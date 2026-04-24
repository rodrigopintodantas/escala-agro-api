const ServidorService = require('../services/servidor.service');

const listarVeterinarios = async (req, res, next) => {
  try {
    const lista = await ServidorService.listarVeterinarios();
    res.status(200).json(lista);
  } catch (err) {
    next(err);
  }
};

const excluirVeterinario = async (req, res, next) => {
  try {
    const resultado = await ServidorService.excluirVeterinario(req.params.id);
    res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
};

const suspenderVeterinario = async (req, res, next) => {
  try {
    const resultado = await ServidorService.suspenderVeterinarioEmEscalasAtivas(req.params.id);
    res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
};

const reativarVeterinario = async (req, res, next) => {
  try {
    const resultado = await ServidorService.reativarVeterinarioEmEscalasAtivas(req.params.id);
    res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listarVeterinarios,
  excluirVeterinario,
  suspenderVeterinario,
  reativarVeterinario,
};
