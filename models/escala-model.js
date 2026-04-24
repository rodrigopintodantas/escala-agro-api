'use strict';

module.exports = (sequelize, DataTypes) => {
  const EscalaModel = sequelize.define(
    'EscalaModel',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nome: { type: DataTypes.STRING(255), allowNull: false },
      descricao: { type: DataTypes.TEXT, allowNull: true },
      dataInicio: { type: DataTypes.DATEONLY, allowNull: false, field: 'data_inicio' },
      dataFim: { type: DataTypes.DATEONLY, allowNull: false, field: 'data_fim' },
      periodicidade: { type: DataTypes.STRING(32), allowNull: false },
      modoOrdemInicial: { type: DataTypes.STRING(16), allowNull: false, field: 'modo_ordem_inicial' },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'rascunho' },
      criadoPorUsuarioId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'criado_por_usuario_id',
      },
    },
    { freezeTableName: true, tableName: 'escala', timestamps: true },
  );

  EscalaModel.associate = function (models) {
    EscalaModel.belongsTo(models.UsuarioModel, {
      foreignKey: 'criadoPorUsuarioId',
      as: 'criadoPor',
    });
    EscalaModel.hasMany(models.EscalaMembroModel, { foreignKey: 'escalaId', as: 'membros' });
    EscalaModel.hasMany(models.EscalaOrdemHistoricoModel, { foreignKey: 'escalaId', as: 'historicoOrdem' });
    EscalaModel.hasMany(models.EscalaAuditoriaEventoModel, { foreignKey: 'escalaId', as: 'auditoriaEventos' });
    EscalaModel.hasMany(models.PlantaoModel, { foreignKey: 'escalaId', as: 'plantoes' });
    EscalaModel.hasMany(models.ImpedimentoModel, { foreignKey: 'escalaId', as: 'impedimentos' });
    EscalaModel.hasMany(models.PermutaSolicitacaoModel, { foreignKey: 'escalaId', as: 'permutas' });
  };

  return EscalaModel;
};
