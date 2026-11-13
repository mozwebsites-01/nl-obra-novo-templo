import * as store from './store.js';
import { renderLogin } from './views/login.js';
import { renderAdmin } from './views/admin.js';
import { renderPublicReceipt } from './views/recibo.js';
import { initInstall } from './install.js';
import { icon, openDialog } from './ui.js';

initInstall();

const app = document.getElementById('app');

// Inatividade: passados três minutos sem atividade a sessão termina, mesmo com
// a app aberta. 30 segundos antes aparece um aviso com contagem decrescente.
const WARN_MS = 30 * 1000;
let idle, warnTimer, warnDialog, tick;

function closeWarning() {
  clearInterval(tick);
  if (warnDialog?.open) warnDialog.close();
  warnDialog = null;
}

async function expire() {
  closeWarning();
  if (!store.hasSession()) return;
  await store.signOut('inatividade');
  location.replace('#/entrar'); // a mudança de hash reencaminha para o login
}

function showWarning() {
  if (!store.hasSession()) return;
  let left = WARN_MS / 1000;
  warnDialog = openDialog(`
    <div class="sheet__body idle-warn">
      <span class="idle-warn__icon">${icon('history', 24)}</span>
      <h2>A sessão vai terminar</h2>
      <p class="muted">Por segurança, a sessão termina após 3 minutos sem atividade.</p>
      <p class="idle-warn__count num" data-left>0:${String(left).padStart(2, '0')}</p>
    </div>
    <div class="sheet__foot"><button class="btn btn-secondary" data-out>Sair agora</button><button class="btn btn-primary" data-stay>Continuar ligado</button></div>`,
    { className: 'sheet--sm' });
  const out = warnDialog.querySelector('[data-left]');
  tick = setInterval(() => { left = Math.max(0, left - 1); out.textContent = `0:${String(left).padStart(2, '0')}`; }, 1000);
  warnDialog.querySelector('[data-out]').addEventListener('click', async () => {
    closeWarning();
    await store.signOut('saiu');
    location.replace('#/entrar');
  });
  // "Continuar" é um clique: o pointerdown já renovou a sessão e fechou o aviso
  warnDialog.addEventListener('cancel', (e) => e.preventDefault());
}

function armIdle() {
  clearTimeout(idle);
  clearTimeout(warnTimer);
  closeWarning();
  if (!store.hasSession()) return;
  warnTimer = setTimeout(showWarning, store.SESSION_TTL - WARN_MS);
  idle = setTimeout(expire, store.SESSION_TTL);
}

for (const ev of ['pointerdown', 'keydown']) {
  window.addEventListener(ev, (e) => {
    if (!store.hasSession()) return;
    if (e.target.closest?.('[data-out]')) return; // "Sair agora" não renova
    store.touchSession();
    armIdle();
  }, { passive: true });
}
// De volta ao separador: o prazo pode ter passado enquanto esteve escondido.
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !store.hasSession()) return;
  if (await store.getSessionUser()) return armIdle();
  closeWarning();
  location.replace('#/entrar');
});

async function route() {
  const hash = location.hash.slice(1) || '/';
  // Recibo aberto pelo membro a partir do WhatsApp: público, sem sessão
  if (hash.startsWith('/recibo/')) return renderPublicReceipt(app, hash.slice('/recibo/'.length));
  const user = await store.getSessionUser();
  // Painel do membro em pausa: só existe a área de administração (admin e gestores)
  const home = user?.role === 'admin' ? '#/a/painel' : '#/a/inicio';
  armIdle();

  if (!user) {
    if (hash !== '/entrar') return location.replace('#/entrar');
    return renderLogin(app);
  }

  const [, area, page, param] = hash.split('/');
  if (area === 'a' && store.STAFF.includes(user.role)) return renderAdmin(app, page, user, param);
  location.replace(home);
}

window.addEventListener('hashchange', () => route().catch(showFatal));
route().catch(showFatal);

function showFatal(err) {
  console.error(err);
  app.innerHTML = `<p class="empty">Não foi possível abrir esta página. ${err.message}</p>`;
}
