'use strict';

module.exports = (sequelize, DataTypes) => {
  const EscalaAuditoriaEventoModel = sequelize.define(
    'EscalaAuditoriaEventoModel',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      escalaId: { type: DataTypes.INTEGER, allowNull: false, field: 'escala_id' },
      categoriaMembro: { type: DataTypes.STRING(24), allowNull: false, field: 'categoria_membro' },
      tipoEvento: { type: DataTypes.STRING(48), allowNull: false, field: 'tipo_evento' },
      referenciaTipo: { type: DataTypes.STRING(48), allowNull: true, field: 'referencia_tipo' },
      referenciaId: { type: DataTypes.INTEGER, allowNull: true, field: 'referencia_id' },
      dataReferencia: { type: DataTypes.DATEONLY, allowNull: true, field: 'data_referencia' },
      ordemAntesUsuarioIds: { type: DataTypes.JSONB, allowNull: true, field: 'ordem_antes_usuario_ids' },
      ordemDepoisUsuarioIds: { type: DataTypes.JSONB, allowNull: false, field: 'ordem_depois_usuario_ids' },
      detalhes: { type: DataTypes.JSONB, allowNull: true },
      criadoPorUsuarioId: { type: DataTypes.INTEGER, allowNull: true, field: 'criado_por_usuario_id' },
    },
    { freezeTableName: true, tableName: 'escala_auditoria_evento', timestamps: true },
  );

  EscalaAuditoriaEventoModel.associate = function (models) {
    EscalaAuditoriaEventoModel.belongsTo(models.EscalaModel, { foreignKey: 'escalaId', as: 'escala' });
    EscalaAuditoriaEventoModel.belongsTo(models.UsuarioModel, { foreignKey: 'criadoPorUsuarioId', as: 'criadoPor' });
  };

  return EscalaAuditoriaEventoModel;
};
