/* 한판고 서비스워커 — 정적 전체 프리캐시 + 오프라인 플레이
 * 외부 라이브러리 0(workbox 없음) · 빌드 0 · Cloudflare Pages 루트 서빙 전제.
 *
 * ★캐시 버전: 파일을 추가/변경하면 CACHE 문자열을 올려라(구버전은 activate 에서 삭제된다).
 *   DEPLOY.md '게임 추가 절차' 체크리스트 참조.
 */
const CACHE = 'hanpango-v38';

/* 사이트 총량 ~100KB(정적) — 전량 프리캐시한다.
 * ★디렉터리 형태(/block-puzzle/)만 넣는다 — 파일 형태(/block-puzzle/index.html)는 넣지 않는다.
 * Cloudflare Pages 가 그 주소를 308(리다이렉트)로 되돌려 주기 때문에, 한 줄만 넣어도
 * cache.addAll 이 통째로 reject 되어 프리캐시가 전부 실패한다(2026-08-26 실측).
 * 사용자·sitemap·직접 링크는 모두 디렉터리 형태로 들어오므로 이것으로 충분하다. */
const PRECACHE = [
  '/',
  '/games.json',
  '/js/hp-stats.js',
  '/block-puzzle/',
  '/block-puzzle/thumb.webp',
  '/2048/',
  '/2048/thumb.webp',
  '/block-drop/',
  '/block-drop/thumb.webp',
  '/word/',
  '/word/thumb.webp',
  '/shooting/',
  '/shooting/thumb.webp',
  '/brick-breaker/',
  '/brick-breaker/thumb.webp',
  '/estimate/',
  '/estimate/thumb.webp',
  '/sudoku/',
  '/sudoku/thumb.webp',
  '/nonsense/',
  '/nonsense/thumb.webp',
  '/wordchain/',
  '/wordchain/thumb.webp',
  '/minesweeper/',
  '/minesweeper/thumb.webp',
  '/ladder/',
  '/ladder/thumb.webp',
  '/memory/',
  '/memory/thumb.webp',
  '/nonogram/',
  '/nonogram/thumb.webp',
  '/tensec/',
  '/tensec/thumb.webp',
  '/stop/',
  '/stop/thumb.webp',
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

  /* ★/api/ 는 절대 캐시하지 않는다 — 방문·판수는 매번 지금 값을 받아야 한다.
     respondWith 를 부르지 않고 그대로 내보내면 브라우저 기본 네트워크 경로로 나간다
     (network-only). 캐시에 한 번이라도 들어가면 통계가 과거에 얼어붙는다. */
  if (url.pathname.startsWith('/api/')) return;

  const accept = request.headers.get('accept') || '';
  const isDocument = request.mode === 'navigate' || accept.includes('text/html');
  const isGamesJson = url.pathname === '/games.json';

  if (isDocument || isGamesJson) {
    event.respondWith(networkFirst(event, request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});
