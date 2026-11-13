import * as store from './store.js';
import { renderLogin } from './views/login.js';
import { renderAdmin } from './views/admin.js';
import { initInstall } from './install.js';
import { toast } from './ui.js';

initInstall();

const app = document.getElementById('app');

// Inatividade: passados três minutos a sessão termina sozinha, mesmo com a
// app aberta. Cada sinal de atividade volta a pôr a contagem a zero.
let idle;
function armIdle() {
  clearTimeout(idle);
  if (!store.hasSession()) return;
  idle = setTimeout(async () => {
    if (!store.hasSession()) return;
    await store.signOut();
    toast('Sessão terminada por inatividade. Entre novamente.');
    location.replace('#/entrar'); // a mudança de hash reencaminha para o login
  }, store.SESSION_TTL);
}

for (const ev of ['pointerdown', 'keydown']) {
  window.addEventListener(ev, () => { store.touchSession(); armIdle(); }, { passive: true });
}
// De volta ao separador: o prazo pode ter passado enquanto esteve escondido.
// Só reagimos quando havia sessão — a meio do login não se mexe na vista.
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !store.hasSession()) return;
  if (await store.getSessionUser()) return armIdle();
  location.replace('#/entrar');
});

async function route() {
  const hash = location.hash.slice(1) || '/';
  const user = await store.getSessionUser();
  // Painel do membro em pausa: só existe a área de administração (admin e gestores)
  const home = user?.role === 'admin' ? '#/a/painel' : '#/a/inicio';
  armIdle();

  if (!user) {
    if (store.tookExpired()) toast('Sessão terminada por inatividade. Entre novamente.');
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
