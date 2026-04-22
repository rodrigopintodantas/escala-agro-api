const Usuario = require('../models').UsuarioModel;
const Papel = require('../models').PapelModel;
const UsuarioPapel = require('../models').UsuarioPapelModel;

module.exports = perfil;

async function perfil(req, res) {
  try {
    let retorno = {};
    let usuario = await Usuario.findOne({
      where: { login: req.auth.preferred_username },
      include: {
        model: UsuarioPapel,
        include: [{ model: Papel, attributes: ['id', 'nome', 'dashboard'] }],
      },
      attributes: [
        'id',
        'nome',
        'cargo',
        'login',
        'genero',
        'email',
        'ativo',
        'telefone',
        'documento',
      ],
    });
    if (usuario && usuario.UsuarioPapelModels) {
      const userRoles = (usuario.UsuarioPapelModels || []).map((up) => {
        const p = up.PapelModel || {};
        return {
          id: p.id,
          nome: p.nome,
          papel: p.nome,
          optionLabel: p.nome,
          dashboard: p.dashboard,
        };
      });

      retorno = {
        usuario: {
          id: usuario.id,
          login: usuario.login,
          nome: usuario.nome,
          email: usuario.email,
          ativo: usuario.ativo,
          genero: usuario.genero,
          cargo: usuario.cargo,
          telefone: usuario.telefone,
          documento: usuario.documento,
        },
        up: userRoles,
      };
    }

    return res.status(200).send(retorno);
  } catch (err) {
    console.log(err);
    res.status(400).send({
      message: 'Ops... problemas ao recuperar dados  do Usuario. ' + err.message,
    });
  }
}
