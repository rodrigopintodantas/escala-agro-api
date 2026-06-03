/**
 * Overlay de permutas por ordinal (camada aplicada sobre o rodízio puro).
 *
 * Regras validadas (decisões do produto):
 *  - A permuta amarra (servidor, N-ésimo plantão por data). A troca "segue o nome" mesmo que a
 *    data do plantão mude em recálculos.
 *  - Técnicos: a permuta é por DIA (não por vaga) — a pessoa aparece no máximo uma vez por data.
 *  - Ordinal inexistente (a pessoa passou a ter menos plantões) invalida a permuta.
 */
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

const { aplicarOverlayPermutasNasAlocacoes } = EscalaService.__testables;

const ANA = 1;
const BRUNO = 2;
const CARLA = 3;

describe('Overlay de permuta por ordinal — veterinários', () => {
  /** Ana = 1º vet, Carla = 3º vet (8 vets ABCDEFGH → rodízio simples nas datas de teste). */
  function calendarioVet() {
    return [
      { dataIso: '2026-07-04', usuarioId: ANA },
      { dataIso: '2026-07-11', usuarioId: BRUNO },
      { dataIso: '2026-07-18', usuarioId: CARLA },
      { dataIso: '2026-08-01', usuarioId: ANA },
      { dataIso: '2026-08-08', usuarioId: CARLA },
      { dataIso: '2026-08-29', usuarioId: ANA },
    ];
  }

  it('troca o 3º plantão de Ana com o 2º de Carla (overlay sobre o base)', () => {
    const permutas = [
      { id: 10, categoria: 'veterinario', usuarioA: ANA, ordinalA: 3, usuarioB: CARLA, ordinalB: 2 },
    ];
    const { alocacoesVet, permutasInvalidadasIds } = aplicarOverlayPermutasNasAlocacoes(
      calendarioVet(),
      [],
      permutas,
    );
    expect(permutasInvalidadasIds).toEqual([]);
    const porData = Object.fromEntries(alocacoesVet.map((a) => [a.dataIso, a.usuarioId]));
    // 3º plantão de Ana (29/08) passa a ser Carla; 2º de Carla (08/08) passa a ser Ana
    expect(porData['2026-08-29']).toBe(CARLA);
    expect(porData['2026-08-08']).toBe(ANA);
    // demais plantões intactos
    expect(porData['2026-07-04']).toBe(ANA);
    expect(porData['2026-08-01']).toBe(ANA);
  });

  it('a troca "segue o nome" quando a data do 3º plantão de Ana muda (ex.: feriado realocou)', () => {
    // Mesma escala, mas o 3º plantão de Ana caiu para 27/08 (em vez de 29/08).
    const base = [
      { dataIso: '2026-07-04', usuarioId: ANA },
      { dataIso: '2026-07-18', usuarioId: CARLA },
      { dataIso: '2026-08-01', usuarioId: ANA },
      { dataIso: '2026-08-08', usuarioId: CARLA },
      { dataIso: '2026-08-27', usuarioId: ANA },
    ];
    const permutas = [
      { id: 10, categoria: 'veterinario', usuarioA: ANA, ordinalA: 3, usuarioB: CARLA, ordinalB: 2 },
    ];
    const { alocacoesVet } = aplicarOverlayPermutasNasAlocacoes(base, [], permutas);
    const porData = Object.fromEntries(alocacoesVet.map((a) => [a.dataIso, a.usuarioId]));
    expect(porData['2026-08-27']).toBe(CARLA); // a nova data do 3º de Ana
    expect(porData['2026-08-08']).toBe(ANA);
  });

  it('invalida a permuta quando o ordinal não existe mais (Ana passou a ter só 2 plantões)', () => {
    const base = [
      { dataIso: '2026-07-04', usuarioId: ANA },
      { dataIso: '2026-08-01', usuarioId: ANA },
      { dataIso: '2026-08-08', usuarioId: CARLA },
    ];
    const permutas = [
      { id: 99, categoria: 'veterinario', usuarioA: ANA, ordinalA: 3, usuarioB: CARLA, ordinalB: 1 },
    ];
    const { alocacoesVet, permutasInvalidadasIds } = aplicarOverlayPermutasNasAlocacoes(base, [], permutas);
    expect(permutasInvalidadasIds).toContain(99);
    // nada trocado
    const porData = Object.fromEntries(alocacoesVet.map((a) => [a.dataIso, a.usuarioId]));
    expect(porData['2026-08-08']).toBe(CARLA);
  });
});

describe('Overlay de permuta por ordinal — técnicos (por dia, não por vaga)', () => {
  const JOAO = 11;
  const MARCOS = 12;
  const PAULO = 13;
  const RITA = 14;

  it('troca João (2º dia dele) com Marcos (1º dia dele), independentemente da vaga', () => {
    // 2 vagas por dia. João aparece na vaga 1 em 04/07 e na vaga 0 em 18/07.
    const baseTec = [
      { dataIso: '2026-07-04', vagaIndice: 0, usuarioId: PAULO },
      { dataIso: '2026-07-04', vagaIndice: 1, usuarioId: JOAO },
      { dataIso: '2026-07-11', vagaIndice: 0, usuarioId: MARCOS },
      { dataIso: '2026-07-11', vagaIndice: 1, usuarioId: RITA },
      { dataIso: '2026-07-18', vagaIndice: 0, usuarioId: JOAO },
      { dataIso: '2026-07-18', vagaIndice: 1, usuarioId: PAULO },
    ];
    const permutas = [
      { id: 20, categoria: 'tecnico', usuarioA: JOAO, ordinalA: 2, usuarioB: MARCOS, ordinalB: 1 },
    ];
    const { alocacoesTec, permutasInvalidadasIds } = aplicarOverlayPermutasNasAlocacoes([], baseTec, permutas);
    expect(permutasInvalidadasIds).toEqual([]);
    // 2º dia de João = 18/07 (vaga 0) → vira Marcos
    const slot1807 = alocacoesTec.find((a) => a.dataIso === '2026-07-18' && a.vagaIndice === 0);
    expect(slot1807.usuarioId).toBe(MARCOS);
    // 1º dia de Marcos = 11/07 (vaga 0) → vira João
    const slot1107 = alocacoesTec.find((a) => a.dataIso === '2026-07-11' && a.vagaIndice === 0);
    expect(slot1107.usuarioId).toBe(JOAO);
    // a outra vaga de cada dia permanece intacta
    expect(alocacoesTec.find((a) => a.dataIso === '2026-07-11' && a.vagaIndice === 1).usuarioId).toBe(RITA);
    expect(alocacoesTec.find((a) => a.dataIso === '2026-07-18' && a.vagaIndice === 1).usuarioId).toBe(PAULO);
  });
});
