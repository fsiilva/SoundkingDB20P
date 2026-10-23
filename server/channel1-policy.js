import {readFileSync}from'node:fs';
export const profile=JSON.parse(readFileSync(new URL('./validated-profile.json',import.meta.url),'utf8'));
export function channel1Target(state,{delta,expectedRaw},enabled=profile.channel1FaderEnabled){
 if(!enabled)throw Error('Teste de escrita do canal 1 não habilitado.');
 if(state.status!=='connected'||state.protocol!=='tcp'||state.port!==6400||state.host!==profile.host)throw Error('Conexão não corresponde ao equipamento validado.');
 if(delta!==-1&&delta!==1)throw Error('Permitido apenas um passo de ±1 unidade bruta.');
 const snapshot=state.snapshot,age=Date.now()-Date.parse(snapshot?.receivedAt);
 if(!snapshot||!Number.isFinite(age)||age<0||age>15000||state.error||state.decodeError||state.snapshotError)throw Error('Leitura atual válida necessária.');
 const ch=snapshot.channels?.find(ch=>ch.key===profile.channelKey);
 const output=snapshot.raw?.in1Model?.ch1Model?.outputPartModel;
 if(!ch||ch.moduleId!==0||ch.name.trim()!==profile.channelName||output?.moduleId!==0)throw Error('Canal 1 não corresponde à BATERIA validada.');
 if(ch.mute!==true||output.isMuteEnable!==true)throw Error('O teste exige BATERIA com mute ligado.');
 if(!Number.isFinite(expectedRaw)||!Number.isFinite(output.outFaderValue)||Math.abs(expectedRaw-output.outFaderValue)>.001)throw Error('Fader mudou desde a leitura. Atualize antes de ajustar.');
 const target=Math.fround(output.outFaderValue+delta);
 if(target<profile.minRaw||target>profile.maxRaw)throw Error('Passo fora da faixa observada na captura.');
 return {before:output.outFaderValue,target,model:{...output,outFaderValue:target},output};
}
export function channel1Control(state,request,enabled=profile.channel1FaderEnabled){
 const{field,value,expectedRaw,expectedPan,expectedMute}=request;
 if(!['outFaderValue','panValue','isMuteEnable'].includes(field))throw Error('Controle não validado para escrita.');
 // Validate identity/freshness independently from the output modification.
 const output=state.snapshot?.raw?.in1Model?.ch1Model?.outputPartModel;
 const guard=field==='isMuteEnable'&&value===true;
 validateChannel1(state,expectedRaw,enabled,!guard);
 if(expectedPan!==undefined&&(!Number.isFinite(expectedPan)||Math.abs(expectedPan-output.panValue)>.001))throw Error('Pan mudou desde a leitura.');
 if(expectedMute!==undefined&&(typeof expectedMute!=='boolean'||expectedMute!==output.isMuteEnable))throw Error('Mute mudou desde a leitura.');
 if(field==='outFaderValue'&&(!Number.isFinite(value)||value<profile.minRaw||value>profile.maxRaw))throw Error('Fader fora da faixa capturada.');
 if(field==='panValue'&&(!profile.channel1PanEnabled||!Number.isFinite(value)||value<-1||value>1))throw Error('Pan de teste deve ficar entre -1 e +1.');
 if(field==='isMuteEnable'&&value!==true)throw Error('Somente ligar o mute está disponível.');
 const target=typeof value==='number'?Math.fround(value):value;
 return{before:output[field],target,field,model:{...output,[field]:target},output};
}
function validateChannel1(state,expectedRaw,enabled,requireMute=true){
 if(!enabled)throw Error('Controle do canal 1 não habilitado.');
 if(state.status!=='connected'||state.protocol!=='tcp'||state.port!==6400||state.host!==profile.host)throw Error('Conexão não corresponde ao equipamento validado.');
 const snapshot=state.snapshot,age=Date.now()-Date.parse(snapshot?.receivedAt),ch=snapshot?.channels?.find(ch=>ch.key===profile.channelKey),output=snapshot?.raw?.in1Model?.ch1Model?.outputPartModel;
 if(!snapshot||!Number.isFinite(age)||age<0||age>15000||state.error||state.decodeError||state.snapshotError)throw Error('Leitura atual válida necessária.');
 if(!ch||ch.moduleId!==0||ch.name.trim()!==profile.channelName||output?.moduleId!==0)throw Error('Canal 1 não corresponde à BATERIA validada.');
 if(requireMute&&(ch.mute!==true||output.isMuteEnable!==true))throw Error('Fader e pan exigem BATERIA com mute ligado.');
 if(!Number.isFinite(expectedRaw)||!Number.isFinite(output.outFaderValue)||Math.abs(expectedRaw-output.outFaderValue)>.001)throw Error('Fader mudou desde a leitura.');
}
