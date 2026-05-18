const { Op } = require('sequelize');
const models = require('../models');
const ApiBaseError = require('../auth/base-error');
const sequelizeTransaction = require('../auth/sequelize-transaction');
const EscalaService = require('./escala.service');
const { UsuarioModel, UsuarioPapelModel, PapelModel, OrdemServidorModel } = models;

const PAPEIS_VETERINARIO = ['Veterinario', 'Veterinário'];
const PAPEIS_TECNICO = ['Tecnico', 'Técnico'];
const ESCOPO_ORDEM_VETERINARIO = 'veterinario';
const ESCOPO_ORDEM_TECNICO = 'tecnico';

function normalizarEscopo(escopoRaw) {
  return String(escopoRaw || '').toLowerCase() === ESCOPO_ORDEM_TECNICO ? ESCOPO_ORDEM_TECNICO : ESCOPO_ORDEM_VETERINARIO;
}

function configEscopo(escopo) {
  if (escopo === ESCOPO_ORDEM_TECNICO) {
    return {
      papeis: PAPEIS_TECNICO,
      escopoOrdem: ESCOPO_ORDEM_TECNICO,
      rotuloPapel: 'técnico',
      rotuloPapelTitulo: 'Técnico',
    };
  }
  return {
    papeis: PAPEIS_VETERINARIO,
    escopoOrdem: ESCOPO_ORDEM_VETERINARIO,
    rotuloPapel: 'veterinário',
    rotuloPapelTitulo: 'Veterinário',
  };
}

async function listarPorEscopo(escopoRaw) {
  const escopo = normalizarEscopo(escopoRaw);
  const cfg = configEscopo(escopo);
  const papel = await PapelModel.findOne({ where: { nome: { [Op.in]: cfg.papeis } } });
  if (!papel) return [];

  const rows = await UsuarioModel.findAll({
    include: [{ model: UsuarioPapelModel, required: true, where: { PapelModelId: papel.id } }],
    where: { ativo: true },
    attributes: ['id', 'nome', 'login', 'suspensoEscala'],
    order: [['nome', 'ASC']],
  });
  return rows.map((u) => u.get({ plain: true }));
}

const ServidorService = {
  listarVeterinarios: async () => listarPorEscopo(ESCOPO_ORDEM_VETERINARIO),

  listarTecnicos: async () => listarPorEscopo(ESCOPO_ORDEM_TECNICO),

  excluirVeterinario: async (usuarioIdRaw) => ServidorService.excluirServidor(usuarioIdRaw, ESCOPO_ORDEM_VETERINARIO),

  excluirTecnico: async (usuarioIdRaw) => ServidorService.excluirServidor(usuarioIdRaw, ESCOPO_ORDEM_TECNICO),

  excluirServidor: async (usuarioIdRaw, escopoRaw) => {
    const escopo = normalizarEscopo(escopoRaw);
    const cfg = configEscopo(escopo);
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

      const papel = await PapelModel.findOne({
        where: { nome: { [Op.in]: cfg.papeis } },
        transaction: t,
      });
      if (!papel) throw new ApiBaseError(`Papel de ${cfg.rotuloPapel} não encontrado.`);

      const usuario = await UsuarioModel.findByPk(usuarioId, { transaction: t });
      if (!usuario) throw new ApiBaseError(`${cfg.rotuloPapelTitulo} não encontrado.`);

      const vinculo = await UsuarioPapelModel.findOne({
        where: { UsuarioModelId: usuarioId, PapelModelId: papel.id },
        transaction: t,
      });
      if (!vinculo) {
        throw new ApiBaseError(`O usuário informado não está vinculado ao papel de ${cfg.rotuloPapel}.`);
      }

      const recalcEscalas = await EscalaService.removerUsuarioDasEscalasAtivas(usuarioId, t);

      await OrdemServidorModel.destroy({ where: { usuarioId, escopo: cfg.escopoOrdem }, transaction: t });
      const ordemRestante = await OrdemServidorModel.findAll({
        where: { escopo: cfg.escopoOrdem },
        order: [['ordem', 'ASC']],
        transaction: t,
      });
      const idsRestantes = ordemRestante
        .map((r) => Number(r.usuarioId))
        .filter((id) => Number.isFinite(id) && id > 0 && id !== usuarioId);
      await OrdemServidorModel.destroy({ where: { escopo: cfg.escopoOrdem }, transaction: t });
      if (idsRestantes.length > 0) {
        await OrdemServidorModel.bulkCreate(
          idsRestantes.map((id, idx) => ({
            usuarioId: id,
            ordem: idx + 1,
            escopo: cfg.escopoOrdem,
          })),
          { transaction: t },
        );
      }

      await UsuarioPapelModel.destroy({
        where: { UsuarioModelId: usuarioId, PapelModelId: papel.id },
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
