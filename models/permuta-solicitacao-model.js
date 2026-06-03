'use strict';

module.exports = (sequelize, DataTypes) => {
  const PermutaSolicitacaoModel = sequelize.define(
    'PermutaSolicitacaoModel',
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
      solicitanteUsuarioId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'solicitante_usuario_id',
      },
      destinatarioUsuarioId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'destinatario_usuario_id',
      },
      plantaoOrigemId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'plantao_origem_id',
      },
      plantaoDestinoId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'plantao_destino_id',
      },
      categoria: {
        type: DataTypes.STRING(16),
        allowNull: true,
      },
      ordinalSolicitante: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'ordinal_solicitante',
      },
      ordinalDestinatario: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'ordinal_destinatario',
      },
      dataOrigemSnapshot: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'data_origem_snapshot',
      },
      dataDestinoSnapshot: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'data_destino_snapshot',
      },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pendente' },
    },
    { freezeTableName: true, tableName: 'permuta_solicitacao', timestamps: true },
  );

  PermutaSolicitacaoModel.associate = function (models) {
    PermutaSolicitacaoModel.belongsTo(models.EscalaModel, { foreignKey: 'escalaId', as: 'escala' });
    PermutaSolicitacaoModel.belongsTo(models.UsuarioModel, {
      foreignKey: 'solicitanteUsuarioId',
      as: 'solicitante',
    });
    PermutaSolicitacaoModel.belongsTo(models.UsuarioModel, {
      foreignKey: 'destinatarioUsuarioId',
      as: 'destinatario',
    });
    PermutaSolicitacaoModel.belongsTo(models.PlantaoModel, {
      foreignKey: 'plantaoOrigemId',
      as: 'plantaoOrigem',
    });
    PermutaSolicitacaoModel.belongsTo(models.PlantaoModel, {
      foreignKey: 'plantaoDestinoId',
      as: 'plantaoDestino',
    });
  };

  return PermutaSolicitacaoModel;
};
