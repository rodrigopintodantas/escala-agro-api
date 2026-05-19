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
  } = EscalaService.__testables;

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
