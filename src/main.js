import * as store from './store.js';
import { renderLogin } from './views/login.js';
import { renderMember } from './views/member.js';
import { renderAdmin } from './views/admin.js';
import { initInstall } from './install.js';

initInstall();

const app = document.getElementById('app');

async function route() {
  const hash = location.hash.slice(1) || '/';
  const user = await store.getSessionUser();
  const home = user?.role === 'admin' ? '#/a/painel' : '#/m/inicio';

  if (!user) {
    if (hash !== '/entrar') return location.replace('#/entrar');
    return renderLogin(app);
  }

  const [, area, page, param] = hash.split('/');
  if (area === 'a' && user.role === 'admin') return renderAdmin(app, page || 'painel', user, param);
  if (area === 'm' && user.role !== 'admin') return renderMember(app, page || 'inicio', user, param);
  location.replace(home);
}

window.addEventListener('hashchange', () => route().catch(showFatal));
route().catch(showFatal);

function showFatal(err) {
  console.error(err);
  app.innerHTML = `<p class="empty">Não foi possível abrir esta página. ${err.message}</p>`;
}
