'use strict';

module.exports = (sequelize, DataTypes) => {
  const OrdemServidorModel = sequelize.define(
    'OrdemServidorModel',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      usuarioId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'usuario_id',
      },
      ordem: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      escopo: {
        type: DataTypes.STRING(24),
        allowNull: false,
        defaultValue: 'veterinario',
        field: 'escopo',
      },
    },
    { freezeTableName: true, tableName: 'ordem_servidor', timestamps: true },
  );

  OrdemServidorModel.associate = function (models) {
    OrdemServidorModel.belongsTo(models.UsuarioModel, { foreignKey: 'usuarioId', as: 'usuario' });
  };

  return OrdemServidorModel;
};
