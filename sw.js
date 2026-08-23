/* 한판고 서비스워커 — 정적 전체 프리캐시 + 오프라인 플레이
 * 외부 라이브러리 0(workbox 없음) · 빌드 0 · Cloudflare Pages 루트 서빙 전제.
 *
 * ★캐시 버전: 파일을 추가/변경하면 CACHE 문자열을 올려라(구버전은 activate 에서 삭제된다).
 *   DEPLOY.md '게임 추가 절차' 체크리스트 참조.
 */
const CACHE = 'hanpango-v7';

/* 사이트 총량 ~100KB(정적) — 전량 프리캐시한다.
 * 디렉터리 형태(/block-puzzle/)와 파일 형태(/block-puzzle/index.html)를 둘 다 넣는 것은
 * 의도적이다: 사용자는 전자로, sitemap·직접 링크는 후자로 들어올 수 있다. */
const PRECACHE = [
  '/',
  '/games.json',
  '/block-puzzle/',
  '/block-puzzle/thumb.webp',
  '/2048/',
  '/2048/thumb.webp',
  '/privacy/',
  '/about/',
  '/icon.svg',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/donate-qr.webp',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* HTML 과 games.json 은 network-first.
 * 이유: '오늘의 도전' seed 가 날짜 기반이라 온라인일 때는 항상 최신 문서를 받아야 한다. */
async function networkFirst(event, request) {
  try {
    const preloaded = event.preloadResponse ? await event.preloadResponse : null;
    const response = preloaded || await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await caches.match('/');
      if (shell) return shell;
    }
    throw err;
  }
}

/* 정적 자산(webp·png·svg·ico)은 cache-first — 내용이 바뀌면 CACHE 버전으로 무효화한다. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 비-GET(POST 등)은 손대지 않는다.
  if (request.method !== 'GET') return;

  // ★외부 오리진(AdSense·googlesyndication 등)은 절대 가로채지 않는다.
  //   respondWith 를 호출하지 않으면 브라우저 기본 네트워크 경로로 그대로 나간다.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const accept = request.headers.get('accept') || '';
  const isDocument = request.mode === 'navigate' || accept.includes('text/html');
  const isGamesJson = url.pathname === '/games.json';

  if (isDocument || isGamesJson) {
    event.respondWith(networkFirst(event, request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});
