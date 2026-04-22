const { Op } = require('sequelize');
const ApiBaseError = require('../auth/base-error');
const sequelizeTransaction = require('../auth/sequelize-transaction');
const {
  EscalaModel,
  EscalaMembroModel,
  PlantaoModel,
  UsuarioModel,
  PapelModel,
  UsuarioPapelModel,
  PermutaSolicitacaoModel,
  ImpedimentoModel,
  AfastamentoModel,
  TipoAfastamentoModel,
  OrdemServidorModel,
  EscalaOrdemHistoricoModel,
} = require('../models');

const PERIODICIDADES = ['fim_de_semana', 'diario', 'semanal', 'quinzenal', 'mensal'];
const REGRA_ORDEM = {
  NAO_ALTERA: 'nao_altera',
  ADIAR_NO_CICLO: 'adiar_no_ciclo',
};

function dataReferenciaParaStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

function dataNoIntervalo(dataIso, iniIso, fimIso) {
  return dataIso >= iniIso && dataIso <= fimIso;
}

/** Ex.: 2026-03-31 → 31/03/2026 */
function formatarDataIsoParaBr(dataVal) {
  const s = dataReferenciaParaStr(dataVal);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function combinarOrdemEscalaNaOrdemGlobal(ordemEscalaIds, ordemGlobalIds) {
  const escala = [...new Set((ordemEscalaIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))];
  const global = [...new Set((ordemGlobalIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))];
  if (escala.length === 0) return global;
  const escalaSet = new Set(escala);
  const restantes = global.filter((id) => !escalaSet.has(id));
  return [...escala, ...restantes];
}

function rotacionarOrdemAposUsuario(ordemIds, usuarioId) {
  const ids = (ordemIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  const uid = Number(usuarioId);
  if (ids.length === 0) return ids;
  const idx = ids.indexOf(uid);
  if (idx < 0) return ids;
  return [...ids.slice(idx + 1), ...ids.slice(0, idx + 1)];
}

/**
 * Em escalas já concluídas, qualquer recálculo posterior deve preservar a regra de conclusão:
 * a ordem global deve iniciar após o veterinário do último plantão, respeitando o ciclo da
 * ordem final dos membros daquela escala.
 */
async function reaplicarRotacaoOrdemGlobalSeEscalaConcluida(escalaId, statusEscala, transaction) {
  const st = String(statusEscala || '').toLowerCase();
  if (st !== 'concluida') return false;

  const membros = await EscalaMembroModel.findAll({
    where: { escalaId, ativo: true },
    attributes: ['usuarioId', 'ordem'],
    order: [['ordem', 'ASC']],
    transaction,
  });
  const ordemEscala = membros.map((m) => Number(m.usuarioId)).filter((id) => Number.isFinite(id) && id > 0);
  if (ordemEscala.length === 0) return false;

  const ultimoPlantao = await PlantaoModel.findOne({
    where: { escalaId },
    order: [
      ['dataReferencia', 'DESC'],
      ['id', 'DESC'],
    ],
    transaction,
  });
  if (!ultimoPlantao) return false;

  const ordemGlobalAtual = await obterOrdemGlobalUsuarioIds(transaction);
  if (!Array.isArray(ordemGlobalAtual) || ordemGlobalAtual.length === 0) return false;

  const ordemEscalaRotacionada = rotacionarOrdemAposUsuario(ordemEscala, ultimoPlantao.usuarioId);
  const novaOrdemGlobal = combinarOrdemEscalaNaOrdemGlobal(ordemEscalaRotacionada, ordemGlobalAtual);
  const mudou = novaOrdemGlobal.join(',') !== ordemGlobalAtual.join(',');
  if (mudou) {
    await atualizarOrdemServidoresGlobalSemColisao(novaOrdemGlobal, transaction);
  }
  return mudou;
}

function ehFimDeSemanaDataReferencia(val) {
  const s = dataReferenciaParaStr(val);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00`);
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

function listarDatasFinsDeSemana(dataInicioStr, dataFimStr) {
  const out = [];
  const cur = new Date(`${dataInicioStr}T12:00:00`);
  const end = new Date(`${dataFimStr}T12:00:00`);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow === 0 || dow === 6) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      out.push(`${y}-${m}-${d}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Primeiras `quantidade` datas de fim de semana (sáb/dom) **após** `dataFimStr` (não inclui o último dia do período).
 * Alinhado à geração automática de plantões na criação da escala.
 */
function proximasDatasFinsDeSemanaApos(dataFimStr, quantidade) {
  const n = Math.min(Math.max(parseInt(quantidade, 10) || 8, 1), 100);
  const out = [];
  const cur = new Date(`${dataFimStr}T12:00:00`);
  cur.setDate(cur.getDate() + 1);
  while (out.length < n) {
    const dow = cur.getDay();
    if (dow === 0 || dow === 6) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      out.push(`${y}-${m}-${d}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function mergeDatasPlantaoPrevisto(dataInicioStr, dataFimStr, datasPlantaoExtras) {
  const fds = listarDatasFinsDeSemana(dataInicioStr, dataFimStr);
  const inicio = new Date(`${dataInicioStr}T12:00:00`);
  const fim = new Date(`${dataFimStr}T12:00:00`);
  const extrasNorm = [];
  if (Array.isArray(datasPlantaoExtras)) {
    for (const raw of datasPlantaoExtras) {
      if (raw == null || typeof raw !== 'string') continue;
      const ds = raw.trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) throw new ApiBaseError(`Data adicional inválida: ${raw}`);
      const d = new Date(`${ds}T12:00:00`);
      if (d < inicio || d > fim) {
        throw new ApiBaseError(`Data adicional ${ds} está fora do intervalo da escala (${dataInicioStr} a ${dataFimStr}).`);
      }
      extrasNorm.push(ds);
    }
  }
  return [...new Set([...fds, ...extrasNorm])].sort();
}

function moverUsuarioDepoisDaCobertura(ordemUsuarioIds, ausenteId, coberturaId) {
  if (ausenteId === coberturaId) return ordemUsuarioIds;
  const ordem = [...ordemUsuarioIds];
  const idxAusente = ordem.indexOf(ausenteId);
  const idxCobertura = ordem.indexOf(coberturaId);
  if (idxAusente < 0 || idxCobertura < 0) return ordem;
  ordem.splice(idxAusente, 1);
  const novoIdxCobertura = ordem.indexOf(coberturaId);
  ordem.splice(novoIdxCobertura + 1, 0, ausenteId);
  return ordem;
}

function moverUsuarioAntesDeReferencia(ordemUsuarioIds, usuarioMovidoId, referenciaId) {
  if (usuarioMovidoId === referenciaId) return ordemUsuarioIds;
  const ordem = [...ordemUsuarioIds];
  const idxMovido = ordem.indexOf(usuarioMovidoId);
  const idxRef = ordem.indexOf(referenciaId);
  if (idxMovido < 0 || idxRef < 0) return ordem;
  ordem.splice(idxMovido, 1);
  const novoIdxRef = ordem.indexOf(referenciaId);
  ordem.splice(novoIdxRef, 0, usuarioMovidoId);
  return ordem;
}

function montarAfastamentosPorUsuario(afastamentos) {
  const mapa = new Map();
  for (const af of afastamentos) {
    const uid = Number(af.usuarioId);
    if (!Number.isFinite(uid)) continue;
    const atual = mapa.get(uid) || [];
    atual.push(af);
    mapa.set(uid, atual);
  }
  return mapa;
}

function afastamentosAtivosNoDia(afastamentosPorUsuario, usuarioId, dataIso) {
  const lista = afastamentosPorUsuario.get(Number(usuarioId)) || [];
  return lista.filter((af) => dataNoIntervalo(dataIso, dataReferenciaParaStr(af.dataInicio), dataReferenciaParaStr(af.dataFim)));
}

function normalizarTextoSemAcento(v) {
  if (typeof v !== 'string') return '';
  return v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function tipoAfastamentoNormalizado(af) {
  return normalizarTextoSemAcento(af?.tipo?.tipo);
}

function afastamentoEhFerias(af) {
  return tipoAfastamentoNormalizado(af) === 'ferias';
}

function afastamentoEhAtestadoOuAbono(af) {
  const tipo = tipoAfastamentoNormalizado(af);
  return tipo === 'atestado' || tipo === 'abono';
}

function adicionarDiasIso(dataIso, dias) {
  const d = new Date(`${dataIso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return dataReferenciaParaStr(d);
}

function diaUtilDataIso(dataIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataIso || ''))) return false;
  const d = new Date(`${dataIso}T12:00:00`);
  const dow = d.getDay();
  return dow >= 1 && dow <= 5;
}

/**
 * Verifica se existe pelo menos um dia útil em [inicioInclusivo, fimExclusivo).
 */
function existeDiaUtilNoIntervalo(inicioInclusivoIso, fimExclusivoIso, datasNaoUteisIsoSet = new Set()) {
  if (!inicioInclusivoIso || !fimExclusivoIso) return false;
  let cur = new Date(`${inicioInclusivoIso}T12:00:00`);
  const end = new Date(`${fimExclusivoIso}T12:00:00`);
  while (cur < end) {
    const iso = dataReferenciaParaStr(cur);
    if (diaUtilDataIso(iso) && !datasNaoUteisIsoSet.has(iso)) return true;
    cur.setDate(cur.getDate() + 1);
  }
  return false;
}

/**
 * Férias: antes de completar ao menos 1 dia útil pós-fim, o usuário ainda não pode ser escalado.
 * Ex.: fim na sexta -> sábado/domingo continuam indisponíveis; libera após passar por 1 dia útil.
 */
function usuarioBloqueadoPosFeriasNoDia(afastamentosPorUsuario, usuarioId, dataIso, datasNaoUteisIsoSet = new Set()) {
  const lista = afastamentosPorUsuario.get(Number(usuarioId)) || [];
  for (const af of lista) {
    if (!afastamentoEhFerias(af)) continue;
    const fimIso = dataReferenciaParaStr(af.dataFim);
    if (!fimIso || !(dataIso > fimIso)) continue;
    const primeiroDiaPosFim = adicionarDiasIso(fimIso, 1);
    /**
     * Regra: só libera após existir ao menos 1 dia útil *antes* deste plantão.
     * Não considerar o próprio `dataIso` (ex.: plantão extra em segunda/feriado) como
     * "dia útil já trabalhado", senão o usuário é liberado cedo demais.
     */
    const jaPassouDiaUtil = existeDiaUtilNoIntervalo(primeiroDiaPosFim, dataIso, datasNaoUteisIsoSet);
    if (!jaPassouDiaUtil) return true;
  }
  return false;
}

function usuarioIndisponivelParaPlantaoNoDia(
  afastamentosPorUsuario,
  usuarioId,
  dataIso,
  datasNaoUteisIsoSet = new Set(),
) {
  if (afastamentosAtivosNoDia(afastamentosPorUsuario, usuarioId, dataIso).length > 0) return true;
  if (usuarioBloqueadoPosFeriasNoDia(afastamentosPorUsuario, usuarioId, dataIso, datasNaoUteisIsoSet)) return true;
  return false;
}

/**
 * Mantém comportamento de adiar no ciclo para férias, atestado e abono:
 * - adiar no ciclo durante cobertura;
 * Férias/Atestado/Abono ficam explícitos por tipo para permitir evoluções independentes.
 */
function afastamentoDeveAdiarNoCiclo(af) {
  if (afastamentoEhFerias(af) || afastamentoEhAtestadoOuAbono(af)) return true;
  return (af?.tipo?.regraOrdem || REGRA_ORDEM.NAO_ALTERA) === REGRA_ORDEM.ADIAR_NO_CICLO;
}

/**
 * Mapeia, para cada data de plantão, os usuários com retorno obrigatório:
 * - Férias: primeiro plantão após ter trabalhado ao menos 1 dia útil pós-fim;
 * - Atestado/Abono: primeiro plantão após o fim.
 */
function montarRetornosFeriasNoPrimeiroPlantao(afastamentos, plantoes) {
  const mapa = new Map();
  if (!Array.isArray(afastamentos) || !Array.isArray(plantoes) || plantoes.length === 0) {
    return mapa;
  }
  const datasPlantoes = plantoes.map((p) => dataReferenciaParaStr(p.dataReferencia));
  for (const af of afastamentos) {
    const ehFerias = afastamentoEhFerias(af);
    const ehAtestadoOuAbono = afastamentoEhAtestadoOuAbono(af);
    if (!ehFerias && !ehAtestadoOuAbono) continue;
    const usuarioId = Number(af.usuarioId);
    if (!Number.isFinite(usuarioId)) continue;
    const fimIso = dataReferenciaParaStr(af.dataFim);
    if (!fimIso) continue;
    let primeiraDataPosRetorno = null;
    if (ehFerias) {
      const primeiroDiaPosFim = adicionarDiasIso(fimIso, 1);
      primeiraDataPosRetorno = datasPlantoes.find(
        (ds) => ds > fimIso && existeDiaUtilNoIntervalo(primeiroDiaPosFim, ds),
      );
    } else {
      primeiraDataPosRetorno = datasPlantoes.find((ds) => ds > fimIso);
    }
    if (!primeiraDataPosRetorno) continue;
    const atual = mapa.get(primeiraDataPosRetorno) || [];
    if (!atual.includes(usuarioId)) {
      atual.push(usuarioId);
      mapa.set(primeiraDataPosRetorno, atual);
    }
  }
  return mapa;
}

function escolherRetornoFeriasDoDia(
  retornosHoje,
  ordemAtual,
  idxPreferencial,
  afastamentosPorUsuario,
  dataIso,
  datasNaoUteisIsoSet = new Set(),
) {
  if (!Array.isArray(retornosHoje) || retornosHoje.length === 0 || ordemAtual.length === 0) {
    return null;
  }
  let escolhido = null;
  let menorDistancia = Number.MAX_SAFE_INTEGER;
  for (const uidRaw of retornosHoje) {
    const uid = Number(uidRaw);
    const idx = ordemAtual.indexOf(uid);
    if (idx < 0) continue;
    if (usuarioIndisponivelParaPlantaoNoDia(afastamentosPorUsuario, uid, dataIso, datasNaoUteisIsoSet)) continue;
    const distancia = (idx - idxPreferencial + ordemAtual.length) % ordemAtual.length;
    if (distancia < menorDistancia) {
      menorDistancia = distancia;
      escolhido = uid;
    }
  }
  return escolhido;
}

async function obterOrdemAtualDaEscala(escalaId, transaction) {
  const membros = await EscalaMembroModel.findAll({
    where: { escalaId, ativo: true },
    order: [['ordem', 'ASC']],
    transaction,
  });
  if (membros.length === 0) {
    throw new ApiBaseError('Escala sem membros no rodízio.');
  }
  return membros;
}

async function registrarHistoricoOrdem({
  escalaId,
  ordemUsuarioIds,
  ordemUsuarioIdsAntes = null,
  ordemGlobalUsuarioIds = null,
  motivo,
  tipoAfastamentoId = null,
  afastamentoId = null,
  transaction,
}) {
  await EscalaOrdemHistoricoModel.create(
    {
      escalaId,
      motivo,
      tipoAfastamentoId,
      afastamentoId,
      ordemUsuarioIds: ordemUsuarioIds.map((id) => Number(id)),
      ordemUsuarioIdsAntes:
        Array.isArray(ordemUsuarioIdsAntes) && ordemUsuarioIdsAntes.length > 0
          ? ordemUsuarioIdsAntes.map((id) => Number(id))
          : null,
      ordemGlobalUsuarioIds:
        Array.isArray(ordemGlobalUsuarioIds) && ordemGlobalUsuarioIds.length > 0
          ? ordemGlobalUsuarioIds.map((id) => Number(id))
          : null,
    },
    { transaction },
  );
}

async function cancelarPermutasPendentesEscala(escalaId, transaction) {
  const [permutasCanceladas] = await PermutaSolicitacaoModel.update(
    { status: 'cancelada' },
    {
      where: { escalaId, status: 'pendente' },
      transaction,
    },
  );
  return permutasCanceladas;
}

async function atualizarOrdemMembrosEscalaSemColisao(escalaId, ordemUsuarioIds, transaction) {
  // Passo 1: move todos para ordens temporárias negativas, evitando colisão do índice único (escala_id, ordem).
  for (let i = 0; i < ordemUsuarioIds.length; i++) {
    const usuarioId = Number(ordemUsuarioIds[i]);
    await EscalaMembroModel.update(
      { ordem: -(i + 1) },
      {
        where: { escalaId, usuarioId },
        transaction,
      },
    );
  }

  // Passo 2: aplica a ordem final positiva.
  for (let i = 0; i < ordemUsuarioIds.length; i++) {
    const usuarioId = Number(ordemUsuarioIds[i]);
    await EscalaMembroModel.update(
      { ordem: i + 1 },
      {
        where: { escalaId, usuarioId },
        transaction,
      },
    );
  }
}

/** Ordem global de todos os veterinários ativos (tabela `ordem_servidor`), com fallback para novos sem linha. */
async function obterOrdemGlobalUsuarioIds(transaction) {
  const papelVet = await PapelModel.findOne({ where: { nome: 'Veterinario' } });
  if (!papelVet) return [];

  const vets = await UsuarioModel.findAll({
    include: [{ model: UsuarioPapelModel, required: true, where: { PapelModelId: papelVet.id } }],
    where: { ativo: true },
    attributes: ['id', 'nome'],
    order: [['nome', 'ASC']],
    transaction,
  });
  const vetIds = vets.map((v) => Number(v.id));
  const vetSet = new Set(vetIds);

  const rows = await OrdemServidorModel.findAll({
    order: [['ordem', 'ASC']],
    transaction,
  });
  const ordered = rows.map((r) => Number(r.usuarioId)).filter((id) => vetSet.has(id));
  const inOrdered = new Set(ordered);
  const missing = vetIds.filter((id) => !inOrdered.has(id));
  return [...ordered, ...missing];
}

/** Persiste ordem global; substitui linhas para evitar colisão de índice único em `ordem`. */
async function atualizarOrdemServidoresGlobalSemColisao(ordemUsuarioIds, transaction) {
  const ids = ordemUsuarioIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return;

  await OrdemServidorModel.destroy({ where: {}, transaction });
  await OrdemServidorModel.bulkCreate(
    ids.map((usuarioId, idx) => ({
      usuarioId,
      ordem: idx + 1,
    })),
    { transaction },
  );
}

async function recalcularEscalaInterno(
  escalaId,
  {
    transaction,
    historicoMotivo = null,
    historicoAfastamento = null,
    /**
     * Se true, não aplica bootstrap por snapshot do primeiro afastamento; em vez disso, inicia
     * `ordemAtual` e `ordemGlobal` a partir do histórico `motivo: 'inicial'` da escala (criação).
     * Membros na BD guardam o fim do ciclo simulado — usar isso como início com `idxOrdem=0` coloca
     * a pessoa errada no primeiro plantão (ex.: Carla em vez de Ana).
     * O mesmo recorte `inicial` aplica-se em `apos_desfazer_afastamento`: o snapshot do afastamento
     * removido não coincide com o rodízio da criação (ex.: Bruno no 1º dia em vez de Ana).
     * Em `afastamento`, quando não há bootstrap `maisTarde` (ver bloco abaixo), também se usa `inicial`:
     * membros na BD são o fim do ciclo (ex.: pós-Bruno) e não o início do rodízio para o 1º plantão.
     */
    skipBootstrap = false,
  } = {},
) {
  const escala = await EscalaModel.findByPk(escalaId, { transaction });
  if (!escala) {
    throw new ApiBaseError('Escala não encontrada.');
  }
  const dataInicioStr = dataReferenciaParaStr(escala.dataInicio);
  const dataFimStr = dataReferenciaParaStr(escala.dataFim);

  const membros = await obterOrdemAtualDaEscala(escalaId, transaction);
  /** Estado persistido antes deste recálculo (comparação e histórico). */
  const ordemAtualDbInicial = membros.map((m) => Number(m.usuarioId));
  let ordemAtual = [...ordemAtualDbInicial];

  const ordemGlobalDbInicial = await obterOrdemGlobalUsuarioIds(transaction);
  let ordemGlobal = [...ordemGlobalDbInicial];

  /** Inclui datas extras, desfazer afastamento, e afastamento sem bootstrap `maisTarde`. */
  let usarHistoricoInicialRodizio = skipBootstrap || historicoMotivo === 'apos_desfazer_afastamento';

  /**
   * Ao recalcular por um afastamento A com fim em D, afastamentos já cadastrados com início > D
   * (ex.: Ana em junho quando se recalcula Bruno em maio) já alteraram ordem global/membro na BD.
   * Para simular o tempo de forma coerente, inicia-se a partir dos snapshots "antes" do afastamento
   * posterior mais cedo no calendário (efeitos de junho ainda não aplicados ao simular maio).
   * Se **não** existir esse "mais tarde", não se deve usar `membros` como início do rodízio — usa-se o histórico `inicial`.
   */
  if (historicoMotivo === 'afastamento' && historicoAfastamento) {
    const afFimRef = dataReferenciaParaStr(historicoAfastamento.dataFim);
    const idAtual = Number(historicoAfastamento.id);
    const outros = await AfastamentoModel.findAll({
      where: {
        id: { [Op.ne]: idAtual },
        dataInicio: { [Op.lte]: dataFimStr },
        dataFim: { [Op.gte]: dataInicioStr },
      },
      include: [{ model: TipoAfastamentoModel, as: 'tipo', attributes: ['id', 'regraOrdem'] }],
      transaction,
    });
    const maisTarde = outros
      .filter((a) => dataReferenciaParaStr(a.dataInicio) > afFimRef)
      .sort((a, b) => dataReferenciaParaStr(a.dataInicio).localeCompare(dataReferenciaParaStr(b.dataInicio)));
    if (maisTarde.length > 0) {
      const primeiro = maisTarde[0];
      if (Array.isArray(primeiro.ordemGlobalUsuarioIdsAntes) && primeiro.ordemGlobalUsuarioIdsAntes.length > 0) {
        ordemGlobal = primeiro.ordemGlobalUsuarioIdsAntes.map((x) => Number(x));
      }
      const hist = await EscalaOrdemHistoricoModel.findOne({
        where: { escalaId, afastamentoId: Number(primeiro.id) },
        order: [['id', 'DESC']],
        transaction,
      });
      if (hist && Array.isArray(hist.ordemUsuarioIdsAntes) && hist.ordemUsuarioIdsAntes.length > 0) {
        ordemAtual = hist.ordemUsuarioIdsAntes.map((x) => Number(x));
      }
    } else {
      usarHistoricoInicialRodizio = true;
    }
  } else if (!skipBootstrap && historicoMotivo === 'recalculo') {
    /**
     * Sem bootstrap, a BD já pode refletir efeitos de afastamentos "posteriores" no calendário enquanto
     * se simula desde o início da escala. Aplica-se em recálculo por período genérico.
     * **Não** aplicar em `apos_desfazer_afastamento` (bootstrap do 1º afastamento): a reposição feita em
     * `restaurarOrdemEGlobalAntesDesfazerAfastamento` não deve ser sobrescrita pelo snapshot de Ana/etc.
     * O início da simulação nesse motivo usa o histórico `inicial` (bloco abaixo), como em datas extras.
     * Inclusão/exclusão de datas extras usam `skipBootstrap` + esse mesmo bloco `inicial`.
     * Usa-se o primeiro afastamento sobreposto à escala (menor dataInício) e seus snapshots "antes".
     */
    const sobrepostos = await AfastamentoModel.findAll({
      where: {
        usuarioId: { [Op.in]: ordemAtualDbInicial },
        dataInicio: { [Op.lte]: dataFimStr },
        dataFim: { [Op.gte]: dataInicioStr },
      },
      include: [{ model: TipoAfastamentoModel, as: 'tipo', attributes: ['id', 'regraOrdem'] }],
      transaction,
    });
    const ordenados = [...sobrepostos].sort((a, b) =>
      dataReferenciaParaStr(a.dataInicio).localeCompare(dataReferenciaParaStr(b.dataInicio)),
    );
    if (ordenados.length > 0) {
      const primeiro = ordenados[0];
      if (Array.isArray(primeiro.ordemGlobalUsuarioIdsAntes) && primeiro.ordemGlobalUsuarioIdsAntes.length > 0) {
        ordemGlobal = primeiro.ordemGlobalUsuarioIdsAntes.map((x) => Number(x));
      }
      const hist = await EscalaOrdemHistoricoModel.findOne({
        where: { escalaId, afastamentoId: Number(primeiro.id) },
        order: [['id', 'DESC']],
        transaction,
      });
      if (hist && Array.isArray(hist.ordemUsuarioIdsAntes) && hist.ordemUsuarioIdsAntes.length > 0) {
        ordemAtual = hist.ordemUsuarioIdsAntes.map((x) => Number(x));
      }
    }
  }

  if (usarHistoricoInicialRodizio) {
    const histInicial = await EscalaOrdemHistoricoModel.findOne({
      where: { escalaId, motivo: 'inicial' },
      order: [['id', 'ASC']],
      transaction,
    });
    if (histInicial) {
      const plain = histInicial.get ? histInicial.get({ plain: true }) : histInicial;
      const idsInicial = Array.isArray(plain.ordemUsuarioIds)
        ? plain.ordemUsuarioIds.map((x) => Number(x))
        : [];
      const membrosSet = new Set(ordemAtualDbInicial);
      if (
        idsInicial.length > 0 &&
        idsInicial.length === ordemAtualDbInicial.length &&
        idsInicial.every((id) => membrosSet.has(Number(id)))
      ) {
        ordemAtual = idsInicial;
      }
      if (Array.isArray(plain.ordemGlobalUsuarioIds) && plain.ordemGlobalUsuarioIds.length > 0) {
        ordemGlobal = plain.ordemGlobalUsuarioIds.map((x) => Number(x));
      }
    }
  }

  const plantoes = await PlantaoModel.findAll({
    where: { escalaId },
    order: [
      ['dataReferencia', 'ASC'],
      ['id', 'ASC'],
    ],
    transaction,
  });

  const afastamentos = await AfastamentoModel.findAll({
    where: {
      usuarioId: { [Op.in]: ordemAtual },
      dataInicio: { [Op.lte]: dataFimStr },
      dataFim: { [Op.gte]: dataInicioStr },
    },
    include: [{ model: TipoAfastamentoModel, as: 'tipo', attributes: ['id', 'tipo', 'regraOrdem'] }],
    transaction,
  });
  const afastamentosPorUsuario = montarAfastamentosPorUsuario(afastamentos);
  const retornosFeriasNoPrimeiroPlantao = montarRetornosFeriasNoPrimeiroPlantao(afastamentos, plantoes);
  /**
   * Em escalas de fim de semana, plantões adicionais em dias úteis representam feriado/ponto facultativo
   * e não devem contar como "dia útil trabalhado" para liberar retorno de férias.
   */
  const datasNaoUteisParaRetornoFerias =
    String(escala.periodicidade || '').toLowerCase() === 'fim_de_semana'
      ? new Set(
          plantoes
            .map((p) => dataReferenciaParaStr(p.dataReferencia))
            .filter((ds) => !!ds && !ehFimDeSemanaDataReferencia(ds)),
        )
      : new Set();
  /** Retornos de férias já vencidos e ainda não alocados (empates no mesmo dia, indisponibilidade etc.). */
  const filaRetornosFeriasPendentes = [];

  let idxOrdem = 0;
  let atualizados = 0;

  for (const plantao of plantoes) {
    const dataIso = dataReferenciaParaStr(plantao.dataReferencia);
    if (!ordemAtual.length) break;

    const idxPreferencial = idxOrdem % ordemAtual.length;
    const usuarioPreferencial = ordemAtual[idxPreferencial];
    const afastamentosPreferencial = afastamentosAtivosNoDia(afastamentosPorUsuario, usuarioPreferencial, dataIso);
    const preferencialBloqueadoPosFerias = usuarioBloqueadoPosFeriasNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisParaRetornoFerias,
    );
    const preferencialIndisponivel = usuarioIndisponivelParaPlantaoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisParaRetornoFerias,
    );

    let usuarioAlocado = usuarioPreferencial;
    const retornosHoje = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];
    for (const uidRaw of retornosHoje) {
      const uid = Number(uidRaw);
      if (!Number.isFinite(uid)) continue;
      if (!filaRetornosFeriasPendentes.includes(uid)) {
        filaRetornosFeriasPendentes.push(uid);
      }
    }
    const retornoFeriasForcado = escolherRetornoFeriasDoDia(
      filaRetornosFeriasPendentes,
      ordemAtual,
      idxPreferencial,
      afastamentosPorUsuario,
      dataIso,
      datasNaoUteisParaRetornoFerias,
    );

    if (retornoFeriasForcado != null) {
      usuarioAlocado = retornoFeriasForcado;
      /**
       * Retorno de férias é uma alocação obrigatória pontual do dia.
       * Se "fura fila", reposiciona o retornante imediatamente antes do preferencial do dia
       * e avança normalmente o ciclo. Assim evita duplicação/pulo e mantém consumo de 1 slot
       * por plantão (rodízio fecha corretamente no mês seguinte).
       */
      if (Number(usuarioAlocado) !== Number(usuarioPreferencial)) {
        ordemAtual = moverUsuarioAntesDeReferencia(ordemAtual, usuarioAlocado, usuarioPreferencial);
      }
      idxOrdem = (ordemAtual.indexOf(usuarioAlocado) + 1) % ordemAtual.length;
      const idxFila = filaRetornosFeriasPendentes.indexOf(Number(usuarioAlocado));
      if (idxFila >= 0) {
        filaRetornosFeriasPendentes.splice(idxFila, 1);
      }
    } else if (preferencialIndisponivel) {
      let encontrado = null;
      for (let passo = 1; passo <= ordemAtual.length; passo++) {
        const candidato = ordemAtual[(idxPreferencial + passo) % ordemAtual.length];
        if (!usuarioIndisponivelParaPlantaoNoDia(afastamentosPorUsuario, candidato, dataIso, datasNaoUteisParaRetornoFerias)) {
          encontrado = candidato;
          break;
        }
      }

      if (!encontrado) {
        throw new ApiBaseError(`Não há veterinário disponível para o plantão em ${dataIso}.`);
      }

      usuarioAlocado = encontrado;
      const deveAlterarOrdem =
        afastamentosPreferencial.some((af) => afastamentoDeveAdiarNoCiclo(af)) || preferencialBloqueadoPosFerias;

      if (deveAlterarOrdem) {
        ordemAtual = moverUsuarioDepoisDaCobertura(ordemAtual, usuarioPreferencial, usuarioAlocado);
        ordemGlobal = moverUsuarioDepoisDaCobertura(ordemGlobal, usuarioPreferencial, usuarioAlocado);
        idxOrdem = (ordemAtual.indexOf(usuarioAlocado) + 1) % ordemAtual.length;
      } else {
        idxOrdem = (idxPreferencial + 1) % ordemAtual.length;
      }
    } else {
      idxOrdem = (idxPreferencial + 1) % ordemAtual.length;
    }

    if (Number(plantao.usuarioId) !== Number(usuarioAlocado)) {
      /** Sempre persiste alocação simulada; senão o BD fica defasado e idxOrdem diverge (ex.: desfazer afastamento com persistir a partir da data do afastamento). */
      plantao.usuarioId = Number(usuarioAlocado);
      await plantao.save({ transaction });
      atualizados += 1;
    }
  }

  const ordemMudou = ordemAtual.join(',') !== ordemAtualDbInicial.join(',');
  if (ordemMudou) {
    await atualizarOrdemMembrosEscalaSemColisao(escalaId, ordemAtual, transaction);

    if (historicoMotivo) {
      await registrarHistoricoOrdem({
        escalaId,
        ordemUsuarioIds: ordemAtual,
        ordemUsuarioIdsAntes: historicoMotivo === 'afastamento' ? ordemAtualDbInicial : null,
        motivo: historicoMotivo,
        tipoAfastamentoId: historicoAfastamento ? historicoAfastamento.tipoId : null,
        afastamentoId: historicoAfastamento ? historicoAfastamento.id : null,
        transaction,
      });
    }
  }

  const ordemGlobalMudou = ordemGlobal.join(',') !== ordemGlobalDbInicial.join(',');
  if (ordemGlobalMudou && ordemGlobal.length > 0) {
    await atualizarOrdemServidoresGlobalSemColisao(ordemGlobal, transaction);
  }

  return { atualizados, ordemMudou, ordemUsuarioIds: ordemAtual, ordemGlobalMudou };
}

/**
 * Após desfazer um afastamento X, atualiza snapshots "antes" dos afastamentos Y que **ainda começam antes de X**
 * no calendário (ex.: ao desfazer Ana/junho, atualiza Bruno/maio). Quem começa **depois** de X mantém o snapshot
 * gravado na criação (ex.: Ana ao desfazer só Bruno): não sobrescrever com o BD atual, pois esse BD já
 * inclui efeitos de ordem posteriores e quebraria o bootstrap de `recalcularEscalaInterno`.
 */
async function refreshSnapshotsOrdemDeAfastamentosRestantes(transaction, afastamentoRemovidoPlain) {
  const removidoInicio = dataReferenciaParaStr(afastamentoRemovidoPlain.dataInicio);
  const rows = await AfastamentoModel.findAll({ transaction });
  for (const row of rows) {
    const yInicio = dataReferenciaParaStr(row.dataInicio);
    if (!(yInicio < removidoInicio)) continue;

    const og = await obterOrdemGlobalUsuarioIds(transaction);
    await AfastamentoModel.update(
      { ordemGlobalUsuarioIdsAntes: og },
      { where: { id: row.id }, transaction },
    );
    const escalaRows = await EscalaMembroModel.findAll({
      where: { usuarioId: row.usuarioId, ativo: true },
      attributes: ['escalaId'],
      transaction,
    });
    const escalaIds = [...new Set(escalaRows.map((r) => Number(r.escalaId)))];
    for (const escalaId of escalaIds) {
      const temHist = await EscalaOrdemHistoricoModel.findOne({
        where: { escalaId, afastamentoId: Number(row.id) },
        transaction,
      });
      if (!temHist) continue;
      const ordemAtual = (await obterOrdemAtualDaEscala(escalaId, transaction)).map((m) => Number(m.usuarioId));
      await EscalaOrdemHistoricoModel.update(
        { ordemUsuarioIdsAntes: ordemAtual },
        { where: { escalaId, afastamentoId: Number(row.id) }, transaction },
      );
    }
  }
}

async function restaurarOrdemEGlobalAntesDesfazerAfastamento(afastamentoPlain, transaction) {
  const afId = Number(afastamentoPlain.id);
  if (!Number.isFinite(afId)) return;

  const countOutros = await AfastamentoModel.count({
    where: { id: { [Op.ne]: afId } },
    transaction,
  });

  const rowsHist = await EscalaOrdemHistoricoModel.findAll({
    where: { afastamentoId: afId },
    transaction,
    order: [['id', 'DESC']],
  });

  let escalaIdsAfetadas = [...new Set(rowsHist.map((h) => Number(h.escalaId)))];
  if (escalaIdsAfetadas.length === 0) {
    const mem = await EscalaMembroModel.findAll({
      where: { usuarioId: Number(afastamentoPlain.usuarioId), ativo: true },
      attributes: ['escalaId'],
      transaction,
    });
    escalaIdsAfetadas = [...new Set(mem.map((m) => Number(m.escalaId)))];
  }

  /** Nenhum outro afastamento no sistema: volta à ordem gravada em motivo=inicial (escala + ordem geral). */
  if (countOutros === 0) {
    let ordemGlobalInicial = null;
    for (const escalaId of escalaIdsAfetadas) {
      const histInicial = await EscalaOrdemHistoricoModel.findOne({
        where: { escalaId, motivo: 'inicial' },
        order: [['id', 'ASC']],
        transaction,
      });
      if (histInicial && Array.isArray(histInicial.ordemUsuarioIds) && histInicial.ordemUsuarioIds.length > 0) {
        await atualizarOrdemMembrosEscalaSemColisao(
          escalaId,
          histInicial.ordemUsuarioIds.map((x) => Number(x)),
          transaction,
        );
      }
      if (
        ordemGlobalInicial == null &&
        histInicial &&
        Array.isArray(histInicial.ordemGlobalUsuarioIds) &&
        histInicial.ordemGlobalUsuarioIds.length > 0
      ) {
        ordemGlobalInicial = histInicial.ordemGlobalUsuarioIds.map((x) => Number(x));
      }
    }
    if ((!ordemGlobalInicial || ordemGlobalInicial.length === 0) && Array.isArray(afastamentoPlain.ordemGlobalUsuarioIdsAntes)) {
      const og = afastamentoPlain.ordemGlobalUsuarioIdsAntes;
      if (og.length > 0) ordemGlobalInicial = og.map((x) => Number(x));
    }
    if (ordemGlobalInicial && ordemGlobalInicial.length > 0) {
      await atualizarOrdemServidoresGlobalSemColisao(ordemGlobalInicial, transaction);
    }
    return;
  }

  const visto = new Set();
  for (const h of rowsHist) {
    const eid = Number(h.escalaId);
    if (visto.has(eid)) continue;
    visto.add(eid);
    const antes = h.ordemUsuarioIdsAntes;
    if (Array.isArray(antes) && antes.length > 0) {
      await atualizarOrdemMembrosEscalaSemColisao(eid, antes.map((x) => Number(x)), transaction);
    }
  }

  const og = afastamentoPlain.ordemGlobalUsuarioIdsAntes;
  if (Array.isArray(og) && og.length > 0) {
    await atualizarOrdemServidoresGlobalSemColisao(og.map((x) => Number(x)), transaction);
  }
}

/**
 * Recalcula plantões e ordens das escalas em que o usuário participa e cujo período cruza [dataInicioStr, dataFimStr].
 */
async function recalcularEscalasPorUsuarioPeriodoInterno(
  usuarioId,
  dataInicioStr,
  dataFimStr,
  { transactionExterna = null, historicoMotivo = 'recalculo', historicoAfastamento = null } = {},
) {
  const membros = await EscalaMembroModel.findAll({
    where: { usuarioId, ativo: true },
    attributes: ['escalaId'],
    transaction: transactionExterna || undefined,
  });
  const escalaIds = [...new Set(membros.map((m) => Number(m.escalaId)))];
  if (escalaIds.length === 0) {
    return {
      escalasAfetadas: 0,
      plantoesAtualizados: 0,
      ordensAlteradas: 0,
      ordemGlobalAlterada: false,
      permutasCanceladas: 0,
    };
  }

  const escalas = await EscalaModel.findAll({
    where: {
      id: { [Op.in]: escalaIds },
      dataInicio: { [Op.lte]: dataFimStr },
      dataFim: { [Op.gte]: dataInicioStr },
    },
    attributes: ['id', 'status'],
    transaction: transactionExterna || undefined,
  });

  let plantoesAtualizados = 0;
  let ordensAlteradas = 0;
  let ordemGlobalAlterada = false;
  let permutasCanceladas = 0;

  for (const esc of escalas) {
    if (transactionExterna) {
      const recalc = await recalcularEscalaInterno(esc.id, {
        transaction: transactionExterna,
        historicoMotivo,
        historicoAfastamento,
      });
      plantoesAtualizados += recalc.atualizados;
      if (recalc.ordemMudou) ordensAlteradas += 1;
      if (recalc.ordemGlobalMudou) ordemGlobalAlterada = true;
      permutasCanceladas += await cancelarPermutasPendentesEscala(esc.id, transactionExterna);
      if (await reaplicarRotacaoOrdemGlobalSeEscalaConcluida(esc.id, esc.status, transactionExterna)) {
        ordemGlobalAlterada = true;
      }
      continue;
    }

    await sequelizeTransaction(async (t) => {
      const recalc = await recalcularEscalaInterno(esc.id, {
        transaction: t,
        historicoMotivo,
        historicoAfastamento,
      });
      plantoesAtualizados += recalc.atualizados;
      if (recalc.ordemMudou) ordensAlteradas += 1;
      if (recalc.ordemGlobalMudou) ordemGlobalAlterada = true;
      permutasCanceladas += await cancelarPermutasPendentesEscala(esc.id, t);
      if (await reaplicarRotacaoOrdemGlobalSeEscalaConcluida(esc.id, esc.status, t)) {
        ordemGlobalAlterada = true;
      }
    });
  }

  return {
    escalasAfetadas: escalas.length,
    plantoesAtualizados,
    ordensAlteradas,
    ordemGlobalAlterada,
    permutasCanceladas,
  };
}

const EscalaService = {
  usuarioEhAdministrador: async (usuarioId) => {
    const papel = await PapelModel.findOne({ where: { nome: 'ADMIN' } });
    if (!papel) return false;
    const up = await UsuarioPapelModel.findOne({ where: { UsuarioModelId: usuarioId, PapelModelId: papel.id } });
    return !!up;
  },

  listarPermutas: async (usuarioId, verTodasComoAdmin) => {
    const where = verTodasComoAdmin
      ? {}
      : {
          [Op.or]: [{ solicitanteUsuarioId: usuarioId }, { destinatarioUsuarioId: usuarioId }],
        };
    const rows = await PermutaSolicitacaoModel.findAll({
      where,
      include: [
        { model: EscalaModel, as: 'escala', attributes: ['id', 'nome'] },
        { model: UsuarioModel, as: 'solicitante', attributes: ['id', 'nome', 'login'] },
        { model: UsuarioModel, as: 'destinatario', attributes: ['id', 'nome', 'login'] },
        {
          model: PlantaoModel,
          as: 'plantaoOrigem',
          attributes: ['id', 'dataReferencia', 'usuarioId'],
          required: false,
          include: [{ model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login'] }],
        },
        {
          model: PlantaoModel,
          as: 'plantaoDestino',
          attributes: ['id', 'dataReferencia', 'usuarioId'],
          required: false,
          include: [{ model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login'] }],
        },
      ],
      order: [['createdAt', 'DESC']],
    });
    return rows.map((r) => r.get({ plain: true }));
  },

  cancelarPermutaSolicitacao: async (permutaId, usuarioId) => {
    const row = await PermutaSolicitacaoModel.findByPk(permutaId);
    if (!row) throw new ApiBaseError('Solicitação não encontrada.');
    if (row.status !== 'pendente') throw new ApiBaseError('Apenas solicitações pendentes podem ser canceladas.');
    if (Number(row.solicitanteUsuarioId) !== Number(usuarioId)) {
      throw new ApiBaseError('Apenas o solicitante pode cancelar o pedido.');
    }
    row.status = 'cancelada';
    await row.save();
    return row.get({ plain: true });
  },

  aceitarPermutaSolicitacao: async (permutaId, usuarioId) => {
    return await sequelizeTransaction(async (t) => {
      const row = await PermutaSolicitacaoModel.findByPk(permutaId, { transaction: t });
      if (!row) throw new ApiBaseError('Solicitação não encontrada.');
      if (row.status !== 'pendente') throw new ApiBaseError('Apenas solicitações pendentes podem ser aceitas.');
      if (Number(row.destinatarioUsuarioId) !== Number(usuarioId)) {
        throw new ApiBaseError('Apenas o destinatário pode aceitar o pedido.');
      }
      const oid = row.plantaoOrigemId;
      const did = row.plantaoDestinoId;
      if (oid == null || did == null) throw new ApiBaseError('Plantões da solicitação inválidos.');

      const [pOrigem, pDestino] = await Promise.all([
        PlantaoModel.findByPk(oid, { transaction: t }),
        PlantaoModel.findByPk(did, { transaction: t }),
      ]);
      if (!pOrigem || !pDestino) throw new ApiBaseError('Plantão não encontrado.');
      if (Number(pOrigem.escalaId) !== Number(row.escalaId) || Number(pDestino.escalaId) !== Number(row.escalaId)) {
        throw new ApiBaseError('Plantões não pertencem a esta escala.');
      }
      if (Number(pOrigem.usuarioId) !== Number(row.solicitanteUsuarioId)) {
        throw new ApiBaseError('O plantão ofertado não está mais com o solicitante; não é possível concluir a permuta.');
      }
      if (Number(pDestino.usuarioId) !== Number(row.destinatarioUsuarioId)) {
        throw new ApiBaseError('O plantão desejado não está mais com o destinatário; não é possível concluir a permuta.');
      }

      const uSolicitante = pOrigem.usuarioId;
      const uDestinatario = pDestino.usuarioId;
      pOrigem.usuarioId = uDestinatario;
      pDestino.usuarioId = uSolicitante;
      await pOrigem.save({ transaction: t });
      await pDestino.save({ transaction: t });

      await PermutaSolicitacaoModel.update(
        { status: 'cancelada' },
        {
          where: {
            escalaId: row.escalaId,
            status: 'pendente',
            id: { [Op.ne]: permutaId },
            [Op.or]: [
              { plantaoOrigemId: { [Op.in]: [oid, did] } },
              { plantaoDestinoId: { [Op.in]: [oid, did] } },
            ],
          },
          transaction: t,
        },
      );

      row.status = 'aceita';
      await row.save({ transaction: t });
      return row.get({ plain: true });
    });
  },

  recusarPermutaSolicitacao: async (permutaId, usuarioId) => {
    const row = await PermutaSolicitacaoModel.findByPk(permutaId);
    if (!row) throw new ApiBaseError('Solicitação não encontrada.');
    if (row.status !== 'pendente') throw new ApiBaseError('Apenas solicitações pendentes podem ser recusadas.');
    if (Number(row.destinatarioUsuarioId) !== Number(usuarioId)) {
      throw new ApiBaseError('Apenas o destinatário pode recusar o pedido.');
    }
    row.status = 'recusada';
    await row.save();
    return row.get({ plain: true });
  },

  listar: async () =>
    await EscalaModel.findAll({
      order: [['dataInicio', 'DESC']],
      include: [
        {
          model: EscalaMembroModel,
          as: 'membros',
          attributes: ['id', 'ordem', 'usuarioId', 'ativo'],
          include: [{ model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login'] }],
        },
      ],
    }),

  consultarPorId: async (id, solicitanteUsuarioIdParaPermutas = null) => {
    const escala = await EscalaModel.findByPk(id, {
      include: [
        {
          model: EscalaMembroModel,
          as: 'membros',
          include: [{ model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login', 'email'] }],
        },
      ],
    });
    if (!escala) return null;
    const dataInicioEscala = dataReferenciaParaStr(escala.dataInicio);
    const dataFimEscala = dataReferenciaParaStr(escala.dataFim);
    const plantoes = await PlantaoModel.findAll({
      where: {
        escalaId: id,
        dataReferencia: {
          [Op.gte]: dataInicioEscala,
          [Op.lte]: dataFimEscala,
        },
      },
      include: [{ model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login'] }],
      order: [
        ['dataReferencia', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    const plain = escala.get({ plain: true });
    plain.plantoes = plantoes
      .map((p) => p.get({ plain: true }))
      .filter((p) => {
        const dataRef = dataReferenciaParaStr(p.dataReferencia);
        return dataRef >= dataInicioEscala && dataRef <= dataFimEscala;
      });
    plain.permutaPendenteComoSolicitantePlantaoIds = [];
    if (solicitanteUsuarioIdParaPermutas != null) {
      const pendentes = await PermutaSolicitacaoModel.findAll({
        where: {
          escalaId: id,
          solicitanteUsuarioId: solicitanteUsuarioIdParaPermutas,
          status: 'pendente',
        },
        attributes: ['plantaoOrigemId'],
      });
      const ids = pendentes.map((r) => r.plantaoOrigemId).filter((x) => x != null);
      plain.permutaPendenteComoSolicitantePlantaoIds = [...new Set(ids)];
    }
    return plain;
  },

  /**
   * Simula os próximos plantões após o fim do período da escala.
   * A base é a ordem **atual da própria escala** (escala_membro), rotacionada a partir do
   * último plantão da escala. Isso mantém a simulação alinhada às alterações de ordem já
   * refletidas no calendário principal da escala.
   */
  preverProximosPlantoes: async (escalaId, quantidade = 8) => {
    const eid = parseInt(escalaId, 10);
    if (!Number.isFinite(eid) || eid < 1) throw new ApiBaseError('Identificador da escala inválido.');
    const q = Math.min(Math.max(parseInt(quantidade, 10) || 8, 1), 100);

    const escala = await EscalaModel.findByPk(eid);
    if (!escala) throw new ApiBaseError('Escala não encontrada.');
    const dataFimStr = dataReferenciaParaStr(escala.dataFim);

    const ultimoPlantao = await PlantaoModel.findOne({
      where: { escalaId: eid },
      order: [
        ['dataReferencia', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    const membros = await EscalaMembroModel.findAll({
      where: { escalaId: eid, ativo: true },
      attributes: ['usuarioId', 'ordem'],
      order: [['ordem', 'ASC']],
    });
    let ordemBase = [...new Set(membros.map((m) => Number(m.usuarioId)).filter((id) => Number.isFinite(id) && id > 0))];
    if (ordemBase.length === 0) {
      ordemBase = await obterOrdemGlobalUsuarioIds();
    }
    if (ordemBase.length === 0) {
      return { itens: [] };
    }

    let ordemRotacionada = [...ordemBase];
    if (ultimoPlantao) {
      const uid = Number(ultimoPlantao.usuarioId);
      const idx = ordemRotacionada.indexOf(uid);
      if (idx >= 0) {
        ordemRotacionada = [...ordemRotacionada.slice(idx + 1), ...ordemRotacionada.slice(0, idx + 1)];
      }
    }

    const datas = proximasDatasFinsDeSemanaApos(dataFimStr, q);
    const n = ordemRotacionada.length;
    const idsUnicos = [...new Set(ordemRotacionada)];
    const usuarios = await UsuarioModel.findAll({
      where: { id: { [Op.in]: idsUnicos } },
      attributes: ['id', 'nome', 'login'],
    });
    const mapa = new Map(usuarios.map((u) => [Number(u.id), u.get({ plain: true })]));

    const itens = datas.map((dataRef, k) => {
      const usuarioId = ordemRotacionada[k % n];
      const u = mapa.get(usuarioId);
      return {
        dataReferencia: dataRef,
        usuarioId,
        nome: u ? u.nome : null,
        login: u ? u.login : null,
      };
    });

    return { itens };
  },

  listarVeterinarios: async () => {
    const papelVet = await PapelModel.findOne({ where: { nome: 'Veterinario' } });
    if (!papelVet) return [];

    const vets = await UsuarioModel.findAll({
      include: [
        {
          model: UsuarioPapelModel,
          required: true,
          where: { PapelModelId: papelVet.id },
        },
      ],
      where: { ativo: true },
      attributes: ['id', 'nome', 'login', 'email', 'cargo'],
    });
    const vetPlain = vets.map((v) => v.get({ plain: true }));
    const ids = vetPlain.map((v) => Number(v.id));
    const ordemRows = await OrdemServidorModel.findAll({
      where: { usuarioId: { [Op.in]: ids } },
      order: [['ordem', 'ASC']],
    });
    const ordemMap = new Map(ordemRows.map((r) => [Number(r.usuarioId), Number(r.ordem)]));

    return vetPlain
      .map((v) => ({
        ...v,
        ordemGlobal: ordemMap.has(Number(v.id)) ? ordemMap.get(Number(v.id)) : null,
      }))
      .sort((a, b) => {
        const ao = a.ordemGlobal;
        const bo = b.ordemGlobal;
        if (ao != null && bo != null) return ao - bo;
        if (ao != null) return -1;
        if (bo != null) return 1;
        return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
      });
  },

  salvarOrdemServidores: async (usuarioIds) => {
    const ids = Array.isArray(usuarioIds)
      ? [...new Set(usuarioIds.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x) && x > 0))]
      : [];
    if (ids.length === 0) throw new ApiBaseError('Informe os IDs dos servidores na ordem desejada.');

    const vets = await EscalaService.listarVeterinarios();
    const vetIds = vets.map((v) => Number(v.id));
    if (vetIds.length !== ids.length) {
      throw new ApiBaseError('A ordem deve conter todos os veterinários ativos, sem repetição.');
    }
    const vetSet = new Set(vetIds);
    for (const id of ids) {
      if (!vetSet.has(Number(id))) {
        throw new ApiBaseError(`Usuário ${id} não faz parte dos veterinários ativos.`);
      }
    }

    return await sequelizeTransaction(async (t) => {
      await OrdemServidorModel.destroy({ where: {}, transaction: t });
      await OrdemServidorModel.bulkCreate(
        ids.map((usuarioId, idx) => ({
          usuarioId: Number(usuarioId),
          ordem: idx + 1,
        })),
        { transaction: t },
      );
      return await EscalaService.listarVeterinarios();
    });
  },

  criar: async (payload, criadoPorUsuarioId) => {
    const { nome, descricao, dataInicio, dataFim, periodicidade, membros, datasPlantaoExtras } = payload;
    if (!nome || !dataInicio || !dataFim || !periodicidade) {
      throw new ApiBaseError('Informe nome, dataInicio, dataFim e periodicidade.');
    }
    if (!PERIODICIDADES.includes(periodicidade)) {
      throw new ApiBaseError(`periodicidade inválida. Use: ${PERIODICIDADES.join(', ')}`);
    }
    if (new Date(dataInicio) > new Date(dataFim)) {
      throw new ApiBaseError('dataInicio deve ser anterior ou igual a dataFim.');
    }

    let ordemLista = membros;
    if (!Array.isArray(ordemLista) || ordemLista.length === 0) {
      const globais = await EscalaService.listarVeterinarios();
      ordemLista = globais.map((v, i) => ({ usuarioId: Number(v.id), ordem: i + 1 }));
    }

    ordemLista = ordemLista
      .map((m, i) => ({
        usuarioId: parseInt(m.usuarioId, 10),
        ordem: m.ordem != null ? parseInt(m.ordem, 10) : i + 1,
      }))
      .sort((a, b) => a.ordem - b.ordem);

    if (ordemLista.some((m) => !Number.isFinite(m.usuarioId) || !Number.isFinite(m.ordem) || m.ordem < 1)) {
      throw new ApiBaseError('Ordem de membros inválida.');
    }
    const ids = new Set(ordemLista.map((m) => m.usuarioId));
    if (ids.size !== ordemLista.length) throw new ApiBaseError('Não repita o mesmo veterinário na escala.');

    const vets = await EscalaService.listarVeterinarios();
    const vetSet = new Set(vets.map((v) => Number(v.id)));
    for (const m of ordemLista) {
      if (!vetSet.has(Number(m.usuarioId))) {
        throw new ApiBaseError(`Usuário ${m.usuarioId} não é veterinário no sistema.`);
      }
    }

    return await sequelizeTransaction(async (t) => {
      const iniStr = dataReferenciaParaStr(dataInicio);
      const fimStr = dataReferenciaParaStr(dataFim);
      const existente = await EscalaModel.findOne({
        where: {
          dataInicio: { [Op.lte]: fimStr },
          dataFim: { [Op.gte]: iniStr },
        },
        attributes: ['id', 'nome', 'dataInicio', 'dataFim'],
        transaction: t,
      });
      if (existente) {
        const e = existente.get ? existente.get({ plain: true }) : existente;
        const ni = formatarDataIsoParaBr(e.dataInicio);
        const nf = formatarDataIsoParaBr(e.dataFim);
        throw new ApiBaseError(
          `Já existe a escala "${e.nome}" no período de ${ni} a ${nf}. Não é permitido sobrepor dias com outra escala; a próxima escala deve começar após o término da anterior.`,
        );
      }

      const escala = await EscalaModel.create(
        {
          nome,
          descricao: descricao || null,
          dataInicio,
          dataFim,
          periodicidade,
          modoOrdemInicial: 'fixa',
          status: 'rascunho',
          criadoPorUsuarioId: criadoPorUsuarioId || null,
        },
        { transaction: t },
      );

      await EscalaMembroModel.bulkCreate(
        ordemLista.map((m) => ({
          escalaId: escala.id,
          usuarioId: m.usuarioId,
          ordem: m.ordem,
          ativo: true,
        })),
        { transaction: t },
      );

      const datas = mergeDatasPlantaoPrevisto(dataInicio, dataFim, datasPlantaoExtras);
      const n = ordemLista.length;
      if (datas.length > 0) {
        await PlantaoModel.bulkCreate(
          datas.map((dataRef, idx) => ({
            escalaId: escala.id,
            usuarioId: ordemLista[idx % n].usuarioId,
            dataReferencia: dataRef,
            status: 'previsto',
          })),
          { transaction: t },
        );
      }

      const ordemGlobalInicial = await obterOrdemGlobalUsuarioIds(t);
      await registrarHistoricoOrdem({
        escalaId: escala.id,
        ordemUsuarioIds: ordemLista.map((m) => m.usuarioId),
        ordemGlobalUsuarioIds: ordemGlobalInicial,
        motivo: 'inicial',
        transaction: t,
      });

      /**
       * A geração acima (idx % n) não considera afastamentos já existentes. Sem este passo, um veterinário
       * pode ficar escalado em dia de afastamento ao criar uma escala nova no período (ex.: Ana em 13/06).
       * O recálculo aplica substituição e regras de ordem (`adiar_no_ciclo`, etc.), com bootstrap coerente
       * quando há afastamentos sobrepostos (`historicoMotivo: 'recalculo'`).
       */
      if (datas.length > 0) {
        await recalcularEscalaInterno(escala.id, {
          transaction: t,
          historicoMotivo: 'recalculo',
        });
      }

      return escala;
    });
  },

  adicionarDatasPlantaoExtras: async (escalaId, datasPlantaoExtras) => {
    const escala = await EscalaModel.findByPk(escalaId);
    if (!escala) throw new ApiBaseError('Escala não encontrada.');

    const dataInicioStr = dataReferenciaParaStr(escala.dataInicio);
    const dataFimStr = dataReferenciaParaStr(escala.dataFim);
    if (!Array.isArray(datasPlantaoExtras) || datasPlantaoExtras.length === 0) {
      throw new ApiBaseError('Informe ao menos uma data adicional.');
    }

    const inicio = new Date(`${dataInicioStr}T12:00:00`);
    const fim = new Date(`${dataFimStr}T12:00:00`);
    const extrasNorm = [];
    for (const raw of datasPlantaoExtras) {
      if (raw == null || typeof raw !== 'string') continue;
      const ds = raw.trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) throw new ApiBaseError(`Data adicional inválida: ${raw}`);
      const d = new Date(`${ds}T12:00:00`);
      if (d < inicio || d > fim) {
        throw new ApiBaseError(`Data adicional ${ds} está fora do intervalo da escala (${dataInicioStr} a ${dataFimStr}).`);
      }
      extrasNorm.push(ds);
    }
    const uniques = [...new Set(extrasNorm)].sort();
    if (uniques.length === 0) throw new ApiBaseError('Nenhuma data válida informada.');

    const existentes = await PlantaoModel.findAll({ where: { escalaId }, attributes: ['dataReferencia'] });
    const jaTem = new Set(existentes.map((p) => dataReferenciaParaStr(p.dataReferencia)));
    const novas = uniques.filter((ds) => !jaTem.has(ds));
    if (novas.length === 0) throw new ApiBaseError('Todas as datas informadas já possuem plantão nesta escala.');

    return await sequelizeTransaction(async (t) => {
      const membros = await obterOrdemAtualDaEscala(escalaId, t);
      const primeiroUsuario = Number(membros[0].usuarioId);
      const ordemEscalaUsuarioIdsAntes = membros.map((m) => Number(m.usuarioId));
      const ordemGlobalUsuarioIdsAntes = await obterOrdemGlobalUsuarioIds(t);

      await PlantaoModel.bulkCreate(
        novas.map((ds) => ({
          escalaId,
          usuarioId: primeiroUsuario,
          dataReferencia: ds,
          status: 'previsto',
          ordemGlobalUsuarioIdsAntes,
          ordemEscalaUsuarioIdsAntes,
        })),
        { transaction: t },
      );

      const recalc = await recalcularEscalaInterno(escalaId, {
        transaction: t,
        historicoMotivo: 'manual',
        skipBootstrap: true,
      });
      const permutasCanceladas = await cancelarPermutasPendentesEscala(escalaId, t);
      return {
        adicionados: novas.length,
        atualizados: recalc.atualizados,
        ordemAlterada: recalc.ordemMudou,
        ordemGlobalAlterada: recalc.ordemGlobalMudou,
        permutasCanceladas,
        datas: novas,
      };
    });
  },

  /** Recalcula escalas que cruzam o período (ex.: após excluir afastamento). Aceita `transaction` como nas demais APIs. */
  recalcularEscalasPorUsuarioPeriodo: async (usuarioId, dataInicioStr, dataFimStr, options = {}) => {
    const transactionExterna = options.transaction || options.transactionExterna || null;
    const { historicoMotivo = 'recalculo', historicoAfastamento = null } = options;
    return await recalcularEscalasPorUsuarioPeriodoInterno(usuarioId, dataInicioStr, dataFimStr, {
      transactionExterna,
      historicoMotivo,
      historicoAfastamento,
    });
  },

  /**
   * Restaura ordem na escala e ordem geral a partir dos snapshots, remove o afastamento e recalcula as escalas.
   */
  desfazerAfastamentoRecalculo: async (afastamentoPlain, transaction) => {
    const id = Number(afastamentoPlain.id);
    const usuarioId = Number(afastamentoPlain.usuarioId);
    const dataInicioStr = dataReferenciaParaStr(afastamentoPlain.dataInicio);
    const dataFimStr = dataReferenciaParaStr(afastamentoPlain.dataFim);

    await restaurarOrdemEGlobalAntesDesfazerAfastamento(afastamentoPlain, transaction);

    await AfastamentoModel.destroy({ where: { id }, transaction });

    await refreshSnapshotsOrdemDeAfastamentosRestantes(transaction, afastamentoPlain);

    return await recalcularEscalasPorUsuarioPeriodoInterno(usuarioId, dataInicioStr, dataFimStr, {
      transactionExterna: transaction,
      historicoMotivo: 'apos_desfazer_afastamento',
      historicoAfastamento: null,
    });
  },

  recalcularEscalasPorAfastamento: async (afastamentoId, options = {}) => {
    const transactionExterna = options.transaction || null;
    const afastamento = await AfastamentoModel.findByPk(afastamentoId, {
      include: [{ model: TipoAfastamentoModel, as: 'tipo', attributes: ['id', 'tipo', 'regraOrdem'] }],
      transaction: transactionExterna || undefined,
    });
    if (!afastamento) throw new ApiBaseError('Afastamento não encontrado para recálculo.');

    const ordemGlobalAntesSnapshot = await obterOrdemGlobalUsuarioIds(transactionExterna || undefined);

    const dataInicioStr = dataReferenciaParaStr(afastamento.dataInicio);
    const dataFimStr = dataReferenciaParaStr(afastamento.dataFim);
    const resultado = await recalcularEscalasPorUsuarioPeriodoInterno(afastamento.usuarioId, dataInicioStr, dataFimStr, {
      transactionExterna,
      historicoMotivo: 'afastamento',
      historicoAfastamento: afastamento,
    });

    /** Sempre persiste o snapshot "antes do recálculo" (usado no bootstrap ao desfazer outro afastamento). */
    if (transactionExterna) {
      await AfastamentoModel.update(
        { ordemGlobalUsuarioIdsAntes: ordemGlobalAntesSnapshot },
        { where: { id: afastamentoId }, transaction: transactionExterna },
      );
    }

    return {
      afastamentoId: Number(afastamento.id),
      ...resultado,
    };
  },

  solicitarPermuta: async (escalaId, solicitanteUsuarioId, { plantaoOrigemId, plantaoDestinoId }) => {
    const oid = parseInt(plantaoOrigemId, 10);
    const did = parseInt(plantaoDestinoId, 10);
    if (!oid || !did || oid === did) {
      throw new ApiBaseError('Informe plantão de origem e de destino válidos e diferentes.');
    }
    const escala = await EscalaModel.findByPk(escalaId);
    if (!escala) throw new ApiBaseError('Escala não encontrada.');

    const [origem, destino] = await Promise.all([
      PlantaoModel.findOne({ where: { id: oid, escalaId } }),
      PlantaoModel.findOne({ where: { id: did, escalaId } }),
    ]);
    if (!origem || !destino) throw new ApiBaseError('Plantão não encontrado nesta escala.');
    if (origem.usuarioId !== solicitanteUsuarioId) throw new ApiBaseError('O plantão de origem deve ser seu.');
    if (destino.usuarioId === solicitanteUsuarioId) {
      throw new ApiBaseError('Escolha o plantão de outro veterinário para solicitar a permuta.');
    }

    const existente = await PermutaSolicitacaoModel.findOne({
      where: { escalaId, plantaoOrigemId: oid, plantaoDestinoId: did, status: 'pendente' },
    });
    if (existente) throw new ApiBaseError('Já existe uma solicitação pendente para esta permuta.');

    const row = await PermutaSolicitacaoModel.create({
      escalaId,
      solicitanteUsuarioId,
      destinatarioUsuarioId: destino.usuarioId,
      plantaoOrigemId: oid,
      plantaoDestinoId: did,
      status: 'pendente',
    });
    return row.get({ plain: true });
  },

  removerPlantoesFeriadosFacultativos: async (escalaId, plantaoIdsRaw) => {
    const ids = Array.isArray(plantaoIdsRaw)
      ? [...new Set(plantaoIdsRaw.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x) && x > 0))]
      : [];
    if (ids.length === 0) throw new ApiBaseError('Informe ao menos um plantão a remover.');

    const escala = await EscalaModel.findByPk(escalaId);
    if (!escala) throw new ApiBaseError('Escala não encontrada.');

    const plantoes = await PlantaoModel.findAll({ where: { escalaId, id: { [Op.in]: ids } } });
    if (plantoes.length !== ids.length) {
      throw new ApiBaseError('Um ou mais plantões não foram encontrados nesta escala.');
    }
    for (const p of plantoes) {
      if (ehFimDeSemanaDataReferencia(p.dataReferencia)) {
        throw new ApiBaseError(
          'Só é possível remover plantões de feriados ou pontos facultativos (dias que não são sábado nem domingo).',
        );
      }
    }

    return await sequelizeTransaction(async (t) => {
      /**
       * Não restaurar ordem a partir dos snapshots do plantão (obsoletos após outros eventos).
       * Recálculo com `skipBootstrap` usa o histórico `inicial` da escala como início do rodízio, não
       * a ordem em membros (fim do ciclo) nem o bootstrap do primeiro afastamento.
       */
      await PermutaSolicitacaoModel.destroy({
        where: {
          escalaId,
          [Op.or]: [{ plantaoOrigemId: { [Op.in]: ids } }, { plantaoDestinoId: { [Op.in]: ids } }],
        },
        transaction: t,
      });
      await PlantaoModel.destroy({ where: { escalaId, id: { [Op.in]: ids } }, transaction: t });

      const recalc = await recalcularEscalaInterno(escalaId, {
        transaction: t,
        historicoMotivo: 'manual',
        skipBootstrap: true,
      });
      const permutasCanceladas = await cancelarPermutasPendentesEscala(escalaId, t);

      return {
        removidos: plantoes.length,
        atualizados: recalc.atualizados,
        ordemAlterada: recalc.ordemMudou,
        ordemGlobalAlterada: recalc.ordemGlobalMudou,
        permutasCanceladas,
      };
    });
  },

  ativar: async (id) => {
    const escala = await EscalaModel.findByPk(id);
    if (!escala) throw new ApiBaseError('Escala não encontrada.');
    escala.status = 'ativa';
    await escala.save();
    return escala.get({ plain: true });
  },

  /**
   * Encerra a escala como concluída e atualiza a ordem global para iniciar pelo próximo no ciclo
   * após o último plantão, respeitando a ordem final dos membros da escala.
   * Veterinários fora da escala (se houver) são mantidos ao final.
   */
  concluir: async (id) => {
    const escalaId = parseInt(id, 10);
    if (!Number.isFinite(escalaId) || escalaId < 1) {
      throw new ApiBaseError('Identificador da escala inválido.');
    }

    return await sequelizeTransaction(async (t) => {
      const escala = await EscalaModel.findByPk(escalaId, { transaction: t });
      if (!escala) throw new ApiBaseError('Escala não encontrada.');

      const st = String(escala.status || '').toLowerCase();
      if (st !== 'ativa') {
        throw new ApiBaseError('Somente escalas ativas podem ser concluídas.');
      }

      const ultimoPlantao = await PlantaoModel.findOne({
        where: { escalaId },
        order: [
          ['dataReferencia', 'DESC'],
          ['id', 'DESC'],
        ],
        transaction: t,
      });
      if (!ultimoPlantao) {
        throw new ApiBaseError('Esta escala não possui plantões; não é possível concluir.');
      }

      const membros = await EscalaMembroModel.findAll({
        where: { escalaId, ativo: true },
        attributes: ['usuarioId', 'ordem'],
        order: [['ordem', 'ASC']],
        transaction: t,
      });
      const ordemEscala = membros.map((m) => Number(m.usuarioId)).filter((uid) => Number.isFinite(uid) && uid > 0);
      if (ordemEscala.length === 0) {
        throw new ApiBaseError('A escala não possui membros ativos para concluir.');
      }

      const ordemGlobal = await obterOrdemGlobalUsuarioIds(t);
      const ordemEscalaRotacionada = rotacionarOrdemAposUsuario(ordemEscala, ultimoPlantao.usuarioId);
      const novaOrdemGlobal = combinarOrdemEscalaNaOrdemGlobal(ordemEscalaRotacionada, ordemGlobal);
      await atualizarOrdemServidoresGlobalSemColisao(novaOrdemGlobal, t);

      escala.status = 'concluida';
      await escala.save({ transaction: t });

      await cancelarPermutasPendentesEscala(escalaId, t);

      return escala.get({ plain: true });
    });
  },

  excluir: async (id) => {
    const escala = await EscalaModel.findByPk(id);
    if (!escala) return false;
    await sequelizeTransaction(async (t) => {
      await PermutaSolicitacaoModel.destroy({ where: { escalaId: id }, transaction: t });
      await PlantaoModel.destroy({ where: { escalaId: id }, transaction: t });
      await EscalaOrdemHistoricoModel.destroy({ where: { escalaId: id }, transaction: t });
      await ImpedimentoModel.destroy({ where: { escalaId: id }, transaction: t });
      await EscalaMembroModel.destroy({ where: { escalaId: id }, transaction: t });
      await EscalaModel.destroy({ where: { id }, transaction: t });
    });
    return true;
  },
};

module.exports = EscalaService;
