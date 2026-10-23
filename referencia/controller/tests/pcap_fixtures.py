"""Gera capturas .pcap SINTÉTICAS para testar o analisador. Nada vem da mesa:
os frames são montados por nós com o framing confirmado e mensagens protobuf
reais (do descset). Serve só para validar o parser, não prova o protocolo real."""
import struct, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skdmc import protocol, messages, config


def _eth_ipv4(src_ip, dst_ip, l4proto, l4):
    def ipb(s): return bytes(int(x) for x in s.split("."))
    total = 20 + len(l4)
    ip = bytearray()
    ip += bytes([0x45, 0x00]) + struct.pack("!H", total)
    ip += bytes([0, 0, 0, 0, 64, l4proto, 0, 0]) + ipb(src_ip) + ipb(dst_ip)
    eth = b"\x00\x11\x22\x33\x44\x55\x66\x77\x88\x99\xaa\xbb\x08\x00"
    return eth + bytes(ip) + l4


def _tcp(sport, dport, seq, payload, flags=0x18):
    hdr = struct.pack("!HHIIBBHHH", sport, dport, seq, 0, (5 << 4), flags, 65535, 0, 0)
    return hdr + payload


def _udp(sport, dport, payload):
    return struct.pack("!HHHH", sport, dport, 8 + len(payload), 0) + payload


def write_pcap(path, records):
    """records: lista de (ts, frame_ethernet_bytes)."""
    with open(path, "wb") as f:
        f.write(struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1))  # linktype 1
        for ts, frame in records:
            sec = int(ts); usec = int((ts - sec) * 1e6)
            f.write(struct.pack("<IIII", sec, usec, len(frame), len(frame)))
            f.write(frame)


def make_control_and_discovery(path, cfg=None):
    """Monta um pcap com: descoberta UDP (broadcast + resposta de texto) e um
    fluxo TCP 6400 com alguns frames 0x5A carregando mensagens protobuf reais."""
    cfg = cfg or config.DEFAULTS
    client, mixer = "192.168.43.50", "192.168.43.1"
    recs = []
    t = 1000.0
    # --- descoberta UDP (sintética) ---
    recs.append((t, _eth_ipv4(client, "255.255.255.255", 17, _udp(50000, 7000, b"WHO_IS_THERE?"))))
    t += 0.05
    reply = b"server adress=192.168.43.1;server hostName=Console;server port=6400"
    recs.append((t, _eth_ipv4(mixer, client, 17, _udp(7000, 50000, reply))))
    # --- controle TCP 6400 ---
    Command = messages.get_message_class("Command")
    Eq = messages.get_message_class("EqPartModel")
    msgs = [
        (110, Command(moduleId=3, floatParam=0.5, boolParam=True).SerializeToString()),
        (104, Eq(moduleId=3, highGainValue=-2.0, isByPass=False).SerializeToString()),
    ]
    seq = 1
    for cid, payload in msgs:
        t += 0.1
        frame = protocol.encode_frame(cid, payload, cfg)
        recs.append((t, _eth_ipv4(client, mixer, 6, _tcp(50001, 6400, seq, frame))))
        seq += len(frame)
    write_pcap(path, recs)
    return path


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/synthetic.pcap"
    make_control_and_discovery(out)
    print("gerado:", out)
