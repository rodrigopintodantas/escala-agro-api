'use strict';
module.exports = (sequelize, DataTypes) => {
  const PapelModel = sequelize.define(
    'PapelModel',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nome: {
        type: DataTypes.STRING,
        unique: 'PapelModel',
      },
      descricao: DataTypes.STRING,
      ativo: DataTypes.BOOLEAN,
      dashboard: DataTypes.STRING,
      vinculo: DataTypes.STRING,
    },
    { freezeTableName: true, tableName: 'papel', timestamps: true },
  );

  PapelModel.associate = function (models) {
    PapelModel.hasMany(models.UsuarioPapelModel, {});
  };

  return PapelModel;
};
