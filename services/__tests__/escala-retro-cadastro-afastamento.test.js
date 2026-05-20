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

describe('Afastamento férias/abono — retroativo ao cadastro', () => {
  const {
    usuarioBloqueadoRetroCadastroFeriasAbonoNoDia,
    calcularDataInicioRetroCadastro,
    usuarioIndisponivelParaPlantaoNoDia,
    sincronizarIdxOrdemDePlantoes,
    plantaoRequerRecalculoFocado,
    derivarOrdemVetRodizioConsistenteComPlantoes,
    espelharPlantoesVetMesSeguintePeloMesAnterior,
    buscarProximoUsuarioDisponivelNoCiclo,
    processarRetroativoFocadoEmLote,
    montarRetornosFeriasNoPrimeiroPlantao,
    enfileirarRetornosFeriasDoDia,
    escolherRetornoFeriasDoDia,
    primeiroDiaMesSeguinte,
    obterIdxRodizioAposUltimoPlantaoAntesDe,
    usuarioRetornoFeriasAbonoJaRealizadoAntesDe,
    normalizarOrdemRodizioCompleta,
    aplicarOrdemInicialHistoricoRodizio,
    afastamentoExigeRecalculoPlenoComHistoricoInicial,
    simularRodizioVetPlantoes,
    plantaoVetMesmaPessoaNoFimDeSemanaAnterior,
  } = EscalaService.__testables;

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
  const LETRA_VET = {
    101: 'A',
    102: 'B',
    103: 'C',
    104: 'D',
    105: 'E',
    106: 'F',
    107: 'G',
    108: 'H',
  };
  const ORDEM_VET_PADRAO = [101, 102, 103, 104, 105, 106, 107, 108];

  const afAbonoCadastroSegunda = {
    tipo: { tipo: 'Abono' },
    dataInicio: '2026-06-08',
    dataFim: '2026-06-08',
    createdAt: '2026-06-08T14:30:00.000Z',
  };

  test('cadastro na segunda bloqueia plantão de sábado e domingo anteriores sem dia útil entre', () => {
    const mapa = new Map([[10, [afAbonoCadastroSegunda]]]);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 10, '2026-06-06', new Set())).toBe(true);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 10, '2026-06-07', new Set())).toBe(true);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 10, '2026-06-08', new Set())).toBe(false);
  });

  test('mantém plantão de quinta se houver dia útil entre quinta e início na segunda', () => {
    const mapa = new Map([[10, [afAbonoCadastroSegunda]]]);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 10, '2026-06-04', new Set())).toBe(false);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 10, '2026-06-05', new Set())).toBe(true);
  });

  test('feriado entre plantão e cadastro não conta como dia útil', () => {
    const afCadastroQuarta = {
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-09',
      dataFim: '2026-06-09',
      createdAt: '2026-06-09T10:00:00.000Z',
    };
    const mapa = new Map([[10, [afCadastroQuarta]]]);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 10, '2026-06-06', new Set())).toBe(false);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 10, '2026-06-06', new Set(['2026-06-08']))).toBe(true);
  });

  test('calcularDataInicioRetroCadastro inclui fim de semana antes do início na segunda', () => {
    expect(calcularDataInicioRetroCadastro('2026-06-08', new Set())).toBe('2026-06-05');
  });

  test('primeiroDiaMesSeguinte após abono em 22/06 abre recálculo pleno em 01/07', () => {
    expect(primeiroDiaMesSeguinte('2026-06-22')).toBe('2026-07-01');
  });

  test('usuarioIndisponivelParaPlantaoNoDia inclui bloqueio retroativo', () => {
    const mapa = new Map([[10, [afAbonoCadastroSegunda]]]);
    expect(usuarioIndisponivelParaPlantaoNoDia(mapa, 10, '2026-06-07', new Set())).toBe(true);
  });

  test('cadastro antecipado em maio ainda remove plantão de junho antes do início', () => {
    const af = {
      tipo: { tipo: 'Férias' },
      dataInicio: '2026-06-08',
      dataFim: '2026-06-08',
      createdAt: '2026-05-18T10:00:00.000Z',
    };
    const mapa = new Map([[10, [af]]]);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 10, '2026-06-06', new Set())).toBe(true);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 10, '2026-06-07', new Set())).toBe(true);
  });

  test('abono na segunda remove plantão de sábado anterior (Felipe dia 20, abono dia 22)', () => {
    const af = {
      tipo: { tipo: 'Abono' },
      dataInicio: '2026-06-22',
      dataFim: '2026-06-22',
    };
    const mapa = new Map([[20, [af]]]);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 20, '2026-06-20', new Set())).toBe(true);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 20, '2026-06-21', new Set())).toBe(true);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 20, '2026-06-22', new Set())).toBe(false);
  });

  test('modo focado não reprocessa plantão de outro servidor', () => {
    const ordem = [101, 102, 103, 104, 105, 106, 107, 108];
    const retornos = new Map();
    const afastamentosPorUsuario = new Map([
      [
        105,
        [
          {
            tipo: { tipo: 'Abono' },
            dataInicio: '2026-06-15',
            dataFim: '2026-06-15',
          },
        ],
      ],
    ]);
    const plantaoFelipe = {
      dataReferencia: '2026-06-27',
      usuarioId: 106,
      categoriaPlantao: 'veterinario',
    };
    expect(
      plantaoRequerRecalculoFocado(
        105,
        plantaoFelipe,
        '2026-06-27',
        ordem,
        retornos,
        afastamentosPorUsuario,
        new Set(),
      ),
    ).toBe(false);
    const plantaoElisa = {
      dataReferencia: '2026-06-14',
      usuarioId: 105,
      categoriaPlantao: 'veterinario',
    };
    expect(
      plantaoRequerRecalculoFocado(
        105,
        plantaoElisa,
        '2026-06-14',
        ordem,
        retornos,
        afastamentosPorUsuario,
        new Set(),
      ),
    ).toBe(true);
    const plantaoFelipeDia20 = {
      dataReferencia: '2026-06-20',
      usuarioId: 106,
      categoriaPlantao: 'veterinario',
    };
    const afastamentosFelipe = new Map([
      [
        106,
        [
          {
            tipo: { tipo: 'Abono' },
            dataInicio: '2026-06-22',
            dataFim: '2026-06-22',
          },
        ],
      ],
    ]);
    expect(
      plantaoRequerRecalculoFocado(
        106,
        plantaoFelipeDia20,
        '2026-06-20',
        ordem,
        retornos,
        afastamentosFelipe,
        new Set(),
      ),
    ).toBe(true);
    const plantaoOutroDia21 = {
      dataReferencia: '2026-06-21',
      usuarioId: 107,
      categoriaPlantao: 'veterinario',
    };
    expect(
      plantaoRequerRecalculoFocado(
        106,
        plantaoOutroDia21,
        '2026-06-21',
        ordem,
        retornos,
        afastamentosFelipe,
        new Set(),
      ),
    ).toBe(false);
  });

  test('abono vet dia 12: recalcula fins de semana 13 e 14 até retorno em 20 (não pula dia de outro titular)', () => {
    const ordem = [101, 102, 103, 104, 105, 106, 107, 108];
    const datasPlantoes = [
      '2026-06-06',
      '2026-06-07',
      '2026-06-13',
      '2026-06-14',
      '2026-06-20',
      '2026-06-21',
      '2026-06-27',
      '2026-06-28',
    ];
    const afDaniel = {
      tipo: { tipo: 'Abono' },
      usuarioId: 104,
      dataInicio: '2026-06-12',
      dataFim: '2026-06-12',
    };
    const afMap = new Map([[104, [afDaniel]]]);
    const retornos = montarRetornosFeriasNoPrimeiroPlantao(
      [afDaniel],
      datasPlantoes.map((ds) => ({ dataReferencia: ds, categoriaPlantao: 'veterinario' })),
      new Set(),
    );
    const historico = afDaniel;
    const p13 = { dataReferencia: '2026-06-13', usuarioId: 104, categoriaPlantao: 'veterinario' };
    const p14 = { dataReferencia: '2026-06-14', usuarioId: 105, categoriaPlantao: 'veterinario' };
    const p20 = { dataReferencia: '2026-06-20', usuarioId: 106, categoriaPlantao: 'veterinario' };
    const p27 = { dataReferencia: '2026-06-27', usuarioId: 101, categoriaPlantao: 'veterinario' };
    expect(
      plantaoRequerRecalculoFocado(104, p13, '2026-06-13', ordem, retornos, afMap, new Set(), historico, [], datasPlantoes),
    ).toBe(true);
    expect(
      plantaoRequerRecalculoFocado(104, p14, '2026-06-14', ordem, retornos, afMap, new Set(), historico, [], datasPlantoes),
    ).toBe(true);
    expect(
      plantaoRequerRecalculoFocado(104, p20, '2026-06-20', ordem, retornos, afMap, new Set(), historico, [], datasPlantoes),
    ).toBe(true);
    expect(
      plantaoRequerRecalculoFocado(104, p27, '2026-06-27', ordem, retornos, afMap, new Set(), historico, [], datasPlantoes),
    ).toBe(false);
  });

  test('retroativo vet abono 22/06: não altera 20/06 com Daniel titular (evita E20)', async () => {
    const ordem = [101, 102, 103, 104, 105, 106, 107, 108];
    const plantoes = [
      {
        id: 1,
        dataReferencia: '2026-06-20',
        usuarioId: 104,
        categoriaPlantao: 'veterinario',
        save: jest.fn().mockResolvedValue(undefined),
      },
      {
        id: 2,
        dataReferencia: '2026-06-21',
        usuarioId: 106,
        categoriaPlantao: 'veterinario',
        save: jest.fn().mockResolvedValue(undefined),
      },
    ];
    const afMap = new Map([
      [104, [{ tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' }]],
      [107, [{ tipo: { tipo: 'Abono' }, dataInicio: '2026-06-22', dataFim: '2026-06-22' }]],
    ]);
    await processarRetroativoFocadoEmLote({
      plantoes,
      usuarioAfetadoId: 107,
      inicioAfastamentoIso: '2026-06-22',
      categoriaPlantaoAlvo: 'veterinario',
      ordemAtual: [...ordem],
      ordemGlobal: [...ordem],
      idxInicial: 0,
      afastamentosPorUsuario: afMap,
      datasNaoUteisIsoSet: new Set(),
      transaction: null,
      rotuloProfissional: 'Veterinário',
    });
    expect(plantoes[0].usuarioId).toBe(104);
    expect(plantoes[1].usuarioId).toBe(108);
  });

  test('retroativo vet abono 22/06: corrige 21/06 mesmo com Felipe gravado na BD', async () => {
    const ordem = [101, 102, 103, 104, 105, 106, 107, 108];
    const plantoes = [
      {
        id: 1,
        dataReferencia: '2026-06-21',
        usuarioId: 106,
        categoriaPlantao: 'veterinario',
        save: jest.fn().mockResolvedValue(undefined),
      },
    ];
    const afMap = new Map([
      [107, [{ tipo: { tipo: 'Abono' }, dataInicio: '2026-06-22', dataFim: '2026-06-22' }]],
    ]);
    await processarRetroativoFocadoEmLote({
      plantoes,
      usuarioAfetadoId: 107,
      inicioAfastamentoIso: '2026-06-22',
      categoriaPlantaoAlvo: 'veterinario',
      ordemAtual: [...ordem],
      ordemGlobal: [...ordem],
      idxInicial: 0,
      afastamentosPorUsuario: afMap,
      datasNaoUteisIsoSet: new Set(),
      transaction: null,
      rotuloProfissional: 'Veterinário',
    });
    expect(plantoes[0].usuarioId).toBe(108);
  });

  test('abono vet 22/06: plantão 21 com outro titular é tratado no lote retroativo (não no loop)', () => {
    const ordem = [101, 102, 103, 104, 105, 106, 107, 108];
    const datasPlantoes = ['2026-06-21', '2026-06-27', '2026-06-28'];
    const afGabriela = { tipo: { tipo: 'Abono' }, usuarioId: 107, dataInicio: '2026-06-22', dataFim: '2026-06-22' };
    const p21 = { dataReferencia: '2026-06-21', usuarioId: 106, categoriaPlantao: 'veterinario' };
    expect(
      plantaoRequerRecalculoFocado(
        107,
        p21,
        '2026-06-21',
        ordem,
        new Map(),
        new Map([[107, [afGabriela]]]),
        new Set(),
        afGabriela,
        [],
        datasPlantoes,
      ),
    ).toBe(false);
  });

  test('3º abono vet: não recalcula 20/06 com Daniel titular (evita E20)', () => {
    const ordem = [101, 102, 103, 104, 105, 106, 107, 108];
    const datasPlantoes = [
      '2026-06-06',
      '2026-06-07',
      '2026-06-13',
      '2026-06-14',
      '2026-06-20',
      '2026-06-21',
      '2026-06-27',
      '2026-06-28',
    ];
    const afDaniel = { tipo: { tipo: 'Abono' }, usuarioId: 104, dataInicio: '2026-06-12', dataFim: '2026-06-12' };
    const afGabriela = { tipo: { tipo: 'Abono' }, usuarioId: 107, dataInicio: '2026-06-22', dataFim: '2026-06-22' };
    const p20 = { dataReferencia: '2026-06-20', usuarioId: 104, categoriaPlantao: 'veterinario' };
    expect(
      plantaoRequerRecalculoFocado(
        107,
        p20,
        '2026-06-20',
        ordem,
        new Map(),
        new Map([
          [104, [afDaniel]],
          [107, [afGabriela]],
        ]),
        new Set(),
        afGabriela,
        [afDaniel],
        datasPlantoes,
      ),
    ).toBe(false);
  });

  test('espelhar vet julho repete sequência de junho (B C E F D H A G)', () => {
    const plantoes = [
      { id: 1, dataReferencia: '2026-06-06', usuarioId: 102, categoriaPlantao: 'veterinario' },
      { id: 2, dataReferencia: '2026-06-07', usuarioId: 103, categoriaPlantao: 'veterinario' },
      { id: 3, dataReferencia: '2026-06-13', usuarioId: 105, categoriaPlantao: 'veterinario' },
      { id: 4, dataReferencia: '2026-06-14', usuarioId: 106, categoriaPlantao: 'veterinario' },
      { id: 5, dataReferencia: '2026-06-20', usuarioId: 104, categoriaPlantao: 'veterinario' },
      { id: 6, dataReferencia: '2026-06-21', usuarioId: 108, categoriaPlantao: 'veterinario' },
      { id: 7, dataReferencia: '2026-06-27', usuarioId: 101, categoriaPlantao: 'veterinario' },
      { id: 8, dataReferencia: '2026-06-28', usuarioId: 107, categoriaPlantao: 'veterinario' },
      { id: 9, dataReferencia: '2026-07-04', usuarioId: 999, categoriaPlantao: 'veterinario' },
      { id: 10, dataReferencia: '2026-07-05', usuarioId: 999, categoriaPlantao: 'veterinario' },
      { id: 11, dataReferencia: '2026-07-11', usuarioId: 999, categoriaPlantao: 'veterinario' },
      { id: 12, dataReferencia: '2026-07-12', usuarioId: 999, categoriaPlantao: 'veterinario' },
      { id: 13, dataReferencia: '2026-07-18', usuarioId: 999, categoriaPlantao: 'veterinario' },
      { id: 14, dataReferencia: '2026-07-19', usuarioId: 999, categoriaPlantao: 'veterinario' },
      { id: 15, dataReferencia: '2026-07-25', usuarioId: 999, categoriaPlantao: 'veterinario' },
      { id: 16, dataReferencia: '2026-07-26', usuarioId: 999, categoriaPlantao: 'veterinario' },
    ];
    const { idsProcessados, atualizados } = espelharPlantoesVetMesSeguintePeloMesAnterior({
      plantoes,
      dataLimiteIso: '2026-07-01',
    });
    expect(atualizados).toBe(8);
    expect(idsProcessados.size).toBe(8);
    const letra = (ds) => {
      const p = plantoes.find((x) => x.dataReferencia === ds);
      return { 101: 'A', 102: 'B', 103: 'C', 104: 'D', 105: 'E', 106: 'F', 107: 'G', 108: 'H' }[p.usuarioId];
    };
    expect(letra('2026-07-04')).toBe('B');
    expect(letra('2026-07-05')).toBe('C');
    expect(letra('2026-07-11')).toBe('E');
    expect(letra('2026-07-12')).toBe('F');
    expect(letra('2026-07-18')).toBe('D');
    expect(letra('2026-07-19')).toBe('H');
    expect(letra('2026-07-25')).toBe('A');
    expect(letra('2026-07-26')).toBe('G');
  });

  test('derivarOrdemVet: rotação após G28 (só junho no replay; 1º da fila = Ana)', () => {
    const plantoes = [
      { dataReferencia: '2026-06-06', usuarioId: 102, categoriaPlantao: 'veterinario' },
      { dataReferencia: '2026-06-07', usuarioId: 103, categoriaPlantao: 'veterinario' },
      { dataReferencia: '2026-06-13', usuarioId: 105, categoriaPlantao: 'veterinario' },
      { dataReferencia: '2026-06-14', usuarioId: 106, categoriaPlantao: 'veterinario' },
      { dataReferencia: '2026-06-20', usuarioId: 104, categoriaPlantao: 'veterinario' },
      { dataReferencia: '2026-06-21', usuarioId: 108, categoriaPlantao: 'veterinario' },
      { dataReferencia: '2026-06-27', usuarioId: 101, categoriaPlantao: 'veterinario' },
      { dataReferencia: '2026-06-28', usuarioId: 107, categoriaPlantao: 'veterinario' },
    ];
    const afs = [
      { usuarioId: 101, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-08', dataFim: '2026-06-19' },
      { usuarioId: 104, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      { usuarioId: 107, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-22', dataFim: '2026-06-22' },
    ];
    const reb = derivarOrdemVetRodizioConsistenteComPlantoes({
      plantoes,
      ordemBase: [101, 102, 103, 104, 105, 106, 107, 108],
      afastamentosLista: afs,
      datasNaoUteisIsoSet: new Set(),
      modo: 'replay',
      dataLimiteRotacaoIso: '2026-07-01',
    });
    expect(reb.ordemPersistida[0]).toBe(101);
    expect(reb.ordemAtual[reb.idxOrdem]).toBe(101);
  });

  test('3º abono vet Gabriela 22/06: recalcula 21, 27 e 28 sem reabrir 13–20', () => {
    const ordem = [101, 102, 103, 104, 105, 106, 107, 108];
    const datasPlantoes = [
      '2026-06-06',
      '2026-06-07',
      '2026-06-13',
      '2026-06-14',
      '2026-06-20',
      '2026-06-21',
      '2026-06-27',
      '2026-06-28',
    ];
    const afDaniel = { tipo: { tipo: 'Abono' }, usuarioId: 104, dataInicio: '2026-06-12', dataFim: '2026-06-12' };
    const afGabriela = { tipo: { tipo: 'Abono' }, usuarioId: 107, dataInicio: '2026-06-22', dataFim: '2026-06-22' };
    const historico = afGabriela;
    const outros = [afDaniel];
    const retornos = new Map();
    const afMap = new Map([
      [104, [afDaniel]],
      [107, [afGabriela]],
    ]);
    const p13 = { dataReferencia: '2026-06-13', usuarioId: 105, categoriaPlantao: 'veterinario' };
    const p21 = { dataReferencia: '2026-06-21', usuarioId: 107, categoriaPlantao: 'veterinario' };
    const p27 = { dataReferencia: '2026-06-27', usuarioId: 101, categoriaPlantao: 'veterinario' };
    const p28 = { dataReferencia: '2026-06-28', usuarioId: 108, categoriaPlantao: 'veterinario' };
    expect(
      plantaoRequerRecalculoFocado(107, p13, '2026-06-13', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(false);
    expect(
      plantaoRequerRecalculoFocado(107, p21, '2026-06-21', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(true);
    expect(
      plantaoRequerRecalculoFocado(107, p27, '2026-06-27', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(true);
    expect(
      plantaoRequerRecalculoFocado(107, p28, '2026-06-28', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(true);
  });

  test('retorno no mesmo dia: férias (Ana) antes de abono (Gabriela) no 27/06', () => {
    const ordem = [106, 107, 108, 101, 102, 103, 104, 105];
    const mapa = new Map([
      [101, [{ tipo: { tipo: 'Férias' }, dataInicio: '2026-06-08', dataFim: '2026-06-19' }]],
      [107, [{ tipo: { tipo: 'Abono' }, dataInicio: '2026-06-22', dataFim: '2026-06-22' }]],
    ]);
    const fila = [101, 107];
    const escolhido = escolherRetornoFeriasDoDia(fila, ordem, ordem.indexOf(108), mapa, '2026-06-27', new Set());
    expect(escolhido).toBe(101);
  });

  test('fila pendente: Gabriela (abono) no 28 após Ana retornar no 27 (mesmo fim 19/06)', () => {
    const ordem = [106, 107, 108, 101, 102, 103, 104, 105];
    const mapa = new Map([
      [101, [{ tipo: { tipo: 'Férias' }, dataInicio: '2026-06-08', dataFim: '2026-06-19' }]],
      [107, [{ tipo: { tipo: 'Abono' }, dataInicio: '2026-06-19', dataFim: '2026-06-19' }]],
    ]);
    const fila = [];
    for (const uid of [101, 107]) {
      if (!fila.includes(uid)) fila.push(uid);
    }
    expect(escolherRetornoFeriasDoDia(fila, ordem, ordem.indexOf(108), mapa, '2026-06-27', new Set())).toBe(101);
    const idxAna = fila.indexOf(101);
    if (idxAna >= 0) fila.splice(idxAna, 1);
    expect(escolherRetornoFeriasDoDia(fila, ordem, ordem.indexOf(108), mapa, '2026-06-28', new Set())).toBe(107);
  });

  test('vet: detecta duplicata D20 e D21 no fim de semana', () => {
    const plantoes = [
      { dataReferencia: '2026-06-20', usuarioId: 104, categoriaPlantao: 'veterinario' },
      { dataReferencia: '2026-06-21', usuarioId: 104, categoriaPlantao: 'veterinario' },
    ];
    expect(plantaoVetMesmaPessoaNoFimDeSemanaAnterior(plantoes, plantoes[1])).toBe(true);
    expect(plantaoVetMesmaPessoaNoFimDeSemanaAnterior(plantoes, plantoes[0])).toBe(false);
  });

  test('rodízio pleno: Ana + Daniel + abono Gabriela 19/06 → B6 C7 E13 F14 D20 H21 A27 G28', () => {
    const afs = [
      { usuarioId: 101, tipo: { tipo: 'Férias' }, dataInicio: '2026-06-08', dataFim: '2026-06-19' },
      { usuarioId: 104, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      { usuarioId: 107, tipo: { tipo: 'Abono' }, dataInicio: '2026-06-19', dataFim: '2026-06-19' },
    ];
    const { alocacoes } = simularRodizioVetPlantoes(ORDEM_VET_PADRAO, DATAS_JUN_VET, afs, new Set());
    const seq = DATAS_JUN_VET.map((d) => LETRA_VET[alocacoes.find((a) => a.dataIso === d).usuarioId]).join('');
    expect(seq).toBe('BCEFDHAG');
    expect(alocacoes.find((a) => a.dataIso === '2026-06-21').usuarioId).toBe(108);
    const reb = derivarOrdemVetRodizioConsistenteComPlantoes({
      plantoes: alocacoes.map((a) => ({
        dataReferencia: a.dataIso,
        usuarioId: a.usuarioId,
        categoriaPlantao: 'veterinario',
      })),
      ordemBase: ORDEM_VET_PADRAO,
      afastamentosLista: afs,
      datasNaoUteisIsoSet: new Set(),
      modo: 'replay',
      dataLimiteRotacaoIso: '2026-07-01',
    });
    expect(reb.ordemPersistida[0]).toBe(101);
  });

  test('3º abono vet Gabriela 19/06: recalcula 21, 27 e 28 sem reabrir 13–20', () => {
    const ordem = ORDEM_VET_PADRAO;
    const datasPlantoes = DATAS_JUN_VET;
    const plantoes = datasPlantoes.map((d) => ({ dataReferencia: d, categoriaPlantao: 'veterinario' }));
    const afAna = { tipo: { tipo: 'Férias' }, usuarioId: 101, dataInicio: '2026-06-08', dataFim: '2026-06-19' };
    const afDaniel = { tipo: { tipo: 'Abono' }, usuarioId: 104, dataInicio: '2026-06-12', dataFim: '2026-06-12' };
    const afGabriela = { tipo: { tipo: 'Abono' }, usuarioId: 107, dataInicio: '2026-06-19', dataFim: '2026-06-19' };
    const historico = afGabriela;
    const outros = [afAna, afDaniel];
    const retornos = montarRetornosFeriasNoPrimeiroPlantao([afAna, afDaniel, afGabriela], plantoes, new Set());
    const afMap = new Map([
      [101, [afAna]],
      [104, [afDaniel]],
      [107, [afGabriela]],
    ]);
    const p13 = { dataReferencia: '2026-06-13', usuarioId: 105, categoriaPlantao: 'veterinario' };
    const p21Henrique = { dataReferencia: '2026-06-21', usuarioId: 108, categoriaPlantao: 'veterinario' };
    const p21Gabriela = { dataReferencia: '2026-06-21', usuarioId: 107, categoriaPlantao: 'veterinario' };
    const p27 = { dataReferencia: '2026-06-27', usuarioId: 101, categoriaPlantao: 'veterinario' };
    const p28 = { dataReferencia: '2026-06-28', usuarioId: 107, categoriaPlantao: 'veterinario' };
    expect(
      plantaoRequerRecalculoFocado(107, p13, '2026-06-13', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(false);
    expect(
      plantaoRequerRecalculoFocado(107, p21Henrique, '2026-06-21', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(false);
    expect(
      plantaoRequerRecalculoFocado(107, p21Gabriela, '2026-06-21', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(true);
    expect(
      plantaoRequerRecalculoFocado(107, p27, '2026-06-27', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(true);
    expect(
      plantaoRequerRecalculoFocado(107, p28, '2026-06-28', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(true);
  });

  test('montarRetornos: Ana (férias) e Gabriela (abono 19) no 27; 28 via fila', () => {
    const plantoes = DATAS_JUN_VET.map((dataReferencia) => ({ dataReferencia, categoriaPlantao: 'veterinario' }));
    const afastamentos = [
      { tipo: { tipo: 'Férias' }, usuarioId: 101, dataInicio: '2026-06-08', dataFim: '2026-06-19' },
      { tipo: { tipo: 'Abono' }, usuarioId: 104, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      { tipo: { tipo: 'Abono' }, usuarioId: 107, dataInicio: '2026-06-19', dataFim: '2026-06-19' },
    ];
    const retornos = montarRetornosFeriasNoPrimeiroPlantao(afastamentos, plantoes, new Set());
    expect(retornos.get('2026-06-27')?.sort()).toEqual([101, 107]);
    expect(retornos.get('2026-06-28')).toBeUndefined();
  });

  test('montarRetornos: Ana (férias) e Gabriela (abono 22) ficam no 27; fila trata o abono', () => {
    const plantoes = [
      { dataReferencia: '2026-06-06' },
      { dataReferencia: '2026-06-07' },
      { dataReferencia: '2026-06-13' },
      { dataReferencia: '2026-06-14' },
      { dataReferencia: '2026-06-20' },
      { dataReferencia: '2026-06-21' },
      { dataReferencia: '2026-06-27' },
      { dataReferencia: '2026-06-28' },
    ];
    const afastamentos = [
      { tipo: { tipo: 'Férias' }, usuarioId: 101, dataInicio: '2026-06-08', dataFim: '2026-06-19' },
      { tipo: { tipo: 'Abono' }, usuarioId: 104, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      { tipo: { tipo: 'Abono' }, usuarioId: 107, dataInicio: '2026-06-22', dataFim: '2026-06-22' },
    ];
    const retornos = montarRetornosFeriasNoPrimeiroPlantao(afastamentos, plantoes, new Set());
    expect(retornos.get('2026-06-27')?.sort()).toEqual([101, 107]);
    expect(retornos.get('2026-06-28')).toBeUndefined();
  });

  test('montarRetornos: Ana e Gabriela (férias) escalonam 27 e 28', () => {
    const plantoes = [
      { dataReferencia: '2026-06-06' },
      { dataReferencia: '2026-06-07' },
      { dataReferencia: '2026-06-13' },
      { dataReferencia: '2026-06-14' },
      { dataReferencia: '2026-06-20' },
      { dataReferencia: '2026-06-21' },
      { dataReferencia: '2026-06-27' },
      { dataReferencia: '2026-06-28' },
    ];
    const afastamentos = [
      { tipo: { tipo: 'Férias' }, usuarioId: 101, dataInicio: '2026-06-08', dataFim: '2026-06-19' },
      { tipo: { tipo: 'Abono' }, usuarioId: 104, dataInicio: '2026-06-12', dataFim: '2026-06-12' },
      { tipo: { tipo: 'Férias' }, usuarioId: 107, dataInicio: '2026-06-22', dataFim: '2026-06-25' },
    ];
    const retornos = montarRetornosFeriasNoPrimeiroPlantao(afastamentos, plantoes, new Set());
    expect(retornos.get('2026-06-27')).toEqual([101]);
    expect(retornos.get('2026-06-28')).toEqual([107]);
  });

  test('3º afastamento vet Gabriela férias 22–25/06: recalcula 21, 27 e 28 sem reabrir 13–20', () => {
    const ordem = [101, 102, 103, 104, 105, 106, 107, 108];
    const datasPlantoes = [
      '2026-06-06',
      '2026-06-07',
      '2026-06-13',
      '2026-06-14',
      '2026-06-20',
      '2026-06-21',
      '2026-06-27',
      '2026-06-28',
    ];
    const plantoes = datasPlantoes.map((d) => ({ dataReferencia: d }));
    const afAna = { tipo: { tipo: 'Férias' }, usuarioId: 101, dataInicio: '2026-06-08', dataFim: '2026-06-19' };
    const afDaniel = { tipo: { tipo: 'Abono' }, usuarioId: 104, dataInicio: '2026-06-12', dataFim: '2026-06-12' };
    const afGabriela = { tipo: { tipo: 'Férias' }, usuarioId: 107, dataInicio: '2026-06-22', dataFim: '2026-06-25' };
    const historico = afGabriela;
    const outros = [afAna, afDaniel];
    const retornos = montarRetornosFeriasNoPrimeiroPlantao([afAna, afDaniel, afGabriela], plantoes, new Set());
    const afMap = new Map([
      [101, [afAna]],
      [104, [afDaniel]],
      [107, [afGabriela]],
    ]);
    const p13 = { dataReferencia: '2026-06-13', usuarioId: 105, categoriaPlantao: 'veterinario' };
    const p21 = { dataReferencia: '2026-06-21', usuarioId: 107, categoriaPlantao: 'veterinario' };
    const p27 = { dataReferencia: '2026-06-27', usuarioId: 101, categoriaPlantao: 'veterinario' };
    const p28 = { dataReferencia: '2026-06-28', usuarioId: 107, categoriaPlantao: 'veterinario' };
    expect(
      plantaoRequerRecalculoFocado(107, p13, '2026-06-13', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(false);
    expect(
      plantaoRequerRecalculoFocado(107, p21, '2026-06-21', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(true);
    expect(
      plantaoRequerRecalculoFocado(107, p27, '2026-06-27', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(false);
    expect(
      plantaoRequerRecalculoFocado(107, p28, '2026-06-28', ordem, retornos, afMap, new Set(), historico, outros, datasPlantoes),
    ).toBe(true);
  });

  test('sincronizarIdxOrdem usa plantões anteriores ao limite retroativo', () => {
    const ordem = [101, 102, 103];
    const plantoes = [
      { dataReferencia: '2026-06-19', categoriaPlantao: 'veterinario', usuarioId: 101, vagaIndice: 0 },
      { dataReferencia: '2026-06-20', categoriaPlantao: 'veterinario', usuarioId: 102, vagaIndice: 0 },
    ];
    const { idxVet } = sincronizarIdxOrdemDePlantoes(plantoes, ordem, [], '2026-06-20');
    expect(idxVet).toBe(1);
  });

  test('buscarProximoUsuarioDisponivelNoCiclo avança a cada chamada', () => {
    const ordem = [106, 107, 108, 101, 102, 103, 104, 105];
    const mapa = new Map([
      [101, [{ tipo: { tipo: 'Férias' }, dataInicio: '2026-06-08', dataFim: '2026-06-19' }]],
      [106, [{ tipo: { tipo: 'Abono' }, dataInicio: '2026-06-22', dataFim: '2026-06-22' }]],
    ]);
    const primeiro = buscarProximoUsuarioDisponivelNoCiclo(ordem, 0, mapa, '2026-06-20', new Set(), new Set(), new Set([106]));
    expect(primeiro).toBe(107);
    const segundo = buscarProximoUsuarioDisponivelNoCiclo(
      ordem,
      ordem.indexOf(primeiro) + 1,
      mapa,
      '2026-06-21',
      new Set(),
      new Set(),
      new Set([106]),
    );
    expect(segundo).not.toBe(primeiro);
    expect(segundo).toBeGreaterThan(0);
  });

  test('retroativo em lote: dia 20 Gabriela e dia 21 Henrique (domingo já com Gabriela da Ana)', async () => {
    const ordem = [106, 107, 108, 101, 102, 103, 104, 105];
    const afastamentos = new Map([
      [101, [{ tipo: { tipo: 'Férias' }, dataInicio: '2026-06-08', dataFim: '2026-06-19' }]],
      [106, [{ tipo: { tipo: 'Abono' }, dataInicio: '2026-06-22', dataFim: '2026-06-22' }]],
    ]);
    const plantoes = [
      {
        id: 1,
        dataReferencia: '2026-06-20',
        usuarioId: 106,
        categoriaPlantao: 'veterinario',
        save: jest.fn().mockResolvedValue(undefined),
      },
      {
        id: 2,
        dataReferencia: '2026-06-21',
        usuarioId: 107,
        categoriaPlantao: 'veterinario',
        save: jest.fn().mockResolvedValue(undefined),
      },
    ];
    await processarRetroativoFocadoEmLote({
      plantoes,
      usuarioAfetadoId: 106,
      inicioAfastamentoIso: '2026-06-22',
      categoriaPlantaoAlvo: 'veterinario',
      ordemAtual: [...ordem],
      ordemGlobal: [...ordem],
      idxInicial: 0,
      afastamentosPorUsuario: afastamentos,
      datasNaoUteisIsoSet: new Set(),
      transaction: null,
      rotuloProfissional: 'Veterinário',
    });
    expect(plantoes[0].usuarioId).toBe(107);
    expect(plantoes[1].usuarioId).toBe(108);
  });

  test('idx em 01/07 segue último titular de junho na ordem BCDEGHFA', () => {
    const ordem = [102, 103, 104, 105, 107, 108, 106, 101];
    const plantoes = [
      { dataReferencia: '2026-06-27', categoriaPlantao: 'veterinario', usuarioId: 101, vagaIndice: 0 },
      { dataReferencia: '2026-06-28', categoriaPlantao: 'veterinario', usuarioId: 102, vagaIndice: 0 },
    ];
    expect(obterIdxRodizioAposUltimoPlantaoAntesDe(plantoes, ordem, '2026-07-01', 'veterinario')).toBe(1);
  });

  test('idx técnico em 01/07 segue vaga 1 do último dia de junho (não só vaga 0)', () => {
    const ordem = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const plantoes = [
      { dataReferencia: '2026-06-28', categoriaPlantao: 'tecnico', usuarioId: 15, vagaIndice: 0 },
      { dataReferencia: '2026-06-28', categoriaPlantao: 'tecnico', usuarioId: 16, vagaIndice: 1 },
    ];
    expect(obterIdxRodizioAposUltimoPlantaoAntesDe(plantoes, ordem, '2026-07-01', 'tecnico')).toBe(0);
    expect(
      ordem[obterIdxRodizioAposUltimoPlantaoAntesDe(plantoes, ordem, '2026-07-01', 'tecnico')],
    ).toBe(1);
    const { simularRodizioTecPlantoes } = require('../escala.service').__testables;
    const jul = ['2026-07-04', '2026-07-05'];
    const idx = obterIdxRodizioAposUltimoPlantaoAntesDe(plantoes, ordem, '2026-07-01', 'tecnico');
    const { alocacoes } = simularRodizioTecPlantoes(ordem, jul, [], new Set(), idx);
    const letras = (uid) => ({ 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F', 7: 'G', 8: 'H', 9: 'I', 10: 'J', 11: 'K', 12: 'L', 13: 'M', 14: 'N', 15: 'O', 16: 'P' }[uid]);
    const seq = alocacoes.map((a) => letras(a.usuarioId)).join('');
    expect(seq.startsWith('AB')).toBe(true);
  });

  test('retorno de Ana em 27/06 não deve ser reforçado em julho', () => {
    const plantoes = [
      { dataReferencia: '2026-06-27', categoriaPlantao: 'veterinario', usuarioId: 101, vagaIndice: 0 },
    ];
    const retornos = new Map([['2026-06-27', [101]]]);
    expect(
      usuarioRetornoFeriasAbonoJaRealizadoAntesDe(101, '2026-07-01', retornos, plantoes, 'veterinario'),
    ).toBe(true);
    expect(
      usuarioRetornoFeriasAbonoJaRealizadoAntesDe(101, '2026-07-01', retornos, []),
    ).toBe(false);
  });

  test('retorno Ana (férias 08–19): primeiro plantão 27; fila após pular dia 27 aloca Ana no 28', () => {
    const ordem = [106, 107, 108, 101, 102, 103, 104, 105];
    const plantoesJunho = ['2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14', '2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28'].map(
      (ds) => ({ dataReferencia: ds, categoriaPlantao: 'veterinario' }),
    );
    const afAna = [{ tipo: { tipo: 'Férias' }, usuarioId: 101, dataInicio: '2026-06-08', dataFim: '2026-06-19' }];
    const retornos = montarRetornosFeriasNoPrimeiroPlantao(afAna, plantoesJunho, new Set());
    expect(retornos.get('2026-06-27')).toEqual([101]);

    const fila = [];
    const mapa = new Map([[101, afAna]]);
    enfileirarRetornosFeriasDoDia('2026-06-27', ordem, retornos, mapa, new Set(), fila);
    expect(fila).toEqual([101]);

    const retornoDia28 = escolherRetornoFeriasDoDia(fila, ordem, ordem.indexOf(108), mapa, '2026-06-28', new Set());
    expect(retornoDia28).toBe(101);
  });

  test('Bruno 05/06 com outros posteriores exige recálculo pleno (início mais cedo)', () => {
    const outros = [
      { dataInicio: '2026-06-08', dataFim: '2026-06-19' },
      { dataInicio: '2026-06-15', dataFim: '2026-06-15' },
      { dataInicio: '2026-06-22', dataFim: '2026-06-22' },
    ];
    expect(afastamentoExigeRecalculoPlenoComHistoricoInicial('2026-06-05', outros)).toBe(true);
  });

  test('Ana 08/06 com Bruno 05 anterior não exige recálculo pleno', () => {
    const outros = [{ dataInicio: '2026-06-05', dataFim: '2026-06-12' }];
    expect(afastamentoExigeRecalculoPlenoComHistoricoInicial('2026-06-08', outros)).toBe(false);
  });

  test('aplicarOrdemInicialHistoricoRodizio aceita histórico sem exigir mesmo tamanho bruto', () => {
    const membros = [101, 102, 103, 104, 105, 106, 107, 108];
    const hist = [102, 103, 104, 105, 106, 107, 108, 101, 105];
    const out = aplicarOrdemInicialHistoricoRodizio(hist, membros);
    expect(out).toHaveLength(8);
    expect(new Set(out).size).toBe(8);
  });

  test('Elisa 15/06 com Ana anterior mantém recálculo focalizado', () => {
    const outros = [
      { dataInicio: '2026-06-08', dataFim: '2026-06-19' },
      { dataInicio: '2026-06-22', dataFim: '2026-06-22' },
    ];
    expect(afastamentoExigeRecalculoPlenoComHistoricoInicial('2026-06-15', outros)).toBe(false);
  });

  test('normalizarOrdemRodizioCompleta remove duplicata e repõe membro faltante', () => {
    const membros = [101, 102, 103, 104, 105, 106, 107, 108];
    const corrompida = [102, 103, 104, 106, 105, 107, 101, 106];
    const out = normalizarOrdemRodizioCompleta(corrompida, membros);
    expect(out).toHaveLength(8);
    expect(new Set(out).size).toBe(8);
    for (const id of membros) {
      expect(out).toContain(id);
    }
  });

  test('atestado não aplica retroativo', () => {
    const mapa = new Map([
      [
        10,
        [
          {
            tipo: { tipo: 'Atestado' },
            dataInicio: '2026-06-08',
            dataFim: '2026-06-08',
            createdAt: '2026-06-08T10:00:00.000Z',
          },
        ],
      ],
    ]);
    expect(usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(mapa, 10, '2026-06-06', new Set())).toBe(false);
  });
});
