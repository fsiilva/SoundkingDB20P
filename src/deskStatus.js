export function deskStatus(state,now=Date.now()){
 const snapshot=state?.snapshot,age=snapshot?now-Date.parse(snapshot.receivedAt):Infinity;
 const connected=state?.status==='connected'&&state?.protocol==='tcp'&&state?.port===6400;
 const fresh=connected&&age>=0&&age<15000&&!state?.error&&!state?.decodeError&&!state?.snapshotError;
 return{connected,fresh,age,label:fresh?'Mesa conectada':snapshot?'Dados desatualizados':connected?'Aguardando dados':'Mesa desconectada'};
}
