// service-worker.js（示意）
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 跳過 Firebase Auth / Secure Token / Realtime DB 的請求，直接走網路
  const bypass = [
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebaseapp.com', // 有些 flow 會走這個
    'googleapis.com',
    'gstatic.com', // SDK 腳本也別亂快取舊版
    'asia-southeast1.firebasedatabase.app'
  ];

  if (bypass.some(host => url.hostname.includes(host))) return; // 不接管

  // ...其餘你的快取策略


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