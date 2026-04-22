'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE usuario SET login = 'admin' WHERE login = 'admin@escala.local'`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE usuario SET login = 'admin@escala.local' WHERE login = 'admin' AND email = 'admin@escala.local'`,
    );
  },
};
