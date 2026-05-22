#!/usr/bin/env node
'use strict';

/**
 * Restaura o banco com servidores reais de produção e recria a ordem global inicial.
 *
 * Uso: npm run producao_escala
 */

const db = require('../models');
const { SENHA_PADRAO_PRODUCAO, listarTodos } = require('./dados/usuarios-producao');
const { executarCargaEscalaUsuarios } = require('./lib/carga-escala-usuarios');

const TAG = 'producao_escala';

executarCargaEscalaUsuarios(db.sequelize, {
  conjunto: 'producao',
  definicoes: listarTodos(),
  senhaPadrao: SENHA_PADRAO_PRODUCAO,
  logTag: TAG,
})
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[${TAG}] Erro:`, err.message || err);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await db.sequelize.close();
    } catch {
      /* ignore */
    }
  });
