/* ===== KJ PWA 更新穩定版 SW ===== */

// 你想要每次部署就一定清掉舊快取 → 這裡直接在 activate 把所有 caches 清空
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } finally {
      // 立刻接管現有頁面
      await self.clients.claim();
      // 可選：啟用 navigation preload（網路更快）
      self.registration.navigationPreload && self.registration.navigationPreload.enable();
    }
  })());
});

// 安裝就直接跳過等待，讓新 SW 立即上線
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 不要攔截 Firebase/Google 等外部流量（避免壞快取）
const BYPASS = [
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseapp.com',
  'googleapis.com',
  'gstatic.com',
  'asia-southeast1.firebasedatabase.app'
];

// 視為「殼」的頁面：開啟 App 時一定網路優先
const APP_SHELLS = ['/', '/index.html', '/mymemo.html'];

// 需要「即時更新」的 JS 名稱（同網域）
const JS_IMMEDIATE = [
  /^\/app(\.min)?\.js(\?.*)?$/i,
  /^\/app2(\.min)?\.js(\?.*)?$/i,
  /^\/mymemo(\.min)?\.js(\?.*)?$/i
];

// 工具：網路優先（失敗才回快取）
async function networkFirst(event) {
  const req = event.request;
  try {
    // no-store 強制拿到新內容
    const fresh = await fetch(req, { cache: 'no-store' });
    const cache = await caches.open('runtime');
    cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    const cache = await caches.open('runtime');
    const hit = await cache.match(req);
    return hit || new Response('Offline', { status: 503 });
  }
}

// 工具：快取優先（有就用、沒有再抓）
async function cacheFirst(event) {
  const req = event.request;
  const cache = await caches.open('runtime');
  const hit = await cache.match(req);
  if (hit) return hit;
  const resp = await fetch(req);
  // 只快取同網域 GET 成功的資源
  if (req.method === 'GET' && resp.ok && new URL(req.url).origin === self.location.origin) {
    cache.put(req, resp.clone());
  }
  return resp;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 非 GET 不攔（例如 POST）
  if (req.method !== 'GET') return;

  // 外部服務 → 不攔截（直接走網路）
  if (BYPASS.some(h => url.hostname.includes(h))) return;

  // 只處理同網域資源
  if (url.origin !== self.location.origin) return;

  // 1) App 殼：一律網路優先
  if (APP_SHELLS.includes(url.pathname)) {
    event.respondWith(networkFirst(event));
    return;
  }

  // 2) 需要即時更新的 JS 檔：一律網路優先
  if (JS_IMMEDIATE.some(re => re.test(url.pathname))) {
    event.respondWith(networkFirst(event));
    return;
  }

  // 3) 其他資源：快取優先（可離線）
  event.respondWith(cacheFirst(event));
});