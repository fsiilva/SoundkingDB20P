import test from 'node:test';
import assert from 'node:assert/strict';
import { peakingDb, eqCurve, simulatedSpectrum, bandEnergy, suggestions } from './analyzer.js';

test('filtro peaking RBJ: ganho zero retorna 0 dB', () => {
  for (const f of [50, 100, 1000, 5000, 10000]) {
    assert.equal(peakingDb(f, 1000, 0, 1.0), 0.0);
  }
});

test('filtro peaking RBJ: frequência central atinge o ganho programado', () => {
  const gain = 6.0;
  const fc = 1000.0;
  const peak = peakingDb(fc, fc, gain, 1.0);
  assert.ok(Math.abs(peak - gain) < 0.05, `Esperado ~${gain} dB, obtido ${peak} dB`);
});

test('eqCurve soma as bandas ativas e ignora bandas em bypass', () => {
  const bands = [
    { fc: 100, gain: 4, q: 1.0 },
    { fc: 1000, gain: -3, q: 1.0 },
    { fc: 5000, gain: 6, q: 1.0, bypass: true }, // em bypass
  ];
  const curve = eqCurve(bands, 96);
  assert.equal(curve.length, 96);
  // Frequência de 100 Hz deve ter ganho positivo próximo a 4 dB
  const pt100 = curve.find(([f]) => Math.abs(f - 100) < 5);
  assert.ok(pt100[1] > 2.0);
  // 5000 Hz não deve ter ganho de 6 dB pois está em bypass
  const pt5000 = curve.find(([f]) => Math.abs(f - 5000) < 200);
  assert.ok(pt5000[1] < 1.0);
});

test('simulatedSpectrum gera espectro sintético rotulado como simulado', () => {
  const spec = simulatedSpectrum(42, 64);
  assert.equal(spec._simulado, true);
  assert.equal(spec.pontos.length, 64);
  assert.ok(spec.pontos[0][0] >= 20);
});

test('bandEnergy calcula médias por faixa (graves, médios, agudos)', () => {
  const points = [
    [50, -10],
    [100, -12],
    [500, -20],
    [1000, -22],
    [5000, -30],
  ];
  const energy = bandEnergy(points);
  assert.equal(energy.graves, -11); // (-10 + -12) / 2
  assert.equal(energy.médios, -21); // (-20 + -22) / 2
  assert.equal(energy.agudos, -30);
});

test('suggestions retorna orientações consultivas sem alterar a mesa', () => {
  const mockSpectrum = [
    [50, -5],
    [100, -6], // Graves altos
    [500, -18],
    [1000, -20],
    [5000, -25],
  ];
  const res = suggestions(mockSpectrum, 'reduzir_graves');
  assert.ok(res._aviso.includes('CONSULTIVAS'));
  assert.ok(res.sugestoes.length > 0);
  assert.equal(res.sugestoes[0].status, 'sugerido');
  assert.equal(res.sugestoes[0].freq_hz, 100.0);
  assert.equal(res.sugestoes[0].delta_db, -3.0);
});
