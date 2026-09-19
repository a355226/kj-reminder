/* ===== KJ PWA 更新穩定版 SW (支援完全離線冷啟動與順暢換頁) ===== */

const CACHE_NAME = "runtime-v2"; // 升級版本號以刷新快取

// 啟用時：接管頁面，清除舊版快取，並停用容易導致手機換頁懸掛的 navigationPreload
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        );
      } finally {
        await self.clients.claim();
        // 關閉 navigationPreload 避免手機 WebKit 換頁卡死
        if (self.registration.navigationPreload) {
          await self.registration.navigationPreload.disable();
        }
      }
    })()
  );
});

// 安裝就直接跳過等待，讓新 SW 立即上線
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// 嚴格排除 Firebase 資料庫與驗證 API（這些動態 API 不可快取）
const BYPASS = [
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "asia-southeast1.firebasedatabase.app",
];

// 關鍵靜態第三方 CDN（離線時必須靠快取提供，否則斷網無法執行）
const ESSENTIAL_CDN_HOSTS = [
  "www.gstatic.com",
  "cdn.jsdelivr.net",
  "apis.google.com",
  "accounts.google.com",
];

// 需要「即時更新」的 JS 名稱（同網域）
const JS_IMMEDIATE = [
  /^\/.*app(\.min)?\.js(\?.*)?$/i,
  /^\/.*app2(\.min)?\.js(\?.*)?$/i,
  /^\/.*mymemo(\.min)?\.js(\?.*)?$/i,
];

// 工具：網路優先（失敗才回快取）
async function networkFirst(event) {
  const req = event.request;
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req, { cache: "no-store" });
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    // 斷網時先精準比對，找不到則忽略 search 參數比對
    const hit =
      (await cache.match(req)) ||
      (await cache.match(req, { ignoreSearch: true }));
    return hit || new Response("Offline", { status: 503 });
  }
}

// 工具：快取優先（有就用、沒有再抓並存入）
async function cacheFirst(event) {
  const req = event.request;
  const cache = await caches.open(CACHE_NAME);
  const hit =
    (await cache.match(req)) ||
    (await cache.match(req, { ignoreSearch: true }));
  if (hit) return hit;

  try {
    const resp = await fetch(req);
    const isSameOrigin = new URL(req.url).origin === self.location.origin;
    const isCdn = ESSENTIAL_CDN_HOSTS.some((h) =>
      new URL(req.url).hostname.includes(h)
    );

    if (
      req.method === "GET" &&
      (resp.ok || resp.type === "opaque") &&
      (isSameOrigin || isCdn)
    ) {
      cache.put(req, resp.clone());
    }
    return resp;
  } catch (e) {
    return hit || new Response("Offline", { status: 503 });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 非 GET 不攔（例如 POST）
  if (req.method !== "GET") return;

  // 動態 API → 不攔截（直接走網路）
  if (BYPASS.some((h) => url.hostname.includes(h))) return;

  // 1) 關鍵第三方 CDN 靜態檔案（Firebase SDK / Sortable）：快取優先
  if (ESSENTIAL_CDN_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(cacheFirst(event));
    return;
  }

  // 非同網域其他資源不處理
  if (url.origin !== self.location.origin) return;

  // 2) 頁面導航（App 殼 / HTML 頁面）：支援子目錄與所有 HTML 換頁，一律網路優先
  if (
    req.mode === "navigate" ||
    url.pathname.endsWith(".html") ||
    url.pathname === "/" ||
    url.pathname.endsWith("/")
  ) {
    event.respondWith(networkFirst(event));
    return;
  }

  // 3) 需要即時更新的 JS 檔：一律網路優先
  if (JS_IMMEDIATE.some((re) => re.test(url.pathname))) {
    event.respondWith(networkFirst(event));
    return;
  }

  // 4) 其他資源（圖片、圖示、CSS 等）：快取優先
  event.respondWith(cacheFirst(event));
});
