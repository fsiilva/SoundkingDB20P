import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import protobuf from'protobufjs';import {SnapshotDecoder,protobufContent,SNAPSHOT_REQUEST,encodeOutput110}from'./db20p.js';
const root=protobuf.Root.fromJSON(JSON.parse(readFileSync(new URL('./schema.json',import.meta.url))));const type=root.lookupType('com.amo.skdmc.data.SKDMCData');
function frame(){const pb=type.encode(type.create({in1Model:{ch1Model:{channelName:'TESTE',moduleId:0,outputPartModel:{outFaderValue:508,isMuteEnable:true}}},in2Model:{},busModel:{},setupModel:{}})).finish();const b=Buffer.alloc(16398);b.fill(0x5a,0,6);b.writeUInt32BE(1,6);b.writeUInt32BE(16384,10);const prefix=Buffer.from(protobuf.Writer.create().uint32(pb.length).finish());prefix.copy(b,14);Buffer.from(pb).copy(b,14+prefix.length);return b}
test('pedido fixo coincide exatamente com bytes capturados',()=>assert.equal(SNAPSHOT_REQUEST().toString('hex'),'5a5a5a5a5a5a0000000100000000'));
test('reconstitui snapshot fragmentado sem converter fader para dB',()=>{const decoder=new SnapshotDecoder(),bytes=frame();const snapshots=[];for(let i=0;i<bytes.length;i+=19)snapshots.push(...decoder.feed(bytes.subarray(i,i+19)));assert.equal(snapshots.length,1);assert.equal(snapshots[0].channels[0].name,'TESTE');assert.equal(snapshots[0].channels[0].moduleId,0);assert.equal(snapshots[0].channels[0].rawFader,508);assert.equal(snapshots[0].channels[0].mute,true)});
test('suporta frames concatenados e espera corpo completo',()=>{const decoder=new SnapshotDecoder();const bytes=frame();assert.deepEqual(decoder.feed(bytes.subarray(0,100)),[]);assert.equal(decoder.feed(Buffer.concat([bytes.subarray(100),bytes])).length,2)});
test('não corta zeros que pertencem a valores protobuf',()=>{const bytes=Buffer.from([0x0a,2,8,0,0,0]);assert.deepEqual(protobufContent(bytes),bytes.subarray(0,4));assert.throws(()=>protobufContent(Buffer.from([0,1])));assert.throws(()=>protobufContent(Buffer.from([0x0a,9,8])))});
test('recusa comprimento excessivo sem aguardar alocação arbitrária',()=>{const b=Buffer.alloc(14);b.fill(90,0,6);b.writeUInt32BE(1,6);b.writeUInt32BE(0xffffffff,10);assert.throws(()=>new SnapshotDecoder().feed(b))});

test('encoder 110 reproduz pacotes do aplicativo byte a byte',()=>{
 const base={moduleId:0,panValue:0,isSoloEnable:false,isMuteEnable:true,outFaderValue:460.88644,isLREnable:false};
 assert.equal(encodeOutput110(base).toString('hex'),'5a5a5a5a5a5a0000006e000000070720012d7771e643');
 assert.equal(encodeOutput110({...base,outFaderValue:0}).toString('hex'),'5a5a5a5a5a5a0000006e00000002022001');
 assert.equal(encodeOutput110({...base,isMuteEnable:false,outFaderValue:504.91608}).toString('hex'),'5a5a5a5a5a5a0000006e00000005052d4275fc43');
 assert.throws(()=>encodeOutput110({...base,phantom:true}));assert.throws(()=>encodeOutput110({...base,outFaderValue:NaN}));
});
