import {reformulate, MAX_TEXT} from './core.js';
import {LANGUAGES} from './languages.js';

// Las páginas y los content scripts no tienen acceso al almacén de claves.
const ready = chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'})
  .then(() => chrome.storage.local.remove(['mymemoryEmail', 'mymemoryUsage']));
const jobs = new Map();
const extensionPage = sender => sender.url?.startsWith(chrome.runtime.getURL(''));
async function badge() {
  const {enabled} = await chrome.storage.local.get('enabled');
  await chrome.action.setBadgeText({text: enabled ? 'ON' : ''});
  await chrome.action.setBadgeBackgroundColor({color: '#5a50df'});
}
chrome.runtime.onInstalled.addListener(async ({reason}) => {
  await ready;
  if (reason === 'install') {
    await chrome.storage.local.set({enabled: false});
    await chrome.runtime.openOptionsPage();
  }
  await badge();
});
chrome.runtime.onStartup.addListener(badge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.enabled) badge();
  if (changes.keys || changes.enabled || changes.freeConfirmed || changes.translationLanguage) {
    for (const job of jobs.values()) job.abort();
    jobs.clear();
    chrome.tabs.query({}).then(tabs => {
      for (const tab of tabs) chrome.tabs.sendMessage(tab.id, {type: 'STATE_CHANGED'}).catch(() => {});
    });
  }
});
chrome.tabs.onRemoved.addListener(tabId => {
  for (const [id, job] of jobs) if (id.startsWith(`${tabId}:`)) { job.abort(); jobs.delete(id); }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  const jobId = `${sender.tab?.id}:${sender.frameId ?? 0}`;
  (async () => {
    await ready;
    if (message.type === 'GET_STATE') {
      const {enabled, keys = {}, freeConfirmed, translationLanguage = ''} = await chrome.storage.local.get(['enabled', 'keys', 'freeConfirmed', 'translationLanguage']);
      return {enabled: !!enabled, configured: Object.values(keys).some(Boolean) && !!freeConfirmed,
        translationLanguage: LANGUAGES.some(item => item.code === translationLanguage) ? translationLanguage : ''};
    }
    if (message.type === 'OPEN_OPTIONS') { await chrome.runtime.openOptionsPage(); return {ok: true}; }
    if (message.type === 'RESET_COOLDOWNS' && extensionPage(sender)) { await chrome.storage.session.remove('cooldowns'); return {ok: true}; }
    if (message.type === 'CANCEL' && sender.tab) {
      jobs.get(jobId)?.abort(); jobs.delete(jobId);
      return {ok: true};
    }
    if (message.type !== 'REFORMULATE' || !sender.tab || !/^https?:/.test(sender.url || '')) return {error: 'Acci\u00f3n no permitida.'};
    const {enabled, keys = {}, freeConfirmed, translationLanguage = ''} = await chrome.storage.local.get(['enabled', 'keys', 'freeConfirmed', 'translationLanguage']);
    if (!enabled) return {error: 'La extensi\u00f3n est\u00e1 apagada.'};
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if (!text || text.length > MAX_TEXT) return {error: `Selecciona entre 1 y ${MAX_TEXT} caracteres.`};
    if (!freeConfirmed) return {error: 'Completa la configuración inicial en Ajustes.'};
    jobs.get(jobId)?.abort();
    const job = new AbortController();
    jobs.set(jobId, job);
    try {
      const {cooldowns = {}} = await chrome.storage.session.get('cooldowns');
      const result = await reformulate({keys, text, cooldowns, signal: job.signal,
        detectLanguage: text => chrome.i18n.detectLanguage(text),
        translationLanguage: LANGUAGES.find(item => item.code === translationLanguage) || null, onFailure: async (id, state) => {
        const current = await chrome.storage.session.get('cooldowns');
        await chrome.storage.session.set({cooldowns: {...current.cooldowns, [id]: state}});
      }});
      if (job.signal.aborted) return {error: 'Consulta cancelada.'};
      await chrome.storage.local.set({lastProvider: result.provider});
      return result;
    } finally { if (jobs.get(jobId) === job) jobs.delete(jobId); }
  })().then(sendResponse).catch(error => sendResponse({error: error.name === 'AbortError' ? 'Consulta cancelada.' : error.message || 'No se pudo conectar. Inténtalo de nuevo.'}));
  return true;
});
