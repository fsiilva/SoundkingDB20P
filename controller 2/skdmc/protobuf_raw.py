"""Decodificador GENÉRICO de protobuf (wire-format), sem esquema.

Lê os campos (número + wire type + valor cru) de um blob. Serve para CONFIRMAR
que um payload é protobuf válido e inspecionar sua forma SEM inventar nomes nem
assumir qual mensagem é. É a base honesta da análise: só o que está nos bytes.
"""

WIRE = {0: "varint", 1: "i64", 2: "len", 5: "i32"}


def _uvarint(b, o):
    r = s = 0
    while o < len(b):
        x = b[o]; o += 1
        r |= (x & 0x7F) << s
        if x < 0x80:
            return r, o
        s += 7
        if s > 70:
            raise ValueError("varint longo demais")
    raise ValueError("varint truncado")


def decode_raw(b, _depth=0):
    """Retorna lista de dicts {field, wire, ...}. Levanta ValueError se não for
    protobuf bem-formado (útil para distinguir payload protobuf de outra coisa)."""
    out = []
    o = 0
    n = len(b)
    while o < n:
        tag, o = _uvarint(b, o)
        field = tag >> 3
        wt = tag & 7
        if field == 0:
            raise ValueError("field 0 inválido")
        if wt == 0:
            v, o = _uvarint(b, o)
            out.append({"field": field, "wire": "varint", "value": v})
        elif wt == 1:
            if o + 8 > n:
                raise ValueError("i64 truncado")
            out.append({"field": field, "wire": "i64", "raw": b[o:o + 8].hex()})
            o += 8
        elif wt == 5:
            if o + 4 > n:
                raise ValueError("i32 truncado")
            import struct as _s
            chunk = b[o:o + 4]
            out.append({"field": field, "wire": "i32", "raw": chunk.hex(),
                        "as_float": _s.unpack("<f", chunk)[0]})
            o += 4
        elif wt == 2:
            ln, o = _uvarint(b, o)
            if o + ln > n:
                raise ValueError("len-delim truncado")
            sub = b[o:o + ln]; o += ln
            entry = {"field": field, "wire": "len", "len": ln}
            # tentar interpretar como sub-mensagem; se falhar, como texto/bytes
            if _depth < 6 and ln > 0:
                try:
                    entry["message"] = decode_raw(sub, _depth + 1)
                except ValueError:
                    pass
            if "message" not in entry:
                try:
                    entry["string"] = sub.decode("utf-8")
                except UnicodeDecodeError:
                    entry["bytes"] = sub[:32].hex() + ("…" if ln > 32 else "")
            out.append(entry)
        else:
            raise ValueError(f"wire type não suportado: {wt}")
    return out


def looks_like_protobuf(b):
    """True se o blob decodifica como protobuf bem-formado (heurística forte,
    sem esquema)."""
    if not b:
        return False
    try:
        decode_raw(b)
        return True
    except ValueError:
        return False
