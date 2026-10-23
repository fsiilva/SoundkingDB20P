"""Verifica responsividade: captura abas em larguras do iMac e de janelas menores,
e checa que não há rolagem horizontal da página (sem cortes)."""
import os, sys, threading, socketserver
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ui.server as server
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "screens_resp")
os.makedirs(OUT, exist_ok=True)
httpd = socketserver.TCPServer(("127.0.0.1", 0), server.Handler)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{port}"

sizes = [("imac_1920", 1920, 1080), ("janela_1280", 1280, 820),
         ("janela_1024", 1024, 760), ("estreita_760", 760, 900)]
views = ["overview", "channels", "eq", "dyn", "buses", "analyze"]
ok = True
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for name, w, h in sizes:
        pg = b.new_page(viewport={"width": w, "height": h})
        pg.goto(base, wait_until="networkidle")
        for v in views:
            pg.click(f'#tabs button[data-view="{v}"]'); pg.wait_for_timeout(200)
            # sem rolagem horizontal da página?
            over = pg.evaluate("document.documentElement.scrollWidth > window.innerWidth + 2")
            if over:
                ok = False; print(f"FALHA rolagem horizontal em {name}/{v}")
        pg.screenshot(path=os.path.join(OUT, f"{name}_overview.png"))
        pg.close()
    b.close()
httpd.shutdown()
print("Responsividade:", "SEM cortes horizontais" if ok else "HOUVE corte")
sys.exit(0 if ok else 1)
