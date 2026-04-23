const EscalaService = require('../services/escala.service');

const listar = async (req, res, next) => {
  try {
    const lista = await EscalaService.listar();
    res.status(200).json(lista);
  } catch (err) {
    next(err);
  }
};

const listarPermutas = async (req, res, next) => {
  try {
    const usuId = req.auth && req.auth.UsuarioId ? req.auth.UsuarioId : null;
    if (!usuId) {
      return res.status(401).json({ message: 'Não autenticado.' });
    }
    const admin = await EscalaService.usuarioEhAdministrador(usuId);
    const lista = await EscalaService.listarPermutas(usuId, admin);
    res.status(200).json(lista);
  } catch (err) {
    next(err);
  }
};

const listarVeterinarios = async (req, res, next) => {
  try {
    const lista = await EscalaService.listarVeterinarios();
    res.status(200).json(lista);
  } catch (err) {
    next(err);
  }
};

const listarTecnicos = async (req, res, next) => {
  try {
    const lista = await EscalaService.listarTecnicos();
    res.status(200).json(lista);
  } catch (err) {
    next(err);
  }
};

const listarOrdemServidores = async (req, res, next) => {
  try {
    const escopo = req.query && String(req.query.escopo || '').toLowerCase() === 'tecnico' ? 'tecnico' : 'veterinario';
    const lista =
      escopo === 'tecnico' ? await EscalaService.listarTecnicos() : await EscalaService.listarVeterinarios();
    res.status(200).json(lista);
  } catch (err) {
    next(err);
  }
};

const salvarOrdemServidores = async (req, res, next) => {
  try {
    const usuarioIds = req.body && Array.isArray(req.body.usuarioIds) ? req.body.usuarioIds : [];
    const escopo = req.body && req.body.escopo != null ? String(req.body.escopo).toLowerCase() : 'veterinario';
    const lista = await EscalaService.salvarOrdemServidores(usuarioIds, escopo);
    res.status(200).json(lista);
  } catch (err) {
    next(err);
  }
};

const criar = async (req, res, next) => {
  try {
    const criadoPor = req.auth && req.auth.UsuarioId ? req.auth.UsuarioId : null;
    const escala = await EscalaService.criar(req.body, criadoPor);
    res.status(201).json(escala);
  } catch (err) {
    next(err);
  }
};

const consultar = async (req, res, next) => {
  try {
    const usuId = req.auth && req.auth.UsuarioId ? req.auth.UsuarioId : null;
    const escala = await EscalaService.consultarPorId(req.params.id, usuId);
    if (!escala) {
      return res.status(404).json({ message: 'Escala não encontrada.' });
    }
    res.status(200).json(escala);
  } catch (err) {
    next(err);
  }
};

const preverProximosPlantoes = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const q = req.query && req.query.quantidade != null ? parseInt(req.query.quantidade, 10) : 8;
    const resultado = await EscalaService.preverProximosPlantoes(id, q);
    res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
};

const excluir = async (req, res, next) => {
  try {
    const ok = await EscalaService.excluir(req.params.id);
    if (!ok) {
      return res.status(404).json({ message: 'Escala não encontrada.' });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const ativar = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const escala = await EscalaService.ativar(id);
    res.status(200).json(escala);
  } catch (err) {
    next(err);
  }
};

const concluir = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const escala = await EscalaService.concluir(id);
    res.status(200).json(escala);
  } catch (err) {
    next(err);
  }
};

const adicionarDatasPlantaoExtras = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { datasPlantaoExtras } = req.body || {};
    const resultado = await EscalaService.adicionarDatasPlantaoExtras(id, datasPlantaoExtras);
    res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
};

const removerPlantoesFeriados = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { plantaoIds } = req.body || {};
    const resultado = await EscalaService.removerPlantoesFeriadosFacultativos(id, plantaoIds);
    res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
};

const solicitarPermuta = async (req, res, next) => {
  try {
    const usuId = req.auth && req.auth.UsuarioId ? req.auth.UsuarioId : null;
    if (!usuId) {
      return res.status(401).json({ message: 'Não autenticado.' });
    }
    const criada = await EscalaService.solicitarPermuta(parseInt(req.params.id, 10), usuId, req.body);
    res.status(201).json(criada);
  } catch (err) {
    next(err);
  }
};

const cancelarPermuta = async (req, res, next) => {
  try {
    const usuId = req.auth && req.auth.UsuarioId ? req.auth.UsuarioId : null;
    if (!usuId) {
      return res.status(401).json({ message: 'Não autenticado.' });
    }
    const ok = await EscalaService.cancelarPermutaSolicitacao(parseInt(req.params.permutaId, 10), usuId);
    res.status(200).json(ok);
  } catch (err) {
    next(err);
  }
};

const aceitarPermuta = async (req, res, next) => {
  try {
    const usuId = req.auth && req.auth.UsuarioId ? req.auth.UsuarioId : null;
    if (!usuId) {
      return res.status(401).json({ message: 'Não autenticado.' });
    }
    const ok = await EscalaService.aceitarPermutaSolicitacao(parseInt(req.params.permutaId, 10), usuId);
    res.status(200).json(ok);
  } catch (err) {
    next(err);
  }
};

const recusarPermuta = async (req, res, next) => {
  try {
    const usuId = req.auth && req.auth.UsuarioId ? req.auth.UsuarioId : null;
    if (!usuId) {
      return res.status(401).json({ message: 'Não autenticado.' });
    }
    const ok = await EscalaService.recusarPermutaSolicitacao(parseInt(req.params.permutaId, 10), usuId);
    res.status(200).json(ok);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listar,
  listarPermutas,
  listarVeterinarios,
  listarTecnicos,
  listarOrdemServidores,
  salvarOrdemServidores,
  consultar,
  preverProximosPlantoes,
  criar,
  excluir,
  ativar,
  concluir,
  adicionarDatasPlantaoExtras,
  removerPlantoesFeriados,
  solicitarPermuta,
  cancelarPermuta,
  aceitarPermuta,
  recusarPermuta,
};
