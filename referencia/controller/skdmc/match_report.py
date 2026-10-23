"""Relatório comparativo do decodificador dirigido. Tudo rotulado como HIPÓTESE.
Separa OBSERVADO (bytes) de INFERIDO (qual mensagem). Não altera nada."""
import json, argparse, binascii
from . import match, protobuf_raw, commands, messages


def build_report(payload, cmd_id=None, top=5):
    results = match.match_payload(payload, cmd_id=cmd_id, top=top)
    amb = match.ambiguity(results)
    try:
        observed = protobuf_raw.decode_raw(payload)
        observed_ok = True
    except ValueError:
        observed = []
        observed_ok = False
    guess = commands.SEND_PROTO_GUESS.get(cmd_id) if cmd_id is not None else None
    rep = {
        "_aviso": "HIPÓTESE — não validado com frames reais suficientes. "
                  "Nada aqui confirma vínculo ID->mensagem.",
        "cmd_id": cmd_id,
        "id_rotulo_confirmado": commands.SEND_COMMANDS.get(cmd_id),   # semântica (fato)
        "id_mensagem_palpite_provisorio": guess,                      # palpite (NÃO fato)
        "payload_len": len(payload),
        "payload_hex": binascii.hexlify(payload).decode(),
        "observado": {
            "e_protobuf_valido": observed_ok,
            "campos_nos_bytes": observed,   # OBSERVADO: direto dos bytes
        },
        "ambiguidade": amb,
        "candidatas": [],
    }
    for c in results:
        rep["candidatas"].append({
            "mensagem": c.name,                         # INFERIDO
            "score": c.score,
            "parseou": c.ok,
            "roundtrip_byte_a_byte": c.reencode_roundtrip,
            "tags_observadas": c.observed_fields,
            "tags_casadas_no_schema": c.matched_tags,
            "tags_wire_coerente": c.wire_consistent_tags,
            "tags_inexplicadas": c.unknown_tags,
            "bytes_nao_explicados_aprox": c.unexplained_bytes,
            "erro": c.error,
        })
    return rep


def render_text(rep):
    L = []
    L.append("# Decodificador dirigido — RELATÓRIO (HIPÓTESE)")
    L.append(rep["_aviso"])
    L.append("")
    L.append(f"cmd_id: {rep['cmd_id']}  | semântica confirmada do ID: {rep['id_rotulo_confirmado']}")
    if rep["id_mensagem_palpite_provisorio"]:
        L.append(f"palpite provisório de mensagem (NÃO confirmado): {rep['id_mensagem_palpite_provisorio']}")
    L.append(f"payload: {rep['payload_len']} bytes | protobuf válido (observado): "
             f"{rep['observado']['e_protobuf_valido']}")
    obs = rep["observado"]["campos_nos_bytes"]
    if obs:
        tags = ", ".join(f"#{o['field']}({o['wire']})" for o in obs)
        L.append(f"OBSERVADO nos bytes — campos: {tags}")
    L.append("")
    L.append(f"Ambiguidade entre candidatas: {'SIM' if rep['ambiguidade'] else 'não'}")
    L.append("Candidatas (ordenadas por score heurístico; INFERÊNCIA):")
    L.append("  score  parse  rt  msg  (casadas/observadas, wire-ok, inexplicadas)")
    for c in rep["candidatas"]:
        L.append("  %5.2f  %-5s  %-3s %s  (%d/%d casadas, %d wire-ok, %d inexpl.)" % (
            c["score"], "ok" if c["parseou"] else "ERRO",
            "sim" if c["roundtrip_byte_a_byte"] else "não",
            c["mensagem"], len(c["tags_casadas_no_schema"]),
            len(c["tags_observadas"]), len(c["tags_wire_coerente"]),
            len(c["tags_inexplicadas"])))
        if c["erro"]:
            L.append(f"         erro: {c['erro']}")
    L.append("")
    L.append("Como ler: 'score' é heurística (ver match.score_candidate). "
             "'rt' = reencode bate byte-a-byte (sinal forte). Campos OBSERVADOS vêm "
             "dos bytes; a MENSAGEM é inferência e segue hipótese até validar com "
             "vários frames reais do mesmo ID.")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Decodificador dirigido offline (HIPÓTESE).")
    ap.add_argument("--hex", help="payload em hex (ex.: 1a03...)")
    ap.add_argument("--file", help="arquivo binário com o payload")
    ap.add_argument("--id", type=int, default=None, help="ID de comando (opcional)")
    ap.add_argument("--candidates", help="lista separada por vírgula p/ forçar candidatas")
    ap.add_argument("--top", type=int, default=5)
    ap.add_argument("--json", action="store_true", help="saída JSON")
    args = ap.parse_args(argv)
    if args.hex:
        payload = binascii.unhexlify(args.hex.strip().replace(" ", ""))
    elif args.file:
        payload = open(args.file, "rb").read()
    else:
        ap.error("informe --hex ou --file")
    cands = args.candidates.split(",") if args.candidates else None
    if cands:
        results = match.match_payload(payload, cmd_id=args.id, candidates=cands, top=args.top)
        rep = build_report(payload, cmd_id=args.id, top=args.top)
    else:
        rep = build_report(payload, cmd_id=args.id, top=args.top)
    if args.json:
        print(json.dumps(rep, ensure_ascii=False, indent=2))
    else:
        print(render_text(rep))


if __name__ == "__main__":
    main()
