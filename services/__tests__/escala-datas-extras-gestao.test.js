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

jest.mock('../../auth/sequelize-transaction', () => ({
  sequelizeTransaction: async (fn) => fn({}),
}));

const EscalaService = require('../escala.service');

const {
  textoGestaoDataAdicionalPlantao,
  obterIdxRodizioAposUltimoPlantaoAntesDe,
  rotacionarOrdemParaProximoPreferencial,
  simularRodizioVetPlantoes,
  simularRodizioTecPlantoes,
} = EscalaService.__testables;

describe('datas extras em modo gestão (escala ativa)', () => {
  test('texto de observação de gestão para data adicional', () => {
    expect(textoGestaoDataAdicionalPlantao()).toBe('Gestão - Feriado ou data adicional de plantão');
  });

  test('simulação para data extra não altera ordem persistida dos membros', () => {
    const ordemVet = [1, 2, 3];
    const ordemTec = [10, 11, 12, 13];
    const plantoesExistentes = [
      { dataReferencia: '2026-06-07', categoriaPlantao: 'veterinario', vagaIndice: 0, usuarioId: 1 },
      { dataReferencia: '2026-06-07', categoriaPlantao: 'tecnico', vagaIndice: 0, usuarioId: 10 },
      { dataReferencia: '2026-06-07', categoriaPlantao: 'tecnico', vagaIndice: 1, usuarioId: 11 },
      { dataReferencia: '2026-06-08', categoriaPlantao: 'veterinario', vagaIndice: 0, usuarioId: 2 },
      { dataReferencia: '2026-06-08', categoriaPlantao: 'tecnico', vagaIndice: 0, usuarioId: 12 },
      { dataReferencia: '2026-06-08', categoriaPlantao: 'tecnico', vagaIndice: 1, usuarioId: 13 },
    ];
    const dataExtra = '2026-06-09';
    const idxVet = obterIdxRodizioAposUltimoPlantaoAntesDe(plantoesExistentes, ordemVet, dataExtra, 'veterinario');
    const idxTec = obterIdxRodizioAposUltimoPlantaoAntesDe(plantoesExistentes, ordemTec, dataExtra, 'tecnico', ordemTec);
    const ordemVetRot = rotacionarOrdemParaProximoPreferencial(ordemVet, idxVet);
    const ordemTecRot = rotacionarOrdemParaProximoPreferencial(ordemTec, idxTec);

    const simVet = simularRodizioVetPlantoes(ordemVetRot, [dataExtra], [], new Set());
    const simTec = simularRodizioTecPlantoes(ordemTecRot, [dataExtra], [], new Set(), 0, plantoesExistentes, dataExtra);

    expect(simVet.alocacoes).toHaveLength(1);
    expect(simVet.alocacoes[0].usuarioId).toBe(3);
    expect(simTec.alocacoes).toHaveLength(2);
    expect(ordemVet).toEqual([1, 2, 3]);
    expect(ordemTec).toEqual([10, 11, 12, 13]);
  });
});
