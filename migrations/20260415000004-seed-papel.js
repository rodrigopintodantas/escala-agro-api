'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const papeis = [
      {
        nome: 'Produtor',
        descricao: 'Papel destinado aos produtores rurais',
        ativo: true,
        dashboard: '/produtor',
        vinculo: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        nome: 'Veterinario',
        descricao: 'Papel para veterinários do sistema',
        ativo: true,
        dashboard: '/vt',
        vinculo: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        nome: 'ADMIN',
        descricao: 'Administrador do sistema',
        ativo: true,
        dashboard: '/admin',
        vinculo: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await queryInterface.bulkInsert('papel', papeis, {});
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('papel', null, {});
  },
};
