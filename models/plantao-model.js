'use strict';

module.exports = (sequelize, DataTypes) => {
  const PlantaoModel = sequelize.define(
    'PlantaoModel',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      escalaId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'escala_id',
      },
      usuarioId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'usuario_id',
      },
      dataReferencia: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'data_referencia',
      },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'previsto' },
      observacao: { type: DataTypes.TEXT, allowNull: true },
      ordemGlobalUsuarioIdsAntes: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'ordem_global_usuario_ids_antes',
      },
      ordemEscalaUsuarioIdsAntes: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'ordem_escala_usuario_ids_antes',
      },
    },
    { freezeTableName: true, tableName: 'plantao', timestamps: true },
  );

  PlantaoModel.associate = function (models) {
    PlantaoModel.belongsTo(models.EscalaModel, { foreignKey: 'escalaId', as: 'escala' });
    PlantaoModel.belongsTo(models.UsuarioModel, { foreignKey: 'usuarioId', as: 'usuario' });
  };

  return PlantaoModel;
};
