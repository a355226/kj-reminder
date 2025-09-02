const CACHE_NAME = "cms-quota-v1"; // 更新版本號
const URLS_TO_CACHE = ["/", "/index.html", "/reminder.png", "/manifest.json"];

// 在安裝時快取必須的資源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
  self.skipWaiting(); // 安裝後立即啟用
});

// 在啟用時，清理舊的快取
self.addEventListener("activate", (event) => {
  const cacheWhitelist = [CACHE_NAME]; // 確保新版本的快取會保留
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (!cacheWhitelist.includes(cacheName)) {
              return caches.delete(cacheName); // 刪除舊的快取
            }
          })
        );
      })
      .then(() => {
        clients.claim(); // 啟用後立刻接管所有頁面
      })
  );
});

// 優化 fetch 事件處理，合併網路與快取策略
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const bypass = [
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    "firebaseapp.com",
    "googleapis.com",
    "gstatic.com",
    "asia-southeast1.firebasedatabase.app",
  ];

  // 跳過指定的 API 請求
  if (bypass.some((host) => url.hostname.includes(host))) {
    event.respondWith(fetch(event.request)); // 直接使用網路請求
    return;
  }

  // 嘗試從快取中獲取資源，若找不到再從網路載入
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // 如果找到快取，返回快取內容
        return cachedResponse;
      }

      // 若快取中沒有，則從網路請求並快取回來
      return fetch(event.request).then((response) => {
        // 如果請求成功，將結果快取
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, response.clone());
          return response;
        });
      });
    })
  );
});
