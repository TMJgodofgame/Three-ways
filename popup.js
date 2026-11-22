import {LANGUAGES} from './languages.js';
const toggle = document.querySelector('#toggle');
const languageSelect = document.querySelector('#translation-language');
const languageStatus = document.querySelector('#language-status');
for (const language of LANGUAGES) {
  const option = document.createElement('option');
  option.value = language.code; option.textContent = language.label;
  languageSelect.append(option);
}
async function loadLanguage() {
  const {translationLanguage = ''} = await chrome.storage.local.get('translationLanguage');
  languageSelect.value = LANGUAGES.some(item => item.code === translationLanguage) ? translationLanguage : '';
  languageSelect.disabled = false;
}
languageSelect.addEventListener('change', async () => {
  languageSelect.disabled = true;
  try {
    await chrome.storage.local.set({translationLanguage: languageSelect.value});
    languageStatus.textContent = languageSelect.value ? 'Idioma guardado para las próximas selecciones.' : 'Traducción automática desactivada.';
  } catch {
    await loadLanguage().catch(() => {});
    languageStatus.textContent = 'No se pudo guardar el idioma. Vuelve a intentarlo.';
  } finally { languageSelect.disabled = false; }
});
loadLanguage().catch(() => { languageStatus.textContent = 'No se pudo cargar el idioma. Reabre la extensión.'; });
let enabled = false;
async function render() {
  const data = await chrome.storage.local.get(['enabled', 'keys', 'freeConfirmed', 'lastProvider']);
  enabled = !!data.enabled;
  toggle.setAttribute('aria-checked', String(enabled));
  toggle.setAttribute('aria-label', enabled ? 'Apagar extensión' : 'Encender extensión');
  document.querySelector('#power-title').textContent = enabled ? 'Lista para ayudarte' : 'Extensión apagada';
  document.querySelector('#power-help').textContent = enabled ? 'Selecciona un texto en cualquier web.' : 'Actívala para entender lo que lees.';
  const configured = data.freeConfirmed && Object.values(data.keys || {}).some(Boolean);
  document.querySelector('#status').textContent = !configured ? 'Primero añade tus claves API en Configuración.' : data.lastProvider ? `Última respuesta: ${data.lastProvider}.` : 'Tus APIs están guardadas. Todo listo.';
  toggle.disabled = false;
}
toggle.addEventListener('click', async () => {
  toggle.disabled = true;
  try {
    const {keys = {}, freeConfirmed} = await chrome.storage.local.get(['keys', 'freeConfirmed']);
    if (!enabled && (!Object.values(keys).some(Boolean) || !freeConfirmed)) { await chrome.runtime.openOptionsPage(); return; }
    await chrome.storage.local.set({enabled: !enabled});
    await render();
  } catch { document.querySelector('#status').textContent = 'No se pudo guardar el cambio. Reabre la extensión.'; }
  finally { toggle.disabled = false; }
});
document.querySelector('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
render().catch(() => { document.querySelector('#status').textContent = 'No se pudo cargar la configuración.'; });
