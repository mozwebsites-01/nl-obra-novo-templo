// Área de gestão. Dois papéis:
//  - administração (principal): vê tudo — total geral, saldo de cada gestor, relatórios de todos;
//    cria e suspende gestores, gere membros e a meta da obra;
//  - gestor: regista membros, lança os valores que recebe (com recibo de receção) e imprime
//    relatórios — vê apenas os seus próprios recebimentos e o seu saldo acumulado.
// O painel do membro está em pausa: os membros não entram no sistema.
import * as store from '../store.js';
import {
  esc, icon, avatar, progress, barChart, receipt, toast, openDialog, confirmDialog, navigate,
} from '../ui.js';
import {
  METODOS, money, pct, fmtDate, fmtDateShort, fmtDateTime, fmtLongToday, monthKey, monthShort, monthLong,
  phoneFmt, isValidPhone, isoDate, parseAmount, defaultPayer, firstName, periodRange, shiftPeriod,
} from '../format.js';
import { openInstallGuide } from '../install.js';

// [chave, rótulo, ícone, rótulo curto para a barra inferior do telemóvel]
const NAV_ADMIN = [
  ['painel', 'Painel', 'layout-dashboard', 'Painel'],
  ['gestores', 'Gestores', 'key-round', 'Gestores'],
  ['contribuicoes', 'Recebimentos', 'receipt', 'Recebidos'],
  ['membros', 'Membros', 'users', 'Membros'],
  ['relatorios', 'Relatórios', 'file-text', 'Relatórios'],
  ['obra', 'Obra', 'landmark', 'Obra'],
];
const NAV_GESTOR = [
  ['inicio', 'Início', 'home', 'Início'],
  ['contribuicoes', 'Recebimentos', 'receipt', 'Recebidos'],
  ['membros', 'Membros', 'users', 'Membros'],
  ['relatorios', 'Relatórios', 'file-text', 'Relatórios'],
];

const isAdmin = (u) => u.role === 'admin';
const sumv = (l) => l.reduce((s, c) => s + c.valor, 0);
const roleLabel = (u) => u.cargo || (isAdmin(u) ? 'Administração' : 'Gestor');

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
        <div class="a-side__logo"><img src="assets/brand/logo-lockup-white.svg" alt="Nataniel Litsure Ministries" width="148" height="65"></div>
        <nav class="a-nav" aria-label="Gestão" style="--nav-n:${nav.length}">
          ${nav.map(([k, l, ic, short]) => `<a href="#/a/${k}" data-nav="${k}" class="${k === page ? 'is-active' : ''}" ${k === page ? 'aria-current="page"' : ''}>${icon(ic, 18)}<span class="a-nav__full">${l}</span><span class="a-nav__short">${short}</span></a>`).join('')}
        </nav>
        <div class="a-side__foot">
          ${mine ? `<div class="side-saldo"><p>O seu saldo acumulado</p><p class="side-saldo__v num">${money(mine.total.valor, { decimals: false })}</p></div>` : ''}
          <button type="button" class="a-side__ghost" data-act="install">${icon('smartphone', 16)}<span>Instalar no telemóvel</span>${icon('chevron-right', 14)}</button>
          ${isAdmin(user) ? `<button type="button" class="a-side__ghost" data-act="reset">${icon('rotate-ccw', 16)}<span>Repor demonstração</span>${icon('chevron-right', 14)}</button>` : ''}
          <p class="a-side__ver">Protótipo · v0.4</p>
        </div>
      </aside>
      <div class="a-main">
        <div class="a-bar">
          <form class="a-search" data-search role="search">${icon('search', 18)}<input type="search" placeholder="Procurar membro, recibo ou referência" aria-label="Procurar"></form>
          <div class="a-bar__end">
            ${isAdmin(user) ? '' : `<button type="button" class="btn btn-primary btn-sm a-bar__cta" data-record>${icon('plus-circle', 16)} Registar contribuição</button><span class="a-bar__sep" aria-hidden="true"></span>`}
            <div class="a-me">${avatar(user, 34)}<div><p>${esc(user.nome)}</p><p class="a-me__role">${esc(roleLabel(user))}</p></div></div>
            <button type="button" class="a-icon" data-act="logout" aria-label="Terminar sessão" title="Terminar sessão">${icon('log-out', 20)}</button>
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

  root.querySelector('[data-act=logout]').addEventListener('click', async () => { await store.signOut(); navigate('#/entrar'); });
  root.querySelector('[data-act=install]').addEventListener('click', openInstallGuide);
  root.querySelector('[data-record]')?.addEventListener('click', () => recordDialog(ctx));
  root.querySelector('[data-search]').addEventListener('submit', (e) => {
    e.preventDefault();
    sessionStorage.setItem('nl.q', e.currentTarget.querySelector('input').value.trim());
    navigate('#/a/contribuicoes');
  });
  root.querySelector('[data-act=reset]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Repor dados de demonstração?', text: 'Todas as alterações feitas neste navegador serão substituídas pelos dados iniciais.', confirmLabel: 'Repor dados' });
    if (!ok) return;
    await store.resetDemo();
    toast('Dados de demonstração repostos');
    navigate('#/a/painel');
  });

  const pages = { painel, inicio, gestores, contribuicoes, membros, relatorios, obra };
  await pages[page](ctx);
  window.scrollTo(0, 0);
}

// Recibo --------------------------------------------------------------------
// Imprime só o diálogo aberto (o recibo), sem o resto da aplicação
function printDialog() {
  document.body.classList.add('print-dialog');
  window.addEventListener('afterprint', () => document.body.classList.remove('print-dialog'), { once: true });
  window.print();
}

async function receiptDialog(c, people) {
  const settings = await store.getSettings();
  const d = openDialog(`
    <header class="sheet__head"><h2>Recibo ${esc(c.ref)}</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <div class="sheet__scroll">${receipt(c, { member: people.get(c.membroId), reviewer: people.get(c.registadoPor || c.revistoPor), settings })}</div>
    <div class="sheet__foot"><button type="button" class="btn btn-secondary" data-close>Fechar</button><button type="button" class="btn btn-primary" data-print>${icon('printer', 18)} Imprimir recibo</button></div>`);
  d.querySelector('[data-print]').addEventListener('click', printDialog);
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
        <input class="input" id="rec-m" list="rec-members" autocomplete="off" placeholder="Escreva o nome ou o telemóvel" value="${pre ? esc(label(pre)) : ''}">
        <datalist id="rec-members">${members.map((m) => `<option value="${esc(label(m))}"></option>`).join('')}</datalist>
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
  d.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { $('#rec-v').value = b.dataset.v; $('#rec-v').focus(); }));
  $('[data-new-member]').addEventListener('click', () => addMemberDialog((m) => {
    members.push(m);
    byLabel.set(label(m), m);
    $('#rec-members').insertAdjacentHTML('beforeend', `<option value="${esc(label(m))}"></option>`);
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
    // O diálogo passa a mostrar o recibo de receção, pronto a imprimir
    d.innerHTML = `
      <header class="sheet__head"><h2>Contribuição registada</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
      <div class="sheet__scroll">${receipt(c, { member: m, reviewer: ctx.user, settings })}</div>
      <div class="sheet__foot"><button type="button" class="btn btn-secondary" data-again>Registar outra</button><button type="button" class="btn btn-primary" data-print>${icon('printer', 18)} Imprimir recibo</button></div>`;
    d.querySelector('[data-print]').addEventListener('click', printDialog);
    d.querySelector('[data-again]').addEventListener('click', () => { d.close(); recordDialog(ctx); });
    d.addEventListener('close', () => ctx.refresh(), { once: true });
    toast(`Recibo ${c.ref} emitido · ${money(c.valor)}`);
  });
}

// Painel (administração) --------------------------------------------------
async function painel(ctx) {
  const { main, head } = ctx;
  const [s, series, settings, all, methods, people, gestoresList] = await Promise.all([
    store.obraSummary(), store.monthlySeries(), store.getSettings(), visibleReceipts(ctx.user),
    store.methodBreakdown(), peopleMap(), store.listGestores(),
  ]);
  const cur = series[series.length - 1];
  const geral = totals(all);
  head(fmtLongToday(), 'Painel', '<a class="btn btn-secondary" href="#/a/relatorios">' + icon('printer', 18) + ' Relatórios</a>');

  main.innerHTML = `
    <div class="dash">
      <section class="card obra-card" aria-label="Progresso da obra">
        <div class="card-head" style="margin-bottom:0"><p class="eyebrow">Total geral · ${esc(settings.obraNome)}</p><a href="#/a/obra" class="link small">Editar meta</a></div>
        <div class="obra-card__amount"><span class="display-num">${money(s.arrecadado, { decimals: false, unit: false })}</span><span class="unit">MT</span></div>
        <p class="obra-card__of muted">arrecadados de <span class="num">${money(s.meta, { decimals: false })}</span> · <strong class="num accent">${pct(s.pct)}</strong></p>
        ${progress(s.pct)}
        <dl class="stats">
          <div><dt>Recebido hoje</dt><dd>${money(geral.hoje.valor, { decimals: false })}</dd></div>
          <div><dt>Esta semana</dt><dd>${money(geral.semana.valor, { decimals: false })}</dd></div>
          <div><dt>Este mês</dt><dd>${money(geral.mes.valor, { decimals: false })}</dd></div>
          <div><dt>Por angariar</dt><dd>${money(s.falta, { decimals: false })}</dd></div>
        </dl>
      </section>

      <section class="card pad" aria-label="Saldo de cada gestor">
        <div class="card-head"><p class="eyebrow">Saldo de cada gestor</p><a href="#/a/gestores" class="link small">Ver gestores</a></div>
        <div class="split">${gestoresList.map((g) => {
          const t = totals(all.filter((c) => c.registadoPor === g.id));
          const share = s.arrecadado ? (t.total.valor / s.arrecadado) * 100 : 0;
          return `<div class="split__row">
            <div class="split__who">${avatar(g, 32)}<div><p class="split__name">${esc(g.nome)}</p><p class="muted small">hoje ${money(t.hoje.valor, { decimals: false })}</p></div></div>
            <div class="split__val"><p class="num">${money(t.total.valor, { decimals: false })}</p><p class="muted small num">${pct(share)}</p></div>
            <div class="split__bar"><div style="width:${share.toFixed(1)}%"></div></div>
          </div>`;
        }).join('')}
          <div class="split__total"><span>Total geral</span><strong class="num">${money(s.arrecadado, { decimals: false })}</strong></div>
        </div>
      </section>

      <section class="card pad">
        <div class="card-head"><p class="eyebrow">Evolução mensal</p><p class="muted small num">${cur ? `${money(cur.value, { decimals: false })} em ${monthLong(cur.key)} · ${cur.contribuintes} contribuintes` : ''}</p></div>
        ${barChart(series, { height: 220, showValues: true })}
      </section>

      <section class="card pad">
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
  head(fmtLongToday(), `Olá, ${firstName(user.nome)}`);

  const period = (lbl, x) => `<div><dt>${lbl}</dt><dd class="num">${money(x.valor, { decimals: false })}</dd><dd class="muted small">${x.n} ${x.n === 1 ? 'recebimento' : 'recebimentos'}</dd></div>`;
  main.innerHTML = `
    <div class="g-home">
      <section class="card saldo" aria-label="O seu saldo acumulado">
        <p class="eyebrow saldo__eyebrow">O seu saldo acumulado</p>
        <p class="saldo__value"><span class="display-num">${money(t.total.valor, { decimals: false, unit: false })}</span><span class="unit">MT</span></p>
        <p class="saldo__sub">${t.total.n ? `Recebido por si em ${t.total.n} ${t.total.n === 1 ? 'contribuição' : 'contribuições'}${first ? `, desde ${fmtDate(first)}` : ''}.` : 'Ainda não registou recebimentos.'}</p>
        <dl class="saldo__periods">${period('Hoje', t.hoje)}${period('Esta semana', t.semana)}${period('Este mês', t.mes)}</dl>
        <div class="saldo__actions">
          <button type="button" class="btn btn-light" data-record-here>${icon('plus-circle', 18)} Registar contribuição</button>
          <a class="btn btn-ghost-light" href="#/a/relatorios">${icon('printer', 18)} Relatório de hoje</a>
        </div>
      </section>

      <section class="card pad">
        <div class="card-head"><p class="eyebrow">Os seus recebimentos por mês</p></div>
        ${barChart(monthlyOf(mine), { height: 180, showValues: true })}
      </section>

      <section class="card dash__wide table-card g-home__wide">
        <div class="card-head card-head--table"><p class="eyebrow">Os seus últimos recebimentos</p><a href="#/a/contribuicoes" class="link small">Ver todos</a></div>
        ${mine.length ? receiptsTable(mine.slice(0, 8), people) : `<div class="empty">Quando registar um valor recebido, o recibo aparece aqui.</div>`}
      </section>
    </div>`;
  main.querySelector('[data-record-here]').addEventListener('click', () => recordDialog(ctx));
  bindReceiptRows(main, mine, people);
}

// Tabela de recebimentos (partilhada) -------------------------------------
function receiptsTable(list, people, { showReceiver = false } = {}) {
  if (!list.length) return '<p class="empty">Sem recebimentos.</p>';
  return `<table class="table">
    <thead><tr><th>Recibo</th><th>Membro</th><th>Data</th><th>Forma</th><th>Entregue/enviado por · Ref.</th>${showReceiver ? '<th>Recebido por</th>' : ''}<th class="r">Valor</th></tr></thead>
    <tbody>${list.map((c) => {
      const m = people.get(c.membroId);
      const g = people.get(c.registadoPor);
      return `<tr class="click" data-id="${c.id}" tabindex="0"><td class="num muted">${esc(c.ref)}</td><td><div class="cell-person">${avatar(m, 30)}<span>${esc(m?.nome || '—')}</span></div></td><td>${fmtDate(c.data)}</td><td>${METODOS[c.metodo]}</td><td><span>${esc(c.pagador || '—')}</span><span class="cell-sub num" style="display:block">${esc(c.referencia || 'sem referência')}</span></td>${showReceiver ? `<td>${esc(g?.nome || '—')}</td>` : ''}<td class="r">${money(c.valor)}</td></tr>`;
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
          <button type="button" class="btn btn-secondary btn-sm" data-report="${g.id}">${icon('printer', 15)} Relatório</button>
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
  document.querySelector('[data-add]').addEventListener('click', () => addGestorDialog(ctx));
}

function addGestorDialog(ctx) {
  const d = openDialog(`
    <header class="sheet__head"><h2>Adicionar gestor</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <form class="sheet__body" style="display:grid;gap:16px" novalidate>
      <p class="muted small">O gestor pode registar membros, lançar os valores que recebe e imprimir relatórios. Vê apenas os seus próprios recebimentos.</p>
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
  let limit = 40;

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
        <div class="table-foot"><span>A mostrar ${Math.min(limit, list.length)} de ${list.length} · total desta seleção: <strong class="num" style="color:var(--ink)">${money(sumv(list))}</strong></span>${list.length > limit ? '<button type="button" class="btn btn-secondary btn-sm" data-more>Mostrar mais</button>' : ''}</div>`
      : `<p class="empty">${all.length ? 'Nenhum recebimento corresponde aos filtros.' : 'Ainda não há recebimentos registados.'}</p>`;
    table.querySelector('[data-more]')?.addEventListener('click', () => { limit += 40; paint(); });
    bindReceiptRows(table, list, people);
  };

  main.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('input', () => { f[el.dataset.f] = el.value; limit = 40; paint(); }));
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

// Membros -----------------------------------------------------------------
async function membros(ctx) {
  const { main, head, user } = ctx;
  const admin = isAdmin(user);
  let [list, regs, receipts, people] = await Promise.all([store.listMembers(), store.listRegistrations(), visibleReceipts(user), peopleMap()]);
  let tab = ctx.param === 'pedidos' && admin ? 'pedidos' : ctx.param === 'suspensos' && admin ? 'suspensos' : 'ativos';
  let q = '';
  head('Comunidade', 'Membros', `<button type="button" class="btn btn-${admin ? 'primary' : 'secondary'}" data-add>${icon('user-plus', 18)} Adicionar membro</button>`);

  // Totais por membro, dentro do que este utilizador pode ver
  const statsFor = (id) => {
    const l = receipts.filter((c) => c.membroId === id);
    return { n: l.length, total: sumv(l), ultima: l[0]?.data || null };
  };

  const paint = () => {
    const ql = q.toLowerCase();
    const match = (m) => !ql || m.nome.toLowerCase().includes(ql) || m.telefone.includes(ql.replace(/\s/g, ''));
    const tabs = admin ? [['ativos', 'Ativos', list.filter((m) => m.estado !== 'suspenso').length], ['suspensos', 'Suspensos', list.filter((m) => m.estado === 'suspenso').length], ...(regs.length ? [['pedidos', 'Pedidos antigos', regs.length]] : [])] : [];
    let table;
    if (tab === 'pedidos') {
      const rows = regs.filter(match);
      table = rows.length
        ? `<table class="table"><thead><tr><th>Pedido de</th><th>Telemóvel</th><th>Recebido</th><th class="r">Decisão</th></tr></thead><tbody>${rows.map((m) => `
            <tr><td><div class="cell-person">${avatar(m, 32)}<span>${esc(m.nome)}</span></div></td><td class="num">+258 ${phoneFmt(m.telefone)}</td><td>${fmtDateTime(m.criadoEm)}</td>
            <td class="r"><div class="row-actions"><button type="button" class="btn btn-secondary btn-sm" data-reg="${m.id}" data-ok="0">Recusar</button><button type="button" class="btn btn-primary btn-sm" data-reg="${m.id}" data-ok="1">${icon('check', 16)} Aprovar</button></div></td></tr>`).join('')}</tbody></table>`
        : '<p class="empty">Não há pedidos por tratar.</p>';
    } else {
      const rows = list.filter((m) => (tab === 'suspensos' ? m.estado === 'suspenso' : m.estado !== 'suspenso')).filter(match);
      table = rows.length
        ? `<table class="table"><thead><tr><th>Membro</th><th>Telemóvel</th><th class="r">Contribuições</th><th class="r">${admin ? 'Total' : 'Recebido por si'}</th><th>Última</th><th class="r"></th></tr></thead>
          <tbody>${rows.map((m) => {
            const s = statsFor(m.id);
            const susp = m.estado === 'suspenso';
            const action = admin
              ? `<button type="button" class="btn btn-ghost btn-sm" data-susp="${m.id}">${susp ? 'Reativar' : 'Suspender'}</button>`
              : `<button type="button" class="btn btn-secondary btn-sm" data-rec="${m.id}">${icon('plus-circle', 15)} Registar</button>`;
            return `<tr class="click${susp ? ' is-muted' : ''}" data-id="${m.id}" tabindex="0"><td><div class="cell-person">${avatar(m, 32)}<span>${esc(m.nome)}</span></div></td><td class="num">+258 ${phoneFmt(m.telefone)}</td><td class="r">${s.n}</td><td class="r">${money(s.total)}</td><td class="${s.ultima ? '' : 'muted'}">${s.ultima ? fmtDate(s.ultima) : '—'}</td><td class="r">${action}</td></tr>`;
          }).join('')}</tbody></table>`
        : `<p class="empty">${tab === 'suspensos' ? 'Nenhum membro suspenso.' : q ? 'Nenhum membro corresponde à pesquisa.' : 'Ainda não há membros. Adicione o primeiro.'}</p>`;
    }

    main.innerHTML = `
      ${tabs.length ? `<div class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button type="button" role="tab" class="tab" data-tab="${k}" aria-selected="${k === tab}">${l}<span class="tab__n num">${n}</span></button>`).join('')}</div>` : ''}
      <div class="toolbar"><label class="search">${icon('search', 18)}<input class="input" type="search" placeholder="Procurar por nome ou telemóvel" aria-label="Procurar membro" data-q value="${esc(q)}"></label><span class="muted small">${list.length} membros</span></div>
      <div class="card table-card">${table}</div>`;

    main.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));
    const qi = main.querySelector('[data-q]');
    qi.addEventListener('input', () => { q = qi.value; paint(); const n = main.querySelector('[data-q]'); n.focus(); n.setSelectionRange(q.length, q.length); });

    main.querySelectorAll('[data-reg]').forEach((b) => b.addEventListener('click', async () => {
      const aprovar = b.dataset.ok === '1';
      const m = regs.find((x) => x.id === b.dataset.reg);
      await store.reviewRegistration(m.id, aprovar, user.id);
      toast(aprovar ? `${m.nome} adicionado aos membros` : 'Pedido recusado');
      [list, regs] = await Promise.all([store.listMembers(), store.listRegistrations()]);
      paint();
    }));
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

async function relatorios(ctx) {
  const { main, head, user } = ctx;
  const admin = isAdmin(user);
  const [all, people, gestoresList, settings] = await Promise.all([visibleReceipts(user), peopleMap(), store.listGestores(), store.getSettings()]);
  const st = { kind: 'dia', anchor: isoDate(), gestor: admin ? sessionStorage.getItem('nl.gestor') || '' : user.id };
  sessionStorage.removeItem('nl.gestor');

  head('Relatórios', 'Relatório de recebimentos',
    `<button type="button" class="btn btn-secondary" data-export>${icon('download', 18)} Exportar CSV</button><button type="button" class="btn btn-primary" data-print>${icon('printer', 18)} Imprimir</button>`);

  const current = () => {
    const r = periodRange(st.kind, st.anchor);
    const list = all.filter((c) => c.data >= r.from && c.data <= r.to && (!st.gestor || c.registadoPor === st.gestor));
    return { r, list };
  };

  const paint = () => {
    const { r, list } = current();
    const total = sumv(list);
    const membersN = new Set(list.map((c) => c.membroId)).size;
    const whoLabel = st.gestor ? people.get(st.gestor)?.nome || '—' : 'Todos os gestores';
    const byGestor = admin && !st.gestor
      ? gestoresList.map((g) => { const l = list.filter((c) => c.registadoPor === g.id); return { g, n: l.length, v: sumv(l) }; })
      : [];
    const byMethod = Object.entries(METODOS).map(([k, l]) => { const x = list.filter((c) => c.metodo === k); return { l, n: x.length, v: sumv(x) }; }).filter((x) => x.n);
    const now = new Date();

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
            <h2>${KIND_TITLE[st.kind]}</h2>
            <p class="report__period">${esc(r.label)}</p>
          </div>
        </header>
        <dl class="report__info">
          <div><dt>Gestor</dt><dd>${esc(whoLabel)}</dd></div>
          <div><dt>Período</dt><dd class="num">${fmtDate(r.from)}${r.from !== r.to ? ` a ${fmtDate(r.to)}` : ''}</dd></div>
          <div><dt>Emitido em</dt><dd class="num">${fmtDateTime(now.toISOString())}</dd></div>
          <div><dt>Emitido por</dt><dd>${esc(user.nome)}</dd></div>
        </dl>

        <dl class="report__kpis">
          <div class="is-main"><dt>Total recebido</dt><dd class="num">${money(total)}</dd></div>
          <div><dt>Recebimentos</dt><dd class="num">${list.length}</dd></div>
          <div><dt>Membros</dt><dd class="num">${membersN}</dd></div>
          <div><dt>Valor médio</dt><dd class="num">${money(list.length ? total / list.length : 0)}</dd></div>
        </dl>

        ${byGestor.length ? `<section class="report__sec"><h3>Por gestor</h3>
          <table class="table"><thead><tr><th>Gestor</th><th class="r">Recebimentos</th><th class="r">Parte</th><th class="r">Valor</th></tr></thead>
          <tbody>${byGestor.map((x) => `<tr><td>${esc(x.g.nome)}</td><td class="r">${x.n}</td><td class="r">${pct(total ? (x.v / total) * 100 : 0)}</td><td class="r">${money(x.v)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total geral</td><td class="r">${list.length}</td><td class="r">100,0%</td><td class="r">${money(total)}</td></tr></tfoot></table></section>` : ''}

        ${byMethod.length ? `<section class="report__sec"><h3>Por forma de pagamento</h3>
          <table class="table"><tbody>${byMethod.map((x) => `<tr><td>${x.l}</td><td class="r">${x.n}</td><td class="r">${money(x.v)}</td></tr>`).join('')}</tbody></table></section>` : ''}

        <section class="report__sec"><h3>Recebimentos</h3>
          ${list.length ? `<table class="table"><thead><tr><th>Data</th><th>Recibo</th><th>Membro</th><th>Forma</th>${st.gestor ? '' : '<th>Recebido por</th>'}<th class="r">Valor</th></tr></thead>
          <tbody>${list.map((c) => `<tr><td class="num">${fmtDateShort(c.data)}</td><td class="num muted">${esc(c.ref)}</td><td>${esc(people.get(c.membroId)?.nome || '—')}</td><td>${METODOS[c.metodo]}</td>${st.gestor ? '' : `<td>${esc(people.get(c.registadoPor)?.nome || '—')}</td>`}<td class="r">${money(c.valor)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="${st.gestor ? 4 : 5}">Total</td><td class="r">${money(total)}</td></tr></tfoot></table>`
          : '<p class="empty">Não há recebimentos neste período.</p>'}
        </section>

        <footer class="report__sign">
          <div><span></span><p>${st.gestor ? esc(whoLabel) : 'Gestor responsável'}</p></div>
          <div><span></span><p>Administração</p></div>
        </footer>
      </article>`;

    main.querySelectorAll('[name=kind]').forEach((x) => x.addEventListener('change', () => { st.kind = x.value; paint(); }));
    main.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const next = shiftPeriod(st.kind, st.anchor, Number(b.dataset.step));
      st.anchor = next > isoDate() ? isoDate() : next;
      paint();
    }));
    main.querySelector('.period-nav__date').addEventListener('change', (e) => { if (e.target.value) { st.anchor = e.target.value; paint(); } });
    main.querySelector('[data-gestor]')?.addEventListener('change', (e) => { st.gestor = e.target.value; paint(); });
  };

  document.querySelector('[data-print]').addEventListener('click', () => window.print());
  document.querySelector('[data-export]').addEventListener('click', () => {
    const { r, list } = current();
    exportCsv(list, people, `relatorio-${st.kind}-${r.from}`);
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
          <p class="error-text" data-error hidden></p>
          <div><button type="submit" class="btn btn-primary">Guardar alterações</button></div>
        </form>
      </section>
      <section>
        <p class="eyebrow" style="margin-bottom:12px">Pré-visualização</p>
        <div class="preview" data-preview></div>
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
  form.addEventListener('input', paintPreview);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const meta = Number(form.meta.value.replace(/\D/g, ''));
    const err = form.querySelector('[data-error]');
    const msg = !form.obraNome.value.trim() ? 'Indique o nome da campanha.' : !(meta > 0) ? 'Indique uma meta maior que zero.' : form.prazo.value <= form.inicio.value ? 'O prazo tem de ser posterior ao início.' : '';
    err.textContent = msg; err.hidden = !msg;
    if (msg) return;
    await store.updateSettings({ obraNome: form.obraNome.value.trim(), meta, inicio: form.inicio.value, prazo: form.prazo.value });
    toast('Alterações guardadas');
  });
  paintPreview();
}
