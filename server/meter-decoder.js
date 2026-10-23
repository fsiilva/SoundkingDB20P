import {readFileSync} from 'node:fs';
import protobuf from 'protobufjs';

const root = protobuf.Root.fromJSON(JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8')));
const MeterLevel = root.lookupType('com.amo.skdmc.data.MeterLevelData');

const sync = Buffer.from([0x5a, 0x5a]);

export function meterDbToPct(db) {
  if (!Number.isFinite(db) || db <= -90) return 0;
  if (db >= 0) return 100;
  // Piecewise curve: -90..-40 -> 0%..35%, -40..-18 -> 35%..70%, -18..0 -> 70%..100%
  if (db < -40) {
    return Math.max(0, Math.min(35, Math.round(((db + 90) / 50) * 35)));
  }
  if (db < -18) {
    return Math.max(35, Math.min(70, Math.round(35 + ((db + 40) / 22) * 35)));
  }
  return Math.max(70, Math.min(100, Math.round(70 + ((db + 18) / 18) * 30)));
}

export class MeterDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.skipped = 0;
  }

  feed(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    if (this.buffer.length > 512 * 1024) {
      this.buffer = Buffer.alloc(0);
      throw Error('Buffer do medidor excedeu 512 KB.');
    }

    const results = [];
    while (this.buffer.length >= 266) {
      const index = this.buffer.indexOf(sync);
      if (index < 0) {
        this.skipped += this.buffer.length - 1;
        this.buffer = this.buffer.subarray(-1);
        break;
      }
      if (index > 0) {
        this.skipped += index;
        this.buffer = this.buffer.subarray(index);
      }
      if (this.buffer.length < 266) break;

      const frame = this.buffer.subarray(0, 266);
      this.buffer = this.buffer.subarray(266);

      // Verify header pattern observed on DB20P: 5a 5a ... 01 00 66 (102 bytes delimited protobuf)
      if (frame[8] !== 0x01 || frame[9] !== 0x00 || frame[10] !== 0x66) {
        continue;
      }

      try {
        const decoded = MeterLevel.decodeDelimited(frame.subarray(10));
        const gainValue = Buffer.from(decoded.gainValue);
        if (gainValue.length < 70) continue;

        const channels = [];
        for (let i = 0; i < 16; i++) {
          const ng = gainValue.readInt8(i * 3 + 0);
          const comp = gainValue.readInt8(i * 3 + 1);
          const level = gainValue.readInt8(i * 3 + 2);
          channels.push({
            moduleId: i,
            level,
            ng,
            comp,
            pct: meterDbToPct(level)
          });
        }

        const masterLeft = gainValue.readInt8(68);
        const masterRight = gainValue.readInt8(69);

        results.push({
          receivedAt: new Date().toISOString(),
          channels,
          master: {
            left: masterLeft,
            right: masterRight,
            leftPct: meterDbToPct(masterLeft),
            rightPct: meterDbToPct(masterRight)
          }
        });
      } catch {
        // Skip malformed frame without breaking the stream
      }
    }
    return results;
  }
}
