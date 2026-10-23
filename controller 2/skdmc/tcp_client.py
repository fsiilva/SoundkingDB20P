"""Cliente TCP para a mesa (porta 6400).

Estrutura pronta, mas com TRAVA DE SEGURANÇA: nesta fase o cliente NÃO conecta
nem envia nada. `allow_network=False` por padrão; qualquer tentativa de abrir
socket levanta RuntimeError. Isso cumpre a restrição de não transmitir à mesa
sem autorização.

Quando você autorizar (e após a captura confirmar framing/length), basta
instanciar com allow_network=True.
"""
import socket
from . import config, protocol


class SafetyLock(RuntimeError):
    pass


class TcpClient:
    def __init__(self, host=None, port=config.TCP_PORT, cfg=None,
                 allow_network=False, allow_read=False):
        self.host = host or config.DEFAULT_HOST
        self.port = port
        self.cfg = cfg or config.DEFAULTS
        self.allow_network = allow_network   # permissão de ESCRITA (comandos à mesa)
        self.allow_read = allow_read         # permissão de LEITURA (pedir estado)
        self._sock = None
        self._rx = bytearray()

    # ---- conexão ----
    def connect(self, timeout=3.0):
        """Conecta à mesa. Permitido se houver permissão de LEITURA ou de ESCRITA.
        Conectar por si só não altera nada na mesa."""
        if not (self.allow_read or self.allow_network):
            raise SafetyLock(
                "Conexão bloqueada: sem permissão de leitura nem de escrita "
                "(allow_read=False, allow_network=False)."
            )
        self._sock = socket.create_connection((self.host, self.port), timeout=timeout)
        return self

    def close(self):
        if self._sock:
            self._sock.close()
            self._sock = None

    # ---- LEITURA (separada da escrita) ----
    def read_snapshot(self, timeout=4.0):
        """Pede e devolve o snapshot real (SKDMCData, canais). Requer allow_read.
        Só pede o estado (ID=1, LEN=0) — NÃO altera a mesa."""
        from . import reader
        return reader.read_snapshot_live(self.host, self.port, timeout=timeout,
                                         allow_read=self.allow_read)

    # ---- ESCRITA (bloqueada nesta fase) ----
    def send_command(self, cmd_id: int, message) -> bytes:
        """Serializa a mensagem protobuf, monta o frame e — só se a ESCRITA estiver
        liberada — envia. Retorna os bytes do frame (útil para inspeção/teste)."""
        payload = message.SerializeToString()
        frame = protocol.encode_frame(cmd_id, payload, self.cfg)
        if not self.allow_network:
            raise SafetyLock("Envio bloqueado: allow_network=False (comando de escrita desativado).")
        self._sock.sendall(frame)
        return frame

    # ---- recepção (parsing puro; não abre socket) ----
    def feed(self, data: bytes):
        """Alimenta bytes recebidos e devolve os frames COMPLETOS já disponíveis,
        usando o framing REAL confirmado (reader: 5A×6 + id + len + payload).
        Pode ser usado offline com dados de uma captura/fixture. Não abre socket."""
        from . import reader
        self._rx += data
        buf = bytes(self._rx)
        frames = [f for f in reader.iter_frames(buf) if f.cmd_id is not None and f.complete]
        del self._rx[:reader.consumed_bytes(buf)]
        return frames

    def snapshot(self):
        """Se já chegou o frame de snapshot (ID=1), devolve o SKDMCData; senão None.
        Usa só o que está no buffer de recepção — não envia nada."""
        from . import reader
        buf = bytes(self._rx)
        for fr in reader.iter_frames(buf):
            if fr.cmd_id == 1 and fr.complete and fr.payload:
                try:
                    return reader.parse_snapshot(fr.payload)
                except ValueError:
                    return None
        return None
