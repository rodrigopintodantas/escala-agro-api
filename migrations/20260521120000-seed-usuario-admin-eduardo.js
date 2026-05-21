'use strict';

const bcrypt = require('bcryptjs');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const qi = queryInterface;
    const now = new Date();

    const senhaHash = await bcrypt.hash('123456', 10);

    const [papeis] = await qi.sequelize.query(`SELECT id FROM papel WHERE nome = 'ADMIN' LIMIT 1`);
    const adminPapel = papeis && papeis[0] ? papeis[0] : null;
    if (!adminPapel) {
      throw new Error('Papel ADMIN não encontrado para vincular usuário Eduardo.');
    }

    const login = 'Eduardo';
    const [existentes] = await qi.sequelize.query(`SELECT id FROM usuario WHERE login = :login LIMIT 1`, {
      replacements: { login },
    });
    const existente = existentes && existentes[0] ? existentes[0] : null;

    if (existente) {
      await qi.sequelize.query(
        `
          UPDATE usuario
             SET nome = :nome,
                 senha_hash = :senhaHash,
                 ativo = true,
                 email = :email,
                 cargo = 'Admin',
                 "updatedAt" = :updatedAt
           WHERE id = :id
        `,
        {
          replacements: {
            id: existente.id,
            nome: 'Eduardo',
            senhaHash,
            email: 'eduardo@escala.local',
            updatedAt: now,
          },
        },
      );
    } else {
      await qi.bulkInsert('usuario', [
        {
          nome: 'Eduardo',
          documento: null,
          login,
          senha_hash: senhaHash,
          ativo: true,
          email: 'eduardo@escala.local',
          genero: null,
          cargo: 'Admin',
          telefone: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }

    const [usuarios] = await qi.sequelize.query(`SELECT id FROM usuario WHERE login = :login LIMIT 1`, {
      replacements: { login },
    });
    const usuario = usuarios && usuarios[0] ? usuarios[0] : null;
    if (!usuario) {
      throw new Error('Usuário Eduardo não encontrado após insert/update.');
    }

    const [links] = await qi.sequelize.query(
      `SELECT id FROM usuario_papel WHERE usuario_id = :usuarioId AND papel_id = :papelId LIMIT 1`,
      {
        replacements: { usuarioId: usuario.id, papelId: adminPapel.id },
      },
    );
    if (!links || links.length === 0) {
      await qi.bulkInsert('usuario_papel', [
        {
          usuario_id: usuario.id,
          papel_id: adminPapel.id,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }
  },

  async down(queryInterface, Sequelize) {
    const [usuarios] = await queryInterface.sequelize.query(`SELECT id FROM usuario WHERE login = 'Eduardo'`);
    const ids = (usuarios || []).map((u) => u.id);
    if (ids.length > 0) {
      await queryInterface.bulkDelete('usuario_papel', { usuario_id: { [Sequelize.Op.in]: ids } });
      await queryInterface.bulkDelete('usuario', { id: { [Sequelize.Op.in]: ids } });
    }
  },
};
