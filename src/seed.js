// Dados de demonstração, determinísticos e relativos à data de hoje.
// Contas de teste (apenas para este protótipo local):
//   Administração (principal) — telemóvel 84 000 0001, PIN 2580
//   Gestora Rute Langa         — telemóvel 84 000 0002, PIN 1357
//   Gestor Paulo Cossa         — telemóvel 84 000 0003, PIN 2468
import { isoDate, pad, defaultPayer } from './format.js';

export const DEMO = {
  gestor: { telefone: '840000002', pin: '1357' },
  gestor2: { telefone: '840000003', pin: '2468' },
  admin: { telefone: '840000001', pin: '2580' },
  membro: { telefone: '841234567', pin: '1234' },
};

const NOMES = ['Fernando', 'Lurdes', 'Celso', 'Graça', 'Alberto', 'Esperança', 'Hélder', 'Felizarda', 'Joaquim', 'Rosa',
  'Armando', 'Teresa', 'Ernesto', 'Isabel', 'Domingos', 'Marta', 'Abel', 'Sónia', 'Benedito', 'Cristina', 'Paulo',
  'Amélia', 'Zacarias', 'Luísa', 'Edson', 'Glória', 'Silvestre', 'Joana', 'Valter', 'Albertina', 'Inácio', 'Fátima',
  'Mateus', 'Rute', 'Elias', 'Noémia', 'Tomás', 'Celeste', 'Simão', 'Judite', 'Aurélio', 'Berta', 'Jaime', 'Dulce', 'Nelson'];
const APELIDOS = ['Macuácua', 'Sitoe', 'Mondlane', 'Nhantumbo', 'Cumbe', 'Mabunda', 'Chissano', 'Tembe', 'Muianga', 'Langa',
  'Machava', 'Bila', 'Zunguze', 'Manhiça', 'Chilaule', 'Nhaca', 'Massingue', 'Guambe', 'Mucavele', 'Novela', 'Tivane',
  'Cuna', 'Mathe', 'Maússe', 'Chongo', 'Muchanga', 'Matavele', 'Cossa', 'Macamo', 'Uamusse'];

const VALORES = [[500, 10], [1000, 20], [1500, 8], [2000, 15], [2500, 12], [3000, 8], [5000, 12], [7500, 4], [10000, 6], [15000, 2], [20000, 2]];
const METODOS = [['mpesa', 55], ['emola', 20], ['banco', 15], ['numerario', 10]];
const MOTIVOS = [
  'A referência indicada não consta do extrato M-Pesa da igreja.',
  'O valor recebido difere do valor declarado. Por favor, declare novamente com o valor correto.',
  'Contribuição declarada em duplicado.',
];

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smsProof(ref, valor, date) {
  const d = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${String(date.getFullYear()).slice(2)}`;
  const t = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const lines = [
    `${ref} Confirmado. Transferiste`,
    `${valor.toFixed(2)}MT para 85XXXX312 - NATANIEL`,
    `LITSURE MINISTRIES aos ${d} as ${t}.`,
    'Custo da transacao: 0.00MT. Novo saldo',
    'M-Pesa: ****. Obrigado por usar M-Pesa.',
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="210" viewBox="0 0 420 210"><rect width="420" height="210" fill="#fafafa"/><text x="20" y="28" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#8a8a8a">M-PESA · SMS</text><rect x="16" y="42" width="388" height="150" rx="14" fill="#e9e9eb"/>${lines
    .map((l, i) => `<text x="32" y="${72 + i * 24}" font-family="Helvetica,Arial,sans-serif" font-size="14" fill="#1c1c1e">${l}</text>`)
    .join('')}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function buildSeed(now = new Date()) {
  const r = rng(20261030);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const weighted = (pairs) => {
    let x = r() * pairs.reduce((s, p) => s + p[1], 0);
    for (const [v, w] of pairs) if ((x -= w) < 0) return v;
    return pairs[0][0];
  };
  const code = (n, chars) => Array.from({ length: n }, () => pick(chars)).join('');
  const referencia = (metodo) => ({
    mpesa: code(10, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'),
    emola: 'PP' + code(6, '0123456789') + '.' + code(4, '0123456789'),
    banco: 'TRF' + code(9, '0123456789'),
    numerario: '',
  })[metodo];

  const start = new Date(now.getFullYear(), now.getMonth() - 9, 1);
  const startIso = start.toISOString();

  const admin = { id: 'm_admin', nome: 'Samuel Tembe', cargo: 'Tesoureiro', telefone: DEMO.admin.telefone, pin: DEMO.admin.pin, role: 'admin', criadoEm: startIso };
  const ana = { id: 'm_ana', nome: 'Ana Matsinhe', telefone: DEMO.membro.telefone, pin: DEMO.membro.pin, role: 'membro', criadoEm: startIso };
  const others = [];
  const used = new Set([ana.nome]);
  const phones = new Set([admin.telefone, ana.telefone]);
  while (others.length < 46) {
    const nome = `${pick(NOMES)} ${pick(APELIDOS)}`;
    if (used.has(nome)) continue;
    let tel;
    do tel = '8' + pick(['2', '3', '4', '5', '6', '7']) + code(7, '0123456789'); while (phones.has(tel));
    used.add(nome); phones.add(tel);
    others.push({ id: `m_${pad(others.length + 1)}`, nome, telefone: tel, pin: code(4, '0123456789'), role: 'membro', criadoEm: startIso });
  }

  const raw = [];
  const add = (membro, date, valor, metodo, extra = {}) => {
    const declared = new Date(date); declared.setHours(7 + Math.floor(r() * 14), Math.floor(r() * 60));
    raw.push({ membroId: membro.id, data: isoDate(date), valor, metodo, referencia: referencia(metodo), declared, ...extra });
  };

  for (let i = 0; i < 10; i++) {
    const y = start.getFullYear(), m = start.getMonth() + i;
    const dim = new Date(y, m + 1, 0).getDate();
    const lastDay = i === 9 ? now.getDate() : dim;
    const p = 0.5 + 0.035 * i;
    for (const mem of others) {
      if (r() > p) continue;
      const n = r() < 0.25 ? 2 : 1;
      for (let k = 0; k < n; k++) add(mem, new Date(y, m, 1 + Math.floor(r() * lastDay)), weighted(VALORES), weighted(METODOS));
    }
    if (r() < 0.8) add(pick(others), new Date(y, m, 1 + Math.floor(r() * lastDay)), pick([80000, 100000, 120000, 150000, 200000]), 'banco');

    // Ana: contribuição regular no dia 5, por M-Pesa
    if (lastDay >= 5) add(ana, new Date(y, m, 5), 2500, 'mpesa', { fixed: i === 7 ? 'rejeitado' : 'confirmado' });
    if (i === 5) add(ana, new Date(y, m, 18), 5000, 'emola', { fixed: 'confirmado' });
    if (i === 9) add(ana, new Date(y, m, Math.max(1, lastDay - 2)), 2500, 'mpesa', { fixed: 'pendente' });
  }

  const dayMs = 86400000;
  const byId = new Map([ana, ...others].map((m) => [m.id, m]));
  const contributions = raw
    .sort((a, b) => a.declared - b.declared)
    .map((c, idx) => {
      const age = (now - c.declared) / dayMs;
      let estado = c.fixed || (age <= 5 ? (r() < 0.75 ? 'pendente' : 'confirmado') : r() < 0.02 ? 'rejeitado' : 'confirmado');
      if (estado === 'confirmado' && age < 1) estado = 'pendente';
      const reviewed = new Date(c.declared.getTime() + (1 + Math.floor(r() * 2)) * dayMs);
      reviewed.setHours(9 + Math.floor(r() * 8), Math.floor(r() * 60));
      const motivo = estado === 'rejeitado' ? (c.membroId === ana.id ? MOTIVOS[0] : pick(MOTIVOS)) : null;
      const comprovativo = c.metodo === 'mpesa' && (estado === 'pendente' || r() < 0.3)
        ? { nome: 'sms-mpesa.svg', dataUrl: smsProof(c.referencia, c.valor, c.declared) }
        : null;
      return {
        id: `c_${pad(idx + 1)}`,
        ref: `NL-${c.declared.getFullYear()}-${String(idx + 1).padStart(6, '0')}`,
        membroId: c.membroId,
        valor: c.valor,
        metodo: c.metodo,
        referencia: c.referencia,
        pagador: defaultPayer(byId.get(c.membroId), c.metodo),
        data: c.data,
        nota: '',
        comprovativo,
        estado,
        motivo,
        declaradoEm: c.declared.toISOString(),
        revistoEm: estado === 'pendente' ? null : (reviewed > now ? now : reviewed).toISOString(),
        revistoPor: estado === 'pendente' ? null : admin.id,
      };
    });

  // Notificações da Ana: as revisões mais recentes; a última por ler
  const anaReviewed = contributions.filter((c) => c.membroId === ana.id && c.estado !== 'pendente').slice(-4);
  const notifications = anaReviewed.map((c, i) => ({
    id: `n_${i + 1}`,
    membroId: ana.id,
    contribId: c.id,
    tipo: c.estado,
    texto: notificationText(c),
    lida: i < anaReviewed.length - 1,
    criadoEm: c.revistoEm,
  }));

  return {
    version: 1,
    seq: contributions.length,
    settings: {
      obraNome: 'Obra do Novo Templo',
      meta: 5000000,
      inicio: isoDate(start),
      prazo: `${now.getFullYear() + 1}-12-31`,
    },
    members: [admin, ...seedGestores(startIso), ana, ...others, ...seedRegistrations(now)],
    // Modelo atual: cada valor é recebido e lançado por um gestor, por isso fica logo confirmado
    contributions: contributions.map((c) => ({
      ...c, estado: 'confirmado', motivo: null, comprovativo: null,
      revistoEm: c.declaradoEm, revistoPor: gestorFor(c.membroId), registadoPor: gestorFor(c.membroId),
    })),
    notifications,
    messages: seedMessages(now),
  };
}

// Gestores de demonstração: registam membros, recebem e lançam contribuições
export const GESTOR_IDS = ['m_gestor', 'm_gestor2'];
export function seedGestores(criadoEm = new Date().toISOString()) {
  return [
    { id: 'm_gestor', nome: 'Rute Langa', cargo: 'Gestora', telefone: DEMO.gestor.telefone, pin: DEMO.gestor.pin, role: 'gestor', estado: 'ativo', criadoEm },
    { id: 'm_gestor2', nome: 'Paulo Cossa', cargo: 'Gestor', telefone: DEMO.gestor2.telefone, pin: DEMO.gestor2.pin, role: 'gestor', estado: 'ativo', criadoEm },
  ];
}

// Cada membro entrega sempre ao mesmo gestor (distribuição estável pelo id)
export function gestorFor(membroId) {
  let h = 0;
  for (const ch of membroId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GESTOR_IDS[h % GESTOR_IDS.length];
}

// Pedidos de registo à espera de aprovação
export function seedRegistrations(now = new Date()) {
  const ago = (h) => new Date(now.getTime() - h * 3600000).toISOString();
  return [
    { id: 'm_req1', nome: 'Lídia Nhantumbo', telefone: '847712093', pin: '4321', role: 'membro', estado: 'pendente', criadoEm: ago(3) },
    { id: 'm_req2', nome: 'Osvaldo Macamo', telefone: '826640518', pin: '8642', role: 'membro', estado: 'pendente', criadoEm: ago(27) },
  ];
}

// Conversas de exemplo entre membros e a tesouraria
export function seedMessages(now = new Date()) {
  const ago = (days, h = 0) => new Date(now.getTime() - days * 86400000 - h * 3600000).toISOString();
  return [
    { id: 'msg_1', membroId: 'm_ana', de: 'membro', texto: 'Bom dia. A minha contribuição de agosto aparece como rejeitada. Podem verificar, por favor?', criadoEm: ago(5, 3), lida: true },
    { id: 'msg_2', membroId: 'm_ana', de: 'admin', autorId: 'm_admin', texto: 'Bom dia, Ana. A referência de agosto não aparecia no extrato. Se declarar novamente com o código do SMS, confirmamos logo.', criadoEm: ago(4, 6), lida: true },
    { id: 'msg_3', membroId: 'm_ana', de: 'membro', texto: 'Obrigado pela explicação. Vou tratar disso esta semana.', criadoEm: ago(4, 2), lida: true },
    { id: 'msg_4', membroId: 'm_ana', de: 'admin', autorId: 'm_admin', texto: 'Com todo o gosto. Qualquer dúvida, escreva por aqui.', criadoEm: ago(1, 5), lida: false },
    { id: 'msg_5', membroId: 'm_03', de: 'membro', texto: 'Boa tarde. Posso contribuir em numerário no culto de domingo? A quem entrego?', criadoEm: ago(0, 2), lida: false },
    { id: 'msg_6', membroId: 'm_07', de: 'membro', texto: 'Gostaria de saber se é possível receber o recibo impresso para os meus registos.', criadoEm: ago(1, 1), lida: false },
  ];
}

export function notificationText(c) {
  const v = c.valor.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const [y, m, d] = c.data.split('-');
  return c.estado === 'confirmado'
    ? `A sua contribuição de ${v} MT de ${d}/${m}/${y} foi confirmada. Obrigado.`
    : `A sua contribuição de ${v} MT de ${d}/${m}/${y} não pôde ser confirmada. ${c.motivo}`;
}
