'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.bulkInsert(
      'papel',
      [
        {
          nome: 'Técnico',
          descricao: 'Papel para técnicos do sistema',
          ativo: true,
          dashboard: '/tecnico',
          vinculo: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      {},
    );
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('papel', { nome: 'Técnico' }, {});
  },
};
