'use strict';

const bcrypt = require('bcryptjs');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const qi = queryInterface;
    const now = new Date();

    const [papeisVet] = await qi.sequelize.query(
      `SELECT id, nome FROM papel WHERE nome IN ('Veterinário', 'Veterinario') ORDER BY id ASC`,
    );
    if (!papeisVet || papeisVet.length === 0) {
      throw new Error('Papel de veterinário não encontrado.');
    }
    const papelVetIds = papeisVet.map((p) => Number(p.id)).filter((id) => Number.isFinite(id));
    const papelVetIdPrincipal = papelVetIds[0];

    // 1) Retira todos os vínculos atuais de veterinário.
    await qi.sequelize.query(`DELETE FROM usuario_papel WHERE papel_id IN (:papelVetIds)`, {
      replacements: { papelVetIds },
    });

    const senhaPadraoHash = await bcrypt.hash('123456', 10);
    const novaLista = [
      { nome: 'Janaína', login: 'janaina', email: 'vet_novo_01@escala.local' },
      { nome: 'Érica', login: 'erica', email: 'vet_novo_02@escala.local' },
      { nome: 'Gabriella', login: 'gabriella', email: 'vet_novo_03@escala.local' },
      { nome: 'Lorena', login: 'lorena', email: 'vet_novo_04@escala.local' },
      { nome: 'Daniella', login: 'daniella', email: 'vet_novo_05@escala.local' },
      { nome: 'Cosme', login: 'cosme', email: 'vet_novo_06@escala.local' },
      { nome: 'Lucas', login: 'lucas', email: 'vet_novo_07@escala.local' },
      { nome: 'Marcelo Vaske', login: 'marcelo.vaske', email: 'vet_novo_08@escala.local' },
      { nome: 'Letícia', login: 'leticia', email: 'vet_novo_09@escala.local' },
      { nome: 'Celidônio', login: 'celidonio', email: 'vet_novo_10@escala.local' },
      { nome: 'Luciana', login: 'luciana', email: 'vet_novo_11@escala.local' },
    ];

    const usuarioIdsOrdenados = [];

    for (const [idx, vet] of novaLista.entries()) {
      const [existentes] = await qi.sequelize.query(`SELECT id FROM usuario WHERE login = :login LIMIT 1`, {
        replacements: { login: vet.login },
      });
      const existente = existentes && existentes[0] ? existentes[0] : null;

      if (existente) {
        await qi.sequelize.query(
          `
            UPDATE usuario
               SET nome = :nome,
                   ativo = true,
                   email = :email,
                   cargo = 'Veterinário',
                   "updatedAt" = :updatedAt
             WHERE id = :id
          `,
          {
            replacements: {
              id: Number(existente.id),
              nome: vet.nome,
              email: vet.email,
              updatedAt: now,
            },
          },
        );
        usuarioIdsOrdenados.push(Number(existente.id));
      } else {
        await qi.bulkInsert('usuario', [
          {
            nome: vet.nome,
            documento: null,
            login: vet.login,
            senha_hash: senhaPadraoHash,
            ativo: true,
            email: vet.email,
            genero: null,
            cargo: 'Veterinário',
            telefone: null,
            createdAt: now,
            updatedAt: now,
          },
        ]);
        const [criados] = await qi.sequelize.query(`SELECT id FROM usuario WHERE login = :login LIMIT 1`, {
          replacements: { login: vet.login },
        });
        if (!criados || !criados[0]) {
          throw new Error(`Falha ao criar usuário veterinário: ${vet.nome}`);
        }
        usuarioIdsOrdenados.push(Number(criados[0].id));
      }

      await qi.sequelize.query(
        `
          INSERT INTO usuario_papel (usuario_id, papel_id, "createdAt", "updatedAt")
          SELECT :usuarioId, :papelId, :createdAt, :updatedAt
          WHERE NOT EXISTS (
            SELECT 1 FROM usuario_papel WHERE usuario_id = :usuarioId AND papel_id = :papelId
          )
        `,
        {
          replacements: {
            usuarioId: usuarioIdsOrdenados[idx],
            papelId: papelVetIdPrincipal,
            createdAt: now,
            updatedAt: now,
          },
        },
      );
    }

    // 2) Reescreve a ordem global dos veterinários exatamente na ordem solicitada.
    await qi.sequelize.query(`DELETE FROM ordem_servidor WHERE escopo = 'veterinario'`);
    for (let i = 0; i < usuarioIdsOrdenados.length; i++) {
      await qi.bulkInsert('ordem_servidor', [
        {
          usuario_id: usuarioIdsOrdenados[i],
          ordem: i + 1,
          escopo: 'veterinario',
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;

    await qi.sequelize.query(`DELETE FROM ordem_servidor WHERE escopo = 'veterinario'`);
    await qi.sequelize.query(
      `DELETE FROM usuario_papel WHERE usuario_id IN (SELECT id FROM usuario WHERE email LIKE 'vet_novo_%@escala.local')`,
    );
    await qi.sequelize.query(`DELETE FROM usuario WHERE email LIKE 'vet_novo_%@escala.local'`);
  },
};

