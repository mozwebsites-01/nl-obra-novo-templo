import * as store from '../store.js';
import {
  esc, icon, avatar, status, progress, barChart, receipt, toast, openDialog, confirmDialog, navigate,
} from '../ui.js';
import {
  METODOS, ESTADOS, money, pct, fmtDate, fmtDateShort, fmtDateTime, fmtLongToday, monthKey, monthLong, phoneFmt, isValidPhone, isoDate,
} from '../format.js';
import { openInstallGuide } from '../install.js';

// Cada item leva também um rótulo curto, usado na barra inferior do telemóvel.
const NAV = [
  ['painel', 'Painel', 'layout-dashboard', 'Painel'],
  ['confirmacoes', 'Confirmações', 'inbox', 'Confirmar'],
  ['contribuicoes', 'Contribuições', 'receipt', 'Recibos'],
  ['mensagens', 'Mensagens', 'message-circle', 'Mensagens'],
  ['membros', 'Membros', 'users', 'Membros'],
  ['obra', 'Obra', 'landmark', 'Obra'],
];

const REJECT_REASONS = [
  'A referência indicada não consta do extrato da igreja.',
  'O valor recebido difere do valor declarado.',
  'Contribuição declarada em duplicado.',
];

// O que precisa da atenção da tesouraria: alimenta os contadores do menu e o sino
async function attention() {
  const [s, regs, msgs] = await Promise.all([store.obraSummary(), store.listRegistrations(), store.unreadMessagesForAdmin()]);
  return { confirmacoes: s.pendentes, membros: regs.length, mensagens: msgs, regs, total: s.pendentes + regs.length + msgs };
}

export async function renderAdmin(root, page, user, param) {
  document.body.className = 'is-admin';
  const att = await attention();
  if (!NAV.some(([k]) => k === page)) page = 'painel';

  root.innerHTML = `
    <div class="a-shell">
      <aside class="a-side">
        <div class="a-side__logo"><img src="assets/brand/logo-lockup-white.svg" alt="Nataniel Litsure Ministries" width="148" height="65"></div>
        <nav class="a-nav" aria-label="Administração">
          ${NAV.map(([k, l, ic, short]) => `<a href="#/a/${k}" data-nav="${k}" class="${k === page ? 'is-active' : ''}" ${k === page ? 'aria-current="page"' : ''}>${icon(ic, 18)}<span class="a-nav__full">${l}</span><span class="a-nav__short">${short}</span>${att[k] ? `<span class="badge num">${att[k]}</span>` : ''}</a>`).join('')}
        </nav>
        <div class="a-side__foot">
          <button type="button" class="a-side__ghost" data-act="install">${icon('smartphone', 16)}<span>Instalar no telemóvel</span>${icon('chevron-right', 14)}</button>
          <button type="button" class="a-side__ghost" data-act="reset">${icon('rotate-ccw', 16)}<span>Repor demonstração</span>${icon('chevron-right', 14)}</button>
          <p class="a-side__ver">Protótipo · v0.3</p>
        </div>
      </aside>
      <div class="a-main">
        <div class="a-bar">
          <form class="a-search" data-search role="search">${icon('search', 18)}<input type="search" placeholder="Procurar membro, recibo ou referência" aria-label="Procurar"></form>
          <div class="a-bar__end">
            <button type="button" class="a-icon" aria-label="Avisos" data-bell>${icon('bell', 20)}${att.total ? `<span class="count">${att.total}</span>` : ''}</button>
            <span class="a-bar__sep" aria-hidden="true"></span>
            <div class="a-me">${avatar(user, 34)}<div><p>${esc(user.nome)}</p><p class="a-me__role">${esc(user.cargo || 'Administração')}</p></div></div>
            <button type="button" class="a-icon" data-act="logout" aria-label="Terminar sessão" title="Terminar sessão">${icon('log-out', 20)}</button>
          </div>
        </div>
        <header class="a-top"><div><p class="a-top__eyebrow" data-eyebrow></p><h1 data-title></h1></div><div class="a-top__actions" data-actions></div></header>
        <div class="a-content" id="main"></div>
      </div>
    </div>`;

  root.querySelector('[data-act=logout]').addEventListener('click', async () => { await store.signOut(); navigate('#/entrar'); });
  root.querySelector('[data-bell]').addEventListener('click', () => openAttention());
  root.querySelector('[data-act=install]').addEventListener('click', openInstallGuide);
  root.querySelector('[data-search]').addEventListener('submit', (e) => {
    e.preventDefault();
    sessionStorage.setItem('nl.q', e.currentTarget.querySelector('input').value.trim());
    navigate('#/a/contribuicoes');
  });
  root.querySelector('[data-act=reset]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Repor dados de demonstração?', text: 'Todas as alterações feitas neste navegador serão substituídas pelos dados iniciais.', confirmLabel: 'Repor dados' });
    if (!ok) return;
    await store.resetDemo();
    toast('Dados de demonstração repostos');
    navigate('#/a/painel');
  });

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
    async refreshBadges() {
      const a = await attention();
      const put = (host, cls, n) => {
        let el = host.querySelector(`.${cls}`);
        if (!n) return el?.remove();
        if (!el) { el = document.createElement('span'); el.className = `${cls} num`; host.append(el); }
        el.textContent = n;
      };
      for (const k of ['confirmacoes', 'mensagens', 'membros']) put(root.querySelector(`[data-nav=${k}]`), 'badge', a[k]);
      put(root.querySelector('[data-bell]'), 'count', a.total);
    },
  };
  const pages = { painel, confirmacoes, contribuicoes, mensagens, membros, obra };
  await pages[page](ctx);
  window.scrollTo(0, 0);
}

// Centro de avisos da tesouraria (novos membros, contribuições, mensagens)
async function openAttention() {
  const a = await attention();
  const ago = (iso) => fmtDateTime(iso);
  const items = [
    ...a.regs.map((m) => `<a class="notif is-unread" href="#/a/membros/pedidos" data-close><p><strong>Novo pedido de acesso:</strong> ${esc(m.nome)} (+258 ${phoneFmt(m.telefone)})</p><p class="muted small" style="margin-top:4px">${ago(m.criadoEm)}</p></a>`),
    a.confirmacoes ? `<a class="notif is-unread" href="#/a/confirmacoes" data-close><p><strong>${a.confirmacoes}</strong> ${a.confirmacoes === 1 ? 'contribuição aguarda' : 'contribuições aguardam'} confirmação</p></a>` : '',
    a.mensagens ? `<a class="notif is-unread" href="#/a/mensagens" data-close><p><strong>${a.mensagens}</strong> ${a.mensagens === 1 ? 'mensagem nova' : 'mensagens novas'} de membros</p></a>` : '',
  ].filter(Boolean);
  openDialog(`
    <header class="sheet__head"><h2>Avisos</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <div class="notif-list">${items.join('') || '<p class="empty">Está tudo em dia.</p>'}</div>`);
}

function showReceipt(c, member, reviewer, settings) {
  openDialog(`
    <header class="sheet__head"><h2>Detalhe da contribuição</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <div style="overflow-y:auto">${receipt(c, { member, reviewer, settings, showProof: true })}</div>`);
}

// Painel -------------------------------------------------------------------
async function painel({ main, head }) {
  const [s, series, settings, recent, methods, members] = await Promise.all([
    store.obraSummary(), store.monthlySeries(), store.getSettings(),
    store.listContributions({ estado: 'confirmado' }), store.methodBreakdown(), store.listMembers(),
  ]);
  const names = new Map(members.map((m) => [m.id, m]));
  const cur = series[series.length - 1];
  head(fmtLongToday(), 'Painel');

  main.innerHTML = `
    <div class="dash">
      <section class="card obra-card" aria-label="Progresso da obra">
        <div class="card-head" style="margin-bottom:0"><p class="eyebrow">${esc(settings.obraNome)}</p><a href="#/a/obra" class="link small">Editar meta</a></div>
        <div class="obra-card__amount"><span class="display-num">${money(s.arrecadado, { decimals: false, unit: false })}</span><span class="unit">MT</span></div>
        <p class="obra-card__of muted">arrecadados de <span class="num">${money(s.meta, { decimals: false })}</span> · <strong class="num accent">${pct(s.pct)}</strong></p>
        ${progress(s.pct)}
        <dl class="stats">
          <div><dt>Por angariar</dt><dd>${money(s.falta, { decimals: false })}</dd></div>
          <div><dt>Contribuições confirmadas</dt><dd>${s.confirmadas}</dd></div>
          <div><dt>Contribuintes</dt><dd>${s.contribuintes}</dd></div>
          <div><dt>Prazo</dt><dd>${fmtDate(settings.prazo)}</dd></div>
        </dl>
      </section>

      <section class="card pend-card" aria-label="Por confirmar">
        <p class="eyebrow">Por confirmar</p>
        <p class="display-num">${s.pendentes}</p>
        <p class="muted">${s.pendentes === 1 ? 'contribuição declarada' : 'contribuições declaradas'} · <span class="num">${money(s.pendentesValor)}</span></p>
        <div class="pend-card__spacer"></div>
        ${s.pendentes ? '<a class="btn btn-primary" href="#/a/confirmacoes">Rever contribuições</a>' : '<p class="muted small">Tudo em dia. As novas declarações aparecem aqui.</p>'}
      </section>

      <section class="card pad">
        <div class="card-head"><p class="eyebrow">Evolução mensal</p><p class="muted small num">${cur ? `${money(cur.value, { decimals: false })} em ${monthLong(cur.key)} · ${cur.contribuintes} contribuintes` : ''}</p></div>
        ${barChart(series, { height: 220, showValues: true })}
      </section>

      <section class="card pad">
        <div class="card-head"><p class="eyebrow">Métodos de pagamento</p></div>
        <div class="methods">${methods.map((m) => `
          <div><div class="method__top"><span>${m.metodo === 'banco' ? 'Transferência' : METODOS[m.metodo]}</span><span class="num" style="white-space:nowrap">${money(m.valor, { decimals: false })} <span class="muted">· ${pct(m.pct)}</span></span></div>
          <div class="method__bar"><div style="width:${m.pct.toFixed(1)}%"></div></div></div>`).join('')}
        </div>
      </section>

      <section class="card dash__wide table-card">
        <div class="card-head card-head--table"><p class="eyebrow">Confirmadas recentemente</p><a href="#/a/contribuicoes" class="link small">Ver todas</a></div>
        <table class="table">
          <thead><tr><th>Membro</th><th>Recibo</th><th>Data</th><th>Método</th><th class="r">Valor</th></tr></thead>
          <tbody>${recent.slice(0, 6).map((c) => {
            const m = names.get(c.membroId);
            return `<tr><td><div class="cell-person">${avatar(m, 32)}<span>${esc(m?.nome || '—')}</span></div></td><td class="num muted">${esc(c.ref)}</td><td>${fmtDate(c.data)}</td><td>${METODOS[c.metodo]}</td><td class="r">${money(c.valor)}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </section>
    </div>`;
}

// Confirmações -------------------------------------------------------------
async function confirmacoes(ctx) {
  const { main, head, user } = ctx;
  const settings = await store.getSettings();
  let queue = (await store.listContributions({ estado: 'pendente' })).reverse(); // mais antigas primeiro
  const members = new Map((await store.listMembers()).map((m) => [m.id, m]));
  let selected = queue[0]?.id;

  const paint = () => {
    head('Tesouraria', 'Confirmações', '');
    if (!queue.length) {
      main.innerHTML = `<div class="card empty" style="padding:64px 24px"><p style="font-size:15px;color:var(--ink)">Não há contribuições por confirmar.</p><p style="margin-top:6px">As novas declarações dos membros aparecem aqui, das mais antigas para as mais recentes.</p></div>`;
      return;
    }
    const c = queue.find((x) => x.id === selected) || queue[0];
    selected = c.id;
    const m = members.get(c.membroId);
    main.innerHTML = `
      <p class="muted small" style="margin:-12px 0 20px">${queue.length} por confirmar · <span class="num">${money(queue.reduce((s, x) => s + x.valor, 0))}</span>. Compare cada declaração com o extrato antes de confirmar.</p>
      <div class="review">
        <div class="card queue" role="list">${queue.map((q) => {
          const qm = members.get(q.membroId);
          return `<button type="button" class="queue__item" role="listitem" data-id="${q.id}" aria-current="${q.id === selected}">
            ${avatar(qm, 36)}
            <div class="queue__main"><p class="queue__name">${esc(qm?.nome || '—')}</p><p class="queue__meta">${fmtDateShort(q.data)} · ${METODOS[q.metodo]}${q.comprovativo ? ' · com comprovativo' : ''}</p></div>
            <span class="queue__val">${money(q.valor, { unit: false })}</span>
          </button>`;
        }).join('')}</div>
        <div class="card review__detail">
          ${receipt(c, { member: m, settings, showProof: true })}
          <div class="review__actions" data-actions>
            <button type="button" class="btn btn-secondary" data-reject>${icon('x', 18)} Rejeitar</button>
            <button type="button" class="btn btn-primary" data-confirm>${icon('check', 18)} Confirmar contribuição</button>
          </div>
          <form class="review__reject" data-reject-form hidden novalidate>
            <label class="field"><span style="font-size:13px;font-weight:500">Motivo da rejeição</span>
              <textarea class="textarea" name="motivo" rows="2" placeholder="O membro verá este texto na notificação."></textarea></label>
            <div class="reason-chips">${REJECT_REASONS.map((r) => `<button type="button" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
            <p class="error-text" data-error hidden></p>
            <div class="review__reject-actions"><button type="button" class="btn btn-ghost" data-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Rejeitar contribuição</button></div>
          </form>
        </div>
      </div>`;

    main.querySelectorAll('.queue__item').forEach((b) => b.addEventListener('click', () => { selected = b.dataset.id; paint(); }));
    const actions = main.querySelector('[data-actions]');
    const form = main.querySelector('[data-reject-form]');
    main.querySelector('[data-confirm]').addEventListener('click', () => decide(c, 'confirmado'));
    main.querySelector('[data-reject]').addEventListener('click', () => { actions.hidden = true; form.hidden = false; form.motivo.focus(); });
    main.querySelector('[data-cancel]').addEventListener('click', () => { actions.hidden = false; form.hidden = true; });
    form.querySelectorAll('[data-reason]').forEach((b) => b.addEventListener('click', () => { form.motivo.value = b.dataset.reason; form.motivo.focus(); }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const motivo = form.motivo.value.trim();
      const err = form.querySelector('[data-error]');
      err.hidden = motivo.length >= 5;
      err.textContent = 'Explique ao membro, numa frase, porque não foi possível confirmar.';
      if (motivo.length >= 5) decide(c, 'rejeitado', motivo);
    });
  };

  async function decide(c, estado, motivo) {
    try {
      await store.reviewContribution(c.id, { estado, motivo, revistoPor: user.id });
    } catch (ex) {
      toast(ex.message);
      return;
    }
    const idx = queue.findIndex((x) => x.id === c.id);
    queue = queue.filter((x) => x.id !== c.id);
    selected = queue[Math.min(idx, queue.length - 1)]?.id;
    ctx.refreshBadges();
    toast(estado === 'confirmado' ? `Contribuição ${c.ref} confirmada` : `Contribuição ${c.ref} rejeitada`);
    paint();
  }

  paint();
}

// Contribuições ------------------------------------------------------------
async function contribuicoes({ main, head }) {
  const [all, membersList, settings] = await Promise.all([store.listContributions(), store.listMembers(), store.getSettings()]);
  const admin = await store.getMember('m_admin');
  const members = new Map(membersList.map((m) => [m.id, m]));
  const months = [...new Set(all.map((c) => monthKey(c.data)))];
  const f = { q: sessionStorage.getItem('nl.q') || '', estado: '', metodo: '', mes: '' };
  sessionStorage.removeItem('nl.q');
  let limit = 40;
  const count = (estado) => all.filter((c) => !estado || c.estado === estado).length;
  const TABS = [['', 'Todas'], ['pendente', 'Por confirmar'], ['confirmado', 'Confirmadas'], ['rejeitado', 'Rejeitadas']];

  head('Registo', 'Contribuições', `<button type="button" class="btn btn-secondary" data-export>${icon('download', 18)} Exportar CSV</button>`);

  main.innerHTML = `
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" class="tab" data-tab="${k}" aria-selected="${k === f.estado}">${l}<span class="tab__n num">${count(k)}</span></button>`).join('')}</div>
    <div class="toolbar">
      <label class="search">${icon('search', 18)}<input class="input" type="search" placeholder="Procurar por membro, recibo ou referência" data-f="q" aria-label="Procurar" value="${esc(f.q)}"></label>
      <select class="select" data-f="metodo" aria-label="Método"><option value="">Todos os métodos</option>${Object.entries(METODOS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <select class="select" data-f="mes" aria-label="Mês"><option value="">Todos os meses</option>${months.map((k) => `<option value="${k}">${monthLong(k)}</option>`).join('')}</select>
    </div>
    <div class="card table-card" data-table></div>`;

  main.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => {
    f.estado = t.dataset.tab; limit = 40;
    main.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    paint();
  }));

  const filtered = () => {
    const q = f.q.toLowerCase();
    return all.filter((c) => {
      if (f.estado && c.estado !== f.estado) return false;
      if (f.metodo && c.metodo !== f.metodo) return false;
      if (f.mes && monthKey(c.data) !== f.mes) return false;
      if (q) {
        const m = members.get(c.membroId);
        if (![m?.nome, c.ref, c.referencia, c.pagador, m?.telefone].some((v) => v && v.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  };

  const table = main.querySelector('[data-table]');
  const paint = () => {
    const list = filtered();
    const totalConf = list.filter((c) => c.estado === 'confirmado').reduce((s, c) => s + c.valor, 0);
    table.innerHTML = list.length
      ? `<table class="table">
          <thead><tr><th>Recibo</th><th>Membro</th><th>Data</th><th>Método</th><th>Enviado por · Ref.</th><th>Estado</th><th class="r">Valor</th></tr></thead>
          <tbody>${list.slice(0, limit).map((c) => {
            const m = members.get(c.membroId);
            return `<tr class="click" data-id="${c.id}" tabindex="0"><td class="num muted">${esc(c.ref)}</td><td><div class="cell-person">${avatar(m, 32)}<span>${esc(m?.nome || '—')}</span></div></td><td>${fmtDate(c.data)}</td><td>${METODOS[c.metodo]}</td><td><span>${esc(c.pagador || '—')}</span><span class="cell-sub num" style="display:block">${esc(c.referencia || 'sem referência')}</span></td><td>${status(c.estado)}</td><td class="r">${money(c.valor)}</td></tr>`;
          }).join('')}</tbody>
        </table>
        <div class="table-foot"><span>A mostrar ${Math.min(limit, list.length)} de ${list.length} · confirmado nesta seleção: <strong class="num" style="color:var(--ink)">${money(totalConf)}</strong></span>${list.length > limit ? '<button type="button" class="btn btn-secondary btn-sm" data-more>Mostrar mais</button>' : ''}</div>`
      : '<p class="empty">Nenhuma contribuição corresponde aos filtros.</p>';
    table.querySelector('[data-more]')?.addEventListener('click', () => { limit += 40; paint(); });
    table.querySelectorAll('tr[data-id]').forEach((tr) => {
      const open = () => { const c = all.find((x) => x.id === tr.dataset.id); showReceipt(c, members.get(c.membroId), c.revistoPor ? admin : null, settings); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  };

  main.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('input', () => { f[el.dataset.f] = el.value; limit = 40; paint(); }));
  document.querySelector('[data-export]').addEventListener('click', () => exportCsv(filtered(), members));
  paint();
}

function exportCsv(list, members) {
  const rows = [['Recibo', 'Membro', 'Telemóvel', 'Data', 'Método', 'Enviado por', 'Referência', 'Estado', 'Valor (MT)', 'Motivo']];
  for (const c of list) {
    const m = members.get(c.membroId);
    rows.push([c.ref, m?.nome || '', m ? `+258${m.telefone}` : '', c.data, METODOS[c.metodo], c.pagador || '', c.referencia || '', ESTADOS[c.estado], c.valor.toFixed(2).replace('.', ','), c.motivo || '']);
  }
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `contribuicoes-obra-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${list.length} contribuições exportadas`);
}

// Mensagens ----------------------------------------------------------------
function bubbles(list, members) {
  let lastDay = '';
  return list.map((m) => {
    const day = isoDate(new Date(m.criadoEm));
    const sep = day !== lastDay ? `<p class="chat__day">${fmtDate(day)}</p>` : '';
    lastDay = day;
    const mine = m.de === 'admin';
    const d = new Date(m.criadoEm);
    const who = mine ? (members.get(m.autorId)?.nome || 'Tesouraria') : '';
    return `${sep}<div class="msg ${mine ? 'is-me' : 'is-them'}"><p>${esc(m.texto)}</p><time>${mine ? `${esc(who)} · ` : ''}${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</time></div>`;
  }).join('');
}

async function mensagens(ctx) {
  const { main, head, user } = ctx;
  head('Comunidade', 'Mensagens');
  const all = await store.listMembers();
  const admin = await store.getMember('m_admin');
  const members = new Map([...all, admin].map((m) => [m.id, m]));
  let threads = await store.listThreads();
  let selected = ctx.param && members.has(ctx.param) ? ctx.param : threads[0]?.membroId;

  const paint = async () => {
    threads = await store.listThreads();
    if (selected && !threads.some((t) => t.membroId === selected)) threads.unshift({ membroId: selected, last: null, unread: 0 });
    if (!threads.length) {
      main.innerHTML = '<div class="card empty" style="padding:64px 24px">Ainda não há mensagens. Quando um membro escrever, a conversa aparece aqui.</div>';
      return;
    }
    if (selected) { await store.markThreadRead(selected, 'admin'); ctx.refreshBadges(); threads = threads.map((t) => (t.membroId === selected ? { ...t, unread: 0 } : t)); }
    const m = members.get(selected);
    const list = await store.listMessages(selected);
    main.innerHTML = `
      <div class="inbox card">
        <div class="inbox__list" role="list">${threads.map((t) => {
          const tm = members.get(t.membroId);
          return `<button type="button" class="inbox__item" role="listitem" data-id="${t.membroId}" aria-current="${t.membroId === selected}">
            ${avatar(tm, 40)}
            <div class="inbox__main"><p class="inbox__name">${esc(tm?.nome || '—')}</p><p class="inbox__snip">${t.last ? `${t.last.de === 'admin' ? 'Você: ' : ''}${esc(t.last.texto)}` : 'Nova conversa'}</p></div>
            <div class="inbox__end">${t.last ? `<time>${fmtDateShort(isoDate(new Date(t.last.criadoEm)))}</time>` : ''}${t.unread ? `<span class="badge-dot num">${t.unread}</span>` : ''}</div>
          </button>`;
        }).join('')}</div>
        <section class="inbox__thread">
          <header class="inbox__head">${avatar(m, 40)}<div><p class="inbox__name">${esc(m?.nome || '—')}</p><p class="muted small num">+258 ${m ? phoneFmt(m.telefone) : ''}</p></div></header>
          <div class="inbox__body"><div class="chat" data-chat>${list.length ? bubbles(list, members) : '<p class="empty">Escreva a primeira mensagem a este membro.</p>'}</div></div>
          <form class="composer inbox__composer" novalidate>
            <label class="sr-only" for="reply">Resposta</label>
            <textarea id="reply" rows="1" maxlength="1000" placeholder="Escreva uma resposta a ${esc(m?.nome.split(' ')[0] || '')}…"></textarea>
            <button type="submit" aria-label="Enviar resposta" disabled>${icon('send', 20)}</button>
          </form>
        </section>
      </div>`;

    const body = main.querySelector('.inbox__body');
    body.scrollTop = body.scrollHeight;
    main.querySelectorAll('.inbox__item').forEach((b) => b.addEventListener('click', () => { selected = b.dataset.id; paint(); }));
    const form = main.querySelector('form');
    const ta = form.querySelector('textarea');
    const send = form.querySelector('button');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; send.disabled = !ta.value.trim(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const texto = ta.value.trim();
      if (!texto) return;
      await store.sendMessage({ membroId: selected, de: 'admin', texto, autorId: user.id });
      await paint();
      main.querySelector('textarea').focus();
    });
  };
  await paint();
}

// Membros ------------------------------------------------------------------
const MEMBER_STATE = {
  ativo: '<span class="status status--confirmado">Ativo</span>',
  suspenso: '<span class="status status--rejeitado">Suspenso</span>',
};

async function membros(ctx) {
  const { main, head, user } = ctx;
  let [list, regs, stats, settings] = await Promise.all([store.listMembers(), store.listRegistrations(), store.memberStats(), store.getSettings()]);
  let tab = ctx.param === 'pedidos' ? 'pedidos' : ctx.param === 'suspensos' ? 'suspensos' : 'ativos';
  let q = '';
  head('Comunidade', 'Membros', `<button type="button" class="btn btn-primary" data-add>${icon('user-plus', 18)} Adicionar membro</button>`);

  const counts = () => ({
    ativos: list.filter((m) => m.estado !== 'suspenso').length,
    pedidos: regs.length,
    suspensos: list.filter((m) => m.estado === 'suspenso').length,
  });
  const TABS = [['ativos', 'Membros ativos'], ['pedidos', 'Pedidos de acesso'], ['suspensos', 'Suspensos']];

  const paint = () => {
    const c = counts();
    const ql = q.toLowerCase();
    const match = (m) => !ql || m.nome.toLowerCase().includes(ql) || m.telefone.includes(ql.replace(/\s/g, ''));
    let table;
    if (tab === 'pedidos') {
      const rows = regs.filter(match);
      table = rows.length
        ? `<table class="table"><thead><tr><th>Pedido de</th><th>Telemóvel</th><th>Recebido</th><th class="r">Decisão</th></tr></thead><tbody>${rows.map((m) => `
            <tr><td><div class="cell-person">${avatar(m, 32)}<span>${esc(m.nome)}</span></div></td><td class="num">+258 ${phoneFmt(m.telefone)}</td><td>${fmtDateTime(m.criadoEm)}</td>
            <td class="r"><div class="row-actions"><button type="button" class="btn btn-secondary btn-sm" data-reg="${m.id}" data-ok="0">Recusar</button><button type="button" class="btn btn-primary btn-sm" data-reg="${m.id}" data-ok="1">${icon('check', 16)} Aprovar</button></div></td></tr>`).join('')}</tbody></table>`
        : '<p class="empty">Não há pedidos de acesso por tratar. Quando alguém se registar, a tesouraria é avisada e o pedido aparece aqui.</p>';
    } else {
      const rows = list.filter((m) => (tab === 'suspensos' ? m.estado === 'suspenso' : m.estado !== 'suspenso')).filter(match);
      table = rows.length
        ? `<table class="table"><thead><tr><th>Membro</th><th>Telemóvel</th><th>Estado</th><th class="r">Contribuições</th><th class="r">Total confirmado</th><th>Última</th><th class="r"></th></tr></thead>
          <tbody>${rows.map((m) => {
            const s = stats.get(m.id) || { count: 0, total: 0, ultima: null };
            const susp = m.estado === 'suspenso';
            return `<tr class="click${susp ? ' is-muted' : ''}" data-id="${m.id}" tabindex="0"><td><div class="cell-person">${avatar(m, 32)}<span>${esc(m.nome)}</span></div></td><td class="num">+258 ${phoneFmt(m.telefone)}</td><td>${MEMBER_STATE[susp ? 'suspenso' : 'ativo']}</td><td class="r">${s.count}</td><td class="r">${money(s.total)}</td><td class="${s.ultima ? '' : 'muted'}">${s.ultima ? fmtDate(s.ultima) : '—'}</td>
              <td class="r"><button type="button" class="btn btn-secondary btn-sm" data-susp="${m.id}">${susp ? 'Reativar' : 'Suspender'}</button></td></tr>`;
          }).join('')}</tbody></table>`
        : `<p class="empty">${tab === 'suspensos' ? 'Nenhum membro suspenso.' : 'Nenhum membro corresponde à pesquisa.'}</p>`;
    }

    main.innerHTML = `
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" class="tab" data-tab="${k}" aria-selected="${k === tab}">${l}<span class="tab__n num${k === 'pedidos' && c.pedidos ? ' is-alert' : ''}">${c[k]}</span></button>`).join('')}</div>
      <div class="toolbar"><label class="search">${icon('search', 18)}<input class="input" type="search" placeholder="Procurar por nome ou telemóvel" aria-label="Procurar membro" data-q value="${esc(q)}"></label></div>
      <div class="card table-card">${table}</div>`;

    main.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));
    const qi = main.querySelector('[data-q]');
    qi.addEventListener('input', () => { q = qi.value; paint(); const n = main.querySelector('[data-q]'); n.focus(); n.setSelectionRange(q.length, q.length); });

    main.querySelectorAll('[data-reg]').forEach((b) => b.addEventListener('click', async () => {
      const aprovar = b.dataset.ok === '1';
      const m = regs.find((x) => x.id === b.dataset.reg);
      if (!aprovar && !(await confirmDialog({ title: `Recusar o pedido de ${m.nome}?`, text: 'A pessoa não terá acesso ao sistema. Se for engano, pode adicioná-la mais tarde como membro.', confirmLabel: 'Recusar pedido' }))) return;
      await store.reviewRegistration(m.id, aprovar, user.id);
      toast(aprovar ? `${m.nome} já pode entrar no sistema` : 'Pedido recusado');
      [list, regs] = await Promise.all([store.listMembers(), store.listRegistrations()]);
      ctx.refreshBadges();
      paint();
    }));

    main.querySelectorAll('[data-susp]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const m = list.find((x) => x.id === b.dataset.susp);
      if (await toggleSuspension(m, user)) { list = await store.listMembers(); paint(); }
    }));

    main.querySelectorAll('tr[data-id]').forEach((tr) => {
      const open = () => memberDialog(list.find((m) => m.id === tr.dataset.id), stats, settings, user, async () => { list = await store.listMembers(); paint(); });
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  };

  document.querySelector('[data-add]').addEventListener('click', addMemberDialog);
  paint();
}

async function toggleSuspension(m, user) {
  if (m.estado === 'suspenso') {
    await store.setSuspended(m.id, false);
    toast(`Acesso de ${m.nome} reativado`);
    return true;
  }
  return new Promise((resolve) => {
    let done = false;
    const d = openDialog(`
      <header class="sheet__head"><h2>Suspender ${esc(m.nome)}?</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
      <form class="sheet__body" style="display:grid;gap:14px" novalidate>
        <p class="muted">O membro deixa de conseguir entrar no sistema até ser reativado. O histórico de contribuições mantém-se.</p>
        <div class="field"><label for="motivo">Motivo <span class="muted" style="font-weight:400">(apenas para a tesouraria)</span></label><textarea class="textarea" id="motivo" rows="2" maxlength="200"></textarea></div>
        <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button type="submit" class="btn btn-primary">Suspender acesso</button></div>
      </form>`);
    d.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await store.setSuspended(m.id, true, d.querySelector('#motivo').value.trim());
      done = true;
      d.close();
      toast(`Acesso de ${m.nome} suspenso`);
    });
    d.addEventListener('close', () => resolve(done));
  });
}

async function memberDialog(m, stats, settings, user, onChange) {
  const contribs = await store.listContributions({ membroId: m.id });
  const s = stats.get(m.id) || { count: 0, total: 0 };
  const susp = m.estado === 'suspenso';
  const d = openDialog(`
    <header class="sheet__head"><h2>${esc(m.nome)}</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <div class="sheet__body">
      <div class="cell-person">${avatar(m, 56)}<div><p class="num">+258 ${phoneFmt(m.telefone)}</p><p class="muted small">Membro desde ${monthLong(m.criadoEm.slice(0, 7))}</p><p style="margin-top:6px">${MEMBER_STATE[susp ? 'suspenso' : 'ativo']}</p></div></div>
      ${susp && m.motivoSuspensao ? `<p class="receipt__note">Suspenso em ${fmtDate(isoDate(new Date(m.suspensoEm)))}: ${esc(m.motivoSuspensao)}</p>` : ''}
      <div class="receipt__rows" style="margin-top:20px">
        <div class="receipt__row"><dt>Total confirmado</dt><dd>${money(s.total)}</dd></div>
        <div class="receipt__row"><dt>Contribuições confirmadas</dt><dd>${s.count}</dd></div>
        <div class="receipt__row"><dt>Participação na meta</dt><dd>${pct(settings.meta ? (s.total / settings.meta) * 100 : 0)}</dd></div>
      </div>
      <p class="eyebrow" style="margin:24px 0 8px">Últimas contribuições</p>
      ${contribs.length ? `<table class="table"><tbody>${contribs.slice(0, 5).map((c) => `<tr><td class="num muted" style="padding-left:0">${esc(c.ref)}</td><td>${fmtDate(c.data)}</td><td>${status(c.estado)}</td><td class="r" style="padding-right:0">${money(c.valor)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Ainda sem contribuições.</p>'}
    </div>
    <div class="sheet__foot">
      <button type="button" class="btn btn-secondary" data-susp>${susp ? 'Reativar acesso' : 'Suspender acesso'}</button>
      <a class="btn btn-primary" href="#/a/mensagens/${m.id}" data-close>${icon('message-circle', 18)} Enviar mensagem</a>
    </div>`);
  d.querySelector('[data-susp]').addEventListener('click', async () => {
    d.close();
    if (await toggleSuspension(m, user)) onChange();
  });
}

function addMemberDialog() {
  const d = openDialog(`
    <header class="sheet__head"><h2>Adicionar membro</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <form class="sheet__body" style="display:grid;gap:16px" novalidate>
      <div class="field"><label for="nome">Nome completo</label><input class="input" id="nome" autocomplete="off"></div>
      <div class="field"><label for="tel">Telemóvel</label><div class="phone" style="height:44px"><span class="phone__prefix">+258</span><input id="tel" inputmode="numeric" placeholder="84 123 4567" style="font-size:15px"></div></div>
      <p class="hint">Será gerado um PIN de 4 dígitos para o primeiro acesso. O membro pode alterá-lo no perfil.</p>
      <p class="error-text" data-error hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-secondary" data-close>Cancelar</button><button type="submit" class="btn btn-primary">Adicionar membro</button></div>
    </form>`);
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = d.querySelector('#nome').value.trim().replace(/\s+/g, ' ');
    const telefone = d.querySelector('#tel').value.replace(/\D/g, '');
    const err = d.querySelector('[data-error]');
    let msg = nome.split(' ').length < 2 ? 'Indique o nome e o apelido.' : !isValidPhone(telefone) ? 'Indique os 9 dígitos do telemóvel, começando por 8.' : '';
    if (!msg) {
      try {
        const { member, pin } = await store.createMember({ nome, telefone });
        d.querySelector('form').outerHTML = `<div class="sheet__body">
          <p>${esc(member.nome)} foi adicionado. Partilhe estes dados de acesso com o membro:</p>
          <div class="receipt__rows" style="margin-top:16px"><div class="receipt__row"><dt>Telemóvel</dt><dd>+258 ${phoneFmt(member.telefone)}</dd></div><div class="receipt__row"><dt>PIN inicial</dt><dd style="font-family:var(--font-display);font-size:20px;letter-spacing:.2em">${pin}</dd></div></div>
          <div style="display:flex;justify-content:flex-end;margin-top:20px"><button type="button" class="btn btn-primary" data-close>Concluir</button></div></div>`;
        d.addEventListener('close', () => navigate('#/a/membros'), { once: true });
        return;
      } catch (ex) { msg = ex.message; }
    }
    err.textContent = msg;
    err.hidden = !msg;
  });
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
          <div class="field"><label for="meta">Meta (MT)</label><input class="input num" id="meta" name="meta" inputmode="numeric" value="${settings.meta}"><p class="hint">Valor total necessário para concluir a obra. Os membros veem o progresso face a esta meta.</p></div>
          <div class="obra-form__row">
            <div class="field"><label for="inicio">Início da campanha</label><input class="input" type="date" id="inicio" name="inicio" value="${settings.inicio}"></div>
            <div class="field"><label for="prazo">Prazo</label><input class="input" type="date" id="prazo" name="prazo" value="${settings.prazo}"></div>
          </div>
          <p class="error-text" data-error hidden></p>
          <div><button type="submit" class="btn btn-primary">Guardar alterações</button></div>
        </form>
      </section>
      <section>
        <p class="eyebrow" style="margin-bottom:12px">Como os membros veem</p>
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
