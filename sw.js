// 성경읽기 앱 서비스 워커
// - 같은 주소의 파일(index.html 등)은 항상 서버에서 새 버전을 먼저 확인합니다.
// - 인터넷이 없거나 4초 안에 응답이 없으면 저장해 둔 마지막 버전을 보여줍니다.
// - Firebase 라이브러리는 저장해 두었다가 사용해 인터넷이 없어도 화면이 열립니다.
// - Firestore 데이터 요청은 건드리지 않습니다.
const CACHE = 'bible-reading-v1';
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(new Request(self.registration.scope, { cache: 'reload' })).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('bible-reading-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Firebase 라이브러리(주소에 버전이 들어 있어 내용이 바뀌지 않음): 저장본 우선
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 같은 사이트의 파일: 서버 우선, 실패하면 저장본
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  }
  // 그 밖의 요청(Firestore 등)은 브라우저가 그대로 처리합니다.
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const findCached = async () =>
    (await cache.match(req, { ignoreSearch: true })) ||
    (req.mode === 'navigate'
      ? (await cache.match(self.registration.scope)) ||
        (await cache.match(new URL('index.html', self.registration.scope).href))
      : undefined);

  const cached = await findCached();

  // 브라우저 임시 저장본을 쓰지 않고 서버에 새 버전이 있는지 확인합니다.
  const net = fetch(req.url, { cache: 'no-cache' }).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });

  if (!cached) return net;
  return Promise.race([
    net.catch(() => cached),
    new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_WAIT_MS)),
  ]);
}
