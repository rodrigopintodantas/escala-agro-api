#!/usr/bin/env node
'use strict';

/**
 * Restaura o banco para o conjunto de usuários de desenvolvimento (migrations de seed)
 * e recria a ordem global inicial de veterinários e técnicos.
 *
 * Uso: npm run desenvolvimento_escala
 */

const db = require('../models');
const { SENHA_PADRAO_DESENVOLVIMENTO, listarTodos } = require('./dados/usuarios-desenvolvimento');
const { executarCargaEscalaUsuarios } = require('./lib/carga-escala-usuarios');

const TAG = 'desenvolvimento_escala';

executarCargaEscalaUsuarios(db.sequelize, {
  conjunto: 'desenvolvimento',
  definicoes: listarTodos(),
  senhaPadrao: SENHA_PADRAO_DESENVOLVIMENTO,
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
