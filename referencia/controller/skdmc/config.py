"""Parâmetros do protocolo.

Separa o que foi CONFIRMADO por engenharia estática do que ainda é PROVISÓRIO
(só a captura de rede confirma). Tudo o que é provisório fica configurável aqui,
para não precisar mexer no código do núcleo quando a captura chegar.
"""
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# CONFIRMADO (análise estática do APK — classe NettyConnect / CmdHandler)
# ---------------------------------------------------------------------------
DEFAULT_HOST = "192.168.43.1"   # campo HOST em NettyConnect (mesa como AP Wi-Fi)
TCP_PORT = 6400                 # campo PORT em NettyConnect (<clinit>)
UDP_BROADCAST_ADDR = "255.255.255.255"  # ConnectActivity scan

SYNC_BYTE = 0x5A                # isStartHeaderByte compara com 90 (0x5A)
SYNC_WRITE_COUNT = 6            # CmdHandler.sendCommand escreve 6x 0x5A
SYNC_MIN_MATCH = 4             # readToFour0x5aHeaderByte sincroniza em 4x 0x5A
CMD_ID_ENDIAN = "big"          # Netty ByteBufOutputStream.writeInt é big-endian
CMD_ID_SIZE = 4                # int32

# ---------------------------------------------------------------------------
# PROVISÓRIO (confirmar na captura passiva — ver README / relatório)
# ---------------------------------------------------------------------------
@dataclass
class ProvisionalConfig:
    # Existe um campo de TAMANHO explícito após o ID do comando?
    # Estaticamente só vimos [sync][int32 id][payload protobuf]. O comprimento
    # pode ser tratado pelo pipeline Netty. Enquanto não confirmado:
    #   has_length_field=False  -> payload vai até o próximo sync (heurística)
    #   has_length_field=True   -> lê length_size bytes como tamanho do payload
    has_length_field: bool = False          # PROVISÓRIO
    length_size: int = 4                     # PROVISÓRIO
    length_endian: str = "big"               # PROVISÓRIO

    # Porta UDP de destino do broadcast de descoberta (não achada no estático).
    udp_discovery_port: int | None = None    # PROVISÓRIO — preencher com a captura

    # Bytes exatos da requisição de descoberta (desconhecidos).
    discovery_probe: bytes | None = None     # PROVISÓRIO

    # Há login/senha antes dos comandos? (tela existe no iOS; não confirmado)
    requires_login: bool | None = None       # PROVISÓRIO

DEFAULTS = ProvisionalConfig()
