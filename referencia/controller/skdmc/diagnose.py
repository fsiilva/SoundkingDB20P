"""Fluxo ÚNICO de diagnóstico offline de uma captura .pcap/.pcapng.

Orquestra os módulos existentes (NÃO duplica lógica):
  - pcap_reader: lê pacotes e agrupa fluxos;
  - pcap_analyze: reassembla TCP e acha frames 0x5A (as duas hipóteses de framing);
  - protocol.decode_frames: extrai (id, payload) dos frames;
  - match: compara cada payload com os descritores protobuf (campos reconhecidos,
    bytes não explicados, ambiguidade);
  - protobuf_raw: confirma payload protobuf.

Produz: resumo de portas/endereços/horários, frames candidatos, comparação com o
esquema, e um RELATÓRIO DE DESCOBERTA em JSON + Markdown que separa claramente
FATOS OBSERVADOS de HIPÓTESES. Nada é inventado: tudo aponta para bytes da captura.

Uso:  python3 -m skdmc.diagnose CAPTURA.pcap -o pasta_saida [--length]
"""
import os, sys, json, argparse
from collections import Counter, defaultdict
from . import pcap_reader, pcap_analyze, protocol, match, protobuf_raw, config, commands


def observed_summary(packets):
    """FATOS: hosts, portas, janela de tempo, contagem por protocolo. Só da captura."""
    if not packets:
        return {"pacotes": 0}
    ts = [p.ts for p in packets if p.ts]
    hosts = Counter()
    ports = Counter()
    proto = Counter()
    for p in packets:
        proto[p.proto] += 1
        hosts[p.src_ip] += 1
        hosts[p.dst_ip] += 1
        if p.proto in ("TCP", "UDP"):
            ports[(p.proto, p.dst_port)] += 1
    return {
        "pacotes": len(packets),
        "por_protocolo": dict(proto),
        "janela_tempo": {"inicio": min(ts) if ts else None, "fim": max(ts) if ts else None,
                          "duracao_s": round(max(ts) - min(ts), 3) if ts else None},
        "hosts": [{"ip": ip, "pacotes": n} for ip, n in hosts.most_common()],
        "portas_destino": [{"proto": pr, "porta": pt, "pacotes": n}
                            for (pr, pt), n in ports.most_common(20)],
    }


def tcp_control_frames(packets, cfg):
    """Extrai frames (id,payload) dos fluxos TCP na porta de controle, nas duas
    hipóteses de framing. Reusa reassemble + protocol.decode_frames (existentes)."""
    flows = pcap_reader.group_flows(packets)
    out = []
    import dataclasses
    for key, fl in flows.items():
        if fl["proto"] != "TCP":
            continue
        if config.TCP_PORT not in (fl["a"][1], fl["b"][1]):
            continue
        streams = pcap_analyze.reassemble_tcp_directions(fl)
        for (src, dst), data in streams.items():
            dirinfo = {"de": f"{src[0]}:{src[1]}", "para": f"{dst[0]}:{dst[1]}",
                        "bytes": len(data), "sync_0x5a": data.count(b"\x5a\x5a\x5a\x5a"),
                        "hipoteses": {}}
            best = None
            for hyp, has_len in (("sem_campo_tamanho", False), ("com_campo_tamanho_int32be", True)):
                frames, _ = protocol.decode_frames(data, dataclasses.replace(cfg, has_length_field=has_len))
                recs = []
                pb_ok = 0
                for fr in frames:
                    is_pb = protobuf_raw.looks_like_protobuf(fr.payload)
                    pb_ok += 1 if is_pb else 0
                    recs.append({"cmd_id": fr.cmd_id, "payload_len": len(fr.payload),
                                 "payload_hex": fr.payload[:40].hex(), "payload": fr.payload,
                                 "is_protobuf": is_pb})
                dirinfo["hipoteses"][hyp] = {"frames": len(frames), "protobuf_ok": pb_ok, "recs": recs}
            # hipótese provável = a que tem mais frames todos-protobuf
            def sc(h): r = dirinfo["hipoteses"][h]; return (r["frames"] > 0 and r["protobuf_ok"] == r["frames"], r["protobuf_ok"])
            best = max(dirinfo["hipoteses"], key=sc)
            dirinfo["hipotese_provavel"] = best if dirinfo["hipoteses"][best]["frames"] else None
            out.append(dirinfo)
    return out


def match_frames(dirinfo, top=3):
    """Para a hipótese provável, compara cada payload com os descritores (match).
    Agrega por cmd_id os candidatos recorrentes. Resultado é HIPÓTESE."""
    hyp = dirinfo.get("hipotese_provavel")
    if not hyp:
        return {}
    by_id = defaultdict(lambda: {"amostras": 0, "candidatos": Counter(),
                                  "ambiguo": 0, "campos_observados": Counter(),
                                  "exemplos": []})
    for rec in dirinfo["hipoteses"][hyp]["recs"]:
        cid = rec["cmd_id"]
        slot = by_id[cid]
        slot["amostras"] += 1
        results = match.match_payload(rec["payload"], cmd_id=cid, top=top)
        if match.ambiguity(results):
            slot["ambiguo"] += 1
        for c in results[:top]:
            slot["candidatos"][c.name] += 1
        # campos observados (genérico, sem esquema)
        try:
            for f in protobuf_raw.decode_raw(rec["payload"]):
                slot["campos_observados"][f["field"]] += 1
        except ValueError:
            pass
        if len(slot["exemplos"]) < 2:
            best = results[0] if results else None
            slot["exemplos"].append({
                "payload_hex": rec["payload_hex"],
                "melhor_candidato": best.name if best else None,
                "score": best.score if best else None,
                "roundtrip": best.reencode_roundtrip if best else None,
                "tags_casadas": best.matched_tags if best else [],
                "tags_inexplicadas": best.unknown_tags if best else [],
                "bytes_nao_explicados": best.unexplained_bytes if best else None,
            })
    # serializa Counters
    out = {}
    for cid, s in by_id.items():
        out[cid] = {
            "semantica_confirmada": commands.SEND_COMMANDS.get(cid),
            "amostras": s["amostras"],
            "candidatos_top": s["candidatos"].most_common(top),
            "fracao_ambigua": round(s["ambiguo"] / s["amostras"], 2) if s["amostras"] else 0,
            "campos_observados": sorted(s["campos_observados"].items()),
            "exemplos": s["exemplos"],
        }
    return out


def diagnose(path, cfg=None):
    cfg = cfg or config.DEFAULTS
    packets = pcap_reader.read_packets(path)
    summary = observed_summary(packets)
    base = pcap_analyze.analyze(path, cfg)        # fluxos + UDP (reuso)
    tcp = tcp_control_frames(packets, cfg)
    matches = [match_frames(d) for d in tcp]
    return {
        "_aviso": "Resultados apontam para bytes DA CAPTURA. IDs/sync observados; "
                  "vínculo id->mensagem e framing seguem HIPÓTESE até validação.",
        "arquivo": os.path.basename(path),
        "fatos_observados": summary,
        "fluxos": base["fluxos"],
        "controle_tcp": [{**d, "hipoteses": {k: {"frames": v["frames"], "protobuf_ok": v["protobuf_ok"]}
                                              for k, v in d["hipoteses"].items()},
                          "match_por_id": m}
                         for d, m in zip(tcp, matches)],
    }


def render_md(rep):
    s = rep["fatos_observados"]
    L = [f"# Relatório de descoberta — {rep['arquivo']}", "", rep["_aviso"], ""]
    L.append("## 1. Fatos observados (da captura)")
    if s.get("pacotes"):
        jt = s["janela_tempo"]
        L.append(f"- Pacotes: **{s['pacotes']}** · por protocolo: {s['por_protocolo']}")
        L.append(f"- Janela de tempo: {jt['inicio']} → {jt['fim']} ({jt['duracao_s']} s)")
        L.append(f"- Hosts: " + ", ".join(f"{h['ip']} ({h['pacotes']})" for h in s['hosts'][:8]))
        L.append("- Portas de destino mais vistas:")
        for p in s["portas_destino"][:8]:
            L.append(f"  - {p['proto']} {p['porta']} — {p['pacotes']} pkts")
    else:
        L.append("- (captura vazia ou ilegível)")
    L.append("")
    L.append("## 2. Framing e comprimentos candidatos")
    L.append("- CONFIRMADO (estático): sync `0x5A` (≥4) + `int32` big-endian = ID do comando.")
    for d in rep["controle_tcp"]:
        L.append(f"- Fluxo {d['de']} → {d['para']}: {d['bytes']} bytes, "
                 f"sync0x5A={d['sync_0x5a']}, framing provável = **{d['hipotese_provavel'] or 'indefinido'}**")
        for k, v in d["hipoteses"].items():
            L.append(f"  - [{k}] frames={v['frames']} protobuf_ok={v['protobuf_ok']}")
    L.append("")
    L.append("## 3. Mapeamento de IDs e canais candidatos (HIPÓTESE)")
    any_id = False
    for d in rep["controle_tcp"]:
        for cid, m in sorted(d.get("match_por_id", {}).items()):
            any_id = True
            cands = ", ".join(f"{n}×{c}" for n, c in m["candidatos_top"]) or "—"
            L.append(f"- ID **{cid}** ({m['semantica_confirmada'] or 'semântica?'}): "
                     f"{m['amostras']} amostra(s), ambígua={m['fracao_ambigua']}, "
                     f"campos observados={[f for f,_ in m['campos_observados']]}")
            L.append(f"  - candidatos: {cands}")
    if not any_id:
        L.append("- (nenhum frame de controle na captura)")
    L.append("")
    L.append("## 4. Possíveis requisitos de inicialização / sessão")
    L.append("- Observar o PRIMEIRO frame de cada direção (quem fala primeiro, qual ID).")
    L.append("- Procurar troca inicial antes dos comandos (possível login/handshake).")
    L.append("- Confirmar se há um 'start data' pedindo o snapshot `AllData` (visto no estático).")
    L.append("")
    L.append("## 5. Próxima evidência necessária (por dúvida)")
    L.append("| Dúvida | Evidência que resolve |")
    L.append("| --- | --- |")
    L.append("| Campo de tamanho no frame? | Comparar as duas hipóteses: a que der 100% protobuf-válido vence |")
    L.append("| Porta/bytes da descoberta UDP | Capturar o broadcast ao abrir o app |")
    L.append("| ID → mensagem exata | Vários frames do mesmo ID + roundtrip byte-a-byte |")
    L.append("| moduleId → canal físico | Mexer um controle por vez e ver qual id/campo muda |")
    L.append("| Login/sessão | Ver se há troca antes do primeiro comando |")
    return "\n".join(L)


def _clean_for_json(obj):
    # remove bytes crus ('payload') que não serializam
    if isinstance(obj, dict):
        return {k: _clean_for_json(v) for k, v in obj.items() if k != "payload"}
    if isinstance(obj, list):
        return [_clean_for_json(x) for x in obj]
    if isinstance(obj, bytes):
        return obj.hex()
    return obj


def main(argv=None):
    ap = argparse.ArgumentParser(description="Diagnóstico offline de captura (.pcap/.pcapng).")
    ap.add_argument("pcap", help="arquivo de captura")
    ap.add_argument("-o", "--out", default="diagnostico", help="pasta de saída")
    ap.add_argument("--length", action="store_true",
                    help="assumir campo de tamanho int32 BE (apenas força a hipótese base)")
    args = ap.parse_args(argv)
    cfg = config.ProvisionalConfig(has_length_field=args.length)
    rep = diagnose(args.pcap, cfg)
    os.makedirs(args.out, exist_ok=True)
    jpath = os.path.join(args.out, "diagnostico.json")
    mpath = os.path.join(args.out, "relatorio.md")
    json.dump(_clean_for_json(rep), open(jpath, "w"), ensure_ascii=False, indent=2)
    open(mpath, "w").write(render_md(rep))
    print(render_md(rep))
    print(f"\nArquivos: {jpath}\n         {mpath}")


if __name__ == "__main__":
    main()
