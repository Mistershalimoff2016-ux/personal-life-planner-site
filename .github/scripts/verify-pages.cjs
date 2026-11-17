const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const base = 'https://mistershalimoff2016-ux.github.io/personal-life-planner-site/';
const out = process.env.PWA_REPORT_DIR || 'public-check';
fs.mkdirSync(out, {recursive:true});
(async()=>{
 const report = {url:base,time:new Date().toISOString(),run:process.env.GITHUB_RUN_ID,siteCommit:process.env.GITHUB_SHA,browsers:[]};
 try {const r=await fetch(base+'build-info.json?check='+Date.now(),{cache:'no-store'});report.build={status:r.status,body:await r.text()}}catch(e){report.build={error:e.message}}
 for(const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
  const result={name,errors:[],console:[],failedRequests:[],badResponses:[],resources:[],pass:false};report.browsers.push(result);
  let browser;
  try {
   browser=await type.launch({headless:true});
   const context=await browser.newContext({viewport:{width:393,height:852},locale:'ru-RU',isMobile:true,hasTouch:true});
   const page=await context.newPage();
   page.on('pageerror',e=>result.errors.push(e.message));
   page.on('console',m=>{if(['error','warning'].includes(m.type()))result.console.push(m.text())});
   page.on('requestfailed',r=>result.failedRequests.push({url:r.url(),failure:r.failure()}));
   page.on('response',r=>{
    const meta={url:r.url(),status:r.status(),type:r.headers()['content-type'],encoding:r.headers()['content-encoding']};
    if(r.url().startsWith(base))result.resources.push(meta);
    if(r.status()>=400)result.badResponses.push(meta);
   });
   const response=await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000}); result.status=response.status();
   await page.locator('.kos-shell').waitFor({timeout:60000});
   await page.getByLabel('Задача',{exact:true}).fill('Проверка публичного запуска');
   await page.getByRole('button',{name:'Добавить задачу',exact:true}).click();
   await page.getByRole('link',{name:'Проверка публичного запуска',exact:true}).waitFor();
   await page.reload();await page.getByRole('link',{name:'Проверка публичного запуска',exact:true}).waitFor();
   await page.getByRole('link',{name:'Тренировки',exact:true}).click();
   await page.getByRole('button',{name:'Новая тренировка',exact:true}).click();
   await page.getByRole('textbox',{name:'Заметки',exact:true}).fill('Проверка публичной тренировки');
   await page.getByRole('button',{name:'Сохранить запись',exact:true}).click();
   await page.getByRole('button',{name:'Редактировать',exact:true}).waitFor();
   await page.reload();await page.getByText('Проверка публичной тренировки',{exact:true}).waitFor();
   await page.getByRole('link',{name:'Календарь',exact:true}).click();await page.getByRole('heading',{name:'Календарь',exact:true}).waitFor();
   await page.getByRole('link',{name:'Прогресс',exact:true}).click();await page.getByRole('heading',{name:'Прогресс',exact:true}).waitFor();
   await page.getByRole('link',{name:'Сегодня',exact:true}).click();
   await page.getByRole('link',{name:'Проверка публичного запуска',exact:true}).waitFor();
   result.pass=true;
   result.serviceWorkers=await page.evaluate(async()=>({controller:navigator.serviceWorker.controller?.scriptURL,registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,active:r.active?.state,waiting:r.waiting?.state}))}));
   await page.screenshot({path:path.join(out,name+'.png')});
   await context.close();
  }catch(e){result.failure=e.stack||e.message; if(browser){for(const context of browser.contexts()){for(const page of context.pages()){try{result.text=(await page.locator('body').innerText()).slice(0,3500);await page.screenshot({path:path.join(out,name+'-failure.png')})}catch{}}}}}
  finally{if(browser)await browser.close()}
 }
 report.pass=report.browsers.length===2&&report.browsers.every(b=>b.pass);
 fs.writeFileSync(path.join(out,'latest.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 process.exitCode=report.pass?0:1;
})().catch(e=>{console.error(e);process.exitCode=1});
