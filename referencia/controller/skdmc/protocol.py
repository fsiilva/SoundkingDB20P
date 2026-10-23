"""Núcleo de enquadramento (framing) do protocolo da mesa.

CONFIRMADO estaticamente (CmdHandler.sendCommand / CommandUtils):
  - cada frame começa com bytes de sincronismo 0x5A (emissor escreve 6; o
    receptor sincroniza ao achar 4 consecutivos);
  - em seguida um int32 big-endian = ID do comando;
  - em seguida o payload protobuf (Message serializada).

PROVISÓRIO (ver config.ProvisionalConfig):
  - se existe um campo de TAMANHO explícito do payload. Enquanto não confirmado,
    o leitor usa a heurística "payload até o próximo sync" (ou fim do buffer).

Este módulo NÃO abre sockets nem envia nada. Só transforma bytes <-> frames.
"""
from dataclasses import dataclass
from . import config


@dataclass
class Frame:
    cmd_id: int
    payload: bytes


def encode_frame(cmd_id: int, payload: bytes, cfg: config.ProvisionalConfig | None = None) -> bytes:
    """Monta um frame para envio. (Usado só em testes nesta fase — nada é
    transmitido até você autorizar.)"""
    cfg = cfg or config.DEFAULTS
    out = bytearray()
    out += bytes([config.SYNC_BYTE] * config.SYNC_WRITE_COUNT)
    out += int(cmd_id).to_bytes(config.CMD_ID_SIZE, config.CMD_ID_ENDIAN)
    if cfg.has_length_field:  # PROVISÓRIO
        out += len(payload).to_bytes(cfg.length_size, cfg.length_endian)
    out += payload
    return bytes(out)


def find_sync(buf: bytes, start: int = 0) -> int:
    """Retorna o índice logo APÓS uma sequência de >= SYNC_MIN_MATCH bytes 0x5A,
    ou -1 se não houver sincronismo completo no buffer. CONFIRMADO: sincroniza
    em 4x 0x5A (readToFour0x5aHeaderByte)."""
    i = start
    n = len(buf)
    while i < n:
        if buf[i] == config.SYNC_BYTE:
            j = i
            while j < n and buf[j] == config.SYNC_BYTE:
                j += 1
            if (j - i) >= config.SYNC_MIN_MATCH:
                return j  # primeiro byte após o run de 0x5A
            i = j
        else:
            i += 1
    return -1


def decode_frames(buf: bytes, cfg: config.ProvisionalConfig | None = None):
    """Gera (Frame, consumed_until). Pode sobrar um frame incompleto no fim;
    o chamador mantém o resto no buffer. Retorna lista de frames + offset
    consumido.

    ATENÇÃO: com has_length_field=False (padrão, provisório) o fim do payload é
    inferido pelo próximo sincronismo; isso é suficiente para testes com
    fixtures, mas o delimitador real precisa ser confirmado na captura.
    """
    cfg = cfg or config.DEFAULTS
    frames = []
    pos = 0
    n = len(buf)
    while True:
        after_sync = find_sync(buf, pos)
        if after_sync < 0:
            break
        hdr = after_sync
        if hdr + config.CMD_ID_SIZE > n:
            break  # id incompleto; espera mais bytes
        cmd_id = int.from_bytes(buf[hdr:hdr + config.CMD_ID_SIZE], config.CMD_ID_ENDIAN)
        body = hdr + config.CMD_ID_SIZE
        if cfg.has_length_field:  # PROVISÓRIO
            if body + cfg.length_size > n:
                break
            ln = int.from_bytes(buf[body:body + cfg.length_size], cfg.length_endian)
            pstart = body + cfg.length_size
            if pstart + ln > n:
                break  # payload incompleto
            payload = buf[pstart:pstart + ln]
            end = pstart + ln
        else:  # heurística provisória: até o próximo sync ou fim
            nxt = find_sync(buf, body)
            if nxt < 0:
                payload = buf[body:]
                end = n
            else:
                # recuar o run de 0x5A que pertence ao próximo frame
                k = nxt
                while k > body and buf[k - 1] == config.SYNC_BYTE:
                    k -= 1
                payload = buf[body:k]
                end = k
        frames.append(Frame(cmd_id=cmd_id, payload=bytes(payload)))
        pos = end
    return frames, pos
