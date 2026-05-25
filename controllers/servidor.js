const ServidorService = require('../services/servidor.service');

const listarVeterinarios = async (req, res, next) => {
  try {
    const lista = await ServidorService.listarVeterinarios();
    res.status(200).json(lista);
  } catch (err) {
    next(err);
  }
};

const listarTecnicos = async (req, res, next) => {
  try {
    const lista = await ServidorService.listarTecnicos();
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

const excluirTecnico = async (req, res, next) => {
  try {
    const resultado = await ServidorService.excluirTecnico(req.params.id);
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

const criarVeterinario = async (req, res, next) => {
  try {
    const resultado = await ServidorService.adicionarServidor('veterinario', req.body);
    res.status(201).json(resultado);
  } catch (err) {
    next(err);
  }
};

const criarTecnico = async (req, res, next) => {
  try {
    const resultado = await ServidorService.adicionarServidor('tecnico', req.body);
    res.status(201).json(resultado);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listarVeterinarios,
  listarTecnicos,
  criarVeterinario,
  criarTecnico,
  excluirVeterinario,
  excluirTecnico,
  suspenderVeterinario,
  reativarVeterinario,
};
