// Componentes de apresentação partilhados (strings HTML) e pequenos utilitários de DOM.
import { ICONS } from './icons.js';
import {
  ESTADOS, METODOS, money, moneyCompact, monthLong, fmtDate, fmtDateTime, initials, phoneFmt, porExtenso,
} from './format.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function icon(name, size = 20) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Aceita o nome ou o objeto do membro; usa a fotografia quando existe.
export function avatar(person, size = 36) {
  const nome = typeof person === 'string' ? person : person?.nome || '?';
  const foto = typeof person === 'object' ? person?.foto : null;
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px`;
  if (foto) return `<span class="avatar avatar--photo" style="${style}" aria-hidden="true"><img src="${foto}" alt=""></span>`;
  return `<span class="avatar" style="${style}" aria-hidden="true">${esc(initials(nome))}</span>`;
}

export const status = (estado) => `<span class="status status--${estado}">${ESTADOS[estado]}</span>`;

export function progress(p) {
  const v = Math.max(0, Math.min(100, p));
  return `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v.toFixed(1)}"><div class="progress__fill" style="width:${v}%"></div></div>`;
}

// Escala "redonda" para o eixo (1; 1,5; 2; 2,5; 3; 4; 5; 6; 8 × 10^n)
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= v);
}

// Gráfico de barras com eixo e linhas de grelha (sem valores em cima de cada barra).
// private: só alturas relativas, sem montantes (vista do membro)
export function barChart(series, { height = 160, private: priv = false } = {}) {
  const top = niceMax(Math.max(...series.map((s) => s.value), 1));
  const axis = priv ? '' : `<div class="chart__axis" aria-hidden="true"><span>${moneyCompact(top)}</span><span>${moneyCompact(top / 2)}</span><span>0</span></div>`;
  return `<div class="chart${priv ? '' : ' chart--axis'}" style="height:${height}px" role="img" aria-label="${priv ? 'Evolução mensal das contribuições' : 'Valores recebidos por mês'}">${axis}${series
    .map(
      (s) => `<div class="chart__col${s.current ? ' is-current' : ''}" title="${esc(monthLong(s.key))}${priv ? '' : `: ${esc(money(s.value))}`}">
        <div class="chart__track"><div class="chart__bar" style="height:${((s.value / top) * 100).toFixed(1)}%"></div></div>
        <span class="chart__label">${esc(s.label)}</span>
      </div>`,
    )
    .join('')}</div>`;
}

function row(label, value) {
  return `<div class="receipt__row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
}

// O recibo: o mesmo documento para membro e tesouraria.
export function receipt(c, { member, reviewer, settings, showProof = false }) {
  const rows = [
    row('Membro', esc(member?.nome || '—')),
    row('Telemóvel', member ? `+258 ${esc(phoneFmt(member.telefone))}` : '—'),
    row('Data do pagamento', esc(fmtDate(c.data))),
    row('Método', esc(METODOS[c.metodo])),
  ];
  // Valor recebido e lançado por um gestor: o recibo funciona como acusação de receção
  if (c.registadoPor) rows.push(row('Registado em', esc(fmtDateTime(c.revistoEm || c.declaradoEm))));
  else rows.push(row('Declarada em', esc(fmtDateTime(c.declaradoEm))));
  if (c.estado === 'confirmado' && !c.registadoPor) rows.push(row('Confirmada em', `${esc(fmtDateTime(c.revistoEm))}${reviewer ? `<br><span class="muted small">${esc(reviewer.nome)} · Tesouraria</span>` : ''}`));
  if (c.estado === 'rejeitado') rows.push(row('Revista em', esc(fmtDateTime(c.revistoEm))));
  if (c.nota) rows.push(row('Nota', esc(c.nota)));

  let note = '';
  if (c.estado === 'pendente' && !showProof) note = 'Aguarda confirmação da tesouraria. Será notificado assim que for revista.';
  if (c.estado === 'rejeitado') note = `Não foi possível confirmar: ${esc(c.motivo)}`;

  let proof = '';
  if (showProof) {
    if (c.comprovativo?.dataUrl) proof = `<div class="receipt__proof"><p class="eyebrow" style="margin-bottom:8px">Comprovativo</p><img src="${c.comprovativo.dataUrl}" alt="Comprovativo enviado pelo membro"></div>`;
    else if (c.comprovativo?.nome) proof = `<div class="receipt__proof"><p class="eyebrow" style="margin-bottom:8px">Comprovativo</p><p class="small">${icon('file-text', 16)} ${esc(c.comprovativo.nome)}</p></div>`;
    else proof = `<div class="receipt__proof"><p class="eyebrow" style="margin-bottom:8px">Comprovativo</p><p class="small muted">O membro não anexou comprovativo.</p></div>`;
  }

  // Texto do recibo, como num recibo em papel: quem pagou e a quantia por extenso
  const words = c.estado === 'confirmado'
    ? `<p class="receipt__words">Recebemos de <strong>${esc(member?.nome || '—')}</strong> a quantia de <strong>${esc(porExtenso(c.valor))}</strong>, referente à contribuição para a ${esc(settings.obraNome)}.</p>`
    : `<p class="receipt__words muted">Contribuição para a ${esc(settings.obraNome)}.</p>`;
  return `<article class="receipt">
    <header class="receipt__head">
      <img class="receipt__mark" src="assets/brand/mark-navy.svg" alt="">
      <div class="receipt__org"><p>Nataniel Litsure Ministries</p><p>${c.registadoPor ? 'Recibo de receção' : 'Recibo de contribuição'}</p></div>
      <div class="receipt__no"><span>N.º</span><strong class="num">${esc(c.ref)}</strong></div>
    </header>
    <div class="receipt__amount"><span class="receipt__cur">MT</span><span class="display-num">${money(c.valor, { unit: false })}</span>${status(c.estado)}</div>
    ${words}
    <dl class="receipt__rows">${rows.join('')}</dl>
    ${note ? `<p class="receipt__note">${note}</p>` : ''}
    ${proof}
  </article>`;
}

// Régua da obra: a meta dividida em cinco troços, com marcas a cada 5% e o ponto atual
export function ruler(value, meta) {
  const p = meta ? Math.max(0, Math.min(100, (value / meta) * 100)) : 0;
  const scale = (v) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('pt-PT', { maximumFractionDigits: 2 })} M` : moneyCompact(v));
  const ticks = Array.from({ length: 21 }, (_, i) => `<i class="${i % 4 === 0 ? 'is-major' : ''}" style="left:${i * 5}%"></i>`).join('');
  const labels = Array.from({ length: 6 }, (_, i) => `<span style="left:${i * 20}%">${scale((meta * i) / 5)}</span>`).join('');
  const pctTxt = `${p.toFixed(1).replace('.', ',')}%`;
  return `<div class="ruler" role="img" aria-label="${pctTxt} da meta">
    <div class="ruler__track"><div class="ruler__fill" style="width:${p}%"></div><span class="ruler__mark${p > 85 ? ' is-end' : ''}" style="left:${p}%"><b>${pctTxt}</b></span></div>
    <div class="ruler__ticks">${ticks}</div>
    <div class="ruler__scale">${labels}</div>
  </div>`;
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

export function openDialog(html, { onMount, className = '' } = {}) {
  const d = document.createElement('dialog');
  d.className = `sheet ${className}`;
  d.innerHTML = html;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
  d.showModal();
  onMount?.(d);
  return d;
}

export function confirmDialog({ title, text, confirmLabel }) {
  return new Promise((resolve) => {
    let ok = false;
    const d = openDialog(`
      <div class="sheet__body"><h2 style="font-size:17px">${esc(title)}</h2><p class="muted" style="margin-top:8px">${esc(text)}</p></div>
      <div class="sheet__foot"><button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${esc(confirmLabel)}</button></div>`);
    d.querySelector('[data-ok]').addEventListener('click', () => { ok = true; d.close(); });
    d.addEventListener('close', () => resolve(ok));
  });
}

export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Bom dia' : h < 19 ? 'Boa tarde' : 'Boa noite';
}
