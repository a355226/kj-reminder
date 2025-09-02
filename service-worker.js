// service-worker.js
const CACHE_NAME = 'cms-quota-v1';  // 目前未使用但保留
const URLS_TO_CACHE = [
  '/', '/index.html', '/reminder.png', '/manifest.json'
];

// 立即接管生命週期
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  clients.claim();
});

// 單一 fetch 監聽：特定網域「不接管」，其餘一律走網路（不快取）
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 跳過 Firebase Auth / Secure Token / Realtime DB / SDK 等請求
  const bypassHosts = [
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebaseapp.com', // 有些 flow 會走這個
    'googleapis.com',
    'gstatic.com',     // SDK 腳本避免被舊版快取
    'asia-southeast1.firebasedatabase.app'
  ];

  // 命中以上網域：不接管，讓瀏覽器直接請求（等同原生網路）
  if (bypassHosts.some(host => url.hostname.includes(host))) {
    return;
  }

  // 其餘請求：強制走最新（不使用快取）
  event.respondWith(fetch(event.request));
});
