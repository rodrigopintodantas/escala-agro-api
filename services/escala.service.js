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
const { sequelize } = require('../models');

const PERIODICIDADES = ['fim_de_semana', 'diario', 'semanal', 'quinzenal', 'mensal'];
const REGRA_ORDEM = {
  NAO_ALTERA: 'nao_altera',
  ADIAR_NO_CICLO: 'adiar_no_ciclo',
};
const PAPEIS_VETERINARIO = ['Veterinario', 'Veterinário'];
const PAPEIS_TECNICO = ['Tecnico', 'Técnico'];
const CATEGORIA_MEMBRO = { VETERINARIO: 'veterinario', TECNICO: 'tecnico' };
const CATEGORIA_PLANTAO = { VETERINARIO: 'veterinario', TECNICO: 'tecnico' };
const ESCOPO_ORDEM = { VETERINARIO: 'veterinario', TECNICO: 'tecnico' };

async function obterPapelVeterinario(transaction) {
  return PapelModel.findOne({
    where: { nome: { [Op.in]: PAPEIS_VETERINARIO } },
    transaction,
  });
}

async function obterPapelTecnico(transaction) {
  return PapelModel.findOne({
    where: { nome: { [Op.in]: PAPEIS_TECNICO } },
    transaction,
  });
}

function categoriaMembroDe(m) {
  const raw = m && m.get ? m.get('categoriaMembro') : m?.categoriaMembro;
  const t = String(raw || '').toLowerCase();
  return t === CATEGORIA_MEMBRO.TECNICO ? CATEGORIA_MEMBRO.TECNICO : CATEGORIA_MEMBRO.VETERINARIO;
}

function categoriaPlantaoDe(p) {
  const raw = p && p.get ? p.get('categoriaPlantao') : p?.categoriaPlantao;
  const t = String(raw || '').toLowerCase();
  return t === CATEGORIA_PLANTAO.TECNICO ? CATEGORIA_PLANTAO.TECNICO : CATEGORIA_PLANTAO.VETERINARIO;
}

function escopoOrdemParaCategoriaMembro(cat) {
  return String(cat || '').toLowerCase() === CATEGORIA_MEMBRO.TECNICO ? ESCOPO_ORDEM.TECNICO : ESCOPO_ORDEM.VETERINARIO;
}

async function escopoOrdemGlobalParaUsuarioId(usuarioId, transaction) {
  const uid = Number(usuarioId);
  if (!Number.isFinite(uid) || uid < 1) return ESCOPO_ORDEM.VETERINARIO;
  const rows = await OrdemServidorModel.findAll({
    where: { usuarioId: uid },
    attributes: ['escopo'],
    transaction,
  });
  if (rows.some((r) => String(r.escopo || '') === ESCOPO_ORDEM.TECNICO)) return ESCOPO_ORDEM.TECNICO;
  if (rows.some((r) => String(r.escopo || '') === ESCOPO_ORDEM.VETERINARIO)) return ESCOPO_ORDEM.VETERINARIO;
  const papelT = await obterPapelTecnico(transaction);
  if (papelT) {
    const up = await UsuarioPapelModel.findOne({
      where: { UsuarioModelId: uid, PapelModelId: papelT.id },
      transaction,
    });
    if (up) return ESCOPO_ORDEM.TECNICO;
  }
  return ESCOPO_ORDEM.VETERINARIO;
}

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
    attributes: ['usuarioId', 'ordem', 'categoriaMembro'],
    order: [
      [sequelize.literal("CASE WHEN categoria_membro = 'veterinario' THEN 0 ELSE 1 END"), 'ASC'],
      ['ordem', 'ASC'],
    ],
    transaction,
  });
  const ordemEscalaVet = membros
    .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.VETERINARIO)
    .map((m) => Number(m.usuarioId))
    .filter((id) => Number.isFinite(id) && id > 0);
  const ordemEscalaTec = membros
    .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.TECNICO)
    .map((m) => Number(m.usuarioId))
    .filter((id) => Number.isFinite(id) && id > 0);

  let algumMudou = false;

  if (ordemEscalaVet.length > 0) {
    const ultimoVet = await PlantaoModel.findOne({
      where: { escalaId, categoriaPlantao: CATEGORIA_PLANTAO.VETERINARIO },
      order: [
        ['dataReferencia', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction,
    });
    if (ultimoVet) {
      const ordemGlobalAtual = await obterOrdemGlobalUsuarioIds(transaction, ESCOPO_ORDEM.VETERINARIO);
      if (Array.isArray(ordemGlobalAtual) && ordemGlobalAtual.length > 0) {
        const ordemEscalaRotacionada = rotacionarOrdemAposUsuario(ordemEscalaVet, ultimoVet.usuarioId);
        const novaOrdemGlobal = combinarOrdemEscalaNaOrdemGlobal(ordemEscalaRotacionada, ordemGlobalAtual);
        if (novaOrdemGlobal.join(',') !== ordemGlobalAtual.join(',')) {
          await atualizarOrdemServidoresGlobalSemColisao(novaOrdemGlobal, transaction, ESCOPO_ORDEM.VETERINARIO);
          algumMudou = true;
        }
      }
    }
  }

  if (ordemEscalaTec.length > 0) {
    const ultimoTecPlantao = await PlantaoModel.findOne({
      where: { escalaId, categoriaPlantao: CATEGORIA_PLANTAO.TECNICO },
      order: [
        ['dataReferencia', 'DESC'],
        ['vagaIndice', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction,
    });
    if (ultimoTecPlantao) {
      const ordemGlobalAtual = await obterOrdemGlobalUsuarioIds(transaction, ESCOPO_ORDEM.TECNICO);
      if (Array.isArray(ordemGlobalAtual) && ordemGlobalAtual.length > 0) {
        const dataUlt = dataReferenciaParaStr(ultimoTecPlantao.dataReferencia);
        const ultimos = await PlantaoModel.findAll({
          where: { escalaId, dataReferencia: dataUlt, categoriaPlantao: CATEGORIA_PLANTAO.TECNICO },
          attributes: ['usuarioId'],
          order: [['id', 'ASC']],
          transaction,
        });
        const uids = [...new Set(ultimos.map((p) => Number(p.usuarioId)).filter((id) => Number.isFinite(id) && id > 0))];
        uids.sort((a, b) => ordemEscalaTec.indexOf(a) - ordemEscalaTec.indexOf(b));
        let ordemEscalaRotacionada = [...ordemEscalaTec];
        for (const uid of uids) {
          ordemEscalaRotacionada = rotacionarOrdemAposUsuario(ordemEscalaRotacionada, uid);
        }
        const novaOrdemGlobal = combinarOrdemEscalaNaOrdemGlobal(ordemEscalaRotacionada, ordemGlobalAtual);
        if (novaOrdemGlobal.join(',') !== ordemGlobalAtual.join(',')) {
          await atualizarOrdemServidoresGlobalSemColisao(novaOrdemGlobal, transaction, ESCOPO_ORDEM.TECNICO);
          algumMudou = true;
        }
      }
    }
  }

  return algumMudou;
}

function ehFimDeSemanaDataReferencia(val) {
  const s = dataReferenciaParaStr(val);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00`);
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

function ehSabadoDataReferencia(val) {
  const s = dataReferenciaParaStr(val);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return new Date(`${s}T12:00:00`).getDay() === 6;
}

function ehDomingoDataReferencia(val) {
  const s = dataReferenciaParaStr(val);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return new Date(`${s}T12:00:00`).getDay() === 0;
}

function diffDiasEntreReferenciasIso(a, b) {
  const da = new Date(`${dataReferenciaParaStr(a)}T12:00:00`);
  const db = new Date(`${dataReferenciaParaStr(b)}T12:00:00`);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
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

function compararUsuariosPorNomeAlfabetico(a, b) {
  const nomeA = String(a?.nome || '');
  const nomeB = String(b?.nome || '');
  const normA = normalizarTextoSemAcento(nomeA);
  const normB = normalizarTextoSemAcento(nomeB);
  if (normA !== normB) return normA.localeCompare(normB, 'pt-BR');
  return nomeA.localeCompare(nomeB, 'pt-BR');
}

function tipoAfastamentoNormalizado(af) {
  return normalizarTextoSemAcento(af?.tipo?.tipo);
}

function afastamentoEhFerias(af) {
  return tipoAfastamentoNormalizado(af) === 'ferias';
}

function afastamentoEhAtestado(af) {
  return tipoAfastamentoNormalizado(af) === 'atestado';
}

function afastamentoEhAbono(af) {
  return tipoAfastamentoNormalizado(af) === 'abono';
}

/** Texto exibido no plantão quando o preferencial do dia está só de atestado (ordem do rodízio não muda). */
function textoGestaoAtestadoMedico(afastamentosPreferencial, rotuloProfissional = 'Veterinário') {
  const af = (afastamentosPreferencial || []).find((a) => afastamentoEhAtestado(a));
  const rawNome = af?.usuario ? af.usuario.nome || af.usuario.login : '';
  const nome = String(rawNome || '').trim() || rotuloProfissional;
  return `Gestão - Atestado médico ${nome}`;
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
 * Férias/Abono: antes de completar ao menos 1 dia útil pós-fim, o usuário ainda não pode ser escalado.
 * Ex.: fim na sexta -> sábado/domingo continuam indisponíveis; libera após passar por 1 dia útil.
 */
function usuarioBloqueadoPosFeriasOuAbonoNoDia(afastamentosPorUsuario, usuarioId, dataIso, datasNaoUteisIsoSet = new Set()) {
  const lista = afastamentosPorUsuario.get(Number(usuarioId)) || [];
  for (const af of lista) {
    if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) continue;
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
  if (usuarioBloqueadoPosFeriasOuAbonoNoDia(afastamentosPorUsuario, usuarioId, dataIso, datasNaoUteisIsoSet)) return true;
  return false;
}

/**
 * Adiar no ciclo durante cobertura: férias e abono (e tipos com regra explícita no BD).
 * Atestado médico não altera a ordem do rodízio.
 */
function afastamentoDeveAdiarNoCiclo(af) {
  if (afastamentoEhAtestado(af)) return false;
  if (afastamentoEhFerias(af) || afastamentoEhAbono(af)) return true;
  return (af?.tipo?.regraOrdem || REGRA_ORDEM.NAO_ALTERA) === REGRA_ORDEM.ADIAR_NO_CICLO;
}

/**
 * Mapeia, para cada data de plantão, os usuários com retorno obrigatório:
 * - Férias/Abono: primeiro plantão após ter trabalhado ao menos 1 dia útil pós-fim;
 * - Atestado não entra (não força retorno no ciclo).
 */
function montarRetornosFeriasNoPrimeiroPlantao(afastamentos, plantoes, datasNaoUteisIsoSet = new Set()) {
  const mapa = new Map();
  if (!Array.isArray(afastamentos) || !Array.isArray(plantoes) || plantoes.length === 0) {
    return mapa;
  }
  const datasPlantoes = [...new Set(plantoes.map((p) => dataReferenciaParaStr(p.dataReferencia)))].sort();
  for (const af of afastamentos) {
    const ehFerias = afastamentoEhFerias(af);
    const ehAbono = afastamentoEhAbono(af);
    if (!ehFerias && !ehAbono) continue;
    const usuarioId = Number(af.usuarioId);
    if (!Number.isFinite(usuarioId)) continue;
    const fimIso = dataReferenciaParaStr(af.dataFim);
    if (!fimIso) continue;
    const primeiroDiaPosFim = adicionarDiasIso(fimIso, 1);
    const primeiraDataPosRetorno = datasPlantoes.find(
      (ds) => ds > fimIso && existeDiaUtilNoIntervalo(primeiroDiaPosFim, ds, datasNaoUteisIsoSet),
    );
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

async function obterMembrosAtivosEscala(escalaId, transaction) {
  const membros = await EscalaMembroModel.findAll({
    where: { escalaId, ativo: true },
    order: [
      [sequelize.literal("CASE WHEN categoria_membro = 'veterinario' THEN 0 ELSE 1 END"), 'ASC'],
      ['ordem', 'ASC'],
    ],
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
  categoriaOrdem = null,
  transaction,
}) {
  await EscalaOrdemHistoricoModel.create(
    {
      escalaId,
      motivo,
      tipoAfastamentoId,
      afastamentoId,
      categoriaOrdem: categoriaOrdem || null,
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

async function atualizarOrdemMembrosEscalaSemColisao(escalaId, ordemUsuarioIds, transaction, categoriaMembro = CATEGORIA_MEMBRO.VETERINARIO) {
  const cat = String(categoriaMembro || '').toLowerCase() === CATEGORIA_MEMBRO.TECNICO ? CATEGORIA_MEMBRO.TECNICO : CATEGORIA_MEMBRO.VETERINARIO;
  for (let i = 0; i < ordemUsuarioIds.length; i++) {
    const usuarioId = Number(ordemUsuarioIds[i]);
    await EscalaMembroModel.update(
      { ordem: -(i + 1) },
      {
        where: { escalaId, usuarioId, categoriaMembro: cat },
        transaction,
      },
    );
  }

  for (let i = 0; i < ordemUsuarioIds.length; i++) {
    const usuarioId = Number(ordemUsuarioIds[i]);
    await EscalaMembroModel.update(
      { ordem: i + 1 },
      {
        where: { escalaId, usuarioId, categoriaMembro: cat },
        transaction,
      },
    );
  }
}

/** Ordem global por escopo (`ordem_servidor.escopo`), com fallback para servidores ativos do papel correspondente. */
async function obterOrdemGlobalUsuarioIds(transaction, escopo = ESCOPO_ORDEM.VETERINARIO) {
  const papel =
    escopo === ESCOPO_ORDEM.TECNICO ? await obterPapelTecnico(transaction) : await obterPapelVeterinario(transaction);
  if (!papel) return [];

  const servidores = await UsuarioModel.findAll({
    include: [{ model: UsuarioPapelModel, required: true, where: { PapelModelId: papel.id } }],
    where: { ativo: true },
    attributes: ['id', 'nome'],
    transaction,
  });
  const servidoresOrdenados = [...servidores].sort((a, b) => compararUsuariosPorNomeAlfabetico(a, b));
  const srvIds = servidoresOrdenados.map((v) => Number(v.id));
  const srvSet = new Set(srvIds);

  const rows = await OrdemServidorModel.findAll({
    where: { escopo },
    order: [['ordem', 'ASC']],
    transaction,
  });
  const ordered = rows.map((r) => Number(r.usuarioId)).filter((id) => srvSet.has(id));
  const inOrdered = new Set(ordered);
  const missing = srvIds.filter((id) => !inOrdered.has(id));
  return [...ordered, ...missing];
}

/** Persiste ordem global do escopo; substitui apenas linhas daquele escopo. */
async function atualizarOrdemServidoresGlobalSemColisao(ordemUsuarioIds, transaction, escopo = ESCOPO_ORDEM.VETERINARIO) {
  const ids = ordemUsuarioIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return;

  await OrdemServidorModel.destroy({ where: { escopo }, transaction });
  await OrdemServidorModel.bulkCreate(
    ids.map((usuarioId, idx) => ({
      usuarioId,
      ordem: idx + 1,
      escopo,
    })),
    { transaction },
  );
}

async function buscarHistoricoOrdemParaAfastamento(escalaId, afastamentoId, categoriaOrdem, transaction) {
  const cat = String(categoriaOrdem || '').toLowerCase();
  let hist = await EscalaOrdemHistoricoModel.findOne({
    where: { escalaId, afastamentoId: Number(afastamentoId), categoriaOrdem: cat },
    order: [['id', 'DESC']],
    transaction,
  });
  if (!hist) {
    hist = await EscalaOrdemHistoricoModel.findOne({
      where: { escalaId, afastamentoId: Number(afastamentoId), categoriaOrdem: { [Op.is]: null } },
      order: [['id', 'DESC']],
      transaction,
    });
  }
  return hist;
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

  const membros = await obterMembrosAtivosEscala(escalaId, transaction);
  const ordemAtualDbInicialVet = membros
    .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.VETERINARIO)
    .map((m) => Number(m.usuarioId))
    .filter((id) => Number.isFinite(id) && id > 0);
  const ordemAtualDbInicialTec = membros
    .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.TECNICO)
    .map((m) => Number(m.usuarioId))
    .filter((id) => Number.isFinite(id) && id > 0);

  let ordemAtualVet = [...ordemAtualDbInicialVet];
  let ordemAtualTec = [...ordemAtualDbInicialTec];

  const ordemGlobalDbInicialVet = await obterOrdemGlobalUsuarioIds(transaction, ESCOPO_ORDEM.VETERINARIO);
  const ordemGlobalDbInicialTec = await obterOrdemGlobalUsuarioIds(transaction, ESCOPO_ORDEM.TECNICO);
  let ordemGlobalVet = [...ordemGlobalDbInicialVet];
  let ordemGlobalTec = [...ordemGlobalDbInicialTec];

  const idsMembrosUniao = [...new Set([...ordemAtualDbInicialVet, ...ordemAtualDbInicialTec])];

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
      const catPrimeiro =
        (await escopoOrdemGlobalParaUsuarioId(primeiro.usuarioId, transaction)) === ESCOPO_ORDEM.TECNICO
          ? CATEGORIA_MEMBRO.TECNICO
          : CATEGORIA_MEMBRO.VETERINARIO;
      if (Array.isArray(primeiro.ordemGlobalUsuarioIdsAntes) && primeiro.ordemGlobalUsuarioIdsAntes.length > 0) {
        const og = primeiro.ordemGlobalUsuarioIdsAntes.map((x) => Number(x));
        if (catPrimeiro === CATEGORIA_MEMBRO.TECNICO) ordemGlobalTec = og;
        else ordemGlobalVet = og;
      }
      const hist = await buscarHistoricoOrdemParaAfastamento(escalaId, primeiro.id, catPrimeiro, transaction);
      if (hist && Array.isArray(hist.ordemUsuarioIdsAntes) && hist.ordemUsuarioIdsAntes.length > 0) {
        const oa = hist.ordemUsuarioIdsAntes.map((x) => Number(x));
        if (catPrimeiro === CATEGORIA_MEMBRO.TECNICO) ordemAtualTec = oa;
        else ordemAtualVet = oa;
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
        usuarioId: { [Op.in]: idsMembrosUniao },
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
      const catPrimeiro =
        (await escopoOrdemGlobalParaUsuarioId(primeiro.usuarioId, transaction)) === ESCOPO_ORDEM.TECNICO
          ? CATEGORIA_MEMBRO.TECNICO
          : CATEGORIA_MEMBRO.VETERINARIO;
      if (Array.isArray(primeiro.ordemGlobalUsuarioIdsAntes) && primeiro.ordemGlobalUsuarioIdsAntes.length > 0) {
        const og = primeiro.ordemGlobalUsuarioIdsAntes.map((x) => Number(x));
        if (catPrimeiro === CATEGORIA_MEMBRO.TECNICO) ordemGlobalTec = og;
        else ordemGlobalVet = og;
      }
      const hist = await buscarHistoricoOrdemParaAfastamento(escalaId, primeiro.id, catPrimeiro, transaction);
      if (hist && Array.isArray(hist.ordemUsuarioIdsAntes) && hist.ordemUsuarioIdsAntes.length > 0) {
        const oa = hist.ordemUsuarioIdsAntes.map((x) => Number(x));
        if (catPrimeiro === CATEGORIA_MEMBRO.TECNICO) ordemAtualTec = oa;
        else ordemAtualVet = oa;
      }
    }
  }

  if (usarHistoricoInicialRodizio) {
    const histsInicial = await EscalaOrdemHistoricoModel.findAll({
      where: { escalaId, motivo: 'inicial' },
      order: [['id', 'ASC']],
      transaction,
    });
    for (const histInicial of histsInicial) {
      const plain = histInicial.get ? histInicial.get({ plain: true }) : histInicial;
      const catRaw = plain.categoriaOrdem;
      const cat =
        String(catRaw || '').toLowerCase() === CATEGORIA_MEMBRO.TECNICO ? CATEGORIA_MEMBRO.TECNICO : CATEGORIA_MEMBRO.VETERINARIO;
      const alvoIds = cat === CATEGORIA_MEMBRO.TECNICO ? ordemAtualDbInicialTec : ordemAtualDbInicialVet;
      const idsInicial = Array.isArray(plain.ordemUsuarioIds) ? plain.ordemUsuarioIds.map((x) => Number(x)) : [];
      const membrosSet = new Set(alvoIds);
      if (
        idsInicial.length > 0 &&
        alvoIds.length > 0 &&
        idsInicial.length === alvoIds.length &&
        idsInicial.every((id) => membrosSet.has(Number(id)))
      ) {
        if (cat === CATEGORIA_MEMBRO.TECNICO) ordemAtualTec = idsInicial;
        else ordemAtualVet = idsInicial;
      }
      if (Array.isArray(plain.ordemGlobalUsuarioIds) && plain.ordemGlobalUsuarioIds.length > 0) {
        const og = plain.ordemGlobalUsuarioIds.map((x) => Number(x));
        if (cat === CATEGORIA_MEMBRO.TECNICO) ordemGlobalTec = og;
        else ordemGlobalVet = og;
      }
    }
  }

  const plantoes = await PlantaoModel.findAll({
    where: { escalaId },
    order: [
      ['dataReferencia', 'ASC'],
      [sequelize.literal("CASE WHEN categoria_plantao = 'veterinario' THEN 0 ELSE 1 END"), 'ASC'],
      ['vagaIndice', 'ASC'],
      ['id', 'ASC'],
    ],
    transaction,
  });

  const idsParaAfastamentos = [...new Set([...ordemAtualVet, ...ordemAtualTec, ...ordemAtualDbInicialVet, ...ordemAtualDbInicialTec])].filter(
    (id) => Number.isFinite(id) && id > 0,
  );

  const afastamentos = await AfastamentoModel.findAll({
    where: {
      usuarioId: { [Op.in]: idsParaAfastamentos },
      dataInicio: { [Op.lte]: dataFimStr },
      dataFim: { [Op.gte]: dataInicioStr },
    },
    include: [
      { model: TipoAfastamentoModel, as: 'tipo', attributes: ['id', 'tipo', 'regraOrdem'] },
      { model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login'] },
    ],
    transaction,
  });
  const afastamentosPorUsuario = montarAfastamentosPorUsuario(afastamentos);
  /**
   * Em escalas de fim de semana, plantões adicionais em dias úteis representam feriado/ponto facultativo
   * e não devem contar como "dia útil trabalhado" para liberar retorno pós-férias/abono.
   */
  const datasNaoUteisParaRetornoPosAfastamento =
    String(escala.periodicidade || '').toLowerCase() === 'fim_de_semana'
      ? new Set(
          plantoes
            .map((p) => dataReferenciaParaStr(p.dataReferencia))
            .filter((ds) => !!ds && !ehFimDeSemanaDataReferencia(ds)),
        )
      : new Set();
  const retornosFeriasNoPrimeiroPlantao = montarRetornosFeriasNoPrimeiroPlantao(
    afastamentos,
    plantoes,
    datasNaoUteisParaRetornoPosAfastamento,
  );
  /** Retornos de férias já vencidos e ainda não alocados (empates no mesmo dia, indisponibilidade etc.). */
  const filaRetornosFeriasPendentes = [];

  const primeiroUsuarioNoDiaTech = new Map();

  if (plantoes.some((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO) && ordemAtualDbInicialVet.length === 0) {
    throw new ApiBaseError('Escala sem veterinários no rodízio para os plantões de veterinário.');
  }
  if (plantoes.some((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO) && ordemAtualDbInicialTec.length === 0) {
    throw new ApiBaseError('Escala sem técnicos no rodízio para os plantões de técnico.');
  }

  let idxOrdemVet = 0;
  let idxOrdemTec = 0;
  let atualizados = 0;

  for (const plantao of plantoes) {
    const dataIso = dataReferenciaParaStr(plantao.dataReferencia);
    const catPlantao = categoriaPlantaoDe(plantao);
    let ordemAtual = catPlantao === CATEGORIA_PLANTAO.TECNICO ? ordemAtualTec : ordemAtualVet;
    let ordemGlobal = catPlantao === CATEGORIA_PLANTAO.TECNICO ? ordemGlobalTec : ordemGlobalVet;
    let idxOrdem = catPlantao === CATEGORIA_PLANTAO.TECNICO ? idxOrdemTec : idxOrdemVet;

    const rotuloProfissional = catPlantao === CATEGORIA_PLANTAO.TECNICO ? 'Técnico' : 'Veterinário';
    const msgSemServidor = `Não há ${rotuloProfissional.toLowerCase()} disponível para o plantão`;

    if (!ordemAtual.length) continue;

    let observacaoPlantao = null;

    const idsExcluirMesmoDia = new Set();
    if (catPlantao === CATEGORIA_PLANTAO.TECNICO && Number(plantao.vagaIndice) === 1) {
      const u0 = primeiroUsuarioNoDiaTech.get(dataIso);
      if (u0 != null) idsExcluirMesmoDia.add(Number(u0));
    }

    const idxPreferencial = idxOrdem % ordemAtual.length;
    const usuarioPreferencial = ordemAtual[idxPreferencial];
    const afastamentosPreferencial = afastamentosAtivosNoDia(afastamentosPorUsuario, usuarioPreferencial, dataIso);
    const preferencialBloqueadoPosFerias = usuarioBloqueadoPosFeriasOuAbonoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisParaRetornoPosAfastamento,
    );
    let preferencialIndisponivel = usuarioIndisponivelParaPlantaoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisParaRetornoPosAfastamento,
    );
    if (idsExcluirMesmoDia.has(Number(usuarioPreferencial))) {
      preferencialIndisponivel = true;
    }

    let usuarioAlocado = usuarioPreferencial;
    const retornosHoje = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];
    for (const uidRaw of retornosHoje) {
      const uid = Number(uidRaw);
      if (!Number.isFinite(uid)) continue;
      /**
       * Fila de retornos é compartilhada no loop de plantões (vet/téc).
       * Evita inserir retorno de uma categoria quando o plantão atual é da outra,
       * senão o usuário pode "sobrar" pendente e ser forçado novamente no dia seguinte.
       */
      if (!ordemAtual.includes(uid)) continue;
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
      datasNaoUteisParaRetornoPosAfastamento,
    );

    if (retornoFeriasForcado != null && !idsExcluirMesmoDia.has(Number(retornoFeriasForcado))) {
      usuarioAlocado = retornoFeriasForcado;
      if (Number(usuarioAlocado) !== Number(usuarioPreferencial)) {
        ordemAtual = moverUsuarioAntesDeReferencia(ordemAtual, usuarioAlocado, usuarioPreferencial);
      }
      idxOrdem = (ordemAtual.indexOf(usuarioAlocado) + 1) % ordemAtual.length;
      const idxFila = filaRetornosFeriasPendentes.indexOf(Number(usuarioAlocado));
      if (idxFila >= 0) {
        filaRetornosFeriasPendentes.splice(idxFila, 1);
      }
    } else if (preferencialIndisponivel) {
      const gestaoAtestado =
        !preferencialBloqueadoPosFerias &&
        afastamentosPreferencial.length > 0 &&
        afastamentosPreferencial.every((af) => afastamentoEhAtestado(af));

      if (gestaoAtestado) {
        usuarioAlocado = usuarioPreferencial;
        observacaoPlantao = textoGestaoAtestadoMedico(afastamentosPreferencial, rotuloProfissional);
        idxOrdem = (idxPreferencial + 1) % ordemAtual.length;
      } else {
        let encontrado = null;
        let encontradoComGestaoAtestado = false;
        let afastamentosEncontrado = [];
        for (let passo = 1; passo <= ordemAtual.length; passo++) {
          const candidato = ordemAtual[(idxPreferencial + passo) % ordemAtual.length];
          if (idsExcluirMesmoDia.has(Number(candidato))) continue;
          const afastamentosCandidato = afastamentosAtivosNoDia(afastamentosPorUsuario, candidato, dataIso);
          const candidatoBloqueadoPosFeriasOuAbono = usuarioBloqueadoPosFeriasOuAbonoNoDia(
            afastamentosPorUsuario,
            candidato,
            dataIso,
            datasNaoUteisParaRetornoPosAfastamento,
          );
          const candidatoSomenteAtestado =
            !candidatoBloqueadoPosFeriasOuAbono &&
            afastamentosCandidato.length > 0 &&
            afastamentosCandidato.every((af) => afastamentoEhAtestado(af));
          const candidatoIndisponivelReal = candidatoBloqueadoPosFeriasOuAbono || (afastamentosCandidato.length > 0 && !candidatoSomenteAtestado);
          if (candidatoIndisponivelReal) continue;
          encontrado = candidato;
          encontradoComGestaoAtestado = candidatoSomenteAtestado;
          afastamentosEncontrado = afastamentosCandidato;
          break;
        }

        if (!encontrado) {
          throw new ApiBaseError(`${msgSemServidor} em ${dataIso}.`);
        }

        usuarioAlocado = encontrado;
        if (encontradoComGestaoAtestado) {
          observacaoPlantao = textoGestaoAtestadoMedico(afastamentosEncontrado, rotuloProfissional);
        }
        const deveAlterarOrdem =
          afastamentosPreferencial.some((af) => afastamentoDeveAdiarNoCiclo(af)) || preferencialBloqueadoPosFerias;

        if (deveAlterarOrdem) {
          ordemAtual = moverUsuarioDepoisDaCobertura(ordemAtual, usuarioPreferencial, usuarioAlocado);
          ordemGlobal = moverUsuarioDepoisDaCobertura(ordemGlobal, usuarioPreferencial, usuarioAlocado);
          idxOrdem = (ordemAtual.indexOf(usuarioAlocado) + 1) % ordemAtual.length;
        } else {
          idxOrdem = (idxPreferencial + 1) % ordemAtual.length;
        }
      }
    } else {
      idxOrdem = (idxPreferencial + 1) % ordemAtual.length;
    }

    if (catPlantao === CATEGORIA_PLANTAO.TECNICO) {
      ordemAtualTec = ordemAtual;
      ordemGlobalTec = ordemGlobal;
      idxOrdemTec = idxOrdem;
    } else {
      ordemAtualVet = ordemAtual;
      ordemGlobalVet = ordemGlobal;
      idxOrdemVet = idxOrdem;
    }

    const obsDesejada = observacaoPlantao;
    const usuarioMudou = Number(plantao.usuarioId) !== Number(usuarioAlocado);
    const obsMudou = (plantao.observacao || null) !== (obsDesejada || null);
    if (usuarioMudou || obsMudou) {
      plantao.usuarioId = Number(usuarioAlocado);
      plantao.observacao = obsDesejada;
      await plantao.save({ transaction });
      atualizados += 1;
    }

    if (catPlantao === CATEGORIA_PLANTAO.TECNICO && Number(plantao.vagaIndice) === 0) {
      primeiroUsuarioNoDiaTech.set(dataIso, Number(usuarioAlocado));
    }
  }

  const ordemMudouVet = ordemAtualVet.join(',') !== ordemAtualDbInicialVet.join(',');
  const ordemMudouTec = ordemAtualTec.join(',') !== ordemAtualDbInicialTec.join(',');
  const ordemMudou = ordemMudouVet || ordemMudouTec;

  if (ordemMudouVet && ordemAtualDbInicialVet.length > 0) {
    await atualizarOrdemMembrosEscalaSemColisao(escalaId, ordemAtualVet, transaction, CATEGORIA_MEMBRO.VETERINARIO);
  }
  if (ordemMudouTec && ordemAtualDbInicialTec.length > 0) {
    await atualizarOrdemMembrosEscalaSemColisao(escalaId, ordemAtualTec, transaction, CATEGORIA_MEMBRO.TECNICO);
  }

  if (historicoMotivo && ordemMudou) {
    if (ordemMudouVet && ordemAtualDbInicialVet.length > 0) {
      await registrarHistoricoOrdem({
        escalaId,
        ordemUsuarioIds: ordemAtualVet,
        ordemUsuarioIdsAntes: historicoMotivo === 'afastamento' ? ordemAtualDbInicialVet : null,
        motivo: historicoMotivo,
        tipoAfastamentoId: historicoAfastamento ? historicoAfastamento.tipoId : null,
        afastamentoId: historicoAfastamento ? historicoAfastamento.id : null,
        categoriaOrdem: CATEGORIA_MEMBRO.VETERINARIO,
        transaction,
      });
    }
    if (ordemMudouTec && ordemAtualDbInicialTec.length > 0) {
      await registrarHistoricoOrdem({
        escalaId,
        ordemUsuarioIds: ordemAtualTec,
        ordemUsuarioIdsAntes: historicoMotivo === 'afastamento' ? ordemAtualDbInicialTec : null,
        motivo: historicoMotivo,
        tipoAfastamentoId: historicoAfastamento ? historicoAfastamento.tipoId : null,
        afastamentoId: historicoAfastamento ? historicoAfastamento.id : null,
        categoriaOrdem: CATEGORIA_MEMBRO.TECNICO,
        transaction,
      });
    }
  }

  const ordemGlobalMudouVet = ordemGlobalVet.join(',') !== ordemGlobalDbInicialVet.join(',');
  const ordemGlobalMudouTec = ordemGlobalTec.join(',') !== ordemGlobalDbInicialTec.join(',');
  if (ordemGlobalMudouVet && ordemGlobalVet.length > 0) {
    await atualizarOrdemServidoresGlobalSemColisao(ordemGlobalVet, transaction, ESCOPO_ORDEM.VETERINARIO);
  }
  if (ordemGlobalMudouTec && ordemGlobalTec.length > 0) {
    await atualizarOrdemServidoresGlobalSemColisao(ordemGlobalTec, transaction, ESCOPO_ORDEM.TECNICO);
  }

  const ordemGlobalMudou = ordemGlobalMudouVet || ordemGlobalMudouTec;

  return {
    atualizados,
    ordemMudou,
    ordemUsuarioIds: [...ordemAtualVet, ...ordemAtualTec],
    ordemGlobalMudou,
  };
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

    const escopoAf = await escopoOrdemGlobalParaUsuarioId(row.usuarioId, transaction);
    const og = await obterOrdemGlobalUsuarioIds(transaction, escopoAf);
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
      for (const catMem of [CATEGORIA_MEMBRO.VETERINARIO, CATEGORIA_MEMBRO.TECNICO]) {
        const membrosCat = await EscalaMembroModel.findAll({
          where: { escalaId, ativo: true, categoriaMembro: catMem },
          order: [['ordem', 'ASC']],
          transaction,
        });
        const ordemAtual = membrosCat.map((m) => Number(m.usuarioId)).filter((id) => Number.isFinite(id) && id > 0);
        if (ordemAtual.length === 0) continue;
        await EscalaOrdemHistoricoModel.update(
          { ordemUsuarioIdsAntes: ordemAtual },
          { where: { escalaId, afastamentoId: Number(row.id), categoriaOrdem: catMem }, transaction },
        );
      }
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
    let ordemGlobalInicialVet = null;
    let ordemGlobalInicialTec = null;
    for (const escalaId of escalaIdsAfetadas) {
      const histsInicial = await EscalaOrdemHistoricoModel.findAll({
        where: { escalaId, motivo: 'inicial' },
        order: [['id', 'ASC']],
        transaction,
      });
      for (const histInicial of histsInicial) {
        const plain = histInicial.get ? histInicial.get({ plain: true }) : histInicial;
        const cat =
          String(plain.categoriaOrdem || '').toLowerCase() === CATEGORIA_MEMBRO.TECNICO
            ? CATEGORIA_MEMBRO.TECNICO
            : CATEGORIA_MEMBRO.VETERINARIO;
        if (Array.isArray(plain.ordemUsuarioIds) && plain.ordemUsuarioIds.length > 0) {
          await atualizarOrdemMembrosEscalaSemColisao(
            escalaId,
            plain.ordemUsuarioIds.map((x) => Number(x)),
            transaction,
            cat,
          );
        }
        if (Array.isArray(plain.ordemGlobalUsuarioIds) && plain.ordemGlobalUsuarioIds.length > 0) {
          const og = plain.ordemGlobalUsuarioIds.map((x) => Number(x));
          if (cat === CATEGORIA_MEMBRO.TECNICO) ordemGlobalInicialTec = og;
          else ordemGlobalInicialVet = og;
        }
      }
    }
    const escopoAf = await escopoOrdemGlobalParaUsuarioId(afastamentoPlain.usuarioId, transaction);
    if (
      (!ordemGlobalInicialVet || ordemGlobalInicialVet.length === 0) &&
      (!ordemGlobalInicialTec || ordemGlobalInicialTec.length === 0) &&
      Array.isArray(afastamentoPlain.ordemGlobalUsuarioIdsAntes)
    ) {
      const og = afastamentoPlain.ordemGlobalUsuarioIdsAntes;
      if (og.length > 0) {
        if (escopoAf === ESCOPO_ORDEM.TECNICO) ordemGlobalInicialTec = og.map((x) => Number(x));
        else ordemGlobalInicialVet = og.map((x) => Number(x));
      }
    }
    if (ordemGlobalInicialVet && ordemGlobalInicialVet.length > 0) {
      await atualizarOrdemServidoresGlobalSemColisao(ordemGlobalInicialVet, transaction, ESCOPO_ORDEM.VETERINARIO);
    }
    if (ordemGlobalInicialTec && ordemGlobalInicialTec.length > 0) {
      await atualizarOrdemServidoresGlobalSemColisao(ordemGlobalInicialTec, transaction, ESCOPO_ORDEM.TECNICO);
    }
    return;
  }

  for (const h of rowsHist) {
    const eid = Number(h.escalaId);
    const antes = h.ordemUsuarioIdsAntes;
    const catH =
      String(h.categoriaOrdem || '').toLowerCase() === CATEGORIA_MEMBRO.TECNICO
        ? CATEGORIA_MEMBRO.TECNICO
        : CATEGORIA_MEMBRO.VETERINARIO;
    if (Array.isArray(antes) && antes.length > 0) {
      await atualizarOrdemMembrosEscalaSemColisao(eid, antes.map((x) => Number(x)), transaction, catH);
    }
  }

  const og = afastamentoPlain.ordemGlobalUsuarioIdsAntes;
  if (Array.isArray(og) && og.length > 0) {
    const escopoAf = await escopoOrdemGlobalParaUsuarioId(afastamentoPlain.usuarioId, transaction);
    await atualizarOrdemServidoresGlobalSemColisao(og.map((x) => Number(x)), transaction, escopoAf);
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
          attributes: ['id', 'dataReferencia', 'usuarioId', 'observacao'],
          required: false,
          include: [{ model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login'] }],
        },
        {
          model: PlantaoModel,
          as: 'plantaoDestino',
          attributes: ['id', 'dataReferencia', 'usuarioId', 'observacao'],
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
      pOrigem.observacao = null;
      pDestino.observacao = null;
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
          separate: true,
          order: [
            [sequelize.literal("CASE WHEN categoria_membro = 'veterinario' THEN 0 ELSE 1 END"), 'ASC'],
            ['ordem', 'ASC'],
          ],
          attributes: ['id', 'ordem', 'usuarioId', 'ativo', 'categoriaMembro'],
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
          separate: true,
          order: [
            [sequelize.literal("CASE WHEN categoria_membro = 'veterinario' THEN 0 ELSE 1 END"), 'ASC'],
            ['ordem', 'ASC'],
          ],
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
        [sequelize.literal("CASE WHEN categoria_plantao = 'veterinario' THEN 0 ELSE 1 END"), 'ASC'],
        ['vagaIndice', 'ASC'],
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

    const membros = await EscalaMembroModel.findAll({
      where: { escalaId: eid, ativo: true },
      attributes: ['usuarioId', 'ordem', 'categoriaMembro'],
      order: [
        [sequelize.literal("CASE WHEN categoria_membro = 'veterinario' THEN 0 ELSE 1 END"), 'ASC'],
        ['ordem', 'ASC'],
      ],
    });
    let ordemVet = membros
      .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.VETERINARIO)
      .map((m) => Number(m.usuarioId))
      .filter((id) => Number.isFinite(id) && id > 0);
    let ordemTec = membros
      .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.TECNICO)
      .map((m) => Number(m.usuarioId))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (ordemVet.length === 0) {
      ordemVet = await obterOrdemGlobalUsuarioIds(undefined, ESCOPO_ORDEM.VETERINARIO);
    }
    if (ordemTec.length === 0) {
      ordemTec = await obterOrdemGlobalUsuarioIds(undefined, ESCOPO_ORDEM.TECNICO);
    }

    const ultimoVet = await PlantaoModel.findOne({
      where: { escalaId: eid, categoriaPlantao: CATEGORIA_PLANTAO.VETERINARIO },
      order: [
        ['dataReferencia', 'DESC'],
        ['id', 'DESC'],
      ],
    });
    let rotVet = [...ordemVet];
    if (ultimoVet && rotVet.length > 0) {
      const uid = Number(ultimoVet.usuarioId);
      const idx = rotVet.indexOf(uid);
      if (idx >= 0) {
        rotVet = [...rotVet.slice(idx + 1), ...rotVet.slice(0, idx + 1)];
      }
    }

    let rotTec = [...ordemTec];
    const ultimoTecPlantao = await PlantaoModel.findOne({
      where: { escalaId: eid, categoriaPlantao: CATEGORIA_PLANTAO.TECNICO },
      order: [
        ['dataReferencia', 'DESC'],
        ['vagaIndice', 'DESC'],
        ['id', 'DESC'],
      ],
    });
    if (ultimoTecPlantao && rotTec.length > 0) {
      const dataUlt = dataReferenciaParaStr(ultimoTecPlantao.dataReferencia);
      const ultimos = await PlantaoModel.findAll({
        where: { escalaId: eid, dataReferencia: dataUlt, categoriaPlantao: CATEGORIA_PLANTAO.TECNICO },
        attributes: ['usuarioId'],
        order: [['id', 'ASC']],
      });
      const uids = [...new Set(ultimos.map((p) => Number(p.usuarioId)).filter((id) => Number.isFinite(id) && id > 0))];
      uids.sort((a, b) => rotTec.indexOf(a) - rotTec.indexOf(b));
      let ord = [...rotTec];
      for (const uid of uids) {
        ord = rotacionarOrdemAposUsuario(ord, uid);
      }
      rotTec = ord;
    }

    const datas = proximasDatasFinsDeSemanaApos(dataFimStr, q);
    const nv = rotVet.length;
    const nt = rotTec.length;

    const idsUnicos = [...new Set([...rotVet, ...rotTec])];
    const usuarios = await UsuarioModel.findAll({
      where: { id: { [Op.in]: idsUnicos } },
      attributes: ['id', 'nome', 'login'],
    });
    const mapa = new Map(usuarios.map((u) => [Number(u.id), u.get({ plain: true })]));

    const montarItem = (dataRef, usuarioId, segundoUsuarioId = null, terceiroUsuarioId = null) => {
      const u = mapa.get(Number(usuarioId));
      const v = segundoUsuarioId != null ? mapa.get(Number(segundoUsuarioId)) : null;
      const w = terceiroUsuarioId != null ? mapa.get(Number(terceiroUsuarioId)) : null;
      const out = {
        dataReferencia: dataRef,
        usuarioId: Number(usuarioId),
        nome: u ? u.nome : null,
        login: u ? u.login : null,
      };
      if (segundoUsuarioId != null) {
        out.segundoUsuarioId = Number(segundoUsuarioId);
        out.segundoNome = v ? v.nome : null;
        out.segundoLogin = v ? v.login : null;
      }
      if (terceiroUsuarioId != null) {
        out.terceiroUsuarioId = Number(terceiroUsuarioId);
        out.terceiroNome = w ? w.nome : null;
        out.terceiroLogin = w ? w.login : null;
      }
      return out;
    };

    if (nv >= 1 && nt >= 2) {
      const itens = datas.map((dataRef, k) => {
        const vetId = rotVet[k % nv];
        const t0 = rotTec[(k * 2) % nt];
        const t1 = rotTec[(k * 2 + 1) % nt];
        return montarItem(dataRef, vetId, t0, t1);
      });
      return { itens };
    }

    if (nv >= 1 && nt === 0) {
      const itens = datas.map((dataRef, k) => montarItem(dataRef, rotVet[k % nv]));
      return { itens };
    }

    if (nv === 0 && nt >= 2) {
      const itens = datas.map((dataRef, k) => {
        const t0 = rotTec[(k * 2) % nt];
        const t1 = rotTec[(k * 2 + 1) % nt];
        return montarItem(dataRef, t0, t1);
      });
      return { itens };
    }

    return { itens: [] };
  },

  listarVeterinarios: async () => {
    const papelVet = await obterPapelVeterinario();
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
      where: { usuarioId: { [Op.in]: ids }, escopo: ESCOPO_ORDEM.VETERINARIO },
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
        return compararUsuariosPorNomeAlfabetico(a, b);
      });
  },

  listarTecnicos: async () => {
    const papelT = await obterPapelTecnico();
    if (!papelT) return [];

    const tecs = await UsuarioModel.findAll({
      include: [
        {
          model: UsuarioPapelModel,
          required: true,
          where: { PapelModelId: papelT.id },
        },
      ],
      where: { ativo: true },
      attributes: ['id', 'nome', 'login', 'email', 'cargo'],
    });
    const tecPlain = tecs.map((v) => v.get({ plain: true }));
    const ids = tecPlain.map((v) => Number(v.id));
    const ordemRows = await OrdemServidorModel.findAll({
      where: { usuarioId: { [Op.in]: ids }, escopo: ESCOPO_ORDEM.TECNICO },
      order: [['ordem', 'ASC']],
    });
    const ordemMap = new Map(ordemRows.map((r) => [Number(r.usuarioId), Number(r.ordem)]));

    return tecPlain
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
        return compararUsuariosPorNomeAlfabetico(a, b);
      });
  },

  salvarOrdemServidores: async (usuarioIds, escopoParam = ESCOPO_ORDEM.VETERINARIO) => {
    const escopo =
      String(escopoParam || '').toLowerCase() === ESCOPO_ORDEM.TECNICO ? ESCOPO_ORDEM.TECNICO : ESCOPO_ORDEM.VETERINARIO;

    const ids = Array.isArray(usuarioIds)
      ? [...new Set(usuarioIds.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x) && x > 0))]
      : [];
    if (ids.length === 0) throw new ApiBaseError('Informe os IDs dos servidores na ordem desejada.');

    const lista = escopo === ESCOPO_ORDEM.TECNICO ? await EscalaService.listarTecnicos() : await EscalaService.listarVeterinarios();
    const rotulo = escopo === ESCOPO_ORDEM.TECNICO ? 'técnicos' : 'veterinários';
    const permitidos = lista.map((v) => Number(v.id));
    if (permitidos.length !== ids.length) {
      throw new ApiBaseError(`A ordem deve conter todos os ${rotulo} ativos, sem repetição.`);
    }
    const setPerm = new Set(permitidos);
    for (const id of ids) {
      if (!setPerm.has(Number(id))) {
        throw new ApiBaseError(`Usuário ${id} não faz parte dos ${rotulo} ativos.`);
      }
    }

    return await sequelizeTransaction(async (t) => {
      await OrdemServidorModel.destroy({ where: { escopo }, transaction: t });
      await OrdemServidorModel.bulkCreate(
        ids.map((usuarioId, idx) => ({
          usuarioId: Number(usuarioId),
          ordem: idx + 1,
          escopo,
        })),
        { transaction: t },
      );
      return escopo === ESCOPO_ORDEM.TECNICO ? await EscalaService.listarTecnicos() : await EscalaService.listarVeterinarios();
    });
  },

  criar: async (payload, criadoPorUsuarioId) => {
    const { nome, descricao, dataInicio, dataFim, periodicidade, membrosVeterinarios, membrosTecnicos, datasPlantaoExtras } = payload;
    if (!nome || !dataInicio || !dataFim || !periodicidade) {
      throw new ApiBaseError('Informe nome, dataInicio, dataFim e periodicidade.');
    }
    if (!PERIODICIDADES.includes(periodicidade)) {
      throw new ApiBaseError(`periodicidade inválida. Use: ${PERIODICIDADES.join(', ')}`);
    }
    if (new Date(dataInicio) > new Date(dataFim)) {
      throw new ApiBaseError('dataInicio deve ser anterior ou igual a dataFim.');
    }

    const normalizarLista = (arr) => {
      if (!Array.isArray(arr) || arr.length === 0) return [];
      return arr
        .map((m, i) => ({
          usuarioId: parseInt(m.usuarioId, 10),
          ordem: m.ordem != null ? parseInt(m.ordem, 10) : i + 1,
        }))
        .sort((a, b) => a.ordem - b.ordem);
    };

    let ordemListaVet = normalizarLista(membrosVeterinarios);
    let ordemListaTec = normalizarLista(membrosTecnicos);

    if (ordemListaVet.length === 0) {
      const globais = await EscalaService.listarVeterinarios();
      ordemListaVet = globais.map((v, i) => ({ usuarioId: Number(v.id), ordem: i + 1 }));
    }
    if (ordemListaTec.length === 0) {
      const globais = await EscalaService.listarTecnicos();
      ordemListaTec = globais.map((v, i) => ({ usuarioId: Number(v.id), ordem: i + 1 }));
    }

    if (ordemListaVet.some((m) => !Number.isFinite(m.usuarioId) || !Number.isFinite(m.ordem) || m.ordem < 1)) {
      throw new ApiBaseError('Ordem de veterinários inválida.');
    }
    if (ordemListaTec.some((m) => !Number.isFinite(m.usuarioId) || !Number.isFinite(m.ordem) || m.ordem < 1)) {
      throw new ApiBaseError('Ordem de técnicos inválida.');
    }
    if (new Set(ordemListaVet.map((m) => m.usuarioId)).size !== ordemListaVet.length) {
      throw new ApiBaseError('Não repita o mesmo veterinário na lista de veterinários.');
    }
    if (new Set(ordemListaTec.map((m) => m.usuarioId)).size !== ordemListaTec.length) {
      throw new ApiBaseError('Não repita o mesmo técnico na lista de técnicos.');
    }
    const setVet = new Set(ordemListaVet.map((m) => m.usuarioId));
    for (const m of ordemListaTec) {
      if (setVet.has(m.usuarioId)) {
        throw new ApiBaseError('A mesma pessoa não pode figurar como veterinário e como técnico na mesma escala.');
      }
    }

    if (ordemListaVet.length < 1) {
      throw new ApiBaseError('A escala exige ao menos 1 veterinário.');
    }
    if (ordemListaTec.length < 2) {
      throw new ApiBaseError('A escala exige ao menos 2 técnicos (duas vagas por dia, sem repetir o mesmo servidor no dia).');
    }

    const permitidosVet = await EscalaService.listarVeterinarios();
    const permitidosTec = await EscalaService.listarTecnicos();
    const setPermVet = new Set(permitidosVet.map((v) => Number(v.id)));
    const setPermTec = new Set(permitidosTec.map((v) => Number(v.id)));
    for (const m of ordemListaVet) {
      if (!setPermVet.has(Number(m.usuarioId))) {
        throw new ApiBaseError(`Usuário ${m.usuarioId} não é veterinário no sistema.`);
      }
    }
    for (const m of ordemListaTec) {
      if (!setPermTec.has(Number(m.usuarioId))) {
        throw new ApiBaseError(`Usuário ${m.usuarioId} não é técnico no sistema.`);
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
          status: 'ativa',
          criadoPorUsuarioId: criadoPorUsuarioId || null,
        },
        { transaction: t },
      );

      await EscalaMembroModel.bulkCreate(
        [
          ...ordemListaVet.map((m) => ({
            escalaId: escala.id,
            usuarioId: m.usuarioId,
            ordem: m.ordem,
            categoriaMembro: CATEGORIA_MEMBRO.VETERINARIO,
            ativo: true,
          })),
          ...ordemListaTec.map((m) => ({
            escalaId: escala.id,
            usuarioId: m.usuarioId,
            ordem: m.ordem,
            categoriaMembro: CATEGORIA_MEMBRO.TECNICO,
            ativo: true,
          })),
        ],
        { transaction: t },
      );

      const datas = mergeDatasPlantaoPrevisto(dataInicio, dataFim, datasPlantaoExtras);
      const nv = ordemListaVet.length;
      const nt = ordemListaTec.length;
      if (datas.length > 0) {
        const rowsPlantao = [];
        let idxV = 0;
        let idxT = 0;
        for (let di = 0; di < datas.length; di++) {
          const dataRef = datas[di];
          rowsPlantao.push(
            {
              escalaId: escala.id,
              usuarioId: ordemListaVet[idxV % nv].usuarioId,
              dataReferencia: dataRef,
              categoriaPlantao: CATEGORIA_PLANTAO.VETERINARIO,
              vagaIndice: 0,
              status: 'previsto',
            },
            {
              escalaId: escala.id,
              usuarioId: ordemListaTec[idxT % nt].usuarioId,
              dataReferencia: dataRef,
              categoriaPlantao: CATEGORIA_PLANTAO.TECNICO,
              vagaIndice: 0,
              status: 'previsto',
            },
            {
              escalaId: escala.id,
              usuarioId: ordemListaTec[(idxT + 1) % nt].usuarioId,
              dataReferencia: dataRef,
              categoriaPlantao: CATEGORIA_PLANTAO.TECNICO,
              vagaIndice: 1,
              status: 'previsto',
            },
          );
          idxV += 1;
          idxT += 2;
        }
        await PlantaoModel.bulkCreate(rowsPlantao, { transaction: t });
      }

      const ordemGlobalInicialVet = await obterOrdemGlobalUsuarioIds(t, ESCOPO_ORDEM.VETERINARIO);
      const ordemGlobalInicialTec = await obterOrdemGlobalUsuarioIds(t, ESCOPO_ORDEM.TECNICO);
      await registrarHistoricoOrdem({
        escalaId: escala.id,
        ordemUsuarioIds: ordemListaVet.map((m) => m.usuarioId),
        ordemGlobalUsuarioIds: ordemGlobalInicialVet,
        motivo: 'inicial',
        categoriaOrdem: CATEGORIA_MEMBRO.VETERINARIO,
        transaction: t,
      });
      await registrarHistoricoOrdem({
        escalaId: escala.id,
        ordemUsuarioIds: ordemListaTec.map((m) => m.usuarioId),
        ordemGlobalUsuarioIds: ordemGlobalInicialTec,
        motivo: 'inicial',
        categoriaOrdem: CATEGORIA_MEMBRO.TECNICO,
        transaction: t,
      });

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
      const membros = await obterMembrosAtivosEscala(escalaId, t);
      const membrosVet = membros.filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.VETERINARIO);
      const membrosTec = membros.filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.TECNICO);
      const primeiroVet = membrosVet.length ? Number(membrosVet[0].usuarioId) : null;
      const primeiroTec = membrosTec.length ? Number(membrosTec[0].usuarioId) : null;
      const segundoTec = membrosTec.length > 1 ? Number(membrosTec[1].usuarioId) : primeiroTec;
      const ordemGlobalVetAntes = await obterOrdemGlobalUsuarioIds(t, ESCOPO_ORDEM.VETERINARIO);
      const ordemGlobalTecAntes = await obterOrdemGlobalUsuarioIds(t, ESCOPO_ORDEM.TECNICO);
      const ordemEscalaVetAntes = membrosVet.map((m) => Number(m.usuarioId));
      const ordemEscalaTecAntes = membrosTec.map((m) => Number(m.usuarioId));

      const novosPlantoes = [];
      for (const ds of novas) {
        if (primeiroVet != null) {
          novosPlantoes.push({
            escalaId,
            usuarioId: primeiroVet,
            dataReferencia: ds,
            categoriaPlantao: CATEGORIA_PLANTAO.VETERINARIO,
            vagaIndice: 0,
            status: 'previsto',
            ordemGlobalUsuarioIdsAntes: ordemGlobalVetAntes,
            ordemEscalaUsuarioIdsAntes: ordemEscalaVetAntes,
          });
        }
        if (primeiroTec != null && segundoTec != null) {
          novosPlantoes.push(
            {
              escalaId,
              usuarioId: primeiroTec,
              dataReferencia: ds,
              categoriaPlantao: CATEGORIA_PLANTAO.TECNICO,
              vagaIndice: 0,
              status: 'previsto',
              ordemGlobalUsuarioIdsAntes: ordemGlobalTecAntes,
              ordemEscalaUsuarioIdsAntes: ordemEscalaTecAntes,
            },
            {
              escalaId,
              usuarioId: segundoTec,
              dataReferencia: ds,
              categoriaPlantao: CATEGORIA_PLANTAO.TECNICO,
              vagaIndice: 1,
              status: 'previsto',
              ordemGlobalUsuarioIdsAntes: ordemGlobalTecAntes,
              ordemEscalaUsuarioIdsAntes: ordemEscalaTecAntes,
            },
          );
        }
      }
      await PlantaoModel.bulkCreate(novosPlantoes, { transaction: t });

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

    const escopoAf = await escopoOrdemGlobalParaUsuarioId(afastamento.usuarioId, transactionExterna || undefined);
    const ordemGlobalAntesSnapshot = await obterOrdemGlobalUsuarioIds(transactionExterna || undefined, escopoAf);

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
    if (categoriaPlantaoDe(origem) !== CATEGORIA_PLANTAO.VETERINARIO || categoriaPlantaoDe(destino) !== CATEGORIA_PLANTAO.VETERINARIO) {
      throw new ApiBaseError('Permuta só está disponível entre plantões de veterinário.');
    }
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

      const membros = await EscalaMembroModel.findAll({
        where: { escalaId, ativo: true },
        attributes: ['usuarioId', 'ordem', 'categoriaMembro'],
        order: [
          [sequelize.literal("CASE WHEN categoria_membro = 'veterinario' THEN 0 ELSE 1 END"), 'ASC'],
          ['ordem', 'ASC'],
        ],
        transaction: t,
      });
      const ordemEscalaVet = membros
        .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.VETERINARIO)
        .map((m) => Number(m.usuarioId))
        .filter((uid) => Number.isFinite(uid) && uid > 0);
      const ordemEscalaTec = membros
        .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.TECNICO)
        .map((m) => Number(m.usuarioId))
        .filter((uid) => Number.isFinite(uid) && uid > 0);
      if (ordemEscalaVet.length === 0 && ordemEscalaTec.length === 0) {
        throw new ApiBaseError('A escala não possui membros ativos para concluir.');
      }

      const ultimoPlantaoQualquer = await PlantaoModel.findOne({
        where: { escalaId },
        order: [
          ['dataReferencia', 'DESC'],
          ['vagaIndice', 'DESC'],
          ['id', 'DESC'],
        ],
        transaction: t,
      });
      if (!ultimoPlantaoQualquer) {
        throw new ApiBaseError('Esta escala não possui plantões; não é possível concluir.');
      }

      if (ordemEscalaVet.length > 0) {
        const ultimoVet = await PlantaoModel.findOne({
          where: { escalaId, categoriaPlantao: CATEGORIA_PLANTAO.VETERINARIO },
          order: [
            ['dataReferencia', 'DESC'],
            ['id', 'DESC'],
          ],
          transaction: t,
        });
        if (ultimoVet) {
          const ordemGlobal = await obterOrdemGlobalUsuarioIds(t, ESCOPO_ORDEM.VETERINARIO);
          const ordemEscalaRotacionada = rotacionarOrdemAposUsuario(ordemEscalaVet, ultimoVet.usuarioId);
          const novaOrdemGlobal = combinarOrdemEscalaNaOrdemGlobal(ordemEscalaRotacionada, ordemGlobal);
          await atualizarOrdemServidoresGlobalSemColisao(novaOrdemGlobal, t, ESCOPO_ORDEM.VETERINARIO);
        }
      }

      if (ordemEscalaTec.length > 0) {
        const ultimoTecPlantao = await PlantaoModel.findOne({
          where: { escalaId, categoriaPlantao: CATEGORIA_PLANTAO.TECNICO },
          order: [
            ['dataReferencia', 'DESC'],
            ['vagaIndice', 'DESC'],
            ['id', 'DESC'],
          ],
          transaction: t,
        });
        if (ultimoTecPlantao) {
          const ordemGlobal = await obterOrdemGlobalUsuarioIds(t, ESCOPO_ORDEM.TECNICO);
          const dataUlt = dataReferenciaParaStr(ultimoTecPlantao.dataReferencia);
          const ultimos = await PlantaoModel.findAll({
            where: { escalaId, dataReferencia: dataUlt, categoriaPlantao: CATEGORIA_PLANTAO.TECNICO },
            attributes: ['usuarioId'],
            order: [['id', 'ASC']],
            transaction: t,
          });
          const uids = [...new Set(ultimos.map((p) => Number(p.usuarioId)).filter((id) => Number.isFinite(id) && id > 0))];
          uids.sort((a, b) => ordemEscalaTec.indexOf(a) - ordemEscalaTec.indexOf(b));
          let ordemEscalaRotacionada = [...ordemEscalaTec];
          for (const uid of uids) {
            ordemEscalaRotacionada = rotacionarOrdemAposUsuario(ordemEscalaRotacionada, uid);
          }
          const novaOrdemGlobal = combinarOrdemEscalaNaOrdemGlobal(ordemEscalaRotacionada, ordemGlobal);
          await atualizarOrdemServidoresGlobalSemColisao(novaOrdemGlobal, t, ESCOPO_ORDEM.TECNICO);
        }
      }

      escala.status = 'concluida';
      await escala.save({ transaction: t });

      await cancelarPermutasPendentesEscala(escalaId, t);

      return escala.get({ plain: true });
    });
  },

  removerUsuarioDasEscalasAtivas: async (usuarioIdRaw, transaction) => {
    const usuarioId = Number(usuarioIdRaw);
    if (!Number.isFinite(usuarioId) || usuarioId < 1) {
      throw new ApiBaseError('Usuário inválido para remoção da escala ativa.');
    }

    const escalasAtivas = await EscalaModel.findAll({
      where: { status: 'ativa' },
      attributes: ['id'],
      transaction,
    });

    let escalasAfetadas = 0;
    let plantoesAtualizados = 0;
    let ordensAlteradas = 0;
    let ordemGlobalAlterada = false;
    let permutasCanceladas = 0;

    for (const esc of escalasAtivas) {
      const escalaId = Number(esc.id);
      const membrosEscala = await EscalaMembroModel.findAll({
        where: { escalaId },
        attributes: ['id', 'usuarioId', 'ordem', 'categoriaMembro', 'ativo'],
        order: [
          [sequelize.literal("CASE WHEN categoria_membro = 'veterinario' THEN 0 ELSE 1 END"), 'ASC'],
          ['ordem', 'ASC'],
          ['id', 'ASC'],
        ],
        transaction,
      });
      const ativoRows = membrosEscala.filter((m) => m.ativo);
      const alvo = ativoRows.find((m) => Number(m.usuarioId) === usuarioId);
      if (!alvo) continue;
      const catRem = categoriaMembroDe(alvo);
      const ativosMesmaCat = ativoRows.filter((m) => categoriaMembroDe(m) === catRem);
      const minNaCat = catRem === CATEGORIA_MEMBRO.TECNICO ? 2 : 1;
      if (ativosMesmaCat.length <= minNaCat) {
        throw new ApiBaseError(
          catRem === CATEGORIA_MEMBRO.TECNICO
            ? 'Não é possível excluir o técnico: a escala ativa precisa de pelo menos 2 técnicos.'
            : 'Não é possível excluir o último veterinário de uma escala ativa.',
        );
      }

      for (const cat of [CATEGORIA_MEMBRO.VETERINARIO, CATEGORIA_MEMBRO.TECNICO]) {
        const rowsCat = membrosEscala.filter((m) => categoriaMembroDe(m) === cat);
        for (let i = 0; i < rowsCat.length; i++) {
          await EscalaMembroModel.update(
            { ordem: -(i + 1) },
            {
              where: { id: Number(rowsCat[i].id), escalaId },
              transaction,
            },
          );
        }
      }

      await EscalaMembroModel.update(
        { ativo: false },
        {
          where: { escalaId, usuarioId, ativo: true },
          transaction,
        },
      );

      for (const cat of [CATEGORIA_MEMBRO.VETERINARIO, CATEGORIA_MEMBRO.TECNICO]) {
        const restantes = await EscalaMembroModel.findAll({
          where: { escalaId, ativo: true, categoriaMembro: cat },
          order: [['ordem', 'ASC']],
          transaction,
        });
        const idsOrd = restantes.map((m) => Number(m.usuarioId)).filter((id) => Number.isFinite(id) && id > 0);
        if (idsOrd.length > 0) {
          await atualizarOrdemMembrosEscalaSemColisao(escalaId, idsOrd, transaction, cat);
        }
      }

      const inativos = await EscalaMembroModel.findAll({
        where: { escalaId, ativo: false },
        attributes: ['id'],
        transaction,
      });
      for (const m of inativos) {
        await EscalaMembroModel.update(
          { ordem: 1000000 + Number(m.id) },
          {
            where: { id: Number(m.id), escalaId },
            transaction,
          },
        );
      }

      const recalc = await recalcularEscalaInterno(escalaId, {
        transaction,
        historicoMotivo: 'manual',
        skipBootstrap: true,
      });
      escalasAfetadas += 1;
      plantoesAtualizados += recalc.atualizados;
      if (recalc.ordemMudou) ordensAlteradas += 1;
      if (recalc.ordemGlobalMudou) ordemGlobalAlterada = true;
      permutasCanceladas += await cancelarPermutasPendentesEscala(escalaId, transaction);
    }

    return {
      escalasAfetadas,
      plantoesAtualizados,
      ordensAlteradas,
      ordemGlobalAlterada,
      permutasCanceladas,
    };
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
