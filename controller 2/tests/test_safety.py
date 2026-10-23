"""Garante que nada é transmitido à mesa nesta fase: cliente TCP e descoberta
UDP devem recusar operações de rede enquanto não autorizados."""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skdmc import tcp_client, discovery, messages


class TestSafety(unittest.TestCase):
    def test_tcp_connect_blocked(self):
        c = tcp_client.TcpClient()
        with self.assertRaises(tcp_client.SafetyLock):
            c.connect()

    def test_tcp_send_blocked(self):
        c = tcp_client.TcpClient()
        Command = messages.get_message_class("Command")
        with self.assertRaises(tcp_client.SafetyLock):
            c.send_command(110, Command(moduleId=1))

    def test_discovery_blocked(self):
        with self.assertRaises(discovery.SafetyLock):
            discovery.discover(allow_network=True)  # porta/payload desconhecidos

    def test_feed_offline_ok(self):
        # recepção offline (parsing) NÃO precisa de rede e deve funcionar.
        # frame no FORMATO REAL: 5A×6 + id(4,BE) + len(4,BE) + payload
        c = tcp_client.TcpClient()
        payload = b"\x01"
        frame = b"\x5a" * 6 + (110).to_bytes(4, "big") + len(payload).to_bytes(4, "big") + payload
        frames = c.feed(frame)
        self.assertEqual(frames[0].cmd_id, 110)


if __name__ == "__main__":
    unittest.main()
