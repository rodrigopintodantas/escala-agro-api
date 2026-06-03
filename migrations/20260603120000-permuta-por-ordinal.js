'use strict';

/**
 * Permuta por ordinal: deixa de amarrar dois `plantao_id` fixos e passa a amarrar
 * (servidor, N-ésimo plantão dele na escala) de cada lado. O overlay é reaplicado após o
 * rodízio, então a troca "segue o nome" mesmo quando a data do plantão muda.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    if (!(await qi.tableExists('permuta_solicitacao'))) return;

    const cols = await qi.describeTable('permuta_solicitacao');

    if (!cols.categoria) {
      await qi.addColumn('permuta_solicitacao', 'categoria', {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'veterinario | tecnico — categoria dos plantões permutados.',
      });
    }
    if (!cols.ordinal_solicitante) {
      await qi.addColumn('permuta_solicitacao', 'ordinal_solicitante', {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'N-ésimo plantão do solicitante na escala (1-based, por data) no calendário base.',
      });
    }
    if (!cols.ordinal_destinatario) {
      await qi.addColumn('permuta_solicitacao', 'ordinal_destinatario', {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'N-ésimo plantão do destinatário na escala (1-based, por data) no calendário base.',
      });
    }
    if (!cols.data_origem_snapshot) {
      await qi.addColumn('permuta_solicitacao', 'data_origem_snapshot', {
        type: Sequelize.DATEONLY,
        allowNull: true,
        comment: 'Data do plantão do solicitante na criação (apenas exibição/auditoria).',
      });
    }
    if (!cols.data_destino_snapshot) {
      await qi.addColumn('permuta_solicitacao', 'data_destino_snapshot', {
        type: Sequelize.DATEONLY,
        allowNull: true,
        comment: 'Data do plantão do destinatário na criação (apenas exibição/auditoria).',
      });
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    if (!(await qi.tableExists('permuta_solicitacao'))) return;
    const cols = await qi.describeTable('permuta_solicitacao');
    if (cols.data_destino_snapshot) await qi.removeColumn('permuta_solicitacao', 'data_destino_snapshot');
    if (cols.data_origem_snapshot) await qi.removeColumn('permuta_solicitacao', 'data_origem_snapshot');
    if (cols.ordinal_destinatario) await qi.removeColumn('permuta_solicitacao', 'ordinal_destinatario');
    if (cols.ordinal_solicitante) await qi.removeColumn('permuta_solicitacao', 'ordinal_solicitante');
    if (cols.categoria) await qi.removeColumn('permuta_solicitacao', 'categoria');
  },
};
