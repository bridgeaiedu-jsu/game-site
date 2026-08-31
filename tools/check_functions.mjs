/* functions/ 배포 게이트 — 2026-08-31 · T0831-functions-export-guard
 *
 * 왜 만들었나 — 2026-08-31 배포 실패
 *   노노그램 병합(aeb1240)에서 충돌을 '양쪽 다 보존'으로 해소하는 바람에 `functions/_games.js` 에
 *   `export const GAMES` 가 두 줄이 됐다. Cloudflare Pages 의 wrangler 빌드가
 *   'Multiple exports with the same name GAMES' 로 거부해 배포가 통째로 실패했고,
 *   새 경로 `/nonogram/` 만 404 였다(라이브는 이전 성공분이 남아 멀쩡했다).
 *
 *   ★원인을 정확히 적어 둔다 — 기존 `tools/counter/test_functions.mjs` 는 이 손상을 **못 보는
 *   것이 아니라 '이름 없이' 본다**. 그 시험은 대상 모듈을 진짜 `import()` 하므로 Node 가 파싱
 *   단계에서 SyntaxError 를 던지고 프로세스가 그 자리에서 죽는다(rc=1). 즉 판정이 아니라
 *   **추락**이다: 'PASS n · FAIL m' 요약 줄이 아예 안 찍히고, 하네스 오류와 구별되지 않으며,
 *   FAIL 줄을 세는 사람·자동 호출자에게는 '실패 0' 으로 보인다. 게다가 그 시험이 실제로 여는
 *   모듈은 `functions/api/hit.js`·`stats.js`·`_games.js` 셋뿐이라, functions/ 에 파일이 늘면
 *   범위 밖으로 샌다. 그리고 정작 오늘의 손상은 **병합 커밋에서 처음 생겼다** — 두 부모
 *   (326f259·4bc5359)는 각자 한 줄이라 각 레인의 시험은 정직하게 초록이었다. 병합한 나무에서
 *   다시 돌리지 않으면 어떤 검사기도 이것을 볼 기회가 없다.
 *
 *   그래서 이 게이트는 셋을 바꾼다:
 *     ① functions/ **아래 전부**를 대상으로 삼는다(파일이 늘어도 저절로 따라온다).
 *     ② 실패를 **이름 붙은 FAIL** 로 낸다 — 추락하지 않으므로 요약 줄이 반드시 찍힌다.
 *     ③ 모듈을 **평가하지 않고 파싱·링크만** 한다(wrangler 의 번들러가 하는 일과 같은 층).
 *
 * 무엇을 보나 (각 지적에 [규칙id] 가 붙는다 — 뮤테이션이 이 id 로 '지정 규칙만 FAIL' 을 대조한다)
 *   [parse]        functions/ 아래 모든 .js/.mjs 가 ES 모듈로 파싱된다.
 *                  중복 export·중복 선언은 전부 여기서 잡힌다(오늘의 실패가 이것이다).
 *   [import-path]  상대 경로 import 대상이 디스크에 실재한다.
 *   [bare-import]  외부 패키지 import 가 없다(이 저장소 규약: 빌드 0 · 외부 의존 0).
 *                  `node:`·`cloudflare:` 접두는 런타임 제공이라 허용한다.
 *   [link]         import 로 가져오는 이름이 대상 모듈에 실제로 있다.
 *                  ★평가(evaluate)는 하지 않는다 — 코드를 실행시키지 않고 결합만 확인한다.
 *   [route-export] 이름이 `_` 로 시작하지 않는 파일은 `onRequest*` 를 하나 이상 내보낸다(라우트).
 *                  `_` 로 시작하는 보조 파일은 `onRequest*` 를 **하나도** 내보내지 않는다 —
 *                  내보내는 순간 `/_games` 가 진짜 라우트가 된다(`functions/_games.js` 주석의 경고).
 *
 * 앞 단계가 막힌 파일의 뒷 단계는 **건너뛴다**(SKIP). 한 원인을 두 규칙이 중복해서 지적하면
 * '어느 규칙이 잡았는가' 가 흐려지고, 뮤테이션의 '지정 규칙만 FAIL' 대조가 성립하지 않는다.
 *
 * 사용법:
 *   node tools/check_functions.mjs [저장소 경로]
 *   node tools/check_functions.mjs . --mutate dup-export      # 검출력 확인(임시 사본에만 주입)
 *   node tools/check_functions.mjs . --list-mutations
 * ★읽기 전용이다 — 뮤테이션은 임시 폴더에 만든 사본에만 주입하고 끝나면 지운다.
 * 종료코드: 0 = 미달 0 · 1 = 미달 발견 · 2 = 검사를 세울 수 없음(대상 없음·구동 실패 등)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

/* ── vm 모듈 API 는 플래그가 필요하다. 호출자가 그것까지 알 필요는 없으니 스스로 다시 뜬다. ── */
if (typeof vm.SourceTextModule !== 'function') {
  const self = fileURLToPath(import.meta.url);
  const r = spawnSync(process.execPath,
    ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning', self, ...process.argv.slice(2)],
    { stdio: 'inherit' });
  if (r.error) { console.error('다시 띄우지 못했다: ' + r.error.message); process.exit(2); }
  process.exit(r.status === null ? 2 : r.status);
}

const argv = process.argv.slice(2);
const flag = n => argv.indexOf(n) >= 0;
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : '.');
const MUTATE = argOf('--mutate', null);

/* 고의 결함 — 검출력 확인용. [설명, 대상 파일, 찾을 문자열, 바꿀 문자열, 나와야 할 곳 수(생략 시 1),
   FAIL 이 나와야 하는 규칙]. 개수가 다르면 앵커가 늙은 것이니 조용히 넘기지 않고 rc=2 로 멈춘다. */
const MUTATIONS = {
  /* 2026-08-31 배포 실패를 글자 그대로 재현한다 — 병합이 만든 GAMES 이중 export */
  'dup-export': ['병합이 만든 GAMES 이중 export 재현(2026-08-31 배포 실패)',
                 'functions/_games.js',
                 /* 앵커는 줄 전체가 아니라 선언 머리다 — 게임이 늘어도 늙지 않는다 */
                 'export const GAMES = [',
                 "export const GAMES = ['dup-a'];\nexport const GAMES = [",
                 1, 'parse'],
  'missing-binding': ['_games.js 가 내보내는 이름을 바꿔 import 가 못 찾게 한다',
                      'functions/_games.js', 'export const GAMES = [', 'export const GAMES_RENAMED = [', 1, 'link'],
  'bad-import-path': ['hit.js 의 상대 import 를 없는 파일로 돌린다',
                      'functions/api/hit.js', "from '../_games.js'", "from '../_gamez.js'", 1, 'import-path'],
  'route-on-helper': ['보조 파일(_games.js)에 onRequest 를 붙여 라우트로 만들어 버린다',
                      'functions/_games.js', 'export const GAMES = [',
                      'export function onRequest(){ return new Response("x"); }\nexport const GAMES = [', 1, 'route-export'],
  'route-missing': ['라우트 파일에서 onRequest 를 지운다',
                    'functions/api/stats.js', 'export async function onRequest', 'async function onRequest', 1, 'route-export'],
  'bare-import': ['외부 패키지를 들여온다(이 저장소 규약 위반)',
                  'functions/api/hit.js', "import {", "import lodash from 'lodash';\nimport {", 1, 'bare-import'],
};

if (flag('--list-mutations')) {
  for (const [k, v] of Object.entries(MUTATIONS)) console.log(`  ${k.padEnd(16)} → [${v[5]}] ${v[0]}`);
  process.exit(0);
}

/* ── 대상 고르기 ─────────────────────────────────────────────────────────── */
function listModules(dir) {
  const out = [];
  const walk = d => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/* ── 임시 사본 만들기(뮤테이션 전용) ─────────────────────────────────────── */
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d); else fs.copyFileSync(s, d);
  }
}
function stageMutation(root, name) {
  const m = MUTATIONS[name];
  if (!m) { console.error('모르는 뮤테이션: ' + name + ' (--list-mutations 로 목록을 본다)'); process.exit(2); }
  const [desc, rel, from, to, want, rule] = m;
  const need = want || 1;
  /* ★도구마다 자기 무대를 쓴다 — 고정 이름을 공유하면 두 검사가 동시에 돌 때 서로를 지운다. */
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-functions-gate-'));
  copyTree(path.join(root, 'functions'), path.join(stage, 'functions'));
  const target = path.join(stage, rel);
  if (!fs.existsSync(target)) { console.error('뮤테이션 대상이 없다: ' + rel); fs.rmSync(stage, { recursive: true, force: true }); process.exit(2); }
  const src = fs.readFileSync(target, 'utf8');
  const n = src.split(from).length - 1;
  if (n !== need) {
    console.error('뮤테이션 앵커가 %d 곳(%d곳이어야 한다): %s → %s', n, need, name, rel);
    fs.rmSync(stage, { recursive: true, force: true });
    process.exit(2);
  }
  fs.writeFileSync(target, src.split(from).join(to));
  console.log('  ★고의 결함 주입: %s — %s  (FAIL 이 나와야 하는 규칙: [%s])', name, desc, rule);
  return { stage, rule };
}

/* ── 판정 틀 ─────────────────────────────────────────────────────────────── */
let pass = 0, fail = 0, skip = 0;
const failedRules = new Set();
const ok = (rule, name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  [' + rule + '] ' + name); }
  else { fail++; failedRules.add(rule); console.log('  FAIL  [' + rule + '] ' + name + (detail ? ' — ' + detail : '')); }
};
const skipped = (rule, name, why) => { skip++; console.log('  SKIP  [' + rule + '] ' + name + ' — ' + why); };

/* SourceTextModule 이 던지는 SyntaxError 에는 **소스 위치가 없다** — 스택은 이 스크립트의
   호출 지점을 가리킬 뿐이다(2026-08-31 실측: 스택에서 숫자를 주웠더니 21행 손상을 15행으로
   보고했다). 그래서 줄 번호를 스택에서 짜내지 않는다. 대신 오류 문구가 이름을 말해 주는
   중복 계열에 한해, 그 이름을 **선언·내보내는 줄을 전부 찾아 그대로 적어 준다** — 어느 쪽이
   범인인지는 단정하지 않고 사람이 볼 자리만 좁혀 준다. */
function locateName(src, message) {
  const m = /Identifier '([^']+)' has already been declared/.exec(message)
         || /Duplicate export of '([^']+)'/.exec(message);
  if (!m || !src) return '';
  const name = m[1];
  const decl = new RegExp('^\\s*(?:export\\s+)?(?:const|let|var|function|class)\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  const exp = new RegExp('^\\s*export\\s*\\{[^}]*\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  const hits = [];
  src.split('\n').forEach((l, i) => { if (decl.test(l) || exp.test(l)) hits.push(i + 1); });
  return hits.length ? ` · '${name}' 를 선언·내보내는 줄: ${hits.join(', ')}` : '';
}

/* ── 본 검사 ─────────────────────────────────────────────────────────────── */
let scanRoot = ROOT, stageDir = null, wantRule = null;
if (MUTATE) { const s = stageMutation(ROOT, MUTATE); stageDir = s.stage; scanRoot = s.stage; wantRule = s.rule; }

const FN_DIR = path.join(scanRoot, 'functions');
if (!fs.existsSync(FN_DIR)) {
  console.error('functions/ 가 없다 — 검사를 세울 수 없다: ' + FN_DIR);
  if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
  process.exit(2);
}
const files = listModules(FN_DIR);
if (!files.length) {
  console.error('functions/ 아래에 검사할 모듈이 없다 — 검사를 세울 수 없다');
  if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
  process.exit(2);
}

const rel = p => path.relative(scanRoot, p).split(path.sep).join('/');
console.log('functions/ 배포 게이트 — 대상 ' + rel(FN_DIR) + ' · 모듈 ' + files.length + '개');
console.log('  (파싱·링크만 한다 — 모듈을 평가하지 않으므로 코드가 실행되지 않는다)');
console.log('');

const context = vm.createContext({});
const mods = new Map();          /* 절대경로 → SourceTextModule (파싱 성공분만) */
const badParse = new Set();      /* 절대경로 (파싱 실패) */

/* ① parse — 중복 export·중복 선언·문법 손상 전부 여기서 잡힌다 */
for (const f of files) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); }
  catch (e) { ok('parse', rel(f) + ' 를 읽는다', false, e.message); badParse.add(f); continue; }
  try {
    const m = new vm.SourceTextModule(src, { identifier: pathToFileURL(f).href, context });
    mods.set(f, m);
    ok('parse', rel(f) + ' 가 ES 모듈로 파싱된다', true);
  } catch (e) {
    badParse.add(f);
    ok('parse', rel(f) + ' 가 ES 모듈로 파싱된다', false,
       e.constructor.name + ': ' + e.message + locateName(src, e.message));
  }
}

/* ② import-path · bare-import — 파싱된 모듈의 의존 목록을 그대로 본다 */
const resolvedDeps = new Map();  /* 절대경로 → Map(specifier → 절대경로) */
const badDeps = new Set();
const badLink = new Set();       /* 절대경로 (링크 실패) — 뒷 단계는 건너뛴다 */
for (const f of files) {
  const m = mods.get(f);
  if (!m) { skipped('import-path', rel(f) + ' 의 import 대상이 실재한다', '파싱 실패'); skipped('bare-import', rel(f) + ' 가 외부 패키지를 들이지 않는다', '파싱 실패'); continue; }
  const specs = m.dependencySpecifiers;
  const map = new Map();
  const missing = [], bare = [];
  for (const s of specs) {
    if (s.startsWith('./') || s.startsWith('../') || s.startsWith('/')) {
      const target = path.resolve(path.dirname(f), s);
      if (fs.existsSync(target)) map.set(s, target); else missing.push(s);
    } else if (s.startsWith('node:') || s.startsWith('cloudflare:')) {
      map.set(s, null);            /* 런타임이 주는 모듈 — 디스크에 없어도 정상 */
    } else {
      bare.push(s);
    }
  }
  ok('import-path', rel(f) + ' 의 상대 import 대상이 실재한다 (' + specs.length + '건)',
     missing.length === 0, '없는 대상: ' + missing.join(', '));
  ok('bare-import', rel(f) + ' 가 외부 패키지를 들이지 않는다',
     bare.length === 0, '외부 패키지: ' + bare.join(', '));
  if (missing.length || bare.length) badDeps.add(f); else resolvedDeps.set(f, map);
}

/* ③ link — import 로 가져오는 이름이 대상에 실제로 있는가. 평가는 하지 않는다. */
async function linkOnce(entry) {
  /* 링크는 모듈 인스턴스를 소비하므로 검사마다 새로 파싱한 사본으로 건다
     (한 번 링크한 모듈을 다시 링크하면 상태 오류가 난다). */
  const fresh = new Map();
  const make = f => {
    if (fresh.has(f)) return fresh.get(f);
    const m = new vm.SourceTextModule(fs.readFileSync(f, 'utf8'), { identifier: pathToFileURL(f).href, context });
    fresh.set(f, m);
    return m;
  };
  const linker = (specifier, referencing) => {
    const refPath = fileURLToPath(referencing.identifier);
    const target = path.resolve(path.dirname(refPath), specifier);
    if (!fs.existsSync(target)) throw new Error('대상 없음: ' + specifier);
    return make(target);
  };
  const root = make(entry);
  await root.link(linker);
  return root;
}
for (const f of files) {
  const name = rel(f) + ' 의 import 이름이 대상 모듈에 실재한다';
  if (badParse.has(f)) { skipped('link', name, '파싱 실패'); continue; }
  if (badDeps.has(f)) { skipped('link', name, 'import 대상 문제'); continue; }
  const deps = [...(resolvedDeps.get(f) || new Map()).values()].filter(Boolean);
  if (deps.some(d => badParse.has(d))) { skipped('link', name, '의존 모듈의 파싱 실패'); continue; }
  if (deps.some(d => !fs.existsSync(d))) { skipped('link', name, '의존 모듈 없음'); continue; }
  try { await linkOnce(f); ok('link', name, true); }
  catch (e) { badLink.add(f); ok('link', name, false, e.message); }
}

/* ④ route-export — Pages 는 `onRequest*` 를 내보내는 모듈만 라우트 표에 넣는다.
   내보내는 이름을 알아내려고 모듈을 평가하지 않는다 — '그 이름을 import 하는 작은 모듈' 을
   만들어 링크만 걸어 본다. 링크가 통과하면 그 export 가 있는 것이고, 없으면 링크가 거부한다. */
const ROUTE_NAMES = ['onRequest', 'onRequestGet', 'onRequestPost', 'onRequestPut',
                     'onRequestPatch', 'onRequestDelete', 'onRequestHead', 'onRequestOptions'];
async function hasExport(f, name) {
  const spec = './' + path.basename(f);
  const probeId = pathToFileURL(path.join(path.dirname(f), '__probe__.mjs')).href;
  const probe = new vm.SourceTextModule(
    `import { ${name} } from ${JSON.stringify(spec)}; export default ${name};`,
    { identifier: probeId, context });
  const fresh = new Map();
  const make = p => {
    if (fresh.has(p)) return fresh.get(p);
    const m = new vm.SourceTextModule(fs.readFileSync(p, 'utf8'), { identifier: pathToFileURL(p).href, context });
    fresh.set(p, m);
    return m;
  };
  try {
    await probe.link((specifier, referencing) => {
      const refPath = fileURLToPath(referencing.identifier);
      const target = path.resolve(path.dirname(refPath), specifier);
      if (!fs.existsSync(target)) throw new Error('대상 없음: ' + specifier);
      return make(target);
    });
    return true;
  } catch (e) {
    /* ★'없다' 로 접을 수 있는 것은 **내가 물어본 그 이름이 그 파일에 없다** 는 오류뿐이다.
       의존 모듈(_games.js 등)이 다른 이름을 못 내놓아 난 오류까지 '없다' 로 접으면,
       엉뚱한 원인이 route-export 의 FAIL 로 둔갑한다(2026-08-31 missing-binding 뮤테이션에서 실측).
       그 반대 방향(진짜로 onRequest 가 없는 경우)은 route-missing 뮤테이션이 지킨다. */
    const mine = e.message.includes(`does not provide an export named '${name}'`)
              && e.message.includes(`module '${spec}'`);
    if (mine) return false;
    throw e;                       /* 그 밖의 오류는 삼키지 않는다 */
  }
}
for (const f of files) {
  const base = path.basename(f);
  const helper = base.startsWith('_');
  const name = rel(f) + (helper ? ' 는 onRequest* 를 내보내지 않는다(보조 파일)' : ' 는 onRequest* 를 하나 이상 내보낸다(라우트)');
  if (badParse.has(f)) { skipped('route-export', name, '파싱 실패'); continue; }
  if (badDeps.has(f)) { skipped('route-export', name, 'import 대상 문제'); continue; }
  if (badLink.has(f)) { skipped('route-export', name, '링크 실패'); continue; }
  let found;
  try {
    found = [];
    for (const rn of ROUTE_NAMES) if (await hasExport(f, rn)) found.push(rn);
  } catch (e) { skipped('route-export', name, '이름 조회 실패: ' + e.message); continue; }
  ok('route-export', name, helper ? found.length === 0 : found.length > 0,
     helper ? '라우트가 되어 버린다: ' + found.join(', ') : 'onRequest* 를 하나도 내보내지 않는다');
}

if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });

console.log('');
if (skip) console.log('  · 앞 단계가 막혀 건너뛴 검사 ' + skip + '건 (한 원인을 두 규칙이 겹쳐 지적하지 않는다)');
console.log(`==== functions 배포 게이트: PASS ${pass} · FAIL ${fail}${skip ? ' · SKIP ' + skip : ''} ====`);

/* 뮤테이션을 걸었으면 '지정 규칙만 FAIL 인가' 까지 여기서 판정한다 — 무임승차를 막는다. */
if (MUTATE) {
  const got = [...failedRules].sort().join(',');
  const okOnly = failedRules.size === 1 && failedRules.has(wantRule);
  console.log(`  검출력 판정: 지정 규칙 [${wantRule}] · 실제 FAIL 규칙 [${got || '없음'}] → ${okOnly ? 'OK(지정 규칙만 FAIL)' : '어긋남'}`);
  process.exit(okOnly ? 1 : 2);   /* 1 = 의도대로 잡았다 · 2 = 잡지 못했거나 엉뚱한 규칙이 울렸다 */
}
process.exit(fail ? 1 : 0);
