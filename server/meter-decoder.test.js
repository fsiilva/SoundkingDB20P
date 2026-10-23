import test from 'node:test';
import assert from 'node:assert/strict';
import {MeterDecoder, meterDbToPct} from './meter-decoder.js';

const SAMPLE_FRAME_HEX =
  '5a5a0000000000000100660a640000cdb200a60000a60000a60000a60000a60000a60000a60000b30000a60000a60000a60000b0b00000a6a6cea6a6a6a6a6a6a6b3a6a6a6a6a6a6a6a6a6a6a6a6a6b5b5c2c0bebebebeb5b5b5b5b8b8a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

test('meterDbToPct converte corretamente limites e faixas de áudio', () => {
  assert.equal(meterDbToPct(-90), 0);
  assert.equal(meterDbToPct(-100), 0);
  assert.equal(meterDbToPct(-40), 35);
  assert.equal(meterDbToPct(-18), 70);
  assert.equal(meterDbToPct(0), 100);
  assert.equal(meterDbToPct(5), 100);
  assert.equal(meterDbToPct(null), 0);
});

test('MeterDecoder decodifica quadro de 266 bytes capturado na DB20P', () => {
  const decoder = new MeterDecoder();
  const frame = Buffer.from(SAMPLE_FRAME_HEX, 'hex');
  assert.equal(frame.length, 266);

  const results = decoder.feed(frame);
  assert.equal(results.length, 1);
  const data = results[0];
  assert.equal(data.channels.length, 16);

  // Canal 1 (BATERIA, moduleId 0): 0xcd = -51 dB
  assert.equal(data.channels[0].moduleId, 0);
  assert.equal(data.channels[0].level, -51);
  assert.equal(data.channels[0].ng, 0);
  assert.equal(data.channels[0].comp, 0);
  assert.ok(data.channels[0].pct > 0);

  // Canal 2 (BAIXO, moduleId 1): 0xa6 = -90 dB (silêncio)
  assert.equal(data.channels[1].moduleId, 1);
  assert.equal(data.channels[1].level, -90);
  assert.equal(data.channels[1].pct, 0);

  // Master LR (offsets 68 e 69: 0xc2 = -62 dB, 0xc0 = -64 dB)
  assert.equal(data.master.left, -62);
  assert.equal(data.master.right, -64);
});

test('MeterDecoder suporta fragmentação TCP e quadros concatenados', () => {
  const decoder = new MeterDecoder();
  const frame = Buffer.from(SAMPLE_FRAME_HEX, 'hex');

  // Fragmentado em 3 partes
  assert.equal(decoder.feed(frame.subarray(0, 50)).length, 0);
  assert.equal(decoder.feed(frame.subarray(50, 150)).length, 0);
  const r1 = decoder.feed(frame.subarray(150));
  assert.equal(r1.length, 1);

  // Concatenado: 2 quadros juntos
  const double = Buffer.concat([frame, frame]);
  const r2 = decoder.feed(double);
  assert.equal(r2.length, 2);
});
