// Camada de dados. Toda a aplicação passa por aqui; as funções são assíncronas
// para que esta implementação (localStorage) possa ser trocada por Supabase
// sem alterar as vistas.
import { notificationText } from './seed.js';
import { isoDate, monthKey, monthShort } from './format.js';

// Versão de produção: começa sem nenhum dado. A chave nova deixa para trás os dados
// de demonstração que estejam guardados nos navegadores (e apaga-os).
const KEY = 'nl.db.v2';
const SESSION = 'nl.session.v1';
// A sessão caduca ao fim de três minutos sem atividade: quem deixa o
// telemóvel pousado ou fecha a app tem de introduzir as credenciais outra vez.
export const SESSION_TTL = 3 * 60 * 1000;

// Uma única vez, nos navegadores que tinham a demonstração: apaga os dados antigos,
// a conta lembrada e as tentativas de PIN dessa versão.
if (localStorage.getItem('nl.db.v1')) for (const k of ['nl.db.v1', 'nl.attempts.v1', 'nl.last.v1']) localStorage.removeItem(k);

function emptyDb() {
  const now = new Date();
  return {
    version: 2,
    seq: 0,
    settings: {
      obraNome: 'Obra do Novo Templo',
      meta: 5000000,
      inicio: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      prazo: `${now.getFullYear() + 1}-12-31`,
      whatsapp: '879470600',
    },
    members: [],
    contributions: [],
    notifications: [],
    messages: [],
  };
}

let db = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      // Número oficial do WhatsApp da tesouraria (dados guardados antes de existir)
      if (!data.settings.whatsapp) { data.settings.whatsapp = '879470600'; save(data); }
      return data;
    }
  } catch { /* dados corrompidos: recomeça */ }
  const fresh = emptyDb();
  save(fresh);
  return fresh;
}

// Primeiro acesso: ainda não existe a conta da administração
export async function needsSetup() {
  return !db.members.some((m) => m.role === 'admin');
}

export async function createAdmin({ nome, telefone, pin }) {
  if (!(await needsSetup())) throw new Error('A conta da administração já foi criada.');
  const admin = { id: 'm_admin', nome, telefone, pin, role: 'admin', cargo: 'Administração', estado: 'ativo', criadoEm: new Date().toISOString() };
  db.members.push(admin);
  save();
  sessionStorage.setItem(SESSION, JSON.stringify({ id: admin.id, at: Date.now() }));
  localStorage.setItem('nl.last.v1', admin.telefone);
  return admin;
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
// Sessão guardada no sessionStorage como { id, at } (`at` = última atividade):
// fechar o separador ou a app termina a sessão, por isso cada visita nova
// pede o PIN. Só o número da última conta fica lembrado (nunca o PIN).
const LAST = 'nl.last.v1';
const EXIT = 'nl.exit';
localStorage.removeItem(SESSION); // sessões antigas, guardadas antes desta mudança

function readSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION));
    return s && s.id ? s : null;
  } catch {
    return null;
  }
}

export const hasSession = () => !!readSession();

// Renova o prazo. Chamada a cada sinal de atividade do utilizador.
export function touchSession() {
  const s = readSession();
  if (s) sessionStorage.setItem(SESSION, JSON.stringify({ id: s.id, at: Date.now() }));
}

// Porque é que a pessoa voltou à entrada ('saiu' | 'inatividade'); lido uma vez.
export function takeExitReason() {
  const r = sessionStorage.getItem(EXIT);
  sessionStorage.removeItem(EXIT);
  return r;
}

// Última conta usada neste aparelho: a entrada mostra o nome e pede só o PIN.
export async function lastAccount() {
  const tel = localStorage.getItem(LAST);
  const m = tel && db.members.find((x) => x.telefone === tel);
  return m && canSignIn(m) ? m : null;
}

export function forgetAccount() {
  localStorage.removeItem(LAST);
}

export async function getSessionUser() {
  const s = readSession();
  if (!s) return null;
  if (Date.now() - (s.at || 0) > SESSION_TTL) {
    await signOut('inatividade');
    return null;
  }
  const m = db.members.find((x) => x.id === s.id);
  if (!m || !canSignIn(m)) {
    await signOut();
    return null;
  }
  touchSession();
  return m;
}

export async function findMemberByPhone(telefone) {
  return db.members.find((m) => m.telefone === telefone) || null;
}

// Estados do membro: pendente (aguarda aprovação) · ativo · suspenso · recusado
const isActive = (m) => !m.estado || m.estado === 'ativo';
// Só a administração e os gestores entram no sistema
export const STAFF = ['admin', 'gestor', 'super'];
const canSignIn = (m) => STAFF.includes(m.role) && isActive(m);

// Tentativas falhadas por número: ao fim de 5, a entrada fica bloqueada 60 s.
const ATTEMPTS = 'nl.attempts.v1';
export const MAX_ATTEMPTS = 5;
const LOCK_MS = 60 * 1000;
const readAttempts = () => { try { return JSON.parse(localStorage.getItem(ATTEMPTS)) || {}; } catch { return {}; } };

// Segundos que faltam até poder tentar outra vez (0 = desbloqueado)
export function lockedFor(telefone) {
  const a = readAttempts()[telefone];
  return a?.until ? Math.max(0, Math.ceil((a.until - Date.now()) / 1000)) : 0;
}

// Devolve { user } quando entra, ou { left } / { locked } quando falha.
export async function signIn(telefone, pin) {
  if (lockedFor(telefone)) return { locked: lockedFor(telefone) };
  const m = await findMemberByPhone(telefone);
  const all = readAttempts();
  if (!m || !canSignIn(m) || m.pin !== pin) {
    const n = (all[telefone]?.n || 0) + 1; // um bloqueio já cumprido guarda n = 0
    all[telefone] = n >= MAX_ATTEMPTS ? { n: 0, until: Date.now() + LOCK_MS } : { n };
    localStorage.setItem(ATTEMPTS, JSON.stringify(all));
    return n >= MAX_ATTEMPTS ? { locked: LOCK_MS / 1000 } : { left: MAX_ATTEMPTS - n };
  }
  delete all[telefone];
  localStorage.setItem(ATTEMPTS, JSON.stringify(all));
  sessionStorage.setItem(SESSION, JSON.stringify({ id: m.id, at: Date.now() }));
  localStorage.setItem(LAST, m.telefone);
  return { user: m };
}

export async function signOut(reason) {
  sessionStorage.removeItem(SESSION);
  for (const k of ['nl.q', 'nl.gestor']) sessionStorage.removeItem(k);
  if (reason) sessionStorage.setItem(EXIT, reason);
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
  if (!m || !['membro', 'gestor'].includes(m.role)) throw new Error('Pessoa não encontrada.');
  m.estado = suspenso ? 'suspenso' : 'ativo';
  m.motivoSuspensao = suspenso ? motivo : null;
  m.suspensoEm = suspenso ? new Date().toISOString() : null;
  save();
  return m;
}

// Gestores: criados só pela administração
export async function listGestores() {
  return db.members.filter((m) => m.role === 'gestor').sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}

export async function createGestor({ nome, telefone }) {
  if (db.members.some((m) => m.telefone === telefone)) throw new Error('Este número já está registado no sistema.');
  const pin = String(1000 + Math.floor(Math.random() * 9000));
  const gestor = { id: uid('m_'), nome, telefone, pin, role: 'gestor', cargo: 'Gestor', estado: 'ativo', criadoEm: new Date().toISOString() };
  db.members.push(gestor);
  save();
  return { gestor, pin };
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
export async function listContributions({ membroId, estado, registadoPor } = {}) {
  let list = db.contributions;
  if (membroId) list = list.filter((c) => c.membroId === membroId);
  if (registadoPor) list = list.filter((c) => c.registadoPor === registadoPor);
  if (estado) list = list.filter((c) => c.estado === estado);
  return [...list].sort(byRecent);
}

export async function getContribution(id) {
  return db.contributions.find((c) => c.id === id) || null;
}

// Valor recebido e lançado por um gestor ou pela administração: fica logo confirmado
export async function recordContribution({ membroId, valor, metodo, referencia, pagador, data, nota, registadoPor }) {
  db.seq = (db.seq || db.contributions.length) + 1;
  const now = new Date().toISOString();
  const c = {
    id: uid('c_'),
    ref: `NL-${new Date().getFullYear()}-${String(db.seq).padStart(6, '0')}`,
    membroId, valor, metodo,
    referencia: referencia || '', pagador: pagador || '',
    data, nota: nota || '', comprovativo: null,
    estado: 'confirmado', motivo: null,
    declaradoEm: now, revistoEm: now, revistoPor: registadoPor, registadoPor,
  };
  db.contributions.push(c);
  save();
  return c;
}

// Despesas (saídas de dinheiro) ----------------------------------------------
// Nunca se alteram nem se apagam: um engano corrige-se anulando (fica no histórico).
export async function listExpenses() {
  return (db.expenses || []).slice().sort((a, b) => b.data.localeCompare(a.data) || b.registadoEm.localeCompare(a.registadoEm));
}
export async function recordExpense({ data, valor, categoria, descricao, nota, beneficiario, metodo, referencia, registadoPor }) {
  db.expenses = db.expenses || [];
  db.expSeq = (db.expSeq || 0) + 1;
  const e = {
    id: uid('e_'), ref: `DS-${new Date().getFullYear()}-${String(db.expSeq).padStart(6, '0')}`,
    data, valor, categoria, descricao, nota, beneficiario: beneficiario || '', metodo, referencia: referencia || '',
    registadoPor, registadoEm: new Date().toISOString(), anulada: false, anuladaEm: null, anuladaPor: null, motivoAnulacao: null,
  };
  db.expenses.push(e);
  save();
  return e;
}
export async function voidExpense(id, { motivo, por }) {
  const e = (db.expenses || []).find((x) => x.id === id);
  if (!e) throw new Error('Despesa não encontrada.');
  if (e.anulada) throw new Error('Esta despesa já foi anulada.');
  Object.assign(e, { anulada: true, anuladaEm: new Date().toISOString(), anuladaPor: por, motivoAnulacao: motivo });
  save();
  return e;
}

// O comprovativo foi enviado ao membro (WhatsApp ou partilha do PDF)
export async function markNotified(id, { por, canal }) {
  const c = db.contributions.find((x) => x.id === id);
  if (!c) return null;
  c.notificadoEm = new Date().toISOString();
  c.notificadoPor = por;
  c.notificadoCanal = canal;
  save();
  return c;
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

// Acesso de desenvolvedor (super admin): número reservado em db.devPhone
export async function devSetupAvailable(telefone) {
  return !!db.devPhone && db.devPhone === telefone && !db.members.some((m) => m.role === 'super');
}
export async function createSuper({ nome, telefone, pin }) {
  if (!(await devSetupAvailable(telefone))) throw new Error('Número não autorizado.');
  const m = { id: uid('m_'), nome, telefone, pin, role: 'super', cargo: 'Desenvolvedor', estado: 'ativo', criadoEm: new Date().toISOString() };
  db.members.push(m);
  save();
  sessionStorage.setItem(SESSION, JSON.stringify({ id: m.id, at: Date.now() }));
  return m;
}

// Alterar o próprio PIN
let pinFails = 0;
export async function changePin(current, next) {
  const s = JSON.parse(sessionStorage.getItem(SESSION) || 'null');
  const m = s && db.members.find((x) => x.id === s.id);
  if (!m) throw new Error('Sessão terminada. Entre outra vez.');
  if (m.pin !== current) {
    pinFails += 1;
    if (pinFails >= MAX_ATTEMPTS) { pinFails = 0; await signOut('pin'); return { signedOut: true }; }
    throw new Error(`O PIN atual está errado. Restam ${MAX_ATTEMPTS - pinFails} tentativas.`);
  }
  pinFails = 0;
  m.pin = next;
  save();
  return { ok: true };
}

export async function resetPin(personId) {
  const m = db.members.find((x) => x.id === personId && x.role === 'gestor');
  if (!m) throw new Error('Não é possível redefinir o PIN desta conta.');
  let pin;
  do { pin = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); } while (/^(\d)\1{3}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin));
  m.pin = pin;
  save();
  return { pin };
}
