'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;

    if (!(await qi.tableExists('tipo_afastamento'))) {
      await qi.createTable('tipo_afastamento', {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        tipo: {
          type: Sequelize.STRING(120),
          allowNull: false,
        },
        descricao: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        regra_ordem: {
          type: Sequelize.STRING(32),
          allowNull: false,
          defaultValue: 'nao_altera',
          comment: 'nao_altera | adiar_no_ciclo',
        },
        createdAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updatedAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      });
    }

    const tipoCols = await qi.describeTable('tipo_afastamento');
    if (!tipoCols.regra_ordem) {
      await qi.addColumn('tipo_afastamento', 'regra_ordem', {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'nao_altera',
        comment: 'nao_altera | adiar_no_ciclo',
      });
    }

    // Idempotente: retry após falha posterior (DDL em PG pode autocommitar antes do fim do script).
    await sequelize.query(`
      INSERT INTO tipo_afastamento (id, tipo, descricao, regra_ordem, "createdAt", "updatedAt")
      VALUES
        (1, 'Férias', 'Férias', 'adiar_no_ciclo', NOW(), NOW()),
        (2, 'Abono', 'Abono', 'nao_altera', NOW(), NOW()),
        (3, 'Atestado', 'Atestado', 'nao_altera', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    await sequelize.query(`
      UPDATE tipo_afastamento
         SET regra_ordem = CASE
           WHEN id = 1 THEN 'adiar_no_ciclo'
           ELSE 'nao_altera'
         END
       WHERE regra_ordem IS NULL OR regra_ordem = ''
    `);

    await sequelize.query(`
      SELECT setval(
        pg_get_serial_sequence('tipo_afastamento', 'id'),
        COALESCE((SELECT MAX(id) FROM tipo_afastamento), 1)
      )
    `);

    if (!(await qi.tableExists('afastamento'))) {
      await qi.createTable('afastamento', {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        tipo_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: 'tipo_afastamento', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        usuario_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: 'usuario', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        data_inicio: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        data_fim: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        createdAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updatedAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      });

      await qi.addIndex('afastamento', ['usuario_id'], {
        name: 'afastamento_usuario_id_idx',
      });
      await qi.addIndex('afastamento', ['data_inicio', 'data_fim'], {
        name: 'afastamento_periodo_idx',
      });
    }

    if (await qi.tableExists('ordem_servidor')) {
      await sequelize.query(`
        INSERT INTO ordem_servidor (usuario_id, ordem, "createdAt", "updatedAt")
        SELECT u.id, ROW_NUMBER() OVER (ORDER BY u.nome ASC), NOW(), NOW()
          FROM usuario u
          JOIN usuario_papel up ON up.usuario_id = u.id
          JOIN papel p ON p.id = up.papel_id
         WHERE p.nome IN ('Veterinario', 'Veterinário')
           AND u.ativo = true
           AND NOT EXISTS (
             SELECT 1
               FROM ordem_servidor os
              WHERE os.usuario_id = u.id
           )
        ORDER BY u.nome ASC
      `);
    }

    if (await qi.tableExists('escala_ordem_historico')) {
      await sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint
             WHERE conname = 'escala_ordem_historico_tipo_afastamento_fk'
          ) THEN
            ALTER TABLE escala_ordem_historico
            ADD CONSTRAINT escala_ordem_historico_tipo_afastamento_fk
            FOREIGN KEY (tipo_afastamento_id) REFERENCES tipo_afastamento(id)
            ON UPDATE CASCADE ON DELETE SET NULL;
          END IF;
        END
        $$;
      `);

      await sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint
             WHERE conname = 'escala_ordem_historico_afastamento_fk'
          ) THEN
            ALTER TABLE escala_ordem_historico
            ADD CONSTRAINT escala_ordem_historico_afastamento_fk
            FOREIGN KEY (afastamento_id) REFERENCES afastamento(id)
            ON UPDATE CASCADE ON DELETE SET NULL;
          END IF;
        END
        $$;
      `);
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.query('DROP TABLE IF EXISTS afastamento CASCADE');
    await sequelize.query('DROP TABLE IF EXISTS tipo_afastamento CASCADE');
  },
};
