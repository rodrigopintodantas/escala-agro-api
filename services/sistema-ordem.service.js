'use strict';

const { tecnicos: tecnicosProducao, veterinarios: veterinariosProducao } = require('../scripts/dados/usuarios-producao');

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

/**
 * Removida em favor de `reconstruirOrdemServidorInicial`, que agora produz a ordem final correta
 * (canônica para produção ou alfabética como fallback). Mantida como no-op para preservar o
 * contrato exportado e não quebrar callers existentes.
 */
async function normalizarOrdemGlobalTecnico(_sequelize, _transaction) {
  /** No-op: a ordenação é decidida em `reconstruirOrdemServidorInicial`. */
}

/** Normaliza nome para comparação ignorando acentos e caixa (mesma regra usada na migration histórica). */
function chaveOrdenacaoAlfabetica(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Ordena pela posição na lista canônica (por `login`); usuários fora da lista vão depois,
 * em ordem alfabética ignorando acentos (tie-breaker estável por `id`).
 */
function ordenarPelaListaCanonica(usuarios, listaCanonica) {
  const posicaoPorLogin = new Map();
  (listaCanonica || []).forEach((def, idx) => {
    posicaoPorLogin.set(String(def.login), idx);
  });

  return [...usuarios].sort((a, b) => {
    const posA = posicaoPorLogin.has(String(a.login)) ? posicaoPorLogin.get(String(a.login)) : Number.POSITIVE_INFINITY;
    const posB = posicaoPorLogin.has(String(b.login)) ? posicaoPorLogin.get(String(b.login)) : Number.POSITIVE_INFINITY;
    if (posA !== posB) return posA - posB;
    const chaveA = chaveOrdenacaoAlfabetica(a.nome);
    const chaveB = chaveOrdenacaoAlfabetica(b.nome);
    if (chaveA < chaveB) return -1;
    if (chaveA > chaveB) return 1;
    return Number(a.id) - Number(b.id);
  });
}

/** Ordem alfabética ignorando acentos (fallback quando os logins não batem com nenhuma lista canônica). */
function ordenarAlfabeticamente(usuarios) {
  return [...usuarios].sort((a, b) => {
    const chaveA = chaveOrdenacaoAlfabetica(a.nome);
    const chaveB = chaveOrdenacaoAlfabetica(b.nome);
    if (chaveA < chaveB) return -1;
    if (chaveA > chaveB) return 1;
    return Number(a.id) - Number(b.id);
  });
}

async function listarUsuariosAtivosPorPapel(sequelize, nomePapel, transaction) {
  const [rows] = await sequelize.query(
    `
      SELECT DISTINCT u.id, u.nome, u.login
      FROM usuario u
      INNER JOIN usuario_papel up ON up.usuario_id = u.id
      INNER JOIN papel p ON p.id = up.papel_id
      WHERE u.ativo = true
        AND p.nome = :papel
    `,
    {
      transaction,
      replacements: { papel: nomePapel },
    },
  );
  return rows || [];
}

/**
 * Decide a ordem definitiva da categoria. Quando TODOS os logins ativos pertencem à lista
 * canônica, respeita a sequência definida em `usuarios-producao.js` (ordem oficial usada na
 * criação da escala). Caso contrário (ambiente de desenvolvimento, dados manuais ou logins
 * divergentes), faz fallback para ordem alfabética ignorando acentos.
 */
function ordenarConformeListaCanonicaOuAlfabetica(usuarios, listaCanonica) {
  if (!Array.isArray(usuarios) || usuarios.length === 0) return [];
  const loginsCanonicos = new Set((listaCanonica || []).map((d) => String(d.login)));
  const todosBatem = usuarios.every((u) => loginsCanonicos.has(String(u.login)));
  return todosBatem ? ordenarPelaListaCanonica(usuarios, listaCanonica) : ordenarAlfabeticamente(usuarios);
}

async function inserirOrdemServidorEscopo(sequelize, transaction, escopo, usuariosOrdenados) {
  if (!usuariosOrdenados.length) return;
  const valoresSql = usuariosOrdenados
    .map((_, idx) => `(:uid_${idx}, :ordem_${idx}, :escopo, NOW(), NOW())`)
    .join(', ');
  const replacements = { escopo };
  usuariosOrdenados.forEach((u, idx) => {
    replacements[`uid_${idx}`] = Number(u.id);
    replacements[`ordem_${idx}`] = idx + 1;
  });
  await sequelize.query(
    `
      INSERT INTO ordem_servidor (usuario_id, ordem, escopo, "createdAt", "updatedAt")
      VALUES ${valoresSql}
    `,
    { transaction, replacements },
  );
}

async function reconstruirOrdemServidorInicial(sequelize, transaction) {
  await sequelize.query(`DELETE FROM ordem_servidor`, { transaction });

  const veterinarios = await listarUsuariosAtivosPorPapel(sequelize, 'Veterinário', transaction);
  const vetsOrdenados = ordenarConformeListaCanonicaOuAlfabetica(veterinarios, veterinariosProducao);
  await inserirOrdemServidorEscopo(sequelize, transaction, 'veterinario', vetsOrdenados);

  const tecnicos = await listarUsuariosAtivosPorPapel(sequelize, 'Técnico', transaction);
  const tecsOrdenados = ordenarConformeListaCanonicaOuAlfabetica(tecnicos, tecnicosProducao);
  await inserirOrdemServidorEscopo(sequelize, transaction, 'tecnico', tecsOrdenados);
}

module.exports = {
  TABELAS_RESET,
  TABELAS_USUARIO_RESET,
  contarTabela,
  normalizarOrdemGlobalTecnico,
  reconstruirOrdemServidorInicial,
};
