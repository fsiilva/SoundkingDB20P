// Reversible validation for the user-designated, muted BATERIA channel only.
import{Transport}from'../server/transport.js';import{writeFileSync,mkdirSync}from'node:fs';
const t=new Transport({allowChannel1Write:true});const evidence={at:new Date().toISOString(),steps:[]};let baseline=null,target=null,restored=false;
const current=()=>t.state.snapshot?.channels.find(c=>c.key==='in1Model.ch1Model');
mkdirSync('capturas/calibracao-canal1',{recursive:true});const save=()=>writeFileSync('capturas/calibracao-canal1/teste-escrita.json',JSON.stringify(evidence,null,2));
try{
 await t.connect({protocol:'tcp',host:'192.168.18.162',port:6400});await t.freshSnapshot(t.generation);
 const ch=current();if(ch?.name.trim()!=='BATERIA'||ch.moduleId!==0||ch.mute!==true)throw Error('BATERIA não está identificada e mutada. Nenhum ajuste enviado.');
 baseline=ch.rawFader;target=Math.fround(baseline-1);evidence.baseline={channel:ch,output:t.state.snapshot.raw.in1Model.ch1Model.outputPartModel};save();
 console.log(JSON.stringify({phase:'baseline',fader:baseline,mute:ch.mute,target}));
 await t.stepChannel1({delta:-1,expectedRaw:baseline});evidence.steps.push({...t.state.lastWrite});save();console.log(JSON.stringify({phase:'step-confirmed',fader:current().rawFader,mute:current().mute}));
 await t.stepChannel1({delta:1,expectedRaw:target});evidence.steps.push({...t.state.lastWrite});
 if(Math.abs(current().rawFader-baseline)>.001||current().mute!==true)throw Error('Restauração divergente.');restored=true;evidence.restored=true;save();console.log(JSON.stringify({phase:'restored',fader:current().rawFader,mute:current().mute}));
}catch(e){evidence.error=e.message;console.error(e.message);process.exitCode=1}
finally{
 if(baseline!==null&&!restored){try{await t.freshSnapshot(t.generation);const ch=current();if(Math.abs(ch.rawFader-baseline)<.001){restored=true;evidence.restored=true}else if(ch.mute===true&&Math.abs(ch.rawFader-target)<.001){await t.stepChannel1({delta:1,expectedRaw:target});restored=Math.abs(current().rawFader-baseline)<.001;evidence.recovery={...t.state.lastWrite};evidence.restored=restored}else evidence.manualCheck='Fader alterado por outro estado ou mute desligado; não sobrescrito automaticamente.'}catch(e){evidence.recoveryError=e.message}}
 evidence.lastChannel=current();save();t.disconnect();if(baseline!==null&&!restored)console.error('VERIFICAR MANUALMENTE BATERIA: restauração não confirmada.');
}
