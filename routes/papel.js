var express = require('express');
var router = express.Router();
const ctl = require('../controllers/papel');

router.get('/', ctl.ativos);
router.get('/ativos', ctl.ativos);
router.get('/:id', ctl.consultarPeloId);

module.exports = router;
