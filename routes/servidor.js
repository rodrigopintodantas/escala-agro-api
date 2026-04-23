const express = require('express');
const router = express.Router();
const ctl = require('../controllers/servidor');

router.get('/veterinarios', ctl.listarVeterinarios);
router.delete('/veterinarios/:id', ctl.excluirVeterinario);

module.exports = router;
