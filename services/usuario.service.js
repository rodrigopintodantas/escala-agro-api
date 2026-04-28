const { Op } = require('sequelize');
const sequelizeTransaction = require('../auth/sequelize-transaction');
const { UsuarioModel, PapelModel, UsuarioPapelModel } = require('../models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ApiBaseError = require('../auth/base-error');

const AUTH_JWT_EXPIRES_IN = process.env.AUTH_JWT_EXPIRES_IN || '8h';

function getJwtSecret() {
  return process.env.AUTH_JWT_SECRET || 'escala-agro-dev-secret';
}

const UsuarioService = {
  consultaPeloId: async (usuarioId) => {
    return await UsuarioModel.findOne({ where: { id: usuarioId } });
  },

  consultaPeloLogin: async (login) => {
    return await UsuarioModel.findOne({ where: { login } });
  },

  autenticar: async (login, senha) => {
    const usuario = await UsuarioModel.findOne({
      where: { login },
      attributes: ['id', 'login', 'ativo', 'senhaHash'],
    });
    if (!usuario) {
      throw new ApiBaseError('Login ou senha inválidos.');
    }
    if (!usuario.ativo) {
      throw new ApiBaseError('O usuário está bloqueado no sistema.');
    }
    const ok = await bcrypt.compare(senha, usuario.senhaHash || '');
    if (!ok) {
      throw new ApiBaseError('Login ou senha inválidos.');
    }
    const token = jwt.sign(
      {
        login: usuario.login,
        usuarioId: usuario.id,
      },
      getJwtSecret(),
      { expiresIn: AUTH_JWT_EXPIRES_IN },
    );
    return { token };
  },

  listar: async () => {
    return await UsuarioModel.findAll({
      include: [
        {
          model: UsuarioPapelModel,
          include: [
            {
              model: PapelModel,
            },
          ],
        },
      ],
      order: [['nome', 'ASC']],
    });
  },

  listaAdmin: async () => {
    return await UsuarioModel.findAll({
      include: [
        {
          model: UsuarioPapelModel,
          include: [{ model: PapelModel }],
        },
      ],
      order: [['nome', 'ASC']],
    });
  },

  listaGestores: async () => {
    return await UsuarioModel.findAll({
      include: [
        {
          model: UsuarioPapelModel,
          required: true,
          where: { PapelModelId: 1 },
          include: [{ model: PapelModel }],
        },
      ],
      order: [['nome', 'ASC']],
    });
  },

  criar: async (objetoReq, roles) => {
    let perfis = [];
    if (roles && Array.isArray(roles) && roles.length > 0) {
      perfis = await PapelModel.findAll({
        where: {
          [Op.or]: [{ nome: { [Op.in]: roles } }, { descricao: { [Op.in]: roles } }],
        },
      });
    }

    await sequelizeTransaction(async (t) => {
      let objeto = await UsuarioModel.create(
        {
          nome: objetoReq.nome,
          cargo: objetoReq.cargo,
          email: objetoReq.email,
          telefone: objetoReq.telefone,
          genero: objetoReq.genero,
          login: objetoReq.login,
          senhaHash: await bcrypt.hash(String(objetoReq.senha || '123456'), 10),
          ativo: true,
          documento: objetoReq.documento || null,
        },
        { transaction: t },
      );

      if (perfis && perfis.length > 0) {
        for (let index = 0; index < perfis.length; index++) {
          await UsuarioPapelModel.create(
            {
              UsuarioModelId: objeto.id,
              PapelModelId: perfis[index].id,
            },
            { transaction: t },
          );
        }
      }
    });
  },

  criarAdmin: async (objetoReq) => {
    const perfil = await PapelModel.findOne({
      where: { nome: 'ADMIN' },
    });

    await sequelizeTransaction(async (t) => {
      let objeto = await UsuarioModel.create(
        {
          nome: objetoReq.nome,
          cargo: objetoReq.cargo,
          email: objetoReq.email,
          telefone: objetoReq.telefone,
          genero: objetoReq.genero,
          login: objetoReq.login,
          senhaHash: await bcrypt.hash(String(objetoReq.senha || '123456'), 10),
          ativo: true,
          documento: objetoReq.documento || null,
        },
        { transaction: t },
      );

      await UsuarioPapelModel.create(
        {
          UsuarioModelId: objeto.id,
          PapelModelId: perfil.id,
        },
        { transaction: t },
      );
    });
  },

  alterar: async (objetoReq, roles) => {
    let objeto = await UsuarioModel.findByPk(objetoReq.id);

    if (!objeto) {
      throw new Error('Usuário não encontrado');
    }

    let perfis = [];
    if (roles && Array.isArray(roles) && roles.length > 0) {
      perfis = await PapelModel.findAll({
        where: {
          [Op.or]: [{ nome: { [Op.in]: roles } }, { descricao: { [Op.in]: roles } }],
        },
      });
    }

    await sequelizeTransaction(async (t) => {
      objeto = await objeto.update(
        {
          nome: objetoReq.nome,
          cargo: objetoReq.cargo,
          email: objetoReq.email,
          telefone: objetoReq.telefone,
          genero: objetoReq.genero,
          login: objetoReq.login,
          ...(objetoReq.senha ? { senhaHash: await bcrypt.hash(String(objetoReq.senha), 10) } : {}),
          ativo: objetoReq.ativo,
          documento: objetoReq.documento || null,
        },
        { transaction: t },
      );

      await UsuarioPapelModel.destroy({
        where: {
          UsuarioModelId: objetoReq.id,
        },
        transaction: t,
      });

      if (perfis && perfis.length > 0) {
        for (let index = 0; index < perfis.length; index++) {
          await UsuarioPapelModel.create(
            {
              UsuarioModelId: objetoReq.id,
              PapelModelId: perfis[index].id,
            },
            { transaction: t },
          );
        }
      }
    });

    return objeto;
  },

  excluir: async (usuarioId) => {
    await sequelizeTransaction(async (t) => {
      await UsuarioPapelModel.destroy({
        where: {
          UsuarioModelId: usuarioId,
        },
        transaction: t,
      });

      const objeto = await UsuarioModel.findByPk(usuarioId);
      if (!objeto) {
        throw new Error('Usuário não encontrado');
      }
      await objeto.destroy({ transaction: t });
    });
  },

  excluirLista: async (ids) => {
    await sequelizeTransaction(async (t) => {
      await UsuarioPapelModel.destroy({
        where: {
          UsuarioModelId: {
            [Op.in]: ids,
          },
        },
        transaction: t,
      });

      await UsuarioModel.destroy({
        where: {
          id: {
            [Op.in]: ids,
          },
        },
        transaction: t,
      });
    });
  },

  bloquear: async (usuarioId) => {
    let objeto = await UsuarioModel.findByPk(usuarioId);
    objeto = await objeto.update({
      ativo: false,
    });
    return objeto;
  },

  desbloquear: async (usuarioId) => {
    let objeto = await UsuarioModel.findByPk(usuarioId);
    objeto = await objeto.update({
      ativo: true,
    });
    return objeto;
  },

  total: async () => {
    return await UsuarioModel.count();
  },
};

module.exports = UsuarioService;
