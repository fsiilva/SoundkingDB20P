"""Teste de INTERAÇÃO real da UI com Playwright: verifica que o EQ atualiza a
curva sem recriar elementos, que o fader muda o valor, e que mute/demo funcionam.
Não toca a mesa (servidor local em loopback)."""
import os, sys, threading, socketserver
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ui.server as server
from playwright.sync_api import sync_playwright

httpd = socketserver.TCPServer(("127.0.0.1", 0), server.Handler)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{port}"
ok = True
def check(name, cond):
    global ok; ok = ok and cond; print(("PASS" if cond else "FALHA"), name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"]); pg = b.new_page(viewport={"width":1280,"height":860})
    pg.goto(base, wait_until="networkidle")

    # EQ: identidade do elemento path não muda ao mexer no slider (não recria)
    pg.click('#tabs button[data-view="eq"]'); pg.wait_for_timeout(200)
    pg.evaluate("window.__p0 = document.getElementById('eqpath')")
    d_before = pg.get_attribute('#eqpath','d')
    sl = pg.query_selector('#eq input[data-eq="low"][data-k="gain"]')
    sl.evaluate("el=>{el.value=10; el.dispatchEvent(new Event('input',{bubbles:true}))}")
    pg.wait_for_timeout(120)
    same_node = pg.evaluate("window.__p0 === document.getElementById('eqpath')")
    d_after = pg.get_attribute('#eqpath','d')
    out_val = pg.text_content('[data-out="low-gain"]')
    check("EQ: path é o MESMO elemento (não recriado)", same_node)
    check("EQ: curva (d) mudou ao ajustar ganho", d_before != d_after)
    check("EQ: valor do ganho atualizou", "10" in (out_val or ""))

    # Canais: fader muda o valor exibido
    pg.click('#tabs button[data-view="channels"]'); pg.wait_for_timeout(200)
    v0 = pg.text_content('.strip[data-i="0"] .val.big')
    f = pg.query_selector('.strip[data-i="0"] .fader')
    box = f.bounding_box()
    pg.mouse.move(box["x"]+box["width"]/2, box["y"]+8); pg.mouse.down()
    pg.mouse.move(box["x"]+box["width"]/2, box["y"]+box["height"]-8); pg.mouse.up()
    pg.wait_for_timeout(120)
    v1 = pg.text_content('.strip[data-i="0"] .val.big')
    check("Canal: fader altera o valor", v0 != v1)

    # navegação próximo
    pg.click('.navbtn[data-nav="1"]'); pg.wait_for_timeout(120)
    sel = pg.query_selector('.strip.sel')
    check("Canal: navegação seleciona outro canal", sel is not None and sel.get_attribute("data-i")=="1")

    # mute via demo (não vai à mesa — servidor responde demo)
    pg.click('.strip[data-i="1"] [data-act="mute"]'); pg.wait_for_timeout(120)
    muted = pg.query_selector('.strip[data-i="1"] .btn.mute.on')
    check("Canal: MUTE marca estado (demo)", muted is not None)

    b.close()
httpd.shutdown()
print("RESULTADO:", "TODAS PASSARAM" if ok else "HOUVE FALHA")
sys.exit(0 if ok else 1)
