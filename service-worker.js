/* ===== KJ PWA 穩定版 SW (保證自動登入與跳轉正常) ===== */

const CACHE_NAME = "kj-pwa-static-v3";

// 僅快取真正離線必需的靜態資源
const ESSENTIAL_ASSETS = [
  "https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 清理舊版本快取
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// 絕對不攔截的網域（所有 Google 登入、Token 驗證、Firebase API 一律直接走原生網路）
const STRICT_BYPASS = [
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "asia-southeast1.firebasedatabase.app",
  "accounts.google.com",
  "apis.google.com",
  "firebaseapp.com"
];

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. 只處理 GET 請求
  if (req.method !== "GET") return;

  // 2. 嚴格放行：任何涉及登入與 Firebase 通訊的流量，絕不走快取
  if (STRICT_BYPASS.some((h) => url.hostname.includes(h))) {
    return;
  }

  // 3. 關鍵第三方 CDN 靜態檔（Firebase SDK / Sortable）：快取優先
  if (url.origin.includes("cdn.jsdelivr.net") || url.origin.includes("www.gstatic.com")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const resp = await fetch(req);
          if (resp && (resp.ok || resp.type === "opaque")) {
            cache.put(req, resp.clone());
          }
          return resp;
        } catch (e) {
          return hit || new Response("Offline", { status: 503 });
        }
      })
    );
    return;
  }

  // 4. 其他跨域資源不處理
  if (url.origin !== self.location.origin) return;

  // 5. 同網域資源（包含 HTML 與 JS）：一律走網路優先，斷網時才讀快取
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (err) {
        // 斷網時退回快取
        const hit =
          (await cache.match(req)) ||
          (await cache.match(req, { ignoreSearch: true }));
        return hit || new Response("Offline", { status: 503 });
      }
    })()
  );
});
