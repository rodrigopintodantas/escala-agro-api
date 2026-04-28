const ApiBaseError = require('../auth/base-error');
const UsuarioService = require('../services/usuario.service');

const login = async (req, res, next) => {
  try {
    const { login, senha } = req.body || {};
    if (!login || !senha) {
      throw new ApiBaseError('Informe login e senha.');
    }

    const autenticado = await UsuarioService.autenticar(String(login).trim(), String(senha));
    res.status(200).json(autenticado);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  login,
};

