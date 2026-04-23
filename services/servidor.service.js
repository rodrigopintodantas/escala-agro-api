const { Op } = require('sequelize');
const models = require('../models');
const ApiBaseError = require('../auth/base-error');
const sequelizeTransaction = require('../auth/sequelize-transaction');
const EscalaService = require('./escala.service');
const { UsuarioModel, UsuarioPapelModel, PapelModel, OrdemServidorModel } = models;

const PAPEIS_VETERINARIO = ['Veterinario', 'Veterinário'];
const ESCOPO_ORDEM_VETERINARIO = 'veterinario';

const ServidorService = {
  listarVeterinarios: async () => {
    const papelVet = await PapelModel.findOne({ where: { nome: { [Op.in]: PAPEIS_VETERINARIO } } });
    if (!papelVet) return [];

    const rows = await UsuarioModel.findAll({
      include: [{ model: UsuarioPapelModel, required: true, where: { PapelModelId: papelVet.id } }],
      where: { ativo: true },
      attributes: ['id', 'nome', 'login'],
      order: [['nome', 'ASC']],
    });
    return rows.map((u) => u.get({ plain: true }));
  },

  excluirVeterinario: async (usuarioIdRaw) => {
    const usuarioId = Number(usuarioIdRaw);
    if (!Number.isFinite(usuarioId) || usuarioId < 1) {
      throw new ApiBaseError('Usuário inválido.');
    }

    return await sequelizeTransaction(async (t) => {
      const papelVet = await PapelModel.findOne({
        where: { nome: { [Op.in]: PAPEIS_VETERINARIO } },
        transaction: t,
      });
      if (!papelVet) throw new ApiBaseError('Papel de veterinário não encontrado.');

      const usuario = await UsuarioModel.findByPk(usuarioId, { transaction: t });
      if (!usuario) throw new ApiBaseError('Veterinário não encontrado.');

      const vinculoVet = await UsuarioPapelModel.findOne({
        where: { UsuarioModelId: usuarioId, PapelModelId: papelVet.id },
        transaction: t,
      });
      if (!vinculoVet) {
        throw new ApiBaseError('O usuário informado não está vinculado ao papel de veterinário.');
      }

      const recalcEscalas = await EscalaService.removerUsuarioDasEscalasAtivas(usuarioId, t);

      await OrdemServidorModel.destroy({ where: { usuarioId, escopo: ESCOPO_ORDEM_VETERINARIO }, transaction: t });
      const ordemRestante = await OrdemServidorModel.findAll({
        where: { escopo: ESCOPO_ORDEM_VETERINARIO },
        order: [['ordem', 'ASC']],
        transaction: t,
      });
      const idsRestantes = ordemRestante
        .map((r) => Number(r.usuarioId))
        .filter((id) => Number.isFinite(id) && id > 0 && id !== usuarioId);
      await OrdemServidorModel.destroy({ where: { escopo: ESCOPO_ORDEM_VETERINARIO }, transaction: t });
      if (idsRestantes.length > 0) {
        await OrdemServidorModel.bulkCreate(
          idsRestantes.map((id, idx) => ({
            usuarioId: id,
            ordem: idx + 1,
            escopo: ESCOPO_ORDEM_VETERINARIO,
          })),
          { transaction: t },
        );
      }

      await UsuarioPapelModel.destroy({
        where: { UsuarioModelId: usuarioId, PapelModelId: papelVet.id },
        transaction: t,
      });

      usuario.ativo = false;
      await usuario.save({ transaction: t });

      return {
        removido: true,
        recalcEscalas,
      };
    });
  },
};

module.exports = ServidorService;
