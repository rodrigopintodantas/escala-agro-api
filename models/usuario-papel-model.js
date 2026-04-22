'use strict';

module.exports = (sequelize, DataTypes) => {
  const UsuarioPapelModel = sequelize.define(
    'UsuarioPapelModel',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      PapelModelId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'papel_id',
      },
      UsuarioModelId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'usuario_id',
      },
    },
    { freezeTableName: true, tableName: 'usuario_papel', timestamps: false },
  );

  UsuarioPapelModel.associate = function (models) {
    UsuarioPapelModel.belongsTo(models.UsuarioModel, {
      allowNull: false,
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });
    UsuarioPapelModel.belongsTo(models.PapelModel, {
      allowNull: false,
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });
  };

  return UsuarioPapelModel;
};
