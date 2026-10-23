"""Leitor do protocolo REAL da mesa (confirmado pelas capturas de 22/10/2026).

Enquadramento confirmado (porta TCP 6400), nas duas direções:

    5A 5A 5A 5A 5A 5A | uint32 ID (big-endian) | uint32 LENGTH (big-endian) | payload[LENGTH]

Observações confirmadas pela captura:
  - o snapshot (ID=1) vem como um buffer de tamanho fixo (LENGTH múltiplo de 16 KB)
    cujo conteúdo útil pode ser MENOR que LENGTH (resto é preenchimento);
  - o payload do snapshot começa com **2 bytes de prefixo** (ex.: `ef 5a`) ANTES do
    protobuf; por isso o `ParseFromString` direto falha com "wire format corrupt".

Este módulo corrige os dois pontos: localiza o início real do protobuf e extrai só
os campos de topo completos (parse tolerante), validando contra o esquema real.

NÃO abre sockets e NÃO envia nada — só transforma bytes recebidos em mensagens.
A leitura de rede continua a cargo do chamador, com a escrita bloqueada.
"""
import socket
from dataclasses import dataclass
from . import config, messages

SYNC = 0x5A
SYNC_MIN = 4           # receptor sincroniza em 4x 0x5A (confirmado)
ID_SIZE = 4
LEN_SIZE = 4

# Pedido de snapshot CONFIRMADO nos bytes da captura (app->mesa, porta 6400):
#   5A 5A 5A 5A 5A 5A | 00 00 00 01 (ID=1) | 00 00 00 00 (LENGTH=0)
# É um pedido de LEITURA (pede o estado; não altera nada na mesa).
SNAPSHOT_REQUEST = b"\x5a" * 6 + (1).to_bytes(4, "big") + (0).to_bytes(4, "big")


class ReadLock(RuntimeError):
    """Leitura de rede não autorizada nesta fase."""


@dataclass
class Frame:
    cmd_id: int
    payload: bytes
    complete: bool      # False se o LENGTH excede os bytes disponíveis (frame parcial)


def iter_frames(buf: bytes):
    """Percorre o buffer e devolve os frames (ID + payload) no framing real.
    Para no primeiro frame incompleto (retorna-o com complete=False) para o
    chamador manter o resto no buffer e continuar quando chegar mais bytes."""
    i, n = 0, len(buf)
    while i < n:
        j = buf.find(b"\x5a" * SYNC_MIN, i)
        if j < 0:
            break
        k = j
        while k < n and buf[k] == SYNC:
            k += 1
        if k + ID_SIZE + LEN_SIZE > n:          # cabeçalho incompleto
            yield Frame(None, b"", False)
            return
        cid = int.from_bytes(buf[k:k + ID_SIZE], "big")
        ln = int.from_bytes(buf[k + ID_SIZE:k + ID_SIZE + LEN_SIZE], "big")
        pstart = k + ID_SIZE + LEN_SIZE
        pend = pstart + ln
        if pend > n:                            # payload ainda não chegou todo
            yield Frame(cid, buf[pstart:n], False)
            return
        yield Frame(cid, buf[pstart:pend], True)
        i = pend


def consumed_bytes(buf: bytes) -> int:
    """Quantos bytes do buffer já formam frames COMPLETOS (para o chamador
    descartar e manter o resto)."""
    i, n = 0, len(buf)
    while i < n:
        j = buf.find(b"\x5a" * SYNC_MIN, i)
        if j < 0:
            return i
        k = j
        while k < n and buf[k] == SYNC:
            k += 1
        if k + ID_SIZE + LEN_SIZE > n:
            return i
        ln = int.from_bytes(buf[k + ID_SIZE:k + ID_SIZE + LEN_SIZE], "big")
        pend = k + ID_SIZE + LEN_SIZE + ln
        if pend > n:
            return i
        i = pend
    return i


# ---- extração do protobuf do payload (lida com prefixo + preenchimento) ----

def _uvarint(b, i):
    r = s = 0
    n = len(b)
    while i < n:
        x = b[i]; i += 1
        r |= (x & 0x7F) << s
        if x < 0x80:
            return r, i
        s += 7
    raise IndexError


def _complete_toplevel_prefix(b: bytes) -> bytes:
    """Devolve o maior prefixo de `b` formado só por campos de topo protobuf
    COMPLETOS (ignora preenchimento/sobra no fim). Vazio se nem o 1º campo fecha."""
    i, n = 0, len(b)
    good = 0
    while i < n:
        start = i
        try:
            tag, i = _uvarint(b, i)
        except IndexError:
            break
        f, wt = tag >> 3, tag & 7
        if f == 0 or wt in (3, 4, 6, 7):
            break
        try:
            if wt == 0:          # varint
                _, i = _uvarint(b, i)
            elif wt == 2:        # length-delimited
                ln, i = _uvarint(b, i)
                if i + ln > n:
                    break
                i += ln
            elif wt == 5:        # 32-bit
                if i + 4 > n:
                    break
                i += 4
            elif wt == 1:        # 64-bit
                if i + 8 > n:
                    break
                i += 8
        except IndexError:
            break
        good = i
    return b[:good]


def _try_parse(body: bytes):
    """Tenta montar um SKDMCData a partir de `body`. Devolve (msg, n_campos) ou None."""
    if not body:
        return None
    SK = messages.get_message_class("SKDMCData")
    msg = SK()
    try:
        msg.MergeFromString(body)
    except Exception:
        return None
    return msg, len(msg.ListFields())


def extract_protobuf(payload: bytes, max_prefix: int = 4) -> bytes:
    """Localiza o início real do protobuf (pulando o prefixo de 2 bytes quando
    presente) e devolve os campos de topo completos do offset que de fato VALIDA
    como SKDMCData com mais campos. Vazio se nenhum offset validar."""
    best_body, best_n = b"", -1
    for off in range(0, max_prefix + 1):
        cand = _complete_toplevel_prefix(payload[off:])
        r = _try_parse(cand)
        if r and r[1] > best_n:
            best_body, best_n = cand, r[1]
    return best_body


def parse_snapshot(payload: bytes):
    """Valida e devolve o SKDMCData do snapshot (ID=1). Levanta ValueError com
    mensagem clara se não houver protobuf válido suficiente."""
    body = extract_protobuf(payload)
    if not body:
        raise ValueError("payload do snapshot não contém protobuf válido "
                         "(verifique o framing: 5A×6 + id(4) + len(4) + payload, "
                         "e o prefixo de 2 bytes antes do protobuf)")
    return _try_parse(body)[0]


def snapshot_from_stream(stream: bytes):
    """Conveniência: dado o stream TCP recebido da mesa (mesa->app, porta 6400),
    acha o frame ID=1 e devolve o SKDMCData. Concatena chunks de ID=1 se houver
    mais de um (snapshot grande em pedaços de 16 KB)."""
    chunks = []
    for fr in iter_frames(stream):
        if fr.cmd_id == 1 and fr.payload:
            chunks.append(fr.payload)
    if not chunks:
        raise ValueError("nenhum frame de snapshot (ID=1) encontrado no stream")
    if len(chunks) == 1:
        return parse_snapshot(chunks[0])
    # vários chunks: extrai protobuf de cada e concatena os campos completos
    body = b"".join(extract_protobuf(c) for c in chunks)
    r = _try_parse(_complete_toplevel_prefix(body))
    if not r:
        raise ValueError("snapshot em múltiplos chunks não validou como SKDMCData")
    return r[0]


def read_snapshot_live(host: str, port: int = 6400, timeout: float = 4.0,
                        allow_read: bool = False):
    """LEITURA real da mesa: conecta, pede o snapshot (ID=1, LEN=0 — confirmado na
    captura), recebe o frame ID=1 e devolve (SKDMCData, lista_de_canais).

    Permissão de LEITURA é SEPARADA da de escrita: só pede o estado, NUNCA envia
    comando que altere a mesa. Levanta ReadLock se allow_read=False.

    Trata timeout e desconexão; sempre fecha o socket.
    """
    if not allow_read:
        raise ReadLock("Leitura de rede desativada (allow_read=False). "
                       "A leitura é separada da escrita; habilite-a explicitamente.")
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    rx = bytearray()
    try:
        s.connect((host, port))
        s.sendall(SNAPSHOT_REQUEST)           # pedido de LEITURA (não altera a mesa)
        import time
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                chunk = s.recv(65536)
            except socket.timeout:
                break
            if not chunk:                     # mesa fechou a conexão
                break
            rx += chunk
            # já temos um frame ID=1 completo?
            for fr in iter_frames(bytes(rx)):
                if fr.cmd_id == 1 and fr.complete and fr.payload:
                    snap = parse_snapshot(fr.payload)
                    return snap, channels(snap)
    except (ConnectionRefusedError, ConnectionResetError, OSError, socket.timeout) as e:
        raise ConnectionError(f"falha ao ler da mesa {host}:{port}: {e}")
    finally:
        try:
            s.close()
        except OSError:
            pass
    raise ConnectionError(f"não recebi um snapshot (ID=1) completo de {host}:{port} "
                          f"em {timeout}s")


def channels(snapshot) -> list:
    """Extrai a lista de canais (moduleId, nome, fader, mute, pan) do SKDMCData."""
    out = []
    for grp in ("in1Model", "in2Model"):
        m = getattr(snapshot, grp, None)
        if m is None:
            continue
        for f in m.DESCRIPTOR.fields:
            v = getattr(m, f.name)
            if hasattr(v, "channelName"):
                o = getattr(v, "outputPartModel", None)
                out.append({
                    "moduleId": v.moduleId,
                    "name": v.channelName.strip(),
                    "fader": getattr(o, "outFaderValue", None) if o else None,
                    "mute": getattr(o, "isMuteEnable", None) if o else None,
                    "pan": getattr(o, "panValue", None) if o else None,
                })
    return out
