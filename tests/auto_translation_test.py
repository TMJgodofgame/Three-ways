"""Prueba de la extensión real con perfil temporal y APIs simuladas.

Ejecutar: python tests/auto_translation_test.py
Requiere Playwright y su navegador Chromium.
"""
import json
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
TEXT = "Este proyecto ayuda a comprender textos complicados mientras navegas por una página web."


def check_until(check, message):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.05)
    raise AssertionError(message)


with sync_playwright() as p, tempfile.TemporaryDirectory(prefix="tres-formas-test-") as profile:
    context = p.chromium.launch_persistent_context(
        profile, channel="chromium", headless=True,
        args=[f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}"],
    )
    try:
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
        extension_id = worker.url.split("/")[2]
        check_until(lambda: (worker.evaluate('() => true') and any(page.url.endswith('/options.html') for page in context.pages)),
                    "No se completó la instalación de la extensión")
        worker.evaluate("""() => {
          globalThis.testRequests = [];
          globalThis.testFailTranslation = false;
          globalThis.fetch = async (url, options) => {
            const body = JSON.parse(options.body);
            const instruction = body.systemInstruction?.parts[0].text || body.messages[0].content;
            testRequests.push({url:String(url), body, instruction});
            const wrongLanguage = globalThis.testWrongLanguage && String(url).includes('googleapis');
            const result = {versions:(!wrongLanguage && globalThis.testLanguageVersions) || ['Una versión sencilla del texto.', 'Una explicación directa del texto.', 'El texto dicho de forma cotidiana.']};
            if (globalThis.testLiteralMarkup) result.versions[1] = '<em>Etiqueta de prueba</em>';
            if (instruction.includes('"translation"') && !(testFailTranslation && String(url).includes('googleapis'))) {
              result.translation = globalThis.testTranslation || (instruction.includes('ar-SA') ? 'نص مترجم' : 'Prevedeni tekst');
            }
            const content = JSON.stringify(result);
            return new Response(JSON.stringify(body.systemInstruction
              ? {candidates:[{content:{parts:[{text:content}]}}]}
              : {choices:[{message:{content}}]}));
          };
        }""")
        popup = context.new_page()
        popup.goto(f"chrome-extension://{extension_id}/popup.html")
        selector = popup.locator("#translation-language")
        expect(selector).to_be_enabled()
        expect(selector).to_have_value("")
        codes = selector.locator("option").evaluate_all("options => options.map(o => o.value)")
        assert codes[:6] == ["", "en-GB", "ar-SA", "sr-RS", "de-DE", "zh-CN"]
        assert len(codes) == len(set(codes)) == 151
        worker.evaluate("() => chrome.storage.local.set({enabled:true, freeConfirmed:true, keys:{gemini:'test-key',groq:'test-key'}})")
        assert popup.locator('#usage').count() == 0
        assert 'MyMemory' not in popup.inner_text('body')

        page = context.new_page()
        def fixture(route):
            if route.request.url.endswith('/privacidad'):
                body = '<p>Antes</p><div id="editor" contenteditable="true">Borrador de prueba</div><p>Después</p><input type="password" value="dato-ficticio">'
            elif route.request.url.endswith('/idioma'):
                body = f'<p id="sample">{language_text}</p>'
            elif route.request.url.endswith('/parrafos'):
                body = '<p id="start">Primer párrafo de la selección.</p><p>Segundo párrafo con <strong>varios elementos</strong>.</p><p id="end">Final del texto seleccionado.</p>'
            elif route.request.url.endswith('/cuestionario'):
                body = '''<form>
                  <p id="start">Una pregunta con varias opciones para reformular.</p>
                  <input type="hidden" value="dato-oculto-no-enviar">
                  <p><input id="radio" type="radio" name="opcion" value="valor-radio-no-enviar"><label for="radio">Primera opción</label></p>
                  <p><input type="RADIO" name="opcion"><span>Segunda opción</span></p>
                  <p><input id="checkbox" type="checkbox" value="valor-checkbox-no-enviar"><label for="checkbox">Otra opción</label></p>
                  <input type="button" value="Botón"><input type="submit" value="Enviar"><input type="reset" value="Restablecer">
                  <p id="end">Final del texto seleccionado.</p>
                </form>'''
            else:
                body = f'<p id="sample">{TEXT}</p>'
            route.fulfill(content_type="text/html; charset=utf-8",
                          body=f'<html lang="es"><head><title>Título privado de prueba</title></head><body>{body}</body></html>')
        context.route("https://tres-formas.test/**", fixture)
        cdp = context.new_cdp_session(page)

        def nodes():
            tree = cdp.send("DOM.getDocument", {"depth": -1, "pierce": True})["root"]
            result = []

            def visit(node):
                result.append(node)
                for child in node.get("children", []) + node.get("shadowRoots", []):
                    visit(child)
            visit(tree)
            return result

        def panel_text():
            return " ".join(node.get("nodeValue", "") for node in nodes())

        def select_text():
            page.goto("https://tres-formas.test/")
            # GET_STATE se resuelve antes de que el usuario seleccione texto.
            page.wait_for_timeout(200)
            page.locator('#sample').click(click_count=3)
            check_until(lambda: "Una versión sencilla del texto." in panel_text(), "Faltan las reformulaciones")

        def translations():
            return worker.evaluate("() => testRequests.filter(request => request.instruction.includes('\"translation\"'))")

        select_text()
        assert translations() == [], "Sin idioma no debe haber traducción automática"
        assert "Prevedeni tekst" not in panel_text()
        assert not any(node['nodeName'] == 'SELECT' for node in nodes())
        print("OK: predeterminado vacío y ninguna llamada automática")

        selector.select_option("sr-RS")
        expect(popup.locator("#language-status")).to_contain_text("Idioma guardado")
        popup.reload()
        expect(selector).to_have_value("sr-RS")
        select_text()
        check_until(lambda: "Prevedeni tekst" in panel_text(), "No aparece la traducción serbia")
        text = panel_text()
        assert text.index("El texto dicho de forma cotidiana.") < text.index("Prevedeni tekst")
        assert 'sr-RS' in translations()[-1]['instruction']
        assert json.loads(translations()[-1]['body']['contents'][0]['parts'][0]['text'])['text'] == TEXT
        assert len(translations()) == 1, 'La traducción debe venir en la misma consulta'
        print("OK: persistencia, tres versiones y traducción del original debajo")

        selector.select_option("ar-SA")
        expect(popup.locator("#language-status")).to_contain_text("Idioma guardado")
        select_text()
        check_until(lambda: "نص مترجم" in panel_text(), "No aparece la traducción árabe")
        assert any(node.get('attributes', []) == ['lang', 'ar-SA', 'dir', 'rtl'] for node in nodes())
        print("OK: traducción árabe de derecha a izquierda")

        worker.evaluate("() => { testFailTranslation = true; }")
        select_text()
        check_until(lambda: 'نص مترجم' in panel_text(), 'Falta la traducción del proveedor de respaldo')
        assert 'groq.com' in translations()[-1]['url']
        print("OK: una traducción incompleta activa el proveedor de respaldo")

        selector.select_option("")
        expect(popup.locator("#language-status")).to_contain_text("desactivada")
        before = len(translations())
        select_text()
        assert len(translations()) == before
        assert not any(node['nodeName'] == 'SELECT' for node in nodes())
        assert 'MyMemory' not in panel_text()
        assert all('mymemory' not in request['url'].lower() for request in worker.evaluate('() => testRequests'))
        print("OK: volver a ningún idioma desactiva las traducciones automáticas")

        worker.evaluate('() => { globalThis.testLiteralMarkup = true; }')
        select_text()
        assert '<em>Etiqueta de prueba</em>' in panel_text()
        assert not any(node['nodeName'] == 'EM' for node in nodes())
        requests = worker.evaluate('() => testRequests')
        for request in requests:
            body = request['body']
            content = body['contents'][0]['parts'][0]['text'] if 'contents' in body else body['messages'][-1]['content']
            assert json.loads(content) == {'text': TEXT}
            assert all(marker not in json.dumps(body) for marker in ['tres-formas.test', 'test-key', 'privado de prueba'])
        print('OK: texto de IA literal y peticiones sin URL, título ni claves en el cuerpo')

        # Regresión: una selección entre bloques puede atravesar controles de un formulario.
        for path, gesture in [('parrafos', 'mouse'), ('cuestionario', 'mouse'),
                              ('cuestionario', 'reverse'), ('cuestionario', 'radio'),
                              ('cuestionario', 'checkbox')]:
            page.goto(f'https://tres-formas.test/{path}')
            page.wait_for_timeout(200)
            before = len(worker.evaluate('() => testRequests'))
            if gesture in ('radio', 'checkbox'):
                page.locator(f'#{gesture}').focus()
                page.keyboard.press('Control+a')
            else:
                points = page.evaluate('''() => {
                  const first = document.querySelector('#start').firstChild;
                  const last = document.querySelector('#end').firstChild;
                  const range = document.createRange();
                  range.setStart(first, 0); range.setEnd(first, 1);
                  const start = range.getBoundingClientRect();
                  range.setStart(last, last.length - 1); range.setEnd(last, last.length);
                  const end = range.getBoundingClientRect();
                  return [[start.left, start.top + start.height / 2], [end.right, end.top + end.height / 2]];
                }''')
                if gesture == 'reverse':
                    points.reverse()
                page.mouse.move(*points[0])
                page.mouse.down()
                page.mouse.move(*points[1], steps=12)
                page.mouse.up()
            selected = page.evaluate('getSelection().toString().trim()')
            assert 'Final del texto seleccionado.' in selected
            if path == 'cuestionario':
                assert all(text in selected for text in ['Una pregunta', 'Primera opción', 'Segunda opción', 'Otra opción'])
            else:
                assert 'Primer párrafo' in selected and 'Segundo párrafo' in selected
            check_until(lambda: len(worker.evaluate('() => testRequests')) > before,
                        f'No se procesó la selección: {path}/{gesture}')
            check_until(lambda: 'Una versión sencilla del texto.' in panel_text(), 'Falta el panel de resultados')
            sent = worker.evaluate('''() => {
              const body = testRequests.at(-1).body;
              return JSON.parse(body.contents?.[0].parts[0].text || body.messages.at(-1).content).text;
            }''')
            assert sent == selected, 'Se debe enviar todo el texto seleccionado'
            assert 'no-enviar' not in sent, 'No se deben extraer valores de controles'
            assert len(worker.evaluate('() => testRequests')) == before + 1
            print(f'OK: selección completa {path}/{gesture}')

        samples = [
            ('ingles', 'You can select several paragraphs on a web page to understand their meaning more easily without changing the original information.', [
                'Select several paragraphs on a web page to understand them more easily while keeping the original information.',
                'Highlight multiple paragraphs on a web page for a clearer version that preserves their original meaning.',
                'You can highlight a few paragraphs on a website to make them easier to understand without changing what they say.']),
            ('serbio-latino', 'Možete da izaberete nekoliko pasusa na veb stranici kako biste lakše razumeli njihovo značenje bez promene izvornih informacija.', [
                'Izaberite nekoliko pasusa na veb stranici da biste ih lakše razumeli, uz očuvanje izvornih informacija.',
                'Označite više pasusa na veb stranici i lakše shvatite njihovo značenje bez menjanja informacija.',
                'Možete da označite par pasusa na sajtu kako biste lakše razumeli šta piše, a da informacije ostanu iste.']),
            ('serbio-cirilico', 'Можете да изаберете неколико пасуса на веб страници како бисте лакше разумели њихово значење без промене изворних информација.', [
                'Изаберите неколико пасуса на веб страници да бисте их лакше разумели, уз очување изворних информација.',
                'Означите више пасуса на веб страници и лакше схватите њихово значење без мењања информација.',
                'Можете да означите пар пасуса на сајту како бисте лакше разумели шта пише, а да информације остану исте.'])
        ]
        for name, language_text, expected_versions in samples:
            for target in ('', 'es-ES'):
                selector.select_option(target)
                wrong_language = name == 'ingles' and bool(target)
                worker.evaluate('''async ({versions, wrong}) => {
                  globalThis.testLiteralMarkup = false;
                  globalThis.testFailTranslation = false;
                  globalThis.testLanguageVersions = versions;
                  globalThis.testWrongLanguage = wrong;
                  globalThis.testTranslation = 'Puedes seleccionar varios párrafos de una página web para comprenderlos mejor.';
                  await chrome.storage.session.remove('cooldowns');
                }''', {'versions': expected_versions, 'wrong': wrong_language})
                before = len(worker.evaluate('() => testRequests'))
                page.goto('https://tres-formas.test/idioma')
                page.wait_for_timeout(200)
                page.locator('#sample').click(click_count=3)
                try:
                    check_until(lambda: all(version in panel_text() for version in expected_versions),
                                f'No se conservaron las versiones en {name}, traducción={target}')
                except AssertionError as error:
                    detection = worker.evaluate('text => chrome.i18n.detectLanguage(text)', language_text)
                    raise AssertionError(f'{error}; detección={detection}; panel={panel_text()}') from error
                sent = worker.evaluate('() => testRequests')
                assert len(sent) == before + (2 if wrong_language else 1)
                if wrong_language:
                    assert 'groq.com' in sent[-1]['url']
                    assert 'Una versión sencilla del texto.' not in panel_text()
                if target:
                    assert 'Puedes seleccionar varios párrafos' in panel_text()
                else:
                    assert 'Puedes seleccionar varios párrafos' not in panel_text()
                print(f'OK: idioma original {name}, traducción={target or "ninguna"}, respaldo={wrong_language}')
        selector.select_option('')
        worker.evaluate('''() => {
          delete globalThis.testLanguageVersions;
          delete globalThis.testTranslation;
          globalThis.testWrongLanguage = false;
        }''')
        requests = worker.evaluate('() => testRequests')

        page.goto('https://tres-formas.test/privacidad')
        page.wait_for_timeout(200)
        page.locator('#editor').click(click_count=3)
        page.wait_for_timeout(650)
        assert len(worker.evaluate('() => testRequests')) == len(requests)
        page.locator('input').press('Control+a')
        page.wait_for_timeout(650)
        assert len(worker.evaluate('() => testRequests')) == len(requests)
        page.get_by_text('Antes', exact=True).click()
        page.keyboard.press('Control+a')
        assert 'Borrador de prueba' in page.evaluate('getSelection().toString()')
        page.wait_for_timeout(650)
        assert len(worker.evaluate('() => testRequests')) == len(requests)
        print('OK: sin peticiones desde contraseña, editor ni selección que cruce el editor')

        # Un contexto de contenido debe carecer de acceso incluso a un ajuste inocuo.
        worlds = []
        cdp.on('Runtime.executionContextCreated', lambda event: worlds.append(event['context']))
        cdp.send('Runtime.enable')
        isolated = next(world for world in worlds if world['origin'] == f'chrome-extension://{extension_id}')
        def in_content(expression):
            reply = cdp.send('Runtime.evaluate', {'contextId': isolated['id'], 'expression': expression,
                                                  'awaitPromise': True, 'returnByValue': True})
            assert 'exceptionDetails' not in reply, reply.get('exceptionDetails')
            return reply['result'].get('value')
        assert in_content('''(async () => {
          try { await chrome.storage.local.get('enabled'); return false; } catch { return true; }
        })()''')
        state = in_content("chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert state['enabled'] and set(state) == {'enabled', 'configured', 'translationLanguage'}
        assert 'error' in in_content("chrome.runtime.sendMessage({type:'RESET_COOLDOWNS'})")
        assert worker.evaluate('''async text => {
          const data = await chrome.storage.local.get(null);
          return !JSON.stringify(data).includes(text) && !JSON.stringify(data).includes('Etiqueta de prueba');
        }''', TEXT)
        print('OK: almacén local restringido, estado sin claves y acción de ajustes denegada al script de página')

        popup.locator('#toggle').click()
        expect(popup.locator('#toggle')).to_have_attribute('aria-checked', 'false')
        page.goto('https://tres-formas.test/')
        page.wait_for_timeout(200)
        page.locator('#sample').click(click_count=3)
        page.wait_for_timeout(650)
        assert len(worker.evaluate('() => testRequests')) == len(requests)
        assert 'Etiqueta de prueba' not in panel_text()
        popup.locator('#toggle').click()
        expect(popup.locator('#toggle')).to_have_attribute('aria-checked', 'true')
        select_text()
        print('OK: apagar la extensión impide enviar selecciones')
        popup.screenshot(path=str(Path(tempfile.gettempdir()) / "tres-formas-popup.png"))
        exceptions = []
        cdp.send('Runtime.enable')
        cdp.on('Runtime.exceptionThrown', lambda event: exceptions.append(event))
        page.on('pageerror', lambda error: exceptions.append(str(error)))
        worker.evaluate('() => { setTimeout(() => chrome.runtime.reload(), 0); }')
        page.wait_for_timeout(500)
        page.keyboard.press('Escape')
        page.evaluate("""() => {
          window.dispatchEvent(new Event('pagehide'));
          document.querySelector('#sample').dispatchEvent(new PointerEvent('pointerup', {bubbles:true}));
          window.dispatchEvent(new Event('pagehide'));
        }""")
        page.wait_for_timeout(600)
        assert exceptions == [], f'Errores tras recargar la extensión: {exceptions}'
        assert 'Una versión sencilla del texto.' not in panel_text()
        print('OK: recargar la extensión con una pestaña abierta no deja errores sin capturar')
    finally:
        context.close()
