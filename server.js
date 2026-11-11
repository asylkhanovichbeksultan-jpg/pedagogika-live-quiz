'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const {questions,pointsByLevel}=require('./questions');
const games=new Map(),MAX_PLAYERS=150,PORT=Number(process.env.PORT||3000);
const id=()=>crypto.randomBytes(18).toString('hex');
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const write=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const body=req=>new Promise((resolve,reject)=>{let s='';req.on('data',x=>{s+=x;if(s.length>12000){reject(bad('Сұраныс тым үлкен',413));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'));}catch{reject(bad('JSON қатесі'));}});req.on('error',reject);});
function gameFor(pin){const g=games.get(String(pin||''));if(!g)throw bad('PIN табылмады',404);g.activeAt=Date.now();return g;}
function playerFor(g,token){return [...g.players.values()].find(p=>p.token===token);}
function auth(g,role,token){if(role==='host'&&token===g.hostToken)return {role,player:null};if(role==='player'){const p=playerFor(g,token);if(p)return {role,player:p};}throw bad('Рұқсат жоқ. Қайта қосылыңыз.',403);}
const rank=g=>[...g.players.values()].sort((a,b)=>b.score-a.score||b.correctCount-a.correctCount||a.joinedAt-b.joinedAt).map((p,i)=>({id:p.id,name:p.name,score:p.score,correctCount:p.correctCount,rank:i+1}));
function state(g,a){
 const q=questions[g.index],leaders=rank(g),p=a.player,ans=p&&g.answers.get(p.id);
 return {pin:g.pin,phase:g.phase,questionIndex:g.index,total:questions.length,counts:{easy:10,medium:3,hard:2},
 question:['question','reveal'].includes(g.phase)?{text:q.question,options:q.options,level:q.level,duration:q.time,endsAt:g.endsAt,number:g.index+1}:null,
 stats:g.phase==='reveal'?{counts:q.options.map((_,i)=>[...g.answers.values()].filter(x=>x.choice===i).length),correct:q.correct,source:q.source}:null,
 players:a.role==='host'?[...g.players.values()].map(x=>({id:x.id,name:x.name})):undefined,
 participantCount:g.players.size,answeredCount:g.answers.size,
 leaders:g.phase==='lobby'?[]:leaders.slice(0,g.phase==='finished'?50:10),
 personal:p?{id:p.id,name:p.name,score:p.score,rank:leaders.find(x=>x.id===p.id)?.rank,answer:ans?.choice??null,roundGain:p.roundGain,correctCount:p.correctCount,wasCorrect:g.phase==='reveal'?p.lastCorrect:null}:null};
}
function broadcast(g){for(const c of [...g.clients])try{c.res.write('data: '+JSON.stringify(state(g,c.auth))+'\n\n');}catch{g.clients.delete(c);}}
function reveal(g){
 if(g.phase!=='question')return;clearTimeout(g.timer);const q=questions[g.index];
 for(const p of g.players.values()){const a=g.answers.get(p.id);const correct=Boolean(a&&a.choice===q.correct);p.lastCorrect=correct;p.roundGain=0;
 if(correct){const remaining=Math.max(0,1-a.elapsed/(q.time*1000));p.roundGain=Math.round(pointsByLevel[q.level]*(0.5+0.5*remaining));p.score+=p.roundGain;p.correctCount++;}}
 g.phase='reveal';g.endsAt=0;broadcast(g);
}
function newQuestion(g){
 clearTimeout(g.timer);g.phase='question';g.answers=new Map();
 for(const p of g.players.values()){p.roundGain=0;p.lastCorrect=null;}
 g.endsAt=Date.now()+questions[g.index].time*1000;
 g.timer=setTimeout(()=>reveal(g),questions[g.index].time*1000+35);broadcast(g);
}
function newGame(){let pin;do{pin=String(crypto.randomInt(100000,1000000));}while(games.has(pin));
 const g={pin,hostToken:id(),phase:'lobby',index:-1,players:new Map(),answers:new Map(),clients:new Set(),timer:null,endsAt:0,activeAt:Date.now()};games.set(pin,g);return g;}
function origin(req){
 if(process.env.PUBLIC_URL)return process.env.PUBLIC_URL.replace(/\/$/,'');
 const proto=String(req.headers['x-forwarded-proto']||'http').split(',')[0];
 const host=String(req.headers['x-forwarded-host']||req.headers.host||'localhost:3000').split(',')[0];
 return proto+'://'+host;
}
async function api(req,res,u){
 const route=u.pathname;
 if(req.method==='GET'&&route==='/api/health')return write(res,200,{ok:true,games:games.size});
 if(req.method==='GET'&&route==='/api/config')return write(res,200,{joinOrigin:origin(req),questions:questions.length});
 if(req.method==='POST'&&route==='/api/create'){const g=newGame();return write(res,200,{pin:g.pin,token:g.hostToken,joinUrl:origin(req)+'/?pin='+g.pin});}
 if(req.method==='POST'&&route==='/api/join'){
  const b=await body(req),g=gameFor(b.pin),name=String(b.name||'').trim().replace(/\s+/g,' ');
  if(name.length<2||name.length>24||/[\x00-\x1f]/.test(name))throw bad('Атыңыз 2–24 таңба арасында болсын');
  let p=b.token?playerFor(g,b.token):null;
  if(!p){if(g.phase!=='lobby')throw bad('Ойын басталған, қосылу жабық',409);
   if(g.players.size>=MAX_PLAYERS)throw bad('Бөлме толды',409);
   if([...g.players.values()].some(x=>x.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw bad('Бұл ат бар. Басқа ат таңдаңыз',409);
   p={id:id(),token:id(),name,score:0,correctCount:0,roundGain:0,lastCorrect:null,joinedAt:Date.now()};g.players.set(p.id,p);}
  broadcast(g);return write(res,200,{pin:g.pin,token:p.token,name:p.name});
 }
 if(req.method==='POST'&&route==='/api/start'){const b=await body(req),g=gameFor(b.pin);auth(g,'host',b.token);
  if(g.phase!=='lobby')throw bad('Ойын басталып кеткен',409);if(!g.players.size)throw bad('Кемінде бір қатысушы қосылсын',409);
  g.index=0;newQuestion(g);return write(res,200,{ok:true});}
 if(req.method==='POST'&&route==='/api/answer'){
  const b=await body(req),g=gameFor(b.pin),p=auth(g,'player',b.token).player;
  if(g.phase!=='question'||Date.now()>g.endsAt)throw bad('Уақыт аяқталды',409);
  if(!Number.isInteger(b.choice)||b.choice<0||b.choice>3)throw bad('Нұсқа дұрыс емес');
  if(g.answers.has(p.id))throw bad('Жауап беріп қойдыңыз',409);
  g.answers.set(p.id,{choice:b.choice,elapsed:Math.max(0,Date.now()-(g.endsAt-questions[g.index].time*1000))});broadcast(g);
  if(g.answers.size===g.players.size)reveal(g);
  return write(res,200,{ok:true});
 }
 if(req.method==='POST'&&route==='/api/next'){
  const b=await body(req),g=gameFor(b.pin);auth(g,'host',b.token);
  if(g.phase!=='reveal')throw bad('Нәтиженің шығуын күтіңіз',409);
  if(g.index===questions.length-1){g.phase='finished';broadcast(g);}else{g.index++;newQuestion(g);}
  return write(res,200,{ok:true});
 }
 if(req.method==='POST'&&route==='/api/restart'){
  const b=await body(req),g=gameFor(b.pin);auth(g,'host',b.token);clearTimeout(g.timer);
  g.phase='lobby';g.index=-1;g.answers=new Map();g.endsAt=0;
  for(const p of g.players.values()){p.score=0;p.correctCount=0;p.roundGain=0;p.lastCorrect=null;}
  broadcast(g);return write(res,200,{ok:true});
 }
 if(req.method==='GET'&&route==='/api/state'){
  const g=gameFor(u.searchParams.get('pin')),a=auth(g,u.searchParams.get('role'),u.searchParams.get('token'));
  return write(res,200,state(g,a));
 }
 if(req.method==='GET'&&route==='/api/events'){
  const g=gameFor(u.searchParams.get('pin')),a=auth(g,u.searchParams.get('role'),u.searchParams.get('token'));
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  const client={res,auth:a};g.clients.add(client);res.write('retry: 1500\n\n');broadcast(g);
  const heartbeat=setInterval(()=>{try{res.write(': heartbeat\n\n');}catch{}},20000);
  res.on('close',()=>{clearInterval(heartbeat);g.clients.delete(client);});
  return;
 }
 throw bad('API табылмады',404);
}
function staticFile(req,res,u){
 if(req.method!=='GET'&&req.method!=='HEAD')throw bad('Қолдау таппайды',405);
 let name=u.pathname==='/'||u.pathname==='/host'?'index.html':u.pathname.replace(/^\/+/,'');
 const base=path.resolve(__dirname,'public'),file=path.resolve(base,name);
 if(!file.startsWith(base+path.sep))throw bad('Рұқсат жоқ',403);
 fs.stat(file,(e,s)=>{if(e||!s.isFile())return write(res,404,{error:'Бет табылмады'});
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
  fs.createReadStream(file).pipe(res);
 });
}
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/'))await api(req,res,u);else staticFile(req,res,u);}catch(e){if(!res.headersSent)write(res,e.status||400,{error:e.message||'Сервер қатесі'});}});
setInterval(()=>{const now=Date.now();for(const [pin,g] of games)if(now-g.activeAt>21600000){clearTimeout(g.timer);for(const c of g.clients)try{c.res.end();}catch{}games.delete(pin);}},600000).unref();
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log('QUIZ ARENA → http://localhost:'+PORT+'/host'));
module.exports={server,reveal,newGame};
