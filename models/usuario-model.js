'use strict';

module.exports = (sequelize, DataTypes) => {
  const UsuarioModel = sequelize.define(
    'UsuarioModel',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nome: {
        type: DataTypes.STRING,
        unique: 'UsuarioModel',
      },
      documento: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      login: { type: DataTypes.STRING, unique: 'login' },
      ativo: DataTypes.BOOLEAN,
      email: DataTypes.STRING,
      genero: DataTypes.STRING,
      cargo: DataTypes.STRING,
      telefone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    { freezeTableName: true, tableName: 'usuario', timestamps: false },
  );

  UsuarioModel.associate = function (models) {
    UsuarioModel.hasMany(models.UsuarioPapelModel, {
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });
  };

  return UsuarioModel;
};
