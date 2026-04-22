'use strict';

module.exports = (sequelize, DataTypes) => {
  const EscalaMembroModel = sequelize.define(
    'EscalaMembroModel',
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
      ordem: { type: DataTypes.INTEGER, allowNull: false },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { freezeTableName: true, tableName: 'escala_membro', timestamps: true },
  );

  EscalaMembroModel.associate = function (models) {
    EscalaMembroModel.belongsTo(models.EscalaModel, { foreignKey: 'escalaId', as: 'escala' });
    EscalaMembroModel.belongsTo(models.UsuarioModel, { foreignKey: 'usuarioId', as: 'usuario' });
  };

  return EscalaMembroModel;
};
