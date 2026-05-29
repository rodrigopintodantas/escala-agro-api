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
  EscalaAuditoriaEventoModel: {},
  sequelize: { literal: () => '' },
}));

const EscalaService = require('../escala.service');

const {
  recalcularEscalaCompletaNucleo,
  simularRodizioVetPlantoes,
  simularRodizioTecPlantoes,
  classificarRelevanciaAfastamentoEscalaAtiva,
  montarParametrosFiltroAfastamentoPlantoes,
} = EscalaService.__testables;

/**
 * Vet alfabéticos (A-H) e Tec alfabéticos (I-X).
 * Convenções: dias úteis = sex/sáb/dom (para o cenário escala de fim de semana com plantão dom 02-12).
 * Aqui usamos diretamente as datas dos plantões já decididas pela criação da escala.
 */
const A = 101;
const B = 102;
const C = 103;
const D = 104;
const E = 105;
const F = 106;
const G = 107;
const H = 108;
const ORDEM_VET = [A, B, C, D, E, F, G, H];

const ORDEM_TEC = [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216];
const FABIO_TEC = 211;

const DATAS_JUN_JUL_VET = [
  '2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14',
  '2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28',
  '2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12',
  '2026-07-18', '2026-07-19', '2026-07-25', '2026-07-26',
];

const LETRA_VET = { 101: 'A', 102: 'B', 103: 'C', 104: 'D', 105: 'E', 106: 'F', 107: 'G', 108: 'H' };

function plantoesVetGravados(datas, alocacoesPorData) {
  return datas.map((d, idx) => ({
    id: idx + 1,
    dataReferencia: d,
    categoriaPlantao: 'veterinario',
    vagaIndice: 0,
    usuarioId: alocacoesPorData?.[d] ?? ORDEM_VET[idx % ORDEM_VET.length],
  }));
}

function plantoesTecGravados(datas, ordemAlfabetica = ORDEM_TEC) {
  const out = [];
  let cursor = 0;
  for (const d of datas) {
    for (const vagaIndice of [0, 1]) {
      out.push({
        id: out.length + 1,
        dataReferencia: d,
        categoriaPlantao: 'tecnico',
        vagaIndice,
        usuarioId: ordemAlfabetica[cursor % ordemAlfabetica.length],
      });
      cursor += 1;
    }
  }
  return out;
}

function calendarioVetStr(alocacoes, datas) {
  return datas
    .map((d) => {
      const a = alocacoes.find((x) => x.dataIso === d);
      return a ? LETRA_VET[a.usuarioId] || '?' : '?';
    })
    .join('');
}

describe('recalcularEscalaCompletaNucleo (Fase 1 — núcleo puro)', () => {
  test('escala sem afastamentos: calendário e ordem permanecem alfabéticos', () => {
    const plantoes = plantoesVetGravados(DATAS_JUN_JUL_VET);
    const r = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: ORDEM_VET,
      plantoesGravados: plantoes,
      afastamentos: [],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    expect(calendarioVetStr(r.alocacoesVet, DATAS_JUN_JUL_VET)).toBe('ABCDEFGHABCDEFGH');
    expect(r.atualizados).toBe(0);
    expect(r.ordemMudou).toBe(false);
    expect(r.diffsCongeladosVet).toEqual([]);
  });

  test('cenário Ana + Diego + Gabriela + Ana17 + Hen17: BCEFDHAG/BCEFDGAH', () => {
    const plantoes = plantoesVetGravados(DATAS_JUN_JUL_VET);
    const afastamentos = [
      { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
      { id: 2, usuarioId: D, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      { id: 3, usuarioId: G, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-17', dataFim: '2026-06-24' },
      { id: 4, usuarioId: A, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' },
      { id: 5, usuarioId: H, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' },
    ];
    const r = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: ORDEM_VET,
      plantoesGravados: plantoes,
      afastamentos,
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    expect(calendarioVetStr(r.alocacoesVet, DATAS_JUN_JUL_VET)).toBe('BCEFDHAGBCEFDGAH');
  });

  test('determinismo: ordem dos afastamentos no input não afeta o resultado', () => {
    const plantoes = plantoesVetGravados(DATAS_JUN_JUL_VET);
    const afastamentos = [
      { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
      { id: 2, usuarioId: D, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      { id: 3, usuarioId: G, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-17', dataFim: '2026-06-24' },
      { id: 4, usuarioId: A, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' },
      { id: 5, usuarioId: H, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' },
    ];
    const r1 = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: ORDEM_VET,
      plantoesGravados: plantoes,
      afastamentos,
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    const r2 = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: ORDEM_VET,
      plantoesGravados: plantoes,
      afastamentos: [...afastamentos].reverse(),
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    expect(calendarioVetStr(r1.alocacoesVet, DATAS_JUN_JUL_VET)).toBe(
      calendarioVetStr(r2.alocacoesVet, DATAS_JUN_JUL_VET),
    );
    expect(r1.ordemFinalVet).toEqual(r2.ordemFinalVet);
    expect(r1.afastamentosOrdenadosIds).toEqual(r2.afastamentosOrdenadosIds);
  });

  test('abono Henrique 11/06 (irrelevante) não altera calendário', () => {
    const plantoes = plantoesVetGravados(DATAS_JUN_JUL_VET);
    const afastamentosSemHen11 = [
      { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
      { id: 2, usuarioId: D, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      { id: 3, usuarioId: G, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-17', dataFim: '2026-06-24' },
      { id: 4, usuarioId: A, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' },
      { id: 5, usuarioId: H, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' },
    ];
    const afHen11 = { id: 6, usuarioId: H, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-11', dataFim: '2026-06-11' };
    const semHen11 = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: ORDEM_VET,
      plantoesGravados: plantoes,
      afastamentos: afastamentosSemHen11,
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    const comHen11 = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: ORDEM_VET,
      plantoesGravados: plantoes,
      afastamentos: [...afastamentosSemHen11, afHen11],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    expect(calendarioVetStr(comHen11.alocacoesVet, DATAS_JUN_JUL_VET)).toBe(
      calendarioVetStr(semHen11.alocacoesVet, DATAS_JUN_JUL_VET),
    );
  });

  test('férias téc Fábio 17–24/06 não altera calendário vet', () => {
    const plantoesVet = plantoesVetGravados(DATAS_JUN_JUL_VET);
    const plantoesTec = plantoesTecGravados(DATAS_JUN_JUL_VET);
    const todosPlantoes = [...plantoesVet, ...plantoesTec];
    const afastamentosVet = [
      { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
      { id: 2, usuarioId: D, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      { id: 3, usuarioId: G, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-17', dataFim: '2026-06-24' },
      { id: 4, usuarioId: A, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' },
      { id: 5, usuarioId: H, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' },
    ];
    const afFabio = { id: 6, usuarioId: FABIO_TEC, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-17', dataFim: '2026-06-24' };
    const semFabio = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemInicialTec: ORDEM_TEC,
      ordemMembrosVet: ORDEM_VET,
      ordemMembrosTec: ORDEM_TEC,
      plantoesGravados: todosPlantoes,
      afastamentos: afastamentosVet,
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    const comFabio = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemInicialTec: ORDEM_TEC,
      ordemMembrosVet: ORDEM_VET,
      ordemMembrosTec: ORDEM_TEC,
      plantoesGravados: todosPlantoes,
      afastamentos: [...afastamentosVet, afFabio],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    expect(calendarioVetStr(comFabio.alocacoesVet, DATAS_JUN_JUL_VET)).toBe(
      calendarioVetStr(semFabio.alocacoesVet, DATAS_JUN_JUL_VET),
    );
    expect(comFabio.ordemFinalVet).toEqual(semFabio.ordemFinalVet);
  });

  test('congelamento: divergências em datas < dataCongelamentoIso ficam apenas em diffsCongelados', () => {
    /** Calendário gravado errado para 06/06 (deveria ser A=101, está como B=102) — congelado. */
    const plantoes = plantoesVetGravados(DATAS_JUN_JUL_VET, { '2026-06-06': B });
    const r = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: ORDEM_VET,
      plantoesGravados: plantoes,
      afastamentos: [],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-07-01',
    });
    expect(r.atualizados).toBe(0);
    expect(r.diffsCongeladosVet).toEqual([
      { dataIso: '2026-06-06', gravado: B, simulado: A },
    ]);
  });

  test('persistência: datas >= dataCongelamentoIso entram em updatesVet', () => {
    /** Sem afastamentos: calendário simulado é ABCDEFGH; se gravarmos B em vez de A no 04/07, deve atualizar. */
    const plantoes = plantoesVetGravados(DATAS_JUN_JUL_VET, { '2026-07-04': B });
    const r = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: ORDEM_VET,
      plantoesGravados: plantoes,
      afastamentos: [],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    expect(r.atualizados).toBe(1);
    expect(r.updatesVet).toHaveLength(1);
    expect(r.updatesVet[0].dataIso).toBe('2026-07-04');
    expect(r.updatesVet[0].usuarioId).toBe(A);
  });

  test('exclusão arbitrária de afastamento do meio: resultado = simulação sem o removido', () => {
    /**
     * Crítica para a nova funcionalidade: depois de cadastrar Ana, Diego, Gabriela, Ana17, Hen17,
     * remover o Diego (12/06) deve produzir o MESMO resultado que se ele nunca tivesse existido.
     * O modelo incremental atual exigia LIFO (só dava pra remover o mais recente).
     */
    const plantoes = plantoesVetGravados(DATAS_JUN_JUL_VET);
    const afCompleto = [
      { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
      { id: 2, usuarioId: D, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      { id: 3, usuarioId: G, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-17', dataFim: '2026-06-24' },
      { id: 4, usuarioId: A, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' },
      { id: 5, usuarioId: H, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' },
    ];
    const afSemDiego = afCompleto.filter((a) => a.id !== 2);

    const rComDiego = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: ORDEM_VET,
      plantoesGravados: plantoes,
      afastamentos: afCompleto,
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    /** Plantões após o cenário com Diego (simula o estado gravado antes de excluir Diego). */
    const plantoesAposComDiego = DATAS_JUN_JUL_VET.map((d, idx) => {
      const a = rComDiego.alocacoesVet.find((x) => x.dataIso === d);
      return {
        id: idx + 1,
        dataReferencia: d,
        categoriaPlantao: 'veterinario',
        vagaIndice: 0,
        usuarioId: a ? a.usuarioId : ORDEM_VET[idx % ORDEM_VET.length],
      };
    });

    const rAposRemover = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: rComDiego.ordemFinalVet,
      plantoesGravados: plantoesAposComDiego,
      afastamentos: afSemDiego,
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    const rNuncaTeveDiego = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: ORDEM_VET,
      plantoesGravados: plantoes,
      afastamentos: afSemDiego,
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    expect(calendarioVetStr(rAposRemover.alocacoesVet, DATAS_JUN_JUL_VET)).toBe(
      calendarioVetStr(rNuncaTeveDiego.alocacoesVet, DATAS_JUN_JUL_VET),
    );
    expect(rAposRemover.ordemFinalVet).toEqual(rNuncaTeveDiego.ordemFinalVet);
  });

  test('atestado mantém o titular no plantão (não desloca rodízio nem altera ordem)', () => {
    /**
     * Modelo de atestado "em gestão": o veterinário titular permanece no plantão e a ordem
     * do rodízio segue normalmente (o simulador trata `afastamentoEhAtestado` separadamente).
     */
    const plantoes = plantoesVetGravados(DATAS_JUN_JUL_VET);
    const afAtestadoB = {
      id: 99,
      usuarioId: B,
      tipo: { tipo: 'Atestado' },
      dataInicio: '2026-06-07',
      dataFim: '2026-06-07',
    };
    const r = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: ORDEM_VET,
      plantoesGravados: plantoes,
      afastamentos: [afAtestadoB],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    /** Calendário não muda (B continua no 07/06). */
    expect(calendarioVetStr(r.alocacoesVet, DATAS_JUN_JUL_VET)).toBe('ABCDEFGHABCDEFGH');
    expect(r.atualizados).toBe(0);
  });

  test('cenário acumulado (Ana → +Diego → +Gabriela → +Ana17 → +Hen17): bate com simulador puro em cada passo', () => {
    const plantoes = plantoesVetGravados(DATAS_JUN_JUL_VET);
    const af1 = { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' };
    const af2 = { id: 2, usuarioId: D, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' };
    const af3 = { id: 3, usuarioId: G, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-17', dataFim: '2026-06-24' };
    const af4 = { id: 4, usuarioId: A, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' };
    const af5 = { id: 5, usuarioId: H, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' };

    const passos = [[af1], [af1, af2], [af1, af2, af3], [af1, af2, af3, af4], [af1, af2, af3, af4, af5]];
    for (const afastamentos of passos) {
      const r = recalcularEscalaCompletaNucleo({
        ordemInicialVet: ORDEM_VET,
        ordemMembrosVet: ORDEM_VET,
        plantoesGravados: plantoes,
        afastamentos,
        periodicidadeEscala: 'fim_de_semana',
        dataCongelamentoIso: '2026-01-01',
      });
      const direto = simularRodizioVetPlantoes(ORDEM_VET, DATAS_JUN_JUL_VET, afastamentos, new Set());
      expect(r.alocacoesVet).toEqual(direto.alocacoes);
      expect(r.ordemFinalVet).toEqual(direto.ordemPersistida);
    }
  });

  test('férias téc Hugo 10–17/07 (escalado só em 25-26/07): irrelevante, não altera téc', () => {
    /**
     * Regressão: 16 técnicos; Hugo está na posição 15 da fila, escalado naturalmente em 25/07.
     * As férias (10–17/07) não tocam plantão dele e o retorno cai depois de dias úteis suficientes
     * (18–24/07 contém dias úteis). O afastamento deve ser irrelevante: calendário e fila técnica
     * permanecem idênticos ao cenário sem o afastamento.
     */
    const plantoesTec = plantoesTecGravados(DATAS_JUN_JUL_VET);
    const hugoUsuarioId = ORDEM_TEC[12];

    const semFerias = recalcularEscalaCompletaNucleo({
      ordemInicialTec: ORDEM_TEC,
      ordemMembrosTec: ORDEM_TEC,
      plantoesGravados: plantoesTec,
      afastamentos: [],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    /** Confirma a premissa: Hugo escalado em 25/07. */
    expect(
      semFerias.alocacoesTec.find((a) => a.dataIso === '2026-07-25' && a.vagaIndice === 0)?.usuarioId,
    ).toBe(hugoUsuarioId);

    const comFerias = recalcularEscalaCompletaNucleo({
      ordemInicialTec: ORDEM_TEC,
      ordemMembrosTec: ORDEM_TEC,
      plantoesGravados: plantoesTec,
      afastamentos: [
        {
          id: 1,
          usuarioId: hugoUsuarioId,
          tipo: { tipo: 'Férias' },
          dataInicio: '2026-07-10',
          dataFim: '2026-07-17',
        },
      ],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    expect(comFerias.alocacoesTec).toEqual(semFerias.alocacoesTec);
    expect(comFerias.ordemFinalTec).toEqual(semFerias.ordemFinalTec);
    expect(comFerias.atualizados).toBe(0);
    /** O afastamento foi filtrado fora do rodízio (sem efeito no plantão do titular). */
    expect(comFerias.afastamentosRodizioIds).toEqual([]);
  });

  test('abono téc 12/06 (sex) deve ser IRRELEVANTE quando Marilene já está em 20/06 (deslocada por abono 15/06)', () => {
    /**
     * Cenário reportado: depois de cadastrar Maria férias 08/06–02/07 e abono Marilene 15/06,
     * Marilene está em 20/06 v0 (retorno forçado). Adicionar abono Marilene 12/06 deveria ser
     * IRRELEVANTE — ela não plantonea nem em 13/06 (Marcelo está lá) nem em 14/06 (Walber), e
     * 20/06 já passou por dia útil intermediário (16-19/06).
     */
    const TEC = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
    const mariaId = TEC[7];
    const marileneId = TEC[8];
    const datasTec = [
      '2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14',
      '2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28',
      '2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12',
      '2026-07-18', '2026-07-19', '2026-07-25', '2026-07-26',
    ];
    const afMaria = {
      id: 1, usuarioId: mariaId, tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-08', dataFim: '2026-07-02',
    };
    const afAbonoMarilene15 = {
      id: 2, usuarioId: marileneId, tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-15', dataFim: '2026-06-15',
    };
    const afAbonoMarilene12 = {
      id: 3, usuarioId: marileneId, tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-12', dataFim: '2026-06-12',
    };

    /** Calendário gravado = recálculo com Maria + abono Marilene 15/06. */
    const baseSem12 = recalcularEscalaCompletaNucleo({
      ordemInicialTec: TEC,
      ordemMembrosTec: TEC,
      plantoesGravados: plantoesTecGravados(datasTec, TEC),
      afastamentos: [afMaria, afAbonoMarilene15],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    const gravados = baseSem12.alocacoesTec.map((a) => ({
      dataReferencia: a.dataIso, categoriaPlantao: 'tecnico',
      usuarioId: a.usuarioId, vagaIndice: a.vagaIndice,
    }));
    /** Confirma a premissa do cenário: Marilene em 20/06, fora de 13/06 e 14/06. */
    expect(baseSem12.alocacoesTec.find((a) => a.dataIso === '2026-06-20' && a.vagaIndice === 0)?.usuarioId).toBe(marileneId);
    expect(baseSem12.alocacoesTec.find((a) => a.dataIso === '2026-06-14' && a.vagaIndice === 1)?.usuarioId).not.toBe(marileneId);

    /** Adicionar abono 12/06: recálculo total não deve alterar nada, e o abono deve ser filtrado. */
    const comAbono12 = recalcularEscalaCompletaNucleo({
      ordemInicialTec: TEC,
      ordemMembrosTec: TEC,
      plantoesGravados: gravados,
      afastamentos: [afMaria, afAbonoMarilene15, afAbonoMarilene12],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    expect(comAbono12.atualizados).toBe(0);
    expect(comAbono12.afastamentosRodizioIds).not.toContain(3);
    /** Tag também deve vir irrelevante. */
    const categoriaPorUsuarioId = new Map();
    for (const id of TEC) categoriaPorUsuarioId.set(Number(id), 'tecnico');
    const paramsFiltro = montarParametrosFiltroAfastamentoPlantoes({
      plantoes: gravados, ordemVetInicial: [], ordemTecInicial: TEC,
      afastamentosLista: [afMaria, afAbonoMarilene15, afAbonoMarilene12],
      periodicidadeEscala: 'fim_de_semana', categoriaPorUsuarioId,
    });
    const ctx = {
      escalaId: 1, escalaNome: 'Teste', escalaStatus: 'ativa',
      dataInicioStr: '2026-06-06', dataFimStr: '2026-07-26', paramsFiltro,
    };
    expect(classificarRelevanciaAfastamentoEscalaAtiva(afAbonoMarilene12, ctx)).toBe('irrelevante');
  });

  test('retro-cadastro também bloqueia candidato substituto: abono téc em 2ª-feira tira titular do plantão de domingo anterior', () => {
    /**
     * Regressão real (cenário produção, 22 técnicos, ordem oficial):
     * - Maria Claudinéia (idx 7) tem férias 08/06–02/07, então em 14/06 v1 o substituto natural
     *   passa a ser Marilene (idx 8).
     * - Marilene tem abono em 15/06 (2ª-feira). Como não há dia útil entre o domingo 14/06 e a
     *   2ª-feira do abono, o retro-cadastro impede Marilene de plantonear em 14/06.
     *
     * Bug: a busca por substituto não verificava retro-cadastro, então o simulador escolhia
     * Marilene como substituta e ela ficava em 14/06 v1 mesmo com o abono em 15/06.
     */
    const TEC = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
    const mariaId = TEC[7];
    const marileneId = TEC[8];
    const datasTec = [
      '2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14',
      '2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28',
      '2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12',
      '2026-07-18', '2026-07-19', '2026-07-25', '2026-07-26',
    ];
    const plantoesTec = plantoesTecGravados(datasTec, TEC);
    const afMaria = {
      id: 1,
      usuarioId: mariaId,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-08',
      dataFim: '2026-07-02',
    };
    const afMarilene = {
      id: 2,
      usuarioId: marileneId,
      tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-15',
      dataFim: '2026-06-15',
    };

    const r = recalcularEscalaCompletaNucleo({
      ordemInicialTec: TEC,
      ordemMembrosTec: TEC,
      plantoesGravados: plantoesTec,
      afastamentos: [afMaria, afMarilene],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });

    const alocacao14v1 = r.alocacoesTec.find((a) => a.dataIso === '2026-06-14' && a.vagaIndice === 1);
    expect(alocacao14v1?.usuarioId).not.toBe(marileneId);
  });

  test('tag de relevância acompanha o recálculo total: férias téc Hugo 10–17/07 é IRRELEVANTE', () => {
    /**
     * Regressão (Diego/Hugo): o classificador da tag usava simulação sem filtrar afastamentos
     * sem efeito; o "retorno forçado pós-férias" do simulador disparava para afastamentos
     * irrelevantes e gerava `com !== sem`, marcando a tag como "relevante" mesmo o recálculo
     * total tratando como "irrelevante". Invariante esperada: se o recálculo filtrou o
     * afastamento (não está em `afastamentosRodizioIds`), a tag deve ser `irrelevante`.
     */
    const plantoesTec = plantoesTecGravados(DATAS_JUN_JUL_VET);
    const hugoUsuarioId = ORDEM_TEC[12];
    const afHugo = {
      id: 1,
      usuarioId: hugoUsuarioId,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-07-10',
      dataFim: '2026-07-17',
    };

    const recalc = recalcularEscalaCompletaNucleo({
      ordemInicialTec: ORDEM_TEC,
      ordemMembrosTec: ORDEM_TEC,
      plantoesGravados: plantoesTec,
      afastamentos: [afHugo],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    expect(recalc.afastamentosRodizioIds).toEqual([]);

    const categoriaPorUsuarioId = new Map();
    for (const id of ORDEM_TEC) categoriaPorUsuarioId.set(Number(id), 'tecnico');
    const paramsFiltro = montarParametrosFiltroAfastamentoPlantoes({
      plantoes: plantoesTec,
      ordemVetInicial: [],
      ordemTecInicial: ORDEM_TEC,
      afastamentosLista: [afHugo],
      periodicidadeEscala: 'fim_de_semana',
      categoriaPorUsuarioId,
    });
    const ctx = {
      escalaId: 1,
      escalaNome: 'Teste',
      escalaStatus: 'ativa',
      dataInicioStr: '2026-06-06',
      dataFimStr: '2026-07-26',
      paramsFiltro,
    };
    expect(classificarRelevanciaAfastamentoEscalaAtiva(afHugo, ctx)).toBe('irrelevante');
  });

  test('retorno pós-escala: férias téc Fabrícia 20–29/07 com retorno hipotético em 01/08 (fora da escala) coloca-a no início da fila', () => {
    /**
     * Cenário real (22 técnicos, ordem oficial):
     * - Escala junho/julho vai até 26/07/2026 (último plantão).
     * - Fabrícia (idx 3) tira férias 20–29/07. Como o primeiro plantão pós-fim com dia útil
     *   intermediário seria 01/08 (sábado), DEPOIS do fim da escala, o "retorno forçado"
     *   não dispara dentro da simulação.
     * - Antes desta mudança, o simulador apenas movia Fabrícia para depois da cobertura
     *   (moverUsuarioDepoisDaCobertura) ao bloqueá-la em 18/07 (retro-cadastro) e 25/07–26/07
     *   (ativo), empurrando-a para o fundo da fila final (~posição 15).
     * - Comportamento desejado (espelho do retorno forçado): Fabrícia deve aparecer no
     *   topo da fila persistida — ela ainda não plantonou nesta escala e seria a próxima
     *   a plantonear (em 01/08) na escala seguinte. Quem termina o afastamento mais cedo
     *   tem prioridade sobre os demais pendentes.
     */
    const TEC = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
    const fabriciaId = TEC[3];
    const datasTec = [
      '2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14',
      '2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28',
      '2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12',
      '2026-07-18', '2026-07-19', '2026-07-25', '2026-07-26',
    ];
    const plantoesTec = plantoesTecGravados(datasTec, TEC);
    const afFabricia = {
      id: 1,
      usuarioId: fabriciaId,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-07-20',
      dataFim: '2026-07-29',
    };

    const r = recalcularEscalaCompletaNucleo({
      ordemInicialTec: TEC,
      ordemMembrosTec: TEC,
      plantoesGravados: plantoesTec,
      afastamentos: [afFabricia],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });

    /** Premissa: o afastamento foi considerado relevante (efeito real no calendário). */
    expect(r.afastamentosRodizioIds).toContain(1);
    const posFabricia = r.ordemFinalTec.indexOf(fabriciaId);
    expect(posFabricia).toBeGreaterThanOrEqual(0);
    expect(posFabricia).toBeLessThanOrEqual(1);
  });

  test('retorno pós-escala: múltiplos técnicos com retorno fora da escala mantêm ordem FIFO por dataFim', () => {
    /**
     * Dois técnicos com afastamento cujo retorno cai fora da escala devem aparecer no topo
     * da fila persistida na ordem em que voltariam: quem termina o afastamento mais cedo
     * vem primeiro. Garante que o ajuste pós-escala respeita FIFO por dataFim.
     */
    const TEC = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
    const tecA = TEC[3];
    const tecB = TEC[5];
    const datasTec = [
      '2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14',
      '2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28',
      '2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12',
      '2026-07-18', '2026-07-19', '2026-07-25', '2026-07-26',
    ];
    const plantoesTec = plantoesTecGravados(datasTec, TEC);
    const afA = {
      id: 1,
      usuarioId: tecA,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-07-21',
      dataFim: '2026-07-29',
    };
    const afB = {
      id: 2,
      usuarioId: tecB,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-07-22',
      dataFim: '2026-07-30',
    };

    const r = recalcularEscalaCompletaNucleo({
      ordemInicialTec: TEC,
      ordemMembrosTec: TEC,
      plantoesGravados: plantoesTec,
      afastamentos: [afA, afB],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });

    const posA = r.ordemFinalTec.indexOf(tecA);
    const posB = r.ordemFinalTec.indexOf(tecB);
    expect(posA).toBeGreaterThanOrEqual(0);
    expect(posB).toBeGreaterThanOrEqual(0);
    expect(posA).toBeLessThan(posB);
  });

  test('retorno pós-escala: férias téc Helena 24/07–07/08 (retorno em 15/08) é posicionada na 9ª posição da fila', () => {
    /**
     * Cenário real (16 técnicos, escala junho/julho até 26/07): férias de Helena (idx 14)
     * iniciam em 24/07 e terminam em 07/08, ou seja, o afastamento ainda está em curso nas
     * primeiras datas hipotéticas de plantão após a escala (01/08, 02/08, 08/08, 09/08).
     * Helena só retorna em 15/08 (sábado seguinte com dia útil intermediário em 10/08).
     *
     * Posicionamento esperado: como ela "pula" 4 datas hipotéticas × 2 vagas/dia = 8 vagas
     * antes de retornar, deve aparecer na posição 9 (índice 8) da fila persistida — ou seja,
     * exatamente onde plantonia em 15/08 v0. Antes desta correção ela era empurrada para o
     * fim da fila (idx 15) por `moverUsuarioDepoisDaCobertura`, e a escala de agosto a
     * realocava em 23/08 em vez de 15/08.
     */
    const TEC = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const helenaId = TEC[14];
    const plantoesTec = plantoesTecGravados(DATAS_JUN_JUL_VET, TEC);
    const afHelena = {
      id: 1,
      usuarioId: helenaId,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-07-24',
      dataFim: '2026-08-07',
    };

    const r = recalcularEscalaCompletaNucleo({
      ordemInicialTec: TEC,
      ordemMembrosTec: TEC,
      plantoesGravados: plantoesTec,
      afastamentos: [afHelena],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });

    expect(r.ordemFinalTec.indexOf(helenaId)).toBe(8);
  });

  test('retorno pós-escala: ordem persistida em julho permite que escala de agosto coloque Helena em 15/08', () => {
    /**
     * Garantia de que o posicionamento na fila final (problema 1) corrige automaticamente o
     * cenário em que, ao criar a escala de agosto, Helena devia ser alocada em 15/08 (1ª
     * data com dia útil intermediário pós-fim) e não em 23/08. O simulador da escala
     * seguinte usa `ordemFinalTec` de julho como ordem inicial; com Helena já posicionada
     * em idx 8, o retorno forçado em 15/08 a coloca em v0 dessa data.
     */
    const TEC = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const helenaId = TEC[14];
    const plantoesTecJul = plantoesTecGravados(DATAS_JUN_JUL_VET, TEC);
    const afHelena = {
      id: 1,
      usuarioId: helenaId,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-07-24',
      dataFim: '2026-08-07',
    };
    const rJul = recalcularEscalaCompletaNucleo({
      ordemInicialTec: TEC,
      ordemMembrosTec: TEC,
      plantoesGravados: plantoesTecJul,
      afastamentos: [afHelena],
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });

    const datasAgo = [
      '2026-08-01', '2026-08-02', '2026-08-08', '2026-08-09',
      '2026-08-15', '2026-08-16', '2026-08-22', '2026-08-23',
      '2026-08-29', '2026-08-30',
    ];
    const sim = simularRodizioTecPlantoes(rJul.ordemFinalTec, datasAgo, [afHelena], new Set());
    const aloc15v0 = sim.alocacoes.find((a) => a.dataIso === '2026-08-15' && a.vagaIndice === 0);
    const aloc23v0 = sim.alocacoes.find((a) => a.dataIso === '2026-08-23' && a.vagaIndice === 0);
    expect(aloc15v0?.usuarioId).toBe(helenaId);
    expect(aloc23v0?.usuarioId).not.toBe(helenaId);
  });

  test('alinhamento com `simularRodizioVetPlantoes`: mesmo input, mesma alocação', () => {
    const afastamentos = [
      { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
      { id: 2, usuarioId: D, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      { id: 3, usuarioId: G, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-17', dataFim: '2026-06-24' },
    ];
    const plantoes = plantoesVetGravados(DATAS_JUN_JUL_VET);
    const r = recalcularEscalaCompletaNucleo({
      ordemInicialVet: ORDEM_VET,
      ordemMembrosVet: ORDEM_VET,
      plantoesGravados: plantoes,
      afastamentos,
      periodicidadeEscala: 'fim_de_semana',
      dataCongelamentoIso: '2026-01-01',
    });
    const direto = simularRodizioVetPlantoes(ORDEM_VET, DATAS_JUN_JUL_VET, afastamentos, new Set());
    expect(r.alocacoesVet).toEqual(direto.alocacoes);
    expect(r.ordemFinalVet).toEqual(direto.ordemPersistida);
  });
});
