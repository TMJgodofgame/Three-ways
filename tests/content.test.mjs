import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(sendMessage, id = 'test-extension') {
  const listeners = [];
  const target = {addEventListener(type, callback, options) { listeners.push({type, callback, signal:options?.signal}); }};
  const runtime = {id, sendMessage, onMessage:{addListener() {}}};
  vm.runInNewContext(source, {chrome:{runtime}, document:target, window:target,
    AbortController, clearTimeout, setTimeout});
  return {runtime, listeners};
}

test('los eventos de selección sin gesto del navegador no consultan el texto', async () => {
  const calls = [];
  const {listeners} = setup(message => {
    calls.push(message.type);
    return Promise.resolve({enabled:true, configured:true});
  });
  await tick();
  calls.length = 0;
  for (const type of ['pointerup', 'keyup']) {
    listeners.find(item => item.type === type).callback({type, isTrusted:false});
  }
  assert.deepEqual(calls, []);
});

for (const mode of ['synchronous', 'asynchronous', 'missing-id', 'throwing-id']) {
  test(`contexto invalidado (${mode}): limpia los eventos sin errores sin capturar`, async () => {
    let invalid = false, calls = 0;
    const {runtime, listeners} = setup(() => {
      calls++;
      if (!invalid) return Promise.resolve({enabled:true, configured:true});
      const error = new Error('Extension context invalidated.');
      if (mode === 'synchronous') throw error;
      return Promise.reject(error);
    });
    await tick();
    invalid = true;
    if (mode === 'missing-id') runtime.id = undefined;
    if (mode === 'throwing-id') Object.defineProperty(runtime, 'id', {get() { throw new Error('Extension context invalidated.'); }});
    const before = calls;
    assert.doesNotThrow(() => listeners.find(item => item.type === 'pagehide').callback());
    await tick();
    assert.ok(listeners.every(item => item.signal.aborted));
    // Incluso una llamada ya encolada no vuelve a contactar al runtime antiguo.
    listeners.find(item => item.type === 'pagehide').callback();
    await tick();
    assert.equal(calls, before + (['missing-id', 'throwing-id'].includes(mode) ? 0 : 1));
  });
}

test('un fallo de conexión temporal conserva los eventos para poder reintentar', async () => {
  const {listeners} = setup(() => Promise.reject(new Error('Could not establish connection.')));
  await tick();
  assert.ok(listeners.every(item => !item.signal.aborted));
});
