/* 프리캐시-캐시버전 게이트 — 2026-09-02 · T0902-precache-cache-gate
 *
 * 왜 만들었나 — 오늘 하루에 두 번 사람이 마지막 방벽이었다
 *   ① 16번째 게임 stop 출고 때 대문 index.html 이 바뀌었고, CACHE v35→v36 은 사람이 따로 알아채 올렸다.
 *   ② /about/ 를 고친 커밋 `8d65c60` 에서 **기존 게이트 23종이 전부 rc=0 인데 CACHE 는 v36 그대로**였다.
 *      /about/ 은 sw.js 의 PRECACHE 항목이라, 그대로 냈으면 **v36 캐시를 가진 재방문자는 낡은 소개를
 *      계속 봤다.** 출고 직전 사람이 손으로 잡아 v37 로 올렸다(`be23d74`).
 *   sw.js 는 스스로 "파일을 추가/변경하면 CACHE 문자열을 올려라" 고 주석에 적어 두었다.
 *   규약은 있었고 그것을 지키는 장치가 없었다 — 이 도구가 그 장치다.
 *
 * 무엇을 재는가 (계약 한 줄 · 2026-09-03 R2 · AMEND1 에서 확정)
 *   **구간에서 '프리캐시 계약에 영향을 주는 변경' 이 하나라도 있었다면, 구간 끝 나무의 CACHE 값은
 *   그 모든 변경보다 나중에 정해졌고, 또한 과거에 쓰인 적 없는 새 값이어야 한다.**
 *
 * '프리캐시 계약에 영향을 주는 변경' 은 셋이다 (AMEND1 · reviewer-gemini 축4·축6)
 *   ⓐ PRECACHE 에 실린 자원의 **내용 변경**
 *   ⓑ PRECACHE 에 실린 자원의 **삭제** — head 의 목록만 보면 자원과 항목을 함께 지운 출고가 빠져나간다.
 *      그래서 판정 대상 집합은 **그 커밋의 부모 PRECACHE ∪ 그 커밋의 PRECACHE** 다.
 *      (지워진 페이지는 옛 CACHE 버킷이 caches.delete 되지 않는 한 재방문자에게 영구 잔존한다)
 *   ⓒ **PRECACHE 목록 자체의 변경**(항목 추가·삭제·경로 수정) — sw.js 는 PRECACHE 항목이 아니라서
 *      목록에 새 자원을 추가해도 '바뀐 파일 중 프리캐시 대상 0개' 로 빠져나갔다.
 *
 * ★왜 '구간 어딘가에서 CACHE 가 바뀌었는가' 로는 모자란가 (R1 의 대리물 · master 실측)
 *   `--base 6a0c502 --head 8d65c60` 구간은 abdbedf(대문 변경) → da5624d(v35→v36) → 8d65c60(about 변경·안 올림)
 *   이다. 양끝만 보면 CACHE 가 v35→v36 으로 달라져 있어 초록이 나왔다. 그러나 **구간 끝 나무는
 *   v36 + 고쳐진 about** 이라, v36 을 가진 재방문자는 낡은 소개를 그대로 본다. 올린 뒤에 또 바꾼 것을
 *   보려면 값의 같고 다름이 아니라 **정해진 시점의 앞뒤**를 재야 한다.
 *
 * ★설계 원칙 1 — 비교 기준은 git 이다
 *   파일 내용을 추측하지 않는다. `git diff --name-only base..head` 로 바뀐 파일을 얻고,
 *   PRECACHE 는 **head 시점의 sw.js** 에서 읽는다(지금 나가는 계약이 그것이므로).
 *
 * ★설계 원칙 2 — 디렉터리 형태로 매핑한다 (이 도구의 핵심)
 *   PRECACHE 는 '/about/' 처럼 **디렉터리 형태만** 담는다. 파일 형태를 넣으면 Cloudflare Pages 가
 *   308 을 돌려주어 addAll 이 통째로 reject 되기 때문이다(sw.js 주석 · 2026-08-26 실측).
 *   그래서 `about/index.html` 변경은 **'/about/' 항목의 변경으로 매핑되어야 한다.**
 *   여기서 틀리면 오늘의 결함(8d65c60)을 그대로 놓친다.
 *
 * ★설계 원칙 3 — 못 읽은 것은 통과로 세지 않는다
 *   PRECACHE 배열이나 CACHE 문자열을 못 뽑으면 '위반 0' 이 아니라 **판정 불가(rc=2)** 다.
 *   git 호출이 실패해도 마찬가지다. (`tools/check_home_sync.mjs` · `tools/check_functions.mjs` 와 같은 계약)
 *
 * 규칙
 *   [precache-cache-bump]  PRECACHE 대상이 마지막으로 바뀐 커밋보다 CACHE 가 ★나중(또는 같은 커밋)에 정해져 있다
 *                          (지적문은 어느 커밋의 어느 파일이 어느 PRECACHE 항목에 걸렸고
 *                           CACHE 가 어느 커밋에서 어떤 값으로 정해졌는지를 이름으로 댄다)
 *
 * ★이 도구가 못 보는 것(정직한 한계)
 *   · **실브라우저에서 구버전 캐시가 실제로 지워지는지는 못 본다.** 이 도구가 재는 것은
 *     '버전 문자열이 올랐는가' 뿐이고, 재방문자의 캐시가 갈아 끼워지는 것은 실브라우저로만 확인된다.
 *   · 값이 **실제로 서빙되는지**는 안 본다 — 문자열의 앞뒤·형식·중복만 본다.
 *   · 순서는 **first-parent 선을 따라** 본다. 병합 커밋은 첫 부모 대비 차이로 한 번에 세고,
 *     병합해 들어온 옆가지의 커밋들을 하나씩 걷지는 않는다.
 *     ★이것이 옳은 것은 **전제 하나에 기대고 있다** — 이 저장소는 main 으로 들어올 때 `--no-ff` 병합을
 *     쓰므로, 옆가지의 내용이 병합 커밋의 첫 부모 대비 차이에 통째로 들어온다. 그래서 옆가지를 하나씩
 *     걷는 것은 같은 변경을 두 번 세는 쪽에 가깝다. **rebase 나 squash 로 들어온 이력에서는 이 전제가
 *     깨진다** — 그때는 옆가지의 중간 상태(올린 뒤에 또 바꾼 순간)가 first-parent 선에서 접혀 보이지
 *     않을 수 있다. 그 이력을 쓰기 시작하면 이 도구의 순서 판정을 다시 재야 한다.
 *   · ★**축7 — 런타임 cacheFirst 하위 자산을 못 본다.** sw.js 는 PRECACHE 에 없는 동일 오리진 자원도
 *     cacheFirst 로 같은 버킷에 담는다. 그래서 `/stop/` 은 초록인데 `stop/game.js` 구버전이 계속
 *     실행되는 경로가 남는다. 이 게이트의 계약이 아니다(master 가 별도 티켓으로 뗐다).
 *   · ★**축8 — PRECACHE 목록의 실재성을 못 본다.** 목록에 있는데 저장소에 없는 경로가 하나라도 있으면
 *     cache.addAll 전체가 reject 되어 프리캐시가 통째로 실패한다. 이 게이트는 그것을 재지 않는다
 *     (master 가 별도 티켓으로 뗐다).
 *   · CACHE 접두어(hanpango-)가 바뀌면 대소를 정의할 수 없어 **판정 불가(rc=2)** 로 멈춘다 — 통과시키지 않는다.
 *
 * 사용법:
 *   node tools/check_precache_cache.mjs [저장소 경로] [--base <ref>] [--head <ref>]
 *        기본값 base=HEAD^ · head=HEAD
 *   node tools/check_precache_cache.mjs [저장소 경로] --mutate <이름>   (검출력 확인 · 아래 MUTATIONS)
 *   node tools/check_precache_cache.mjs [저장소 경로] --selftest        (뮤테이션 전량 자동 확인)
 *   ★모르는 플래그·값 없는 플래그는 **조용히 무시하지 않는다** — rc=2 로 거부하고 사용법을 찍는다.
 *     사용법 출력에 rc=0 을 쓰지 않는다(사용법 rc 를 판정 rc 로 오독하는 사고를 막는다).
 *
 * 종료코드: 0 미달 0 · 1 미달 발견 · 2 판정 불가(모르는 플래그·값 누락·뮤테이션 주입 실패 포함)
 *           ★--mutate 일 때는 형제 도구와 다르다 — 뮤테이션마다 기대 rc 가 다르기 때문이다(오탐 0 을
 *           증명하는 뮤테이션은 rc=0 이 정답이다). 0 기대대로 · 3 기대와 어긋남 · 2 주입 실패.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
const has = n => argv.indexOf(n) >= 0;
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const FLAGS_WITH_VALUE = ['--mutate', '--base', '--head'];
const FLAGS_BARE = ['--selftest'];

/* ★모르는 플래그를 조용히 무시하면 오타 하나가 초록을 만든다 — 그건 게이트가 아니다.
   사용법은 stderr 로 찍고 ★rc=2(판정 불가) 로 끝낸다. rc=0 을 쓰지 않는다. */
const USAGE = [
  '사용법:',
  '  node tools/check_precache_cache.mjs [저장소 경로] [--base <ref>] [--head <ref>]',
  '  node tools/check_precache_cache.mjs [저장소 경로] --mutate <이름>',
  '  node tools/check_precache_cache.mjs [저장소 경로] --selftest',
  '종료코드: 0 미달 0 · 1 미달 발견 · 2 판정 불가(모르는 플래그·값 누락 포함)'
].join('\n');
function refuseFlags(why){
  console.error('  ‽ [precache-cache-bump] 판정 불가 — ' + why);
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
const BASE = argOf('--base', 'HEAD^');
const HEAD = argOf('--head', 'HEAD');

/* ── 채점판 ──────────────────────────────────────────────────────────────── */
const failedRules = new Set();
const indetRules = new Set();
let failCount = 0, indetCount = 0, passCount = 0;
function bad(rule, msg){ failedRules.add(rule); failCount++; console.log('  ✗ [' + rule + '] ' + msg); }
function indet(rule, why){ indetRules.add(rule); indetCount++; console.log('  ‽ [' + rule + '] 판정 불가 — ' + why); }
function good(rule, msg){ passCount++; console.log('  ✓ [' + rule + '] ' + msg); }

/* ── git ─────────────────────────────────────────────────────────────────── */
function git(root, args){
  try { return { out: execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e){ return { err: 'git ' + args.join(' ') + ' 가 실패했다: ' + String(e.stderr || e.message).trim().split('\n')[0] }; }
}

/* ── 읽기 ────────────────────────────────────────────────────────────────── */
/* sw.js 는 **작업 트리가 아니라 지정한 커밋에서** 읽는다 — 옛 구간을 재려면 그때의 계약을 봐야 한다. */
function swAt(root, ref){
  const r = git(root, ['show', ref + ':sw.js']);
  if (r.err) return { err: ref + ' 의 sw.js 를 읽지 못했다(' + r.err + ')' };
  return { text: r.out };
}
function parseCache(text, ref){
  const m = /const CACHE\s*=\s*'([^']*)'/.exec(text) || /const CACHE\s*=\s*"([^"]*)"/.exec(text);
  if (!m) return { err: ref + ' 의 sw.js 에서 CACHE 문자열을 찾지 못했다' };
  return { value: m[1] };
}
/* PRECACHE 항목은 **하드코딩하지 않는다** — sw.js 에서만 읽는다. */
function parsePrecache(text, ref){
  const s = text.indexOf('const PRECACHE');
  if (s < 0) return { err: ref + ' 의 sw.js 에서 PRECACHE 선언을 찾지 못했다' };
  const open = text.indexOf('[', s);
  const close = text.indexOf('];', open);
  if (open < 0 || close < 0) return { err: ref + ' 의 sw.js 에서 PRECACHE 배열의 끝을 찾지 못했다' };
  const lit = text.slice(open, close + 1);
  const items = [...lit.matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] !== undefined ? x[1] : x[2]);
  if (!items.length) return { err: ref + ' 의 PRECACHE 배열이 비어 있다' };
  return { items };
}

/* ★CACHE 값 규칙 (AMEND1 축5) — '바뀌었다' 와 '올랐다' 는 다르다.
   ★왜 이 형식인가(이 저장소의 실제 값으로 근거를 댄다): sw.js 를 건드린 first-parent 커밋 38개의
   CACHE 값을 전수로 뽑아 보면 hanpango-v1 → hanpango-v37 이다. 접두어는 38커밋 내내 'hanpango'
   하나이고, 번호는 1..37 로 단조 증가하며, 역행 0건·재사용 0건이다(be65d63 이 v34 를 그대로
   이어받은 것처럼 ★연속 같은 값은 있으나 떠났다가 돌아온 값은 없다). 그래서
   '<접두어>-v<정수>' 를 형식으로 잡고, 접두어가 같을 때 정수의 대소로 단조를 판정한다.
   접두어가 바뀌면 대소를 정의할 수 없으므로 통과가 아니라 ★판정 불가로 멈춘다. */
const CACHE_SHAPE = /^([A-Za-z0-9][A-Za-z0-9._-]*)-v(\d+)$/;
function parseCacheValue(v){
  const m = CACHE_SHAPE.exec(v);
  if (!m) return null;
  return { prefix: m[1], n: Number(m[2]) };
}
/* 이 저장소가 지금까지 실제로 쓴 CACHE 값의 계보(오래된 것부터 · 연속 중복은 접는다).
   ★'과거에 쓰인 적 없는 새 값' 을 판정하려면 구간 밖 이력까지 봐야 한다. */
function cacheLineage(root, head){
  const r = git(root, ['log', '--first-parent', '--reverse', '--format=%H', head, '--', 'sw.js']);
  if (r.err) return { err: r.err };
  const shas = r.out.split('\n').map(x => x.trim()).filter(Boolean);
  const seq = [];
  for (const c of shas){
    const sw = swAt(root, c);
    if (sw.err) return { err: sw.err };
    const cv = parseCache(sw.text, c);
    if (cv.err) return { err: cv.err };
    if (!seq.length || seq[seq.length - 1].value !== cv.value) seq.push({ sha: c.slice(0, 7), value: cv.value });
  }
  return { seq };
}

/* ★핵심 — 바뀐 파일 하나가 어떤 PRECACHE 항목(URL)으로 나가는가.
   PRECACHE 가 디렉터리 형태만 담으므로 index.html 은 **그 디렉터리 주소로도** 대응시킨다.
   이 매핑이 없으면 about/index.html 변경이 '/about/' 에 걸리지 않아 오늘의 결함을 놓친다. */
function urlCandidates(repoRelPath){
  const p = repoRelPath.replace(/\\/g, '/');
  const out = ['/' + p];
  if (p === 'index.html' || p.endsWith('/index.html')){
    out.push('/' + p.slice(0, p.length - 'index.html'.length));   /* 'about/index.html' → '/about/' · 'index.html' → '/' */
  }
  return out;
}

/* ── 판정 ────────────────────────────────────────────────────────────────── */
/* 한 커밋의 sw.js 에서 PRECACHE 집합과 CACHE 값을 함께 뽑는다(둘 중 하나라도 못 뽑으면 판정 불가). */
function swFacts(root, ref){
  const sw = swAt(root, ref);
  if (sw.err) return { err: sw.err };
  const P = parsePrecache(sw.text, ref);
  if (P.err) return { err: P.err };
  const C = parseCache(sw.text, ref);
  if (C.err) return { err: C.err };
  return { set: new Set(P.items), count: P.items.length, cache: C.value };
}

function run(root, base, head){
  console.log('프리캐시-캐시버전 게이트 — 대상 ' + root + ' · 구간 ' + base + '..' + head);
  console.log('  · 이 게이트는 ★커밋된 이력을 잰다(작업 트리의 미커밋 변경은 판정에 들어가지 않는다)');

  /* ★축9 — 작업 트리가 더러우면 경고한다. rc 는 바꾸지 않는다:
     이 도구의 계약 대상은 커밋된 이력이고, 미커밋 상태로 rc 를 붉히면 작업 중에는 아예 못 쓰는
     도구가 된다. 잃는 것(거짓 안도)은 경고로 막고, 계약은 그대로 둔다. */
  const st = git(root, ['status', '--porcelain']);
  if (!st.err){
    const dirty = st.out.split('\n').map(x => x.trim()).filter(Boolean);
    if (dirty.length) console.log('  ⚠ 작업 트리에 미커밋 변경 ' + dirty.length + '건이 있다 — 아래 판정은 그것을 보지 않는다');
  }

  /* ★축10 — 구간의 시작점은 base 가 아니라 base 와 head 의 **공통 조상**이다.
     base 가 갈라진 다른 갈래일 때 base 의 CACHE 값을 기준으로 삼으면, 양쪽이 각자 같은 값으로
     올린 경우 '안 올랐다' 는 위양성이 난다. 조상관계면 공통 조상 = base 라 값이 달라지지 않는다.
     (파일 목록은 이미 커밋마다 c~1..c 로 얻으므로 2-dot diff 의 상류 혼입은 구조적으로 없다) */
  const mbr = git(root, ['merge-base', base, head]);
  if (mbr.err){ indet('precache-cache-bump', base + ' 와 ' + head + ' 의 공통 조상을 찾지 못했다(' + mbr.err + ')'); return 2; }
  const MB = mbr.out.trim();
  if (!MB){ indet('precache-cache-bump', base + ' 와 ' + head + ' 는 공통 조상이 없다 — 구간으로 잴 수 없다'); return 2; }
  const baseRef = MB;

  const fHead = swFacts(root, head);
  if (fHead.err){ indet('precache-cache-bump', fHead.err); return 2; }
  const fBase = swFacts(root, baseRef);
  if (fBase.err){ indet('precache-cache-bump', fBase.err); return 2; }
  const P = { items: [...fHead.set], length: fHead.count };
  const cHead = { value: fHead.cache }, cBase = { value: fBase.cache };

  /* ★축5 ① — 값이 비었거나 형식이 깨졌으면 통과가 아니라 판정 불가다. */
  const vHead = parseCacheValue(cHead.value);
  if (!vHead){
    indet('precache-cache-bump', head + ' 의 CACHE 값이 비었거나 형식이 아니다(' + JSON.stringify(cHead.value)
      + ') — 이 저장소의 형식은 <접두어>-v<정수> 다. 통과로 세지 않는다');
    return 2;
  }

  /* ★참계약(순서) — 구간을 커밋 단위로 걸으면서 두 시점을 따로 잡는다.
     ① 프리캐시 대상이 마지막으로 바뀐 커밋  ② CACHE 값이 마지막으로 정해진 커밋
     ②가 ①보다 앞이면, 구간 끝 나무는 '옛 CACHE + 새 파일' 이다 — 재방문자가 낡은 사본을 본다. */
  const rl = git(root, ['rev-list', '--reverse', '--first-parent', baseRef + '..' + head]);
  if (rl.err){ indet('precache-cache-bump', rl.err); return 2; }
  const commits = rl.out.split('\n').map(x => x.trim()).filter(Boolean);

  const bp = git(root, ['rev-parse', base]);
  const baseSha = bp.err ? null : bp.out.trim();
  console.log('  · ' + head + ' 의 PRECACHE ' + P.length + '항목 · CACHE ' + cBase.value + ' → ' + cHead.value
    + (baseSha && baseSha !== MB ? ' · ★' + base + ' 는 갈래라 시작점을 공통 조상 ' + MB.slice(0, 7) + ' 로 잡았다' : ''));
  console.log('  · 구간 커밋 ' + commits.length + '개(first-parent 선)');

  let prevCache = cBase.value, prevSet = fBase.set;
  let lastTouch = null, lastBump = null, touchCount = 0;
  for (let i = 0; i < commits.length; i++){
    const c = commits[i];
    const f = swFacts(root, c);
    if (f.err){ indet('precache-cache-bump', f.err); return 2; }

    /* ★축4 — 판정 대상 집합은 '부모의 PRECACHE ∪ 이 커밋의 PRECACHE' 다.
       자원과 목록 항목을 함께 지운 커밋은 head 집합만 보면 통째로 빠져나간다. */
    const target = new Set([...prevSet, ...f.set]);

    const d = git(root, ['diff', '--name-status', c + '~1', c]);
    if (d.err){ indet('precache-cache-bump', d.err); return 2; }
    const rows = d.out.split('\n').map(x => x.trim()).filter(Boolean)
      .map(line => { const p = line.split('\t'); return { status: p[0], paths: p.slice(1) }; });

    const hits = [];
    for (const row of rows){
      for (const p of row.paths){
        for (const u of urlCandidates(p)){
          if (target.has(u)){ hits.push({ file: p, url: u, del: row.status.startsWith('D') }); break; }
        }
      }
    }

    /* ★축6 — PRECACHE 목록 자체가 달라졌으면 그것만으로 계약에 영향을 주는 변경이다. */
    const added = [...f.set].filter(x => !prevSet.has(x));
    const removed = [...prevSet].filter(x => !f.set.has(x));
    const listChanged = added.length > 0 || removed.length > 0;

    if (hits.length || listChanged){
      touchCount += hits.length;
      lastTouch = { i, sha: c.slice(0, 7), hits, added, removed };
    }
    if (f.cache !== prevCache){ lastBump = { i, sha: c.slice(0, 7), from: prevCache, to: f.cache }; }
    prevCache = f.cache;
    prevSet = f.set;
  }

  const nameHits = t => {
    const parts = t.hits.map(h => h.file + (h.del ? '(삭제)' : '') + ' → PRECACHE 항목 ' + h.url);
    if (t.added.length) parts.push('PRECACHE 항목 추가 ' + t.added.join(','));
    if (t.removed.length) parts.push('PRECACHE 항목 삭제 ' + t.removed.join(','));
    return parts.join(' · ');
  };

  if (!lastTouch){
    good('precache-cache-bump', '이 구간은 프리캐시 계약에 영향을 주는 변경(대상 내용·삭제·PRECACHE 목록)이 없다 — CACHE 를 올릴 의무가 없다(구간 커밋 ' + commits.length + '개 중 0개)');
  } else if (!lastBump){
    bad('precache-cache-bump', '프리캐시 계약에 영향을 주는 변경이 있는데 CACHE 가 구간 내내 그대로다(' + cHead.value + ') — 재방문자는 낡은 사본을 계속 본다. 마지막으로 바꾼 곳: '
      + lastTouch.sha + ' 의 ' + nameHits(lastTouch));
  } else if (lastBump.i >= lastTouch.i){
    /* 순서는 맞다. 이제 값 자체를 본다 — ★'바뀌었다' 는 '올랐다' 가 아니다(축5). */
    const vFrom = parseCacheValue(lastBump.from);
    if (!vFrom){
      indet('precache-cache-bump', '직전 CACHE 값이 형식이 아니라 대소를 비교할 수 없다(' + JSON.stringify(lastBump.from) + ')');
    } else if (vFrom.prefix !== vHead.prefix){
      indet('precache-cache-bump', 'CACHE 접두어가 ' + vFrom.prefix + ' 에서 ' + vHead.prefix
        + ' 로 바뀌었다 — 어느 쪽이 나중 값인지 정의할 수 없다. 통과로 세지 않는다');
    } else if (vHead.n <= vFrom.n){
      bad('precache-cache-bump', '★CACHE 가 오르지 않고 역행(또는 제자리)했다 — ' + lastBump.sha + ' 에서 '
        + lastBump.from + ' → ' + lastBump.to + '. 그 옛 버킷을 가진 사용자는 낡은 사본을 그대로 받는다. '
        + '바뀐 것: ' + nameHits(lastTouch));
    } else {
      /* ★축5③ — 과거에 쓰인 적 없는 새 값인가. 구간 밖 이력까지 봐야 하므로 sw.js 계보를 뽑는다. */
      const lin = cacheLineage(root, head);
      if (lin.err){
        indet('precache-cache-bump', 'CACHE 이력 계보를 뽑지 못해 값 재사용을 판정할 수 없다(' + lin.err + ')');
      } else {
        const uses = lin.seq.filter(x => x.value === cHead.value);
        if (uses.length > 1){
          bad('precache-cache-bump', '★CACHE 값 ' + cHead.value + ' 은 과거에 이미 쓰인 값이다(계보에서 '
            + uses.length + '번 등장: ' + uses.map(x => x.sha).join(', ')
            + ') — 그 값 시절의 버킷을 가진 사용자는 낡은 사본을 그대로 받는다. 바뀐 것: ' + nameHits(lastTouch));
        } else {
          good('precache-cache-bump', 'PRECACHE 계약에 영향을 주는 변경이 있었고 CACHE 는 그 뒤(또는 같은 커밋)에 '
            + '단조 증가한 새 값으로 정해졌다 — 마지막 변경 ' + lastTouch.sha + '(' + nameHits(lastTouch)
            + ') · CACHE 확정 ' + lastBump.sha + '(' + lastBump.from + ' → ' + lastBump.to + ') · 계보 '
            + lin.seq.length + '단계 중 이 값의 등장 1회');
        }
      }
    }
  } else {
    bad('precache-cache-bump', '★CACHE 를 올린 뒤에 프리캐시 대상을 또 바꿨다 — CACHE 는 ' + lastBump.sha + ' 에서 ' + lastBump.from + ' → ' + lastBump.to
      + ' 로 정해졌는데, 그 뒤 ' + lastTouch.sha + ' 이 ' + nameHits(lastTouch) + ' 를 바꿨다. 구간 끝 나무 = ' + cHead.value
      + ' + 고쳐진 그 파일 ⇒ ' + cHead.value + ' 를 가진 재방문자는 낡은 사본을 계속 본다.');
  }

  console.log('결과: 통과 ' + passCount + ' · 미달 ' + failCount + ' · 판정 불가 ' + indetCount);
  if (indetCount) return 2;
  return failCount ? 1 : 0;
}

/* ── 뮤테이션(검출력 확인) ───────────────────────────────────────────────── */
/* 임시 git 저장소를 만들어 '기준 커밋 → 변이 커밋' 두 개를 쌓고 그 구간을 잰다.
   ★기대값이 뮤테이션마다 다르다 — 오탐 0 을 증명하는 항목은 rc=0 이 정답이다. */
const MUTATIONS = {
  'touch-precache-no-bump': {
    why: '프리캐시 대상(about/index.html)을 바꾸고 CACHE 는 안 올린다 — 오늘 8d65c60 의 형태다',
    expect: { rc: 1, fail: ['precache-cache-bump'], indet: [] },
    apply(dir){
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      return commit(dir, 'about 만 고친다');
    }
  },
  'touch-precache-with-bump': {
    why: '프리캐시 대상을 바꾸고 CACHE 도 올린다 — 정상 출고의 모양(붉으면 안 된다)',
    expect: { rc: 0, fail: [], indet: [] },
    apply(dir){
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      if (!bumpCache(path.join(dir, 'sw.js'))) return false;
      return commit(dir, 'about 을 고치고 CACHE 도 올린다');
    }
  },
  'touch-nonprecache': {
    why: '프리캐시 대상이 아닌 파일만 바꾼다 — 오탐 0 확인(붉으면 안 된다)',
    expect: { rc: 0, fail: [], indet: [] },
    apply(dir){
      appendLine(path.join(dir, 'tools', 'README.md'), '변이');
      return commit(dir, '프리캐시와 무관한 파일만 고친다');
    }
  },
  'bump-only': {
    why: 'CACHE 만 올리고 프리캐시 대상은 안 바꾼다 — 무해하므로 붉으면 안 된다',
    expect: { rc: 0, fail: [], indet: [] },
    apply(dir){
      if (!bumpCache(path.join(dir, 'sw.js'))) return false;
      return commit(dir, 'CACHE 만 올린다');
    }
  },
  'unreadable-cache': {
    why: 'head 의 sw.js 에서 CACHE 문자열을 읽을 수 없게 만든다 — 통과가 아니라 판정 불가여야 한다(설계 원칙 3)',
    expect: { rc: 2, fail: [], indet: ['precache-cache-bump'] },
    apply(dir){
      const p = path.join(dir, 'sw.js');
      const s = fs.readFileSync(p, 'utf8');
      const next = s.replace(/const CACHE\s*=\s*'[^']*';/, 'const CACHE = makeCacheName();');
      if (next === s) return false;
      fs.writeFileSync(p, next, 'utf8');
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      return commit(dir, 'CACHE 를 읽을 수 없게 만든다');
    }
  },
  /* ── R2 에서 더한 4종 ─────────────────────────────────────────────────── */
  'bump-then-touch': {
    why: '★순서 축 — 프리캐시 대상을 바꾸고 CACHE 를 올린 뒤 ★같은 대상을 또 바꾼다. 구간 양끝만 보면 CACHE 가 달라 보여 초록이었다(R1 대리물이 놓치던 8d65c60 형태)',
    range: { base: 'HEAD~2', head: 'HEAD' },
    expect: { rc: 1, fail: ['precache-cache-bump'], indet: [] },
    apply(dir){
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 1 -->');
      if (!bumpCache(path.join(dir, 'sw.js'))) return false;
      if (!commit(dir, 'about 을 고치고 CACHE 도 올린다')) return false;
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 2 -->');
      return commit(dir, '★올린 뒤에 about 을 또 고친다');
    }
  },
  'touch-then-bump': {
    why: '★순서 축의 반대편 — 바꾼 뒤에 올린다. 정상 출고의 모양이므로 붉으면 안 된다(순서 규칙의 오탐 0)',
    range: { base: 'HEAD~2', head: 'HEAD' },
    expect: { rc: 0, fail: [], indet: [] },
    apply(dir){
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      if (!commit(dir, 'about 을 고친다')) return false;
      if (!bumpCache(path.join(dir, 'sw.js'))) return false;
      return commit(dir, '그 뒤에 CACHE 를 올린다');
    }
  },
  'unreadable-precache': {
    why: 'head 의 sw.js 에서 PRECACHE 배열을 못 읽게 만든다 — ★프리캐시 대상을 함께 바꿔 두었으므로 읽혔다면 rc=1 이 나와야 한다. 공허하지 않게 rc=2(판정 불가)여야 한다(설계 원칙 3)',
    expect: { rc: 2, fail: [], indet: ['precache-cache-bump'] },
    apply(dir){
      const p = path.join(dir, 'sw.js');
      const s = fs.readFileSync(p, 'utf8');
      const next = s.replace(/const PRECACHE/, 'const ASSET_LIST');
      if (next === s) return false;
      fs.writeFileSync(p, next, 'utf8');
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      return commit(dir, 'PRECACHE 선언 이름을 바꿔 못 읽게 만든다');
    }
  },
  /* ── AMEND1 에서 더한 5종 (reviewer-gemini 축4·축5·축6) ─────────────────── */
  'delete-precache-target-no-bump': {
    why: '★축4 — 자원(about/index.html)과 PRECACHE 항목(/about/)을 ★함께 지우고 CACHE 는 안 올린다. head 의 목록만 보면 지워진 항목이 집합에 없어 통째로 빠져나갔다. 재방문자에게는 지워진 페이지가 옛 버킷에 영구 잔존한다',
    expect: { rc: 1, fail: ['precache-cache-bump'], indet: [] },
    apply(dir){
      fs.rmSync(path.join(dir, 'about', 'index.html'));
      if (!removePrecacheEntry(path.join(dir, 'sw.js'), '/about/')) return false;
      return commit(dir, 'about 을 자원과 목록에서 함께 지우고 CACHE 는 안 올린다');
    }
  },
  'cache-rollback': {
    why: '★축5 — 프리캐시 대상을 바꾸고 CACHE 를 ★역행시킨다(v37→v36). 값이 달라지기만 하면 통과던 옛 규칙은 이것을 "올랐다" 로 읽었다. 그 옛 버킷을 가진 사용자는 낡은 사본을 그대로 받는다',
    expect: { rc: 1, fail: ['precache-cache-bump'], indet: [] },
    apply(dir){
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      if (!rollbackCache(path.join(dir, 'sw.js'), 1)) return false;
      return commit(dir, 'about 을 고치고 CACHE 를 되돌린다');
    }
  },
  'cache-empty': {
    why: "★축5 — 프리캐시 대상을 바꾸고 CACHE 를 빈 문자열로 만든다. 옛 규칙은 '달라졌다' 며 통과시켰다. 통과도 미달도 아닌 ★판정 불가여야 한다",
    expect: { rc: 2, fail: [], indet: ['precache-cache-bump'] },
    apply(dir){
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      if (!setCache(path.join(dir, 'sw.js'), '')) return false;
      return commit(dir, 'about 을 고치고 CACHE 를 비운다');
    }
  },
  /* ★티켓이 나열한 5종 밖의 1종 — 넣지 않으면 '과거에 쓰인 적 없는 새 값' 규칙을 붉히는 표본이
     하나도 없어 그 규칙이 공허해진다. 단조 규칙에 무임승차하지 않도록 ★단조는 통과하는 표본으로 만들었다. */
  'cache-value-reuse': {
    why: "★축5③ — 옛 값으로 되돌아간다. v37→v40→v35(의무 없는 구간) 뒤에 프리캐시 대상을 바꾸며 ★다시 v40 을 쓴다. 직전 값 v35 보다는 커서 ★단조 규칙은 통과하지만, v40 은 이미 쓰인 값이라 그 시절 버킷을 가진 사용자는 낡은 사본을 받는다",
    range: { base: 'HEAD^', head: 'HEAD' },
    expect: { rc: 1, fail: ['precache-cache-bump'], indet: [] },
    apply(dir){
      const p = path.join(dir, 'sw.js');
      const cur = readCache(p);
      const m = cur && /^(.*-v)(\d+)$/.exec(cur);
      if (!m) return false;
      const pre = m[1], n = Number(m[2]);
      if (!setCache(p, pre + String(n + 3))) return false;      /* v37 → v40 */
      if (!commit(dir, 'CACHE 를 앞질러 올린다')) return false;
      if (!setCache(p, pre + String(n - 2))) return false;      /* v40 → v35 (프리캐시 변경 없음 = 의무 없음) */
      if (!commit(dir, '되돌린다 — 프리캐시 변경이 없어 의무가 없는 구간이다')) return false;
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      if (!setCache(p, pre + String(n + 3))) return false;      /* v35 → v40 (단조는 통과 · 재사용) */
      return commit(dir, 'about 을 고치며 ★이미 쓴 v40 을 다시 쓴다');
    }
  },
  /* ★자릿수 경계 — master 가 미리 준 함정이다. 단조를 ★문자열로 비교하면 '-v10' < '-v9' 이므로
     v9→v10 이 역행으로 오판된다(사전순에서 '1' 이 '9' 보다 앞이다). 숫자로 비교하는지를 ★양방향으로
     세운다: 한쪽만 세우면 '항상 통과' 하는 구현도 통과한다. */
  'bump-across-digit-width': {
    why: "★Q3 함정 — v9 에서 v10 으로 올린다(자릿수가 늘어난다). 문자열 비교라면 역행으로 오판해 붉어진다. 숫자 비교면 정상 출고이므로 rc=0 이어야 한다",
    expect: { rc: 0, fail: [], indet: [] },
    apply(dir){
      const p = path.join(dir, 'sw.js');
      const cur = readCache(p);
      const m = cur && /^(.*-v)(\d+)$/.exec(cur);
      if (!m) return false;
      if (!setCache(p, m[1] + '9')) return false;
      if (!commit(dir, 'CACHE 를 v9 로 맞춘다(자릿수 경계 표본을 만들기 위해)')) return false;
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      if (!setCache(p, m[1] + '10')) return false;
      return commit(dir, 'about 을 고치고 v9 에서 v10 으로 올린다');
    }
  },
  'rollback-across-digit-width': {
    why: "★위 표본의 반대편 — v10 에서 v9 로 ★내린다. 문자열 비교라면 '9' 가 '10' 보다 뒤라 통과시켜 버린다. 숫자 비교면 역행이므로 rc=1 이어야 한다. 이 짝이 없으면 '자릿수 경계에서 늘 통과' 하는 구현이 위 표본만으로 초록을 받는다",
    expect: { rc: 1, fail: ['precache-cache-bump'], indet: [] },
    apply(dir){
      const p = path.join(dir, 'sw.js');
      const cur = readCache(p);
      const m = cur && /^(.*-v)(\d+)$/.exec(cur);
      if (!m) return false;
      if (!setCache(p, m[1] + '10')) return false;
      if (!commit(dir, 'CACHE 를 v10 으로 맞춘다')) return false;
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      if (!setCache(p, m[1] + '9')) return false;
      return commit(dir, 'about 을 고치고 v10 에서 v9 로 내린다');
    }
  },
  'add-precache-entry-no-bump': {
    why: '★축6 — PRECACHE 목록에 새 항목만 추가하고 CACHE 는 안 올린다. sw.js 자신은 PRECACHE 항목이 아니라서 "바뀐 파일 중 프리캐시 대상 0개" 로 빠져나갔다',
    expect: { rc: 1, fail: ['precache-cache-bump'], indet: [] },
    apply(dir){
      if (!addPrecacheEntry(path.join(dir, 'sw.js'), '/추가된자원/')) return false;
      return commit(dir, 'PRECACHE 에 항목만 추가한다');
    }
  },
  'add-precache-entry-with-bump': {
    why: '★축6 의 반대편 — 항목을 추가하고 CACHE 도 올린다. 정상 출고이므로 붉으면 안 된다(오탐 0)',
    expect: { rc: 0, fail: [], indet: [] },
    apply(dir){
      if (!addPrecacheEntry(path.join(dir, 'sw.js'), '/추가된자원/')) return false;
      if (!bumpCache(path.join(dir, 'sw.js'))) return false;
      return commit(dir, 'PRECACHE 에 항목을 추가하고 CACHE 도 올린다');
    }
  },
  'unknown-flag': {
    why: '모르는 플래그를 준다 — 조용히 무시하고 기본 구간을 재서 초록을 주면 안 된다. ★이 항목만은 실제 CLI 를 그대로 띄워 잰다(플래그 해석은 run() 안이 아니라 진입부에 있어, 저장소 변이로는 닿지 않는다)',
    spawn: ['--그런플래그는없다'],
    expect: { rc: 2, fail: [], indet: [] }
  }
};
/* ★spawn 항목 전용 — 이 파일 자신을 자식 프로세스로 띄워 진짜 종료코드를 받는다.
   종료코드를 못 받으면(실행 자체 실패) 2 로 접지 않는다 — 그러면 기대 rc=2 와 구별되지 않아
   ★추락이 판정으로 위장한다. -1 을 돌려 어긋남으로 드러나게 한다. */
function spawnCli(root, args){
  try {
    execFileSync(process.execPath, [SELF, root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return 0;
  } catch (e){
    return typeof e.status === 'number' ? e.status : -1;
  }
}
function appendLine(p, line){
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + line + '\r\n', 'utf8');
}
/* ★올림은 실제 출고와 같은 모양이어야 한다 — 번호를 1 올린다.
   (R2 까지는 '-bumped' 를 덧붙였는데, 그것은 이 저장소가 실제로 쓰는 <접두어>-v<정수> 형식을
   깨뜨린다. 형식 검사를 세운 뒤로는 그 표본이 '올림' 이 아니라 '형식 파괴' 를 재게 된다.) */
function setCache(p, value){
  const s = fs.readFileSync(p, 'utf8');
  const m = /(const CACHE\s*=\s*')([^']*)(')/.exec(s);
  if (!m) return false;
  fs.writeFileSync(p, s.replace(m[0], m[1] + value + m[3]), 'utf8');
  return true;
}
function readCache(p){
  const m = /const CACHE\s*=\s*'([^']*)'/.exec(fs.readFileSync(p, 'utf8'));
  return m ? m[1] : null;
}
function bumpCache(p){
  const cur = readCache(p);
  if (!cur) return false;
  const m = /^(.*-v)(\d+)$/.exec(cur);
  if (!m) return false;
  return setCache(p, m[1] + String(Number(m[2]) + 1));
}
function rollbackCache(p, back){
  const cur = readCache(p);
  if (!cur) return false;
  const m = /^(.*-v)(\d+)$/.exec(cur);
  if (!m) return false;
  const n = Number(m[2]) - back;
  if (n < 0) return false;
  return setCache(p, m[1] + String(n));
}
/* PRECACHE 배열의 첫 항목 앞에 새 항목을 끼워 넣는다(목록 자체의 변경 · 축6). */
function addPrecacheEntry(p, entry){
  const s = fs.readFileSync(p, 'utf8');
  const i = s.indexOf('const PRECACHE');
  if (i < 0) return false;
  const open = s.indexOf('[', i);
  if (open < 0) return false;
  const next = s.slice(0, open + 1) + "\r\n  '" + entry + "'," + s.slice(open + 1);
  if (next === s) return false;
  fs.writeFileSync(p, next, 'utf8');
  return true;
}
/* PRECACHE 배열에서 항목 하나를 지운다(자원 삭제와 짝지어 쓴다 · 축4). */
function removePrecacheEntry(p, entry){
  const s = fs.readFileSync(p, 'utf8');
  const re = new RegExp("\\s*'" + entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "',?");
  if (!re.test(s)) return false;
  fs.writeFileSync(p, s.replace(re, ''), 'utf8');
  return true;
}
function commit(dir, msg){
  const a = git(dir, ['add', '-A']);
  if (a.err) return false;
  const c = git(dir, ['commit', '-q', '-m', msg]);
  return !c.err;
}
/* 대조에 쓰는 파일만 임시 git 저장소로 옮긴다(원본 저장소는 절대 건드리지 않는다). */
function stageRepo(root){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precache-cache-'));
  fs.mkdirSync(path.join(dir, 'about'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(root, 'sw.js'), path.join(dir, 'sw.js'));
  fs.copyFileSync(path.join(root, 'about', 'index.html'), path.join(dir, 'about', 'index.html'));
  fs.writeFileSync(path.join(dir, 'tools', 'README.md'), '기준 시점\r\n', 'utf8');
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'gate@local'], ['config', 'user.name', 'gate'],
                      ['add', '-A'], ['commit', '-q', '-m', '기준']]){
    const r = git(dir, args);
    if (r.err) return null;
  }
  return dir;
}
function resetScore(){ failedRules.clear(); indetRules.clear(); failCount = indetCount = passCount = 0; }
function judge(m, rc){
  const seenFail = [...failedRules].sort(), seenIndet = [...indetRules].sort();
  const wantFail = m.expect.fail.slice().sort(), wantIndet = m.expect.indet.slice().sort();
  const ok = rc === m.expect.rc
    && seenFail.join(',') === wantFail.join(',')
    && seenIndet.join(',') === wantIndet.join(',');
  return { ok, rc, seenFail, seenIndet, wantFail, wantIndet };
}

/* ── 진입 ────────────────────────────────────────────────────────────────── */
if (has('--selftest')){
  console.log('자기시험 — 뮤테이션마다 기대한 rc 와 규칙이 그대로 나오는지 본다(어긋남 0 이 합격선)');
  let bads = 0, setupFail = 0;
  const rows = [];
  for (const [name, m] of Object.entries(MUTATIONS)){
    if (m.spawn){                                   /* 저장소 변이가 아니라 실제 CLI 호출로 잰다 */
      resetScore();
      const rcS = spawnCli(ROOT, m.spawn);
      const vS = judge(m, rcS);
      if (!vS.ok) bads++;
      rows.push({ name, why: m.why, ...vS });
      continue;
    }
    const dir = stageRepo(ROOT);
    if (dir === null){ setupFail++; rows.push({ name, ok: false, why: '임시 저장소를 만들지 못했다' }); continue; }
    let injected = false;
    try { injected = m.apply(dir); } catch (e){ injected = false; }
    if (!injected){ setupFail++; rows.push({ name, ok: false, why: '주입 실패(앵커 노후화)' }); fs.rmSync(dir, { recursive: true, force: true }); continue; }
    resetScore();
    const silent = console.log; console.log = () => {};
    let rc;
    const rg = m.range || { base: 'HEAD^', head: 'HEAD' };
    try { rc = run(dir, rg.base, rg.head); } finally { console.log = silent; fs.rmSync(dir, { recursive: true, force: true }); }
    const v = judge(m, rc);
    if (!v.ok) bads++;
    rows.push({ name, why: m.why, ...v });
  }
  for (const r of rows){
    console.log('  ' + (r.ok ? 'PASS ' : '★FAIL') + ' ' + r.name.padEnd(24)
      + ' rc=' + String(r.rc) + '(기대 ' + (r.wantFail ? MUTATIONS[r.name].expect.rc : '-') + ')'
      + ' · 미달 ' + (r.seenFail && r.seenFail.length ? r.seenFail.join(',') : '없음')
      + '(기대 ' + (r.wantFail && r.wantFail.length ? r.wantFail.join(',') : '없음') + ')'
      + ' · 판정불가 ' + (r.seenIndet && r.seenIndet.length ? r.seenIndet.join(',') : '없음')
      + '(기대 ' + (r.wantIndet && r.wantIndet.length ? r.wantIndet.join(',') : '없음') + ')');
    if (r.why) console.log('        ← ' + r.why);
  }
  console.log('자기시험 결과: 항목 ' + rows.length + ' · 어긋남 ' + bads + ' · 주입 실패 ' + setupFail);
  process.exit((bads || setupFail) ? 1 : 0);
}

if (MUTATE){
  const m = MUTATIONS[MUTATE];
  if (!m){ console.error('그런 뮤테이션이 없다: ' + MUTATE); process.exit(2); }
  if (m.spawn){
    resetScore();
    const rcS = spawnCli(ROOT, m.spawn);
    const vS = judge(m, rcS);
    console.log('  검출력 판정: rc=' + rcS + '(기대 ' + m.expect.rc + ') → ' + (vS.ok ? '기대대로' : '★어긋남'));
    process.exit(vS.ok ? 0 : 3);
  }
  const dir = stageRepo(ROOT);
  if (dir === null){ console.error('임시 저장소를 만들지 못했다'); process.exit(2); }
  let injected = false;
  try { injected = m.apply(dir); } catch (e){ console.error('주입 중 오류: ' + e.message); injected = false; }
  if (!injected){ fs.rmSync(dir, { recursive: true, force: true }); console.error('주입 실패(앵커 노후화): ' + MUTATE); process.exit(2); }
  let rc;
  const rg = m.range || { base: 'HEAD^', head: 'HEAD' };
  try { rc = run(dir, rg.base, rg.head); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const v = judge(m, rc);
  console.log('  검출력 판정: rc=' + rc + '(기대 ' + m.expect.rc + ')'
    + ' · 미달 [' + (v.seenFail.join(',') || '없음') + '](기대 [' + (v.wantFail.join(',') || '없음') + '])'
    + ' · 판정불가 [' + (v.seenIndet.join(',') || '없음') + '](기대 [' + (v.wantIndet.join(',') || '없음') + '])'
    + ' → ' + (v.ok ? '기대대로' : '★어긋남'));
  process.exit(v.ok ? 0 : 3);
}

process.exit(run(ROOT, BASE, HEAD));
