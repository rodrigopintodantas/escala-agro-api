const express = require('express');
const router = express.Router();
const ctl = require('../controllers/sistema');

router.post('/reiniciar-teste', ctl.reiniciarTeste);
router.post('/carregar-desenvolvimento', ctl.carregarDesenvolvimento);
router.post('/carregar-producao', ctl.carregarProducao);

module.exports = router;

