"""Testes do fluxo ÚNICO de diagnóstico (skdmc.diagnose) com captura SINTÉTICA.
Validam a orquestração, não o protocolo real da mesa."""
import os, sys, json, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skdmc import diagnose, config
import pcap_fixtures


class TestDiagnose(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.pcap = os.path.join(cls.tmp, "syn.pcap")
        cls.cfg = config.ProvisionalConfig(has_length_field=True)
        pcap_fixtures.make_control_and_discovery(cls.pcap, cls.cfg)
        cls.rep = diagnose.diagnose(cls.pcap, cls.cfg)

    def test_observed_facts(self):
        s = self.rep["fatos_observados"]
        self.assertEqual(s["pacotes"], 4)
        self.assertIn("TCP", s["por_protocolo"])
        self.assertIn("UDP", s["por_protocolo"])
        # porta 6400 observada
        self.assertTrue(any(p["porta"] == 6400 for p in s["portas_destino"]))
        # janela de tempo preservada
        self.assertGreaterEqual(s["janela_tempo"]["duracao_s"], 0)

    def test_framing_detected(self):
        tcp = self.rep["controle_tcp"]
        self.assertTrue(tcp)
        d = tcp[0]
        self.assertEqual(d["hipotese_provavel"], "com_campo_tamanho_int32be")

    def test_ids_matched_against_schema(self):
        tcp = self.rep["controle_tcp"]
        ids = set()
        for d in tcp:
            ids.update(d.get("match_por_id", {}).keys())
        self.assertIn(104, ids)
        self.assertIn(110, ids)
        # cada id tem candidatos vindos do descritor (lista não vazia)
        for d in tcp:
            for cid, m in d.get("match_por_id", {}).items():
                self.assertTrue(m["candidatos_top"])
                self.assertIn("amostras", m)

    def test_ambiguity_flagged(self):
        # payloads curtos e sintéticos são ambíguos -> fração > 0 para algum id
        tcp = self.rep["controle_tcp"]
        fr = [m["fracao_ambigua"] for d in tcp for m in d.get("match_por_id", {}).values()]
        self.assertTrue(any(f > 0 for f in fr))

    def test_exports_json_and_md(self):
        out = os.path.join(self.tmp, "out")
        diagnose.main([self.pcap, "-o", out, "--length"])
        self.assertTrue(os.path.exists(os.path.join(out, "diagnostico.json")))
        self.assertTrue(os.path.exists(os.path.join(out, "relatorio.md")))
        # JSON não deve conter a chave de bytes crus 'payload' (hex é permitido)
        data = json.load(open(os.path.join(out, "diagnostico.json")))
        self.assertNotIn('"payload":', json.dumps(data))
        # e deve ser totalmente serializável (não sobrou bytes)
        json.dumps(data)

    def test_empty_pcap_graceful(self):
        import struct
        empty = os.path.join(self.tmp, "empty.pcap")
        with open(empty, "wb") as f:
            f.write(struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1))
        rep = diagnose.diagnose(empty)
        self.assertEqual(rep["fatos_observados"].get("pacotes"), 0)
        self.assertEqual(rep["controle_tcp"], [])


if __name__ == "__main__":
    unittest.main()
