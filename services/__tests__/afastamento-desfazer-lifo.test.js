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
  },
  TipoAfastamentoModel: {},
  OrdemServidorModel: {},
  EscalaOrdemHistoricoModel: {},
  EscalaAuditoriaEventoModel: {},
  sequelize: { literal: () => '' },
}));

jest.mock('../../auth/sequelize-transaction', () => ({
  sequelizeTransaction: async (fn) => fn({}),
}));

const { AfastamentoModel } = require('../../models');
const EscalaService = require('../escala.service');

const { obterIdsAfastamentosMaisRecentesPorClasse } = EscalaService.__testables;

describe('desfazer afastamento — fila LIFO por classe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    EscalaService.listarVeterinarios = jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    EscalaService.listarTecnicos = jest.fn().mockResolvedValue([{ id: 10 }, { id: 11 }]);
  });

  test('retorna o mais recente por createdAt em cada classe (ex.: Ana depois Daniel → só Daniel)', async () => {
    AfastamentoModel.findAll.mockResolvedValue([
      { id: 99, usuarioId: 2, createdAt: new Date('2026-06-10T12:00:00Z') },
      { id: 88, usuarioId: 1, createdAt: new Date('2026-06-05T12:00:00Z') },
      { id: 77, usuarioId: 10, createdAt: new Date('2026-06-01T12:00:00Z') },
    ]);

    const ids = await obterIdsAfastamentosMaisRecentesPorClasse(null);
    expect(ids.veterinario).toBe(99);
    expect(ids.tecnico).toBe(77);
  });
});
