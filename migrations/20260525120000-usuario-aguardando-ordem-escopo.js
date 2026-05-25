'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('usuario', 'aguardando_ordem_escopo', {
      type: Sequelize.STRING(24),
      allowNull: true,
      comment:
        'Escopo (veterinario/tecnico) em que o servidor aguarda inclusão na ordem global após conclusão de escala.',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('usuario', 'aguardando_ordem_escopo');
  },
};
