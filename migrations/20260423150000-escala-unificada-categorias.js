'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    await qi.addColumn('plantao', 'categoria_plantao', {
      type: Sequelize.STRING(24),
      allowNull: false,
      defaultValue: 'veterinario',
      comment: 'veterinario | tecnico — vagas do mesmo dia são distintas',
    });

    await qi.sequelize.query(`
      UPDATE plantao p
      SET categoria_plantao = 'tecnico'
      FROM escala e
      WHERE p.escala_id = e.id AND LOWER(COALESCE(e.tipo, 'veterinario')) = 'tecnico'
    `);

    await qi.addColumn('escala_membro', 'categoria_membro', {
      type: Sequelize.STRING(24),
      allowNull: false,
      defaultValue: 'veterinario',
      comment: 'veterinario | tecnico — rodízio e ordem por categoria',
    });

    await qi.sequelize.query(`
      UPDATE escala_membro m
      SET categoria_membro = 'tecnico'
      FROM escala e
      WHERE m.escala_id = e.id AND LOWER(COALESCE(e.tipo, 'veterinario')) = 'tecnico'
    `);

    await qi.removeIndex('escala_membro', 'escala_membro_escala_ordem_uk');
    await qi.addIndex('escala_membro', ['escala_id', 'categoria_membro', 'ordem'], {
      unique: true,
      name: 'escala_membro_escala_cat_ordem_uk',
    });

    await qi.removeIndex('plantao', 'plantao_escala_data_vaga_uk');
    await qi.addIndex('plantao', ['escala_id', 'data_referencia', 'categoria_plantao', 'vaga_indice'], {
      unique: true,
      name: 'plantao_escala_data_cat_vaga_uk',
    });

    await qi.addColumn('escala_ordem_historico', 'categoria_ordem', {
      type: Sequelize.STRING(24),
      allowNull: true,
      comment: 'veterinario | tecnico — qual lista a linha representa (motivo inicial / afastamento)',
    });

    await qi.sequelize.query(`
      UPDATE escala_ordem_historico h
      SET categoria_ordem = CASE
        WHEN LOWER(COALESCE(e.tipo, 'veterinario')) = 'tecnico' THEN 'tecnico'
        ELSE 'veterinario'
      END
      FROM escala e
      WHERE h.escala_id = e.id AND h.motivo = 'inicial'
    `);

    await qi.sequelize.query(`
      UPDATE escala_ordem_historico h
      SET categoria_ordem = sub.escopo
      FROM (
        SELECT h2.id,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM ordem_servidor os
              WHERE os.usuario_id = a.usuario_id AND os.escopo = 'tecnico'
            ) THEN 'tecnico'
            ELSE 'veterinario'
          END AS escopo
        FROM escala_ordem_historico h2
        INNER JOIN afastamento a ON a.id = h2.afastamento_id
        WHERE h2.afastamento_id IS NOT NULL AND h2.categoria_ordem IS NULL
      ) AS sub
      WHERE h.id = sub.id
    `);

    await qi.removeColumn('escala', 'tipo');
  },

  async down(queryInterface, Sequelize) {
    const qi = queryInterface;

    await qi.addColumn('escala', 'tipo', {
      type: Sequelize.STRING(24),
      allowNull: false,
      defaultValue: 'veterinario',
    });

    await qi.sequelize.query(`
      UPDATE escala e
      SET tipo = 'tecnico'
      WHERE EXISTS (
        SELECT 1 FROM escala_membro m
        WHERE m.escala_id = e.id AND m.categoria_membro = 'tecnico' AND m.ativo = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM escala_membro m2
        WHERE m2.escala_id = e.id AND m2.categoria_membro = 'veterinario' AND m2.ativo = true
      )
    `);

    await qi.removeColumn('escala_ordem_historico', 'categoria_ordem');

    await qi.removeIndex('plantao', 'plantao_escala_data_cat_vaga_uk');
    await qi.addIndex('plantao', ['escala_id', 'data_referencia', 'vaga_indice'], {
      unique: true,
      name: 'plantao_escala_data_vaga_uk',
    });

    await qi.removeIndex('escala_membro', 'escala_membro_escala_cat_ordem_uk');
    await qi.addIndex('escala_membro', ['escala_id', 'ordem'], {
      unique: true,
      name: 'escala_membro_escala_ordem_uk',
    });

    await qi.removeColumn('escala_membro', 'categoria_membro');
    await qi.removeColumn('plantao', 'categoria_plantao');
  },
};
