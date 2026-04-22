'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    if (await qi.tableExists('escala_ordem_historico')) {
      const hCols = await qi.describeTable('escala_ordem_historico');
      if (!hCols.ordem_global_usuario_ids) {
        await qi.addColumn('escala_ordem_historico', 'ordem_global_usuario_ids', {
          type: Sequelize.JSONB,
          allowNull: true,
          comment: 'Snapshot da ordem geral (ordem_servidor) no momento motivo=inicial (para restaurar ao desfazer o último afastamento).',
        });
      }
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    if (await qi.tableExists('escala_ordem_historico')) {
      const hCols = await qi.describeTable('escala_ordem_historico');
      if (hCols.ordem_global_usuario_ids) {
        await qi.removeColumn('escala_ordem_historico', 'ordem_global_usuario_ids');
      }
    }
  },
};
