const CACHE_NAME = 'cms-quota-v1';  // ← 可改版號以觸發更新
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/reminder.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // 安裝後立即啟用
});

self.addEventListener('activate', event => {
  clients.claim(); // 啟用後立刻接管所有頁面
});

self.addEventListener('fetch', event => {
  // 不做任何快取，直接用 fetch 確保都是最新資料
  event.respondWith(fetch(event.request));
});