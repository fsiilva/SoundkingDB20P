import{randomUUID}from'node:crypto';
import{setTimeout as delay}from'node:timers/promises';
import{encodeOutput110}from'./db20p.js';
import{profile}from'./channel1-policy.js';
const protectedFields=['moduleId','panValue','isMuteEnable','isSoloEnable','isLREnable'];
export function faderModel(state,key,expectedRaw){
 if(state.status!=='connected'||state.protocol!=='tcp'||state.port!==6400||state.host!==profile.host)throw Error('Mesa validada não conectada.');
 if(state.error||state.decodeError||state.snapshotError)throw Error('A conexão precisa de uma leitura válida.');
 const snapshot=state.snapshot,age=Date.now()-Date.parse(snapshot?.receivedAt);
 if(!Number.isFinite(age)||age<0||age>15000)throw Error('Dados da mesa desatualizados.');
 const ch=snapshot?.channels?.find(c=>c.key===key);const parts=typeof key==='string'?key.split('.'):[];
 const output=parts.length===2?snapshot?.raw?.[parts[0]]?.[parts[1]]?.outputPartModel:null;
 if(!ch||!output||!Number.isInteger(ch.moduleId)||ch.moduleId<0||ch.moduleId>15||output.moduleId!==ch.moduleId)throw Error('Canal de entrada não reconhecido.');
 if(snapshot.channels.filter(c=>c.moduleId===ch.moduleId).length!==1)throw Error('ID de canal ambíguo.');
 if(!Number.isFinite(output.outFaderValue)||output.outFaderValue<0||output.outFaderValue>1000)throw Error('Fader recebido fora da faixa do aplicativo.');
 if(expectedRaw!==undefined&&(!Number.isFinite(expectedRaw)||Math.abs(output.outFaderValue-expectedRaw)>.001))throw Error('O canal mudou antes do arraste. Tente novamente.');
 return{...output};
}
export class RealtimeFader{
 constructor(transport){this.t=transport;this.session=null}
 async start({key,expectedRaw}){
  const t=this.t;if(!t.allowChannel1Write)throw Error('Escrita não habilitada.');
  if(t.state.writeInProgress||this.session)throw Error('Outro ajuste está em andamento.');
  faderModel(t.state,key,expectedRaw);const generation=t.generation,automatic=t.state.autoRead;
  clearInterval(t.syncTimer);t.syncTimer=null;t.state.autoRead=false;t.state.writeInProgress=true;
  const record={at:new Date().toISOString(),channel:key,field:'outFaderValue',status:'checking',realtime:true};t.state.lastWrite=record;
  try{
   await t.freshSnapshot(generation);const model=faderModel(t.state,key,expectedRaw);
   const s={token:randomUUID(),key,model,generation,automatic,record,sequence:0,lastSentSequence:0,lastSentAt:0,target:model.outFaderValue,pending:null,ending:false,frames:0};this.session=s;
   t.state.activeFader={key,status:'dragging'};record.status='dragging';record.before=model.outFaderValue;
   this.arm(s);s.deadline=setTimeout(()=>{this.end({token:s.token}).catch(()=>{})},60000);s.deadline.unref?.();
   s.poll=setInterval(()=>{if(this.session!==s||s.ending)return;try{if(t.state.readPending)return;t.requestSnapshot(true)}catch(e){this.abort(e.message)}},750);s.poll.unref?.();
   return{token:s.token,key,raw:model.outFaderValue,maxRaw:1000};
  }catch(e){record.status='error';record.error=e.message;t.state.writeInProgress=false;if(automatic&&t.generation===generation&&t.state.status==='connected')t.startAutoRead();throw e}
 }
 get(token){const s=this.session;if(!s||s.token!==token)throw Error('Arraste expirou ou pertence a outra sessão.');if(s.generation!==this.t.generation||this.t.state.status!=='connected'||this.t.state.error||this.t.state.decodeError||this.t.state.snapshotError){this.abort('Conexão interrompida durante o arraste.');throw Error('Conexão interrompida durante o arraste.')}return s}
 arm(s){clearTimeout(s.idle);s.idle=setTimeout(()=>{this.end({token:s.token}).catch(()=>{})},5000);s.idle.unref?.()}
 move({token,value,sequence}){
  const s=this.get(token);if(s.ending)throw Error('Arraste já está sendo confirmado.');
  if(!Number.isFinite(value)||value<0||value>1000)throw Error('Fader deve estar entre 0 e 1000.');
  if(!Number.isSafeInteger(sequence)||sequence<=0)throw Error('Sequência inválida.');
  if(sequence<=s.sequence)return{status:'ignored',sequence:s.sequence,raw:s.target};
  s.sequence=sequence;s.target=Math.fround(value);s.pending={value:s.target,sequence};this.arm(s);
  this.schedule(s);return{status:s.pending?'queued':'sent',sequence:s.sequence,raw:s.target};
 }
 schedule(s){if(s.sendTimer)return;const wait=Math.max(0,100-(Date.now()-s.lastSentAt));if(wait===0){this.flush(s);return}s.sendTimer=setTimeout(()=>{s.sendTimer=null;try{this.flush(s)}catch(e){this.abort(e.message)}},wait);s.sendTimer.unref?.()}
 flush(s){if(this.session!==s||!s.pending)return;this.get(s.token);const item=s.pending;s.pending=null;
  const bytes=encodeOutput110({...s.model,outFaderValue:item.value});this.t.socket.write(bytes);this.t.state.bytesSent+=bytes.length;s.lastSentAt=Date.now();s.lastSentSequence=item.sequence;s.frames++;
  Object.assign(s.record,{status:'streaming',target:item.value,sequence:item.sequence,frames:s.frames});
 }
 observe(snapshot){const s=this.session;if(!s)return;const parts=s.key.split('.'),output=snapshot.raw?.[parts[0]]?.[parts[1]]?.outputPartModel;
  if(!output||protectedFields.some(field=>output[field]!==s.model[field]))this.abort('Mute, pan, solo ou roteamento mudou em outro controlador. Arraste interrompido.');
 }
 async end({token}){
  const s=this.get(token);if(s.finishPromise)return s.finishPromise;s.ending=true;
  s.finishPromise=this.finish(s);return s.finishPromise;
 }
 async finish(s){const t=this.t;clearTimeout(s.idle);clearTimeout(s.deadline);clearInterval(s.poll);clearTimeout(s.sendTimer);s.sendTimer=null;
  try{
   if(s.pending){const wait=100-(Date.now()-s.lastSentAt);if(wait>0)await delay(wait);this.flush(s)}
   s.record.status='verifying';t.state.activeFader={key:s.key,status:'verifying'};
   await t.freshSnapshot(s.generation);if(this.session!==s)throw Error(s.record.error||'Arraste interrompido.');this.get(s.token);
   const model=faderModel(t.state,s.key);
   if(Math.abs(model.outFaderValue-s.target)>.001)throw Error('O valor final não foi confirmado pela mesa.');
   Object.assign(s.record,{status:'confirmed',target:s.target,received:model.outFaderValue,frames:s.frames,confirmedAt:t.state.snapshot.receivedAt});
   return{status:'confirmed',key:s.key,raw:model.outFaderValue,sequence:s.sequence,confirmedAt:s.record.confirmedAt};
  }catch(e){s.record.status='error';s.record.error=e.message;throw e}
  finally{this.release(s)}
 }
 release(s){clearTimeout(s.idle);clearTimeout(s.deadline);clearTimeout(s.sendTimer);clearInterval(s.poll);if(this.session!==s)return;this.session=null;this.t.state.writeInProgress=false;this.t.state.activeFader=null;if(s.automatic&&this.t.generation===s.generation&&this.t.state.status==='connected'&&!this.t.state.decodeError)this.t.startAutoRead()}
 abort(message='Arraste cancelado.'){const s=this.session;if(!s)return;s.pending=null;s.record.status='error';s.record.error=message;this.release(s)}
}
