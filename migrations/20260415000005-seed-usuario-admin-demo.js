'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    await queryInterface.bulkInsert(
      'usuario',
      [
        {
          nome: 'Administrador',
          documento: null,
          login: 'admin',
          ativo: true,
          email: 'admin@escala.local',
          genero: null,
          cargo: 'Admin',
          telefone: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      {},
    );

    const papeisRows = await queryInterface.sequelize.query(
      `SELECT id FROM papel WHERE nome = 'ADMIN' LIMIT 1`,
      { type: Sequelize.QueryTypes.SELECT },
    );
    const usuariosRows = await queryInterface.sequelize.query(
      `SELECT id FROM usuario WHERE login = 'admin' LIMIT 1`,
      { type: Sequelize.QueryTypes.SELECT },
    );

    const adminPapel = papeisRows[0];
    const adminUser = usuariosRows[0];

    if (!adminPapel || !adminUser) {
      throw new Error('Seed admin: papel ADMIN ou usuário demo não encontrado.');
    }

    await queryInterface.bulkInsert(
      'usuario_papel',
      [
        {
          usuario_id: adminUser.id,
          papel_id: adminPapel.id,
          createdAt: now,
          updatedAt: now,
        },
      ],
      {},
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM usuario_papel WHERE usuario_id IN (SELECT id FROM usuario WHERE login = 'admin')`,
    );
    await queryInterface.bulkDelete('usuario', { login: 'admin' }, {});
  },
};
