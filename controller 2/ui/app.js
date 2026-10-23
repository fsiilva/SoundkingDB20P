"use strict";
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
let STATE=null, META=null, SEL=0, MODE="simple";

const api = {
  state: () => fetch("/api/state").then(r=>r.json()),
  meta:  () => fetch("/api/meta").then(r=>r.json()),
  spectrum:(seed=0)=>fetch("/api/spectrum?seed="+seed).then(r=>r.json()),
  suggest:(obj,seed=0)=>fetch("/api/suggest?seed="+seed+(obj?"&obj="+obj:"")).then(r=>r.json()),
  demoSet:(p)=>fetch("/api/demo-set",{method:"POST",body:JSON.stringify(p)}).then(r=>r.json()),
};
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("show"),1600);}
const fmt = (v,d=1) => (v==null?"—":(v>0?"+":"")+Number(v).toFixed(d));
const meterPct = db => Math.max(0,Math.min(100,(db+60)/66*100));   // -60..+6 (exibição)
const faderTop = db => (1-meterPct(db)/100)*100;                    // % do topo

// biquad peaking RBJ (espelha skdmc/analyzer.py) — curva de EQ instantânea no cliente
function peakingDb(f, fc, gainDb, q){
  if(!gainDb) return 0; const fs=48000, A=Math.pow(10,gainDb/40), w0=2*Math.PI*fc/fs;
  const alpha=Math.sin(w0)/(2*Math.max(q,1e-3)), cw=Math.cos(w0);
  const b0=1+alpha*A,b1=-2*cw,b2=1-alpha*A,a0=1+alpha/A,a1=-2*cw,a2=1-alpha/A;
  const w=2*Math.PI*f/fs, cosw=Math.cos(w), sinw=Math.sin(w);
  const mag=(c0,c1,c2)=>Math.hypot(c0+c1*cosw+c2*Math.cos(2*w),-(c1*sinw+c2*Math.sin(2*w)));
  const den=mag(a0,a1,a2); return den?20*Math.log10(mag(b0,b1,b2)/den):0;
}
function eqCurve(bands, pts=120, fmin=20, fmax=20000){
  const out=[]; for(let i=0;i<pts;i++){const f=fmin*Math.pow(fmax/fmin,i/(pts-1));
    let t=0; for(const b of bands){ if(b.bypass)continue; t+=peakingDb(f,b.fc,b.gain||0,b.q||1); }
    out.push([f,t]); } return out;
}

// ---------- navegação ----------
$("#tabs").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;setView(b.dataset.view);});
function setView(v){ $$("#tabs button").forEach(x=>x.classList.toggle("active",x.dataset.view===v));
  $$(".view").forEach(s=>s.classList.toggle("active",s.id==="view-"+v)); render();}
$("#modes").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  MODE=b.dataset.mode; document.body.className=MODE;
  $$("#modes button").forEach(x=>x.classList.toggle("active",x===b)); render();});
document.addEventListener("keydown",e=>{
  if(activeView()!=="view-channels" && activeView()!=="view-eq" && activeView()!=="view-dyn")return;
  if(e.key==="ArrowRight"){SEL=Math.min(STATE.channels.length-1,SEL+1);render();}
  if(e.key==="ArrowLeft"){SEL=Math.max(0,SEL-1);render();}
});
function activeView(){return ($(".view.active")||{}).id||"view-overview";}
function render(){ if(!STATE)return; const v=activeView();
  ({ "view-overview":renderOverview,"view-channels":renderChannels,"view-eq":renderEq,
     "view-dyn":renderDyn,"view-buses":renderBuses,"view-analyze":renderAnalyze,
     "view-settings":renderSettings }[v]||(()=>{}))();
}

// ---------- visão geral ----------
function meterCol(name, db, val){
  return `<div class="mcol"><div class="meter tall"><i style="height:${meterPct(db)}%"></i></div>
    <div class="mlabel">${name}</div>${val!=null?`<div class="mval">${fmt(val)}</div>`:""}</div>`;
}
function renderOverview(){
  const ch=STATE.channels;
  const grp=(title,arr)=>`<div class="ovgroup"><div class="ovh">${title}</div>
     <div class="mrow">${arr.map(c=>meterCol(c.name,c.meter,c.fader)).join("")}</div></div>`;
  const in1=grp("IN1 · Ch 1–8", ch.slice(0,8));
  const in2=grp("IN2 · Ch 9–12", ch.slice(8,12));
  const st=grp("Estéreo", ch.slice(12,16));
  const buses=`<div class="ovgroup"><div class="ovh">Buses 1–8</div>
     <div class="mrow">${STATE.buses.map(b=>meterCol(b.name.replace("Bus ","B"),b.meter,b.fader)).join("")}</div></div>`;
  const m=STATE.master;
  const master=`<div class="ovgroup master"><div class="ovh">Master</div>
     <div class="mrow">${meterCol("L",m.meterL,m.faderL)}${meterCol("R",m.meterR,m.faderR)}</div>
     <div class="row" style="margin-top:8px"><div class="btn mute ${m.mute?'on':''}" data-m="mute">MUTE</div>
       <div class="btn ${m.hpf?'on':''}" data-m="hpf">HPF</div></div></div>`;
  const simTag = STATE._meters_simulados? '<span class="sim-tag">medidores simulados</span>':'';
  $("#overview").innerHTML=`
    <div class="ovtop">${in1}${in2}${st}</div>
    <div class="ovbot">${buses}${master}
      <div class="ovgroup status"><div class="ovh">Status</div>
        <div class="kv">
          <b>Conexão</b><span class="badge off">● desconectado</span>
          <b>Rede</b><span class="val">desativada</span>
          <b>Canais</b><span class="val">${ch.length}</span>
          <b>Buses</b><span class="val">${STATE.buses.length}</span>
          <b>Porta TCP</b><span class="val">6400</span>
          <b>Sync</b><span class="val">0x5A</span>
        </div>${simTag}</div>
    </div>`;
  $("#overview").onclick=async e=>{const b=e.target.closest("[data-m]");if(!b)return;
    const f=b.dataset.m,nv=!STATE.master[f];await api.demoSet({target:"master",field:f,value:nv});
    STATE.master[f]=nv;toast("master "+f+" (demo)");renderOverview();};
}

// ---------- canais ----------
function chNav(){
  return `<div class="chnav">
    <button class="navbtn" data-nav="-1">‹ anterior</button>
    <select id="chjump">${STATE.channels.map((c,i)=>`<option value="${i}" ${i===SEL?'selected':''}>${c.name}</option>`).join("")}</select>
    <button class="navbtn" data-nav="1">próximo ›</button>
    <span class="note">setas ← → navegam</span></div>`;
}
function strip(c,i){ const pro=MODE==="pro";
  return `<div class="strip ${i===SEL?'sel':''}" data-i="${i}" tabindex="0">
    <div class="nm" title="${c.name}">${c.name}</div>
    <div class="mid">id ${c.moduleId}${c.kind==="stereo"?" · ST":""}</div>
    <div class="faderwrap">
      <div class="meter"><i style="height:${meterPct(c.meter)}%"></i></div>
      <div class="fader" data-fader="${i}"><div class="cap" style="top:calc(${faderTop(c.fader)}% - 8px)"></div></div>
    </div>
    <div class="val big">${fmt(c.fader)}<span class="u">dB</span></div>
    <div class="row">
      <div class="btn mute ${c.mute?'on':''}" data-act="mute">MUTE</div>
      <div class="btn solo ${c.solo?'on':''}" data-act="solo">SOLO</div>
    </div>
    <div class="panwrap"><span class="pl">L</span>
      <input class="pan" type="range" min="-1" max="1" step="0.01" value="${c.pan}" data-pan="${i}">
      <span class="pl">R</span></div>
    ${pro?`<div class="mid">pan ${fmt(c.pan,2)}</div>
      <div class="chip-row">${c.input.phantom48v?'<span class="chip on">48V</span>':'<span class="chip">48V</span>'}
        ${c.input.hpf?'<span class="chip on">HPF</span>':'<span class="chip">HPF</span>'}</div>`:``}
  </div>`;
}
function renderChannels(){
  $("#channels-wrap").innerHTML = chNav()+`<div class="strips">${STATE.channels.map(strip).join("")}</div>`;
  bindChannelStrips();
}
function bindChannelStrips(){
  const wrap=$("#channels-wrap");
  $("#chjump").onchange=e=>{SEL=+e.target.value;renderChannels();};
  $$('[data-nav]',wrap).forEach(b=>b.onclick=()=>{SEL=Math.max(0,Math.min(STATE.channels.length-1,SEL+ +b.dataset.nav));renderChannels();
    const el=$(`.strip[data-i="${SEL}"]`);el&&el.scrollIntoView({inline:"center",block:"nearest"});});
  wrap.querySelectorAll(".strip").forEach(st=>{
    st.addEventListener("click",async e=>{SEL=+st.dataset.i;
      const b=e.target.closest("[data-act]");
      if(b){const act=b.dataset.act,c=STATE.channels[SEL],nv=!c[act];
        const r=await api.demoSet({target:"channel",index:SEL,field:act,value:nv});
        if(r.ok){c[act]=nv;b.classList.toggle("on",nv);toast(act.toUpperCase()+" (demo)");}}
      else markSelected();});
  });
  wrap.querySelectorAll("[data-pan]").forEach(p=>p.addEventListener("input",async()=>{
    const i=+p.dataset.pan,val=parseFloat(p.value);STATE.channels[i].pan=val;
    await api.demoSet({target:"channel",index:i,field:"pan",value:val});}));
  wrap.querySelectorAll("[data-fader]").forEach(f=>f.addEventListener("mousedown",ev=>startFader(ev,f)));
}
function markSelected(){$$(".strip").forEach(s=>s.classList.toggle("sel",+s.dataset.i===SEL));}
function startFader(ev,f){ ev.preventDefault(); const i=+f.dataset.fader, rect=f.getBoundingClientRect();
  const cap=f.querySelector(".cap"), valEl=f.closest(".strip").querySelector(".val.big");
  const meter=f.closest(".faderwrap").querySelector(".meter i");
  const move=ev2=>{const y=(ev2.clientY||0)-rect.top; const pct=1-Math.max(0,Math.min(1,y/rect.height));
    const db=Math.round((pct*66-60)*10)/10; STATE.channels[i].fader=db;
    cap.style.top=`calc(${faderTop(db)}% - 8px)`; valEl.innerHTML=`${fmt(db)}<span class="u">dB</span>`;};
  move(ev);
  const up=async()=>{document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);
    await api.demoSet({target:"channel",index:i,field:"fader",value:STATE.channels[i].fader});toast("fader (demo)");};
  document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);
}

// ---------- EQ (atualiza em tempo real, sem recriar elementos) ----------
let eqBuiltFor=-1, eqPathEl=null;
function bandsOf(c){return ["low","lowMid","highMid","high"].map(b=>({band:b,fc:c.eq[b].fc,gain:c.eq[b].gain,q:c.eq[b].q,bypass:c.eq[b].bypass}));}
function eqSvgMarkup(){
  const W=820,H=240,pad=26;
  let grid="";[100,1000,10000].forEach(f=>{const x=eqX(f,W,pad);grid+=`<line x1="${x}" y1="${pad}" x2="${x}" y2="${H-pad}" stroke="#222a33"/><text x="${x+3}" y="${H-pad+14}" fill="#64707f" font-size="11">${f>=1000?(f/1000)+'k':f}</text>`;});
  [-12,-6,0,6,12].forEach(d=>{const y=eqY(d,H,pad);grid+=`<line x1="${pad}" y1="${y}" x2="${W-pad}" y2="${y}" stroke="${d===0?'#33404d':'#1b222a'}"/><text x="2" y="${y+4}" fill="#64707f" font-size="11">${d>0?'+':''}${d}</text>`;});
  return `<svg id="eqsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}<path id="eqpath" d="" fill="none" stroke="var(--accent)" stroke-width="2.5"/></svg>`;
}
function eqX(f,W=820,pad=26){return pad+(Math.log10(f/20)/Math.log10(20000/20))*(W-2*pad);}
function eqY(d,H=240,pad=26){return H/2-(d/12)*(H/2-pad);}
function updateEqCurve(){ const c=STATE.channels[SEL]; const curve=eqCurve(bandsOf(c));
  if(eqPathEl) eqPathEl.setAttribute("d", curve.map((p,i)=>(i?"L":"M")+eqX(p[0]).toFixed(1)+","+eqY(p[1]).toFixed(1)).join(" ")); }
function renderEq(){
  const c=STATE.channels[SEL];
  if(eqBuiltFor!==SEL){ // (re)constrói só quando muda o canal
    $("#eq").innerHTML=`<div class="panel">
      <div class="eqhead"><b>Canal: ${c.name}</b>
        <select id="eqsel">${STATE.channels.map((x,i)=>`<option value="${i}" ${i===SEL?'selected':''}>${x.name}</option>`).join("")}</select></div>
      ${eqSvgMarkup()}
      <div class="eqbands">${bandsOf(c).map(b=>`
        <div class="eqband"><div class="eqbh"><b>${b.band}</b>
          <label class="sw"><input type="checkbox" data-eq="${b.band}" data-k="bypass" ${b.bypass?'checked':''}> bypass</label></div>
          <label>Ganho <output data-out="${b.band}-gain">${fmt(b.gain)} dB</output></label>
          <input type="range" min="-12" max="12" step="0.1" value="${b.gain}" data-eq="${b.band}" data-k="gain">
          <div class="pro-only">
            <label>Freq <span class="note">(faixa não confirmada)</span> <output data-out="${b.band}-fc">${Math.round(b.fc)} Hz</output></label>
            <input type="range" min="20" max="20000" step="1" value="${b.fc}" data-eq="${b.band}" data-k="fc">
            <label>Q <output data-out="${b.band}-q">${b.q.toFixed(1)}</output></label>
            <input type="range" min="0.3" max="8" step="0.1" value="${b.q}" data-eq="${b.band}" data-k="q">
          </div>
        </div>`).join("")}</div>
      <p class="note">Curva calculada por filtro biquad (visualiza o ajuste). Unidades e faixas reais da mesa ainda não confirmadas.</p></div>`;
    eqPathEl=$("#eqpath"); eqBuiltFor=SEL;
    $("#eqsel").onchange=e=>{SEL=+e.target.value;renderEq();};
    $$("#eq [data-eq]").forEach(inp=>inp.addEventListener("input",onEqInput));
  }
  updateEqCurve();
}
async function onEqInput(){
  const inp=this, band=inp.dataset.eq, k=inp.dataset.k;
  const c=STATE.channels[SEL];
  let val = k==="bypass"? inp.checked : parseFloat(inp.value);
  c.eq[band][k]=val;
  const out=$(`[data-out="${band}-${k}"]`);
  if(out) out.textContent = k==="gain"?`${fmt(val)} dB`: k==="fc"?`${Math.round(val)} Hz`: k==="q"?Number(val).toFixed(1):"";
  updateEqCurve(); // instantâneo, sem recriar nada
  api.demoSet({target:"channel",index:SEL,field:"eq",value:{band,[k]:val}});
}

// ---------- dinâmica (campos reais do esquema) ----------
function dynBar(label,value,min,max,unit,note){
  const pct=Math.max(0,Math.min(100,(value-min)/(max-min)*100));
  const shown = unit==="dB" ? fmt(value) : Number(value).toFixed(unit==="ms"?0:1);
  return `<div class="dyrow"><span class="dlabel">${label}${note?` <span class="note">${note}</span>`:""}</span>
    <div class="dbar"><i style="width:${pct}%"></i></div><span class="val">${shown} ${unit}</span></div>`;
}
function renderDyn(){
  const c=STATE.channels[SEL],g=c.dyn.gate,cp=c.dyn.comp;
  $("#dyn").innerHTML=`<div class="panel">
    <div class="eqhead"><b>Canal: ${c.name}</b>
      <select id="dynsel">${STATE.channels.map((x,i)=>`<option value="${i}" ${i===SEL?'selected':''}>${x.name}</option>`).join("")}</select></div>
    <div class="dyn2">
      <div class="dynbox"><div class="dynh"><b>Gate</b> ${g.enabled?'<span class="chip on">ativo</span>':'<span class="chip">inativo</span>'}</div>
        ${dynBar("Threshold",g.threshold,-80,0,"dB")}
        ${dynBar("Attack",g.attack,0,50,"ms")}
        ${dynBar("Release",g.release,0,600,"ms")}
        <div class="pro-only">${dynBar("Hold",g.hold,0,300,"ms")}${dynBar("Depth",g.depth,-80,0,"dB")}</div>
        <p class="note">Campos: gateThreshold/Attack/Release/Hold/Depth (esquema). Unidades não confirmadas.</p></div>
      <div class="dynbox"><div class="dynh"><b>Compressor</b> ${cp.enabled?'<span class="chip on">ativo</span>':'<span class="chip">inativo</span>'}</div>
        ${dynBar("Threshold",cp.threshold,-60,0,"dB")}
        <div class="dyrow"><span class="dlabel">Ratio</span><div class="dbar"><i style="width:${Math.min(100,cp.ratio/10*100)}%"></i></div><span class="val">${cp.ratio}:1</span></div>
        ${dynBar("Attack",cp.attack,0,100,"ms")}
        ${dynBar("Release",cp.release,0,600,"ms")}
        <div class="pro-only">${dynBar("Makeup Gain",cp.gain,0,24,"dB")}</div>
        <p class="note">Campos: compressorTreshold/Attack/Release/Gain/Ratio (esquema). Unidades não confirmadas.</p></div>
    </div>
    <p class="note">Valores simulados. Edição de dinâmica entra quando o framing e os <code>moduleId</code> forem confirmados na captura.</p></div>`;
  $("#dynsel").onchange=e=>{SEL=+e.target.value;renderDyn();};
}

// ---------- buses / saídas ----------
function renderBuses(){
  // Bus: exibição de leitura. "mute de bus" NÃO é campo confirmado no descritor,
  // então é mostrado como indicador (não é um botão clicável que fingiria controlar).
  const busStrip=b=>`<div class="strip bus">
    <div class="nm">${b.name}</div><div class="mid">saída</div>
    <div class="faderwrap"><div class="meter"><i style="height:${meterPct(b.meter)}%"></i></div>
      <div class="fader static"><div class="cap" style="top:calc(${faderTop(b.fader)}% - 8px)"></div></div></div>
    <div class="val big">${fmt(b.fader)}<span class="u">dB</span></div>
    <div class="row"><span class="chip ${b.mute?'on':''}" title="indicador (não confirmado no descritor)">MUTE</span></div>
    <div class="mid sim-tag">leitura · nível sim</div></div>`;
  const sends = `<div class="panel pro-only"><b>Envios por canal → buses</b>
    <div class="note">Existe no esquema (MicInBusModel: gainValue, isPrefader, panValue). Valores simulados.</div>
    <div class="sendgrid"><table><tr><th>Canal</th>${STATE.buses.map(b=>`<th>${b.name.replace("Bus ","B")}</th>`).join("")}</tr>
      ${STATE.channels.slice(0,12).map(c=>`<tr><td>${c.name}</td>${c.busSends.map(s=>`<td class="val">${fmt(s)}</td>`).join("")}</tr>`).join("")}
    </table></div></div>`;
  $("#buses").innerHTML=`<div class="strips">${STATE.buses.map(busStrip).join("")}</div>${sends}
    <p class="note">Buses observados: Bus 1–8.</p>`;
}

// ---------- análise de frequência ----------
let curObjetivo=null, curSuggest=null;
async function renderAnalyze(){
  const c=STATE.channels[SEL];
  const spec=await api.spectrum(1);
  const sg=await api.suggest(curObjetivo,1); curSuggest=sg;
  const curve=eqCurve(bandsOf(c));
  $("#analyze").innerHTML=`<div class="panel">
    <div class="eqhead"><b>Espectro (simulado) + curva de EQ · ${c.name}</b>
      <div style="display:flex;gap:8px">
        <select id="anchsel">${STATE.channels.map((x,i)=>`<option value="${i}" ${i===SEL?'selected':''}>${x.name}</option>`).join("")}</select>
        <select id="objsel">
          <option value="">Objetivo: automático</option>
          <option value="reduzir_graves">Reduzir excesso de graves</option>
          <option value="inteligibilidade_voz">Melhorar inteligibilidade da voz</option>
          <option value="controlar_medios">Controlar médios agressivos</option>
          <option value="reduzir_aspereza_agudos">Reduzir aspereza nos agudos</option>
        </select></div></div>
    ${spectrumSvg(spec.pontos,curve)}
    <div class="kv kv3"><b>Graves</b><span class="val">${fmt(sg.energia_por_regiao.graves)} dB</span>
      <b>Médios</b><span class="val">${fmt(sg.energia_por_regiao['médios'])} dB</span>
      <b>Agudos</b><span class="val">${fmt(sg.energia_por_regiao.agudos)} dB</span></div>
    <p class="note">${spec._simulado?'⚠️ Espectro SIMULADO — sem captação de áudio real nesta fase. ':''}${sg._aviso}</p>
    <h2 style="margin-top:12px">Sugestões (consultivas)</h2>
    <div id="suggs">${sg.sugestoes.map((s,i)=>suggCard(s,i)).join("")||'<p class="note">Sem sugestões para este espectro/objetivo.</p>'}</div>
  </div>`;
  $("#objsel").value=curObjetivo||""; $("#objsel").onchange=e=>{curObjetivo=e.target.value||null;renderAnalyze();};
  $("#anchsel").onchange=e=>{SEL=+e.target.value;renderAnalyze();};
}
function suggCard(s,i){
  return `<div class="sugg ${s.status==='aceito'?'aceito':s.status==='rejeitado'?'rejeitado':''}" data-i="${i}">
    <h4>${s.objetivo}</h4>
    <div class="note">Comparação: aplicar <b>${fmt(s.delta_db)} dB</b> em <b>${s.freq_hz} Hz</b> (Q ${s.q}). ${s.motivo}</div>
    <div class="note">Estado atual: sem esse ajuste → Sugerido: com o ajuste. <span class="sim-tag">hipótese</span></div>
    <div class="act"><button class="ok" data-acc="${i}">Aceitar (demo)</button><button class="no" data-rej="${i}">Rejeitar</button></div></div>`;
}
document.addEventListener("click",async e=>{
  const acc=e.target.closest("[data-acc]"),rej=e.target.closest("[data-rej]");
  if((!acc&&!rej)||!curSuggest)return;
  const i=+(acc?acc.dataset.acc:rej.dataset.rej),s=curSuggest.sugestoes[i];
  if(rej){s.status="rejeitado";toast("Sugestão rejeitada");}
  else{s.status="aceito";const c=STATE.channels[SEL],band=nearestBand(c,s.freq_hz);
    c.eq[band].gain=Math.max(-12,Math.min(12,c.eq[band].gain+s.delta_db));eqBuiltFor=-1;
    await api.demoSet({target:"channel",index:SEL,field:"eq",value:{band,gain:c.eq[band].gain}});
    toast("Aplicado no EQ simulado (demo)");}
  const el=$(`#suggs .sugg[data-i="${i}"]`); if(el)el.className="sugg "+s.status;
});
function nearestBand(c,fc){let best="low",d=1e9;for(const b of ["low","lowMid","highMid","high"]){const dd=Math.abs(Math.log(c.eq[b].fc)-Math.log(fc));if(dd<d){d=dd;best=b;}}return best;}
function spectrumSvg(pts,curve){
  const W=820,H=240,pad=26;
  const xs=f=>pad+(Math.log10(f/20)/Math.log10(20000/20))*(W-2*pad);
  const ysS=d=>pad+((-d)/60)*(H-2*pad), ysE=d=>H/2-(d/12)*(H/2-pad);
  const bars=pts.map(p=>{const x=xs(p[0]);return `<line x1="${x.toFixed(1)}" y1="${H-pad}" x2="${x.toFixed(1)}" y2="${ysS(p[1]).toFixed(1)}" stroke="#2d6a9f" stroke-width="3" opacity=".55"/>`;}).join("");
  const eqp=curve.map((p,i)=>(i?"L":"M")+xs(p[0]).toFixed(1)+","+ysE(p[1]).toFixed(1)).join(" ");
  const regions=`<rect x="${xs(20)}" y="${pad}" width="${xs(250)-xs(20)}" height="${H-2*pad}" fill="#1b2a1b" opacity=".25"/>
    <rect x="${xs(2000)}" y="${pad}" width="${xs(20000)-xs(2000)}" height="${H-2*pad}" fill="#2a1b2a" opacity=".25"/>
    <text x="${xs(70)}" y="${pad+13}" fill="#7a8694" font-size="11">graves</text>
    <text x="${xs(600)}" y="${pad+13}" fill="#7a8694" font-size="11">médios</text>
    <text x="${xs(6000)}" y="${pad+13}" fill="#7a8694" font-size="11">agudos</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${regions}${bars}<path d="${eqp}" fill="none" stroke="var(--accent)" stroke-width="2.5"/></svg>`;
}

// ---------- config / diagnóstico ----------
function renderSettings(){
  const f=META?META.flags:{},co=META?META.confirmado:{},sc=META?META.schema_checks:{};
  $("#settings").innerHTML=`<div class="setgrid">
    <div class="panel"><b>Estado da conexão</b>
      <div class="kv"><b>Status</b><span>${STATE.connection.status} <span class="badge off">rede off</span></span>
        <b>Host (padrão)</b><span class="val">${STATE.connection.host}</span>
        <b>Porta TCP</b><span class="val">${STATE.connection.port}</span>
        <b>allow_network</b><span class="val">${f.allow_network}</span>
        <b>escrita</b><span class="val">${f.write_enabled}</span></div>
      <p class="note">${STATE.connection.nota}</p></div>
    <div class="panel"><b>Protocolo (confirmado estaticamente)</b>
      <div class="kv"><b>Sync</b><span class="val">${co.sync}</span>
        <b>ID comando</b><span class="val">${co.cmd_id}</span>
        <b>Porta</b><span class="val">${co.tcp_port}</span></div>
      <p class="note">Framing e fim de payload: hipótese (ver pcap_analyze).</p></div>
    <div class="panel"><b>Checagem do esquema (fato)</b><div class="diag">${JSON.stringify(sc,null,2)}</div></div>
    <div class="panel"><b>Diagnóstico</b><div class="diag">interface: demonstração
medidores: ${f.meters_simulados?'SIMULADOS':'—'}
origem do estado: ${STATE._origem}
escrita à mesa: BLOQUEADA (403)
leitura real: ${f.allow_read?'HABILITADA':'desativada'}</div></div>
    <div class="panel" style="grid-column:1/-1"><b>Leitura real da mesa</b>
      <p class="note">Lê o estado da mesa (porta 6400) — só leitura, a escrita continua bloqueada.
        ${f.allow_read?'':'Para habilitar no iMac: <code>DB20P_ALLOW_READ=1 DB20P_HOST=192.168.18.162 python3 ui/server.py</code>'}</p>
      <button id="btnread" ${f.allow_read?'':'disabled'} style="cursor:${f.allow_read?'pointer':'not-allowed'};color:${f.allow_read?'var(--accent)':'var(--dim)'};border:1px solid var(--line2);background:var(--panel2);padding:8px 14px;border-radius:8px;font:inherit">
        ${f.allow_read?'Conectar e ler estado real':'Leitura real desativada'}</button>
      <div id="readout" class="note" style="margin-top:10px"></div></div></div>`;
  const btn=$("#btnread");
  if(btn && !btn.disabled) btn.onclick=async()=>{
    btn.disabled=true; $("#readout").textContent="Conectando à mesa…";
    try{
      const r=await fetch("/api/read-snapshot",{method:"POST"});
      const d=await r.json();
      if(d.ok){
        $("#readout").innerHTML=`<b style="color:var(--ok)">✓ Estado real lido de ${d.host}</b> — ${d.canais.length} canais:<br>`+
          `<table style="margin-top:8px"><tr><th>moduleId</th><th>canal</th><th>fader</th><th>mute</th></tr>`+
          d.canais.map(c=>`<tr><td class="val">${c.moduleId}</td><td>${c.name||'—'}</td><td class="val">${c.fader==null?'—':c.fader.toFixed(1)}</td><td>${c.mute?'MUTE':'—'}</td></tr>`).join("")+`</table>`;
        $("#connBadge").textContent="● lendo (somente leitura)";
      } else {
        $("#readout").innerHTML=`<span style="color:var(--bad)">Não deu: ${d.reason}</span>`;
      }
    }catch(e){ $("#readout").innerHTML=`<span style="color:var(--bad)">Erro: ${e}</span>`; }
    btn.disabled=false;
  };
}

// ---------- boot ----------
Promise.all([api.state(),api.meta()]).then(([s,m])=>{STATE=s;META=m;window.STATE=s;window.META=m;
  // garante o wrapper de canais
  if(!$("#channels-wrap")){const w=document.createElement("div");w.id="channels-wrap";$("#view-channels").appendChild(w);}
  $("#connBadge").textContent=(m.flags.allow_network?"● conectando":"● desconectado");
  render();});
