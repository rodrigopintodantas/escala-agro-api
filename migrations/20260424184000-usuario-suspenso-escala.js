'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('usuario', 'suspenso_escala', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Indica servidor suspenso para atuacao em escalas ativas',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('usuario', 'suspenso_escala');
  },
};
