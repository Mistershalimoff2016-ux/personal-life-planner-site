// Local pre-publication check. Does not publish, clear application data, or use external services.
// PREVIOUS_SITE=/path/to/previous-main [CANDIDATE_SITE=/path/to/candidate] node .github/scripts/verify-candidate.cjs
const {chromium, webkit} = require('playwright');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {scenario, verifyRetained, verifyShell} = require('./simple-pwa-scenario.cjs');

const prefix = '/personal-life-planner-site/';
const candidate = path.resolve(process.env.CANDIDATE_SITE || '.');
const previous = process.env.PREVIOUS_SITE ? path.resolve(process.env.PREVIOUS_SITE) : null;
const out = path.resolve(process.env.PWA_REPORT_DIR || 'artifacts');
fs.mkdirSync(out, {recursive:true});
const oldTask = 'Задача до SIMPLE PLANNER V1';
const oldWorkoutNote = 'Тренировка сохранена до SIMPLE PLANNER V1';
let servingRoot = candidate;
let server;
let base;
const gitHead = root => {try{return execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}catch{return null}};
const readBuild = root => JSON.parse(fs.readFileSync(path.join(root,'build-info.json'),'utf8'));
const workerManifestVersion = root => {
    const source = fs.readFileSync(path.join(root,'service-worker-assets.js'),'utf8');
    const match = source.match(/self\.assetsManifest\s*=\s*(\{[\s\S]*\})\s*;/);
    assert.ok(match, 'Missing worker asset manifest: '+root);
    return JSON.parse(match[1]).version;
};
const report = {phase:'candidate', time:new Date().toISOString(), run:process.env.GITHUB_RUN_ID || null,
    siteCommit:process.env.GITHUB_SHA || gitHead(candidate), candidateRoot:candidate, previousRoot:previous,
    browsers:[], limitations:['Local HTTP loopback serves actual candidate files; this does not verify a public HTTPS deployment or physical iPhone.'], pass:false};
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json',
    '.css':'text/css; charset=utf-8','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png',
    '.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.zip':'application/zip','.txt':'text/plain; charset=utf-8'};

async function serve(req,res) {
    try {
        const url = new URL(req.url,'http://127.0.0.1');
        if (!url.pathname.startsWith(prefix)) {res.writeHead(404);res.end('Outside candidate site');return}
        const root = servingRoot;
        const relative = decodeURIComponent(url.pathname.slice(prefix.length));
        let file = path.resolve(root, relative || 'index.html');
        if (file !== root && !file.startsWith(root+path.sep)) {res.writeHead(403);res.end();return}
        let status = 200;
        let stat;
        try {stat = await fsp.stat(file);if(stat.isDirectory()){file=path.join(file,'index.html');stat=await fsp.stat(file)}} catch {
            // GitHub Pages supplies custom 404 HTML for deep links. Missing assets stay real errors.
            if ((req.headers['sec-fetch-dest']==='document' || req.headers.accept?.includes('text/html')) && fs.existsSync(path.join(root,'404.html'))) {
                file=path.join(root,'404.html');stat=await fsp.stat(file);status=404;
            } else {res.writeHead(404,{'Content-Type':'text/plain'});res.end('Missing asset');return}
        }
        res.writeHead(status, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream',
            'Content-Length':stat.size,'Cache-Control':'public, max-age=600',
            'Last-Modified':stat.mtime.toUTCString()});
        if(req.method==='HEAD'){res.end();return}
        const stream = fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
    } catch(error) {if(!res.headersSent)res.writeHead(500);res.end('Candidate server error: '+error.message)}
}
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function workerReady(page) {
    await page.evaluate(async()=>{
        await Promise.race([
            (async()=>{
                await navigator.serviceWorker.ready;
                if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
            })(),
            new Promise((_,reject)=>setTimeout(()=>reject(Error('Service worker did not control the candidate within 30 seconds')),30000))
        ]);
    });
}
async function workerVersion(page) {
    return page.evaluate(()=>new Promise((resolve,reject)=>{
        const worker=navigator.serviceWorker.controller;
        if(!worker){resolve(null);return}
        const channel=new MessageChannel();
        const timer=setTimeout(()=>{channel.port1.close();reject(Error('Worker did not report its version'))},5000);
        channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data?.version || null)};
        worker.postMessage({type:'GET_VERSION'},[channel.port2]);
    }));
}
function tracker(result) {
    return page=>{
        page.setDefaultTimeout(30000);
        page.on('pageerror',e=>result.errors.push(e.message));
        page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text())});
        page.on('requestfailed',r=>result.failedRequests.push({url:r.url(),error:r.failure()}));
        page.on('response',r=>{if(r.status()>=400)result.badResponses.push({url:r.url(),status:r.status(),resourceType:r.request().resourceType()})});
    };
}
async function screenshotFailure(context, result, name) {
    if(!context)return;
    for(const [index,page] of context.pages().entries())try{
        result.text=(await page.locator('body').innerText()).slice(0,3000);
        await page.screenshot({path:path.join(out,`${name}-failure-${index}.png`)});
    }catch{}
}
function resultData(name) {return {name,pass:false,errors:[],consoleErrors:[],failedRequests:[],badResponses:[]}}
function browserOptions(name) {
    const options={headless:true,viewport:{width:393,height:852},locale:'ru-RU',isMobile:true,hasTouch:true,acceptDownloads:true};
    if(name==='chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)options.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    return options;
}
function assertAssets(result) {
    const missing=result.badResponses.filter(r=>r.resourceType!=='document');
    assert.equal(missing.length,0,'Candidate returned failed non-document assets: '+JSON.stringify(missing));
    assert.equal(result.errors.length,0,'Browser script errors: '+result.errors.join('\n'));
}
async function cleanCheck(name,type) {
    servingRoot=candidate;
    const result=resultData(name+'-clean');
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'simple-candidate-clean-'));
    let context;
    try {
        context=await type.launchPersistentContext(profile,browserOptions(name));
        let page=await context.newPage();tracker(result)(page);
        result.scenario=await scenario(page,base);result.threeTabs=true;
        await workerReady(page);result.activeVersion=await workerVersion(page);
        assert.equal(result.activeVersion,report.candidateVersion,'Wrong worker generation on clean install');
        await page.getByRole('link',{name:'Сегодня',exact:true}).click();await verifyShell(page);
        await page.screenshot({path:path.join(out,name+'-candidate-today.png')});
        await context.close();context=null;
        context=await type.launchPersistentContext(profile,browserOptions(name));page=await context.newPage();tracker(result)(page);
        await verifyRetained(page,base);result.onlineRestart=true;
        await page.setViewportSize({width:320,height:568});
        assert.equal(await page.locator('.kos-main').evaluate(e=>e.scrollWidth>e.clientWidth),false,'320px content overflow');
        result.narrowViewport=true;
        // WebKit offline capability is intentionally not inferred from this online candidate test.
        result.offlineTested=false;
        result.offlineLimitation='This candidate phase verifies online process restart; offline emulation is a separate capability-dependent check.';
        await page.screenshot({path:path.join(out,name+'-candidate-restart.png')});
        assertAssets(result);result.pass=true;
    } catch(error) {result.failure=error.stack||error.message;await screenshotFailure(context,result,name+'-clean')}
    finally {if(context)await context.close();fs.rmSync(profile,{recursive:true,force:true})}
    return result;
}
async function seedLegacy(page) {
    await page.goto(base);
    await page.getByLabel('Задача',{exact:true}).fill(oldTask,{timeout:60000});
    await page.getByRole('button',{name:'Добавить задачу',exact:true}).click();
    await page.getByRole('link',{name:oldTask,exact:true}).waitFor();
    await page.getByRole('link',{name:'Тренировки',exact:true}).click();
    await page.getByRole('button',{name:'Новая тренировка',exact:true}).click();
    await page.getByLabel(/Вид тренировки/).selectOption('Кардио');
    await page.getByLabel('Продолжительность, мин',{exact:true}).fill('22');
    await page.getByRole('textbox',{name:'Заметки',exact:true}).fill(oldWorkoutNote);
    await page.getByRole('button',{name:'Сохранить запись',exact:true}).click();
    await page.getByText('Запись сохранена.',{exact:true}).waitFor();
    // Start a clean document only after both records have been committed. This avoids approving
    // a reload over unsaved user input while testing the existing safe-update bridge.
    await page.goto(base+'today');
    await page.getByRole('link',{name:oldTask,exact:true}).waitFor();
    await workerReady(page);
}
async function verifyLegacyRetained(page) {
    await page.goto(base+'today');
    await page.getByRole('link',{name:oldTask,exact:true}).waitFor({timeout:60000});
    await verifyShell(page);
    await page.getByRole('link',{name:'Спорт',exact:true}).click();
    await page.getByRole('link',{name:/Кардио/}).first().click();
    await page.getByText(oldWorkoutNote,{exact:true}).waitFor();
    await page.getByRole('button',{name:'Редактировать',exact:true}).click();
    assert.equal(await page.getByLabel('Продолжительность, мин',{exact:true}).inputValue(),'22','Legacy workout duration changed');
    assert.equal(await page.getByLabel('Вид тренировки',{exact:true}).inputValue(),'Кардио','Legacy workout kind changed');
}
async function upgradeCheck(name,type) {
    const result=resultData(name+'-upgrade');
    if(!previous) {result.skipped=true;result.failure='PREVIOUS_SITE is required for an actual V2-to-candidate upgrade test';return result}
    servingRoot=previous;
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'simple-candidate-upgrade-'));
    let context;
    try {
        context=await type.launchPersistentContext(profile,browserOptions(name));let page=await context.newPage();tracker(result)(page);
        await seedLegacy(page);result.beforeVersion=await workerVersion(page);
        assert.equal(result.beforeVersion,report.previousVersion,'Upgrade did not start with the previous worker');
        assert.notEqual(result.beforeVersion,report.candidateVersion,'Previous and candidate worker generations must differ');
        result.legacyRecordsSaved={task:oldTask,workoutKind:'Кардио',workoutMinutes:22,workoutNote:oldWorkoutNote};
        servingRoot=candidate;
        await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();if(!registration)throw Error('Previous worker registration absent');await registration.update()});
        const deadline=Date.now()+90000;
        let lastError;
        while(Date.now()<deadline) {
            try {
                const update=page.getByRole('button',{name:'Обновить после сохранения',exact:true});
                if(await update.isVisible()){await update.click();result.safeUpdateButtonUsed=true}
                const active=await workerVersion(page);
                if(active===report.candidateVersion) {
                    await verifyShell(page);result.afterVersion=active;break;
                }
            } catch(error) {lastError=error.message}
            await pause(500);
        }
        assert.equal(result.afterVersion,report.candidateVersion,'Candidate did not activate/show three tabs: '+(lastError||'worker generation remained old'));
        await verifyLegacyRetained(page);result.legacyDataRetained=true;result.threeTabs=true;
        await page.screenshot({path:path.join(out,name+'-candidate-upgrade.png')});
        await context.close();context=null;
        context=await type.launchPersistentContext(profile,browserOptions(name));page=await context.newPage();tracker(result)(page);
        await verifyLegacyRetained(page);result.upgradeRestartRetained=true;
        assertAssets(result);result.pass=true;
    } catch(error) {result.failure=error.stack||error.message;await screenshotFailure(context,result,name+'-upgrade')}
    finally {servingRoot=candidate;if(context)await context.close();fs.rmSync(profile,{recursive:true,force:true})}
    return result;
}
(async()=>{
    report.build=readBuild(candidate);report.expectedSource=report.build.source_commit;report.sourceCommit=report.expectedSource;
    report.candidateVersion=workerManifestVersion(candidate);
    if(previous){report.previousBuild=readBuild(previous);report.previousVersion=workerManifestVersion(previous);report.previousSiteCommit=gitHead(previous)}
    server=http.createServer((req,res)=>void serve(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    base='http://127.0.0.1:'+server.address().port+prefix;report.url=base;
    const requested=(process.env.PWA_BROWSERS||'chromium,webkit').split(',').map(x=>x.trim());
    for(const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
        if(!requested.includes(name)){report.browsers.push({name,pass:false,skipped:true,limitation:'Browser excluded by PWA_BROWSERS'});continue}
        const result={name,clean:await cleanCheck(name,type),upgrade:await upgradeCheck(name,type)};
        result.pass=result.clean.pass&&result.upgrade.pass;report.browsers.push(result);
    }
    report.pass=report.browsers.length===2&&report.browsers.every(result=>result.pass);
})().catch(error=>{report.failure=error.stack||error.message}).finally(async()=>{
    if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve))}
    report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'latest.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
});
