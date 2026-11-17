const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {scenario,verifyRetained,verifyShell}=require('./simple-pwa-scenario.cjs');
const base='https://mistershalimoff2016-ux.github.io/personal-life-planner-site/';
const out=process.env.PWA_REPORT_DIR||'public-check';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const expected=JSON.parse(fs.readFileSync('build-info.json','utf8')).source_commit;
 const report={phase:'public',url:base,time:new Date().toISOString(),run:process.env.GITHUB_RUN_ID,siteCommit:process.env.GITHUB_SHA,expectedSource:expected,browsers:[]};
 for(let attempt=0;attempt<60;attempt++){
  try{const r=await fetch(base+'build-info.json?verify='+Date.now(),{cache:'no-store'});const body=await r.text();report.build={status:r.status,body};if(r.ok&&JSON.parse(body).source_commit===expected)break}catch(e){report.build={error:e.message}}
  if(attempt===59)throw Error('Expected public deployment is not available');await new Promise(r=>setTimeout(r,5000));
 }
 for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
  const result={name,pass:false,errors:[],failedRequests:[],badResponses:[]};report.browsers.push(result);
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'simple-public-'));let context;
  const options={headless:true,viewport:{width:393,height:852},locale:'ru-RU',isMobile:true,hasTouch:true};
  const track=p=>{p.on('pageerror',e=>result.errors.push(e.message));p.on('requestfailed',r=>result.failedRequests.push({url:r.url(),error:r.failure()}));p.on('response',r=>{if(r.status()>=400)result.badResponses.push({url:r.url(),status:r.status()})})};
  try{
   context=await type.launchPersistentContext(profile,options);let page=await context.newPage();track(page);
   result.scenario=await scenario(page,base);result.threeTabs=true;
   await page.getByRole('link',{name:'Сегодня',exact:true}).click();await verifyShell(page);await page.screenshot({path:path.join(out,name+'-today.png')});
   await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}))});
   result.activeVersion=await page.evaluate(()=>new Promise((resolve,reject)=>{const c=new MessageChannel();const t=setTimeout(()=>reject(Error('No worker version')),5000);c.port1.onmessage=e=>{clearTimeout(t);resolve(e.data.version)};navigator.serviceWorker.controller.postMessage({type:'GET_VERSION'},[c.port2])}));
   await context.close();context=await type.launchPersistentContext(profile,options);page=await context.newPage();track(page);
   await verifyRetained(page,base);result.onlineRestart=true;
   let offlineSupported=name==='chromium';
   if(name==='webkit')try{offlineSupported=JSON.parse(fs.readFileSync(path.join(out,'webkit-capability.json'),'utf8')).sameSessionOffline===true}catch{}
   if(offlineSupported){await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}))});await context.setOffline(true);await page.reload();await page.getByRole('button',{name:'Редактировать',exact:true}).waitFor();await verifyRetained(page,base);result.offlineReloadAfterRestart=true}
   else{result.offlineReloadAfterRestart=null;result.offlineLimitation='Offline emulation unavailable in minimal WebKit probe; online restart verified.'}
   await page.setViewportSize({width:320,height:568});if(await page.locator('.kos-main').evaluate(e=>e.scrollWidth>e.clientWidth))throw Error('Narrow viewport overflow');result.narrowViewport=true;
   await page.screenshot({path:path.join(out,name+'.png')});result.pass=result.errors.length===0;
  }catch(e){result.failure=e.stack||e.message;if(context)for(const p of context.pages())try{result.text=(await p.locator('body').innerText()).slice(0,2500);await p.screenshot({path:path.join(out,name+'-failure.png')})}catch{}}
  finally{if(context)await context.close();fs.rmSync(profile,{recursive:true,force:true})}
 }
 report.pass=report.browsers.every(b=>b.pass);fs.writeFileSync(path.join(out,'latest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
})().catch(e=>{console.error(e);process.exitCode=1});
