'use strict';

const TABELAS_RESET = [
  'permuta_solicitacao',
  'impedimento',
  'afastamento',
  'escala_auditoria_evento',
  'escala_ordem_historico',
  'plantao',
  'escala_membro',
  'escala',
];

const TABELAS_USUARIO_RESET = ['ordem_servidor', 'usuario_papel', 'usuario'];

async function contarTabela(sequelize, tabela, transaction) {
  const [rows] = await sequelize.query(`SELECT COUNT(*)::int AS total FROM ${tabela}`, { transaction });
  return Number(rows?.[0]?.total || 0);
}

/** Ordem alfabética de técnicos ignorando acentos — migration 20260424123000. */
async function normalizarOrdemGlobalTecnico(sequelize, transaction) {
  await sequelize.query(
    `
      WITH ordenado AS (
        SELECT
          u.id AS usuario_id,
          ROW_NUMBER() OVER (
            ORDER BY
              translate(
                lower(u.nome),
                'áàâãäéèêëíìîïóòôõöúùûüç',
                'aaaaaeeeeiiiiooooouuuuc'
              ),
              lower(u.nome),
              u.id
          ) AS nova_ordem
        FROM usuario u
        INNER JOIN usuario_papel up ON up.usuario_id = u.id
        INNER JOIN papel p ON p.id = up.papel_id
        WHERE u.ativo = true
          AND p.nome = 'Técnico'
      )
      UPDATE ordem_servidor
         SET ordem = ordem + 100000,
             "updatedAt" = NOW()
       WHERE escopo = 'tecnico';

      WITH ordenado AS (
        SELECT
          u.id AS usuario_id,
          ROW_NUMBER() OVER (
            ORDER BY
              translate(
                lower(u.nome),
                'áàâãäéèêëíìîïóòôõöúùûüç',
                'aaaaaeeeeiiiiooooouuuuc'
              ),
              lower(u.nome),
              u.id
          ) AS nova_ordem
        FROM usuario u
        INNER JOIN usuario_papel up ON up.usuario_id = u.id
        INNER JOIN papel p ON p.id = up.papel_id
        WHERE u.ativo = true
          AND p.nome = 'Técnico'
      )
      UPDATE ordem_servidor os
         SET ordem = o.nova_ordem,
             "updatedAt" = NOW()
        FROM ordenado o
       WHERE os.usuario_id = o.usuario_id
         AND os.escopo = 'tecnico';
    `,
    { transaction },
  );
}

async function reconstruirOrdemServidorInicial(sequelize, transaction) {
  await sequelize.query(`DELETE FROM ordem_servidor`, { transaction });

  await sequelize.query(
    `
      INSERT INTO ordem_servidor (usuario_id, ordem, escopo, "createdAt", "updatedAt")
      SELECT
        x.usuario_id,
        ROW_NUMBER() OVER (ORDER BY x.nome ASC),
        'veterinario',
        NOW(),
        NOW()
      FROM (
        SELECT DISTINCT u.id AS usuario_id, u.nome
        FROM usuario u
        JOIN usuario_papel up ON up.usuario_id = u.id
        JOIN papel p ON p.id = up.papel_id
        WHERE u.ativo = true
          AND p.nome IN ('Veterinário', 'Veterinario')
      ) x
      ORDER BY x.nome ASC
    `,
    { transaction },
  );

  await sequelize.query(
    `
      INSERT INTO ordem_servidor (usuario_id, ordem, escopo, "createdAt", "updatedAt")
      SELECT
        x.usuario_id,
        ROW_NUMBER() OVER (ORDER BY x.nome ASC),
        'tecnico',
        NOW(),
        NOW()
      FROM (
        SELECT DISTINCT u.id AS usuario_id, u.nome
        FROM usuario u
        JOIN usuario_papel up ON up.usuario_id = u.id
        JOIN papel p ON p.id = up.papel_id
        WHERE u.ativo = true
          AND p.nome IN ('Técnico', 'Tecnico')
      ) x
      ORDER BY x.nome ASC
    `,
    { transaction },
  );
}

module.exports = {
  TABELAS_RESET,
  TABELAS_USUARIO_RESET,
  contarTabela,
  normalizarOrdemGlobalTecnico,
  reconstruirOrdemServidorInicial,
};
