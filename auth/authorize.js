const { UsuarioPapelModel, PapelModel, UsuarioModel } = require('../models');

/**
 * Autenticação simples sem SSO:
 * - Lê o login do usuário do header Authorization.
 * - Formato recomendado: "Authorization: Bearer login_do_usuario"
 * - Também aceita apenas o valor do login (sem Bearer) como fallback.
 */
function getLoginFromRequest(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
    return parts[1];
  }

  return authHeader;
}

function temPermissao(userRoles = [], functionRoles = []) {
  if (userRoles.length == 0) {
    return false;
  }
  return userRoles.some((element) => functionRoles.indexOf(element) > -1);
}

function authorize(functionRoles = []) {
  if (typeof functionRoles === 'string') {
    functionRoles = [functionRoles];
  }

  return async (req, res, next) => {
    try {
      const login = getLoginFromRequest(req);

      if (!login) {
        return res.status(401).json({ message: 'Cabeçalho Authorization não informado.' });
      }

      const usuario = await getUsuario(login);
      if (!usuario) {
        return res.status(400).json({
          message: 'O usuário não existe no sistema. ',
        });
      }

      if (!usuario.ativo) {
        return res.status(401).json({
          message: 'O usuário está bloqueado no sistema. ',
        });
      }

      const papelHeader = req.headers['up'];
      if (papelHeader != null && papelHeader !== '') {
        const papelId = parseInt(papelHeader, 10);
        if (!Number.isNaN(papelId)) {
          const upSel = await getPapelUsuarioPeloId(usuario.id, papelId);
          if (!upSel) {
            return res.status(400).json({
              message: 'O usuário não tem perfil no sistema. ',
            });
          }
        }
      }

      const ups = await getPapelUsuario(usuario);
      if (!ups || ups.length === 0) {
        return res.status(400).json({
          message: 'O usuário não tem perfil no sistema. ',
        });
      }

      if (
        !temPermissao(
          ups.map((up) => up.nome),
          functionRoles,
        )
      ) {
        return res.status(401).json({
          message: 'Usuário sem perfil',
        });
      }

      req.auth = {
        preferred_username: login,
        UsuarioId: usuario.id,
      };

      next();
    } catch (error) {
      console.error('Erro no middleware authorize:', error);
      return res.status(401).json({
        message: 'Não autorizado. ',
      });
    }
  };
}

function authorizeSemPerfilSelecionado() {
  return async (req, res) => {
    try {
      const login = getLoginFromRequest(req);

      if (!login) {
        return res.status(401).json({ message: 'Cabeçalho Authorization não informado.' });
      }

      const usuario = await getUsuario(login);
      if (!usuario) {
        return res.status(400).json({
          message: 'O usuário não existe no sistema. ',
        });
      }

      if (!usuario.ativo) {
        return res.status(401).json({
          message: 'O usuário está bloqueado no sistema. ',
        });
      }

      const up = await getPapelUsuario(usuario);

      if (!up || up.length === 0) {
        return res.status(400).json({
          message: 'O usuário não possui perfil no sistema.',
        });
      }

      req.auth = {
        preferred_username: login,
        UsuarioId: usuario.id,
      };

      return res.status(200).send({ usuario: usuario, up: up });
    } catch (error) {
      console.error('Erro no middleware authorizeSemPerfilSelecionado:', error);
      return res.status(401).json({
        message: 'Não autorizado. ',
      });
    }
  };
}

async function getUsuario(preferred_username) {
  const usuario = await UsuarioModel.findOne({
    where: {
      login: preferred_username,
    },
    attributes: ['id', 'login', 'ativo', 'nome', 'cargo', 'email', 'documento'],
  });

  return usuario;
}

async function getPapelUsuarioPeloId(UsuarioId, PapelId) {
  try {
    const resultado = await UsuarioPapelModel.findOne({
      where: {
        UsuarioModelId: UsuarioId,
        PapelModelId: PapelId,
      },
    });

    return resultado;
  } catch (error) {
    console.error('Erro ao buscar papel:', error);
    throw error;
  }
}

async function getPapelUsuario(usuario) {
  const up = await UsuarioPapelModel.findAll({
    where: {
      UsuarioModelId: usuario.id,
    },
    include: [
      {
        model: PapelModel,
        attributes: ['id', 'dashboard', 'nome', 'descricao'],
      },
    ],
  });
  return up.map((u) => {
    return {
      id: u.PapelModel.id,
      nome: u.PapelModel.nome,
      descricao: u.PapelModel.descricao,
      dashboard: u.PapelModel.dashboard,
    };
  });
}

module.exports = {
  authorizeSemPerfilSelecionado,
  authorize,
};
