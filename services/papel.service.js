const { PapelModel } = require('../models');

const PapelService = {
  consultaPeloId: async (papelId) => {
    return await PapelModel.findOne({
      where: {
        id: papelId,
      },
    });
  },

  consultaAtivos: async () => {
    return await PapelModel.findAll({
      where: { ativo: true },
      attributes: ['id', 'nome', 'descricao', 'dashboard'],
    });
  },

  consultaPeloNome: async (nome) => {
    return await PapelModel.findOne({
      where: { nome },
    });
  },
};

module.exports = PapelService;
