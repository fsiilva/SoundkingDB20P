import {spawn}from'node:child_process';
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');setTimeout(()=>process.exit(code),400).unref()}
for(const args of [['server/index.js'],['tools/legacy-url.mjs'],['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort']]){const child=spawn(process.execPath,args,{stdio:'inherit',cwd:new URL('..',import.meta.url)});children.push(child);child.on('error',e=>{console.error(e.message);stop(1)});child.on('exit',code=>{if(!stopping)stop(code??1)})}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
