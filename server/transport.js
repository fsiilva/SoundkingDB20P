import {EventEmitter} from 'node:events';
import{RealtimeFader}from'./realtime-fader.js';
import {channel1Target,channel1Control,profile}from'./channel1-policy.js';
import {setTimeout as delay}from'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {SnapshotDecoder,SNAPSHOT_REQUEST,snapshotFromStream,encodeOutput110,encodeEq104,encodeDynamic106,encodeInput102,encodeMaster114,encodeBus108} from './db20p.js';
import {MeterDecoder} from './meter-decoder.js';
import net from 'node:net';
import dgram from 'node:dgram';
export class Transport extends EventEmitter {
 constructor({allowChannel1Write=profile.channel1FaderEnabled,allowRead=true}={}){super();this.allowChannel1Write=allowChannel1Write;this.allowRead=allowRead;this.socket=null;this.meterSocket=null;this.generation=0;this.syncTimer=null;this.readTimer=null;this.simMeterInterval=null;this.reset();this.realtime=new RealtimeFader(this)}
 reset(){this.decoder=new SnapshotDecoder();this.meterDecoder=new MeterDecoder();this.state={status:'disconnected',protocol:null,host:null,port:null,bytesReceived:0,packetsReceived:0,error:null,logs:[],localPort:null,snapshot:null,snapshotRequestedAt:null,decodeError:null,snapshotError:null,bytesSent:0,autoRead:false,readPending:false,writeInProgress:false,lastWrite:null,activeFader:null,meters:null,meterStatus:'disconnected',meterError:null,permissions:{allowRead:this.allowRead,writeEnabled:this.allowChannel1Write},capabilities:{channel1Fader:this.allowChannel1Write,faders:this.allowChannel1Write,maxLiveFaderRaw:1000,channel1Pan:true,channel1MuteOn:this.allowChannel1Write,maxFaderRaw:profile.maxRaw}}}
 stopTimers(){clearInterval(this.syncTimer);clearTimeout(this.readTimer);clearInterval(this.simMeterInterval);this.syncTimer=null;this.readTimer=null;this.simMeterInterval=null;this.state.autoRead=false;this.state.readPending=false}
 log(data,remote){
  this.state.bytesReceived+=data.length;this.state.packetsReceived++;
  this.state.logs.push({at:new Date().toISOString(),remote,bytes:data.length,hex:data.subarray(0,512).toString('hex')});this.state.logs=this.state.logs.slice(-60);
  if(this.state.protocol==='tcp'&&this.state.port===6400){try{for(const snapshot of this.decoder.feed(data)){this.state.snapshot=snapshot;this.state.readPending=false;this.state.snapshotError=null;this.state.decodeError=null;clearTimeout(this.readTimer);this.realtime?.observe(snapshot)}}catch(e){this.state.decodeError=e.message;this.realtime?.abort(e.message);this.state.readPending=false;clearTimeout(this.readTimer);this.stopTimers()}}
 }
 disconnect(){this.generation++;this.realtime?.abort('Conexão encerrada.');this.stopTimers();if(this.meterSocket){try{this.meterSocket.destroy()}catch{}this.meterSocket=null}if(this.socket){if(this.state.protocol==='tcp')this.socket.destroy();else{try{this.socket.close()}catch{}}}this.socket=null;this.state.status='disconnected';this.state.meterStatus='disconnected'}
 requestSnapshot(writeRead=false){
  if(!this.allowRead)throw Error('Leitura de rede desativada (allowRead=false). A leitura é separada da escrita.');
  if(this.state.status!=='connected'||this.state.protocol!=='tcp'||this.state.port!==6400)throw Error('Conecte via TCP na porta 6400.');
  const now=Date.now();if(this.state.readPending)throw Error('A leitura anterior ainda está em andamento.');
  if(this.state.snapshotRequestedAt&&now-Date.parse(this.state.snapshotRequestedAt)<(writeRead&&this.state.writeInProgress?250:5000))throw Error('Aguarde 5 segundos entre leituras.');
  this.state.decodeError=null;this.state.snapshotError=null;this.state.readPending=true;this.state.snapshotRequestedAt=new Date(now).toISOString();
  const bytes=SNAPSHOT_REQUEST();this.socket.write(bytes);this.state.bytesSent+=bytes.length;
  clearTimeout(this.readTimer);this.readTimer=setTimeout(()=>{this.state.readPending=false;this.state.snapshotError='A mesa não respondeu à leitura em 4 segundos. Últimos dados preservados.'},4000);this.readTimer.unref?.();return this.state;
 }
 startAutoRead(){
  if(!this.allowRead)throw Error('Leitura de rede desativada (allowRead=false).');
  if(this.state.writeInProgress)throw Error('Aguarde a confirmação do ajuste.');
  if(this.state.status!=='connected'||this.state.protocol!=='tcp'||this.state.port!==6400)throw Error('Leitura automática exige TCP 6400.');
  clearInterval(this.syncTimer);this.state.autoRead=true;
  if(!this.state.readPending&&(!this.state.snapshotRequestedAt||Date.now()-Date.parse(this.state.snapshotRequestedAt)>=5000))this.requestSnapshot();this.syncTimer=setInterval(()=>{if(this.state.status!=='connected'){this.stopTimers();return}try{this.requestSnapshot()}catch(e){this.state.snapshotError=e.message}},6000);this.syncTimer.unref?.();return this.state;
 }
 async freshSnapshot(generation){
  const check=()=>{if(this.generation!==generation||this.state.status!=='connected')throw Error('Conexão alterada durante o teste.');};
  check();while(this.state.readPending){check();await delay(25)}
  const remaining=(this.state.writeInProgress?251:5001)-(Date.now()-Date.parse(this.state.snapshotRequestedAt||0));if(remaining>0)await delay(remaining);check();
  const previous=this.state.snapshot;this.requestSnapshot(this.state.writeInProgress);const until=Date.now()+4500;
  while(this.state.readPending&&Date.now()<until){check();await delay(25)}check();
  if(this.state.snapshot===previous||this.state.snapshotError||this.state.decodeError)throw Error(this.state.snapshotError||this.state.decodeError||'Sem nova leitura para confirmar o ajuste.');
  return this.state.snapshot;
 }
 async stepChannel1(request){const result=channel1Target(this.state,request,this.allowChannel1Write);return this.applyChannel1({...request,field:'outFaderValue',value:result.target})}
 async applyChannel1(request){
  if(this.state.writeInProgress)throw Error('Ajuste anterior ainda em andamento.');
  channel1Control(this.state,request,this.allowChannel1Write);
  const generation=this.generation,wasAutomatic=this.state.autoRead;clearInterval(this.syncTimer);this.syncTimer=null;this.state.autoRead=false;this.state.writeInProgress=true;
  const record={at:new Date().toISOString(),status:'checking',channel:profile.channelKey,field:request.field,delta:request.delta};this.state.lastWrite=record;
  try{
   await this.freshSnapshot(generation);const target=channel1Control(this.state,request,this.allowChannel1Write);
   const bytes=encodeOutput110(target.model);this.socket.write(bytes);this.state.bytesSent+=bytes.length;
   Object.assign(record,{status:'sent',before:target.before,target:target.target,frameHex:bytes.toString('hex')});
   await this.freshSnapshot(generation);const ch=this.state.snapshot.channels.find(ch=>ch.key===profile.channelKey);
   const output=this.state.snapshot.raw.in1Model.ch1Model.outputPartModel;
   if(!ch||ch.mute!==true||(typeof target.target==='boolean'?output[target.field]!==target.target:(!Number.isFinite(output[target.field])||Math.abs(output[target.field]-target.target)>.001)))throw Error('Leitura de retorno não confirmou o parâmetro ou o mute. Verifique a mesa.');
   for(const field of ['moduleId','outFaderValue','panValue','isSoloEnable','isMuteEnable','isLREnable'])if(field!==target.field&&output[field]!==target.output[field])throw Error('Outro parâmetro de saída mudou durante a confirmação.');
   Object.assign(record,{status:'confirmed',confirmedAt:this.state.snapshot.receivedAt,received:output[target.field]});return this.state;
  }catch(e){Object.assign(record,{status:'error',error:e.message});throw e}
  finally{this.state.writeInProgress=false;if(wasAutomatic&&this.generation===generation&&this.state.status==='connected'&&!this.state.decodeError)this.startAutoRead()}
 }
 async applyChannelControl({key,moduleId,field,value}){
  if(!this.allowChannel1Write)throw Error('Escrita não habilitada.');
  if(this.state.writeInProgress)throw Error('Ajuste anterior ainda em andamento.');
  if(this.state.status!=='connected'&&this.state.status!=='simulated')throw Error('Mesa não conectada.');
  const isOffline=!this.socket||this.state.status==='simulated';
  const ch=this.state.snapshot?.channels?.find(c=>(key&&c.key===key)||(moduleId!==undefined&&c.moduleId===moduleId));
  const chKey=key||ch?.key||`in1Model.ch${(moduleId??0)+1}Model`,parts=chKey.split('.');
  const cur=this.state.snapshot?.raw?.[parts[0]]?.[parts[1]]?.outputPartModel||{};
  const modId=moduleId??ch?.moduleId??cur?.moduleId??0;
  const model={moduleId:modId,panValue:cur.panValue??0,isSoloEnable:cur.isSoloEnable??false,isMuteEnable:cur.isMuteEnable??false,outFaderValue:cur.outFaderValue??0,isLREnable:cur.isLREnable??true,[field]:value};
  if(isOffline){
   if(this.state.snapshot){
    if(this.state.snapshot.raw?.[parts[0]]?.[parts[1]]?.outputPartModel){
     this.state.snapshot.raw[parts[0]][parts[1]].outputPartModel[field]=value;
    }
    if(ch){
     if(field==='outFaderValue'){ch.faderRaw=value;ch.rawFader=value;ch.outFaderValue=value;}
     else if(field==='isMuteEnable'){ch.mute=value;ch.isMuteEnable=value;}
     else if(field==='isSoloEnable'){ch.solo=value;ch.isSoloEnable=value;}
     else if(field==='panValue'){ch.pan=value;ch.rawPan=value;}
     else if(field==='isLREnable'){ch.lr=value;ch.isLREnable=value;}
    }
   }
   this.state.lastWrite={at:new Date().toISOString(),status:'confirmed',channel:key||`ch_${modId}`,field,target:value,received:value};
   return this.state;
  }
  const generation=this.generation,wasAutomatic=this.state.autoRead;clearInterval(this.syncTimer);this.syncTimer=null;this.state.autoRead=false;this.state.writeInProgress=true;
  const record={at:new Date().toISOString(),status:'checking',channel:key||`ch_${modId}`,field,target:value};this.state.lastWrite=record;
  try{
   const bytes=encodeOutput110(model);this.socket.write(bytes);this.state.bytesSent+=bytes.length;
   Object.assign(record,{status:'sent',frameHex:bytes.toString('hex')});
   await delay(120);if(!this.state.readPending){try{this.requestSnapshot(true)}catch{}}
   Object.assign(record,{status:'confirmed',confirmedAt:new Date().toISOString(),received:value});return this.state;
  }catch(e){Object.assign(record,{status:'error',error:e.message});throw e}
  finally{this.state.writeInProgress=false;if(wasAutomatic&&this.generation===generation&&this.state.status==='connected'&&!this.state.decodeError)this.startAutoRead()}
 }
 async applyChannelEq({key,moduleId,eqModel}){
  if(!this.allowChannel1Write)throw Error('Escrita não habilitada.');
  if(this.state.writeInProgress)throw Error('Ajuste anterior ainda em andamento.');
  if(this.state.status!=='connected'&&this.state.status!=='simulated')throw Error('Mesa não conectada.');
  const isOffline=!this.socket||this.state.status==='simulated';
  const ch=this.state.snapshot?.channels?.find(c=>(key&&c.key===key)||(moduleId!==undefined&&c.moduleId===moduleId));
  const chKey=key||ch?.key||`in1Model.ch${(moduleId??0)+1}Model`,parts=chKey.split('.');
  const cur=this.state.snapshot?.raw?.[parts[0]]?.[parts[1]]?.eqPartModel||{};
  const modId=moduleId??ch?.moduleId??cur?.moduleId??0;
  const merged={...cur,...eqModel,moduleId:modId};
  if(isOffline){
   if(this.state.snapshot?.raw?.[parts[0]]?.[parts[1]])this.state.snapshot.raw[parts[0]][parts[1]].eqPartModel=merged;
   this.state.lastWrite={at:new Date().toISOString(),status:'confirmed',channel:key||`ch_${modId}`,field:'eq',target:eqModel};
   return this.state;
  }
  const generation=this.generation,wasAutomatic=this.state.autoRead;clearInterval(this.syncTimer);this.syncTimer=null;this.state.autoRead=false;this.state.writeInProgress=true;
  const record={at:new Date().toISOString(),status:'checking',channel:key||`ch_${modId}`,field:'eq',target:eqModel};this.state.lastWrite=record;
  try{
   const bytes=encodeEq104(merged);this.socket.write(bytes);this.state.bytesSent+=bytes.length;
   Object.assign(record,{status:'sent',frameHex:bytes.toString('hex')});
   await delay(120);if(!this.state.readPending){try{this.requestSnapshot(true)}catch{}}
   Object.assign(record,{status:'confirmed',confirmedAt:new Date().toISOString()});return this.state;
  }catch(e){Object.assign(record,{status:'error',error:e.message});throw e}
  finally{this.state.writeInProgress=false;if(wasAutomatic&&this.generation===generation&&this.state.status==='connected'&&!this.state.decodeError)this.startAutoRead()}
 }
 async applyChannelDynamic({key,moduleId,dynModel}){
  if(!this.allowChannel1Write)throw Error('Escrita não habilitada.');
  if(this.state.writeInProgress)throw Error('Ajuste anterior ainda em andamento.');
  if(this.state.status!=='connected'&&this.state.status!=='simulated')throw Error('Mesa não conectada.');
  const isOffline=!this.socket||this.state.status==='simulated';
  const ch=this.state.snapshot?.channels?.find(c=>(key&&c.key===key)||(moduleId!==undefined&&c.moduleId===moduleId));
  const chKey=key||ch?.key||`in1Model.ch${(moduleId??0)+1}Model`,parts=chKey.split('.');
  const cur=this.state.snapshot?.raw?.[parts[0]]?.[parts[1]]?.dymanicPartModel||{};
  const modId=moduleId??ch?.moduleId??cur?.moduleId??0;
  const merged={...cur,...dynModel,moduleId:modId};
  if(isOffline){
   if(this.state.snapshot?.raw?.[parts[0]]?.[parts[1]])this.state.snapshot.raw[parts[0]][parts[1]].dymanicPartModel=merged;
   this.state.lastWrite={at:new Date().toISOString(),status:'confirmed',channel:key||`ch_${modId}`,field:'dyn',target:dynModel};
   return this.state;
  }
  const generation=this.generation,wasAutomatic=this.state.autoRead;clearInterval(this.syncTimer);this.syncTimer=null;this.state.autoRead=false;this.state.writeInProgress=true;
  const record={at:new Date().toISOString(),status:'checking',channel:key||`ch_${modId}`,field:'dyn',target:dynModel};this.state.lastWrite=record;
  try{
   const bytes=encodeDynamic106(merged);this.socket.write(bytes);this.state.bytesSent+=bytes.length;
   Object.assign(record,{status:'sent',frameHex:bytes.toString('hex')});
   await delay(120);if(!this.state.readPending){try{this.requestSnapshot(true)}catch{}}
   Object.assign(record,{status:'confirmed',confirmedAt:new Date().toISOString()});return this.state;
  }catch(e){Object.assign(record,{status:'error',error:e.message});throw e}
  finally{this.state.writeInProgress=false;if(wasAutomatic&&this.generation===generation&&this.state.status==='connected'&&!this.state.decodeError)this.startAutoRead()}
 }
 async applyChannelInput({key,moduleId,inputModel}){
  if(!this.allowChannel1Write)throw Error('Escrita não habilitada.');
  if(this.state.writeInProgress)throw Error('Ajuste anterior ainda em andamento.');
  if(this.state.status!=='connected'&&this.state.status!=='simulated')throw Error('Mesa não conectada.');
  const isOffline=!this.socket||this.state.status==='simulated';
  const ch=this.state.snapshot?.channels?.find(c=>(key&&c.key===key)||(moduleId!==undefined&&c.moduleId===moduleId));
  const chKey=key||ch?.key||`in1Model.ch${(moduleId??0)+1}Model`,parts=chKey.split('.');
  const cur=this.state.snapshot?.raw?.[parts[0]]?.[parts[1]]?.inputPartModel||{};
  const modId=moduleId??ch?.moduleId??cur?.moduleId??0;
  const merged={...cur,...inputModel,moduleId:modId};
  if(isOffline){
   if(this.state.snapshot?.raw?.[parts[0]]?.[parts[1]])this.state.snapshot.raw[parts[0]][parts[1]].inputPartModel=merged;
   this.state.lastWrite={at:new Date().toISOString(),status:'confirmed',channel:key||`ch_${modId}`,field:'input',target:inputModel};
   return this.state;
  }
  const generation=this.generation,wasAutomatic=this.state.autoRead;clearInterval(this.syncTimer);this.syncTimer=null;this.state.autoRead=false;this.state.writeInProgress=true;
  const record={at:new Date().toISOString(),status:'checking',channel:key||`ch_${modId}`,field:'input',target:inputModel};this.state.lastWrite=record;
  try{
   const bytes=encodeInput102(merged);this.socket.write(bytes);this.state.bytesSent+=bytes.length;
   Object.assign(record,{status:'sent',frameHex:bytes.toString('hex')});
   await delay(120);if(!this.state.readPending){try{this.requestSnapshot(true)}catch{}}
   Object.assign(record,{status:'confirmed',confirmedAt:new Date().toISOString()});return this.state;
  }catch(e){Object.assign(record,{status:'error',error:e.message});throw e}
  finally{this.state.writeInProgress=false;if(wasAutomatic&&this.generation===generation&&this.state.status==='connected'&&!this.state.decodeError)this.startAutoRead()}
 }
 async applyMaster({field,value}){
  if(!this.allowChannel1Write)throw Error('Escrita não habilitada.');
  if(this.state.writeInProgress)throw Error('Ajuste anterior ainda em andamento.');
  if(this.state.status!=='connected'&&this.state.status!=='simulated')throw Error('Mesa não conectada.');
  const isOffline=!this.socket||this.state.status==='simulated';
  const cur=this.state.snapshot?.raw?.busModel?.outBusLRModel?.outputModel||{};
  const model={moduleId:255,gainValue:cur.gainValue??500,isMute:cur.isMute??false,isSolo:cur.isSolo??false,panValue:cur.panValue??0,[field]:value};
  if(isOffline){
   if(this.state.snapshot?.raw?.busModel?.outBusLRModel?.outputModel){
    this.state.snapshot.raw.busModel.outBusLRModel.outputModel[field]=value;
   }
   if(this.state.snapshot?.master){
    if(field==='gainValue')this.state.snapshot.master.fader=value;
    if(field==='isMute')this.state.snapshot.master.mute=value;
    if(field==='isSolo')this.state.snapshot.master.solo=value;
    if(field==='panValue')this.state.snapshot.master.pan=value;
   }
   this.state.lastWrite={at:new Date().toISOString(),status:'confirmed',channel:'master',field,target:value,received:value};
   return this.state;
  }
  const generation=this.generation,wasAutomatic=this.state.autoRead;clearInterval(this.syncTimer);this.syncTimer=null;this.state.autoRead=false;this.state.writeInProgress=true;
  const record={at:new Date().toISOString(),status:'checking',channel:'master',field,target:value};this.state.lastWrite=record;
  try{
   const bytes=encodeMaster114(model);this.socket.write(bytes);this.state.bytesSent+=bytes.length;
   Object.assign(record,{status:'sent',frameHex:bytes.toString('hex')});
   await delay(120);if(!this.state.readPending){try{this.requestSnapshot(true)}catch{}}
   Object.assign(record,{status:'confirmed',confirmedAt:new Date().toISOString()});return this.state;
  }catch(e){Object.assign(record,{status:'error',error:e.message});throw e}
  finally{this.state.writeInProgress=false;if(wasAutomatic&&this.generation===generation&&this.state.status==='connected'&&!this.state.decodeError)this.startAutoRead()}
 }
 async applyBusSend({moduleId=0,busParamId=1,field='gainValue',value,busModel}){
  if(!this.allowChannel1Write)throw Error('Escrita não habilitada.');
  if(this.state.writeInProgress)throw Error('Ajuste anterior ainda em andamento.');
  if(this.state.status!=='connected'&&this.state.status!=='simulated')throw Error('Mesa não conectada.');
  const isOffline=!this.socket||this.state.status==='simulated';
  const model={moduleId,busParamId,isBusEnable:true,...(busModel||{[field]:value})};
  if(isOffline){
   this.state.lastWrite={at:new Date().toISOString(),status:'confirmed',channel:`ch_${moduleId}`,field:`bus_${busParamId}`,target:busModel||{[field]:value}};
   return this.state;
  }
  const generation=this.generation,wasAutomatic=this.state.autoRead;clearInterval(this.syncTimer);this.syncTimer=null;this.state.autoRead=false;this.state.writeInProgress=true;
  const record={at:new Date().toISOString(),status:'checking',channel:`ch_${moduleId}`,field:`bus_${busParamId}`,target:busModel||{[field]:value}};this.state.lastWrite=record;
  try{
   const bytes=encodeBus108(model);this.socket.write(bytes);this.state.bytesSent+=bytes.length;
   Object.assign(record,{status:'sent',frameHex:bytes.toString('hex')});
   await delay(120);if(!this.state.readPending){try{this.requestSnapshot(true)}catch{}}
   Object.assign(record,{status:'confirmed',confirmedAt:new Date().toISOString()});return this.state;
  }catch(e){Object.assign(record,{status:'error',error:e.message});throw e}
  finally{this.state.writeInProgress=false;if(wasAutomatic&&this.generation===generation&&this.state.status==='connected'&&!this.state.decodeError)this.startAutoRead()}
 }
 async applyMuteGroup({group,mute=true}){
  if(!this.state.snapshot?.channels)throw Error('Nenhum snapshot carregado.');
  const channels=this.state.snapshot.channels;
  let targetChannels=[];
  if(group==='all'){
   targetChannels=channels;
   await this.applyMaster({field:'isMute',value:mute});
  }else if(group==='vocals'){
   targetChannels=channels.filter((c,i)=>{
    const name=(c.name||'').toUpperCase();
    return name.includes('VOZ')||name.includes('VOCAL')||name.includes('MIC')||i<4;
   });
  }else if(group==='band'){
   targetChannels=channels.filter((c,i)=>{
    const name=(c.name||'').toUpperCase();
    const isVocal=name.includes('VOZ')||name.includes('VOCAL')||name.includes('MIC')||i<4;
    return !isVocal;
   });
  }else if(group==='clear'){
   targetChannels=channels;
   mute=false;
   await this.applyMaster({field:'isMute',value:false});
  }
  for(const ch of targetChannels){
   await this.applyChannelControl({key:ch.key,moduleId:ch.moduleId,field:'isMuteEnable',value:mute});
  }
  return this.state;
 }
 async applyScene(scene){
  if(!scene)throw Error('Cena inválida.');
  if(scene.master&&typeof scene.master.fader==='number'){
   await this.applyMaster({field:'gainValue',value:scene.master.fader});
  }
  if(scene.master&&typeof scene.master.mute==='boolean'){
   await this.applyMaster({field:'isMute',value:scene.master.mute});
  }
  if(Array.isArray(scene.channels)){
   for(const ch of scene.channels){
    if(typeof ch.faderRaw==='number'){
     await this.applyChannelControl({moduleId:ch.moduleId,field:'outFaderValue',value:ch.faderRaw});
    }
    if(typeof ch.mute==='boolean'){
     await this.applyChannelControl({moduleId:ch.moduleId,field:'isMuteEnable',value:ch.mute});
    }
    if(typeof ch.pan==='number'){
     await this.applyChannelControl({moduleId:ch.moduleId,field:'panValue',value:ch.pan});
    }
    if(typeof ch.solo==='boolean'){
     await this.applyChannelControl({moduleId:ch.moduleId,field:'isSoloEnable',value:ch.solo});
    }
    if(typeof ch.lr==='boolean'){
     await this.applyChannelControl({moduleId:ch.moduleId,field:'isLREnable',value:ch.lr});
    }
   }
  }
  return this.state;
 }
 simulateOffline(filePath='capturas/analise-inicial/response-6400.bin'){
  this.disconnect();
  this.reset();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    filePath,
    path.resolve(process.cwd(), filePath),
    path.resolve(__dirname, 'response-6400.bin'),
    path.resolve(__dirname, '../capturas/analise-inicial/response-6400.bin'),
  ];
  const fullPath = candidates.find(p => p && fs.existsSync(p));
  if(fullPath){
   const bin=fs.readFileSync(fullPath);
   this.state.snapshot=snapshotFromStream(bin);
   if(this.state.snapshot){
    const out=this.state.snapshot?.raw?.busModel?.outBusLRModel?.outputModel;
    this.state.snapshot.master={
     fader:out?.gainValue??500,
     mute:out?.isMute??false,
     solo:out?.isSolo??false,
     pan:out?.panValue??0
    };
   }
  }
  this.state.status='simulated';
  this.state.host='192.168.18.162';
  this.state.port=6400;
  this.state.protocol='tcp';
  this.state.meterStatus='simulated';
  this.updateSimulatedMeters();
  this.startSimulatedMeters();
  return this.state;
 }
 updateSimulatedMeters(){
  const channels=(this.state.snapshot?.channels||[]).map((ch,idx)=>{
   const fader=ch.faderRaw??ch.outFaderValue??0;
   const isMuted=ch.mute===true;
   let db=-90;let pct=0;
   if(!isMuted&&fader>50){
    const base=-34+(fader/1000)*24;
    const jitter=(Math.sin(Date.now()/250+idx*1.3)*3+Math.random()*2);
    db=Math.min(-2,Math.max(-65,Math.round(base+jitter)));
    pct=Math.max(0,Math.min(100,Math.round(((db+70)/70)*100)));
   }
   return{id:idx+1,moduleId:ch.moduleId,name:ch.name,level:db,pct,ng:ch.moduleId===0?-12:null,comp:ch.moduleId===0?-3:null};
  });
  const masterMuted=this.state.snapshot?.master?.mute??false;
  const masterFader=this.state.snapshot?.master?.fader??500;
  let mL=-90,mR=-90,mLPct=0,mRPct=0;
  if(!masterMuted&&masterFader>50){
   mL=Math.round(-18+Math.sin(Date.now()/320)*4);
   mR=Math.round(-19+Math.cos(Date.now()/320)*4);
   mLPct=Math.max(0,Math.min(100,Math.round(((mL+70)/70)*100)));
   mRPct=Math.max(0,Math.min(100,Math.round(((mR+70)/70)*100)));
  }
  const meters={channels,master:{left:mL,right:mR,leftPct:mLPct,rightPct:mRPct}};
  this.state.meters=meters;
  this.emit('meters',meters);
 }
 startSimulatedMeters(){
  clearInterval(this.simMeterInterval);
  this.simMeterInterval=setInterval(()=>{
   if(this.state.status!=='simulated'){clearInterval(this.simMeterInterval);return}
   this.updateSimulatedMeters();
  },150);
  this.simMeterInterval.unref?.();
 }
 async connect({protocol,host,port,localPort=0,meterPort,autoRead=false}){
  if(this.state.writeInProgress)throw Error('Aguarde a confirmação do ajuste antes de reconectar.');
  if(!['tcp','udp'].includes(protocol))throw Error('Protocolo deve ser tcp ou udp.');
  if(net.isIP(host)!==4)throw Error('Informe um endereço IPv4 válido.');
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Porta de destino inválida.');
  if(!Number.isInteger(localPort)||localPort<0||localPort>65535)throw Error('Porta local inválida.');
  if(typeof autoRead!=='boolean'||(autoRead&&(protocol!=='tcp'||port!==6400)))throw Error('Leitura automática exige TCP 6400.');
  this.disconnect();this.reset();const generation=this.generation;Object.assign(this.state,{status:'connecting',protocol,host,port});
  const socket=protocol==='tcp'?new net.Socket():dgram.createSocket('udp4');this.socket=socket;
  const current=()=>this.generation===generation;
  socket.on('error',e=>{if(current()){this.state.error=e.message;this.state.status='error';this.realtime?.abort(e.message);this.stopTimers()}});
  if(protocol==='tcp'){socket.on('data',d=>{if(current())this.log(d,`${host}:${port}`)});socket.on('close',()=>{if(current()){this.realtime?.abort('Conexão TCP encerrada.');this.stopTimers();if(this.state.status!=='error')this.state.status='disconnected'}})}
  else socket.on('message',(d,r)=>{if(current())this.log(d,`${r.address}:${r.port}`)});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{if(current()){this.disconnect();this.state.status='error';this.state.error='Tempo limite de conexão.'}reject(Error('Tempo limite de conexão.'))},4000);const fail=e=>{clearTimeout(timeout);reject(e)};socket.once('error',fail);const ready=()=>{clearTimeout(timeout);socket.off('error',fail);if(!current()){reject(Error('Conexão cancelada.'));return}this.state.status=protocol==='tcp'?'connected':'listening';this.state.localPort=socket.address().port;resolve()};if(protocol==='tcp')socket.connect(port,host,ready);else socket.bind(localPort,'0.0.0.0',ready)});
  const targetMeterPort=meterPort??(protocol==='tcp'&&port===6400?6401:null);
  if(targetMeterPort)this.connectMeterSocket(host,targetMeterPort,generation);
  if(autoRead)this.startAutoRead();return this.state;
 }
 connectMeterSocket(host,meterPort,generation){
  if(this.meterSocket){try{this.meterSocket.destroy()}catch{}this.meterSocket=null}
  const current=()=>this.generation===generation&&this.state.status==='connected';
  const meterSocket=new net.Socket();this.meterSocket=meterSocket;
  meterSocket.on('error',e=>{if(current()){this.state.meterError=e.message}});
  meterSocket.on('data',d=>{
   if(!current())return;
   try{
    for(const meter of this.meterDecoder.feed(d)){
     this.state.meters=meter;
     this.emit('meters',meter);
    }
   }catch(err){this.state.meterError=err.message}
  });
  meterSocket.on('close',()=>{if(current())this.state.meterStatus='disconnected'});
  meterSocket.connect(meterPort,host,()=>{
   if(current()){this.state.meterStatus='connected';this.state.meterError=null}
  });
 }
}
