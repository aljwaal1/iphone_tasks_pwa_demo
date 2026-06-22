importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

/* ===== تخزين مؤقت للعمل شبه أوفلاين (دمج بدل sw.js غير المستخدم) ===== */
const CACHE_NAME = "iphone-tasks-pwa-pro-v13";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  // لا نتدخل في طلبات OneSignal نفسها (تحتاج الشبكة دائمًا)
  if(event.request.url.includes("onesignal.com") || event.request.url.includes("cdn.onesignal.com")) return;
  event.respondWith(
    caches.match(event.request).then(res => res || fetch(event.request))
  );
});
