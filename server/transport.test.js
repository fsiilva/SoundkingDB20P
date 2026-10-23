import test from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';import dgram from 'node:dgram';import {once}from'node:events';import {setTimeout as delay}from'node:timers/promises';import {Transport}from'./transport.js';
async function waitFor(fn){for(let i=0;i<100;i++){if(fn())return;await delay(10)}assert.fail('Tempo limite aguardando dados')}
test('TCP conecta, recebe bytes reais e encerra sem transmitir comandos',async()=>{let incoming=0;const server=net.createServer(s=>{s.on('data',d=>incoming+=d.length);s.write(Buffer.from('5a5a0001','hex'))});server.listen(0,'127.0.0.1');await once(server,'listening');const t=new Transport();try{await t.connect({protocol:'tcp',host:'127.0.0.1',port:server.address().port});await waitFor(()=>t.state.bytesReceived===4);assert.equal(t.state.status,'connected');assert.equal(t.state.logs[0].hex,'5a5a0001');assert.equal(incoming,0);t.disconnect();assert.equal(t.state.status,'disconnected')}finally{t.disconnect();await new Promise(r=>server.close(r))}});
test('UDP recebe datagramas em porta local sem afirmar conexão física',async()=>{const t=new Transport(),sender=dgram.createSocket('udp4');try{await t.connect({protocol:'udp',host:'127.0.0.1',port:6400,localPort:0});assert.equal(t.state.status,'listening');sender.send(Buffer.from('resposta'),t.state.localPort,'127.0.0.1');await waitFor(()=>t.state.packetsReceived===1);assert.equal(t.state.bytesReceived,8)}finally{t.disconnect();sender.close()}});
test('rejeita protocolo, IP e portas inválidas',async()=>{const t=new Transport();for(const args of [{protocol:'http',host:'127.0.0.1',port:10},{protocol:'tcp',host:'x',port:10},{protocol:'tcp',host:'127.0.0.1',port:0},{protocol:'udp',host:'127.0.0.1',port:6400,localPort:-1}])await assert.rejects(t.connect(args));assert.equal(t.socket,null)});
test('mantém log limitado para tráfego contínuo',()=>{const t=new Transport();for(let i=0;i<100;i++)t.log(Buffer.alloc(1024),'local');assert.equal(t.state.logs.length,60);assert.equal(t.state.bytesReceived,102400);assert.equal(t.state.logs[0].hex.length,1024)});
test('conecta socket de medidores e atualiza meters na recepção',async()=>{
 const sampleHex='5a5a0000000000000100660a640000cdb200a60000a60000a60000a60000a60000a60000a60000b30000a60000a60000a60000b0b00000a6a6cea6a6a6a6a6a6a6b3a6a6a6a6a6a6a6a6a6a6a6a6a6b5b5c2c0bebebebeb5b5b5b5b8b8a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6'+'00'.repeat(157);
 const frame=Buffer.from(sampleHex,'hex');
 const clients=new Set();
 const server=net.createServer(s=>clients.add(s));
 const meterServer=net.createServer(s=>{clients.add(s);s.write(frame)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 await new Promise(r=>meterServer.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 const meterPort=meterServer.address().port;
 const t=new Transport();
 const waitMeters=once(t,'meters');
 try{
  await t.connect({protocol:'tcp',host:'127.0.0.1',port,meterPort});
  const [meter]=await waitMeters;
  assert.equal(t.state.meterStatus,'connected');
  assert.equal(t.state.meters.channels[0].level,-51);
  assert.equal(meter.channels[0].level,-51);
  t.disconnect();
  assert.equal(t.state.meterStatus,'disconnected');
 }finally{
  t.disconnect();
  for(const c of clients)c.destroy();
  await new Promise(r=>server.close(r));
  await new Promise(r=>meterServer.close(r));
 }
});
test('leitura automática envia apenas pedido fixo, preserva snapshot em timeout e para ao desconectar',t=>{t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:100000});const transport=new Transport();const writes=[];transport.state.status='connected';transport.state.protocol='tcp';transport.state.port=6400;transport.state.snapshot={channels:[{name:'último estado'}]};transport.socket={write:bytes=>writes.push(bytes.toString('hex')),destroy:()=>{}};try{transport.startAutoRead();assert.equal(writes.length,1);assert.equal(transport.state.autoRead,true);assert.equal(transport.state.readPending,true);t.mock.timers.tick(4000);assert.match(transport.state.snapshotError,/4 segundos/);assert.equal(transport.state.snapshot.channels[0].name,'último estado');t.mock.timers.tick(2000);assert.equal(writes.length,2);assert.ok(writes.every(x=>x==='5a5a5a5a5a5a0000000100000000'));transport.disconnect();t.mock.timers.tick(12000);assert.equal(writes.length,2);assert.equal(transport.state.autoRead,false)}finally{transport.disconnect();t.mock.timers.reset()}});


