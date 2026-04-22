const express = require('express');
const { authorize } = require('../auth/authorize');
const _ROLES = require('../auth/role');
const ctl = require('../controllers/escala');

const router = express.Router();
const somenteAdmin = authorize([_ROLES.ADMIN]);

/** Leitura: admin ou veterinário. Alteração / lista para criar escala: só admin. */
router.get('/veterinarios', somenteAdmin, ctl.listarVeterinarios);
router.get('/ordem-servidores', somenteAdmin, ctl.listarOrdemServidores);
router.put('/ordem-servidores', somenteAdmin, ctl.salvarOrdemServidores);
router.get('/permutas', ctl.listarPermutas);
router.post('/permutas/:permutaId/cancelar', ctl.cancelarPermuta);
router.post('/permutas/:permutaId/aceitar', ctl.aceitarPermuta);
router.post('/permutas/:permutaId/recusar', ctl.recusarPermuta);
router.post('/:id/datas-plantao-extras', somenteAdmin, ctl.adicionarDatasPlantaoExtras);
router.post('/:id/remover-plantoes-feriados', somenteAdmin, ctl.removerPlantoesFeriados);
router.post('/:id/ativar', somenteAdmin, ctl.ativar);
router.post('/:id/concluir', somenteAdmin, ctl.concluir);
router.post('/:id/solicitar-permuta', ctl.solicitarPermuta);
router.get('/:id/previsao-plantoes', ctl.preverProximosPlantoes);
router.get('/:id', ctl.consultar);
router.delete('/:id', somenteAdmin, ctl.excluir);
router.get('/', ctl.listar);
router.post('/', somenteAdmin, ctl.criar);

module.exports = router;
