"""Testes do enquadramento (framing). Usam fixtures locais em memória.
Confirmam o COMPORTAMENTO do código, não o protocolo real da mesa — o fim de
payload com has_length_field=False é heurística provisória."""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skdmc import protocol, config, messages


class TestFraming(unittest.TestCase):
    def test_encode_header_shape(self):
        frame = protocol.encode_frame(110, b"\x01\x02\x03")
        # 6x 0x5A (confirmado) + int32 big-endian do id + payload
        self.assertEqual(frame[:6], bytes([0x5A] * 6))
        self.assertEqual(int.from_bytes(frame[6:10], "big"), 110)
        self.assertEqual(frame[10:], b"\x01\x02\x03")

    def test_find_sync_min4(self):
        buf = b"\x00\x5a\x5a\x5a\x00" + b"\x5a\x5a\x5a\x5a\xAA"
        # primeiro run tem só 3 -> ignorado; segundo tem 4 -> sincroniza
        idx = protocol.find_sync(buf)
        self.assertEqual(buf[idx], 0xAA)

    def test_roundtrip_with_length_field(self):
        # modo PROVISÓRIO com length explícito: round-trip determinístico
        cfg = config.ProvisionalConfig(has_length_field=True, length_size=4, length_endian="big")
        Command = messages.get_message_class("Command")
        payload = Command(moduleId=5, floatParam=0.25).SerializeToString()
        frame = protocol.encode_frame(104, payload, cfg)
        frames, consumed = protocol.decode_frames(frame, cfg)
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].cmd_id, 104)
        m2 = Command(); m2.ParseFromString(frames[0].payload)
        self.assertEqual(m2.moduleId, 5)
        self.assertEqual(consumed, len(frame))

    def test_two_frames_heuristic(self):
        # sem length (heurística: payload até o próximo sync)
        f1 = protocol.encode_frame(110, b"\xAA\xBB")
        f2 = protocol.encode_frame(104, b"\xCC")
        frames, _ = protocol.decode_frames(f1 + f2)
        self.assertEqual([fr.cmd_id for fr in frames], [110, 104])
        self.assertEqual(frames[0].payload, b"\xAA\xBB")
        self.assertEqual(frames[1].payload, b"\xCC")

    def test_partial_buffer_waits(self):
        # id incompleto após o sync -> nenhum frame, espera mais bytes
        buf = bytes([0x5A] * 6) + b"\x00\x00"  # só 2 dos 4 bytes do id
        frames, consumed = protocol.decode_frames(buf)
        self.assertEqual(frames, [])
        self.assertEqual(consumed, 0)


if __name__ == "__main__":
    unittest.main()
