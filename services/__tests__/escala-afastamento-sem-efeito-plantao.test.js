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
});
