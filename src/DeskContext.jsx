import React,{createContext,useContext,useState,useEffect,useCallback}from'react';
export const DeskContext=createContext(null);
export function DeskProvider({children}){
 const[state,setState]=useState(null),[meters,setMeters]=useState(null),[bridgeError,setBridgeError]=useState(''),[actionError,setActionError]=useState(''),[busy,setBusy]=useState(false);
 const refresh=useCallback(async(signal)=>{const response=await fetch('/api/transport',{signal});if(!response.ok)throw Error('Não foi possível consultar a ponte local.');const next=await response.json();setState(next);setBridgeError('');return next},[]);
 useEffect(()=>{let stopped=false;const controller=new AbortController();let timer;async function poll(){try{await refresh(controller.signal)}catch(e){if(!stopped)setBridgeError('Ponte local indisponível. Execute npm run dev.')}if(!stopped)timer=setTimeout(poll,1000)}poll();return()=>{stopped=true;clearTimeout(timer);controller.abort()}},[refresh]);
 useEffect(()=>{if(state?.status!=='connected'||typeof EventSource==='undefined'){setMeters(null);return}const es=new EventSource('/api/meters/stream');es.onmessage=e=>{try{setMeters(JSON.parse(e.data))}catch{}};es.onerror=()=>{};return()=>{es.close()}},[state?.status]);
 async function action(path,body={}){setBusy(true);setActionError('');try{const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const next=await response.json();if(!response.ok)throw Error(next.error);setState(next);setBridgeError('');return next}catch(e){setActionError(e.message);return null}finally{setBusy(false)}}
 return <DeskContext.Provider value={{state,meters,error:bridgeError||actionError,busy,action,refresh}}>{children}</DeskContext.Provider>;
}
export const useDesk=()=>useContext(DeskContext);
