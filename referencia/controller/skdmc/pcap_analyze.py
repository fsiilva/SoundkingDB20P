"""Analisa um .pcap/.pcapng de uma sessão do app oficial com a mesa.

O que faz (tudo offline, só leitura):
  1. lê pacotes, agrupa por fluxo, preserva ts/IP/porta/payload;
  2. remonta cada direção dos fluxos TCP (por número de sequência);
  3. procura frames com sincronismo 0x5A (CONFIRMADO) e extrai ID (int32 BE) +
     payload; confirma se o payload é protobuf bem-formado (decoder genérico);
  4. para a descoberta, examina os pacotes UDP (broadcast e respostas);
  5. gera um relatório legível + arquivos JSON para inspeção.

NÃO decodifica um payload como uma mensagem NOMEADA a menos que você passe um
mapa id->mensagem explícito (--map); e, mesmo assim, rotula como HIPÓTESE. O
padrão é o dump genérico de protobuf (campos por número/wire-type), que não
inventa nada.
"""
import json, os, argparse
from . import pcap_reader, protocol, config, protobuf_raw


def reassemble_tcp_directions(flow):
    """Devolve {(src,dst): bytes} com o stream remontado por direção (ordenado
    por seq, com dedupe simples)."""
    dirs = {}
    for p in flow["packets"]:
        if p.proto != "TCP" or not p.payload:
            continue
        key = ((p.src_ip, p.src_port), (p.dst_ip, p.dst_port))
        dirs.setdefault(key, []).append(p)
    streams = {}
    for key, pkts in dirs.items():
        pkts.sort(key=lambda x: (x.seq, x.ts))
        buf = bytearray(); last_end = None
        for p in pkts:
            if last_end is not None and p.seq == last_end:
                buf += p.payload
            elif last_end is None:
                buf += p.payload
            elif p.seq > last_end:
                buf += p.payload  # lacuna (pacote perdido) — concatena mesmo assim
            else:
                continue  # retransmissão/sobreposição: ignora
            last_end = p.seq + len(p.payload)
        streams[key] = bytes(buf)
    return streams


def _scan_with_cfg(data, cfg):
    frames, consumed = protocol.decode_frames(data, cfg)
    out = []
    for fr in frames:
        is_pb = protobuf_raw.looks_like_protobuf(fr.payload)
        rec = {
            "cmd_id": fr.cmd_id,                      # CONFIRMADO: int32 após 0x5A
            "payload_len": len(fr.payload),
            "payload_head_hex": fr.payload[:24].hex(),
            "payload_is_protobuf": is_pb,            # evidência (decoder genérico)
        }
        if is_pb:
            try:
                rec["protobuf_raw"] = protobuf_raw.decode_raw(fr.payload)
            except ValueError:
                rec["payload_is_protobuf"] = False
        out.append(rec)
    return out


def analyze_tcp_stream(data, cfg):
    """Testa as DUAS hipóteses de framing e devolve ambas, mais qual é a mais
    provável (a que produz mais frames todos-protobuf-válidos). Nenhuma é
    tratada como fato — o relatório marca as duas como hipótese."""
    import dataclasses
    cfg_nolen = dataclasses.replace(cfg, has_length_field=False)
    cfg_len = dataclasses.replace(cfg, has_length_field=True)
    res = {
        "sem_campo_tamanho": _scan_with_cfg(data, cfg_nolen),
        "com_campo_tamanho_int32be": _scan_with_cfg(data, cfg_len),
    }

    def score(frames):
        if not frames:
            return (0, 0)
        pb = sum(1 for f in frames if f["payload_is_protobuf"])
        return (pb == len(frames), pb)  # prioriza "todos válidos", depois qtd

    best = max(res, key=lambda k: score(res[k]))
    melhor = best if res[best] else None
    return res, melhor


def analyze(path, cfg=None, id_map=None):
    cfg = cfg or config.DEFAULTS
    pkts = pcap_reader.read_packets(path)
    flows = pcap_reader.group_flows(pkts)
    report = {
        "arquivo": os.path.basename(path),
        "pacotes": len(pkts),
        "fluxos": [],
        "confirmado": {
            "sync": "0x5A (>=4 consecutivos)",
            "cmd_id": "int32 big-endian após o sync",
            "tcp_port_esperado": config.TCP_PORT,
            "udp_broadcast": config.UDP_BROADCAST_ADDR,
        },
        "hipoteses": {
            "has_length_field": cfg.has_length_field,
            "fim_de_payload": "campo de tamanho" if cfg.has_length_field
                              else "heurística: até o próximo sync (PROVISÓRIO)",
            "id_map_usado": bool(id_map),
        },
    }
    for key, fl in flows.items():
        ps = fl["packets"]
        entry = {
            "proto": fl["proto"],
            "a": f"{fl['a'][0]}:{fl['a'][1]}",
            "b": f"{fl['b'][0]}:{fl['b'][1]}",
            "pacotes": len(ps),
            "ts_inicio": ps[0].ts, "ts_fim": ps[-1].ts,
            "bytes_total": sum(len(p.payload) for p in ps),
        }
        if fl["proto"] == "TCP" and (config.TCP_PORT in (fl["a"][1], fl["b"][1])):
            entry["papel"] = "provável canal de controle (porta 6400)"
            streams = reassemble_tcp_directions(fl)
            entry["direcoes"] = []
            for (src, dst), data in streams.items():
                res, melhor = analyze_tcp_stream(data, cfg)
                entry["direcoes"].append({
                    "de": f"{src[0]}:{src[1]}", "para": f"{dst[0]}:{dst[1]}",
                    "bytes": len(data),
                    "sync_0x5a_presente": data.count(b"\x5a\x5a\x5a\x5a") > 0,
                    "hipotese_mais_provavel": melhor,  # None se nenhuma casou
                    "framing": {
                        k: {"frames_detectados": len(v),
                            "frames": v[:200]}
                        for k, v in res.items()
                    },
                })
        elif fl["proto"] == "UDP":
            entry["papel"] = "provável descoberta (UDP)"
            entry["amostras"] = []
            for p in ps[:20]:
                is_txt = True
                try:
                    txt = p.payload.decode("utf-8")
                except UnicodeDecodeError:
                    is_txt = False; txt = None
                entry["amostras"].append({
                    "ts": p.ts, "de": f"{p.src_ip}:{p.src_port}",
                    "para": f"{p.dst_ip}:{p.dst_port}", "len": len(p.payload),
                    "texto": txt, "hex": p.payload[:48].hex(),
                    "broadcast": p.dst_ip.endswith(".255") or p.dst_ip == "255.255.255.255",
                })
        report["fluxos"].append(entry)
    return report


def write_outputs(report, outdir):
    os.makedirs(outdir, exist_ok=True)
    jpath = os.path.join(outdir, "analise.json")
    with open(jpath, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    tpath = os.path.join(outdir, "relatorio.txt")
    with open(tpath, "w", encoding="utf-8") as f:
        f.write(render_text(report))
    return jpath, tpath


def render_text(r):
    L = []
    L.append(f"# Análise de captura: {r['arquivo']}")
    L.append(f"Pacotes: {r['pacotes']} | Fluxos: {len(r['fluxos'])}")
    L.append("")
    L.append("CONFIRMADO: sync %s; cmd_id %s; porta TCP %s; broadcast %s" % (
        r['confirmado']['sync'], r['confirmado']['cmd_id'],
        r['confirmado']['tcp_port_esperado'], r['confirmado']['udp_broadcast']))
    L.append("HIPÓTESE: fim de payload = %s" % r['hipoteses']['fim_de_payload'])
    L.append("")
    for fl in r["fluxos"]:
        L.append(f"— Fluxo {fl['proto']}  {fl['a']} <-> {fl['b']}  "
                 f"({fl['pacotes']} pkts, {fl['bytes_total']} bytes) "
                 f"{fl.get('papel','')}")
        from collections import Counter
        for d in fl.get("direcoes", []):
            L.append(f"    {d['de']} -> {d['para']}: {d['bytes']} bytes, "
                     f"sync0x5A={d['sync_0x5a_presente']}, "
                     f"framing provável={d['hipotese_mais_provavel'] or 'indefinido'}")
            for k, v in d["framing"].items():
                frames = v["frames"]
                ids = Counter(fr["cmd_id"] for fr in frames)
                pb = sum(1 for fr in frames if fr["payload_is_protobuf"])
                marca = "  <== provável" if k == d["hipotese_mais_provavel"] else ""
                L.append(f"      [{k}] frames={len(frames)} protobuf_ok={pb}/{len(frames)}{marca}")
                if ids:
                    L.append("         IDs: " + ", ".join(
                        f"{i}×{c}" for i, c in sorted(ids.items())))
        for s in fl.get("amostras", [])[:6]:
            tag = "BROADCAST" if s["broadcast"] else ""
            L.append(f"    UDP {s['de']} -> {s['para']} {tag} len={s['len']} "
                     f"texto={s['texto']!r}")
    L.append("")
    L.append("Lembrete: IDs e sync são CONFIRMADOS; o vínculo id->mensagem e o fim")
    L.append("de payload continuam HIPÓTESE até casar com o esquema e a captura.")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Analisa .pcap da sessão MQ16/DB20P (offline).")
    ap.add_argument("pcap", help="caminho do arquivo .pcap/.pcapng")
    ap.add_argument("-o", "--out", default="pcap_out", help="pasta de saída")
    ap.add_argument("--length", action="store_true",
                    help="assumir campo de tamanho int32 BE após o id (HIPÓTESE)")
    args = ap.parse_args(argv)
    cfg = config.ProvisionalConfig(has_length_field=args.length)
    report = analyze(args.pcap, cfg)
    j, t = write_outputs(report, args.out)
    print(render_text(report))
    print(f"\nArquivos: {j}\n         {t}")


if __name__ == "__main__":
    main()
