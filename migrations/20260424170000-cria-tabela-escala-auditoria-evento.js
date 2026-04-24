'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('escala_auditoria_evento', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      escala_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'escala', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      categoria_membro: { type: Sequelize.STRING(24), allowNull: false },
      tipo_evento: { type: Sequelize.STRING(48), allowNull: false },
      referencia_tipo: { type: Sequelize.STRING(48), allowNull: true },
      referencia_id: { type: Sequelize.INTEGER, allowNull: true },
      data_referencia: { type: Sequelize.DATEONLY, allowNull: true },
      ordem_antes_usuario_ids: { type: Sequelize.JSONB, allowNull: true },
      ordem_depois_usuario_ids: { type: Sequelize.JSONB, allowNull: false },
      detalhes: { type: Sequelize.JSONB, allowNull: true },
      criado_por_usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'usuario', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex('escala_auditoria_evento', ['escala_id', 'categoria_membro', 'createdAt'], {
      name: 'escala_auditoria_evento_escala_categoria_data_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('escala_auditoria_evento', 'escala_auditoria_evento_escala_categoria_data_idx');
    await queryInterface.dropTable('escala_auditoria_evento');
  },
};
