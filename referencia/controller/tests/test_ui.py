"""Testes da camada de UI: modelo de estado (dirigido pelo esquema real) e os
endpoints do servidor (somente leitura; escrita à mesa bloqueada).
Sobe o servidor numa porta efêmera em 127.0.0.1 (loopback local — NÃO é a mesa)."""
import os, sys, json, unittest, threading, http.server, socketserver, urllib.request
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ui.state_model as state_model
import ui.server as server


class TestStateModel(unittest.TestCase):
    def test_schema_checks_pass(self):
        self.assertTrue(all(state_model.validate_against_schema().values()))

    def test_state_structure(self):
        st = state_model.build_state()
        self.assertTrue(st["_simulado"])
        self.assertEqual(len(st["channels"]), 16)   # Ch1-12 + ST1,ST2,PDIF,USB (observado)
        self.assertEqual(len(st["buses"]), 8)        # Bus1-8 (observado)
        self.assertFalse(st["connection"]["allow_network"])
        ch = st["channels"][0]
        for k in ("fader", "mute", "solo", "pan", "eq", "dyn"):
            self.assertIn(k, ch)
        self.assertEqual(set(ch["eq"].keys()), {"low", "lowMid", "highMid", "high"})

    def test_dyn_fields_match_schema(self):
        # os campos de dinâmica usados devem existir no descritor (nada inventado)
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from skdmc import messages
        dynf = [f.name for f in messages.get_message_class("MicInDynamicPartModel").DESCRIPTOR.fields]
        for schema_name in ["gateThresholdValue", "gateAttackValue", "gateReleaseValue",
                            "gateHoldValue", "gateDepthValue", "compressorTresholdValue",
                            "compressorAttackValue", "compressorReleaseValue",
                            "compressorGainValue", "compressorRatioValue"]:
            self.assertIn(schema_name, dynf)
        ch = state_model.build_state()["channels"][0]
        self.assertEqual(set(ch["dyn"]["gate"]) - {"enabled"},
                         {"threshold", "attack", "release", "hold", "depth"})
        self.assertEqual(set(ch["dyn"]["comp"]) - {"enabled"},
                         {"threshold", "ratio", "attack", "release", "gain"})


class TestServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = socketserver.TCPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.t = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.t.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close()

    def _get(self, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}") as r:
            return r.getcode(), json.loads(r.read())

    def _post(self, path, obj):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}",
                                     data=json.dumps(obj).encode(), method="POST")
        try:
            with urllib.request.urlopen(req) as r:
                return r.getcode(), json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_state_endpoint(self):
        code, s = self._get("/api/state")
        self.assertEqual(code, 200)
        self.assertTrue(s["_simulado"])

    def test_meta_flags_locked(self):
        _, m = self._get("/api/meta")
        self.assertFalse(m["flags"]["allow_network"])
        self.assertFalse(m["flags"]["write_enabled"])

    def test_command_is_forbidden(self):
        code, body = self._post("/api/command", {"anything": 1})
        self.assertEqual(code, 403)
        self.assertFalse(body["ok"])

    def test_demo_set_is_memory_only(self):
        code, body = self._post("/api/demo-set",
                                {"target": "channel", "index": 0, "field": "mute", "value": True})
        self.assertEqual(code, 200)
        self.assertTrue(body["demo"])
        # confirma que mudou só no estado em memória
        _, s = self._get("/api/state")
        self.assertTrue(s["channels"][0]["mute"])

    def test_suggest_endpoint(self):
        _, s = self._get("/api/suggest?obj=reduzir_graves")
        self.assertIn("sugestoes", s)

    def test_eqcurve_endpoint(self):
        bands = json.dumps([{"fc": 100, "gain": 6, "q": 1.0}])
        _, s = self._get("/api/eqcurve?bands=" + urllib.parse.quote(bands))
        self.assertTrue(len(s["curve"]) > 10)


if __name__ == "__main__":
    import urllib.parse  # noqa
    unittest.main()
