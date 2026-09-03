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
 *   [precache-url-shape]      항목이 '/' 로 시작하는 절대 경로다(질의·조각·'..'·'//'·공백·제어문자·백슬래시 없음)
 *   [precache-dir-form]       디렉터리 자원의 표기가 성하다(파일 형태 …/index.html 도, 후행 슬래시 누락도 308 이다)
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
 *   · ★**유니코드 정규화(NFC/NFD)를 하지 않는다 — 하지 않기로 정한 것이다**(R2 축3·축6).
 *     근거 셋: ①이 저장소의 경로와 PRECACHE 항목은 실측으로 **전부 ASCII 다**(비-ASCII 0/45 · 추적 파일 0건).
 *     ②존재 검사가 이미 **바이트 그대로** 대조하므로, 정규화가 다른 이름은 '없다' 로 **닫히는 쪽**으로 틀린다.
 *     ③정규화를 넣으면 오히려 **느슨해진다**(NFD 로 적힌 항목을 NFC 파일로 통과시킨다) — 배포처는
 *     바이트로 판정하므로 그것은 거짓 초록이다. 비-ASCII 경로를 쓰기 시작하면 이 결정을 다시 봐야 한다.
 *   · ★**심볼릭 링크를 따로 다루지 않는다 — 하지 않기로 정한 것이다**(R2 축8 · gemini 도 미재현 라벨).
 *     근거: ①이 저장소에 심볼릭 링크는 **0건**이다(`git ls-files -s` 의 120000 모드 0건 실측).
 *     ②표본을 만들 수 없으면 그 분기는 **검사할 수 없는 코드**가 되고, 검사되지 않는 방어는
 *     다음 사람이 조용히 되돌려도 아무도 모른다. 재현되지 않은 것을 근거로 코드를 늘리지 않는다.
 *     ③지금은 `statSync` 가 링크를 따라가므로 **링크가 가리키는 실물이 있으면 통과**한다 —
 *     배포처가 링크를 어떻게 다루는지 확인되지 않았으니, 링크가 생기면 이 줄을 먼저 다시 읽어라.
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

/* ★배열의 끝은 정규식으로 찾지 않는다 — 괄호 짝을 맞춘다(R2 · 축1·축5는 같은 뿌리다).
   왜: 원문에서 /\]\s*;/ 로 끝을 찾으면
     ①배열 안 주석에 '];' 가 있으면 거기서 잘린다 — master 재현에서 45항목 중 ★36개만 읽고
       없는 항목이 검사 대상 밖으로 빠진 채 rc=0 이 났다(거짓 통과).
     ②세미콜론을 생략한 정상 자바스크립트(ASI)를 '끝을 못 찾았다' 며 거부한다(거짓 판정 불가).
   문자열·주석을 건너뛰며 깊이를 세면 ★세미콜론과 무관하게 끝이 정해지고 둘 다 닫힌다. */
function precacheSpan(text){
  const head = /const\s+PRECACHE\s*=\s*/.exec(text);
  if (!head) return null;
  const open = text.indexOf('[', head.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++){
    const c = text[i];
    if (c === '/' && text[i + 1] === '/'){ const nl = text.indexOf('\n', i); if (nl < 0) return null; i = nl; continue; }
    if (c === '/' && text[i + 1] === '*'){ const e = text.indexOf('*/', i + 2); if (e < 0) return null; i = e + 1; continue; }
    if (c === '\'' || c === '"' || c === '`'){
      const e = endOfString(text, i);
      if (e < 0) return null;
      i = e;
      continue;
    }
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')'){
      depth--;
      if (depth === 0) return c === ']' ? { open, close: i } : null;   /* 짝이 어긋나면 판정 불가 */
      if (depth < 0) return null;
    }
  }
  return null;                                  /* 끝을 못 찾았다 → 판정 불가(통과 아님) */
}
/* 따옴표 문자열의 닫는 위치. ★이스케이프를 센다(\' 로 끝난 것처럼 보이는 자리에서 끊기지 않게).
   줄바꿈으로 닫히지 않는 따옴표는 자바스크립트 문법 오류이므로 -1 을 돌려 판정 불가로 보낸다. */
function endOfString(text, start){
  const q = text[start];
  for (let i = start + 1; i < text.length; i++){
    const c = text[i];
    if (c === '\\'){ i++; continue; }
    if (c === q) return i;
    if (c === '\n' && q !== '`') return -1;
  }
  return -1;
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
      const end = endOfString(lit, i);          /* ★종결 탐색과 같은 규칙을 쓴다(이스케이프 포함) */
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

/* ★파스 온전성의 독립 확인 — 분모는 분자와 ★다른 출처에서 와야 방어가 된다.
   R2 가 가르쳐 준 것: 파스가 잘리면 '잰 건수 36 = 전체 36' 처럼 ★자기일관되게 거짓을 말한다.
   분자도 분모도 같은 망가진 파스에서 나오기 때문이다. 그래서 파스 결과와 무관한 방법으로
   한 번 더 센다 — 파일 전체를 ★줄 단위로 훑어 '항목처럼 생긴 줄'(따옴표로 감싼 / 로 시작하는
   값이 그 줄의 전부)을 센다. 이 수가 파스한 항목 수보다 ★많으면 파스가 무언가를 빠뜨린 것이다.
   (적을 때는 배열을 한 줄에 쓴 경우가 있어 '교차 확인 미적용' 으로만 알린다 — 잘림의 지문은
    언제나 B > A 다. 잘리면 A 가 줄고 남은 항목 줄은 그대로 남아 B 에 잡힌다.) */
const ITEM_LINE = /^\s*(['"])(\/[^'"]*)\1\s*,?\s*$/;
function lineShapedItems(text){
  const out = [];
  for (const line of text.split('\n')){
    const m = ITEM_LINE.exec(line.replace(/\r$/, ''));
    if (m) out.push(m[2]);
  }
  return out;
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
/* 그 자리가 ★실제로 디렉터리인가(대소문자까지 정확히). 이름 규칙으로 짐작하지 않기 위해 쓴다. */
function isDirExact(root, rel){
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length) return false;
  let abs = root;
  for (const seg of parts){
    const names = listDir(abs);
    if (names === null || names.indexOf(seg) < 0) return false;
    abs = path.join(abs, seg);
  }
  try { return fs.statSync(abs).isDirectory(); } catch { return false; }
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

  /* ★파스 온전성 — 분모를 분자와 다른 출처에서 한 번 더 센다(R2 blocker 의 처방).
     잘림의 지문은 언제나 'B > A' 다: 파스가 중간에서 끊기면 A 만 줄고, 뒤에 남은 항목 줄은
     그대로 남아 줄 단위 계수 B 에 잡힌다. 그 상태에서는 통과를 주지 않는다. */
  const byLine = lineShapedItems(text);
  if (byLine.length > items.length){
    const extra = byLine.filter(u => items.indexOf(u) < 0);
    for (const rule of RULES) indet(rule, '파스가 배열의 일부만 읽었을 수 있다 — 파스 ' + items.length + '항목인데 '
      + '줄 단위 독립 계수는 ' + byLine.length + '항목이다'
      + (extra.length ? ' (파스가 못 본 것 예: ' + extra.slice(0, 3).map(x => JSON.stringify(x)).join(', ') + (extra.length > 3 ? ' 외 ' + (extra.length - 3) + '건' : '') + ')' : '')
      + ' · ★두 수가 어긋나면 통과를 주지 않는다');
    console.log('결과: 통과 ' + passCount + ' · 미달 ' + failCount + ' · 판정 불가 ' + indetCount);
    return 2;
  }
  const crossNote = byLine.length === items.length
    ? '줄 단위 독립 계수 ' + byLine.length + '와 일치'
    : '★교차 확인 미적용(줄 단위 계수 ' + byLine.length + ' — 배열이 줄 단위로 적혀 있지 않다)';
  console.log('  · PRECACHE ' + items.length + '개 항목(sw.js 에서 읽었다 · 이 도구에 목록·개수를 박지 않는다) · ' + crossNote);

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
      /* R2 축4·축7 — 눈에 안 보이는 글자가 형태 검사를 통과하던 자리. 세 종류를 여기서 함께 닫는다.
         ★공백·제어문자는 그 자체로 다른 URL 이고(요청은 인코딩되어 나간다), 백슬래시는 Windows 경로
         습관이 새어 든 것이며(배포처는 경로 구분자로 안 읽는다), 둘 다 프리캐시 항목으로는 404 다. */
      if (/\s/.test(u)) why.push('공백류(공백·탭·개행)가 들어 있다 — ' + JSON.stringify(u));
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x1f\x7f]/.test(u)) why.push('제어문자가 들어 있다 — ' + JSON.stringify(u));
      if (u.indexOf('\\') >= 0) why.push("백슬래시가 있다(경로 구분자는 '/' 뿐이다)");
    }
    if (why.length) shapeBad.push({ u, why: why.join(' · ') });
    else clean.push(u);
  }
  /* ★퍼센트 인코딩은 미달이 아니라 판정 불가다 — '%2F' 가 이름 그대로인지 인코딩인지 이 도구가
     정하지 않았다. 규칙을 정하지 않은 채 어느 쪽으로든 판정하면 그 판정이 곧 추측이다. */
  const pctItems = clean.filter(u => u.indexOf('%') >= 0);
  if (shapeBad.length) bad('precache-url-shape', '형태가 어긋난 항목 ' + shapeBad.length + '건 — ' + shapeBad.map(x => JSON.stringify(x.u) + ' (' + x.why + ')').join(' · '));
  else if (pctItems.length) indet('precache-url-shape', '퍼센트 인코딩이 든 항목 ' + pctItems.length + '건 — ' + pctItems.map(u => JSON.stringify(u)).join(' · ')
    + ' · 디코딩 규칙을 정하지 않았다(이름 그대로인지 인코딩인지)');
  else good('precache-url-shape', items.length + '개 항목이 모두 절대 경로다(질의·조각·".."·"//"·공백·제어문자·백슬래시·퍼센트 0건)');

  /* ② 중복 */
  const seen = new Map();
  for (const u of items) seen.set(u, (seen.get(u) || 0) + 1);
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  if (dups.length) bad('precache-duplicate', '같은 URL 이 두 번 이상 실려 있다 — ' + dups.map(([u, n]) => JSON.stringify(u) + ' ×' + n).join(' · ')
    + ' (addAll 은 같은 batch 안의 중복을 InvalidStateError 로 거절한다 — 없는 파일과 같은 결과다)');
  else good('precache-duplicate', '중복 항목 0 — ' + items.length + '개가 모두 서로 다른 URL 이다');

  /* ★잴 대상이 0개면 통과가 아니다 — 아래 두 규칙은 '형식이 성한 항목' 만 본다. 그 집합이 비면
     "0개 항목이 모두 대응한다" 는 초록 문장이 나오는데, 그것은 관측이 아니라 관측의 부재다.
     (master 가 이 티켓에서 경고한 바로 그 공허다 — 결손 0 인 저장소에서는 아무것도 안 하는
      게이트도 rc=0 을 낸다. 그래서 분모를 단언하고, 분모가 0 이면 판정 불가로 올린다.) */
  if (!clean.length){
    indet('precache-dir-form', '형식이 성한 항목이 하나도 없어 잴 대상이 없다(전량이 url-shape 에서 걸렸다)');
    indet('precache-target-exists', '형식이 성한 항목이 하나도 없어 잴 대상이 없다(전량이 url-shape 에서 걸렸다)');
    console.log('결과: 통과 ' + passCount + ' · 미달 ' + failCount + ' · 판정 불가 ' + indetCount);
    return 2;
  }

  /* ③ 파일 형태로 적힌 디렉터리 항목 — Cloudflare Pages 가 308 을 돌려주어 addAll 이 통째로 깨진다.
     ★이 항목은 파일이 실제로 있으므로 실재 검사로는 절대 안 잡힌다. 규칙이 따로 있어야 하는 이유다. */
  const fileForm = clean.filter(u => u === '/index.html' || u.endsWith('/index.html'));
  /* ★R2 축2 — 반대 모양도 같은 308 이다. `/about` 처럼 **후행 슬래시가 빠진 디렉터리 항목**은
     배포처가 `/about/` 로 308 을 돌려주므로 addAll 이 통째로 깨진다. 이 저장소가 2026-08-26 에
     실제로 다친 형태가 바로 308 이다.
     ★'디렉터리인가' 를 이름 규칙으로 짐작하지 않는다 — 저장소에서 그 자리가 실제로 디렉터리인지 본다.
     그러면 확장자 없는 파일(예: `/robots`)과 디렉터리를 헷갈리지 않는다. */
  const noSlashDir = clean.filter(u => !u.endsWith('/') && isDirExact(root, u.slice(1)));
  const dirFormBad = fileForm.concat(noSlashDir);
  if (dirFormBad.length) bad('precache-dir-form', '디렉터리 자원의 표기가 어긋난 항목 ' + dirFormBad.length + '건 — '
    + fileForm.map(u => JSON.stringify(u) + '(파일 형태) → ' + JSON.stringify(u.slice(0, u.length - 'index.html'.length)) + ' 로 적어라')
      .concat(noSlashDir.map(u => JSON.stringify(u) + '(후행 슬래시 없음) → ' + JSON.stringify(u + '/') + ' 로 적어라')).join(' · ')
    + ' (배포처가 308 을 돌려주어 cache.addAll 이 통째로 reject 된다 · 2026-08-26 실측 · sw.js 주석)');
  else good('precache-dir-form', '디렉터리 표기 어긋남 0 — 파일 형태 0건 · 후행 슬래시 빠진 디렉터리 0건');

  /* ④ 실재성 — ★③에서 이미 지적된 항목은 뺀다.
     후행 슬래시가 빠진 디렉터리 항목(`/about`)은 매핑하면 '파일이 아니라 디렉터리다' 로 실재 검사도
     함께 울어 한 결함이 두 규칙을 붉힌다. 원인을 대는 규칙은 ③ 하나여야 한다(무임승차 배제 · 자기시험이 잡았다). */
  const dirFormSet = new Set(dirFormBad);
  const cleanForExists = clean.filter(u => !dirFormSet.has(u));
  const missing = [];
  let checked = 0;
  for (const u of cleanForExists){
    const rel = targetOf(u);
    const r = resolveExact(root, rel);
    checked++;
    if (!r.ok) missing.push({ u, rel, at: r.at, why: r.why });
  }
  if (!cleanForExists.length){
    indet('precache-target-exists', '실재를 잴 대상이 0건이다(형식·디렉터리 표기에서 전량이 걸렸다) — 잴 것이 없으면 통과가 아니다');
  } else if (missing.length) bad('precache-target-exists', '대응 자원을 찾지 못한 항목 ' + missing.length + '건 — '
    + missing.map(m => JSON.stringify(m.u) + ' → ' + m.rel + ' (' + m.at + ' 에서 막혔다: ' + m.why + ')').join(' · '));
  else if (checked !== cleanForExists.length) indet('precache-target-exists', '잰 건수(' + checked + ')가 대상 건수(' + cleanForExists.length + ')와 다르다 — 세는 자리가 고장 났다');
  else good('precache-target-exists', '★잰 건수 ' + checked + ' = 형식·표기가 성한 항목 ' + cleanForExists.length + '(형식 통과 ' + clean.length + ' · 전체 ' + items.length + ') · 전부 저장소의 실제 파일에 대응한다(대소문자까지 정확히 대조)');

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
  'all-entries-relative': {
    why: '전 항목의 선두 "/" 를 떼어낸다 — ★실재·파일형태 규칙의 대상 집합이 비었을 때 "0개가 모두 대응한다" 는 공허한 초록을 내지 않는지 본다',
    rules: ['precache-url-shape'], rc: 2,
    apply(text){
      const span = precacheSpan(text);
      if (span === null) return null;
      const lit = text.slice(span.open, span.close + 1);
      const next = lit.replace(/'\/([^']*)'/g, "'$1'");
      if (next === lit) return null;
      return text.slice(0, span.open) + next + text.slice(span.close + 1);
    }
  },
  'comment-close-bracket': {
    why: '★R2 blocker 재현 — 배열 안 주석에 "];" 를 넣고 그 뒤에 없는 파일 항목을 넣는다(옛 파서는 여기서 잘려 36항목만 읽고 초록을 냈다)',
    rules: ['precache-target-exists'], rc: 1,
    apply(text, root){
      const span = precacheSpan(text);
      if (span === null) return null;
      const ghost = '/ghost-after-comment.webp';
      if (fs.existsSync(path.join(root, ghost.slice(1)))) return null;   /* 정말 없는 경로여야 한다 */
      const inject = '\n  // temporary marker: ];\n  \'' + ghost + '\',';
      return text.slice(0, span.open + 1) + inject + text.slice(span.open + 1);
    }
  },
  'no-semicolon': {
    why: '★R2 축5 — 배열 끝의 세미콜론을 뗀다(ASI 는 정상 자바스크립트다). 거부하지 말고 그대로 판정해야 한다(오탐 0)',
    rules: [], rc: 0,
    apply(text){
      const span = precacheSpan(text);
      if (span === null) return null;
      const after = text.slice(span.close + 1);
      const m = /^(\s*);/.exec(after);
      if (!m) return null;
      return text.slice(0, span.close + 1) + m[1] + after.slice(m[0].length);
    }
  },
  'dir-without-slash': {
    why: '★R2 축2 — 실재하는 디렉터리 항목에서 후행 슬래시를 뗀다(배포처가 308 을 준다 · 2026-08-26 에 다친 형태)',
    rules: ['precache-dir-form'], rc: 1,
    apply(text, root){
      const P = parsePrecache(text);
      if (P.err) return null;
      const dir = P.items.find(u => u.endsWith('/') && u !== '/' && isDirExact(root, u.slice(1, -1)));
      if (!dir) return null;
      const needle = "'" + dir + "'";
      if (text.split(needle).length !== 2) return null;                  /* 앵커 유일성 */
      return text.replace(needle, "'" + dir.slice(0, -1) + "'");
    }
  },
  'control-char-entry': {
    why: '★R2 축4·축7 — 항목 끝에 눈에 안 보이는 제어문자(탭)를 붙인다(형태 검사가 그냥 통과시키던 자리)',
    rules: ['precache-url-shape'], rc: 1,
    apply(text){
      const P = parsePrecache(text);
      if (P.err) return null;
      const one = P.items.find(u => u.endsWith('.webp'));
      if (!one) return null;
      const needle = "'" + one + "'";
      if (text.split(needle).length !== 2) return null;
      return text.replace(needle, "'" + one + '\\t' + "'");
    }
  },
  'entries-outside-array': {
    why: '★파스 온전성 교차 확인 — 항목처럼 생긴 줄을 배열 밖에 둔다(파스가 무언가를 놓친 상태의 지문). 통과가 아니라 판정 불가여야 한다',
    rules: [], rc: 2,
    apply(text){
      const span = precacheSpan(text);
      if (span === null) return null;
      const tail = '\nconst PRECACHE_EXTRA = [\n  \'/outside-the-array.webp\',\n];\n';
      return text + tail;
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
