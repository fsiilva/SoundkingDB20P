import {readFileSync}from'node:fs';
import protobuf from 'protobufjs';
const root=protobuf.Root.fromJSON(JSON.parse(readFileSync(new URL('./schema.json',import.meta.url),'utf8')));
const Snapshot=root.lookupType('com.amo.skdmc.data.SKDMCData');
const Output=root.lookupType('com.amo.skdmc.data.MicInOutputPartModel');
export const SNAPSHOT_REQUEST_HEX='5a5a5a5a5a5a0000000100000000';
export const SNAPSHOT_REQUEST=()=>Buffer.from(SNAPSHOT_REQUEST_HEX,'hex');
const sync=Buffer.alloc(6,0x5a);
function varint(b,pos){let value=0,factor=1;for(let i=0;i<10;i++){if(pos>=b.length)throw Error('Varint truncado.');const byte=b[pos++];value+=(byte&127)*factor;if(byte<128)return[value,pos];factor*=128}throw Error('Varint inválido.')}
export function protobufContent(block){let pos=0;while(pos<block.length){const start=pos;if(block[pos]===0){if(block.subarray(pos).some(x=>x!==0))throw Error('Padding contém bytes não nulos.');return block.subarray(0,pos)}let tag;[tag,pos]=varint(block,pos);if(tag<8)throw Error('Campo protobuf inválido.');switch(tag%8){case 0:[,pos]=varint(block,pos);break;case 1:pos+=8;break;case 2:{let length;[length,pos]=varint(block,pos);pos+=length;break}case 5:pos+=4;break;default:throw Error('Wire type inválido.')}if(pos>block.length||pos<=start)throw Error('Campo protobuf truncado.')}return block}
export class SnapshotDecoder{
 constructor(){this.buffer=Buffer.alloc(0);this.skipped=0}
 feed(data){this.buffer=Buffer.concat([this.buffer,data]);if(this.buffer.length>1024*1024){this.buffer=Buffer.alloc(0);throw Error('Buffer de leitura excedeu 1 MB.')}const snapshots=[];while(this.buffer.length>=14){const index=this.buffer.indexOf(sync);if(index<0){this.skipped+=this.buffer.length-5;this.buffer=this.buffer.subarray(-5);break}if(index){this.skipped+=index;this.buffer=this.buffer.subarray(index)}if(this.buffer.length<14)break;const command=this.buffer.readUInt32BE(6),length=this.buffer.readUInt32BE(10);if(length>262144)throw Error('Comprimento de frame fora do limite.');if(this.buffer.length<14+length)break;const body=this.buffer.subarray(14,14+length);this.buffer=this.buffer.subarray(14+length);if(command!==1)continue;
 // Firmware snapshot: fixed 16 KB block containing a length-delimited protobuf.
 if(length!==16384)throw Error('Snapshot diferente do perfil capturado (16384 bytes).');
 const[protobufLength,contentStart]=varint(body,0);
 if(protobufLength<=0||contentStart+protobufLength>body.length)throw Error('Comprimento protobuf inválido.');
 if(body.subarray(contentStart+protobufLength).some(x=>x!==0))throw Error('Padding contém bytes não nulos.');
 const content=body.subarray(contentStart,contentStart+protobufLength);const message=Snapshot.decode(content);if(!message.in1Model||!message.in2Model||!message.busModel||!message.setupModel)throw Error('Snapshot sem os grupos esperados.');const raw=Snapshot.toObject(message,{defaults:true,longs:String,bytes:String});const channels=[];for(const group of ['in1Model','in2Model'])for(const[key,ch]of Object.entries(raw[group]))if(ch&&typeof ch==='object'){const o=ch.outputPartModel;channels.push({key:`${group}.${key}`,moduleId:ch.moduleId,name:ch.channelName||'(sem nome)',outputPresent:!!o,rawFader:o?.outFaderValue??null,rawPan:o?.panValue??null,mute:o?.isMuteEnable??null,solo:o?.isSoloEnable??null})}snapshots.push({receivedAt:new Date().toISOString(),command,payloadBytes:length,protobufBytes:content.length,lengthPrefix:body.subarray(0,contentStart).toString('hex'),profile:'DB20P 2026-10-22; protobuf delimitado + padding nulo',channels,raw});}return snapshots}
}

// Only encodes the six captured output fields. No arbitrary IDs or field names.
export function encodeOutput110(model){
 const fields=['moduleId','panValue','isSoloEnable','isMuteEnable','outFaderValue','isLREnable'];
 for(const key of Object.keys(model))if(!fields.includes(key))throw Error('Campo de saída desconhecido.');
 const error=Output.verify(model);if(error)throw Error(error);
 for(const key of ['panValue','outFaderValue'])if(model[key]!==undefined&&!Number.isFinite(model[key]))throw Error('Valor não finito.');
 const sparse=Object.fromEntries(Object.entries(model).filter(([,v])=>v!==0&&v!==false));
 const payload=Buffer.from(Output.encode(Output.create(sparse)).finish());
 const delimited=Buffer.from(Output.encodeDelimited(Output.create(sparse)).finish());
 const header=Buffer.alloc(14);header.fill(0x5a,0,6);header.writeUInt32BE(110,6);header.writeUInt32BE(payload.length,10);
 return Buffer.concat([header,delimited]);
}
