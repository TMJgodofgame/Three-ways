(() => {
  if (globalThis.__tresFormasLoaded) return;
  globalThis.__tresFormasLoaded = true;
  let enabled = false, configured = false, host, shadow, body, footer, timer, currentText = '', serial = 0;
  let disconnected = false, stateSerial = 0;
  const events = new AbortController();
  function contextAvailable() {
    try { return !!globalThis.chrome?.runtime?.id; }
    catch { return false; }
  }
  function disconnect() {
    if (disconnected) return;
    disconnected = true; enabled = false; configured = false;
    stateSerial++;
    events.abort();
    close(false);
  }
  async function send(message) {
    if (disconnected) return null;
    if (!contextAvailable()) { disconnect(); return null; }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (!contextAvailable() || /Extension context invalidated/i.test(error?.message || String(error))) {
        disconnect();
        return null;
      }
      throw error;
    }
  }
  const labels = ['Más sencilla', 'Más directa', 'Más cotidiana'];
  const css = `
    :host{all:initial;color-scheme:light}
    *{box-sizing:border-box} .panel{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#25253e;background:#fff;border:1px solid #e4e1f1;border-radius:18px;box-shadow:0 18px 70px #21164030;overflow:hidden;width:100%;max-height:inherit;display:flex;flex-direction:column}
    header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #eeecf5;flex-shrink:0} .brand{font-weight:750;font-size:15px;letter-spacing:-.4px}.brand span{display:inline-grid;place-items:center;background:#6654df;color:white;width:25px;height:25px;border-radius:8px;margin-right:8px;font-size:13px}
    button{font:12px system-ui;cursor:pointer;border:1px solid #e5e1ef;background:#fff;color:#6353cd;border-radius:7px;padding:6px 9px}button:hover{background:#f0edff}button:focus-visible{outline:2px solid #6654df;outline-offset:2px} .close{border:0;font-size:23px;line-height:1;padding:4px 7px;color:#858098} .body{overflow:auto;padding:16px 18px;overscroll-behavior:contain} .caption{font-size:10px;color:#888198;letter-spacing:1.3px;font-weight:700;margin-bottom:6px}
    blockquote{font-size:12px;color:#777185;background:#f7f6fc;border-left:3px solid #ded8fa;margin:0 0 18px;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:95px;overflow:auto} .card{padding:13px 14px;background:#f8f7fe;border:1px solid #ebe7fa;border-radius:12px;margin-top:10px}.card-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.label{color:#6a55d9;font-size:11px;font-weight:700}.card p{margin:9px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.7;color:#39344c}
    .message{margin:8px 0;font-size:13px;color:#746c85;white-space:pre-wrap;overflow-wrap:anywhere}.loading{display:flex;align-items:center;gap:10px;padding:15px 0}.spinner{width:17px;height:17px;border:2px solid #e6e0fc;border-top-color:#6654df;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}}
    footer{border-top:1px solid #eeecf5;padding:11px 18px;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:10px;color:#8b829b;flex-shrink:0}footer span{overflow-wrap:anywhere}.tools{display:flex;gap:8px;margin-top:12px}.hint{font-size:10px;color:#9991a7;margin-top:14px}
  `;
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function close(cancel = true) {
    serial++;
    clearTimeout(timer);
    host?.remove(); host = null; shadow = null; currentText = '';
    if (cancel) send({type: 'CANCEL'}).catch(() => {});
  }
  function place(rect) {
    if (!host) return;
    const width = Math.min(410, window.innerWidth - 24);
    const height = Math.min(620, window.innerHeight - 24);
    const left = Math.max(12, Math.min(rect?.left || 12, window.innerWidth - width - 12));
    const below = (rect?.bottom || 12) + 10;
    const top = below + 280 < window.innerHeight ? below : Math.max(12, (rect?.top || 12) - Math.min(height, 520) - 10);
    for (const [key,value] of Object.entries({width:`${width}px`,maxHeight:`${Math.min(height, window.innerHeight-top-12)}px`,left:`${left}px`,top:`${top}px`})) host.style.setProperty(key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()), value, 'important');
  }
  function mount(text, rect) {
    host?.remove();
    host = document.createElement('div');
    for (const [key,value] of Object.entries({position:'fixed',display:'block','z-index':'2147483647',margin:'0',padding:'0',border:'0',background:'transparent',opacity:'1',visibility:'visible','pointer-events':'auto'})) host.style.setProperty(key,value,'important');
    shadow = host.attachShadow({mode: 'closed'});
    const style = node('style'); style.textContent = css; shadow.append(style);
    const panel = node('section', 'panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Tres formas de entender el texto');
    const header = node('header');
    const brand = node('div', 'brand'); brand.append(node('span', '', '≋'), document.createTextNode('Tres Formas'));
    const dismiss = node('button', 'close', '×'); dismiss.setAttribute('aria-label', 'Cerrar ventana'); dismiss.addEventListener('click', () => close());
    header.append(brand, dismiss);
    body = node('div', 'body'); body.setAttribute('aria-live', 'polite'); body.setAttribute('aria-busy', 'true');
    body.append(node('div', 'caption', 'TU TEXTO'), node('blockquote', '', text));
    const loading = node('div', 'loading'); loading.append(node('span', 'spinner'), node('div', 'message', 'Buscando tres formas de decirlo…')); body.append(loading);
    footer = node('footer'); footer.append(node('span', '', 'Un momento para verlo más claro.'), settingsButton());
    panel.append(header, body, footer); shadow.append(panel); document.documentElement.append(host); place(rect);
  }
  function settingsButton() {
    const button = node('button', '', 'Ajustes');
    button.addEventListener('click', () => send({type: 'OPEN_OPTIONS'}).catch(() => {}));
    return button;
  }
  function error(message, retry) {
    body.setAttribute('aria-busy', 'false');
    body.querySelector('.loading')?.remove();
    body.append(node('p', 'message', message));
    if (retry) {
      const tools = node('div', 'tools'); const button = node('button', '', 'Reintentar');
      button.addEventListener('click', () => request(currentText)); tools.append(button); body.append(tools);
    }
    footer.firstChild.textContent = 'No se ha podido completar la consulta.';
  }
  async function copy(text, button) {
    const originalLabel = button.dataset.copyLabel ||= button.textContent;
    try {
      try { await navigator.clipboard.writeText(text); }
      catch {
        const field = node('textarea'); field.value = text; field.style.cssText = 'position:fixed;opacity:0'; shadow.append(field); field.focus(); field.select();
        const ok = document.execCommand('copy'); field.remove(); if (!ok) throw new Error();
      }
      button.textContent = 'Copiado ✓';
    } catch { button.textContent = 'Selecciona y copia'; }
    setTimeout(() => { button.textContent = originalLabel; }, 1800);
  }
  function addTranslation(translation) {
    if (!translation) return;
    const card = node('article', 'card');
    card.setAttribute('aria-label', 'Traducci\u00f3n del texto original');
    const top = node('div', 'card-top');
    const button = node('button', '', 'Copiar traducci\u00f3n');
    button.addEventListener('click', () => copy(translation.text, button));
    top.append(node('span', 'label', `Traducci\u00f3n \u00b7 ${translation.label}`), button);
    const translated = node('p', '', translation.text);
    translated.lang = translation.language;
    translated.dir = ['ar', 'he', 'fa', 'ur', 'ps', 'yi'].includes(translation.language.split('-')[0]) ? 'rtl' : 'auto';
    card.append(top, translated); body.append(card);
  }
  async function request(text, rect) {
    if (!enabled || !text) return;
    const id = ++serial;
    currentText = text; mount(text, rect);
    if (text.length > 4000) { error('Selecciona un fragmento más corto: el máximo es de 4000 caracteres.', false); return; }
    if (!configured) { error('Añade tus claves API y completa la configuración en Ajustes.', false); return; }
    try {
      const result = await send({type: 'REFORMULATE', text});
      if (id !== serial || !host || !enabled) return;
      if (result?.error || !result?.versions) { error(result?.error || 'No se recibió una respuesta. Inténtalo de nuevo.', true); return; }
      body.setAttribute('aria-busy', 'false'); body.querySelector('.loading')?.remove();
      result.versions.forEach((text, index) => {
        const card = node('article', 'card'), top = node('div', 'card-top'), button = node('button', '', 'Copiar');
        button.setAttribute('aria-label', `Copiar versión ${index+1}`); button.addEventListener('click', () => copy(text, button));
        top.append(node('span', 'label', `${String(index+1).padStart(2,'0')} · ${labels[index]}`), button);
        card.append(top, node('p', '', text)); body.append(card);
      });
      addTranslation(result.translation);
      body.append(node('p', 'hint', 'La IA puede cometer errores. Contrasta los matices con el original.'));
      footer.firstChild.textContent = `Respuesta de ${result.provider}`;
    } catch { if (id === serial && host) error('Se ha perdido la conexión con la extensión. Recarga esta pestaña y vuelve a intentarlo.', false); }
  }
  const editable = 'input,textarea,select,[contenteditable]:not([contenteditable="false" i]),[role="textbox" i]';
  function includesEditable(range, event) {
    if (document.designMode === 'on' || document.activeElement?.closest(editable)) return true;
    if (event.composedPath().some(item => item instanceof Element && item.matches(editable))) return true;
    const root = range.commonAncestorContainer;
    const element = root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
    if (element?.closest(editable)) return true;
    // Una selección puede empezar y acabar fuera del mismo editor.
    return Array.from(root.querySelectorAll?.(editable) || []).some(field => range.intersectsNode(field));
  }
  function capture(event) {
    if (!enabled || !event.isTrusted || (host && event.composedPath().includes(host))) return;
    clearTimeout(timer);
    if (event.type === 'keyup' && !['Shift','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','a','A'].includes(event.key)) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
    const range = selection.getRangeAt(0);
    if (includesEditable(range, event)) return;
    const text = selection.toString().trim();
    if (!text || text === currentText) return;
    const r = range.getBoundingClientRect();
    const rect = {left:r.left, top:r.top, bottom:r.bottom};
    close();
    timer = setTimeout(() => request(text, rect), 450);
  }
  document.addEventListener('pointerup', capture, {capture:true, signal:events.signal});
  document.addEventListener('keyup', capture, {capture:true, signal:events.signal});
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && host) { close(); } }, {capture:true, signal:events.signal});
  window.addEventListener('resize', () => { if (host) place(); }, {signal:events.signal});
  window.addEventListener('pagehide', () => close(), {signal:events.signal});
  async function state() {
    const version = ++stateSerial;
    try {
      const result = await send({type:'GET_STATE'});
      if (version !== stateSerial) return;
      enabled = !!result?.enabled; configured = !!result?.configured;
      close();
    } catch { enabled = false; close(false); }
  }
  try {
    chrome.runtime.onMessage.addListener(message => { if (!disconnected && message.type === 'STATE_CHANGED') state(); });
    state();
  } catch { disconnect(); }
})();
