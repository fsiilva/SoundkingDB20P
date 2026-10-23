"""Testes do leitor/analisador de .pcap usando capturas SINTÉTICAS.
Validam o parser, não o protocolo real da mesa."""
import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skdmc import pcap_reader, pcap_analyze, protobuf_raw, config, messages
import pcap_fixtures


class TestPcap(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.pcap = os.path.join(cls.tmp, "syn.pcap")
        # usa o modo com length explícito p/ round-trip determinístico no teste
        cls.cfg = config.ProvisionalConfig(has_length_field=True)
        pcap_fixtures.make_control_and_discovery(cls.pcap, cls.cfg)

    def test_read_packets(self):
        pkts = pcap_reader.read_packets(self.pcap)
        self.assertGreaterEqual(len(pkts), 4)
        protos = {p.proto for p in pkts}
        self.assertIn("TCP", protos)
        self.assertIn("UDP", protos)

    def test_flows_grouping(self):
        flows = pcap_reader.group_flows(pcap_reader.read_packets(self.pcap))
        self.assertTrue(any(f["proto"] == "TCP" for f in flows.values()))
        self.assertTrue(any(f["proto"] == "UDP" for f in flows.values()))

    def test_analyze_finds_frames(self):
        rep = pcap_analyze.analyze(self.pcap, self.cfg)
        tcp = [f for f in rep["fluxos"] if f["proto"] == "TCP"][0]
        d = tcp["direcoes"][0]
        # a fixture usa campo de tamanho -> essa deve ser a hipótese vencedora
        self.assertEqual(d["hipotese_mais_provavel"], "com_campo_tamanho_int32be")
        frames = d["framing"]["com_campo_tamanho_int32be"]["frames"]
        ids = [fr["cmd_id"] for fr in frames]
        self.assertIn(110, ids)
        self.assertIn(104, ids)
        self.assertTrue(all(fr["payload_is_protobuf"] for fr in frames))

    def test_udp_discovery_seen(self):
        rep = pcap_analyze.analyze(self.pcap, self.cfg)
        udp_flows = [f for f in rep["fluxos"] if f["proto"] == "UDP"]
        self.assertTrue(udp_flows)
        all_samples = [s for f in udp_flows for s in f["amostras"]]
        texts = [s["texto"] for s in all_samples if s["texto"]]
        self.assertTrue(any("Console" in (t or "") for t in texts))
        self.assertTrue(any(s["broadcast"] for s in all_samples))

    def test_raw_protobuf_fields(self):
        Command = messages.get_message_class("Command")
        raw = Command(moduleId=9, integerParam=4).SerializeToString()
        fields = protobuf_raw.decode_raw(raw)
        nums = {f["field"]: f for f in fields}
        self.assertEqual(nums[2]["value"], 9)   # moduleId = tag 2
        self.assertEqual(nums[3]["value"], 4)   # integerParam = tag 3

    def test_outputs_written(self):
        rep = pcap_analyze.analyze(self.pcap, self.cfg)
        j, t = pcap_analyze.write_outputs(rep, os.path.join(self.tmp, "out"))
        self.assertTrue(os.path.exists(j) and os.path.exists(t))


if __name__ == "__main__":
    unittest.main()
