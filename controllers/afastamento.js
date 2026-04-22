const AfastamentoService = require('../services/afastamento.service');

const listarTipos = async (req, res, next) => {
  try {
    const lista = await AfastamentoService.listarTipos();
    res.status(200).json(lista);
  } catch (err) {
    next(err);
  }
};

const listar = async (req, res, next) => {
  try {
    const usuId = req.auth && req.auth.UsuarioId ? req.auth.UsuarioId : null;
    if (!usuId) {
      return res.status(401).json({ message: 'Não autenticado.' });
    }
    const lista = await AfastamentoService.listarParaUsuario(usuId);
    res.status(200).json(lista);
  } catch (err) {
    next(err);
  }
};

const criar = async (req, res, next) => {
  try {
    const usuId = req.auth && req.auth.UsuarioId ? req.auth.UsuarioId : null;
    if (!usuId) {
      return res.status(401).json({ message: 'Não autenticado.' });
    }
    const criado = await AfastamentoService.criar(usuId, req.body || {});
    res.status(201).json(criado);
  } catch (err) {
    next(err);
  }
};

const desfazer = async (req, res, next) => {
  try {
    const usuId = req.auth && req.auth.UsuarioId ? req.auth.UsuarioId : null;
    if (!usuId) {
      return res.status(401).json({ message: 'Não autenticado.' });
    }
    const resultado = await AfastamentoService.desfazer(usuId, req.params.id);
    res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listarTipos,
  listar,
  criar,
  desfazer,
};
