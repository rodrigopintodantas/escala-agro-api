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

const TEC = {
  alvaro: 1,
  amanda: 2,
  bernardo: 3,
  bianca: 4,
  camila: 5,
  carlos: 6,
  denise: 7,
  diego: 8,
  eduardo: 9,
  elisa: 10,
  fernanda: 11,
  fabio: 12,
  gabriela: 13,
  gustavo: 14,
  helena: 15,
  hugo: 16,
};

const ORDEM_INICIAL = Object.values(TEC);

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

const DATAS_JUL = ['2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12'];

const LETRA_TEC = {
  [TEC.alvaro]: 'A',
  [TEC.amanda]: 'B',
  [TEC.bernardo]: 'C',
  [TEC.bianca]: 'D',
  [TEC.camila]: 'E',
  [TEC.carlos]: 'F',
  [TEC.denise]: 'G',
  [TEC.diego]: 'H',
  [TEC.eduardo]: 'I',
  [TEC.elisa]: 'J',
  [TEC.fernanda]: 'K',
  [TEC.fabio]: 'L',
  [TEC.gabriela]: 'M',
  [TEC.gustavo]: 'N',
  [TEC.helena]: 'O',
  [TEC.hugo]: 'P',
};

function seqLetras(alocacoes) {
  return alocacoes.map((a) => LETRA_TEC[a.usuarioId] || '?').join('');
}

function paresPorDia(alocacoes) {
  const mapa = new Map();
  for (const a of alocacoes) {
    const key = a.dataIso;
    if (!mapa.has(key)) mapa.set(key, []);
    mapa.get(key).push(a);
  }
  return mapa;
}

describe('Rodízio técnicos (AABB, 2 vagas/dia)', () => {
  const {
    simularRodizioTecPlantoes,
    simularRodizioTecModoFocado,
    plantaoRequerRecalculoFocado,
    obterIdxRodizioAposUltimoPlantaoAntesDe,
    rotacionarOrdemParaProximoPreferencial,
  } = EscalaService.__testables;

  test('Alvaro férias 05–19/06: junho sem duplicar mesma pessoa nas duas vagas', () => {
    const { alocacoes } = simularRodizioTecPlantoes(ORDEM_INICIAL, DATAS_JUN, [
      { usuarioId: TEC.alvaro, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
    ]);
    for (const [, lista] of paresPorDia(alocacoes)) {
      expect(lista).toHaveLength(2);
      expect(lista[0].usuarioId).not.toBe(lista[1].usuarioId);
    }
  });

  test('após Alvaro, abono Diego 12/06: 14/06 Carlos+Denise (não Eduardo duplicado)', () => {
    const aposAlvaro = simularRodizioTecPlantoes(ORDEM_INICIAL, DATAS_JUN, [
      { usuarioId: TEC.alvaro, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
    ]).ordemPersistida;

    const { alocacoes } = simularRodizioTecPlantoes(aposAlvaro, DATAS_JUN, [
      { usuarioId: TEC.alvaro, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
      { usuarioId: TEC.diego, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
    ]);

    const dia14 = paresPorDia(alocacoes).get('2026-06-14');
    expect(dia14).toBeDefined();
    expect(dia14[0].usuarioId).not.toBe(dia14[1].usuarioId);
    const ids14 = dia14.map((p) => p.usuarioId);
    expect(ids14.filter((id) => id === TEC.eduardo).length).toBeLessThanOrEqual(1);

    const dia20 = paresPorDia(alocacoes).get('2026-06-20');
    expect(dia20.map((p) => p.usuarioId)).toContain(TEC.diego);
  });

  test('2º abono Diego: julho começa AB após junho focalizado HH', () => {
    const afAlvaro = [{ usuarioId: TEC.alvaro, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' }];
    const aposAlvaro = simularRodizioTecPlantoes(ORDEM_INICIAL, DATAS_JUN, afAlvaro);
    let plantoes = aposAlvaro.alocacoes.map((a, i) => ({
      id: i + 1,
      dataIso: a.dataIso,
      vagaIndice: a.vagaIndice,
      usuarioId: a.usuarioId,
    }));
    const afDiego = [
      ...afAlvaro,
      { usuarioId: TEC.diego, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
    ];
    const focadoDiego = simularRodizioTecModoFocado({
      ordemInicial: aposAlvaro.ordemPersistida,
      plantoesIniciais: plantoes,
      afastamentosFlat: afDiego,
      usuarioAfetadoId: TEC.diego,
      inicioAfastamentoIso: '2026-06-12',
      fimAfastamentoIso: '2026-06-12',
    });
    const junSeq = seqLetras(focadoDiego.alocacoes);
    expect(junSeq.endsWith('OP')).toBe(true);

    const plantoesJunDb = focadoDiego.alocacoes.map((a, i) => ({
      dataReferencia: a.dataIso,
      categoriaPlantao: 'tecnico',
      usuarioId: a.usuarioId,
      vagaIndice: a.vagaIndice,
      id: i + 1,
    }));
    const idxJul = obterIdxRodizioAposUltimoPlantaoAntesDe(
      plantoesJunDb,
      ORDEM_INICIAL,
      '2026-07-01',
      'tecnico',
      ORDEM_INICIAL,
    );
    const ordemJul = rotacionarOrdemParaProximoPreferencial(ORDEM_INICIAL, idxJul);
    const jul = simularRodizioTecPlantoes(
      ordemJul,
      DATAS_JUL,
      afDiego,
      new Set(),
      0,
      plantoesJunDb,
      '2026-07-01',
    );
    const julSeq = seqLetras(jul.alocacoes);
    expect(julSeq).toMatch(/^AB/);
  });

  test('modo focalizado (API): após Alvaro, abono Diego 12/06 — 14/06 sem Eduardo duplicado', () => {
    const afastamentos = [
      { usuarioId: TEC.alvaro, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
    ];
    const aposAlvaro = simularRodizioTecPlantoes(ORDEM_INICIAL, DATAS_JUN, afastamentos);

    const plantoesIniciais = aposAlvaro.alocacoes.map((a, i) => ({
      id: i + 1,
      dataIso: a.dataIso,
      vagaIndice: a.vagaIndice,
      usuarioId: a.usuarioId,
    }));
    const { alocacoes } = simularRodizioTecModoFocado({
      ordemInicial: aposAlvaro.ordemPersistida,
      plantoesIniciais,
      afastamentosFlat: [
        ...afastamentos,
        { usuarioId: TEC.diego, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      ],
      usuarioAfetadoId: TEC.diego,
      inicioAfastamentoIso: '2026-06-12',
      fimAfastamentoIso: '2026-06-12',
    });

    const dia14 = paresPorDia(alocacoes).get('2026-06-14');
    expect(dia14).toBeDefined();
    expect(dia14[0].usuarioId).not.toBe(dia14[1].usuarioId);
    expect(dia14.filter((p) => p.usuarioId === TEC.eduardo).length).toBeLessThanOrEqual(1);

    const dia20 = paresPorDia(alocacoes).get('2026-06-20');
    expect(dia20).toBeDefined();
    expect(dia20.map((p) => p.usuarioId)).toContain(TEC.diego);
    expect(dia20[0].usuarioId).not.toBe(dia20[1].usuarioId);

    const full = simularRodizioTecPlantoes(aposAlvaro.ordemPersistida, DATAS_JUN, [
      ...afastamentos,
      { usuarioId: TEC.diego, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
    ]);
    for (const dataIso of ['2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14', '2026-06-20', '2026-06-21']) {
      const foc = paresPorDia(alocacoes).get(dataIso).map((p) => p.usuarioId).sort();
      const pl = paresPorDia(full.alocacoes).get(dataIso).map((p) => p.usuarioId).sort();
      expect(foc).toEqual(pl);
    }
  });

  test('modo focalizado: corrige vaga 1 quando vaga 0 recalculada deixa duplicata no mesmo dia', () => {
    const afastamentos = [
      { usuarioId: TEC.alvaro, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
    ];
    const aposAlvaro = simularRodizioTecPlantoes(ORDEM_INICIAL, DATAS_JUN, afastamentos);
    const plantoesIniciais = aposAlvaro.alocacoes.map((a, i) => ({
      id: i + 1,
      dataIso: a.dataIso,
      vagaIndice: a.vagaIndice,
      usuarioId: a.usuarioId,
    }));
    const p14v0 = plantoesIniciais.find((p) => p.dataIso === '2026-06-14' && p.vagaIndice === 0);
    const p14v1 = plantoesIniciais.find((p) => p.dataIso === '2026-06-14' && p.vagaIndice === 1);
    const p20 = plantoesIniciais.find((p) => p.dataIso === '2026-06-20' && p.vagaIndice === 0);
    p14v0.usuarioId = TEC.eduardo;
    p14v1.usuarioId = TEC.eduardo;
    p20.usuarioId = TEC.diego;

    const { alocacoes } = simularRodizioTecModoFocado({
      ordemInicial: aposAlvaro.ordemPersistida,
      plantoesIniciais,
      afastamentosFlat: [
        ...afastamentos,
        { usuarioId: TEC.diego, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      ],
      usuarioAfetadoId: TEC.diego,
      inicioAfastamentoIso: '2026-06-12',
      fimAfastamentoIso: '2026-06-12',
    });

    const dia14 = paresPorDia(alocacoes).get('2026-06-14');
    expect(dia14[0].usuarioId).not.toBe(dia14[1].usuarioId);
  });

  test('abono veterinário focalizado não reabre todos os plantões de técnico', () => {
    const plantaoTec = { categoriaPlantao: 'tecnico', usuarioId: TEC.carlos, vagaIndice: 0 };
    const afVetAbono = { tipo: { tipo: 'Abono' }, dataInicio: '2026-06-22', dataFim: '2026-06-22' };
    expect(
      plantaoRequerRecalculoFocado(
        101,
        plantaoTec,
        '2026-06-06',
        ORDEM_INICIAL,
        new Map(),
        {},
        new Set(),
        afVetAbono,
      ),
    ).toBe(false);
  });

  test('3º abono Fábio 22/06: não altera alocação do dia 06/06', () => {
    const afastamentosBase = [
      { usuarioId: TEC.alvaro, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
      { usuarioId: TEC.diego, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
    ];
    let ordem = ORDEM_INICIAL;
    let plantoesIniciais = null;
    for (const passo of [
      { uid: TEC.alvaro, inicio: '2026-06-05', fim: '2026-06-19', tipo: 'Férias' },
      { uid: TEC.diego, inicio: '2026-06-12', fim: '2026-06-12', tipo: 'Abono' },
    ]) {
      const afs = [
        { usuarioId: TEC.alvaro, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
      ];
      if (passo.uid === TEC.diego) {
        afs.push({
          usuarioId: TEC.diego,
          tipo: { tipo: 'Abono' },
          dataInicio: '2026-06-12',
          dataFim: '2026-06-12',
        });
      }
      if (passo.uid === TEC.alvaro) {
        const apos = simularRodizioTecPlantoes(ordem, DATAS_JUN, afs);
        ordem = apos.ordemPersistida;
        plantoesIniciais = apos.alocacoes.map((a, i) => ({
          id: i + 1,
          dataIso: a.dataIso,
          vagaIndice: a.vagaIndice,
          usuarioId: a.usuarioId,
        }));
      } else {
        const focado = simularRodizioTecModoFocado({
          ordemInicial: ordem,
          plantoesIniciais,
          afastamentosFlat: afs,
          usuarioAfetadoId: passo.uid,
          inicioAfastamentoIso: passo.inicio,
          fimAfastamentoIso: passo.fim,
        });
        ordem = focado.ordemPersistida;
        plantoesIniciais = focado.alocacoes.map((a, i) => ({
          id: i + 1,
          dataIso: a.dataIso,
          vagaIndice: a.vagaIndice,
          usuarioId: a.usuarioId,
        }));
      }
    }

    const dia06Antes = plantoesIniciais
      .filter((p) => p.dataIso === '2026-06-06')
      .map((p) => p.usuarioId)
      .sort();

    const p21 = plantoesIniciais.find((p) => p.dataIso === '2026-06-21' && p.vagaIndice === 0);
    if (p21) p21.usuarioId = TEC.fabio;

    const aposFabio = simularRodizioTecModoFocado({
      ordemInicial: ordem,
      plantoesIniciais,
      afastamentosFlat: [
        ...afastamentosBase,
        { usuarioId: TEC.fabio, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-22', dataFim: '2026-06-22' },
      ],
      usuarioAfetadoId: TEC.fabio,
      inicioAfastamentoIso: '2026-06-22',
      fimAfastamentoIso: '2026-06-22',
    });

    const dia06Depois = paresPorDia(aposFabio.alocacoes)
      .get('2026-06-06')
      .map((p) => p.usuarioId)
      .sort();
    expect(dia06Depois).toEqual(dia06Antes);

    const idsOrdem = aposFabio.ordemPersistida;
    expect(new Set(idsOrdem).size).toBe(idsOrdem.length);
  });

  test('3º abono Fábio 22/06: último fim de semana Hugo+Helena (sem Gustavo duplicado)', () => {
    const afastamentosBase = [
      { usuarioId: TEC.alvaro, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
      { usuarioId: TEC.diego, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
    ];
    let ordem = ORDEM_INICIAL;
    let plantoesIniciais = null;
    const passos = [
      { uid: TEC.alvaro, inicio: '2026-06-05', fim: '2026-06-19', full: true },
      { uid: TEC.diego, inicio: '2026-06-12', fim: '2026-06-12', full: false },
      { uid: TEC.fabio, inicio: '2026-06-22', fim: '2026-06-22', full: false },
    ];
    let afs = [];
    for (const passo of passos) {
      if (passo.uid === TEC.alvaro) {
        afs = [{ usuarioId: TEC.alvaro, tipo: { tipo: 'Férias' }, dataInicio: passo.inicio, dataFim: passo.fim }];
      } else if (passo.uid === TEC.diego) {
        afs = [
          ...afastamentosBase.filter((a) => a.usuarioId === TEC.alvaro),
          { usuarioId: TEC.diego, tipo: { tipo: 'Abono' }, dataInicio: passo.inicio, dataFim: passo.fim },
        ];
      } else {
        afs = [
          ...afastamentosBase,
          { usuarioId: TEC.fabio, tipo: { tipo: 'Abono' }, dataInicio: passo.inicio, dataFim: passo.fim },
        ];
      }
      if (passo.full) {
        const apos = simularRodizioTecPlantoes(ordem, DATAS_JUN, afs);
        ordem = apos.ordemPersistida;
        plantoesIniciais = apos.alocacoes.map((a, i) => ({
          id: i + 1,
          dataIso: a.dataIso,
          vagaIndice: a.vagaIndice,
          usuarioId: a.usuarioId,
        }));
      } else {
        if (passo.uid === TEC.fabio) {
          const p21 = plantoesIniciais?.find((p) => p.dataIso === '2026-06-21' && p.vagaIndice === 0);
          if (p21) p21.usuarioId = TEC.fabio;
        }
        const focado = simularRodizioTecModoFocado({
          ordemInicial: ordem,
          plantoesIniciais,
          afastamentosFlat: afs,
          usuarioAfetadoId: passo.uid,
          inicioAfastamentoIso: passo.inicio,
          fimAfastamentoIso: passo.fim,
        });
        ordem = focado.ordemPersistida;
        plantoesIniciais = focado.alocacoes.map((a, i) => ({
          id: i + 1,
          dataIso: a.dataIso,
          vagaIndice: a.vagaIndice,
          usuarioId: a.usuarioId,
        }));
      }
    }

    const allAfs = [
      ...afastamentosBase,
      { usuarioId: TEC.fabio, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-22', dataFim: '2026-06-22' },
    ];
    const fullMes = simularRodizioTecPlantoes(ORDEM_INICIAL, DATAS_JUN, allAfs);

    const dia28Foc = paresPorDia(
      plantoesIniciais.map((p) => ({ dataIso: p.dataIso, vagaIndice: p.vagaIndice, usuarioId: p.usuarioId })),
    ).get('2026-06-28');

    expect(dia28Foc[0].usuarioId).not.toBe(dia28Foc[1].usuarioId);
    expect(dia28Foc.map((p) => p.usuarioId).sort()).toEqual(
      fullMes.alocacoes.filter((a) => a.dataIso === '2026-06-28').map((a) => a.usuarioId).sort(),
    );
    expect(dia28Foc.map((p) => p.usuarioId).sort()).toEqual([TEC.helena, TEC.hugo].sort());

    const dia21Foc = paresPorDia(
      plantoesIniciais.map((p) => ({ dataIso: p.dataIso, vagaIndice: p.vagaIndice, usuarioId: p.usuarioId })),
    ).get('2026-06-21');
    expect(dia21Foc.map((p) => p.usuarioId)).not.toContain(TEC.fabio);

    const dia27Foc = paresPorDia(
      plantoesIniciais.map((p) => ({ dataIso: p.dataIso, vagaIndice: p.vagaIndice, usuarioId: p.usuarioId })),
    ).get('2026-06-27');
    expect(dia27Foc.map((p) => p.usuarioId)).toContain(TEC.fabio);
    expect(dia27Foc.map((p) => p.usuarioId)).toContain(TEC.alvaro);
    expect(dia27Foc.map((p) => p.usuarioId).sort()).toEqual([TEC.alvaro, TEC.fabio].sort());
  });

  test('3º abono Fábio: corrige 28/06 para HH mesmo se BD tinha Fernanda+Gabriela antes', () => {
    const afastamentosBase = [
      { usuarioId: TEC.alvaro, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' },
      { usuarioId: TEC.diego, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
    ];
    let ordem = ORDEM_INICIAL;
    let plantoesIniciais = null;
    for (const passo of [
      { uid: TEC.alvaro, full: true, afs: [{ usuarioId: TEC.alvaro, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-05', dataFim: '2026-06-19' }] },
      {
        uid: TEC.diego,
        full: false,
        afs: [
          ...afastamentosBase.filter((a) => a.usuarioId === TEC.alvaro),
          { usuarioId: TEC.diego, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
        ],
      },
    ]) {
      if (passo.full) {
        const apos = simularRodizioTecPlantoes(ordem, DATAS_JUN, passo.afs);
        ordem = apos.ordemPersistida;
        plantoesIniciais = apos.alocacoes.map((a, i) => ({
          id: i + 1,
          dataIso: a.dataIso,
          vagaIndice: a.vagaIndice,
          usuarioId: a.usuarioId,
        }));
      } else {
        const focado = simularRodizioTecModoFocado({
          ordemInicial: ordem,
          plantoesIniciais,
          afastamentosFlat: passo.afs,
          usuarioAfetadoId: passo.uid,
          inicioAfastamentoIso: '2026-06-12',
          fimAfastamentoIso: '2026-06-12',
        });
        ordem = focado.ordemPersistida;
        plantoesIniciais = focado.alocacoes.map((a, i) => ({
          id: i + 1,
          dataIso: a.dataIso,
          vagaIndice: a.vagaIndice,
          usuarioId: a.usuarioId,
        }));
      }
    }
    for (const p of plantoesIniciais.filter((x) => x.dataIso === '2026-06-28')) {
      p.usuarioId = p.vagaIndice === 0 ? TEC.fernanda : TEC.gabriela;
    }
    const p21 = plantoesIniciais.find((p) => p.dataIso === '2026-06-21' && p.vagaIndice === 0);
    if (p21) p21.usuarioId = TEC.fabio;

    const aposFabio = simularRodizioTecModoFocado({
      ordemInicial: ordem,
      plantoesIniciais,
      afastamentosFlat: [
        ...afastamentosBase,
        { usuarioId: TEC.fabio, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-22', dataFim: '2026-06-22' },
      ],
      usuarioAfetadoId: TEC.fabio,
      inicioAfastamentoIso: '2026-06-22',
      fimAfastamentoIso: '2026-06-22',
    });

    const dia28 = paresPorDia(aposFabio.alocacoes).get('2026-06-28');
    expect(dia28.map((p) => p.usuarioId).sort()).toEqual([TEC.helena, TEC.hugo].sort());
  });
});
