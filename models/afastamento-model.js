'use strict';

module.exports = (sequelize, DataTypes) => {
  const AfastamentoModel = sequelize.define(
    'AfastamentoModel',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      tipoId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'tipo_id',
      },
      usuarioId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'usuario_id',
      },
      dataInicio: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'data_inicio',
      },
      dataFim: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'data_fim',
      },
      ordemGlobalUsuarioIdsAntes: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'ordem_global_usuario_ids_antes',
      },
    },
    { freezeTableName: true, tableName: 'afastamento', timestamps: true },
  );

  AfastamentoModel.associate = function (models) {
    AfastamentoModel.belongsTo(models.TipoAfastamentoModel, {
      foreignKey: 'tipoId',
      as: 'tipo',
    });
    AfastamentoModel.belongsTo(models.UsuarioModel, {
      foreignKey: 'usuarioId',
      as: 'usuario',
    });
  };

  return AfastamentoModel;
};
