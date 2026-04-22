const express = require('express');
const router = express.Router();

const { authorize, authorizeSemPerfilSelecionado } = require('../auth/authorize');

const perfil = require('../auth/perfil');
const _ROLES = require('../auth/role');

const VERSAO = '0.1.0';

router.get('/status', function (req, res) {
  res.send({
    msg: 'Estou bem ' + VERSAO + ' - ' + new Date().toISOString(),
  });
});

router.get('/', function (req, res) {
  res.send({ msg: 'escala-agro - API' });
});

router.get('/auth', authorizeSemPerfilSelecionado(), perfil);
router.use('/usuario', require('./usuario'));
router.use('/papel', authorize([_ROLES.ADMIN]), require('./papel'));
router.use('/escala', authorize([_ROLES.ADMIN, _ROLES.VT]), require('./escala'));
router.use('/afastamento', authorize([_ROLES.ADMIN, _ROLES.VT]), require('./afastamento'));
router.use('/servidor', authorize([_ROLES.ADMIN]), require('./servidor'));

module.exports = router;
