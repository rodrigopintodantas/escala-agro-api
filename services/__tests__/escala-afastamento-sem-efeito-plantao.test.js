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
const ORDEM = [A, B, C, D, E, F, G, H];

const DATAS_JUN = [
  '2026-06-06',
  '2026-06-07',
  '2026-06-13',
  '2026-06-14',
  '2026-06-20',
  '2026-06-21',
  '2026-06-27',
  '2026-06-28',
];

describe('Férias/abono sem efeito nos plantões do titular', () => {
  const {
    simularRodizioVetPlantoes,
    simularRodizioTecPlantoes,
    filtrarAfastamentosFeriasAbonoSemEfeitoEmPlantoes,
    afastamentosEfetivosRodizioEscala,
    afastamentosParaSimulacaoPlenaCategoria,
    sincronizarCalendarioRodizioPlenoEscalaBimestre,
    afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario,
    afastamentoFeriasOuAbonoEntraNoRodizio,
    abonoMudaAlgumPlantaoDoRodizio,
    montarParametrosFiltroAfastamentoPlantoes,
    classificarRelevanciaAfastamentoEscalaAtiva,
    afastamentoFeriasOuAbonoRelevanteNoRodizio,
    afastamentoFeriasOuAbonoRedundanteNoCalendario,
    afastamentoFeriasOuAbonoContribuiParaCalendarioGravado,
    afastamentoFeriasOuAbonoTitularEscaladoNoPeriodoSemAfastamento,
    afastamentoFeriasOuAbonoRelevanteParaTagEscala,
    afastamentoFeriasOuAbonoContribuiCalendarioNoPeriodoRetro,
    afastamentoFeriasOuAbonoNaoAlteraRodizioComVsSem,
    afastamentoFeriasOuAbonoTitularPerdeAlgumPlantao,
    afastamentosListaParaRodizioEscala,
  } = EscalaService.__testables;

  const ORDEM_VET = [101, 102, 103, 104, 105, 106, 107, 108];
  const LETRA_VET = { 101: 'A', 102: 'B', 103: 'C', 104: 'D', 105: 'E', 106: 'F', 107: 'G', 108: 'H' };
  const DATAS_JUN_VET = [
    '2026-06-06',
    '2026-06-07',
    '2026-06-13',
    '2026-06-14',
    '2026-06-20',
    '2026-06-21',
    '2026-06-27',
    '2026-06-28',
  ];

  const plantoesVet = DATAS_JUN.map((dataReferencia) => ({
    dataReferencia,
    categoriaPlantao: 'veterinario',
  }));
  const categoriaPorUsuarioId = new Map(ORDEM.map((id) => [id, 'veterinario']));

  function plantoesGravadosVet(ordem, datas, afsRodizio = []) {
    const { alocacoes } = simularRodizioVetPlantoes(ordem, datas, afsRodizio, new Set());
    return alocacoes.map((a) => ({
      dataReferencia: a.dataIso,
      categoriaPlantao: 'veterinario',
      usuarioId: a.usuarioId,
    }));
  }

  function plantoesGravadosTec(ordem, datas, afsRodizio = []) {
    const { alocacoes } = simularRodizioTecPlantoes(ordem, datas, afsRodizio, new Set());
    return alocacoes.map((a) => ({
      dataReferencia: a.dataIso,
      categoriaPlantao: 'tecnico',
      usuarioId: a.usuarioId,
      vagaIndice: a.vagaIndice,
    }));
  }

  function params(afs, { ordem = ORDEM, datas = DATAS_JUN, plantoes = plantoesVet } = {}) {
    return montarParametrosFiltroAfastamentoPlantoes({
      plantoes,
      ordemVetInicial: ordem,
      ordemTecInicial: [],
      afastamentosLista: afs,
      periodicidadeEscala: 'fim_de_semana',
      categoriaPorUsuarioId,
    });
  }

  test('férias de Ana só em dias sem plantão dela na escala são ignoradas no rodízio', () => {
    const afs = [
      { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-05-01', dataFim: '2026-05-31' },
    ];
    const p = params(afs);
    expect(afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario(afs[0], p)).toBe(false);
    expect(filtrarAfastamentosFeriasAbonoSemEfeitoEmPlantoes(afs, p)).toHaveLength(0);
    const efetivos = afastamentosEfetivosRodizioEscala(afs, p);
    expect(efetivos).toHaveLength(0);
    const { alocacoes } = simularRodizioVetPlantoes(ORDEM, DATAS_JUN, [], new Set());
    const comEfetivos = simularRodizioVetPlantoes(ORDEM, DATAS_JUN, efetivos, new Set());
    expect(comEfetivos.alocacoes.map((a) => a.usuarioId)).toEqual(alocacoes.map((a) => a.usuarioId));
  });

  test('abono Ana 14/06 (sem plantão dela) em escala jun–jul: irrelevante', () => {
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
    const afs = [{ id: 98, usuarioId: A, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-14', dataFim: '2026-06-14' }];
    const plantoes = plantoesGravadosVet(ORDEM, DATAS_JUN_JUL, []);
    const p = params(afs, { datas: DATAS_JUN_JUL, plantoes });
    expect(afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario(afs[0], p)).toBe(false);
    expect(filtrarAfastamentosFeriasAbonoSemEfeitoEmPlantoes(afs, p)).toHaveLength(0);
    expect(afastamentosEfetivosRodizioEscala(afs, p)).toHaveLength(0);
  });

  test('abono Ana 17/07 após Ana+Daniel+Gabriela: tag irrelevante', () => {
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
    const afAna = { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' };
    const afDaniel = { id: 2, usuarioId: D, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' };
    const afGabriela = {
      id: 3,
      usuarioId: G,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-17',
      dataFim: '2026-06-24',
    };
    const afAnaJul = { id: 4, usuarioId: A, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' };
    const brutosAnteriores = [afAna, afDaniel, afGabriela];
    const plantoes = plantoesGravadosVet(ORDEM, DATAS_JUN_JUL, brutosAnteriores);
    const brutos = [...brutosAnteriores, afAnaJul];
    const p = params(brutos, { datas: DATAS_JUN_JUL, plantoes });
    const ctx = { dataInicioStr: '2026-06-01', dataFimStr: '2026-07-31', paramsFiltro: p };
    expect(afastamentoFeriasOuAbonoNaoAlteraRodizioComVsSem(afAnaJul, p)).toBe(true);
    expect(afastamentoFeriasOuAbonoContribuiCalendarioNoPeriodoRetro(afAnaJul, p, ctx.dataFimStr)).toBe(false);
    expect(classificarRelevanciaAfastamentoEscalaAtiva(afAnaJul, ctx)).toBe('irrelevante');
  });

  test('abono Ana 17/07 (plantão só 25/07): tag irrelevante com escala já ajustada', () => {
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
    const afAna = { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' };
    const afDaniel = { id: 2, usuarioId: D, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' };
    const afGabriela = {
      id: 3,
      usuarioId: G,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-17',
      dataFim: '2026-06-24',
    };
    const afAnaJul = { id: 100, usuarioId: A, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' };
    const plantoes = plantoesGravadosVet(ORDEM, DATAS_JUN_JUL, [afAna, afDaniel, afGabriela]);
    const p = params([afAna, afDaniel, afGabriela, afAnaJul], { datas: DATAS_JUN_JUL, plantoes });
    const ctx = { dataInicioStr: '2026-06-01', dataFimStr: '2026-07-31', paramsFiltro: p };
    expect(afastamentoFeriasOuAbonoNaoAlteraRodizioComVsSem(afAnaJul, p)).toBe(true);
    expect(classificarRelevanciaAfastamentoEscalaAtiva(afAnaJul, ctx)).toBe('irrelevante');
  });

  test('abono Diego 17/06 com plantões gravados com vagaIndice=0 (igual produção): tag irrelevante', () => {
    /**
     * Reproduz a chave de produção: o banco grava `vaga_indice = 0` (default do modelo) em todo
     * plantão veterinário. Sem normalizar a chave em ambos os mapas, `sem.get(...)` retornaria
     * undefined em produção e a tag virava "Relevante" indevidamente.
     */
    const afAna = { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' };
    const afDiego = { id: 2, usuarioId: D, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-17', dataFim: '2026-06-17' };
    const plantoesSemVaga = plantoesGravadosVet(ORDEM, DATAS_JUN, [afAna]);
    const plantoesComVaga = plantoesSemVaga.map((p) => ({ ...p, vagaIndice: 0 }));
    const p = params([afAna, afDiego], { datas: DATAS_JUN, plantoes: plantoesComVaga });
    const ctx = { dataInicioStr: '2026-06-01', dataFimStr: '2026-06-30', paramsFiltro: p };
    expect(afastamentoFeriasOuAbonoContribuiCalendarioNoPeriodoRetro(afDiego, p, ctx.dataFimStr)).toBe(false);
    expect(classificarRelevanciaAfastamentoEscalaAtiva(afDiego, ctx)).toBe('irrelevante');
  });

  test('abono Diego 17/06 após férias Ana (Diego em 13/06): tag irrelevante (escala jun-jul)', () => {
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
    const afAna = { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' };
    /** Abono em qua, Diego (D=104) escalado 13/06 (sáb) com retro-cadastro liberado por dia útil intermediário. */
    const afDiego = { id: 2, usuarioId: D, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-17', dataFim: '2026-06-17' };
    const plantoes = plantoesGravadosVet(ORDEM, DATAS_JUN_JUL, [afAna]);
    const p = params([afAna, afDiego], { datas: DATAS_JUN_JUL, plantoes });
    const ctx = { dataInicioStr: '2026-06-01', dataFimStr: '2026-07-31', paramsFiltro: p };
    expect(afastamentosListaParaRodizioEscala([afAna, afDiego], p).map((a) => a.id)).toEqual([1]);
    expect(classificarRelevanciaAfastamentoEscalaAtiva(afDiego, ctx)).toBe('irrelevante');
  });

  test('abono Ana 15/07 (dia útil, sem plantão dela) não entra no rodízio nem move outros plantões', () => {
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
    const afAna = { id: 1, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' };
    const afDaniel = { id: 2, usuarioId: D, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' };
    const afGabriela = {
      id: 3,
      usuarioId: G,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-17',
      dataFim: '2026-06-24',
    };
    /** Abono em quarta-feira, fora do plantão dela em 25/07. Não pode forçar retorno fictício em 18/07. */
    const afAnaJul = { id: 200, usuarioId: A, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-15', dataFim: '2026-07-15' };
    const brutosAnteriores = [afAna, afDaniel, afGabriela];
    const plantoes = plantoesGravadosVet(ORDEM, DATAS_JUN_JUL, brutosAnteriores);
    const brutos = [...brutosAnteriores, afAnaJul];
    const p = params(brutos, { datas: DATAS_JUN_JUL, plantoes });
    const ctx = { dataInicioStr: '2026-06-01', dataFimStr: '2026-07-31', paramsFiltro: p };

    expect(afastamentoFeriasOuAbonoTitularEscaladoNoPeriodoSemAfastamento(afAnaJul, p)).toBe(false);
    expect(afastamentosListaParaRodizioEscala(brutos, p).map((a) => a.id)).toEqual(
      brutosAnteriores.map((a) => a.id),
    );
    expect(classificarRelevanciaAfastamentoEscalaAtiva(afAnaJul, ctx)).toBe('irrelevante');

    const semNovo = simularRodizioVetPlantoes(ORDEM, DATAS_JUN_JUL, brutosAnteriores, new Set());
    const comNovo = simularRodizioVetPlantoes(ORDEM, DATAS_JUN_JUL, brutos, new Set());
    /**
     * O motor agora também ignora afastamentos sem efeito em plantão (não bloqueia nenhuma
     * data útil de plantão), então o calendário produzido com ou sem `afAnaJul` é idêntico —
     * defesa em profundidade contra contaminação do rodízio por afastamentos irrelevantes.
     */
    expect(comNovo.alocacoes.map((a) => a.usuarioId)).toEqual(
      semNovo.alocacoes.map((a) => a.usuarioId),
    );

    const afastamentosFiltrados = afastamentosListaParaRodizioEscala(brutos, p);
    const comFiltrado = simularRodizioVetPlantoes(
      ORDEM,
      DATAS_JUN_JUL,
      afastamentosFiltrados,
      new Set(),
    );
    /** Após o filtro, o calendário continua idêntico ao gravado (sem o abono neutro). */
    expect(comFiltrado.alocacoes.map((a) => a.usuarioId)).toEqual(
      semNovo.alocacoes.map((a) => a.usuarioId),
    );
  });

  test('abono Ana 17/06 (dia sem plantão) em escala jun–jul alfabética: irrelevante', () => {
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
    const afs = [{ id: 99, usuarioId: A, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-17', dataFim: '2026-06-17' }];
    const plantoes = plantoesGravadosVet(ORDEM, DATAS_JUN_JUL, []);
    const p = params(afs, { datas: DATAS_JUN_JUL, plantoes });
    expect(afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario(afs[0], p)).toBe(false);
    expect(filtrarAfastamentosFeriasAbonoSemEfeitoEmPlantoes(afs, p)).toHaveLength(0);
  });

  test('férias de Ana em junho alteram plantões e permanecem no filtro', () => {
    const afs = [
      { id: 2, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
    ];
    const p = params(afs);
    expect(afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario(afs[0], p)).toBe(true);
    expect(filtrarAfastamentosFeriasAbonoSemEfeitoEmPlantoes(afs, p)).toHaveLength(1);
  });

  test('férias Ana 05–19 com calendário gravado (plantão 06/06): relevante', () => {
    const afs = [
      { id: 2, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
    ];
    const plantoes = plantoesGravadosVet(ORDEM, DATAS_JUN, []);
    const p = params(afs, { plantoes });
    expect(afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario(afs[0], p)).toBe(true);
    expect(filtrarAfastamentosFeriasAbonoSemEfeitoEmPlantoes(afs, p)).toHaveLength(1);
  });

  test('férias Ana 08–19: tag relevante (plantão 06/06 na janela retroativa)', () => {
    const afs = [
      { id: 2, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-08', dataFim: '2026-06-19' },
    ];
    const plantoes = plantoesGravadosVet(ORDEM, DATAS_JUN, afs);
    const p = params(afs, { plantoes });
    const ctx = { dataInicioStr: '2026-06-01', dataFimStr: '2026-06-30', paramsFiltro: p };
    expect(afastamentoFeriasOuAbonoRelevanteParaTagEscala(afs[0], p)).toBe(true);
    expect(classificarRelevanciaAfastamentoEscalaAtiva(afs[0], ctx)).toBe('relevante');
  });

  test('abono Daniel 12/06 após Ana: tag relevante (efeito no plantão 13/06)', () => {
    const { simularRodizioVetPlantoes, sincronizarCalendarioRodizioPlenoEscalaBimestre } =
      EscalaService.__testables;
    const afAna = {
      id: 1,
      usuarioId: A,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-05',
      dataFim: '2026-06-19',
    };
    const afDaniel = {
      id: 2,
      usuarioId: D,
      tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-12',
      dataFim: '2026-06-12',
    };
    const gravadosSoAna = simularRodizioVetPlantoes(ORDEM, DATAS_JUN, [afAna], new Set()).alocacoes.map((a) => ({
      dataReferencia: a.dataIso,
      categoriaPlantao: 'veterinario',
      usuarioId: a.usuarioId,
    }));
    const brutos = [afAna, afDaniel];
    const p = params(brutos, { plantoes: gravadosSoAna });
    const efetivos = afastamentosEfetivosRodizioEscala(brutos, p);
    const afPleno = afastamentosParaSimulacaoPlenaCategoria(brutos, efetivos, p, 'veterinario');
    const plantoesDb = gravadosSoAna.map((row, i) => ({ ...row, id: i + 1 }));
    sincronizarCalendarioRodizioPlenoEscalaBimestre({
      plantoes: plantoesDb,
      ordemVetInicial: ORDEM,
      ordemTecInicial: [],
      afastamentosFlat: afPleno,
      datasNaoUteisIsoSet: p.datasNaoUteisIsoSet,
      categoriaPorUsuarioId: p.categoriaPorUsuarioId,
      sincronizarVet: true,
      sincronizarTec: false,
    });
    const pComCal = params(brutos, {
      plantoes: plantoesDb.map((row) => ({
        dataReferencia: row.dataReferencia,
        categoriaPlantao: 'veterinario',
        usuarioId: row.usuarioId,
      })),
    });
    const ctx = { dataInicioStr: '2026-06-01', dataFimStr: '2026-06-30', paramsFiltro: pComCal };
    expect(afastamentoFeriasOuAbonoContribuiCalendarioNoPeriodoRetro(afDaniel, pComCal, ctx.dataFimStr)).toBe(
      true,
    );
    expect(classificarRelevanciaAfastamentoEscalaAtiva(afDaniel, ctx)).toBe('relevante');
  });

  test('férias Ana: tag relevante quando calendário já reflete o afastamento', () => {
    const afs = [
      { id: 2, usuarioId: A, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
    ];
    const plantoes = plantoesGravadosVet(ORDEM, DATAS_JUN, afs);
    const p = params(afs, { plantoes });
    const ctx = { dataInicioStr: '2026-06-01', dataFimStr: '2026-06-30', paramsFiltro: p };
    expect(afastamentoFeriasOuAbonoRelevanteParaTagEscala(afs[0], p, ctx.dataFimStr)).toBe(true);
    expect(afastamentoFeriasOuAbonoContribuiCalendarioNoPeriodoRetro(afs[0], p, ctx.dataFimStr)).toBe(true);
    expect(classificarRelevanciaAfastamentoEscalaAtiva(afs[0], ctx)).toBe('relevante');
  });

  test('abono Diego permanece no rodízio após férias Fernanda (14/06 sem Diego)', () => {
    const TEC = {
      alvaro: 1,
      diego: 8,
      fernanda: 11,
      amanda: 2,
      bernardo: 3,
      bianca: 4,
      camila: 5,
      carlos: 6,
      denise: 7,
      eduardo: 9,
      elisa: 10,
      fabio: 12,
      gabriela: 13,
      gustavo: 14,
      helena: 15,
      hugo: 16,
    };
    const ORDEM_TEC = Object.values(TEC);
    const DATAS_JUN = [
      '2026-06-06',
      '2026-06-07',
      '2026-06-13',
      '2026-06-14',
      '2026-06-20',
      '2026-06-21',
      '2026-06-27',
      '2026-06-28',
    ];
    const afAlvaro = {
      id: 1,
      usuarioId: TEC.alvaro,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-05',
      dataFim: '2026-06-19',
    };
    const afDiego = {
      id: 2,
      usuarioId: TEC.diego,
      tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-12',
      dataFim: '2026-06-12',
    };
    const afFernanda = {
      id: 3,
      usuarioId: TEC.fernanda,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-17',
      dataFim: '2026-06-24',
    };
    const brutos = [afAlvaro, afDiego, afFernanda];
    const { simularRodizioTecPlantoes, sincronizarCalendarioRodizioPlenoEscalaBimestre } =
      EscalaService.__testables;
    const plantoesGravados = simularRodizioTecPlantoes(ORDEM_TEC, DATAS_JUN, [afAlvaro, afDiego]).alocacoes.map(
      (a) => ({
        dataReferencia: a.dataIso,
        categoriaPlantao: 'tecnico',
        usuarioId: a.usuarioId,
        vagaIndice: a.vagaIndice,
      }),
    );
    const cat = new Map(ORDEM_TEC.map((id) => [id, 'tecnico']));
    const p = montarParametrosFiltroAfastamentoPlantoes({
      plantoes: plantoesGravados,
      ordemVetInicial: [],
      ordemTecInicial: ORDEM_TEC,
      afastamentosLista: brutos,
      periodicidadeEscala: 'fim_de_semana',
      categoriaPorUsuarioId: cat,
    });
    expect(afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario(afDiego, p)).toBe(true);
    const efetivos = afastamentosEfetivosRodizioEscala(brutos, p);
    expect(efetivos.some((a) => Number(a.id) === 2)).toBe(true);
    const afPleno = afastamentosParaSimulacaoPlenaCategoria(brutos, efetivos, p, 'tecnico');
    const pleno = simularRodizioTecPlantoes(ORDEM_TEC, DATAS_JUN, afPleno, p.datasNaoUteisIsoSet);
    const ids14 = pleno.alocacoes.filter((a) => a.dataIso === '2026-06-14').map((a) => a.usuarioId);
    expect(ids14).not.toContain(TEC.diego);
    const plantoesDb = plantoesGravados.map((row, i) => ({ ...row, id: i + 1 }));
    sincronizarCalendarioRodizioPlenoEscalaBimestre({
      plantoes: plantoesDb,
      ordemVetInicial: [],
      ordemTecInicial: ORDEM_TEC,
      afastamentosFlat: afPleno.map((a) => (a.get ? a.get({ plain: true }) : a)),
      datasNaoUteisIsoSet: p.datasNaoUteisIsoSet,
      categoriaPorUsuarioId: cat,
      sincronizarVet: false,
      sincronizarTec: true,
    });
    const ids14Db = plantoesDb.filter((pl) => pl.dataReferencia === '2026-06-14').map((pl) => pl.usuarioId);
    expect(ids14Db).not.toContain(TEC.diego);
  });

  test('férias Álvaro permanecem relevantes mesmo com abono Diego na escala (não excluir do rodízio)', () => {
    const TEC = {
      alvaro: 1,
      diego: 8,
      amanda: 2,
      bernardo: 3,
      bianca: 4,
      camila: 5,
      carlos: 6,
      denise: 7,
      eduardo: 9,
      elisa: 10,
      fernanda: 11,
      fabio: 12,
      gabriela: 13,
      gustavo: 14,
      helena: 15,
      hugo: 16,
    };
    const ORDEM_TEC = Object.values(TEC);
    const DATAS_JUN = [
      '2026-06-06',
      '2026-06-07',
      '2026-06-13',
      '2026-06-14',
      '2026-06-20',
      '2026-06-21',
      '2026-06-27',
      '2026-06-28',
    ];
    const afAlvaro = {
      id: 1,
      usuarioId: TEC.alvaro,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-05',
      dataFim: '2026-06-19',
    };
    const afDiego = {
      id: 2,
      usuarioId: TEC.diego,
      tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-12',
      dataFim: '2026-06-12',
    };
    const plantoesGravados = simularRodizioTecPlantoes(ORDEM_TEC, DATAS_JUN, [afAlvaro]).alocacoes.map(
      (a) => ({
        dataReferencia: a.dataIso,
        categoriaPlantao: 'tecnico',
        usuarioId: a.usuarioId,
        vagaIndice: a.vagaIndice,
      }),
    );
    const cat = new Map(ORDEM_TEC.map((id) => [id, 'tecnico']));
    const p = montarParametrosFiltroAfastamentoPlantoes({
      plantoes: plantoesGravados,
      ordemVetInicial: [],
      ordemTecInicial: ORDEM_TEC,
      afastamentosLista: [afAlvaro, afDiego],
      periodicidadeEscala: 'fim_de_semana',
      categoriaPorUsuarioId: cat,
    });
    expect(afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario(afAlvaro, p)).toBe(true);
    const efetivos = afastamentosEfetivosRodizioEscala([afAlvaro, afDiego], p);
    expect(efetivos.some((a) => Number(a.id) === 1)).toBe(true);
    expect(efetivos.some((a) => Number(a.id) === 2)).toBe(false);
  });

  test('férias Álvaro permanecem no filtro com calendário já sem ele em 06/06 (antes do abono Diego)', () => {
    const TEC = {
      alvaro: 1,
      diego: 8,
      amanda: 2,
      bernardo: 3,
      bianca: 4,
      camila: 5,
      carlos: 6,
      denise: 7,
      eduardo: 9,
      elisa: 10,
      fernanda: 11,
      fabio: 12,
      gabriela: 13,
      gustavo: 14,
      helena: 15,
      hugo: 16,
    };
    const ORDEM_TEC = Object.values(TEC);
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
    const afAlvaro = {
      id: 1,
      usuarioId: TEC.alvaro,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-05',
      dataFim: '2026-06-19',
    };
    const afDiego = {
      id: 2,
      usuarioId: TEC.diego,
      tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-12',
      dataFim: '2026-06-12',
    };
    const afsBrutos = [afAlvaro, afDiego];
    const plantoesGravados = simularRodizioTecPlantoes(ORDEM_TEC, DATAS_JUN_JUL, [afAlvaro]).alocacoes.map(
      (a) => ({
        dataReferencia: a.dataIso,
        categoriaPlantao: 'tecnico',
        usuarioId: a.usuarioId,
        vagaIndice: a.vagaIndice,
      }),
    );
    const cat = new Map(ORDEM_TEC.map((id) => [id, 'tecnico']));
    const p = montarParametrosFiltroAfastamentoPlantoes({
      plantoes: plantoesGravados,
      ordemVetInicial: [],
      ordemTecInicial: ORDEM_TEC,
      afastamentosLista: afsBrutos,
      periodicidadeEscala: 'fim_de_semana',
      categoriaPorUsuarioId: cat,
    });
    expect(afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario(afAlvaro, p)).toBe(true);
    const efetivos = afastamentosEfetivosRodizioEscala(afsBrutos, p);
    expect(efetivos.some((a) => Number(a.id) === 1)).toBe(true);
    expect(efetivos.some((a) => Number(a.id) === 2)).toBe(false);

    const { sincronizarCalendarioRodizioPlenoEscalaBimestre } = EscalaService.__testables;
    const plantoesDb = plantoesGravados.map((row, i) => ({ ...row, id: i + 1 }));
    plantoesDb
      .filter((pl) => pl.dataReferencia === '2026-06-06')
      .forEach((pl) => {
        pl.usuarioId = TEC.alvaro;
      });
    const afListPleno = efetivos.map((a) => (a.get ? a.get({ plain: true }) : a));
    sincronizarCalendarioRodizioPlenoEscalaBimestre({
      plantoes: plantoesDb,
      ordemVetInicial: [],
      ordemTecInicial: ORDEM_TEC,
      afastamentosFlat: afListPleno,
      datasNaoUteisIsoSet: p.datasNaoUteisIsoSet,
    });
    const dia06 = plantoesDb.filter((pl) => pl.dataReferencia === '2026-06-06');
    for (const pl of dia06) {
      expect(Number(pl.usuarioId)).not.toBe(TEC.alvaro);
    }
  });

  test('vet: 2º afastamento abono Daniel 12/06 após só Ana — corrige 13/06 (sem Daniel)', () => {
    const { simularRodizioVetPlantoes, sincronizarCalendarioRodizioPlenoEscalaBimestre } =
      EscalaService.__testables;
    const afAna = {
      id: 1,
      usuarioId: 101,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-05',
      dataFim: '2026-06-19',
    };
    const afDaniel = {
      id: 2,
      usuarioId: 104,
      tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-12',
      dataFim: '2026-06-12',
    };
    const gravadosSoAna = simularRodizioVetPlantoes(ORDEM_VET, DATAS_JUN_VET, [afAna], new Set()).alocacoes.map(
      (a) => ({
        dataReferencia: a.dataIso,
        categoriaPlantao: 'veterinario',
        usuarioId: a.usuarioId,
      }),
    );
    const cat = new Map(ORDEM_VET.map((id) => [id, 'veterinario']));
    const brutos = [afAna, afDaniel];
    const p = montarParametrosFiltroAfastamentoPlantoes({
      plantoes: gravadosSoAna,
      ordemVetInicial: ORDEM_VET,
      ordemTecInicial: [],
      afastamentosLista: brutos,
      periodicidadeEscala: 'fim_de_semana',
      categoriaPorUsuarioId: cat,
    });
    expect(abonoMudaAlgumPlantaoDoRodizio(afDaniel, p)).toBe(true);
    const efetivos = afastamentosEfetivosRodizioEscala(brutos, p);
    expect(efetivos.some((a) => Number(a.id) === 2)).toBe(true);
    const afPleno = afastamentosParaSimulacaoPlenaCategoria(brutos, efetivos, p, 'veterinario');
    const plantoesDb = gravadosSoAna.map((row, i) => ({ ...row, id: i + 1 }));
    sincronizarCalendarioRodizioPlenoEscalaBimestre({
      plantoes: plantoesDb,
      ordemVetInicial: ORDEM_VET,
      ordemTecInicial: [],
      afastamentosFlat: afPleno.map((a) => (a.get ? a.get({ plain: true }) : a)),
      datasNaoUteisIsoSet: p.datasNaoUteisIsoSet,
      categoriaPorUsuarioId: cat,
      sincronizarVet: true,
      sincronizarTec: false,
    });
    const uid13 = plantoesDb.find((pl) => pl.dataReferencia === '2026-06-13').usuarioId;
    expect(uid13).not.toBe(104);
    expect(LETRA_VET[uid13]).toBe('E');
    const seq = DATAS_JUN_VET.map(
      (d) => LETRA_VET[plantoesDb.find((pl) => pl.dataReferencia === d).usuarioId],
    ).join('');
    expect(seq).toBe('BCEFDGAH');
  });

  test('vet: férias Gabriela 17–24 após Ana+Daniel mantém BCEFDHAG (13/06 não é Daniel)', () => {
    const { simularRodizioVetPlantoes, sincronizarCalendarioRodizioPlenoEscalaBimestre } =
      EscalaService.__testables;
    const afAna = {
      id: 1,
      usuarioId: 101,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-05',
      dataFim: '2026-06-19',
    };
    const afDaniel = {
      id: 2,
      usuarioId: 104,
      tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-12',
      dataFim: '2026-06-12',
    };
    const afGabriela = {
      id: 3,
      usuarioId: 107,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-17',
      dataFim: '2026-06-24',
    };
    const brutos = [afAna, afDaniel, afGabriela];
    const gravados = simularRodizioVetPlantoes(ORDEM_VET, DATAS_JUN_VET, [afAna, afDaniel]).alocacoes.map(
      (a) => ({
        dataReferencia: a.dataIso,
        categoriaPlantao: 'veterinario',
        usuarioId: a.usuarioId,
      }),
    );
    const cat = new Map(ORDEM_VET.map((id) => [id, 'veterinario']));
    const p = montarParametrosFiltroAfastamentoPlantoes({
      plantoes: gravados,
      ordemVetInicial: ORDEM_VET,
      ordemTecInicial: [],
      afastamentosLista: brutos,
      periodicidadeEscala: 'fim_de_semana',
      categoriaPorUsuarioId: cat,
    });
    expect(afastamentoFeriasOuAbonoEntraNoRodizio(afDaniel, p)).toBe(true);
    const efetivos = afastamentosEfetivosRodizioEscala(brutos, p);
    expect(efetivos.some((a) => Number(a.id) === 2)).toBe(true);
    const afPleno = afastamentosParaSimulacaoPlenaCategoria(brutos, efetivos, p, 'veterinario');
    expect(afPleno.some((a) => Number(a.id) === 2)).toBe(true);
    const seq = (lista) =>
      DATAS_JUN_VET.map(
        (d) => LETRA_VET[simularRodizioVetPlantoes(ORDEM_VET, DATAS_JUN_VET, lista, p.datasNaoUteisIsoSet).alocacoes.find((a) => a.dataIso === d).usuarioId],
      ).join('');
    expect(seq(afPleno)).toBe('BCEFDHAG');
    const plantoesDb = gravados.map((row, i) => ({ ...row, id: i + 1 }));
    plantoesDb.find((pl) => pl.dataReferencia === '2026-06-13').usuarioId = 104;
    sincronizarCalendarioRodizioPlenoEscalaBimestre({
      plantoes: plantoesDb,
      ordemVetInicial: ORDEM_VET,
      ordemTecInicial: [],
      afastamentosFlat: afPleno.map((a) => (a.get ? a.get({ plain: true }) : a)),
      datasNaoUteisIsoSet: p.datasNaoUteisIsoSet,
      categoriaPorUsuarioId: cat,
      sincronizarVet: true,
      sincronizarTec: false,
    });
    expect(LETRA_VET[plantoesDb.find((pl) => pl.dataReferencia === '2026-06-13').usuarioId]).toBe('E');
    expect(LETRA_VET[plantoesDb.find((pl) => pl.dataReferencia === '2026-06-20').usuarioId]).toBe('D');
  });

  test('vet: abono Gabriela 13/07 após jun+jul corretos não entra no rodízio nem na plena', () => {
    const DATAS_JUL_VET = [
      '2026-07-04',
      '2026-07-05',
      '2026-07-11',
      '2026-07-12',
      '2026-07-18',
      '2026-07-19',
      '2026-07-25',
      '2026-07-26',
    ];
    const { simularRodizioVetPlantoes } = EscalaService.__testables;
    const afAna = {
      id: 1,
      usuarioId: 101,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-05',
      dataFim: '2026-06-19',
    };
    const afDaniel = {
      id: 2,
      usuarioId: 104,
      tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-12',
      dataFim: '2026-06-12',
    };
    const afGabFerias = {
      id: 3,
      usuarioId: 107,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-17',
      dataFim: '2026-06-24',
    };
    const afFelipe = {
      id: 4,
      usuarioId: 105,
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-07-10',
      dataFim: '2026-07-17',
    };
    const afGabAbonoJul = {
      id: 5,
      usuarioId: 107,
      tipo: { tipo: 'Abono' },
      dataInicio: '2026-07-13',
      dataFim: '2026-07-13',
    };
    const semAbonoJul = [afAna, afDaniel, afGabFerias, afFelipe];
    const comAbonoJul = [...semAbonoJul, afGabAbonoJul];
    const todasDatas = [...DATAS_JUN_VET, ...DATAS_JUL_VET];
    const gravados = simularRodizioVetPlantoes(ORDEM_VET, todasDatas, semAbonoJul, new Set()).alocacoes.map(
      (a) => ({
        dataReferencia: a.dataIso,
        categoriaPlantao: 'veterinario',
        usuarioId: a.usuarioId,
      }),
    );
    const cat = new Map(ORDEM_VET.map((id) => [id, 'veterinario']));
    const p = montarParametrosFiltroAfastamentoPlantoes({
      plantoes: gravados,
      ordemVetInicial: ORDEM_VET,
      ordemTecInicial: [],
      afastamentosLista: comAbonoJul,
      periodicidadeEscala: 'fim_de_semana',
      categoriaPorUsuarioId: cat,
    });
    expect(afastamentoFeriasOuAbonoEntraNoRodizio(afGabAbonoJul, p)).toBe(false);
    expect(filtrarAfastamentosFeriasAbonoSemEfeitoEmPlantoes(comAbonoJul, p)).toHaveLength(4);
    const efetivos = afastamentosEfetivosRodizioEscala(comAbonoJul, p);
    expect(efetivos.some((a) => Number(a.id) === 5)).toBe(false);
    const afPleno = afastamentosParaSimulacaoPlenaCategoria(comAbonoJul, efetivos, p, 'veterinario');
    expect(afPleno.some((a) => Number(a.id) === 5)).toBe(false);
    const letra = (lista, ds) =>
      LETRA_VET[simularRodizioVetPlantoes(ORDEM_VET, todasDatas, lista, p.datasNaoUteisIsoSet).alocacoes.find((a) => a.dataIso === ds).usuarioId];
    const julSeqSem = DATAS_JUL_VET.map((d) => letra(semAbonoJul, d)).join('');
    const julSeqCom = DATAS_JUL_VET.map((d) => letra(comAbonoJul, d)).join('');
    expect(julSeqCom).not.toBe(julSeqSem);
    const julGravado = DATAS_JUL_VET.map(
      (d) => LETRA_VET[gravados.find((pl) => pl.dataReferencia === d).usuarioId],
    ).join('');
    expect(julGravado).toBe(julSeqSem);
    const plantoesDb = gravados.map((row, i) => ({ ...row, id: i + 1 }));
    const antes = plantoesDb.map((pl) => ({ ...pl }));
    sincronizarCalendarioRodizioPlenoEscalaBimestre({
      plantoes: plantoesDb,
      ordemVetInicial: ORDEM_VET,
      ordemTecInicial: [],
      afastamentosFlat: afPleno.map((a) => (a.get ? a.get({ plain: true }) : a)),
      datasNaoUteisIsoSet: p.datasNaoUteisIsoSet,
      categoriaPorUsuarioId: cat,
      sincronizarVet: true,
      sincronizarTec: false,
    });
    for (const pl of plantoesDb) {
      const ant = antes.find((x) => x.id === pl.id);
      expect(pl.usuarioId).toBe(ant.usuarioId);
    }
  });

  test('férias técnico 05–19 com calendário gravado (plantão 06/06): relevante', () => {
    const ORDEM_TEC = [201, 202, 203, 204, 205, 206];
    const alvaro = 201;
    const afs = [
      { id: 3, usuarioId: alvaro, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
    ];
    const plantoesAntes = plantoesGravadosTec(ORDEM_TEC, DATAS_JUN, []);
    const cat = new Map(ORDEM_TEC.map((id) => [id, 'tecnico']));
    const pAntes = montarParametrosFiltroAfastamentoPlantoes({
      plantoes: plantoesAntes,
      ordemVetInicial: [],
      ordemTecInicial: ORDEM_TEC,
      afastamentosLista: afs,
      periodicidadeEscala: 'fim_de_semana',
      categoriaPorUsuarioId: cat,
    });
    expect(afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario(afs[0], pAntes)).toBe(true);
    expect(filtrarAfastamentosFeriasAbonoSemEfeitoEmPlantoes(afs, pAntes)).toHaveLength(1);
  });

  /**
   * Regressão (isolamento entre categorias):
   * Abono de técnico (Álvaro 18/06) não pode marcar plantão vet como "exige recálculo focado".
   * O mapa `retornosFeriasNoPrimeiroPlantao` é compartilhado entre vet/téc; sem o filtro de
   * pertencimento à ordem da categoria do plantão, `plantaoRequerRecalculoFocado(Vet/Tec)`
   * retornava true em datas onde o titular tec aparecia no mapa, contaminando o calendário vet.
   */
  test('abono de técnico não exige recálculo focado em plantões vet (isolamento entre categorias)', () => {
    const { plantaoRequerRecalculoFocado } = EscalaService.__testables;
    const ORDEM_VET_ISO = [101, 102, 103, 104, 105, 106, 107, 108];
    const ALVARO_TEC = 999;
    const afAlvaro = {
      id: 99,
      usuarioId: ALVARO_TEC,
      tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-18',
      dataFim: '2026-06-18',
    };
    /**
     * Cenário: ainda que o mapa de retornos (compartilhado entre vet/téc) eventualmente contivesse
     * o usuário técnico, o recálculo focado em plantões vet não pode disparar quando o titular
     * não pertence à ordem vet. Inserimos Álvaro manualmente no mapa para isolar o cenário sem
     * depender de como `montarRetornosFeriasNoPrimeiroPlantao` decide criar a entrada.
     */
    const retornos = new Map(DATAS_JUN_VET.map((d) => [d, [ALVARO_TEC]]));

    for (const dataReferencia of DATAS_JUN_VET) {
      const plantaoVet = { dataReferencia, categoriaPlantao: 'veterinario', usuarioId: 101 };
      expect(
        plantaoRequerRecalculoFocado(
          ALVARO_TEC,
          plantaoVet,
          dataReferencia,
          ORDEM_VET_ISO,
          retornos,
          new Map(),
          new Set(),
          afAlvaro,
          [],
          DATAS_JUN_VET,
        ),
      ).toBe(false);
    }
  });

  /**
   * Regressão (filtro do rodízio preserva afastamentos vet relevantes):
   * Após Ana/Diego/Gabriela já refletidos no calendário gravado (BCEFDHAG em jun+jul), o filtro
   * `afastamentosListaParaRodizioEscala` deve manter Ana, Diego e Gabriela (titulares perdem plantão)
   * e remover apenas o abono Álvaro do técnico (titular não perde plantão). Antes da correção,
   * `Redundante` filtrava todos os 3 vet também, deixando a re-simulação plena rodar sem afastamentos
   * e sobrescrever o calendário vet para ordem alfabética genérica.
   */
  test('filtro do rodízio: abono Álvaro tec irrelevante remove só Álvaro, mantém Ana/Diego/Gabriela vet', () => {
    const ORDEM_VET_ALF = [101, 102, 103, 104, 105, 106, 107, 108];
    const ORDEM_TEC_ALF = [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216];
    const DATAS_JUN_JUL = [
      '2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14',
      '2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28',
      '2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12',
      '2026-07-18', '2026-07-19', '2026-07-25', '2026-07-26',
    ];
    const afAna = { id: 1, usuarioId: 101, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' };
    const afDiego = { id: 2, usuarioId: 104, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' };
    const afGab = { id: 3, usuarioId: 107, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-17', dataFim: '2026-06-24' };
    const afAlvaro = { id: 4, usuarioId: 201, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-18', dataFim: '2026-06-18' };

    const semAlvaroVet = simularRodizioVetPlantoes(ORDEM_VET_ALF, DATAS_JUN_JUL, [afAna, afDiego, afGab], new Set());
    const semAlvaroTec = simularRodizioTecPlantoes(ORDEM_TEC_ALF, DATAS_JUN_JUL, [], new Set());
    const plantoesGravados = [
      ...semAlvaroVet.alocacoes.map((a) => ({ dataReferencia: a.dataIso, categoriaPlantao: 'veterinario', usuarioId: a.usuarioId })),
      ...semAlvaroTec.alocacoes.map((a) => ({ dataReferencia: a.dataIso, categoriaPlantao: 'tecnico', usuarioId: a.usuarioId, vagaIndice: a.vagaIndice })),
    ];
    const categoriaPorUsuarioId = new Map([
      ...ORDEM_VET_ALF.map((id) => [id, 'veterinario']),
      ...ORDEM_TEC_ALF.map((id) => [id, 'tecnico']),
    ]);
    const params = montarParametrosFiltroAfastamentoPlantoes({
      plantoes: plantoesGravados,
      ordemVetInicial: ORDEM_VET_ALF,
      ordemTecInicial: ORDEM_TEC_ALF,
      afastamentosLista: [afAna, afDiego, afGab, afAlvaro],
      periodicidadeEscala: 'fim_de_semana',
      categoriaPorUsuarioId,
    });
    const filtrados = afastamentosListaParaRodizioEscala([afAna, afDiego, afGab, afAlvaro], params);
    const ids = filtrados.map((a) => Number(a.id)).sort();
    expect(ids).toEqual([1, 2, 3]);

    /** Re-simulação plena com os 3 vet relevantes preserva o calendário vet BCEFDHAG em jun+jul. */
    const reSim = simularRodizioVetPlantoes(ORDEM_VET_ALF, DATAS_JUN_JUL, filtrados, new Set());
    const LETRA = { 101: 'A', 102: 'B', 103: 'C', 104: 'D', 105: 'E', 106: 'F', 107: 'G', 108: 'H' };
    const seq = DATAS_JUN_JUL.map((d) => {
      const a = reSim.alocacoes.find((x) => x.dataIso === d);
      return a ? LETRA[a.usuarioId] : '?';
    }).join('');
    expect(seq).toBe('BCEFDHAGBCEFDHAG');
  });

  /**
   * Simetria do isolamento: abono vet não pode marcar plantão tec como "exige recálculo focado".
   */
  test('abono de veterinário não exige recálculo focado em plantões téc (isolamento entre categorias)', () => {
    const { plantaoRequerRecalculoFocado, montarRetornosFeriasNoPrimeiroPlantao } = EscalaService.__testables;
    const ORDEM_TEC_ISO = [201, 202, 203, 204, 205, 206];
    const ANA_VET = 101;
    const afAna = {
      id: 11,
      usuarioId: ANA_VET,
      tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-17',
      dataFim: '2026-06-17',
    };
    const plantoesParaRetornos = [
      { dataReferencia: '2026-06-13', categoriaPlantao: 'veterinario', usuarioId: ANA_VET },
      { dataReferencia: '2026-06-20', categoriaPlantao: 'veterinario', usuarioId: ANA_VET },
      { dataReferencia: '2026-06-20', categoriaPlantao: 'tecnico', usuarioId: 201, vagaIndice: 0 },
    ];
    const categoriaPorUsuarioId = new Map([
      [ANA_VET, 'veterinario'],
      ...ORDEM_TEC_ISO.map((id) => [id, 'tecnico']),
    ]);
    const retornos = montarRetornosFeriasNoPrimeiroPlantao(
      [afAna],
      plantoesParaRetornos,
      new Set(),
      categoriaPorUsuarioId,
    );
    for (const dataReferencia of ['2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28']) {
      const plantaoTec = { dataReferencia, categoriaPlantao: 'tecnico', usuarioId: 201, vagaIndice: 0 };
      expect(
        plantaoRequerRecalculoFocado(
          ANA_VET,
          plantaoTec,
          dataReferencia,
          ORDEM_TEC_ISO,
          retornos,
          new Map(),
          new Set(),
          afAna,
          [],
          ['2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14', '2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28'],
        ),
      ).toBe(false);
    }
  });

  /**
   * Regressão (`montarRetornosFeriasNoPrimeiroPlantao` ignora afastamentos sem efeito):
   *
   * Cenário do usuário: escala vet jun-jul ABCDEFGH, após Ana(05-19/06 férias) + Diego(12/06 abono)
   * + Gabriela(17-24/06 férias) + Ana(17/07 abono) + Henrique(17/07 abono), o calendário gravado é
   * BCEFDHAG em junho e BCEFDGAH em julho. Ao cadastrar abono Henrique 11/06 (quarta-feira, sem
   * plantão dela em junho — Henrique escalado em 21/06 e o pós-fim 11/06 tem 12/06 sex útil
   * intermediário, logo nada bloqueia 21/06), o motor antes criava entrada de retorno fictícia
   * em 13/06 para Henrique, deslocando todo o rodízio (e escalando Gabriela durante suas próprias
   * férias). Agora, como o abono não bloqueia nenhum plantão dela, `montarRetornos` ignora o
   * candidato e o calendário permanece BCEFDHAG/BCEFDGAH (mesmo do passo anterior).
   */
  test('abono Henrique 11/06 (irrelevante) não deve alterar calendário BCEFDHAG/BCEFDGAH', () => {
    const ORDEM_VET = [101, 102, 103, 104, 105, 106, 107, 108];
    const LETRA = { 101: 'A', 102: 'B', 103: 'C', 104: 'D', 105: 'E', 106: 'F', 107: 'G', 108: 'H' };
    const DATAS = [
      '2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14',
      '2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28',
      '2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12',
      '2026-07-18', '2026-07-19', '2026-07-25', '2026-07-26',
    ];
    const seq = (alocs) =>
      DATAS.map((d) => {
        const a = alocs.find((x) => x.dataIso === d);
        return a ? LETRA[a.usuarioId] : '?';
      }).join('');

    const afAna = { id: 1, usuarioId: 101, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' };
    const afDiego = { id: 2, usuarioId: 104, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' };
    const afGab = { id: 3, usuarioId: 107, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-17', dataFim: '2026-06-24' };
    const afAna17jul = { id: 4, usuarioId: 101, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' };
    const afHen17jul = { id: 5, usuarioId: 108, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' };
    const afHen11jun = { id: 6, usuarioId: 108, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-11', dataFim: '2026-06-11' };

    const semHen11 = simularRodizioVetPlantoes(
      ORDEM_VET,
      DATAS,
      [afAna, afDiego, afGab, afAna17jul, afHen17jul],
      new Set(),
    );
    expect(seq(semHen11.alocacoes)).toBe('BCEFDHAGBCEFDGAH');

    const comHen11 = simularRodizioVetPlantoes(
      ORDEM_VET,
      DATAS,
      [afAna, afDiego, afGab, afAna17jul, afHen17jul, afHen11jun],
      new Set(),
    );
    expect(seq(comHen11.alocacoes)).toBe(seq(semHen11.alocacoes));

    const plantoes = semHen11.alocacoes.map((a) => ({
      dataReferencia: a.dataIso,
      categoriaPlantao: 'veterinario',
      usuarioId: a.usuarioId,
    }));
    const cat = new Map(ORDEM_VET.map((id) => [id, 'veterinario']));
    const todos = [afAna, afDiego, afGab, afAna17jul, afHen17jul, afHen11jun];
    const p = montarParametrosFiltroAfastamentoPlantoes({
      plantoes,
      ordemVetInicial: ORDEM_VET,
      ordemTecInicial: [],
      afastamentosLista: todos,
      periodicidadeEscala: 'fim_de_semana',
      categoriaPorUsuarioId: cat,
    });

    expect(afastamentoFeriasOuAbonoTitularPerdeAlgumPlantao(afHen11jun, p)).toBe(false);
    expect(afastamentoFeriasOuAbonoTitularPerdeAlgumPlantao(afGab, p)).toBe(true);

    const filtrados = afastamentosListaParaRodizioEscala(todos, p);
    expect(filtrados.map((a) => Number(a.id)).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  /**
   * Regressão (isolamento da sincronização de idx no modo focado):
   * Em `recalcularEscalaInterno`, quando o afastamento focado é técnico (ex.: férias do Fábio
   * 17-24/06), `sincronizarIdxOrdemDePlantoes` deve ser chamada com `ordemVet=[]` para que o
   * `idxVet` retornado seja 0. Caso contrário, a rotação final pós-loop (`ordemAtualVet =
   * rotacionarOrdemParaProximoPreferencial(ordemAtualVet, idxOrdemVet)`) embaralha a ordem
   * dos veterinários sem que nenhum plantão vet tenha sido reprocessado.
   */
  test('sincronizarIdxOrdemDePlantoes com ordemVet=[] mantém idxVet=0 (isolamento focado téc)', () => {
    const { sincronizarIdxOrdemDePlantoes } = EscalaService.__testables;
    const ORDEM_VET_BCEFDHAG = [102, 103, 105, 106, 104, 108, 101, 107];
    const ORDEM_TEC = [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212];
    const plantoes = [
      { dataReferencia: '2026-06-06', categoriaPlantao: 'veterinario', usuarioId: 102 },
      { dataReferencia: '2026-06-06', categoriaPlantao: 'tecnico', usuarioId: 201, vagaIndice: 0 },
      { dataReferencia: '2026-06-13', categoriaPlantao: 'veterinario', usuarioId: 103 },
      { dataReferencia: '2026-06-13', categoriaPlantao: 'tecnico', usuarioId: 203, vagaIndice: 0 },
    ];
    const idxAmbos = sincronizarIdxOrdemDePlantoes(plantoes, ORDEM_VET_BCEFDHAG, ORDEM_TEC, '2026-06-21');
    expect(idxAmbos.idxVet).not.toBe(0);
    const idxSoTec = sincronizarIdxOrdemDePlantoes(plantoes, [], ORDEM_TEC, '2026-06-21');
    expect(idxSoTec.idxVet).toBe(0);
    expect(idxSoTec.idxTec).toBe(idxAmbos.idxTec);
  });

  /**
   * Regressão (férias téc Fábio não altera calendário vet):
   * Após escala jun+jul ABCDEFGH com Ana(férias 05-19/06)+Diego(abono 12/06)+Gabriela(férias 17-24/06)
   * +Ana(abono 17/07)+Henrique(abono 17/07), o calendário vet gravado é BCEFDHAG/BCEFDGAH.
   * Cadastrar férias técnico Fábio 17-24/06 não pode alterar a simulação plena vet — passando
   * todos os afastamentos (vet+téc), a simulação ignora o titular téc (fora da `ordemVet`) e
   * o resultado vet permanece exatamente BCEFDHAG/BCEFDGAH.
   */
  test('férias téc Fábio 17–24/06 não altera simulação plena vet (BCEFDHAG/BCEFDGAH)', () => {
    const ORDEM_VET = ORDEM;
    const DATAS = [
      '2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14',
      '2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28',
      '2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12',
      '2026-07-18', '2026-07-19', '2026-07-25', '2026-07-26',
    ];
    const LETRA = { 101: 'A', 102: 'B', 103: 'C', 104: 'D', 105: 'E', 106: 'F', 107: 'G', 108: 'H' };
    const seq = (alocacoes) =>
      DATAS.map((d) => {
        const a = alocacoes.find((x) => x.dataIso === d);
        return a ? LETRA[a.usuarioId] : '?';
      }).join('');

    const FABIO_TEC = 211;
    const afAna = { id: 1, usuarioId: 101, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' };
    const afDiego = { id: 2, usuarioId: 104, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' };
    const afGab = { id: 3, usuarioId: 107, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-17', dataFim: '2026-06-24' };
    const afAna17jul = { id: 4, usuarioId: 101, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' };
    const afHen17jul = { id: 5, usuarioId: 108, tipo: { tipo: 'Abono' }, dataInicio: '2026-07-17', dataFim: '2026-07-17' };
    const afFabio = { id: 6, usuarioId: FABIO_TEC, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-17', dataFim: '2026-06-24' };

    const semFabio = simularRodizioVetPlantoes(
      ORDEM_VET,
      DATAS,
      [afAna, afDiego, afGab, afAna17jul, afHen17jul],
      new Set(),
    );
    expect(seq(semFabio.alocacoes)).toBe('BCEFDHAGBCEFDGAH');

    const comFabio = simularRodizioVetPlantoes(
      ORDEM_VET,
      DATAS,
      [afAna, afDiego, afGab, afAna17jul, afHen17jul, afFabio],
      new Set(),
    );
    expect(seq(comFabio.alocacoes)).toBe(seq(semFabio.alocacoes));
  });
});
