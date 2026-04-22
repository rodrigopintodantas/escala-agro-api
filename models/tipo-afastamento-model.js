'use strict';

module.exports = (sequelize, DataTypes) => {
  const TipoAfastamentoModel = sequelize.define(
    'TipoAfastamentoModel',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      tipo: { type: DataTypes.STRING(120), allowNull: false },
      descricao: { type: DataTypes.TEXT, allowNull: true },
      regraOrdem: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'nao_altera',
        field: 'regra_ordem',
      },
    },
    { freezeTableName: true, tableName: 'tipo_afastamento', timestamps: true },
  );

  TipoAfastamentoModel.associate = function (models) {
    TipoAfastamentoModel.hasMany(models.AfastamentoModel, {
      foreignKey: 'tipoId',
      as: 'afastamentos',
    });
  };

  return TipoAfastamentoModel;
};
