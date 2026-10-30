// Camada de dados. Toda a aplicação passa por aqui; as funções são assíncronas
// para que esta implementação (localStorage) possa ser trocada por Supabase
// sem alterar as vistas.
import { buildSeed, notificationText, seedMessages, seedRegistrations } from './seed.js';
import { isoDate, monthKey, monthShort, defaultPayer } from './format.js';

const KEY = 'nl.db.v1';
const SESSION = 'nl.session.v1';

let db = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      // Migração: dados guardados antes de existirem mensagens
      if (!data.messages) { data.messages = seedMessages(); save(data); }
      if (!data.registos) { data.registos = true; data.members.push(...seedRegistrations()); save(data); }
      if (data.contributions.some((c) => c.pagador === undefined)) {
        const byId = new Map(data.members.map((m) => [m.id, m]));
        for (const c of data.contributions) if (c.pagador === undefined) c.pagador = defaultPayer(byId.get(c.membroId), c.metodo);
        save(data);
      }
      return data;
    }
  } catch { /* dados corrompidos: recomeça */ }
  const fresh = buildSeed();
  save(fresh);
  return fresh;
}

function save(data = db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    throw new Error('O armazenamento do navegador está cheio. Anexe um comprovativo mais pequeno.');
  }
}

const uid = (p) => p + Math.random().toString(36).slice(2, 10);
const sum = (list) => list.reduce((s, c) => s + c.valor, 0);
const byRecent = (a, b) => b.data.localeCompare(a.data) || b.declaradoEm.localeCompare(a.declaradoEm);

// Sessão --------------------------------------------------------------------
export async function getSessionUser() {
  const id = localStorage.getItem(SESSION);
  const m = id ? db.members.find((x) => x.id === id) : null;
  return m && isActive(m) ? m : null;
}

export async function findMemberByPhone(telefone) {
  return db.members.find((m) => m.telefone === telefone) || null;
}

// Estados do membro: pendente (aguarda aprovação) · ativo · suspenso · recusado
const isActive = (m) => !m.estado || m.estado === 'ativo';

export async function signIn(telefone, pin) {
  const m = await findMemberByPhone(telefone);
  if (!m || !isActive(m) || m.pin !== pin) return null;
  localStorage.setItem(SESSION, m.id);
  return m;
}

export async function signOut() {
  localStorage.removeItem(SESSION);
}

export async function resetDemo() {
  db = buildSeed();
  save();
}

// Obra ----------------------------------------------------------------------
export async function getSettings() {
  return { ...db.settings };
}

export async function updateSettings(patch) {
  Object.assign(db.settings, patch);
  save();
  return { ...db.settings };
}

export async function obraSummary() {
  const conf = db.contributions.filter((c) => c.estado === 'confirmado');
  const pend = db.contributions.filter((c) => c.estado === 'pendente');
  const arrecadado = sum(conf);
  const meta = db.settings.meta;
  return {
    arrecadado,
    meta,
    pct: meta ? (arrecadado / meta) * 100 : 0,
    falta: Math.max(0, meta - arrecadado),
    confirmadas: conf.length,
    contribuintes: new Set(conf.map((c) => c.membroId)).size,
    pendentes: pend.length,
    pendentesValor: sum(pend),
  };
}

// Valores confirmados por mês, desde o início da campanha (máx. 12 meses)
export async function monthlySeries() {
  const nowKey = monthKey(isoDate());
  const keys = [];
  const d = new Date(db.settings.inicio + 'T00:00:00');
  while (true) {
    const k = isoDate(d).slice(0, 7);
    if (k > nowKey) break;
    keys.push(k);
    d.setMonth(d.getMonth() + 1);
  }
  return keys.slice(-12).map((key) => {
    const list = db.contributions.filter((c) => c.estado === 'confirmado' && monthKey(c.data) === key);
    return { key, label: monthShort(key), value: sum(list), contribuintes: new Set(list.map((c) => c.membroId)).size, current: key === nowKey };
  });
}

export async function methodBreakdown() {
  const conf = db.contributions.filter((c) => c.estado === 'confirmado');
  const total = sum(conf) || 1;
  return ['mpesa', 'emola', 'banco', 'numerario'].map((metodo) => {
    const v = sum(conf.filter((c) => c.metodo === metodo));
    return { metodo, valor: v, pct: (v / total) * 100 };
  });
}

// Membros -------------------------------------------------------------------
export async function listMembers() {
  return db.members.filter((m) => m.role === 'membro' && (isActive(m) || m.estado === 'suspenso')).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}

export async function getMember(id) {
  return db.members.find((m) => m.id === id) || null;
}

export async function memberStats() {
  const stats = new Map();
  for (const c of db.contributions) {
    if (c.estado !== 'confirmado') continue;
    const s = stats.get(c.membroId) || { count: 0, total: 0, ultima: null };
    s.count += 1; s.total += c.valor;
    if (!s.ultima || c.data > s.ultima) s.ultima = c.data;
    stats.set(c.membroId, s);
  }
  return stats;
}

export async function memberSummary(id) {
  const mine = db.contributions.filter((c) => c.membroId === id);
  const conf = mine.filter((c) => c.estado === 'confirmado');
  const pend = mine.filter((c) => c.estado === 'pendente');
  return { total: sum(conf), count: conf.length, pendente: sum(pend), pendentes: pend.length };
}

// Registo feito pelo próprio membro: fica pendente até a tesouraria aprovar
export async function registerMember({ nome, telefone, pin }) {
  if (db.members.some((m) => m.telefone === telefone)) throw new Error('Este número já está registado.');
  const member = { id: uid('m_'), nome, telefone, pin, role: 'membro', estado: 'pendente', criadoEm: new Date().toISOString() };
  db.members.push(member);
  save();
  return member;
}

export async function listRegistrations() {
  return db.members.filter((m) => m.estado === 'pendente').sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

export async function reviewRegistration(id, aprovar, revistoPor) {
  const m = db.members.find((x) => x.id === id);
  if (!m || m.estado !== 'pendente') throw new Error('Este pedido já foi tratado.');
  m.estado = aprovar ? 'ativo' : 'recusado';
  m.revistoEm = new Date().toISOString();
  m.revistoPor = revistoPor;
  if (aprovar) m.criadoEm = m.revistoEm;
  save();
  return m;
}

// Suspender impede a entrada; reativar devolve o acesso
export async function setSuspended(id, suspenso, motivo = '') {
  const m = db.members.find((x) => x.id === id);
  if (!m || m.role !== 'membro') throw new Error('Membro não encontrado.');
  m.estado = suspenso ? 'suspenso' : 'ativo';
  m.motivoSuspensao = suspenso ? motivo : null;
  m.suspensoEm = suspenso ? new Date().toISOString() : null;
  save();
  return m;
}

export async function createMember({ nome, telefone }) {
  if (db.members.some((m) => m.telefone === telefone)) throw new Error('Já existe um membro registado com este número.');
  const pin = String(1000 + Math.floor(Math.random() * 9000));
  const member = { id: uid('m_'), nome, telefone, pin, role: 'membro', criadoEm: new Date().toISOString() };
  db.members.push(member);
  save();
  return { member, pin };
}

export async function updatePin(id, pin) {
  const m = db.members.find((x) => x.id === id);
  if (!m) throw new Error('Membro não encontrado.');
  m.pin = pin;
  save();
}

export async function updatePhoto(id, foto) {
  const m = db.members.find((x) => x.id === id);
  if (!m) throw new Error('Membro não encontrado.');
  const prev = m.foto;
  m.foto = foto || null;
  try { save(); } catch (e) { m.foto = prev; throw new Error('A fotografia é demasiado grande. Escolha outra.'); }
  return m;
}

// Mensagens -----------------------------------------------------------------
export async function listMessages(membroId) {
  return db.messages.filter((m) => m.membroId === membroId).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
}

export async function sendMessage({ membroId, de, texto, autorId }) {
  const msg = { id: uid('msg_'), membroId, de, autorId: autorId || null, texto, criadoEm: new Date().toISOString(), lida: false };
  db.messages.push(msg);
  save();
  return msg;
}

// Marca como lidas as mensagens enviadas pelo outro lado
export async function markThreadRead(membroId, leitor) {
  const outro = leitor === 'admin' ? 'membro' : 'admin';
  for (const m of db.messages) if (m.membroId === membroId && m.de === outro) m.lida = true;
  save();
}

export async function unreadMessagesForMember(membroId) {
  return db.messages.filter((m) => m.membroId === membroId && m.de === 'admin' && !m.lida).length;
}

export async function unreadMessagesForAdmin() {
  return db.messages.filter((m) => m.de === 'membro' && !m.lida).length;
}

// Uma conversa por membro, a mais recente primeiro
export async function listThreads() {
  const threads = new Map();
  for (const m of db.messages) {
    const t = threads.get(m.membroId) || { membroId: m.membroId, last: null, unread: 0 };
    if (!t.last || m.criadoEm > t.last.criadoEm) t.last = m;
    if (m.de === 'membro' && !m.lida) t.unread += 1;
    threads.set(m.membroId, t);
  }
  return [...threads.values()].sort((a, b) => b.last.criadoEm.localeCompare(a.last.criadoEm));
}

// Contribuições -------------------------------------------------------------
export async function listContributions({ membroId, estado } = {}) {
  let list = db.contributions;
  if (membroId) list = list.filter((c) => c.membroId === membroId);
  if (estado) list = list.filter((c) => c.estado === estado);
  return [...list].sort(byRecent);
}

export async function getContribution(id) {
  return db.contributions.find((c) => c.id === id) || null;
}

export async function declareContribution({ membroId, valor, metodo, referencia, pagador, data, nota, comprovativo }) {
  db.seq = (db.seq || db.contributions.length) + 1;
  const now = new Date();
  const c = {
    id: uid('c_'),
    ref: `NL-${now.getFullYear()}-${String(db.seq).padStart(6, '0')}`,
    membroId, valor, metodo,
    referencia: referencia || '',
    pagador: pagador || '',
    data, nota: nota || '',
    comprovativo: comprovativo || null,
    estado: 'pendente', motivo: null,
    declaradoEm: now.toISOString(), revistoEm: null, revistoPor: null,
  };
  db.contributions.push(c);
  try { save(); } catch (e) { db.contributions.pop(); db.seq -= 1; throw e; }
  return c;
}

export async function reviewContribution(id, { estado, motivo, revistoPor }) {
  const c = db.contributions.find((x) => x.id === id);
  if (!c) throw new Error('Contribuição não encontrada.');
  if (c.estado !== 'pendente') throw new Error('Esta contribuição já foi revista.');
  c.estado = estado;
  c.motivo = estado === 'rejeitado' ? motivo : null;
  c.revistoEm = new Date().toISOString();
  c.revistoPor = revistoPor;
  db.notifications.push({ id: uid('n_'), membroId: c.membroId, contribId: c.id, tipo: estado, texto: notificationText(c), lida: false, criadoEm: c.revistoEm });
  save();
  return c;
}

// Notificações --------------------------------------------------------------
export async function listNotifications(membroId) {
  return db.notifications.filter((n) => n.membroId === membroId).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

export async function unreadCount(membroId) {
  return db.notifications.filter((n) => n.membroId === membroId && !n.lida).length;
}

export async function markAllRead(membroId) {
  for (const n of db.notifications) if (n.membroId === membroId) n.lida = true;
  save();
}
