const sequelizeTransaction = require('../auth/sequelize-transaction');

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

async function contarTabela(sequelize, tabela, transaction) {
  const [rows] = await sequelize.query(`SELECT COUNT(*)::int AS total FROM ${tabela}`, { transaction });
  return Number(rows?.[0]?.total || 0);
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

const SistemaService = {
  reiniciarTeste: async () => {
    const db = require('../models');
    return await sequelizeTransaction(async (t) => {
      const antes = {};
      for (const tabela of TABELAS_RESET) {
        antes[tabela] = await contarTabela(db.sequelize, tabela, t);
      }

      await db.sequelize.query(
        `TRUNCATE TABLE ${TABELAS_RESET.join(', ')} RESTART IDENTITY CASCADE`,
        { transaction: t },
      );

      await reconstruirOrdemServidorInicial(db.sequelize, t);

      const ordemServidor = await contarTabela(db.sequelize, 'ordem_servidor', t);
      return {
        mensagem: 'Sistema reiniciado para testes com sucesso.',
        removidos: antes,
        ordemServidorRecriada: ordemServidor,
      };
    });
  },
};

module.exports = SistemaService;

