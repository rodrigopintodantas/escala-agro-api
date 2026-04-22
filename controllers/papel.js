const PapelService = require('../services/papel.service');

const consultarPeloId = async (req, res) => {
  return res.status(200).send(await PapelService.consultaPeloId(req.params.id));
};

const ativos = async (req, res) => {
  res.status(200).send(await PapelService.consultaAtivos());
};

module.exports = {
  ativos,
  consultarPeloId,
};
