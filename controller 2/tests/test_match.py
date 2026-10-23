"""Testes do decodificador dirigido. Dados SINTÉTICOS (montados por nós) — não
provam vínculo real ID->mensagem; validam só o comportamento do scorer."""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skdmc import match, messages, match_report


class TestMatch(unittest.TestCase):
    def test_valid_message_scores_high(self):
        Eq = messages.get_message_class("EqPartModel")
        payload = Eq(moduleId=3, highFreqValue=8000.0, highGainValue=-2.0,
                     isByPass=False).SerializeToString()
        c = match.score_candidate("EqPartModel", payload)
        self.assertTrue(c.ok)
        self.assertTrue(c.reencode_roundtrip)      # mesma mensagem -> roundtrip perfeito
        self.assertGreaterEqual(c.score, 0.9)
        self.assertEqual(c.unknown_tags, [])

    def test_correct_candidate_ranks_first(self):
        Cmd = messages.get_message_class("Command")
        payload = Cmd(moduleId=5, integerParam=2, floatParam=1.0).SerializeToString()
        results = match.match_payload(payload, cmd_id=None, top=5)
        self.assertEqual(results[0].name, "Command")
        self.assertTrue(results[0].reencode_roundtrip)

    def test_invalid_data_no_false_confidence(self):
        # bytes aleatórios que não são protobuf válido
        payload = bytes([0xFF, 0xFF, 0xFF, 0x07, 0x00, 0x13, 0x37])
        results = match.match_payload(payload, top=5)
        # nenhuma candidata deve alcançar roundtrip; scores baixos
        self.assertFalse(any(c.reencode_roundtrip for c in results))
        self.assertLess(results[0].score, 0.9)

    def test_ambiguity_flagged(self):
        # payload minimalista: só o campo 1 varint = 1. Muitas mensagens têm
        # 'moduleId' no tag 1 -> ambiguidade esperada.
        payload = bytes([0x08, 0x01])  # field 1, varint, valor 1
        results = match.match_payload(payload, top=5)
        self.assertTrue(match.ambiguity(results))
        # várias candidatas parseiam esse payload trivial
        self.assertGreaterEqual(sum(1 for c in results if c.ok), 2)

    def test_report_labels_hypothesis(self):
        Cmd = messages.get_message_class("Command")
        payload = Cmd(moduleId=1).SerializeToString()
        rep = match_report.build_report(payload, cmd_id=110, top=3)
        self.assertIn("HIPÓTESE", rep["_aviso"])
        # semântica do ID é fato; mensagem é palpite/ inferência
        self.assertEqual(rep["id_rotulo_confirmado"],
                         "Canal (fader/mute/solo/pan)")
        self.assertIn("observado", rep)
        self.assertIn("candidatas", rep)

    def test_unknown_tags_counted(self):
        # monta um payload com um campo de tag altíssima que não existe no schema
        # de uma mensagem pequena -> deve aparecer em tags_inexplicadas
        # tag 1023 wire-type 2: (1023<<3)|2 = 8186 = varint 0xFA 0x3F, len 2, "AB"
        payload = bytes([0x08, 0x01]) + bytes([0xFA, 0x3F, 0x02, 0x41, 0x42])
        c = match.score_candidate("MeterLevelData", payload)
        self.assertIn(1023, c.observed_fields)
        self.assertIn(1023, c.unknown_tags)


if __name__ == "__main__":
    unittest.main()
