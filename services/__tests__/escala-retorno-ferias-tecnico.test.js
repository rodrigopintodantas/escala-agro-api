jest.mock('../../models', () => ({
  EscalaModel: {},
  EscalaMembroModel: {},
  PlantaoModel: {},
  UsuarioModel: {},
  PapelModel: {},
  UsuarioPapelModel: {},
  PermutaSolicitacaoModel: {},
  ImpedimentoModel: {},
  AfastamentoModel: {},
  TipoAfastamentoModel: {},
  OrdemServidorModel: {},
  EscalaOrdemHistoricoModel: {},
  sequelize: { literal: () => '' },
}));

const EscalaService = require('../escala.service');

describe('Retorno de ferias tecnico - regressao', () => {
  const { escolherRetornoFeriasDoDia } = EscalaService.__testables;

  test('nao deve selecionar o mesmo tecnico na segunda vaga do mesmo dia', () => {
    const ordemAtual = [101, 102, 103, 104];
    const afastamentosPorUsuario = new Map();
    const dataIso = '2026-06-20';
    const pendentes = [101];
    const idxPreferencial = 0;

    const vaga0 = escolherRetornoFeriasDoDia(
      pendentes,
      ordemAtual,
      idxPreferencial,
      afastamentosPorUsuario,
      dataIso,
      new Set(),
      new Set(),
    );
    expect(vaga0).toBe(101);

    const vaga1 = escolherRetornoFeriasDoDia(
      pendentes,
      ordemAtual,
      idxPreferencial,
      afastamentosPorUsuario,
      dataIso,
      new Set(),
      new Set([101]),
    );
    expect(vaga1).toBeNull();
  });

  test('retornos em datas diferentes escolhem apenas o tecnico previsto de cada data', () => {
    const ordemAtual = [201, 202, 203, 204, 205, 206];
    const afastamentosPorUsuario = new Map();
    const filaPendentes = [];

    // 20/06: retorna Alvaro (201)
    filaPendentes.push(201);
    const retornoAlvaro = escolherRetornoFeriasDoDia(
      filaPendentes,
      ordemAtual,
      0,
      afastamentosPorUsuario,
      '2026-06-20',
      new Set(),
      new Set(),
    );
    expect(retornoAlvaro).toBe(201);

    // Simula remocao da fila apos alocacao da vaga do dia.
    filaPendentes.splice(filaPendentes.indexOf(retornoAlvaro), 1);

    // 27/06: retorna Amanda (202)
    filaPendentes.push(202);
    const retornoAmanda = escolherRetornoFeriasDoDia(
      filaPendentes,
      ordemAtual,
      0,
      afastamentosPorUsuario,
      '2026-06-27',
      new Set(),
      new Set(),
    );
    expect(retornoAmanda).toBe(202);
  });
});
