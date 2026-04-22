const ApiBaseError = require('../auth/base-error');
const UsuarioService = require('../services/usuario.service');

const consultarPeloId = async (req, res) => {
  return res.status(200).send(await UsuarioService.consultaPeloId(req.params.id));
};

const listar = async (req, res) => {
  try {
    const usuarios = await UsuarioService.listar();
    res.status(200).send(usuarios);
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    res.status(500).send({ error: 'Erro interno do servidor ao listar usuários' });
  }
};

const listarAdmin = async (req, res) => {
  res.status(200).send(await UsuarioService.listaAdmin());
};

const listarGestores = async (req, res) => {
  res.status(200).send(await UsuarioService.listaGestores());
};

const criar = async (req, res) => {
  let objetoReq = req.body;

  if (!objetoReq) {
    throw new ApiBaseError('Dados do Usuário não informados.');
  }

  const papels = objetoReq.papels || [];
  const roles = papels.map((papel) => papel.nome || papel.descricao);

  await UsuarioService.criar(objetoReq, roles);
  res.status(201).send({ msg: 'Usuario incluido com sucesso.' });
};

const criarAdmin = async (req, res) => {
  let objetoReq = req.body;

  if (!objetoReq) {
    throw new ApiBaseError('Dados do Usuário não informados.');
  }

  await UsuarioService.criarAdmin(objetoReq);
  res.status(201).send({ msg: 'Usuario incluido com sucesso.' });
};

const alterar = async (req, res) => {
  let objetoReq = req.body;

  if (!objetoReq) {
    throw new ApiBaseError('Dados do Usuário não informados.');
  }

  const papels = objetoReq.papels || [];
  const roles = papels.map((papel) => papel.nome || papel.descricao);

  await UsuarioService.alterar(objetoReq, roles);

  res.status(200).send({ msg: 'Usuario atualizado com sucesso.' });
};

const excluir = async (req, res) => {
  await UsuarioService.excluir(req.params.id);
  return res.status(204).send();
};

const total = async (req, res) => {
  res.status(200).send({ total: await UsuarioService.total() });
};

const excluirLista = async (req, res) => {
  const ids = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiBaseError('Lista de IDs não informada ou vazia.');
  }

  await UsuarioService.excluirLista(ids);
  res.status(204).send();
};

const bloquear = async (req, res) => {
  let objetoReq = req.body;
  if (!objetoReq) {
    throw new ApiBaseError('Dados do Usuário não informados.');
  }

  const objeto = await UsuarioService.bloquear(req.params.id);
  res.status(200).send(objeto);
};

const desbloquear = async (req, res) => {
  let objetoReq = req.body;

  if (!objetoReq) {
    throw new ApiBaseError('Dados do Usuário não informados.');
  }

  const objeto = await UsuarioService.desbloquear(req.params.id);
  res.status(200).send(objeto);
};

module.exports = {
  alterar,
  criar,
  criarAdmin,
  listar,
  listarAdmin,
  listarGestores,
  consultarPeloId,
  excluir,
  total,
  excluirLista,
  bloquear,
  desbloquear,
};
