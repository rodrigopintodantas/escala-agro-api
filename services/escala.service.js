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
  EscalaAuditoriaEventoModel,
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

/** Coloca o próximo preferencial (`idxOrdem`) na posição 1 da fila persistida (Rodízio — veterinários). */
function rotacionarOrdemParaProximoPreferencial(ordemUsuarioIds, idxOrdem) {
  const ordem = (ordemUsuarioIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  const n = ordem.length;
  if (n === 0) return ordem;
  const i = ((Number(idxOrdem) % n) + n) % n;
  return [...ordem.slice(i), ...ordem.slice(0, i)];
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

/** Garante permutação única com todos os membros da escala (evita sumir H ou duplicar F). */
function normalizarOrdemRodizioCompleta(ordemUsuarioIds, membrosIdsReferencia) {
  const seen = new Set();
  const out = [];
  for (const id of ordemUsuarioIds || []) {
    const uid = Number(id);
    if (!Number.isFinite(uid) || uid < 1 || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
  }
  for (const id of membrosIdsReferencia || []) {
    const uid = Number(id);
    if (!Number.isFinite(uid) || uid < 1 || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
  }
  return out;
}

/**
 * Férias/abono com a data de início mais cedo entre os afastamentos da escala (ex.: Bruno 05/06
 * com Ana 08/06): recálculo focalizado preserva plantões já ajustados e corrompe a fila
 * (ex.: CDEFBEAF sem G/H). Re-simula do histórico `inicial` com todos os afastamentos.
 */
function afastamentoExigeRecalculoPlenoComHistoricoInicial(afInicioIso, outrosAfastamentos) {
  if (!afInicioIso || !Array.isArray(outrosAfastamentos) || outrosAfastamentos.length === 0) {
    return false;
  }
  const inicios = [
    afInicioIso,
    ...outrosAfastamentos.map((a) => dataReferenciaParaStr(a.dataInicio)).filter(Boolean),
  ];
  const inicioMaisCedo = inicios.sort((a, b) => a.localeCompare(b))[0];
  return afInicioIso === inicioMaisCedo;
}

/** Aplica ordem do histórico `inicial` quando cobre todos os membros ativos (permite tamanhos divergentes no raw). */
function aplicarOrdemInicialHistoricoRodizio(idsInicial, membrosIdsReferencia) {
  const norm = normalizarOrdemRodizioCompleta(idsInicial, membrosIdsReferencia);
  if (membrosIdsReferencia.length > 0 && norm.length === membrosIdsReferencia.length) {
    return norm;
  }
  return null;
}

/** Ordem AABB do histórico `inicial` (ciclo de referência), distinta da fila rotacionada nos membros. */
async function obterOrdemCicloReferenciaEscala(escalaId, membrosIdsReferencia, categoriaMembro, transaction) {
  const cat = String(categoriaMembro || '').toLowerCase();
  let hist = await EscalaOrdemHistoricoModel.findOne({
    where: { escalaId, motivo: 'inicial', categoriaOrdem: cat },
    order: [['id', 'DESC']],
    transaction,
  });
  if (!hist) {
    hist = await EscalaOrdemHistoricoModel.findOne({
      where: { escalaId, motivo: 'inicial', categoriaOrdem: { [Op.is]: null } },
      order: [['id', 'DESC']],
      transaction,
    });
  }
  if (!hist) return [...(membrosIdsReferencia || [])];
  const plain = hist.get ? hist.get({ plain: true }) : hist;
  const idsInicial = Array.isArray(plain.ordemUsuarioIds) ? plain.ordemUsuarioIds.map((x) => Number(x)) : [];
  const aplicada = aplicarOrdemInicialHistoricoRodizio(idsInicial, membrosIdsReferencia);
  return aplicada || [...(membrosIdsReferencia || [])];
}

async function ordemMembrosEscalaPorNomeAlfabetico(membrosIds, transaction) {
  const ids = (membrosIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  if (ids.length === 0) return [];
  const usuarios = await UsuarioModel.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ['id', 'nome'],
    transaction,
  });
  return [...usuarios]
    .sort((a, b) => compararUsuariosPorNomeAlfabetico(a, b))
    .map((u) => Number(u.id))
    .filter((id) => Number.isFinite(id) && id > 0);
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

/** Feriado/ponto facultativo incluído com escala ativa — ordem dos membros não é recalculada. */
function textoGestaoDataAdicionalPlantao() {
  return 'Gestão - Feriado ou data adicional de plantão';
}

/**
 * Cria plantões em datas extras (feriado/facultativo) simulando o rodízio atual, sem alterar ordem na escala.
 */
async function criarPlantoesDatasExtrasModoGestao(escala, novasDatas, criadoPorUsuarioId, transaction) {
  const escalaId = Number(escala.id);
  const dataInicioStr = dataReferenciaParaStr(escala.dataInicio);
  const dataFimStr = dataReferenciaParaStr(escala.dataFim);

  const membros = await obterMembrosAtivosEscala(escalaId, transaction);
  const ordemVet = membros
    .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.VETERINARIO)
    .map((m) => Number(m.usuarioId))
    .filter((id) => Number.isFinite(id) && id > 0);
  const ordemTec = membros
    .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.TECNICO)
    .map((m) => Number(m.usuarioId))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (ordemVet.length === 0 && ordemTec.length < 2) {
    throw new ApiBaseError('Escala sem membros suficientes no rodízio para incluir a data adicional.');
  }

  const plantoesDb = await PlantaoModel.findAll({
    where: { escalaId },
    order: [
      ['dataReferencia', 'ASC'],
      [sequelize.literal("CASE WHEN categoria_plantao = 'veterinario' THEN 0 ELSE 1 END"), 'ASC'],
      ['vagaIndice', 'ASC'],
      ['id', 'ASC'],
    ],
    transaction,
  });
  const plantoesPlain = plantoesDb.map((p) => (p.get ? p.get({ plain: true }) : p));

  const ordemGlobalVetAntes = await obterOrdemGlobalUsuarioIds(transaction, ESCOPO_ORDEM.VETERINARIO);
  const ordemGlobalTecAntes = await obterOrdemGlobalUsuarioIds(transaction, ESCOPO_ORDEM.TECNICO);
  const ordemEscalaVetAntes = [...ordemVet];
  const ordemEscalaTecAntes = [...ordemTec];

  const idsParaAfastamentos = [...new Set([...ordemVet, ...ordemTec])].filter((id) => Number.isFinite(id) && id > 0);
  const afastamentos = await AfastamentoModel.findAll({
    where: {
      usuarioId: { [Op.in]: idsParaAfastamentos },
      dataInicio: { [Op.lte]: dataFimStr },
      dataFim: { [Op.gte]: dataInicioStr },
    },
    include: [
      { model: TipoAfastamentoModel, as: 'tipo', attributes: ['id', 'tipo', 'regraOrdem'] },
      { model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login', 'suspensoEscala'] },
    ],
    transaction,
  });
  const afFlat = afastamentos.map((a) => (a.get ? a.get({ plain: true }) : a));
  const datasNaoUteisParaRetornoPosAfastamento =
    String(escala.periodicidade || '').toLowerCase() === 'fim_de_semana'
      ? new Set(
          plantoesPlain
            .map((p) => dataReferenciaParaStr(p.dataReferencia))
            .filter((ds) => !!ds && !ehFimDeSemanaDataReferencia(ds)),
        )
      : new Set();

  const primeiraNova = novasDatas[0];
  const datasSim = mergeDatasPlantaoPrevisto(dataInicioStr, dataFimStr, novasDatas);
  const datasDesde = datasSim.filter((ds) => ds >= primeiraNova);

  const obsGestao = textoGestaoDataAdicionalPlantao();
  const novosPlantoes = [];

  if (ordemVet.length > 0) {
    const idxVet = obterIdxRodizioAposUltimoPlantaoAntesDe(
      plantoesPlain,
      ordemVet,
      primeiraNova,
      CATEGORIA_PLANTAO.VETERINARIO,
    );
    const ordemVetRot = rotacionarOrdemParaProximoPreferencial(ordemVet, idxVet);
    const simVet = simularRodizioVetPlantoes(ordemVetRot, datasDesde, afFlat, datasNaoUteisParaRetornoPosAfastamento);
    for (const dataIso of novasDatas) {
      const aloc = simVet.alocacoes.find((a) => a.dataIso === dataIso);
      if (!aloc) continue;
      novosPlantoes.push({
        escalaId,
        usuarioId: Number(aloc.usuarioId),
        dataReferencia: dataIso,
        categoriaPlantao: CATEGORIA_PLANTAO.VETERINARIO,
        vagaIndice: 0,
        status: 'previsto',
        observacao: obsGestao,
        ordemGlobalUsuarioIdsAntes: ordemGlobalVetAntes,
        ordemEscalaUsuarioIdsAntes: ordemEscalaVetAntes,
      });
    }
  }

  if (ordemTec.length >= 2) {
    const ordemRefCicloTec = await obterOrdemCicloReferenciaEscala(
      escalaId,
      ordemTec,
      CATEGORIA_MEMBRO.TECNICO,
      transaction,
    );
    const idxTec = obterIdxRodizioAposUltimoPlantaoAntesDe(
      plantoesPlain,
      ordemTec,
      primeiraNova,
      CATEGORIA_PLANTAO.TECNICO,
      ordemRefCicloTec,
    );
    const ordemTecRot = rotacionarOrdemParaProximoPreferencial(ordemTec, idxTec);
    const simTec = simularRodizioTecPlantoes(
      ordemTecRot,
      datasDesde,
      afFlat,
      datasNaoUteisParaRetornoPosAfastamento,
      0,
      plantoesPlain,
      primeiraNova,
    );
    for (const dataIso of novasDatas) {
      const alocs = simTec.alocacoes.filter((a) => a.dataIso === dataIso);
      for (const aloc of alocs) {
        novosPlantoes.push({
          escalaId,
          usuarioId: Number(aloc.usuarioId),
          dataReferencia: dataIso,
          categoriaPlantao: CATEGORIA_PLANTAO.TECNICO,
          vagaIndice: Number(aloc.vagaIndice) || 0,
          status: 'previsto',
          observacao: obsGestao,
          ordemGlobalUsuarioIdsAntes: ordemGlobalTecAntes,
          ordemEscalaUsuarioIdsAntes: ordemEscalaTecAntes,
        });
      }
    }
  }

  if (novosPlantoes.length === 0) {
    throw new ApiBaseError('Não foi possível alocar profissionais para a data adicional informada.');
  }

  await PlantaoModel.bulkCreate(novosPlantoes, { transaction });

  if (ordemVet.length > 0) {
    await registrarEventoAuditoriaEscala({
      escalaId,
      categoriaMembro: CATEGORIA_MEMBRO.VETERINARIO,
      tipoEvento: 'feriado_inclusao',
      referenciaTipo: 'escala',
      referenciaId: escalaId,
      ordemAntesUsuarioIds: ordemEscalaVetAntes,
      ordemDepoisUsuarioIds: ordemEscalaVetAntes,
      detalhes: { datas: novasDatas, modoGestao: true },
      criadoPorUsuarioId,
      transaction,
    });
  }
  if (ordemTec.length > 0) {
    await registrarEventoAuditoriaEscala({
      escalaId,
      categoriaMembro: CATEGORIA_MEMBRO.TECNICO,
      tipoEvento: 'feriado_inclusao',
      referenciaTipo: 'escala',
      referenciaId: escalaId,
      ordemAntesUsuarioIds: ordemEscalaTecAntes,
      ordemDepoisUsuarioIds: ordemEscalaTecAntes,
      detalhes: { datas: novasDatas, modoGestao: true },
      criadoPorUsuarioId,
      transaction,
    });
  }

  return {
    adicionados: novasDatas.length,
    atualizados: 0,
    ordemAlterada: false,
    ordemGlobalAlterada: false,
    permutasCanceladas: 0,
    modoGestao: true,
    datas: novasDatas,
  };
}

function adicionarDiasIso(dataIso, dias) {
  const d = new Date(`${dataIso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return dataReferenciaParaStr(d);
}

/** Primeiro dia do mês seguinte a `dataIso` (ex.: 2026-06-22 → 2026-07-01). */
function primeiroDiaMesSeguinte(dataIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataIso || ''))) return dataIso;
  const d = new Date(`${dataIso}T12:00:00`);
  d.setMonth(d.getMonth() + 1, 1);
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

/**
 * Férias/abono com início em D: remove o servidor de plantões anteriores a D quando não houve
 * dia útil entre o plantão e D (inclui feriados em escalas de fim de semana).
 * Usa `dataInicio` (não `createdAt`) para funcionar com cadastro antecipado.
 */
function usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(
  afastamentosPorUsuario,
  usuarioId,
  dataIso,
  datasNaoUteisIsoSet = new Set(),
) {
  const lista = afastamentosPorUsuario.get(Number(usuarioId)) || [];
  for (const af of lista) {
    if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) continue;
    const inicioAfastamentoIso = dataReferenciaParaStr(af.dataInicio);
    if (!inicioAfastamentoIso || dataIso >= inicioAfastamentoIso) continue;
    const fimIso = dataReferenciaParaStr(af.dataFim);
    if (dataNoIntervalo(dataIso, inicioAfastamentoIso, fimIso)) continue;
    /** Dia útil estrito entre o plantão e o início do afastamento (o dia do plantão não conta). */
    const primeiroDiaAposPlantao = adicionarDiasIso(dataIso, 1);
    if (primeiroDiaAposPlantao >= inicioAfastamentoIso) {
      return true;
    }
    if (!existeDiaUtilNoIntervalo(primeiroDiaAposPlantao, inicioAfastamentoIso, datasNaoUteisIsoSet)) {
      return true;
    }
  }
  return false;
}

/**
 * Menor data de plantão potencialmente afetada pela regra retroativa (para expandir o recálculo).
 */
function calcularDataInicioRetroCadastro(inicioAfastamentoIso, datasNaoUteisIsoSet = new Set()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(inicioAfastamentoIso || ''))) return inicioAfastamentoIso;
  let earliest = inicioAfastamentoIso;
  let p = adicionarDiasIso(inicioAfastamentoIso, -1);
  const limite = adicionarDiasIso(inicioAfastamentoIso, -120);
  while (p >= limite) {
    if (p >= inicioAfastamentoIso) {
      p = adicionarDiasIso(p, -1);
      continue;
    }
    const primeiroAposP = adicionarDiasIso(p, 1);
    const bloqueiaP =
      primeiroAposP >= inicioAfastamentoIso ||
      !existeDiaUtilNoIntervalo(primeiroAposP, inicioAfastamentoIso, datasNaoUteisIsoSet);
    if (bloqueiaP) {
      earliest = p;
      p = adicionarDiasIso(p, -1);
    } else {
      break;
    }
  }
  return earliest;
}

/**
 * Dia de plantão imediatamente antes do início sujeito à regra retroativa (o mais próximo do início).
 * Ex.: abono segunda 22/06 → só 21/06 para corrigir titular errado, não 20/06 com Daniel.
 */
function ultimoDiaPlantaoRetroCadastroAntesInicio(
  inicioAfastamentoIso,
  usuarioId,
  afastamentosPorUsuario,
  datasNaoUteisIsoSet = new Set(),
) {
  const inicio = String(inicioAfastamentoIso || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) return null;
  const limite = calcularDataInicioRetroCadastro(inicio, datasNaoUteisIsoSet);
  let p = adicionarDiasIso(inicio, -1);
  while (p >= limite) {
    if (
      usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(
        afastamentosPorUsuario,
        usuarioId,
        p,
        datasNaoUteisIsoSet,
      )
    ) {
      return p;
    }
    p = adicionarDiasIso(p, -1);
  }
  return null;
}

function usuarioIndisponivelParaPlantaoNoDia(
  afastamentosPorUsuario,
  usuarioId,
  dataIso,
  datasNaoUteisIsoSet = new Set(),
) {
  if (afastamentosAtivosNoDia(afastamentosPorUsuario, usuarioId, dataIso).length > 0) return true;
  if (usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(afastamentosPorUsuario, usuarioId, dataIso, datasNaoUteisIsoSet)) {
    return true;
  }
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
function montarLimitesRetornoPorDataECategoria(plantoes) {
  const limites = new Map();
  for (const p of plantoes) {
    const ds = dataReferenciaParaStr(p.dataReferencia ?? p.dataIso);
    if (!ds) continue;
    const cat = categoriaPlantaoDe(p) || CATEGORIA_PLANTAO.VETERINARIO;
    const key = `${ds}|${cat}`;
    limites.set(key, (limites.get(key) || 0) + 1);
  }
  return limites;
}

function categoriaUsuarioParaRetornoFerias(usuarioId, categoriaPorUsuarioId) {
  const uid = Number(usuarioId);
  if (categoriaPorUsuarioId?.has(uid)) return categoriaPorUsuarioId.get(uid);
  return CATEGORIA_PLANTAO.VETERINARIO;
}

function montarRetornosFeriasNoPrimeiroPlantao(
  afastamentos,
  plantoes,
  datasNaoUteisIsoSet = new Set(),
  categoriaPorUsuarioId = null,
) {
  const mapa = new Map();
  if (!Array.isArray(afastamentos) || !Array.isArray(plantoes) || plantoes.length === 0) {
    return mapa;
  }
  const limitesPorDataCategoria = montarLimitesRetornoPorDataECategoria(plantoes);
  const datasPlantoes = [...new Set(plantoes.map((p) => dataReferenciaParaStr(p.dataReferencia ?? p.dataIso)))].sort();
  const candidatos = [];
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
    /**
     * Só faz sentido forçar retorno quando o afastamento bloqueia alguma data de plantão
     * (ativo, retro-cadastro ou pós-fim sem dia útil intermediário). Caso contrário, o motor
     * acabava deslocando o rodízio por um afastamento que nem fazia o titular perder plantão
     * (ex.: abono em dia útil distante do plantão), contaminando simulações dependentes.
     */
    const apenasEsse = montarAfastamentosPorUsuario([af]);
    const bloqueiaAlgumPlantao = plantoes.some((p) => {
      const ds = dataReferenciaParaStr(p.dataReferencia ?? p.dataIso);
      if (!ds) return false;
      return usuarioIndisponivelParaPlantaoNoDia(apenasEsse, usuarioId, ds, datasNaoUteisIsoSet);
    });
    if (!bloqueiaAlgumPlantao) continue;
    candidatos.push({
      usuarioId,
      primeiraDataPosRetorno,
      fimIso,
      ehFerias,
      ehAbono,
    });
  }
  candidatos.sort((a, b) => {
    const cmpData = a.primeiraDataPosRetorno.localeCompare(b.primeiraDataPosRetorno);
    if (cmpData !== 0) return cmpData;
    const cmpFim = a.fimIso.localeCompare(b.fimIso);
    if (cmpFim !== 0) return cmpFim;
    if (a.ehFerias !== b.ehFerias) return a.ehFerias ? -1 : 1;
    return a.ehAbono ? -1 : 1;
  });
  /**
   * Mesmo dia de retorno:
   * - Férias + férias (ex.: Ana 19 e Gabriela 25 → 27): escalona (1 vaga/dia).
   * - Férias + abono no mesmo dia: mantém os dois no mapa; a fila/escolherRetorno prioriza férias
   *   e o abono retorna no plantão seguinte (ex.: A27 + G28).
   */
  for (const c of candidatos) {
    const catUsuario = categoriaUsuarioParaRetornoFerias(c.usuarioId, categoriaPorUsuarioId);
    let dataAloc = c.primeiraDataPosRetorno;
    while (dataAloc) {
      const ocupados = mapa.get(dataAloc) || [];
      if (ocupados.includes(c.usuarioId)) break;
      const limite =
        limitesPorDataCategoria.get(`${dataAloc}|${catUsuario}`) ||
        limitesPorDataCategoria.get(`${dataAloc}|${CATEGORIA_PLANTAO.VETERINARIO}`) ||
        1;
      const ocupadosMesmaCategoria = ocupados.filter(
        (uid) => categoriaUsuarioParaRetornoFerias(uid, categoriaPorUsuarioId) === catUsuario,
      );
      const candidatoPorUsuario = new Map(candidatos.map((x) => [x.usuarioId, x]));
      const todosConflitoSaoFerias = [...ocupadosMesmaCategoria, c.usuarioId].every(
        (uid) => candidatoPorUsuario.get(uid)?.ehFerias,
      );
      if (ocupadosMesmaCategoria.length < limite || !todosConflitoSaoFerias) {
        mapa.set(dataAloc, [...ocupados, c.usuarioId]);
        break;
      }
      const idx = datasPlantoes.indexOf(dataAloc);
      dataAloc = idx >= 0 && idx + 1 < datasPlantoes.length ? datasPlantoes[idx + 1] : null;
    }
  }
  return mapa;
}

/**
 * Gera datas hipotéticas de plantão APÓS o fim da escala, replicando o padrão de intervalos
 * das últimas datas (ciclo detectado automaticamente). Em escala de fim de semana o ciclo é
 * `[6, 1, 6, 1, ...]`, então as próximas datas após `26/07-dom` são `01/08-sáb`, `02/08-dom`,
 * `08/08-sáb`, `09/08-dom`, `15/08-sáb`, etc. Em escala diária `[1, 1, ...]` é `+1, +1, ...`.
 * Fallback: incrementos de 7 dias.
 */
function gerarDatasPlantaoHipoteticas(datasPlantaoIso, n) {
  if (!Array.isArray(datasPlantaoIso) || datasPlantaoIso.length === 0) return [];
  const datas = [...datasPlantaoIso].sort();
  const numDatas = datas.length;
  const baseLen = Math.min(numDatas - 1, 8);
  const intervalos = [];
  for (let i = numDatas - baseLen; i < numDatas; i++) {
    if (i <= 0) continue;
    const a = new Date(`${datas[i - 1]}T12:00:00`);
    const b = new Date(`${datas[i]}T12:00:00`);
    const diff = Math.round((b - a) / 86400000);
    if (Number.isFinite(diff) && diff > 0) intervalos.push(diff);
  }
  if (intervalos.length === 0) intervalos.push(7);

  let cycleLen = intervalos.length;
  for (let k = 1; k <= Math.floor(intervalos.length / 2); k++) {
    let isCycle = true;
    for (let i = 0; i + k < intervalos.length; i++) {
      if (intervalos[i] !== intervalos[i + k]) {
        isCycle = false;
        break;
      }
    }
    if (isCycle) {
      cycleLen = k;
      break;
    }
  }

  const fantasmas = [];
  let dataAtual = datas[numDatas - 1];
  let idxCiclo = intervalos.length % cycleLen;
  for (let i = 0; i < n; i++) {
    const intervalo = intervalos[idxCiclo % intervalos.length] || 7;
    if (intervalo <= 0) break;
    dataAtual = adicionarDiasIso(dataAtual, intervalo);
    fantasmas.push(dataAtual);
    idxCiclo = (idxCiclo + 1) % cycleLen;
  }
  return fantasmas;
}

/**
 * Reposiciona, na fila final do rodízio, usuários cujo afastamento (férias/abono) terminou
 * sem que houvesse plantão na escala em que o "retorno forçado" pudesse acontecer. A fila
 * final passa a refletir o estado em que o rodízio TERMINARIA caso a escala continuasse
 * gerando plantões hipotéticos com o mesmo padrão de intervalos das últimas datas.
 *
 * Posicionamento: cada pendente é colocado em uma posição relativa ao próximo preferencial
 * (`idxOrdem`) igual ao número de "vagas hipotéticas" que ele PULARIA antes de retornar.
 *  - Fabrícia (férias 20–29/07): retorna em 01/08 (1ª data hipotética). Pula 0 vagas.
 *    Posição relativa = 0 → vai para o topo da fila persistida.
 *  - Helena (férias 24/07–07/08): retorna em 15/08 (5ª data). Pula 8 vagas (1, 2, 8, 9 de
 *    agosto, com 2 vagas/dia para técnicos). Posição relativa = 8 → vai para a 9ª posição.
 *
 * Quando o afastamento é tão longo que nenhuma data hipotética gerada satisfaz a condição
 * de retorno (nenhum dia útil intermediário entre fim+1 e a data hipotética), o pendente
 * NÃO é movido — sua posição "natural" já reflete que ele não voltará tão cedo.
 *
 * Em caso de empate de `posInsercaoHipotetica` entre múltiplos pendentes, quem termina o
 * afastamento mais cedo fica antes (FIFO por `dataFim`).
 */
function aplicarRetornosFeriasPendentesPosEscala({
  ordemAtual,
  idxOrdem,
  afastamentosFlat,
  datasPlantaoIso,
  datasNaoUteisIsoSet = new Set(),
  vagasPorData = 1,
}) {
  const ordemSaida = [...(ordemAtual || [])];
  let idxSaida = Number(idxOrdem) || 0;
  if (!ordemSaida.length || !Array.isArray(datasPlantaoIso) || datasPlantaoIso.length === 0) {
    return { ordemAtual: ordemSaida, idxOrdem: idxSaida };
  }
  const datasOrdenadas = [...datasPlantaoIso].sort();
  const vagasEfetivas = Math.max(1, Number(vagasPorData) || 1);
  const numHipoteticas = Math.max(8, datasOrdenadas.length);
  const datasHipoteticas = gerarDatasPlantaoHipoteticas(datasOrdenadas, numHipoteticas);
  const conjuntoMembros = new Set(ordemSaida.map((id) => Number(id)));
  const pendentes = [];
  for (const af of afastamentosFlat || []) {
    const ehFerias = afastamentoEhFerias(af);
    const ehAbono = afastamentoEhAbono(af);
    if (!ehFerias && !ehAbono) continue;
    const usuarioId = Number(af.usuarioId);
    if (!Number.isFinite(usuarioId) || !conjuntoMembros.has(usuarioId)) continue;
    const fimIso = dataReferenciaParaStr(af.dataFim);
    if (!fimIso) continue;
    const primeiroDiaPosFim = adicionarDiasIso(fimIso, 1);
    const teveRetornoNaEscala = datasOrdenadas.some(
      (ds) => ds > fimIso && existeDiaUtilNoIntervalo(primeiroDiaPosFim, ds, datasNaoUteisIsoSet),
    );
    if (teveRetornoNaEscala) continue;
    const idxRetornoHipotetico = datasHipoteticas.findIndex(
      (d) => d > fimIso && existeDiaUtilNoIntervalo(primeiroDiaPosFim, d, datasNaoUteisIsoSet),
    );
    if (idxRetornoHipotetico < 0) continue;
    const apenasEsse = montarAfastamentosPorUsuario([af]);
    const bloqueiaAlgumPlantao = datasOrdenadas.some((ds) =>
      usuarioIndisponivelParaPlantaoNoDia(apenasEsse, usuarioId, ds, datasNaoUteisIsoSet),
    );
    if (!bloqueiaAlgumPlantao) continue;
    pendentes.push({
      usuarioId,
      fimIso,
      ehFerias,
      posInsercaoHipotetica: idxRetornoHipotetico * vagasEfetivas,
    });
  }
  if (pendentes.length === 0) return { ordemAtual: ordemSaida, idxOrdem: idxSaida };

  pendentes.sort((a, b) => {
    const cmpPos = b.posInsercaoHipotetica - a.posInsercaoHipotetica;
    if (cmpPos !== 0) return cmpPos;
    const cmpFim = b.fimIso.localeCompare(a.fimIso);
    if (cmpFim !== 0) return cmpFim;
    if (a.ehFerias !== b.ehFerias) return a.ehFerias ? 1 : -1;
    return Number(a.usuarioId) - Number(b.usuarioId);
  });
  const jaProcessados = new Set();
  let ordemAtualizada = ordemSaida;
  const idxAtualizado = idxSaida;
  for (const p of pendentes) {
    if (jaProcessados.has(p.usuarioId)) continue;
    if (!ordemAtualizada.includes(p.usuarioId)) continue;
    const len = ordemAtualizada.length;
    if (len === 0) break;
    const posDesejada = ((idxAtualizado + p.posInsercaoHipotetica) % len + len) % len;
    const lista = [...ordemAtualizada];
    const idxAtualPendente = lista.indexOf(Number(p.usuarioId));
    if (idxAtualPendente < 0) continue;
    lista.splice(idxAtualPendente, 1);
    const idxIns = Math.min(Math.max(0, posDesejada), lista.length);
    lista.splice(idxIns, 0, Number(p.usuarioId));
    ordemAtualizada = lista;
    jaProcessados.add(p.usuarioId);
  }
  return { ordemAtual: ordemAtualizada, idxOrdem: idxAtualizado };
}

/** Primeira data de plantão após o fim do afastamento em que já houve dia útil (retorno no ciclo). */
function dataPlantaoRetornoUsuarioNoMapa(retornosFeriasNoPrimeiroPlantao, usuarioId) {
  if (!retornosFeriasNoPrimeiroPlantao) return null;
  const uid = Number(usuarioId);
  for (const [dataIso, uids] of retornosFeriasNoPrimeiroPlantao.entries()) {
    if ((uids || []).some((u) => Number(u) === uid)) return dataIso;
  }
  return null;
}

function dataPlantaoRetornoUsuario(
  retornosFeriasNoPrimeiroPlantao,
  af,
  datasPlantoesOrdenadas,
  datasNaoUteisIsoSet = new Set(),
) {
  const noMapa = dataPlantaoRetornoUsuarioNoMapa(retornosFeriasNoPrimeiroPlantao, af.usuarioId);
  if (noMapa) return noMapa;
  return primeiraDataPlantaoRetornoPosFeriasOuAbono(af, datasPlantoesOrdenadas, datasNaoUteisIsoSet);
}

function primeiraDataPlantaoRetornoPosFeriasOuAbono(af, datasPlantoesOrdenadas, datasNaoUteisIsoSet = new Set()) {
  const ehFerias = afastamentoEhFerias(af);
  const ehAbono = afastamentoEhAbono(af);
  if (!ehFerias && !ehAbono) return null;
  const fimIso = dataReferenciaParaStr(af.dataFim);
  if (!fimIso || !Array.isArray(datasPlantoesOrdenadas) || datasPlantoesOrdenadas.length === 0) {
    return null;
  }
  const primeiroDiaPosFim = adicionarDiasIso(fimIso, 1);
  return (
    datasPlantoesOrdenadas.find(
      (ds) => ds > fimIso && existeDiaUtilNoIntervalo(primeiroDiaPosFim, ds, datasNaoUteisIsoSet),
    ) || null
  );
}

function dataFimMaisAntigoRetornoUsuario(afastamentosPorUsuario, usuarioId) {
  const lista = afastamentosPorUsuario.get(Number(usuarioId)) || [];
  let melhorFim = null;
  for (const af of lista) {
    if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) continue;
    const fimIso = dataReferenciaParaStr(af.dataFim);
    if (!fimIso) continue;
    if (!melhorFim || fimIso < melhorFim) melhorFim = fimIso;
  }
  return melhorFim;
}

/** Menor = maior prioridade no retorno do dia (férias antes de abono). */
function prioridadeRetornoCicloUsuario(afastamentosPorUsuario, usuarioId, dataIso) {
  const lista = afastamentosPorUsuario.get(Number(usuarioId)) || [];
  let melhor = 99;
  for (const af of lista) {
    if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) continue;
    const fimIso = dataReferenciaParaStr(af.dataFim);
    if (!fimIso || !(dataIso > fimIso)) continue;
    const p = afastamentoEhFerias(af) ? 0 : 1;
    if (p < melhor) melhor = p;
  }
  return melhor;
}

function escolherRetornoFeriasDoDia(
  retornosHoje,
  ordemAtual,
  idxPreferencial,
  afastamentosPorUsuario,
  dataIso,
  datasNaoUteisIsoSet = new Set(),
  idsExcluirMesmoDia = new Set(),
) {
  if (!Array.isArray(retornosHoje) || retornosHoje.length === 0 || ordemAtual.length === 0) {
    return null;
  }
  let escolhido = null;
  let melhorPrioridade = Number.MAX_SAFE_INTEGER;
  let menorDistancia = Number.MAX_SAFE_INTEGER;
  for (const uidRaw of retornosHoje) {
    const uid = Number(uidRaw);
    if (idsExcluirMesmoDia.has(uid)) continue;
    const idx = ordemAtual.indexOf(uid);
    if (idx < 0) continue;
    if (usuarioIndisponivelParaPlantaoNoDia(afastamentosPorUsuario, uid, dataIso, datasNaoUteisIsoSet)) continue;
    const prioridade = prioridadeRetornoCicloUsuario(afastamentosPorUsuario, uid, dataIso);
    const distancia = (idx - idxPreferencial + ordemAtual.length) % ordemAtual.length;
    const fimRetorno = dataFimMaisAntigoRetornoUsuario(afastamentosPorUsuario, uid);
    if (
      prioridade < melhorPrioridade ||
      (prioridade === melhorPrioridade &&
        fimRetorno &&
        escolhido != null &&
        fimRetorno.localeCompare(dataFimMaisAntigoRetornoUsuario(afastamentosPorUsuario, escolhido) || '') < 0) ||
      (prioridade === melhorPrioridade && distancia < menorDistancia)
    ) {
      melhorPrioridade = prioridade;
      menorDistancia = distancia;
      escolhido = uid;
    }
  }
  return escolhido;
}

/** Enfileira retornos de férias/abono do dia (usado ao pular plantão no modo focado). */
function enfileirarRetornosFeriasDoDia(
  dataIso,
  ordemAtual,
  retornosFeriasNoPrimeiroPlantao,
  afastamentosPorUsuario,
  datasNaoUteisIsoSet,
  filaRetornosFeriasPendentes,
  idsExcluirMesmoDia = new Set(),
) {
  const retornosHoje = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];
  for (const uidRaw of retornosHoje) {
    const uid = Number(uidRaw);
    if (!Number.isFinite(uid)) continue;
    if (!ordemAtual.includes(uid)) continue;
    if (idsExcluirMesmoDia.has(uid)) continue;
    if (usuarioIndisponivelParaPlantaoNoDia(afastamentosPorUsuario, uid, dataIso, datasNaoUteisIsoSet)) continue;
    if (!filaRetornosFeriasPendentes.includes(uid)) {
      filaRetornosFeriasPendentes.push(uid);
    }
  }
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

/**
 * Propaga a ordem final de uma escala (`ordemFinalEscala`) para a `OrdemServidorModel` global
 * (escopo vet ou téc) preservando os usuários do banco que NÃO pertencem à escala. Apenas as
 * posições ocupadas pelos membros da escala são reescritas, na ordem em que aparecem em
 * `ordemFinalEscala`. Evita que recálculos da escala "sumam" com outros servidores cadastrados.
 *
 * Equivalente ao fluxo antigo (linha de `ordemGlobalTec/Vet` em `recalcularEscalaInterno`),
 * porém isolado para o caminho determinístico (`recalcularEscalaCompleta`).
 */
async function propagarOrdemEscalaParaOrdemGlobal(ordemFinalEscala, escopo, transaction) {
  const idsEscala = (ordemFinalEscala || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (idsEscala.length === 0) return false;

  const ordemGlobalAtual = await obterOrdemGlobalUsuarioIds(transaction, escopo);
  if (ordemGlobalAtual.length === 0) return false;

  const setEscala = new Set(idsEscala);
  const posicoesEscalaNaGlobal = [];
  for (let i = 0; i < ordemGlobalAtual.length; i++) {
    if (setEscala.has(Number(ordemGlobalAtual[i]))) posicoesEscalaNaGlobal.push(i);
  }
  if (posicoesEscalaNaGlobal.length !== idsEscala.length) return false;

  const novaOrdem = [...ordemGlobalAtual];
  for (let i = 0; i < posicoesEscalaNaGlobal.length; i++) {
    novaOrdem[posicoesEscalaNaGlobal[i]] = idsEscala[i];
  }
  if (novaOrdem.join(',') === ordemGlobalAtual.join(',')) return false;

  await atualizarOrdemServidoresGlobalSemColisao(novaOrdem, transaction, escopo);
  return true;
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

  const ServidorService = require('./servidor.service');
  const servidores = await UsuarioModel.findAll({
    include: [{ model: UsuarioPapelModel, required: true, where: { PapelModelId: papel.id } }],
    where: { ativo: true, ...ServidorService.whereNaoAguardandoOrdemEscopo(escopo) },
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

/**
 * Ajusta o índice do rodízio com base nos plantões já gravados antes de `dataLimiteIso`.
 */
/**
 * Técnicos — recálculo focalizado (AABB, 2º/3º abono, retorno do par no dia de retorno).
 */
function plantaoRequerRecalculoFocadoTec(
  usuarioAfetadoId,
  plantao,
  dataIso,
  ordemAtual,
  retornosFeriasNoPrimeiroPlantao,
  afastamentosPorUsuario,
  datasNaoUteisIsoSet,
  historicoAfastamento = null,
  outrosAfastamentosNaEscala = [],
  datasPlantoesOrdenadas = null,
) {
  const uid = Number(usuarioAfetadoId);
  if (!Number.isFinite(uid) || uid < 1 || !ordemAtual?.length) return false;
  if (categoriaPlantaoDe(plantao) !== CATEGORIA_PLANTAO.TECNICO) return false;
  /**
   * Isolamento entre categorias: se o titular do afastamento focado não pertence à categoria
   * do plantão (ex.: técnico focado em plantão vet), esse plantão não está sujeito ao recálculo.
   * Sem essa guarda, o mapa compartilhado `retornosFeriasNoPrimeiroPlantao` (vet+téc) faz a
   * função retornar true quando o usuário focado está nos retornos do dia da outra categoria.
   */
  if (!ordemAtual.includes(uid)) return false;
  /**
   * Abono focalizado: após o fim, re-simula só quando necessário.
   * - 2º abono (ex.: Diego): onda entre fim e 1º retorno (como vet), sem reabrir domingo 21.
   * - 3º+ abono (ex.: Fábio): titular + dia de retorno do par; retroativo tira titular do sáb/dom.
   */
  if (historicoAfastamento) {
    const af = historicoAfastamento.get ? historicoAfastamento.get({ plain: true }) : historicoAfastamento;
    if (afastamentoEhAbono(af) && ordemAtual.includes(uid)) {
      const inicioIso = dataReferenciaParaStr(af.dataInicio);
      if (inicioIso && dataIso < inicioIso && Number(plantao.usuarioId) === uid) {
        return false;
      }
      const fimIso = dataReferenciaParaStr(af.dataFim);
      if (fimIso && dataIso > fimIso) {
        const temAbonoAnteriorNaEscala = (outrosAfastamentosNaEscala || []).some((a) =>
          afastamentoEhAbono(a),
        );
        const datasRef = Array.isArray(datasPlantoesOrdenadas) ? datasPlantoesOrdenadas : [];
        const primeiraRetorno = dataPlantaoRetornoUsuario(
          retornosFeriasNoPrimeiroPlantao,
          af,
          datasRef,
          datasNaoUteisIsoSet,
        );
        if (!temAbonoAnteriorNaEscala) {
          if (primeiraRetorno && dataIso < primeiraRetorno) return true;
          if (Number(plantao.usuarioId) === uid) return true;
          if (primeiraRetorno && dataIso === primeiraRetorno) return true;
          return false;
        }
        if (Number(plantao.usuarioId) === uid) return true;
        if (primeiraRetorno && dataIso === primeiraRetorno) return true;
        return false;
      }
    }
  }
  const retornosHoje = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];
  if (retornosHoje.some((u) => Number(u) === uid)) {
    if (historicoAfastamento) {
      const afRet = historicoAfastamento.get ? historicoAfastamento.get({ plain: true }) : historicoAfastamento;
      const temAbonoAnteriorRet = (outrosAfastamentosNaEscala || []).some((a) => afastamentoEhAbono(a));
      if (afastamentoEhAbono(afRet) && temAbonoAnteriorRet) {
        const datasRefRet = Array.isArray(datasPlantoesOrdenadas) ? datasPlantoesOrdenadas : [];
        const primeiraRetornoRet = dataPlantaoRetornoUsuario(
          retornosFeriasNoPrimeiroPlantao,
          afRet,
          datasRefRet,
          datasNaoUteisIsoSet,
        );
        if (primeiraRetornoRet && dataIso === primeiraRetornoRet) return true;
        return Number(plantao.usuarioId) === uid;
      }
      if (afastamentoEhFerias(afRet)) {
        const temAnteriorFer = (outrosAfastamentosNaEscala || []).length > 0;
        const datasRefFer = Array.isArray(datasPlantoesOrdenadas) ? datasPlantoesOrdenadas : [];
        const primeiraRetornoFer = dataPlantaoRetornoUsuario(
          retornosFeriasNoPrimeiroPlantao,
          afRet,
          datasRefFer,
          datasNaoUteisIsoSet,
        );
        if (temAnteriorFer && primeiraRetornoFer) {
          if (dataIso === primeiraRetornoFer) return true;
          const idxRetFer = datasRefFer.indexOf(primeiraRetornoFer);
          if (idxRetFer >= 0 && datasRefFer[idxRetFer + 1] === dataIso) return true;
        }
        return Number(plantao.usuarioId) === uid;
      }
    }
    return true;
  }
  if (historicoAfastamento) {
    const afHist = historicoAfastamento.get ? historicoAfastamento.get({ plain: true }) : historicoAfastamento;
    if (afastamentoEhFerias(afHist) && Number(afHist.usuarioId) === uid) {
      const inicioIsoHist = dataReferenciaParaStr(afHist.dataInicio);
      const fimIsoHist = dataReferenciaParaStr(afHist.dataFim);
      const temAnteriorHist = (outrosAfastamentosNaEscala || []).length > 0;
      if (inicioIsoHist && dataIso < inicioIsoHist) {
        return Number(plantao.usuarioId) === uid;
      }
      if (fimIsoHist && dataIso > fimIsoHist && temAnteriorHist) {
        const datasRefHist = Array.isArray(datasPlantoesOrdenadas) ? datasPlantoesOrdenadas : [];
        const primeiraRetornoHist = dataPlantaoRetornoUsuario(
          retornosFeriasNoPrimeiroPlantao,
          afHist,
          datasRefHist,
          datasNaoUteisIsoSet,
        );
        if (Number(plantao.usuarioId) === uid) return true;
        if (primeiraRetornoHist && dataIso === primeiraRetornoHist) return true;
        const idxRetHist = datasRefHist.indexOf(primeiraRetornoHist);
        if (idxRetHist >= 0 && datasRefHist[idxRetHist + 1] === dataIso) return true;
        return false;
      }
    }
  }
  if (Number(plantao.usuarioId) !== uid) return false;
  if (historicoAfastamento) {
    const af = historicoAfastamento.get ? historicoAfastamento.get({ plain: true }) : historicoAfastamento;
    const inicioIso = dataReferenciaParaStr(af.dataInicio);
    if (afastamentoEhAbono(af) && inicioIso && dataIso < inicioIso) {
      return false;
    }
  }
  return usuarioIndisponivelParaPlantaoNoDia(afastamentosPorUsuario, uid, dataIso, datasNaoUteisIsoSet);
}

/**
 * Veterinários — recálculo focalizado (1 vaga/dia).
 * Abono sem abono anterior na escala: onda entre fim e 1º retorno (Daniel 12 → E13 F14).
 * Com abono anterior (ex.: Gabriela após Daniel): só titular, dia de retorno e plantão seguinte
 * (evita reabrir 13–20; garante 28 quando retorno em 27 foi da Ana — A27 G28).
 */
function plantaoRequerRecalculoFocadoVet(
  usuarioAfetadoId,
  plantao,
  dataIso,
  ordemAtual,
  retornosFeriasNoPrimeiroPlantao,
  afastamentosPorUsuario,
  datasNaoUteisIsoSet,
  historicoAfastamento = null,
  datasPlantoesOrdenadas = null,
  outrosAfastamentosNaEscala = [],
) {
  const uid = Number(usuarioAfetadoId);
  if (!Number.isFinite(uid) || uid < 1 || !ordemAtual?.length) return false;
  if (categoriaPlantaoDe(plantao) !== CATEGORIA_PLANTAO.VETERINARIO) return false;
  /**
   * Isolamento entre categorias: titular do afastamento focado fora da ordem vet (ex.: técnico)
   * não deve marcar plantões vet como "exige recálculo". O mapa de retornos é compartilhado
   * vet+téc, então é necessário descartar explicitamente esses casos antes das verificações.
   */
  if (!ordemAtual.includes(uid)) return false;

  if (historicoAfastamento) {
    const af = historicoAfastamento.get ? historicoAfastamento.get({ plain: true }) : historicoAfastamento;
    const afUid = Number(af.usuarioId);
    if (Number(afUid) === uid && ordemAtual.includes(uid) && (afastamentoEhAbono(af) || afastamentoEhFerias(af))) {
      const fimIso = dataReferenciaParaStr(af.dataFim);
      if (fimIso && dataIso > fimIso) {
        const datasRef = Array.isArray(datasPlantoesOrdenadas) ? datasPlantoesOrdenadas : [];
        const primeiraRetorno = dataPlantaoRetornoUsuario(
          retornosFeriasNoPrimeiroPlantao,
          af,
          datasRef,
          datasNaoUteisIsoSet,
        );
        const temAfastamentoAnteriorNaEscala = (outrosAfastamentosNaEscala || []).length > 0;
        const temAbonoAnteriorNaEscala = (outrosAfastamentosNaEscala || []).some((a) => afastamentoEhAbono(a));
        if (afastamentoEhAbono(af) && !temAbonoAnteriorNaEscala) {
          if (primeiraRetorno && dataIso < primeiraRetorno) return true;
        } else if (temAfastamentoAnteriorNaEscala && primeiraRetorno) {
          if (Number(plantao.usuarioId) === uid) return true;
          if (dataIso === primeiraRetorno) return true;
          const idxRet = datasRef.indexOf(primeiraRetorno);
          if (idxRet >= 0 && datasRef[idxRet + 1] === dataIso) return true;
        } else if (afastamentoEhFerias(af) && !temAfastamentoAnteriorNaEscala) {
          if (primeiraRetorno && dataIso < primeiraRetorno) return true;
        }
      }
    }
  }

  const retornosHoje = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];
  if (retornosHoje.some((u) => Number(u) === uid)) {
    if (historicoAfastamento) {
      const afRet = historicoAfastamento.get ? historicoAfastamento.get({ plain: true }) : historicoAfastamento;
      const temAnteriorRet = (outrosAfastamentosNaEscala || []).length > 0;
      if (afastamentoEhFerias(afRet) && temAnteriorRet) {
        const datasRefRet = Array.isArray(datasPlantoesOrdenadas) ? datasPlantoesOrdenadas : [];
        const primeiraRetornoRet = dataPlantaoRetornoUsuario(
          retornosFeriasNoPrimeiroPlantao,
          afRet,
          datasRefRet,
          datasNaoUteisIsoSet,
        );
        if (primeiraRetornoRet && dataIso === primeiraRetornoRet) return true;
        const idxRetFer = datasRefRet.indexOf(primeiraRetornoRet);
        if (idxRetFer >= 0 && datasRefRet[idxRetFer + 1] === dataIso) return true;
        return Number(plantao.usuarioId) === uid;
      }
    }
    return true;
  }
  if (historicoAfastamento) {
    const afHist = historicoAfastamento.get ? historicoAfastamento.get({ plain: true }) : historicoAfastamento;
    if (afastamentoEhFerias(afHist) && Number(afHist.usuarioId) === uid) {
      const inicioIsoHist = dataReferenciaParaStr(afHist.dataInicio);
      const fimIsoHist = dataReferenciaParaStr(afHist.dataFim);
      const temAnteriorHist = (outrosAfastamentosNaEscala || []).length > 0;
      if (inicioIsoHist && dataIso < inicioIsoHist) {
        return Number(plantao.usuarioId) === uid;
      }
      if (fimIsoHist && dataIso > fimIsoHist && temAnteriorHist) {
        const datasRefHist = Array.isArray(datasPlantoesOrdenadas) ? datasPlantoesOrdenadas : [];
        const primeiraRetornoHist = dataPlantaoRetornoUsuario(
          retornosFeriasNoPrimeiroPlantao,
          afHist,
          datasRefHist,
          datasNaoUteisIsoSet,
        );
        if (Number(plantao.usuarioId) === uid) return true;
        if (primeiraRetornoHist && dataIso === primeiraRetornoHist) return true;
        const idxRetHist = datasRefHist.indexOf(primeiraRetornoHist);
        if (idxRetHist >= 0 && datasRefHist[idxRetHist + 1] === dataIso) return true;
        return false;
      }
    }
  }
  if (Number(plantao.usuarioId) !== uid) return false;
  return usuarioIndisponivelParaPlantaoNoDia(afastamentosPorUsuario, uid, dataIso, datasNaoUteisIsoSet);
}

/**
 * Em recálculo com afastamentos anteriores na escala: despacha por categoria (vet/téc).
 */
function plantaoRequerRecalculoFocado(
  usuarioAfetadoId,
  plantao,
  dataIso,
  ordemAtual,
  retornosFeriasNoPrimeiroPlantao,
  afastamentosPorUsuario,
  datasNaoUteisIsoSet,
  historicoAfastamento = null,
  outrosAfastamentosNaEscala = [],
  datasPlantoesOrdenadas = null,
) {
  if (categoriaPlantaoDe(plantao) === CATEGORIA_PLANTAO.TECNICO) {
    return plantaoRequerRecalculoFocadoTec(
      usuarioAfetadoId,
      plantao,
      dataIso,
      ordemAtual,
      retornosFeriasNoPrimeiroPlantao,
      afastamentosPorUsuario,
      datasNaoUteisIsoSet,
      historicoAfastamento,
      outrosAfastamentosNaEscala,
      datasPlantoesOrdenadas,
    );
  }
  return plantaoRequerRecalculoFocadoVet(
    usuarioAfetadoId,
    plantao,
    dataIso,
    ordemAtual,
    retornosFeriasNoPrimeiroPlantao,
    afastamentosPorUsuario,
    datasNaoUteisIsoSet,
    historicoAfastamento,
    datasPlantoesOrdenadas,
    outrosAfastamentosNaEscala,
  );
}

function buscarProximoUsuarioDisponivelNoCiclo(
  ordemAtual,
  idxBase,
  afastamentosPorUsuario,
  dataIso,
  datasNaoUteisIsoSet = new Set(),
  idsExcluirMesmoDia = new Set(),
  idsPular = new Set(),
) {
  if (!Array.isArray(ordemAtual) || ordemAtual.length === 0) return null;
  const base = ((Number(idxBase) % ordemAtual.length) + ordemAtual.length) % ordemAtual.length;
  for (let passo = 1; passo <= ordemAtual.length; passo++) {
    const candidato = ordemAtual[(base + passo) % ordemAtual.length];
    const uid = Number(candidato);
    if (!Number.isFinite(uid) || uid < 1) continue;
    if (idsPular.has(uid) || idsExcluirMesmoDia.has(uid)) continue;
    const afastamentosCandidato = afastamentosAtivosNoDia(afastamentosPorUsuario, uid, dataIso);
    const candidatoBloqueadoPosFeriasOuAbono = usuarioBloqueadoPosFeriasOuAbonoNoDia(
      afastamentosPorUsuario,
      uid,
      dataIso,
      datasNaoUteisIsoSet,
    );
    const candidatoSomenteAtestado =
      !candidatoBloqueadoPosFeriasOuAbono &&
      afastamentosCandidato.length > 0 &&
      afastamentosCandidato.every((af) => afastamentoEhAtestado(af));
    const candidatoIndisponivelReal =
      candidatoBloqueadoPosFeriasOuAbono || (afastamentosCandidato.length > 0 && !candidatoSomenteAtestado);
    if (candidatoIndisponivelReal) continue;
    return uid;
  }
  return null;
}

/**
 * Retroativo focalizado em lote: cada plantão do titular antes do início do afastamento recebe
 * substituto distinto, avançando o ciclo (evita Gabriela no sábado e domingo).
 */
async function processarRetroativoFocadoEmLote({
  plantoes,
  usuarioAfetadoId,
  inicioAfastamentoIso,
  categoriaPlantaoAlvo,
  ordemAtual,
  ordemGlobal,
  idxInicial,
  afastamentosPorUsuario,
  datasNaoUteisIsoSet,
  transaction,
  rotuloProfissional,
  historicoAfastamento = null,
}) {
  const uid = Number(usuarioAfetadoId);
  const idsProcessados = new Set();
  let atualizados = 0;
  let ordem = [...ordemAtual];
  let og = [...ordemGlobal];
  let idxBusca = Number(idxInicial) || 0;
  let ultimaDataRetro = '';
  let ultimoSubstituto = null;
  const afHist = historicoAfastamento
    ? historicoAfastamento.get
      ? historicoAfastamento.get({ plain: true })
      : historicoAfastamento
    : null;
  const ultimoDiaRetroAntesInicio = ultimoDiaPlantaoRetroCadastroAntesInicio(
    inicioAfastamentoIso,
    uid,
    afastamentosPorUsuario,
    datasNaoUteisIsoSet,
  );

  let temAbonoAnteriorNoLote = false;
  for (const listaAf of afastamentosPorUsuario.values()) {
    for (const a of listaAf || []) {
      if (afastamentoEhAbono(a) && Number(a.usuarioId) !== uid) {
        temAbonoAnteriorNoLote = true;
        break;
      }
    }
    if (temAbonoAnteriorNoLote) break;
  }
  const datasRefRetroLote = [
    ...new Set(
      plantoes
        .filter((px) => categoriaPlantaoDe(px) === categoriaPlantaoAlvo)
        .map((px) => dataReferenciaParaStr(px.dataReferencia))
        .filter(Boolean),
    ),
  ].sort();

  const plantoesRetro = plantoes
    .filter((p) => {
      if (categoriaPlantaoDe(p) !== categoriaPlantaoAlvo) return false;
      const ds = dataReferenciaParaStr(p.dataReferencia);
      if (!ds) return false;

      if (
        categoriaPlantaoAlvo === CATEGORIA_PLANTAO.TECNICO &&
        afHist &&
        afastamentoEhAbono(afHist) &&
        temAbonoAnteriorNoLote
      ) {
        return (
          ds < inicioAfastamentoIso &&
          Number(p.usuarioId) === uid &&
          usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(
            afastamentosPorUsuario,
            uid,
            ds,
            datasNaoUteisIsoSet,
          )
        );
      }

      if (!ds || ds >= inicioAfastamentoIso) return false;
      if (!usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(afastamentosPorUsuario, uid, ds, datasNaoUteisIsoSet)) {
        return false;
      }
      if (categoriaPlantaoAlvo === CATEGORIA_PLANTAO.VETERINARIO) {
        /**
         * Só o titular afetado ou o último fim de semana antes do início (ex.: 21, não 20 com Daniel).
         * Evita trocar D20 por E20 ao cadastrar abono da Gabriela na segunda 22/06.
         */
        if (Number(p.usuarioId) === uid) return true;
        if (ultimoDiaRetroAntesInicio && ds === ultimoDiaRetroAntesInicio) return true;
        return false;
      }
      if (categoriaPlantaoAlvo === CATEGORIA_PLANTAO.TECNICO && afHist && afastamentoEhAbono(afHist)) {
        return Number(p.usuarioId) === uid;
      }
      return Number(p.usuarioId) === uid;
    })
    .sort((a, b) => dataReferenciaParaStr(a.dataReferencia).localeCompare(dataReferenciaParaStr(b.dataReferencia)));

  for (const plantao of plantoesRetro) {
    const dataIso = dataReferenciaParaStr(plantao.dataReferencia);
    const posTitular = ordem.indexOf(uid);
    const retroTitular =
      !!inicioAfastamentoIso && dataIso < inicioAfastamentoIso && posTitular >= 0;
    const primeiroRetroDoLote = retroTitular && !ultimaDataRetro;
    const posGravado = ordem.indexOf(Number(plantao.usuarioId));
    let idxParaBusca;
    if (
      categoriaPlantaoAlvo === CATEGORIA_PLANTAO.VETERINARIO &&
      ultimoDiaRetroAntesInicio &&
      dataIso === ultimoDiaRetroAntesInicio &&
      Number(plantao.usuarioId) !== uid &&
      posGravado >= 0
    ) {
      /** Plantão com outro nome na BD: substituto segue a partir de quem está gravado (ex.: 21 com G → H). */
      idxParaBusca = posGravado;
    } else if (primeiroRetroDoLote) {
      idxParaBusca = posTitular >= 0 ? posTitular : idxBusca % ordem.length;
    } else if (retroTitular) {
      idxParaBusca = idxBusca % ordem.length;
    } else if (ultimaDataRetro && dataIso > ultimaDataRetro) {
      idxParaBusca = idxBusca;
    } else {
      idxParaBusca = posTitular >= 0 ? posTitular : idxBusca;
    }
    const idsExcluirMesmoDia = new Set();
    if (categoriaPlantaoAlvo === CATEGORIA_PLANTAO.TECNICO) {
      for (const p of plantoes) {
        if (categoriaPlantaoDe(p) !== categoriaPlantaoAlvo) continue;
        if (dataReferenciaParaStr(p.dataReferencia) !== dataIso) continue;
        if (Number(p.id) === Number(plantao.id)) continue;
        const u = Number(p.usuarioId);
        if (Number.isFinite(u) && u > 0) idsExcluirMesmoDia.add(u);
      }
    }
    const encontrado = buscarProximoUsuarioDisponivelNoCiclo(
      ordem,
      idxParaBusca,
      afastamentosPorUsuario,
      dataIso,
      datasNaoUteisIsoSet,
      idsExcluirMesmoDia,
      new Set([uid]),
    );
    if (!encontrado) {
      throw new ApiBaseError(`Não há ${rotuloProfissional.toLowerCase()} disponível para o plantão em ${dataIso}.`);
    }
    ordem = moverUsuarioDepoisDaCobertura(ordem, uid, encontrado);
    og = moverUsuarioDepoisDaCobertura(og, uid, encontrado);
    /** Próximo plantão: após o ausente na fila (não repetir o titular como preferencial). */
    idxBusca = (ordem.indexOf(uid) + 1) % ordem.length;
    ultimaDataRetro = dataIso;
    ultimoSubstituto = encontrado;
    if (Number(plantao.usuarioId) !== encontrado) {
      plantao.usuarioId = encontrado;
      plantao.observacao = null;
      await plantao.save({ transaction });
      atualizados += 1;
    }
    idsProcessados.add(Number(plantao.id));
  }

  if (ultimoSubstituto != null && ultimaDataRetro) {
    const corrigidos = await corrigirCoberturaDuplicadaAposRetro({
      plantoes,
      inicioAfastamentoIso,
      ultimaDataRetroIso: ultimaDataRetro,
      ultimoSubstitutoId: ultimoSubstituto,
      titularAfastadoId: uid,
      categoriaPlantaoAlvo,
      ordemAtual: ordem,
      ordemGlobal: og,
      idxBusca,
      afastamentosPorUsuario,
      datasNaoUteisIsoSet,
      transaction,
      idsProcessados,
      rotuloProfissional,
    });
    ordem = corrigidos.ordemAtual;
    og = corrigidos.ordemGlobal;
    idxBusca = corrigidos.idxBusca;
    atualizados += corrigidos.atualizados;
  }

  return { ordemAtual: ordem, ordemGlobal: og, idxOrdem: idxBusca, idsProcessados, atualizados };
}

/** Plantão entre o último retroativo e o início do afastamento que ficou com o mesmo substituto (ex.: domingo). */
async function corrigirCoberturaDuplicadaAposRetro({
  plantoes,
  inicioAfastamentoIso,
  ultimaDataRetroIso,
  ultimoSubstitutoId,
  titularAfastadoId = null,
  categoriaPlantaoAlvo,
  ordemAtual,
  ordemGlobal,
  idxBusca,
  afastamentosPorUsuario,
  datasNaoUteisIsoSet,
  transaction,
  idsProcessados,
  rotuloProfissional,
}) {
  let ordem = ordemAtual;
  let og = ordemGlobal;
  let idx = idxBusca;
  let atualizados = 0;
  const primeiroAposUltimoRetro = adicionarDiasIso(ultimaDataRetroIso, 1);
  const substitutoId = Number(ultimoSubstitutoId);
  const titularId = Number(titularAfastadoId);
  const idsPularSubstituicao = new Set([substitutoId]);
  if (Number.isFinite(titularId) && titularId > 0) idsPularSubstituicao.add(titularId);

  for (const plantao of plantoes) {
    if (categoriaPlantaoDe(plantao) !== categoriaPlantaoAlvo) continue;
    const dataIso = dataReferenciaParaStr(plantao.dataReferencia);
    if (!dataIso || dataIso >= inicioAfastamentoIso || dataIso < primeiroAposUltimoRetro) continue;
    if (Number(plantao.usuarioId) !== substitutoId) continue;
    if (idsProcessados.has(Number(plantao.id))) continue;
    if (existeDiaUtilNoIntervalo(primeiroAposUltimoRetro, dataIso, datasNaoUteisIsoSet)) continue;

    const idsExcluirMesmoDia = new Set();
    if (categoriaPlantaoAlvo === CATEGORIA_PLANTAO.TECNICO) {
      for (const p of plantoes) {
        if (categoriaPlantaoDe(p) !== categoriaPlantaoAlvo) continue;
        if (dataReferenciaParaStr(p.dataReferencia) !== dataIso) continue;
        if (Number(p.id) === Number(plantao.id)) continue;
        const u = Number(p.usuarioId);
        if (Number.isFinite(u) && u > 0) idsExcluirMesmoDia.add(u);
      }
    }

    const posSubstituto = ordem.indexOf(substitutoId);
    const encontrado = buscarProximoUsuarioDisponivelNoCiclo(
      ordem,
      posSubstituto >= 0 ? posSubstituto : idx,
      afastamentosPorUsuario,
      dataIso,
      datasNaoUteisIsoSet,
      idsExcluirMesmoDia,
      idsPularSubstituicao,
    );
    if (!encontrado) {
      throw new ApiBaseError(`Não há ${rotuloProfissional.toLowerCase()} disponível para o plantão em ${dataIso}.`);
    }
    if (Number(plantao.usuarioId) !== encontrado) {
      plantao.usuarioId = encontrado;
      plantao.observacao = null;
      await plantao.save({ transaction });
      atualizados += 1;
    }
    if (Number.isFinite(titularId) && titularId > 0) {
      idx = (ordem.indexOf(titularId) + 1) % ordem.length;
    } else {
      idx = (ordem.indexOf(encontrado) + 1) % ordem.length;
    }
    idsProcessados.add(Number(plantao.id));
  }

  return { ordemAtual: ordem, ordemGlobal: og, idxBusca: idx, atualizados };
}

/**
 * Garante duas pessoas distintas nas duas vagas de técnico no mesmo dia (ex.: Eduardo/Eduardo no 14/06
 * após recálculo focalizado que altera só a vaga 0 e mantém a vaga 1 gravada na BD).
 */
async function corrigirDuplicatasTecnicosMesmoDia({
  plantoes,
  ordemAtualTec,
  afastamentosPorUsuario,
  datasNaoUteisIsoSet,
  transaction,
}) {
  if (!ordemAtualTec?.length) return 0;
  const porData = new Map();
  for (const p of plantoes) {
    if (categoriaPlantaoDe(p) !== CATEGORIA_PLANTAO.TECNICO) continue;
    const ds = dataReferenciaParaStr(p.dataReferencia);
    if (!ds) continue;
    if (!porData.has(ds)) porData.set(ds, []);
    porData.get(ds).push(p);
  }
  let atualizados = 0;
  for (const [, lista] of porData) {
    if (lista.length < 2) continue;
    lista.sort((a, b) => Number(a.vagaIndice ?? 0) - Number(b.vagaIndice ?? 0));
    const p0 = lista[0];
    const p1 = lista[1];
    const u0 = Number(p0.usuarioId);
    const u1 = Number(p1.usuarioId);
    if (!Number.isFinite(u0) || u0 < 1 || u0 !== u1) continue;
    const dataIso = dataReferenciaParaStr(p1.dataReferencia);
    const idsExcluir = new Set([u0]);
    const pos = ordemAtualTec.indexOf(u0);
    const encontrado = buscarProximoUsuarioDisponivelNoCiclo(
      ordemAtualTec,
      pos >= 0 ? pos : 0,
      afastamentosPorUsuario,
      dataIso,
      datasNaoUteisIsoSet,
      idsExcluir,
      new Set(),
    );
    if (!encontrado) continue;
    if (Number(p1.usuarioId) !== encontrado) {
      p1.usuarioId = encontrado;
      p1.observacao = null;
      if (transaction) {
        await p1.save({ transaction });
      }
      atualizados += 1;
    }
  }
  return atualizados;
}

/**
 * No 1º plantão após dia útil pós-abono, realoca o par AABB do dia (ex.: 27/06 Fábio + Álvaro).
 * Evita manter o titular da vaga 1 (ex.: Diego já escalado no 20) só por ainda estar “disponível”.
 */
function alocarParTecDiaRetornoAbonoFocalizado({
  plantoes,
  dataIso,
  usuarioAfetadoId,
  ordemAtualTec,
  ordemGlobalTec,
  afastamentosPorUsuario,
  retornosFeriasNoPrimeiroPlantao,
  datasNaoUteisIsoSet,
}) {
  const uid = Number(usuarioAfetadoId);
  const retornosHoje = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];
  if (!retornosHoje.some((u) => Number(u) === uid)) return null;

  const par = plantoes
    .filter(
      (p) =>
        categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO &&
        dataReferenciaParaStr(p.dataReferencia) === dataIso,
    )
    .sort((a, b) => Number(a.vagaIndice) - Number(b.vagaIndice));
  if (par.length < 2) return null;

  let ordem = [...ordemAtualTec];
  let og = [...ordemGlobalTec];
  const idxFoc = ordem.indexOf(uid);
  if (idxFoc < 0) return null;

  const p0 = par[0];
  const p1 = par[1];
  const idsExcluir = new Set([uid]);
  const u0 = uid;

  const u1Atual = Number(p1.usuarioId);
  if (
    Number(p0.usuarioId) === u0 &&
    Number.isFinite(u1Atual) &&
    u1Atual > 0 &&
    u1Atual !== u0 &&
    !usuarioIndisponivelParaPlantaoNoDia(afastamentosPorUsuario, u1Atual, dataIso, datasNaoUteisIsoSet)
  ) {
    return {
      ordemAtualTec,
      ordemGlobalTec,
      idxOrdemTec: (ordemAtualTec.indexOf(u1Atual) + 1) % ordemAtualTec.length,
      idsProcessados: par.map((p) => Number(p.id)),
      atualizados: 0,
    };
  }

  let u1 = null;
  const outrosRetornos = retornosHoje
    .map((u) => Number(u))
    .filter(
      (u) =>
        Number.isFinite(u) &&
        u > 0 &&
        u !== uid &&
        !idsExcluir.has(u) &&
        !usuarioIndisponivelParaPlantaoNoDia(afastamentosPorUsuario, u, dataIso, datasNaoUteisIsoSet),
    );
  if (outrosRetornos.length > 0) {
    u1 = escolherRetornoFeriasDoDia(
      outrosRetornos,
      ordem,
      (idxFoc + 1) % ordem.length,
      afastamentosPorUsuario,
      dataIso,
      datasNaoUteisIsoSet,
      idsExcluir,
    );
  }
  if (u1 == null) {
    u1 = buscarProximoUsuarioDisponivelNoCiclo(
      ordem,
      (idxFoc + 1) % ordem.length,
      afastamentosPorUsuario,
      dataIso,
      datasNaoUteisIsoSet,
      idsExcluir,
      new Set(),
    );
  }
  if (u1 == null) return null;

  const titular0Antes = Number(p0.usuarioId);
  const titular1Antes = Number(p1.usuarioId);
  if (titular0Antes !== u0 && Number.isFinite(titular0Antes) && titular0Antes > 0) {
    ordem = moverUsuarioDepoisDaCobertura(ordem, titular0Antes, u0);
    og = moverUsuarioDepoisDaCobertura(og, titular0Antes, u0);
  }
  if (titular1Antes !== u1 && Number.isFinite(titular1Antes) && titular1Antes > 0) {
    ordem = moverUsuarioDepoisDaCobertura(ordem, titular1Antes, u1);
    og = moverUsuarioDepoisDaCobertura(og, titular1Antes, u1);
  }

  p0.usuarioId = u0;
  p0.observacao = null;
  p1.usuarioId = u1;
  p1.observacao = null;

  return {
    ordemAtualTec: ordem,
    ordemGlobalTec: og,
    idxOrdemTec: (ordem.indexOf(u1) + 1) % ordem.length,
    idsProcessados: par.map((p) => Number(p.id)),
    atualizados:
      (titular0Antes !== u0 ? 1 : 0) + (titular1Antes !== u1 ? 1 : 0),
  };
}

/**
 * 3º+ abono focalizado: alinha o par do plantão seguinte ao retorno do titular com o rodízio pleno,
 * só se o gravado divergir (ex.: 28/06 FK → HH). Não reabre o dia no loop (evita Amanda/Bernardo).
 */
/** 2º abono focalizado: alinha plantões ao rodízio pleno (evita desvio do incremental vs simulação única). */
function reconciliarPlantoesTecComRodizioPleno({
  plantoes,
  ordemInicial,
  afastamentosFlat,
  datasNaoUteisIsoSet = new Set(),
}) {
  const datasTec = [
    ...new Set(
      plantoes
        .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO)
        .map((p) => dataReferenciaParaStr(p.dataReferencia))
        .filter(Boolean),
    ),
  ].sort();
  if (!datasTec.length) return 0;
  const sim = simularRodizioTecPlantoes(ordemInicial, datasTec, afastamentosFlat, datasNaoUteisIsoSet);
  let atualizados = 0;
  for (const a of sim.alocacoes) {
    const pl = plantoes.find(
      (p) =>
        categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO &&
        dataReferenciaParaStr(p.dataReferencia) === a.dataIso &&
        Number(p.vagaIndice) === Number(a.vagaIndice),
    );
    if (!pl) continue;
    const alvo = Number(a.usuarioId);
    if (Number.isFinite(alvo) && alvo > 0 && Number(pl.usuarioId) !== alvo) {
      pl.usuarioId = alvo;
      pl.observacao = null;
      atualizados += 1;
    }
  }
  return atualizados;
}

function alinharParTecDiaSeguinteRetornoAbonoComRodizioPleno({
  plantoes,
  dataSeguinteIso,
  ordemInicial,
  afastamentosFlat,
  datasNaoUteisIsoSet = new Set(),
}) {
  if (!dataSeguinteIso || !Array.isArray(plantoes) || plantoes.length === 0) return { atualizados: 0 };
  const parAtual = plantoes
    .filter(
      (p) =>
        categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO &&
        dataReferenciaParaStr(p.dataReferencia) === dataSeguinteIso,
    )
    .sort((a, b) => Number(a.vagaIndice) - Number(b.vagaIndice));
  if (parAtual.length < 2) return { atualizados: 0 };

  const datasTec = [
    ...new Set(
      plantoes
        .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO)
        .map((p) => dataReferenciaParaStr(p.dataReferencia))
        .filter(Boolean),
    ),
  ].sort();
  const plantoesRef = plantoes
    .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO)
    .map((p) => ({
      dataReferencia: dataReferenciaParaStr(p.dataReferencia),
      categoriaPlantao: CATEGORIA_PLANTAO.TECNICO,
      usuarioId: Number(p.usuarioId),
      vagaIndice: Number(p.vagaIndice),
    }));
  const sim = simularRodizioTecPlantoes(
    ordemInicial,
    datasTec.length ? datasTec : [dataSeguinteIso],
    afastamentosFlat,
    datasNaoUteisIsoSet,
  );
  const esperado = sim.alocacoes
    .filter((a) => a.dataIso === dataSeguinteIso)
    .sort((a, b) => Number(a.vagaIndice) - Number(b.vagaIndice));
  if (esperado.length < 2) return { atualizados: 0 };

  let atualizados = 0;
  for (let i = 0; i < 2; i++) {
    const alvo = Number(esperado[i].usuarioId);
    if (!Number.isFinite(alvo) || alvo < 1) continue;
    if (Number(parAtual[i].usuarioId) !== alvo) {
      parAtual[i].usuarioId = alvo;
      parAtual[i].observacao = null;
      atualizados += 1;
    }
  }
  return { atualizados };
}

/** Veterinário (1 vaga/dia): alinha titular do dia ao rodízio pleno de referência. */
function alinharPlantaoVetDiaComRodizioPleno({
  plantoes,
  dataIso,
  ordemInicial,
  afastamentosFlat,
  datasNaoUteisIsoSet = new Set(),
}) {
  if (!dataIso || !Array.isArray(plantoes) || plantoes.length === 0) return { atualizados: 0 };
  const pl = plantoes.find(
    (p) =>
      categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO &&
      dataReferenciaParaStr(p.dataReferencia) === dataIso,
  );
  if (!pl) return { atualizados: 0 };
  const datasVet = [
    ...new Set(
      plantoes
        .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO)
        .map((p) => dataReferenciaParaStr(p.dataReferencia))
        .filter(Boolean),
    ),
  ].sort();
  const sim = simularRodizioVetPlantoes(
    ordemInicial,
    datasVet.length ? datasVet : [dataIso],
    afastamentosFlat,
    datasNaoUteisIsoSet,
  );
  const esperado = sim.alocacoes.find((a) => a.dataIso === dataIso);
  if (!esperado) return { atualizados: 0 };
  const alvo = Number(esperado.usuarioId);
  if (!Number.isFinite(alvo) || alvo < 1 || Number(pl.usuarioId) === alvo) return { atualizados: 0 };
  pl.usuarioId = alvo;
  pl.observacao = null;
  return { atualizados: 1 };
}

/** Veterinário: mesmo titular no fim de semana anterior (ex.: D20 e D21 após pular retorno de Daniel no 20). */
function plantaoVetMesmaPessoaNoFimDeSemanaAnterior(plantoes, plantao) {
  if (categoriaPlantaoDe(plantao) !== CATEGORIA_PLANTAO.VETERINARIO) return false;
  const dataIso = dataReferenciaParaStr(plantao.dataReferencia);
  const uid = Number(plantao.usuarioId);
  if (!dataIso || !Number.isFinite(uid) || uid < 1 || !Array.isArray(plantoes)) return false;
  let dataAnterior = null;
  for (const p of plantoes) {
    if (categoriaPlantaoDe(p) !== CATEGORIA_PLANTAO.VETERINARIO) continue;
    const ds = dataReferenciaParaStr(p.dataReferencia);
    if (!ds || ds >= dataIso) continue;
    if (!dataAnterior || ds > dataAnterior) dataAnterior = ds;
  }
  if (!dataAnterior) return false;
  const plantaoAnterior = plantoes.find(
    (p) =>
      categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO &&
      dataReferenciaParaStr(p.dataReferencia) === dataAnterior,
  );
  return plantaoAnterior != null && Number(plantaoAnterior.usuarioId) === uid;
}

function avancarIdxOrdemAPartirDoPlantao(plantao, ordemAtual, catPlantao, idxState) {
  const uid = Number(plantao.usuarioId);
  if (!ordemAtual.length || !Number.isFinite(uid) || uid < 1) return;
  const pos = ordemAtual.indexOf(uid);
  if (pos < 0) return;
  const next = (pos + 1) % ordemAtual.length;
  if (catPlantao === CATEGORIA_PLANTAO.TECNICO) idxState.idxTec = next;
  else idxState.idxVet = next;
}

function sincronizarIdxOrdemDePlantoes(plantoes, ordemAtualVet, ordemAtualTec, dataLimiteIso) {
  let idxVet = 0;
  let idxTec = 0;
  if (!dataLimiteIso || !Array.isArray(plantoes)) {
    return { idxVet, idxTec };
  }
  for (const plantao of plantoes) {
    const dataIso = dataReferenciaParaStr(plantao.dataReferencia);
    if (!dataIso || dataIso >= dataLimiteIso) break;
    const cat = categoriaPlantaoDe(plantao);
    const ordem = cat === CATEGORIA_PLANTAO.TECNICO ? ordemAtualTec : ordemAtualVet;
    const uid = Number(plantao.usuarioId);
    if (!ordem.length || !Number.isFinite(uid) || uid < 1) continue;
    const pos = ordem.indexOf(uid);
    if (pos < 0) continue;
    const next = (pos + 1) % ordem.length;
    if (cat === CATEGORIA_PLANTAO.TECNICO) idxTec = next;
    else idxVet = next;
  }
  return { idxVet, idxTec };
}

/**
 * Próximo índice do rodízio após o último plantão gravado antes de `dataLimiteIso`
 * (usa titulares de junho já corretos; evita idx derivado de simulação parcial).
 */
function obterIdxRodizioAposUltimoPlantaoAntesDe(
  plantoes,
  ordemAtual,
  dataLimiteIso,
  categoriaAlvo = CATEGORIA_PLANTAO.VETERINARIO,
  /** Ordem do ciclo AABB (ex.: inicial da escala) para achar o próximo após o último titular gravado. */
  ordemReferenciaCiclo = null,
) {
  if (!dataLimiteIso || !Array.isArray(plantoes) || !ordemAtual?.length) return 0;
  const plantoesAntes = plantoes
    .filter((p) => {
      const dataIso = dataReferenciaParaStr(p.dataReferencia);
      if (!dataIso || dataIso >= dataLimiteIso) return false;
      return categoriaPlantaoDe(p) === categoriaAlvo;
    })
    .sort((a, b) => {
      const cmp = dataReferenciaParaStr(a.dataReferencia).localeCompare(dataReferenciaParaStr(b.dataReferencia));
      if (cmp !== 0) return cmp;
      return Number(a.vagaIndice ?? 0) - Number(b.vagaIndice ?? 0);
    });

  if (categoriaAlvo === CATEGORIA_PLANTAO.TECNICO) {
    /** AABB: último titular do último dia (vaga 1) na fila rotacionada atual. */
    let ultimaData = null;
    for (const plantao of plantoesAntes) {
      const ds = dataReferenciaParaStr(plantao.dataReferencia);
      if (ds && (!ultimaData || ds > ultimaData)) ultimaData = ds;
    }
    if (!ultimaData) return 0;
    const noUltimoDia = plantoesAntes
      .filter((p) => dataReferenciaParaStr(p.dataReferencia) === ultimaData)
      .sort((a, b) => Number(a.vagaIndice ?? 0) - Number(b.vagaIndice ?? 0));
    let uUltimo = null;
    for (const p of noUltimoDia) {
      const uid = Number(p.usuarioId);
      if (Number.isFinite(uid) && uid > 0) uUltimo = uid;
    }
    if (uUltimo == null) return 0;
    const pos = ordemAtual.indexOf(uUltimo);
    if (pos >= 0) return (pos + 1) % ordemAtual.length;
    const ref =
      Array.isArray(ordemReferenciaCiclo) && ordemReferenciaCiclo.length > 0
        ? ordemReferenciaCiclo
        : ordemAtual;
    const posRef = ref.indexOf(uUltimo);
    if (posRef < 0) return 0;
    const proximoUid = ref[(posRef + 1) % ref.length];
    const posAtual = ordemAtual.indexOf(proximoUid);
    return posAtual < 0 ? 0 : posAtual;
  }

  let lastUid = null;
  for (const plantao of plantoesAntes) {
    if (Number(plantao.vagaIndice) !== 0) continue;
    const uid = Number(plantao.usuarioId);
    if (Number.isFinite(uid) && uid > 0) lastUid = uid;
  }
  if (lastUid == null) return 0;
  const pos = ordemAtual.indexOf(lastUid);
  return pos < 0 ? 0 : (pos + 1) % ordemAtual.length;
}

/** Retorno de férias/abono já ocorreu em plantão anterior ao recálculo pleno do mês seguinte. */
function usuarioRetornoFeriasAbonoJaRealizadoAntesDe(
  usuarioId,
  dataLimiteIso,
  retornosFeriasNoPrimeiroPlantao,
  plantoes,
  categoriaAlvo = CATEGORIA_PLANTAO.TECNICO,
) {
  const uid = Number(usuarioId);
  if (!Number.isFinite(uid) || uid < 1 || !dataLimiteIso) return false;
  for (const [dataRetorno, uids] of retornosFeriasNoPrimeiroPlantao.entries()) {
    if (dataRetorno >= dataLimiteIso) continue;
    if (!(uids || []).some((u) => Number(u) === uid)) continue;
    const tevePlantao = plantoes.some((p) => {
      const ds = dataReferenciaParaStr(p.dataReferencia);
      return (
        categoriaPlantaoDe(p) === categoriaAlvo &&
        ds >= dataRetorno &&
        ds < dataLimiteIso &&
        Number(p.usuarioId) === uid
      );
    });
    if (tevePlantao) return true;
  }
  return false;
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

async function registrarEventoAuditoriaEscala({
  escalaId,
  categoriaMembro,
  tipoEvento,
  referenciaTipo = null,
  referenciaId = null,
  dataReferencia = null,
  ordemAntesUsuarioIds = null,
  ordemDepoisUsuarioIds = [],
  detalhes = null,
  criadoPorUsuarioId = null,
  transaction,
}) {
  const ordemDepois = Array.isArray(ordemDepoisUsuarioIds) ? ordemDepoisUsuarioIds.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : [];
  const ordemAntes = Array.isArray(ordemAntesUsuarioIds) ? ordemAntesUsuarioIds.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : null;
  if (ordemDepois.length === 0) return;
  await EscalaAuditoriaEventoModel.create(
    {
      escalaId: Number(escalaId),
      categoriaMembro: String(categoriaMembro || '').toLowerCase() === CATEGORIA_MEMBRO.TECNICO ? CATEGORIA_MEMBRO.TECNICO : CATEGORIA_MEMBRO.VETERINARIO,
      tipoEvento: String(tipoEvento || 'recalculo'),
      referenciaTipo: referenciaTipo || null,
      referenciaId: Number.isFinite(Number(referenciaId)) && Number(referenciaId) > 0 ? Number(referenciaId) : null,
      dataReferencia: dataReferencia ? dataReferenciaParaStr(dataReferencia) : null,
      ordemAntesUsuarioIds: ordemAntes,
      ordemDepoisUsuarioIds: ordemDepois,
      detalhes: detalhes || null,
      criadoPorUsuarioId:
        Number.isFinite(Number(criadoPorUsuarioId)) && Number(criadoPorUsuarioId) > 0 ? Number(criadoPorUsuarioId) : null,
    },
    { transaction },
  );
}

/**
 * Parâmetros para decidir se férias/abono alteram plantões da escala (cadastro irrelevante).
 */
function montarParametrosFiltroAfastamentoPlantoes({
  plantoes,
  ordemVetInicial,
  ordemTecInicial,
  afastamentosLista,
  periodicidadeEscala,
  categoriaPorUsuarioId,
}) {
  const plantoesNorm = (plantoes || []).map((p) => ({
    dataReferencia: dataReferenciaParaStr(p.dataReferencia),
    categoriaPlantao: categoriaPlantaoDe(p),
    usuarioId: p.usuarioId != null ? Number(p.usuarioId) : undefined,
    vagaIndice: p.vagaIndice,
  }));
  const datasNaoUteisIsoSet =
    String(periodicidadeEscala || '').toLowerCase() === 'fim_de_semana'
      ? new Set(
          plantoesNorm
            .map((p) => p.dataReferencia)
            .filter((ds) => !!ds && !ehFimDeSemanaDataReferencia(ds)),
        )
      : new Set();
  return {
    plantoes: plantoesNorm,
    ordemVetInicial: [...(ordemVetInicial || [])],
    ordemTecInicial: [...(ordemTecInicial || [])],
    afastamentosLista: (afastamentosLista || []).map((a) => (a.get ? a.get({ plain: true }) : a)),
    periodicidadeEscala,
    categoriaPorUsuarioId: categoriaPorUsuarioId || new Map(),
    datasNaoUteisIsoSet,
  };
}

function categoriaAfastamentoUsuarioFiltro(params, usuarioId) {
  const uid = Number(usuarioId);
  if (params.categoriaPorUsuarioId?.has(uid)) {
    return params.categoriaPorUsuarioId.get(uid);
  }
  return CATEGORIA_PLANTAO.VETERINARIO;
}

/**
 * Chave de alocação: sempre `dataIso|vagaIndice` (vaga ausente vira 0).
 * Vet em produção grava `vaga_indice = 0` no banco — manter a mesma normalização aqui evita
 * `sem.get(...)` retornar `undefined` por divergência de chave e classificar afastamento como
 * "relevante" sem motivo.
 */
function chaveAlocacaoRodizio(aloc) {
  const vaga = aloc.vagaIndice != null ? Number(aloc.vagaIndice) : 0;
  return `${aloc.dataIso}|${vaga}`;
}

function mapaAlocacoesRodizio(alocacoes) {
  const mapa = new Map();
  for (const a of alocacoes || []) {
    mapa.set(chaveAlocacaoRodizio(a), Number(a.usuarioId));
  }
  return mapa;
}

function simularAlocacoesRodizioCategoria(params, categoria, afastamentosSubset) {
  const datas = [
    ...new Set(
      params.plantoes
        .filter((p) => categoriaPlantaoDe(p) === categoria)
        .map((p) => p.dataReferencia)
        .filter(Boolean),
    ),
  ].sort();
  if (!datas.length) return [];
  const ordemBase =
    categoria === CATEGORIA_PLANTAO.TECNICO ? params.ordemTecInicial : params.ordemVetInicial;
  const ordem = normalizarOrdemRodizioCompleta(ordemBase, ordemBase);
  if (!ordem.length) return [];
  const plantoesRef = params.plantoes.filter((p) => categoriaPlantaoDe(p) === categoria);
  if (categoria === CATEGORIA_PLANTAO.TECNICO) {
    return simularRodizioTecPlantoes(
      ordem,
      datas,
      afastamentosSubset,
      params.datasNaoUteisIsoSet,
      0,
      plantoesRef,
    ).alocacoes;
  }
  return simularRodizioVetPlantoes(ordem, datas, afastamentosSubset, params.datasNaoUteisIsoSet).alocacoes;
}

function afastamentosListaSemRegistro(af, lista) {
  const plainAf = af && af.get ? af.get({ plain: true }) : af;
  const idAf = Number(plainAf?.id);
  return (lista || []).filter((a) => {
    const plain = a && a.get ? a.get({ plain: true }) : a;
    if (Number.isFinite(idAf) && idAf > 0) return Number(plain.id) !== idAf;
    return !(
      Number(plain.usuarioId) === Number(plainAf.usuarioId) &&
      dataReferenciaParaStr(plain.dataInicio) === dataReferenciaParaStr(plainAf.dataInicio) &&
      dataReferenciaParaStr(plain.dataFim) === dataReferenciaParaStr(plainAf.dataFim) &&
      Number(plain.tipoId) === Number(plainAf.tipoId)
    );
  });
}

function mapasRodizioComESemAfastamento(af, params) {
  const plainAf = af && af.get ? af.get({ plain: true }) : af;
  const cat = categoriaAfastamentoUsuarioFiltro(params, plainAf.usuarioId);
  const outros = afastamentosListaSemRegistro(plainAf, params.afastamentosLista);
  const com = simularAlocacoesRodizioCategoria(params, cat, [...outros, plainAf]);
  const sem = simularAlocacoesRodizioCategoria(params, cat, outros);
  return { com: mapaAlocacoesRodizio(com), sem: mapaAlocacoesRodizio(sem), cat };
}

/**
 * Versão consistente com o recálculo total: filtra fora os afastamentos sem efeito (que NÃO
 * tiram plantão do titular) antes de simular. Sem essa filtragem, o "retorno forçado pós-férias"
 * do simulador é disparado para afastamentos irrelevantes (ex.: férias 30/06–10/07 de quem
 * estava escalado fora desse intervalo) e gera diferenças entre `com`/`sem` que rotulam o
 * afastamento como relevante na tag — mesmo o recálculo dizendo o contrário.
 *
 * Usada apenas pelas funções de classificação de relevância da TAG (`com` vs `sem`). NÃO usar
 * em `afastamentoFeriasOuAbonoRelevanteNoRodizio`, que compara `com` com o calendário GRAVADO:
 * lá o `com` precisa ser a simulação completa (incluindo retornos forçados) para casar com o
 * que o motor grava de fato.
 */
function mapasRodizioComESemAfastamentoConsistente(af, params) {
  const plainAf = af && af.get ? af.get({ plain: true }) : af;
  const cat = categoriaAfastamentoUsuarioFiltro(params, plainAf.usuarioId);
  const outros = afastamentosListaSemRegistro(plainAf, params.afastamentosLista);
  const paramsOutros = { ...params, afastamentosLista: outros };
  const outrosFiltrados = afastamentosListaParaRodizioEscala(outros, paramsOutros);
  const todos = [...outros, plainAf];
  const paramsComEste = { ...params, afastamentosLista: todos };
  const comFiltrados = afastamentosListaParaRodizioEscala(todos, paramsComEste);
  const com = simularAlocacoesRodizioCategoria(params, cat, comFiltrados);
  const sem = simularAlocacoesRodizioCategoria(params, cat, outrosFiltrados);
  return { com: mapaAlocacoesRodizio(com), sem: mapaAlocacoesRodizio(sem), cat };
}

function mapaPlantoesGravadosCategoria(params, categoria) {
  const mapa = new Map();
  for (const p of params.plantoes || []) {
    if (categoriaPlantaoDe(p) !== categoria) continue;
    const ds = p.dataReferencia;
    if (!ds) continue;
    const vaga = p.vagaIndice != null ? Number(p.vagaIndice) : 0;
    mapa.set(`${ds}|${vaga}`, Number(p.usuarioId));
  }
  return mapa;
}

function contextoRecalculoFocadoParaAfastamento(af, params) {
  const uid = Number(af.usuarioId);
  const cat = categoriaAfastamentoUsuarioFiltro(params, af.usuarioId);
  const ordem =
    cat === CATEGORIA_PLANTAO.TECNICO ? params.ordemTecInicial : params.ordemVetInicial;
  const outros = params.afastamentosLista.filter((a) => Number(a.id) !== Number(af.id));
  const todos = [...outros, af];
  const afastamentosPorUsuario = montarAfastamentosPorUsuario(todos);
  const retornosFeriasNoPrimeiroPlantao = montarRetornosFeriasNoPrimeiroPlantao(
    todos,
    params.plantoes || [],
    params.datasNaoUteisIsoSet,
    params.categoriaPorUsuarioId,
  );
  const datasPlantoesOrdenadas = [
    ...new Set(
      (params.plantoes || [])
        .filter((p) => categoriaPlantaoDe(p) === cat)
        .map((p) => p.dataReferencia)
        .filter(Boolean),
    ),
  ].sort();
  return {
    uid,
    cat,
    ordem,
    outros,
    afastamentosPorUsuario,
    retornosFeriasNoPrimeiroPlantao,
    datasPlantoesOrdenadas,
  };
}

/** O titular já está escalado em algum plantão dentro do intervalo do afastamento. */
function afastamentoFeriasOuAbonoTemPlantaoTitularNoPeriodo(af, params) {
  if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) return false;
  const uid = Number(af.usuarioId);
  const inicioIso = dataReferenciaParaStr(af.dataInicio);
  const fimIso = dataReferenciaParaStr(af.dataFim);
  if (!Number.isFinite(uid) || uid < 1 || !inicioIso || !fimIso) return false;
  const cat = categoriaAfastamentoUsuarioFiltro(params, uid);
  return (params.plantoes || []).some((p) => {
    if (categoriaPlantaoDe(p) !== cat) return false;
    if (Number(p.usuarioId) !== uid) return false;
    const ds = p.dataReferencia || dataReferenciaParaStr(p.dataReferencia);
    return ds && ds >= inicioIso && ds <= fimIso;
  });
}

/** Calendário gravado já reflete a simulação com todos os afastamentos da lista (incluindo este). */
function afastamentoFeriasOuAbonoRedundanteNoCalendario(af, params) {
  if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) return false;
  const cat = categoriaAfastamentoUsuarioFiltro(params, af.usuarioId);
  const gravados = mapaPlantoesGravadosCategoria(params, cat);
  const temGravadosNaCategoria = [...gravados.values()].some((uid) => Number.isFinite(uid) && uid > 0);
  if (!temGravadosNaCategoria) return false;
  const todos = (params.afastamentosLista || []).map((a) => (a.get ? a.get({ plain: true }) : a));
  const comTodos = mapaAlocacoesRodizio(simularAlocacoesRodizioCategoria(params, cat, todos));
  for (const [k, uidGrav] of gravados) {
    if (Number(comTodos.get(k)) !== Number(uidGrav)) return false;
  }
  return true;
}

/**
 * Férias/abono relevantes quando incluir o afastamento altera o rodízio em relação ao calendário
 * gravado (ou, sem calendário, em relação à simulação sem ele).
 */
function afastamentoFeriasOuAbonoRelevanteNoRodizio(af, params) {
  if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) return true;
  if (afastamentoFeriasOuAbonoRedundanteNoCalendario(af, params)) return false;
  /**
   * Abono/férias só "entra" no rodízio se tira o titular de pelo menos um plantão (ativo, retro-cadastro
   * ou pós-fim sem dia útil). Caso contrário, o "retorno forçado" pós-afastamento moveria outro servidor
   * sem motivo (ex.: abono Ana 15/07 em escala BCEFDHAG, Ana só escalada 25/07).
   */
  if (!afastamentoFeriasOuAbonoTitularPerdeAlgumPlantao(af, params)) return false;
  const { com, sem, cat } = mapasRodizioComESemAfastamento(af, params);
  const gravados = mapaPlantoesGravadosCategoria(params, cat);
  const temGravadosNaCategoria = [...gravados.values()].some((uid) => Number.isFinite(uid) && uid > 0);
  if (temGravadosNaCategoria) {
    for (const [k, uidGrav] of gravados) {
      if (Number(com.get(k)) !== Number(uidGrav)) return true;
    }
    return false;
  }
  for (const [k, vCom] of com) {
    if (sem.get(k) !== vCom) return true;
  }
  return false;
}

/**
 * Altera plantão do titular: afastamento efetivamente remove o titular de pelo menos um plantão
 * em que ele estaria escalado (ativo, retro-cadastro ou pós-fim sem dia útil). Vale tanto para o
 * calendário gravado quanto para a simulação "sem este afastamento" — robusto após recálculo.
 */
function afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario(af, params) {
  if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) return true;
  if (afastamentoFeriasOuAbonoRedundanteNoCalendario(af, params)) return false;
  return afastamentoFeriasOuAbonoTitularPerdeAlgumPlantao(af, params);
}

function abonoMudaAlgumPlantaoDoRodizio(af, params) {
  return afastamentoFeriasOuAbonoRelevanteNoRodizio(af, params);
}

function afastamentoFeriasOuAbonoEntraNoRodizio(af, params) {
  return afastamentoFeriasOuAbonoRelevanteNoRodizio(af, params);
}

/** Mantém só férias/abono que mudam plantões (exclui “sem efeito” do rodízio). */
function filtrarAfastamentosFeriasAbonoSemEfeitoEmPlantoes(afs, params) {
  return (afs || [])
    .map((a) => (a.get ? a.get({ plain: true }) : a))
    .filter((af) => {
      if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) return false;
      return afastamentoFeriasOuAbonoRelevanteNoRodizio(af, params);
    });
}

function afastamentosEfetivosRodizioEscala(afs, params) {
  return filtrarAfastamentosFeriasAbonoSemEfeitoEmPlantoes(afs, params);
}

function afastamentosParaSimulacaoPlenaCategoria(brutos, efetivos, params, categoria) {
  const idsEfetivos = new Set((efetivos || []).map((a) => Number(a.id)));
  const cat = String(categoria || '').toLowerCase();
  return (brutos || [])
    .map((a) => (a.get ? a.get({ plain: true }) : a))
    .filter((a) => {
      if (categoriaAfastamentoUsuarioFiltro(params, a.usuarioId) !== cat) return false;
      if (!afastamentoEhFerias(a) && !afastamentoEhAbono(a)) return true;
      return idsEfetivos.has(Number(a.id));
    });
}

/**
 * Férias/abono efetivamente tira o titular de algum plantão (ativo no dia, retro-cadastro pré-início,
 * ou pós-fim sem dia útil intermediário). Considera o titular tanto no calendário já gravado quanto na
 * simulação "sem este afastamento" — cobre o recálculo após a escala já estar ajustada.
 */
function afastamentoFeriasOuAbonoTitularPerdeAlgumPlantao(af, params) {
  if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) return false;
  const plainAf = af && af.get ? af.get({ plain: true }) : af;
  const uid = Number(plainAf.usuarioId);
  if (!Number.isFinite(uid) || uid < 1) return false;
  const cat = categoriaAfastamentoUsuarioFiltro(params, uid);
  const datasNaoUteisIsoSet = params.datasNaoUteisIsoSet || new Set();
  const apenasEsse = montarAfastamentosPorUsuario([plainAf]);

  for (const p of params.plantoes || []) {
    if (categoriaPlantaoDe(p) !== cat) continue;
    if (Number(p.usuarioId) !== uid) continue;
    const dataIso = p.dataReferencia || dataReferenciaParaStr(p.dataReferencia);
    if (!dataIso) continue;
    if (usuarioIndisponivelParaPlantaoNoDia(apenasEsse, uid, dataIso, datasNaoUteisIsoSet)) return true;
  }

  const { sem } = mapasRodizioComESemAfastamento(plainAf, params);
  for (const [k, uidAlocado] of sem) {
    if (Number(uidAlocado) !== uid) continue;
    const dataIso = String(k).includes('|') ? String(k).split('|')[0] : String(k);
    if (usuarioIndisponivelParaPlantaoNoDia(apenasEsse, uid, dataIso, datasNaoUteisIsoSet)) return true;
  }
  return false;
}

/**
 * Filtragem ITERATIVA dos férias/abono "sem efeito real" para o rodízio.
 *
 * Por que iterativa? A heurística `afastamentoFeriasOuAbonoTitularPerdeAlgumPlantao` decide se um
 * afastamento X é irrelevante comparando o calendário gravado/`sem-X` contra um cenário em que
 * o titular fica bloqueado. Quando o usuário tem dois afastamentos que "se cobrem mutuamente"
 * (ex.: abono Marilene 12/06 + abono Marilene 15/06, ambos disparam retorno forçado em 20/06),
 * cada um isoladamente parece redundante — o outro mantém o titular fora dos plantões. Avaliando
 * cada um contra TODOS os outros, ambos seriam removidos e o titular voltaria ao plantão original,
 * quebrando o calendário gravado.
 *
 * Solução: percorre os afastamentos em ordem canônica (`dataInicio, dataFim, id`) e tenta remover
 * um por vez, sempre recalculando o conjunto `efetivos`. Se a remoção de X (com os efetivos
 * atualizados) for segura — titular permanece coberto em todos os plantões — X é removido. Se não,
 * mantém. Repete até estabilizar (ponto fixo). É monotônico (só remove), termina em O(N²) no pior caso.
 *
 * Não usar `Redundante` aqui: afastamentos já refletidos no calendário gravado ainda precisam entrar
 * na re-simulação plena para reproduzir o mesmo calendário; caso contrário a simulação roda sem eles
 * e sobrescreve com a ordem alfabética.
 */
function afastamentosListaParaRodizioEscala(afastamentos, paramsFiltro) {
  const lista = (afastamentos || []).map((row) => (row.get ? row.get({ plain: true }) : row));
  const naoFiltraveis = lista.filter((p) => !afastamentoEhFerias(p) && !afastamentoEhAbono(p));
  const candidatos = lista.filter((p) => afastamentoEhFerias(p) || afastamentoEhAbono(p));

  candidatos.sort((a, b) => {
    const ai = String(dataReferenciaParaStr(a.dataInicio) || '');
    const bi = String(dataReferenciaParaStr(b.dataInicio) || '');
    if (ai !== bi) return ai.localeCompare(bi);
    const af = String(dataReferenciaParaStr(a.dataFim) || '');
    const bf = String(dataReferenciaParaStr(b.dataFim) || '');
    if (af !== bf) return af.localeCompare(bf);
    return Number(a.id || 0) - Number(b.id || 0);
  });

  let efetivos = [...candidatos];
  let removeuAlgumNestaPassada = true;
  while (removeuAlgumNestaPassada) {
    removeuAlgumNestaPassada = false;
    for (const candidato of [...efetivos]) {
      const paramsAtualizados = {
        ...paramsFiltro,
        afastamentosLista: [...naoFiltraveis, ...efetivos],
      };
      if (!afastamentoFeriasOuAbonoTitularPerdeAlgumPlantao(candidato, paramsAtualizados)) {
        efetivos = efetivos.filter((x) => x !== candidato);
        removeuAlgumNestaPassada = true;
      }
    }
  }

  /**
   * Preserva a ordem ORIGINAL para os mantidos (estabilidade do retorno em relação à entrada).
   */
  const efetivosSet = new Set(efetivos);
  return lista.filter((p) => {
    if (!afastamentoEhFerias(p) && !afastamentoEhAbono(p)) return true;
    return efetivosSet.has(p);
  });
}

/** Escalas em `ativa` ou `rascunho` (prioridade: ativa, depois a mais recente). */
async function obterEscalasAbertasRelevancia(transaction = null) {
  return EscalaModel.findAll({
    where: { status: { [Op.in]: ['ativa', 'rascunho'] } },
    attributes: ['id', 'nome', 'dataInicio', 'dataFim', 'periodicidade', 'status'],
    order: [
      [sequelize.literal("CASE WHEN status = 'ativa' THEN 0 WHEN status = 'rascunho' THEN 1 ELSE 2 END"), 'ASC'],
      ['dataInicio', 'DESC'],
      ['id', 'DESC'],
    ],
    transaction,
  });
}

/** Contexto de uma escala aberta para classificar relevância de afastamentos na listagem admin. */
async function montarContextoRelevanciaEscala(escala, transaction = null) {
  const escalaId = Number(escala.id);
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

  const ordemCicloRefVet = await obterOrdemCicloReferenciaEscala(
    escalaId,
    ordemAtualDbInicialVet,
    CATEGORIA_MEMBRO.VETERINARIO,
    transaction,
  );
  const ordemCicloRefTec = await obterOrdemCicloReferenciaEscala(
    escalaId,
    ordemAtualDbInicialTec,
    CATEGORIA_MEMBRO.TECNICO,
    transaction,
  );

  let ordemAtualVet = [...ordemAtualDbInicialVet];
  let ordemAtualTec = [...ordemAtualDbInicialTec];
  const porFimDesc = await AfastamentoModel.findAll({
    where: {
      usuarioId: { [Op.in]: [...new Set([...ordemAtualDbInicialVet, ...ordemAtualDbInicialTec])] },
      dataInicio: { [Op.lte]: dataFimStr },
      dataFim: { [Op.gte]: dataInicioStr },
    },
    include: [{ model: TipoAfastamentoModel, as: 'tipo', attributes: ['id', 'regraOrdem'] }],
    order: [
      ['dataFim', 'DESC'],
      ['dataInicio', 'DESC'],
      ['id', 'DESC'],
    ],
    transaction,
  });
  for (const outro of porFimDesc) {
    const catOutro =
      (await escopoOrdemGlobalParaUsuarioId(outro.usuarioId, transaction)) === ESCOPO_ORDEM.TECNICO
        ? CATEGORIA_MEMBRO.TECNICO
        : CATEGORIA_MEMBRO.VETERINARIO;
    const histOutro = await buscarHistoricoOrdemParaAfastamento(escalaId, outro.id, catOutro, transaction);
    if (!histOutro) continue;
    const plainOutro = histOutro.get ? histOutro.get({ plain: true }) : histOutro;
    const idsDepois = Array.isArray(plainOutro.ordemUsuarioIds)
      ? plainOutro.ordemUsuarioIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
      : [];
    if (idsDepois.length === 0) continue;
    if (catOutro === CATEGORIA_MEMBRO.TECNICO) ordemAtualTec = idsDepois;
    else ordemAtualVet = idsDepois;
    break;
  }

  const ordemVetParaFiltro = ordemCicloRefVet.length > 0 ? [...ordemCicloRefVet] : [...ordemAtualDbInicialVet];
  const ordemTecParaFiltro = ordemCicloRefTec.length > 0 ? [...ordemCicloRefTec] : [...ordemAtualDbInicialTec];

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

  const idsParaAfastamentos = [
    ...new Set([
      ...ordemAtualVet,
      ...ordemAtualTec,
      ...ordemAtualDbInicialVet,
      ...ordemAtualDbInicialTec,
      ...ordemVetParaFiltro,
      ...ordemTecParaFiltro,
    ]),
  ].filter((id) => Number.isFinite(id) && id > 0);

  const afastamentos =
    idsParaAfastamentos.length > 0
      ? await AfastamentoModel.findAll({
          where: {
            usuarioId: { [Op.in]: idsParaAfastamentos },
            dataInicio: { [Op.lte]: dataFimStr },
            dataFim: { [Op.gte]: dataInicioStr },
          },
          include: [{ model: TipoAfastamentoModel, as: 'tipo', attributes: ['id', 'tipo', 'regraOrdem'] }],
          transaction,
        })
      : [];

  const categoriaPorUsuarioId = new Map();
  for (const id of ordemAtualVet) {
    categoriaPorUsuarioId.set(Number(id), CATEGORIA_PLANTAO.VETERINARIO);
  }
  for (const id of ordemAtualTec) {
    categoriaPorUsuarioId.set(Number(id), CATEGORIA_PLANTAO.TECNICO);
  }

  const plantoesPlain = (plantoes || []).map((p) => {
    const row = p.get ? p.get({ plain: true }) : p;
    return {
      ...row,
      dataReferencia: dataReferenciaParaStr(row.dataReferencia),
      categoriaPlantao: categoriaPlantaoDe(row),
      usuarioId: row.usuarioId != null ? Number(row.usuarioId) : undefined,
    };
  });

  const paramsFiltro = montarParametrosFiltroAfastamentoPlantoes({
    plantoes: plantoesPlain,
    ordemVetInicial: ordemVetParaFiltro,
    ordemTecInicial: ordemTecParaFiltro,
    afastamentosLista: (afastamentos || []).map((a) => (a.get ? a.get({ plain: true }) : a)),
    periodicidadeEscala: escala.periodicidade,
    categoriaPorUsuarioId,
  });

  return {
    escalaId,
    escalaNome: escala.nome || null,
    escalaStatus: String(escala.status || '').toLowerCase(),
    dataInicioStr,
    dataFimStr,
    paramsFiltro,
  };
}

/** Compat.: contexto da primeira escala aberta (ativa preferida). */
async function obterContextoRelevanciaEscalaAtiva(transaction = null) {
  const escalas = await obterEscalasAbertasRelevancia(transaction);
  if (!escalas.length) return null;
  return montarContextoRelevanciaEscala(escalas[0], transaction);
}

async function resolverContextoRelevanciaAfastamento(afPlain, cache, transaction = null) {
  const escalas = cache?.escalasAbertas || (await obterEscalasAbertasRelevancia(transaction));
  if (!escalas.length) return null;

  const ini = dataReferenciaParaStr(afPlain.dataInicio);
  const fim = dataReferenciaParaStr(afPlain.dataFim);

  let escalaEscolhida = escalas[0];
  for (const escala of escalas) {
    const dataInicioStr = dataReferenciaParaStr(escala.dataInicio);
    const dataFimStr = dataReferenciaParaStr(escala.dataFim);
    if (fim >= dataInicioStr && ini <= dataFimStr) {
      escalaEscolhida = escala;
      break;
    }
  }

  const escalaId = Number(escalaEscolhida.id);
  if (!cache.ctxByEscalaId) cache.ctxByEscalaId = new Map();
  if (!cache.ctxByEscalaId.has(escalaId)) {
    cache.ctxByEscalaId.set(escalaId, await montarContextoRelevanciaEscala(escalaEscolhida, transaction));
  }
  return cache.ctxByEscalaId.get(escalaId);
}

/** Titular teria plantão no intervalo do afastamento na simulação sem este registro. */
function afastamentoFeriasOuAbonoTitularEscaladoNoPeriodoSemAfastamento(af, params) {
  if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) return true;
  const uid = Number(af.usuarioId);
  const inicioIso = dataReferenciaParaStr(af.dataInicio);
  const fimIso = dataReferenciaParaStr(af.dataFim);
  if (!Number.isFinite(uid) || uid < 1 || !inicioIso || !fimIso) return false;
  const cat = categoriaAfastamentoUsuarioFiltro(params, af.usuarioId);
  const { sem } = mapasRodizioComESemAfastamento(af, params);
  for (const p of params.plantoes || []) {
    if (categoriaPlantaoDe(p) !== cat) continue;
    const ds = p.dataReferencia || dataReferenciaParaStr(p.dataReferencia);
    if (!ds || ds < inicioIso || ds > fimIso) continue;
    const vaga = p.vagaIndice != null ? Number(p.vagaIndice) : 0;
    if (Number(sem.get(`${ds}|${vaga}`)) === uid) return true;
  }
  return false;
}

/**
 * O calendário gravado difere da simulação sem este afastamento (mantendo os demais).
 * Serve só para exibição na listagem admin — não altera o recálculo.
 */
function afastamentoFeriasOuAbonoContribuiParaCalendarioGravado(af, params) {
  if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) return true;
  const cat = categoriaAfastamentoUsuarioFiltro(params, af.usuarioId);
  const gravados = mapaPlantoesGravadosCategoria(params, cat);
  const temGravadosNaCategoria = [...gravados.values()].some((uid) => Number.isFinite(uid) && uid > 0);
  const { com, sem } = mapasRodizioComESemAfastamento(af, params);
  if (!temGravadosNaCategoria) {
    for (const [k, vSem] of sem) {
      if (Number(com.get(k)) !== Number(vSem)) return true;
    }
    return false;
  }
  for (const [k, uidGrav] of gravados) {
    if (Number(sem.get(k)) !== Number(uidGrav)) return true;
  }
  return false;
}

/**
 * Janela para tag: início retroativo até o fim da escala (não só dataFim do cadastro).
 * Abono em 12/06 pode alterar plantão em 13/06; limitar ao fim do cadastro omitia esse efeito.
 */
function periodoRetroAfastamentoParaTag(af, params, escalaFimStr) {
  let inicioIso = dataReferenciaParaStr(af.dataInicio);
  const retroInicio = calcularDataInicioRetroCadastro(inicioIso, params.datasNaoUteisIsoSet || new Set());
  if (retroInicio < inicioIso) inicioIso = retroInicio;
  const fimCadastro = dataReferenciaParaStr(af.dataFim);
  const fimLimiteEscala =
    escalaFimStr && /^\d{4}-\d{2}-\d{2}$/.test(String(escalaFimStr)) ? String(escalaFimStr) : fimCadastro;
  return { inicioIso, fimCadastro, fimLimiteEscala };
}

/** Com vs sem: titular envolvido em mudança de alocação no período retroativo. */
function afastamentoFeriasOuAbonoRelevanteParaTagEscala(af, params, escalaFimStr) {
  if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) return true;
  const plainAf = af && af.get ? af.get({ plain: true }) : af;
  const uid = Number(plainAf.usuarioId);
  if (!Number.isFinite(uid) || uid < 1) return true;
  const { inicioIso, fimCadastro } = periodoRetroAfastamentoParaTag(plainAf, params, escalaFimStr);
  const cat = categoriaAfastamentoUsuarioFiltro(params, plainAf.usuarioId);
  const { com, sem } = mapasRodizioComESemAfastamentoConsistente(plainAf, params);
  const chaves = new Set([...com.keys(), ...sem.keys()]);
  for (const k of chaves) {
    const ds = String(k).includes('|') ? String(k).split('|')[0] : String(k);
    if (ds < inicioIso || ds > fimCadastro) continue;
    const vSem = Number(sem.get(k));
    const vCom = Number(com.get(k));
    if (!Number.isFinite(vSem) && !Number.isFinite(vCom)) continue;
    if (vSem === vCom) continue;
    if (vSem === uid || vCom === uid) return true;
  }
  return false;
}

/** Incluir este afastamento não muda o rodízio simulado (com === sem em todas as datas). */
function afastamentoFeriasOuAbonoNaoAlteraRodizioComVsSem(af, params) {
  if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) return false;
  const plainAf = af && af.get ? af.get({ plain: true }) : af;
  const { com, sem } = mapasRodizioComESemAfastamentoConsistente(plainAf, params);
  const chaves = new Set([...com.keys(), ...sem.keys()]);
  for (const k of chaves) {
    if (Number(com.get(k)) !== Number(sem.get(k))) return false;
  }
  return true;
}

/**
 * Calendário gravado ≠ simulação sem este afastamento, em datas em que com≠sem (efeito deste cadastro).
 */
function afastamentoFeriasOuAbonoContribuiCalendarioNoPeriodoRetro(af, params, escalaFimStr) {
  if (!afastamentoEhFerias(af) && !afastamentoEhAbono(af)) return true;
  const plainAf = af && af.get ? af.get({ plain: true }) : af;
  const { inicioIso, fimLimiteEscala } = periodoRetroAfastamentoParaTag(plainAf, params, escalaFimStr);
  const cat = categoriaAfastamentoUsuarioFiltro(params, plainAf.usuarioId);
  const gravados = mapaPlantoesGravadosCategoria(params, cat);
  const { com, sem } = mapasRodizioComESemAfastamentoConsistente(plainAf, params);
  for (const [k, uidGrav] of gravados) {
    const ds = String(k).includes('|') ? String(k).split('|')[0] : String(k);
    if (ds < inicioIso || ds > fimLimiteEscala) continue;
    if (Number(com.get(k)) === Number(sem.get(k))) continue;
    if (Number(sem.get(k)) !== Number(uidGrav)) return true;
  }
  return false;
}

/**
 * `relevante` | `irrelevante` | `fora_periodo` — só para tags na listagem admin.
 */
function classificarRelevanciaAfastamentoEscalaAtiva(afPlain, ctx) {
  const ini = dataReferenciaParaStr(afPlain.dataInicio);
  const fim = dataReferenciaParaStr(afPlain.dataFim);
  if (fim < ctx.dataInicioStr || ini > ctx.dataFimStr) {
    return 'fora_periodo';
  }
  if (!afastamentoEhFerias(afPlain) && !afastamentoEhAbono(afPlain)) {
    return 'relevante';
  }
  const params = ctx.paramsFiltro;
  if (afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario(afPlain, params)) {
    return 'relevante';
  }
  if (afastamentoFeriasOuAbonoNaoAlteraRodizioComVsSem(afPlain, params)) {
    return 'irrelevante';
  }
  if (afastamentoFeriasOuAbonoContribuiCalendarioNoPeriodoRetro(afPlain, params, ctx.dataFimStr)) {
    return 'relevante';
  }
  if (afastamentoFeriasOuAbonoRelevanteParaTagEscala(afPlain, params, ctx.dataFimStr)) {
    return 'relevante';
  }
  return 'irrelevante';
}

async function enriquecerRelevanciaEscalaAtivaAfastamentos(lista) {
  const cache = { escalasAbertas: await obterEscalasAbertasRelevancia(), ctxByEscalaId: new Map() };
  if (!cache.escalasAbertas.length) {
    return (lista || []).map((af) => ({
      ...(af.get ? af.get({ plain: true }) : af),
      relevanciaEscalaAtiva: null,
      escalaAtivaNome: null,
      escalaReferenciaStatus: null,
    }));
  }
  const resultado = [];
  for (const af of lista || []) {
    const plain = af.get ? af.get({ plain: true }) : af;
    const ctx = await resolverContextoRelevanciaAfastamento(plain, cache);
    resultado.push({
      ...plain,
      relevanciaEscalaAtiva: classificarRelevanciaAfastamentoEscalaAtiva(plain, ctx),
      escalaAtivaNome: ctx.escalaNome,
      escalaReferenciaStatus: ctx.escalaStatus === 'rascunho' ? 'rascunho' : 'ativa',
    });
  }
  return resultado;
}

/**
 * Simula o rodízio de veterinários (sem modo focalizado) — usado em testes e depuração.
 */
function simularRodizioVetPlantoes(ordemInicial, datasPlantaoIso, afastamentosFlat, datasNaoUteisIsoSet = new Set()) {
  let ordemAtual = [...ordemInicial];
  let ordemGlobal = [...ordemInicial];
  let idxOrdem = 0;
  const membrosRef = [...ordemInicial];
  const afastamentosPorUsuario = montarAfastamentosPorUsuario(afastamentosFlat);
  const plantoes = (datasPlantaoIso || []).map((dataReferencia) => ({
    dataReferencia,
    categoriaPlantao: CATEGORIA_PLANTAO.VETERINARIO,
  }));
  const retornosFeriasNoPrimeiroPlantao = montarRetornosFeriasNoPrimeiroPlantao(
    afastamentosFlat,
    plantoes,
    datasNaoUteisIsoSet,
  );
  const filaRetornosFeriasPendentes = [];
  const alocacoes = [];

  for (const plantao of plantoes) {
    const dataIso = dataReferenciaParaStr(plantao.dataReferencia);
    if (!ordemAtual.length) continue;

    const idxPreferencial = idxOrdem % ordemAtual.length;
    const usuarioPreferencial = ordemAtual[idxPreferencial];
    const idxBaseBuscaSubstituto = idxPreferencial;

    const afastamentosPreferencial = afastamentosAtivosNoDia(afastamentosPorUsuario, usuarioPreferencial, dataIso);
    const preferencialBloqueadoPosFerias = usuarioBloqueadoPosFeriasOuAbonoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisIsoSet,
    );
    const preferencialBloqueadoRetroCadastro = usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisIsoSet,
    );
    const preferencialIndisponivel = usuarioIndisponivelParaPlantaoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisIsoSet,
    );

    let usuarioAlocado = usuarioPreferencial;
    const retornosHoje = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];
    for (const uidRaw of retornosHoje) {
      const uid = Number(uidRaw);
      if (!Number.isFinite(uid) || !ordemAtual.includes(uid)) continue;
      if (!filaRetornosFeriasPendentes.includes(uid)) {
        filaRetornosFeriasPendentes.push(uid);
      }
    }
    const temRetornoFeriasPendente =
      retornosHoje.length > 0 || filaRetornosFeriasPendentes.length > 0;
    const retornoFeriasForcado = temRetornoFeriasPendente
      ? escolherRetornoFeriasDoDia(
          filaRetornosFeriasPendentes,
          ordemAtual,
          idxPreferencial,
          afastamentosPorUsuario,
          dataIso,
          datasNaoUteisIsoSet,
          new Set(),
        )
      : null;

    if (retornoFeriasForcado != null) {
      usuarioAlocado = retornoFeriasForcado;
      if (Number(usuarioAlocado) !== Number(usuarioPreferencial)) {
        ordemAtual = moverUsuarioAntesDeReferencia(ordemAtual, usuarioAlocado, usuarioPreferencial);
        ordemGlobal = moverUsuarioAntesDeReferencia(ordemGlobal, usuarioAlocado, usuarioPreferencial);
      }
      idxOrdem = (ordemAtual.indexOf(usuarioAlocado) + 1) % ordemAtual.length;
    } else if (preferencialIndisponivel) {
      const gestaoAtestado =
        !preferencialBloqueadoPosFerias &&
        afastamentosPreferencial.length > 0 &&
        afastamentosPreferencial.every((af) => afastamentoEhAtestado(af));
      if (gestaoAtestado) {
        usuarioAlocado = usuarioPreferencial;
        idxOrdem = (idxPreferencial + 1) % ordemAtual.length;
      } else {
        let encontrado = null;
        for (let passo = 1; passo <= ordemAtual.length; passo++) {
          const candidato = ordemAtual[(idxBaseBuscaSubstituto + passo) % ordemAtual.length];
          const afastamentosCandidato = afastamentosAtivosNoDia(afastamentosPorUsuario, candidato, dataIso);
          const candidatoBloqueadoPosFeriasOuAbono = usuarioBloqueadoPosFeriasOuAbonoNoDia(
            afastamentosPorUsuario,
            candidato,
            dataIso,
            datasNaoUteisIsoSet,
          );
          /**
           * Retro-cadastro também precisa ser verificado no substituto. Ex.: candidato tem abono
           * na 2ª-feira e o plantão é no domingo anterior; sem dia útil intermediário, ele estaria
           * impedido de plantonear no domingo. Antes essa regra só era aplicada ao preferencial.
           */
          const candidatoBloqueadoRetroCadastro = usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(
            afastamentosPorUsuario,
            candidato,
            dataIso,
            datasNaoUteisIsoSet,
          );
          const candidatoSomenteAtestado =
            !candidatoBloqueadoPosFeriasOuAbono &&
            !candidatoBloqueadoRetroCadastro &&
            afastamentosCandidato.length > 0 &&
            afastamentosCandidato.every((af) => afastamentoEhAtestado(af));
          const candidatoIndisponivelReal =
            candidatoBloqueadoPosFeriasOuAbono ||
            candidatoBloqueadoRetroCadastro ||
            (afastamentosCandidato.length > 0 && !candidatoSomenteAtestado);
          if (candidatoIndisponivelReal) continue;
          encontrado = candidato;
          break;
        }
        if (!encontrado) {
          throw new ApiBaseError(`Não há veterinário disponível para o plantão em ${dataIso}.`);
        }
        usuarioAlocado = encontrado;
        const deveAlterarOrdem =
          afastamentosPreferencial.some((af) => afastamentoDeveAdiarNoCiclo(af)) ||
          preferencialBloqueadoPosFerias ||
          preferencialBloqueadoRetroCadastro;
        if (deveAlterarOrdem) {
          ordemAtual = moverUsuarioDepoisDaCobertura(ordemAtual, usuarioPreferencial, usuarioAlocado);
          ordemGlobal = moverUsuarioDepoisDaCobertura(ordemGlobal, usuarioPreferencial, usuarioAlocado);
          idxOrdem = (ordemAtual.indexOf(usuarioPreferencial) + 1) % ordemAtual.length;
        } else {
          idxOrdem = (idxPreferencial + 1) % ordemAtual.length;
        }
      }
    } else {
      idxOrdem = (idxPreferencial + 1) % ordemAtual.length;
    }

    const idxFila = filaRetornosFeriasPendentes.indexOf(Number(usuarioAlocado));
    if (idxFila >= 0) filaRetornosFeriasPendentes.splice(idxFila, 1);
    alocacoes.push({ dataIso, usuarioId: usuarioAlocado });
  }

  const ajusteFinal = aplicarRetornosFeriasPendentesPosEscala({
    ordemAtual,
    idxOrdem,
    afastamentosFlat,
    datasPlantaoIso,
    datasNaoUteisIsoSet,
  });
  ordemAtual = ajusteFinal.ordemAtual;
  idxOrdem = ajusteFinal.idxOrdem;

  const ordemNormalizada = normalizarOrdemRodizioCompleta(ordemAtual, membrosRef);
  const ordemPersistida = rotacionarOrdemParaProximoPreferencial(ordemNormalizada, idxOrdem);
  return { ordemAtual: ordemNormalizada, idxOrdem, ordemPersistida, alocacoes };
}

/** Simula rodízio de técnicos (2 vagas/dia, AABB…) — testes e depuração. */
function simularRodizioTecPlantoes(
  ordemInicial,
  datasPlantaoIso,
  afastamentosFlat,
  datasNaoUteisIsoSet = new Set(),
  idxInicial = 0,
  plantoesReferenciaRetorno = null,
  dataLimiteRetornoRealizado = null,
) {
  let ordemAtual = [...ordemInicial];
  let ordemGlobal = [...ordemInicial];
  let idxOrdem = Number(idxInicial) || 0;
  const membrosRef = [...ordemInicial];
  const afastamentosPorUsuario = montarAfastamentosPorUsuario(afastamentosFlat);
  const plantoes = [];
  for (const dataReferencia of datasPlantaoIso || []) {
    plantoes.push({ dataReferencia, categoriaPlantao: CATEGORIA_PLANTAO.TECNICO, vagaIndice: 0 });
    plantoes.push({ dataReferencia, categoriaPlantao: CATEGORIA_PLANTAO.TECNICO, vagaIndice: 1 });
  }
  const plantoesParaRetorno =
    Array.isArray(plantoesReferenciaRetorno) && plantoesReferenciaRetorno.length > 0
      ? plantoesReferenciaRetorno
      : plantoes;
  const categoriaPorUsuarioIdTec = new Map(
    (ordemInicial || []).map((id) => [Number(id), CATEGORIA_PLANTAO.TECNICO]),
  );
  const retornosFeriasNoPrimeiroPlantao = montarRetornosFeriasNoPrimeiroPlantao(
    afastamentosFlat,
    plantoesParaRetorno,
    datasNaoUteisIsoSet,
    categoriaPorUsuarioIdTec,
  );
  const filaRetornosFeriasPendentes = [];
  const primeiroUsuarioNoDiaTech = new Map();
  const alocacoes = [];

  for (const plantao of plantoes) {
    const dataIso = dataReferenciaParaStr(plantao.dataReferencia);
    if (!ordemAtual.length) continue;

    const idsExcluirMesmoDia = new Set();
    if (Number(plantao.vagaIndice) === 1) {
      const u0 = primeiroUsuarioNoDiaTech.get(dataIso);
      if (u0 != null) idsExcluirMesmoDia.add(Number(u0));
    }

    const idxPreferencial = idxOrdem % ordemAtual.length;
    const usuarioPreferencial = ordemAtual[idxPreferencial];
    const idxBaseBuscaSubstituto = idxPreferencial;

    const afastamentosPreferencial = afastamentosAtivosNoDia(afastamentosPorUsuario, usuarioPreferencial, dataIso);
    const preferencialBloqueadoPosFerias = usuarioBloqueadoPosFeriasOuAbonoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisIsoSet,
    );
    const preferencialBloqueadoRetroCadastro = usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisIsoSet,
    );
    let preferencialIndisponivel = usuarioIndisponivelParaPlantaoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisIsoSet,
    );
    if (idsExcluirMesmoDia.has(Number(usuarioPreferencial))) {
      preferencialIndisponivel = true;
    }

    let usuarioAlocado = usuarioPreferencial;
    const retornosHoje = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];
    for (const uidRaw of retornosHoje) {
      const uid = Number(uidRaw);
      if (!Number.isFinite(uid) || !ordemAtual.includes(uid)) continue;
      if (idsExcluirMesmoDia.has(uid)) continue;
      if (
        dataLimiteRetornoRealizado &&
        plantoesReferenciaRetorno &&
        usuarioRetornoFeriasAbonoJaRealizadoAntesDe(
          uid,
          dataLimiteRetornoRealizado,
          retornosFeriasNoPrimeiroPlantao,
          plantoesReferenciaRetorno,
          CATEGORIA_PLANTAO.TECNICO,
        )
      ) {
        continue;
      }
      if (!filaRetornosFeriasPendentes.includes(uid)) filaRetornosFeriasPendentes.push(uid);
    }
    const temRetornoFeriasPendente =
      retornosHoje.length > 0 || filaRetornosFeriasPendentes.length > 0;
    const retornoFeriasForcado = temRetornoFeriasPendente
      ? escolherRetornoFeriasDoDia(
          filaRetornosFeriasPendentes,
          ordemAtual,
          idxPreferencial,
          afastamentosPorUsuario,
          dataIso,
          datasNaoUteisIsoSet,
          idsExcluirMesmoDia,
        )
      : null;

    if (retornoFeriasForcado != null && !idsExcluirMesmoDia.has(Number(retornoFeriasForcado))) {
      usuarioAlocado = retornoFeriasForcado;
      if (Number(usuarioAlocado) !== Number(usuarioPreferencial)) {
        ordemAtual = moverUsuarioAntesDeReferencia(ordemAtual, usuarioAlocado, usuarioPreferencial);
        ordemGlobal = moverUsuarioAntesDeReferencia(ordemGlobal, usuarioAlocado, usuarioPreferencial);
      }
      idxOrdem = (ordemAtual.indexOf(usuarioAlocado) + 1) % ordemAtual.length;
    } else if (preferencialIndisponivel) {
      let encontrado = null;
      for (let passo = 1; passo <= ordemAtual.length; passo++) {
        const candidato = ordemAtual[(idxBaseBuscaSubstituto + passo) % ordemAtual.length];
        if (idsExcluirMesmoDia.has(Number(candidato))) continue;
        const afastamentosCandidato = afastamentosAtivosNoDia(afastamentosPorUsuario, candidato, dataIso);
        const candidatoBloqueadoPosFeriasOuAbono = usuarioBloqueadoPosFeriasOuAbonoNoDia(
          afastamentosPorUsuario,
          candidato,
          dataIso,
          datasNaoUteisIsoSet,
        );
        /**
         * Retro-cadastro também precisa ser verificado no substituto. Ex.: candidato tem abono
         * na 2ª-feira e o plantão é no domingo anterior; sem dia útil intermediário, ele estaria
         * impedido de plantonear no domingo. Antes essa regra só era aplicada ao preferencial.
         */
        const candidatoBloqueadoRetroCadastro = usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(
          afastamentosPorUsuario,
          candidato,
          dataIso,
          datasNaoUteisIsoSet,
        );
        const candidatoSomenteAtestado =
          !candidatoBloqueadoPosFeriasOuAbono &&
          !candidatoBloqueadoRetroCadastro &&
          afastamentosCandidato.length > 0 &&
          afastamentosCandidato.every((af) => afastamentoEhAtestado(af));
        const candidatoIndisponivelReal =
          candidatoBloqueadoPosFeriasOuAbono ||
          candidatoBloqueadoRetroCadastro ||
          (afastamentosCandidato.length > 0 && !candidatoSomenteAtestado);
        if (candidatoIndisponivelReal) continue;
        encontrado = candidato;
        break;
      }
      if (!encontrado) {
        throw new ApiBaseError(`Não há técnico disponível para o plantão em ${dataIso}.`);
      }
      usuarioAlocado = encontrado;
      const deveAlterarOrdem =
        afastamentosPreferencial.some((af) => afastamentoDeveAdiarNoCiclo(af)) ||
        preferencialBloqueadoPosFerias ||
        preferencialBloqueadoRetroCadastro;
      if (deveAlterarOrdem) {
        ordemAtual = moverUsuarioDepoisDaCobertura(ordemAtual, usuarioPreferencial, usuarioAlocado);
        ordemGlobal = moverUsuarioDepoisDaCobertura(ordemGlobal, usuarioPreferencial, usuarioAlocado);
        idxOrdem = (ordemAtual.indexOf(usuarioPreferencial) + 1) % ordemAtual.length;
      } else {
        idxOrdem = (idxPreferencial + 1) % ordemAtual.length;
      }
    } else {
      idxOrdem = (idxPreferencial + 1) % ordemAtual.length;
    }

    const idxFila = filaRetornosFeriasPendentes.indexOf(Number(usuarioAlocado));
    if (idxFila >= 0) filaRetornosFeriasPendentes.splice(idxFila, 1);
    alocacoes.push({ dataIso, vagaIndice: Number(plantao.vagaIndice), usuarioId: usuarioAlocado });
    if (Number(plantao.vagaIndice) === 0) {
      primeiroUsuarioNoDiaTech.set(dataIso, Number(usuarioAlocado));
    }
  }

  const ajusteFinal = aplicarRetornosFeriasPendentesPosEscala({
    ordemAtual,
    idxOrdem,
    afastamentosFlat,
    datasPlantaoIso,
    datasNaoUteisIsoSet,
    vagasPorData: 2,
  });
  ordemAtual = ajusteFinal.ordemAtual;
  idxOrdem = ajusteFinal.idxOrdem;

  const ordemNormalizada = normalizarOrdemRodizioCompleta(ordemAtual, membrosRef);
  const ordemPersistida = rotacionarOrdemParaProximoPreferencial(ordemNormalizada, idxOrdem);
  return { ordemAtual: ordemNormalizada, idxOrdem, ordemPersistida, alocacoes };
}

/**
 * Reconstrói a fila de técnicos com o mesmo rodízio pleno que geraria o calendário atual
 * (ex.: após abono Diego + espelho de julho, Elisa fica antes de Diego na fila).
 */
function derivarOrdemTecRodizioConsistenteComPlantoes({
  plantoes,
  ordemBase,
  afastamentosLista,
  datasNaoUteisIsoSet,
}) {
  const ordemInicial = normalizarOrdemRodizioCompleta(ordemBase, ordemBase);
  if (!ordemInicial.length) {
    return { ordemAtual: [], ordemPersistida: [], idxOrdem: 0 };
  }
  const datasTec = [
    ...new Set(
      plantoes
        .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO)
        .map((p) => dataReferenciaParaStr(p.dataReferencia))
        .filter(Boolean),
    ),
  ].sort();
  const plantoesRef = plantoes
    .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO)
    .map((p) => ({
      dataReferencia: dataReferenciaParaStr(p.dataReferencia),
      categoriaPlantao: CATEGORIA_PLANTAO.TECNICO,
      usuarioId: Number(p.usuarioId),
      vagaIndice: Number(p.vagaIndice),
    }));
  const afFlat = (afastamentosLista || []).map((a) => (a.get ? a.get({ plain: true }) : a));
  const sim = simularRodizioTecPlantoes(
    ordemInicial,
    datasTec,
    afFlat,
    datasNaoUteisIsoSet,
    0,
    plantoesRef,
  );
  return {
    ordemAtual: sim.ordemAtual,
    ordemPersistida: sim.ordemPersistida,
    idxOrdem: sim.idxOrdem,
  };
}

/**
 * Reconstrói a fila de veterinários a partir do calendário gravado (mesma ideia do técnico:
 * plantões + afastamentos → fila interna + rotação para o próximo plantão).
 */
function derivarOrdemVetRodizioConsistenteComPlantoes({
  plantoes,
  ordemBase,
  afastamentosLista,
  datasNaoUteisIsoSet = new Set(),
  /**
   * `rotacionar`: mantém a fila do loop focalizado e só alinha o próximo da fila ao calendário gravado.
   * `replay`: reconstrói a fila a partir do calendário (1º abono na escala, ex.: Daniel).
   */
  modo = 'replay',
  /** Ex.: `2026-07-01` no abono focalizado de junho — igual ao recálculo pleno do mês seguinte. */
  dataLimiteRotacaoIso = null,
}) {
  const ordemInicial = normalizarOrdemRodizioCompleta(ordemBase, ordemBase);
  if (!ordemInicial.length) {
    return { ordemAtual: [], ordemPersistida: [], idxOrdem: 0 };
  }
  const plantoesVetTodos = (plantoes || [])
    .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO)
    .sort((a, b) => {
      const cmp = dataReferenciaParaStr(a.dataReferencia).localeCompare(dataReferenciaParaStr(b.dataReferencia));
      if (cmp !== 0) return cmp;
      return Number(a.vagaIndice ?? 0) - Number(b.vagaIndice ?? 0);
    });
  /** Com `dataLimiteRotacaoIso` (ex. 01/07): só plantões anteriores; sem limite (escala bimestral): todos os dias. */
  const plantoesVet = dataLimiteRotacaoIso
    ? plantoesVetTodos.filter((p) => dataReferenciaParaStr(p.dataReferencia) < dataLimiteRotacaoIso)
    : plantoesVetTodos;
  const datasVet = [
    ...new Set(plantoesVet.map((p) => dataReferenciaParaStr(p.dataReferencia)).filter(Boolean)),
  ].sort();
  const limiteRotacao =
    dataLimiteRotacaoIso ||
    (datasVet.length > 0 ? adicionarDiasIso(datasVet[datasVet.length - 1], 1) : null);
  if (modo === 'rotacionar' && limiteRotacao) {
    const idxFim = obterIdxRodizioAposUltimoPlantaoAntesDe(
      plantoesVet,
      ordemInicial,
      limiteRotacao,
      CATEGORIA_PLANTAO.VETERINARIO,
    );
    const ordemPersistida = rotacionarOrdemParaProximoPreferencial(ordemInicial, idxFim);
    return { ordemAtual: ordemInicial, ordemPersistida, idxOrdem: idxFim };
  }
  const afFlat = (afastamentosLista || []).map((a) => (a.get ? a.get({ plain: true }) : a));
  const retornosFeriasNoPrimeiroPlantao = montarRetornosFeriasNoPrimeiroPlantao(
    afFlat,
    plantoesVet.map((p) => ({ dataReferencia: dataReferenciaParaStr(p.dataReferencia) })),
    datasNaoUteisIsoSet,
  );
  let ordemAtual = [...ordemInicial];
  let idxOrdem = 0;
  for (const plantao of plantoesVet) {
    const dataIso = dataReferenciaParaStr(plantao.dataReferencia);
    const alocado = Number(plantao.usuarioId);
    if (!dataIso || !Number.isFinite(alocado) || alocado < 1) continue;
    const idxPref = idxOrdem % ordemAtual.length;
    const preferencial = ordemAtual[idxPref];
    const retornosHoje = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];
    const alocadoEhRetorno = retornosHoje.some((u) => Number(u) === alocado);
    if (
      alocado !== preferencial &&
      ordemAtual.includes(alocado) &&
      (preferencial == null || ordemAtual.includes(preferencial))
    ) {
      if (alocadoEhRetorno && preferencial != null) {
        ordemAtual = moverUsuarioAntesDeReferencia(ordemAtual, alocado, preferencial);
      } else if (preferencial != null) {
        ordemAtual = moverUsuarioDepoisDaCobertura(ordemAtual, preferencial, alocado);
      }
    }
    const pos = ordemAtual.indexOf(alocado);
    idxOrdem = pos >= 0 ? (pos + 1) % ordemAtual.length : (idxPref + 1) % ordemAtual.length;
  }
  const ordemNormalizada = normalizarOrdemRodizioCompleta(ordemAtual, ordemInicial);
  const n = ordemNormalizada.length;
  let idxFim = 0;
  if (limiteRotacao && n > 0) {
    idxFim = obterIdxRodizioAposUltimoPlantaoAntesDe(
      plantoesVet,
      ordemNormalizada,
      limiteRotacao,
      CATEGORIA_PLANTAO.VETERINARIO,
    );
    /**
     * Ex.: A no 27 (retorno) e G no 28 — na fila interna G e A podem não ser adjacentes;
     * o próximo plantão (julho) segue o penúltimo fim de semana (Ana), não (pos(G)+1).
     */
    if (plantoesVet.length >= 2) {
      const uPen = Number(plantoesVet[plantoesVet.length - 2].usuarioId);
      const uUlt = Number(plantoesVet[plantoesVet.length - 1].usuarioId);
      const iUlt = ordemNormalizada.indexOf(uUlt);
      const iPen = ordemNormalizada.indexOf(uPen);
      if (
        Number.isFinite(uPen) &&
        Number.isFinite(uUlt) &&
        uPen !== uUlt &&
        iPen >= 0 &&
        iUlt >= 0 &&
        (iUlt + 1) % n !== iPen
      ) {
        idxFim = iPen;
      }
    }
  }
  const ordemPersistida = rotacionarOrdemParaProximoPreferencial(ordemNormalizada, idxFim);
  return { ordemAtual: ordemNormalizada, ordemPersistida, idxOrdem: idxFim };
}

/**
 * Re-simula plantões de técnico com data > fim do abono (mesma lógica do recálculo pleno).
 * Evita índice desalinhado entre dias consecutivos no loop focalizado (ex.: 27 → 28).
 */
function mesIsoDeDataReferencia(dataIso) {
  const s = String(dataIso || '');
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : '';
}

/** Mesma regra do cadastro (máx. dois meses fechados): junho+julho = uma linha de plantões. */
function escalaCobreNoMaximoDoisMeses(dataInicioStr, dataFimStr) {
  const mesIni = mesIsoDeDataReferencia(dataInicioStr);
  const mesFim = mesIsoDeDataReferencia(dataFimStr);
  if (!mesIni || !mesFim || mesIni > mesFim) return false;
  const [y0, m0] = mesIni.split('-').map(Number);
  const [y1, m1] = mesFim.split('-').map(Number);
  const diffMeses = (y1 - y0) * 12 + (m1 - m0);
  return diffMeses >= 0 && diffMeses <= 1;
}

/**
 * Recalendário pleno em escala bimestral: todos os fins de semana em ordem cronológica
 * (equivalente a duas escalas mensais seguidas, sem espelhar julho em cima de junho).
 */
function sincronizarCalendarioRodizioPlenoEscalaBimestre({
  plantoes,
  ordemVetInicial,
  ordemTecInicial,
  afastamentosFlat,
  datasNaoUteisIsoSet = new Set(),
}) {
  let atualizados = 0;
  const afList = afastamentosFlat || [];

  const datasVet = [
    ...new Set(
      plantoes
        .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO)
        .map((p) => dataReferenciaParaStr(p.dataReferencia))
        .filter(Boolean),
    ),
  ].sort();
  if (datasVet.length && Array.isArray(ordemVetInicial) && ordemVetInicial.length) {
    const ordemVet = normalizarOrdemRodizioCompleta(ordemVetInicial, ordemVetInicial);
    const simVet = simularRodizioVetPlantoes(ordemVet, datasVet, afList, datasNaoUteisIsoSet);
    for (const aloc of simVet.alocacoes || []) {
      const pl = plantoes.find(
        (p) =>
          categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO &&
          dataReferenciaParaStr(p.dataReferencia) === aloc.dataIso,
      );
      if (!pl) continue;
      const alvo = Number(aloc.usuarioId);
      if (Number.isFinite(alvo) && alvo > 0 && Number(pl.usuarioId) !== alvo) {
        pl.usuarioId = alvo;
        pl.observacao = null;
        atualizados += 1;
      }
    }
  }

  const datasTec = [
    ...new Set(
      plantoes
        .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO)
        .map((p) => dataReferenciaParaStr(p.dataReferencia))
        .filter(Boolean),
    ),
  ].sort();
  if (datasTec.length && Array.isArray(ordemTecInicial) && ordemTecInicial.length) {
    const ordemTec = normalizarOrdemRodizioCompleta(ordemTecInicial, ordemTecInicial);
    const simTec = simularRodizioTecPlantoes(ordemTec, datasTec, afList, datasNaoUteisIsoSet);
    for (const aloc of simTec.alocacoes || []) {
      const pl = plantoes.find(
        (p) =>
          categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO &&
          dataReferenciaParaStr(p.dataReferencia) === aloc.dataIso &&
          Number(p.vagaIndice) === Number(aloc.vagaIndice),
      );
      if (!pl) continue;
      const alvo = Number(aloc.usuarioId);
      if (Number.isFinite(alvo) && alvo > 0 && Number(pl.usuarioId) !== alvo) {
        pl.usuarioId = alvo;
        pl.observacao = null;
        atualizados += 1;
      }
    }
  }

  return { atualizados };
}

/**
 * Fila global em escala bimestral: sempre via `simularRodizioVetPlantoes` (linha do tempo contínua).
 * - Afastamento em jun (ex.: Diego): só fins de semana &lt; 01/07 → BCEFDGAH.
 * - Afastamento em jul (ex.: Elisa): todos os fins de semana jun+jul → BCFDEHAG (não replay/derivar).
 */
function ordemVetPersistidaBimestreFocado({
  plantoes,
  ordemBaseVet,
  afastamentosFlat,
  fimIsoAfastamentoFocado,
  datasNaoUteisIsoSet = new Set(),
}) {
  const ordemBase = normalizarOrdemRodizioCompleta(ordemBaseVet, ordemBaseVet);
  if (!ordemBase.length) {
    return { ordemAtual: [], ordemPersistida: [], idxOrdem: 0 };
  }
  const datasVet = [
    ...new Set(
      plantoes
        .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO)
        .map((p) => dataReferenciaParaStr(p.dataReferencia))
        .filter(Boolean),
    ),
  ].sort();
  const dataLimiteRotacao = fimIsoAfastamentoFocado
    ? primeiroDiaMesSeguinte(fimIsoAfastamentoFocado)
    : null;
  const ultimaDataVet = datasVet.length ? datasVet[datasVet.length - 1] : null;
  const afastamentoAntesDoUltimoMesDaEscala = Boolean(
    dataLimiteRotacao &&
      fimIsoAfastamentoFocado &&
      ultimaDataVet &&
      mesIsoDeDataReferencia(fimIsoAfastamentoFocado) < mesIsoDeDataReferencia(ultimaDataVet),
  );
  const datasSimulacao = afastamentoAntesDoUltimoMesDaEscala
    ? datasVet.filter((ds) => ds < dataLimiteRotacao)
    : datasVet;
  if (!datasSimulacao.length) {
    return { ordemAtual: [...ordemBase], ordemPersistida: [...ordemBase], idxOrdem: 0 };
  }
  return simularRodizioVetPlantoes(
    ordemBase,
    datasSimulacao,
    afastamentosFlat,
    datasNaoUteisIsoSet,
  );
}

function mesIsoAnteriorDeDataLimite(dataLimiteIso) {
  const mes = mesIsoDeDataReferencia(dataLimiteIso);
  if (!/^\d{4}-\d{2}$/.test(mes)) return '';
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * No modo focalizado (ex.: abono Diego em junho), julho repete os pares do mês anterior
 * (1º fim de semana de jul = 1º de jun, etc.) — evita Eduardo+Diego onde junho tinha Eduardo+Elisa.
 */
function espelharPlantoesTecMesSeguintePeloMesAnterior({ plantoes, dataLimiteIso }) {
  const mesAnterior = mesIsoAnteriorDeDataLimite(dataLimiteIso);
  if (!mesAnterior || !dataLimiteIso) {
    return { idsProcessados: new Set(), atualizados: 0 };
  }
  const datasMesAnterior = [
    ...new Set(
      plantoes
        .filter((p) => {
          const ds = dataReferenciaParaStr(p.dataReferencia);
          return (
            categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO &&
            ds &&
            mesIsoDeDataReferencia(ds) === mesAnterior
          );
        })
        .map((p) => dataReferenciaParaStr(p.dataReferencia)),
    ),
  ].sort();
  const datasMesSeguinte = [
    ...new Set(
      plantoes
        .filter((p) => {
          const ds = dataReferenciaParaStr(p.dataReferencia);
          return (
            categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO &&
            ds &&
            dataLimiteIso &&
            ds >= dataLimiteIso
          );
        })
        .map((p) => dataReferenciaParaStr(p.dataReferencia)),
    ),
  ].sort();
  const idsProcessados = new Set();
  let atualizados = 0;
  const n = Math.min(datasMesAnterior.length, datasMesSeguinte.length);
  for (let i = 0; i < n; i++) {
    const dsJun = datasMesAnterior[i];
    const dsJul = datasMesSeguinte[i];
    const parJun = plantoes
      .filter(
        (p) =>
          categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO &&
          dataReferenciaParaStr(p.dataReferencia) === dsJun,
      )
      .sort((a, b) => Number(a.vagaIndice) - Number(b.vagaIndice));
    const parJul = plantoes
      .filter(
        (p) =>
          categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO &&
          dataReferenciaParaStr(p.dataReferencia) === dsJul,
      )
      .sort((a, b) => Number(a.vagaIndice) - Number(b.vagaIndice));
    for (let v = 0; v < Math.min(parJun.length, parJul.length); v++) {
      const uidJun = Number(parJun[v].usuarioId);
      if (!Number.isFinite(uidJun) || uidJun < 1) continue;
      if (Number(parJul[v].usuarioId) !== uidJun) {
        parJul[v].usuarioId = uidJun;
        parJul[v].observacao = null;
        atualizados += 1;
      }
      idsProcessados.add(Number(parJul[v].id));
    }
  }
  return { idsProcessados, atualizados };
}

async function espelharPlantoesTecMesSeguinteFocado(opts) {
  const { transaction, ...memOpts } = opts;
  const res = espelharPlantoesTecMesSeguintePeloMesAnterior(memOpts);
  if (transaction) {
    for (const plantao of opts.plantoes) {
      if (!res.idsProcessados.has(Number(plantao.id))) continue;
      if (typeof plantao.save === 'function') {
        await plantao.save({ transaction });
      }
    }
  }
  return res;
}

/**
 * Veterinário (1 vaga/dia): julho repete o 1º, 2º, … fim de semana de junho (mesma lógica do técnico).
 */
function espelharPlantoesVetMesSeguintePeloMesAnterior({ plantoes, dataLimiteIso }) {
  const mesAnterior = mesIsoAnteriorDeDataLimite(dataLimiteIso);
  if (!mesAnterior || !dataLimiteIso) {
    return { idsProcessados: new Set(), atualizados: 0 };
  }
  const datasMesAnterior = [
    ...new Set(
      plantoes
        .filter((p) => {
          const ds = dataReferenciaParaStr(p.dataReferencia);
          return (
            categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO &&
            ds &&
            mesIsoDeDataReferencia(ds) === mesAnterior
          );
        })
        .map((p) => dataReferenciaParaStr(p.dataReferencia)),
    ),
  ].sort();
  const datasMesSeguinte = [
    ...new Set(
      plantoes
        .filter((p) => {
          const ds = dataReferenciaParaStr(p.dataReferencia);
          return (
            categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO &&
            ds &&
            ds >= dataLimiteIso
          );
        })
        .map((p) => dataReferenciaParaStr(p.dataReferencia)),
    ),
  ].sort();
  const idsProcessados = new Set();
  let atualizados = 0;
  const n = Math.min(datasMesAnterior.length, datasMesSeguinte.length);
  for (let i = 0; i < n; i++) {
    const dsJun = datasMesAnterior[i];
    const dsJul = datasMesSeguinte[i];
    const plJun = plantoes.find(
      (p) =>
        categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO &&
        dataReferenciaParaStr(p.dataReferencia) === dsJun,
    );
    const plJul = plantoes.find(
      (p) =>
        categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO &&
        dataReferenciaParaStr(p.dataReferencia) === dsJul,
    );
    if (!plJun || !plJul) continue;
    const uidJun = Number(plJun.usuarioId);
    if (!Number.isFinite(uidJun) || uidJun < 1) continue;
    if (Number(plJul.usuarioId) !== uidJun) {
      plJul.usuarioId = uidJun;
      plJul.observacao = null;
      atualizados += 1;
    }
    idsProcessados.add(Number(plJul.id));
  }
  return { idsProcessados, atualizados };
}

async function espelharPlantoesVetMesSeguinteFocado(opts) {
  const { transaction, ...memOpts } = opts;
  const res = espelharPlantoesVetMesSeguintePeloMesAnterior(memOpts);
  if (transaction) {
    for (const plantao of opts.plantoes) {
      if (!res.idsProcessados.has(Number(plantao.id))) continue;
      if (typeof plantao.save === 'function') {
        await plantao.save({ transaction });
      }
    }
  }
  return res;
}

function plantoesTecDiaBatemComAlocacoes(plantoes, dataIso, alocacoes) {
  const mapa = new Map();
  for (const a of alocacoes) {
    mapa.set(`${a.dataIso}:${a.vagaIndice}`, a.usuarioId);
  }
  const noDia = plantoes.filter(
    (p) =>
      dataReferenciaParaStr(p.dataReferencia) === dataIso &&
      categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO,
  );
  if (noDia.length === 0) return true;
  return noDia.every(
    (p) => Number(mapa.get(`${dataIso}:${Number(p.vagaIndice)}`)) === Number(p.usuarioId),
  );
}

function realocarPlantoesTecAposFimAbonoEmMemoria({
  plantoes,
  fimIsoAbono,
  ordemAtualTec,
  ordemGlobalTec,
  afastamentosLista,
  datasNaoUteisIsoSet,
  apenasSeDiaDivergente = false,
  /** Ordem inicial da escala para referência do último fim de semana (recálculo pleno com todos os afastamentos). */
  ordemReferenciaPlena = null,
  idxOrdemTecInicial = null,
}) {
  const plantoesAlvo = plantoes.filter((p) => {
    const ds = dataReferenciaParaStr(p.dataReferencia);
    return categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO && ds && ds > fimIsoAbono;
  });
  const idsProcessados = new Set();
  let atualizados = 0;
  if (plantoesAlvo.length === 0) {
    return { ordemAtualTec: [...ordemAtualTec], ordemGlobalTec: [...ordemGlobalTec], idxOrdemTec: 0, idsProcessados, atualizados };
  }

  const datasApos = [
    ...new Set(plantoesAlvo.map((p) => dataReferenciaParaStr(p.dataReferencia)).filter(Boolean)),
  ].sort();
  const limiteIdx = adicionarDiasIso(fimIsoAbono, 1);
  let ordemWork = [...ordemAtualTec];
  let ordemGlobalWork = [...ordemGlobalTec];
  let idxWork =
    idxOrdemTecInicial != null && Number.isFinite(Number(idxOrdemTecInicial))
      ? ((Number(idxOrdemTecInicial) % ordemWork.length) + ordemWork.length) % ordemWork.length
      : obterIdxRodizioAposUltimoPlantaoAntesDe(plantoes, ordemWork, limiteIdx, CATEGORIA_PLANTAO.TECNICO);

  const ultimaDataApos = datasApos.length > 0 ? datasApos[datasApos.length - 1] : null;

  const aplicarAlocacoesDiaNosPlantoes = (alocsDia) => {
    for (const a of alocsDia) {
      const plantao = plantoesAlvo.find(
        (p) =>
          dataReferenciaParaStr(p.dataReferencia) === a.dataIso &&
          Number(p.vagaIndice) === Number(a.vagaIndice),
      );
      if (!plantao) continue;
      if (Number(plantao.usuarioId) !== Number(a.usuarioId)) {
        plantao.usuarioId = Number(a.usuarioId);
        plantao.observacao = null;
        atualizados += 1;
      }
      idsProcessados.add(Number(plantao.id));
    }
  };

  if (apenasSeDiaDivergente && datasApos.length > 0) {
    const datasIntermediarias = ultimaDataApos
      ? datasApos.filter((ds) => ds !== ultimaDataApos)
      : [...datasApos];
    const datasMesRodizio = [
      ...new Set(
        plantoes
          .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO)
          .map((p) => dataReferenciaParaStr(p.dataReferencia))
          .filter(Boolean),
      ),
    ].sort();
    const simRef = simularRodizioTecPlantoes(
      ordemWork,
      datasMesRodizio,
      afastamentosLista,
      datasNaoUteisIsoSet,
      idxWork,
    );
    for (const ds of datasIntermediarias) {
      const alocsDia = simRef.alocacoes.filter((a) => a.dataIso === ds);
      if (!plantoesTecDiaBatemComAlocacoes(plantoes, ds, alocsDia)) {
        aplicarAlocacoesDiaNosPlantoes(alocsDia);
      } else {
        for (const p of plantoesAlvo) {
          if (dataReferenciaParaStr(p.dataReferencia) === ds) idsProcessados.add(Number(p.id));
        }
      }
    }
    if (datasIntermediarias.length > 0) {
      const simOrdemInter = simularRodizioTecPlantoes(
        ordemWork,
        datasIntermediarias,
        afastamentosLista,
        datasNaoUteisIsoSet,
        idxWork,
      );
      ordemWork = simOrdemInter.ordemAtual;
      ordemGlobalWork = simOrdemInter.ordemPersistida;
      idxWork = simOrdemInter.idxOrdem;
    }
    if (ultimaDataApos) {
      const ordemPlena = ordemReferenciaPlena?.length
        ? normalizarOrdemRodizioCompleta(ordemReferenciaPlena, ordemReferenciaPlena)
        : ordemWork;
      const simPlena = simularRodizioTecPlantoes(
        ordemPlena,
        datasMesRodizio,
        afastamentosLista,
        datasNaoUteisIsoSet,
        0,
      );
      const alocsUltimaRef = simPlena.alocacoes.filter((a) => a.dataIso === ultimaDataApos);
      if (!plantoesTecDiaBatemComAlocacoes(plantoes, ultimaDataApos, alocsUltimaRef)) {
        aplicarAlocacoesDiaNosPlantoes(alocsUltimaRef);
      } else {
        for (const p of plantoesAlvo) {
          if (dataReferenciaParaStr(p.dataReferencia) === ultimaDataApos) idsProcessados.add(Number(p.id));
        }
      }
    }
  } else {
    for (const ds of datasApos) {
      const simDia = simularRodizioTecPlantoes(
        ordemWork,
        [ds],
        afastamentosLista,
        datasNaoUteisIsoSet,
        idxWork,
      );
      const jaCorreto = plantoesTecDiaBatemComAlocacoes(plantoes, ds, simDia.alocacoes);
      if (!jaCorreto) {
        for (const a of simDia.alocacoes) {
          const plantao = plantoesAlvo.find(
            (p) =>
              dataReferenciaParaStr(p.dataReferencia) === a.dataIso &&
              Number(p.vagaIndice) === Number(a.vagaIndice),
          );
          if (!plantao) continue;
          if (Number(plantao.usuarioId) !== Number(a.usuarioId)) {
            plantao.usuarioId = Number(a.usuarioId);
            plantao.observacao = null;
            atualizados += 1;
          }
          idsProcessados.add(Number(plantao.id));
        }
        ordemWork = simDia.ordemAtual;
        ordemGlobalWork = simDia.ordemPersistida;
      } else {
        for (const p of plantoesAlvo) {
          if (dataReferenciaParaStr(p.dataReferencia) === ds) idsProcessados.add(Number(p.id));
        }
      }
      idxWork = simDia.idxOrdem;
    }
  }

  for (const plantao of plantoesAlvo) {
    idsProcessados.add(Number(plantao.id));
  }

  return {
    ordemAtualTec: ordemWork,
    ordemGlobalTec: ordemGlobalWork,
    idxOrdemTec: idxWork,
    idsProcessados,
    atualizados,
  };
}

async function realocarPlantoesTecAposFimAbonoFocado(opts) {
  const { transaction, ...memOpts } = opts;
  const res = realocarPlantoesTecAposFimAbonoEmMemoria(memOpts);
  if (transaction) {
    for (const plantao of opts.plantoes) {
      if (!res.idsProcessados.has(Number(plantao.id))) continue;
      if (typeof plantao.save === 'function') {
        await plantao.save({ transaction });
      }
    }
  }
  return res;
}

/**
 * Simula recálculo focalizado de técnicos (2º afastamento com anterior na escala), usando plantões
 * já gravados como ponto de partida — cobre o fluxo real da API, distinto do recálculo pleno.
 */
function simularRodizioTecModoFocado({
  ordemInicial,
  plantoesIniciais,
  afastamentosFlat,
  usuarioAfetadoId,
  inicioAfastamentoIso,
  fimAfastamentoIso,
  datasNaoUteisIsoSet = new Set(),
  /** Ordem da escala no BD (rodízio base) para alinhar domingo 21 / dia após retorno ao pleno. */
  ordemReferenciaPleno = null,
  /** Ordem AABB do histórico `inicial` — referência do rodízio pleno (preferível a `ordemReferenciaPleno`). */
  ordemCicloReferencia = null,
  /** Escala bimestral (máx. 2 meses): sem espelho / corte no 1º dia do mês seguinte ao fim do afastamento. */
  rodizioContinuo = false,
}) {
  const ordemEntradaFocado = [...ordemInicial];
  const ordemPlenoRef =
    Array.isArray(ordemCicloReferencia) && ordemCicloReferencia.length
      ? [...ordemCicloReferencia]
      : Array.isArray(ordemReferenciaPleno) && ordemReferenciaPleno.length
        ? [...ordemReferenciaPleno]
        : [...ordemInicial];
  let ordemAtualTec = [...ordemInicial];
  let ordemGlobalTec = [...ordemInicial];
  let idxOrdemTec = 0;
  const membrosRef = [...ordemInicial];
  const uid = Number(usuarioAfetadoId);
  const afastamentosPorUsuario = montarAfastamentosPorUsuario(afastamentosFlat);
  let plantoes = (plantoesIniciais || []).map((p, i) => ({
    id: p.id ?? i + 1,
    dataReferencia: p.dataIso ?? p.dataReferencia,
    categoriaPlantao: CATEGORIA_PLANTAO.TECNICO,
    vagaIndice: Number(p.vagaIndice),
    usuarioId: Number(p.usuarioId),
    observacao: null,
  }));
  plantoes.sort((a, b) => {
    const cmp = dataReferenciaParaStr(a.dataReferencia).localeCompare(dataReferenciaParaStr(b.dataReferencia));
    if (cmp !== 0) return cmp;
    return Number(a.vagaIndice) - Number(b.vagaIndice);
  });
  const categoriaPorUsuarioIdTecFoc = new Map(
    (ordemInicial || []).map((id) => [Number(id), CATEGORIA_PLANTAO.TECNICO]),
  );
  const retornosFeriasNoPrimeiroPlantao = montarRetornosFeriasNoPrimeiroPlantao(
    afastamentosFlat,
    plantoes,
    datasNaoUteisIsoSet,
    categoriaPorUsuarioIdTecFoc,
  );
  const filaRetornosFeriasPendentes = [];
  const primeiroUsuarioNoDiaTech = new Map();
  const dataLimitePuloFocado =
    fimAfastamentoIso && !rodizioContinuo ? primeiroDiaMesSeguinte(fimAfastamentoIso) : null;
  const tipoFocadoSim =
    (afastamentosFlat || []).find((a) => Number(a.usuarioId) === uid)?.tipo?.tipo || 'Abono';
  const afFocadoPlainSim = {
    usuarioId: uid,
    dataInicio: inicioAfastamentoIso,
    dataFim: fimAfastamentoIso,
    tipo: { tipo: tipoFocadoSim },
  };
  const outrosAfastamentosSim = (afastamentosFlat || []).filter(
    (a) => Number(a.usuarioId) !== uid && (afastamentoEhAbono(a) || afastamentoEhFerias(a)),
  );
  const datasPlantoesTecOrdenadas = [
    ...new Set(plantoes.map((p) => dataReferenciaParaStr(p.dataReferencia)).filter(Boolean)),
  ].sort();
  const plantaoIdsRetroLote = new Set();
  const datasRetornoAbonoFocadoProcessadosSim = new Set();
  const idxState = { idxTec: 0 };
  const datasRelevantes = plantoes
    .filter((p) =>
      plantaoRequerRecalculoFocado(
        uid,
        p,
        dataReferenciaParaStr(p.dataReferencia),
        ordemAtualTec,
        retornosFeriasNoPrimeiroPlantao,
        afastamentosPorUsuario,
        datasNaoUteisIsoSet,
        afFocadoPlainSim,
        outrosAfastamentosSim,
        datasPlantoesTecOrdenadas,
      ),
    )
    .map((p) => dataReferenciaParaStr(p.dataReferencia))
    .filter(Boolean)
    .sort();
  const primeiraDataRelevante = datasRelevantes[0];
  if (primeiraDataRelevante) {
    const idxSync = sincronizarIdxOrdemDePlantoes(plantoes, [], ordemAtualTec, primeiraDataRelevante);
    idxOrdemTec = idxSync.idxTec;
    idxState.idxTec = idxOrdemTec;
  }

  const ultimoDiaRetroAntesInicioSim = afastamentoEhAbono(afFocadoPlainSim)
    ? ultimoDiaPlantaoRetroCadastroAntesInicio(
        inicioAfastamentoIso,
        uid,
        afastamentosPorUsuario,
        datasNaoUteisIsoSet,
      )
    : null;
  const fimIsoAbonoSim = fimAfastamentoIso;
  const temAbonoAnteriorFimSim = outrosAfastamentosSim.some((a) => afastamentoEhAbono(a));

  if (inicioAfastamentoIso && ordemAtualTec.length > 0) {
    let idxBusca = idxOrdemTec;
    const plantoesRetro = plantoes
      .filter((p) => {
        const ds = dataReferenciaParaStr(p.dataReferencia);
        if (!ds) return false;
        if (afastamentoEhAbono(afFocadoPlainSim) && temAbonoAnteriorFimSim) {
          return (
            ds < inicioAfastamentoIso &&
            Number(p.usuarioId) === uid &&
            usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(
              afastamentosPorUsuario,
              uid,
              ds,
              datasNaoUteisIsoSet,
            )
          );
        }
        if (!ds || ds >= inicioAfastamentoIso) return false;
        if (!usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(afastamentosPorUsuario, uid, ds, datasNaoUteisIsoSet)) {
          return false;
        }
        if (afastamentoEhAbono(afFocadoPlainSim)) {
          return Number(p.usuarioId) === uid;
        }
        return Number(p.usuarioId) === uid;
      })
      .sort((a, b) =>
        dataReferenciaParaStr(a.dataReferencia).localeCompare(dataReferenciaParaStr(b.dataReferencia)),
      );
    for (const plantao of plantoesRetro) {
      const dataIso = dataReferenciaParaStr(plantao.dataReferencia);
      const posTitular = ordemAtualTec.indexOf(uid);
      const idxParaBusca = posTitular >= 0 ? idxBusca % ordemAtualTec.length : idxBusca;
      const idsExcluirMesmoDia = new Set();
      for (const p of plantoes) {
        if (dataReferenciaParaStr(p.dataReferencia) !== dataIso) continue;
        if (Number(p.id) === Number(plantao.id)) continue;
        const u = Number(p.usuarioId);
        if (Number.isFinite(u) && u > 0) idsExcluirMesmoDia.add(u);
      }
      const encontrado = buscarProximoUsuarioDisponivelNoCiclo(
        ordemAtualTec,
        idxParaBusca,
        afastamentosPorUsuario,
        dataIso,
        datasNaoUteisIsoSet,
        idsExcluirMesmoDia,
        new Set([uid]),
      );
      if (!encontrado) {
        throw new ApiBaseError(`Não há técnico disponível para o plantão em ${dataIso}.`);
      }
      ordemAtualTec = moverUsuarioDepoisDaCobertura(ordemAtualTec, uid, encontrado);
      ordemGlobalTec = moverUsuarioDepoisDaCobertura(ordemGlobalTec, uid, encontrado);
      idxBusca = (ordemAtualTec.indexOf(uid) + 1) % ordemAtualTec.length;
      plantao.usuarioId = encontrado;
      plantaoIdsRetroLote.add(Number(plantao.id));
    }
    idxOrdemTec = idxBusca;
    idxState.idxTec = idxOrdemTec;
  }

  for (const plantao of plantoes) {
    const dataIso = dataReferenciaParaStr(plantao.dataReferencia);
    const recalculoPlenoNestePlantao = Boolean(dataLimitePuloFocado && dataIso >= dataLimitePuloFocado);
    const aplicarModoFocadoNoPlantao = !recalculoPlenoNestePlantao;

    if (plantaoIdsRetroLote.has(Number(plantao.id))) {
      const pos = ordemAtualTec.indexOf(Number(plantao.usuarioId));
      if (pos >= 0) {
        idxOrdemTec = (pos + 1) % ordemAtualTec.length;
        idxState.idxTec = idxOrdemTec;
      }
      if (Number(plantao.vagaIndice) === 0) {
        primeiroUsuarioNoDiaTech.set(dataIso, Number(plantao.usuarioId));
      }
      continue;
    }

    if (datasRetornoAbonoFocadoProcessadosSim.has(dataIso)) {
      const pos = ordemAtualTec.indexOf(Number(plantao.usuarioId));
      if (pos >= 0) {
        idxOrdemTec = (pos + 1) % ordemAtualTec.length;
        idxState.idxTec = idxOrdemTec;
      }
      if (Number(plantao.vagaIndice) === 0) {
        primeiroUsuarioNoDiaTech.set(dataIso, Number(plantao.usuarioId));
      }
      continue;
    }

    const retornosHojeSim = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];

    if (
      aplicarModoFocadoNoPlantao &&
      Number(plantao.vagaIndice) === 0 &&
      !datasRetornoAbonoFocadoProcessadosSim.has(dataIso)
    ) {
      let uidPar = null;
      if (retornosHojeSim.length > 0) {
        const temAfastamentoAnteriorNaEscala = outrosAfastamentosSim.length > 0;
        const focalEhAbonoSim = afastamentoEhAbono(afFocadoPlainSim);
        const retornosParaPar =
          temAfastamentoAnteriorNaEscala && focalEhAbonoSim
            ? retornosHojeSim.filter((u) =>
                outrosAfastamentosSim.some(
                  (a) => Number(a.usuarioId) === Number(u) && afastamentoEhAbono(a),
                ),
              )
            : retornosHojeSim.filter((u) => Number(u) === uid);
        if (retornosParaPar.length > 0) {
          uidPar = escolherRetornoFeriasDoDia(
            retornosParaPar,
            ordemAtualTec,
            idxOrdemTec % ordemAtualTec.length,
            afastamentosPorUsuario,
            dataIso,
            datasNaoUteisIsoSet,
            new Set(),
          );
        }
      }
      if (uidPar != null) {
        const resPar = alocarParTecDiaRetornoAbonoFocalizado({
          plantoes,
          dataIso,
          usuarioAfetadoId: uidPar,
          ordemAtualTec,
          ordemGlobalTec,
          afastamentosPorUsuario,
          retornosFeriasNoPrimeiroPlantao,
          datasNaoUteisIsoSet,
        });
        if (resPar) {
          datasRetornoAbonoFocadoProcessadosSim.add(dataIso);
          ordemAtualTec = resPar.ordemAtualTec;
          ordemGlobalTec = resPar.ordemGlobalTec;
          idxOrdemTec = resPar.idxOrdemTec;
          idxState.idxTec = idxOrdemTec;
          const par0 = plantoes.find(
            (p) =>
              dataReferenciaParaStr(p.dataReferencia) === dataIso && Number(p.vagaIndice) === 0,
          );
          if (par0) primeiroUsuarioNoDiaTech.set(dataIso, Number(par0.usuarioId));
          continue;
        }
      }
    }

    const plantaoExigeRecalculoFocado =
      aplicarModoFocadoNoPlantao &&
      plantaoRequerRecalculoFocado(
        uid,
        plantao,
        dataIso,
        ordemAtualTec,
        retornosFeriasNoPrimeiroPlantao,
        afastamentosPorUsuario,
        datasNaoUteisIsoSet,
        afFocadoPlainSim,
        outrosAfastamentosSim,
        datasPlantoesTecOrdenadas,
      );
    const temAfastamentoAnteriorSim = outrosAfastamentosSim.length > 0;
    const primeiraRetornoFocSim =
      temAfastamentoAnteriorSim && fimIsoAbonoSim
        ? dataPlantaoRetornoUsuario(
            retornosFeriasNoPrimeiroPlantao,
            afFocadoPlainSim,
            datasPlantoesTecOrdenadas,
            datasNaoUteisIsoSet,
          )
        : null;
    const retornosRelevantesFocadoSim = (retornosHojeSim || []).filter((u) => {
      const uidR = Number(u);
      if (uidR === uid) {
        if (primeiraRetornoFocSim && dataIso === primeiraRetornoFocSim) return true;
        return Number(plantao.usuarioId) === uid;
      }
      return outrosAfastamentosSim.some(
        (a) => Number(a.usuarioId) === uidR && afastamentoEhAbono(a),
      );
    });
    const podePularPlantaoNoModoFocado =
      aplicarModoFocadoNoPlantao &&
      !plantaoExigeRecalculoFocado &&
      retornosRelevantesFocadoSim.length === 0;

    if (podePularPlantaoNoModoFocado) {
      const duplicataTecVaga1 =
        Number(plantao.vagaIndice) === 1 &&
        (() => {
          const u0 = primeiroUsuarioNoDiaTech.get(dataIso);
          return u0 != null && Number(plantao.usuarioId) === Number(u0);
        })();
      if (!duplicataTecVaga1) {
        const pularSemAvancarIdxAbonoTec =
          fimIsoAbonoSim && dataIso <= fimIsoAbonoSim && ordemAtualTec.includes(uid);
        if (!pularSemAvancarIdxAbonoTec) {
          const pos = ordemAtualTec.indexOf(Number(plantao.usuarioId));
          if (pos >= 0) {
            idxOrdemTec = (pos + 1) % ordemAtualTec.length;
            idxState.idxTec = idxOrdemTec;
          }
        }
        if (Number(plantao.vagaIndice) === 0) {
          primeiroUsuarioNoDiaTech.set(dataIso, Number(plantao.usuarioId));
        }
        continue;
      }
    }

    const idsExcluirMesmoDia = new Set();
    if (Number(plantao.vagaIndice) === 1) {
      const u0 = primeiroUsuarioNoDiaTech.get(dataIso);
      if (u0 != null) idsExcluirMesmoDia.add(Number(u0));
    }

    const idxPreferencial = idxOrdemTec % ordemAtualTec.length;
    const usuarioPreferencial = ordemAtualTec[idxPreferencial];
    const idxBaseBuscaSubstituto = idxPreferencial;
    const afastamentosPreferencial = afastamentosAtivosNoDia(afastamentosPorUsuario, usuarioPreferencial, dataIso);
    const preferencialBloqueadoPosFerias = usuarioBloqueadoPosFeriasOuAbonoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisIsoSet,
    );
    const preferencialBloqueadoRetroCadastro = usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisIsoSet,
    );
    let preferencialIndisponivel = usuarioIndisponivelParaPlantaoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisIsoSet,
    );
    if (idsExcluirMesmoDia.has(Number(usuarioPreferencial))) preferencialIndisponivel = true;

    let usuarioAlocado = usuarioPreferencial;
    const retornosHoje = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];
    for (const uidRaw of retornosHoje) {
      const uidRet = Number(uidRaw);
      if (!Number.isFinite(uidRet) || !ordemAtualTec.includes(uidRet)) continue;
      if (idsExcluirMesmoDia.has(uidRet)) continue;
      if (!filaRetornosFeriasPendentes.includes(uidRet)) filaRetornosFeriasPendentes.push(uidRet);
    }
    const filaRetornosParaEscolhaSim = filaRetornosFeriasPendentes;
    const temRetornoFeriasPendente =
      retornosHoje.length > 0 || filaRetornosParaEscolhaSim.length > 0;
    const retornoFeriasForcado = temRetornoFeriasPendente
      ? escolherRetornoFeriasDoDia(
          filaRetornosParaEscolhaSim,
          ordemAtualTec,
          idxPreferencial,
          afastamentosPorUsuario,
          dataIso,
          datasNaoUteisIsoSet,
          idsExcluirMesmoDia,
        )
      : null;

    if (retornoFeriasForcado != null && !idsExcluirMesmoDia.has(Number(retornoFeriasForcado))) {
      usuarioAlocado = retornoFeriasForcado;
      if (Number(usuarioAlocado) !== Number(usuarioPreferencial)) {
        ordemAtualTec = moverUsuarioAntesDeReferencia(ordemAtualTec, usuarioAlocado, usuarioPreferencial);
        ordemGlobalTec = moverUsuarioAntesDeReferencia(ordemGlobalTec, usuarioAlocado, usuarioPreferencial);
      }
      idxOrdemTec = (ordemAtualTec.indexOf(usuarioAlocado) + 1) % ordemAtualTec.length;
    } else if (preferencialIndisponivel) {
      let encontrado = null;
      for (let passo = 1; passo <= ordemAtualTec.length; passo++) {
        const candidato = ordemAtualTec[(idxBaseBuscaSubstituto + passo) % ordemAtualTec.length];
        if (idsExcluirMesmoDia.has(Number(candidato))) continue;
        const afastamentosCandidato = afastamentosAtivosNoDia(afastamentosPorUsuario, candidato, dataIso);
        const candidatoBloqueadoPosFeriasOuAbono = usuarioBloqueadoPosFeriasOuAbonoNoDia(
          afastamentosPorUsuario,
          candidato,
          dataIso,
          datasNaoUteisIsoSet,
        );
        const candidatoSomenteAtestado =
          !candidatoBloqueadoPosFeriasOuAbono &&
          afastamentosCandidato.length > 0 &&
          afastamentosCandidato.every((af) => afastamentoEhAtestado(af));
        const candidatoIndisponivelReal =
          candidatoBloqueadoPosFeriasOuAbono || (afastamentosCandidato.length > 0 && !candidatoSomenteAtestado);
        if (candidatoIndisponivelReal) continue;
        encontrado = candidato;
        break;
      }
      if (!encontrado) {
        throw new ApiBaseError(`Não há técnico disponível para o plantão em ${dataIso}.`);
      }
      usuarioAlocado = encontrado;
      const deveAlterarOrdem =
        afastamentosPreferencial.some((af) => afastamentoDeveAdiarNoCiclo(af)) ||
        preferencialBloqueadoPosFerias ||
        preferencialBloqueadoRetroCadastro;
      if (deveAlterarOrdem) {
        ordemAtualTec = moverUsuarioDepoisDaCobertura(ordemAtualTec, usuarioPreferencial, usuarioAlocado);
        ordemGlobalTec = moverUsuarioDepoisDaCobertura(ordemGlobalTec, usuarioPreferencial, usuarioAlocado);
        idxOrdemTec = (ordemAtualTec.indexOf(usuarioPreferencial) + 1) % ordemAtualTec.length;
      } else {
        idxOrdemTec = (idxPreferencial + 1) % ordemAtualTec.length;
      }
    } else {
      idxOrdemTec = (idxPreferencial + 1) % ordemAtualTec.length;
    }

    const idxFila = filaRetornosFeriasPendentes.indexOf(Number(usuarioAlocado));
    if (idxFila >= 0) filaRetornosFeriasPendentes.splice(idxFila, 1);

    plantao.usuarioId = Number(usuarioAlocado);
    if (Number(plantao.vagaIndice) === 0) {
      primeiroUsuarioNoDiaTech.set(dataIso, Number(usuarioAlocado));
      const p1 = plantoes.find(
        (p) =>
          dataReferenciaParaStr(p.dataReferencia) === dataIso && Number(p.vagaIndice) === 1,
      );
      if (p1 && Number(p1.usuarioId) === Number(usuarioAlocado)) {
        const subst = buscarProximoUsuarioDisponivelNoCiclo(
          ordemAtualTec,
          ordemAtualTec.indexOf(Number(usuarioAlocado)),
          afastamentosPorUsuario,
          dataIso,
          datasNaoUteisIsoSet,
          new Set([Number(usuarioAlocado)]),
          new Set(),
        );
        if (subst) p1.usuarioId = subst;
      }
    }
  }

  for (const [, lista] of (() => {
    const porData = new Map();
    for (const p of plantoes) {
      const ds = dataReferenciaParaStr(p.dataReferencia);
      if (!porData.has(ds)) porData.set(ds, []);
      porData.get(ds).push(p);
    }
    return porData;
  })()) {
    if (lista.length < 2) continue;
    lista.sort((a, b) => Number(a.vagaIndice) - Number(b.vagaIndice));
    const u0 = Number(lista[0].usuarioId);
    const u1 = Number(lista[1].usuarioId);
    if (u0 === u1 && Number.isFinite(u0)) {
      const dataIso = dataReferenciaParaStr(lista[1].dataReferencia);
      const encontrado = buscarProximoUsuarioDisponivelNoCiclo(
        ordemAtualTec,
        ordemAtualTec.indexOf(u0),
        afastamentosPorUsuario,
        dataIso,
        datasNaoUteisIsoSet,
        new Set([u0]),
        new Set(),
      );
      if (encontrado) lista[1].usuarioId = encontrado;
    }
  }

  const temAfastamentoAnteriorFimSim = outrosAfastamentosSim.length > 0;
  if (temAfastamentoAnteriorFimSim && fimIsoAbonoSim) {
    const afFocoAlign = { ...afFocadoPlainSim, usuarioId: uid };
    const diasAlinharPleno = new Set();
    if (afastamentoEhAbono(afFocoAlign) && ultimoDiaRetroAntesInicioSim) {
      diasAlinharPleno.add(ultimoDiaRetroAntesInicioSim);
    }
    if (afastamentoEhFerias(afFocoAlign) && inicioAfastamentoIso) {
      diasAlinharPleno.add(inicioAfastamentoIso);
    }
    const primeiraRetorno = dataPlantaoRetornoUsuario(
      retornosFeriasNoPrimeiroPlantao,
      afFocoAlign,
      datasPlantoesTecOrdenadas,
      datasNaoUteisIsoSet,
    );
    const idxRet = primeiraRetorno ? datasPlantoesTecOrdenadas.indexOf(primeiraRetorno) : -1;
    const dataSeguinte =
      idxRet >= 0 && idxRet + 1 < datasPlantoesTecOrdenadas.length
        ? datasPlantoesTecOrdenadas[idxRet + 1]
        : null;
    if (dataSeguinte) diasAlinharPleno.add(dataSeguinte);
    if (afastamentoEhFerias(afFocoAlign) && fimIsoAbonoSim) {
      for (const ds of datasPlantoesTecOrdenadas) {
        if (ds > fimIsoAbonoSim) diasAlinharPleno.add(ds);
      }
    }
    for (const dsAlinhar of diasAlinharPleno) {
      alinharParTecDiaSeguinteRetornoAbonoComRodizioPleno({
        plantoes,
        dataSeguinteIso: dsAlinhar,
        ordemInicial: ordemPlenoRef,
        afastamentosFlat,
        datasNaoUteisIsoSet,
      });
    }
  }

  const alocacoes = plantoes.map((p) => ({
    dataIso: dataReferenciaParaStr(p.dataReferencia),
    vagaIndice: Number(p.vagaIndice),
    usuarioId: Number(p.usuarioId),
  }));

  const ordemNormalizada = normalizarOrdemRodizioCompleta(ordemAtualTec, membrosRef);
  const ordemPersistida = rotacionarOrdemParaProximoPreferencial(ordemNormalizada, idxOrdemTec);
  return { ordemAtual: ordemNormalizada, idxOrdem: idxOrdemTec, ordemPersistida, alocacoes };
}

async function recalcularEscalaInterno(
  escalaId,
  {
    transaction,
    historicoMotivo = null,
    historicoAfastamento = null,
    auditoriaContexto = null,
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
  /** Junho+julho na mesma escala: rodízio contínuo, sem espelhar o 2º mês no 1º. */
  const rodizioContinuoEscala = escalaCobreNoMaximoDoisMeses(dataInicioStr, dataFimStr);

  const membros = await obterMembrosAtivosEscala(escalaId, transaction);
  const ordemAtualDbInicialVet = membros
    .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.VETERINARIO)
    .map((m) => Number(m.usuarioId))
    .filter((id) => Number.isFinite(id) && id > 0);
  const ordemAtualDbInicialTec = membros
    .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.TECNICO)
    .map((m) => Number(m.usuarioId))
    .filter((id) => Number.isFinite(id) && id > 0);

  const ordemCicloRefTec = await obterOrdemCicloReferenciaEscala(
    escalaId,
    ordemAtualDbInicialTec,
    CATEGORIA_MEMBRO.TECNICO,
    transaction,
  );
  const ordemCicloRefVet = await obterOrdemCicloReferenciaEscala(
    escalaId,
    ordemAtualDbInicialVet,
    CATEGORIA_MEMBRO.VETERINARIO,
    transaction,
  );

  let ordemAtualVet = [...ordemAtualDbInicialVet];
  let ordemAtualTec = [...ordemAtualDbInicialTec];

  const ordemGlobalDbInicialVet = await obterOrdemGlobalUsuarioIds(transaction, ESCOPO_ORDEM.VETERINARIO);
  const ordemGlobalDbInicialTec = await obterOrdemGlobalUsuarioIds(transaction, ESCOPO_ORDEM.TECNICO);
  let ordemGlobalVet = [...ordemGlobalDbInicialVet];
  let ordemGlobalTec = [...ordemGlobalDbInicialTec];

  const idsMembrosUniao = [...new Set([...ordemAtualDbInicialVet, ...ordemAtualDbInicialTec])];

  /** Inclui datas extras, desfazer afastamento, e afastamento sem bootstrap `maisTarde`. */
  let usarHistoricoInicialRodizio = skipBootstrap || historicoMotivo === 'apos_desfazer_afastamento';
  /** Com afastamentos anteriores: não re-simular do `inicial`; recálculo focalizado no servidor atual. */
  let preservarPlantoesAntesDe = null;
  let recalcComAfastamentosAnteriores = false;

  /**
   * Ao recalcular por um afastamento A com fim em D, afastamentos já cadastrados com início > D
   * (ex.: Ana em junho quando se recalcula Bruno em maio) já alteraram ordem global/membro na BD.
   * Para simular o tempo de forma coerente, inicia-se a partir dos snapshots "antes" do afastamento
   * posterior mais cedo no calendário (efeitos de junho ainda não aplicados ao simular maio).
   * Se **não** existir esse "mais tarde", não se deve usar `membros` como início do rodízio — usa-se o histórico `inicial`.
   */
  if (historicoMotivo === 'afastamento' && historicoAfastamento) {
    const afFimRef = dataReferenciaParaStr(historicoAfastamento.dataFim);
    const afInicioRef = dataReferenciaParaStr(historicoAfastamento.dataInicio);
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
    /**
     * Bootstrap "antes" do afastamento com início depois do fim deste só quando nenhum outro afastamento
     * já alterou a mesma janela (ex.: maio vs férias em junho). Com Ana + Felipe já em junho e novo abono
     * da Elisa em 15/06, não voltar ao snapshot anterior ao Felipe (22) — isso re-simulava junho inteiro
     * e corrompia a ordem (ex.: BCDFEGAF sem H).
     */
    const algumOutroSobrepostoAoPeriodoAtual = outros.some((a) => {
      const oIni = dataReferenciaParaStr(a.dataInicio);
      const oFim = dataReferenciaParaStr(a.dataFim);
      return oIni <= afFimRef && oFim >= afInicioRef;
    });
    const podeBootstrapAntesMaisTarde = maisTarde.length > 0 && !algumOutroSobrepostoAoPeriodoAtual;
    if (podeBootstrapAntesMaisTarde) {
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
    } else if (outros.length > 0) {
      if (afastamentoExigeRecalculoPlenoComHistoricoInicial(afInicioRef, outros)) {
        /**
         * Ex.: Bruno 05–12/06 cadastrado após Ana/Elisa/Felipe — início mais cedo no calendário.
         * Reprocessa todos os plantões (não focalizado), mas mantém a fila já gravada na escala
         * (ex.: BCDGEHFA após 3 afastamentos). Voltar ao histórico `inicial` (ABCDEFGH) e simular
         * os quatro afastamentos de uma vez gera plantões de junho CDEFBEAF em vez de CDGH…
         */
        usarHistoricoInicialRodizio = outros.length === 0;
        recalcComAfastamentosAnteriores = false;
      } else {
        /**
         * Já existe afastamento anterior (ex.: férias da Ana). Re-simular desde o histórico `inicial`
         * desfaz o rodízio pós-recálculo e ignora retroativo do novo abono/férias (Felipe no dia 20).
         * Continua da ordem registrada no último afastamento e só reprocessa plantões a partir da janela retroativa.
         */
        usarHistoricoInicialRodizio = false;
        recalcComAfastamentosAnteriores = true;
        const porFimDesc = [...outros].sort((a, b) => {
          const cmpFim = dataReferenciaParaStr(b.dataFim).localeCompare(dataReferenciaParaStr(a.dataFim));
          if (cmpFim !== 0) return cmpFim;
          return dataReferenciaParaStr(b.dataInicio).localeCompare(dataReferenciaParaStr(a.dataInicio));
        });
        for (const outro of porFimDesc) {
          const catOutro =
            (await escopoOrdemGlobalParaUsuarioId(outro.usuarioId, transaction)) === ESCOPO_ORDEM.TECNICO
              ? CATEGORIA_MEMBRO.TECNICO
              : CATEGORIA_MEMBRO.VETERINARIO;
          const histOutro = await buscarHistoricoOrdemParaAfastamento(escalaId, outro.id, catOutro, transaction);
          if (!histOutro) continue;
          const plainOutro = histOutro.get ? histOutro.get({ plain: true }) : histOutro;
          const idsDepois = Array.isArray(plainOutro.ordemUsuarioIds)
            ? plainOutro.ordemUsuarioIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
            : [];
          if (idsDepois.length === 0) continue;
          if (catOutro === CATEGORIA_MEMBRO.TECNICO) ordemAtualTec = idsDepois;
          else ordemAtualVet = idsDepois;
          break;
        }
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

  let aplicouOrdemInicialVet = false;
  let aplicouOrdemInicialTec = false;
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
      const aplicada = aplicarOrdemInicialHistoricoRodizio(idsInicial, alvoIds);
      if (aplicada) {
        if (cat === CATEGORIA_MEMBRO.TECNICO) {
          ordemAtualTec = aplicada;
          aplicouOrdemInicialTec = true;
        } else {
          ordemAtualVet = aplicada;
          aplicouOrdemInicialVet = true;
        }
      }
      if (Array.isArray(plain.ordemGlobalUsuarioIds) && plain.ordemGlobalUsuarioIds.length > 0) {
        const og = normalizarOrdemRodizioCompleta(
          plain.ordemGlobalUsuarioIds.map((x) => Number(x)),
          cat === CATEGORIA_MEMBRO.TECNICO ? ordemGlobalDbInicialTec : ordemGlobalDbInicialVet,
        );
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
      { model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login', 'suspensoEscala'] },
    ],
    transaction,
  });
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
  const categoriaPorUsuarioIdRetorno = new Map();
  for (const id of ordemAtualVet) {
    categoriaPorUsuarioIdRetorno.set(Number(id), CATEGORIA_PLANTAO.VETERINARIO);
  }
  for (const id of ordemAtualTec) {
    categoriaPorUsuarioIdRetorno.set(Number(id), CATEGORIA_PLANTAO.TECNICO);
  }

  const ordemVetParaFiltroAfastamento =
    ordemCicloRefVet.length > 0
      ? [...ordemCicloRefVet]
      : aplicouOrdemInicialVet
        ? [...ordemAtualVet]
        : [...ordemAtualDbInicialVet];
  const ordemTecParaFiltroAfastamento =
    ordemCicloRefTec.length > 0
      ? [...ordemCicloRefTec]
      : aplicouOrdemInicialTec
        ? [...ordemAtualTec]
        : [...ordemAtualDbInicialTec];
  const paramsFiltroAfastamento = montarParametrosFiltroAfastamentoPlantoes({
    plantoes,
    ordemVetInicial: ordemVetParaFiltroAfastamento,
    ordemTecInicial: ordemTecParaFiltroAfastamento,
    afastamentosLista: (afastamentos || []).map((a) => (a.get ? a.get({ plain: true }) : a)),
    periodicidadeEscala: escala.periodicidade,
    categoriaPorUsuarioId: categoriaPorUsuarioIdRetorno,
  });
  const afastamentosRodizio = afastamentosListaParaRodizioEscala(afastamentos, paramsFiltroAfastamento);
  const afastamentosPlainRodizio = afastamentosRodizio.map((a) => (a.get ? a.get({ plain: true }) : a));

  if (historicoMotivo === 'afastamento' && historicoAfastamento) {
    const afFocadoIrrelevante = historicoAfastamento.get
      ? historicoAfastamento.get({ plain: true })
      : historicoAfastamento;
    if (
      (afastamentoEhFerias(afFocadoIrrelevante) || afastamentoEhAbono(afFocadoIrrelevante)) &&
      afastamentoFeriasOuAbonoRedundanteNoCalendario(afFocadoIrrelevante, paramsFiltroAfastamento)
    ) {
      return {
        atualizados: 0,
        ordemMudou: false,
        ordemUsuarioIds: [...ordemAtualVet, ...ordemAtualTec],
        ordemAtualVet,
        ordemAtualTec,
        ordemInicialVet: ordemAtualDbInicialVet,
        ordemInicialTec: ordemAtualDbInicialTec,
        ordemGlobalMudou: false,
      };
    }
  }

  const afastamentosPorUsuario = montarAfastamentosPorUsuario(afastamentosRodizio);

  const retornosFeriasNoPrimeiroPlantao = montarRetornosFeriasNoPrimeiroPlantao(
    afastamentosRodizio,
    plantoes,
    datasNaoUteisParaRetornoPosAfastamento,
    categoriaPorUsuarioIdRetorno,
  );
  const datasPlantoesVetOrdenadas = [
    ...new Set(
      plantoes
        .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO)
        .map((p) => dataReferenciaParaStr(p.dataReferencia))
        .filter(Boolean),
    ),
  ].sort();
  const datasPlantoesTecOrdenadas = [
    ...new Set(
      plantoes
        .filter((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO)
        .map((p) => dataReferenciaParaStr(p.dataReferencia))
        .filter(Boolean),
    ),
  ].sort();
  /** Retornos de férias já vencidos e ainda não alocados (empates no mesmo dia, indisponibilidade etc.). */
  const filaRetornosFeriasPendentes = [];

  const primeiroUsuarioNoDiaTech = new Map();

  const modoRecalculoFocado = Boolean(
    recalcComAfastamentosAnteriores && historicoMotivo === 'afastamento' && historicoAfastamento,
  );
  let usuarioAfetadoRecalculoId = null;
  /**
   * Com afastamento anterior + novo (ex.: Ana depois abono Felipe em 22/06): plantões fora do foco
   * são pulados em junho para não mexer em dias de outros servidores. A partir do 1º dia do mês
   * seguinte ao fim do afastamento atual, re-simula o rodízio inteiro (ex.: julho alinhado a junho).
   */
  let dataLimitePuloFocado = null;
  let idxSincronizadoParaMesSeguinte = false;
  let afFocadoPlain = null;
  let fimIsoAbonoFocado = null;
  /** Abono com limite 01/08 quando anteriores pararam em 01/07 (ex.: Elisa); não quando limite repete (ex.: Daniel após Ana). */
  let limiteMesNovoAposAnterioresVet = false;
  if (modoRecalculoFocado) {
    const afFocado = historicoAfastamento.get ? historicoAfastamento.get({ plain: true }) : historicoAfastamento;
    afFocadoPlain = afFocado;
    const uidFocado = Number(afFocado.usuarioId);
    if (Number.isFinite(uidFocado) && uidFocado > 0) usuarioAfetadoRecalculoId = uidFocado;
    const fimAfIso = dataReferenciaParaStr(afFocado.dataFim);
    if (fimAfIso) {
      fimIsoAbonoFocado = fimAfIso;
      if (!rodizioContinuoEscala) {
        dataLimitePuloFocado = primeiroDiaMesSeguinte(fimAfIso);
      }
    }
  }
  const idxState = { idxVet: 0, idxTec: 0 };

  if (plantoes.some((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO) && ordemAtualDbInicialVet.length === 0) {
    throw new ApiBaseError('Escala sem veterinários no rodízio para os plantões de veterinário.');
  }
  if (plantoes.some((p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO) && ordemAtualDbInicialTec.length === 0) {
    throw new ApiBaseError('Escala sem técnicos no rodízio para os plantões de técnico.');
  }

  let idxOrdemVet = 0;
  let idxOrdemTec = 0;

  if (usarHistoricoInicialRodizio) {
    if (!aplicouOrdemInicialVet && ordemAtualDbInicialVet.length > 0) {
      ordemAtualVet = await ordemMembrosEscalaPorNomeAlfabetico(ordemAtualDbInicialVet, transaction);
    }
    if (!aplicouOrdemInicialTec && ordemAtualDbInicialTec.length > 0) {
      ordemAtualTec = await ordemMembrosEscalaPorNomeAlfabetico(ordemAtualDbInicialTec, transaction);
    }
    idxOrdemVet = 0;
    idxOrdemTec = 0;
    idxState.idxVet = 0;
    idxState.idxTec = 0;
  }

  const outrosAfastamentosFocado =
    modoRecalculoFocado && historicoAfastamento
      ? afastamentosRodizio
          .filter((a) => Number(a.id) !== Number(historicoAfastamento.id))
          .map((a) => (a.get ? a.get({ plain: true }) : a))
      : [];

  if (
    modoRecalculoFocado &&
    afFocadoPlain &&
    afastamentoEhAbono(afFocadoPlain) &&
    outrosAfastamentosFocado.length > 0 &&
    dataLimitePuloFocado
  ) {
    limiteMesNovoAposAnterioresVet = !outrosAfastamentosFocado.some((a) => {
      const fimO = dataReferenciaParaStr(a.dataFim);
      return fimO && primeiroDiaMesSeguinte(fimO) === dataLimitePuloFocado;
    });
  }

  if (modoRecalculoFocado && usuarioAfetadoRecalculoId != null) {
    const datasRelevantes = plantoes
      .filter((p) => {
        const cat = categoriaPlantaoDe(p);
        const ordem = cat === CATEGORIA_PLANTAO.TECNICO ? ordemAtualTec : ordemAtualVet;
        return plantaoRequerRecalculoFocado(
          usuarioAfetadoRecalculoId,
          p,
          dataReferenciaParaStr(p.dataReferencia),
          ordem,
          retornosFeriasNoPrimeiroPlantao,
          afastamentosPorUsuario,
          datasNaoUteisParaRetornoPosAfastamento,
          historicoAfastamento,
          outrosAfastamentosFocado,
          cat === CATEGORIA_PLANTAO.TECNICO ? datasPlantoesTecOrdenadas : datasPlantoesVetOrdenadas,
        );
      })
      .map((p) => dataReferenciaParaStr(p.dataReferencia))
      .filter((ds) => !!ds)
      .sort();
    const primeiraDataRelevante = datasRelevantes[0];
    if (primeiraDataRelevante) {
      /**
       * Isolamento entre categorias: a sincronização de `idxOrdem` deve atualizar apenas o
       * índice da categoria do titular focado. Se o focado é técnico (ex.: férias do Fábio),
       * sincronizar `idxOrdemVet` aqui faria a rotação final (logo abaixo do loop principal)
       * embaralhar a ordem vet sem que nenhum plantão vet tenha sido reprocessado.
       */
      const focadoEhVet = ordemAtualDbInicialVet.includes(Number(usuarioAfetadoRecalculoId));
      const focadoEhTec = ordemAtualDbInicialTec.includes(Number(usuarioAfetadoRecalculoId));
      const semCategoriaFocada = !focadoEhVet && !focadoEhTec;
      const idxSync = sincronizarIdxOrdemDePlantoes(
        plantoes,
        focadoEhVet || semCategoriaFocada ? ordemAtualVet : [],
        focadoEhTec || semCategoriaFocada ? ordemAtualTec : [],
        primeiraDataRelevante,
      );
      if (focadoEhVet || semCategoriaFocada) {
        idxOrdemVet = idxSync.idxVet;
        idxState.idxVet = idxOrdemVet;
      }
      if (focadoEhTec || semCategoriaFocada) {
        idxOrdemTec = idxSync.idxTec;
        idxState.idxTec = idxOrdemTec;
      }
    }
  }
  let atualizados = 0;
  const plantaoIdsRetroLote = new Set();
  const datasRetornoAbonoFocadoProcessados = new Set();
  const plantaoIdsMesSeguinteLote = new Set();

  if (modoRecalculoFocado && usuarioAfetadoRecalculoId != null && historicoAfastamento) {
    const afFocLote = historicoAfastamento.get ? historicoAfastamento.get({ plain: true }) : historicoAfastamento;
    const inicioIsoLote = dataReferenciaParaStr(afFocLote.dataInicio);
    if (
      inicioIsoLote &&
      (afastamentoEhFerias(afFocLote) || afastamentoEhAbono(afFocLote))
    ) {
      const escopoAf = await escopoOrdemGlobalParaUsuarioId(usuarioAfetadoRecalculoId, transaction);
      const catLote =
        escopoAf === ESCOPO_ORDEM.TECNICO ? CATEGORIA_PLANTAO.TECNICO : CATEGORIA_PLANTAO.VETERINARIO;
      const rotuloLote = catLote === CATEGORIA_PLANTAO.TECNICO ? 'Técnico' : 'Veterinário';
      const ordemLote = catLote === CATEGORIA_PLANTAO.TECNICO ? ordemAtualTec : ordemAtualVet;
      const ogLote = catLote === CATEGORIA_PLANTAO.TECNICO ? ordemGlobalTec : ordemGlobalVet;
      const idxLote = catLote === CATEGORIA_PLANTAO.TECNICO ? idxOrdemTec : idxOrdemVet;
      if (ordemLote.length > 0) {
        const lote = await processarRetroativoFocadoEmLote({
          plantoes,
          usuarioAfetadoId: usuarioAfetadoRecalculoId,
          inicioAfastamentoIso: inicioIsoLote,
          categoriaPlantaoAlvo: catLote,
          ordemAtual: ordemLote,
          ordemGlobal: ogLote,
          idxInicial: idxLote,
          afastamentosPorUsuario,
          datasNaoUteisIsoSet: datasNaoUteisParaRetornoPosAfastamento,
          transaction,
          rotuloProfissional: rotuloLote,
          historicoAfastamento,
        });
        if (catLote === CATEGORIA_PLANTAO.TECNICO) {
          ordemAtualTec = lote.ordemAtual;
          ordemGlobalTec = lote.ordemGlobal;
          idxOrdemTec = lote.idxOrdem;
          idxState.idxTec = idxOrdemTec;
        } else {
          ordemAtualVet = lote.ordemAtual;
          ordemGlobalVet = lote.ordemGlobal;
          idxOrdemVet = lote.idxOrdem;
          idxState.idxVet = idxOrdemVet;
        }
        atualizados += lote.atualizados;
        for (const id of lote.idsProcessados) plantaoIdsRetroLote.add(id);
      }
    }
  }

  /**
   * Isolamento entre categorias: quando o afastamento focado pertence claramente a uma
   * categoria (vet xor téc), plantões da OUTRA categoria não devem ser reprocessados.
   * Vale tanto para o fluxo "geral" (a fila gravada nos membros pode estar desalinhada
   * com o calendário por sincronizações prévias e re-simular gera datas erradas), quanto
   * para o modo focado (loop principal poderia avançar `idxOrdem` da categoria oposta e
   * a rotação final pós-loop embaralharia a ordem dela sem motivo — ex.: férias téc do
   * Fábio rotacionando indevidamente a ordem dos veterinários).
   */
  const usuarioIdFocadoIsolamento =
    historicoMotivo === 'afastamento' && historicoAfastamento
      ? Number(
          (historicoAfastamento.get && historicoAfastamento.get({ plain: true })?.usuarioId) ??
            historicoAfastamento.usuarioId,
        )
      : null;
  const afastamentoFocadoEhVet =
    Number.isFinite(usuarioIdFocadoIsolamento) &&
    ordemAtualDbInicialVet.includes(usuarioIdFocadoIsolamento);
  const afastamentoFocadoEhTec =
    Number.isFinite(usuarioIdFocadoIsolamento) &&
    ordemAtualDbInicialTec.includes(usuarioIdFocadoIsolamento);
  const isolarCategoriaOposta =
    afastamentoFocadoEhVet !== afastamentoFocadoEhTec;
  const categoriaPreservadaIsolamento = isolarCategoriaOposta
    ? (afastamentoFocadoEhTec ? CATEGORIA_PLANTAO.VETERINARIO : CATEGORIA_PLANTAO.TECNICO)
    : null;

  for (const plantao of plantoes) {
    const dataIso = dataReferenciaParaStr(plantao.dataReferencia);
    const catPlantao = categoriaPlantaoDe(plantao);

    if (isolarCategoriaOposta && catPlantao === categoriaPreservadaIsolamento) {
      continue;
    }

    let ordemAtual = catPlantao === CATEGORIA_PLANTAO.TECNICO ? ordemAtualTec : ordemAtualVet;
    let ordemGlobal = catPlantao === CATEGORIA_PLANTAO.TECNICO ? ordemGlobalTec : ordemGlobalVet;
    let idxOrdem = catPlantao === CATEGORIA_PLANTAO.TECNICO ? idxOrdemTec : idxOrdemVet;

    const rotuloProfissional = catPlantao === CATEGORIA_PLANTAO.TECNICO ? 'Técnico' : 'Veterinário';
    const msgSemServidor = `Não há ${rotuloProfissional.toLowerCase()} disponível para o plantão`;

    if (!ordemAtual.length) continue;

    /** Recálculo pleno no mês seguinte só quando junho foi “pulado” (modo focalizado). Recálculo do `inicial` simula tudo seguido. */
    const recalculoPlenoNestePlantao = Boolean(
      modoRecalculoFocado && dataLimitePuloFocado && dataIso >= dataLimitePuloFocado,
    );

    if (recalculoPlenoNestePlantao && !idxSincronizadoParaMesSeguinte) {
      filaRetornosFeriasPendentes.length = 0;
      primeiroUsuarioNoDiaTech.clear();
      const ordemRefCicloTec = normalizarOrdemRodizioCompleta(
        ordemAtualDbInicialTec.length ? ordemAtualDbInicialTec : ordemAtualTec,
        ordemAtualTec,
      );
      const resEspelho = await espelharPlantoesTecMesSeguinteFocado({
        plantoes,
        dataLimiteIso: dataLimitePuloFocado,
        transaction,
      });
      for (const id of resEspelho.idsProcessados) plantaoIdsMesSeguinteLote.add(id);
      atualizados += resEspelho.atualizados;
      const resEspelhoVet = await espelharPlantoesVetMesSeguinteFocado({
        plantoes,
        dataLimiteIso: dataLimitePuloFocado,
        transaction,
      });
      for (const id of resEspelhoVet.idsProcessados) plantaoIdsMesSeguinteLote.add(id);
      atualizados += resEspelhoVet.atualizados;
      const idxVetMesAnterior = obterIdxRodizioAposUltimoPlantaoAntesDe(
        plantoes,
        ordemAtualVet,
        dataLimitePuloFocado,
        CATEGORIA_PLANTAO.VETERINARIO,
      );
      ordemAtualVet = rotacionarOrdemParaProximoPreferencial(ordemAtualVet, idxVetMesAnterior);
      ordemGlobalVet = rotacionarOrdemParaProximoPreferencial(ordemGlobalVet, idxVetMesAnterior);
      idxOrdemVet = idxVetMesAnterior;
      idxState.idxVet = idxOrdemVet;
      const idxTecMesAnterior = obterIdxRodizioAposUltimoPlantaoAntesDe(
        plantoes,
        ordemAtualTec,
        dataLimitePuloFocado,
        CATEGORIA_PLANTAO.TECNICO,
        ordemRefCicloTec,
      );
      ordemAtualTec = rotacionarOrdemParaProximoPreferencial(ordemAtualTec, idxTecMesAnterior);
      ordemGlobalTec = [...ordemAtualTec];
      idxOrdemTec = 0;
      idxState.idxTec = 0;
      idxSincronizadoParaMesSeguinte = true;
      if (catPlantao === CATEGORIA_PLANTAO.TECNICO) {
        ordemAtual = ordemAtualTec;
        ordemGlobal = ordemGlobalTec;
        idxOrdem = idxOrdemTec;
      } else {
        ordemAtual = ordemAtualVet;
        ordemGlobal = ordemGlobalVet;
        idxOrdem = idxOrdemVet;
      }
    }

    const aplicarModoFocadoNoPlantao = modoRecalculoFocado && !recalculoPlenoNestePlantao;

    if (plantaoIdsRetroLote.has(Number(plantao.id))) {
      avancarIdxOrdemAPartirDoPlantao(plantao, ordemAtual, catPlantao, idxState);
      if (catPlantao === CATEGORIA_PLANTAO.TECNICO) idxOrdemTec = idxState.idxTec;
      else idxOrdemVet = idxState.idxVet;
      if (catPlantao === CATEGORIA_PLANTAO.TECNICO && Number(plantao.vagaIndice) === 0) {
        const uid0 = Number(plantao.usuarioId);
        if (Number.isFinite(uid0) && uid0 > 0) {
          primeiroUsuarioNoDiaTech.set(dataIso, uid0);
        }
      }
      continue;
    }

    if (plantaoIdsMesSeguinteLote.has(Number(plantao.id))) {
      avancarIdxOrdemAPartirDoPlantao(plantao, ordemAtual, catPlantao, idxState);
      if (catPlantao === CATEGORIA_PLANTAO.TECNICO) idxOrdemTec = idxState.idxTec;
      else idxOrdemVet = idxState.idxVet;
      if (catPlantao === CATEGORIA_PLANTAO.TECNICO && Number(plantao.vagaIndice) === 0) {
        const uid0 = Number(plantao.usuarioId);
        if (Number.isFinite(uid0) && uid0 > 0) {
          primeiroUsuarioNoDiaTech.set(dataIso, uid0);
        }
      }
      continue;
    }

    if (
      catPlantao === CATEGORIA_PLANTAO.TECNICO &&
      datasRetornoAbonoFocadoProcessados.has(dataIso)
    ) {
      avancarIdxOrdemAPartirDoPlantao(plantao, ordemAtual, catPlantao, idxState);
      idxOrdemTec = idxState.idxTec;
      if (Number(plantao.vagaIndice) === 0) {
        const uid0 = Number(plantao.usuarioId);
        if (Number.isFinite(uid0) && uid0 > 0) {
          primeiroUsuarioNoDiaTech.set(dataIso, uid0);
        }
      }
      continue;
    }

    /**
     * Técnicos (AABB): dia com retorno no mapa (ex.: Diego no 20 após 3º abono Fábio) realoca o par
     * inteiro de uma vez — evita vaga 1 errada (HE) por fila/loop vaga a vaga.
     */
    if (
      catPlantao === CATEGORIA_PLANTAO.TECNICO &&
      aplicarModoFocadoNoPlantao &&
      Number(plantao.vagaIndice) === 0 &&
      !datasRetornoAbonoFocadoProcessados.has(dataIso)
    ) {
      const retornosDiaTec = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];
      let uidPar = null;
      if (retornosDiaTec.length > 0) {
        const temAfastamentoAnteriorNaEscala = outrosAfastamentosFocado.length > 0;
        const uidFocadoPar = Number(usuarioAfetadoRecalculoId);
        const focalEhAbonoPar = afFocadoPlain && afastamentoEhAbono(afFocadoPlain);
        const retornosParaPar =
          temAfastamentoAnteriorNaEscala && focalEhAbonoPar
            ? retornosDiaTec.filter((u) =>
                outrosAfastamentosFocado.some(
                  (a) => Number(a.usuarioId) === Number(u) && afastamentoEhAbono(a),
                ),
              )
            : retornosDiaTec.filter((u) => Number(u) === uidFocadoPar);
        if (retornosParaPar.length > 0) {
          uidPar = escolherRetornoFeriasDoDia(
            retornosParaPar,
            ordemAtualTec,
            idxOrdemTec % ordemAtualTec.length,
            afastamentosPorUsuario,
            dataIso,
            datasNaoUteisParaRetornoPosAfastamento,
            new Set(),
          );
        }
      }
      if (uidPar != null) {
        const resPar = alocarParTecDiaRetornoAbonoFocalizado({
          plantoes,
          dataIso,
          usuarioAfetadoId: uidPar,
          ordemAtualTec,
          ordemGlobalTec,
          afastamentosPorUsuario,
          retornosFeriasNoPrimeiroPlantao,
          datasNaoUteisIsoSet: datasNaoUteisParaRetornoPosAfastamento,
        });
        if (resPar) {
          datasRetornoAbonoFocadoProcessados.add(dataIso);
          ordemAtualTec = resPar.ordemAtualTec;
          ordemGlobalTec = resPar.ordemGlobalTec;
          idxOrdemTec = resPar.idxOrdemTec;
          idxState.idxTec = idxOrdemTec;
          ordemAtual = ordemAtualTec;
          ordemGlobal = ordemGlobalTec;
          idxOrdem = idxOrdemTec;
          const par0 = plantoes.find(
            (p) =>
              categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO &&
              dataReferenciaParaStr(p.dataReferencia) === dataIso &&
              Number(p.vagaIndice) === 0,
          );
          if (par0) primeiroUsuarioNoDiaTech.set(dataIso, Number(par0.usuarioId));
          for (const idProc of resPar.idsProcessados) {
            const pl = plantoes.find((p) => Number(p.id) === Number(idProc));
            if (pl && typeof pl.save === 'function') {
              await pl.save({ transaction });
            }
          }
          atualizados += resPar.atualizados;
          continue;
        }
      }
    }

    const retornosHojeFocado = retornosFeriasNoPrimeiroPlantao.get(dataIso) || [];
    const vetDuplicataFimDeSemanaAnterior =
      catPlantao === CATEGORIA_PLANTAO.VETERINARIO &&
      plantaoVetMesmaPessoaNoFimDeSemanaAnterior(plantoes, plantao);

    const plantaoExigeRecalculoFocado =
      aplicarModoFocadoNoPlantao &&
      usuarioAfetadoRecalculoId != null &&
      (vetDuplicataFimDeSemanaAnterior ||
        plantaoRequerRecalculoFocado(
          usuarioAfetadoRecalculoId,
          plantao,
          dataIso,
          ordemAtual,
          retornosFeriasNoPrimeiroPlantao,
          afastamentosPorUsuario,
          datasNaoUteisParaRetornoPosAfastamento,
          historicoAfastamento,
          outrosAfastamentosFocado,
          catPlantao === CATEGORIA_PLANTAO.TECNICO ? datasPlantoesTecOrdenadas : datasPlantoesVetOrdenadas,
        ));

    /**
     * Não pular: dias com retorno no mapa (ex.: Daniel no 20) — só enfileirar deixava a fila
     * suja e o domingo seguinte herdava o mesmo titular (D21). Nem duplicata D20/D21.
     */
    const temAfastamentoAnteriorNoFoco = outrosAfastamentosFocado.length > 0;
    const primeiraRetornoFocApi =
      temAfastamentoAnteriorNoFoco &&
      afFocadoPlain &&
      (afastamentoEhAbono(afFocadoPlain) || afastamentoEhFerias(afFocadoPlain)) &&
      fimIsoAbonoFocado
        ? dataPlantaoRetornoUsuario(
            retornosFeriasNoPrimeiroPlantao,
            afFocadoPlain,
            datasPlantoesTecOrdenadas,
            datasNaoUteisParaRetornoPosAfastamento,
          )
        : null;
    const retornosRelevantesFocado = (retornosHojeFocado || []).filter((u) => {
      const uidR = Number(u);
      /**
       * Isolamento entre categorias: o mapa de retornos é compartilhado vet+téc; se o usuário
       * do retorno não pertence à ordem da categoria do plantão atual, ignorar para não impedir
       * o pulo do plantão (ex.: abono téc Álvaro 18/06 não pode bloquear o pulo em plantão vet).
       */
      if (!ordemAtual.includes(uidR)) return false;
      const uidFoc = Number(usuarioAfetadoRecalculoId);
      if (uidR === uidFoc) {
        if (primeiraRetornoFocApi && dataIso === primeiraRetornoFocApi) return true;
        return Number(plantao.usuarioId) === uidR;
      }
      return outrosAfastamentosFocado.some(
        (a) => Number(a.usuarioId) === uidR && afastamentoEhAbono(a),
      );
    });
    /**
     * Abono vet com limite em mês novo (ex.: Elisa 10/07 → 01/08 após afastamentos com limite 01/07):
     * julho já espelhado; o loop focalizado corrompe fins de semana — só realinha via pleno no fim.
     * Não aplicar quando o limite repete o dos anteriores (ex.: Daniel 12/06 após Ana → 01/07): junho
     * ainda precisa do recálculo focal antes de espelhar julho.
     */
    const inicioIsoAbonoFocadoLoop = afFocadoPlain
      ? dataReferenciaParaStr(afFocadoPlain.dataInicio)
      : null;
    const vetAbonoPreservarMesParaPleno =
      aplicarModoFocadoNoPlantao &&
      catPlantao === CATEGORIA_PLANTAO.VETERINARIO &&
      afFocadoPlain &&
      afastamentoEhAbono(afFocadoPlain) &&
      temAfastamentoAnteriorNoFoco &&
      limiteMesNovoAposAnterioresVet &&
      dataLimitePuloFocado &&
      fimIsoAbonoFocado &&
      inicioIsoAbonoFocadoLoop &&
      mesIsoDeDataReferencia(dataIso) === mesIsoDeDataReferencia(inicioIsoAbonoFocadoLoop) &&
      dataIso > fimIsoAbonoFocado &&
      dataIso < dataLimitePuloFocado;
    const podePularPlantaoNoModoFocado =
      aplicarModoFocadoNoPlantao &&
      usuarioAfetadoRecalculoId != null &&
      (vetAbonoPreservarMesParaPleno ||
        (!plantaoExigeRecalculoFocado && retornosRelevantesFocado.length === 0));

    if (podePularPlantaoNoModoFocado) {
      const duplicataTecVaga1 =
        catPlantao === CATEGORIA_PLANTAO.TECNICO &&
        Number(plantao.vagaIndice) === 1 &&
        (() => {
          const u0 = primeiroUsuarioNoDiaTech.get(dataIso);
          return u0 != null && Number(plantao.usuarioId) === Number(u0);
        })();
      if (!duplicataTecVaga1) {
      const idsExcluirRetornoSkip = new Set();
      if (catPlantao === CATEGORIA_PLANTAO.TECNICO && Number(plantao.vagaIndice) === 1) {
        const u0 = primeiroUsuarioNoDiaTech.get(dataIso);
        if (u0 != null) idsExcluirRetornoSkip.add(Number(u0));
      }
      enfileirarRetornosFeriasDoDia(
        dataIso,
        ordemAtual,
        retornosFeriasNoPrimeiroPlantao,
        afastamentosPorUsuario,
        datasNaoUteisParaRetornoPosAfastamento,
        filaRetornosFeriasPendentes,
        idsExcluirRetornoSkip,
      );
      const pularSemAvancarIdxAbonoTec =
        afFocadoPlain &&
        afastamentoEhAbono(afFocadoPlain) &&
        catPlantao === CATEGORIA_PLANTAO.TECNICO &&
        ordemAtualTec.includes(Number(usuarioAfetadoRecalculoId)) &&
        fimIsoAbonoFocado &&
        dataIso <= fimIsoAbonoFocado;
      if (!pularSemAvancarIdxAbonoTec) {
        avancarIdxOrdemAPartirDoPlantao(plantao, ordemAtual, catPlantao, idxState);
        if (catPlantao === CATEGORIA_PLANTAO.TECNICO) idxOrdemTec = idxState.idxTec;
        else idxOrdemVet = idxState.idxVet;
      }
      if (catPlantao === CATEGORIA_PLANTAO.TECNICO && Number(plantao.vagaIndice) === 0) {
        const uid0 = Number(plantao.usuarioId);
        if (Number.isFinite(uid0) && uid0 > 0) {
          primeiroUsuarioNoDiaTech.set(dataIso, uid0);
        }
      }
      continue;
      }
    }

    let observacaoPlantao = null;

    const idsExcluirMesmoDia = new Set();
    if (catPlantao === CATEGORIA_PLANTAO.TECNICO && Number(plantao.vagaIndice) === 1) {
      const u0 = primeiroUsuarioNoDiaTech.get(dataIso);
      if (u0 != null) idsExcluirMesmoDia.add(Number(u0));
    }

    let idxPreferencial = idxOrdem % ordemAtual.length;
    let usuarioPreferencial = ordemAtual[idxPreferencial];
    /** Base da busca por substituto (pode diferir do preferencial em retroativo focalizado). */
    let idxBaseBuscaSubstituto = idxPreferencial;
    let titularIndisponivelNoPlantao = null;
    const afFocAloc = historicoAfastamento
      ? historicoAfastamento.get
        ? historicoAfastamento.get({ plain: true })
        : historicoAfastamento
      : null;
    const inicioAfIsoAloc = afFocAloc ? dataReferenciaParaStr(afFocAloc.dataInicio) : null;
    const retroVetAbonoAfetado =
      aplicarModoFocadoNoPlantao &&
      catPlantao === CATEGORIA_PLANTAO.VETERINARIO &&
      afFocAloc &&
      afastamentoEhAbono(afFocAloc) &&
      usuarioAfetadoRecalculoId != null &&
      inicioAfIsoAloc &&
      dataIso < inicioAfIsoAloc &&
      Number(plantao.usuarioId) === usuarioAfetadoRecalculoId &&
      usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(
        afastamentosPorUsuario,
        usuarioAfetadoRecalculoId,
        dataIso,
        datasNaoUteisParaRetornoPosAfastamento,
      );
    if (
      aplicarModoFocadoNoPlantao &&
      usuarioAfetadoRecalculoId != null &&
      (retroVetAbonoAfetado || Number(plantao.usuarioId) === usuarioAfetadoRecalculoId) &&
      !(afFocadoPlain && afastamentoEhAbono(afFocadoPlain) && catPlantao === CATEGORIA_PLANTAO.TECNICO)
    ) {
      const posAfetado = ordemAtual.indexOf(usuarioAfetadoRecalculoId);
      if (posAfetado >= 0) {
        usuarioPreferencial = usuarioAfetadoRecalculoId;
        idxPreferencial = posAfetado;
        const retroTitular = retroVetAbonoAfetado;
        const indisponivelNoDia = usuarioIndisponivelParaPlantaoNoDia(
          afastamentosPorUsuario,
          usuarioAfetadoRecalculoId,
          dataIso,
          datasNaoUteisParaRetornoPosAfastamento,
        );
        if (retroTitular || indisponivelNoDia) {
          titularIndisponivelNoPlantao = usuarioAfetadoRecalculoId;
        }
        /**
         * Retroativo em sequência (ex.: sábado e domingo antes do abono na segunda): após cobrir o
         * sábado, o domingo deve seguir o ciclo (Henrique), não voltar a buscar a partir do Felipe
         * (o que repetia Gabriela).
         */
        idxBaseBuscaSubstituto = retroTitular ? idxOrdem % ordemAtual.length : posAfetado;
      }
    }
    const afastamentosPreferencial = afastamentosAtivosNoDia(afastamentosPorUsuario, usuarioPreferencial, dataIso);
    const preferencialBloqueadoPosFerias = usuarioBloqueadoPosFeriasOuAbonoNoDia(
      afastamentosPorUsuario,
      usuarioPreferencial,
      dataIso,
      datasNaoUteisParaRetornoPosAfastamento,
    );
    const preferencialBloqueadoRetroCadastro = usuarioBloqueadoRetroCadastroFeriasAbonoNoDia(
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
    if (titularIndisponivelNoPlantao != null) {
      preferencialIndisponivel = true;
    }
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
      /** Em técnicos, evita re-enfileirar na vaga 1 quem já entrou na vaga 0 do mesmo dia. */
      if (idsExcluirMesmoDia.has(uid)) continue;
      if (
        recalculoPlenoNestePlantao &&
        dataLimitePuloFocado &&
        usuarioRetornoFeriasAbonoJaRealizadoAntesDe(
          uid,
          dataLimitePuloFocado,
          retornosFeriasNoPrimeiroPlantao,
          plantoes,
          catPlantao,
        )
      ) {
        continue;
      }
      if (!filaRetornosFeriasPendentes.includes(uid)) {
        filaRetornosFeriasPendentes.push(uid);
      }
    }
    const filaRetornosParaEscolha = filaRetornosFeriasPendentes;
    const temRetornoFeriasPendente =
      retornosHoje.length > 0 || filaRetornosParaEscolha.length > 0;
    const retornoFeriasForcado = temRetornoFeriasPendente
      ? escolherRetornoFeriasDoDia(
          filaRetornosParaEscolha,
          ordemAtual,
          idxPreferencial,
          afastamentosPorUsuario,
          dataIso,
          datasNaoUteisParaRetornoPosAfastamento,
          idsExcluirMesmoDia,
        )
      : null;

    if (retornoFeriasForcado != null && !idsExcluirMesmoDia.has(Number(retornoFeriasForcado))) {
      usuarioAlocado = retornoFeriasForcado;
      if (Number(usuarioAlocado) !== Number(usuarioPreferencial)) {
        ordemAtual = moverUsuarioAntesDeReferencia(ordemAtual, usuarioAlocado, usuarioPreferencial);
        ordemGlobal = moverUsuarioAntesDeReferencia(ordemGlobal, usuarioAlocado, usuarioPreferencial);
      }
      idxOrdem = (ordemAtual.indexOf(usuarioAlocado) + 1) % ordemAtual.length;
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
          const candidato = ordemAtual[(idxBaseBuscaSubstituto + passo) % ordemAtual.length];
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
          afastamentosPreferencial.some((af) => afastamentoDeveAdiarNoCiclo(af)) ||
          preferencialBloqueadoPosFerias ||
          preferencialBloqueadoRetroCadastro;

        if (deveAlterarOrdem) {
          ordemAtual = moverUsuarioDepoisDaCobertura(ordemAtual, usuarioPreferencial, usuarioAlocado);
          ordemGlobal = moverUsuarioDepoisDaCobertura(ordemGlobal, usuarioPreferencial, usuarioAlocado);
          idxOrdem = (ordemAtual.indexOf(usuarioPreferencial) + 1) % ordemAtual.length;
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
    const idxFila = filaRetornosFeriasPendentes.indexOf(Number(usuarioAlocado));
    if (idxFila >= 0) {
      filaRetornosFeriasPendentes.splice(idxFila, 1);
    }
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
      const p1MesmoDia = plantoes.find(
        (p) =>
          categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO &&
          dataReferenciaParaStr(p.dataReferencia) === dataIso &&
          Number(p.vagaIndice) === 1,
      );
      if (p1MesmoDia && Number(p1MesmoDia.usuarioId) === Number(usuarioAlocado)) {
        const idsExcluirIrmao = new Set([Number(usuarioAlocado)]);
        const posDup = ordemAtualTec.indexOf(Number(usuarioAlocado));
        const substIrmao = buscarProximoUsuarioDisponivelNoCiclo(
          ordemAtualTec,
          posDup >= 0 ? posDup : idxOrdemTec,
          afastamentosPorUsuario,
          dataIso,
          datasNaoUteisParaRetornoPosAfastamento,
          idsExcluirIrmao,
          new Set(),
        );
        if (substIrmao && Number(p1MesmoDia.usuarioId) !== substIrmao) {
          p1MesmoDia.usuarioId = substIrmao;
          p1MesmoDia.observacao = null;
          await p1MesmoDia.save({ transaction });
          atualizados += 1;
        }
      }
    }
  }

  const focalEhVet =
    afFocadoPlain && ordemAtualDbInicialVet.includes(Number(afFocadoPlain.usuarioId));
  const focalEhTec =
    afFocadoPlain && ordemAtualDbInicialTec.includes(Number(afFocadoPlain.usuarioId));

  if (rodizioContinuoEscala && modoRecalculoFocado) {
    const ordemVetPleno =
      ordemCicloRefVet.length > 0 ? ordemCicloRefVet : ordemAtualDbInicialVet;
    const ordemTecPleno =
      ordemCicloRefTec.length > 0 ? ordemCicloRefTec : ordemAtualDbInicialTec;
    const resPlenoBimestre = sincronizarCalendarioRodizioPlenoEscalaBimestre({
      plantoes,
      ordemVetInicial: ordemVetPleno,
      ordemTecInicial: ordemTecPleno,
      afastamentosFlat: afastamentosPlainRodizio,
      datasNaoUteisIsoSet: datasNaoUteisParaRetornoPosAfastamento,
    });
    if (resPlenoBimestre.atualizados > 0) {
      for (const p of plantoes) {
        if (typeof p.save === 'function') {
          await p.save({ transaction });
        }
      }
      atualizados += resPlenoBimestre.atualizados;
    }
  }

  if (
    !rodizioContinuoEscala &&
    modoRecalculoFocado &&
    afFocadoPlain &&
    (afastamentoEhAbono(afFocadoPlain) || afastamentoEhFerias(afFocadoPlain)) &&
    outrosAfastamentosFocado.length > 0 &&
    focalEhTec
  ) {
    const afListAlinhar = afastamentosPlainRodizio;
    const ordemAlinharPleno =
      ordemCicloRefTec.length > 0
        ? ordemCicloRefTec
        : ordemAtualDbInicialTec.length
          ? ordemAtualDbInicialTec
          : ordemAtualTec;
    const inicioIsoAlinhar = dataReferenciaParaStr(afFocadoPlain.dataInicio);
    const diasAlinharPleno = new Set();
    if (afastamentoEhAbono(afFocadoPlain) && inicioIsoAlinhar) {
      const ultimoDomingoAlinhar = ultimoDiaPlantaoRetroCadastroAntesInicio(
        inicioIsoAlinhar,
        Number(afFocadoPlain.usuarioId),
        afastamentosPorUsuario,
        datasNaoUteisParaRetornoPosAfastamento,
      );
      if (ultimoDomingoAlinhar) diasAlinharPleno.add(ultimoDomingoAlinhar);
    }
    if (afastamentoEhFerias(afFocadoPlain) && inicioIsoAlinhar) {
      diasAlinharPleno.add(inicioIsoAlinhar);
    }
    const primeiraRetornoAlinhar = dataPlantaoRetornoUsuario(
      retornosFeriasNoPrimeiroPlantao,
      afFocadoPlain,
      datasPlantoesTecOrdenadas,
      datasNaoUteisParaRetornoPosAfastamento,
    );
    const idxRetAlinhar = primeiraRetornoAlinhar
      ? datasPlantoesTecOrdenadas.indexOf(primeiraRetornoAlinhar)
      : -1;
    const dataSeguinteAlinhar =
      idxRetAlinhar >= 0 && idxRetAlinhar + 1 < datasPlantoesTecOrdenadas.length
        ? datasPlantoesTecOrdenadas[idxRetAlinhar + 1]
        : null;
    if (dataSeguinteAlinhar) diasAlinharPleno.add(dataSeguinteAlinhar);
    if (afastamentoEhFerias(afFocadoPlain)) {
      const fimIsoFeriasAlinhar = dataReferenciaParaStr(afFocadoPlain.dataFim);
      if (fimIsoFeriasAlinhar) {
        for (const ds of datasPlantoesTecOrdenadas) {
          if (ds > fimIsoFeriasAlinhar) diasAlinharPleno.add(ds);
        }
      }
    }
    for (const dsAlinhar of diasAlinharPleno) {
      const resAlinhar = alinharParTecDiaSeguinteRetornoAbonoComRodizioPleno({
        plantoes,
        dataSeguinteIso: dsAlinhar,
        ordemInicial: ordemAlinharPleno,
        afastamentosFlat: afListAlinhar,
        datasNaoUteisIsoSet: datasNaoUteisParaRetornoPosAfastamento,
      });
      if (resAlinhar.atualizados > 0) {
        for (const p of plantoes) {
          if (
            categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO &&
            dataReferenciaParaStr(p.dataReferencia) === dsAlinhar &&
            typeof p.save === 'function'
          ) {
            await p.save({ transaction });
          }
        }
        atualizados += resAlinhar.atualizados;
      }
    }
  }

  if (
    !rodizioContinuoEscala &&
    modoRecalculoFocado &&
    afFocadoPlain &&
    (afastamentoEhAbono(afFocadoPlain) || afastamentoEhFerias(afFocadoPlain)) &&
    outrosAfastamentosFocado.length > 0 &&
    focalEhVet
  ) {
    const afListAlinharVet = afastamentosPlainRodizio;
    const ordemAlinharVet =
      ordemCicloRefVet.length > 0
        ? ordemCicloRefVet
        : ordemAtualDbInicialVet.length
          ? ordemAtualDbInicialVet
          : ordemAtualVet;
    const inicioIsoAlinharVet = dataReferenciaParaStr(afFocadoPlain.dataInicio);
    const diasAlinharVet = new Set();
    if (afastamentoEhAbono(afFocadoPlain) && inicioIsoAlinharVet) {
      const ultimoDomingoVet = ultimoDiaPlantaoRetroCadastroAntesInicio(
        inicioIsoAlinharVet,
        Number(afFocadoPlain.usuarioId),
        afastamentosPorUsuario,
        datasNaoUteisParaRetornoPosAfastamento,
      );
      if (ultimoDomingoVet) diasAlinharVet.add(ultimoDomingoVet);
    }
    const primeiraRetornoVet = dataPlantaoRetornoUsuario(
      retornosFeriasNoPrimeiroPlantao,
      afFocadoPlain,
      datasPlantoesVetOrdenadas,
      datasNaoUteisParaRetornoPosAfastamento,
    );
    const idxRetVet = primeiraRetornoVet ? datasPlantoesVetOrdenadas.indexOf(primeiraRetornoVet) : -1;
    const dataSeguinteVet =
      idxRetVet >= 0 && idxRetVet + 1 < datasPlantoesVetOrdenadas.length
        ? datasPlantoesVetOrdenadas[idxRetVet + 1]
        : null;
    if (afastamentoEhFerias(afFocadoPlain) && inicioIsoAlinharVet) {
      for (const ds of datasPlantoesVetOrdenadas) {
        if (ds >= inicioIsoAlinharVet) diasAlinharVet.add(ds);
      }
    } else {
      if (afastamentoEhFerias(afFocadoPlain) && inicioIsoAlinharVet) {
        diasAlinharVet.add(inicioIsoAlinharVet);
      }
      if (dataSeguinteVet) diasAlinharVet.add(dataSeguinteVet);
      if (afastamentoEhFerias(afFocadoPlain)) {
        const fimIsoFeriasVet = dataReferenciaParaStr(afFocadoPlain.dataFim);
        if (fimIsoFeriasVet) {
          for (const ds of datasPlantoesVetOrdenadas) {
            if (ds > fimIsoFeriasVet) diasAlinharVet.add(ds);
          }
        }
      }
    }
    if (afastamentoEhAbono(afFocadoPlain) && dataSeguinteVet) {
      diasAlinharVet.add(dataSeguinteVet);
    }
    if (
      afastamentoEhAbono(afFocadoPlain) &&
      limiteMesNovoAposAnterioresVet &&
      dataLimitePuloFocado &&
      inicioIsoAlinharVet
    ) {
      const fimIsoVetAbono =
        dataReferenciaParaStr(afFocadoPlain.dataFim) || inicioIsoAlinharVet;
      const mesAbono = mesIsoDeDataReferencia(inicioIsoAlinharVet);
      for (const ds of datasPlantoesVetOrdenadas) {
        if (
          fimIsoVetAbono &&
          ds > fimIsoVetAbono &&
          ds < dataLimitePuloFocado &&
          mesIsoDeDataReferencia(ds) === mesAbono
        ) {
          diasAlinharVet.add(ds);
        }
      }
    }
    for (const dsAlinhar of diasAlinharVet) {
      const resAlinharVet = alinharPlantaoVetDiaComRodizioPleno({
        plantoes,
        dataIso: dsAlinhar,
        ordemInicial: ordemAlinharVet,
        afastamentosFlat: afListAlinharVet,
        datasNaoUteisIsoSet: datasNaoUteisParaRetornoPosAfastamento,
      });
      if (resAlinharVet.atualizados > 0) {
        for (const p of plantoes) {
          if (
            categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO &&
            dataReferenciaParaStr(p.dataReferencia) === dsAlinhar &&
            typeof p.save === 'function'
          ) {
            await p.save({ transaction });
          }
        }
        atualizados += resAlinharVet.atualizados;
      }
    }
  }

  atualizados += await corrigirDuplicatasTecnicosMesmoDia({
    plantoes,
    ordemAtualTec,
    afastamentosPorUsuario,
    datasNaoUteisIsoSet: datasNaoUteisParaRetornoPosAfastamento,
    transaction,
  });

  ordemAtualVet = normalizarOrdemRodizioCompleta(ordemAtualVet, ordemAtualDbInicialVet);
  ordemAtualTec = normalizarOrdemRodizioCompleta(ordemAtualTec, ordemAtualDbInicialTec);
  ordemGlobalVet = normalizarOrdemRodizioCompleta(ordemGlobalVet, ordemGlobalDbInicialVet);
  ordemGlobalTec = normalizarOrdemRodizioCompleta(ordemGlobalTec, ordemGlobalDbInicialTec);

  /**
   * Abono focalizado: calendário é ajustado plantão a plantão; a fila 1–16 vem do rodízio pleno
   * (todos os afastamentos + plantões gravados), para bater com junho/julho — Diego, Fábio, etc.
   */
  const abonoFocadoReconstruirOrdemTec =
    modoRecalculoFocado &&
    afFocadoPlain &&
    (afastamentoEhAbono(afFocadoPlain) || afastamentoEhFerias(afFocadoPlain));
  const afastamentoFocadoReconstruirOrdemVet =
    modoRecalculoFocado &&
    afFocadoPlain &&
    (afastamentoEhAbono(afFocadoPlain) || afastamentoEhFerias(afFocadoPlain)) &&
    ordemAtualDbInicialVet.includes(Number(afFocadoPlain.usuarioId));
  if (abonoFocadoReconstruirOrdemTec) {
    const ordemRefTec =
      ordemCicloRefTec.length > 0
        ? ordemCicloRefTec
        : ordemAtualDbInicialTec.length
          ? ordemAtualDbInicialTec
          : ordemAtualTec;
    const ordemBaseTec = normalizarOrdemRodizioCompleta(ordemRefTec, ordemRefTec);
    if (rodizioContinuoEscala) {
      const rebTecBimestre = derivarOrdemTecRodizioConsistenteComPlantoes({
        plantoes,
        ordemBase: ordemBaseTec,
        afastamentosLista: afastamentosPlainRodizio,
        datasNaoUteisIsoSet: datasNaoUteisParaRetornoPosAfastamento,
      });
      if (rebTecBimestre.ordemAtual.length > 0) {
        ordemAtualTec = rebTecBimestre.ordemAtual;
        ordemGlobalTec = rebTecBimestre.ordemPersistida.length
          ? rebTecBimestre.ordemPersistida
          : [...rebTecBimestre.ordemAtual];
        idxOrdemTec = rebTecBimestre.idxOrdem;
      }
    } else {
      const reb = derivarOrdemTecRodizioConsistenteComPlantoes({
        plantoes,
        ordemBase: ordemBaseTec,
        afastamentosLista: afastamentosPlainRodizio,
        datasNaoUteisIsoSet: datasNaoUteisParaRetornoPosAfastamento,
      });
      if (reb.ordemAtual.length > 0) {
        ordemAtualTec = reb.ordemAtual;
        ordemGlobalTec = reb.ordemPersistida.length ? reb.ordemPersistida : [...reb.ordemAtual];
        idxOrdemTec = reb.idxOrdem;
      }
    }
  }
  if (afastamentoFocadoReconstruirOrdemVet) {
    const afList = afastamentosPlainRodizio;
    const ordemRefVet =
      ordemCicloRefVet.length > 0
        ? ordemCicloRefVet
        : ordemAtualDbInicialVet.length
          ? ordemAtualDbInicialVet
          : ordemAtualVet;
    const ordemBaseVet = normalizarOrdemRodizioCompleta(ordemRefVet, ordemRefVet);
    if (rodizioContinuoEscala) {
      const rebVetBimestre = ordemVetPersistidaBimestreFocado({
        plantoes,
        ordemBaseVet,
        afastamentosFlat: afList,
        fimIsoAfastamentoFocado: fimIsoAbonoFocado,
        datasNaoUteisIsoSet: datasNaoUteisParaRetornoPosAfastamento,
      });
      if (rebVetBimestre.ordemPersistida.length > 0) {
        ordemAtualVet = rebVetBimestre.ordemAtual;
        ordemGlobalVet = [...rebVetBimestre.ordemPersistida];
        idxOrdemVet = rebVetBimestre.idxOrdem;
      }
    } else {
      const rebVet = derivarOrdemVetRodizioConsistenteComPlantoes({
        plantoes,
        ordemBase: normalizarOrdemRodizioCompleta(
          ordemAtualVet.length ? ordemAtualVet : ordemRefVet,
          ordemRefVet,
        ),
        afastamentosLista: afList,
        datasNaoUteisIsoSet: datasNaoUteisParaRetornoPosAfastamento,
        modo: 'replay',
        dataLimiteRotacaoIso: dataLimitePuloFocado || null,
      });
      if (rebVet.ordemPersistida.length > 0) {
        ordemAtualVet = rebVet.ordemAtual;
        ordemGlobalVet = [...rebVet.ordemPersistida];
        idxOrdemVet = rebVet.idxOrdem;
      }
    }
  } else {
    ordemAtualVet = rotacionarOrdemParaProximoPreferencial(ordemAtualVet, idxOrdemVet);
    ordemGlobalVet = rotacionarOrdemParaProximoPreferencial(ordemGlobalVet, idxOrdemVet);
  }
  if (!abonoFocadoReconstruirOrdemTec) {
    ordemAtualTec = rotacionarOrdemParaProximoPreferencial(ordemAtualTec, idxOrdemTec);
    ordemGlobalTec = rotacionarOrdemParaProximoPreferencial(ordemGlobalTec, idxOrdemTec);
  }

  /**
   * Mantém ordem global alinhada à fila do rodízio da escala quando esta mudou.
   * Se a fila veio do replay/simulação plena, não sobrescrever com `ordemAtual` suja do loop focalizado.
   */
  if (ordemAtualVet.join(',') !== ordemGlobalVet.join(',')) {
    if (afastamentoFocadoReconstruirOrdemVet) {
      ordemAtualVet = [...ordemGlobalVet];
    } else {
      ordemGlobalVet = [...ordemAtualVet];
    }
  }
  if (ordemAtualTec.join(',') !== ordemGlobalTec.join(',')) {
    if (abonoFocadoReconstruirOrdemTec) {
      ordemAtualTec = [...ordemGlobalTec];
    } else {
      ordemGlobalTec = [...ordemAtualTec];
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

  const categoriaAlvo =
    String(auditoriaContexto?.categoriaAlvo || '').toLowerCase() === CATEGORIA_MEMBRO.TECNICO
      ? CATEGORIA_MEMBRO.TECNICO
      : String(auditoriaContexto?.categoriaAlvo || '').toLowerCase() === CATEGORIA_MEMBRO.VETERINARIO
        ? CATEGORIA_MEMBRO.VETERINARIO
        : null;
  const registrarVet =
    ordemMudouVet ||
    (auditoriaContexto?.registrarMesmoSemMudanca === true &&
      categoriaAlvo === CATEGORIA_MEMBRO.VETERINARIO &&
      ordemAtualDbInicialVet.length > 0);
  const registrarTec =
    ordemMudouTec ||
    (auditoriaContexto?.registrarMesmoSemMudanca === true &&
      categoriaAlvo === CATEGORIA_MEMBRO.TECNICO &&
      ordemAtualDbInicialTec.length > 0);

  if (registrarVet) {
    await registrarEventoAuditoriaEscala({
      escalaId,
      categoriaMembro: CATEGORIA_MEMBRO.VETERINARIO,
      tipoEvento: auditoriaContexto?.tipoEvento || 'recalculo_ordem',
      referenciaTipo: auditoriaContexto?.referenciaTipo || null,
      referenciaId: auditoriaContexto?.referenciaId || null,
      dataReferencia: auditoriaContexto?.dataReferencia || null,
      ordemAntesUsuarioIds: ordemAtualDbInicialVet,
      ordemDepoisUsuarioIds: ordemAtualVet,
      detalhes: auditoriaContexto?.detalhes || { historicoMotivo },
      criadoPorUsuarioId: auditoriaContexto?.criadoPorUsuarioId || null,
      transaction,
    });
  }
  if (registrarTec) {
    await registrarEventoAuditoriaEscala({
      escalaId,
      categoriaMembro: CATEGORIA_MEMBRO.TECNICO,
      tipoEvento: auditoriaContexto?.tipoEvento || 'recalculo_ordem',
      referenciaTipo: auditoriaContexto?.referenciaTipo || null,
      referenciaId: auditoriaContexto?.referenciaId || null,
      dataReferencia: auditoriaContexto?.dataReferencia || null,
      ordemAntesUsuarioIds: ordemAtualDbInicialTec,
      ordemDepoisUsuarioIds: ordemAtualTec,
      detalhes: auditoriaContexto?.detalhes || { historicoMotivo },
      criadoPorUsuarioId: auditoriaContexto?.criadoPorUsuarioId || null,
      transaction,
    });
  }

  return {
    atualizados,
    ordemMudou,
    ordemUsuarioIds: [...ordemAtualVet, ...ordemAtualTec],
    ordemAtualVet,
    ordemAtualTec,
    ordemInicialVet: ordemAtualDbInicialVet,
    ordemInicialTec: ordemAtualDbInicialTec,
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

/**
 * Restaura a ordem geral (veterinários e técnicos) ao snapshot gravado em `motivo: 'inicial'` na criação da escala.
 */
async function restaurarOrdemGlobalPreExclusaoEscala(escalaId, transaction) {
  const histsInicial = await EscalaOrdemHistoricoModel.findAll({
    where: { escalaId: Number(escalaId), motivo: 'inicial' },
    order: [['id', 'ASC']],
    transaction,
  });
  let ordemGlobalInicialVet = null;
  let ordemGlobalInicialTec = null;
  for (const histInicial of histsInicial) {
    const plain = histInicial.get ? histInicial.get({ plain: true }) : histInicial;
    const cat =
      String(plain.categoriaOrdem || '').toLowerCase() === CATEGORIA_MEMBRO.TECNICO
        ? CATEGORIA_MEMBRO.TECNICO
        : CATEGORIA_MEMBRO.VETERINARIO;
    if (!Array.isArray(plain.ordemGlobalUsuarioIds) || plain.ordemGlobalUsuarioIds.length === 0) continue;
    const og = plain.ordemGlobalUsuarioIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
    if (og.length === 0) continue;
    if (cat === CATEGORIA_MEMBRO.TECNICO) ordemGlobalInicialTec = og;
    else ordemGlobalInicialVet = og;
  }
  if (ordemGlobalInicialVet && ordemGlobalInicialVet.length > 0) {
    await atualizarOrdemServidoresGlobalSemColisao(ordemGlobalInicialVet, transaction, ESCOPO_ORDEM.VETERINARIO);
  }
  if (ordemGlobalInicialTec && ordemGlobalInicialTec.length > 0) {
    await atualizarOrdemServidoresGlobalSemColisao(ordemGlobalInicialTec, transaction, ESCOPO_ORDEM.TECNICO);
  }
  if (!ordemGlobalInicialVet?.length && !ordemGlobalInicialTec?.length) return;

  const afastamentos = await AfastamentoModel.findAll({ attributes: ['id', 'usuarioId'], transaction });
  for (const af of afastamentos) {
    const escopoAf = await escopoOrdemGlobalParaUsuarioId(af.usuarioId, transaction);
    const og = await obterOrdemGlobalUsuarioIds(transaction, escopoAf);
    if (og.length > 0) {
      await AfastamentoModel.update(
        { ordemGlobalUsuarioIdsAntes: og },
        { where: { id: Number(af.id) }, transaction },
      );
    }
  }
}

/**
 * Fila LIFO por classe (vet/técnico): id do afastamento com `createdAt` mais recente em cada escopo.
 */
async function obterIdsAfastamentosMaisRecentesPorClasse(transaction) {
  const rows = await AfastamentoModel.findAll({
    attributes: ['id', 'usuarioId', 'createdAt'],
    order: [['createdAt', 'DESC']],
    transaction,
  });
  const [vets, tecs] = await Promise.all([
    EscalaService.listarVeterinarios(),
    EscalaService.listarTecnicos(),
  ]);
  const idsVet = new Set(vets.map((v) => Number(v.id)));
  const idsTec = new Set(tecs.map((t) => Number(t.id)));
  let veterinario = null;
  let tecnico = null;
  for (const row of rows) {
    const uid = Number(row.usuarioId);
    if (veterinario == null && idsVet.has(uid)) {
      veterinario = Number(row.id);
    }
    if (tecnico == null && idsTec.has(uid)) {
      tecnico = Number(row.id);
    }
    if (veterinario != null && tecnico != null) break;
  }
  return { veterinario, tecnico };
}

async function afastamentoEhMaisRecenteDaClasse(afastamentoPlain, transaction) {
  const id = Number(afastamentoPlain?.id);
  if (!Number.isFinite(id)) return false;
  const { veterinario, tecnico } = await obterIdsAfastamentosMaisRecentesPorClasse(transaction);
  const escopo = await escopoOrdemGlobalParaUsuarioId(afastamentoPlain.usuarioId, transaction);
  const alvo = escopo === ESCOPO_ORDEM.TECNICO ? tecnico : veterinario;
  return alvo != null && Number(alvo) === id;
}

/** Restaura ordem na escala e ordem geral ao estado imediatamente anterior ao cadastro deste afastamento. */
async function restaurarEstadoAntesAfastamento(afastamentoPlain, transaction) {
  const afId = Number(afastamentoPlain.id);
  if (!Number.isFinite(afId)) return;

  const rowsHist = await EscalaOrdemHistoricoModel.findAll({
    where: { afastamentoId: afId },
    transaction,
    order: [['id', 'DESC']],
  });

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
  if (!Array.isArray(og) || og.length === 0) {
    throw new ApiBaseError(
      'Não foi possível desfazer: falta o registro da ordem anterior a este afastamento.',
    );
  }
  const escopoAf = await escopoOrdemGlobalParaUsuarioId(afastamentoPlain.usuarioId, transaction);
  await atualizarOrdemServidoresGlobalSemColisao(og.map((x) => Number(x)), transaction, escopoAf);
}

/**
 * Núcleo puro do recálculo total. Recebe TODAS as entradas já carregadas e produz o resultado
 * esperado (alocações, ordem final, diffs) sem tocar no BD. Facilita testar sem mocks de models.
 *
 * Entradas:
 *  - `ordemInicialVet` / `ordemInicialTec`: ordem do rodízio na criação da escala.
 *  - `ordemMembrosVet` / `ordemMembrosTec`: ordem atual gravada nos membros (para comparar
 *     mudança e devolver `ordemMudou*`). Quando ausente, considera-se que não houve mudança.
 *  - `plantoesGravados`: array com `{ dataIso, categoria, vagaIndice, usuarioId }` do estado
 *     gravado, usado para calcular `atualizados` e `diffsCongelados*`.
 *  - `afastamentos`: lista COMPLETA de afastamentos relevantes ao período (vet + téc).
 *  - `periodicidadeEscala`: 'fim_de_semana' | 'diario' | ... usado para decidir se datas
 *     adicionais (feriados em dia útil) contam como "dia útil" para retornos.
 *  - `dataCongelamentoIso`: datas estritamente anteriores ficam congeladas (não persistir).
 */
/**
 * Datas distintas em que cada usuário é titular, ordenadas crescentemente (calendário base).
 * Cada usuário aparece no máximo uma vez por data (vet: 1 vaga; téc: rodízio impede repetir no dia),
 * então a lista funciona como "1º, 2º, 3º… plantão da pessoa na escala".
 */
function mapaDatasOrdenadasPorUsuario(alocacoes) {
  const porUsuario = new Map();
  const ordenadas = [...(alocacoes || [])].sort((a, b) =>
    String(a.dataIso).localeCompare(String(b.dataIso)),
  );
  for (const a of ordenadas) {
    const uid = Number(a.usuarioId);
    if (!Number.isFinite(uid) || uid < 1 || !a.dataIso) continue;
    if (!porUsuario.has(uid)) porUsuario.set(uid, []);
    const lista = porUsuario.get(uid);
    if (!lista.includes(a.dataIso)) lista.push(a.dataIso);
  }
  return porUsuario;
}

/**
 * Overlay de permutas por ordinal aplicado SOBRE o calendário base (rodízio puro), sem alterar a
 * ordem do ciclo. Cada permuta amarra (usuarioA, ordinalA) ↔ (usuarioB, ordinalB), em que o ordinal
 * é o N-ésimo plantão (1-based, por data) da pessoa na escala. Para técnicos a permuta é por DIA
 * (não por vaga): troca-se a pessoa entre as duas datas, independentemente da vaga.
 *
 * Os ordinais são resolvidos no estado base ANTES de qualquer troca (estáveis); depois todas as
 * trocas são aplicadas de uma vez. Invalida quando o ordinal não existe (a pessoa tem menos
 * plantões que o ordinal pedido — ex.: cobertura por afastamento removeu uma aparição).
 *
 * @returns {{ alocacoesVet, alocacoesTec, permutasInvalidadasIds: number[] }}
 */
function aplicarOverlayPermutasNasAlocacoes(alocacoesVet, alocacoesTec, permutas) {
  const vet = (alocacoesVet || []).map((a) => ({ ...a }));
  const tec = (alocacoesTec || []).map((a) => ({ ...a }));
  const permutasInvalidadasIds = [];
  if (!Array.isArray(permutas) || permutas.length === 0) {
    return { alocacoesVet: vet, alocacoesTec: tec, permutasInvalidadasIds };
  }

  const datasPorUsuarioVet = mapaDatasOrdenadasPorUsuario(vet);
  const datasPorUsuarioTec = mapaDatasOrdenadasPorUsuario(tec);

  /** Resolve todos os pares (slot do A, slot do B) no BASE antes de mutar, para ordinais estáveis. */
  const trocas = [];
  for (const p of permutas) {
    const cat = String(p.categoria || '').toLowerCase();
    const ehTec = cat === CATEGORIA_PLANTAO.TECNICO;
    const arr = ehTec ? tec : vet;
    const mapa = ehTec ? datasPorUsuarioTec : datasPorUsuarioVet;
    const uidA = Number(p.usuarioA);
    const uidB = Number(p.usuarioB);
    const dataA = (mapa.get(uidA) || [])[Number(p.ordinalA) - 1];
    const dataB = (mapa.get(uidB) || [])[Number(p.ordinalB) - 1];
    if (!dataA || !dataB) {
      permutasInvalidadasIds.push(Number(p.id));
      continue;
    }
    const slotA = arr.find((a) => a.dataIso === dataA && Number(a.usuarioId) === uidA);
    const slotB = arr.find((a) => a.dataIso === dataB && Number(a.usuarioId) === uidB);
    if (!slotA || !slotB) {
      permutasInvalidadasIds.push(Number(p.id));
      continue;
    }
    trocas.push({ slotA, slotB, uidA, uidB });
  }

  for (const t of trocas) {
    t.slotA.usuarioId = t.uidB;
    t.slotB.usuarioId = t.uidA;
  }

  return { alocacoesVet: vet, alocacoesTec: tec, permutasInvalidadasIds };
}

function recalcularEscalaCompletaNucleo({
  ordemInicialVet = [],
  ordemInicialTec = [],
  ordemMembrosVet = [],
  ordemMembrosTec = [],
  plantoesGravados = [],
  afastamentos = [],
  periodicidadeEscala = 'fim_de_semana',
  dataCongelamentoIso = null,
  permutas = [],
}) {
  const plantoesVetGravados = plantoesGravados.filter(
    (p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.VETERINARIO,
  );
  const plantoesTecGravados = plantoesGravados.filter(
    (p) => categoriaPlantaoDe(p) === CATEGORIA_PLANTAO.TECNICO,
  );
  const datasPlantoesVet = [
    ...new Set(plantoesVetGravados.map((p) => dataReferenciaParaStr(p.dataReferencia)).filter(Boolean)),
  ].sort();
  const datasPlantoesTec = [
    ...new Set(plantoesTecGravados.map((p) => dataReferenciaParaStr(p.dataReferencia)).filter(Boolean)),
  ].sort();

  /**
   * Ordenação canônica por (dataInicio, dataFim, id). O `id` é o desempate estável que garante
   * que o resultado independe da ordem de cadastro no BD e que duas execuções consecutivas
   * produzem o mesmo resultado.
   */
  const afastamentosOrdenados = [...afastamentos].sort((a, b) => {
    const cmpIni = String(dataReferenciaParaStr(a.dataInicio)).localeCompare(
      String(dataReferenciaParaStr(b.dataInicio)),
    );
    if (cmpIni !== 0) return cmpIni;
    const cmpFim = String(dataReferenciaParaStr(a.dataFim)).localeCompare(
      String(dataReferenciaParaStr(b.dataFim)),
    );
    if (cmpFim !== 0) return cmpFim;
    return Number(a.id || 0) - Number(b.id || 0);
  });

  /**
   * Em escalas com periodicidade "fim_de_semana", as datas adicionais (ex.: feriados em dia útil)
   * NÃO contam como dia útil para liberar o retorno após férias/abono — o simulador já recebe
   * esse conjunto para tratar corretamente.
   */
  const datasNaoUteisIsoSet =
    String(periodicidadeEscala || '').toLowerCase() === 'fim_de_semana'
      ? new Set(
          plantoesGravados
            .map((p) => dataReferenciaParaStr(p.dataReferencia))
            .filter((ds) => !!ds && !ehFimDeSemanaDataReferencia(ds)),
        )
      : new Set();

  const congelamentoIso =
    dataCongelamentoIso != null && /^\d{4}-\d{2}-\d{2}$/.test(String(dataCongelamentoIso))
      ? String(dataCongelamentoIso)
      : dataReferenciaParaStr(new Date());

  /**
   * Filtra férias/abono que NÃO tiram plantão do titular antes de simular. Sem isso, um
   * afastamento "irrelevante" (ex.: férias 10–17/07 de um técnico escalado só para 25/07)
   * ainda dispararia o "retorno forçado" no primeiro plantão pós-fim e mexeria na fila.
   * Mesma filtragem usada pelo fluxo antigo (`recalcularEscalaInterno`).
   */
  const categoriaPorUsuarioIdFiltro = new Map();
  for (const id of ordemInicialVet) categoriaPorUsuarioIdFiltro.set(Number(id), CATEGORIA_PLANTAO.VETERINARIO);
  for (const id of ordemInicialTec) categoriaPorUsuarioIdFiltro.set(Number(id), CATEGORIA_PLANTAO.TECNICO);
  const paramsFiltroAfastamento = montarParametrosFiltroAfastamentoPlantoes({
    plantoes: plantoesGravados,
    ordemVetInicial: ordemInicialVet,
    ordemTecInicial: ordemInicialTec,
    afastamentosLista: afastamentosOrdenados,
    periodicidadeEscala,
    categoriaPorUsuarioId: categoriaPorUsuarioIdFiltro,
  });
  const afastamentosRodizio = afastamentosListaParaRodizioEscala(
    afastamentosOrdenados,
    paramsFiltroAfastamento,
  );

  const simVet =
    ordemInicialVet.length > 0 && datasPlantoesVet.length > 0
      ? simularRodizioVetPlantoes(ordemInicialVet, datasPlantoesVet, afastamentosRodizio, datasNaoUteisIsoSet)
      : { ordemAtual: [...ordemInicialVet], idxOrdem: 0, ordemPersistida: [...ordemInicialVet], alocacoes: [] };

  const plantoesTecRef = plantoesTecGravados.map((p) => ({
    dataReferencia: dataReferenciaParaStr(p.dataReferencia),
    categoriaPlantao: CATEGORIA_PLANTAO.TECNICO,
    usuarioId: Number(p.usuarioId),
    vagaIndice: Number(p.vagaIndice ?? 0),
  }));
  const simTec =
    ordemInicialTec.length > 0 && datasPlantoesTec.length > 0
      ? simularRodizioTecPlantoes(
          ordemInicialTec,
          datasPlantoesTec,
          afastamentosRodizio,
          datasNaoUteisIsoSet,
          0,
          plantoesTecRef,
        )
      : { ordemAtual: [...ordemInicialTec], idxOrdem: 0, ordemPersistida: [...ordemInicialTec], alocacoes: [] };

  /**
   * Overlay de permutas por ordinal aplicado SOBRE o rodízio puro (não altera a ordem do ciclo,
   * apenas o titular de cada plantão). Os ordinais são lidos do calendário base recém-simulado.
   */
  const overlay = aplicarOverlayPermutasNasAlocacoes(simVet.alocacoes, simTec.alocacoes, permutas);
  const alocacoesVetFinais = overlay.alocacoesVet;
  const alocacoesTecFinais = overlay.alocacoesTec;
  const permutasInvalidadasIds = overlay.permutasInvalidadasIds;

  /**
   * Plantões para persistir: data >= congelamento E usuário simulado difere do gravado.
   * Datas congeladas com divergência ficam apenas registradas em `diffsCongelados*` (não persistir).
   */
  const updatesVet = [];
  const diffsCongeladosVet = [];
  for (const aloc of alocacoesVetFinais) {
    const pl = plantoesVetGravados.find(
      (p) => dataReferenciaParaStr(p.dataReferencia) === aloc.dataIso,
    );
    if (!pl) continue;
    const alvo = Number(aloc.usuarioId);
    if (!Number.isFinite(alvo) || alvo < 1 || Number(pl.usuarioId) === alvo) continue;
    if (aloc.dataIso < congelamentoIso) {
      diffsCongeladosVet.push({ dataIso: aloc.dataIso, gravado: Number(pl.usuarioId), simulado: alvo });
      continue;
    }
    updatesVet.push({ plantao: pl, dataIso: aloc.dataIso, usuarioId: alvo });
  }

  const updatesTec = [];
  const diffsCongeladosTec = [];
  for (const aloc of alocacoesTecFinais) {
    const pl = plantoesTecGravados.find(
      (p) =>
        dataReferenciaParaStr(p.dataReferencia) === aloc.dataIso &&
        Number(p.vagaIndice ?? 0) === Number(aloc.vagaIndice ?? 0),
    );
    if (!pl) continue;
    const alvo = Number(aloc.usuarioId);
    if (!Number.isFinite(alvo) || alvo < 1 || Number(pl.usuarioId) === alvo) continue;
    if (aloc.dataIso < congelamentoIso) {
      diffsCongeladosTec.push({
        dataIso: aloc.dataIso,
        vagaIndice: Number(aloc.vagaIndice ?? 0),
        gravado: Number(pl.usuarioId),
        simulado: alvo,
      });
      continue;
    }
    updatesTec.push({
      plantao: pl,
      dataIso: aloc.dataIso,
      vagaIndice: Number(aloc.vagaIndice ?? 0),
      usuarioId: alvo,
    });
  }

  const ordemMembrosFinalVet = simVet.ordemPersistida.length ? simVet.ordemPersistida : [...ordemMembrosVet];
  const ordemMembrosFinalTec = simTec.ordemPersistida.length ? simTec.ordemPersistida : [...ordemMembrosTec];
  const ordemMudouVet =
    ordemMembrosVet.length > 0 && ordemMembrosFinalVet.join(',') !== ordemMembrosVet.join(',');
  const ordemMudouTec =
    ordemMembrosTec.length > 0 && ordemMembrosFinalTec.join(',') !== ordemMembrosTec.join(',');

  return {
    atualizados: updatesVet.length + updatesTec.length,
    ordemMudou: ordemMudouVet || ordemMudouTec,
    ordemMudouVet,
    ordemMudouTec,
    ordemInicialVet,
    ordemInicialTec,
    ordemFinalVet: ordemMembrosFinalVet,
    ordemFinalTec: ordemMembrosFinalTec,
    alocacoesVet: alocacoesVetFinais,
    alocacoesTec: alocacoesTecFinais,
    alocacoesBaseVet: simVet.alocacoes,
    alocacoesBaseTec: simTec.alocacoes,
    permutasInvalidadasIds,
    updatesVet,
    updatesTec,
    diffsCongeladosVet,
    diffsCongeladosTec,
    congelamentoIso,
    afastamentosOrdenadosIds: afastamentosOrdenados.map((a) => Number(a.id || 0)),
    afastamentosRodizioIds: afastamentosRodizio.map((a) => Number(a.id || 0)),
  };
}

/**
 * Recálculo total (determinístico) de uma escala a partir da ordem inicial gravada e da lista
 * COMPLETA de afastamentos. Substitui o fluxo incremental `recalcularEscalaInterno` quando
 * ativado: é puro o suficiente para que mesmo input produza mesmo output, e portanto:
 *   - permite excluir qualquer afastamento (não exige LIFO);
 *   - independe da ordem de cadastro (afastamentos são ordenados por `dataInicio, dataFim, id`);
 *   - elimina os modos "focado", "bootstrap", "isolamento entre categorias" etc.
 *
 * Plantões com `dataReferencia < dataCongelamentoIso` são tratados como FATO consumado:
 * não são persistidos diff, mesmo que a simulação difira (proteção para dias já realizados).
 *
 * Em `dryRun = true`, nada é gravado — útil para testes de paridade e para calcular relevância
 * de afastamentos via diff (executar com e sem o afastamento e comparar).
 */
/**
 * Carrega do BD todas as entradas que o núcleo determinístico precisa para uma escala
 * (ordem inicial, membros, plantões gravados e afastamentos relevantes). Centraliza a leitura
 * para que o recálculo e o cálculo do calendário base (usado pelas permutas) compartilhem a
 * mesma fonte de verdade.
 */
async function montarEntradaNucleoEscala(escalaId, transaction) {
  const escala = await EscalaModel.findByPk(escalaId, { transaction });
  if (!escala) throw new ApiBaseError('Escala não encontrada.');

  const dataInicioEscalaIso = dataReferenciaParaStr(escala.dataInicio);
  const dataFimEscalaIso = dataReferenciaParaStr(escala.dataFim);

  const membros = await obterMembrosAtivosEscala(escalaId, transaction);
  const ordemMembrosVet = membros
    .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.VETERINARIO)
    .map((m) => Number(m.usuarioId))
    .filter((id) => Number.isFinite(id) && id > 0);
  const ordemMembrosTec = membros
    .filter((m) => categoriaMembroDe(m) === CATEGORIA_MEMBRO.TECNICO)
    .map((m) => Number(m.usuarioId))
    .filter((id) => Number.isFinite(id) && id > 0);

  const ordemInicialVet = await obterOrdemCicloReferenciaEscala(
    escalaId,
    ordemMembrosVet,
    CATEGORIA_MEMBRO.VETERINARIO,
    transaction,
  );
  const ordemInicialTec = await obterOrdemCicloReferenciaEscala(
    escalaId,
    ordemMembrosTec,
    CATEGORIA_MEMBRO.TECNICO,
    transaction,
  );

  const plantoes = await PlantaoModel.findAll({
    where: { escalaId },
    order: [
      ['dataReferencia', 'ASC'],
      ['vagaIndice', 'ASC'],
    ],
    transaction,
  });

  const idsMembros = [...new Set([...ordemMembrosVet, ...ordemMembrosTec])].filter(
    (id) => Number.isFinite(id) && id > 0,
  );
  const afastamentosRows = idsMembros.length
    ? await AfastamentoModel.findAll({
        where: {
          usuarioId: { [Op.in]: idsMembros },
          dataInicio: { [Op.lte]: dataFimEscalaIso },
          dataFim: { [Op.gte]: dataInicioEscalaIso },
        },
        include: [{ model: TipoAfastamentoModel, as: 'tipo', attributes: ['id', 'tipo', 'regraOrdem'] }],
        transaction,
      })
    : [];
  const afastamentos = afastamentosRows.map((a) => (a.get ? a.get({ plain: true }) : a));

  return { escala, ordemMembrosVet, ordemMembrosTec, ordemInicialVet, ordemInicialTec, plantoes, afastamentos };
}

/** Lê as permutas em vigor (status 'ativa') de uma escala, em ordem de criação (id ASC). */
async function carregarPermutasAtivasOverlay(escalaId, transaction) {
  const rows = await PermutaSolicitacaoModel.findAll({
    where: { escalaId, status: 'ativa' },
    order: [['id', 'ASC']],
    transaction,
  });
  return rows
    .map((r) => (r.get ? r.get({ plain: true }) : r))
    .filter(
      (r) =>
        Number(r.ordinalSolicitante) > 0 &&
        Number(r.ordinalDestinatario) > 0 &&
        Number(r.solicitanteUsuarioId) > 0 &&
        Number(r.destinatarioUsuarioId) > 0,
    )
    .map((r) => ({
      id: Number(r.id),
      categoria: String(r.categoria || CATEGORIA_PLANTAO.VETERINARIO).toLowerCase(),
      usuarioA: Number(r.solicitanteUsuarioId),
      ordinalA: Number(r.ordinalSolicitante),
      usuarioB: Number(r.destinatarioUsuarioId),
      ordinalB: Number(r.ordinalDestinatario),
    }));
}

/**
 * Calendário base (rodízio puro, SEM overlay de permutas) de uma escala, com os ordinais
 * de cada pessoa por categoria. Base do cadastro/validação de permutas por ordinal.
 *
 * @returns {{ datasPorUsuarioVet: Map<number,string[]>, datasPorUsuarioTec: Map<number,string[]> }}
 */
async function calcularBaseOrdinaisEscala(escalaId, transaction) {
  const entrada = await montarEntradaNucleoEscala(escalaId, transaction);
  const resultado = recalcularEscalaCompletaNucleo({
    ordemInicialVet: entrada.ordemInicialVet,
    ordemInicialTec: entrada.ordemInicialTec,
    ordemMembrosVet: entrada.ordemMembrosVet,
    ordemMembrosTec: entrada.ordemMembrosTec,
    plantoesGravados: entrada.plantoes,
    afastamentos: entrada.afastamentos,
    periodicidadeEscala: entrada.escala.periodicidade,
    permutas: [],
  });
  return {
    escala: entrada.escala,
    ordemMembrosVet: entrada.ordemMembrosVet,
    ordemMembrosTec: entrada.ordemMembrosTec,
    datasPorUsuarioVet: mapaDatasOrdenadasPorUsuario(resultado.alocacoesBaseVet),
    datasPorUsuarioTec: mapaDatasOrdenadasPorUsuario(resultado.alocacoesBaseTec),
  };
}

/**
 * Reaplica as permutas ativas SOBRE os plantões já persistidos (sem alterar a ordem do ciclo).
 * Usado pelos fluxos que recalculam pelo motor legado `recalcularEscalaInterno` (inclusão/remoção
 * de datas extras/feriados), garantindo que a troca "siga o nome" também nesses caminhos.
 * Invalida permutas cujo ordinal não exista mais no calendário base.
 */
async function reaplicarOverlayPermutasPersistido(escalaId, transaction) {
  const permutas = await carregarPermutasAtivasOverlay(escalaId, transaction);
  if (permutas.length === 0) return { invalidadasIds: [] };

  const base = await calcularBaseOrdinaisEscala(escalaId, transaction);
  const plantoes = await PlantaoModel.findAll({ where: { escalaId }, transaction });

  const invalidadasIds = [];
  const trocas = [];
  for (const p of permutas) {
    const ehTec = p.categoria === CATEGORIA_PLANTAO.TECNICO;
    const mapa = ehTec ? base.datasPorUsuarioTec : base.datasPorUsuarioVet;
    const dataA = (mapa.get(p.usuarioA) || [])[p.ordinalA - 1];
    const dataB = (mapa.get(p.usuarioB) || [])[p.ordinalB - 1];
    if (!dataA || !dataB) {
      invalidadasIds.push(p.id);
      continue;
    }
    const plA = plantoes.find(
      (x) => categoriaPlantaoDe(x) === p.categoria && dataReferenciaParaStr(x.dataReferencia) === dataA && Number(x.usuarioId) === p.usuarioA,
    );
    const plB = plantoes.find(
      (x) => categoriaPlantaoDe(x) === p.categoria && dataReferenciaParaStr(x.dataReferencia) === dataB && Number(x.usuarioId) === p.usuarioB,
    );
    if (!plA || !plB) {
      invalidadasIds.push(p.id);
      continue;
    }
    trocas.push({ plA, plB, a: p.usuarioA, b: p.usuarioB });
  }

  for (const t of trocas) {
    t.plA.usuarioId = t.b;
    t.plB.usuarioId = t.a;
    t.plA.observacao = null;
    t.plB.observacao = null;
    await t.plA.save({ transaction });
    await t.plB.save({ transaction });
  }
  if (invalidadasIds.length > 0) {
    await PermutaSolicitacaoModel.update(
      { status: 'invalidada' },
      { where: { id: { [Op.in]: invalidadasIds } }, transaction },
    );
  }
  return { invalidadasIds };
}

/** Localiza, num mapa (usuário → datas base ordenadas), quem tem a data e qual o ordinal (1-based). */
function resolverOrdinalPorDataNoMapa(mapa, dataIso) {
  for (const [usuarioId, datas] of mapa.entries()) {
    const idx = datas.indexOf(dataIso);
    if (idx >= 0) return { usuarioId: Number(usuarioId), ordinal: idx + 1 };
  }
  return null;
}

/** Normaliza e valida a categoria informada para uma permuta. */
function normalizarCategoriaPermuta(categoria) {
  const cat = String(categoria || '').toLowerCase();
  if (cat !== CATEGORIA_PLANTAO.VETERINARIO && cat !== CATEGORIA_PLANTAO.TECNICO) {
    throw new ApiBaseError('Categoria inválida para permuta (use veterinário ou técnico).');
  }
  return cat;
}

/**
 * Resolve e valida uma permuta por ordinal contra o calendário base atual da escala:
 * categoria válida, servidores distintos e membros ativos, ordinais existentes e — regra do usuário —
 * nenhum dos dois slots (servidor + N-ésimo plantão) pode já participar de outra permuta ativa/pendente.
 *
 * @returns {{ escala, categoria, dataA: string, dataB: string }}
 */
async function resolverPermutaOrdinal(
  { escalaId, categoria, usuarioA, ordinalA, usuarioB, ordinalB, permutaIdIgnorar = null },
  transaction,
) {
  const eid = parseInt(escalaId, 10);
  if (!Number.isFinite(eid) || eid < 1) throw new ApiBaseError('Informe a escala.');
  const cat = normalizarCategoriaPermuta(categoria);
  const uidA = Number(usuarioA);
  const uidB = Number(usuarioB);
  const ordA = Number(ordinalA);
  const ordB = Number(ordinalB);
  if (!Number.isFinite(uidA) || uidA < 1 || !Number.isFinite(uidB) || uidB < 1) {
    throw new ApiBaseError('Selecione os dois servidores da permuta.');
  }
  if (uidA === uidB) throw new ApiBaseError('Selecione dois servidores diferentes para a permuta.');
  if (!Number.isInteger(ordA) || ordA < 1 || !Number.isInteger(ordB) || ordB < 1) {
    throw new ApiBaseError('Informe o número do plantão (ordinal) de cada servidor.');
  }

  const base = await calcularBaseOrdinaisEscala(eid, transaction);
  const membrosCat = cat === CATEGORIA_PLANTAO.VETERINARIO ? base.ordemMembrosVet : base.ordemMembrosTec;
  const setMembros = new Set(membrosCat.map((id) => Number(id)));
  if (!setMembros.has(uidA) || !setMembros.has(uidB)) {
    throw new ApiBaseError('Ambos os servidores devem ser membros ativos da escala na categoria informada.');
  }

  const mapa = cat === CATEGORIA_PLANTAO.VETERINARIO ? base.datasPorUsuarioVet : base.datasPorUsuarioTec;
  const datasA = mapa.get(uidA) || [];
  const datasB = mapa.get(uidB) || [];
  const dataA = datasA[ordA - 1];
  const dataB = datasB[ordB - 1];
  if (!dataA) {
    throw new ApiBaseError(`O servidor de origem não possui o ${ordA}º plantão nesta escala.`);
  }
  if (!dataB) {
    throw new ApiBaseError(`O servidor de destino não possui o ${ordB}º plantão nesta escala.`);
  }

  /** "Uma vaga já permutada não pode fazer parte de outra permuta" (slot = servidor + ordinal). */
  const outras = await PermutaSolicitacaoModel.findAll({
    where: {
      escalaId: eid,
      status: { [Op.in]: ['ativa', 'pendente'] },
      ...(permutaIdIgnorar != null ? { id: { [Op.ne]: Number(permutaIdIgnorar) } } : {}),
    },
    transaction,
  });
  const slotsUsados = new Set();
  for (const o of outras) {
    const oc = String(o.categoria || '').toLowerCase();
    slotsUsados.add(`${oc}#${Number(o.solicitanteUsuarioId)}#${Number(o.ordinalSolicitante)}`);
    slotsUsados.add(`${oc}#${Number(o.destinatarioUsuarioId)}#${Number(o.ordinalDestinatario)}`);
  }
  if (slotsUsados.has(`${cat}#${uidA}#${ordA}`) || slotsUsados.has(`${cat}#${uidB}#${ordB}`)) {
    throw new ApiBaseError('Um dos plantões selecionados já participa de outra permuta. Escolha outro.');
  }

  return { escala: base.escala, categoria: cat, dataA, dataB };
}

/** Revalida (no aceite/ativação) que os slots por ordinal de uma permuta ainda existem e estão livres. */
async function validarSlotsPermutaOrdinalDisponiveis(row, transaction) {
  return await resolverPermutaOrdinal(
    {
      escalaId: row.escalaId,
      categoria: row.categoria,
      usuarioA: row.solicitanteUsuarioId,
      ordinalA: row.ordinalSolicitante,
      usuarioB: row.destinatarioUsuarioId,
      ordinalB: row.ordinalDestinatario,
      permutaIdIgnorar: row.id,
    },
    transaction,
  );
}

async function recalcularEscalaCompleta(
  escalaId,
  { transaction, dataCongelamentoIso = null, dryRun = false } = {},
) {
  const {
    escala,
    ordemMembrosVet,
    ordemMembrosTec,
    ordemInicialVet,
    ordemInicialTec,
    plantoes,
    afastamentos,
  } = await montarEntradaNucleoEscala(escalaId, transaction);

  const permutas = await carregarPermutasAtivasOverlay(escalaId, transaction);

  const resultado = recalcularEscalaCompletaNucleo({
    ordemInicialVet,
    ordemInicialTec,
    ordemMembrosVet,
    ordemMembrosTec,
    plantoesGravados: plantoes,
    afastamentos,
    periodicidadeEscala: escala.periodicidade,
    dataCongelamentoIso,
    permutas,
  });

  if (!dryRun) {
    if (Array.isArray(resultado.permutasInvalidadasIds) && resultado.permutasInvalidadasIds.length > 0) {
      await PermutaSolicitacaoModel.update(
        { status: 'invalidada' },
        { where: { id: { [Op.in]: resultado.permutasInvalidadasIds } }, transaction },
      );
    }
    for (const u of resultado.updatesVet) {
      const pl = u.plantao;
      pl.usuarioId = u.usuarioId;
      pl.observacao = null;
      if (typeof pl.save === 'function') await pl.save({ transaction });
    }
    for (const u of resultado.updatesTec) {
      const pl = u.plantao;
      pl.usuarioId = u.usuarioId;
      pl.observacao = null;
      if (typeof pl.save === 'function') await pl.save({ transaction });
    }
    if (resultado.ordemMudouVet && ordemMembrosVet.length > 0) {
      await atualizarOrdemMembrosEscalaSemColisao(
        escalaId,
        resultado.ordemFinalVet,
        transaction,
        CATEGORIA_MEMBRO.VETERINARIO,
      );
      await propagarOrdemEscalaParaOrdemGlobal(
        resultado.ordemFinalVet,
        ESCOPO_ORDEM.VETERINARIO,
        transaction,
      );
    }
    if (resultado.ordemMudouTec && ordemMembrosTec.length > 0) {
      await atualizarOrdemMembrosEscalaSemColisao(
        escalaId,
        resultado.ordemFinalTec,
        transaction,
        CATEGORIA_MEMBRO.TECNICO,
      );
      await propagarOrdemEscalaParaOrdemGlobal(
        resultado.ordemFinalTec,
        ESCOPO_ORDEM.TECNICO,
        transaction,
      );
    }
  }

  /** Versão "pública": omite as referências às instâncias Sequelize (`updatesVet/Tec`). */
  return {
    atualizados: resultado.atualizados,
    ordemMudou: resultado.ordemMudou,
    ordemMudouVet: resultado.ordemMudouVet,
    ordemMudouTec: resultado.ordemMudouTec,
    ordemInicialVet: resultado.ordemInicialVet,
    ordemInicialTec: resultado.ordemInicialTec,
    ordemFinalVet: resultado.ordemFinalVet,
    ordemFinalTec: resultado.ordemFinalTec,
    alocacoesVet: resultado.alocacoesVet,
    alocacoesTec: resultado.alocacoesTec,
    alocacoesBaseVet: resultado.alocacoesBaseVet,
    alocacoesBaseTec: resultado.alocacoesBaseTec,
    permutasInvalidadasIds: resultado.permutasInvalidadasIds,
    diffsCongeladosVet: resultado.diffsCongeladosVet,
    diffsCongeladosTec: resultado.diffsCongeladosTec,
    congelamentoIso: resultado.congelamentoIso,
    afastamentosOrdenadosIds: resultado.afastamentosOrdenadosIds,
    afastamentosRodizioIds: resultado.afastamentosRodizioIds,
  };
}

/**
 * (Recálculo total) Recalcula plantões e ordens das escalas em que o usuário participa e cujo
 * período cruza [dataInicioStr, dataFimStr], usando `recalcularEscalaCompleta` (determinístico,
 * baseado na ordem inicial gravada + lista completa de afastamentos).
 *
 * Substitui `recalcularEscalasPorUsuarioPeriodoInterno` para o fluxo de inclusão/exclusão de
 * afastamento — sem necessidade de LIFO, snapshots por evento ou bootstrap especial.
 *
 * Auditoria: registra um evento em `EscalaAuditoriaEventoModel` por categoria que mudou.
 * Permutas: cancela pendentes (compatível com o fluxo antigo).
 */
async function recalcularEscalasPorUsuarioPeriodoCompleto(
  usuarioId,
  dataInicioStr,
  dataFimStr,
  { transactionExterna = null, auditoriaContexto = null, dataCongelamentoIso = null } = {},
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
  let permutasCanceladas = 0;

  const executar = async (transaction) => {
    for (const esc of escalas) {
      const ordemInicialVet = await obterOrdemCicloReferenciaEscala(
        esc.id,
        [],
        CATEGORIA_MEMBRO.VETERINARIO,
        transaction,
      );
      const ordemInicialTec = await obterOrdemCicloReferenciaEscala(
        esc.id,
        [],
        CATEGORIA_MEMBRO.TECNICO,
        transaction,
      );

      const recalc = await recalcularEscalaCompleta(esc.id, {
        transaction,
        dataCongelamentoIso,
      });
      plantoesAtualizados += recalc.atualizados;
      if (recalc.ordemMudouVet) ordensAlteradas += 1;
      if (recalc.ordemMudouTec) ordensAlteradas += 1;
      permutasCanceladas += await cancelarPermutasPendentesEscala(esc.id, transaction);

      if (auditoriaContexto) {
        if (recalc.ordemMudouVet && ordemInicialVet.length > 0) {
          await registrarEventoAuditoriaEscala({
            escalaId: esc.id,
            categoriaMembro: CATEGORIA_MEMBRO.VETERINARIO,
            tipoEvento: auditoriaContexto.tipoEvento || 'recalculo_ordem',
            referenciaTipo: auditoriaContexto.referenciaTipo || null,
            referenciaId: auditoriaContexto.referenciaId || null,
            dataReferencia: auditoriaContexto.dataReferencia || null,
            ordemAntesUsuarioIds: recalc.ordemInicialVet,
            ordemDepoisUsuarioIds: recalc.ordemFinalVet,
            detalhes: auditoriaContexto.detalhes || null,
            criadoPorUsuarioId: auditoriaContexto.criadoPorUsuarioId || null,
            transaction,
          });
        }
        if (recalc.ordemMudouTec && ordemInicialTec.length > 0) {
          await registrarEventoAuditoriaEscala({
            escalaId: esc.id,
            categoriaMembro: CATEGORIA_MEMBRO.TECNICO,
            tipoEvento: auditoriaContexto.tipoEvento || 'recalculo_ordem',
            referenciaTipo: auditoriaContexto.referenciaTipo || null,
            referenciaId: auditoriaContexto.referenciaId || null,
            dataReferencia: auditoriaContexto.dataReferencia || null,
            ordemAntesUsuarioIds: recalc.ordemInicialTec,
            ordemDepoisUsuarioIds: recalc.ordemFinalTec,
            detalhes: auditoriaContexto.detalhes || null,
            criadoPorUsuarioId: auditoriaContexto.criadoPorUsuarioId || null,
            transaction,
          });
        }
      }
    }
  };

  if (transactionExterna) {
    await executar(transactionExterna);
  } else {
    await sequelizeTransaction(executar);
  }

  return {
    escalasAfetadas: escalas.length,
    plantoesAtualizados,
    ordensAlteradas,
    ordemGlobalAlterada: false,
    permutasCanceladas,
  };
}

/**
 * Recalcula plantões e ordens das escalas em que o usuário participa e cujo período cruza [dataInicioStr, dataFimStr].
 */
async function recalcularEscalasPorUsuarioPeriodoInterno(
  usuarioId,
  dataInicioStr,
  dataFimStr,
  { transactionExterna = null, historicoMotivo = 'recalculo', historicoAfastamento = null, auditoriaContexto = null } = {},
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
        auditoriaContexto,
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
        auditoriaContexto,
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

  obterIdsAfastamentosMaisRecentesPorClasse: (transaction) => obterIdsAfastamentosMaisRecentesPorClasse(transaction),
  enriquecerRelevanciaEscalaAtivaAfastamentos: (lista) => enriquecerRelevanciaEscalaAtivaAfastamentos(lista),

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
          include: [{ model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login', 'suspensoEscala'] }],
        },
        {
          model: PlantaoModel,
          as: 'plantaoDestino',
          attributes: ['id', 'dataReferencia', 'usuarioId', 'observacao'],
          required: false,
          include: [{ model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login', 'suspensoEscala'] }],
        },
      ],
      order: [['createdAt', 'DESC']],
    });
    const lista = rows.map((r) => r.get({ plain: true }));

    /**
     * Para permutas por ordinal (ativa/pendente) resolve a data ATUAL de cada lado no calendário
     * base de cada escala, para exibição (a snapshot pode estar defasada após recálculos).
     */
    const escalaIds = [
      ...new Set(
        lista
          .filter((p) => ['ativa', 'pendente'].includes(String(p.status || '').toLowerCase()))
          .map((p) => Number(p.escalaId)),
      ),
    ];
    const baseporEscala = new Map();
    for (const eid of escalaIds) {
      try {
        baseporEscala.set(eid, await calcularBaseOrdinaisEscala(eid));
      } catch (_e) {
        baseporEscala.set(eid, null);
      }
    }
    for (const p of lista) {
      const base = baseporEscala.get(Number(p.escalaId));
      if (!base || !p.ordinalSolicitante || !p.ordinalDestinatario) continue;
      const cat = String(p.categoria || CATEGORIA_PLANTAO.VETERINARIO).toLowerCase();
      const mapa = cat === CATEGORIA_PLANTAO.TECNICO ? base.datasPorUsuarioTec : base.datasPorUsuarioVet;
      const datasS = mapa.get(Number(p.solicitanteUsuarioId)) || [];
      const datasD = mapa.get(Number(p.destinatarioUsuarioId)) || [];
      p.dataOrigemAtual = datasS[Number(p.ordinalSolicitante) - 1] || null;
      p.dataDestinoAtual = datasD[Number(p.ordinalDestinatario) - 1] || null;
    }
    return lista;
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
      /** Revalida o par por ordinal sobre o calendário base atual antes de ativar o overlay. */
      await validarSlotsPermutaOrdinalDisponiveis(row, t);
      row.status = 'ativa';
      row.plantaoOrigemId = null;
      row.plantaoDestinoId = null;
      await row.save({ transaction: t });
      await recalcularEscalaCompleta(row.escalaId, { transaction: t });
      return row.get({ plain: true });
    });
  },

  excluirPermutaAdministrador: async (adminUsuarioId, permutaId) => {
    const admin = await EscalaService.usuarioEhAdministrador(adminUsuarioId);
    if (!admin) {
      throw new ApiBaseError('Apenas administradores podem excluir permutas por este fluxo.');
    }
    const id = parseInt(permutaId, 10);
    if (!Number.isFinite(id)) throw new ApiBaseError('ID inválido.');

    return await sequelizeTransaction(async (t) => {
      const row = await PermutaSolicitacaoModel.findByPk(id, { transaction: t });
      if (!row) throw new ApiBaseError('Permuta não encontrada.');
      const escalaId = Number(row.escalaId);
      const eraAtiva = String(row.status || '').toLowerCase() === 'ativa';
      await row.destroy({ transaction: t });
      /** Sem o overlay desta permuta, o recálculo restaura os titulares do rodízio base. */
      if (eraAtiva) {
        await recalcularEscalaCompleta(escalaId, { transaction: t });
      }
      return { removido: true, id };
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
          include: [{ model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login', 'suspensoEscala'] }],
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
      include: [{ model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login', 'suspensoEscala'] }],
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

    const ServidorService = require('./servidor.service');
    const vets = await UsuarioModel.findAll({
      include: [
        {
          model: UsuarioPapelModel,
          required: true,
          where: { PapelModelId: papelVet.id },
        },
      ],
      where: { ativo: true, ...ServidorService.whereNaoAguardandoOrdemEscopo(ESCOPO_ORDEM.VETERINARIO) },
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

    const ServidorService = require('./servidor.service');
    const tecs = await UsuarioModel.findAll({
      include: [
        {
          model: UsuarioPapelModel,
          required: true,
          where: { PapelModelId: papelT.id },
        },
      ],
      where: { ativo: true, ...ServidorService.whereNaoAguardandoOrdemEscopo(ESCOPO_ORDEM.TECNICO) },
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

  listarAuditoriaEscalasAbertas: async (categoriaParam = CATEGORIA_MEMBRO.VETERINARIO) => {
    const categoria =
      String(categoriaParam || '').toLowerCase() === CATEGORIA_MEMBRO.TECNICO ? CATEGORIA_MEMBRO.TECNICO : CATEGORIA_MEMBRO.VETERINARIO;

    const escalas = await EscalaModel.findAll({
      attributes: ['id', 'nome', 'dataInicio', 'dataFim', 'status'],
      order: [['dataInicio', 'DESC']],
    });
    if (escalas.length === 0) return [];

    const escalaIds = escalas.map((e) => Number(e.id));
    const eventos = await EscalaAuditoriaEventoModel.findAll({
      where: { escalaId: { [Op.in]: escalaIds }, categoriaMembro: categoria },
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
    });

    const afastamentoRefIds = [
      ...new Set(
        eventos
          .filter((e) => String(e.referenciaTipo || '') === 'afastamento' && Number.isFinite(Number(e.referenciaId)))
          .map((e) => Number(e.referenciaId)),
      ),
    ];
    const afastamentosRef =
      afastamentoRefIds.length > 0
        ? await AfastamentoModel.findAll({
            where: { id: { [Op.in]: afastamentoRefIds } },
            include: [{ model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login'] }],
            attributes: ['id', 'usuarioId'],
          })
        : [];
    const afastamentoServidorMap = new Map(
      afastamentosRef.map((a) => {
        const ap = a.get ? a.get({ plain: true }) : a;
        return [
          Number(ap.id),
          {
            usuarioId: Number(ap.usuarioId),
            nome: ap?.usuario?.nome || null,
            login: ap?.usuario?.login || null,
          },
        ];
      }),
    );

    const idsUsuarios = new Set();
    for (const ev of eventos) {
      const antes = Array.isArray(ev.ordemAntesUsuarioIds) ? ev.ordemAntesUsuarioIds : [];
      const depois = Array.isArray(ev.ordemDepoisUsuarioIds) ? ev.ordemDepoisUsuarioIds : [];
      for (const id of [...antes, ...depois]) {
        const n = Number(id);
        if (Number.isFinite(n) && n > 0) idsUsuarios.add(n);
      }
    }
    const rowsUsuarios =
      idsUsuarios.size > 0
        ? await UsuarioModel.findAll({
            where: { id: { [Op.in]: [...idsUsuarios] } },
            attributes: ['id', 'nome', 'login'],
          })
        : [];
    const usuarioMap = new Map(rowsUsuarios.map((u) => [Number(u.id), u.get({ plain: true })]));

    const nomeOrdem = (arr) =>
      (Array.isArray(arr) ? arr : []).map((id) => {
        const uid = Number(id);
        const u = usuarioMap.get(uid);
        return { usuarioId: uid, nome: u?.nome || null, login: u?.login || null };
      });

    const eventosPorEscala = new Map();
    for (const evRow of eventos) {
      const ev = evRow.get ? evRow.get({ plain: true }) : evRow;
      const detalhesBase = ev.detalhes && typeof ev.detalhes === 'object' ? { ...ev.detalhes } : {};
      const refAfast = String(ev.referenciaTipo || '') === 'afastamento' ? afastamentoServidorMap.get(Number(ev.referenciaId)) : null;
      if (refAfast) {
        detalhesBase.servidorRelacionado = {
          usuarioId: refAfast.usuarioId,
          nome: refAfast.nome,
          login: refAfast.login,
          papel: String(ev.categoriaMembro || '') === CATEGORIA_MEMBRO.TECNICO ? 'Técnico' : 'Veterinário',
        };
      } else if (detalhesBase?.servidorRelacionado && !detalhesBase.servidorRelacionado.papel) {
        detalhesBase.servidorRelacionado.papel =
          String(ev.categoriaMembro || '') === CATEGORIA_MEMBRO.TECNICO ? 'Técnico' : 'Veterinário';
      }
      const arr = eventosPorEscala.get(Number(ev.escalaId)) || [];
      arr.push({
        id: Number(ev.id),
        categoriaMembro: ev.categoriaMembro,
        tipoEvento: ev.tipoEvento,
        referenciaTipo: ev.referenciaTipo || null,
        referenciaId: ev.referenciaId != null ? Number(ev.referenciaId) : null,
        dataReferencia: ev.dataReferencia || null,
        detalhes: detalhesBase,
        createdAt: ev.createdAt,
        ordemAntes: nomeOrdem(ev.ordemAntesUsuarioIds),
        ordemDepois: nomeOrdem(ev.ordemDepoisUsuarioIds),
      });
      eventosPorEscala.set(Number(ev.escalaId), arr);
    }

    return escalas.map((eRow) => {
      const e = eRow.get ? eRow.get({ plain: true }) : eRow;
      return {
        escalaId: Number(e.id),
        nome: e.nome,
        dataInicio: dataReferenciaParaStr(e.dataInicio),
        dataFim: dataReferenciaParaStr(e.dataFim),
        status: e.status,
        categoriaMembro: categoria,
        eventos: eventosPorEscala.get(Number(e.id)) || [],
      };
    });
  },

  salvarOrdemServidores: async (usuarioIds, escopoParam = ESCOPO_ORDEM.VETERINARIO) => {
    const escopo =
      String(escopoParam || '').toLowerCase() === ESCOPO_ORDEM.TECNICO ? ESCOPO_ORDEM.TECNICO : ESCOPO_ORDEM.VETERINARIO;

    const escalaBloqueiaOrdem = await EscalaModel.findOne({
      where: { status: { [Op.in]: ['rascunho', 'ativa'] } },
      attributes: ['id'],
    });
    if (escalaBloqueiaOrdem) {
      throw new ApiBaseError(
        'Há escala em rascunho ou ativa. A ordem dos servidores só pode ser alterada quando não houver escalas nesses status.',
      );
    }

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
          status: 'rascunho',
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
      await registrarEventoAuditoriaEscala({
        escalaId: escala.id,
        categoriaMembro: CATEGORIA_MEMBRO.VETERINARIO,
        tipoEvento: 'ordem_inicial',
        ordemDepoisUsuarioIds: ordemListaVet.map((m) => m.usuarioId),
        detalhes: { origem: 'criacao_escala' },
        criadoPorUsuarioId: criadoPorUsuarioId || null,
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
      await registrarEventoAuditoriaEscala({
        escalaId: escala.id,
        categoriaMembro: CATEGORIA_MEMBRO.TECNICO,
        tipoEvento: 'ordem_inicial',
        ordemDepoisUsuarioIds: ordemListaTec.map((m) => m.usuarioId),
        detalhes: { origem: 'criacao_escala' },
        criadoPorUsuarioId: criadoPorUsuarioId || null,
        transaction: t,
      });

      if (datas.length > 0) {
        const recalcCriacao = await recalcularEscalaInterno(escala.id, {
          transaction: t,
          historicoMotivo: 'recalculo',
        });

        const idsVet = ordemListaVet.map((m) => Number(m.usuarioId)).filter((id) => Number.isFinite(id) && id > 0);
        const idsTec = ordemListaTec.map((m) => Number(m.usuarioId)).filter((id) => Number.isFinite(id) && id > 0);
        const afastamentosSobrepostos = await AfastamentoModel.findAll({
          where: {
            usuarioId: { [Op.in]: [...new Set([...idsVet, ...idsTec])] },
            dataInicio: { [Op.lte]: dataFim },
            dataFim: { [Op.gte]: dataInicio },
          },
          include: [
            { model: UsuarioModel, as: 'usuario', attributes: ['id', 'nome', 'login'] },
            { model: TipoAfastamentoModel, as: 'tipo', attributes: ['id', 'tipo'] },
          ],
          transaction: t,
        });
        const afVet = afastamentosSobrepostos
          .filter((af) => idsVet.includes(Number(af.usuarioId)))
          .map((af) => {
            const p = af.get ? af.get({ plain: true }) : af;
            return {
              afastamentoId: Number(p.id),
              usuarioId: Number(p.usuarioId),
              nome: p?.usuario?.nome || null,
              login: p?.usuario?.login || null,
              papel: 'Veterinário',
              tipo: p?.tipo?.tipo || null,
              dataInicio: dataReferenciaParaStr(p.dataInicio),
              dataFim: dataReferenciaParaStr(p.dataFim),
            };
          });
        const afTec = afastamentosSobrepostos
          .filter((af) => idsTec.includes(Number(af.usuarioId)))
          .map((af) => {
            const p = af.get ? af.get({ plain: true }) : af;
            return {
              afastamentoId: Number(p.id),
              usuarioId: Number(p.usuarioId),
              nome: p?.usuario?.nome || null,
              login: p?.usuario?.login || null,
              papel: 'Técnico',
              tipo: p?.tipo?.tipo || null,
              dataInicio: dataReferenciaParaStr(p.dataInicio),
              dataFim: dataReferenciaParaStr(p.dataFim),
            };
          });

        if (afVet.length > 0) {
          await registrarEventoAuditoriaEscala({
            escalaId: escala.id,
            categoriaMembro: CATEGORIA_MEMBRO.VETERINARIO,
            tipoEvento: 'afastamento_preexistente_na_criacao',
            referenciaTipo: 'escala',
            referenciaId: escala.id,
            ordemAntesUsuarioIds: recalcCriacao.ordemInicialVet || ordemListaVet.map((m) => m.usuarioId),
            ordemDepoisUsuarioIds: recalcCriacao.ordemAtualVet || ordemListaVet.map((m) => m.usuarioId),
            detalhes: { afastamentos: afVet },
            criadoPorUsuarioId: criadoPorUsuarioId || null,
            transaction: t,
          });
        }
        if (afTec.length > 0) {
          await registrarEventoAuditoriaEscala({
            escalaId: escala.id,
            categoriaMembro: CATEGORIA_MEMBRO.TECNICO,
            tipoEvento: 'afastamento_preexistente_na_criacao',
            referenciaTipo: 'escala',
            referenciaId: escala.id,
            ordemAntesUsuarioIds: recalcCriacao.ordemInicialTec || ordemListaTec.map((m) => m.usuarioId),
            ordemDepoisUsuarioIds: recalcCriacao.ordemAtualTec || ordemListaTec.map((m) => m.usuarioId),
            detalhes: { afastamentos: afTec },
            criadoPorUsuarioId: criadoPorUsuarioId || null,
            transaction: t,
          });
        }
      }

      return escala;
    });
  },

  adicionarDatasPlantaoExtras: async (escalaId, datasPlantaoExtras, criadoPorUsuarioId = null) => {
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

    const escalaAtiva = String(escala.status || '').toLowerCase() === 'ativa';
    if (escalaAtiva) {
      return await sequelizeTransaction(async (t) => {
        const resp = await criarPlantoesDatasExtrasModoGestao(escala, novas, criadoPorUsuarioId, t);
        await reaplicarOverlayPermutasPersistido(escalaId, t);
        return resp;
      });
    }

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
        auditoriaContexto: {
          tipoEvento: 'feriado_inclusao',
          referenciaTipo: 'escala',
          referenciaId: escalaId,
          detalhes: { datas: novas },
          criadoPorUsuarioId,
        },
      });
      const permutasCanceladas = await cancelarPermutasPendentesEscala(escalaId, t);
      await reaplicarOverlayPermutasPersistido(escalaId, t);
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
   * Remove o afastamento e recalcula as escalas via `recalcularEscalaCompleta` (determinístico,
   * baseado na ordem inicial gravada). Permite excluir QUALQUER afastamento — não exige LIFO.
   */
  desfazerAfastamentoRecalculo: async (afastamentoPlain, transaction, criadoPorUsuarioId = null) => {
    const id = Number(afastamentoPlain.id);
    const usuarioId = Number(afastamentoPlain.usuarioId);
    const dataInicioStr = dataReferenciaParaStr(afastamentoPlain.dataInicio);
    const dataFimStr = dataReferenciaParaStr(afastamentoPlain.dataFim);
    const usuarioRef = await UsuarioModel.findByPk(usuarioId, {
      attributes: ['id', 'nome', 'login'],
      transaction,
    });
    const usuarioRefPlain = usuarioRef && usuarioRef.get ? usuarioRef.get({ plain: true }) : null;
    const escopoAf = await escopoOrdemGlobalParaUsuarioId(usuarioId, transaction);
    const categoriaAlvo = escopoAf === ESCOPO_ORDEM.TECNICO ? CATEGORIA_MEMBRO.TECNICO : CATEGORIA_MEMBRO.VETERINARIO;

    await AfastamentoModel.destroy({ where: { id }, transaction });

    return await recalcularEscalasPorUsuarioPeriodoCompleto(usuarioId, dataInicioStr, dataFimStr, {
      transactionExterna: transaction,
      auditoriaContexto: {
        tipoEvento: 'afastamento_exclusao',
        referenciaTipo: 'afastamento',
        referenciaId: id,
        detalhes: {
          dataInicio: dataInicioStr,
          dataFim: dataFimStr,
          usuarioId,
          tipoAfastamento: afastamentoPlain?.tipo?.tipo || null,
          servidorRelacionado: {
            usuarioId,
            nome: usuarioRefPlain?.nome || null,
            login: usuarioRefPlain?.login || null,
            papel: categoriaAlvo === CATEGORIA_MEMBRO.TECNICO ? 'Técnico' : 'Veterinário',
          },
        },
        criadoPorUsuarioId,
        categoriaAlvo,
      },
    });
  },

  /**
   * (Fase 1 — recálculo total) Recalcula plantões e ordem da escala a partir da ordem inicial
   * gravada (`motivo='inicial'`) e da lista COMPLETA de afastamentos. Ainda não está integrada
   * ao fluxo de cadastro/exclusão de afastamentos; é chamada apenas em testes/depuração.
   */
  recalcularEscalaCompleta: async (escalaId, options = {}) =>
    recalcularEscalaCompleta(escalaId, options),

  recalcularEscalasPorAfastamento: async (afastamentoId, options = {}) => {
    const transactionExterna = options.transaction || null;
    const criadoPorUsuarioId = options.criadoPorUsuarioId || null;
    const afastamento = await AfastamentoModel.findByPk(afastamentoId, {
      include: [{ model: TipoAfastamentoModel, as: 'tipo', attributes: ['id', 'tipo', 'regraOrdem'] }],
      transaction: transactionExterna || undefined,
    });
    if (!afastamento) throw new ApiBaseError('Afastamento não encontrado para recálculo.');

    const escopoAf = await escopoOrdemGlobalParaUsuarioId(afastamento.usuarioId, transactionExterna || undefined);

    const dataInicioStr = dataReferenciaParaStr(afastamento.dataInicio);
    const dataFimStr = dataReferenciaParaStr(afastamento.dataFim);
    const resultado = await recalcularEscalasPorUsuarioPeriodoCompleto(
      afastamento.usuarioId,
      dataInicioStr,
      dataFimStr,
      {
        transactionExterna,
        auditoriaContexto: {
          tipoEvento: 'afastamento_inclusao',
          referenciaTipo: 'afastamento',
          referenciaId: Number(afastamento.id),
          detalhes: {
            dataInicio: dataInicioStr,
            dataFim: dataFimStr,
            usuarioId: Number(afastamento.usuarioId),
            tipoAfastamento: afastamento?.tipo?.tipo || null,
          },
          criadoPorUsuarioId,
          categoriaAlvo: escopoAf === ESCOPO_ORDEM.TECNICO ? CATEGORIA_MEMBRO.TECNICO : CATEGORIA_MEMBRO.VETERINARIO,
        },
      },
    );

    return {
      afastamentoId: Number(afastamento.id),
      ...resultado,
    };
  },

  /**
   * Lista, por servidor, os plantões do calendário BASE (rodízio puro, sem permutas) de cada
   * categoria, já numerados (1º, 2º, 3º…) por data. Base do cadastro de permutas por ordinal:
   * o admin escolhe servidor + número do plantão, e a troca "segue o nome" mesmo se a data mudar.
   */
  listarPlantoesBaseParaPermuta: async (escalaId) => {
    const eid = parseInt(escalaId, 10);
    if (!Number.isFinite(eid) || eid < 1) throw new ApiBaseError('Identificador da escala inválido.');
    const base = await calcularBaseOrdinaisEscala(eid);

    const idsUnicos = [
      ...new Set([...base.datasPorUsuarioVet.keys(), ...base.datasPorUsuarioTec.keys()].map((x) => Number(x))),
    ].filter((x) => Number.isFinite(x) && x > 0);
    const usuarios = idsUnicos.length
      ? await UsuarioModel.findAll({ where: { id: { [Op.in]: idsUnicos } }, attributes: ['id', 'nome', 'login'] })
      : [];
    const mapaNome = new Map(usuarios.map((u) => [Number(u.id), u.get({ plain: true })]));

    const montar = (mapa, categoria) =>
      [...mapa.entries()]
        .map(([usuarioId, datas]) => {
          const u = mapaNome.get(Number(usuarioId));
          return {
            usuarioId: Number(usuarioId),
            nome: u ? u.nome : null,
            login: u ? u.login : null,
            categoria,
            plantoes: datas.map((dataIso, i) => ({ ordinal: i + 1, dataReferencia: dataIso })),
          };
        })
        .filter((s) => s.plantoes.length > 0)
        .sort((a, b) => compararUsuariosPorNomeAlfabetico(a, b));

    return {
      escalaId: eid,
      veterinarios: montar(base.datasPorUsuarioVet, CATEGORIA_PLANTAO.VETERINARIO),
      tecnicos: montar(base.datasPorUsuarioTec, CATEGORIA_PLANTAO.TECNICO),
    };
  },

  /**
   * Veterinário solicita permuta escolhendo seu plantão (origem) e o de outro vet (destino) no
   * calendário. As datas são traduzidas para ordinais no calendário BASE; assim o pedido segue o
   * novo modelo por ordinal e a troca passa a "seguir o nome" após o aceite.
   */
  solicitarPermuta: async (escalaId, solicitanteUsuarioId, payload = {}) => {
    const eid = parseInt(escalaId, 10);
    if (!Number.isFinite(eid) || eid < 1) throw new ApiBaseError('Informe a escala.');
    const oid = parseInt(payload.plantaoOrigemId, 10);
    const did = parseInt(payload.plantaoDestinoId, 10);
    if (!oid || !did || oid === did) {
      throw new ApiBaseError('Informe plantão de origem e de destino válidos e diferentes.');
    }
    const categoria = CATEGORIA_PLANTAO.VETERINARIO;

    return await sequelizeTransaction(async (t) => {
      const [pOrigem, pDestino] = await Promise.all([
        PlantaoModel.findOne({ where: { id: oid, escalaId: eid }, transaction: t }),
        PlantaoModel.findOne({ where: { id: did, escalaId: eid }, transaction: t }),
      ]);
      if (!pOrigem || !pDestino) throw new ApiBaseError('Plantão não encontrado nesta escala.');
      if (categoriaPlantaoDe(pOrigem) !== CATEGORIA_PLANTAO.VETERINARIO || categoriaPlantaoDe(pDestino) !== CATEGORIA_PLANTAO.VETERINARIO) {
        throw new ApiBaseError('A permuta pelo perfil veterinário só vale entre plantões de veterinário.');
      }

      const base = await calcularBaseOrdinaisEscala(eid, t);
      const dataOrigem = dataReferenciaParaStr(pOrigem.dataReferencia);
      const dataDestino = dataReferenciaParaStr(pDestino.dataReferencia);
      const ro = resolverOrdinalPorDataNoMapa(base.datasPorUsuarioVet, dataOrigem);
      const rd = resolverOrdinalPorDataNoMapa(base.datasPorUsuarioVet, dataDestino);
      if (!ro) throw new ApiBaseError('Não foi possível identificar o seu plantão no rodízio base.');
      if (!rd) throw new ApiBaseError('Não foi possível identificar o plantão desejado no rodízio base.');
      if (ro.usuarioId !== Number(solicitanteUsuarioId)) {
        throw new ApiBaseError('O plantão de origem deve ser seu (no rodízio base) e ainda não estar permutado.');
      }
      if (rd.usuarioId === Number(solicitanteUsuarioId)) {
        throw new ApiBaseError('Escolha o plantão de outro veterinário para solicitar a permuta.');
      }

      const { dataA, dataB } = await resolverPermutaOrdinal(
        {
          escalaId: eid,
          categoria,
          usuarioA: solicitanteUsuarioId,
          ordinalA: ro.ordinal,
          usuarioB: rd.usuarioId,
          ordinalB: rd.ordinal,
        },
        t,
      );
      const row = await PermutaSolicitacaoModel.create(
        {
          escalaId: eid,
          solicitanteUsuarioId: Number(solicitanteUsuarioId),
          destinatarioUsuarioId: rd.usuarioId,
          categoria,
          ordinalSolicitante: ro.ordinal,
          ordinalDestinatario: rd.ordinal,
          dataOrigemSnapshot: dataA,
          dataDestinoSnapshot: dataB,
          status: 'pendente',
        },
        { transaction: t },
      );
      return row.get({ plain: true });
    });
  },

  /**
   * Admin: cadastra uma permuta por ordinal já em vigor (status 'ativa'). A troca é aplicada como
   * overlay no recálculo — não há troca física de linha de plantão amarrada a IDs.
   */
  criarPermutaAdministrador: async (adminUsuarioId, payload = {}) => {
    const admin = await EscalaService.usuarioEhAdministrador(adminUsuarioId);
    if (!admin) {
      throw new ApiBaseError('Apenas administradores podem cadastrar permutas por este fluxo.');
    }
    const eid = parseInt(payload.escalaId, 10);
    const categoria = normalizarCategoriaPermuta(payload.categoria);
    const usuarioA = Number(payload.solicitanteUsuarioId);
    const ordinalA = Number(payload.ordinalSolicitante);
    const usuarioB = Number(payload.destinatarioUsuarioId);
    const ordinalB = Number(payload.ordinalDestinatario);

    return await sequelizeTransaction(async (t) => {
      const { dataA, dataB } = await resolverPermutaOrdinal(
        { escalaId: eid, categoria, usuarioA, ordinalA, usuarioB, ordinalB },
        t,
      );
      const row = await PermutaSolicitacaoModel.create(
        {
          escalaId: eid,
          solicitanteUsuarioId: usuarioA,
          destinatarioUsuarioId: usuarioB,
          categoria,
          ordinalSolicitante: ordinalA,
          ordinalDestinatario: ordinalB,
          dataOrigemSnapshot: dataA,
          dataDestinoSnapshot: dataB,
          status: 'ativa',
        },
        { transaction: t },
      );
      await recalcularEscalaCompleta(eid, { transaction: t });
      return row.get({ plain: true });
    });
  },

  removerPlantoesFeriadosFacultativos: async (escalaId, plantaoIdsRaw, criadoPorUsuarioId = null) => {
    const ids = Array.isArray(plantaoIdsRaw)
      ? [...new Set(plantaoIdsRaw.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x) && x > 0))]
      : [];
    if (ids.length === 0) throw new ApiBaseError('Informe ao menos um plantão a remover.');

    const escala = await EscalaModel.findByPk(escalaId);
    if (!escala) throw new ApiBaseError('Escala não encontrada.');
    if (String(escala.status || '').toLowerCase() === 'ativa') {
      throw new ApiBaseError(
        'Não é possível remover feriados ou datas adicionais enquanto a escala estiver ativa. Conclua a escala ou altere o status antes de remover.',
      );
    }

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
        auditoriaContexto: {
          tipoEvento: 'feriado_exclusao',
          referenciaTipo: 'escala',
          referenciaId: escalaId,
          detalhes: { plantaoIds: ids },
          criadoPorUsuarioId,
        },
      });
      const permutasCanceladas = await cancelarPermutasPendentesEscala(escalaId, t);
      await reaplicarOverlayPermutasPersistido(escalaId, t);

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

      const ServidorService = require('./servidor.service');
      await ServidorService.promoverAguardandoOrdemGlobal(ESCOPO_ORDEM.VETERINARIO, t);
      await ServidorService.promoverAguardandoOrdemGlobal(ESCOPO_ORDEM.TECNICO, t);

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
      await restaurarOrdemGlobalPreExclusaoEscala(id, t);
      await PermutaSolicitacaoModel.destroy({ where: { escalaId: id }, transaction: t });
      await PlantaoModel.destroy({ where: { escalaId: id }, transaction: t });
      await EscalaAuditoriaEventoModel.destroy({ where: { escalaId: id }, transaction: t });
      await EscalaOrdemHistoricoModel.destroy({ where: { escalaId: id }, transaction: t });
      await ImpedimentoModel.destroy({ where: { escalaId: id }, transaction: t });
      await EscalaMembroModel.destroy({ where: { escalaId: id }, transaction: t });
      await EscalaModel.destroy({ where: { id }, transaction: t });
    });
    return true;
  },
};

EscalaService.__testables = {
  escolherRetornoFeriasDoDia,
  enfileirarRetornosFeriasDoDia,
  montarRetornosFeriasNoPrimeiroPlantao,
  usuarioIndisponivelParaPlantaoNoDia,
  usuarioBloqueadoRetroCadastroFeriasAbonoNoDia,
  calcularDataInicioRetroCadastro,
  existeDiaUtilNoIntervalo,
  adicionarDiasIso,
  primeiroDiaMesSeguinte,
  escalaCobreNoMaximoDoisMeses,
  sincronizarCalendarioRodizioPlenoEscalaBimestre,
  ordemVetPersistidaBimestreFocado,
  obterIdxRodizioAposUltimoPlantaoAntesDe,
  usuarioRetornoFeriasAbonoJaRealizadoAntesDe,
  sincronizarIdxOrdemDePlantoes,
  plantaoRequerRecalculoFocado,
  plantaoRequerRecalculoFocadoVet,
  plantaoRequerRecalculoFocadoTec,
  primeiraDataPlantaoRetornoPosFeriasOuAbono,
  ultimoDiaPlantaoRetroCadastroAntesInicio,
  derivarOrdemVetRodizioConsistenteComPlantoes,
  alinharPlantaoVetDiaComRodizioPleno,
  espelharPlantoesVetMesSeguintePeloMesAnterior,
  prioridadeRetornoCicloUsuario,
  buscarProximoUsuarioDisponivelNoCiclo,
  processarRetroativoFocadoEmLote,
  corrigirCoberturaDuplicadaAposRetro,
  normalizarOrdemRodizioCompleta,
  aplicarOrdemInicialHistoricoRodizio,
  afastamentoExigeRecalculoPlenoComHistoricoInicial,
  rotacionarOrdemParaProximoPreferencial,
  simularRodizioVetPlantoes,
  plantaoVetMesmaPessoaNoFimDeSemanaAnterior,
  simularRodizioTecPlantoes,
  aplicarRetornosFeriasPendentesPosEscala,
  simularRodizioTecModoFocado,
  corrigirDuplicatasTecnicosMesmoDia,
  textoGestaoDataAdicionalPlantao,
  restaurarOrdemGlobalPreExclusaoEscala,
  obterIdsAfastamentosMaisRecentesPorClasse,
  afastamentoEhMaisRecenteDaClasse,
  restaurarEstadoAntesAfastamento,
  montarParametrosFiltroAfastamentoPlantoes,
  afastamentoFeriasOuAbonoAlteraPlantoesDoUsuario,
  afastamentoFeriasOuAbonoTemPlantaoTitularNoPeriodo,
  afastamentoFeriasOuAbonoRedundanteNoCalendario,
  afastamentoFeriasOuAbonoRelevanteNoRodizio,
  filtrarAfastamentosFeriasAbonoSemEfeitoEmPlantoes,
  afastamentosEfetivosRodizioEscala,
  afastamentosParaSimulacaoPlenaCategoria,
  afastamentoFeriasOuAbonoEntraNoRodizio,
  abonoMudaAlgumPlantaoDoRodizio,
  afastamentosListaParaRodizioEscala,
  obterEscalasAbertasRelevancia,
  montarContextoRelevanciaEscala,
  obterContextoRelevanciaEscalaAtiva,
  resolverContextoRelevanciaAfastamento,
  afastamentoFeriasOuAbonoTitularEscaladoNoPeriodoSemAfastamento,
  afastamentoFeriasOuAbonoTitularPerdeAlgumPlantao,
  afastamentoFeriasOuAbonoContribuiParaCalendarioGravado,
  afastamentosListaSemRegistro,
  afastamentoFeriasOuAbonoNaoAlteraRodizioComVsSem,
  afastamentoFeriasOuAbonoRelevanteParaTagEscala,
  afastamentoFeriasOuAbonoContribuiCalendarioNoPeriodoRetro,
  classificarRelevanciaAfastamentoEscalaAtiva,
  enriquecerRelevanciaEscalaAtivaAfastamentos,
  recalcularEscalaCompleta,
  recalcularEscalaCompletaNucleo,
  mapaDatasOrdenadasPorUsuario,
  aplicarOverlayPermutasNasAlocacoes,
};

module.exports = EscalaService;
