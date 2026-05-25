const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const models = require('../models');
const ApiBaseError = require('../auth/base-error');
const sequelizeTransaction = require('../auth/sequelize-transaction');
const EscalaService = require('./escala.service');
const { UsuarioModel, UsuarioPapelModel, PapelModel, OrdemServidorModel, EscalaModel } = models;

const SENHA_PADRAO_NOVO_SERVIDOR = '123456';
const STATUS_ESCALA_BLOQUEIA_ORDEM = ['rascunho', 'ativa'];

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

function whereNaoAguardandoOrdemEscopo(escopo) {
  return {
    [Op.or]: [{ aguardandoOrdemEscopo: null }, { aguardandoOrdemEscopo: { [Op.ne]: escopo } }],
  };
}

async function existeEscalaRascunhoOuAtiva(transaction) {
  const row = await EscalaModel.findOne({
    where: { status: { [Op.in]: STATUS_ESCALA_BLOQUEIA_ORDEM } },
    attributes: ['id'],
    transaction,
  });
  return !!row;
}

async function persistirOrdemEscopo(usuarioIds, escopo, transaction) {
  const ids = [...new Set((usuarioIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))];
  await OrdemServidorModel.destroy({ where: { escopo }, transaction });
  if (ids.length === 0) return;
  await OrdemServidorModel.bulkCreate(
    ids.map((usuarioId, idx) => ({
      usuarioId,
      ordem: idx + 1,
      escopo,
    })),
    { transaction },
  );
}

async function adicionarUsuarioAoFinalOrdemGlobal(usuarioId, escopo, transaction) {
  const uid = Number(usuarioId);
  if (!Number.isFinite(uid) || uid < 1) return;

  const rows = await OrdemServidorModel.findAll({
    where: { escopo },
    order: [['ordem', 'ASC']],
    transaction,
  });
  const ids = rows.map((r) => Number(r.usuarioId)).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.includes(uid)) ids.push(uid);
  await persistirOrdemEscopo(ids, escopo, transaction);
}

async function listarPorEscopo(escopoRaw) {
  const escopo = normalizarEscopo(escopoRaw);
  const cfg = configEscopo(escopo);
  const papel = await PapelModel.findOne({ where: { nome: { [Op.in]: cfg.papeis } } });
  if (!papel) {
    return { ativos: [], aguardandoConclusaoEscala: [], existeEscalaBloqueandoOrdem: false };
  }

  const rows = await UsuarioModel.findAll({
    include: [{ model: UsuarioPapelModel, required: true, where: { PapelModelId: papel.id } }],
    where: { ativo: true },
    attributes: ['id', 'nome', 'login', 'suspensoEscala', 'aguardandoOrdemEscopo'],
    order: [['nome', 'ASC']],
  });
  const plain = rows.map((u) => u.get({ plain: true }));
  const aguardando = plain.filter((u) => String(u.aguardandoOrdemEscopo || '').toLowerCase() === escopo);
  const ativos = plain.filter((u) => String(u.aguardandoOrdemEscopo || '').toLowerCase() !== escopo);
  const existeEscalaBloqueandoOrdem = await existeEscalaRascunhoOuAtiva();

  return { ativos, aguardandoConclusaoEscala: aguardando, existeEscalaBloqueandoOrdem };
}

const ServidorService = {
  existeEscalaRascunhoOuAtiva,

  whereNaoAguardandoOrdemEscopo,

  promoverAguardandoOrdemGlobal: async (escopoRaw, transaction) => {
    const escopo = normalizarEscopo(escopoRaw);
    const cfg = configEscopo(escopo);
    const papel = await PapelModel.findOne({
      where: { nome: { [Op.in]: cfg.papeis } },
      transaction,
    });
    if (!papel) return { promovidos: 0 };

    const aguardando = await UsuarioModel.findAll({
      include: [{ model: UsuarioPapelModel, required: true, where: { PapelModelId: papel.id } }],
      where: { ativo: true, aguardandoOrdemEscopo: cfg.escopoOrdem },
      order: [['id', 'ASC']],
      transaction,
    });
    if (aguardando.length === 0) return { promovidos: 0 };

    const rows = await OrdemServidorModel.findAll({
      where: { escopo: cfg.escopoOrdem },
      order: [['ordem', 'ASC']],
      transaction,
    });
    const ids = rows.map((r) => Number(r.usuarioId)).filter((id) => Number.isFinite(id) && id > 0);

    for (const usuario of aguardando) {
      const uid = Number(usuario.id);
      if (!ids.includes(uid)) ids.push(uid);
      usuario.aguardandoOrdemEscopo = null;
      await usuario.save({ transaction });
    }

    await persistirOrdemEscopo(ids, cfg.escopoOrdem, transaction);
    return { promovidos: aguardando.length };
  },

  adicionarServidor: async (escopoRaw, payload) => {
    const escopo = normalizarEscopo(escopoRaw);
    const cfg = configEscopo(escopo);
    const nome = String(payload?.nome || '').trim();
    const login = String(payload?.login || '').trim().toLowerCase();
    if (!nome) throw new ApiBaseError('Informe o nome do servidor.');
    if (!login) throw new ApiBaseError('Informe o login do servidor.');

    return await sequelizeTransaction(async (t) => {
      const papel = await PapelModel.findOne({
        where: { nome: { [Op.in]: cfg.papeis } },
        transaction: t,
      });
      if (!papel) throw new ApiBaseError(`Papel de ${cfg.rotuloPapel} não encontrado.`);

      const loginExistente = await UsuarioModel.findOne({ where: { login }, transaction: t });
      if (loginExistente) throw new ApiBaseError('Já existe um usuário com este login.');

      const prefixo = escopo === ESCOPO_ORDEM_TECNICO ? 'tec' : 'vet';
      const emailInformado = String(payload?.email || '').trim();
      const email = emailInformado || `${prefixo}_${login}@escala.local`;
      const cargo = String(payload?.cargo || '').trim() || cfg.rotuloPapelTitulo;

      const usuario = await UsuarioModel.create(
        {
          nome,
          login,
          email,
          cargo,
          telefone: String(payload?.telefone || '').trim() || null,
          genero: String(payload?.genero || 'masculino').trim() || 'masculino',
          senhaHash: await bcrypt.hash(SENHA_PADRAO_NOVO_SERVIDOR, 10),
          ativo: true,
          suspensoEscala: false,
          aguardandoOrdemEscopo: null,
        },
        { transaction: t },
      );

      await UsuarioPapelModel.create(
        {
          UsuarioModelId: usuario.id,
          PapelModelId: papel.id,
        },
        { transaction: t },
      );

      const bloqueiaOrdem = await existeEscalaRascunhoOuAtiva(t);
      if (bloqueiaOrdem) {
        usuario.aguardandoOrdemEscopo = cfg.escopoOrdem;
        await usuario.save({ transaction: t });
      } else {
        await adicionarUsuarioAoFinalOrdemGlobal(usuario.id, cfg.escopoOrdem, t);
      }

      return {
        servidor: {
          id: Number(usuario.id),
          nome: usuario.nome,
          login: usuario.login,
          aguardandoConclusaoEscala: bloqueiaOrdem,
        },
        senhaPadrao: SENHA_PADRAO_NOVO_SERVIDOR,
      };
    });
  },

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
