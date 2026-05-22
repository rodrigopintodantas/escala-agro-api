jest.mock('../../models', () => ({
  EscalaModel: {},
  EscalaMembroModel: {},
  PlantaoModel: {},
  UsuarioModel: {},
  PapelModel: {},
  UsuarioPapelModel: {},
  PermutaSolicitacaoModel: {},
  ImpedimentoModel: {},
  AfastamentoModel: {
    findAll: jest.fn(),
    update: jest.fn(),
  },
  TipoAfastamentoModel: {},
  OrdemServidorModel: {
    destroy: jest.fn(),
    bulkCreate: jest.fn(),
    findAll: jest.fn(),
  },
  EscalaOrdemHistoricoModel: {
    findAll: jest.fn(),
  },
  EscalaAuditoriaEventoModel: {},
  sequelize: { literal: () => '' },
}));

jest.mock('../../auth/sequelize-transaction', () => ({
  sequelizeTransaction: async (fn) => fn({}),
}));

const { EscalaOrdemHistoricoModel, OrdemServidorModel, AfastamentoModel } = require('../../models');
const EscalaService = require('../escala.service');

const { restaurarOrdemGlobalPreExclusaoEscala } = EscalaService.__testables;

describe('restaurarOrdemGlobalPreExclusaoEscala', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    OrdemServidorModel.findAll.mockResolvedValue([]);
    OrdemServidorModel.destroy.mockResolvedValue(0);
    OrdemServidorModel.bulkCreate.mockResolvedValue([]);
    AfastamentoModel.findAll.mockResolvedValue([]);
    AfastamentoModel.update.mockResolvedValue([0]);
  });

  test('restaura ordem global de veterinários e técnicos a partir do histórico inicial', async () => {
    EscalaOrdemHistoricoModel.findAll.mockResolvedValue([
      {
        get: () => ({
          categoriaOrdem: 'veterinario',
          ordemGlobalUsuarioIds: [3, 1, 2],
        }),
      },
      {
        get: () => ({
          categoriaOrdem: 'tecnico',
          ordemGlobalUsuarioIds: [20, 21, 22],
        }),
      },
    ]);

    await restaurarOrdemGlobalPreExclusaoEscala(99, {});

    expect(OrdemServidorModel.destroy).toHaveBeenCalledTimes(2);
    expect(OrdemServidorModel.bulkCreate).toHaveBeenCalledWith(
      [
        { usuarioId: 3, ordem: 1, escopo: 'veterinario' },
        { usuarioId: 1, ordem: 2, escopo: 'veterinario' },
        { usuarioId: 2, ordem: 3, escopo: 'veterinario' },
      ],
      { transaction: {} },
    );
    expect(OrdemServidorModel.bulkCreate).toHaveBeenCalledWith(
      [
        { usuarioId: 20, ordem: 1, escopo: 'tecnico' },
        { usuarioId: 21, ordem: 2, escopo: 'tecnico' },
        { usuarioId: 22, ordem: 3, escopo: 'tecnico' },
      ],
      { transaction: {} },
    );
  });

  test('não altera ordem global se histórico inicial não tiver snapshot', async () => {
    EscalaOrdemHistoricoModel.findAll.mockResolvedValue([
      { get: () => ({ categoriaOrdem: 'veterinario', ordemGlobalUsuarioIds: null }) },
    ]);

    await restaurarOrdemGlobalPreExclusaoEscala(99, {});

    expect(OrdemServidorModel.destroy).not.toHaveBeenCalled();
    expect(OrdemServidorModel.bulkCreate).not.toHaveBeenCalled();
  });
});
