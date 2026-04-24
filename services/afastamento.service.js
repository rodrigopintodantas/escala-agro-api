const ApiBaseError = require('../auth/base-error');
const EscalaService = require('./escala.service');
const sequelizeTransaction = require('../auth/sequelize-transaction');
const { AfastamentoModel, TipoAfastamentoModel, UsuarioModel } = require('../models');

const includePadrao = [
  {
    model: TipoAfastamentoModel,
    as: 'tipo',
    attributes: ['id', 'tipo', 'descricao', 'regraOrdem'],
  },
  {
    model: UsuarioModel,
    as: 'usuario',
    attributes: ['id', 'nome', 'login', 'email'],
  },
];

const AfastamentoService = {
  listarTipos: async () => {
    const rows = await TipoAfastamentoModel.findAll({
      order: [['id', 'ASC']],
      attributes: ['id', 'tipo', 'descricao', 'regraOrdem'],
    });
    return rows.map((r) => r.get({ plain: true }));
  },

  listarParaUsuario: async (usuarioIdLogado) => {
    const admin = await EscalaService.usuarioEhAdministrador(usuarioIdLogado);
    const where = admin ? {} : { usuarioId: usuarioIdLogado };
    const rows = await AfastamentoModel.findAll({
      where,
      include: includePadrao,
      order: [
        ['dataInicio', 'DESC'],
        ['id', 'DESC'],
      ],
    });
    return rows.map((r) => r.get({ plain: true }));
  },

  criar: async (usuarioIdLogado, body) => {
    const tipoId = parseInt(body.tipoId, 10);
    const dataInicio = typeof body.dataInicio === 'string' ? body.dataInicio.trim().slice(0, 10) : '';
    const dataFim = typeof body.dataFim === 'string' ? body.dataFim.trim().slice(0, 10) : '';

    if (!Number.isFinite(tipoId)) {
      throw new ApiBaseError('Informe o tipo de afastamento.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
      throw new ApiBaseError('Informe data inicial e final no formato AAAA-MM-DD.');
    }
    if (dataFim < dataInicio) {
      throw new ApiBaseError('A data final deve ser igual ou posterior à data inicial.');
    }

    const tipo = await TipoAfastamentoModel.findByPk(tipoId);
    if (!tipo) {
      throw new ApiBaseError('Tipo de afastamento inválido.');
    }

    const admin = await EscalaService.usuarioEhAdministrador(usuarioIdLogado);
    let usuarioRegistro;
    if (admin) {
      if (body.usuarioId == null || body.usuarioId === '') {
        throw new ApiBaseError('Informe o usuário para o afastamento.');
      }
      usuarioRegistro = parseInt(body.usuarioId, 10);
      if (!Number.isFinite(usuarioRegistro)) {
        throw new ApiBaseError('Usuário informado inválido.');
      }
    } else {
      usuarioRegistro = usuarioIdLogado;
    }

    const usuario = await UsuarioModel.findByPk(usuarioRegistro, { attributes: ['id'] });
    if (!usuario) {
      throw new ApiBaseError('Usuário não encontrado.');
    }

    return await sequelizeTransaction(async (t) => {
      const created = await AfastamentoModel.create(
        {
          tipoId,
          usuarioId: usuarioRegistro,
          dataInicio,
          dataFim,
        },
        { transaction: t },
      );

      const recalc = await EscalaService.recalcularEscalasPorAfastamento(created.id, {
        transaction: t,
        criadoPorUsuarioId: usuarioIdLogado,
      });

      const full = await AfastamentoModel.findByPk(created.id, {
        include: includePadrao,
        transaction: t,
      });

      return {
        ...full.get({ plain: true }),
        recalc,
      };
    });
  },

  /** Remove o afastamento e recalcula escalas no período. Admin ou o próprio veterinário. */
  desfazer: async (usuarioIdLogado, afastamentoId) => {
    const id = parseInt(afastamentoId, 10);
    if (!Number.isFinite(id)) {
      throw new ApiBaseError('ID inválido.');
    }

    return await sequelizeTransaction(async (t) => {
      const row = await AfastamentoModel.findByPk(id, {
        include: [{ model: TipoAfastamentoModel, as: 'tipo' }],
        transaction: t,
      });
      if (!row) {
        throw new ApiBaseError('Afastamento não encontrado.');
      }

      const admin = await EscalaService.usuarioEhAdministrador(usuarioIdLogado);
      if (!admin && Number(row.usuarioId) !== Number(usuarioIdLogado)) {
        throw new ApiBaseError('Você não pode desfazer este afastamento.');
      }

      const plain = row.get({ plain: true });
      const recalc = await EscalaService.desfazerAfastamentoRecalculo(plain, t, usuarioIdLogado);
      return { removido: true, recalc };
    });
  },
};

module.exports = AfastamentoService;
