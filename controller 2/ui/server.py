"""Servidor local da interface (somente leitura / demonstração).

Biblioteca padrão apenas (http.server) — sem dependências, compatível com Intel.
NESTA FASE nada alcança a mesa: allow_network=False fixo; comandos de escrita
retornam 403; os "ajustes" da UI acontecem só no estado em memória (demo).

Endpoints (todos GET, exceto onde indicado):
  /                -> página (index.html + app.js + style.css)
  /api/state       -> estado SIMULADO atual (ui/state_model)
  /api/meta        -> metadados: schema checks, framing confirmado, flags
  /api/eqcurve?... -> curva de EQ (matemática real) para bandas passadas
  /api/spectrum    -> espectro SIMULADO (rotulado)
  /api/suggest?obj -> sugestões consultivas de EQ
  POST /api/command-> SEMPRE 403 (escrita desativada)
  POST /api/demo-set -> aplica ajuste SÓ no estado em memória (demo; não vai à mesa)
"""
import http.server, socketserver, json, os, sys, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import ui.state_model as state_model
from skdmc import analyzer

PORT = int(os.environ.get("DB20P_UI_PORT", "8777"))
WRITE_ENABLED = False          # trava de ESCRITA: nenhum comando vai à mesa (fixo)
ALLOW_NETWORK = False          # espelha a trava de escrita do controlador

# LEITURA é separada da escrita e desativada por padrão. Habilite explicitamente
# no iMac com a variável de ambiente, sem nunca liberar a escrita:
#   DB20P_ALLOW_READ=1  DB20P_HOST=192.168.18.162  python3 ui/server.py
ALLOW_READ = os.environ.get("DB20P_ALLOW_READ", "0") in ("1", "true", "yes")
MESA_HOST = os.environ.get("DB20P_HOST", "192.168.18.162")
MESA_PORT = int(os.environ.get("DB20P_PORT", "6400"))

# estado em memória (demo). Reconstruído do modelo; ajustes da UI ficam aqui.
STATE = state_model.build_state()


def _json(h, obj, code=200):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    h.send_response(code)
    h.send_header("Content-Type", "application/json; charset=utf-8")
    h.send_header("Content-Length", str(len(data)))
    h.end_headers()
    h.wfile.write(data)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, *a):  # silencioso
        pass

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/api/state":
            return _json(self, STATE)
        if u.path == "/api/meta":
            return _json(self, {
                "schema_checks": state_model.validate_against_schema(),
                "confirmado": {"tcp_port": 6400, "host_padrao": "192.168.43.1",
                                "sync": "0x5A", "cmd_id": "int32 big-endian"},
                "flags": {"write_enabled": WRITE_ENABLED, "allow_network": ALLOW_NETWORK,
                           "allow_read": ALLOW_READ, "meters_simulados": STATE.get("_meters_simulados", True)},
                "mesa": {"host": MESA_HOST, "port": MESA_PORT},
                "aviso": ("Leitura real " + ("HABILITADA" if ALLOW_READ else "desativada")
                          + "; escrita sempre bloqueada."),
            })
        if u.path == "/api/spectrum":
            seed = int(q.get("seed", ["0"])[0])
            return _json(self, analyzer.simulated_spectrum(seed=seed))
        if u.path == "/api/suggest":
            obj = q.get("obj", [None])[0]
            spec = analyzer.simulated_spectrum(seed=int(q.get("seed", ["0"])[0]))
            return _json(self, analyzer.suggestions(spec["pontos"], objetivo=obj))
        if u.path == "/api/eqcurve":
            try:
                bands = json.loads(q.get("bands", ["[]"])[0])
            except Exception:
                bands = []
            return _json(self, {"curve": analyzer.eq_curve(bands) if bands else []})
        if u.path == "/api/read-snapshot":
            # LEITURA real da mesa (separada da escrita; escrita segue bloqueada).
            if not ALLOW_READ:
                return _json(self, {"ok": False, "modo": "demo",
                    "reason": "Leitura real desativada. Habilite com DB20P_ALLOW_READ=1 "
                              "(a escrita continua bloqueada)."}, code=403)
            host = q.get("host", [MESA_HOST])[0]
            try:
                from skdmc import reader
                snap, chs = reader.read_snapshot_live(host, MESA_PORT, timeout=4.0,
                                                      allow_read=True)
                return _json(self, {"ok": True, "fonte": "mesa", "host": host,
                                     "canais": chs, "_simulado": False})
            except reader.ReadLock as e:
                return _json(self, {"ok": False, "reason": str(e)}, code=403)
            except ConnectionError as e:
                return _json(self, {"ok": False, "reason": str(e)}, code=502)
            except Exception as e:
                return _json(self, {"ok": False, "reason": f"erro ao decodificar: {e}"}, code=500)
        return super().do_GET()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else b""
        if u.path == "/api/read-snapshot":
            # LEITURA real (separada da escrita; escrita segue bloqueada).
            if not ALLOW_READ:
                return _json(self, {"ok": False, "modo": "demo",
                    "reason": "Leitura real desativada. Habilite com DB20P_ALLOW_READ=1 "
                              "(a escrita continua bloqueada)."}, code=403)
            try:
                p = json.loads(body or b"{}")
            except Exception:
                p = {}
            host = p.get("host", MESA_HOST)
            try:
                from skdmc import reader
                snap, chs = reader.read_snapshot_live(host, MESA_PORT, timeout=4.0, allow_read=True)
                return _json(self, {"ok": True, "fonte": "mesa", "host": host,
                                     "canais": chs, "_simulado": False})
            except reader.ReadLock as e:
                return _json(self, {"ok": False, "reason": str(e)}, code=403)
            except ConnectionError as e:
                return _json(self, {"ok": False, "reason": str(e)}, code=502)
            except Exception as e:
                return _json(self, {"ok": False, "reason": f"erro ao decodificar: {e}"}, code=500)
        if u.path == "/api/command":
            return _json(self, {"ok": False,
                "reason": "Escrita à mesa DESATIVADA nesta fase (allow_network=False). "
                          "Nenhum comando é enviado ao equipamento."}, code=403)
        if u.path == "/api/demo-set":
            # ajuste SÓ no estado em memória (demonstração) — não vai à mesa
            try:
                p = json.loads(body or b"{}")
                _apply_demo(p)
                return _json(self, {"ok": True, "demo": True,
                    "nota": "Ajuste aplicado apenas no estado simulado (não foi à mesa)."})
            except Exception as e:
                return _json(self, {"ok": False, "erro": str(e)}, code=400)
        return _json(self, {"ok": False}, code=404)


def _apply_demo(p):
    """Aplica no STATE em memória. Suporta: fader/mute/solo/pan de canal, bandas
    de EQ, gate/comp. Só demonstração."""
    t = p.get("target"); idx = p.get("index"); field = p.get("field"); val = p.get("value")
    if t == "channel" and isinstance(idx, int) and 0 <= idx < len(STATE["channels"]):
        ch = STATE["channels"][idx]
        if field in ("fader", "mute", "solo", "pan"):
            ch[field] = val
        elif field == "eq" and isinstance(val, dict):
            band = val.get("band")
            if band in ch["eq"]:
                for k in ("fc", "gain", "q", "bypass"):
                    if k in val:
                        ch["eq"][band][k] = val[k]
    elif t == "master" and field in ("faderL", "faderR", "mute", "hpf"):
        STATE["master"][field] = val
    elif t == "bus" and isinstance(idx, int) and 0 <= idx < len(STATE["buses"]):
        if field in ("fader", "mute"):
            STATE["buses"][idx][field] = val


if __name__ == "__main__":
    os.chdir(HERE)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"UI (demonstração) em http://127.0.0.1:{PORT}  — Ctrl+C para parar")
        print(f"Escrita à mesa: {'LIGADA' if WRITE_ENABLED else 'DESATIVADA'} | "
              f"Rede: {'LIGADA' if ALLOW_NETWORK else 'DESATIVADA'}")
        httpd.serve_forever()
