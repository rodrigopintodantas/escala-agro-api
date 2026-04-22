'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    if (!(await qi.tableExists('plantao'))) return;

    const cols = await qi.describeTable('plantao');
    if (!cols.ordem_global_usuario_ids_antes) {
      await qi.addColumn('plantao', 'ordem_global_usuario_ids_antes', {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Snapshot da ordem geral antes do lote que incluiu este plantão extra (feriado).',
      });
    }
    if (!cols.ordem_escala_usuario_ids_antes) {
      await qi.addColumn('plantao', 'ordem_escala_usuario_ids_antes', {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Snapshot da ordem dos membros da escala antes do lote que incluiu este plantão extra.',
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const qi = queryInterface;
    if (!(await qi.tableExists('plantao'))) return;
    const cols = await qi.describeTable('plantao');
    if (cols.ordem_global_usuario_ids_antes) {
      await qi.removeColumn('plantao', 'ordem_global_usuario_ids_antes');
    }
    if (cols.ordem_escala_usuario_ids_antes) {
      await qi.removeColumn('plantao', 'ordem_escala_usuario_ids_antes');
    }
  },
};
