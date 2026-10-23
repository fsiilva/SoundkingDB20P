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
    def __init__(self, host=None, port=config.TCP_PORT, cfg=None, allow_network=False):
        self.host = host or config.DEFAULT_HOST
        self.port = port
        self.cfg = cfg or config.DEFAULTS
        self.allow_network = allow_network
        self._sock = None
        self._rx = bytearray()

    # ---- conexão (bloqueada nesta fase) ----
    def connect(self, timeout=3.0):
        if not self.allow_network:
            raise SafetyLock(
                "Rede desativada nesta fase. Nada é enviado à mesa sem sua "
                "autorização. Habilite com allow_network=True quando liberado."
            )
        self._sock = socket.create_connection((self.host, self.port), timeout=timeout)
        return self

    def close(self):
        if self._sock:
            self._sock.close()
            self._sock = None

    # ---- envio (bloqueado nesta fase) ----
    def send_command(self, cmd_id: int, message) -> bytes:
        """Serializa a mensagem protobuf, monta o frame e — só se a rede estiver
        liberada — envia. Retorna os bytes do frame (útil para inspeção/teste)."""
        payload = message.SerializeToString()
        frame = protocol.encode_frame(cmd_id, payload, self.cfg)
        if not self.allow_network:
            raise SafetyLock("Envio bloqueado: allow_network=False (comando de escrita desativado).")
        self._sock.sendall(frame)
        return frame

    # ---- recepção (parsing puro; não abre socket) ----
    def feed(self, data: bytes):
        """Alimenta bytes recebidos e devolve os frames completos já disponíveis.
        Pode ser usado offline com dados de uma captura/fixture."""
        self._rx += data
        frames, consumed = protocol.decode_frames(bytes(self._rx), self.cfg)
        del self._rx[:consumed]
        return frames
