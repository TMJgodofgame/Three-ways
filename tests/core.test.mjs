import test from 'node:test';
import assert from 'node:assert/strict';
import {askProvider, reformulate, PROVIDERS} from '../core.js';

const versions = ['Una versión sencilla.', 'Una versión directa.', 'Una versión cotidiana.'];
const language = {code:'sr-RS', label:'Serbio'};
const origins = {gemini:'https://generativelanguage.googleapis.com', groq:'https://api.groq.com', openrouter:'https://openrouter.ai'};
function response(provider, result) {
  const content = JSON.stringify(result);
  return new Response(JSON.stringify(provider.id === 'gemini'
    ? {candidates:[{content:{parts:[{text:content}]}}]}
    : {choices:[{message:{content}}]}));
}

for (const provider of PROVIDERS) {
  test(`${provider.id}: traducción y versiones en una petición`, async () => {
    let calls = 0;
    const result = await askProvider(provider, 'fake', 'Texto original', undefined, async (url, options) => {
      calls++;
      assert.equal(new URL(url).origin, origins[provider.id]);
      assert.equal(new URL(url).search, '');
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.referrerPolicy, 'no-referrer');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers[provider.id === 'gemini' ? 'x-goog-api-key' : 'Authorization'],
        provider.id === 'gemini' ? 'fake' : 'Bearer fake');
      assert.ok(!options.body.includes('fake'));
      const body = JSON.parse(options.body);
      const instruction = body.systemInstruction?.parts[0].text || body.messages[0].content;
      assert.match(instruction, /sr-RS/);
      assert.match(instruction, /"translation"/);
      return response(provider, {versions, translation:'Prevedeni tekst'});
    }, language);
    assert.equal(calls, 1);
    assert.deepEqual(result.versions, versions);
    assert.deepEqual(result.translation, {text:'Prevedeni tekst', language:'sr-RS', label:'Serbio'});
  });
}

test('sin idioma no pide ni muestra traducción', async () => {
  const result = await askProvider(PROVIDERS[0], 'fake', 'Texto', undefined, async (url, options) => {
    assert.doesNotMatch(JSON.parse(options.body).systemInstruction.parts[0].text, /"translation"/);
    return response(PROVIDERS[0], {versions});
  });
  assert.equal(result.translation, null);
});

test('una respuesta ilegible no guarda texto del proveedor en las pausas ni lo muestra', async () => {
  const privateMarker = 'texto-de-prueba-privado';
  const failures = [];
  const attempt = reformulate({keys:{gemini:'fake'}, text:'Texto',
    onFailure: (id, failure) => failures.push(failure.reason),
    request: (provider, key, text, signal) => askProvider(provider, key, text, signal,
      async () => new Response(privateMarker))});
  await assert.rejects(attempt, error => !error.message.includes(privateMarker) && error.message.includes('JSON'));
  assert.deepEqual(failures, ['El proveedor no devolvió una respuesta JSON válida.']);
});

test('una traducción vacía pasa al siguiente proveedor con el idioma elegido', async () => {
  const attempts = [];
  const result = await reformulate({keys:{gemini:'fake', groq:'fake'}, text:'Texto', translationLanguage:language,
    request: (provider, key, text, signal, fetcher, selected) => {
      attempts.push(provider.id);
      return askProvider(provider, key, text, signal, async () => response(provider,
        {versions, translation:provider.id === 'gemini' ? ' ' : 'Prevedeni tekst'}), selected);
    }});
  assert.deepEqual(attempts, ['gemini', 'groq']);
  assert.equal(result.translation.language, 'sr-RS');
});

const englishText = 'You can select several paragraphs to understand them more easily.';
const englishVersions = ['Select multiple paragraphs to make them easier to understand.',
  'Choose several paragraphs and read clearer versions of them.',
  'Highlight a few paragraphs to help you understand what they mean.'];
const spanishTarget = {code:'es-ES', label:'Español'};
const detected = language => ({isReliable:true, languages:[{language, percentage:100}]});

for (const provider of PROVIDERS) {
  test(`${provider.id}: mantiene inglés aunque la traducción elegida sea español`, async () => {
    const checked = [];
    const result = await reformulate({keys:{[provider.id]:'fake'}, text:englishText,
      translationLanguage:spanishTarget,
      detectLanguage: async text => { checked.push(text); return detected('en'); },
      request: (provider, key, text, signal, fetcher, target, source) => askProvider(provider, key, text, signal,
        async (url, options) => {
          const body = JSON.parse(options.body);
          const instruction = body.systemInstruction?.parts[0].text || body.messages[0].content;
          assert.match(instruction, /"en" \(ISO language code\)/);
          assert.match(instruction, /es-ES/);
          const original = body.contents?.[0].parts[0].text || body.messages.at(-1).content;
          assert.deepEqual(JSON.parse(original), {text:englishText});
          return response(provider, {versions:englishVersions, translation:'Puedes seleccionar varios párrafos.'});
        }, target, source)});
    assert.deepEqual(result.versions, englishVersions);
    assert.equal(result.translation.language, 'es-ES');
    assert.deepEqual(checked, [englishText, englishVersions.join('\n'), ...englishVersions]);
  });
}

for (const source of ['en', 'sr']) {
  test(`${source}: descarta incluso una sola versión en español y prueba el respaldo`, async () => {
    const attempts = [], failures = [];
    const correct = source === 'en' ? englishVersions : ['Možeš izabrati više pasusa.', 'Izaberi nekoliko pasusa.', 'Označi par pasusa.'];
    const result = await reformulate({keys:{gemini:'fake', groq:'fake'}, text:'Original',
      translationLanguage:spanishTarget,
      detectLanguage: async text => detected(text === versions[0] ? 'es' : source),
      onFailure: (id, failure) => failures.push({id, reason:failure.reason}),
      request: async (provider, key, text, signal, fetcher, target, language) => {
        attempts.push(provider.id);
        assert.equal(language, source);
        assert.deepEqual(target, spanishTarget);
        return {versions:provider.id === 'gemini' ? [correct[0], versions[0], correct[2]] : correct};
      }});
    assert.deepEqual(attempts, ['gemini', 'groq']);
    assert.deepEqual(result.versions, correct);
    assert.deepEqual(failures, [{id:'gemini', reason:'La IA no mantuvo el idioma del texto original.'}]);
  });
}

test('si el único proveedor cambia el idioma, no muestra sus versiones', async () => {
  await assert.rejects(reformulate({keys:{gemini:'fake'}, text:englishText,
    detectLanguage: async text => detected(text === englishText ? 'en' : 'es'),
    request: async () => ({versions})}), /no mantuvo el idioma/);
});

test('detecta el idioma incorrecto de versiones breves al comprobarlas juntas', async () => {
  const attempts = [];
  const result = await reformulate({keys:{gemini:'fake', groq:'fake'}, text:englishText,
    detectLanguage: async text => text === englishText ? detected('en')
      : text === versions.join('\n') ? detected('es')
      : {isReliable:false, languages:[]},
    request: async provider => {
      attempts.push(provider.id);
      return {versions:provider.id === 'gemini' ? versions : englishVersions};
    }});
  assert.deepEqual(attempts, ['gemini', 'groq']);
  assert.deepEqual(result.versions, englishVersions);
});

for (const detection of [undefined, {isReliable:false, languages:[{language:'es', percentage:100}]},
  {isReliable:true, languages:[{language:'en', percentage:55}, {language:'es', percentage:45}]}, detected('und')]) {
  test(`una detección no concluyente no impone un idioma: ${JSON.stringify(detection)}`, async () => {
    const result = await reformulate({keys:{gemini:'fake'}, text:englishText,
      detectLanguage: async () => { if (!detection) throw new Error('Unavailable'); return detection; },
      request: async (provider, key, text, signal, fetcher, target, source) => {
        assert.equal(source, '');
        return {versions:englishVersions};
      }});
    assert.deepEqual(result.versions, englishVersions);
  });
}

test('no rechaza serbio latino por confusión del detector con croata', async () => {
  const result = await reformulate({keys:{gemini:'fake'}, text:'Original',
    detectLanguage: async text => detected(text === 'Original' ? 'hr' : 'sr'),
    request: async () => ({versions:['Možeš izabrati više pasusa.', 'Izaberi nekoliko pasusa.', 'Označi par pasusa.']})});
  assert.equal(result.providerId, 'gemini');
});

test('cancelar durante la detección no llega a consultar al proveedor', async () => {
  const controller = new AbortController();
  await assert.rejects(reformulate({keys:{gemini:'fake'}, text:englishText, signal:controller.signal,
    detectLanguage: async () => { controller.abort(); return detected('en'); },
    request: async () => assert.fail('No debe consultar')}), {name:'AbortError'});
});
