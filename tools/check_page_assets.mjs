/* 페이지 자산 프리캐시 커버리지 게이트 — 2026-09-03 · T0903-runtime-asset-escape 2단계
 *
 * 계약 (master 승인 · 2026-09-03 · 이 한 문장이 판정의 단일 기준이다)
 *   **페이지가 참조하는 동일 오리진 하위 자원(문서와 `/api/` 를 뺀 것)은 모두 PRECACHE 에 실려 있어야 한다.**
 *
 * 왜 만들었나 — 축7 이 열리는 자리를 구조로 닫는다
 *   `sw.js` 의 fetch 핸들러는 문서와 `/api/` 를 뺀 **모든 동일 오리진 GET** 을 cacheFirst 로 보내고
 *   (sw.js:137-138), cacheFirst 는 캐시에 있으면 **망에 나가지 않는다**(sw.js:105-106). 담기는 곳은
 *   프리캐시와 **같은 버킷**이라(sw.js:109) CACHE 를 올리면 함께 지워진다(sw.js:75-76).
 *   그래서 '구버전 자산이 영원히 남는' 사고는 **PRECACHE 밖 자원이 있을 때만** 생긴다 —
 *   자매 게이트 `check_precache_cache.mjs` 는 PRECACHE **대상**이 바뀔 때만 CACHE 를 요구하므로,
 *   목록 밖 자산만 바뀐 출고는 초록으로 지나간다(2026-09-03 합성 커밋으로 재현했다).
 *   ★현행 저장소에는 그런 자원이 0건이다. 이 게이트는 그 0을 **지키는** 장치다(사고 수습이 아니다).
 *
 * ★형제 게이트와의 관계 — 거울상이지 같은 계약이 아니다
 *   `check_precache_integrity.mjs` 는 **목록 → 파일**을 본다(실린 것이 실재하는가).
 *   이 도구는 **페이지 참조 → 목록**을 본다(요청될 것이 실려 있는가).
 *   방향이 반대이므로 ★한 도구에 얹지 않는다(하나의 게이트에 두 계약을 얹으면 그것이 다음 라운드의 병이 된다).
 *
 * 규칙 (지적마다 [규칙id] 가 붙는다 — 뮤테이션이 이 id 로 귀속을 대조한다)
 *   [page-asset-precached]   페이지가 참조하는 동일 오리진 하위 자원이 PRECACHE 에 있다
 *   [page-asset-dynamic]     정적으로 못 푸는 조립 참조는 ★통과가 아니라 판정 불가다(데이터 원본을 찾으면 전개해서 판정)
 *   [page-asset-sw-exempt]   서비스워커 스크립트 면제는 ★등록문이 실제로 준 경로 하나에만 준다
 *
 * ★급소를 먼저 밝힌다 — 정적 추출로 못 보는 참조 (master 가 이 게이트의 급소로 지목한 자리)
 *   대문은 카드를 `games.json` 으로 **런타임에 조립**한다(index.html:455-456 `${esc(g.path)}`·`${esc(g.thumb)}`).
 *   문자열만 긁는 추출기는 그 자리에서 `${…}` 밖에 못 본다. 이 도구는 그것을 두 갈래로 가른다:
 *     (가) **데이터에서 파생되는 조립** — 그 페이지가 리터럴로 `fetch('/games.json')` 하거나
 *          `<link rel="manifest" href="…">` 로 매니페스트를 걸고 있으면, 그 **데이터 파일을 열어
 *          경로꼴 값을 전부 전개**해서 규칙 1로 판정한다(조립식을 해석하지 않는다 — 데이터가 정본이다).
 *     (나) **원본을 못 찾는 조립** — 판정 불가(rc=2)다. ★'모르면 초록' 은 게이트가 아니다.
 *   그리고 ★통과할 때도 조립 자리와 그 해소 경로를 판정문에 찍는다. 무엇을 못 보는지 말하지 않는
 *   초록은 자기 사정거리를 숨긴다(2026-09-03 내가 내 실재성 게이트에서 찾아낸 바로 그 병이다).
 *
 * ★교차 오리진을 빼는 이유는 둘이고, 둘 다 필요하다
 *   ①도달하지 않는다 — `sw.js:124` 가 `respondWith` 를 부르지 않아 우리 버킷에 들어가지 않는다.
 *   ②넣으면 해롭다 — 우리가 버전을 통제하지 않는데다 `cache.addAll` 은 non-ok·opaque 응답에서
 *     TypeError 로 **목록 전체를 reject** 한다. 교차 오리진을 요구하는 가드는 우리가 막으려던
 *     그 병(프리캐시 통째 실패)을 스스로 부른다.
 *   ★서비스워커 스크립트(`/sw.js`)도 뺀다 — 명세가 그 요청에 service-workers mode "none" 을 못박아
 *     어떤 fetch 핸들러도 가로챌 수 없고, 프리캐시에 넣으면 워커가 자기 갱신 경로를 방해한다.
 *     다만 면제는 **등록문이 실제로 준 경로 하나**로 좁힌다 — 이름 규칙(`*sw*.js` 꼴)로 주면
 *     그 틈으로 진짜 자산이 빠져나간다.
 *
 * ★이 도구가 못 보는 것(정직한 한계)
 *   · **따옴표 밖에서 조립되는 경로는 못 본다.** 그래서 (나) 갈래를 판정 불가로 둔다 —
 *     내 그물의 한계를 계약이 알고 있어야 한다.
 *   · **역방향은 보지 않는다.** PRECACHE 에 있는데 아무 페이지도 안 부르는 항목은 이 계약의 대상이 아니다
 *     (실재성은 형제 게이트가 본다).
 *   · **배포 산출물이 아니라 저장소를 본다.** 호스팅이 자동으로 끼워 넣는 자원은 보이지 않는다.
 *   · CSS 는 이 저장소에 별도 파일이 없어(전부 인라인) `<link rel=stylesheet>` 경로는 표본으로 시험하지 못했다.
 *     규칙상으로는 다른 자산과 똑같이 취급된다.
 *
 * 사용법:
 *   node tools/check_page_assets.mjs [저장소 경로]
 *   node tools/check_page_assets.mjs [저장소 경로] --mutate <이름>
 *   node tools/check_page_assets.mjs [저장소 경로] --selftest
 *   ★모르는 플래그·값 없는 플래그는 rc=2 로 거부한다(사용법 출력에 rc=0 을 쓰지 않는다).
 *
 * 종료코드: 0 미달 0 · 1 미달 발견 · 2 판정 불가(모르는 플래그·값 누락·뮤테이션 주입 실패 포함)
 *           ★--mutate 는 뮤테이션마다 기대 rc 가 다르다(오탐 0 표본은 0, 판정 불가 표본은 2)
 *           → 0 기대대로 · 3 어긋남 · 2 주입 실패.
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const has = n => argv.indexOf(n) >= 0;
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const FLAGS_WITH_VALUE = ['--mutate'];
const FLAGS_BARE = ['--selftest'];
const USAGE = [
  '사용법:',
  '  node tools/check_page_assets.mjs [저장소 경로]',
  '  node tools/check_page_assets.mjs [저장소 경로] --mutate <이름>',
  '  node tools/check_page_assets.mjs [저장소 경로] --selftest',
  '종료코드: 0 미달 0 · 1 미달 발견 · 2 판정 불가(모르는 플래그·값 누락 포함)'
].join('\n');
function refuseFlags(why){
  console.error('  ‽ [page-asset-precached] 판정 불가 — ' + why);
  console.error(USAGE);
  process.exit(2);
}
for (let i = 0; i < argv.length; i++){
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  if (FLAGS_BARE.indexOf(a) >= 0) continue;
  if (FLAGS_WITH_VALUE.indexOf(a) >= 0){
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) refuseFlags(a + ' 에 값이 없다');
    i++;
    continue;
  }
  refuseFlags('모르는 플래그: ' + a);
}
const MUTATE = argOf('--mutate', null);
const positional = argv.filter((a, i) => !a.startsWith('--') && FLAGS_WITH_VALUE.indexOf(argv[i - 1]) < 0);
const ROOT = positional[0] || process.cwd();

/* ── 채점판 ──────────────────────────────────────────────────────────────── */
const RULES = ['page-asset-precached', 'page-asset-dynamic', 'page-asset-sw-exempt'];
const failedRules = new Set();
const indetRules = new Set();
let failCount = 0, indetCount = 0, passCount = 0;
function bad(rule, msg){ failedRules.add(rule); failCount++; console.log('  ✗ [' + rule + '] ' + msg); }
function indet(rule, why){ indetRules.add(rule); indetCount++; console.log('  ‽ [' + rule + '] 판정 불가 — ' + why); }
function good(rule, msg){ passCount++; console.log('  ✓ [' + rule + '] ' + msg); }
function resetScore(){ failedRules.clear(); indetRules.clear(); failCount = indetCount = passCount = 0; }

/* ── 읽기(뮤테이션은 원본에 쓰지 않고 이 층에서 갈아 끼운다) ─────────────── */
let OVERRIDE = new Map();
function readText(root, rel){
  const key = rel.split(path.sep).join('/');
  if (OVERRIDE.has(key)) return OVERRIDE.get(key);
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
}
/* 배포되는 페이지 = 저장소 뿌리와 그 하위의 .html 중 개발용 폴더를 뺀 것.
   ★목록을 이 파일에 박지 않는다 — 디렉터리를 걸어서 찾는다(게임이 늘어도 이 도구는 안 늙는다). */
const DEV_DIRS = new Set(['tools', 'functions', 'node_modules', '.git', '_round']);
function listPages(root){
  const out = [];
  const walk = (rel) => {
    let ents;
    try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents){
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()){ if (!DEV_DIRS.has(e.name) && !e.name.startsWith('.')) walk(r); }
      else if (e.name.endsWith('.html')) out.push(r);
    }
  };
  walk('');
  return out.sort();
}
function parsePrecache(text){
  const head = /const\s+PRECACHE\s*=\s*/.exec(text || '');
  if (!head) return { err: 'sw.js 에서 PRECACHE 선언을 찾지 못했다' };
  const open = text.indexOf('[', head.index);
  const re = /\]\s*;/g; re.lastIndex = open;
  const m = re.exec(text);
  if (open < 0 || !m) return { err: 'sw.js 에서 PRECACHE 배열의 끝을 찾지 못했다' };
  const items = [...text.slice(open, m.index).matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] !== undefined ? x[1] : x[2]);
  if (!items.length) return { err: 'PRECACHE 배열이 비어 있다' };
  return { items };
}

/* ── 분류 — sw.js 라우팅을 그대로 적용한다(추측하지 않는다) ──────────────── */
const isCross = u => /^(https?:)?\/\//.test(u);
const isDoc = u => u.endsWith('/') || u.endsWith('.html');
function needsPrecache(u){
  if (!u || isCross(u)) return false;              /* sw.js:124 */
  if (!u.startsWith('/')) return false;            /* 문서 상대 표기는 아래에서 절대화한 뒤에만 본다 */
  if (u.startsWith('/api/')) return false;         /* sw.js:129 */
  if (isDoc(u) || u === '/games.json') return false; /* sw.js:132-136 — 문서·games.json 은 networkFirst */
  return true;                                      /* sw.js:138 cacheFirst */
}
/* ★조각(#)과 질의(?)는 떼고 본다 — 요청되는 것은 그 앞부분이고, 붙인 채로 보면
   '/about/#en' 이 문서로 안 보여 거짓 지적이 난다(실측으로 잡았다). */
function stripHashQuery(u){
  if (!u) return u;
  const h = u.indexOf('#'); if (h >= 0) u = u.slice(0, h);
  const q = u.indexOf('?'); if (q >= 0) u = u.slice(0, q);
  return u;
}
/* 페이지 기준 상대 경로를 절대 경로로 만든다(문서 상대 표기도 요청은 절대로 나간다).
   ★후행 슬래시를 보존한다 — 잃으면 디렉터리 문서가 자산으로 오분류된다(iframe src="block-puzzle/" 실측). */
function absolutize(pageRel, u){
  u = stripHashQuery(u);
  if (!u || isCross(u)) return u;
  if (u.startsWith('/')) return u;
  const dir = pageRel.indexOf('/') >= 0 ? '/' + pageRel.slice(0, pageRel.lastIndexOf('/') + 1) : '/';
  const trailing = u.endsWith('/');
  const parts = (dir + u).split('/');
  const stack = [];
  for (const p of parts){
    if (p === '.' || p === '') { if (stack.length === 0) stack.push(''); continue; }
    if (p === '..') { if (stack.length > 1) stack.pop(); continue; }
    stack.push(p);
  }
  let out = stack.join('/') || '/';
  if (trailing && !out.endsWith('/')) out += '/';
  return out;
}

/* ── 추출 ────────────────────────────────────────────────────────────────── */
/* 정적 참조: 값 안에 보간(${)이 없는 것만 여기 들어온다. 보간이 있으면 '조립 자리' 로 따로 센다. */
const ATTR = /\b(src|href|srcset)\s*=\s*"([^"]*)"/g;
const CALL = /(fetch|importScripts|register)\s*\(\s*(['"])([^'"]*)\2/g;      /* 리터럴 인자만 */
const CALL_NONLIT = /(fetch|importScripts|register)\s*\(\s*(?!['"])([A-Za-z_$][\w$.]*)/g;  /* 변수 인자 */
const ASSIGN_NONLIT = /([A-Za-z_$][\w$]*)\.(src|href)\s*=\s*(?!['"`])([A-Za-z_$][\w$.]*)/g;
/* ★대입 자리는 '무슨 요소인가' 로 갈라야 한다.
   `a.href = url` 은 내려받기·이동(문서)이고, `link.href` · `img.src` 는 하위 자원 요청이다.
   요소를 모르면 통과가 아니라 판정 불가다 — 실측 근거: ladder/index.html:1016-1017 이
   createElement('a') 로 만든 앵커에 blob URL 을 넣는데, 요소를 안 보면 이 게이트가
   멀쩡한 페이지를 영원히 판정 불가로 만든다. */
const NAV_TAGS = new Set(['a', 'area', 'form']);
const SUBRESOURCE_TAGS = new Set(['img', 'script', 'link', 'iframe', 'audio', 'video', 'source', 'track', 'embed']);
const CREATE_EL = /([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\(\s*['"]([a-zA-Z]+)['"]/g;
/* 한 이름이 파일 안에서 여러 요소로 쓰일 수 있다(ladder 는 같은 이름 a 를 span 으로도 앵커로도 쓴다).
   ★그때 '가장 가까운 선언' 같은 어림으로 하나를 고르지 않는다 — 어림이 틀리면 자원 자리를
   문서로 오분류해 조용한 초록이 된다. 대신 ★묶음으로 판정하고 안전한 쪽으로 닫는다:
     · 그 이름의 선언 중 ★하나라도 하위 자원 요소면 → 조립 자리로 센다(판정 불가 쪽).
     · 전부 문서 표면(a·form)이거나 자원을 안 부르는 요소면 → 건너뛴다.
     · 선언을 하나도 못 찾으면 → 조립 자리로 센다(모르면 닫는다). */
function tagsOfVar(text, name){
  const found = [];
  for (const m of text.matchAll(CREATE_EL)) if (m[1] === name) found.push(m[2].toLowerCase());
  return [...new Set(found)];
}

function lineOf(text, index){ return text.slice(0, index).split('\n').length; }

function scanPage(root, pageRel){
  const text = readText(root, pageRel);
  if (text === null) return { err: pageRel + ' 을 읽지 못했다' };
  const statics = [];      /* {url, at} */
  const dynamics = [];     /* {at, what} — 정적으로 못 푸는 자리 */
  let swScript = null;     /* 등록문이 준 경로 */
  let swDynamic = false;

  for (const m of text.matchAll(ATTR)){
    const raw = m[2];
    const at = pageRel + ':' + lineOf(text, m.index);
    if (raw.indexOf('${') >= 0){ dynamics.push({ at, what: m[1] + '="' + raw.trim().slice(0, 40) + '"' }); continue; }
    for (const one of (m[1] === 'srcset' ? raw.split(',').map(s => s.trim().split(/\s+/)[0]) : [raw])){
      if (one) statics.push({ url: absolutize(pageRel, one), at });
    }
  }
  for (const m of text.matchAll(CALL)){
    const at = pageRel + ':' + lineOf(text, m.index);
    if (m[1] === 'register'){ swScript = absolutize(pageRel, m[3]); continue; }
    statics.push({ url: absolutize(pageRel, m[3]), at });
  }
  for (const m of text.matchAll(CALL_NONLIT)){
    const at = pageRel + ':' + lineOf(text, m.index);
    if (m[1] === 'register'){ swDynamic = true; continue; }
    dynamics.push({ at, what: m[1] + '(' + m[2] + ')' });
  }
  for (const m of text.matchAll(ASSIGN_NONLIT)){
    const at = pageRel + ':' + lineOf(text, m.index);
    const tags = tagsOfVar(text, m[1]);
    const risky = !tags.length || tags.some(t => SUBRESOURCE_TAGS.has(t));
    if (!risky) continue;                                        /* 전부 문서 표면(a·form)이거나 자원을 안 부르는 요소 */
    dynamics.push({ at, what: m[1] + '.' + m[2] + ' = ' + m[3] + (tags.length ? ' (<' + tags.join('|') + '>)' : ' (요소 선언을 못 찾았다)') });
  }
  return { statics, dynamics, swScript, swDynamic };
}

/* 데이터 원본에서 경로꼴 값을 전부 전개한다 — ★조립식을 해석하지 않고 데이터를 정본으로 삼는다. */
const ASSETISH = /^\/[^\s'"]*$/;
function expandData(root, rel){
  const raw = readText(root, rel);
  if (raw === null) return { err: rel + ' 을 읽지 못했다' };
  let v;
  try { v = JSON.parse(raw); } catch (e){ return { err: rel + ' 이 JSON 이 아니다: ' + e.message }; }
  const out = [];
  const walk = (node) => {
    if (typeof node === 'string'){ if (ASSETISH.test(node)) out.push(node); return; }
    if (Array.isArray(node)){ node.forEach(walk); return; }
    if (node && typeof node === 'object'){ Object.values(node).forEach(walk); }
  };
  walk(v);
  return { urls: out };
}

/* ── 판정 ────────────────────────────────────────────────────────────────── */
function run(root){
  console.log('페이지 자산 프리캐시 커버리지 게이트 — 대상 ' + root);
  console.log('  · 계약: 페이지가 참조하는 동일 오리진 하위 자원(문서·/api/ 제외)은 모두 PRECACHE 에 있어야 한다');

  const sw = readText(root, 'sw.js');
  if (sw === null){ for (const r of RULES) indet(r, 'sw.js 를 읽지 못했다'); return 2; }
  const P = parsePrecache(sw);
  if (P.err){ for (const r of RULES) indet(r, P.err); return 2; }
  const PRE = new Set(P.items);

  const pages = listPages(root);
  if (!pages.length){ for (const r of RULES) indet(r, '배포 페이지(.html)를 하나도 찾지 못했다'); return 2; }

  const required = new Map();     /* url -> [출처…] */
  const dynamics = [];            /* 정적으로 못 푼 자리 */
  const resolved = [];            /* 데이터로 전개한 자리 */
  const exempt = new Map();       /* url -> 사유 */
  let swExemptUnresolved = [];

  for (const p of pages){
    const s = scanPage(root, p);
    if (s.err){ for (const r of RULES) indet(r, s.err); return 2; }

    /* 서비스워커 면제 — 등록문이 준 경로 하나만. 등록 인자가 조립식이면 면제를 주지 않고 판정 불가. */
    if (s.swDynamic) swExemptUnresolved.push(p);
    if (s.swScript) exempt.set(s.swScript, '서비스워커 등록 대상(' + p + ') — 명세상 service-workers mode "none" 이라 fetch 핸들러에 도달하지 않는다');

    for (const r of s.statics){
      if (!needsPrecache(r.url)) continue;
      if (!required.has(r.url)) required.set(r.url, []);
      required.get(r.url).push(r.at);
    }

    /* ★조립 자리 — 그 페이지가 리터럴로 읽는 데이터 원본을 찾으면 전개하고, 못 찾으면 판정 불가 */
    if (s.dynamics.length){
      /* ★해소 원본은 '그 페이지의 코드가 리터럴로 읽는 데이터' 뿐이다.
         매니페스트는 모든 페이지가 걸고 있으므로 그것을 해소 원본으로 세면 ★어느 페이지의 어떤
         조립 자리든 자동으로 해소된 것이 되어 이 규칙이 공허해진다(첫 실행에서 실제로 그랬다 —
         ladder 의 앵커 대입이 매니페스트로 '해소' 됐다). 아이콘은 아래 ⑤에서 따로 요구 집합에 넣는다. */
      const sources = [];
      for (const r of s.statics){
        if (/\.json$/.test(r.url) && r.at.indexOf(':') >= 0) sources.push(r.url);
      }
      if (!sources.length){
        for (const d of s.dynamics) dynamics.push({ page: p, ...d });
      } else {
        for (const src of [...new Set(sources)]){
          const e = expandData(root, src.replace(/^\//, ''));
          if (e.err){ dynamics.push({ page: p, at: src, what: '데이터 원본을 전개하지 못했다 — ' + e.err }); continue; }
          let n = 0;
          for (const u of e.urls){
            if (!needsPrecache(u)) continue;
            if (!required.has(u)) required.set(u, []);
            required.get(u).push(src + ' (데이터 전개 · ' + p + ' 의 조립 참조)');
            n++;
          }
          resolved.push({ page: p, src, n, sites: s.dynamics.length });
        }
      }
    }
  }

  /* ★사정거리를 먼저 밝힌다 — 이 게이트가 무엇을 몇 개 재는지, 무엇을 못 보는지. */
  console.log('  · 페이지 ' + pages.length + '쪽 · PRECACHE ' + PRE.size + '항목(sw.js 에서 읽었다)');
  for (const r of resolved) console.log('  · 조립 참조 ' + r.sites + '자리(' + r.page + ')를 데이터로 갈음했다 — ' + r.src + ' 의 자산 ' + r.n + '건을 전부 요구한다'
    + ' (★조립식을 해석한 것이 아니다 — 그 데이터가 주는 경로 전부를 요구하는 것으로 갈음했다)');
  for (const [u, why] of exempt) console.log('  · 면제 ' + u + ' — ' + why);
  /* ★통과할 때도 사정거리를 밝힌다 — 무엇을 못 보는지 말하지 않는 초록은 자기 사정거리를 숨긴다. */
  console.log('  · ★이 판정이 못 보는 것: 따옴표 밖에서 조립되는 경로(발견되면 [page-asset-dynamic] 로 올린다)'
    + ' · 배포 호스팅이 끼워 넣는 자원 · 역방향(목록에 있는데 아무 페이지도 안 부르는 항목 — 그것은 형제 게이트의 계약이다)');

  if (swExemptUnresolved.length){
    indet('page-asset-sw-exempt', '서비스워커 등록 인자가 리터럴이 아니라 면제 대상을 확정할 수 없다 — ' + swExemptUnresolved.join(', ')
      + ' (이름 규칙으로 면제를 주면 그 틈으로 진짜 자산이 빠져나간다)');
  } else if (exempt.size){
    good('page-asset-sw-exempt', '면제는 등록문이 준 경로 ' + [...exempt.keys()].join(', ') + ' 뿐이다(이름 규칙 면제 0)');
  } else {
    good('page-asset-sw-exempt', '서비스워커 등록문이 없어 면제 대상도 없다');
  }

  if (dynamics.length){
    indet('page-asset-dynamic', '정적으로 못 푸는 조립 참조 ' + dynamics.length + '자리 — '
      + dynamics.map(d => d.at + ' [' + d.what + ']').join(' · ')
      + ' (데이터 원본을 못 찾았다 · ★모르는 것을 통과로 세지 않는다)');
  } else {
    good('page-asset-dynamic', '조립 참조가 없거나(' + pages.length + '쪽) 전부 데이터 원본으로 전개했다 — 못 푼 자리 0');
  }

  /* ★분모를 단언한다 — 잰 것이 0이면 통과가 아니라 판정 불가다. */
  const targets = [...required.keys()].filter(u => !exempt.has(u));
  if (!targets.length){
    indet('page-asset-precached', '판정 대상 참조가 0건이다 — 잴 것이 없으면 통과가 아니다');
  } else {
    const missing = targets.filter(u => !PRE.has(u));
    if (missing.length){
      bad('page-asset-precached', '페이지가 부르는데 PRECACHE 에 없는 자원 ' + missing.length + '건 — '
        + missing.map(u => JSON.stringify(u) + ' ← ' + required.get(u)[0] + (required.get(u).length > 1 ? ' 외 ' + (required.get(u).length - 1) + '곳' : '')).join(' · ')
        + ' (런타임 cacheFirst 로 담겨 CACHE 가 오를 때까지 구버전이 남는다)');
    } else {
      good('page-asset-precached', '★잰 참조 ' + targets.length + '건(면제 ' + exempt.size + '건 제외) · 전부 PRECACHE 에 있다');
    }
  }

  console.log('결과: 통과 ' + passCount + ' · 미달 ' + failCount + ' · 판정 불가 ' + indetCount);
  if (indetCount) return 2;
  return failCount ? 1 : 0;
}

/* ── 뮤테이션 ────────────────────────────────────────────────────────────── */
/* ★제품 파일에 쓰지 않는다 — 텍스트만 메모리에서 갈아 끼운다(OVERRIDE). */
function pageWithBody(root, rel, inject){
  const t = readText(root, rel);
  if (t === null || t.indexOf('</body>') < 0) return null;
  return t.replace('</body>', inject + '\n</body>');
}
const MUTATIONS = {
  'unlisted-asset': {
    why: '실재하지만 PRECACHE 에 없는 자원을 페이지가 참조하게 한다(축7 이 열리는 바로 그 형태)',
    rules: ['page-asset-precached'], rc: 1,
    apply(root){
      const P = parsePrecache(readText(root, 'sw.js'));
      if (P.err) return null;
      /* ★gemini 축7 이 말한 바로 그 모양을 만든다 — 페이지가 부르는 별도 스크립트인데 목록에 없다.
         ★공허하지 않게 두 가지를 먼저 확인한다: 목록에 없어야 하고, 면제 대상(등록 스크립트)이
         아니어야 한다. (1회차에 이 확인이 없어 뮤테이션이 /sw.js 를 골랐고, 그것은 면제라
         아무것도 안 붉었다 — 표본이 공허했다.) */
      const target = '/stop/game.js';
      if (P.items.indexOf(target) >= 0) return null;
      const home = readText(root, 'index.html');
      if (home === null) return null;
      const reg = /navigator\.serviceWorker\.register\(\s*'([^']*)'/.exec(home);
      if (reg && reg[1] === target) return null;
      const t = pageWithBody(root, 'stop/index.html', '<script src="' + target + '"></script>');
      return t && new Map([['stop/index.html', t]]);
    }
  },
  'listed-asset': {
    why: '이미 PRECACHE 에 있는 자원을 참조하게 한다 — ★오탐 0 을 증명한다',
    rules: [], rc: 0,
    apply(root){
      const P = parsePrecache(readText(root, 'sw.js'));
      if (P.err) return null;
      const pick = P.items.find(u => u.endsWith('.png') || u.endsWith('.webp'));
      if (!pick) return null;
      const t = pageWithBody(root, 'index.html', '<img src="' + pick + '" alt="">');
      return t && new Map([['index.html', t]]);
    }
  },
  'data-asset-missing': {
    why: 'games.json 의 thumb 하나를 PRECACHE 밖 경로로 바꾼다 — ★데이터 전개가 실제로 작동하는지 본다(조립 자리는 그대로)',
    rules: ['page-asset-precached'], rc: 1,
    apply(root){
      const raw = readText(root, 'games.json');
      if (raw === null) return null;
      const v = JSON.parse(raw);
      if (!v.length || !v[0].thumb) return null;
      v[0].thumb = '/no-such-dir/ghost-thumb.webp';
      return new Map([['games.json', JSON.stringify(v, null, 2)]]);
    }
  },
  'dynamic-without-source': {
    why: '데이터 원본이 없는 페이지에 조립 참조를 넣는다 — ★모르는 것을 통과로 세지 않는지 본다',
    rules: [], rc: 2,
    apply(root){
      const t = pageWithBody(root, 'about/index.html', '<script>const u = window.assetPath; const i = new Image(); i.src = u;</script>');
      return t && new Map([['about/index.html', t]]);
    }
  },
  'sw-register-dynamic': {
    why: '등록 인자를 변수로 바꾼다 — ★면제 대상을 확정 못 하면 판정 불가여야 한다(이름 규칙 면제 금지)',
    rules: [], rc: 2,
    apply(root){
      const t = readText(root, 'index.html');
      if (t === null) return null;
      const m = /navigator\.serviceWorker\.register\(\s*'([^']*)'/.exec(t);
      if (!m) return null;
      return new Map([['index.html', t.replace(m[0], "navigator.serviceWorker.register(swPath")]]);
    }
  },
  'drop-precache-entry': {
    why: 'PRECACHE 에서 페이지가 실제로 부르는 항목을 뺀다 — 목록이 줄어드는 방향도 잡는지 본다',
    rules: ['page-asset-precached'], rc: 1,
    apply(root){
      const t = readText(root, 'sw.js');
      const P = parsePrecache(t);
      if (P.err) return null;
      const victim = '/js/hp-stats.js';
      if (P.items.indexOf(victim) < 0) return null;
      const needle = new RegExp("\\n\\s*'" + victim.replace(/[/.]/g, m => '\\' + m) + "',");
      if (!needle.test(t)) return null;
      return new Map([['sw.js', t.replace(needle, '')]]);
    }
  }
};

function runMutation(name){
  const m = MUTATIONS[name];
  if (!m) return { err: '그런 뮤테이션이 없다: ' + name };
  let ov = null;
  try { ov = m.apply(ROOT); } catch (e){ return { err: '주입 중 오류: ' + e.message }; }
  if (!ov || !ov.size) return { err: '주입 실패(앵커 노후화): ' + name };
  resetScore();
  const lines = [];
  const silent = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  let rc;
  OVERRIDE = ov;
  try { rc = run(ROOT); } finally { console.log = silent; OVERRIDE = new Map(); }
  const seen = [...failedRules].sort();
  const want = m.rules.slice().sort();
  const miss = want.filter(r => seen.indexOf(r) < 0);
  const noise = seen.filter(r => want.indexOf(r) < 0);
  return { ok: rc === m.rc && !miss.length && !noise.length, rc, wantRc: m.rc, want, seen, miss, noise, why: m.why, indet: [...indetRules].sort(), lines };
}

/* ── 진입 ────────────────────────────────────────────────────────────────── */
if (has('--selftest')){
  console.log('자기시험 — 뮤테이션마다 기대 rc 가 나오고 지목 규칙만 붉는지 본다(무임승차 0 이 합격선)');
  let bads = 0, setupFail = 0;
  const rows = [];
  for (const name of Object.keys(MUTATIONS)){
    const r = runMutation(name);
    if (r.err){ setupFail++; rows.push({ name, ok: false, why: r.err }); continue; }
    if (!r.ok) bads++;
    rows.push({ name, ...r });
  }
  for (const r of rows){
    console.log('  ' + (r.ok ? 'PASS ' : '★FAIL') + ' ' + r.name.padEnd(22)
      + ' rc=' + String(r.rc) + '(기대 ' + String(r.wantRc) + ')'
      + ' · 잡아야 할 규칙 ' + (r.want && r.want.length ? r.want.join(',') : '없음(오탐 0·판정 불가 표본)')
      + ' · 실제 ' + (r.seen && r.seen.length ? r.seen.join(',') : '없음')
      + (r.indet && r.indet.length ? ' · 판정 불가 [' + r.indet.join(',') + ']' : '')
      + (r.miss && r.miss.length ? '  ← 안 잡힌 규칙 ' + r.miss.join(',') : '')
      + (r.noise && r.noise.length ? '  ← 무임승차 ' + r.noise.join(',') : ''));
    if (r.why) console.log('        ← ' + r.why);
  }
  console.log('자기시험 결과: 항목 ' + rows.length + ' · 어긋남 ' + bads + ' · 주입 실패 ' + setupFail);
  process.exit((bads || setupFail) ? 1 : 0);
}
if (MUTATE){
  const r = runMutation(MUTATE);
  if (r.err){ console.error(r.err); process.exit(2); }
  for (const l of r.lines) console.log(l);
  console.log('  검출력 판정: rc=' + r.rc + '(기대 ' + r.wantRc + ')'
    + ' · 지정 규칙 [' + (r.want.join(',') || '없음') + '] · 실제 미달 규칙 [' + (r.seen.join(',') || '없음') + ']'
    + (r.miss.length ? ' ← 안 잡힘 ' + r.miss.join(',') : '')
    + (r.noise.length ? ' ← 무임승차 ' + r.noise.join(',') : ''));
  process.exit(r.ok ? 0 : 3);
}
process.exit(run(ROOT));
