const SistemaService = require('../services/sistema.service');

const reiniciarTeste = async (req, res, next) => {
  try {
    const resultado = await SistemaService.reiniciarTeste();
    res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  reiniciarTeste,
};

