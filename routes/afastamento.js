const express = require('express');
const ctl = require('../controllers/afastamento');

const router = express.Router();

router.get('/tipos', ctl.listarTipos);
router.get('/', ctl.listar);
router.post('/', ctl.criar);
router.delete('/:id', ctl.desfazer);

module.exports = router;
