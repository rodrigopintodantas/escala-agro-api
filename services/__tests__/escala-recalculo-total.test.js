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
