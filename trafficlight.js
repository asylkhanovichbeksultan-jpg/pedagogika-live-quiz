'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const rooms=new Map();
const MAX_ROOMS=150, MAX_VOTES=600;
const rand=(n=20)=>crypto.randomBytes(n).toString('hex');
const reply=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(obj));};
const fail=(msg,status=400)=>Object.assign(new Error(msg),{status});
async function read(req){return await new Promise((ok,no)=>{let s='';req.on('data',chunk=>{s+=chunk;if(s.length>4096){no(fail('Сұраныс тым үлкен',413));req.destroy();}});req.on('end',()=>{try{ok(JSON.parse(s||'{}'))}catch{no(fail('Қате деректер'))}});req.on('error',no)})}
function get(code){const r=rooms.get(String(code||'').toUpperCase());if(!r)throw fail('Сессия табылмады. Жаңа код сұраңыз.',404);r.active=Date.now();return r}
function auth(r,req,obj){const key=String(req.headers['x-host-key']||obj?.key||'');const a=Buffer.from(key),b=Buffer.from(r.key);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw fail('Мұғалімге ғана рұқсат бар',403)}
function stats(r){const counts={green:0,yellow:0,red:0},scores=Array(10).fill(0);let sum=0;for(const v of r.votes.values()){counts[v.color]++;scores[v.score-1]++;sum+=v.score}const total=r.votes.size;return {total,counts,scores,average:total?Math.round(sum/total*10)/10:0,pct:Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,total?Math.round(v*1000/total)/10:0]))}}
function baseUrl(req){const proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0];const host=String(req.headers['x-forwarded-host']||req.headers.host||'localhost:3000').split(',')[0];return (proto==='http'||proto==='https'?proto:'https')+'://'+host}
function state(r,host=false){return {room:r.room,phase:r.phase,total:r.votes.size,topic:r.topic,createdAt:r.created,stats:host||r.phase==='revealed'?stats(r):null}}
const TOPIC='Мұғалімнің кәсіби іс-әрекетіндегі оқыту технологиялары';
async function handle(req,res,u){
try{
 const route=u.pathname;
 if((route==='/bagdarsham'||route==='/bagdarsham/'||route==='/bagdarsham.html')&&req.method==='GET'){
   const file=path.join(__dirname,'public','bagdarsham.html');
   return fs.readFile(file,(error,contents)=>{if(error)return reply(res,500,{error:'Сайт файлы табылмады'});res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(contents)})
 }
 if(req.method==='POST'&&route==='/bagdarsham/api/create'){
  if(rooms.size>=MAX_ROOMS)throw fail('Сессия шегі толды, кейінірек қайталаңыз',503);
  let room;do{room=String(crypto.randomInt(100000,999999))}while(rooms.has(room));
  const r={room,key:rand(),phase:'open',votes:new Map(),topic:TOPIC,created:Date.now(),active:Date.now()};rooms.set(room,r);
  const origin=baseUrl(req);
  return reply(res,200,{room,key:r.key,studentUrl:origin+'/bagdarsham/?room='+room,hostUrl:origin+'/bagdarsham/?host='+room+'&key='+r.key});
 }
 if(req.method==='GET'&&route==='/bagdarsham/api/state'){
  const r=get(u.searchParams.get('room'));let host=false;
  const given=String(req.headers['x-host-key']||'');
  if(given){auth(r,req,{});host=true}
  return reply(res,200,state(r,host));
 }
 if(req.method==='POST'&&route==='/bagdarsham/api/vote'){
  const b=await read(req),r=get(b.room);
  if(r.phase!=='open')throw fail('Дауыс беру жабық. Нәтижені күтіңіз.',409);
  if(!['green','yellow','red'].includes(b.color))throw fail('Түсті таңдаңыз');
  if(!Number.isInteger(b.score)||b.score<1||b.score>10)throw fail('1–10 аралығында балл таңдаңыз');
  if(typeof b.voter!=='string'||!/^[A-Za-z0-9_-]{12,70}$/.test(b.voter))throw fail('Қатысушы идентификаторы жарамсыз');
  if(!r.votes.has(b.voter)&&r.votes.size>=MAX_VOTES)throw fail('Сессиядағы қатысушылар шегі толды',409);
  r.votes.set(b.voter,{color:b.color,score:b.score});
  return reply(res,200,{ok:true,total:r.votes.size});
 }
 if(req.method==='POST'&&['/bagdarsham/api/reveal','/bagdarsham/api/reopen','/bagdarsham/api/clear'].includes(route)){
  const b=await read(req),r=get(b.room);auth(r,req,b);
  if(route.endsWith('/reveal'))r.phase='revealed';
  if(route.endsWith('/reopen'))r.phase='open';
  if(route.endsWith('/clear')){r.phase='open';r.votes.clear()}
  return reply(res,200,state(r,true));
 }
 throw fail('Мекенжай табылмады',404);
}catch(err){if(!res.headersSent)reply(res,err.status||500,{error:err.message||'Сервер қатесі'})}
}
setInterval(()=>{for(const [k,r] of rooms)if(Date.now()-r.active>8*60*60*1000)rooms.delete(k)},600000).unref();
module.exports=handle;
