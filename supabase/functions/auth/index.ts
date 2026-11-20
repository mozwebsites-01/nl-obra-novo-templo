// auth — entrada segura e gestão de acessos (Nataniel Litsure Ministries · Obra do Novo Templo)
//
// Porque existe: o PIN tem 4 dígitos. Se a palavra-passe da conta fosse derivada só do PIN,
// qualquer pessoa podia tentar os 10 000 PIN diretamente no servidor de autenticação.
// Aqui, a palavra-passe real de cada conta é HMAC(chave secreta do servidor, telemóvel:PIN).
// A chave secreta é gerada e guardada na base de dados (esquema "secure", invisível à API) e
// nunca sai do servidor. Assim, a ÚNICA forma de entrar é por esta função, que bloqueia
// o número ao fim de 5 PIN errados (15 min, 30 min, 1 h … até 24 h).
//
// Implementar com "Verify JWT" DESLIGADO (a própria função verifica a sessão quando precisa).
// Usa os segredos automáticos SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.
//
// Ações (POST JSON { action, ... }):
//   login         { telefone, pin }                 → { session }
//   change_pin    { current, next }       (sessão)  → { ok }
//   create_gestor { nome, telefone }      (admin)   → { gestor, pin }
//   reset_pin     { person_id }           (admin)   → { pin }   (gestor; o desenvolvedor também a administração)
//   setup_admin   { nome, telefone, pin }           → { session }  (só se ainda não existir administração)
//   setup_super   { nome, telefone, pin }           → { session }  (só o número reservado, uma vez)
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DOMAIN = 'nl-obra.app';
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, NO_SESSION);

const ORIGINS = ['https://nataniellitsure.tr', 'https://www.nataniellitsure.tr', 'https://mozwebsites-01.github.io', 'http://localhost:4173'];
const corsFor = (req: Request) => {
  const o = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
};

const TEL = /^8[2-7]\d{7}$/;
const PIN = /^\d{4}$/;
const WEAK = new Set(['2580', '0852', '1212', '1122', '1313', '1010', '2000', '1004', '6969', '2468', '1357']);
const weakPin = (p: string) => /^(\d)\1{3}$/.test(p) || WEAK.has(p) || '0123456789'.includes(p) || '9876543210'.includes(p);
const email = (tel: string) => `${tel}@${DOMAIN}`;
const legacy = (pin: string) => `NL-${pin}-obra`; // formato antigo, migrado na primeira entrada

let pepperCache = '';
async function pepper() {
  if (!pepperCache) {
    const { data, error } = await admin.rpc('sec_pepper');
    if (error || !data) throw new Error('Configuração de segurança em falta.');
    pepperCache = data as string;
  }
  return pepperCache;
}
async function derive(tel: string, pin: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(await pepper()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${tel}:${pin}`)));
  return 'v2.' + [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomPin() {
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
    const p = String(n).padStart(4, '0');
    if (!weakPin(p)) return p;
  }
}

async function tryPassword(tel: string, password: string) {
  const c = createClient(URL_, ANON, NO_SESSION);
  const { data, error } = await c.auth.signInWithPassword({ email: email(tel), password });
  return error ? null : data;
}
// PIN certo? Tenta a palavra-passe segura; se a conta ainda tiver o formato antigo, migra-a.
async function verify(tel: string, pin: string) {
  const strong = await derive(tel, pin);
  let d = await tryPassword(tel, strong);
  if (d) return d;
  d = await tryPassword(tel, legacy(pin));
  if (d?.user) {
    await admin.auth.admin.updateUserById(d.user.id, { password: strong });
    return d;
  }
  return null;
}

const lockStatus = async (tel: string) => {
  const { data } = await admin.rpc('sec_lock_status', { p_telefone: tel });
  return Number(data) || 0;
};
const register = async (tel: string, ok: boolean, acao: string, ip: string | null) => {
  const { data } = await admin.rpc('sec_register', { p_telefone: tel, p_ok: ok, p_acao: acao, p_ip: ip });
  return (data || {}) as { locked?: number; left?: number };
};

// Quem está a pedir (pela sessão enviada no cabeçalho)
async function caller(req: Request) {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return null;
  const { data: person } = await admin.from('people').select('*').eq('user_id', user.id).maybeSingle();
  if (!person || person.estado !== 'ativo') return null;
  return { user, person };
}

async function createAccount(tel: string, pin: string) {
  const { data, error } = await admin.auth.admin.createUser({ email: email(tel), password: await derive(tel, pin), email_confirm: true });
  if (error || !data.user) {
    if (/already|registered|exists/i.test(error?.message || '')) throw new Error('Já existe uma conta de acesso com este número.');
    throw new Error('Não foi possível criar a conta de acesso.');
  }
  return data.user;
}
async function insertPerson(row: Record<string, unknown>, userId: string) {
  const { data, error } = await admin.from('people').insert(row).select().single();
  if (error) {
    await admin.auth.admin.deleteUser(userId); // não deixa contas soltas
    if (/duplicate|unique/i.test(error.message)) throw new Error('Este número já está registado no sistema.');
    throw new Error('Não foi possível registar a pessoa.');
  }
  return data;
}
const sessionOf = (d: { session: { access_token: string; refresh_token: string } | null } | null) =>
  d?.session ? { access_token: d.session.access_token, refresh_token: d.session.refresh_token } : null;

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  let body: Record<string, string> = {};
  try { body = await req.json(); } catch { return json({ error: 'Pedido inválido.' }, 400); }
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
  const nome = String(body.nome || '').trim().replace(/\s+/g, ' ').slice(0, 80);

  try {
    switch (body.action) {
      case 'login': {
        const tel = String(body.telefone || ''), pin = String(body.pin || '');
        if (!TEL.test(tel) || !PIN.test(pin)) return json({ error: 'Número ou PIN inválido.' }, 400);
        const locked = await lockStatus(tel);
        if (locked) return json({ locked }, 429);
        const d = await verify(tel, pin);
        const r = await register(tel, !!d, 'entrada', ip);
        if (!d) return json(r.locked ? { locked: r.locked } : { error: 'PIN errado.', left: r.left }, r.locked ? 429 : 401);
        return json({ session: sessionOf(d) });
      }

      case 'change_pin': {
        const who = await caller(req);
        if (!who) return json({ error: 'Sessão terminada. Entre outra vez.' }, 401);
        const tel = who.person.telefone as string;
        const cur = String(body.current || ''), next = String(body.next || '');
        if (!PIN.test(next) || weakPin(next)) return json({ error: 'Este PIN é fácil de adivinhar. Escolha outro.' }, 400);
        const locked = await lockStatus(tel);
        if (locked) return json({ locked }, 429);
        const ok = PIN.test(cur) && !!(await verify(tel, cur));
        const r = await register(tel, ok, 'alterar_pin', ip);
        if (!ok) return json(r.locked ? { locked: r.locked } : { error: 'O PIN atual está errado.', left: r.left }, r.locked ? 429 : 401);
        const { error } = await admin.auth.admin.updateUserById(who.user.id, { password: await derive(tel, next) });
        if (error) return json({ error: 'Não foi possível alterar o PIN.' }, 500);
        return json({ ok: true });
      }

      case 'create_gestor': {
        const who = await caller(req);
        if (!who || !['admin', 'super'].includes(who.person.role)) return json({ error: 'Só a administração pode adicionar gestores.' }, 403);
        const tel = String(body.telefone || '');
        if (nome.split(' ').length < 2 || !TEL.test(tel)) return json({ error: 'Indique o nome completo e um número válido.' }, 400);
        const { data: exists } = await admin.from('people').select('id').eq('telefone', tel).maybeSingle();
        if (exists) return json({ error: 'Este número já está registado no sistema.' }, 409);
        const pin = randomPin();
        const user = await createAccount(tel, pin);
        const gestor = await insertPerson({ user_id: user.id, nome, telefone: tel, role: 'gestor', cargo: 'Gestor', criado_por: who.person.id }, user.id);
        return json({ gestor, pin });
      }

      case 'reset_pin': {
        const who = await caller(req);
        if (!who || !['admin', 'super'].includes(who.person.role)) return json({ error: 'Sem permissão.' }, 403);
        const { data: target } = await admin.from('people').select('*').eq('id', String(body.person_id || '')).maybeSingle();
        const allowed = target?.user_id && (target.role === 'gestor' || (target.role === 'admin' && who.person.role === 'super'));
        if (!allowed) return json({ error: 'Não é possível redefinir o PIN desta conta.' }, 403);
        const pin = randomPin();
        const { error } = await admin.auth.admin.updateUserById(target.user_id, { password: await derive(target.telefone, pin) });
        if (error) return json({ error: 'Não foi possível redefinir o PIN.' }, 500);
        await register(target.telefone, true, `pin_redefinido_por_${who.person.role}`, ip); // também desbloqueia o número
        return json({ pin });
      }

      case 'setup_admin':
      case 'setup_super': {
        const tel = String(body.telefone || ''), pin = String(body.pin || '');
        if (nome.split(' ').length < 2 || !TEL.test(tel)) return json({ error: 'Indique o nome completo e um número válido.' }, 400);
        if (!PIN.test(pin) || weakPin(pin)) return json({ error: 'Este PIN é fácil de adivinhar. Escolha outro.' }, 400);
        const isSuper = body.action === 'setup_super';
        if (isSuper) {
          const { data: ok } = await admin.rpc('dev_setup_available', { p_telefone: tel });
          if (!ok) return json({ error: 'Número não autorizado.' }, 403);
        } else {
          const { data: ok } = await admin.rpc('needs_setup');
          if (!ok) return json({ error: 'A conta da administração já foi criada.' }, 403);
        }
        const user = await createAccount(tel, pin);
        await insertPerson(isSuper
          ? { user_id: user.id, nome, telefone: tel, role: 'super', cargo: 'Desenvolvedor' }
          : { user_id: user.id, nome, telefone: tel, role: 'admin', cargo: 'Administração' }, user.id);
        await register(tel, true, body.action, ip);
        return json({ session: sessionOf(await tryPassword(tel, await derive(tel, pin))) });
      }

      default:
        return json({ error: 'Ação desconhecida.' }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message || 'Erro no servidor.' }, 500);
  }
});
