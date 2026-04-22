const ServidorService = require('../services/servidor.service');

const listarSaldoVeterinarios = async (req, res, next) => {
  try {
    const lista = await ServidorService.listarSaldoVeterinarios();
    res.status(200).json(lista);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listarSaldoVeterinarios,
};
