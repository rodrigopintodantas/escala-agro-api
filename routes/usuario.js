var express = require('express');
var router = express.Router();
const ctl = require('../controllers/usuario');
const { authorize } = require('../auth/authorize');

const _ROLES = require('../auth/role');

router.get('/total', ctl.total);
router.get('/', ctl.listar);
router.post('/', ctl.criar);
router.post('/criar-admin', authorize([_ROLES.ADMIN]), ctl.criarAdmin);
router.get('/gestor', ctl.listarGestores);
router.get('/todos', authorize([_ROLES.ADMIN]), ctl.listarAdmin);

router.post('/gestor-nuest', ctl.criar);
router.post('/excluir-lista', ctl.excluirLista);
router.put('/bloquear/:id', ctl.bloquear);
router.put('/desbloquear/:id', ctl.desbloquear);
router.delete('/:id', ctl.excluir);
router.put('/:id', ctl.alterar);
router.get('/:id', ctl.consultarPeloId);

module.exports = router;
