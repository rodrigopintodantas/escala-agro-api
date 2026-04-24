const express = require('express');
const router = express.Router();
const ctl = require('../controllers/servidor');

router.get('/veterinarios', ctl.listarVeterinarios);
router.post('/veterinarios/:id/suspender', ctl.suspenderVeterinario);
router.post('/veterinarios/:id/reativar', ctl.reativarVeterinario);
router.delete('/veterinarios/:id', ctl.excluirVeterinario);

module.exports = router;
