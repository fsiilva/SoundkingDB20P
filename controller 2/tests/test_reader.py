"""Testes do leitor real (skdmc.reader) usando a CAPTURA REAL da mesa.
Prova que o framing (5A×6 + id + len + payload) e a extração do protobuf (pulando
o prefixo de 2 bytes + buffer de 16 KB) validam o SKDMCData."""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skdmc import reader, pcap_reader, pcap_analyze

CAP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "captures", "mq16_bruto.pcap")
MESA = "192.168.18.162"


def _snapshot_stream():
    pk = pcap_reader.read_packets(CAP)
    for key, fl in pcap_reader.group_flows(pk).items():
        if fl["proto"] == "TCP" and MESA in (fl["a"][0], fl["b"][0]) and \
           (fl["a"][1] == 6400 or fl["b"][1] == 6400):
            for (src, dst), data in pcap_analyze.reassemble_tcp_directions(fl).items():
                if src[0] == MESA and len(data) > 1000:
                    return data
    return None


@unittest.skipUnless(os.path.exists(CAP), "captura real ausente")
class TestReaderReal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stream = _snapshot_stream()

    def test_stream_present(self):
        self.assertIsNotNone(self.stream)
        self.assertGreater(len(self.stream), 10000)

    def test_framing_id_and_len(self):
        frames = [f for f in reader.iter_frames(self.stream) if f.cmd_id is not None]
        self.assertTrue(frames)
        # primeiro frame é o snapshot: ID=1
        self.assertEqual(frames[0].cmd_id, 1)

    def test_snapshot_validates(self):
        msg = reader.snapshot_from_stream(self.stream)
        names = [f.name for f, _ in msg.ListFields()]
        self.assertIn("in1Model", names)
        self.assertIn("busModel", names)

    def test_channels_extracted(self):
        msg = reader.snapshot_from_stream(self.stream)
        chs = reader.channels(msg)
        self.assertEqual(len(chs), 16)
        by_id = {c["moduleId"]: c["name"] for c in chs}
        self.assertEqual(by_id[0], "BATERIA")     # moduleId 0 confirmado na captura
        self.assertEqual(by_id[3], "GUITARRA")


class TestReaderUnit(unittest.TestCase):
    def test_extract_strips_prefix(self):
        # monta um payload: 2 bytes de prefixo + protobuf simples + sobra
        from skdmc import messages
        Eq = messages.get_message_class("EqPartModel")
        pb = Eq(moduleId=3, highGainValue=2.0).SerializeToString()
        payload = b"\xef\x5a" + pb + b"\x00\x00\x00"   # prefixo + protobuf + preenchimento
        body = reader.extract_protobuf(payload)
        self.assertTrue(body)  # achou o protobuf pulando o prefixo

    def test_iter_frames_partial(self):
        # cabeçalho sem payload completo -> frame incompleto
        buf = b"\x5a" * 6 + (1).to_bytes(4, "big") + (100).to_bytes(4, "big") + b"\x01\x02"
        frames = list(reader.iter_frames(buf))
        self.assertFalse(frames[-1].complete)


if __name__ == "__main__":
    unittest.main()
