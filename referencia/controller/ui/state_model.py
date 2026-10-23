"""Monta um ESTADO SIMULADO do mixer a partir do esquema REAL (skdmc.descset) e
do layout de canais OBSERVADO no app oficial (strings do binário iOS):
  - Entradas: Ch1..Ch8 (IN1) + Ch9..Ch12 (IN2) + ST1, ST2, PDIF, USB
  - Buses: Bus1..Bus8
  - Master L/R
Tudo marcado como simulado. NÃO é dado da mesa. Os campos usados existem no
esquema (EqPartModel, MicInDynamicPartModel, MicInOutputPartModel, etc.).
"""
import os, sys, json, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skdmc import messages

# Layout OBSERVADO (binário iOS: busSendIN1Ch1..8, IN2 Ch9..12, ST1, ST2, PDIF, USB)
INPUT_LAYOUT = (
    [{"id": i, "name": f"Ch {i}", "kind": "mono"} for i in range(1, 9)] +
    [{"id": i, "name": f"Ch {i}", "kind": "mono"} for i in range(9, 13)] +
    [{"id": 13, "name": "ST1", "kind": "stereo"},
     {"id": 14, "name": "ST2", "kind": "stereo"},
     {"id": 15, "name": "PDIF", "kind": "stereo"},
     {"id": 16, "name": "USB", "kind": "stereo"}]
)
BUS_COUNT = 8  # Bus1..Bus8 (observado)

# Bandas de EQ confirmadas no esquema (EqPartModel): high, highMid, lowMid, low
EQ_BANDS = ["low", "lowMid", "highMid", "high"]
# Frequências centrais de PARTIDA (apenas para visualização inicial; NÃO são
# faixas confirmadas da DB20P — rotular como padrão de exibição).
EQ_DEFAULT_FC = {"low": 100.0, "lowMid": 500.0, "highMid": 2000.0, "high": 8000.0}


def _rng(seed):
    r = random.Random(seed)
    return r


def build_state(seed=42, with_meters=True):
    r = _rng(seed)
    channels = []
    for ch in INPUT_LAYOUT:
        i = ch["id"]
        gain = round(r.uniform(-18, 6), 1)           # valor de fader (unidade NÃO confirmada)
        eq = {b: {"fc": EQ_DEFAULT_FC[b], "gain": round(r.uniform(-4, 4), 1), "q": 1.0,
                  "bypass": False} for b in EQ_BANDS}
        channels.append({
            "moduleId": i,
            "name": ch["name"],
            "kind": ch["kind"],
            "fader": gain,                 # MicInOutputPartModel.outFaderValue (nome do campo)
            "mute": (i % 7 == 0),
            "solo": False,
            "pan": round(r.uniform(-1, 1), 2),
            "input": {"phantom48v": (ch["kind"] == "mono" and i <= 8 and i % 3 == 0),
                       "hpf": i % 4 == 0, "trim": round(r.uniform(-6, 12), 1)},
            "eq": eq,
            # campos de dinâmica = os que EXISTEM no esquema (MicInDynamicPartModel).
            # Valores simulados; unidades (dB/ms) NÃO confirmadas na mesa.
            "dyn": {
                "gate": {"enabled": i % 5 == 0,
                          "threshold": round(r.uniform(-60, -20), 1),
                          "attack": round(r.uniform(0.5, 20), 1),
                          "release": round(r.uniform(20, 400), 0),
                          "hold": round(r.uniform(0, 200), 0),
                          "depth": round(r.uniform(-60, -10), 1)},
                "comp": {"enabled": i % 4 == 0,
                          "threshold": round(r.uniform(-30, -6), 1),
                          "ratio": round(r.choice([2, 3, 4, 6, 8]), 1),
                          "attack": round(r.uniform(1, 50), 1),
                          "release": round(r.uniform(30, 500), 0),
                          "gain": round(r.uniform(0, 12), 1)}},
            "busSends": [round(r.uniform(-30, 0), 1) for _ in range(BUS_COUNT)],
            "meter": round(r.uniform(-48, -6), 1) if with_meters else None,  # SIMULADO
        })
    buses = [{"moduleId": b, "name": f"Bus {b}", "fader": round(r.uniform(-12, 3), 1),
              "mute": False, "meter": round(r.uniform(-40, -8), 1) if with_meters else None}
             for b in range(1, BUS_COUNT + 1)]
    state = {
        "_simulado": True,
        "_origem": "ESTADO SIMULADO — não veio da mesa (fixture gerada do esquema)",
        "_meters_simulados": with_meters,
        "connection": {"status": "desconectado", "allow_network": False,
                        "host": "192.168.43.1", "port": 6400,
                        "nota": "Rede desativada nesta fase. Nada é enviado à mesa."},
        "master": {"faderL": round(r.uniform(-6, 3), 1), "faderR": round(r.uniform(-6, 3), 1),
                    "mute": False, "hpf": False,
                    "meterL": round(r.uniform(-30, -6), 1) if with_meters else None,
                    "meterR": round(r.uniform(-30, -6), 1) if with_meters else None},
        "channels": channels,
        "buses": buses,
    }
    return state


def validate_against_schema():
    """Confere que os campos que usamos existem no esquema real (fato)."""
    checks = {}
    eq = messages.get_message_class("EqPartModel")
    checks["eq_bands"] = all(f"{b}FreqValue" in [x.name for x in eq.DESCRIPTOR.fields]
                             for b in EQ_BANDS)
    dyn = messages.get_message_class("MicInDynamicPartModel")
    dynf = [x.name for x in dyn.DESCRIPTOR.fields]
    checks["gate"] = "gateThresholdValue" in dynf
    checks["comp"] = "compressorTresholdValue" in dynf
    out = messages.get_message_class("MicInOutputPartModel")
    checks["output"] = "outFaderValue" in [x.name for x in out.DESCRIPTOR.fields]
    return checks


if __name__ == "__main__":
    print(json.dumps(build_state(), ensure_ascii=False, indent=2)[:600])
    print("schema checks:", validate_against_schema())
