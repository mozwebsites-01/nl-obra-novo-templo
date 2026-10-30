import * as store from '../store.js';
import {
  esc, icon, avatar, barChart, receipt, toast, openDialog, confirmDialog, navigate, greeting,
} from '../ui.js';
import { openInstallGuide, isInstalled } from '../install.js';
import {
  METODOS, ESTADOS, money, pct, fmtDate, fmtDateShort, fmtDateTime, monthLong, phoneFmt, isoDate, parseAmount, parseISO, defaultPayer,
} from '../format.js';

const NAV = [
  ['inicio', 'Início', 'home'],
  ['contribuir', 'Contribuir', 'plus-circle'],
  ['historico', 'Histórico', 'history'],
  ['mensagens', 'Mensagens', 'message-circle'],
  ['conta', 'Conta', 'user'],
];

const METHOD_ICON = { mpesa: 'smartphone', emola: 'smartphone', banco: 'landmark', numerario: 'banknote' };
const PREF_HIDE = 'nl.pref.hide';
const PREF_SMS = 'nl.pref.sms';

export async function renderMember(root, page, user, param) {
  document.body.className = 'is-member';
  document.body.classList.toggle('hide-values', localStorage.getItem(PREF_HIDE) === '1');
  const active = page === 'recibo' ? 'historico' : page === 'perfil' ? 'conta' : page;
  const unreadMsg = await store.unreadMessagesForMember(user.id);

  root.innerHTML = `
    <div class="m-app">
      <main class="m-main" id="main"></main>
      <nav class="m-nav" aria-label="Navegação principal">
        ${NAV.map(([k, label, ic]) => `<a href="#/m/${k}" class="${k === active ? 'is-active' : ''}" ${k === active ? 'aria-current="page"' : ''}><span class="m-nav__icon">${icon(ic, 24)}${k === 'mensagens' && unreadMsg && active !== 'mensagens' ? '<span class="m-nav__dot" aria-label="Mensagem nova"></span>' : ''}</span><span>${label}</span></a>`).join('')}
      </nav>
    </div>`;

  const main = root.querySelector('#main');
  const pages = { inicio, contribuir, historico, mensagens, conta, perfil: conta, recibo };
  await (pages[page] || inicio)(main, user, param);
  window.scrollTo(0, 0);
}

// Partes comuns ------------------------------------------------------------
function bar(title, back = '#/m/inicio') {
  return `<div class="bar"><a class="bar__btn" href="${back}" aria-label="Voltar">${icon('arrow-left', 22)}</a><h1>${esc(title)}</h1><span aria-hidden="true"></span></div>`;
}

function dayLabel(iso) {
  const today = isoDate();
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (iso === today) return 'Hoje';
  if (iso === isoDate(y)) return 'Ontem';
  return parseISO(iso).getFullYear() === new Date().getFullYear() ? fmtDateShort(iso) : fmtDate(iso);
}

function txRow(c) {
  return `<a class="tx" href="#/m/recibo/${c.id}">
    <span class="tx__icon">${icon(METHOD_ICON[c.metodo], 20)}</span>
    <div class="tx__main"><p class="tx__title">${METODOS[c.metodo]}</p><p class="tx__sub">${esc(c.ref)}</p></div>
    <div class="tx__end"><p class="tx__amt amt">${money(c.valor)}</p><p class="tx__state is-${c.estado}">${ESTADOS[c.estado]}</p></div>
  </a>`;
}

// Movimentos agrupados por dia, em cartões
function groupedByDay(list) {
  const groups = new Map();
  for (const c of list) {
    if (!groups.has(c.data)) groups.set(c.data, []);
    groups.get(c.data).push(c);
  }
  return [...groups].map(([d, items]) => `<p class="day">${dayLabel(d)}</p><div class="tx-card">${items.map(txRow).join('')}</div>`).join('');
}

function toggleHidden() {
  const on = localStorage.getItem(PREF_HIDE) !== '1';
  localStorage.setItem(PREF_HIDE, on ? '1' : '0');
  document.body.classList.toggle('hide-values', on);
  return on;
}

// A última contribuição, em destaque no Início.
function trackerCard(c) {
  return `<a class="track" href="#/m/recibo/${c.id}">
    <div class="track__top">
      <span class="tx__icon">${icon(METHOD_ICON[c.metodo], 20)}</span>
      <div class="tx__main">
        <p class="track__eyebrow">A sua última contribuição</p>
        <p class="tx__title amt">${money(c.valor)} <span class="muted" style="font-weight:500">· ${METODOS[c.metodo]}</span></p>
        <p class="tx__sub">${dayLabel(c.data)} · ${esc(c.ref)}</p>
      </div>
      ${icon('chevron-right', 18)}
    </div>
  </a>`;
}

// Início -------------------------------------------------------------------
// O membro vê apenas as suas contribuições e a evolução mensal (sem montantes da obra).
async function inicio(main, user) {
  const [me, series, recent, settings, unread, unreadMsg] = await Promise.all([
    store.memberSummary(user.id), store.monthlySeries(),
    store.listContributions({ membroId: user.id }), store.getSettings(), store.unreadCount(user.id),
    store.unreadMessagesForMember(user.id),
  ]);
  // Ecrã compacto: tudo cabe num telemóvel sem scroll
  const last = recent[0];
  main.innerHTML = `
    <header class="hero hero--home">
      <svg class="hero__arc" viewBox="0 0 200 200" aria-hidden="true"><path d="M 13.3 92.4 A 87 87 0 1 1 173.8 146.1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      <div class="hero__row">
        <a class="who" href="#/m/conta">${avatar(user, 44)}<div><p class="who__hi">${greeting()} · ${esc(settings.obraNome)}</p><p class="who__name">${esc(user.nome)}</p></div></a>
        <button type="button" class="round-btn" data-notif aria-label="Avisos${unread ? ` (${unread} por ler)` : ''}">${icon('bell', 20)}${unread ? `<span class="count">${unread}</span>` : ''}</button>
      </div>
      <div class="hero__chips">
        <span>${icon('check', 14)} ${me.count} ${me.count === 1 ? 'confirmada' : 'confirmadas'}</span>
        ${me.pendentes ? `<span>${icon('history', 14)} ${me.pendentes} a confirmar</span>` : ''}
      </div>
      <nav class="quick" aria-label="Atalhos">
        <a class="quick__item" href="#/m/contribuir"><span class="quick__btn">${icon('plus-circle', 24)}</span>Contribuir</a>
        <a class="quick__item" href="#/m/historico"><span class="quick__btn">${icon('history', 24)}</span>Histórico</a>
        <a class="quick__item" href="#/m/mensagens"><span class="quick__btn">${icon('message-circle', 24)}${unreadMsg ? `<span class="count">${unreadMsg}</span>` : ''}</span>Mensagens</a>
        <button type="button" class="quick__item" data-notif><span class="quick__btn">${icon('bell', 24)}${unread ? `<span class="count">${unread}</span>` : ''}</span>Avisos</button>
      </nav>
    </header>

    <div class="m-body m-body--home">
      ${last ? trackerCard(last) : `<a class="track track--empty" href="#/m/contribuir"><span class="tx__icon">${icon('plus-circle', 20)}</span><div class="tx__main"><p class="track__eyebrow">Ainda sem contribuições</p><p class="tx__title">Registe a sua primeira contribuição</p></div>${icon('chevron-right', 18)}</a>`}

      <section class="sec">
        <div class="sec-head"><h2>Como foram as contribuições</h2><span class="legend"><i></i>mês atual</span></div>
        <div class="tx-card tx-card--pad tx-card--chart">${barChart(series, { height: 108, private: true })}</div>
      </section>

      <figure class="verse">
        <span class="verse__mark" aria-hidden="true">“</span>
        <blockquote>Deus ama ao que dá com alegria.</blockquote>
        <figcaption>2 Coríntios 9:7</figcaption>
      </figure>
    </div>`;

  main.querySelectorAll('[data-notif]').forEach((b) => b.addEventListener('click', () => openNotifications(main, user)));
}

// Contribuir ---------------------------------------------------------------
const REF_HINT = {
  mpesa: 'O código de 10 caracteres no início do SMS de confirmação do M-Pesa.',
  emola: 'O código da transação na mensagem de confirmação do e-Mola.',
  banco: 'O número do talão ou da transferência.',
};

// Quem fez o pagamento — ajuda a tesouraria a encontrá-lo no extrato
const PAYER_TEXT = {
  mpesa: ['Número ou nome usado no M-Pesa', 'O número de onde saiu o dinheiro, ou o nome do titular se foi outra pessoa a enviar.'],
  emola: ['Número ou nome usado no e-Mola', 'O número de onde saiu o dinheiro, ou o nome do titular se foi outra pessoa a enviar.'],
  banco: ['Nome do titular da conta', 'O nome que aparece na transferência bancária.'],
  numerario: ['Entregue por', 'Nome de quem entregou o valor à tesouraria.'],
};

async function contribuir(main, user, retryId) {
  const settings = await store.getSettings();
  const retry = retryId ? await store.getContribution(retryId) : null;
  const pre = retry && retry.membroId === user.id ? retry : null;
  const today = isoDate();
  let comprovativo = null;

  main.innerHTML = `
    <header class="hero">
      ${bar('Contribuir')}
      <p class="hero__label" style="margin-top:24px"><label for="valor">Valor da contribuição</label></p>
      <div class="amount-hero"><input id="valor" form="contrib" name="valor" inputmode="decimal" autocomplete="off" placeholder="0" value="${pre ? esc(String(pre.valor)) : ''}"><span>MT</span></div>
      <div class="chips-hero">${[1000, 2500, 5000, 10000].map((v) => `<button type="button" data-v="${v}">${money(v, { decimals: false })}</button>`).join('')}</div>
    </header>

    <form class="m-body form" id="contrib" novalidate>
      <p class="muted small" style="margin-top:-4px">Depois de enviar o valor pelo meio habitual, registe aqui os dados. A tesouraria confirma e será notificado.</p>
      <fieldset class="field">
        <legend>Método de pagamento</legend>
        <div class="tx-card">${Object.entries(METODOS).map(([k, l]) => `
          <label class="tx choice"><span class="tx__icon">${icon(METHOD_ICON[k], 20)}</span><span class="tx__main"><span class="tx__title">${l}</span></span><input type="radio" name="metodo" value="${k}" ${k === (pre?.metodo || 'mpesa') ? 'checked' : ''}></label>`).join('')}
        </div>
      </fieldset>
      <div class="field">
        <label for="pagador" data-payer-label>Enviado por</label>
        <input class="input" id="pagador" name="pagador" autocomplete="off" maxlength="80" value="${esc(pre?.pagador || defaultPayer(user, pre?.metodo || 'mpesa'))}">
        <p class="hint" data-payer-hint></p>
      </div>
      <div class="field" data-ref-field>
        <label for="ref">Referência da transação <span class="muted" style="font-weight:400">(opcional)</span></label>
        <input class="input num" id="ref" name="referencia" autocomplete="off" autocapitalize="characters" placeholder="Ex.: DJK4H7X2PQ">
        <p class="hint" data-ref-hint></p>
      </div>
      <div class="field">
        <label for="data">Data do pagamento</label>
        <input class="input" type="date" id="data" name="data" max="${today}" value="${pre?.data || today}">
      </div>
      <div class="field">
        <label for="file">Comprovativo <span class="muted" style="font-weight:400">(opcional)</span></label>
        <label class="upload" for="file">${icon('paperclip', 20)}<span data-upload-label>Anexar fotografia ou PDF</span></label>
        <input type="file" id="file" accept="image/*,application/pdf" hidden>
      </div>
      <div class="field">
        <label for="nota">Nota <span class="muted" style="font-weight:400">(opcional)</span></label>
        <textarea class="textarea" id="nota" name="nota" rows="2" maxlength="200"></textarea>
      </div>
      <p class="error-text" data-error hidden></p>
      <button class="btn btn-primary btn-block btn-pill" type="submit">Declarar contribuição</button>
    </form>`;

  const form = main.querySelector('form');
  const valor = main.querySelector('#valor');
  const refField = form.querySelector('[data-ref-field]');

  const payer = form.querySelector('#pagador');
  let payerEdited = Boolean(pre);
  payer.addEventListener('input', () => { payerEdited = true; });
  const syncMethod = () => {
    const m = form.metodo.value;
    refField.hidden = m === 'numerario';
    form.querySelector('[data-ref-hint]').textContent = REF_HINT[m] || '';
    const [label, hint] = PAYER_TEXT[m];
    form.querySelector('[data-payer-label]').textContent = label;
    form.querySelector('[data-payer-hint]').textContent = hint;
    if (!payerEdited) payer.value = defaultPayer(user, m);
  };
  form.querySelectorAll('[name=metodo]').forEach((r) => r.addEventListener('change', syncMethod));
  syncMethod();

  main.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { valor.value = b.dataset.v; valor.focus(); }));

  form.querySelector('#file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const label = form.querySelector('[data-upload-label]');
    if (!file) return;
    try {
      comprovativo = file.type.startsWith('image/') ? { nome: file.name, dataUrl: await compressImage(file) } : { nome: file.name };
      label.textContent = file.name;
      label.parentElement.classList.add('has-file');
    } catch {
      comprovativo = null;
      label.textContent = 'Não foi possível ler o ficheiro. Tente outra imagem.';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('[data-error]');
    const v = parseAmount(valor.value);
    const metodo = form.metodo.value;
    const referencia = metodo === 'numerario' ? '' : form.referencia.value.trim().toUpperCase();
    const pagador = payer.value.trim().replace(/\s+/g, ' ');
    const data = form.data.value;
    let msg = '';
    if (!Number.isFinite(v) || v <= 0) msg = 'Indique o valor que contribuiu.';
    else if (v > 10_000_000) msg = 'Verifique o valor: parece demasiado alto.';
    else if (pagador.length < 3) msg = `${PAYER_TEXT[metodo][0]}: indique o nome ou número para a tesouraria localizar o pagamento.`;
    else if (!data || data > today) msg = 'Indique a data do pagamento (não pode ser futura).';
    err.textContent = msg;
    err.hidden = !msg;
    if (msg) { if (!Number.isFinite(v) || v <= 0) valor.focus(); return; }

    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const c = await store.declareContribution({ membroId: user.id, valor: v, metodo, referencia, pagador, data, nota: form.nota.value.trim(), comprovativo });
      done(main, c, settings);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
}

function done(main, c, settings) {
  main.innerHTML = `
    <header class="hero">${bar('Contribuição registada')}</header>
    <section class="done">
      <div class="done__mark">${icon('check', 32)}</div>
      <h1>Obrigado</h1>
      <p>Registámos ${money(c.valor)} para a ${esc(settings.obraNome)}. Assim que a tesouraria confirmar, receberá uma notificação.</p>
      <dl class="tx-card done__ref">
        <div class="receipt__row"><dt>Recibo</dt><dd>${esc(c.ref)}</dd></div>
        <div class="receipt__row"><dt>Estado</dt><dd><span class="tx__state is-pendente">Pendente</span></dd></div>
      </dl>
      <a class="btn btn-primary btn-block btn-pill" href="#/m/recibo/${c.id}">Ver recibo</a>
      <a class="btn btn-ghost btn-block" href="#/m/inicio">Voltar ao início</a>
    </section>`;
  window.scrollTo(0, 0);
}

function compressImage(file, max = 1000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Recorte quadrado ao centro, 320 px — suficiente para o avatar e leve para guardar
function squareImage(file, size = 320) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Escolha uma imagem (JPG ou PNG).'));
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error('Não foi possível ler esta imagem. Escolha outra.'));
    img.src = URL.createObjectURL(file);
  });
}

// Mensagens ----------------------------------------------------------------
function chatHTML(list, me, labelThem) {
  let lastDay = '';
  return list.map((m) => {
    const day = m.criadoEm.slice(0, 10);
    const sep = day !== lastDay ? `<p class="chat__day">${dayLabel(isoDate(new Date(m.criadoEm)))}</p>` : '';
    lastDay = day;
    const mine = m.de === me;
    const d = new Date(m.criadoEm);
    return `${sep}<div class="msg ${mine ? 'is-me' : 'is-them'}">${!mine && labelThem ? `<span class="msg__who">${esc(labelThem)}</span>` : ''}<p>${esc(m.texto)}</p><time>${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</time></div>`;
  }).join('');
}

async function mensagens(main, user) {
  await store.markThreadRead(user.id, 'membro');
  const list = await store.listMessages(user.id);

  main.innerHTML = `
    <header class="hero">
      ${bar('Mensagens')}
      <p class="hero__note">Escreva à tesouraria e à liderança. A resposta aparece aqui e nos avisos.</p>
    </header>
    <div class="m-body m-chat">
      <div class="chat" data-chat>${list.length ? chatHTML(list, 'membro', 'Tesouraria') : '<p class="empty">Ainda não há mensagens. Escreva a sua primeira mensagem abaixo.</p>'}</div>
    </div>
    <form class="composer m-composer" novalidate>
      <label class="sr-only" for="msg">Mensagem</label>
      <textarea id="msg" rows="1" maxlength="1000" placeholder="Escreva a sua mensagem…"></textarea>
      <button type="submit" aria-label="Enviar mensagem" disabled>${icon('send', 20)}</button>
    </form>`;

  const form = main.querySelector('form');
  const ta = form.querySelector('textarea');
  const send = form.querySelector('button');
  const chat = main.querySelector('[data-chat]');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; send.disabled = !ta.value.trim(); };
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = ta.value.trim();
    if (!texto) return;
    send.disabled = true;
    await store.sendMessage({ membroId: user.id, de: 'membro', texto, autorId: user.id });
    ta.value = '';
    grow();
    chat.innerHTML = chatHTML(await store.listMessages(user.id), 'membro', 'Tesouraria');
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });
  requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
}

// Histórico ----------------------------------------------------------------
const FILTERS = [['', 'Todas'], ['confirmado', 'Confirmadas'], ['pendente', 'Pendentes'], ['rejeitado', 'Rejeitadas']];

async function historico(main, user) {
  const [all, me] = await Promise.all([store.listContributions({ membroId: user.id }), store.memberSummary(user.id)]);
  let filter = '';

  main.innerHTML = `
    <header class="hero">
      ${bar('Histórico')}
      <div class="hero-split">
        <div><p>Confirmadas</p><p>${me.count}</p></div>
        <div><p>Por confirmar</p><p>${me.pendentes}</p></div>
      </div>
    </header>
    <div class="m-body">
      <div class="pills" role="group" aria-label="Filtrar por estado">${FILTERS.map(([k, l]) => `<button type="button" class="pill" data-f="${k}" aria-pressed="${k === filter}">${l}</button>`).join('')}</div>
      <div data-list></div>
    </div>`;

  const listEl = main.querySelector('[data-list]');
  const paintList = () => {
    const items = filter ? all.filter((c) => c.estado === filter) : all;
    listEl.innerHTML = items.length ? groupedByDay(items) : `<p class="empty">Sem contribuições ${filter ? 'neste estado' : 'registadas'}.</p>`;
  };
  main.querySelectorAll('[data-f]').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.f;
      main.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      paintList();
    }),
  );
  paintList();
}

// Recibo -------------------------------------------------------------------
async function recibo(main, user, id) {
  const c = await store.getContribution(id);
  if (!c || c.membroId !== user.id) {
    main.innerHTML = `<header class="hero">${bar('Recibo', '#/m/historico')}</header><p class="empty">Este recibo não existe ou não lhe pertence.</p>`;
    return;
  }
  const [settings, reviewer] = await Promise.all([store.getSettings(), c.revistoPor ? store.getMember(c.revistoPor) : null]);
  main.innerHTML = `
    <header class="hero" style="padding-bottom:40px">${bar('Recibo', '#/m/historico')}</header>
    <div class="receipt-wrap">${receipt(c, { member: user, reviewer, settings })}</div>
    <div class="receipt-actions">
      ${c.estado === 'confirmado' ? `<button type="button" class="btn btn-secondary btn-block btn-pill" data-print>${icon('printer', 18)} Imprimir recibo</button>` : ''}
      ${c.estado === 'rejeitado' ? `<a class="btn btn-primary btn-block btn-pill" href="#/m/contribuir/${c.id}">Declarar novamente</a>` : ''}
    </div>`;
  main.querySelector('[data-print]')?.addEventListener('click', () => window.print());
}

// Conta --------------------------------------------------------------------
function infoRow(ic, label, value) {
  return `<div class="tx"><span class="tx__icon">${icon(ic, 20)}</span><div class="tx__main"><p class="tx__label">${esc(label)}</p><p class="tx__value">${value}</p></div></div>`;
}
function toggleRow(ic, label, sub, key, on) {
  return `<div class="tx"><span class="tx__icon">${icon(ic, 20)}</span><div class="tx__main"><p class="tx__title">${esc(label)}</p><p class="tx__sub">${esc(sub)}</p></div><button type="button" class="switch" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-toggle="${key}"></button></div>`;
}
function actionRow(ic, label, sub, act, danger = false) {
  return `<button type="button" class="tx${danger ? ' tx--danger' : ''}" data-act="${act}"><span class="tx__icon">${icon(ic, 20)}</span><div class="tx__main"><p class="tx__title">${esc(label)}</p>${sub ? `<p class="tx__sub">${esc(sub)}</p>` : ''}</div>${danger ? '' : icon('chevron-right', 18)}</button>`;
}

async function conta(main, user) {
  main.innerHTML = `
    <header class="hero hero--profile">
      ${bar('A minha conta')}
      <div class="photo-edit">
        ${avatar(user, 88)}
        <label class="photo-edit__btn" for="foto" title="Alterar fotografia">${icon('camera', 16)}<span class="sr-only">Alterar fotografia</span></label>
        <input type="file" id="foto" accept="image/*" hidden>
      </div>
      <h2>${esc(user.nome)}</h2>
      <p>+258 ${esc(phoneFmt(user.telefone))}</p>
    </header>
    <div class="m-body" style="padding-top:4px">
      <p class="divider">Dados pessoais</p>
      <div class="row-list">
        <label class="tx" for="foto" style="cursor:pointer"><span class="tx__icon">${icon('camera', 20)}</span><div class="tx__main"><p class="tx__title">${user.foto ? 'Alterar fotografia' : 'Adicionar fotografia'}</p><p class="tx__sub">Aparece no seu perfil e nas mensagens</p></div>${icon('chevron-right', 18)}</label>
        ${user.foto ? actionRow('x', 'Remover fotografia', 'Volta a mostrar as suas iniciais', 'nophoto') : ''}
        ${infoRow('user', 'Nome', esc(user.nome))}
        ${infoRow('phone', 'Telemóvel', `+258 ${esc(phoneFmt(user.telefone))}`)}
        ${infoRow('calendar', 'Membro desde', esc(monthLong(user.criadoEm.slice(0, 7))))}
      </div>
      <p class="divider">Definições</p>
      <div class="row-list">
        ${toggleRow('eye-off', 'Ocultar valores', 'Os montantes ficam desfocados no ecrã', 'hide', localStorage.getItem(PREF_HIDE) === '1')}
        ${toggleRow('message-square', 'Avisos por SMS', 'Receber também as confirmações por SMS', 'sms', localStorage.getItem(PREF_SMS) !== '0')}
      </div>
      <p class="divider">Aplicação</p>
      <div class="row-list">
        ${actionRow('smartphone', isInstalled() ? 'App instalada' : 'Instalar no telemóvel', 'Android e iPhone', 'install')}
      </div>
      <p class="divider">Segurança</p>
      <div class="row-list">
        ${actionRow('key-round', 'Alterar PIN', 'Quatro dígitos para entrar', 'pin')}
        ${actionRow('languages', 'Idioma', 'Português', 'lang')}
        ${actionRow('rotate-ccw', 'Repor demonstração', 'Volta aos dados iniciais do protótipo', 'reset')}
        ${actionRow('log-out', 'Terminar sessão', '', 'logout', true)}
      </div>
    </div>`;

  main.querySelectorAll('[data-toggle]').forEach((sw) =>
    sw.addEventListener('click', () => {
      if (sw.dataset.toggle === 'hide') {
        sw.setAttribute('aria-checked', String(toggleHidden()));
      } else {
        const on = sw.getAttribute('aria-checked') !== 'true';
        localStorage.setItem(PREF_SMS, on ? '1' : '0');
        sw.setAttribute('aria-checked', String(on));
        toast(on ? 'Avisos por SMS ativados' : 'Avisos por SMS desativados');
      }
    }),
  );
  main.querySelector('#foto').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await store.updatePhoto(user.id, await squareImage(file));
      toast('Fotografia atualizada');
      navigate('#/m/conta');
    } catch (ex) {
      toast(ex.message || 'Não foi possível usar esta imagem. Escolha outra.');
    }
  });
  main.querySelector('[data-act=nophoto]')?.addEventListener('click', async () => {
    await store.updatePhoto(user.id, null);
    toast('Fotografia removida');
    navigate('#/m/conta');
  });
  const act = (name, fn) => main.querySelector(`[data-act=${name}]`).addEventListener('click', fn);
  act('logout', async () => { await store.signOut(); navigate('#/entrar'); });
  act('lang', () => toast('Por agora, o sistema está disponível apenas em português'));
  act('pin', () => changePin(user));
  act('install', openInstallGuide);
  act('reset', async () => {
    const ok = await confirmDialog({ title: 'Repor dados de demonstração?', text: 'Todas as alterações feitas neste navegador serão substituídas pelos dados iniciais.', confirmLabel: 'Repor dados' });
    if (!ok) return;
    await store.resetDemo();
    toast('Dados de demonstração repostos');
    navigate('#/m/inicio');
  });
}

function changePin(user) {
  const d = openDialog(`
    <header class="sheet__head"><h2>Alterar PIN</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <form class="sheet__body" style="display:grid;gap:16px" novalidate>
      <div class="field"><label for="p1">Novo PIN</label><input class="input num" id="p1" inputmode="numeric" maxlength="4" autocomplete="new-password" type="password"></div>
      <div class="field"><label for="p2">Repita o novo PIN</label><input class="input num" id="p2" inputmode="numeric" maxlength="4" autocomplete="new-password" type="password"></div>
      <p class="error-text" data-error hidden></p>
      <button class="btn btn-primary btn-block btn-pill" type="submit">Guardar PIN</button>
    </form>`);
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = d.querySelector('#p1').value, p2 = d.querySelector('#p2').value;
    const err = d.querySelector('[data-error]');
    const msg = !/^\d{4}$/.test(p1) ? 'O PIN tem de ter 4 dígitos.' : p1 !== p2 ? 'Os dois PIN não coincidem.' : '';
    err.textContent = msg; err.hidden = !msg;
    if (msg) return;
    await store.updatePin(user.id, p1);
    d.close();
    toast('PIN guardado');
  });
}

// Notificações -------------------------------------------------------------
async function openNotifications(main, user) {
  const list = await store.listNotifications(user.id);
  openDialog(`
    <header class="sheet__head"><h2>Avisos</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <div class="notif-list">${list.length
      ? list.map((n) => `<a class="notif ${n.lida ? '' : 'is-unread'}" href="#/m/recibo/${n.contribId}" data-close><p>${esc(n.texto)}</p><p class="muted small" style="margin-top:4px">${fmtDateTime(n.criadoEm)}</p></a>`).join('')
      : '<p class="empty">Ainda não tem avisos.</p>'}</div>`);
  await store.markAllRead(user.id);
  main.querySelectorAll('[data-notif] .count').forEach((c) => c.remove());
}
