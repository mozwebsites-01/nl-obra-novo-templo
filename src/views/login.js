import * as store from '../store.js';
import { DEMO } from '../seed.js';
import { esc, icon, avatar, navigate } from '../ui.js';
import { isValidPhone, phoneFmt, firstName } from '../format.js';

export async function renderLogin(root) {
  document.body.className = 'is-login';
  document.title = 'Entrar · Nataniel Litsure Ministries';
  let telefone = '';
  let pin = '';
  let busy = false;
  const settings = await store.getSettings();
  const reason = store.takeExitReason();
  const NOTICE = {
    saiu: ['check', 'Sessão terminada com segurança.'],
    inatividade: ['history', 'A sessão terminou por inatividade. Entre novamente para continuar.'],
  };
  let lockTimer;

  root.innerHTML = `
    <main class="login">
      <section class="login__main">
        <div class="login__top"><img src="assets/brand/logo-lockup-navy.svg" alt="Nataniel Litsure Ministries" width="100" height="44"><span>${esc(settings.obraNome)}</span></div>
        <div class="login__inner">
          ${NOTICE[reason] ? `<p class="login__notice" role="status">${icon(NOTICE[reason][0], 16)}<span>${NOTICE[reason][1]}</span></p>` : ''}
          <div aria-live="polite" data-step></div>
          <details class="login__demo">
            <summary>Contas de demonstração</summary>
            <div class="login__demo-list">
              <button type="button" class="login__demo-item login__demo-item--wide" data-demo="admin"><b>Administração</b><span>Samuel Tembe · PIN ${DEMO.admin.pin}</span></button>
              <button type="button" class="login__demo-item" data-demo="gestor"><b>Gestora</b><span>Rute Langa · PIN ${DEMO.gestor.pin}</span></button>
              <button type="button" class="login__demo-item" data-demo="gestor2"><b>Gestor</b><span>Paulo Cossa · PIN ${DEMO.gestor2.pin}</span></button>
            </div>
          </details>
        </div>
        <p class="login__foot">Protótipo · os dados ficam guardados apenas neste navegador.</p>
      </section>
      <aside class="login__brand">
        <div>
          <img class="login__brand-logo" src="assets/brand/logo-lockup-white.svg" alt="Nataniel Litsure Ministries" width="220" height="96">
          <p class="login__eyebrow">${esc(settings.obraNome)}</p>
        </div>
        <div class="login__brand-copy">
          <h2>Cada contribuição, registada com transparência.</h2>
          <p>Os gestores registam cada valor recebido e emitem o recibo. A administração acompanha o total de cada gestor e o total geral da obra.</p>
        </div>
      </aside>
    </main>`;

  const step = root.querySelector('[data-step]');

  function phoneStep(error = '') {
    pin = '';
    clearInterval(lockTimer);
    step.innerHTML = `
      <h1 class="login__title">Olá de novo</h1>
      <p class="login__lead">Entre com o número de telemóvel da sua conta de gestão.</p>
      <form class="login__form" novalidate>
        <div class="field">
          <label for="tel">Número de telemóvel</label>
          <div class="phone"><span class="phone__prefix">+258</span>
            <input id="tel" name="tel" inputmode="numeric" autocomplete="tel-national" placeholder="84 123 4567" value="${esc(telefone ? phoneFmt(telefone) : '')}" aria-describedby="tel-err">
          </div>
          <p class="error-text" id="tel-err" ${error ? '' : 'hidden'}>${esc(error)}</p>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Continuar</button>
      </form>
      <p class="login__alt">Acesso reservado à administração e aos gestores da obra.</p>`;
    const input = step.querySelector('#tel');
    input.focus();
    maskPhone(input);
    step.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const digits = input.value.replace(/\D/g, '');
      if (!isValidPhone(digits)) return phoneStep('Introduza os 9 dígitos do número, começando por 8.');
      telefone = digits;
      const m = await store.findMemberByPhone(telefone);
      if (!m) return phoneStep('Este número não tem acesso ao sistema. Fale com a administração da obra.');
      if (m.role === 'membro') return statusStep('pausado');
      if (m.estado === 'suspenso') return statusStep('suspenso');
      pinStep();
    });
  }

  function maskPhone(input) {
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 9);
      input.value = digits.length > 5 ? phoneFmt(digits) : digits.length > 2 ? `${digits.slice(0, 2)} ${digits.slice(2)}` : digits;
    });
  }

  function registerStep(notice = '') {
    step.innerHTML = `
      <button type="button" class="pin-back" data-back>${icon('chevron-left', 16)} Voltar</button>
      <h1 class="login__title">Pedir acesso</h1>
      <p class="login__lead">${esc(notice || 'Preencha os seus dados. A tesouraria confirma que faz parte da igreja e aprova o acesso.')}</p>
      <form class="login__form" novalidate>
        <div class="field"><label for="nome">Nome completo</label><input class="input login__input" id="nome" autocomplete="name" placeholder="Nome e apelido"></div>
        <div class="field"><label for="rtel">Número de telemóvel</label>
          <div class="phone"><span class="phone__prefix">+258</span><input id="rtel" inputmode="numeric" autocomplete="tel-national" placeholder="84 123 4567" value="${esc(telefone ? phoneFmt(telefone) : '')}"></div></div>
        <div class="login__row">
          <div class="field"><label for="p1">Crie um PIN</label><input class="input login__input" id="p1" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="4 dígitos"></div>
          <div class="field"><label for="p2">Repita o PIN</label><input class="input login__input" id="p2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="4 dígitos"></div>
        </div>
        <p class="error-text" data-error hidden></p>
        <button class="btn btn-primary btn-block" type="submit">Enviar pedido</button>
      </form>`;
    step.querySelector('[data-back]').addEventListener('click', () => phoneStep());
    const tel = step.querySelector('#rtel');
    maskPhone(tel);
    step.querySelector(telefone ? '#nome' : '#nome').focus();
    step.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nome = step.querySelector('#nome').value.trim().replace(/\s+/g, ' ');
      const digits = tel.value.replace(/\D/g, '');
      const p1 = step.querySelector('#p1').value, p2 = step.querySelector('#p2').value;
      const err = step.querySelector('[data-error]');
      let msg = nome.split(' ').length < 2 ? 'Indique o nome e o apelido.'
        : !isValidPhone(digits) ? 'Indique os 9 dígitos do telemóvel, começando por 8.'
        : !/^\d{4}$/.test(p1) ? 'O PIN tem de ter 4 dígitos.'
        : p1 !== p2 ? 'Os dois PIN não coincidem.' : '';
      if (!msg) {
        try {
          await store.registerMember({ nome, telefone: digits, pin: p1 });
          telefone = digits;
          return statusStep('enviado');
        } catch (ex) { msg = ex.message; }
      }
      err.textContent = msg; err.hidden = !msg;
    });
  }

  const STATUS = {
    enviado: ['check', 'Pedido enviado', 'A tesouraria foi notificada e vai rever o seu pedido. Assim que for aprovado, entre com o seu número e o PIN que criou.'],
    pendente: ['history', 'Pedido em análise', 'O seu pedido de acesso ainda aguarda aprovação da tesouraria. Tente novamente mais tarde.'],
    recusado: ['x', 'Pedido não aprovado', 'Não foi possível aprovar o acesso com este número. Fale com a secretaria da igreja.'],
    suspenso: ['key-round', 'Acesso suspenso', 'O acesso desta conta está suspenso. Fale com a administração para o reativar.'],
    pausado: ['history', 'Área do membro em pausa', 'Por agora, as contribuições são registadas pelos gestores da obra. Entregue a sua contribuição a um gestor e receberá o recibo.'],
  };

  function statusStep(kind) {
    const [ic, title, text] = STATUS[kind];
    step.innerHTML = `
      <div class="login__status">
        <span class="login__status-icon">${icon(ic, 26)}</span>
        <h1 class="login__title">${title}</h1>
        <p class="login__lead">${text}</p>
        <p class="login__lead num" style="margin-top:4px">+258 ${esc(phoneFmt(telefone))}</p>
        <button type="button" class="btn btn-secondary btn-block" data-back style="margin-top:28px;height:52px;border-radius:12px">Voltar ao início</button>
      </div>`;
    step.querySelector('[data-back]').addEventListener('click', () => phoneStep());
  }

  // Com `known`, é a última conta usada neste aparelho: mostra-se o nome e pede-se só o PIN.
  async function pinStep(known = false) {
    pin = '';
    const m = await store.findMemberByPhone(telefone);
    const head = known && m
      ? `<div class="login__who">${avatar(m, 56)}<div><h1 class="login__title">Olá, ${esc(firstName(m.nome))}</h1>
          <p class="login__lead">${esc(m.role === 'admin' ? 'Administração' : m.cargo || 'Gestor')} · +258 ${esc(phoneFmt(telefone))}</p></div></div>
         <p class="login__lead login__lead--pin">Introduza o seu PIN de 4 dígitos.</p>`
      : `<button type="button" class="pin-back" data-back>${icon('chevron-left', 16)} +258 ${esc(phoneFmt(telefone))}</button>
         <h1 class="login__title">Introduza o seu PIN</h1>
         <p class="login__lead">Quatro dígitos.</p>`;
    step.innerHTML = `
      ${head}
      <div class="pin-dots" aria-label="PIN" data-dots>${'<span class="pin-dot"></span>'.repeat(4)}</div>
      <p class="pin-msg" data-msg></p>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" class="key" data-k="${n}">${n}</button>`).join('')}
        <button type="button" class="key" disabled aria-hidden="true"></button>
        <button type="button" class="key" data-k="0">0</button>
        <button type="button" class="key key--fn" data-k="del" aria-label="Apagar">${icon('backspace', 22)}</button>
      </div>
      ${known && m ? `<button type="button" class="login__switch" data-switch>Não é ${esc(firstName(m.nome))}? Entrar com outro número</button>` : ''}`;
    step.querySelector('[data-back]')?.addEventListener('click', () => phoneStep());
    step.querySelector('[data-switch]')?.addEventListener('click', () => { store.forgetAccount(); telefone = ''; phoneStep(); });
    if (store.lockedFor(telefone)) lockOut();
    step.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));
    paint();
  }

  function paint() {
    step.querySelectorAll('.pin-dot').forEach((d, i) => d.classList.toggle('is-on', i < pin.length));
  }

  async function press(k) {
    if (busy) return;
    const dots = step.querySelector('[data-dots]');
    if (!dots) return;
    dots.classList.remove('is-error');
    step.querySelector('[data-msg]').textContent = '';
    if (k === 'del') pin = pin.slice(0, -1);
    else if (pin.length < 4) pin += k;
    paint();
    if (pin.length === 4) {
      busy = true;
      const res = await store.signIn(telefone, pin);
      await new Promise((r) => setTimeout(r, 180));
      busy = false;
      if (res.user) { clearInterval(lockTimer); return navigate(res.user.role === 'admin' ? '#/a/painel' : '#/a/inicio'); }
      pin = '';
      paint();
      dots.classList.add('is-error');
      if (res.locked) return lockOut();
      step.querySelector('[data-msg]').textContent = res.left === 1
        ? 'PIN incorreto. Resta 1 tentativa antes de a entrada ficar bloqueada.'
        : `PIN incorreto. Restam ${res.left} tentativas.`;
    }
  }

  // Demasiadas tentativas: teclado desativado com contagem decrescente
  function lockOut() {
    const msg = step.querySelector('[data-msg]');
    const keys = step.querySelectorAll('.key');
    const paintLock = () => {
      const left = store.lockedFor(telefone);
      if (!left) {
        clearInterval(lockTimer);
        keys.forEach((k) => { if (k.dataset.k) k.disabled = false; });
        msg.textContent = '';
        return;
      }
      keys.forEach((k) => { k.disabled = true; });
      msg.textContent = `Demasiadas tentativas. Tente novamente dentro de ${left} s.`;
    };
    clearInterval(lockTimer);
    paintLock();
    lockTimer = setInterval(paintLock, 1000);
  }

  const onKey = (e) => {
    if (!document.body.classList.contains('is-login')) return document.removeEventListener('keydown', onKey);
    if (!step.querySelector('[data-dots]') || store.lockedFor(telefone)) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
  };
  document.addEventListener('keydown', onKey);

  root.querySelectorAll('[data-demo]').forEach((b) =>
    b.addEventListener('click', () => {
      telefone = DEMO[b.dataset.demo].telefone;
      root.querySelector('.login__demo').open = false;
      pinStep(true);
    }),
  );

  const last = await store.lastAccount();
  if (last) { telefone = last.telefone; pinStep(true); } else phoneStep();
}
