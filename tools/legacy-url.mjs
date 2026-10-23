import http from 'node:http';
const server=http.createServer((req,res)=>{
 // Keep existing tabs' API calls on the same origin until they reload.
 if(req.url?.startsWith('/api/')){const upstream=http.request({hostname:'127.0.0.1',port:8787,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:8787'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)});upstream.on('error',()=>{res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Ponte local indisponível.'}))});req.pipe(upstream);return}
 const path=req.url?.startsWith('/')&&!req.url.startsWith('//')?req.url:'/';res.writeHead(307,{Location:'http://127.0.0.1:5173'+path,'Cache-Control':'no-store'});res.end();
});server.listen(5174,'127.0.0.1',()=>console.log('Endereço anterior: http://127.0.0.1:5174/ → porta 5173'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));process.on('SIGINT',()=>server.close(()=>process.exit(0)));
