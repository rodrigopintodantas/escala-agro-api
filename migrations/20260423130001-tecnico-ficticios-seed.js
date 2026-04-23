'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    const papeisRows = await queryInterface.sequelize.query(
      `SELECT id FROM papel WHERE nome = 'Técnico' LIMIT 1`,
      { type: Sequelize.QueryTypes.SELECT },
    );
    const papelTecnico = papeisRows[0];
    if (!papelTecnico) {
      throw new Error('Migration técnicos: papel Técnico não encontrado (rode a migration do papel antes).');
    }

    /** Dois nomes fictícios por letra inicial (A–H), total 16. */
    const tecnicos = [
      { nome: 'Álvaro Mendes Tavares', login: 'tec_alvaro', email: 'tec_alvaro@escala.local' },
      { nome: 'Amanda Rocha Prado', login: 'tec_amanda', email: 'tec_amanda@escala.local' },
      { nome: 'Bianca Ferreira Lima', login: 'tec_bianca', email: 'tec_bianca@escala.local' },
      { nome: 'Bernardo Alves Souza', login: 'tec_bernardo', email: 'tec_bernardo@escala.local' },
      { nome: 'Camila Dias Nunes', login: 'tec_camila', email: 'tec_camila@escala.local' },
      { nome: 'Carlos Eduardo Vieira', login: 'tec_carlos', email: 'tec_carlos@escala.local' },
      { nome: 'Denise Lopes Ramos', login: 'tec_denise', email: 'tec_denise@escala.local' },
      { nome: 'Diego Martins Costa', login: 'tec_diego', email: 'tec_diego@escala.local' },
      { nome: 'Elisa Duarte Gomes', login: 'tec_elisa', email: 'tec_elisa@escala.local' },
      { nome: 'Eduardo Silva Prado', login: 'tec_eduardo', email: 'tec_eduardo@escala.local' },
      { nome: 'Fernanda Costa Oliveira', login: 'tec_fernanda', email: 'tec_fernanda@escala.local' },
      { nome: 'Fábio Henrique Dias', login: 'tec_fabio', email: 'tec_fabio@escala.local' },
      { nome: 'Gabriela Santos Rocha', login: 'tec_gabriela', email: 'tec_gabriela@escala.local' },
      { nome: 'Gustavo Lima Alves', login: 'tec_gustavo', email: 'tec_gustavo@escala.local' },
      { nome: 'Helena Vieira Mendes', login: 'tec_helena', email: 'tec_helena@escala.local' },
      { nome: 'Hugo Duarte Nunes', login: 'tec_hugo', email: 'tec_hugo@escala.local' },
    ];

    const rows = tecnicos.map((t) => ({
      nome: t.nome,
      documento: null,
      login: t.login,
      ativo: true,
      email: t.email,
      genero: null,
      cargo: 'Técnico',
      telefone: null,
      createdAt: now,
      updatedAt: now,
    }));

    await queryInterface.bulkInsert('usuario', rows, {});

    const loginList = tecnicos.map((t) => `'${t.login.replace(/'/g, "''")}'`).join(', ');
    const inserted = await queryInterface.sequelize.query(`SELECT id, login FROM usuario WHERE login IN (${loginList})`, {
      type: Sequelize.QueryTypes.SELECT,
    });

    const usuarioPapelRows = inserted.map((u) => ({
      usuario_id: u.id,
      papel_id: papelTecnico.id,
      createdAt: now,
      updatedAt: now,
    }));

    await queryInterface.bulkInsert('usuario_papel', usuarioPapelRows, {});
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM usuario_papel WHERE usuario_id IN (SELECT id FROM usuario WHERE email LIKE 'tec_%@escala.local')`,
    );
    await queryInterface.sequelize.query(`DELETE FROM usuario WHERE email LIKE 'tec_%@escala.local'`);
  },
};
