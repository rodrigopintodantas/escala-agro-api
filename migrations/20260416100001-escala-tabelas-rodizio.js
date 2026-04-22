'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('escala', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nome: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      descricao: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      data_inicio: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      data_fim: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      periodicidade: {
        type: Sequelize.STRING(32),
        allowNull: false,
        comment: 'diario | semanal | quinzenal | mensal',
      },
      modo_ordem_inicial: {
        type: Sequelize.STRING(16),
        allowNull: false,
        comment: 'fixa | aleatorio',
      },
      status: {
        type: Sequelize.STRING(24),
        allowNull: false,
        defaultValue: 'rascunho',
      },
      criado_por_usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'usuario', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
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

    await queryInterface.createTable('escala_membro', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      escala_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'escala', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'usuario', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      ordem: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      ativo: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex('escala_membro', ['escala_id', 'usuario_id'], {
      unique: true,
      name: 'escala_membro_escala_usuario_uk',
    });

    await queryInterface.addIndex('escala_membro', ['escala_id', 'ordem'], {
      unique: true,
      name: 'escala_membro_escala_ordem_uk',
    });

    await queryInterface.createTable('escala_ordem_historico', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      escala_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'escala', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      motivo: {
        type: Sequelize.STRING(32),
        allowNull: false,
        comment: 'inicial | afastamento | manual',
      },
      tipo_afastamento_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      afastamento_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      ordem_usuario_ids: {
        type: Sequelize.JSONB,
        allowNull: false,
        comment: 'Snapshot da ordem vigente [usuarioId...]',
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

    await queryInterface.addIndex('escala_ordem_historico', ['escala_id', 'createdAt'], {
      name: 'escala_ordem_hist_escala_created_idx',
    });

    await queryInterface.createTable('ordem_servidor', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'usuario', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      ordem: {
        type: Sequelize.INTEGER,
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

    await queryInterface.addIndex('ordem_servidor', ['usuario_id'], {
      unique: true,
      name: 'ordem_servidor_usuario_uk',
    });
    await queryInterface.addIndex('ordem_servidor', ['ordem'], {
      unique: true,
      name: 'ordem_servidor_ordem_uk',
    });

    await queryInterface.createTable('plantao', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      escala_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'escala', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'usuario', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      data_referencia: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      status: {
        type: Sequelize.STRING(24),
        allowNull: false,
        defaultValue: 'previsto',
      },
      observacao: {
        type: Sequelize.TEXT,
        allowNull: true,
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

    await queryInterface.addIndex('plantao', ['escala_id', 'data_referencia'], {
      unique: true,
      name: 'plantao_escala_data_uk',
    });

    await queryInterface.createTable('impedimento', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'usuario', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      escala_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'escala', key: 'id' },
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
      tipo: {
        type: Sequelize.STRING(48),
        allowNull: false,
        comment: 'ferias | licenca | outro',
      },
      motivo: {
        type: Sequelize.TEXT,
        allowNull: true,
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

    await queryInterface.createTable('permuta_solicitacao', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      escala_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'escala', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      solicitante_usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'usuario', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      destinatario_usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'usuario', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      plantao_origem_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'plantao', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      plantao_destino_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'plantao', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      status: {
        type: Sequelize.STRING(24),
        allowNull: false,
        defaultValue: 'pendente',
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
  },

  async down(queryInterface) {
    await queryInterface.dropTable('permuta_solicitacao');
    await queryInterface.dropTable('impedimento');
    await queryInterface.dropTable('plantao');
    await queryInterface.dropTable('ordem_servidor');
    await queryInterface.dropTable('escala_ordem_historico');
    await queryInterface.dropTable('escala_membro');
    await queryInterface.dropTable('escala');
  },
};
