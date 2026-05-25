const express = require('express');
const router = express.Router();
const ctl = require('../controllers/servidor');

router.get('/veterinarios', ctl.listarVeterinarios);
router.post('/veterinarios', ctl.criarVeterinario);
router.post('/veterinarios/:id/suspender', ctl.suspenderVeterinario);
router.post('/veterinarios/:id/reativar', ctl.reativarVeterinario);
router.delete('/veterinarios/:id', ctl.excluirVeterinario);

router.get('/tecnicos', ctl.listarTecnicos);
router.post('/tecnicos', ctl.criarTecnico);
router.post('/tecnicos/:id/suspender', ctl.suspenderVeterinario);
router.post('/tecnicos/:id/reativar', ctl.reativarVeterinario);
router.delete('/tecnicos/:id', ctl.excluirTecnico);

module.exports = router;
