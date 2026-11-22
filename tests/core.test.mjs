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
