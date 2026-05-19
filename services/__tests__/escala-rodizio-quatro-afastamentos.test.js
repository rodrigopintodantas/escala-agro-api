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

const A = 101;
const B = 102;
const C = 103;
const D = 104;
const E = 105;
const F = 106;
const G = 107;
const H = 108;

const INICIAL = [A, B, C, D, E, F, G, H];
/** Fila após os 3 primeiros afastamentos (Ana, Felipe, Elisa), antes do Bruno. */
const APOS_TRES_AFASTAMENTOS = [B, C, D, G, E, H, F, A];

const LETRA = {
  [A]: 'A',
  [B]: 'B',
  [C]: 'C',
  [D]: 'D',
  [E]: 'E',
  [F]: 'F',
  [G]: 'G',
  [H]: 'H',
};

function ordemParaLetras(ids) {
  return ids.map((id) => LETRA[id] || '?').join('');
}

const DATAS_JUN_JUL = [
  '2026-06-06',
  '2026-06-07',
  '2026-06-13',
  '2026-06-14',
  '2026-06-20',
  '2026-06-21',
  '2026-06-27',
  '2026-06-28',
  '2026-07-04',
  '2026-07-05',
  '2026-07-11',
  '2026-07-12',
  '2026-07-18',
  '2026-07-19',
  '2026-07-25',
  '2026-07-26',
];

const AFASTAMENTOS_CENARIO = [
  { usuarioId: B, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-12' },
  { usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-08', dataFim: '2026-06-19' },
  { usuarioId: E, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-15', dataFim: '2026-06-15' },
  { usuarioId: F, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-22', dataFim: '2026-06-22' },
];

describe('Rodízio — quatro afastamentos (Bruno último)', () => {
  const { simularRodizioVetPlantoes } = EscalaService.__testables;

  test('junho a partir de BCDGEHFA: titulares CDGHBEFA (H no dia 14, E uma vez)', () => {
    const { alocacoes } = simularRodizioVetPlantoes(
      APOS_TRES_AFASTAMENTOS,
      DATAS_JUN_JUL.filter((d) => d.startsWith('2026-06')),
      AFASTAMENTOS_CENARIO,
    );
    const seq = alocacoes.map((a) => LETRA[a.usuarioId]).join('');
    expect(seq).toMatch(/^CDGH/);
    expect(seq.match(/E/g)?.length || 0).toBe(1);
    expect(alocacoes.find((a) => a.dataIso === '2026-06-14').usuarioId).toBe(H);
    expect(alocacoes.find((a) => a.dataIso === '2026-06-20').usuarioId).toBe(B);
  });

  test('simular do ABCDEFGH isolado difere de BCDGEHFA (motivo de não resetar ao inicial)', () => {
    const { alocacoes } = simularRodizioVetPlantoes(
      INICIAL,
      DATAS_JUN_JUL.filter((d) => d.startsWith('2026-06')),
      AFASTAMENTOS_CENARIO,
    );
    const titulares = alocacoes.map((a) => LETRA[a.usuarioId]).join('');
    expect(titulares).not.toBe('CDGHBEFA');
    expect(titulares).not.toBe('CDEFBEAF');
  });
});
