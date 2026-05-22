'use strict';

const bcrypt = require('bcryptjs');
const {
  TABELAS_RESET,
  TABELAS_USUARIO_RESET,
  reconstruirOrdemServidorInicial,
  normalizarOrdemGlobalTecnico,
} = require('./sistema-ordem.service');

async function truncarTabelas(sequelize, tabelas, transaction) {
  if (!tabelas.length) return;
  await sequelize.query(`TRUNCATE TABLE ${tabelas.join(', ')} RESTART IDENTITY CASCADE`, { transaction });
}

async function carregarPapeisPorNome(sequelize, transaction) {
  const [rows] = await sequelize.query(`SELECT id, nome FROM papel`, { transaction });
  const mapa = new Map();
  for (const row of rows || []) {
    mapa.set(String(row.nome), Number(row.id));
  }
  return mapa;
}

function montarUsuarioRow(def, senhaHash, now) {
  return {
    nome: def.nome,
    documento: null,
    login: def.login,
    senha_hash: senhaHash,
    ativo: true,
    email: def.email,
    genero: null,
    cargo: def.cargo,
    telefone: null,
    suspenso_escala: false,
    createdAt: now,
    updatedAt: now,
  };
}

async function inserirUsuarios(sequelize, definicoes, senhaPlana, transaction) {
  const now = new Date();
  const senhaHash = await bcrypt.hash(senhaPlana, 10);
  const papeisPorNome = await carregarPapeisPorNome(sequelize, transaction);

  const faltando = [...new Set(definicoes.map((d) => d.papel))].filter((nome) => !papeisPorNome.has(nome));
  if (faltando.length > 0) {
    throw new Error(
      `Papéis não encontrados no banco: ${faltando.join(', ')}. Execute as migrations antes (npm run db:migrate).`,
    );
  }

  const usuarioRows = definicoes.map((def) => montarUsuarioRow(def, senhaHash, now));
  await sequelize.getQueryInterface().bulkInsert('usuario', usuarioRows, { transaction });

  const loginsSql = definicoes.map((d) => `'${String(d.login).replace(/'/g, "''")}'`).join(', ');
  const [inseridos] = await sequelize.query(
    `SELECT id, login FROM usuario WHERE login IN (${loginsSql}) ORDER BY id ASC`,
    { transaction },
  );

  const loginParaId = new Map((inseridos || []).map((u) => [String(u.login), Number(u.id)]));
  const usuarioPapelRows = [];

  for (const def of definicoes) {
    const usuarioId = loginParaId.get(def.login);
    const papelId = papeisPorNome.get(def.papel);
    if (!usuarioId || !papelId) {
      throw new Error(`Falha ao vincular papel para login "${def.login}".`);
    }
    usuarioPapelRows.push({
      usuario_id: usuarioId,
      papel_id: papelId,
      createdAt: now,
      updatedAt: now,
    });
  }

  await sequelize.getQueryInterface().bulkInsert('usuario_papel', usuarioPapelRows, { transaction });

  return {
    totalUsuarios: inseridos?.length || 0,
    administradores: definicoes.filter((d) => d.papel === 'ADMIN').length,
    veterinarios: definicoes.filter((d) => d.papel === 'Veterinário').length,
    tecnicos: definicoes.filter((d) => d.papel === 'Técnico').length,
  };
}

async function contarOrdemPorEscopo(sequelize, transaction) {
  const [rows] = await sequelize.query(
    `SELECT escopo, COUNT(*)::int AS total FROM ordem_servidor GROUP BY escopo ORDER BY escopo`,
    { transaction },
  );
  return rows || [];
}

/**
 * @param {import('sequelize').Sequelize} sequelize
 * @param {{ conjunto: string, definicoes: object[], senhaPadrao: string, logTag?: string }} opts
 */
async function executarCargaEscalaUsuarios(sequelize, { conjunto, definicoes, senhaPadrao, logTag }) {
  const tag = logTag || conjunto;
  const resultado = await sequelize.transaction(async (transaction) => {
    await truncarTabelas(sequelize, TABELAS_RESET, transaction);
    await truncarTabelas(sequelize, TABELAS_USUARIO_RESET, transaction);

    const inseridos = await inserirUsuarios(sequelize, definicoes, senhaPadrao, transaction);

    await reconstruirOrdemServidorInicial(sequelize, transaction);
    await normalizarOrdemGlobalTecnico(sequelize, transaction);

    const ordemPorEscopo = await contarOrdemPorEscopo(sequelize, transaction);

    return { inseridos, ordemPorEscopo };
  });

  if (logTag) {
    const env = process.env.NODE_ENV || 'stage';
    console.log(`[${tag}] Ambiente: ${env} — concluído.`);
    console.log(
      `  Usuários: ${resultado.inseridos.totalUsuarios} (${resultado.inseridos.administradores} admin, ${resultado.inseridos.veterinarios} veterinários, ${resultado.inseridos.tecnicos} técnicos)`,
    );
    console.log(`  Senha padrão: ${senhaPadrao}`);
    for (const row of resultado.ordemPorEscopo) {
      console.log(`  Ordem global (${row.escopo}): ${row.total} posições`);
    }
  }

  return {
    mensagem: `Conjunto "${conjunto}" carregado com sucesso.`,
    conjunto,
    inseridos: resultado.inseridos,
    ordemPorEscopo: resultado.ordemPorEscopo,
    senhaPadrao,
  };
}

module.exports = {
  executarCargaEscalaUsuarios,
};
