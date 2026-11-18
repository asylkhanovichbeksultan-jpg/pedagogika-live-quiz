'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const rooms=new Map(),LIMIT_ROOMS=120,LIMIT_STUDENTS=450,MAX_TEXT=650;
const token=()=>crypto.randomBytes(24).toString('hex');
const error=(message,status=400)=>Object.assign(new Error(message),{status});
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(data))}
function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>7000){reject(error('Сұраныс тым үлкен',413));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'))}catch{reject(error('Деректер пішімі қате'))}});req.on('error',reject)})}
function get(room){const x=rooms.get(String(room||'').trim());if(!x)throw error('Сессия табылмады. Мұғалімнен кодты қайта сұраңыз.',404);x.active=Date.now();return x}
function verify(r,req,form){const key=String(req.headers['x-host-key']||form?.key||'');const a=Buffer.from(key),b=Buffer.from(r.key);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw error('Бұл әрекет мұғалімге ғана рұқсат',403)}
function cleanText(x,field){if(typeof x!=='string')throw error(field+' мәтінін енгізіңіз');const t=x.trim().replace(/\r/g,'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'');if(t.length<3||t.length>MAX_TEXT)throw error(field+' мәтіні 3–'+MAX_TEXT+' таңба болуы керек');return t}
function voterKey(raw){if(typeof raw!=='string'||!(/^[a-zA-Z0-9_-]{16,100}$/).test(raw))throw error('Қатысушы коды жарамсыз');return raw}
const progressValues=['grew','some','help'];
function summary(r,includeRows){
 const list=[...r.students.values()],starting=list.filter(x=>x.know&&x.want).length,finished=list.filter(x=>x.learned&&x.progress).length;
 const progress={grew:0,some:0,help:0};for(const x of list)if(x.learned&&progressValues.includes(x.progress))progress[x.progress]++;
 return {started:starting,finished,progress,pct:starting?Math.round(finished/starting*100):0,
 ...(includeRows?{rows:list.filter(x=>x.know).map((x,i)=>({number:i+1,know:x.know,want:x.want,learned:x.learned||'',progress:x.progress||''}))}:{})};
}
function state(r,role,voter){
 const host=role==='host',result=host||r.stage==='published';
 const self=voter&&r.students.get(voter);
 return {room:r.room,stage:r.stage,joined:r.students.size,started:summary(r,false).started,finished:summary(r,false).finished,summary:result?summary(r,true):null,mine:!host?(self?{know:self.know,want:self.want,learned:self.learned,progress:self.progress}:null):undefined};
}
function base(req){const proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0],host=String(req.headers['x-forwarded-host']||req.headers.host||'localhost:3000').split(',')[0];return (['http','https'].includes(proto)?proto:'https')+'://'+host}
const topic='Мұғалімнің кәсіби іс-әрекетіндегі оқыту технологиялары';
async function handle(req,res,u){
 try{
 if(req.method==='GET'&&['/bbb','/bbb/','/bbb.html'].includes(u.pathname)){
  return fs.readFile(path.join(__dirname,'public','bbb.html'),(e,data)=>{if(e)return json(res,500,{error:'Бет табылмады'});res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(data)})}
 if(!u.pathname.startsWith('/bbb/api/'))throw error('Бет табылмады',404);
 if(req.method==='POST'&&u.pathname==='/bbb/api/create'){
  if(rooms.size>=LIMIT_ROOMS)throw error('Сессия саны шегіне жетті',503);
  let room;do{room=String(crypto.randomInt(100000,1000000))}while(rooms.has(room));
  const r={room,key:token(),stage:'before',students:new Map(),active:Date.now(),created:Date.now()};
  rooms.set(room,r);return json(res,200,{room,key:r.key,joinUrl:base(req)+'/bbb/?room='+room,hostUrl:base(req)+'/bbb/?host='+room+'&key='+r.key,topic})}
 if(req.method==='GET'&&u.pathname==='/bbb/api/state'){
  const r=get(u.searchParams.get('room')),k=String(req.headers['x-host-key']||''),v=String(req.headers['x-voter-key']||'');
  if(k)verify(r,req,{});
  return json(res,200,state(r,k?'host':'student',v))}
 if(req.method==='POST'&&u.pathname==='/bbb/api/before'){
  const b=await body(req),r=get(b.room),v=voterKey(b.voter);
  if(r.stage!=='before')throw error('Сабақ басындағы жауап беру кезеңі аяқталды',409);
  const know=cleanText(b.know,'Білемін'),want=cleanText(b.want,'Білгім келеді');
  if(!r.students.has(v)&&r.students.size>=LIMIT_STUDENTS)throw error('Сыныптағы орын саны шегіне жетті',409);
  const prev=r.students.get(v)||{created:Date.now(),learned:'',progress:''};
  r.students.set(v,{...prev,know,want});return json(res,200,{ok:true,started:summary(r,false).started})}
 if(req.method==='POST'&&u.pathname==='/bbb/api/after'){
  const b=await body(req),r=get(b.room),v=voterKey(b.voter);
  if(r.stage!=='after')throw error('«Білдім» бағаны қазір ашық емес',409);
  const record=r.students.get(v);
  if(!record||!record.know||!record.want)throw error('Алдымен сабақ басындағы екі баған толтырылуы керек',409);
  const learned=cleanText(b.learned,'Білдім');
  if(!progressValues.includes(b.progress))throw error('Өз прогресіңді бағала');
  record.learned=learned;record.progress=b.progress;return json(res,200,{ok:true,finished:summary(r,false).finished})}
 if(req.method==='POST'&&['/bbb/api/after-open','/bbb/api/publish','/bbb/api/reopen','/bbb/api/reset'].includes(u.pathname)){
  const b=await body(req),r=get(b.room);verify(r,req,b);
  if(u.pathname.endsWith('/after-open')){if(r.stage!=='before')throw error('«Білдім» кезеңі әлдеқашан басталған',409);r.stage='after'}
  if(u.pathname.endsWith('/publish')){if(r.stage!=='after')throw error('Алдымен сабақ соңындағы кезеңді ашыңыз',409);r.stage='published'}
  if(u.pathname.endsWith('/reopen')){if(r.stage!=='published')throw error('Нәтиже әлі жарияланбады',409);r.stage='after'}
  if(u.pathname.endsWith('/reset')){r.stage='before';r.students.clear()}
  return json(res,200,state(r,'host'))}
 throw error('Сұраныс табылмады',404);
 }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.message||'Сервер қатесі'})}
}
setInterval(()=>{const now=Date.now();for(const [code,r] of rooms)if(now-r.active>8*60*60*1000)rooms.delete(code)},600000).unref();
module.exports=handle;
