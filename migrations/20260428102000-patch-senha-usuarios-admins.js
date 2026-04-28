'use strict';

const bcrypt = require('bcryptjs');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const now = new Date();

    const cols = await qi.describeTable('usuario');
    if (!cols.senha_hash) {
      await qi.addColumn('usuario', 'senha_hash', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }

    const hashPadrao = await bcrypt.hash('123456', 10);
    await qi.sequelize.query(`UPDATE usuario SET senha_hash = :hashPadrao`, {
      replacements: { hashPadrao },
    });

    await qi.changeColumn('usuario', 'senha_hash', {
      type: Sequelize.STRING(255),
      allowNull: false,
    });

    const [admins] = await qi.sequelize.query(`SELECT id FROM papel WHERE nome = 'ADMIN' LIMIT 1`);
    const adminPapel = admins && admins[0] ? admins[0] : null;
    if (!adminPapel) {
      throw new Error('Papel ADMIN não encontrado para vincular usuários da patch.');
    }

    const usuariosPatch = [
      {
        nome: 'Eduardo',
        login: 'eduardo',
        email: 'eduardo@escala.local',
      },
      {
        nome: 'Letícia',
        login: 'leticia',
        email: 'leticia@escala.local',
      },
    ];

    for (const u of usuariosPatch) {
      const [existentes] = await qi.sequelize.query(
        `SELECT id FROM usuario WHERE login = :login LIMIT 1`,
        { replacements: { login: u.login } },
      );
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
              nome: u.nome,
              senhaHash: hashPadrao,
              email: u.email,
              updatedAt: now,
            },
          },
        );
      } else {
        await qi.bulkInsert('usuario', [
          {
            nome: u.nome,
            documento: null,
            login: u.login,
            senha_hash: hashPadrao,
            ativo: true,
            email: u.email,
            genero: null,
            cargo: 'Admin',
            telefone: null,
            createdAt: now,
            updatedAt: now,
          },
        ]);
      }

      const [usuarios] = await qi.sequelize.query(`SELECT id FROM usuario WHERE login = :login LIMIT 1`, {
        replacements: { login: u.login },
      });
      const usuario = usuarios && usuarios[0] ? usuarios[0] : null;
      if (!usuario) continue;

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
    }
  },

  async down(queryInterface, Sequelize) {
    const qi = queryInterface;

    const [usuarios] = await qi.sequelize.query(`SELECT id FROM usuario WHERE login IN ('eduardo', 'leticia')`);
    const ids = (usuarios || []).map((u) => u.id);
    if (ids.length > 0) {
      await qi.bulkDelete('usuario_papel', { usuario_id: { [Sequelize.Op.in]: ids } });
      await qi.bulkDelete('usuario', { id: { [Sequelize.Op.in]: ids } });
    }
  },
};

