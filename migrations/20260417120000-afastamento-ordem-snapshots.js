'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    if (await qi.tableExists('afastamento')) {
      const afCols = await qi.describeTable('afastamento');
      if (!afCols.ordem_global_usuario_ids_antes) {
        await qi.addColumn('afastamento', 'ordem_global_usuario_ids_antes', {
          type: Sequelize.JSONB,
          allowNull: true,
          comment: 'Snapshot da ordem geral (ordem_servidor) antes do recálculo que alterou a ordem global.',
        });
      }
    }

    if (await qi.tableExists('escala_ordem_historico')) {
      const hCols = await qi.describeTable('escala_ordem_historico');
      if (!hCols.ordem_usuario_ids_antes) {
        await qi.addColumn('escala_ordem_historico', 'ordem_usuario_ids_antes', {
          type: Sequelize.JSONB,
          allowNull: true,
          comment: 'Ordem dos membros na escala antes do evento (ex.: afastamento).',
        });
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const qi = queryInterface;
    if (await qi.tableExists('afastamento')) {
      const afCols = await qi.describeTable('afastamento');
      if (afCols.ordem_global_usuario_ids_antes) {
        await qi.removeColumn('afastamento', 'ordem_global_usuario_ids_antes');
      }
    }
    if (await qi.tableExists('escala_ordem_historico')) {
      const hCols = await qi.describeTable('escala_ordem_historico');
      if (hCols.ordem_usuario_ids_antes) {
        await qi.removeColumn('escala_ordem_historico', 'ordem_usuario_ids_antes');
      }
    }
  },
};
