'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {server}=require('../server');
const {questions}=require('../minez-questions');
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const errors=[];
 const open=async(route)=>{
  const p=await browser.newPage({viewport:{width:390,height:844}});
  p.on('pageerror',e=>errors.push('JS '+e.message));
  await p.goto(url+route,{waitUntil:'domcontentloaded'});
  return p;
 };
 try{
  const host=await open('/host?topic=minez');
  assert.match(await host.locator('#topic-label').innerText(),/КӨРКЕМ МІНЕЗ/);
  await host.getByRole('button',{name:/ОЙЫН ҚҰРУ/}).click();
  await host.waitForSelector('.pin');
  const pin=(await host.locator('.pin').innerText()).trim();
  assert.match(pin,/^\d{6}$/);
  const a=await open('/?pin='+pin);
  await a.locator('#nameInput').fill('Айдана');
  await a.getByRole('button',{name:/ОЙЫНҒА КІРУ/}).click();
  const b=await open('/?pin='+pin);
  await b.locator('#nameInput').fill('Ернар');
  await b.getByRole('button',{name:/ОЙЫНҒА КІРУ/}).click();
  await host.getByText('ҚАТЫСУШЫЛАР · 2').waitFor();
  await host.getByRole('button',{name:/ОЙЫНДЫ БАСТАУ/}).click();
  await host.getByText('СҰРАҚ 1 / 15').first().waitFor({timeout:6000});
  await a.getByText('СҰРАҚ 1 / 15').first().waitFor({timeout:6000});
  await a.locator('.answer').nth(questions[0].correct).click();
  await b.locator('.answer').nth((questions[0].correct+1)%4).click();
  await host.getByText('СҰРАҚ 1 / 15 · НӘТИЖЕ').first().waitFor({timeout:6000});
  await host.getByRole('button',{name:/КЕЛЕСІ СҰРАҚ/}).click();
  await host.getByText('СҰРАҚ 2 / 15').first().waitFor({timeout:6000});
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile browser host, two players, begin, answer, scores and next question');
 }finally{
  await browser.close();
  await new Promise(r=>server.close(r));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});