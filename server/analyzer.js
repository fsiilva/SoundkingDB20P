/**
 * Analisador de frequência e cálculo de curvas de equalização (consultivo e DSP).
 * Baseado no modelo matemático comprovado do controlador de referência.
 */

export const BANDS_HZ = [
  { lo: 20, hi: 250, name: 'graves' },
  { lo: 250, hi: 2000, name: 'médios' },
  { lo: 2000, hi: 20000, name: 'agudos' },
];

/**
 * Resposta em magnitude (dB) de um filtro biquad peaking RBJ.
 * Taxa de amostragem padrão fs = 48000 Hz da DB20P.
 */
export function peakingDb(f, fc, gainDb, q = 1.0, fs = 48000.0) {
  if (gainDb === 0) return 0.0;
  const safeQ = Math.max(q, 0.001);
  const A = 10 ** (gainDb / 40.0);
  const w0 = (2 * Math.PI * fc) / fs;
  const alpha = Math.sin(w0) / (2 * safeQ);
  const cw = Math.cos(w0);

  const b0 = 1 + alpha * A;
  const b1 = -2 * cw;
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * cw;
  const a2 = 1 - alpha / A;

  const w = (2 * Math.PI * f) / fs;
  const cosw = Math.cos(w);
  const sinw = Math.sin(w);
  const cos2w = Math.cos(2 * w);
  const sin2w = Math.sin(2 * w);

  const numRe = b0 + b1 * cosw + b2 * cos2w;
  const numIm = -(b1 * sinw + b2 * sin2w);
  const denRe = a0 + a1 * cosw + a2 * cos2w;
  const denIm = -(a1 * sinw + a2 * sin2w);

  const num = Math.hypot(numRe, numIm);
  const den = Math.hypot(denRe, denIm);
  if (den === 0) return 0.0;
  return 20 * Math.log10(num / den);
}

/**
 * Calcula a curva de EQ completa somando a resposta das bandas ativas.
 */
export function eqCurve(bands, points = 96, fmin = 20, fmax = 20000) {
  if (!Array.isArray(bands) || bands.length === 0) return [];
  const freqs = Array.from({ length: points }, (_, i) => fmin * (fmax / fmin) ** (i / (points - 1)));
  return freqs.map(f => {
    let total = 0.0;
    for (const b of bands) {
      if (b.bypass) continue;
      const fc = b.fc ?? b.freq ?? 1000;
      const gain = b.gain ?? 0;
      const q = b.q ?? 1.0;
      total += peakingDb(f, fc, gain, q);
    }
    return [Math.round(f * 10) / 10, Math.round(total * 100) / 100];
  });
}

/**
 * Gera espectro demonstrativo sintético rotulado como simulado.
 */
export function simulatedSpectrum(seed = 0, points = 64, fmin = 20, fmax = 20000) {
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const freqs = Array.from({ length: points }, (_, i) => fmin * (fmax / fmin) ** (i / (points - 1)));
  const pontos = freqs.map(f => {
    const base = f > 100 ? -20 - 12 * Math.log10(f / 100.0) : -20 + (f - 100) * 0.05;
    const val = base + (rand() * 8 - 4);
    return [Math.round(f * 10) / 10, Math.round(val * 10) / 10];
  });
  return { _simulado: true, pontos };
}

/**
 * Calcula energia aproximada por região de frequência.
 */
export function bandEnergy(spectrumPoints) {
  const out = {};
  for (const { lo, hi, name } of BANDS_HZ) {
    const vals = spectrumPoints.filter(([f]) => f >= lo && f < hi).map(([, v]) => v);
    out[name] = vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  }
  return out;
}

/**
 * Motor consultivo de sugestões de equalização (não aplica nada automaticamente).
 */
export function suggestions(spectrumPoints, objetivo = null) {
  const energy = bandEnergy(spectrumPoints);
  const sug = [];

  const add = (obj, freqHz, deltaDb, q, motivo) => {
    sug.push({
      objetivo: obj,
      acao: 'ajustar EQ',
      freq_hz: freqHz,
      delta_db: deltaDb,
      q,
      motivo,
      status: 'sugerido',
      _hipotese: true,
    });
  };

  const g = energy.graves;
  const m = energy.médios;
  const a = energy.agudos;
  const want = objetivo || 'auto';

  if ((want === 'auto' || want === 'reduzir_graves') && g !== null && (m === null || g > (m || -99) + 3)) {
    add('Reduzir excesso de graves', 100.0, -3.0, 0.8, 'Região de graves com mais energia que os médios; corte suave em ~100 Hz.');
  }
  if (want === 'auto' || want === 'inteligibilidade_voz') {
    add('Melhorar inteligibilidade da voz', 3000.0, +2.5, 1.0, 'Realce leve em ~3 kHz tende a melhorar a clareza da voz.');
  }
  if ((want === 'auto' || want === 'controlar_medios') && m !== null && (a === null || m > (a || -99) + 3)) {
    add('Controlar médios agressivos', 800.0, -2.0, 1.2, 'Médios proeminentes podem soar duros; corte moderado em ~800 Hz.');
  }
  if ((want === 'auto' || want === 'reduzir_aspereza_agudos') && a !== null && a > -18) {
    add('Reduzir aspereza nos agudos', 6000.0, -2.0, 1.0, 'Energia alta em agudos; corte suave em ~6 kHz reduz aspereza.');
  }

  return {
    _aviso: 'Sugestões CONSULTIVAS baseadas em espectro simulado. Não alteram a mesa.',
    energia_por_regiao: energy,
    sugestoes: sug,
  };
}
