"""Revisão de FIDELIDADE TÉCNICA: cruza cada parâmetro exposto na UI com o
descritor protobuf (skdmc.descset) e com as evidências do protocolo.

Classifica em três níveis, sem presumir unidade/escala a partir do nome:
  CONFIRMADO  = o campo existe no descritor (fato) OU veio da análise estática.
  PROVÁVEL    = inferência razoável, ainda não validada (ex.: unidade, mapeamento).
  DESCONHECIDO= depende de captura/mesa (faixa, unidade real, moduleId físico).

Gera docs/fidelidade.md e docs/fidelidade.json. Não altera nada do protocolo.
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from skdmc import messages

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs")
os.makedirs(OUT, exist_ok=True)


def field_exists(msg, field):
    try:
        return field in [f.name for f in messages.get_message_class(msg).DESCRIPTOR.fields]
    except Exception:
        return False


# (controle na UI, mensagem, campo no descritor, nível, observação)
ROWS = [
    ("Fader de canal", "MicInOutputPartModel", "outFaderValue", None,
     "Campo existe. Unidade (dB) e faixa: desconhecidas."),
    ("Mute de canal", "MicInOutputPartModel", "isMuteEnable", None, "Booleano confirmado no descritor."),
    ("Solo de canal", "MicInOutputPartModel", "isSoloEnable", None, "Booleano confirmado no descritor."),
    ("Pan de canal", "MicInOutputPartModel", "panValue", None,
     "Campo existe. Faixa real (ex.: -1..1 ou outra) desconhecida."),
    ("48V (phantom)", "MicInInputPartModel", "is48vEnable", None, "Booleano confirmado."),
    ("HPF de entrada", "MicInInputPartModel", "isHPFEnable", None, "Booleano confirmado; hpfValue também existe."),
    ("Trim de entrada", "MicInInputPartModel", "trimValue", None, "Campo existe; unidade/faixa desconhecidas."),
    ("EQ ganho (4 bandas)", "EqPartModel", "highGainValue", None,
     "Campos *GainValue existem p/ high/highMid/lowMid/low. Unidade dB provável; faixa desconhecida."),
    ("EQ frequência", "EqPartModel", "highFreqValue", None,
     "Campos *FreqValue existem. Faixa de Hz por banda NÃO confirmada."),
    ("EQ Q", "EqPartModel", "highQValue", None, "Campos *QValue existem. Faixa de Q desconhecida."),
    ("EQ bypass", "EqPartModel", "isByPass", None, "Booleano confirmado."),
    ("EQ tipo (shelf/peak)", "EqPartModel", "highType", None,
     "highType/lowType existem (int). Semântica dos valores desconhecida."),
    ("Gate threshold", "MicInDynamicPartModel", "gateThresholdValue", None, "Campo existe; unidade/faixa desconhecidas."),
    ("Gate attack/release/hold/depth", "MicInDynamicPartModel", "gateAttackValue", None,
     "gateAttack/Release/Hold/Depth existem; unidades (ms/dB) PROVÁVEIS, não confirmadas."),
    ("Comp threshold/ratio", "MicInDynamicPartModel", "compressorTresholdValue", None,
     "compressorTreshold/Ratio existem; escala do ratio desconhecida."),
    ("Comp attack/release/gain", "MicInDynamicPartModel", "compressorAttackValue", None,
     "compressorAttack/Release/Gain existem; unidades PROVÁVEIS, não confirmadas."),
    ("Envio p/ bus (gain)", "MicInBusModel", "gainValue", None,
     "gainValue/isPrefader/panValue existem. Mapa canal→bus e unidade desconhecidos."),
    ("Nome do canal", "MicInChannelModel", "channelName", None, "String confirmada."),
    ("Master HPF", "SetupInfoModel", "isMasterLrHPFEnable", None,
     "isMasterLrHPFEnable/masterLrHpfValue existem no descritor."),
    ("Bus 8 LPF", "SetupInfoModel", "isBus8LpfEnable", None, "isBus8LpfEnable/bus8LpfValue existem."),
]

# itens SEM campo direto / que são só exibição
EXTRA = [
    ("Fader de bus (valor)", "—", "—", "PROVÁVEL",
     "OutBusModel tem outputModel; o 'fader de bus' provável mas sem campo escalar isolado confirmado. UI = leitura."),
    ("Mute de bus", "—", "—", "DESCONHECIDO",
     "Não há campo 'mute de bus' confirmado no descritor. UI mostra como indicador de leitura."),
    ("Medidores (nível) de canal/bus/master", "MeterLevelData/SetupMeterModel", "gainValue/channelMeterStatue", "DESCONHECIDO",
     "Existe estrutura de meter no descritor, mas a leitura real depende da mesa. Na UI são SIMULADOS."),
    ("Espectro de frequência", "—", "—", "DESCONHECIDO",
     "Não há espectro no protocolo. Requer fonte de áudio real + FFT. Na UI é SIMULADO."),
    ("moduleId → canal/parâmetro físico", "(vários)", "moduleId", "DESCONHECIDO",
     "Todos os modelos têm moduleId, mas o número de cada canal/parâmetro físico só se confirma na captura."),
    ("Framing / fim de payload", "—", "—", "PROVÁVEL",
     "Sync 0x5A + int32 id CONFIRMADOS no estático; campo de tamanho é hipótese até a captura."),
]


def classify():
    out = []
    for ctrl, msg, field, forced, obs in ROWS:
        exists = field_exists(msg, field)
        nivel = forced or ("CONFIRMADO (campo existe)" if exists else "DESCONHECIDO")
        out.append({"controle": ctrl, "mensagem": msg, "campo": field,
                    "campo_existe_no_descritor": exists, "nivel": nivel, "observacao": obs})
    for ctrl, msg, field, nivel, obs in EXTRA:
        out.append({"controle": ctrl, "mensagem": msg, "campo": field,
                    "campo_existe_no_descritor": None, "nivel": nivel, "observacao": obs})
    return out


def main():
    data = classify()
    json.dump(data, open(os.path.join(OUT, "fidelidade.json"), "w"), ensure_ascii=False, indent=2)
    L = ["# Fidelidade técnica — parâmetros x descritor protobuf", "",
         "Classificação sem presumir unidade/escala a partir do nome do campo.", "",
         "| Controle (UI) | Mensagem | Campo | Existe no descritor | Nível | Observação |",
         "| --- | --- | --- | --- | --- | --- |"]
    for d in data:
        ex = "sim" if d["campo_existe_no_descritor"] else ("não" if d["campo_existe_no_descritor"] is False else "—")
        L.append(f"| {d['controle']} | {d['mensagem']} | `{d['campo']}` | {ex} | {d['nivel']} | {d['observacao']} |")
    # contagem
    conf = sum(1 for d in data if str(d["nivel"]).startswith("CONFIRMADO"))
    prov = sum(1 for d in data if d["nivel"] == "PROVÁVEL")
    desc = sum(1 for d in data if d["nivel"] == "DESCONHECIDO")
    L += ["", f"**Resumo:** {conf} campos confirmados no descritor · {prov} prováveis · {desc} desconhecidos.",
          "", "Confirmado = o campo existe no descritor (fato) ou veio da análise estática. "
          "Nenhuma unidade/faixa/escala é tratada como confirmada só porque o campo existe."]
    open(os.path.join(OUT, "fidelidade.md"), "w").write("\n".join(L))
    print("\n".join(L))
    print(f"\nArquivos: {OUT}/fidelidade.md  e  fidelidade.json")


if __name__ == "__main__":
    main()
