// Formatação pt-MZ: meticais, datas e telefones. Sem dependências do DOM.

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export const METODOS = {
  mpesa: 'M-Pesa',
  emola: 'e-Mola',
  banco: 'Transferência bancária',
  numerario: 'Numerário',
};

export const ESTADOS = {
  confirmado: 'Confirmada',
  pendente: 'Pendente',
  rejeitado: 'Rejeitada',
};

export const pad = (n) => String(n).padStart(2, '0');

export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const monthKey = (s) => s.slice(0, 7);

// 12 500 000,00 MT — espaço fino como separador de milhares, sempre (também em 4 dígitos)
export function money(v, { decimals = true, unit = true } = {}) {
  const neg = v < 0;
  const [int, dec] = Math.abs(v).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '−' : ''}${grouped}${decimals ? ',' + dec : ''}${unit ? ' MT' : ''}`;
}

export function moneyCompact(v) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2).replace('.', ',')} M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} mil`;
  return String(Math.round(v));
}

export const pct = (v) => `${v.toFixed(1).replace('.', ',')}%`;

export function fmtDate(s) {
  const d = parseISO(s);
  return `${pad(d.getDate())} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDateShort(s) {
  const d = parseISO(s);
  return `${pad(d.getDate())} ${MESES[d.getMonth()]}`;
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  return `${fmtDate(isoDate(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtLongToday(d = new Date()) {
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES_LONGOS[d.getMonth()]} de ${d.getFullYear()}`;
}

export function monthShort(key) {
  return MESES[Number(key.slice(5, 7)) - 1];
}

export function monthLong(key) {
  return `${MESES_LONGOS[Number(key.slice(5, 7)) - 1]} de ${key.slice(0, 4)}`;
}

export function phoneFmt(t) {
  return `${t.slice(0, 2)} ${t.slice(2, 5)} ${t.slice(5)}`;
}

export function initials(nome) {
  const parts = nome.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export const firstName = (nome) => nome.trim().split(/\s+/)[0];

// Aceita "2 500", "2500,50", "2.500,50"
export function parseAmount(raw) {
  const s = String(raw).replace(/[\s\u00A0\u202F]/g, "");
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export const isValidPhone = (t) => /^8[2-7]\d{7}$/.test(t);

// Quem enviou o dinheiro: por omissão, o número (carteiras móveis) ou o nome do membro
export function defaultPayer(member, metodo) {
  if (!member) return '';
  return metodo === 'mpesa' || metodo === 'emola' ? `+258 ${phoneFmt(member.telefone)}` : member.nome;
}

// Períodos dos relatórios: dia, semana (segunda a domingo) e mês
export function periodRange(kind, anchor = isoDate()) {
  const d = parseISO(anchor);
  if (kind === 'semana') {
    const start = new Date(d); start.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const from = isoDate(start), to = isoDate(end);
    return { from, to, label: `Semana de ${fmtDateShort(from)} a ${fmtDate(to)}` };
  }
  if (kind === 'mes') {
    const from = isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
    const to = isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const label = monthLong(from.slice(0, 7));
    return { from, to, label: label[0].toUpperCase() + label.slice(1) };
  }
  return { from: anchor, to: anchor, label: fmtDate(anchor) };
}

// Desloca a data de referência um período para trás (-1) ou para a frente (+1)
export function shiftPeriod(kind, anchor, step) {
  const d = parseISO(anchor);
  if (kind === 'mes') d.setMonth(d.getMonth() + step, 1);
  else d.setDate(d.getDate() + step * (kind === 'semana' ? 7 : 1));
  return isoDate(d);
}
