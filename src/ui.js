// Componentes de apresentação partilhados (strings HTML) e pequenos utilitários de DOM.
import { ICONS } from './icons.js';
import {
  ESTADOS, METODOS, money, moneyCompact, monthLong, fmtDate, fmtDateTime, initials, phoneFmt,
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

// private: só alturas relativas, sem montantes (vista do membro)
export function barChart(series, { height = 160, showValues = false, private: priv = false } = {}) {
  const max = Math.max(...series.map((s) => s.value), 1);
  return `<div class="chart" style="height:${height}px" role="img" aria-label="${priv ? 'Evolução mensal das contribuições' : 'Valores confirmados por mês'}">${series
    .map(
      (s) => `<div class="chart__col${s.current ? ' is-current' : ''}" title="${esc(monthLong(s.key))}${priv ? '' : `: ${esc(money(s.value))}`}">
        ${showValues ? `<span class="chart__val num">${s.value ? moneyCompact(s.value) : '—'}</span>` : ''}
        <div class="chart__track"><div class="chart__bar" style="height:${((s.value / max) * 100).toFixed(1)}%"></div></div>
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

  return `<article class="receipt">
    <header class="receipt__head">
      <img class="receipt__mark" src="assets/brand/mark-navy.svg" alt="">
      <div><p class="eyebrow">${c.registadoPor ? 'Recibo de receção' : 'Recibo de contribuição'}</p><p class="receipt__ref">${esc(c.ref)}</p></div>
      ${status(c.estado)}
    </header>
    <div class="receipt__amount"><span class="display-num">${money(c.valor, { unit: false })}</span><span class="receipt__unit">MT</span></div>
    <p class="receipt__dest muted">${esc(settings.obraNome)}</p>
    <dl class="receipt__rows">${rows.join('')}</dl>
    ${note ? `<p class="receipt__note">${note}</p>` : ''}
    ${proof}
  </article>`;
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
