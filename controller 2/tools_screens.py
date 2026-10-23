"""Gera screenshots da UI (demo) com Playwright/Chromium já presentes no ambiente.
Sobe o servidor local, navega pelas abas e salva PNGs. Não instala nada."""
import os, sys, threading, socketserver, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ui.server as server
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "screens")
os.makedirs(OUT, exist_ok=True)

httpd = socketserver.TCPServer(("127.0.0.1", 0), server.Handler)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{port}"

tabs = [("overview", "Visão geral"), ("channels", "Canais"), ("eq", "Equalizador"),
        ("dyn", "Dinâmica"), ("buses", "Buses / Saídas"),
        ("analyze", "Análise de frequência"), ("settings", "Config / Diagnóstico")]

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    pg = b.new_page(viewport={"width": 1180, "height": 820}, device_scale_factor=2)
    for mode in ("simple", "pro"):
        pg.goto(base, wait_until="networkidle")
        if mode == "pro":
            pg.click('#modes button[data-mode="pro"]')
        for key, label in tabs:
            pg.click(f'#tabs button[data-view="{key}"]')
            pg.wait_for_timeout(350)
            pg.screenshot(path=os.path.join(OUT, f"{mode}_{key}.png"))
    b.close()
httpd.shutdown()
print("screens em", OUT)
for f in sorted(os.listdir(OUT)):
    print(" ", f)
