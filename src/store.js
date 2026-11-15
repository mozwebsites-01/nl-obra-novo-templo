// Fachada da camada de dados: com o Supabase configurado (src/config.js) usa a base de dados
// partilhada; sem configuração, guarda tudo neste navegador (store-local.js).
import { CONFIG } from './config.js';

export const REMOTE = Boolean(CONFIG.url && CONFIG.anonKey);

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Não foi possível carregar a ligação ao servidor.'));
    document.head.append(s);
  });
}

if (REMOTE && !window.supabase) await loadScript('assets/vendor/supabase.umd.js');
const impl = REMOTE ? await import('./store-remote.js') : await import('./store-local.js');

const call = (name) => (...args) => {
  if (typeof impl[name] !== 'function') throw new Error(`Função indisponível: ${name}`);
  return impl[name](...args);
};

export const SESSION_TTL = impl.SESSION_TTL;
export const STAFF = impl.STAFF;
export const MAX_ATTEMPTS = impl.MAX_ATTEMPTS;

export const createAdmin = call('createAdmin');
export const createGestor = call('createGestor');
export const createMember = call('createMember');
export const declareContribution = call('declareContribution');
export const findMemberByPhone = call('findMemberByPhone');
export const forgetAccount = call('forgetAccount');
export const getContribution = call('getContribution');
export const getMember = call('getMember');
export const getSessionUser = call('getSessionUser');
export const getSettings = call('getSettings');
export const lastAccount = call('lastAccount');
export const listContributions = call('listContributions');
export const listGestores = call('listGestores');
export const listMembers = call('listMembers');
export const listMessages = call('listMessages');
export const listNotifications = call('listNotifications');
export const listRegistrations = call('listRegistrations');
export const listThreads = call('listThreads');
export const lockedFor = call('lockedFor');
export const markAllRead = call('markAllRead');
export const markNotified = call('markNotified');
export const markThreadRead = call('markThreadRead');
export const memberStats = call('memberStats');
export const memberSummary = call('memberSummary');
export const methodBreakdown = call('methodBreakdown');
export const monthlySeries = call('monthlySeries');
export const needsSetup = call('needsSetup');
export const obraSummary = call('obraSummary');
export const recordContribution = call('recordContribution');
export const registerMember = call('registerMember');
export const reviewContribution = call('reviewContribution');
export const reviewRegistration = call('reviewRegistration');
export const sendMessage = call('sendMessage');
export const setSuspended = call('setSuspended');
export const signIn = call('signIn');
export const signOut = call('signOut');
export const takeExitReason = call('takeExitReason');
export const touchSession = call('touchSession');
export const unreadCount = call('unreadCount');
export const unreadMessagesForAdmin = call('unreadMessagesForAdmin');
export const unreadMessagesForMember = call('unreadMessagesForMember');
export const updatePhoto = call('updatePhoto');
export const updatePin = call('updatePin');
export const updateSettings = call('updateSettings');
export const sync = (...a) => (impl.sync ? impl.sync(...a) : undefined);
export const hasSession = call('hasSession');
