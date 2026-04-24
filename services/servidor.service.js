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
      attributes: ['id', 'nome', 'login', 'suspensoEscala'],
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
      const existeEscalaAtiva = await models.EscalaModel.findOne({
        where: { status: 'ativa' },
        attributes: ['id'],
        transaction: t,
      });
      if (existeEscalaAtiva) {
        throw new ApiBaseError(
          'Há escala ativa no momento. Não é possível excluir servidor; utilize a ação de suspender servidor.',
        );
      }

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

  suspenderVeterinarioEmEscalasAtivas: async (usuarioIdRaw) => {
    const usuarioId = Number(usuarioIdRaw);
    if (!Number.isFinite(usuarioId) || usuarioId < 1) {
      throw new ApiBaseError('Usuário inválido.');
    }

    return await sequelizeTransaction(async (t) => {
      const usuario = await UsuarioModel.findByPk(usuarioId, { transaction: t });
      if (!usuario) throw new ApiBaseError('Servidor não encontrado.');

      const membrosAtivos = await models.EscalaMembroModel.findAll({
        include: [
          {
            model: models.EscalaModel,
            as: 'escala',
            required: true,
            where: { status: 'ativa' },
            attributes: ['id'],
          },
        ],
        where: { usuarioId, ativo: true },
        attributes: ['escalaId'],
        transaction: t,
      });
      const escalaIds = [...new Set(membrosAtivos.map((m) => Number(m.escalaId)).filter((id) => Number.isFinite(id) && id > 0))];
      if (escalaIds.length === 0) {
        return { suspenso: false, escalasAfetadas: 0, plantoesMarcados: 0 };
      }

      usuario.suspensoEscala = true;
      await usuario.save({ transaction: t });

      return {
        suspenso: true,
        escalasAfetadas: escalaIds.length,
        plantoesMarcados: 0,
      };
    });
  },

  reativarVeterinarioEmEscalasAtivas: async (usuarioIdRaw) => {
    const usuarioId = Number(usuarioIdRaw);
    if (!Number.isFinite(usuarioId) || usuarioId < 1) {
      throw new ApiBaseError('Usuário inválido.');
    }

    return await sequelizeTransaction(async (t) => {
      const usuario = await UsuarioModel.findByPk(usuarioId, { transaction: t });
      if (!usuario) throw new ApiBaseError('Servidor não encontrado.');

      const membrosAtivos = await models.EscalaMembroModel.findAll({
        include: [
          {
            model: models.EscalaModel,
            as: 'escala',
            required: true,
            where: { status: 'ativa' },
            attributes: ['id'],
          },
        ],
        where: { usuarioId, ativo: true },
        attributes: ['escalaId'],
        transaction: t,
      });
      const escalaIds = [...new Set(membrosAtivos.map((m) => Number(m.escalaId)).filter((id) => Number.isFinite(id) && id > 0))];

      usuario.suspensoEscala = false;
      await usuario.save({ transaction: t });

      return {
        reativado: true,
        escalasAfetadas: escalaIds.length,
      };
    });
  },
};

module.exports = ServidorService;
