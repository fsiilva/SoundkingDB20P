"""Decodificador DIRIGIDO (offline): dado um ID de comando e um payload capturado,
testa mensagens protobuf candidatas do descset e mede o encaixe.

Princípios:
  - NÃO inventa nem altera descritores/campos. Usa só o skdmc.descset real.
  - Separa o OBSERVADO (campos realmente presentes nos bytes, via decoder
    genérico sem esquema) do INFERIDO (qual mensagem seria).
  - Todo resultado é HIPÓTESE até casar com frames reais suficientes.
  - Não mexe em config.py nem "promove" hipótese a fato.
"""
from dataclasses import dataclass, field as dc_field
from . import messages, protobuf_raw, commands

# tipos protobuf -> wire type esperado (para checar coerência observação x esquema)
# (números de FieldDescriptorProto.type)
_TYPE_WIRE = {
    1: {1}, 2: {5}, 3: {0}, 4: {0}, 5: {0}, 6: {1}, 7: {5}, 8: {0},      # double,float,int64,uint64,int32,fixed64,fixed32,bool
    9: {2}, 10: {2}, 11: {2}, 12: {2}, 13: {0}, 14: {0},                  # string,group,message,bytes,uint32,enum
    15: {5}, 16: {1}, 17: {0}, 18: {0},                                   # sfixed32,sfixed64,sint32,sint64
}


@dataclass
class Candidate:
    name: str
    ok: bool                       # ParseFromString sem erro
    score: float                   # 0..1 heurística de compatibilidade
    observed_fields: list          # tags realmente nos bytes (observado)
    schema_fields: dict            # tag -> (nome, tipo) do descritor (fato do schema)
    matched_tags: list             # tags presentes nos bytes QUE existem no schema
    wire_consistent_tags: list     # dessas, as com wire-type coerente
    unknown_tags: list             # tags nos bytes SEM campo no schema (inexplicado)
    reencode_roundtrip: bool       # reencoda igual aos bytes originais? (forte sinal)
    unexplained_bytes: int         # bytes que sobram no roundtrip
    error: str = ""


def _schema_fields(msg_cls):
    out = {}
    for f in msg_cls.DESCRIPTOR.fields:
        out[f.number] = (f.name, f.type)
    return out


def score_candidate(name, payload, msg_cls=None):
    """Pontua uma mensagem candidata contra o payload. Documentação da nota:
      - base 0 se nem parseia;
      - +0.40 se ParseFromString não levanta erro;
      - +0.30 * (tags observadas que existem no schema / tags observadas);
      - +0.20 * (dessas, as com wire-type coerente / tags casadas);
      - +0.10 se o reencode bate byte-a-byte com o payload (roundtrip perfeito).
    Penaliza tags inexplicadas implicitamente (reduzem a fração casada).
    A nota é uma HEURÍSTICA de plausibilidade, não prova.
    """
    if msg_cls is None:
        msg_cls = messages.get_message_class(name)
    sch = _schema_fields(msg_cls)

    # OBSERVADO: o que está de fato nos bytes (sem esquema)
    try:
        observed = protobuf_raw.decode_raw(payload)
    except ValueError:
        observed = None

    obs_tags = sorted({o["field"] for o in observed}) if observed else []
    obs_wire = {}
    if observed:
        wmap = {"varint": 0, "i64": 1, "len": 2, "i32": 5}
        for o in observed:
            obs_wire.setdefault(o["field"], set()).add(wmap.get(o["wire"], -1))

    matched = [t for t in obs_tags if t in sch]
    unknown = [t for t in obs_tags if t not in sch]
    wire_ok = []
    for t in matched:
        exp = _TYPE_WIRE.get(sch[t][1], set())
        if obs_wire.get(t, set()) & exp:
            wire_ok.append(t)

    # parse estrito com o esquema + roundtrip
    ok = False
    roundtrip = False
    unexplained = 0
    err = ""
    msg = msg_cls()
    try:
        n = msg.MergeFromString(payload)  # retorna nº de bytes consumidos
        ok = True
        re = msg.SerializeToString()
        roundtrip = (re == payload)
        if not roundtrip:
            # bytes não explicados ~ diferença de tamanho (aprox., observacional)
            unexplained = abs(len(payload) - len(re))
    except Exception as e:
        err = type(e).__name__ + ": " + str(e)[:120]

    s = 0.0
    if ok:
        s += 0.40
    if obs_tags:
        s += 0.30 * (len(matched) / len(obs_tags))
    if matched:
        s += 0.20 * (len(wire_ok) / len(matched))
    if roundtrip:
        s += 0.10

    return Candidate(
        name=name, ok=ok, score=round(s, 4),
        observed_fields=obs_tags, schema_fields=sch,
        matched_tags=matched, wire_consistent_tags=wire_ok,
        unknown_tags=unknown, reencode_roundtrip=roundtrip,
        unexplained_bytes=unexplained, error=err,
    )


def candidate_names(cmd_id=None):
    """Lista de mensagens candidatas. Se houver um PALPITE provisório para o ID
    (commands.SEND_PROTO_GUESS), ele entra primeiro — mas marcado como palpite,
    não como fato. Sem palpite, devolve todas as mensagens do app."""
    allm = [fq.split(".")[-1] for fq, _ in messages.list_messages()]
    allm = sorted(set(allm))
    guess = commands.SEND_PROTO_GUESS.get(cmd_id) if cmd_id is not None else None
    if guess and guess in allm:
        return [guess] + [m for m in allm if m != guess]
    return allm


def match_payload(payload, cmd_id=None, candidates=None, top=5):
    """Testa candidatas e devolve as melhores por score. Resultado é HIPÓTESE."""
    names = candidates or candidate_names(cmd_id)
    results = []
    for nm in names:
        try:
            results.append(score_candidate(nm, payload))
        except Exception:
            continue
    results.sort(key=lambda c: (c.score, c.reencode_roundtrip, -c.unexplained_bytes), reverse=True)
    return results[:top]


def ambiguity(results, margin=0.08):
    """Há ambiguidade se o 2º colocado está a <margin do 1º (ou empate em roundtrip)."""
    if len(results) < 2:
        return False
    return (results[0].score - results[1].score) < margin
