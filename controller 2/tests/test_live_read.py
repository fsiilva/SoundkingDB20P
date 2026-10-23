"""Testa o caminho de LEITURA real (conectar → pedir snapshot → receber → decodificar)
contra uma MESA FALSA em localhost que REPETE os bytes da captura real.

Isto valida a lógica de integração (framing, pedido ID=1, timeout, desconexão,
decodificação), NÃO a mesa ao vivo — o ambiente de teste não está na rede da igreja.
"""
import os, sys, socket, threading, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skdmc import reader, pcap_reader, pcap_analyze

CAP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "captures", "mq16_bruto.pcap")
MESA = "192.168.18.162"


def _snapshot_stream_bytes():
    pk = pcap_reader.read_packets(CAP)
    for key, fl in pcap_reader.group_flows(pk).items():
        if fl["proto"] == "TCP" and MESA in (fl["a"][0], fl["b"][0]) and \
           (fl["a"][1] == 6400 or fl["b"][1] == 6400):
            for (src, dst), data in pcap_analyze.reassemble_tcp_directions(fl).items():
                if src[0] == MESA and len(data) > 1000:
                    return data
    return None


class FakeMesa(threading.Thread):
    """Servidor TCP que espera o pedido de snapshot e responde com os bytes reais."""
    def __init__(self, reply_bytes, drop=False):
        super().__init__(daemon=True)
        self.reply = reply_bytes
        self.drop = drop            # se True, fecha sem responder (testa desconexão)
        self.srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(1)
        self.port = self.srv.getsockname()[1]
        self.got_request = None

    def run(self):
        try:
            c, _ = self.srv.accept()
            c.settimeout(2.0)
            try:
                self.got_request = c.recv(64)
            except socket.timeout:
                self.got_request = b""
            if not self.drop:
                c.sendall(self.reply)
            c.close()
        except OSError:
            pass
        finally:
            self.srv.close()


@unittest.skipUnless(os.path.exists(CAP), "captura real ausente")
class TestLiveRead(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reply = _snapshot_stream_bytes()

    def test_read_requires_permission(self):
        with self.assertRaises(reader.ReadLock):
            reader.read_snapshot_live("127.0.0.1", 6400, allow_read=False)

    def test_read_from_fake_mesa(self):
        srv = FakeMesa(self.reply); srv.start()
        snap, chs = reader.read_snapshot_live("127.0.0.1", srv.port, timeout=3.0, allow_read=True)
        srv.join(timeout=3)
        # o cliente enviou EXATAMENTE o pedido confirmado (ID=1, LEN=0)
        self.assertEqual(srv.got_request, reader.SNAPSHOT_REQUEST)
        self.assertEqual(len(chs), 16)
        by_id = {c["moduleId"]: c["name"] for c in chs}
        self.assertEqual(by_id[0], "BATERIA")

    def test_disconnect_raises(self):
        srv = FakeMesa(self.reply, drop=True); srv.start()
        with self.assertRaises(ConnectionError):
            reader.read_snapshot_live("127.0.0.1", srv.port, timeout=2.0, allow_read=True)
        srv.join(timeout=3)

    def test_connection_refused(self):
        # porta fechada -> ConnectionError
        s = socket.socket(); s.bind(("127.0.0.1", 0)); closed_port = s.getsockname()[1]; s.close()
        with self.assertRaises(ConnectionError):
            reader.read_snapshot_live("127.0.0.1", closed_port, timeout=2.0, allow_read=True)


class TestReadWriteSeparation(unittest.TestCase):
    def test_read_blocked_but_write_also_blocked_by_default(self):
        from skdmc import tcp_client
        c = tcp_client.TcpClient()               # allow_read=False, allow_network=False
        with self.assertRaises(tcp_client.SafetyLock):
            c.connect()                          # sem nenhuma permissão -> bloqueado
        with self.assertRaises(reader.ReadLock):
            c.read_snapshot()                    # leitura exige allow_read

    def test_read_permission_does_not_enable_write(self):
        from skdmc import tcp_client, messages
        c = tcp_client.TcpClient(allow_read=True)   # só leitura
        # escrita continua bloqueada mesmo com leitura habilitada
        with self.assertRaises(tcp_client.SafetyLock):
            c.send_command(110, messages.get_message_class("Command")(moduleId=1))


if __name__ == "__main__":
    unittest.main()
