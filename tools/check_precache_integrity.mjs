/* 프리캐시 실재성 게이트 — 2026-09-03 · T0903-precache-integrity
 *
 * 왜 만들었나 — 목록 한 줄이 오프라인 능력 전체를 끈다
 *   `sw.js` 의 install 은 `cache.addAll(PRECACHE)` 를 부른다. Cache API 는 목록 중 **단 하나라도**
 *   실패하면 promise 를 통째로 reject 한다. 그러면 새 service worker 의 install 이 실패하고,
 *   ★기존 worker 와 옛 cache 가 그대로 남는다 — 화면에는 아무 표시도 안 난다. 배포는 초록이고
 *   사이트는 조용히 오프라인 능력을 잃는다.
 *
 *   추측이 아니다. 두 갈래 근거가 있다.
 *   ① 명세(W3C Service Workers · Cache addAll) — "If response's type is "error", or response's status
 *      is not an ok status or is 206, reject responsePromise with a TypeError."
 *   ② 이 저장소의 실제 사고 — 2026-08-26 에 파일 형태 항목이 Cloudflare Pages 에서 308 을 받아
 *      addAll 이 통째로 reject 됐다. sw.js 는 그 뒤로 주석에 그 경고를 적어 두었다.
 *   ③ reviewer-codex 가 2026-09-03 에 fixture 로 재현했다 — 저장소에 없는 `/missing-precache.webp` 를
 *      넣자 `INSTALL=REJECTED · ERROR=non-ok response for /missing-precache.webp`.
 *
 *   규약은 sw.js 주석에 있었고, 그것을 지키는 장치가 없었다 — 이 도구가 그 장치다.
 *
 * 무엇을 재는가 (계약 한 줄)
 *   **PRECACHE 에 실린 모든 항목은 배포 산출물에서 실제로 서빙 가능한 자원에 대응해야 한다.**
 *
 * 규칙 (지적마다 [규칙id] 가 붙는다 — 뮤테이션이 이 id 로 귀속을 대조한다)
 *   [precache-url-shape]      항목이 '/' 로 시작하는 절대 경로다(질의·조각·'..'·'//' 없음)
 *   [precache-dir-form]       디렉터리 자원을 **파일 형태**(…/index.html)로 적지 않았다
 *   [precache-target-exists]  항목이 저장소의 실제 파일에 대응한다(디렉터리 형태는 그 안의 index.html)
 *   [precache-duplicate]      같은 URL 이 두 번 이상 실려 있지 않다
 *
 * ★설계 원칙 1 — 목록도 개수도 하드코딩하지 않는다
 *   PRECACHE 는 **sw.js 에서만** 읽는다. 이 파일에 경로를 적어 두면 그 순간 이 도구는
 *   sw.js 가 아니라 자기 자신을 검사하게 된다(자기참조는 규칙 소실을 영원히 못 잡는다).
 *
 * ★설계 원칙 2 — 못 읽으면 통과로 세지 않는다
 *   PRECACHE 배열을 못 뽑거나, 배열 안에 문자열이 아닌 것(식별자·계산식)이 섞여 있으면
 *   '위반 0' 이 아니라 **판정 불가(rc=2)** 다. 못 읽은 입력을 통과로 세는 것이 게이트의 최악이다.
 *   (`tools/check_home_sync.mjs` · `tools/check_precache_cache.mjs` 와 같은 계약)
 *
 * ★설계 원칙 3 — 대소문자를 정확히 본다
 *   Windows 의 파일시스템은 대소문자를 무시한다. `fs.existsSync('/About/index.html')` 는
 *   about/ 만 있어도 참을 돌려준다. 그러나 배포처(Cloudflare Pages)는 대소문자를 구별하므로
 *   그 항목은 404 → addAll 통째 reject 다. 그래서 존재 검사를 existsSync 로 하지 않고
 *   **경로를 한 마디씩 readdir 로 훑어 이름이 바이트 그대로 있는지** 본다.
 *
 * ★중복 항목을 왜 미달로 보는가 (근거)
 *   같은 URL 이 두 번 실리면 addAll 이 성공하지 못한다. 명세의 Batch Cache Operations 는
 *   "If the result of running Query Cache with operation's request, operation's options, and
 *   addedItems is not empty, throw an "InvalidStateError" DOMException." 라고 적는다 —
 *   같은 batch 안에서 이미 담은 항목과 겹치면 던진다는 뜻이다. MDN 도 같은 것을 말한다:
 *   "addAll() … will fail if a resulting put() operation would overwrite a previous cache entry
 *   stored by the same addAll() method." 즉 중복은 취향 문제가 아니라 **없는 파일과 같은 결과**
 *   (프리캐시 통째 실패)를 낸다. 그래서 미달이다.
 *
 * ★이 도구가 못 보는 것(정직한 한계)
 *   · **엣지의 실제 거동을 못 본다.** 이것은 저장소 트리를 보는 정적 검사다. Cloudflare Pages 가
 *     그 주소에 실제로 무엇을 돌려주는지(308 · 404 · 200)는 배포 실측으로만 확인된다.
 *   · ★**호스팅이 없는 URL 에 200 fallback 을 주면 발현 형태가 달라진다** — 'install 실패' 가 아니라
 *     '잘못된 콘텐츠를 프리캐시' 가 된다. 이 정적 게이트는 그 둘을 구별하지 못한다
 *     (reviewer-codex 가 못 잰 것을 그대로 물려받는다).
 *   · **파일 형태 항목이 308 을 받는다는 것 자체는 이 저장소의 실측**(2026-08-26)과 sw.js 주석이
 *     근거다. 현행 명세 본문에서 '리다이렉트된 응답은 put 할 수 없다' 는 조문은 찾지 못했다 —
 *     찾지 못했다고 적는다(근거는 명세가 아니라 실측이다).
 *   · **작업 트리를 잰다.** 커밋된 이력이나 배포된 산출물이 아니라 지금 디스크에 있는 파일을 본다.
 *     구간 판정(무엇이 언제 바뀌었는가)은 형제 도구 `tools/check_precache_cache.mjs` 의 계약이다.
 *   · **런타임 cacheFirst 하위 자산은 보지 않는다**(축7). `/stop/` 이 초록이어도 `stop/game.js` 는
 *     PRECACHE 항목이 아니다 — 이 게이트의 계약이 아니다.
 *   · 자원의 **내용**은 보지 않는다. 빈 파일도 실재하면 통과한다.
 *
 * 사용법:
 *   node tools/check_precache_integrity.mjs [저장소 경로]
 *   node tools/check_precache_integrity.mjs [저장소 경로] --mutate <이름>   (검출력 확인 · 아래 MUTATIONS)
 *   node tools/check_precache_integrity.mjs [저장소 경로] --selftest        (뮤테이션 전량 자동 확인)
 *   ★모르는 플래그·값 없는 플래그는 조용히 무시하지 않는다 — rc=2 로 거부하고 사용법을 찍는다.
 *     (형제 도구 `tools/check_precache_cache.mjs` 와 같은 규약이다. 베껴서가 아니라 같은 이유에서다 —
 *      오타 하나가 초록을 만드는 것은 게이트가 아니고, 사용법 출력에 rc=0 을 쓰면 사용법을 판정으로
 *      오독하는 사고가 난다. 이 저장소는 그 사고를 이미 한 번 겪었다.)
 *
 * 종료코드: 0 미달 0 · 1 미달 발견 · 2 판정 불가(모르는 플래그·값 누락·뮤테이션 주입 실패 포함)
 *           ★--mutate 일 때는 뮤테이션마다 기대 rc 가 다르다(오탐 0 을 증명하는 뮤테이션은 rc=0 이 정답).
 *           그래서 0 기대대로 · 3 기대와 어긋남 · 2 주입 실패 로 돌려준다.
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
  '  node tools/check_precache_integrity.mjs [저장소 경로]',
  '  node tools/check_precache_integrity.mjs [저장소 경로] --mutate <이름>',
  '  node tools/check_precache_integrity.mjs [저장소 경로] --selftest',
  '종료코드: 0 미달 0 · 1 미달 발견 · 2 판정 불가(모르는 플래그·값 누락 포함)'
].join('\n');
function refuseFlags(why){
  console.error('  ‽ [precache-target-exists] 판정 불가 — ' + why);
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
    i++;                                  /* 값 자리는 플래그로 읽지 않는다 */
    continue;
  }
  refuseFlags('모르는 플래그: ' + a);
}

const MUTATE = argOf('--mutate', null);
const positional = argv.filter((a, i) => !a.startsWith('--') && FLAGS_WITH_VALUE.indexOf(argv[i - 1]) < 0);
const ROOT = positional[0] || process.cwd();

/* ── 채점판 ──────────────────────────────────────────────────────────────── */
const RULES = ['precache-url-shape', 'precache-dir-form', 'precache-target-exists', 'precache-duplicate'];
const failedRules = new Set();
const indetRules = new Set();
let failCount = 0, indetCount = 0, passCount = 0;
function bad(rule, msg){ failedRules.add(rule); failCount++; console.log('  ✗ [' + rule + '] ' + msg); }
function indet(rule, why){ indetRules.add(rule); indetCount++; console.log('  ‽ [' + rule + '] 판정 불가 — ' + why); }
function good(rule, msg){ passCount++; console.log('  ✓ [' + rule + '] ' + msg); }
function resetScore(){ failedRules.clear(); indetRules.clear(); failCount = indetCount = passCount = 0; }

/* ── 읽기 ────────────────────────────────────────────────────────────────── */
function readSw(root){
  try { return { text: fs.readFileSync(path.join(root, 'sw.js'), 'utf8') }; }
  catch (e){ return { err: 'sw.js 를 읽지 못했다: ' + e.message }; }
}

/* PRECACHE 리터럴이 차지하는 구간. 끝을 '];' 라는 붙어 있는 두 글자로 찾으면 사이에 공백·줄바꿈이
   하나만 들어와도 못 찾고 '판정 불가' 가 된다 — 공백을 허용하는 모양으로 찾는다
   (`tools/check_home_sync.mjs` 가 뮤테이션이 배열을 예쁘게 다시 쓰자 실제로 그 일을 겪었다). */
function precacheSpan(text){
  const head = /const\s+PRECACHE\s*=\s*/.exec(text);
  if (!head) return null;
  const open = text.indexOf('[', head.index);
  if (open < 0) return null;
  const re = /\]\s*;/g;
  re.lastIndex = open;
  const m = re.exec(text);
  if (!m) return null;
  return { open, close: m.index };            /* text[open] === '[' · text[close] === ']' */
}

/* 배열 리터럴에서 항목을 뽑는다.
   ★문자열만 세고 나머지를 조용히 버리면, 배열에 식별자·계산식이 들어와도 '위반 0' 이 된다.
   그래서 문자열과 주석을 지우고 **남은 글자**를 본다 — 쉼표·공백 말고 다른 것이 남으면 판정 불가다. */
function parsePrecache(text){
  const span = precacheSpan(text);
  if (span === null) return { err: 'sw.js 에서 PRECACHE 선언 또는 배열의 끝을 찾지 못했다' };
  const lit = text.slice(span.open + 1, span.close);
  const items = [];
  let rest = '';
  let i = 0;
  while (i < lit.length){
    const c = lit[i];
    if (c === '\'' || c === '"' || c === '`'){
      const end = lit.indexOf(c, i + 1);
      if (end < 0) return { err: 'PRECACHE 배열 안의 문자열이 닫히지 않았다(' + (i + 1) + '번째 글자 부근)' };
      if (c === '`' && lit.slice(i, end).indexOf('${') >= 0) return { err: 'PRECACHE 항목에 템플릿 보간이 있다 — 값을 정적으로 읽을 수 없다' };
      items.push(lit.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (c === '/' && lit[i + 1] === '/'){ const nl = lit.indexOf('\n', i); i = nl < 0 ? lit.length : nl; continue; }
    if (c === '/' && lit[i + 1] === '*'){ const e = lit.indexOf('*/', i); if (e < 0) return { err: 'PRECACHE 배열 안의 주석이 닫히지 않았다' }; i = e + 2; continue; }
    rest += c;
    i++;
  }
  const leftover = rest.replace(/[\s,]/g, '');
  if (leftover.length) return { err: 'PRECACHE 배열에 문자열이 아닌 것이 섞여 있다 — ' + JSON.stringify(leftover.slice(0, 40)) };
  if (!items.length) return { err: 'PRECACHE 배열이 비어 있다' };
  return { items };
}

/* ── 매핑 ────────────────────────────────────────────────────────────────── */
/* URL 항목 → 저장소 상대경로. 디렉터리 형태는 그 안의 index.html 이다(루트 '/' 는 index.html).
   ★이 매핑이 곧 '서빙 가능' 의 정의다 — sw.js 주석이 말하는 규약(디렉터리 형태만 싣는다)과 짝을 이룬다. */
function targetOf(url){
  const p = url.slice(1);                      /* 선두 '/' 는 shape 규칙이 이미 보증한다 */
  return p === '' || p.endsWith('/') ? p + 'index.html' : p;
}

/* 경로를 한 마디씩 readdir 로 훑어 **이름이 바이트 그대로** 있는지 본다(설계 원칙 3).
   돌려주는 것: { ok:true } · { ok:false, at:'<어디까지 갔나>', why:'...' } */
const dirCache = new Map();
function listDir(abs){
  if (!dirCache.has(abs)){
    let names = null;
    try { names = fs.readdirSync(abs); } catch { names = null; }
    dirCache.set(abs, names);
  }
  return dirCache.get(abs);
}
function resolveExact(root, rel){
  const parts = rel.split('/').filter(Boolean);
  let abs = root;
  for (let i = 0; i < parts.length; i++){
    const names = listDir(abs);
    if (names === null) return { ok: false, at: parts.slice(0, i).join('/') || '(저장소 뿌리)', why: '그 자리가 디렉터리가 아니거나 읽을 수 없다' };
    if (names.indexOf(parts[i]) < 0){
      const ci = names.filter(n => n.toLowerCase() === parts[i].toLowerCase());
      const hint = ci.length ? ' (대소문자만 다른 것이 있다: ' + ci.join(', ') + ')' : '';
      return { ok: false, at: parts.slice(0, i + 1).join('/'), why: '그런 이름이 없다' + hint };
    }
    abs = path.join(abs, parts[i]);
  }
  let st = null;
  try { st = fs.statSync(abs); } catch { st = null; }
  if (st === null) return { ok: false, at: rel, why: '상태를 읽을 수 없다' };
  if (!st.isFile()) return { ok: false, at: rel, why: '파일이 아니다(디렉터리다)' };
  return { ok: true };
}

/* ── 판정 ────────────────────────────────────────────────────────────────── */
function run(root, swTextOverride){
  console.log('프리캐시 실재성 게이트 — 대상 ' + root);
  console.log('  · 이 게이트는 ★작업 트리의 파일을 잰다(배포 엣지의 실제 응답은 보지 않는다)');
  dirCache.clear();

  let text = swTextOverride;
  if (text === undefined){
    const r = readSw(root);
    if (r.err){ for (const rule of RULES) indet(rule, r.err); return 2; }
    text = r.text;
  }
  const P = parsePrecache(text);
  if (P.err){ for (const rule of RULES) indet(rule, P.err); return 2; }
  const items = P.items;
  console.log('  · PRECACHE ' + items.length + '개 항목(sw.js 에서 읽었다 · 이 도구에 목록·개수를 박지 않는다)');

  /* ① 형식 — 여기서 걸린 항목은 아래 규칙의 대상에서 뺀다.
     ★왜 빼는가: 형식이 깨진 항목을 매핑하면 내 매핑이 엉뚱한 파일을 찾아 '없다' 고 또 운다.
     한 결함이 두 규칙을 붉히면 귀속이 흐려진다 — 지적은 원인을 대는 규칙 하나만 해야 한다.
     ★왜 이 규칙이 따로 필요한가: 선두 '/' 가 없는 'about/' 은 내 매핑이 그대로 'about/index.html'
     로 풀어 **실재 검사를 통과해 버린다**. 형식 규칙이 없으면 그 항목은 아무 데도 안 걸린다. */
  const shapeBad = [];
  const clean = [];
  for (const u of items){
    const why = [];
    if (typeof u !== 'string' || u === '') why.push('비어 있다');
    else {
      if (!u.startsWith('/')) why.push("'/' 로 시작하지 않는다(스코프 상대 경로는 배포 위치에 따라 다른 것을 가리킨다)");
      if (u.indexOf('?') >= 0) why.push('질의 문자열이 있다');
      if (u.indexOf('#') >= 0) why.push('조각(#)이 있다');
      if (u.indexOf('//') >= 0) why.push("'//' 가 있다");
      if (u.split('/').indexOf('..') >= 0) why.push("'..' 마디가 있다");
    }
    if (why.length) shapeBad.push({ u, why: why.join(' · ') });
    else clean.push(u);
  }
  if (shapeBad.length) bad('precache-url-shape', '절대 경로가 아닌 항목 ' + shapeBad.length + '건 — ' + shapeBad.map(x => JSON.stringify(x.u) + ' (' + x.why + ')').join(' · '));
  else good('precache-url-shape', items.length + '개 항목이 모두 절대 경로다(질의·조각·".."·"//" 0건)');

  /* ② 중복 */
  const seen = new Map();
  for (const u of items) seen.set(u, (seen.get(u) || 0) + 1);
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  if (dups.length) bad('precache-duplicate', '같은 URL 이 두 번 이상 실려 있다 — ' + dups.map(([u, n]) => JSON.stringify(u) + ' ×' + n).join(' · ')
    + ' (addAll 은 같은 batch 안의 중복을 InvalidStateError 로 거절한다 — 없는 파일과 같은 결과다)');
  else good('precache-duplicate', '중복 항목 0 — ' + items.length + '개가 모두 서로 다른 URL 이다');

  /* ③ 파일 형태로 적힌 디렉터리 항목 — Cloudflare Pages 가 308 을 돌려주어 addAll 이 통째로 깨진다.
     ★이 항목은 파일이 실제로 있으므로 실재 검사로는 절대 안 잡힌다. 규칙이 따로 있어야 하는 이유다. */
  const fileForm = clean.filter(u => u === '/index.html' || u.endsWith('/index.html'));
  if (fileForm.length) bad('precache-dir-form', '디렉터리 자원이 파일 형태로 실려 있다 ' + fileForm.length + '건 — '
    + fileForm.map(u => JSON.stringify(u) + ' → ' + JSON.stringify(u.slice(0, u.length - 'index.html'.length)) + ' 로 적어라').join(' · ')
    + ' (배포처가 308 을 돌려주어 cache.addAll 이 통째로 reject 된다 · 2026-08-26 실측 · sw.js 주석)');
  else good('precache-dir-form', '파일 형태로 적힌 디렉터리 항목 0 — 디렉터리 자원은 모두 "…/" 꼴이다');

  /* ④ 실재성 */
  const missing = [];
  let checked = 0;
  for (const u of clean){
    const rel = targetOf(u);
    const r = resolveExact(root, rel);
    checked++;
    if (!r.ok) missing.push({ u, rel, at: r.at, why: r.why });
  }
  if (missing.length) bad('precache-target-exists', '대응 자원을 찾지 못한 항목 ' + missing.length + '건 — '
    + missing.map(m => JSON.stringify(m.u) + ' → ' + m.rel + ' (' + m.at + ' 에서 막혔다: ' + m.why + ')').join(' · '));
  else good('precache-target-exists', checked + '개 항목이 모두 저장소의 실제 파일에 대응한다(대소문자까지 정확히 대조)');

  console.log('결과: 통과 ' + passCount + ' · 미달 ' + failCount + ' · 판정 불가 ' + indetCount);
  if (indetCount) return 2;
  return failCount ? 1 : 0;
}

/* ── 뮤테이션(검출력 확인) ───────────────────────────────────────────────── */
/* ★제품 파일에 쓰지 않는다. sw.js **텍스트**만 메모리에서 고쳐 같은 판정기에 먹인다 —
   실재 검사는 진짜 저장소 트리를 읽어야 뜻이 있으므로 트리는 그대로 두고 목록만 바꾼다.
   (배포본에 검증 훅을 남기지 않는 것과 같은 태도다 — 조작은 하네스가 메모리에서 한다.)
   apply(text, root) 는 고친 텍스트를 돌려주거나, 앵커가 늙었으면 null 을 돌려준다(주입 실패). */
function insertEntries(text, entries){
  const span = precacheSpan(text);
  if (span === null) return null;
  const inject = entries.map(e => "\n  '" + e + "',").join('');
  return text.slice(0, span.open + 1) + inject + text.slice(span.open + 1);
}
function firstDirEntry(items){ return items.find(u => u.endsWith('/') && u !== '/') || null; }

const MUTATIONS = {
  'add-missing-target': {
    why: '저장소에 없는 경로를 PRECACHE 에 넣는다(codex 가 fixture 로 INSTALL=REJECTED 를 실측한 그 형태)',
    rules: ['precache-target-exists'], rc: 1,
    apply(text, root){
      const name = 'missing-precache.webp';
      if (fs.existsSync(path.join(root, name))) return null;      /* 정말 없는지 먼저 확인한다 */
      return insertEntries(text, ['/' + name]);
    }
  },
  'add-existing-target': {
    why: '실재하는 자원을 넣는다 — ★오탐 0 을 증명한다(아무 지적도 나오면 안 된다)',
    rules: [], rc: 0,
    apply(text, root){
      const P = parsePrecache(text);
      if (P.err) return null;
      const have = new Set(P.items);
      /* 목록에 아직 없는 실재 파일을 **저장소에서 찾아서** 쓴다 — 경로를 이 파일에 박지 않는다. */
      let names = null;
      try { names = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
      const pick = names.filter(d => d.isFile() && !d.name.startsWith('.') && !have.has('/' + d.name)).map(d => d.name).sort()[0];
      if (!pick) return null;
      return insertEntries(text, ['/' + pick]);
    }
  },
  'add-file-form-dir': {
    why: '이미 실려 있는 디렉터리 항목을 **파일 형태**(…/index.html)로 하나 더 넣는다 — 파일은 실재하므로 실재 검사로는 못 잡는다',
    rules: ['precache-dir-form'], rc: 1,
    apply(text, root){
      const P = parsePrecache(text);
      if (P.err) return null;
      const dir = firstDirEntry(P.items);
      if (dir === null) return null;
      /* ★표본이 공허하지 않게: 그 index.html 이 실제로 있어야 한다(없으면 실재 규칙이 대신 울어 귀속이 흐려진다) */
      if (!resolveExact(root, targetOf(dir)).ok) return null;
      return insertEntries(text, [dir + 'index.html']);
    }
  },
  'duplicate-entry': {
    why: '이미 있는 항목을 한 번 더 넣는다(addAll 은 같은 batch 안의 중복을 InvalidStateError 로 거절한다)',
    rules: ['precache-duplicate'], rc: 1,
    apply(text){
      const P = parsePrecache(text);
      if (P.err || !P.items.length) return null;
      return insertEntries(text, [P.items[0]]);
    }
  },
  'relative-entry': {
    why: '선두 "/" 없는 항목을 넣는다 — ★형식 규칙이 없으면 내 매핑이 그대로 풀어 실재 검사를 통과시킨다',
    rules: ['precache-url-shape'], rc: 1,
    apply(text, root){
      const P = parsePrecache(text);
      if (P.err) return null;
      const dir = firstDirEntry(P.items);
      if (dir === null) return null;
      /* ★공허하지 않음의 증명: 대응 파일은 실재한다 — 그러니 붉는 이유는 형식뿐이다 */
      if (!resolveExact(root, targetOf(dir)).ok) return null;
      return insertEntries(text, [dir.slice(1)]);
    }
  },
  'case-mismatch': {
    why: '실려 있는 항목의 대소문자만 바꾼다 — Windows 의 existsSync 로는 통과해 버리는 자리다(배포처는 404 를 준다)',
    rules: ['precache-target-exists'], rc: 1,
    apply(text, root){
      const P = parsePrecache(text);
      if (P.err) return null;
      const dir = P.items.find(u => u.endsWith('/') && u !== '/' && /[a-z]/.test(u));
      if (dir === null || dir === undefined) return null;
      if (!resolveExact(root, targetOf(dir)).ok) return null;     /* 바꾸기 전에는 실재해야 한다 */
      const upper = '/' + dir.slice(1, 2).toUpperCase() + dir.slice(2);
      if (upper === dir) return null;
      const span = precacheSpan(text);
      if (span === null) return null;
      const lit = text.slice(span.open, span.close + 1);
      const needle = "'" + dir + "'";
      if (lit.split(needle).length !== 2) return null;             /* 앵커 유일성 — 두 번 나오면 손대지 않는다 */
      return text.slice(0, span.open) + lit.replace(needle, "'" + upper + "'") + text.slice(span.close + 1);
    }
  },
  'unreadable-array': {
    why: 'PRECACHE 배열에 문자열이 아닌 것(식별자)을 넣는다 — ★못 읽은 것을 통과로 세지 않는지 본다',
    rules: [], rc: 2,
    apply(text){
      const span = precacheSpan(text);
      if (span === null) return null;
      return text.slice(0, span.open + 1) + '\n  EXTRA_ENTRY,' + text.slice(span.open + 1);
    }
  },
  'no-declaration': {
    why: 'PRECACHE 선언 이름을 바꾼다 — 배열 자체를 못 찾는 경우도 통과가 아니라 판정 불가여야 한다',
    rules: [], rc: 2,
    apply(text){
      if (text.indexOf('const PRECACHE') < 0) return null;
      return text.replace('const PRECACHE', 'const PRECACHE_RENAMED');
    }
  }
};

/* 뮤테이션 한 건을 돌려 판정과 귀속을 본다. */
function runMutation(name){
  const m = MUTATIONS[name];
  if (!m) return { err: '그런 뮤테이션이 없다: ' + name };
  const base = readSw(ROOT);
  if (base.err) return { err: base.err };
  let text = null;
  try { text = m.apply(base.text, ROOT); } catch (e){ return { err: '주입 중 오류: ' + e.message }; }
  if (text === null || text === undefined || text === base.text) return { err: '주입 실패(앵커 노후화): ' + name };
  resetScore();
  /* 판정문을 버리지 않고 모아 둔다 — 한 건만 돌려 볼 때는 ★지적문 자체가 보여야 한다
     (이 게이트의 계약 중 하나가 '어느 항목이 어느 경로를 못 찾았는지 이름을 댄다' 이므로,
      그것을 눈으로 확인할 길이 없으면 검출력만 보고 문구는 못 보는 도구가 된다). */
  const lines = [];
  const silent = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  let rc;
  try { rc = run(ROOT, text); } finally { console.log = silent; }
  const seenRules = [...failedRules].sort();
  const want = m.rules.slice().sort();
  const miss = want.filter(r => seenRules.indexOf(r) < 0);
  const noise = seenRules.filter(r => want.indexOf(r) < 0);
  const ok = rc === m.rc && !miss.length && !noise.length;
  return { ok, rc, want, seen: seenRules, miss, noise, why: m.why, wantRc: m.rc, indet: [...indetRules].sort(), lines };
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
    console.log('  ' + (r.ok ? 'PASS ' : '★FAIL') + ' ' + r.name.padEnd(20)
      + ' rc=' + String(r.rc) + '(기대 ' + String(r.wantRc) + ')'
      + ' · 잡아야 할 규칙 ' + (r.want && r.want.length ? r.want.join(',') : '없음(오탐 0·판정 불가 표본)')
      + ' · 실제 ' + (r.seen && r.seen.length ? r.seen.join(',') : '없음')
      + (r.indet && r.indet.length ? ' · 판정 불가 ' + r.indet.length + '건' : '')
      + (r.miss && r.miss.length ? '  ← 안 잡힌 규칙 ' + r.miss.join(',') : '')
      + (r.noise && r.noise.length ? '  ← 무임승차(나오면 안 되는 지적) ' + r.noise.join(',') : ''));
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
