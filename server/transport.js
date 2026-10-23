import {EventEmitter} from 'node:events';
import{RealtimeFader}from'./realtime-fader.js';
import {channel1Target,channel1Control,profile}from'./channel1-policy.js';
import {setTimeout as delay}from'node:timers/promises';
import {SnapshotDecoder,SNAPSHOT_REQUEST,encodeOutput110} from './db20p.js';
import {MeterDecoder} from './meter-decoder.js';
import net from 'node:net';
import dgram from 'node:dgram';
export class Transport extends EventEmitter {
 constructor({allowChannel1Write=profile.channel1FaderEnabled,allowRead=true}={}){super();this.allowChannel1Write=allowChannel1Write;this.allowRead=allowRead;this.socket=null;this.meterSocket=null;this.generation=0;this.syncTimer=null;this.readTimer=null;this.reset();this.realtime=new RealtimeFader(this)}
 reset(){this.decoder=new SnapshotDecoder();this.meterDecoder=new MeterDecoder();this.state={status:'disconnected',protocol:null,host:null,port:null,bytesReceived:0,packetsReceived:0,error:null,logs:[],localPort:null,snapshot:null,snapshotRequestedAt:null,decodeError:null,snapshotError:null,bytesSent:0,autoRead:false,readPending:false,writeInProgress:false,lastWrite:null,activeFader:null,meters:null,meterStatus:'disconnected',meterError:null,permissions:{allowRead:this.allowRead,writeEnabled:this.allowChannel1Write},capabilities:{channel1Fader:this.allowChannel1Write,faders:this.allowChannel1Write,maxLiveFaderRaw:1000,channel1Pan:!!profile.channel1PanEnabled,channel1MuteOn:this.allowChannel1Write,maxFaderRaw:profile.maxRaw}}}
 stopTimers(){clearInterval(this.syncTimer);clearTimeout(this.readTimer);this.syncTimer=null;this.readTimer=null;this.state.autoRead=false;this.state.readPending=false}
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
