// One request in flight, only the newest unsent value retained, final value drained on release.
export class FaderQueue{
 constructor({start,move,end,onState=()=>{},interval=100}){Object.assign(this,{start,move,end,onState,interval});this.closed=true;this.disposed=false}
 emit(state){if(!this.disposed)this.onState(state)}
 begin(options){if(!this.closed)return false;this.options=options;this.token=null;this.sequence=0;this.pending=null;this.finishing=false;this.closed=false;this.failed=false;this.busy=false;this.endStarted=false;this.done=new Promise(resolve=>this.resolve=resolve);this.emit({phase:'ready'});return true}
 update(value){if(this.closed||this.failed||this.finishing)return;this.pending=value;this.emit({phase:'sending',value});this.pump()}
 finish(){if(this.closed)return this.done??Promise.resolve();this.finishing=true;this.emit({phase:'verifying'});this.pump();return this.done}
 async pump(){if(this.busy||this.closed)return;this.busy=true;try{
  if(!this.token&&this.pending!==null){this.emit({phase:'starting',value:this.pending});const result=await this.start(this.options);this.token=result.token}
  while(this.pending!==null&&!this.closed){const value=this.pending;this.pending=null;await this.move({token:this.token,value,sequence:++this.sequence});this.emit({phase:'sent',value:this.pending??value});if(this.pending!==null)await new Promise(r=>setTimeout(r,this.interval))}
  if(this.finishing){if(this.token){this.emit({phase:'verifying'});this.endStarted=true;const result=await this.end({token:this.token});this.emit({phase:'confirmed',value:result.raw,confirmedAt:result.confirmedAt})}this.closed=true;this.resolve?.()}
 }catch(e){this.failed=true;this.closed=true;this.pending=null;this.emit({phase:'error',error:e.message});if(this.token&&!this.endStarted)this.end({token:this.token}).catch(()=>{});this.resolve?.()}
 finally{this.busy=false;if(!this.closed&&(this.pending!==null||this.finishing))this.pump()}}
 dispose(){this.disposed=true;return this.finish()}
}
