import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import protobuf from 'protobufjs';
import {
  SnapshotDecoder,
  protobufContent,
  SNAPSHOT_REQUEST,
  encodeOutput110,
  findSync,
  findSyncIndex,
  encodeFrame,
  iterFrames,
  consumedBytes,
  extractProtobuf,
  parseSnapshot,
  snapshotFromStream,
  channels,
  SEND_COMMANDS,
  RECEIVE_HANDLERS,
  ENM_COMMAND,
} from './db20p.js';

const root = protobuf.Root.fromJSON(JSON.parse(readFileSync(new URL('./schema.json', import.meta.url))));
const type = root.lookupType('com.amo.skdmc.data.SKDMCData');

function frame() {
  const pb = type.encode(type.create({
    in1Model: { ch1Model: { channelName: 'TESTE', moduleId: 0, outputPartModel: { outFaderValue: 508, isMuteEnable: true } } },
    in2Model: {},
    busModel: {},
    setupModel: {},
  })).finish();
  const b = Buffer.alloc(16398);
  b.fill(0x5a, 0, 6);
  b.writeUInt32BE(1, 6);
  b.writeUInt32BE(16384, 10);
  const prefix = Buffer.from(protobuf.Writer.create().uint32(pb.length).finish());
  prefix.copy(b, 14);
  Buffer.from(pb).copy(b, 14 + prefix.length);
  return b;
}

test('pedido fixo coincide exatamente com bytes capturados', () => {
  assert.equal(SNAPSHOT_REQUEST().toString('hex'), '5a5a5a5a5a5a0000000100000000');
});

test('reconstitui snapshot fragmentado sem converter fader para dB', () => {
  const decoder = new SnapshotDecoder();
  const bytes = frame();
  const snapshots = [];
  for (let i = 0; i < bytes.length; i += 19) {
    snapshots.push(...decoder.feed(bytes.subarray(i, i + 19)));
  }
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].channels[0].name, 'TESTE');
  assert.equal(snapshots[0].channels[0].moduleId, 0);
  assert.equal(snapshots[0].channels[0].rawFader, 508);
  assert.equal(snapshots[0].channels[0].mute, true);
});

test('suporta frames concatenados e espera corpo completo', () => {
  const decoder = new SnapshotDecoder();
  const bytes = frame();
  assert.deepEqual(decoder.feed(bytes.subarray(0, 100)), []);
  assert.equal(decoder.feed(Buffer.concat([bytes.subarray(100), bytes])).length, 2);
});

test('não corta zeros que pertencem a valores protobuf', () => {
  const bytes = Buffer.from([0x0a, 2, 8, 0, 0, 0]);
  assert.deepEqual(protobufContent(bytes), bytes.subarray(0, 4));
  assert.throws(() => protobufContent(Buffer.from([0, 1])));
  assert.throws(() => protobufContent(Buffer.from([0x0a, 9, 8])));
});

test('recusa comprimento excessivo sem aguardar alocação arbitrária', () => {
  const b = Buffer.alloc(14);
  b.fill(90, 0, 6);
  b.writeUInt32BE(1, 6);
  b.writeUInt32BE(0xffffffff, 10);
  assert.throws(() => new SnapshotDecoder().feed(b));
});

test('encoder 110 reproduz pacotes do aplicativo byte a byte', () => {
  const base = { moduleId: 0, panValue: 0, isSoloEnable: false, isMuteEnable: true, outFaderValue: 460.88644, isLREnable: false };
  assert.equal(encodeOutput110(base).toString('hex'), '5a5a5a5a5a5a0000006e000000070720012d7771e643');
  assert.equal(encodeOutput110({ ...base, outFaderValue: 0 }).toString('hex'), '5a5a5a5a5a5a0000006e00000002022001');
  assert.equal(encodeOutput110({ ...base, isMuteEnable: false, outFaderValue: 504.91608 }).toString('hex'), '5a5a5a5a5a5a0000006e00000005052d4275fc43');
  assert.throws(() => encodeOutput110({ ...base, phantom: true }));
  assert.throws(() => encodeOutput110({ ...base, outFaderValue: NaN }));
});

// ---- TESTES MIGRADOS DO PROJETO DE REFERÊNCIA (PROJETO A) ----

test('findSync localiza 4, 6 e 8 bytes consecutivos de 0x5a', () => {
  const buf4 = Buffer.concat([Buffer.from([1, 2, 3]), Buffer.alloc(4, 0x5a), Buffer.from([0, 1])]);
  assert.equal(findSync(buf4), 7); // 3 prefix + 4 sync = 7

  const buf6 = Buffer.concat([Buffer.from([0]), Buffer.alloc(6, 0x5a), Buffer.from([0, 1])]);
  assert.equal(findSync(buf6), 7); // 1 prefix + 6 sync = 7

  const bufNone = Buffer.from([0x5a, 0x5a, 0x5a, 0x01, 0x02]); // apenas 3 syncs
  assert.equal(findSync(bufNone), -1);
});

test('encodeFrame monta frame correto com 6x 0x5A, cmdId e length', () => {
  const frameBytes = encodeFrame(110, Buffer.from([0x01, 0x02, 0x03]));
  assert.equal(frameBytes.length, 14 + 3);
  assert.equal(frameBytes.subarray(0, 6).toString('hex'), '5a5a5a5a5a5a');
  assert.equal(frameBytes.readUInt32BE(6), 110);
  assert.equal(frameBytes.readUInt32BE(10), 3);
  assert.deepEqual(frameBytes.subarray(14), Buffer.from([0x01, 0x02, 0x03]));
});

test('iterFrames detecta frames completos, parciais e múltiplos', () => {
  const f1 = encodeFrame(1, Buffer.from('hello'));
  const f2 = encodeFrame(195, Buffer.from('world!'));
  const combined = Buffer.concat([f1, f2]);

  const frames = [...iterFrames(combined)];
  assert.equal(frames.length, 2);
  assert.equal(frames[0].cmdId, 1);
  assert.equal(frames[0].complete, true);
  assert.equal(frames[0].payload.toString(), 'hello');
  assert.equal(frames[1].cmdId, 195);
  assert.equal(frames[1].complete, true);
  assert.equal(frames[1].payload.toString(), 'world!');
  assert.equal(consumedBytes(combined), combined.length);

  // Frame parcial: corta 2 bytes do final
  const partial = combined.subarray(0, combined.length - 2);
  const partialFrames = [...iterFrames(partial)];
  assert.equal(partialFrames.length, 2);
  assert.equal(partialFrames[0].complete, true);
  assert.equal(partialFrames[1].complete, false);
  assert.equal(consumedBytes(partial), f1.length);
});

test('replay de captura real: decodifica snapshot da DB20P e confirma canais reais', () => {
  const candidates = [
    new URL('./response-6400.bin', import.meta.url),
    new URL('../capturas/analise-inicial/response-6400.bin', import.meta.url),
  ];
  const realCapturePath = candidates.find(u => existsSync(u));
  if (!realCapturePath) return;
  const bin = readFileSync(realCapturePath);

  // O stream real tem 16448 bytes (Frame 1 ID=1 + Frame 2 ID=195)
  assert.equal(bin.length, 16448);

  const snapshot = snapshotFromStream(bin);
  assert.equal(snapshot.command, 1);
  assert.equal(snapshot.channels.length, 16);

  // Valida canais confirmados na DB20P física
  const byModuleId = Object.fromEntries(snapshot.channels.map(c => [c.moduleId, c]));
  assert.equal(byModuleId[0].name, 'BATERIA');
  assert.equal(byModuleId[3].name, 'GUITARRA');
  assert.equal(typeof byModuleId[0].rawFader, 'number');
  assert.equal(typeof byModuleId[0].mute, 'boolean');
});

test('catálogo de comandos e handlers do protocolo exportados com integridade', () => {
  assert.equal(SEND_COMMANDS[110], 'Canal (fader/mute/solo/pan)');
  assert.equal(SEND_COMMANDS[104], 'EQ paramétrico (PEQ)');
  assert.equal(SEND_COMMANDS[106], 'Dinâmica (gate/compressor)');
  assert.ok(RECEIVE_HANDLERS.includes('proccessAllDataCmd'));
  assert.ok(RECEIVE_HANDLERS.includes('processMeterData'));
  assert.equal(ENM_COMMAND.PlayBtn, 0);
  assert.equal(ENM_COMMAND.Scene_Export, 11);
});
