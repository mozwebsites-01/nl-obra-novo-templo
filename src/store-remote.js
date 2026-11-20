// Camada de dados partilhada (Supabase). Mesmas funções que store-local.js, para as vistas
// não mudarem. Depois de entrar, os dados que esta pessoa pode ver (as regras de acesso estão
// no servidor) ficam numa cópia em memória, atualizada a cada mudança de página.
import { CONFIG } from './config.js';
import { isoDate, monthKey, monthShort } from './format.js';

const SESSION = 'nl.session.v1';
const LAST = 'nl.last.v2';
const EXIT = 'nl.exit';
export const SESSION_TTL = 3 * 60 * 1000;
export const STAFF = ['admin', 'gestor'];
export const MAX_ATTEMPTS = 5;
const LOCK_MS = 60 * 1000;
const ATTEMPTS = 'nl.attempts.v1';

// A conta de acesso usa um endereço interno derivado do telemóvel; o PIN é completado
// para cumprir o tamanho mínimo da palavra-passe do Supabase.
const emailFor = (tel) => `${tel}@${CONFIG.authDomain}`;
const passFor = (pin) => `NL-${pin}-obra`;

// Sessão do Supabase guardada no separador (fechar o separador termina a sessão)
const sb = window.supabase.createClient(CONFIG.url, CONFIG.anonKey, {
  auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, storageKey: 'nl.auth' },
});

const DEFAULT_SETTINGS = { obraNome: 'Obra do Novo Templo', meta: 5000000, inicio: isoDate(), prazo: isoDate(), whatsapp: '879470600' };
let db = { settings: { ...DEFAULT_SETTINGS }, members: [], contributions: [] };
let me = null;
let syncedAt = 0;

const fail = (error, fallback) => {
  if (!error) return;
  const msg = String(error.message || '');
  if (/duplicate key|unique/i.test(msg)) throw new Error('Este número já está registado no sistema.');
  if (/Failed to fetch|NetworkError|network/i.test(msg)) throw new Error('Sem ligação à internet. Verifique a rede e tente outra vez.');
  throw new Error(msg && !/^\w+_\w+/.test(msg) ? msg : fallback);
};

// Conversão entre o formato da base de dados e o das vistas -----------------
const toPerson = (r) => ({
  id: r.id, userId: r.user_id, nome: r.nome, telefone: r.telefone, role: r.role,
  cargo: r.cargo || (r.role === 'admin' ? 'Administração' : r.role === 'gestor' ? 'Gestor' : undefined),
  estado: r.estado, criadoEm: r.criado_em,
});
const toContribution = (r) => ({
  id: r.id, ref: r.ref, membroId: r.membro_id, valor: Number(r.valor), metodo: r.metodo,
  referencia: r.referencia || '', pagador: r.pagador || '', data: r.data, nota: r.nota || '',
  comprovativo: null, estado: 'confirmado', motivo: null,
  declaradoEm: r.registado_em, revistoEm: r.registado_em, revistoPor: r.registado_por, registadoPor: r.registado_por,
  notificadoEm: r.notificado_em, notificadoPor: r.notificado_por, notificadoCanal: r.notificado_canal,
});
const toSettings = (r) => ({ obraNome: r.obra_nome, meta: Number(r.meta), inicio: r.inicio, prazo: r.prazo, whatsapp: r.whatsapp || '879470600' });

const byRecent = (a, b) => b.data.localeCompare(a.data) || String(b.declaradoEm).localeCompare(String(a.declaradoEm));
const sum = (list) => list.reduce((s, c) => s + c.valor, 0);

// Carrega tudo o que esta pessoa pode ver
export async function sync(force = false) {
  if (!me) return;
  if (!force && Date.now() - syncedAt < 4000) return;
  const [s, p, c] = await Promise.all([
    sb.from('settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('people').select('*').order('nome'),
    sb.from('contributions').select('*').order('data', { ascending: false }).order('registado_em', { ascending: false }),
  ]);
  fail(s.error || p.error || c.error, 'Não foi possível carregar os dados.');
  if (s.data) db.settings = toSettings(s.data);
  db.members = p.data.map(toPerson);
  db.contributions = c.data.map(toContribution);
  me = db.members.find((m) => m.id === me.id) || me;
  syncedAt = Date.now();
}

// Sessão --------------------------------------------------------------------
function readSession() {
  try { const s = JSON.parse(sessionStorage.getItem(SESSION)); return s && s.id ? s : null; } catch { return null; }
}
export const hasSession = () => !!readSession();
export function touchSession() {
  const s = readSession();
  if (s) sessionStorage.setItem(SESSION, JSON.stringify({ id: s.id, at: Date.now() }));
}
export function takeExitReason() {
  const r = sessionStorage.getItem(EXIT);
  sessionStorage.removeItem(EXIT);
  return r;
}

const readLast = () => { try { return JSON.parse(localStorage.getItem(LAST)); } catch { return null; } };
export async function lastAccount() {
  const l = readLast();
  return l?.telefone ? { ...l, estado: 'ativo' } : null;
}
export function forgetAccount() { localStorage.removeItem(LAST); }

async function loadMe() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from('people').select('*').eq('user_id', user.id).maybeSingle();
  if (error || !data) return null;
  return toPerson(data);
}

export async function getSessionUser() {
  const s = readSession();
  if (!s) return null;
  if (Date.now() - (s.at || 0) > SESSION_TTL) { await signOut('inatividade'); return null; }
  if (!me) {
    me = await loadMe();
    if (!me) { await signOut(); return null; }
  }
  if (!STAFF.includes(me.role) || me.estado !== 'ativo') { await signOut(); return null; }
  await sync();
  if (me.estado !== 'ativo') { await signOut(); return null; }
  touchSession();
  return me;
}

// Antes de entrar: só o papel e o estado (o nome vem da última conta usada neste aparelho)
export async function findMemberByPhone(telefone) {
  const { data, error } = await sb.rpc('phone_status', { p_telefone: telefone });
  fail(error, 'Não foi possível verificar o número.');
  if (!data) return null;
  const l = readLast();
  return { telefone, role: data.role, estado: data.estado, ...(l?.telefone === telefone ? { nome: l.nome, cargo: l.cargo } : {}) };
}

const readAttempts = () => { try { return JSON.parse(localStorage.getItem(ATTEMPTS)) || {}; } catch { return {}; } };
export function lockedFor(telefone) {
  const a = readAttempts()[telefone];
  return a?.until ? Math.max(0, Math.ceil((a.until - Date.now()) / 1000)) : 0;
}

export async function signIn(telefone, pin) {
  if (lockedFor(telefone)) return { locked: lockedFor(telefone) };
  const all = readAttempts();
  const { error } = await sb.auth.signInWithPassword({ email: emailFor(telefone), password: passFor(pin) });
  let person = null;
  if (!error) person = await loadMe();
  if (error || !person || !STAFF.includes(person.role) || person.estado !== 'ativo') {
    if (!error) await sb.auth.signOut();
    if (error && /fetch|network/i.test(error.message)) throw new Error('Sem ligação à internet. Verifique a rede e tente outra vez.');
    const n = (all[telefone]?.n || 0) + 1;
    all[telefone] = n >= MAX_ATTEMPTS ? { n: 0, until: Date.now() + LOCK_MS } : { n };
    localStorage.setItem(ATTEMPTS, JSON.stringify(all));
    return n >= MAX_ATTEMPTS ? { locked: LOCK_MS / 1000 } : { left: MAX_ATTEMPTS - n };
  }
  delete all[telefone];
  localStorage.setItem(ATTEMPTS, JSON.stringify(all));
  me = person;
  syncedAt = 0;
  sessionStorage.setItem(SESSION, JSON.stringify({ id: me.id, at: Date.now() }));
  localStorage.setItem(LAST, JSON.stringify({ telefone: me.telefone, nome: me.nome, cargo: me.cargo, role: me.role }));
  return { user: me };
}

export async function signOut(reason) {
  sessionStorage.removeItem(SESSION);
  for (const k of ['nl.q', 'nl.gestor']) sessionStorage.removeItem(k);
  if (reason) sessionStorage.setItem(EXIT, reason);
  me = null;
  db = { settings: { ...DEFAULT_SETTINGS }, members: [], contributions: [] };
  syncedAt = 0;
  await sb.auth.signOut().catch(() => {});
}

// Primeiro acesso -----------------------------------------------------------
export async function needsSetup() {
  const { data, error } = await sb.rpc('needs_setup');
  fail(error, 'Não foi possível ligar ao servidor.');
  return !!data;
}

export async function createAdmin({ nome, telefone, pin }) {
  const { data, error } = await sb.auth.signUp({ email: emailFor(telefone), password: passFor(pin) });
  fail(error, 'Não foi possível criar a conta.');
  if (!data.session) throw new Error('No Supabase, desative "Confirm email" (Authentication › Providers › Email) e tente outra vez.');
  const r = await sb.rpc('setup_admin', { p_nome: nome, p_telefone: telefone });
  fail(r.error, 'Não foi possível criar a conta da administração.');
  me = toPerson(r.data);
  sessionStorage.setItem(SESSION, JSON.stringify({ id: me.id, at: Date.now() }));
  localStorage.setItem(LAST, JSON.stringify({ telefone: me.telefone, nome: me.nome, cargo: me.cargo, role: me.role }));
  await sync(true);
  return me;
}

// Obra ----------------------------------------------------------------------
export async function getSettings() { return { ...db.settings }; }

export async function updateSettings(patch) {
  const row = {};
  if ('obraNome' in patch) row.obra_nome = patch.obraNome;
  if ('meta' in patch) row.meta = patch.meta;
  if ('inicio' in patch) row.inicio = patch.inicio;
  if ('prazo' in patch) row.prazo = patch.prazo;
  if ('whatsapp' in patch) row.whatsapp = patch.whatsapp;
  const { data, error } = await sb.from('settings').update(row).eq('id', 1).select().single();
  fail(error, 'Não foi possível guardar as definições.');
  db.settings = toSettings(data);
  return { ...db.settings };
}

export async function obraSummary() {
  const conf = db.contributions;
  const arrecadado = sum(conf);
  const meta = db.settings.meta;
  return {
    arrecadado, meta,
    pct: meta ? (arrecadado / meta) * 100 : 0,
    falta: Math.max(0, meta - arrecadado),
    confirmadas: conf.length,
    contribuintes: new Set(conf.map((c) => c.membroId)).size,
    pendentes: 0, pendentesValor: 0,
  };
}

export async function monthlySeries() {
  const nowKey = monthKey(isoDate());
  const keys = [];
  const d = new Date(`${db.settings.inicio}T00:00:00`);
  while (keys.length < 240) {
    const k = isoDate(d).slice(0, 7);
    if (k > nowKey) break;
    keys.push(k);
    d.setMonth(d.getMonth() + 1);
  }
  if (!keys.length) keys.push(nowKey);
  return keys.slice(-12).map((key) => {
    const list = db.contributions.filter((c) => monthKey(c.data) === key);
    return { key, label: monthShort(key), value: sum(list), contribuintes: new Set(list.map((c) => c.membroId)).size, current: key === nowKey };
  });
}

export async function methodBreakdown() {
  const total = sum(db.contributions) || 1;
  return ['mpesa', 'emola', 'banco', 'numerario'].map((metodo) => {
    const v = sum(db.contributions.filter((c) => c.metodo === metodo));
    return { metodo, valor: v, pct: (v / total) * 100 };
  });
}

// Pessoas -------------------------------------------------------------------
export async function listMembers() {
  return db.members.filter((m) => m.role === 'membro').sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}
export async function getMember(id) {
  return db.members.find((m) => m.id === id) || (id === 'm_admin' ? db.members.find((m) => m.role === 'admin') : null) || null;
}
export async function listGestores() {
  return db.members.filter((m) => m.role === 'gestor').sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}
export async function memberStats() {
  const stats = new Map();
  for (const c of db.contributions) {
    const s = stats.get(c.membroId) || { count: 0, total: 0, ultima: null };
    s.count += 1; s.total += c.valor;
    if (!s.ultima || c.data > s.ultima) s.ultima = c.data;
    stats.set(c.membroId, s);
  }
  return stats;
}
export async function memberSummary(id) {
  const list = db.contributions.filter((c) => c.membroId === id);
  return { total: sum(list), count: list.length, ultima: list[0]?.data || null };
}
export async function listRegistrations() { return []; }
export async function reviewRegistration() { throw new Error('Os pedidos de acesso de membros estão desativados.'); }
export async function registerMember() { throw new Error('O registo de membros é feito pelos gestores.'); }

export async function createMember({ nome, telefone }) {
  if (db.members.some((m) => m.telefone === telefone)) throw new Error('Já existe uma pessoa registada com este número.');
  const { data, error } = await sb.from('people').insert({ nome, telefone, role: 'membro', criado_por: me?.id }).select().single();
  fail(error, 'Não foi possível adicionar o membro.');
  const member = toPerson(data);
  db.members.push(member);
  return { member, pin: null };
}

export async function createGestor({ nome, telefone }) {
  if (db.members.some((m) => m.telefone === telefone)) throw new Error('Este número já está registado no sistema.');
  const pin = String(1000 + Math.floor(Math.random() * 9000));
  // Cliente à parte, sem guardar sessão: cria a conta do gestor sem sair da conta da administração
  const temp = window.supabase.createClient(CONFIG.url, CONFIG.anonKey, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'nl.tmp' } });
  const { data, error } = await temp.auth.signUp({ email: emailFor(telefone), password: passFor(pin) });
  fail(error, 'Não foi possível criar a conta do gestor.');
  if (!data.user?.identities?.length) throw new Error('Já existe uma conta de acesso com este número.');
  const r = await sb.rpc('add_gestor', { p_user: data.user.id, p_nome: nome, p_telefone: telefone });
  fail(r.error, 'Não foi possível adicionar o gestor.');
  const gestor = toPerson(r.data);
  db.members.push(gestor);
  return { gestor, pin };
}

export async function setSuspended(id, suspenso) {
  const { data, error } = await sb.from('people').update({ estado: suspenso ? 'suspenso' : 'ativo' }).eq('id', id).select().single();
  fail(error, 'Não foi possível alterar o estado.');
  const p = toPerson(data);
  db.members = db.members.map((m) => (m.id === id ? p : m));
  return p;
}

// Contribuições -------------------------------------------------------------
export async function listContributions({ membroId, registadoPor } = {}) {
  return db.contributions
    .filter((c) => (!membroId || c.membroId === membroId) && (!registadoPor || c.registadoPor === registadoPor))
    .sort(byRecent);
}
export async function getContribution(id) { return db.contributions.find((c) => c.id === id) || null; }

export async function recordContribution({ membroId, valor, metodo, referencia, pagador, data, nota, registadoPor }) {
  const { data: row, error } = await sb.from('contributions').insert({
    membro_id: membroId, valor, metodo, referencia: referencia || '', pagador: pagador || '', data, nota: nota || '', registado_por: registadoPor,
  }).select().single();
  fail(error, 'Não foi possível registar a contribuição.');
  const c = toContribution(row);
  db.contributions.unshift(c);
  return c;
}

export async function markNotified(id, { por, canal }) {
  const { data, error } = await sb.from('contributions').update({ notificado_em: new Date().toISOString(), notificado_por: por, notificado_canal: canal }).eq('id', id).select().single();
  if (error) return null;
  const c = toContribution(data);
  db.contributions = db.contributions.map((x) => (x.id === id ? c : x));
  return c;
}

// Sem painel do membro: funções mantidas só por compatibilidade
export async function listMessages() { return []; }
export async function listThreads() { return []; }
export async function unreadMessagesForAdmin() { return 0; }
export async function listNotifications() { return []; }
export async function unreadCount() { return 0; }
