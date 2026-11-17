// Startup/update bridge. It never clears application data, caches or IndexedDB.
(() => {
    const script = document.currentScript;
    const bootVersion = script?.dataset.bootVersion || 'development';
    const base = new URL(document.baseURI);
    const retryKey = `planner-start-retry:${base.pathname}:${bootVersion}`;
    const initialController = navigator.serviceWorker?.controller;
    let dirty = false;
    let reloading = false;
    let started = false;
    let banner;
    let handlingFailure = false;
    for (const event of ['input', 'change']) document.addEventListener(event, e => {
        if (e.target?.matches('input,select,textarea,[contenteditable]')) dirty = true;
    }, true);

    function reloadOnce(version, approved = false) {
        if (reloading) return;
        if (dirty && !approved) { showUpdate(version); return; }
        const key = `planner-reloaded:${base.pathname}:${version}`;
        try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* private mode */ }
        reloading = true;
        location.reload();
    }
    function showUpdate(version) {
        if (banner) return;
        banner = document.createElement('aside');
        banner.setAttribute('role', 'status');
        banner.style.cssText = 'position:fixed;left:12px;right:12px;bottom:90px;z-index:2000;padding:16px;border:1px solid #77d8c6;border-radius:12px;background:#142722;color:#e6eeee;font:14px -apple-system,sans-serif;box-shadow:0 8px 30px #0008';
        const text = document.createElement('p');
        text.textContent = 'Новая версия готова. Сохраните незавершённый ввод перед обновлением. Записи на устройстве сохранятся.';
        const button = document.createElement('button');
        button.textContent = 'Обновить после сохранения';
        button.style.cssText = 'min-height:44px;padding:10px 15px;border:0;border-radius:8px;background:#9ed9b5;color:#10251c';
        button.onclick = () => reloadOnce(version, true);
        banner.append(text, button); document.body.append(banner);
    }
    async function workerVersion(worker) {
        if (!worker) return null;
        return new Promise(resolve => {
            const channel = new MessageChannel();
            const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 1500);
            channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data?.version); };
            worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
        });
    }
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', async () => {
            // The first install claims a fresh page which already runs this release.
            if (!initialController) return;
            const version = await workerVersion(navigator.serviceWorker.controller);
            if (version) reloadOnce(version);
        });
        navigator.serviceWorker.addEventListener('message', e => {
            if (initialController && e.data?.type === 'APP_UPDATED') reloadOnce(e.data.version);
        });
        navigator.serviceWorker.register(new URL('service-worker.js', base), { updateViaCache: 'none' })
            .then(registration => {
                const check = () => registration.update().catch(error => console.warn('PWA update unavailable:', error.message));
                check();
                document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
                window.addEventListener('online', check);
            }).catch(error => console.warn('Offline installation unavailable:', error.message));
    }

    function showStartupFailure(error) {
        if (started) return;
        const root = document.querySelector('#app .spinner-container');
        if (!root) return;
        root.replaceChildren();
        root.style.cssText = 'padding:24px;display:flex;flex-direction:column;gap:14px;color:#e6eeee;background:#101818;text-align:center;font:16px -apple-system,sans-serif;height:100dvh';
        const title = document.createElement('strong'); title.textContent = 'Не удалось загрузить планер';
        const text = document.createElement('p'); text.textContent = 'Проверьте соединение и повторите загрузку. Сохранённые записи остаются на устройстве.';
        const button = document.createElement('button'); button.textContent = 'Повторить загрузку';
        button.style.cssText = 'min-height:46px;padding:12px 18px;border-radius:10px;border:0;background:#9ed9b5';
        button.onclick = () => { const url = new URL(location.href); url.searchParams.set('reload', Date.now()); location.replace(url); };
        root.append(title, text, button);
        console.error('Planner startup failed:', error);
    }
    const timeout = setTimeout(() => showStartupFailure('Startup exceeded 60 seconds'), 60000);
    function startupFailed(error) {
        if (started || handlingFailure) return;
        handlingFailure = true;
        clearTimeout(timeout);
        // Blazor can report platform failures through window events rather than its start promise.
        let retried = true;
        try { retried = !!sessionStorage.getItem(retryKey); sessionStorage.setItem(retryKey, '1'); } catch { /* no reload loop */ }
        if (!retried && navigator.onLine && !dirty) {
            const url = new URL(location.href); url.searchParams.set('reload', Date.now()); location.replace(url);
        } else showStartupFailure(error);
    }
    window.addEventListener('error', event => startupFailed(event.error || event.message));
    window.addEventListener('unhandledrejection', event => startupFailed(event.reason));
    const observer = new MutationObserver(() => {
        if (!document.querySelector('#app .kos-shell')) return;
        started = true; clearTimeout(timeout); observer.disconnect();
        try { sessionStorage.removeItem(retryKey); } catch { /* private mode */ }
    });
    observer.observe(document.getElementById('app'), { childList: true, subtree: true });
    Promise.resolve().then(() => Blazor.start({
        loadBootResource: (type, name, uri) => {
            if (type === 'dotnetjs') {
                const url = new URL(uri, base); url.searchParams.set('v', bootVersion); return url.href;
            }
            return undefined;
        }
    })).catch(startupFailed);
})();
