const express = require('express');
const router = express.Router();
const ctl = require('../controllers/servidor');

router.get('/veterinarios-saldo', ctl.listarSaldoVeterinarios);

module.exports = router;
