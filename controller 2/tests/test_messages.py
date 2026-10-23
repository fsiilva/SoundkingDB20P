"""Testes das mensagens protobuf carregadas do descset recuperado.
Usam só mensagens SINTÉTICAS (criadas e re-lidas em memória). NÃO provam
compatibilidade com a mesa real — isso só a captura valida."""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skdmc import messages


class TestMessages(unittest.TestCase):
    def test_descset_loads(self):
        msgs = messages.list_messages()
        self.assertGreaterEqual(len(msgs), 45)

    def test_known_tags(self):
        # tags conferidas contra os descritores recuperados (fato)
        Command = messages.get_message_class("Command")
        fields = {f.name: f.number for f in Command.DESCRIPTOR.fields}
        self.assertEqual(fields["command"], 1)
        self.assertEqual(fields["moduleId"], 2)
        self.assertEqual(fields["floatParam"], 4)

    def test_roundtrip_command(self):
        Command = messages.get_message_class("Command")
        m = Command(moduleId=7, integerParam=3, floatParam=1.5, boolParam=True)
        raw = m.SerializeToString()
        m2 = Command(); m2.ParseFromString(raw)
        self.assertEqual(m2.moduleId, 7)
        self.assertAlmostEqual(m2.floatParam, 1.5, places=5)
        self.assertTrue(m2.boolParam)

    def test_roundtrip_eq(self):
        Eq = messages.get_message_class("EqPartModel")
        m = Eq(moduleId=12, isByPass=False, highFreqValue=8000.0, highGainValue=-3.0)
        m2 = messages.get_message_class("EqPartModel")()
        m2.ParseFromString(m.SerializeToString())
        self.assertEqual(m2.moduleId, 12)
        self.assertAlmostEqual(m2.highFreqValue, 8000.0, places=1)

    def test_nested_channel(self):
        Ch = messages.get_message_class("MicInChannelModel")
        m = Ch(moduleId=1, channelName="Vocal")
        m.eqPartModel.moduleId = 1
        m.eqPartModel.highGainValue = 2.0
        m2 = messages.get_message_class("MicInChannelModel")()
        m2.ParseFromString(m.SerializeToString())
        self.assertEqual(m2.channelName, "Vocal")
        self.assertAlmostEqual(m2.eqPartModel.highGainValue, 2.0, places=3)


if __name__ == "__main__":
    unittest.main()
