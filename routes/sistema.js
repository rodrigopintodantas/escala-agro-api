const express = require('express');
const router = express.Router();
const ctl = require('../controllers/sistema');

router.post('/reiniciar-teste', ctl.reiniciarTeste);

module.exports = router;

