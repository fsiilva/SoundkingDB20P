import { readFileSync } from 'node:fs';
import protobuf from 'protobufjs';
import { SEND_COMMANDS, SEND_PROTO_GUESS, RECEIVE_HANDLERS, ENM_COMMAND } from './commands.js';

export { SEND_COMMANDS, SEND_PROTO_GUESS, RECEIVE_HANDLERS, ENM_COMMAND };

const root = protobuf.Root.fromJSON(JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8')));
const Snapshot = root.lookupType('com.amo.skdmc.data.SKDMCData');
const Output = root.lookupType('com.amo.skdmc.data.MicInOutputPartModel');
const Eq = root.lookupType('com.amo.skdmc.data.EqPartModel');
const Dynamic = root.lookupType('com.amo.skdmc.data.MicInDynamicPartModel');
const Input = root.lookupType('com.amo.skdmc.data.MicInInputPartModel');
const BusOutput = root.lookupType('com.amo.skdmc.data.BusOutputModel');
const MicBus = root.lookupType('com.amo.skdmc.data.MicInBusModel');

export const SNAPSHOT_REQUEST_HEX = '5a5a5a5a5a5a0000000100000000';
export const SNAPSHOT_REQUEST = () => Buffer.from(SNAPSHOT_REQUEST_HEX, 'hex');

export const SYNC_BYTE = 0x5a;
export const SYNC_MIN_MATCH = 4;
export const SYNC_WRITE_COUNT = 6;
export const CMD_ID_SIZE = 4;
export const LEN_SIZE = 4;
export const HEADER_SIZE = 14;

export function varint(b, pos) {
  let value = 0;
  let factor = 1;
  for (let i = 0; i < 10; i++) {
    if (pos >= b.length) throw Error('Varint truncado.');
    const byte = b[pos++];
    value += (byte & 127) * factor;
    if (byte < 128) return [value, pos];
    factor *= 128;
  }
  throw Error('Varint inválido.');
}

/**
 * Localiza o índice inicial de uma sequência de >= SYNC_MIN_MATCH bytes 0x5A no buffer.
 */
export function findSyncIndex(buf, start = 0) {
  const n = buf.length;
  for (let i = start; i < n; i++) {
    if (buf[i] === SYNC_BYTE) {
      let j = i;
      while (j < n && buf[j] === SYNC_BYTE) j++;
      if (j - i >= SYNC_MIN_MATCH) {
        return i;
      }
      i = j - 1;
    }
  }
  return -1;
}

/**
 * Retorna o índice logo após uma sequência de >= SYNC_MIN_MATCH bytes 0x5A.
 */
export function findSync(buf, start = 0) {
  const n = buf.length;
  let i = start;
  while (i < n) {
    if (buf[i] === SYNC_BYTE) {
      let j = i;
      while (j < n && buf[j] === SYNC_BYTE) j++;
      if (j - i >= SYNC_MIN_MATCH) {
        return j;
      }
      i = j;
    } else {
      i++;
    }
  }
  return -1;
}

/**
 * Monta um frame completo para envio (6x 0x5A + cmdId int32 BE + length int32 BE + payload).
 */
export function encodeFrame(cmdId, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(HEADER_SIZE);
  header.fill(SYNC_BYTE, 0, SYNC_WRITE_COUNT);
  header.writeUInt32BE(cmdId, SYNC_WRITE_COUNT);
  header.writeUInt32BE(payload.length, SYNC_WRITE_COUNT + CMD_ID_SIZE);
  return Buffer.concat([header, payload]);
}

/**
 * Itera os frames contidos em buf segundo o framing confirmado da mesa.
 */
export function* iterFrames(buf) {
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const afterSync = findSync(buf, i);
    if (afterSync < 0) break;
    if (afterSync + CMD_ID_SIZE + LEN_SIZE > n) {
      yield { cmdId: null, payload: Buffer.alloc(0), complete: false };
      return;
    }
    const cmdId = buf.readUInt32BE(afterSync);
    const length = buf.readUInt32BE(afterSync + CMD_ID_SIZE);
    if (length > 262144) {
      throw Error('Comprimento de frame fora do limite.');
    }
    const pstart = afterSync + CMD_ID_SIZE + LEN_SIZE;
    const pend = pstart + length;
    if (pend > n) {
      yield { cmdId, payload: buf.subarray(pstart, n), complete: false };
      return;
    }
    yield { cmdId, payload: buf.subarray(pstart, pend), complete: true, length };
    i = pend;
  }
}

/**
 * Retorna a quantidade de bytes já consumidos por frames completos no buffer.
 */
export function consumedBytes(buf) {
  let i = 0;
  const n = buf.length;
  let lastGood = 0;
  while (i < n) {
    const afterSync = findSync(buf, i);
    if (afterSync < 0) return lastGood;
    if (afterSync + CMD_ID_SIZE + LEN_SIZE > n) return lastGood;
    const length = buf.readUInt32BE(afterSync + CMD_ID_SIZE);
    if (length > 262144) throw Error('Comprimento de frame fora do limite.');
    const pend = afterSync + CMD_ID_SIZE + LEN_SIZE + length;
    if (pend > n) return lastGood;
    i = pend;
    lastGood = i;
  }
  return lastGood;
}

export function protobufContent(block) {
  let pos = 0;
  while (pos < block.length) {
    const start = pos;
    if (block[pos] === 0) {
      if (block.subarray(pos).some(x => x !== 0)) throw Error('Padding contém bytes não nulos.');
      return block.subarray(0, pos);
    }
    let tag;
    [tag, pos] = varint(block, pos);
    if (tag < 8) throw Error('Campo protobuf inválido.');
    switch (tag % 8) {
      case 0: [, pos] = varint(block, pos); break;
      case 1: pos += 8; break;
      case 2: {
        let length;
        [length, pos] = varint(block, pos);
        pos += length;
        break;
      }
      case 5: pos += 4; break;
      default: throw Error('Wire type inválido.');
    }
    if (pos > block.length || pos <= start) throw Error('Campo protobuf truncado.');
  }
  return block;
}

/**
 * Extrai o corpo serializado do protobuf tratando prefixo de 2 bytes (ex: 0xef 0x5a),
 * comprimento delimitado varint e preenchimento de buffer.
 */
export function extractProtobuf(payload) {
  if (!payload || payload.length === 0) return Buffer.alloc(0);

  // Tentativa 1: Varint de delimitação de comprimento
  try {
    const [protobufLength, contentStart] = varint(payload, 0);
    if (protobufLength > 0 && contentStart + protobufLength <= payload.length) {
      const candidate = payload.subarray(contentStart, contentStart + protobufLength);
      const decoded = Snapshot.decode(candidate);
      if (decoded && (decoded.in1Model || decoded.busModel || decoded.setupModel)) {
        return candidate;
      }
    }
  } catch {}

  // Tentativa 2: Decodificação direta
  try {
    const decoded = Snapshot.decode(payload);
    if (decoded && (decoded.in1Model || decoded.busModel || decoded.setupModel)) {
      return payload;
    }
  } catch {}

  // Tentativa 3: Scan com offset de 1 a 4 bytes (prefixos do protocolo)
  for (let offset = 1; offset <= 4; offset++) {
    try {
      const slice = payload.subarray(offset);
      const decoded = Snapshot.decode(slice);
      if (decoded && (decoded.in1Model || decoded.busModel || decoded.setupModel)) {
        return slice;
      }
    } catch {}
  }

  // Fallback: protobufContent tradicional
  try {
    return protobufContent(payload);
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Extrai a lista unificada de canais ordenados por moduleId.
 */
export function channels(raw) {
  const chs = [];
  for (const group of ['in1Model', 'in2Model']) {
    const grp = raw[group];
    if (!grp || typeof grp !== 'object') continue;
    for (const [key, ch] of Object.entries(grp)) {
      if (ch && typeof ch === 'object') {
        const o = ch.outputPartModel;
        chs.push({
          key: `${group}.${key}`,
          moduleId: ch.moduleId,
          name: (ch.channelName || '').trim() || '(sem nome)',
          outputPresent: !!o,
          rawFader: o?.outFaderValue ?? null,
          rawPan: o?.panValue ?? null,
          mute: o?.isMuteEnable ?? null,
          solo: o?.isSoloEnable ?? null,
          lr: o?.isLREnable ?? true,
        });
      }
    }
  }
  chs.sort((a, b) => (a.moduleId ?? 0) - (b.moduleId ?? 0));
  return chs;
}

/**
 * Decodifica o payload do snapshot (ID=1) em um objeto consolidado de estado.
 */
export function parseSnapshot(payload) {
  const content = extractProtobuf(payload);
  if (!content || content.length === 0) {
    throw Error('payload do snapshot não contém protobuf válido');
  }
  const message = Snapshot.decode(content);
  if (!message.in1Model || !message.in2Model || !message.busModel || !message.setupModel) {
    throw Error('Snapshot sem os grupos esperados.');
  }
  const raw = Snapshot.toObject(message, { defaults: true, longs: String, bytes: String });
  return {
    receivedAt: new Date().toISOString(),
    command: 1,
    payloadBytes: payload.length,
    protobufBytes: content.length,
    lengthPrefix: payload.subarray(0, 2).toString('hex'),
    profile: 'DB20P 2026-10-22; protobuf delimitado + padding nulo',
    channels: channels(raw),
    raw,
  };
}

/**
 * Decodifica snapshot a partir de um stream contendo um ou mais frames ID=1.
 */
export function snapshotFromStream(stream) {
  const chunks = [];
  for (const fr of iterFrames(stream)) {
    if (fr.cmdId === 1 && fr.payload && fr.complete) {
      chunks.push(fr.payload);
    }
  }
  if (chunks.length === 0) {
    throw Error('nenhum frame de snapshot (ID=1) encontrado no stream');
  }
  if (chunks.length === 1) {
    return parseSnapshot(chunks[0]);
  }
  const body = Buffer.concat(chunks.map(c => extractProtobuf(c)));
  const message = Snapshot.decode(body);
  const raw = Snapshot.toObject(message, { defaults: true, longs: String, bytes: String });
  return {
    receivedAt: new Date().toISOString(),
    command: 1,
    payloadBytes: chunks.reduce((acc, c) => acc + c.length, 0),
    protobufBytes: body.length,
    profile: 'DB20P multi-chunk',
    channels: channels(raw),
    raw,
  };
}

/**
 * Decodificador incremental para streams TCP contendo snapshots e outros frames da DB20P.
 */
export class SnapshotDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.skipped = 0;
  }

  feed(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    if (this.buffer.length > 1024 * 1024) {
      this.buffer = Buffer.alloc(0);
      throw Error('Buffer de leitura excedeu 1 MB.');
    }

    const snapshots = [];
    while (this.buffer.length >= 14) {
      const syncIndex = findSyncIndex(this.buffer);
      if (syncIndex < 0) {
        const keep = Math.min(this.buffer.length, 5);
        this.skipped += this.buffer.length - keep;
        this.buffer = this.buffer.subarray(this.buffer.length - keep);
        break;
      }
      if (syncIndex > 0) {
        this.skipped += syncIndex;
        this.buffer = this.buffer.subarray(syncIndex);
      }

      let k = 0;
      while (k < this.buffer.length && this.buffer[k] === SYNC_BYTE) k++;
      if (k + 8 > this.buffer.length) break;

      const command = this.buffer.readUInt32BE(k);
      const length = this.buffer.readUInt32BE(k + 4);
      if (length > 262144) {
        throw Error('Comprimento de frame fora do limite.');
      }

      const frameTotal = k + 8 + length;
      if (this.buffer.length < frameTotal) {
        break; // Aguarda payload completo
      }

      const body = this.buffer.subarray(k + 8, frameTotal);
      this.buffer = this.buffer.subarray(frameTotal);

      if (command === 1) {
        snapshots.push(parseSnapshot(body));
      }
    }
    return snapshots;
  }
}

/**
 * Codificador para comando de saída 110 (outFaderValue, panValue, isMuteEnable, isSoloEnable, isLREnable).
 */
export function encodeOutput110(model) {
  const fields = ['moduleId', 'panValue', 'isSoloEnable', 'isMuteEnable', 'outFaderValue', 'isLREnable'];
  for (const key of Object.keys(model)) {
    if (!fields.includes(key)) throw Error('Campo de saída desconhecido.');
  }
  const error = Output.verify(model);
  if (error) throw Error(error);
  for (const key of ['panValue', 'outFaderValue']) {
    if (model[key] !== undefined && !Number.isFinite(model[key])) throw Error('Valor não finito.');
  }
  const sparse = Object.fromEntries(Object.entries(model).filter(([, v]) => v !== 0 && v !== false));
  const payload = Buffer.from(Output.encode(Output.create(sparse)).finish());
  const delimited = Buffer.from(Output.encodeDelimited(Output.create(sparse)).finish());
  const header = Buffer.alloc(14);
  header.fill(0x5a, 0, 6);
  header.writeUInt32BE(110, 6);
  header.writeUInt32BE(payload.length, 10);
  return Buffer.concat([header, delimited]);
}

/**
 * Codificador para comando de Equalizador paramétrico 104 (EqPartModel).
 */
export function encodeEq104(model) {
  const error = Eq.verify(model);
  if (error) throw Error(error);
  const sparse = Object.fromEntries(Object.entries(model).filter(([, v]) => v !== 0 && v !== false && v !== null && v !== undefined));
  const payload = Buffer.from(Eq.encode(Eq.create(sparse)).finish());
  const delimited = Buffer.from(Eq.encodeDelimited(Eq.create(sparse)).finish());
  const header = Buffer.alloc(14);
  header.fill(0x5a, 0, 6);
  header.writeUInt32BE(104, 6);
  header.writeUInt32BE(payload.length, 10);
  return Buffer.concat([header, delimited]);
}

/**
 * Codificador para comando de Dinâmica 106 (MicInDynamicPartModel - Gate e Compressor).
 */
export function encodeDynamic106(model) {
  const error = Dynamic.verify(model);
  if (error) throw Error(error);
  const sparse = Object.fromEntries(Object.entries(model).filter(([, v]) => v !== 0 && v !== false && v !== null && v !== undefined));
  const payload = Buffer.from(Dynamic.encode(Dynamic.create(sparse)).finish());
  const delimited = Buffer.from(Dynamic.encodeDelimited(Dynamic.create(sparse)).finish());
  const header = Buffer.alloc(14);
  header.fill(0x5a, 0, 6);
  header.writeUInt32BE(106, 6);
  header.writeUInt32BE(payload.length, 10);
  return Buffer.concat([header, delimited]);
}

/**
 * Codificador para comando de Entrada 102 (MicInInputPartModel - Phantom 48V, Fase, HPF, Ganho).
 */
export function encodeInput102(model) {
  const error = Input.verify(model);
  if (error) throw Error(error);
  const sparse = Object.fromEntries(Object.entries(model).filter(([, v]) => v !== 0 && v !== false && v !== null && v !== undefined));
  const payload = Buffer.from(Input.encode(Input.create(sparse)).finish());
  const delimited = Buffer.from(Input.encodeDelimited(Input.create(sparse)).finish());
  const header = Buffer.alloc(14);
  header.fill(0x5a, 0, 6);
  header.writeUInt32BE(102, 6);
  header.writeUInt32BE(payload.length, 10);
  return Buffer.concat([header, delimited]);
}

/**
 * Codificador para comando de Saída Master / Bus 114 (BusOutputModel - Volume Master LR, Mute Master).
 */
export function encodeMaster114(model) {
  const error = BusOutput.verify(model);
  if (error) throw Error(error);
  const sparse = Object.fromEntries(Object.entries(model).filter(([, v]) => v !== 0 && v !== false && v !== null && v !== undefined));
  const payload = Buffer.from(BusOutput.encode(BusOutput.create(sparse)).finish());
  const delimited = Buffer.from(BusOutput.encodeDelimited(BusOutput.create(sparse)).finish());
  const header = Buffer.alloc(14);
  header.fill(0x5a, 0, 6);
  header.writeUInt32BE(114, 6);
  header.writeUInt32BE(payload.length, 10);
  return Buffer.concat([header, delimited]);
}

/**
 * Codificador para comando de Envio para Bus 108 (MicInBusModel).
 */
export function encodeBus108(model) {
  const error = MicBus.verify(model);
  if (error) throw Error(error);
  const sparse = Object.fromEntries(Object.entries(model).filter(([, v]) => v !== 0 && v !== false && v !== null && v !== undefined));
  const payload = Buffer.from(MicBus.encode(MicBus.create(sparse)).finish());
  const delimited = Buffer.from(MicBus.encodeDelimited(MicBus.create(sparse)).finish());
  const header = Buffer.alloc(14);
  header.fill(0x5a, 0, 6);
  header.writeUInt32BE(108, 6);
  header.writeUInt32BE(payload.length, 10);
  return Buffer.concat([header, delimited]);
}
