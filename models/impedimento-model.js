'use strict';

module.exports = (sequelize, DataTypes) => {
  const ImpedimentoModel = sequelize.define(
    'ImpedimentoModel',
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
      escalaId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'escala_id',
      },
      dataInicio: { type: DataTypes.DATEONLY, allowNull: false, field: 'data_inicio' },
      dataFim: { type: DataTypes.DATEONLY, allowNull: false, field: 'data_fim' },
      tipo: { type: DataTypes.STRING(48), allowNull: false },
      motivo: { type: DataTypes.TEXT, allowNull: true },
    },
    { freezeTableName: true, tableName: 'impedimento', timestamps: true },
  );

  ImpedimentoModel.associate = function (models) {
    ImpedimentoModel.belongsTo(models.UsuarioModel, { foreignKey: 'usuarioId', as: 'usuario' });
    ImpedimentoModel.belongsTo(models.EscalaModel, { foreignKey: 'escalaId', as: 'escala' });
  };

  return ImpedimentoModel;
};
