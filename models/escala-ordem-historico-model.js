'use strict';

module.exports = (sequelize, DataTypes) => {
  const EscalaOrdemHistoricoModel = sequelize.define(
    'EscalaOrdemHistoricoModel',
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
      motivo: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      tipoAfastamentoId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'tipo_afastamento_id',
      },
      afastamentoId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'afastamento_id',
      },
      ordemUsuarioIds: {
        type: DataTypes.JSONB,
        allowNull: false,
        field: 'ordem_usuario_ids',
      },
      ordemUsuarioIdsAntes: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'ordem_usuario_ids_antes',
      },
      ordemGlobalUsuarioIds: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'ordem_global_usuario_ids',
      },
      categoriaOrdem: {
        type: DataTypes.STRING(24),
        allowNull: true,
        field: 'categoria_ordem',
      },
    },
    { freezeTableName: true, tableName: 'escala_ordem_historico', timestamps: true },
  );

  EscalaOrdemHistoricoModel.associate = function (models) {
    EscalaOrdemHistoricoModel.belongsTo(models.EscalaModel, { foreignKey: 'escalaId', as: 'escala' });
    EscalaOrdemHistoricoModel.belongsTo(models.TipoAfastamentoModel, {
      foreignKey: 'tipoAfastamentoId',
      as: 'tipoAfastamento',
      constraints: false,
    });
    EscalaOrdemHistoricoModel.belongsTo(models.AfastamentoModel, {
      foreignKey: 'afastamentoId',
      as: 'afastamento',
      constraints: false,
    });
  };

  return EscalaOrdemHistoricoModel;
};
