const SistemaService = require('../services/sistema.service');

const reiniciarTeste = async (req, res, next) => {
  try {
    const resultado = await SistemaService.reiniciarTeste();
    res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
};

const carregarDesenvolvimento = async (req, res, next) => {
  try {
    const resultado = await SistemaService.carregarDesenvolvimento();
    res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
};

const carregarProducao = async (req, res, next) => {
  try {
    const resultado = await SistemaService.carregarProducao();
    res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  reiniciarTeste,
  carregarDesenvolvimento,
  carregarProducao,
};

