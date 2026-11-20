// Área de gestão. Dois papéis:
//  - administração (principal): vê tudo — total geral, saldo de cada gestor, relatórios de todos;
//    cria e suspende gestores, gere membros e a meta da obra;
//  - gestor: regista membros, lança os valores que recebe (com recibo de receção) e imprime
//    relatórios — vê apenas os seus próprios recebimentos e o seu saldo acumulado.
// Os membros não entram no sistema: são registados pelos gestores.
import * as store from '../store.js';
import {
  esc, icon, avatar, progress, ruler, barChart, receipt, toast, openDialog, confirmDialog, navigate,
} from '../ui.js';
import {
  pinProblem, METODOS, CATEGORIAS, money, pct, fmtDate, fmtDateShort, fmtDateTime, fmtLongToday, monthKey, monthShort, monthLong,
  phoneFmt, isValidPhone, isoDate, parseAmount, defaultPayer, firstName, periodRange, shiftPeriod,
} from '../format.js';
import { receiptData, whatsappLink, downloadPdf, sharePdf, canSharePdf, pdfButton, warmPdf, receiptPdf } from '../share.js';
import { downloadReportPdf } from '../reportpdf.js';

// [chave, rótulo, ícone, rótulo curto para a barra inferior do telemóvel]
const NAV_ADMIN = [
  ['painel', 'Painel', 'layout-dashboard', 'Painel'],
  ['gestores', 'Gestores', 'key-round', 'Gestores'],
  ['contribuicoes', 'Recebimentos', 'receipt', 'Entradas'],
  ['despesas', 'Despesas', 'wallet', 'Saídas'],
  ['membros', 'Membros', 'users', 'Membros'],
  ['relatorios', 'Relatórios', 'file-text', 'Relatórios'],
  ['obra', 'Obra', 'landmark', 'Obra', 'no-phone'],
];
const NAV_GESTOR = [
  ['inicio', 'Início', 'home', 'Início'],
  ['contribuicoes', 'Recebimentos', 'receipt', 'Recebidos'],
  ['membros', 'Membros', 'users', 'Membros'],
  ['relatorios', 'Relatórios', 'file-text', 'Relatórios'],
];

// A conta de desenvolvedor (super admin) tem o mesmo acesso que a administração
const isAdmin = (u) => u.role === 'admin' || u.role === 'super';

// Campos de telemóvel (+258) nas janelas: só algarismos, no máximo 9, no formato 84 123 4567
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.matches?.('.phone input')) return;
  const d = el.value.replace(/\D/g, '').slice(0, 9);
  el.value = d.length > 5 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}` : d.length > 2 ? `${d.slice(0, 2)} ${d.slice(2)}` : d;
});
const sumv = (l) => l.reduce((s, c) => s + c.valor, 0);
const roleLabel = (u) => (u.role === 'super' ? 'Desenvolvedor' : u.cargo || (isAdmin(u) ? 'Administração' : 'Gestor'));

// Recebimentos visíveis para este utilizador: a administração vê tudo, o gestor só os seus
async function visibleReceipts(user) {
  const all = await store.listContributions({ estado: 'confirmado' });
  return isAdmin(user) ? all : all.filter((c) => c.registadoPor === user.id);
}

// Saldo acumulado e totais de hoje, desta semana e deste mês
function totals(list, today = isoDate()) {
  const wk = periodRange('semana', today);
  const mo = periodRange('mes', today);
  const pick = (f) => { const l = list.filter(f); return { valor: sumv(l), n: l.length }; };
  return {
    total: pick(() => true),
    hoje: pick((c) => c.data === today),
    semana: pick((c) => c.data >= wk.from && c.data <= wk.to),
    mes: pick((c) => c.data >= mo.from && c.data <= mo.to),
  };
}

// Listas: 10 de cada vez, com "Mostrar mais" (mesmo comportamento em todas as páginas)
const PAGE = 10;
function pageFoot(shown, total, summary = '') {
  return `<div class="table-foot"><span>A mostrar ${shown} de ${total}${summary}</span>${total > shown ? `<button type="button" class="btn btn-secondary btn-sm" data-more>Mostrar mais ${Math.min(PAGE, total - shown)}</button>` : ''}</div>`;
}

// Caixa da obra ------------------------------------------------------------
// Saldo disponível = tudo o que foi recebido − todas as despesas (as anuladas não contam)
const validExp = (l) => l.filter((e) => !e.anulada);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function caixa(received, expenses) {
  const entradas = sumv(received);
  const saidas = sumv(validExp(expenses));
  return { entradas, saidas, saldo: entradas - saidas };
}
function finStrip(received, expenses) {
  const k = caixa(received, expenses);
  return `<section class="fin" aria-label="Caixa da obra">
    <div class="fin__item"><p class="fin__l">${icon('receipt', 16)} Total recebido</p><p class="fin__v num">${money(k.entradas)}</p><p class="fin__s">${plural(received.length, 'recibo emitido', 'recibos emitidos')}</p></div>
    <div class="fin__item"><p class="fin__l">${icon('wallet', 16)} Total gasto</p><p class="fin__v num">${money(k.saidas)}</p><p class="fin__s">${plural(validExp(expenses).length, 'despesa registada', 'despesas registadas')}</p></div>
    <div class="fin__item is-main${k.saldo < 0 ? ' is-neg' : ''}"><p class="fin__l">Saldo disponível</p><p class="fin__v num">${money(k.saldo)}</p><p class="fin__s">recebido menos gasto</p></div>
  </section>`;
}

// Totais por mês dos últimos n meses (para os gráficos)
function monthlyOf(list, n = 6) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    const key = isoDate(d).slice(0, 7);
    return { key, label: monthShort(key), value: sumv(list.filter((c) => monthKey(c.data) === key)), current: i === n - 1 };
  });
}

// Toda a gente que aparece nos ecrãs: membros, gestores e administração
async function peopleMap() {
  const [members, gestores, admin] = await Promise.all([store.listMembers(), store.listGestores(), store.getMember('m_admin')]);
  return new Map([...members, ...gestores, admin].filter(Boolean).map((m) => [m.id, m]));
}

export async function renderAdmin(root, page, user, param) {
  document.body.className = 'is-admin';
  const nav = isAdmin(user) ? NAV_ADMIN : NAV_GESTOR;
  // Página fora das permissões deste papel: vai para a primeira página permitida
  if (!nav.some(([k]) => k === page)) return location.replace(`#/a/${nav[0][0]}`);
  const mine = isAdmin(user) ? null : totals(await visibleReceipts(user));

  root.innerHTML = `
    <div class="a-shell">
      <aside class="a-side">
        <div class="a-side__logo"><img class="a-side__lockup" src="assets/brand/logo-lockup-white.svg" alt="Nataniel Litsure Ministries" width="148" height="65"><img class="a-side__mark" src="assets/brand/mark-white.svg" alt="" aria-hidden="true" width="36" height="36"></div>
        <nav class="a-nav" aria-label="Gestão" style="--nav-n:${nav.length};--nav-p:${nav.filter((n) => !n[4]).length}">
          ${(() => {
            const items = nav.map(([k, l, ic, short, x]) => `<a href="#/a/${k}" data-nav="${k}" title="${l}" aria-label="${l}" class="${k === page ? 'is-active' : ''}${x ? ` ${x}` : ''}" ${k === page ? 'aria-current="page"' : ''}>${icon(ic, 18)}<span class="a-nav__full">${l}</span><span class="a-nav__short">${short}</span></a>`);
            // Telemóvel do gestor: botão central para registar uma contribuição
            if (!isAdmin(user)) items.splice(2, 0, `<button type="button" class="a-nav__fab" data-record aria-label="Registar contribuição" title="Registar contribuição">${icon('plus', 24)}</button>`);
            return items.join('');
          })()}
        </nav>
        <div class="a-side__foot">
          ${mine ? `<div class="side-saldo"><p>O seu saldo acumulado</p><p class="side-saldo__v num">${money(mine.total.valor, { decimals: false })}</p></div>` : ''}
          <p class="a-side__ver">Versão 1.0</p>
        </div>
      </aside>
      <div class="a-main">
        <div class="a-bar">
          <img class="a-bar__brand" src="assets/brand/logo-lockup-navy.svg" alt="Nataniel Litsure Ministries" width="92" height="40"><form class="a-search" data-search role="search">${icon('search', 18)}<input type="search" placeholder="Procurar membro, recibo ou referência" aria-label="Procurar"></form>
          <div class="a-bar__end">
            ${isAdmin(user) ? '' : `<button type="button" class="btn btn-primary btn-sm a-bar__cta" data-record aria-label="Registar contribuição">${icon('plus-circle', 16)}<span class="a-bar__cta-t">Registar contribuição</span></button><span class="a-bar__sep" aria-hidden="true"></span>`}
            <button type="button" class="a-me" data-account title="A minha conta · alterar PIN">${avatar(user, 34)}<div><p>${esc(user.nome)}</p><p class="a-me__role">${esc(roleLabel(user))}</p></div></button>
            <button type="button" class="a-out" data-act="logout" aria-label="Terminar sessão" title="Terminar sessão">${icon('log-out', 18)}<span>Sair</span></button>
          </div>
        </div>
        <header class="a-top"><div><p class="a-top__eyebrow" data-eyebrow></p><h1 data-title></h1></div><div class="a-top__actions" data-actions></div></header>
        <div class="a-content" id="main"></div>
      </div>
    </div>`;

  const ctx = {
    main: root.querySelector('#main'),
    user,
    param,
    head(eyebrow, title, actions = '') {
      root.querySelector('[data-eyebrow]').textContent = eyebrow;
      root.querySelector('[data-title]').textContent = title;
      root.querySelector('[data-actions]').innerHTML = actions;
      document.title = `${title} · Nataniel Litsure Ministries`;
    },
    // Volta a desenhar a página atual (depois de registar ou alterar algo)
    refresh: () => navigate(location.hash),
  };

  root.querySelector('[data-act=logout]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Terminar sessão?', text: 'Para voltar a entrar terá de introduzir o seu PIN.', confirmLabel: 'Terminar sessão' });
    if (!ok) return;
    await store.signOut('saiu');
    navigate('#/entrar');
  });
  root.querySelectorAll('[data-record]').forEach((b) => b.addEventListener('click', () => recordDialog(ctx)));
  root.querySelector('[data-account]').addEventListener('click', () => accountDialog(ctx));
  root.querySelector('[data-search]').addEventListener('submit', (e) => {
    e.preventDefault();
    sessionStorage.setItem('nl.q', e.currentTarget.querySelector('input').value.trim());
    navigate('#/a/contribuicoes');
  });

  const pages = { painel, inicio, gestores, contribuicoes, despesas, membros, relatorios, obra };
  await pages[page](ctx);
  window.scrollTo(0, 0);
}

// A minha conta: dados e alteração do PIN ------------------------------------
function accountDialog(ctx) {
  const u = ctx.user;
  const pinField = (id, label) => `<div class="field"><label for="${id}">${label}</label><input class="input pin-input" id="${id}" type="password" inputmode="numeric" maxlength="4" autocomplete="${id === 'pa-cur' ? 'current-password' : 'new-password'}" placeholder="••••"></div>`;
  const d = openDialog(`
    <header class="sheet__head"><h2>A minha conta</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <form class="sheet__body account" novalidate>
      <div class="account__who">${avatar(u, 48)}<div><p class="account__name">${esc(u.nome)}</p><p class="muted small">${esc(roleLabel(u))} · <span class="num">+258 ${esc(phoneFmt(u.telefone))}</span></p></div></div>
      <section class="account__sec">
        <h3>${icon('key-round', 18)} Alterar PIN</h3>
        <p class="hint">Escolha um PIN que só você conheça e não o partilhe com ninguém.</p>
        ${pinField('pa-cur', 'PIN atual')}
        <div class="rec-form__row">${pinField('pa-new', 'Novo PIN')}${pinField('pa-rep', 'Repita o novo PIN')}</div>
        <p class="error-text" data-error hidden></p>
      </section>
      <div class="rec-form__foot"><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button type="submit" class="btn btn-primary">${icon('check', 18)} Guardar novo PIN</button></div>
    </form>`);
  const form = d.querySelector('form');
  const $ = (q) => d.querySelector(q);
  d.querySelectorAll('.pin-input').forEach((i) => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 4); }));
  $('#pa-cur').focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = $('#pa-cur').value, p1 = $('#pa-new').value, p2 = $('#pa-rep').value;
    const err = $('[data-error]');
    const msg = !/^\d{4}$/.test(cur) ? 'Introduza o seu PIN atual (4 dígitos).'
      : pinProblem(p1, p2) || (p1 === cur ? 'O novo PIN tem de ser diferente do atual.' : '');
    err.textContent = msg; err.hidden = !msg;
    if (msg) return;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const r = await store.changePin(cur, p1);
      if (r?.signedOut) { d.close(); navigate('#/entrar'); return; }
      d.close();
      toast('PIN alterado. Use o novo PIN na próxima entrada.');
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false; btn.disabled = false;
      $('#pa-cur').value = ''; $('#pa-cur').focus();
    }
  });
}

// Recibo --------------------------------------------------------------------
// Botão "Baixar PDF" do recibo
function bindPdf(d, data) {
  warmPdf();
  d.querySelector('[data-pdf]').addEventListener('click', async (e) => {
    try { await pdfButton(e.currentTarget, () => downloadPdf(data)); } catch (ex) { toast(ex.message); }
  });
}

// Enviar o comprovativo ao membro: WhatsApp com a mensagem pronta, PDF partilhado ou descarregado
// Envio automático (WhatsApp oficial): estado de cada recibo, como numa notificação bancária
const ENVIO = {
  a_enviar: ['A enviar o comprovativo por WhatsApp…', 'is-busy'],
  enviado: ['Comprovativo enviado por WhatsApp', 'is-ok'],
  entregue: ['Comprovativo entregue no WhatsApp do membro', 'is-ok'],
  lido: ['Comprovativo lido pelo membro', 'is-ok'],
  falhou: ['O comprovativo não foi enviado', 'is-bad'],
};

function autoBox(c, data) {
  const st = c.envioEstado;
  const [label, cls] = ENVIO[st] || ['O comprovativo ainda não foi enviado', 'is-idle'];
  const from = `de +258 ${esc(phoneFmt(data.w || '879470600'))} para +258 ${esc(phoneFmt(data.t))}`;
  return `<section class="deliver deliver--auto ${cls}" aria-live="polite" aria-label="Envio do comprovativo">
    <div class="deliver__head">
      <span class="deliver__icon">${st === 'a_enviar' ? '<span class="btn-spin" aria-hidden="true"></span>' : icon(st === 'falhou' ? 'x' : st ? 'check' : 'message-circle', 20)}</span>
      <div><p class="deliver__title">${label}</p>
      <p class="muted small">WhatsApp ${from}${c.envioEm && st !== 'a_enviar' ? ` · ${esc(fmtDateTime(c.envioEm))}` : ''}</p></div>
    </div>
    ${st === 'falhou' && c.envioErro ? `<p class="deliver__err">${esc(c.envioErro)}</p>` : ''}
    ${!st || st === 'falhou' ? `<div class="deliver__actions"><button type="button" class="btn btn-primary" data-auto-send>${icon('send', 17)} ${st ? 'Tentar de novo' : 'Enviar agora'}</button></div>` : ''}
  </section>`;
}

async function autoSend(d, c, data) {
  const paint = (x) => {
    const box = d.querySelector('.deliver');
    if (box) box.outerHTML = autoBox(x, data);
    d.querySelector('[data-auto-send]')?.addEventListener('click', () => autoSend(d, x, data));
  };
  paint({ ...c, envioEstado: 'a_enviar' });
  let res;
  try { res = await store.sendReceipt(c.id, await receiptPdf(data), { force: c.envioEstado === 'falhou' }); } catch (ex) { res = { estado: 'falhou', erro: ex.message }; }
  d.dataset.changed = '1';
  paint({ ...c, envioEstado: res.estado, envioErro: res.erro, envioEm: new Date().toISOString() });
  toast(res.estado === 'falhou' ? 'O comprovativo não foi enviado' : `Comprovativo enviado a ${firstName(data.n)} por WhatsApp`);
}

function deliverBox(c, data) {
  if (store.AUTO_WHATSAPP) return autoBox(c, data);
  const sent = c.notificadoEm
    ? `<p class="deliver__sent">${icon('check', 14)} Enviado ${c.notificadoCanal === 'pdf' ? 'em PDF' : 'por WhatsApp'} em ${esc(fmtDateTime(c.notificadoEm))}</p>`
    : '';
  return `<section class="deliver" aria-label="Enviar comprovativo ao membro">
    <div class="deliver__head">
      <span class="deliver__icon">${icon('message-circle', 20)}</span>
      <div><p class="deliver__title">Enviar comprovativo a ${esc(firstName(data.n))}</p>
      <p class="muted small">Mensagem de confirmação e recibo em PDF para +258 ${esc(phoneFmt(data.t))}</p></div>
    </div>
    <p class="deliver__from">${icon('smartphone', 14)} Enviar a partir do WhatsApp oficial da tesouraria: <strong class="num">+258 ${esc(phoneFmt(data.w || '879470600'))}</strong></p>
    ${sent}
    <div class="deliver__actions">
      <a class="btn btn-primary" href="${esc(whatsappLink(data))}" target="_blank" rel="noopener" data-wa>${icon('send', 17)} ${c.notificadoEm ? 'Reenviar' : 'Enviar'} por WhatsApp</a>
      ${canSharePdf() ? `<button type="button" class="btn btn-secondary" data-share>${icon('share', 17)} Partilhar PDF</button>` : ''}
    </div>
  </section>`;
}

function wireDeliver(d, c, data, user) {
  if (store.AUTO_WHATSAPP) {
    d.querySelector('[data-auto-send]')?.addEventListener('click', () => autoSend(d, c, data));
    return;
  }
  const mark = async (canal) => {
    await store.markNotified(c.id, { por: user.id, canal });
    d.dataset.changed = '1';
    const box = d.querySelector('.deliver');
    if (box) box.outerHTML = deliverBox({ ...c, notificadoEm: new Date().toISOString(), notificadoCanal: canal }, data);
    wireDeliver(d, { ...c, notificadoEm: new Date().toISOString(), notificadoCanal: canal }, data, user);
  };
  d.querySelector('[data-wa]')?.addEventListener('click', () => { setTimeout(() => mark('whatsapp'), 300); toast('A abrir o WhatsApp com a mensagem pronta'); });
  d.querySelector('[data-share]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await sharePdf(data); await mark('pdf'); } catch (ex) { if (ex.name !== 'AbortError') toast(ex.message); }
    b.disabled = false;
  });
}

async function receiptDialog(c, people, user) {
  user ||= await store.getSessionUser();
  const settings = await store.getSettings();
  const member = people.get(c.membroId);
  const reviewer = people.get(c.registadoPor || c.revistoPor);
  const data = receiptData(c, { member, reviewer, settings });
  const canSend = c.estado === 'confirmado' && member?.telefone && user;
  const d = openDialog(`
    <header class="sheet__head"><h2>Recibo ${esc(c.ref)}</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <div class="sheet__scroll">${canSend ? deliverBox(c, data) : ''}${receipt(c, { member, reviewer, settings })}</div>
    <div class="sheet__foot"><button type="button" class="btn btn-secondary" data-close>Fechar</button><button type="button" class="btn btn-primary" data-pdf>${icon('download', 18)} Baixar PDF</button></div>`);
  bindPdf(d, data);
  if (canSend) wireDeliver(d, c, data, user);
  d.addEventListener('close', () => { if (d.dataset.changed) navigate(location.hash); });
}

// Registar contribuição (gestor) ----------------------------------------------
const PAYER_LABEL = { mpesa: 'Número ou nome usado no M-Pesa', emola: 'Número ou nome usado no e-Mola', banco: 'Nome do titular da conta', numerario: 'Entregue por' };

async function recordDialog(ctx, preMemberId = '') {
  const members = (await store.listMembers()).filter((m) => m.estado !== 'suspenso');
  const label = (m) => `${m.nome} · ${phoneFmt(m.telefone)}`;
  const byLabel = new Map(members.map((m) => [label(m), m]));
  const pre = members.find((m) => m.id === preMemberId);
  const today = isoDate();

  const d = openDialog(`
    <header class="sheet__head"><h2>Registar contribuição</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <form class="sheet__body rec-form" novalidate>
      <div class="field">
        <div class="rec-form__label"><label for="rec-m">Membro</label><button type="button" class="link small" data-new-member>${icon('user-plus', 14)} Novo membro</button></div>
        <div class="combo">
          <input class="input" id="rec-m" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="rec-list" autocomplete="off" spellcheck="false" placeholder="Escreva o nome ou o telemóvel" value="${pre ? esc(label(pre)) : ''}">
          <ul class="combo__list" id="rec-list" role="listbox" hidden></ul>
        </div>
      </div>
      <div class="field">
        <label for="rec-v">Valor recebido</label>
        <div class="rec-amount"><input id="rec-v" inputmode="decimal" autocomplete="off" placeholder="0"><span>MT</span></div>
        <div class="rec-chips">${[500, 1000, 2500, 5000, 10000].map((v) => `<button type="button" data-v="${v}">${money(v, { decimals: false })}</button>`).join('')}</div>
      </div>
      <fieldset class="field">
        <legend>Forma de pagamento</legend>
        <div class="seg">${Object.entries(METODOS).map(([k, l]) => `<label><input type="radio" name="metodo" value="${k}" ${k === 'numerario' ? 'checked' : ''}><span>${k === 'banco' ? 'Banco' : l}</span></label>`).join('')}</div>
      </fieldset>
      <div class="rec-form__row">
        <div class="field"><label for="rec-d">Data do recebimento</label><input class="input" type="date" id="rec-d" max="${today}" value="${today}"></div>
        <div class="field"><label for="rec-p" data-payer-label>Entregue por</label><input class="input" id="rec-p" autocomplete="off" maxlength="80"></div>
      </div>
      <div class="field" data-ref-field hidden><label for="rec-r">Referência da transação <span class="muted" style="font-weight:400">(opcional)</span></label><input class="input num" id="rec-r" autocomplete="off" autocapitalize="characters" placeholder="Ex.: DJK4H7X2PQ"></div>
      <div class="field"><label for="rec-n">Nota <span class="muted" style="font-weight:400">(opcional)</span></label><input class="input" id="rec-n" maxlength="200"></div>
      <p class="error-text" data-error hidden></p>
      <div class="rec-form__foot"><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button type="submit" class="btn btn-primary">${icon('check', 18)} Registar e emitir recibo</button></div>
    </form>`, { className: 'sheet--wide' });

  const form = d.querySelector('form');
  const $ = (s) => d.querySelector(s);
  const memberInput = $('#rec-m');
  const payer = $('#rec-p');
  let payerEdited = false;
  payer.addEventListener('input', () => { payerEdited = true; });
  const current = () => byLabel.get(memberInput.value.trim());
  const sync = () => {
    const metodo = form.metodo.value;
    $('[data-payer-label]').textContent = PAYER_LABEL[metodo];
    $('[data-ref-field]').hidden = metodo === 'numerario';
    if (!payerEdited) payer.value = defaultPayer(current(), metodo);
  };
  form.querySelectorAll('[name=metodo]').forEach((r) => r.addEventListener('change', sync));
  memberInput.addEventListener('input', sync);

  // Lista de sugestões própria, alinhada ao campo (a lista nativa do navegador
  // aparece desalinhada dentro do diálogo). Procura por nome ou por telemóvel.
  const list = $('#rec-list');
  let matches = [], active = -1;
  const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const closeList = () => { list.hidden = true; memberInput.setAttribute('aria-expanded', 'false'); active = -1; };
  const paintList = () => {
    list.innerHTML = matches.length
      ? matches.map((m, i) => `<li role="option" id="rec-opt-${i}" data-i="${i}" aria-selected="${i === active}" class="${i === active ? 'is-active' : ''}"><span>${esc(m.nome)}</span><span class="num">${esc(phoneFmt(m.telefone))}</span></li>`).join('')
      : '<li class="combo__empty">Nenhum membro encontrado. Use "Novo membro" para o adicionar.</li>';
    list.hidden = false;
    memberInput.setAttribute('aria-expanded', 'true');
    memberInput.setAttribute('aria-activedescendant', active >= 0 ? `rec-opt-${active}` : '');
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };
  const search = () => {
    const q = norm(memberInput.value.trim());
    const digits = q.replace(/\D/g, '');
    if (!q || current()) return closeList();
    matches = members.filter((m) => norm(m.nome).includes(q) || (digits.length >= 2 && m.telefone.includes(digits))).slice(0, 8);
    active = matches.length ? 0 : -1;
    paintList();
  };
  const choose = (m) => { memberInput.value = label(m); closeList(); sync(); $('#rec-v').focus(); };
  memberInput.addEventListener('input', search);
  memberInput.addEventListener('focus', search);
  memberInput.addEventListener('blur', () => setTimeout(closeList, 120));
  memberInput.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (matches.length) { active = (active + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length; paintList(); }
    } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(matches[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeList(); }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) { e.preventDefault(); choose(matches[Number(li.dataset.i)]); }
  });
  d.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { $('#rec-v').value = b.dataset.v; $('#rec-v').focus(); }));
  $('[data-new-member]').addEventListener('click', () => addMemberDialog((m) => {
    members.push(m);
    byLabel.set(label(m), m);
    memberInput.value = label(m);
    sync();
  }));
  sync();
  (pre ? $('#rec-v') : memberInput).focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = current();
    const valor = parseAmount($('#rec-v').value);
    const data = $('#rec-d').value;
    const metodo = form.metodo.value;
    const pagador = payer.value.trim().replace(/\s+/g, ' ');
    const err = $('[data-error]');
    const msg = !m ? 'Escolha o membro na lista (ou adicione um novo membro).'
      : !Number.isFinite(valor) || valor <= 0 ? 'Indique o valor recebido.'
      : valor > 10_000_000 ? 'Verifique o valor: parece demasiado alto.'
      : !data || data > today ? 'Indique a data do recebimento (não pode ser futura).'
      : pagador.length < 3 ? 'Indique quem entregou ou enviou o valor.' : '';
    err.textContent = msg; err.hidden = !msg;
    if (msg) return;
    const c = await store.recordContribution({
      membroId: m.id, valor, metodo, data, pagador,
      referencia: metodo === 'numerario' ? '' : $('#rec-r').value.trim().toUpperCase(),
      nota: $('#rec-n').value.trim(), registadoPor: ctx.user.id,
    });
    const settings = await store.getSettings();
    // O diálogo passa a mostrar o recibo de receção e o envio do comprovativo ao membro
    const rd = receiptData(c, { member: m, reviewer: ctx.user, settings });
    d.innerHTML = `
      <header class="sheet__head"><h2>Contribuição registada</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
      <div class="sheet__scroll">${deliverBox(c, rd)}${receipt(c, { member: m, reviewer: ctx.user, settings })}</div>
      <div class="sheet__foot"><button type="button" class="btn btn-secondary" data-again>Registar outra</button><button type="button" class="btn btn-primary" data-pdf>${icon('download', 18)} Baixar PDF</button></div>`;
    bindPdf(d, rd);
    wireDeliver(d, c, rd, ctx.user);
    if (store.AUTO_WHATSAPP) autoSend(d, c, rd);
    d.querySelector('[data-again]').addEventListener('click', () => { d.close(); recordDialog(ctx); });
    d.addEventListener('close', () => ctx.refresh(), { once: true });
    toast(`Recibo ${c.ref} emitido · ${money(c.valor)}`);
  });
}

// Painel (administração) --------------------------------------------------
async function painel(ctx) {
  const { main, head } = ctx;
  const [s, series, settings, all, methods, people, gestoresList, expenses] = await Promise.all([
    store.obraSummary(), store.monthlySeries(), store.getSettings(), visibleReceipts(ctx.user),
    store.methodBreakdown(), peopleMap(), store.listGestores(), store.listExpenses(),
  ]);
  const cur = series[series.length - 1];
  const geral = totals(all);
  head(fmtLongToday(), 'Painel', '<a class="btn btn-secondary" href="#/a/relatorios">' + icon('file-text', 18) + ' Relatórios</a>');

  main.innerHTML = `
    <div class="dash">
      <div class="dash__wide dash__fin">${finStrip(all, expenses)}</div>
      <section class="card obra-card dash__obra" aria-label="Progresso da obra">
        <div class="card-head" style="margin-bottom:0"><p class="eyebrow">Total angariado<span class="d-only"> · ${esc(settings.obraNome)}</span></p><a href="#/a/obra" class="link small">Editar meta</a></div>
        <div class="obra-card__amount"><span class="display-num">${money(s.arrecadado, { decimals: false, unit: false })}</span><span class="unit">MT</span></div>
        <p class="obra-card__of muted">Meta de <span class="num">${money(s.meta, { decimals: false })}</span> · faltam <span class="num">${money(s.falta, { decimals: false })}</span></p>
        ${ruler(s.arrecadado, s.meta)}
        <dl class="stats">
          <div><dt>Recebido hoje</dt><dd>${money(geral.hoje.valor, { decimals: false })}</dd></div>
          <div><dt>Esta semana</dt><dd>${money(geral.semana.valor, { decimals: false })}</dd></div>
          <div><dt>Este mês</dt><dd>${money(geral.mes.valor, { decimals: false })}</dd></div>
          <div><dt>Recibos emitidos</dt><dd>${geral.total.n}</dd></div>
        </dl>
      </section>

      <section class="card pad dash__split" aria-label="Saldo de cada gestor">
        <div class="card-head"><p class="eyebrow">Saldo de cada gestor</p><a href="#/a/gestores" class="link small">Ver gestores</a></div>
        ${gestoresList.length ? '' : `<p class="split__empty">Ainda não há gestores. Adicione os gestores que vão receber e registar as contribuições.</p><a class="btn btn-secondary btn-sm" href="#/a/gestores">${icon('user-plus', 15)} Adicionar gestor</a>`}
        <div class="split"${gestoresList.length ? '' : ' hidden'}>${gestoresList.map((g) => {
          const t = totals(all.filter((c) => c.registadoPor === g.id));
          const share = s.arrecadado ? (t.total.valor / s.arrecadado) * 100 : 0;
          return `<div class="split__row">
            <div class="split__who"><div><p class="split__name">${esc(g.nome)}</p><p class="muted small">hoje ${money(t.hoje.valor, { decimals: false })}</p></div></div>
            <div class="split__val"><p class="num">${money(t.total.valor, { decimals: false })}</p><p class="muted small num">${pct(share)}</p></div>
            <div class="split__bar"><div style="width:${share.toFixed(1)}%"></div></div>
          </div>`;
        }).join('')}
          <div class="split__total"><span>Total geral</span><strong class="num">${money(s.arrecadado, { decimals: false })}</strong></div>
        </div>
      </section>

      <section class="card pad dash__chart">
        <div class="card-head"><p class="eyebrow">Evolução mensal</p><p class="muted small num">${cur ? `${money(cur.value, { decimals: false })} em ${monthLong(cur.key)} · ${cur.contribuintes} contribuintes` : ''}</p></div>
        ${barChart(series, { height: 220 })}
      </section>

      <section class="card pad dash__methods">
        <div class="card-head"><p class="eyebrow">Formas de pagamento</p></div>
        <div class="methods">${methods.map((m) => `
          <div><div class="method__top"><span>${m.metodo === 'banco' ? 'Transferência' : METODOS[m.metodo]}</span><span class="num" style="white-space:nowrap">${money(m.valor, { decimals: false })} <span class="muted">· ${pct(m.pct)}</span></span></div>
          <div class="method__bar"><div style="width:${m.pct.toFixed(1)}%"></div></div></div>`).join('')}
        </div>
      </section>

      <section class="card dash__wide table-card">
        <div class="card-head card-head--table"><p class="eyebrow">Últimos recebimentos</p><a href="#/a/contribuicoes" class="link small">Ver todos</a></div>
        ${receiptsTable(all.slice(0, 6), people, { showReceiver: true })}
      </section>
    </div>`;
  bindReceiptRows(main, all, people);
}

// Início (gestor) ---------------------------------------------------------
async function inicio(ctx) {
  const { main, head, user } = ctx;
  const [mine, people] = await Promise.all([visibleReceipts(user), peopleMap()]);
  const t = totals(mine);
  const first = mine.length ? mine[mine.length - 1].data : null;
  head(fmtLongToday(), 'Início');

  const period = (lbl, x) => `<div><dt>${lbl}</dt><dd class="num">${money(x.valor, { decimals: false })}</dd><dd class="muted small">${x.n} ${x.n === 1 ? 'recebimento' : 'recebimentos'}</dd></div>`;
  main.innerHTML = `
    <div class="g-home">
      <section class="card saldo" aria-label="O seu saldo acumulado">
        <div class="saldo__top"><p class="eyebrow saldo__eyebrow">Saldo acumulado</p><p class="saldo__acct">${esc(user.nome)} · ${esc(user.cargo || 'Gestor')}</p></div>
        <p class="saldo__value"><span class="display-num">${money(t.total.valor, { decimals: false, unit: false })}</span><span class="unit">MT</span></p>
        <p class="saldo__sub">${t.total.n ? `Recebido por si em ${t.total.n} ${t.total.n === 1 ? 'contribuição' : 'contribuições'}${first ? `, desde ${fmtDate(first)}` : ''}.` : 'Ainda não registou recebimentos.'}</p>
        <dl class="saldo__periods">${period('Hoje', t.hoje)}${period('Esta semana', t.semana)}${period('Este mês', t.mes)}</dl>
        <div class="saldo__actions">
          <button type="button" class="btn btn-light" data-record-here>${icon('plus-circle', 18)} Registar contribuição</button>
          <a class="btn btn-ghost-light" href="#/a/relatorios">${icon('file-text', 18)} Relatório de hoje</a>
        </div>
      </section>

      <section class="card pad">
        <div class="card-head"><p class="eyebrow">Os seus recebimentos por mês</p></div>
        ${barChart(monthlyOf(mine), { height: 200 })}
      </section>

      <section class="card dash__wide table-card g-home__wide">
        <div class="card-head card-head--table"><p class="eyebrow">Os seus últimos recebimentos</p><a href="#/a/contribuicoes" class="link small">Ver todos</a></div>
        ${mine.length ? receiptsTable(mine.slice(0, 6), people) : `<div class="empty">Quando registar um valor recebido, o recibo aparece aqui.</div>`}
      </section>
    </div>`;
  main.querySelector('[data-record-here]').addEventListener('click', () => recordDialog(ctx));
  bindReceiptRows(main, mine, people);
}

// Etiqueta do envio do comprovativo na lista de recebimentos
function sentBadge(c) {
  if (store.AUTO_WHATSAPP) {
    if (c.envioEstado === 'falhou') return `<span class="cell-sent is-bad" title="${esc(c.envioErro || '')}">${icon('x', 12)} Não enviado</span>`;
    const t = { enviado: 'Enviado', entregue: 'Entregue', lido: 'Lido', a_enviar: 'A enviar' }[c.envioEstado];
    return t ? `<span class="cell-sent" title="Comprovativo por WhatsApp">${icon('check', 12)} ${t}</span>` : '';
  }
  return c.notificadoEm ? `<span class="cell-sent" title="Comprovativo enviado ao membro">${icon('check', 12)} Enviado</span>` : '';
}

// Tabela de recebimentos (partilhada) -------------------------------------
function receiptsTable(list, people, { showReceiver = false } = {}) {
  if (!list.length) return '<p class="empty">Ainda não há recebimentos. Os valores registados pelos gestores aparecem aqui.</p>';
  return `<table class="table rtable">
    <thead><tr><th class="c-ref">Recibo</th><th class="c-mem">Membro</th><th class="c-date">Data</th><th class="c-met">Forma de pagamento</th>${showReceiver ? '<th class="c-rec">Recebido por</th>' : ''}<th class="r c-amt">Valor</th></tr></thead>
    <tbody>${list.map((c) => {
      const m = people.get(c.membroId);
      const g = people.get(c.registadoPor);
      return `<tr class="click" data-id="${c.id}" tabindex="0"><td class="num muted c-ref">${esc(c.ref)}${sentBadge(c)}</td><td class="c-mem"><span class="cell-name">${esc(m?.nome || '—')}</span>${m?.telefone ? `<span class="cell-sub num" style="display:block">${esc(phoneFmt(m.telefone))}</span>` : ''}</td><td class="c-date">${fmtDate(c.data)}<span class="m-only"> · ${METODOS[c.metodo]}</span></td><td class="c-met"><span class="cell-name">${c.metodo === 'banco' ? 'Transferência' : METODOS[c.metodo]}</span><span class="cell-sub" style="display:block">${esc(c.pagador || '—')}${c.referencia ? ` · <span class="num">${esc(c.referencia)}</span>` : ''}</span></td>${showReceiver ? `<td class="c-rec"><span class="m-only">Recebido por </span>${esc(g?.nome || '—')}</td>` : ''}<td class="r cell-amount c-amt">${money(c.valor)}</td></tr>`;
    }).join('')}</tbody></table>`;
}

function bindReceiptRows(scope, list, people) {
  scope.querySelectorAll('tr[data-id]').forEach((tr) => {
    const open = () => receiptDialog(list.find((x) => x.id === tr.dataset.id), people);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

// Gestores (administração) --------------------------------------------------
async function gestores(ctx) {
  const { main, head } = ctx;
  const [list, all, s] = await Promise.all([store.listGestores(), visibleReceipts(ctx.user), store.obraSummary()]);
  const geral = totals(all);
  head('Equipa', 'Gestores', `<button type="button" class="btn btn-primary" data-add>${icon('user-plus', 18)} Adicionar gestor</button>`);

  main.innerHTML = `
    <dl class="strip card">
      <div><dt>Total geral recebido</dt><dd class="num">${money(s.arrecadado, { decimals: false })}</dd></div>
      <div><dt>Hoje</dt><dd class="num">${money(geral.hoje.valor, { decimals: false })}</dd></div>
      <div><dt>Este mês</dt><dd class="num">${money(geral.mes.valor, { decimals: false })}</dd></div>
      <div><dt>Gestores ativos</dt><dd class="num">${list.filter((g) => g.estado !== 'suspenso').length}</dd></div>
    </dl>
    <div class="gestor-grid">${list.map((g) => {
      const mine = all.filter((c) => c.registadoPor === g.id);
      const t = totals(mine);
      const susp = g.estado === 'suspenso';
      return `<article class="card gestor${susp ? ' is-suspended' : ''}">
        <header class="gestor__head">${avatar(g, 44)}<div class="gestor__id"><p class="gestor__name">${esc(g.nome)}</p><p class="muted small num">+258 ${phoneFmt(g.telefone)} · ${esc(roleLabel(g))}</p></div>
          <span class="status ${susp ? 'status--rejeitado' : 'status--confirmado'}">${susp ? 'Suspenso' : 'Ativo'}</span></header>
        <p class="eyebrow" style="margin-top:20px">Saldo acumulado</p>
        <p class="gestor__saldo"><span class="display-num">${money(t.total.valor, { decimals: false, unit: false })}</span><span class="unit">MT</span></p>
        <p class="muted small">${t.total.n} recebimentos${mine[0] ? ` · último em ${fmtDate(mine[0].data)}` : ''} · ${pct(s.arrecadado ? (t.total.valor / s.arrecadado) * 100 : 0)} do total</p>
        <dl class="gestor__periods">
          <div><dt>Hoje</dt><dd class="num">${money(t.hoje.valor, { decimals: false })}</dd></div>
          <div><dt>Semana</dt><dd class="num">${money(t.semana.valor, { decimals: false })}</dd></div>
          <div><dt>Mês</dt><dd class="num">${money(t.mes.valor, { decimals: false })}</dd></div>
        </dl>
        <footer class="gestor__foot">
          <button type="button" class="btn btn-secondary btn-sm" data-see="${g.id}">Recebimentos</button>
          <button type="button" class="btn btn-secondary btn-sm" data-report="${g.id}">${icon('file-text', 15)} Relatório</button>
          <button type="button" class="btn btn-ghost btn-sm" data-reset="${g.id}" title="Gerar um PIN novo para este gestor">${icon('key-round', 15)} Novo PIN</button>
          <button type="button" class="btn btn-ghost btn-sm" data-susp="${g.id}">${susp ? 'Reativar' : 'Suspender'}</button>
        </footer>
      </article>`;
    }).join('')}</div>`;

  main.querySelectorAll('[data-see]').forEach((b) => b.addEventListener('click', () => { sessionStorage.setItem('nl.gestor', b.dataset.see); navigate('#/a/contribuicoes'); }));
  main.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', () => { sessionStorage.setItem('nl.gestor', b.dataset.report); navigate('#/a/relatorios'); }));
  main.querySelectorAll('[data-susp]').forEach((b) => b.addEventListener('click', async () => {
    const g = list.find((x) => x.id === b.dataset.susp);
    const susp = g.estado === 'suspenso';
    if (!susp && !(await confirmDialog({ title: `Suspender ${g.nome}?`, text: 'Deixa de conseguir entrar no sistema até ser reativado. Os recebimentos já registados mantêm-se.', confirmLabel: 'Suspender acesso' }))) return;
    await store.setSuspended(g.id, !susp);
    toast(susp ? `${g.nome} reativado` : `${g.nome} suspenso`);
    ctx.refresh();
  }));
  main.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    const g = list.find((x) => x.id === b.dataset.reset);
    const ok = await confirmDialog({ title: `Gerar um PIN novo para ${g.nome}?`, text: 'O PIN atual deixa de funcionar. O novo PIN aparece uma única vez: entregue-o ao gestor em privado.', confirmLabel: 'Gerar PIN novo' });
    if (!ok) return;
    try {
      const { pin } = await store.resetPin(g.id);
      openDialog(`
        <header class="sheet__head"><h2>PIN novo</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
        <div class="sheet__body">
          <p>Entregue estes dados a ${esc(g.nome)} em privado. Depois de entrar, o gestor deve escolher o seu próprio PIN em "A minha conta".</p>
          <div class="receipt__rows" style="margin-top:16px"><div class="receipt__row"><dt>Telemóvel</dt><dd>+258 ${phoneFmt(g.telefone)}</dd></div><div class="receipt__row"><dt>PIN</dt><dd style="font-size:20px;font-weight:700;letter-spacing:.2em">${esc(pin)}</dd></div></div>
          <div style="display:flex;justify-content:flex-end;margin-top:20px"><button type="button" class="btn btn-primary" data-close>Concluir</button></div>
        </div>`);
    } catch (ex) { toast(ex.message); }
  }));
  document.querySelector('[data-add]').addEventListener('click', () => addGestorDialog(ctx));
}

function addGestorDialog(ctx) {
  const d = openDialog(`
    <header class="sheet__head"><h2>Adicionar gestor</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <form class="sheet__body" style="display:grid;gap:16px" novalidate>
      <p class="muted small">O gestor pode registar membros, lançar os valores que recebe e baixar relatórios em PDF. Vê apenas os seus próprios recebimentos.</p>
      <div class="field"><label for="g-nome">Nome completo</label><input class="input" id="g-nome" autocomplete="off"></div>
      <div class="field"><label for="g-tel">Telemóvel</label><div class="phone" style="height:44px"><span class="phone__prefix">+258</span><input id="g-tel" inputmode="numeric" placeholder="84 123 4567" style="font-size:15px"></div></div>
      <p class="error-text" data-error hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button type="submit" class="btn btn-primary">Adicionar gestor</button></div>
    </form>`);
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = d.querySelector('#g-nome').value.trim().replace(/\s+/g, ' ');
    const telefone = d.querySelector('#g-tel').value.replace(/\D/g, '');
    const err = d.querySelector('[data-error]');
    let msg = nome.split(' ').length < 2 ? 'Indique o nome e o apelido.' : !isValidPhone(telefone) ? 'Indique os 9 dígitos do telemóvel, começando por 8.' : '';
    if (!msg) {
      try {
        const { gestor, pin } = await store.createGestor({ nome, telefone });
        d.querySelector('form').outerHTML = `<div class="sheet__body">
          <p>${esc(gestor.nome)} foi adicionado como gestor. Partilhe estes dados de acesso em privado:</p>
          <div class="receipt__rows" style="margin-top:16px"><div class="receipt__row"><dt>Telemóvel</dt><dd>+258 ${phoneFmt(gestor.telefone)}</dd></div><div class="receipt__row"><dt>PIN</dt><dd style="font-size:20px;font-weight:700;letter-spacing:.2em">${pin}</dd></div></div>
          <div style="display:flex;justify-content:flex-end;margin-top:20px"><button type="button" class="btn btn-primary" data-close>Concluir</button></div></div>`;
        d.addEventListener('close', () => ctx.refresh(), { once: true });
        return;
      } catch (ex) { msg = ex.message; }
    }
    err.textContent = msg;
    err.hidden = !msg;
  });
}

// Recebimentos ------------------------------------------------------------
async function contribuicoes(ctx) {
  const { main, head, user } = ctx;
  const admin = isAdmin(user);
  const [all, people, gestoresList] = await Promise.all([visibleReceipts(user), peopleMap(), store.listGestores()]);
  const months = [...new Set(all.map((c) => monthKey(c.data)))];
  const f = { q: sessionStorage.getItem('nl.q') || '', gestor: admin ? sessionStorage.getItem('nl.gestor') || '' : '', metodo: '', mes: '' };
  sessionStorage.removeItem('nl.q');
  sessionStorage.removeItem('nl.gestor');
  let limit = PAGE;

  head(admin ? 'Todos os gestores' : 'Registados por si', 'Recebimentos',
    `<button type="button" class="btn btn-secondary" data-export>${icon('download', 18)} Exportar CSV</button>${admin ? '' : `<button type="button" class="btn btn-primary" data-new>${icon('plus-circle', 18)} Registar contribuição</button>`}`);

  main.innerHTML = `
    <div class="toolbar">
      <label class="search">${icon('search', 18)}<input class="input" type="search" placeholder="Procurar por membro, recibo ou referência" data-f="q" aria-label="Procurar" value="${esc(f.q)}"></label>
      ${admin ? `<select class="select" data-f="gestor" aria-label="Gestor"><option value="">Todos os gestores</option>${gestoresList.map((g) => `<option value="${g.id}" ${g.id === f.gestor ? 'selected' : ''}>${esc(g.nome)}</option>`).join('')}</select>` : ''}
      <select class="select" data-f="metodo" aria-label="Forma de pagamento"><option value="">Todas as formas</option>${Object.entries(METODOS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <select class="select" data-f="mes" aria-label="Mês"><option value="">Todos os meses</option>${months.map((k) => `<option value="${k}">${monthLong(k)}</option>`).join('')}</select>
    </div>
    <div class="card table-card" data-table></div>`;

  const filtered = () => {
    const q = f.q.toLowerCase();
    return all.filter((c) => {
      if (f.gestor && c.registadoPor !== f.gestor) return false;
      if (f.metodo && c.metodo !== f.metodo) return false;
      if (f.mes && monthKey(c.data) !== f.mes) return false;
      if (q) {
        const m = people.get(c.membroId);
        if (![m?.nome, c.ref, c.referencia, c.pagador, m?.telefone].some((v) => v && v.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  };

  const table = main.querySelector('[data-table]');
  const paint = () => {
    const list = filtered();
    table.innerHTML = list.length
      ? `${receiptsTable(list.slice(0, limit), people, { showReceiver: admin })}
        ${pageFoot(Math.min(limit, list.length), list.length, ` · total recebido: <strong class="num" style="color:var(--ink)">${money(sumv(list))}</strong>`)}`
      : `<p class="empty">${all.length ? 'Nenhum recebimento corresponde aos filtros.' : 'Ainda não há recebimentos registados.'}</p>`;
    table.querySelector('[data-more]')?.addEventListener('click', () => { limit += PAGE; paint(); });
    bindReceiptRows(table, list, people);
  };

  main.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('input', () => { f[el.dataset.f] = el.value; limit = PAGE; paint(); }));
  document.querySelector('[data-export]').addEventListener('click', () => exportCsv(filtered(), people, `recebimentos-${isoDate()}`));
  document.querySelector('[data-new]')?.addEventListener('click', () => recordDialog(ctx));
  paint();
}

function exportCsv(list, people, filename) {
  const rows = [['Recibo', 'Membro', 'Telemóvel', 'Data', 'Forma de pagamento', 'Entregue/enviado por', 'Referência', 'Recebido por', 'Valor (MT)']];
  for (const c of list) {
    const m = people.get(c.membroId);
    rows.push([c.ref, m?.nome || '', m ? `+258${m.telefone}` : '', c.data, METODOS[c.metodo], c.pagador || '', c.referencia || '', people.get(c.registadoPor)?.nome || '', c.valor.toFixed(2).replace('.', ',')]);
  }
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${filename}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${list.length} recebimentos exportados`);
}

// Despesas (administração) --------------------------------------------------
// Cada despesa tem descrição, nota obrigatória (para que foi e porquê), categoria,
// a quem foi paga e como. Nunca se apaga: um engano corrige-se anulando, com motivo.
function expenseCell(e) {
  return `<span class="cell-name">${esc(e.descricao)}</span>
    <span class="exp-note">${esc(e.nota)}</span>
    <span class="cell-sub" style="display:block">Pago a ${esc(e.beneficiario || '—')} · ${METODOS[e.metodo]}${e.referencia ? ` · <span class="num">${esc(e.referencia)}</span>` : ''}</span>`;
}

// compact: lista da página Despesas — cada linha com altura fixa (nota numa só linha,
// completa na janela da despesa). No relatório a nota aparece sempre por inteiro.
function expensesTable(list, { compact = false } = {}) {
  return `<table class="table etable${compact ? ' etable--compact' : ''}">
    <thead><tr><th>Data</th><th>N.º</th><th>Descrição e nota</th><th>Categoria</th><th class="r">Valor</th></tr></thead>
    <tbody>${list.map((e) => `<tr class="click${e.anulada ? ' is-void' : ''}" data-exp="${e.id}" tabindex="0">
      <td class="num e-date">${fmtDate(e.data)}<span class="m-only"> · ${CATEGORIAS[e.categoria]}</span></td>
      <td class="num muted e-ref">${esc(e.ref)}${e.anulada ? '<span class="tag-void">Anulada</span>' : ''}</td>
      <td class="e-desc">${expenseCell(e)}</td>
      <td class="e-cat">${CATEGORIAS[e.categoria]}</td>
      <td class="r cell-amount e-amt">${money(e.valor)}</td></tr>`).join('')}</tbody></table>`;
}

async function despesas(ctx) {
  const { main, head, user } = ctx;
  const [received, expenses, people] = await Promise.all([visibleReceipts(user), store.listExpenses(), peopleMap()]);
  const months = [...new Set(expenses.map((e) => monthKey(e.data)))];
  const f = { q: '', cat: '', mes: '' };
  let limit = PAGE;

  head('Saídas da obra', 'Despesas',
    `<button type="button" class="btn btn-secondary" data-export>${icon('download', 18)} Exportar CSV</button><button type="button" class="btn btn-primary" data-new>${icon('minus-circle', 18)} Registar despesa</button>`);

  main.innerHTML = `
    ${finStrip(received, expenses)}
    <div class="toolbar">
      <label class="search">${icon('search', 18)}<input class="input" type="search" placeholder="Procurar por descrição, nota, pago a ou n.º" data-f="q" aria-label="Procurar"></label>
      <select class="select" data-f="cat" aria-label="Categoria"><option value="">Todas as categorias</option>${Object.entries(CATEGORIAS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <select class="select" data-f="mes" aria-label="Mês"><option value="">Todos os meses</option>${months.map((k) => `<option value="${k}">${monthLong(k)}</option>`).join('')}</select>
    </div>
    <div class="card table-card" data-table></div>`;

  const filtered = () => {
    const q = f.q.toLowerCase();
    return expenses.filter((e) => (!f.cat || e.categoria === f.cat) && (!f.mes || monthKey(e.data) === f.mes)
      && (!q || [e.descricao, e.nota, e.beneficiario, e.ref, e.referencia].some((v) => v && v.toLowerCase().includes(q))));
  };
  const table = main.querySelector('[data-table]');
  const paint = () => {
    const list = filtered();
    const voided = list.filter((e) => e.anulada).length;
    table.innerHTML = list.length
      ? `${expensesTable(list.slice(0, limit), { compact: true })}
        ${pageFoot(Math.min(limit, list.length), list.length, `${voided ? ` (${voided} anulada${voided > 1 ? 's' : ''}, fora do total)` : ''} · total gasto: <strong class="num" style="color:var(--ink)">${money(sumv(validExp(list)))}</strong>`)}`
      : `<p class="empty">${expenses.length ? 'Nenhuma despesa corresponde aos filtros.' : 'Ainda não há despesas registadas. Use "Registar despesa" sempre que sair dinheiro da obra.'}</p>`;
    table.querySelector('[data-more]')?.addEventListener('click', () => { limit += PAGE; paint(); });
    table.querySelectorAll('tr[data-exp]').forEach((tr) => {
      const open = () => expenseDetail(ctx, list.find((x) => x.id === tr.dataset.exp), people);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
    });
  };
  main.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('input', () => { f[el.dataset.f] = el.value; limit = PAGE; paint(); }));
  document.querySelector('[data-new]').addEventListener('click', () => expenseDialog(ctx));
  document.querySelector('[data-export]').addEventListener('click', () => exportExpensesCsv(filtered(), people, `despesas-${isoDate()}`));
  paint();
}

async function expenseDialog(ctx) {
  const [received, expenses] = await Promise.all([visibleReceipts(ctx.user), store.listExpenses()]);
  const saldo = caixa(received, expenses).saldo;
  const today = isoDate();
  const d = openDialog(`
    <header class="sheet__head"><h2>Registar despesa</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <form class="sheet__body rec-form" novalidate>
      <div class="field">
        <label for="ex-v">Valor gasto</label>
        <div class="rec-amount"><input id="ex-v" inputmode="decimal" autocomplete="off" placeholder="0"><span>MT</span></div>
        <p class="hint exp-saldo" data-saldo>Saldo disponível: <strong class="num">${money(saldo)}</strong></p>
      </div>
      <div class="field"><label for="ex-d">Descrição</label><input class="input" id="ex-d" maxlength="120" autocomplete="off" placeholder="Ex.: Compra de 200 sacos de cimento"></div>
      <div class="field">
        <div class="rec-form__label"><label for="ex-n">Nota</label><span class="hint num" data-count>0/500</span></div>
        <textarea class="textarea" id="ex-n" rows="3" maxlength="500" placeholder="Para que foi o dinheiro, quem autorizou e o que foi recebido em troca."></textarea>
        <p class="hint">A nota é obrigatória e aparece nos relatórios, para total transparência.</p>
      </div>
      <div class="rec-form__row">
        <div class="field"><label for="ex-c">Categoria</label><select class="select" id="ex-c"><option value="">Escolha a categoria</option>${Object.entries(CATEGORIAS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div class="field"><label for="ex-dt">Data da despesa</label><input class="input" type="date" id="ex-dt" max="${today}" value="${today}"></div>
      </div>
      <fieldset class="field">
        <legend>Forma de pagamento</legend>
        <div class="seg">${Object.entries(METODOS).map(([k, l]) => `<label><input type="radio" name="metodo" value="${k}" ${k === 'numerario' ? 'checked' : ''}><span>${k === 'banco' ? 'Banco' : l}</span></label>`).join('')}</div>
      </fieldset>
      <div class="rec-form__row">
        <div class="field"><label for="ex-b">Pago a</label><input class="input" id="ex-b" maxlength="80" autocomplete="off" placeholder="Fornecedor ou pessoa"></div>
        <div class="field" data-ref-field hidden><label for="ex-r">Referência <span class="muted" style="font-weight:400">(opcional)</span></label><input class="input num" id="ex-r" autocomplete="off" autocapitalize="characters" placeholder="N.º da transação ou fatura"></div>
      </div>
      <p class="error-text" data-error hidden></p>
      <div class="rec-form__foot"><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button type="submit" class="btn btn-primary">${icon('check', 18)} Registar despesa</button></div>
    </form>`, { className: 'sheet--wide' });

  const form = d.querySelector('form');
  const $ = (q) => d.querySelector(q);
  const syncRef = () => { $('[data-ref-field]').hidden = form.metodo.value === 'numerario'; };
  form.querySelectorAll('[name=metodo]').forEach((r) => r.addEventListener('change', syncRef));
  $('#ex-n').addEventListener('input', (e) => { $('[data-count]').textContent = `${e.target.value.length}/500`; });
  $('#ex-v').addEventListener('input', () => {
    const v = parseAmount($('#ex-v').value);
    $('[data-saldo]').classList.toggle('is-over', Number.isFinite(v) && v > saldo);
  });
  $('#ex-v').focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const valor = parseAmount($('#ex-v').value);
    const descricao = $('#ex-d').value.trim().replace(/\s+/g, ' ');
    const nota = $('#ex-n').value.trim();
    const categoria = $('#ex-c').value;
    const data = $('#ex-dt').value;
    const beneficiario = $('#ex-b').value.trim().replace(/\s+/g, ' ');
    const metodo = form.metodo.value;
    const err = $('[data-error]');
    const msg = !Number.isFinite(valor) || valor <= 0 ? 'Indique o valor gasto.'
      : valor > 100_000_000 ? 'Verifique o valor: parece demasiado alto.'
      : descricao.length < 3 ? 'Descreva a despesa (ex.: compra de cimento).'
      : nota.length < 10 ? 'Escreva a nota: para que foi o dinheiro e porquê (pelo menos 10 letras).'
      : !categoria ? 'Escolha a categoria.'
      : !data || data > today ? 'Indique a data da despesa (não pode ser futura).'
      : beneficiario.length < 3 ? 'Indique a quem foi pago (fornecedor ou pessoa).' : '';
    err.textContent = msg; err.hidden = !msg;
    if (msg) return;
    if (valor > saldo) {
      const ok = await confirmDialog({
        title: 'Valor acima do saldo disponível',
        text: `O saldo disponível é ${money(saldo)}. Esta despesa deixa a caixa com ${money(saldo - valor)}. Registar mesmo assim?`,
        confirmLabel: 'Registar mesmo assim',
      });
      if (!ok) return;
    }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const x = await store.recordExpense({
        valor, descricao, nota, categoria, data, beneficiario, metodo,
        referencia: metodo === 'numerario' ? '' : $('#ex-r').value.trim().toUpperCase(), registadoPor: ctx.user.id,
      });
      d.close();
      toast(`Despesa ${x.ref} registada · ${money(x.valor)}`);
      ctx.refresh();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false; btn.disabled = false;
    }
  });
}

function expenseDetail(ctx, e, people) {
  const row = (l, v) => `<div><dt>${l}</dt><dd>${v}</dd></div>`;
  const d = openDialog(`
    <header class="sheet__head"><h2>Despesa <span class="num">${esc(e.ref)}</span></h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <div class="sheet__body exp-detail">
      <div class="exp-detail__top">
        <p class="exp-detail__v num${e.anulada ? ' is-void' : ''}">${money(e.valor)}</p>
        ${e.anulada ? '<span class="tag-void">Anulada</span>' : `<span class="muted small">${CATEGORIAS[e.categoria]}</span>`}
      </div>
      <dl class="exp-dl">
        ${row('Descrição', esc(e.descricao))}
        ${row('Nota', `<span class="exp-dl__note">${esc(e.nota)}</span>`)}
        ${row('Categoria', CATEGORIAS[e.categoria])}
        ${row('Data da despesa', fmtDate(e.data))}
        ${row('Pago a', esc(e.beneficiario || '—'))}
        ${row('Forma de pagamento', `${METODOS[e.metodo]}${e.referencia ? ` · <span class="num">${esc(e.referencia)}</span>` : ''}`)}
        ${row('Registado por', `${esc(people.get(e.registadoPor)?.nome || '—')} <span class="muted">· ${fmtDateTime(e.registadoEm)}</span>`)}
        ${e.anulada ? row('Anulada', `${esc(people.get(e.anuladaPor)?.nome || '—')} <span class="muted">· ${fmtDateTime(e.anuladaEm)}</span>`) + row('Motivo da anulação', esc(e.motivoAnulacao || '—')) : ''}
      </dl>
      ${e.anulada ? '' : `<div class="exp-void" data-void-box hidden>
        <label for="ex-m">Motivo da anulação</label>
        <textarea class="textarea" id="ex-m" rows="2" maxlength="200" placeholder="Ex.: valor registado em duplicado"></textarea>
        <p class="hint">A despesa fica no histórico, marcada como anulada, e deixa de contar nos totais.</p>
        <p class="error-text" data-error hidden></p>
      </div>`}
    </div>
    <div class="sheet__foot">
      ${e.anulada ? '<button type="button" class="btn btn-secondary" data-close>Fechar</button>' : `<button type="button" class="btn btn-secondary btn-danger-ghost" data-void>${icon('ban', 18)} Anular despesa</button><button type="button" class="btn btn-primary" data-close>Fechar</button>`}
    </div>`);

  const vb = d.querySelector('[data-void]');
  vb?.addEventListener('click', async () => {
    const box = d.querySelector('[data-void-box]');
    if (box.hidden) { box.hidden = false; vb.innerHTML = `${icon('ban', 18)} Confirmar anulação`; d.querySelector('#ex-m').focus(); return; }
    const motivo = d.querySelector('#ex-m').value.trim();
    const err = d.querySelector('[data-error]');
    if (motivo.length < 3) { err.textContent = 'Indique o motivo da anulação.'; err.hidden = false; return; }
    vb.disabled = true;
    try {
      await store.voidExpense(e.id, { motivo, por: ctx.user.id });
      d.close();
      toast(`Despesa ${e.ref} anulada`);
      ctx.refresh();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; vb.disabled = false; }
  });
}

function downloadCsv(rows, filename) {
  const csv = '\ufeff' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${filename}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportExpensesCsv(list, people, filename) {
  const rows = [['N.º', 'Data', 'Descrição', 'Nota', 'Categoria', 'Pago a', 'Forma de pagamento', 'Referência', 'Valor (MT)', 'Estado', 'Registado por']];
  for (const e of list) {
    rows.push([e.ref, e.data, e.descricao, e.nota, CATEGORIAS[e.categoria], e.beneficiario, METODOS[e.metodo], e.referencia, e.valor.toFixed(2).replace('.', ','), e.anulada ? `Anulada: ${e.motivoAnulacao || ''}` : 'Válida', people.get(e.registadoPor)?.nome || '']);
  }
  downloadCsv(rows, filename);
  toast(`${list.length} despesas exportadas`);
}

// Membros -----------------------------------------------------------------
async function membros(ctx) {
  const { main, head, user } = ctx;
  const admin = isAdmin(user);
  let [list, receipts, people] = await Promise.all([store.listMembers(), visibleReceipts(user), peopleMap()]);
  let tab = ctx.param === 'suspensos' && admin ? 'suspensos' : 'ativos';
  let q = '';
  let limit = PAGE;
  head('Comunidade', 'Membros', `<button type="button" class="btn btn-${admin ? 'primary' : 'secondary'}" data-add>${icon('user-plus', 18)} Adicionar membro</button>`);

  // Totais por membro, dentro do que este utilizador pode ver
  const statsFor = (id) => {
    const l = receipts.filter((c) => c.membroId === id);
    return { n: l.length, total: sumv(l), ultima: l[0]?.data || null };
  };

  const paint = () => {
    const ql = q.toLowerCase();
    const match = (m) => !ql || m.nome.toLowerCase().includes(ql) || m.telefone.includes(ql.replace(/\s/g, ''));
    const tabs = admin ? [['ativos', 'Ativos', list.filter((m) => m.estado !== 'suspenso').length], ['suspensos', 'Suspensos', list.filter((m) => m.estado === 'suspenso').length]] : [];
    let table;
    const rows = list.filter((m) => (tab === 'suspensos' ? m.estado === 'suspenso' : m.estado !== 'suspenso')).filter(match);
    table = rows.length
      ? `<table class="table mtable"><thead><tr><th class="m-name">Membro</th><th class="m-tel">Telemóvel</th><th class="r m-n">Contribuições</th><th class="r m-tot">${admin ? 'Total' : 'Recebido por si'}</th><th class="m-last">Última</th><th class="r m-act"></th></tr></thead>
        <tbody>${rows.slice(0, limit).map((m) => {
          const s = statsFor(m.id);
          const susp = m.estado === 'suspenso';
          const action = admin
            ? `<button type="button" class="btn btn-ghost btn-sm" data-susp="${m.id}">${susp ? 'Reativar' : 'Suspender'}</button>`
            : `<button type="button" class="btn btn-secondary btn-sm" data-rec="${m.id}">${icon('plus-circle', 15)} Registar</button>`;
          return `<tr class="click${susp ? ' is-muted' : ''}" data-id="${m.id}" tabindex="0"><td class="m-name"><span class="cell-name">${esc(m.nome)}</span></td><td class="num m-tel">+258 ${phoneFmt(m.telefone)}</td><td class="r m-n">${s.n}<span class="m-only"> ${s.n === 1 ? 'contribuição' : 'contribuições'}</span></td><td class="r m-tot">${money(s.total)}</td><td class="m-last ${s.ultima ? '' : 'muted'}"><span class="m-only">Última: </span>${s.ultima ? fmtDate(s.ultima) : '—'}</td><td class="r m-act">${action}</td></tr>`;
        }).join('')}</tbody></table>${pageFoot(Math.min(limit, rows.length), rows.length)}`
      : `<p class="empty">${tab === 'suspensos' ? 'Nenhum membro suspenso.' : q ? 'Nenhum membro corresponde à pesquisa.' : 'Ainda não há membros. Adicione o primeiro.'}</p>`;

    main.innerHTML = `
      ${tabs.length ? `<div class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button type="button" role="tab" class="tab" data-tab="${k}" aria-selected="${k === tab}">${l}<span class="tab__n num">${n}</span></button>`).join('')}</div>` : ''}
      <div class="toolbar"><label class="search">${icon('search', 18)}<input class="input" type="search" placeholder="Procurar por nome ou telemóvel" aria-label="Procurar membro" data-q value="${esc(q)}"></label><span class="toolbar__count muted small">${list.length} membros</span></div>
      <div class="card table-card">${table}</div>`;

    main.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; limit = PAGE; paint(); }));
    main.querySelector('[data-more]')?.addEventListener('click', () => { limit += PAGE; paint(); });
    const qi = main.querySelector('[data-q]');
    qi.addEventListener('input', () => { q = qi.value; limit = PAGE; paint(); const n = main.querySelector('[data-q]'); n.focus(); n.setSelectionRange(q.length, q.length); });

    main.querySelectorAll('[data-susp]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const m = list.find((x) => x.id === b.dataset.susp);
      await store.setSuspended(m.id, m.estado !== 'suspenso');
      toast(m.estado === 'suspenso' ? `${m.nome} reativado` : `${m.nome} suspenso`);
      list = await store.listMembers();
      paint();
    }));
    main.querySelectorAll('[data-rec]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); recordDialog(ctx, b.dataset.rec); }));
    main.querySelectorAll('tr[data-id]').forEach((tr) => {
      const open = () => memberDialog(ctx, list.find((m) => m.id === tr.dataset.id), receipts, people);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  };

  document.querySelector('[data-add]').addEventListener('click', () => addMemberDialog((m) => {
    list.push(m);
    people.set(m.id, m);
    paint();
    if (!admin) recordDialog(ctx, m.id);
  }));
  paint();
}

function memberDialog(ctx, m, receipts, people) {
  const admin = isAdmin(ctx.user);
  const mine = receipts.filter((c) => c.membroId === m.id);
  const d = openDialog(`
    <header class="sheet__head"><h2>${esc(m.nome)}</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <div class="sheet__body">
      <div class="cell-person">${avatar(m, 56)}<div><p class="num">+258 ${phoneFmt(m.telefone)}</p><p class="muted small">Membro desde ${monthLong(m.criadoEm.slice(0, 7))}</p></div></div>
      <div class="receipt__rows" style="margin-top:20px">
        <div class="receipt__row"><dt>${admin ? 'Total contribuído' : 'Recebido por si'}</dt><dd>${money(sumv(mine))}</dd></div>
        <div class="receipt__row"><dt>Contribuições</dt><dd>${mine.length}</dd></div>
      </div>
      <p class="eyebrow" style="margin:24px 0 8px">Últimas contribuições</p>
      ${mine.length ? `<table class="table"><tbody>${mine.slice(0, 6).map((c) => `<tr><td class="num muted" style="padding-left:0">${esc(c.ref)}</td><td>${fmtDate(c.data)}</td>${admin ? `<td class="muted small">${esc(people.get(c.registadoPor)?.nome || '')}</td>` : ''}<td class="r" style="padding-right:0">${money(c.valor)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Ainda sem contribuições.</p>'}
    </div>
    ${admin ? '' : `<div class="sheet__foot"><button type="button" class="btn btn-primary" data-rec>${icon('plus-circle', 18)} Registar contribuição</button></div>`}`);
  d.querySelector('[data-rec]')?.addEventListener('click', () => { d.close(); recordDialog(ctx, m.id); });
}

function addMemberDialog(onDone) {
  const d = openDialog(`
    <header class="sheet__head"><h2>Adicionar membro</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <form class="sheet__body" style="display:grid;gap:16px" novalidate>
      <div class="field"><label for="am-nome">Nome completo</label><input class="input" id="am-nome" autocomplete="off"></div>
      <div class="field"><label for="am-tel">Telemóvel</label><div class="phone" style="height:44px"><span class="phone__prefix">+258</span><input id="am-tel" inputmode="numeric" placeholder="84 123 4567" style="font-size:15px"></div></div>
      <p class="error-text" data-error hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button type="submit" class="btn btn-primary">Adicionar membro</button></div>
    </form>`);
  d.querySelector('#am-nome').focus();
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = d.querySelector('#am-nome').value.trim().replace(/\s+/g, ' ');
    const telefone = d.querySelector('#am-tel').value.replace(/\D/g, '');
    const err = d.querySelector('[data-error]');
    let msg = nome.split(' ').length < 2 ? 'Indique o nome e o apelido.' : !isValidPhone(telefone) ? 'Indique os 9 dígitos do telemóvel, começando por 8.' : '';
    if (!msg) {
      try {
        const { member } = await store.createMember({ nome, telefone });
        d.close();
        toast(`${member.nome} adicionado aos membros`);
        onDone?.(member);
        return;
      } catch (ex) { msg = ex.message; }
    }
    err.textContent = msg;
    err.hidden = !msg;
  });
}

// Relatórios ----------------------------------------------------------------
const KINDS = [['dia', 'Diário'], ['semana', 'Semanal'], ['mes', 'Mensal']];
const KIND_TITLE = { dia: 'Relatório diário de recebimentos', semana: 'Relatório semanal de recebimentos', mes: 'Relatório mensal de recebimentos' };
const KIND_FIN = { dia: 'Relatório financeiro diário', semana: 'Relatório financeiro semanal', mes: 'Relatório financeiro mensal' };
const KIND_FILE = { dia: 'diario', semana: 'semanal', mes: 'mensal' };
const metodoNome = (k) => (k === 'banco' ? 'Transferência' : METODOS[k]);

// Relatórios. A administração (com "Todos os gestores") vê o relatório financeiro completo:
// saldo anterior + recebido − gasto = saldo final, com todas as despesas e as suas notas.
// O gestor (ou a administração a ver um só gestor) vê o relatório dos recebimentos.
async function relatorios(ctx) {
  const { main, head, user } = ctx;
  const admin = isAdmin(user);
  const [all, people, gestoresList, settings, allExpenses] = await Promise.all([
    visibleReceipts(user), peopleMap(), store.listGestores(), store.getSettings(), admin ? store.listExpenses() : [],
  ]);
  const expenses = validExp(allExpenses);
  const st = { kind: 'dia', anchor: isoDate(), gestor: admin ? sessionStorage.getItem('nl.gestor') || '' : user.id };
  sessionStorage.removeItem('nl.gestor');

  head('Relatórios', admin ? 'Relatório financeiro' : 'Relatório de recebimentos',
    `<button type="button" class="btn btn-secondary" data-export>${icon('download', 18)} Exportar CSV</button><button type="button" class="btn btn-primary" data-pdf-report>${icon('download', 18)} Baixar PDF</button>`);

  // Tudo o que o relatório mostra, calculado num só sítio (ecrã, PDF e CSV usam o mesmo)
  const current = () => {
    const r = periodRange(st.kind, st.anchor);
    const fin = admin && !st.gestor;
    const list = all.filter((c) => c.data >= r.from && c.data <= r.to && (!st.gestor || c.registadoPor === st.gestor));
    const exps = fin ? expenses.filter((e) => e.data >= r.from && e.data <= r.to).sort((a, b) => a.data.localeCompare(b.data) || a.ref.localeCompare(b.ref)) : [];
    const total = sumv(list);
    const gasto = sumv(exps);
    const anterior = fin ? sumv(all.filter((c) => c.data < r.from)) - sumv(expenses.filter((e) => e.data < r.from)) : 0;
    const whoLabel = st.gestor ? people.get(st.gestor)?.nome || '—' : 'Todos os gestores';
    // Todos os que receberam: os gestores e, se tiver recebido valores, a própria administração
    const receivers = [...gestoresList, ...[...new Set(list.map((c) => c.registadoPor))].filter((id) => !gestoresList.some((g) => g.id === id)).map((id) => people.get(id)).filter(Boolean)];
    const byGestor = admin && !st.gestor
      ? receivers.map((g) => { const l = list.filter((c) => c.registadoPor === g.id); return { nome: g.role === 'admin' ? `${g.nome} (administração)` : g.nome, n: l.length, v: sumv(l), pct: pct(total ? (sumv(l) / total) * 100 : 0) }; })
      : [];
    const byMethod = Object.keys(METODOS).map((k) => { const x = list.filter((c) => c.metodo === k); return { l: metodoNome(k), n: x.length, v: sumv(x) }; }).filter((x) => x.n);
    const byCat = Object.entries(CATEGORIAS).map(([k, l]) => { const x = exps.filter((e) => e.categoria === k); return { l, n: x.length, v: sumv(x) }; }).filter((x) => x.n);
    return {
      r, fin, list, exps, total, gasto, anterior, final: anterior + total - gasto, whoLabel, byGestor, byMethod, byCat,
      members: new Set(list.map((c) => c.membroId)).size,
      range: `${fmtDate(r.from)}${r.from !== r.to ? ` a ${fmtDate(r.to)}` : ''}`,
      title: fin ? KIND_FIN[st.kind] : KIND_TITLE[st.kind],
    };
  };

  const paint = () => {
    const x = current();
    const { r } = x;
    const kpis = x.fin
      ? `<dl class="report__kpis report__kpis--fin">
          <div><dt>Saldo anterior</dt><dd class="num">${money(x.anterior)}</dd></div>
          <div><dt>Recebido</dt><dd class="num">${money(x.total)}</dd><p class="report__kpi-sub">${plural(x.list.length, 'recebimento', 'recebimentos')}</p></div>
          <div><dt>Gasto</dt><dd class="num">${money(x.gasto)}</dd><p class="report__kpi-sub">${plural(x.exps.length, 'despesa', 'despesas')}</p></div>
          <div class="is-main${x.final < 0 ? ' is-neg' : ''}"><dt>Saldo final</dt><dd class="num">${money(x.final)}</dd></div>
        </dl>`
      : `<dl class="report__kpis">
          <div class="is-main"><dt>Total recebido</dt><dd class="num">${money(x.total)}</dd></div>
          <div><dt>Recebimentos</dt><dd class="num">${x.list.length}</dd></div>
          <div><dt>Membros</dt><dd class="num">${x.members}</dd></div>
          <div><dt>Valor médio</dt><dd class="num">${money(x.list.length ? x.total / x.list.length : 0)}</dd></div>
        </dl>`;

    main.innerHTML = `
      <div class="report-controls">
        <div class="seg seg--inline" role="tablist">${KINDS.map(([k, l]) => `<label><input type="radio" name="kind" value="${k}" ${k === st.kind ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <div class="period-nav">
          <button type="button" class="a-icon" data-step="-1" aria-label="Período anterior">${icon('chevron-left', 18)}</button>
          <input class="input period-nav__date" type="date" value="${st.anchor}" max="${isoDate()}" aria-label="Data de referência">
          <button type="button" class="a-icon" data-step="1" aria-label="Período seguinte" ${r.to >= isoDate() ? 'disabled' : ''}>${icon('chevron-right', 18)}</button>
        </div>
        ${admin ? `<select class="select" data-gestor aria-label="Gestor"><option value="">Todos os gestores</option>${gestoresList.map((g) => `<option value="${g.id}" ${g.id === st.gestor ? 'selected' : ''}>${esc(g.nome)}</option>`).join('')}</select>` : ''}
      </div>

      <article class="card report">
        <header class="report__head">
          <img src="assets/brand/logo-lockup-navy.svg" alt="Nataniel Litsure Ministries" width="120" height="53">
          <div class="report__meta">
            <p class="eyebrow">${esc(settings.obraNome)}</p>
            <h2>${x.title}</h2>
            <p class="report__period">${esc(r.label)}</p>
          </div>
        </header>
        <dl class="report__info">
          <div><dt>Gestor</dt><dd>${esc(x.whoLabel)}</dd></div>
          <div><dt>Período</dt><dd class="num">${x.range}</dd></div>
          <div><dt>Emitido em</dt><dd class="num">${fmtDateTime(new Date().toISOString())}</dd></div>
          <div><dt>Emitido por</dt><dd>${esc(user.nome)}</dd></div>
        </dl>

        ${kpis}

        ${x.fin ? `<section class="report__sec"><h3>Resumo de caixa</h3>
          <table class="table ctable"><tbody>
            <tr><td>Saldo no início do período</td><td class="r">${money(x.anterior)}</td></tr>
            <tr><td>Entradas · contribuições recebidas</td><td class="r">+ ${money(x.total)}</td></tr>
            <tr><td>Saídas · despesas da obra</td><td class="r">− ${money(x.gasto)}</td></tr>
          </tbody><tfoot><tr><td>Saldo no fim do período</td><td class="r">${money(x.final)}</td></tr></tfoot></table></section>` : ''}

        ${x.byGestor.length ? `<section class="report__sec"><h3>Recebido por gestor</h3>
          <table class="table gtable"><thead><tr><th>Gestor</th><th class="r"><span class="d-only">Recebimentos</span><span class="m-only">N.º</span></th><th class="r">Parte</th><th class="r">Valor</th></tr></thead>
          <tbody>${x.byGestor.map((g) => `<tr><td>${esc(g.nome)}</td><td class="r">${g.n}</td><td class="r">${g.pct}</td><td class="r">${money(g.v)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total recebido</td><td class="r">${x.list.length}</td><td class="r">100,0%</td><td class="r">${money(x.total)}</td></tr></tfoot></table></section>` : ''}

        ${x.byMethod.length ? `<section class="report__sec"><h3>Recebido por forma de pagamento</h3>
          <table class="table"><tbody>${x.byMethod.map((m) => `<tr><td>${m.l}</td><td class="r">${m.n}</td><td class="r">${money(m.v)}</td></tr>`).join('')}</tbody></table></section>` : ''}

        <section class="report__sec"><h3>Recebimentos</h3>
          ${x.list.length ? `<table class="table dtable"><thead><tr><th>Data</th><th>Recibo</th><th>Membro</th><th>Forma</th>${st.gestor ? '' : '<th>Recebido por</th>'}<th class="r">Valor</th></tr></thead>
          <tbody>${x.list.map((c) => `<tr><td class="num d-date">${fmtDateShort(c.data)}<span class="m-only"> · ${metodoNome(c.metodo)}</span></td><td class="num muted d-ref">${esc(c.ref)}</td><td class="d-mem">${esc(people.get(c.membroId)?.nome || '—')}</td><td class="d-met">${METODOS[c.metodo]}</td>${st.gestor ? '' : `<td class="d-rec"><span class="m-only">Recebido por </span>${esc(people.get(c.registadoPor)?.nome || '—')}</td>`}<td class="r d-amt">${money(c.valor)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="${st.gestor ? 4 : 5}" class="d-tl">Total recebido</td><td class="r d-tv">${money(x.total)}</td></tr></tfoot></table>`
          : '<p class="empty">Não há recebimentos neste período.</p>'}
        </section>

        ${x.fin ? `${x.byCat.length ? `<section class="report__sec"><h3>Gasto por categoria</h3>
          <table class="table"><tbody>${x.byCat.map((c) => `<tr><td>${c.l}</td><td class="r">${c.n}</td><td class="r">${money(c.v)}</td></tr>`).join('')}</tbody></table></section>` : ''}
        <section class="report__sec"><h3>Despesas</h3>
          ${x.exps.length ? `${expensesTable(x.exps)}<table class="table etable etable--total"><tfoot><tr><td>Total gasto</td><td class="r">${money(x.gasto)}</td></tr></tfoot></table>`
          : '<p class="empty">Não há despesas neste período.</p>'}
        </section>` : ''}

        <footer class="report__sign">
          <div><span></span><p>${x.fin ? 'Tesouraria' : st.gestor ? esc(x.whoLabel) : 'Gestor responsável'}</p></div>
          <div><span></span><p>Administração</p></div>
        </footer>
      </article>`;

    main.querySelectorAll('[name=kind]').forEach((el) => el.addEventListener('change', () => { st.kind = el.value; paint(); }));
    main.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const next = shiftPeriod(st.kind, st.anchor, Number(b.dataset.step));
      st.anchor = next > isoDate() ? isoDate() : next;
      paint();
    }));
    main.querySelector('.period-nav__date').addEventListener('change', (e) => { if (e.target.value) { st.anchor = e.target.value; paint(); } });
    main.querySelector('[data-gestor]')?.addEventListener('change', (e) => { st.gestor = e.target.value; paint(); });
    main.querySelectorAll('tr[data-exp]').forEach((tr) => tr.addEventListener('click', () => expenseDetail(ctx, x.exps.find((e) => e.id === tr.dataset.exp), people)));
  };

  // Relatório em PDF, com o mesmo conteúdo do ecrã
  document.querySelector('[data-pdf-report]').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const x = current();
    const showGestor = !st.gestor;
    const rcols = showGestor
      ? [{ label: 'Data', w: 0.095 }, { label: 'Recibo', w: 0.18, muted: true }, { label: 'Membro', w: 0.235 }, { label: 'Forma', w: 0.155 }, { label: 'Recebido por', w: 0.165 }, { label: 'Valor', w: 0.17, r: true, strong: true }]
      : [{ label: 'Data', w: 0.11 }, { label: 'Recibo', w: 0.2, muted: true }, { label: 'Membro', w: 0.34 }, { label: 'Forma', w: 0.17 }, { label: 'Valor', w: 0.18, r: true, strong: true }];
    const sections = [];
    if (x.fin) {
      sections.push({ title: 'Resumo de caixa', cols: [{ label: 'Movimento', w: 0.7 }, { label: 'Valor', w: 0.3, r: true, strong: true }],
        rows: [['Saldo no início do período', money(x.anterior)], ['Entradas · contribuições recebidas', `+ ${money(x.total)}`], ['Saídas · despesas da obra', `− ${money(x.gasto)}`]],
        total: ['Saldo no fim do período', money(x.final)] });
    }
    if (x.byGestor.length) {
      sections.push({ title: 'Recebido por gestor',
        cols: [{ label: 'Gestor', w: 0.46 }, { label: 'Recebimentos', w: 0.18, r: true }, { label: 'Parte', w: 0.14, r: true }, { label: 'Valor', w: 0.22, r: true, strong: true }],
        rows: x.byGestor.map((g) => [g.nome, String(g.n), g.pct, money(g.v)]), total: ['Total recebido', String(x.list.length), '100,0%', money(x.total)] });
    }
    if (x.byMethod.length) {
      sections.push({ title: 'Recebido por forma de pagamento',
        cols: [{ label: 'Forma de pagamento', w: 0.6 }, { label: 'Recebimentos', w: 0.18, r: true }, { label: 'Valor', w: 0.22, r: true, strong: true }],
        rows: x.byMethod.map((m) => [m.l, String(m.n), money(m.v)]) });
    }
    sections.push({ title: 'Recebimentos', cols: rcols, empty: 'Não há recebimentos neste período.',
      rows: x.list.map((c) => [fmtDateShort(c.data), c.ref, people.get(c.membroId)?.nome || '—', metodoNome(c.metodo),
        ...(showGestor ? [people.get(c.registadoPor)?.nome || '—'] : []), money(c.valor)]),
      total: [...rcols.slice(0, -1).map((_, i) => (i === 0 ? 'Total recebido' : '')), money(x.total)] });
    if (x.fin) {
      if (x.byCat.length) {
        sections.push({ title: 'Gasto por categoria',
          cols: [{ label: 'Categoria', w: 0.6 }, { label: 'Despesas', w: 0.18, r: true }, { label: 'Valor', w: 0.22, r: true, strong: true }],
          rows: x.byCat.map((c) => [c.l, String(c.n), money(c.v)]) });
      }
      sections.push({ title: 'Despesas', empty: 'Não há despesas neste período.',
        cols: [{ label: 'Data', w: 0.095 }, { label: 'N.º', w: 0.165, muted: true }, { label: 'Descrição e nota', w: 0.41 }, { label: 'Categoria', w: 0.16, wrap: true }, { label: 'Valor', w: 0.17, r: true, strong: true }],
        rows: x.exps.map((ex) => ({
          cells: [fmtDateShort(ex.data), ex.ref, ex.descricao, CATEGORIAS[ex.categoria], money(ex.valor)],
          sub: { col: 2, lines: [`Nota: ${ex.nota}`, `Pago a ${ex.beneficiario || '—'} · ${METODOS[ex.metodo]}${ex.referencia ? ` · ${ex.referencia}` : ''}`] },
        })),
        total: ['Total gasto', '', '', '', money(x.gasto)] });
    }
    const repData = {
      title: x.title, period: x.r.label, obra: settings.obraNome,
      info: [['Gestor', x.whoLabel], ['Período', x.range], ['Emitido em', fmtDateTime(new Date().toISOString())], ['Emitido por', user.nome]],
      kpis: x.fin
        ? [{ l: 'Saldo anterior', v: money(x.anterior) }, { l: 'Recebido', v: money(x.total) }, { l: 'Gasto', v: money(x.gasto) }, { l: 'Saldo final', v: money(x.final), main: true }]
        : [{ l: 'Total recebido', v: money(x.total), main: true }, { l: 'Recebimentos', v: String(x.list.length) }, { l: 'Membros', v: String(x.members) }, { l: 'Valor médio', v: money(x.list.length ? x.total / x.list.length : 0) }],
      sections,
      signLeft: x.fin ? 'Tesouraria' : st.gestor ? x.whoLabel : 'Gestor responsável',
      file: `Relatorio-${x.fin ? 'financeiro-' : ''}${KIND_FILE[st.kind]}-${x.r.from}${st.gestor ? `-${(people.get(st.gestor)?.nome || '').split(' ')[0]}` : ''}.pdf`,
    };
    try { await pdfButton(b, () => downloadReportPdf(repData)); } catch (ex) { toast(ex.message); }
  });
  warmPdf();

  // CSV: com o relatório financeiro, entradas e saídas no mesmo ficheiro
  document.querySelector('[data-export]').addEventListener('click', () => {
    const x = current();
    if (!x.fin) return exportCsv(x.list, people, `relatorio-${st.kind}-${x.r.from}`);
    const rows = [['Tipo', 'Data', 'N.º', 'Descrição', 'Nota', 'Categoria / forma', 'Pessoa', 'Entrada (MT)', 'Saída (MT)']];
    const n = (v) => v.toFixed(2).replace('.', ',');
    const moves = [
      ...x.list.map((c) => ({ d: c.data, row: ['Entrada', c.data, c.ref, 'Contribuição', c.nota || '', METODOS[c.metodo], people.get(c.membroId)?.nome || '', n(c.valor), ''] })),
      ...x.exps.map((ex) => ({ d: ex.data, row: ['Saída', ex.data, ex.ref, ex.descricao, ex.nota, CATEGORIAS[ex.categoria], ex.beneficiario, '', n(ex.valor)] })),
    ].sort((a, b) => a.d.localeCompare(b.d));
    rows.push(['Saldo anterior', '', '', '', '', '', '', n(x.anterior), '']);
    moves.forEach((m) => rows.push(m.row));
    rows.push(['Saldo final', '', '', '', '', '', '', n(x.final), '']);
    downloadCsv(rows, `relatorio-financeiro-${KIND_FILE[st.kind]}-${x.r.from}`);
    toast('Relatório exportado');
  });
  paint();
}

// Obra ---------------------------------------------------------------------
async function obra({ main, head }) {
  const [settings, s] = await Promise.all([store.getSettings(), store.obraSummary()]);
  head('Campanha', 'Obra');

  main.innerHTML = `
    <div class="obra-form">
      <section class="card pad">
        <div class="card-head"><p class="eyebrow">Definições da campanha</p></div>
        <form novalidate>
          <div class="field"><label for="nome">Nome da campanha</label><input class="input" id="nome" name="obraNome" value="${esc(settings.obraNome)}"></div>
          <div class="field"><label for="meta">Meta (MT)</label><input class="input num" id="meta" name="meta" inputmode="numeric" value="${settings.meta}"><p class="hint">Valor total necessário para concluir a obra. O total geral recebido pelos gestores é comparado com esta meta.</p></div>
          <div class="obra-form__row">
            <div class="field"><label for="inicio">Início da campanha</label><input class="input" type="date" id="inicio" name="inicio" value="${settings.inicio}"></div>
            <div class="field"><label for="prazo">Prazo</label><input class="input" type="date" id="prazo" name="prazo" value="${settings.prazo}"></div>
          </div>
          <div class="field"><label for="wa">WhatsApp da tesouraria</label>
            <div class="phone phone--light"><span class="phone__prefix">+258</span><input id="wa" name="whatsapp" inputmode="numeric" value="${esc(phoneFmt(settings.whatsapp || '879470600'))}"></div>
            <p class="hint">Número oficial que envia os comprovativos aos membros e que aparece nos recibos.</p></div>
          <p class="error-text" data-error hidden></p>
          <div><button type="submit" class="btn btn-primary">Guardar alterações</button></div>
        </form>
      </section>
      <section>
        <p class="eyebrow" style="margin-bottom:12px">Pré-visualização</p>
        <div class="preview" data-preview></div>
        <div class="card pad backup">
          <p class="eyebrow">Cópia de segurança</p>
          <p class="hint">Descarregue todos os dados (pessoas, recebimentos, despesas e definições) num ficheiro. Guarde-o num lugar seguro, fora do telemóvel. O servidor também guarda uma cópia automática todos os dias.</p>
          <button type="button" class="btn btn-secondary" data-backup>${icon('download', 18)} Baixar cópia de segurança</button>
        </div>
      </section>
    </div>`;

  const form = main.querySelector('form');
  const preview = main.querySelector('[data-preview]');
  const paintPreview = () => {
    const meta = Number(form.meta.value.replace(/\D/g, '')) || 0;
    const p = meta ? (s.arrecadado / meta) * 100 : 0;
    preview.innerHTML = `<div class="obra" style="margin:0">
      <p class="eyebrow">${esc(form.obraNome.value || '—')}</p>
      <p class="obra__amount display-num">${money(s.arrecadado, { decimals: false, unit: false })}<span class="obra__unit">MT</span></p>
      <p class="obra__of muted">arrecadados de <span class="num">${money(meta, { decimals: false })}</span></p>
      ${progress(p)}
      <div class="obra__foot"><span><strong class="num">${pct(p)}</strong> da meta</span><span class="num">faltam ${money(Math.max(0, meta - s.arrecadado), { decimals: false })}</span></div>
    </div>`;
  };
  main.querySelector('[data-backup]').addEventListener('click', async () => {
    const [members, gestoresList, contributions, expenses, settingsNow] = await Promise.all([
      store.listMembers(), store.listGestores(), store.listContributions({}), store.listExpenses(), store.getSettings(),
    ]);
    const data = { sistema: 'NL Obra do Novo Templo', criado_em: new Date().toISOString(), definicoes: settingsNow, gestores: gestoresList, membros: members, recebimentos: contributions, despesas: expenses };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `copia-seguranca-nl-obra-${isoDate()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Cópia guardada: ${members.length} membros, ${contributions.length} recebimentos, ${expenses.length} despesas`);
  });
  form.addEventListener('input', paintPreview);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const meta = Number(form.meta.value.replace(/\D/g, ''));
    const err = form.querySelector('[data-error]');
    const whatsapp = form.whatsapp.value.replace(/\D/g, '');
    const msg = !form.obraNome.value.trim() ? 'Indique o nome da campanha.' : !(meta > 0) ? 'Indique uma meta maior que zero.' : form.prazo.value <= form.inicio.value ? 'O prazo tem de ser posterior ao início.' : !isValidPhone(whatsapp) ? 'Indique os 9 dígitos do WhatsApp da tesouraria, começando por 8.' : '';
    err.textContent = msg; err.hidden = !msg;
    if (msg) return;
    await store.updateSettings({ obraNome: form.obraNome.value.trim(), meta, inicio: form.inicio.value, prazo: form.prazo.value, whatsapp });
    toast('Alterações guardadas');
  });
  paintPreview();
}
