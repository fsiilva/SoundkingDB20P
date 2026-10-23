"""Analisador de frequência (consultivo, offline).

Duas partes bem separadas:
  1. CURVA DE EQ (matemática real): dada a configuração de bandas (fc, ganho dB, Q),
     calcula a resposta em magnitude. Isso VISUALIZA o ajuste do usuário — é
     cálculo DSP padrão (filtros biquad RBJ), não é medição da mesa.
  2. ESPECTRO (SIMULADO): sem fonte de áudio real, o espectro é gerado
     sinteticamente e DEVE ser rotulado como simulado na interface. Documenta-se
     aqui o que seria necessário para dados reais.

As sugestões são CONSULTIVAS: nunca alteram a mesa nem o estado automaticamente.

Para espectro REAL seria necessário: uma fonte de áudio (ex.: retorno USB da mesa,
ou entrada de linha/menu de um dispositivo de captura no Mac) + FFT do sinal.
Nada disso existe nesta fase; ver README.
"""
import math

BANDS_HZ = [(20, 250, "graves"), (250, 2000, "médios"), (2000, 20000, "agudos")]


def _peaking_db(f, fc, gain_db, q):
    """Resposta (dB) de um filtro peaking RBJ em f, com centro fc, ganho e Q.
    Cálculo DSP padrão; assume fs=48000 (declarado em SetupInfoModel.isRate48KHz)."""
    if gain_db == 0:
        return 0.0
    fs = 48000.0
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * fc / fs
    alpha = math.sin(w0) / (2 * max(q, 1e-3))
    cw = math.cos(w0)
    b0 = 1 + alpha * A
    b1 = -2 * cw
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cw
    a2 = 1 - alpha / A
    w = 2 * math.pi * f / fs
    cosw, sinw = math.cos(w), math.sin(w)
    # H(e^jw) magnitude
    def mag(c0, c1, c2):
        re = c0 + c1 * cosw + c2 * math.cos(2 * w)
        im = -(c1 * sinw + c2 * math.sin(2 * w))
        return math.hypot(re, im)
    num = mag(b0, b1, b2)
    den = mag(a0, a1, a2)
    if den == 0:
        return 0.0
    return 20 * math.log10(num / den)


def eq_curve(bands, points=96, fmin=20, fmax=20000):
    """bands: lista de dicts {fc, gain, q, bypass}. Retorna [(freq, dB)] somando
    as bandas ativas. Matemática real (visualização do ajuste)."""
    freqs = [fmin * (fmax / fmin) ** (i / (points - 1)) for i in range(points)]
    curve = []
    for f in freqs:
        total = 0.0
        for b in bands:
            if b.get("bypass"):
                continue
            total += _peaking_db(f, b["fc"], b.get("gain", 0.0), b.get("q", 1.0))
        curve.append((round(f, 1), round(total, 2)))
    return curve


def simulated_spectrum(seed=0, points=64, fmin=20, fmax=20000):
    """Espectro SIMULADO (sem áudio real). Rotular claramente na UI.
    Gera uma curva plausível (mais energia nos graves/médios) só para a interface."""
    import random
    r = random.Random(seed)
    freqs = [fmin * (fmax / fmin) ** (i / (points - 1)) for i in range(points)]
    out = []
    for f in freqs:
        base = -20 - 12 * math.log10(f / 100.0) if f > 100 else -20 + (f - 100) * 0.05
        val = base + r.uniform(-4, 4)
        out.append((round(f, 1), round(val, 1)))
    return {"_simulado": True, "pontos": out}


def band_energy(spectrum_points):
    """Resumo por região (graves/médios/agudos) do espectro dado. Observacional
    sobre os pontos fornecidos (sejam simulados ou, no futuro, reais)."""
    out = {}
    for lo, hi, nome in BANDS_HZ:
        vals = [v for f, v in spectrum_points if lo <= f < hi]
        out[nome] = round(sum(vals) / len(vals), 1) if vals else None
    return out


# --- Motor de SUGESTÕES (consultivo) ---
# Cada regra é explicada. As sugestões propõem ajuste de banda de EQ; o usuário
# aceita/rejeita individualmente. NUNCA aplica sozinho.
def suggestions(spectrum_points, objetivo=None):
    energy = band_energy(spectrum_points)
    sug = []

    def add(objetivo, banda_fc, delta_db, q, motivo):
        sug.append({
            "objetivo": objetivo, "acao": "ajustar EQ",
            "freq_hz": banda_fc, "delta_db": delta_db, "q": q,
            "motivo": motivo, "status": "sugerido",  # sugerido|aceito|rejeitado
            "_hipotese": True,
        })

    g = energy.get("graves"); m = energy.get("médios"); a = energy.get("agudos")
    want = objetivo or "auto"
    if want in ("auto", "reduzir_graves") and g is not None and (m is None or g > (m or -99) + 3):
        add("Reduzir excesso de graves", 100.0, -3.0, 0.8,
            "Região de graves com mais energia que os médios; corte suave em ~100 Hz.")
    if want in ("auto", "inteligibilidade_voz"):
        add("Melhorar inteligibilidade da voz", 3000.0, +2.5, 1.0,
            "Realce leve em ~3 kHz tende a melhorar a clareza da voz.")
    if want in ("auto", "controlar_medios") and m is not None and (m > (a or -99) + 3):
        add("Controlar médios agressivos", 800.0, -2.0, 1.2,
            "Médios proeminentes podem soar duros; corte moderado em ~800 Hz.")
    if want in ("auto", "reduzir_aspereza_agudos") and a is not None and a > -18:
        add("Reduzir aspereza nos agudos", 6000.0, -2.0, 1.0,
            "Energia alta em agudos; corte suave em ~6 kHz reduz aspereza.")
    return {"_aviso": "Sugestões CONSULTIVAS baseadas em espectro simulado. "
                       "Não alteram a mesa. Revise antes de aplicar.",
            "energia_por_regiao": energy, "sugestoes": sug}
