'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {server}=require('../server');
const {questions:pedagogikaQuestions}=require('../questions');
const {questions}=require('../minez-questions');
let base;
async function api(url,body){const res=await fetch(base+url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:res.status,body:await res.json()};}
function state(pin,role,token){return api('/api/state?pin='+pin+'&role='+role+'&token='+token);}
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));});
test('Сұрақ саны 15: 10 оңай, 3 орташа, 2 қиын',()=>{
 assert.equal(questions.length,15);
 assert.equal(pedagogikaQuestions.length,15);
 assert.match(questions[0].question,/Көркем мінез/);
 assert.deepEqual(questions.reduce((o,q)=>(o[q.level]=(o[q.level]||0)+1,o),{}),{easy:10,medium:3,hard:2});
 for(const q of questions){assert.equal(q.options.length,4);assert.ok(q.correct>=0&&q.correct<4);assert.ok(q.source);}
});
test('Екі қатысушы, ұпай есептеу, 15 сұрақ және финал',async()=>{
 const creation=await api('/api/create',{});assert.equal(creation.status,200);
 const {pin,token:host}=creation.body;assert.equal(creation.body.topic,'minez');assert.match(pin,/^\d{6}$/);
 const a=(await api('/api/join',{pin,name:'Айдана'})).body;
 const b=(await api('/api/join',{pin,name:'Бексұлтан'})).body;
 assert.equal((await state(pin,'host',host)).body.participantCount,2);
 assert.equal((await api('/api/join',{pin,name:'Айдана'})).status,409);
 assert.equal((await api('/api/start',{pin,token:'wrong'})).status,403);
 assert.equal((await api('/api/start',{pin,token:host})).status,200);
 for(let i=0;i<15;i++){
   const q=questions[i],before=(await state(pin,'player',a.token)).body;
   assert.equal(before.phase,'question');assert.equal(before.question.number,i+1);assert.equal(before.stats,null);
   assert.equal((await api('/api/answer',{pin,token:a.token,choice:q.correct})).status,200);
   assert.equal((await api('/api/answer',{pin,token:a.token,choice:q.correct})).status,409);
   assert.equal((await api('/api/answer',{pin,token:b.token,choice:(q.correct+1)%4})).status,200);
   const after=(await state(pin,'player',a.token)).body;
   assert.equal(after.phase,'reveal');assert.equal(after.stats.correct,q.correct);
   assert.ok(after.personal.roundGain>=({easy:500,medium:750,hard:1000}[q.level]));
   assert.equal((await state(pin,'player',b.token)).body.personal.roundGain,0);
   assert.equal((await api('/api/next',{pin,token:host})).status,200);
 }
 const end=(await state(pin,'host',host)).body;assert.equal(end.phase,'finished');
 assert.equal(end.leaders[0].name,'Айдана');assert.equal(end.leaders[0].correctCount,15);
 assert.equal((await api('/api/restart',{pin,token:host})).status,200);
 assert.equal((await state(pin,'host',host)).body.phase,'lobby');
});
test('Нақты уақыттағы SSE қосылымы',async()=>{
 const room=(await api('/api/create',{})).body;
 const ctrl=new AbortController();
 const res=await fetch(base+'/api/events?pin='+room.pin+'&role=host&token='+room.token,{signal:ctrl.signal});
 assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/event-stream/);
 const reader=res.body.getReader(),first=await reader.read();
 assert.match(new TextDecoder().decode(first.value),/data:|retry:/);ctrl.abort();
});

test('Ескі педагогика ойыны да бөлек режимде жұмыс істейді',async()=>{
 const room=await api('/api/create',{topic:'pedagogika'});
 assert.equal(room.status,200);assert.equal(room.body.topic,'pedagogika');
 const st=await state(room.body.pin,'host',room.body.token);
 assert.match(st.body.title,/диагностика/);assert.equal(st.body.total,15);
});
