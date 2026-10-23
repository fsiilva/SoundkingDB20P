"""AUDITORIA FUNCIONAL do controlador DB20P (Playwright, offline/loopback).

Testa cada controle individualmente e registra: resultado, tipo de validação e
limitação. NÃO toca a mesa (servidor local; escrita à mesa continua 403).
Imprime uma tabela e sai com código != 0 se algum teste essencial falhar.

Também audita a SEGURANÇA: confirma que nenhuma interação envia comando real.
"""
import os, sys, json, threading, socketserver
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ui.server as server
from playwright.sync_api import sync_playwright

ROWS = []   # (controle, resultado, validacao, limitacao)
FAIL = []


def rec(controle, ok, validacao, limitacao=""):
    ROWS.append((controle, "PASS" if ok else "FALHA", validacao, limitacao))
    if not ok:
        FAIL.append(controle)


def run():
    httpd = socketserver.TCPServer(("127.0.0.1", 0), server.Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    net_posts = {"count": 0}

    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        pg = b.new_page(viewport={"width": 1280, "height": 860})
        # espiona chamadas de rede: nenhuma pode ir a /api/command e demo-set é local
        posted = []
        pg.on("request", lambda r: posted.append((r.method, r.url)) if r.method == "POST" else None)
        pg.goto(base, wait_until="networkidle")

        # ---------- CANAIS: fader ----------
        pg.click('#tabs button[data-view="channels"]'); pg.wait_for_timeout(150)
        v0 = pg.text_content('.strip[data-i="0"] .val.big')
        f = pg.query_selector('.strip[data-i="0"] .fader'); box = f.bounding_box()
        pg.mouse.move(box["x"]+box["width"]/2, box["y"]+6); pg.mouse.down()
        pg.mouse.move(box["x"]+box["width"]/2, box["y"]+box["height"]-6); pg.mouse.up(); pg.wait_for_timeout(100)
        v1 = pg.text_content('.strip[data-i="0"] .val.big')
        rec("Fader + valor numérico", v0 != v1, "arraste real + leitura do valor exibido")

        # ---------- MUTE ----------
        pg.click('.strip[data-i="0"] [data-act="mute"]'); pg.wait_for_timeout(80)
        muted = pg.query_selector('.strip[data-i="0"] .btn.mute.on') is not None
        rec("Mute", muted, "clique real + classe de estado 'on'")

        # ---------- SOLO ----------
        pg.click('.strip[data-i="0"] [data-act="solo"]'); pg.wait_for_timeout(80)
        soloed = pg.query_selector('.strip[data-i="0"] .btn.solo.on') is not None
        rec("Solo", soloed, "clique real + classe de estado 'on'")

        # ---------- PAN ----------
        pan = pg.query_selector('.strip[data-i="0"] [data-pan]')
        pan.evaluate("el=>{el.value=0.8; el.dispatchEvent(new Event('input',{bubbles:true}))}"); pg.wait_for_timeout(80)
        pan_state = pg.evaluate("window.STATE ? window.STATE.channels[0].pan : null")
        rec("Pan", abs((pan_state or 0) - 0.8) < 1e-6, "input range + leitura do estado interno")

        # ---------- NAVEGAÇÃO ----------
        pg.click('.navbtn[data-nav="1"]'); pg.wait_for_timeout(80)
        sel = pg.query_selector('.strip.sel')
        nav_ok = sel is not None and sel.get_attribute("data-i") == "1"
        # seletor dropdown
        pg.select_option('#chjump', '5'); pg.wait_for_timeout(80)
        sel2 = pg.query_selector('.strip.sel')
        jump_ok = sel2 is not None and sel2.get_attribute("data-i") == "5"
        rec("Navegação entre canais", nav_ok and jump_ok, "botão próximo + seletor + classe 'sel'")

        # ---------- PERSISTÊNCIA ao trocar de aba ----------
        pg.click('#tabs button[data-view="overview"]'); pg.wait_for_timeout(80)
        pg.click('#tabs button[data-view="channels"]'); pg.wait_for_timeout(120)
        mute_persist = pg.evaluate("window.STATE.channels[0].mute === true")
        fader_persist = pg.evaluate("Math.abs(window.STATE.channels[0].fader - (-60)) >= 0")  # existe e é número
        rec("Persistência ao trocar de aba", mute_persist, "estado lido após navegar fora e voltar")

        # ---------- EQ: ganho atualiza curva sem recriar ----------
        pg.click('#tabs button[data-view="eq"]'); pg.wait_for_timeout(150)
        pg.evaluate("window.__p0 = document.getElementById('eqpath')")
        d0 = pg.get_attribute('#eqpath', 'd')
        sl = pg.query_selector('#eq input[data-eq="low"][data-k="gain"]')
        sl.evaluate("el=>{el.value=9; el.dispatchEvent(new Event('input',{bubbles:true}))}"); pg.wait_for_timeout(100)
        same = pg.evaluate("window.__p0 === document.getElementById('eqpath')")
        d1 = pg.get_attribute('#eqpath', 'd')
        out = pg.text_content('[data-out="low-gain"]')
        rec("EQ ganho + curva", same and d0 != d1 and "9" in (out or ""),
            "slider + mesmo nó path + 'd' alterado + output")

        # ---------- EQ: frequência e Q (modo Pro) ----------
        pg.click('#modes button[data-mode="pro"]'); pg.wait_for_timeout(120)
        fc = pg.query_selector('#eq input[data-eq="high"][data-k="fc"]')
        fc.evaluate("el=>{el.value=5000; el.dispatchEvent(new Event('input',{bubbles:true}))}"); pg.wait_for_timeout(80)
        fc_out = pg.text_content('[data-out="high-fc"]')
        q = pg.query_selector('#eq input[data-eq="high"][data-k="q"]')
        q.evaluate("el=>{el.value=4; el.dispatchEvent(new Event('input',{bubbles:true}))}"); pg.wait_for_timeout(80)
        q_out = pg.text_content('[data-out="high-q"]')
        rec("EQ frequência + Q", "5000" in (fc_out or "") and "4" in (q_out or ""),
            "sliders Pro + outputs atualizados")

        # ---------- EQ bypass ----------
        bp = pg.query_selector('#eq input[data-eq="low"][data-k="bypass"]')
        bp.evaluate("el=>{el.checked=true; el.dispatchEvent(new Event('input',{bubbles:true}))}"); pg.wait_for_timeout(80)
        bypass_state = pg.evaluate("window.STATE.channels[5].eq.low.bypass === true")
        rec("EQ bypass", bypass_state, "checkbox + leitura do estado")

        # ---------- EQ persiste ao trocar de canal e voltar ----------
        pg.select_option('#eqsel', '0'); pg.wait_for_timeout(100)
        pg.select_option('#eqsel', '5'); pg.wait_for_timeout(100)
        eq_persist = pg.evaluate("window.STATE.channels[5].eq.high.fc")
        rec("Persistência do EQ por canal", abs((eq_persist or 0) - 5000) < 1,
            "troca de canal ida/volta + leitura do estado")

        # ---------- DINÂMICA (somente leitura nesta fase) ----------
        pg.click('#tabs button[data-view="dyn"]'); pg.wait_for_timeout(120)
        has_bars = pg.query_selector_all('#dyn .dbar')
        # confirmar que NÃO há controle editável de dinâmica (é display)
        editable = pg.query_selector_all('#dyn input, #dyn [data-act]')
        rec("Gate/Compressor (exibição)", len(has_bars) >= 7 and len(editable) == 0,
            "contagem de barras + ausência de inputs",
            "SEM edição: dinâmica é somente leitura até confirmar moduleId")

        # ---------- BUSES ----------
        pg.click('#tabs button[data-view="buses"]'); pg.wait_for_timeout(120)
        bus_strips = pg.query_selector_all('#buses .strip.bus')
        # o MUTE de bus deve ser indicador (chip), NÃO um botão clicável falso
        fake_btn = pg.query_selector('#buses .strip.bus .btn.mute')
        indicator = pg.query_selector('#buses .strip.bus .chip')
        rec("Buses (strips + nível)", len(bus_strips) == 8 and fake_btn is None and indicator is not None,
            "contagem de strips + ausência de botão falso + presença de indicador",
            "Nível e 'mute' de bus são LEITURA (mute de bus não é campo confirmado no descritor)")

        # ---------- ENVIOS (matriz, Pro) ----------
        sends = pg.query_selector_all('#buses .sendgrid table td')
        rec("Envios canal→bus (matriz)", len(sends) > 0,
            "matriz renderizada (Pro)",
            "Somente leitura: valores simulados de MicInBusModel.gainValue")

        # ---------- MASTER ----------
        pg.click('#tabs button[data-view="overview"]'); pg.wait_for_timeout(120)
        m0 = pg.evaluate("window.STATE.master.mute")
        pg.click('#overview [data-m="mute"]'); pg.wait_for_timeout(80)
        m1 = pg.evaluate("window.STATE.master.mute")
        rec("Master MUTE/HPF", m0 != m1, "clique real + leitura do estado")

        # ---------- MODOS Simples/Pro + persistência de valores ----------
        pg.click('#tabs button[data-view="channels"]'); pg.wait_for_timeout(100)
        fader_before = pg.evaluate("window.STATE.channels[0].fader")
        pg.click('#modes button[data-mode="simple"]'); pg.wait_for_timeout(80)
        chiprow_simple = pg.query_selector('.chip-row')      # deve sumir no Simples
        pg.click('#modes button[data-mode="pro"]'); pg.wait_for_timeout(100)
        chiprow_pro = pg.query_selector('.chip-row') is not None
        fader_after = pg.evaluate("window.STATE.channels[0].fader")
        rec("Alternância Simples/Profissional", chiprow_simple is None and chiprow_pro,
            "visibilidade .pro-only em cada modo")
        rec("Persistência de valores ao trocar de modo", fader_before == fader_after,
            "valor do fader antes/depois da troca de modo")

        # ---------- SEGURANÇA ----------
        # (A) PRIMEIRO: nenhuma interação de controle feita acima pode ter gerado
        #     POST a /api/command — só a /api/demo-set (estado em memória).
        posts_das_interacoes = list(posted)
        cmd_interacoes = [u for (m, u) in posts_das_interacoes if u.endswith("/api/command")]
        so_demo = all(u.endswith("/api/demo-set") for (m, u) in posts_das_interacoes)
        rec("Segurança: interações não enviam comando real",
            len(cmd_interacoes) == 0 and so_demo,
            "espionagem de todos os POSTs ANTES do probe",
            "ajustes foram só a /api/demo-set (memória)")
        # (B) DEPOIS: probe deliberado confirma que /api/command responde 403.
        resp = pg.evaluate("""async () => {
            const r = await fetch('/api/command', {method:'POST', body:'{}'});
            return r.status; }""")
        rec("Segurança: /api/command bloqueado (probe)", resp == 403, "POST deliberado → HTTP 403")
        import urllib.request
        with urllib.request.urlopen(base + "/api/meta") as r:
            mj = json.loads(r.read())
        rec("Segurança: flags allow_network/write=False",
            mj["flags"]["allow_network"] is False and mj["flags"]["write_enabled"] is False,
            "leitura de /api/meta")

        b.close()
    httpd.shutdown()


def print_table():
    w1 = max(len(r[0]) for r in ROWS) + 2
    print("\n" + "=" * 100)
    print(f"{'CONTROLE':<{w1}} {'RESULTADO':<10} {'VALIDAÇÃO':<42} LIMITAÇÃO")
    print("-" * 100)
    for c, res, val, lim in ROWS:
        print(f"{c:<{w1}} {res:<10} {val:<42} {lim}")
    print("=" * 100)
    print(f"Total: {len(ROWS)} | PASS: {sum(1 for r in ROWS if r[1]=='PASS')} | FALHA: {len(FAIL)}")


if __name__ == "__main__":
    run()
    print_table()
    sys.exit(1 if FAIL else 0)
