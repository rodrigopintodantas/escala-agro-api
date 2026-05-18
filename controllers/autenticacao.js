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

const alterarSenha = async (req, res, next) => {
  try {
    const senhaAtual = req.body?.senha_atual != null ? String(req.body.senha_atual) : '';
    const senhaNova = req.body?.senha_nova != null ? String(req.body.senha_nova) : '';
    const senhaNovaConfirmacao =
      req.body?.senha_nova_confirmacao != null ? String(req.body.senha_nova_confirmacao) : '';

    if (!senhaAtual) {
      throw new ApiBaseError('Informe a senha atual.');
    }
    if (senhaNova.length < 6) {
      throw new ApiBaseError('A nova senha deve ter pelo menos 6 caracteres.');
    }
    if (senhaNova !== senhaNovaConfirmacao) {
      throw new ApiBaseError('A confirmação da nova senha não confere.');
    }

    const retorno = await UsuarioService.alterarSenha(req.auth.UsuarioId, senhaAtual, senhaNova);
    res.status(200).json(retorno);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  login,
  alterarSenha,
};

