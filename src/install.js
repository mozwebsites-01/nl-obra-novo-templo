// Instalação da app no telemóvel (PWA).
// Android/Chrome: usa o pedido de instalação nativo quando o navegador o oferece.
// iPhone/iPad: o Safari não tem botão de instalação — mostramos os passos "Adicionar ao ecrã principal".
import { esc, icon, openDialog, toast } from './ui.js';

let deferredPrompt = null;
const DISMISS_KEY = 'nl.install.dismissed';

export function initInstall() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sem service worker: a app continua a funcionar no navegador */ });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.dispatchEvent(new CustomEvent('nl:installable'));
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    toast('App instalada no seu telemóvel');
  });
}

export function platform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

export const bannerDismissed = () => localStorage.getItem(DISMISS_KEY) === '1';
export const dismissBanner = () => localStorage.setItem(DISMISS_KEY, '1');

const step = (n, html) => `<li class="steps__item"><span class="steps__n">${n}</span><div>${html}</div></li>`;

const GUIDES = {
  android: () => `
    <ol class="steps">
      ${step(1, `Abra este endereço no <strong>Chrome</strong> do telemóvel.`)}
      ${step(2, `Toque no menu <span class="kbd">${icon('more-vertical', 16)}</span> no canto superior direito.`)}
      ${step(3, `Escolha <strong>Instalar app</strong> (ou <strong>Adicionar ao ecrã principal</strong>).`)}
      ${step(4, `Confirme em <strong>Instalar</strong>. O ícone NL aparece junto das outras apps.`)}
    </ol>`,
  ios: () => `
    <ol class="steps">
      ${step(1, `Abra este endereço no <strong>Safari</strong> do iPhone ou iPad.`)}
      ${step(2, `Toque no botão <strong>Partilhar</strong> <span class="kbd">${icon('share', 16)}</span> na barra inferior.`)}
      ${step(3, `Deslize e escolha <strong>Adicionar ao ecrã principal</strong> <span class="kbd">${icon('plus-square', 16)}</span>.`)}
      ${step(4, `Toque em <strong>Adicionar</strong>. O ícone NL aparece no ecrã principal.`)}
    </ol>`,
};

export function openInstallGuide() {
  const p = platform();
  let tab = p === 'ios' ? 'ios' : 'android';
  const url = location.origin + location.pathname;

  const d = openDialog(`
    <header class="sheet__head"><h2>Instalar no telemóvel</h2><button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
    <div class="sheet__body install">
      <div class="install__app">
        <img src="assets/icons/icon-192.png" alt="" width="64" height="64">
        <div><p class="install__name">NL Obra</p><p class="muted small">Nataniel Litsure Ministries</p></div>
      </div>
      ${isInstalled() ? `<p class="receipt__note">${icon('check', 16)} A app já está instalada neste aparelho.</p>` : `
      <p class="muted small">Instale a app para a abrir diretamente do ecrã principal, em ecrã inteiro, como qualquer outra aplicação. Não ocupa espaço como uma app da loja.</p>
      <div data-native></div>
      <div class="pills install__tabs" role="tablist">
        <button type="button" class="pill" role="tab" data-t="android" aria-pressed="${tab === 'android'}">Android</button>
        <button type="button" class="pill" role="tab" data-t="ios" aria-pressed="${tab === 'ios'}">iPhone / iPad</button>
      </div>
      <div data-guide></div>
      ${p === 'desktop' ? `<p class="install__url">Abra no telemóvel:<br><strong class="num">${esc(url)}</strong></p>` : ''}`}
    </div>`);

  if (isInstalled()) return;

  const native = d.querySelector('[data-native]');
  const paintNative = () => {
    native.innerHTML = deferredPrompt
      ? `<button type="button" class="btn btn-primary btn-block btn-pill" data-install>${icon('download', 18)} Instalar agora</button>`
      : '';
    native.querySelector('[data-install]')?.addEventListener('click', async () => {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') d.close();
      else paintNative();
    });
  };
  const paintGuide = () => {
    d.querySelector('[data-guide]').innerHTML = GUIDES[tab]();
    d.querySelectorAll('[data-t]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === tab)));
  };
  d.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; paintGuide(); }));
  const onInstallable = () => paintNative();
  document.addEventListener('nl:installable', onInstallable);
  d.addEventListener('close', () => document.removeEventListener('nl:installable', onInstallable));
  paintNative();
  paintGuide();
}
