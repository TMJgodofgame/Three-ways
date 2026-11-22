const ids = ['gemini', 'groq', 'openrouter'];
const feedback = document.querySelector('#feedback');
const form = document.querySelector('#config');
let eraseArmed = false;
async function load() {
  const data = await chrome.storage.local.get(['keys', 'freeConfirmed']);
  for (const id of ids) document.getElementById(id).value = data.keys?.[id] || '';
  document.querySelector('#free-confirmed').checked = !!data.freeConfirmed;
}
for (const button of document.querySelectorAll('.reveal')) button.addEventListener('click', () => {
  const input = document.getElementById(button.dataset.for);
  input.type = input.type === 'password' ? 'text' : 'password';
  button.textContent = input.type === 'password' ? 'Ver' : 'Ocultar';
  button.setAttribute('aria-label', `${input.type === 'password' ? 'Mostrar' : 'Ocultar'} clave de ${button.dataset.for}`);
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const keys = Object.fromEntries(ids.map(id => [id, document.getElementById(id).value.trim()]));
  if (!Object.values(keys).some(Boolean)) { feedback.textContent = 'Añade al menos una clave API para empezar.'; return; }
  if (Object.values(keys).some(key => /\s/.test(key) || key.length > 512)) { feedback.textContent = 'Las claves no deben contener espacios y deben tener menos de 512 caracteres.'; return; }
  const save = document.querySelector('#save');
  save.disabled = true;
  try {
    await chrome.storage.local.set({keys, freeConfirmed: document.querySelector('#free-confirmed').checked});
    await chrome.runtime.sendMessage({type: 'RESET_COOLDOWNS'});
    feedback.textContent = 'Configuración guardada. Pulsa el icono de la extensión para encenderla. Las claves se comprobarán con tu primera consulta.';
    eraseArmed = false;
    document.querySelector('#delete').textContent = 'Borrar mis claves';
  } catch { feedback.textContent = 'No se pudo guardar la configuración. Inténtalo otra vez.'; }
  finally { save.disabled = false; }
});
document.querySelector('#retry').addEventListener('click', async () => {
  try { await chrome.runtime.sendMessage({type: 'RESET_COOLDOWNS'}); feedback.textContent = 'Se volverán a intentar tus proveedores en la próxima selección.'; }
  catch { feedback.textContent = 'No se pudieron reactivar los proveedores.'; }
});
document.querySelector('#delete').addEventListener('click', async event => {
  if (!eraseArmed) { eraseArmed = true; event.target.textContent = 'Pulsa otra vez para borrar'; feedback.textContent = 'Esto borrará las claves guardadas y apagará la extensión.'; return; }
  try {
    await chrome.storage.local.set({keys: {}, enabled: false, freeConfirmed: false, lastProvider: ''});
    await chrome.runtime.sendMessage({type: 'RESET_COOLDOWNS'});
    await load();
    feedback.textContent = 'Claves borradas. La extensión está apagada.';
    event.target.textContent = 'Borrar mis claves'; eraseArmed = false;
  } catch { feedback.textContent = 'No se pudieron borrar las claves.'; }
});
load().catch(() => { feedback.textContent = 'No se pudo cargar la configuración.'; });
