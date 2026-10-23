"""Carrega as mensagens Protocol Buffers a partir do descriptor set RECUPERADO
(skdmc.descset). Nada aqui é inventado: as mensagens, campos e tags vêm dos
descritores embarcados no app oficial.

Sem `protoc`: as classes são construídas em runtime a partir do FileDescriptorSet,
usando o descriptor_pool + message_factory do próprio protobuf.
"""
import os
from google.protobuf import descriptor_pb2 as _dpb
from google.protobuf import descriptor_pool as _dp
from google.protobuf import message_factory as _mf

_HERE = os.path.dirname(os.path.abspath(__file__))
DESCSET_PATH = os.path.join(os.path.dirname(_HERE), "skdmc.descset")

PACKAGE = "com.amo.skdmc.data"


def _build_pool(path=DESCSET_PATH):
    with open(path, "rb") as f:
        fds = _dpb.FileDescriptorSet()
        fds.ParseFromString(f.read())
    files = {fd.name: fd for fd in fds.file}
    pool = _dp.DescriptorPool()
    added = set()

    def add(name):
        if name in added or name not in files:
            added.add(name)
            return
        for dep in files[name].dependency:
            add(dep)
        try:
            pool.Add(files[name])
        except Exception:
            pass
        added.add(name)

    for name in files:
        add(name)
    return pool, fds


POOL, _FDS = _build_pool()


def _class_from_desc(desc):
    # protobuf 5.x+: message_factory.GetMessageClass; 4.x: MessageFactory().GetPrototype
    if hasattr(_mf, "GetMessageClass"):
        return _mf.GetMessageClass(desc)
    return _mf.MessageFactory(POOL).GetPrototype(desc)  # 4.x fallback


def get_message_class(short_or_fqname: str):
    """Retorna a classe da mensagem. Aceita 'Command' ou o nome totalmente
    qualificado 'com.amo.skdmc.data.Command'. Compatível com protobuf 4.x e 5.x+."""
    fq = short_or_fqname if "." in short_or_fqname else f"{PACKAGE}.{short_or_fqname}"
    desc = POOL.FindMessageTypeByName(fq)
    return _class_from_desc(desc)


def list_messages():
    """Lista (nome_fq, [(campo, tag, tipo)]) de todas as mensagens do app."""
    out = []
    for fd in _FDS.file:
        if fd.name.startswith("google/protobuf/"):
            continue

        def walk(msg, prefix):
            fq = f"{prefix}.{msg.name}"
            fields = [(f.name, f.number, f.type) for f in msg.field]
            out.append((fq, fields))
            for nt in msg.nested_type:
                if not nt.options.map_entry:
                    walk(nt, fq)

        for m in fd.message_type:
            walk(m, fd.package)
    return out


if __name__ == "__main__":
    msgs = list_messages()
    print(f"mensagens no app: {len(msgs)}")
    for fq, fields in msgs[:5]:
        print(fq, fields[:4])
