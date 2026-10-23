"""Leitor de capturas .pcap e .pcapng em PURO Python (biblioteca padrão).

Decodifica Ethernet/IPv4 + TCP/UDP e devolve os pacotes com timestamp, IPs,
portas e payload. Não depende de scapy/dpkt — nada a instalar.

Suporta:
  - pcap clássico (magic 0xa1b2c3d4 / 0xd4c3b2a1, us ou ns);
  - pcapng (blocos SHB/IDB/EPB) com os link-types mais comuns.
Link-types tratados: 1 = Ethernet, 0/12/101 = raw IP, 113 = Linux SLL.
"""
import struct
from dataclasses import dataclass


@dataclass
class Packet:
    ts: float          # epoch seconds
    proto: str         # "TCP" | "UDP" | "OTHER"
    src_ip: str
    dst_ip: str
    src_port: int
    dst_port: int
    payload: bytes     # dados da camada de aplicação (após TCP/UDP)
    tcp_flags: int = 0
    seq: int = 0       # número de sequência TCP (0 para UDP)


def _ip(b):  # IPv4 bytes -> string
    return ".".join(str(x) for x in b)


def _parse_ipv4(data, ts):
    if len(data) < 20:
        return None
    ihl = (data[0] & 0x0F) * 4
    proto = data[9]
    src = _ip(data[12:16]); dst = _ip(data[16:20])
    total = struct.unpack("!H", data[2:4])[0]
    l4 = data[ihl:total] if total and total <= len(data) else data[ihl:]
    if proto == 6:  # TCP
        if len(l4) < 20:
            return None
        sp, dp = struct.unpack("!HH", l4[0:4])
        seq = struct.unpack("!I", l4[4:8])[0]
        doff = (l4[12] >> 4) * 4
        flags = l4[13]
        return Packet(ts, "TCP", src, dst, sp, dp, l4[doff:], flags, seq)
    if proto == 17:  # UDP
        if len(l4) < 8:
            return None
        sp, dp, ln = struct.unpack("!HHH", l4[0:6])
        return Packet(ts, "UDP", src, dst, sp, dp, l4[8:ln] if ln and ln <= len(l4) else l4[8:])
    return Packet(ts, "OTHER", src, dst, 0, 0, b"")


def _parse_link(linktype, frame, ts):
    if linktype == 1:  # Ethernet
        if len(frame) < 14:
            return None
        eth = struct.unpack("!H", frame[12:14])[0]
        off = 14
        if eth == 0x8100:  # VLAN
            eth = struct.unpack("!H", frame[16:18])[0]; off = 18
        if eth == 0x0800:
            return _parse_ipv4(frame[off:], ts)
        return None
    if linktype in (0, 12, 14, 101):  # raw IP
        if frame and (frame[0] >> 4) == 4:
            return _parse_ipv4(frame, ts)
        return None
    if linktype == 113:  # Linux cooked (SLL)
        if len(frame) < 16:
            return None
        if struct.unpack("!H", frame[14:16])[0] == 0x0800:
            return _parse_ipv4(frame[16:], ts)
        return None
    return None


def _read_pcap(b):
    magic = b[:4]
    if magic in (b"\xa1\xb2\xc3\xd4", b"\xd4\xc3\xb2\xa1"):
        be = magic == b"\xa1\xb2\xc3\xd4"; nano = False
    elif magic in (b"\xa1\xb2\x3c\x4d", b"\x4d\x3c\xb2\xa1"):
        be = magic == b"\xa1\xb2\x3c\x4d"; nano = True
    else:
        raise ValueError("não é pcap clássico")
    en = ">" if be else "<"
    linktype = struct.unpack(en + "I", b[20:24])[0]
    o = 24; out = []
    while o + 16 <= len(b):
        tss, tsu, caplen, orig = struct.unpack(en + "IIII", b[o:o + 16])
        o += 16
        frame = b[o:o + caplen]; o += caplen
        ts = tss + (tsu / 1e9 if nano else tsu / 1e6)
        p = _parse_link(linktype, frame, ts)
        if p:
            out.append(p)
    return out


def _read_pcapng(b):
    out = []; o = 0; en = "<"; linktypes = {}; ifidx = 0
    while o + 12 <= len(b):
        btype = struct.unpack("<I", b[o:o + 4])[0]
        blen = struct.unpack("<I", b[o + 4:o + 8])[0]
        if btype == 0x0A0D0D0A:  # SHB
            bom = struct.unpack("<I", b[o + 8:o + 12])[0]
            en = "<" if bom == 0x1A2B3C4D else ">"
        block = b[o:o + blen]
        if btype == 0x00000001:  # IDB
            lt = struct.unpack(en + "H", block[8:10])[0]
            linktypes[len(linktypes)] = lt
        elif btype == 0x00000006:  # EPB
            iface, th, tl, caplen, orig = struct.unpack(en + "IIIII", block[8:28])
            frame = block[28:28 + caplen]
            ts = ((th << 32) | tl) / 1e6
            lt = linktypes.get(iface, 1)
            p = _parse_link(lt, frame, ts)
            if p:
                out.append(p)
        elif btype == 0x00000003:  # simple packet
            caplen = struct.unpack(en + "I", block[8:12])[0]
            frame = block[12:12 + caplen]
            p = _parse_link(linktypes.get(0, 1), frame, 0.0)
            if p:
                out.append(p)
        if blen < 12:
            break
        o += blen
    return out


def read_packets(path):
    """Lê um .pcap/.pcapng e devolve lista de Packet (ordenada por timestamp)."""
    with open(path, "rb") as f:
        b = f.read()
    if b[:4] == b"\x0a\x0d\x0d\x0a":
        pkts = _read_pcapng(b)
    else:
        pkts = _read_pcap(b)
    pkts.sort(key=lambda p: p.ts)
    return pkts


def group_flows(packets):
    """Agrupa por fluxo. Chave canônica (ip:porta par, independente de direção).
    Retorna dict {chave: {"proto","a","b","packets":[...]}}."""
    flows = {}
    for p in packets:
        a = (p.src_ip, p.src_port); b = (p.dst_ip, p.dst_port)
        key = (p.proto,) + tuple(sorted([a, b]))
        fl = flows.setdefault(key, {"proto": p.proto, "a": key[1], "b": key[2], "packets": []})
        fl["packets"].append(p)
    return flows
