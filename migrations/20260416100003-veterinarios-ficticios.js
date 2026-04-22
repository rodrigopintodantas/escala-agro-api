'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    const papeisRows = await queryInterface.sequelize.query(
      `SELECT id FROM papel WHERE nome = 'Veterinario' LIMIT 1`,
      { type: Sequelize.QueryTypes.SELECT },
    );
    const papelVet = papeisRows[0];
    if (!papelVet) {
      throw new Error('Migration veterinários: papel Veterinario não encontrado.');
    }

    const veterinarios = [
      { nome: 'Ana Paula Ferreira', login: 'ana', email: 'vet1@escala.local' },
      { nome: 'Bruno Costa Lima', login: 'bru', email: 'vet2@escala.local' },
      { nome: 'Carla Mendes Rocha', login: 'car', email: 'vet3@escala.local' },
      { nome: 'Daniel Souza Alves', login: 'dan', email: 'vet4@escala.local' },
      { nome: 'Elisa Nunes Prado', login: 'eli', email: 'vet5@escala.local' },
      { nome: 'Felipe Duarte Gomes', login: 'fel', email: 'vet6@escala.local' },
      { nome: 'Gabriela Ramos Dias', login: 'gab', email: 'vet7@escala.local' },
      { nome: 'Henrique Lopes Vieira', login: 'hen', email: 'vet8@escala.local' },
    ];

    const rows = veterinarios.map((v) => ({
      nome: v.nome,
      documento: null,
      login: v.login,
      ativo: true,
      email: v.email,
      genero: null,
      cargo: 'Veterinário',
      telefone: null,
      createdAt: now,
      updatedAt: now,
    }));

    await queryInterface.bulkInsert('usuario', rows, {});

    const loginList = veterinarios.map((v) => `'${v.login.replace(/'/g, "''")}'`).join(', ');
    const inserted = await queryInterface.sequelize.query(`SELECT id, login FROM usuario WHERE login IN (${loginList})`, {
      type: Sequelize.QueryTypes.SELECT,
    });

    const usuarioPapelRows = inserted.map((u) => ({
      usuario_id: u.id,
      papel_id: papelVet.id,
      createdAt: now,
      updatedAt: now,
    }));

    await queryInterface.bulkInsert('usuario_papel', usuarioPapelRows, {});
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM usuario_papel WHERE usuario_id IN (SELECT id FROM usuario WHERE email LIKE 'vet%@escala.local')`,
    );
    await queryInterface.sequelize.query(`DELETE FROM usuario WHERE email LIKE 'vet%@escala.local'`);
  },
};
