/* functions/ 배포 게이트 — 2026-08-31 · T0831-functions-export-guard (R2: codex R6 지적 반영)
 *
 * 왜 만들었나 — 2026-08-31 배포 실패
 *   노노그램 병합(aeb1240)에서 충돌을 '양쪽 다 보존'으로 해소하는 바람에 `functions/_games.js` 에
 *   `export const GAMES` 가 두 줄이 됐다. Cloudflare Pages 의 wrangler 빌드가
 *   'Multiple exports with the same name GAMES' 로 거부해 배포가 통째로 실패했다.
 *   (기존 `tools/counter/test_functions.mjs` 는 이 손상을 '못 보는' 것이 아니라 대상 모듈을 진짜
 *   import() 하다가 **추락**한다 — 요약 줄이 안 찍혀 FAIL 을 세는 쪽에는 '실패 0' 으로 보인다.
 *   그리고 정작 손상은 병합 커밋에서 처음 생겨, 병합한 나무에서 돌리지 않으면 볼 기회가 없었다.)
 *
 * ★R2 에서 바꾼 설계 원칙 — **SKIP 은 통과가 아니다** (codex R6 지적 · 오너 결정)
 *   R1 은 앞 단계가 막힌 검사를 SKIP 으로 흘려보내고 종료코드는 미달 개수만 셌다. 그래서
 *   ①문자열 동적 import 의 대상이 없어도 rc=0 ②깨진 .ts 파일이 있어도 rc=0
 *   ③route 검사가 예상 밖 오류로 SKIP 되면 rc=0 이었다. 배포 관문에서 이것이 가장 나쁜 형태다 —
 *   게이트가 있다는 믿음만 주고 실제로는 보지 않는다.
 *   이제 **검사할 수 없었던 자리는 '판정 불가'(‽)로 올리고 rc=2 로 멈춘다.** 사유는 파일:라인과
 *   함께 남긴다. `tools/check_privacy_storage.py` 가 이미 쓰는 계약과 같다:
 *     rc=0 미달 0 · rc=1 미달 발견 · rc=2 판정 불가(하나라도 있으면 통과로 세지 않는다)
 *
 * ★규칙을 두 종류로 나눠 이름 붙인다 (codex R6 논쟁점 — 섞어 설명하면 안 된다)
 *   [wrangler] Wrangler/Pages 가 실제로 거부하거나 못 싣는 것 — 배포 적합성
 *   [정책]     이 저장소가 Wrangler 보다 엄격하게 정한 것 — 저장소 규약
 *
 * 규칙 (각 지적에 [규칙id] 가 붙는다 — 자기시험이 이 id 로 귀속을 대조한다)
 *   [parse]         (wrangler) 파싱되는 스크립트가 ES 모듈로 파싱된다. 중복 export·중복 선언이
 *                   여기서 잡힌다(오늘의 실패). ★.ts/.tsx/.jsx 는 이 도구가 **파싱할 수 없다** →
 *                   조용히 건너뛰지 않고 판정 불가로 멈춘다(아래 '이 도구가 못 보는 것' 참조).
 *   [dynamic-import](wrangler) 동적 import() 의 대상. 문자열 리터럴이면 대상 실재를 본다.
 *                   변수·템플릿 치환이면 정적으로 풀 수 없으므로 판정 불가다.
 *                   근거: Wrangler 도 변수형 동적 import 는 기본 설정에서 번들에 넣지 못한다
 *                   (developers.cloudflare.com/workers/wrangler/bundling/ — find_additional_modules 필요).
 *   [import-path]   (wrangler) 상대 경로 import 대상이 실재한다. 확장자가 없으면 .js/.mjs/.ts 형제
 *                   파일까지 찾아본다 — 확장자 해석 규칙을 단정하지 않고, '어떤 이름으로도 없을
 *                   때' 만 미달로 본다.
 *   [module-type]   (wrangler) 비JS 모듈의 종류. Pages 는 Wasm(.wasm)·text(.html 등)·binary(.bin 등)
 *                   import 를 지원한다(developers.cloudflare.com/pages/functions/module-support/).
 *                   ★그 문서는 text/binary 를 '카테고리' 로 적고 **확장자 목록을 닫아 두지 않는다** —
 *                   그래서 문서가 예로 든 확장자만 데이터 모듈로 인정하고, 그 밖의 확장자는
 *                   허용되는지 단정하지 않고 판정 불가로 멈춘다.
 *   [link]          (wrangler) import 로 가져오는 이름이 대상 모듈에 실재한다.
 *                   ★평가(evaluate)는 하지 않는다 — 코드를 실행시키지 않고 결합만 확인한다.
 *                   node:·cloudflare: 런타임 모듈과 데이터 모듈은 합성 모듈로 세워 결합만 맞춘다
 *                   (R1 은 이것을 디스크에서 찾다가 멀쩡한 코드를 막았다 — codex R6 확정 오탐).
 *   [route-export]  (정책) `_` 로 시작하지 않는 파일은 `onRequest*` 를 하나 이상 내보낸다.
 *                   `_` 로 시작하는 보조 파일은 하나도 내보내지 않는다 — 내보내는 순간
 *                   `/_games` 가 진짜 라우트가 된다(`functions/_games.js` 주석의 경고).
 *                   이름을 알아낼 수 없으면(별표 재export 충돌 등) 판정 불가다.
 *   [bare-import]   (정책) 외부 패키지 import 금지 — 이 저장소는 빌드 0 · 외부 의존 0 이 규약이다.
 *                   Wrangler 는 허용하므로 이것은 배포 적합성이 아니라 우리 규약이다.
 *
 * ★이 도구가 못 보는 것(정직한 한계 — 넘겨짚지 않고 판정 불가로 멈춘다)
 *   · TypeScript/JSX. Pages 는 `/functions` 의 `.ts` 를 공식 지원하지만
 *     (developers.cloudflare.com/pages/functions/typescript/) 이 도구의 파서(Node 내장
 *     vm.SourceTextModule)는 ES 문법만 읽는다. `.ts` 가 하나라도 생기면 rc=2 로 멈추므로,
 *     TS 를 쓰기 시작하면 **wrangler 빌드(dry-run)를 별도 관문으로 세워야 한다.**
 *   · 이 도구는 Wrangler 와 '같은 층'(파싱·결합)에서 볼 뿐 **같은 해석기가 아니다.**
 *     진짜 배포 동등성이 필요하면 wrangler 빌드 자체를 관문으로 두어라.
 *
 * 사용법:
 *   node tools/check_functions.mjs [저장소 경로]
 *   node tools/check_functions.mjs . --mutate dup-export      # 검출력 확인(임시 사본에만 주입)
 *   node tools/check_functions.mjs . --list-mutations
 *   node tools/check_functions.mjs . --selftest               # 내장 검출력 자기시험
 * ★읽기 전용이다 — 뮤테이션·자기시험은 임시 폴더 사본에만 주입하고 끝나면 지운다.
 * 종료코드: 0 = 미달 0 · 1 = 미달 발견 · 2 = 판정 불가(하나라도 있으면 통과로 세지 않는다)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import nodeModule from 'module';
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

const SELF = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
const flag = n => argv.indexOf(n) >= 0;
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : '.');
const MUTATE = argOf('--mutate', null);

/* ── 확장자 표 ───────────────────────────────────────────────────────────────
   PARSEABLE   이 도구가 ES 모듈로 파싱할 수 있는 스크립트
   UNPARSEABLE Pages 는 라우트로 삼지만 이 도구가 읽을 수 없는 스크립트 → 판정 불가
   DATA        Pages 문서가 비JS 모듈의 예로 든 확장자(Wasm·text·binary)
               ※문서가 목록을 닫지 않았으므로 '문서가 든 예' 까지만 인정한다 */
const PARSEABLE = new Set(['.js', '.mjs', '.cjs']);
const UNPARSEABLE = new Set(['.ts', '.mts', '.cts', '.tsx', '.jsx']);
const DATA = new Set(['.wasm', '.html', '.htm', '.txt', '.bin']);
const RESOLVE_EXT = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.tsx', '.jsx'];
const BUILTIN_PREFIX = ['node:', 'cloudflare:'];

/* ★런타임 모듈은 **Node 에게 직접 묻는다**(2026-09-01 · codex R8 + master 설계).
   추측도 목록도 필요 없다. 다만 두 단으로 나눈다 — 이 순서가 안전의 핵심이다:
     (1) 실재 판정은 **실행 없이** module.isBuiltin(spec) 로 한다. 목록 조회일 뿐이다.
     (2) export 이름 대조는 (1)을 통과한 것에만 동적 import 를 허용한다. 즉 **런타임이
         스스로 내장이라고 인정한 specifier 만** import 대상이 된다 — 저장소 코드에서 온
         문자열이 곧바로 import 에 도달하는 경로를 원천 차단한다.
   ★정직성 고지: 여기서 판정하는 것은 '**이 Node 에 실재하는가**' 이지
     '**Cloudflare Workers(workerd)에서 지원되는가**' 가 아니다. 예컨대 node:crypto 는
     호환 날짜 2026-08-04 이후에야 기본 지원된다. 그 차이는 이 도구가 메울 수 없다. */
const isBuiltinSpec = (spec) => {
  try { return nodeModule.isBuiltin(spec); } catch { return false; }
};
const _nsCache = new Map();
async function builtinNamespace(spec) {
  /* (2) — isBuiltin 이 true 라고 인정한 specifier 에만 도달한다. */
  if (_nsCache.has(spec)) return _nsCache.get(spec);
  let out = null;
  try { out = Object.keys(await import(spec)); }
  catch { out = null; }                    /* 이름을 못 얻으면 '모른다'(정지)로 다룬다 */
  _nsCache.set(spec, out);
  return out;
}
/* 런타임 모듈(node:·cloudflare:)이 무슨 이름을 내보내는지는 이 도구가 알 길이 없다 —
   그것은 workerd 의 버전에 매인 사실이지 이 저장소의 사실이 아니다. 저장소가 버전 결박
   manifest 를 두면 그것으로 대조하고, 없으면 named binding 검사를 판정 불가로 올린다.
   ★'런타임 모듈을 허용한다' 와 '그 모듈이 요구된 모든 이름을 내보낸다고 가정한다' 는
     완전히 다른 이야기다(codex R7). 형식: { "node:crypto": ["randomUUID", …] } */
const RUNTIME_EXPORTS_REL = 'tools/runtime-module-exports.json';
const RUNTIME_EXPORTS_FILE = path.join(ROOT, ...RUNTIME_EXPORTS_REL.split('/'));
let _runtimeExports = null;
/* ★이 함수 안에서 **다른 곳에 선언된 도우미를 부르지 않는다.** 첫 판(83fc4b4)은 여기서
   rel() 을 불렀는데 rel 은 run() 안의 지역 상수라 모듈 층위에서 보이지 않았다 —
   ReferenceError 가 아래 catch 로 떨어져 map 이 {} 로 굳었고, manifest 를 무슨 내용으로
   두든 영원히 '대조할 수단이 없다' 가 나왔다(문서가 약속한 탈출구가 닫혀 있었다).
   ★교훈: 넓은 try/catch 는 '읽기 실패' 뿐 아니라 **프로그래밍 오류까지 정상 분기로 둔갑**
     시킨다. 그래서 존재 검사는 try 밖으로 빼고, 실패 사유(why)를 반드시 들고 나와
     지적문에 싣는다 — '파일이 없다' 와 '읽지 못했다' 가 같은 문구로 나오면 안 된다. */
function runtimeExports() {
  if (_runtimeExports) return _runtimeExports;
  if (!fs.existsSync(RUNTIME_EXPORTS_FILE)) {
    _runtimeExports = { map: {}, src: RUNTIME_EXPORTS_REL, why: RUNTIME_EXPORTS_REL + ' 이 없다' };
    return _runtimeExports;
  }
  try {
    const j = JSON.parse(fs.readFileSync(RUNTIME_EXPORTS_FILE, 'utf8'));
    _runtimeExports = (j && typeof j === 'object' && !Array.isArray(j))
      ? { map: j, src: RUNTIME_EXPORTS_REL, why: null }
      : { map: {}, src: RUNTIME_EXPORTS_REL, why: RUNTIME_EXPORTS_REL + ' 의 최상위가 객체가 아니다' };
  } catch (e) {
    _runtimeExports = { map: {}, src: RUNTIME_EXPORTS_REL,
                        why: RUNTIME_EXPORTS_REL + ' 을 읽지 못함(' + e.message + ')' };
  }
  return _runtimeExports;
}
const ROUTE_NAMES = ['onRequest', 'onRequestGet', 'onRequestPost', 'onRequestPut',
                     'onRequestPatch', 'onRequestDelete', 'onRequestHead', 'onRequestOptions'];

/* ── 고의 결함(검출력 확인용) ───────────────────────────────────────────────
   [설명, 대상 파일, 찾을 문자열, 바꿀 문자열, 나와야 할 곳 수, 잡아야 할 규칙]
   개수가 다르면 앵커가 늙은 것이니 조용히 넘기지 않고 rc=2 로 멈춘다. */
const MUTATIONS = {
  'dup-export': ['병합이 만든 GAMES 이중 export 재현(2026-08-31 배포 실패)',
                 'functions/_games.js', 'export const GAMES = [',
                 "export const GAMES = ['dup-a'];\nexport const GAMES = [", 1, 'parse'],
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
                  'functions/api/hit.js', 'import {', "import lodash from 'lodash';\nimport {", 1, 'bare-import'],
  /* R2 에서 더한 것 — codex R6 가 rc=0 으로 새는 것을 확인한 자리들 */
  'dynamic-missing': ['문자열 동적 import 의 대상을 없는 파일로 만든다(R1 은 rc=0 이었다)',
                      'functions/api/hit.js', 'import {',
                      "const zz = import('../definitely-missing.js');\nimport {", 1, 'import-path'],
  'dynamic-variable': ['정적으로 풀 수 없는 동적 import 를 넣는다',
                       'functions/api/hit.js', 'import {',
                       'const zzN = "./x.js"; const zz = import(zzN);\nimport {', 1, 'dynamic-import'],
};

if (flag('--list-mutations')) {
  for (const [k, v] of Object.entries(MUTATIONS)) console.log(`  ${k.padEnd(17)} → [${v[5]}] ${v[0]}`);
  process.exit(0);
}

/* ── 파일 훑기 ───────────────────────────────────────────────────────────── */
function listScripts(dir) {
  const out = [];
  const walk = d => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const ext = path.extname(e.name).toLowerCase();
        if (PARSEABLE.has(ext) || UNPARSEABLE.has(ext)) out.push(p);
      }
    }
  };
  walk(dir);
  return out;
}
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
  const s = fs.readFileSync(target, 'utf8');
  const n = s.split(from).length - 1;
  if (n !== need) {
    console.error('뮤테이션 앵커가 %d 곳(%d곳이어야 한다): %s → %s', n, need, name, rel);
    fs.rmSync(stage, { recursive: true, force: true });
    process.exit(2);
  }
  fs.writeFileSync(target, s.split(from).join(to));
  console.log('  ★고의 결함 주입: %s — %s  (잡아야 할 규칙: [%s])', name, desc, rule);
  return { stage, rule };
}

/* ── 판정 틀 ─────────────────────────────────────────────────────────────── */
let passCount = 0;
const fails = [], indets = [];
const failedRules = new Set(), indetRules = new Set();
const P = (rule, name) => { passCount++; console.log('  PASS  [' + rule + '] ' + name); };
const FAIL = (rule, name, detail) => {
  failedRules.add(rule); fails.push(rule);
  console.log('  ✗ [' + rule + '] ' + name + (detail ? ' — ' + detail : ''));
};
/* ★파생 판정 불가 — 앞 단계가 막혀 '그래서 이 검사를 수행할 수 없었다' 가 된 것.
   원인이 하나인데 판정 불가가 여럿으로 보이면 보고서에서 원인 수와 판정 수가 어긋난다.
   집계에서 갈라 적되, rc 계산에서는 똑같이 '통과로 세지 않는다'(파생이라고 봐주지 않는다).

   ★원인은 **개수 빼기로 구하지 않는다**(2026-08-31 master 지적). '원인 = 판정불가 − 파생'
     이라고 계산하면, 그 파생을 낳은 앞 단계 항목이 **미달(✗)** 일 때 원인이 0 곳으로 나온다 —
     바로 위에 ✗ 가 찍혀 있는데 '원인 없는 파생' 이라는 있을 수 없는 상태를 보고하게 된다.
     그래서 파생을 기록할 때 **그 파생을 낳은 앞 단계 항목의 식별자**(규칙@파일)를 함께 받아
     서로 다른 원인의 개수를 센다. 원인이 미달이든 판정 불가든 똑같이 세어진다. */
let derivedIndets = 0;
const derivedCauses = new Set();
const INDET = (rule, name, why, cause) => {
  indetRules.add(rule); indets.push(rule);
  if (cause) { derivedIndets++; derivedCauses.add(cause); }
  console.log('  ‽ [' + rule + '] ' + name + ' — ' + why
              + (cause ? ` (앞 단계 [${cause}] 가 막혀 파생된 판정이다)` : ''));
};

/* SourceTextModule 이 던지는 SyntaxError 에는 **소스 위치가 없다**(스택은 이 스크립트의 호출
   지점을 가리킨다 · 2026-08-31 실측: 스택에서 숫자를 주웠더니 21행 손상을 15행으로 보고했다).
   그래서 줄 번호를 짜내지 않는다. 오류 문구가 이름을 말해 주는 중복 계열에 한해, 그 이름을
   선언·내보내는 줄을 전부 찾아 그대로 적어 준다 — 범인을 단정하지 않고 볼 자리만 좁혀 준다. */
function locateName(source, message) {
  const m = /Identifier '([^']+)' has already been declared/.exec(message)
         || /Duplicate export of '([^']+)'/.exec(message);
  if (!m || !source) return '';
  const esc = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const decl = new RegExp('^\\s*(?:export\\s+)?(?:const|let|var|function|class)\\s+' + esc + '\\b');
  const exp = new RegExp('^\\s*export\\s*\\{[^}]*\\b' + esc + '\\b');
  const hits = [];
  source.split('\n').forEach((l, i) => { if (decl.test(l) || exp.test(l)) hits.push(i + 1); });
  return hits.length ? ` · '${m[1]}' 를 선언·내보내는 줄: ${hits.join(', ')}` : '';
}
/* 그 문자열이 처음 나오는 줄 — '어디를 보면 되는가' 를 알려 주는 용도다(정확한 토큰 위치가 아니다). */
function lineOf(source, needle) {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle)) return i + 1;
  return 0;
}

/* ── 본 검사 ─────────────────────────────────────────────────────────────── */
async function run(scanRoot) {
  const FN_DIR = path.join(scanRoot, 'functions');
  if (!fs.existsSync(FN_DIR)) { console.error('functions/ 가 없다 — 검사를 세울 수 없다: ' + FN_DIR); return 2; }
  const files = listScripts(FN_DIR);
  if (!files.length) { console.error('functions/ 아래에 검사할 스크립트가 없다 — 검사를 세울 수 없다'); return 2; }

  const rel = p => path.relative(scanRoot, p).split(path.sep).join('/');
  console.log('functions/ 배포 게이트 — 대상 ' + rel(FN_DIR) + ' · 스크립트 ' + files.length + '개');
  console.log('  (파싱·링크만 한다 — 모듈을 평가하지 않으므로 코드가 실행되지 않는다)');
  console.log('  ★검사할 수 없었던 자리는 통과가 아니라 판정 불가(‽)로 올린다 — 하나라도 있으면 rc=2다.');
  console.log('');

  const context = vm.createContext({});
  const source = new Map();       /* 절대경로 → 소스 */
  const parsed = new Map();       /* 절대경로 → SourceTextModule (파싱 성공분) */
  const blocked = new Map();      /* 절대경로 → 이 파일의 뒷 단계를 막는 사유 */
  /* 절대경로 → 그 파일을 막은 **앞 단계 항목의 식별자**(규칙@파일).
     파생 판정의 '원인' 은 개수 빼기가 아니라 이 식별자로 센다 — 원인이 미달(✗)일 수도 있기 때문이다. */
  const blockCause = new Map();

  /* ① parse ------------------------------------------------------------- */
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const nm = rel(f) + ' 가 ES 모듈로 파싱된다';
    if (UNPARSEABLE.has(ext)) {
      /* Pages 는 이 확장자를 라우트로 삼지만(공식 문서) 이 도구의 파서는 ES 문법만 읽는다.
         조용히 건너뛰면 깨진 파일이 rc=0 으로 통과한다 — 그래서 멈춘다. */
      INDET('parse', nm, `${rel(f)}:1 · 이 도구는 ${ext} 를 파싱할 수 없다(Pages 는 지원한다) — wrangler 빌드를 별도 관문으로 세워야 판정할 수 있다`);
      blocked.set(f, '파싱 불가 확장자'); blockCause.set(f, 'parse@' + rel(f));
      continue;
    }
    let s;
    try { s = fs.readFileSync(f, 'utf8'); }
    catch (e) { FAIL('parse', nm, e.message); blocked.set(f, '읽기 실패'); blockCause.set(f, 'parse@' + rel(f)); continue; }
    source.set(f, s);
    try {
      parsed.set(f, new vm.SourceTextModule(s, { identifier: pathToFileURL(f).href, context }));
      P('parse', nm);
    } catch (e) {
      FAIL('parse', nm, e.constructor.name + ': ' + e.message + locateName(s, e.message));
      blocked.set(f, '파싱 실패'); blockCause.set(f, 'parse@' + rel(f));
    }
  }

  /* ② dynamic-import — dependencySpecifiers 에는 동적 import 가 들어오지 않는다.
        문자열 리터럴이면 대상을 정적 import 와 똑같이 보고, 그 밖이면 판정 불가로 멈춘다.
        ★주석·문자열 안의 'import(' 도 세는 과대 근사다 — 놓치는 쪽이 아니라 멈추는 쪽으로 틀린다. */
  const dynSpecs = new Map();     /* 절대경로 → [specifier] */
  for (const f of files) {
    const nm = rel(f) + ' 의 동적 import 대상을 정적으로 풀 수 있다';
    if (blocked.has(f)) { INDET('dynamic-import', nm, `${rel(f)} · ${blocked.get(f)}`, blockCause.get(f)); continue; }
    const s = source.get(f);
    const found = [];
    let bad = 0, badLine = 0;
    const re = /\bimport\s*\(/g;
    let m;
    while ((m = re.exec(s))) {
      const lit = /^import\s*\(\s*(['"`])((?:[^'"`\\\n]|\\.)*)\1\s*\)/.exec(s.slice(m.index));
      if (lit && !(lit[1] === '`' && lit[2].includes('${'))) { found.push(lit[2]); continue; }
      bad++;
      if (!badLine) badLine = s.slice(0, m.index).split('\n').length;
    }
    dynSpecs.set(f, found);
    if (bad) {
      INDET('dynamic-import', nm,
            `${rel(f)}:${badLine} · 대상을 정적으로 풀 수 없는 import() ${bad}곳 — Wrangler 도 변수형 동적 import 는 기본 설정에서 번들에 넣지 못한다`);
      blocked.set(f, '동적 import 판정 불가'); blockCause.set(f, 'dynamic-import@' + rel(f));
    } else {
      P('dynamic-import', nm + (found.length ? ` (문자열 ${found.length}건)` : ' (없음)'));
    }
  }

  /* ③ import-path · bare-import · module-type -------------------------- */
  const specKind = new Map();     /* 절대경로 → Map(specifier → {kind, target}) */
  for (const f of files) {
    const nmPath = rel(f) + ' 의 상대 import 대상이 실재한다';
    const nmBare = rel(f) + ' 가 외부 패키지를 들이지 않는다';
    const nmType = rel(f) + ' 가 들이는 모듈 종류를 Pages 규칙으로 가릴 수 있다';
    if (blocked.has(f)) {
      const why = `${rel(f)} · ${blocked.get(f)}`;
      const cause = blockCause.get(f);
      INDET('import-path', nmPath, why, cause); INDET('bare-import', nmBare, why, cause); INDET('module-type', nmType, why, cause);
      continue;
    }
    const s = source.get(f);
    const specs = [...parsed.get(f).dependencySpecifiers, ...(dynSpecs.get(f) || [])];
    const kinds = new Map();
    const missing = [], bare = [], unknown = [];
    for (const sp of specs) {
      if (BUILTIN_PREFIX.some(p => sp.startsWith(p))) {
        /* ★'node:' 로 시작한다고 실재하는 것이 아니다 — node:totally-fake-xyz 는 배포되면
           깨지는데 R8 까지는 게이트가 통과시켰다(내 실측: Node 는 rc=1 로 실패한다).
           이 Node 가 아는 접두(node:)는 실재를 단정할 수 있고, 모르는 접두(cloudflare:)는
           단정하지 못한다 — 후자는 아래 link 단계에서 판정 불가로 다룬다. */
        const known = isBuiltinSpec(sp);
        kinds.set(sp, { kind: 'builtin', known });
        if (!known && sp.startsWith('node:')) {
          missing.push(sp + ` (${rel(f)}:${lineOf(s, sp)} · 이 Node 에 그런 내장 모듈이 없다)`);
        }
        continue;
      }
      if (!(sp.startsWith('./') || sp.startsWith('../') || sp.startsWith('/'))) { bare.push(sp); continue; }
      const base = path.resolve(path.dirname(f), sp);
      let target = fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
      if (!target) for (const e of RESOLVE_EXT) { if (fs.existsSync(base + e)) { target = base + e; break; } }
      if (!target) { missing.push(sp + ` (${rel(f)}:${lineOf(s, sp)})`); continue; }
      const ext = path.extname(target).toLowerCase();
      if (PARSEABLE.has(ext)) kinds.set(sp, { kind: 'module', target });
      else if (UNPARSEABLE.has(ext)) kinds.set(sp, { kind: 'unparseable', target });
      else if (DATA.has(ext)) kinds.set(sp, { kind: 'data', target });
      else unknown.push(sp + ` (${rel(f)}:${lineOf(s, sp)} · 확장자 ${ext})`);
    }
    specKind.set(f, kinds);
    if (missing.length) { FAIL('import-path', nmPath, '없는 대상: ' + missing.join(', ')); blocked.set(f, 'import 대상 없음'); blockCause.set(f, 'import-path@' + rel(f)); }
    else P('import-path', nmPath + ` (${specs.length}건)`);
    if (bare.length) { FAIL('bare-import', nmBare, '외부 패키지: ' + bare.join(', ') + ' · 이 저장소 규약(Wrangler 는 허용한다)'); blocked.set(f, '외부 패키지'); if (!blockCause.has(f)) blockCause.set(f, 'bare-import@' + rel(f)); }
    else P('bare-import', nmBare);
    if (unknown.length) {
      INDET('module-type', nmType,
            '이 확장자가 Pages 의 text/binary 모듈로 허용되는지 문서가 목록을 닫지 않아 단정할 수 없다: ' + unknown.join(', '));
      blocked.set(f, '모듈 종류 판정 불가'); if (!blockCause.has(f)) blockCause.set(f, 'module-type@' + rel(f));
    } else P('module-type', nmType);
  }

  /* ★(2)단 — 이 Node 가 **스스로 내장이라고 인정한** specifier 만 골라 이름을 물어본다.
     저장소 코드에서 온 문자열이 곧바로 import 에 도달하지 않게 하는 것이 이 필터의 목적이다.
     얻지 못하면 null 로 두고 '모른다'(판정 불가)로 다룬다 — 통과로 세지 않는다. */
  const builtinNames = new Map();
  for (const kinds of specKind.values()) {
    for (const [sp, v] of kinds) {
      if (v.kind !== 'builtin' || !v.known || builtinNames.has(sp)) continue;
      builtinNames.set(sp, await builtinNamespace(sp));
    }
  }

  /* ── 링크 도우미 ──────────────────────────────────────────────────────
     런타임 모듈(node:·cloudflare:)과 데이터 모듈(.wasm·.html·.bin)은 디스크에서 찾지 않고
     합성 모듈로 세운다. 내보내는 이름은 링커가 스스로 알려 준다 — 'does not provide an export
     named X' 오류를 받아 그 이름을 더하고 다시 건다(파서가 진실을 말하게 하고, 내가 정규식으로
     import 절을 짐작하지 않는다). */
  /* ★여기가 R7 이 뚫은 자리다. 예전에는 importer 가 달라는 이름을 링커에게 그대로
     만들어 주었다(최대 64회 재시도) — 그것은 권위 모듈의 export 를 **확인**하는 것이
     아니라 **발명**하는 것이다. 그래서 node:crypto 의 없는 이름도 통과했다.
     이제 종류별로 갈라 판정한다. 각 분기는 자기시험의 meta 변이체가 홀로 지워 본다. */
  function synVerdict(spec, name) {
    const ext = path.extname(spec).toLowerCase();
    /* 방어A — Cloudflare Pages 의 text/binary/wasm 모듈은 **default 만** 내보낸다
       (https://developers.cloudflare.com/pages/functions/module-support/). */
    if (DATA.has(ext)) return { kind: 'data-named' };
    if (!BUILTIN_PREFIX.some(p => spec.startsWith(p))) return { kind: 'foreign' };
    /* ★이 Node 가 아는 내장 모듈이면 **런타임이 정본**이다 — manifest 를 보지 않는다.
       R8 은 manifest 를 먼저 봤고, 그래서 목록에 가짜 이름을 적어 두면 게이트가 통과시키는
       뒷문이 있었다(내 실측: gate rc=0 · Node rc=1). 경고 문구는 방벽이 아니다. */
    if (builtinNames && builtinNames.has(spec)) {
      const names = builtinNames.get(spec);
      if (names === null) return { kind: 'builtin-unverified', why: spec + ' 의 export 이름을 런타임에서 얻지 못했다' };
      return names.includes(name) ? { kind: 'ok' }
                                  : { kind: 'builtin-missing', why: '이 Node 의 ' + spec + ' export 목록' };
    }
    const R = runtimeExports();
    const man = R.map[spec];
    /* 여기 오는 것은 **이 Node 로 확인할 수 없는 접두**(cloudflare: 등)뿐이다.
       그때만 버전 결박 manifest 가 의미를 갖고, 없으면 판정 불가다. */
    const noList = R.why || (R.src + ' 에 ' + spec + ' 항목이 배열로 적혀 있지 않다');
    if (!Array.isArray(man)) return { kind: 'builtin-unverified', why: noList };
    if (!man.includes(name)) return { kind: 'builtin-missing', why: R.src + ' 의 ' + spec + ' 목록' };
    return { kind: 'ok' };
  }
  const MAX_PROBE = 64;
  function makeHelpers(syn) {
    const fresh = new Map();
    const makeFile = p => {
      if (fresh.has(p)) return fresh.get(p);
      const m = new vm.SourceTextModule(fs.readFileSync(p, 'utf8'), { identifier: pathToFileURL(p).href, context });
      fresh.set(p, m);
      return m;
    };
    const makeSyn = (spec, names) => {
      const key = 'syn:' + spec;
      if (fresh.has(key)) return fresh.get(key);
      const list = [...names];
      const m = new vm.SyntheticModule(list, function () { for (const n of list) this.setExport(n, undefined); },
                                       { identifier: 'synthetic:' + spec, context });
      fresh.set(key, m);
      return m;
    };
    return { fresh, makeFile, makeSyn };
  }
  async function tryLink(entryMaker, syn) {
    const H = makeHelpers(syn);
    const linker = (spec, referencing) => {
      if (BUILTIN_PREFIX.some(p => spec.startsWith(p))) return H.makeSyn(spec, syn.get(spec) || new Set(['default']));
      const refId = referencing.identifier;
      const refPath = refId.startsWith('file:') ? fileURLToPath(refId) : refId;
      const base = path.resolve(path.dirname(refPath), spec);
      let target = fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
      if (!target) for (const e of RESOLVE_EXT) { if (fs.existsSync(base + e)) { target = base + e; break; } }
      if (!target) throw new Error('대상 없음: ' + spec);
      const ext = path.extname(target).toLowerCase();
      if (DATA.has(ext)) return H.makeSyn(spec, new Set(['default', ...(syn.get(spec) || [])]));
      if (UNPARSEABLE.has(ext)) throw new Error('UNPARSEABLE:' + spec);
      return H.makeFile(target);
    };
    try { const root = entryMaker(H); await root.link(linker); return { ok: true }; }
    catch (e) {
      const mm = /The requested module '([^']+)' does not provide an export named '([^']+)'/.exec(e.message);
      if (mm) return { ok: false, missing: { spec: mm[1], name: mm[2] }, error: e };
      return { ok: false, error: e };
    }
  }
  /* 합성 모듈의 이름을 채워 가며 링크가 설 때까지 되돌아본다. */
  async function linkResolving(entryMaker) {
    const syn = new Map();
    for (let i = 0; i < MAX_PROBE; i++) {
      const r = await tryLink(entryMaker, syn);
      if (r.ok) return { ok: true };
      const miss = r.missing;
      if (!miss) return r;
      const v = synVerdict(miss.spec, miss.name);
      if (v.kind === 'foreign') return r;
      if (v.kind !== 'ok') {
        const why = v.kind === 'data-named'
          ? `데이터 모듈 ${miss.spec} 에서 named import '${miss.name}' 를 가져온다 — Pages 의 text/binary/wasm 모듈은 default 만 내보낸다`
          : v.kind === 'builtin-missing'
            ? `런타임 모듈 ${miss.spec} 의 export 목록(${v.why})에 '${miss.name}' 가 없다`
            : `런타임 모듈 ${miss.spec} 이 '${miss.name}' 를 내보내는지 대조할 수단이 없다(${v.why}) — ${RUNTIME_EXPORTS_REL} 에 버전 결박 목록을 두면 판정할 수 있다`;
        return { ok: false, kind: v.kind, spec: miss.spec, name: miss.name, error: new Error(why) };
      }
      if (!syn.has(miss.spec)) syn.set(miss.spec, new Set(['default']));
      syn.get(miss.spec).add(miss.name);
    }
    return { ok: false, error: new Error('합성 모듈 이름을 ' + MAX_PROBE + '번 안에 채우지 못했다') };
  }

  /* ④ link -------------------------------------------------------------- */
  const linkBad = new Set();
  for (const f of files) {
    const nm = rel(f) + ' 의 import 이름이 대상 모듈에 실재한다';
    if (blocked.has(f)) { INDET('link', nm, `${rel(f)} · ${blocked.get(f)}`, blockCause.get(f)); linkBad.add(f); continue; }
    const kinds = specKind.get(f) || new Map();
    const un = [...kinds.entries()].filter(([, v]) => v.kind === 'unparseable').map(([k]) => k);
    if (un.length) { INDET('link', nm, `${rel(f)} · 이 도구가 파싱할 수 없는 모듈을 들인다: ${un.join(', ')}`); linkBad.add(f); continue; }
    const depBad = [...kinds.values()].some(v => v.kind === 'module' && blocked.has(v.target));
    const badDep = [...kinds.values()].find(v => v.kind === 'module' && blocked.has(v.target));
    if (depBad) { INDET('link', nm, `${rel(f)} · 의존 모듈이 판정 불가·파싱 실패다`,
                        (badDep && blockCause.get(badDep.target)) || ('의존모듈@' + rel(badDep.target)));
                  linkBad.add(f); continue; }
    const r = await linkResolving(H => H.makeFile(f));
    if (r.ok) P('link', nm);
    else if (String(r.error.message).startsWith('UNPARSEABLE:')) { INDET('link', nm, `${rel(f)} · 이 도구가 파싱할 수 없는 모듈을 들인다`); linkBad.add(f); }
    else if (r.kind === 'builtin-unverified') { INDET('link', nm, `${rel(f)} · ${r.error.message}`); linkBad.add(f); }
    else { FAIL('link', nm, `${rel(f)} · ${r.error.message}`); linkBad.add(f); }
  }

  /* ⑤ route-export ------------------------------------------------------
     내보내는 이름을 알아내려고 모듈을 평가하지 않는다 — '그 이름을 import 하는 작은 모듈' 을
     세워 링크만 걸어 본다. ★'없다' 로 접을 수 있는 것은 **내가 물어본 그 이름이 그 파일에 없다**
     는 오류뿐이다. 그 밖의 오류(별표 재export 충돌 등)는 이름을 알아내지 못한 것이므로
     판정 불가다 — R1 은 이것을 SKIP 으로 흘려 rc=0 을 냈다(codex R6 지적). */
  async function hasExport(f, name) {
    const spec = './' + path.basename(f);
    const probeId = pathToFileURL(path.join(path.dirname(f), '__probe__.mjs')).href;
    const r = await linkResolving(() => new vm.SourceTextModule(
      `import { ${name} } from ${JSON.stringify(spec)}; export default ${name};`,
      { identifier: probeId, context }));
    if (r.ok) return true;
    const mm = r.missing;
    if (mm && mm.spec === spec && mm.name === name) return false;
    throw r.error;
  }
  for (const f of files) {
    const helper = path.basename(f).startsWith('_');
    const nm = rel(f) + (helper ? ' 는 onRequest* 를 내보내지 않는다(보조 파일)' : ' 는 onRequest* 를 하나 이상 내보낸다(라우트)');
    if (blocked.has(f)) { INDET('route-export', nm, `${rel(f)} · ${blocked.get(f)}`, blockCause.get(f)); continue; }
    if (linkBad.has(f)) { INDET('route-export', nm, `${rel(f)} · 링크가 서지 않아 내보내는 이름을 알 수 없다`, 'link@' + rel(f)); continue; }
    const found = [];
    let unknownName = null;
    for (const rn of ROUTE_NAMES) {
      try { if (await hasExport(f, rn)) found.push(rn); }
      catch (e) { unknownName = e.message; break; }
    }
    if (unknownName) { INDET('route-export', nm, `${rel(f)} · 내보내는 이름을 알아낼 수 없다: ${unknownName}`); continue; }
    if (helper ? found.length === 0 : found.length > 0) P('route-export', nm);
    else FAIL('route-export', nm, helper ? '라우트가 되어 버린다: ' + found.join(', ') : 'onRequest* 를 하나도 내보내지 않는다');
  }

  console.log('');
  console.log(`==== functions 배포 게이트: PASS ${passCount} · 미달 ${fails.length} · 판정 불가 ${indets.length}`
    + (derivedIndets ? ` (그중 ${derivedIndets} 건은 앞 단계 지적에서 파생된 것 — 그 파생을 낳은 앞 단계 지적은 ${derivedCauses.size} 곳이다: ${[...derivedCauses].sort().join(', ')})` : '')
    + ' ====');
  /* ★이 분기가 'SKIP 은 통과가 아니다' 방어의 본체다 — 자기시험의 meta 케이스가 이 줄을 지운
     사본을 돌려 rc 가 0 으로 새는지 확인한다. 문구를 바꾸면 그 앵커도 함께 고쳐라. */
  if (indets.length) {
    console.log('결과: rc=2 (판정 불가 %d건 · 미달 %d건) — 판정 불가가 하나라도 있으면 통과로 세지 않는다',
                indets.length, fails.length);
    return 2;
  }
  console.log('결과: rc=%d (미달 %d건)', fails.length ? 1 : 0, fails.length);
  return fails.length ? 1 : 0;
}

/* ── 자기시험 ────────────────────────────────────────────────────────────
   케이스마다 **어느 규칙이 잡아야 하는가**와 **어떤 rc 여야 하는가**를 못박는다.
   ★마지막은 '방어를 지운 변이체' 다 — 판정 불가를 통과로 세던 R1 의 계산식을 되살린 사본이
   rc=0 을 내는지 확인한다. 그 사본이 여전히 rc=2 를 내면 지금의 rc=2 는 이 방어가 만든 것이
   아니라는 뜻이므로 자기시험을 FAIL 로 떨어뜨린다(공허한 통과 차단). */
function fpath(st, rel) { return path.join(st, rel.split('/').join(path.sep)); }
function writeF(st, rel, text) { const p = fpath(st, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
function appendF(st, rel, text) { const p = fpath(st, rel); fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + text); }
function prependF(st, rel, text) { const p = fpath(st, rel); fs.writeFileSync(p, text + fs.readFileSync(p, 'utf8')); }
function replaceF(st, rel, from, to) {
  const p = fpath(st, rel), s = fs.readFileSync(p, 'utf8');
  if (s.split(from).length - 1 !== 1) throw new Error('자기시험 앵커가 유일하지 않다: ' + rel + ' ← ' + from);
  fs.writeFileSync(p, s.split(from).join(to));
}
const FIXTURES = {
  'control': ['손대지 않은 나무', null, 0, []],
  /* ★미달(✗)이 난 파일은 그 뒤 검사를 '수행하지 못한다' — 그것도 판정 불가(‽)로 올라간다.
     그래서 기대 rc 는 1 이 아니라 2 다: 판정 불가가 하나라도 있으면 통과로 세지 않는다는 계약이
     미달 여부보다 우선한다(tools/check_privacy_storage.py 와 같은 규약). */
  'static-missing': ['정적 import 대상 없음(대조군 성격)',
    st => prependF(st, 'functions/api/hit.js', "import '../definitely-missing.js';\n"), 2, ['import-path']],
  'dynamic-missing': ['문자열 동적 import 대상 없음 — R1 은 rc=0 이었다',
    st => appendF(st, 'functions/api/hit.js', "\nconst zz = import('../definitely-missing.js');\n"), 2, ['import-path']],
  'dynamic-variable': ['변수형 동적 import — 정적으로 못 푼다',
    st => appendF(st, 'functions/api/hit.js', '\nconst zzN = "./x.js"; const zz = import(zzN);\n'), 2, ['dynamic-import']],
  'broken-ts': ['깨진 .ts 파일 — R1 은 rc=0 이었다',
    st => writeF(st, 'functions/api/broken.ts', 'export const onRequest: = ;\n'), 2, ['parse']],
  'valid-ts': ['멀쩡한 .ts 도 이 도구로는 판정 불가다(정직한 한계)',
    st => writeF(st, 'functions/api/ok.ts', 'export const onRequest = (): Response => new Response("x");\n'), 2, ['parse']],
  'star-conflict-route': ['별표 재export 충돌 — 이름을 알 수 없다. R1 은 SKIP 후 rc=0 이었다',
    st => { writeF(st, 'functions/route-a.js', "export function onRequest(){ return new Response('a'); }\n");
            writeF(st, 'functions/route-b.js', "export function onRequest(){ return new Response('b'); }\n");
            writeF(st, 'functions/ambiguous.js', "export * from './route-a.js';\nexport * from './route-b.js';\n"); },
    2, ['route-export']],
  /* ★R7 계약 변경 — 예전 기대는 rc=0 이었다. 런타임 모듈 import 를 '막지 않는다' 는 것과
     '그 모듈이 요구된 이름을 내보낸다고 가정한다' 는 다른 이야기다. 대조할 manifest 가
     없으면 named binding 은 판정 불가다(부수효과·default import 는 그대로 통과한다). */
  /* ★R9 계약 변경 — node: 는 이제 **Node 가 정본**이다(module.isBuiltin + 네임스페이스 키).
     R8 은 대조 수단이 없다며 판정 불가를 냈지만, 지금은 실재하는 이름이면 통과한다.
     추측이 아니라 런타임에게 물어 확인한 통과다. */
  'node-builtin-named': ['node: 의 실재하는 named import — 런타임이 확인해 주므로 통과',
    st => prependF(st, 'functions/api/hit.js', "import { randomUUID as zzR } from 'node:crypto';\n"), 0, []],
  'cloudflare-builtin-named': ['cloudflare: 는 이 Node 로 확인할 수 없다 — 판정 불가',
    st => prependF(st, 'functions/api/hit.js', "import { DurableObject as zzD } from 'cloudflare:workers';\n"), 2, ['link']],
  /* ★R9 — 존재하지 않는 런타임 모듈. R8 까지는 세 형태 중 둘이 rc=0 으로 샜다
     (내 실측: Node 는 셋 다 rc=1 로 실패한다 = 배포되면 깨지는 코드였다). */
  'node-missing-sideeffect': ['없는 node: 모듈 · 부수효과 import — R8 은 rc=0 이었다',
    st => prependF(st, 'functions/api/hit.js', "import 'node:totally-fake-xyz';\n"), 2, ['import-path']],
  'node-missing-default': ['없는 node: 모듈 · default import — R8 은 rc=0 이었다',
    st => prependF(st, 'functions/api/hit.js', "import zzF from 'node:totally-fake-xyz';\n"), 2, ['import-path']],
  'node-missing-named': ['없는 node: 모듈 · named import',
    st => prependF(st, 'functions/api/hit.js', "import { zzN } from 'node:totally-fake-xyz';\n"), 2, ['import-path']],
  'node-builtin-sideeffect': ['부수효과만 들이는 런타임 모듈 import 는 막지 않는다',
    st => prependF(st, 'functions/api/hit.js', "import 'node:crypto';\n"), 0, []],
  'node-builtin-default': ['런타임 모듈의 default import 는 막지 않는다',
    st => prependF(st, 'functions/api/hit.js', "import zzC from 'node:crypto';\n"), 0, []],
  /* ★R7 fail-open 3종 — 합성 링커가 '달라는 이름' 을 만들어 주어 전부 rc=0 이었다. */
  'node-unknown-export': ['node: 의 없는 named export — R7 은 rc=0 이었다',
    st => prependF(st, 'functions/api/hit.js', "import { definitelyNotAnExport as zzB } from 'node:crypto';\n"), 2, ['link']],
  'cloudflare-unknown-export': ['cloudflare: 의 없는 named export — R7 은 rc=0 이었다',
    st => prependF(st, 'functions/api/hit.js', "import { definitelyNotAnExport as zzB } from 'cloudflare:workers';\n"), 2, ['link']],
  'pages-text-named-export': ['데이터 모듈의 named import — Pages 는 default 만 준다. R7 은 rc=0 이었다',
    st => { writeF(st, 'functions/message.html', '<strong>hello</strong>\n');
            prependF(st, 'functions/api/hit.js', "import { definitelyNotAnExport as zzB } from '../message.html';\n"); },
    2, ['link']],
  /* ★R8b — **탈출구가 실제로 열리는가**. 방어가 서 있는지만 재고 빠져나갈 길을 재지 않으면,
     문서가 약속한 manifest 가 아무 일도 못 하는 채로 자기시험 전부 PASS 가 된다
     (2026-08-31 실측: runtimeExports() 가 run() 지역 상수 rel 을 불러 ReferenceError 가
      catch 로 떨어졌고 map 이 {} 로 굳어 manifest 를 무엇으로 두든 판정 불가였다).
     규칙을 바꾸면 자기시험의 범위도 함께 넓힌다 — 위 'node-builtin-named' 가 (c) manifest 無 다. */
  /* ★R9 — manifest 의 사정거리가 줄었다. node: 는 Node 가 정본이라 manifest 를 보지 않는다
     (R8 에는 목록에 가짜 이름을 적으면 통과하는 뒷문이 있었다 — 경고는 방벽이 아니다).
     이제 manifest 는 **이 Node 로 확인할 수 없는 접두**(cloudflare: 등)에만 유효하므로
     시험도 그쪽으로 옮긴다. 옛 자리에 두면 시험이 아무것도 재지 않는다. */
  'runtime-manifest-allows': ['(a) manifest 有 + 목록에 있는 이름 → 통과해야 한다(탈출구)',
    st => { writeF(st, 'tools/runtime-module-exports.json', '{"cloudflare:workers": ["DurableObject"]}');
            prependF(st, 'functions/api/hit.js', "import { DurableObject as zzD } from 'cloudflare:workers';\n"); },
    0, []],
  'runtime-manifest-rejects': ['(b) manifest 有 + 목록에 없는 이름 → 미달이어야 한다',
    st => { writeF(st, 'tools/runtime-module-exports.json', '{"cloudflare:workers": ["DurableObject"]}');
            prependF(st, 'functions/api/hit.js', "import { definitelyNotAnExport as zzB } from 'cloudflare:workers';\n"); },
    2, ['link']],
  'runtime-manifest-broken': ['(d) manifest 가 깨진 JSON → 판정 불가로 멈춘다(조용히 무시하지 않는다)',
    st => { writeF(st, 'tools/runtime-module-exports.json', '{ this is not json');
            prependF(st, 'functions/api/hit.js', "import { DurableObject as zzD } from 'cloudflare:workers';\n"); },
    2, ['link']],
  /* ★뒷문 재현 — node: 목록에 가짜 이름을 적어도 이제는 Node 가 아니라고 말한다. */
  'runtime-manifest-backdoor': ['node: manifest 에 가짜 이름 → Node 가 정본이라 막힌다(R8 뒷문)',
    st => { writeF(st, 'tools/runtime-module-exports.json', '{"node:crypto": ["definitelyNotAnExport"]}');
            prependF(st, 'functions/api/hit.js', "import { definitelyNotAnExport as zzB } from 'node:crypto';\n"); },
    2, ['link']],
  'pages-text-module': ['Pages 가 지원하는 text 모듈 import 를 막지 않는다(R1 오탐)',
    st => { writeF(st, 'functions/message.html', '<strong>hello</strong>\n');
            prependF(st, 'functions/api/hit.js', "import zzHtml from '../message.html';\n"); }, 0, []],
  'extensionless-relative': ['확장자 없는 상대 import 는 형제 파일로 풀린다(R1 오탐)',
    st => replaceF(st, 'functions/api/hit.js', '../_games.js', '../_games'), 0, []],
  'unknown-ext-module': ['문서가 확장자 목록을 닫지 않은 종류는 단정하지 않는다',
    st => { writeF(st, 'functions/data.xyz', 'zz\n');
            prependF(st, 'functions/api/hit.js', "import zzX from '../data.xyz';\n"); }, 2, ['module-type']],
};
function runChild(tool, root) {
  const r = spawnSync(process.execPath,
    ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning', tool, root],
    { encoding: 'utf8' });
  const out = r.stdout || '';
  const seen = new Set([...out.matchAll(/[✗‽]\s*\[([a-z-]+)\]/g)].map(m => m[1]));
  /* ★요약의 자기모순 검사 — '파생이 N 건인데 그 파생을 낳은 앞 단계 지적은 0 곳' 은
     있을 수 없는 상태다. 원인을 '판정불가 − 파생' 으로 빼서 구하면, 막은 것이 **미달(✗)**
     일 때 정확히 이 모순이 나온다(2026-08-31 master 지적). 그래서 케이스마다 이 불변식을
     함께 본다 — 규칙을 바꿨으면 그 규칙이 낳는 산출물까지 자기시험이 붙잡아야 한다. */
  const m = /파생된 것 — 그 파생을 낳은 앞 단계 지적은 (\d+) 곳이다: ([^)]*)\)/.exec(out);
  const dm = /그중 (\d+) 건은 앞 단계 지적에서 파생된 것/.exec(out);
  let contradiction = null;
  if (dm && Number(dm[1]) > 0) {
    if (!m) contradiction = '파생을 보고하면서 원인 목록을 적지 않았다';
    else if (Number(m[1]) === 0 || !m[2].trim()) contradiction = '파생 ' + dm[1] + ' 건인데 원인이 0 곳이다';
  }
  return { rc: r.status, seen, out, err: r.stderr || '', contradiction };
}
function selftest() {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-fngate-selftest-'));
  const rows = [];
  let bad = 0;
  /* ★하네스 오류(주입 실패)와 결함 탐지를 같은 칸에 뭉치지 않는다 — 주입도 안 된 케이스를
     '탐지됨' 으로 세면 검출력이 부풀려진다(2026-08-31 교훈). */
  let setupFail = 0;
  try {
    for (const [name, spec] of Object.entries(FIXTURES)) {
      const [, mutate, wantRc, wantRules] = spec;
      const work = path.join(stage, name);
      copyTree(path.join(ROOT, 'functions'), path.join(work, 'functions'));
      if (mutate) {
        try { mutate(work); }
        catch (e) {
          setupFail++;
          rows.push({ name, wantRc, rc: '주입실패', wantRules, seen: [], miss: [], noise: [],
                      ok: false, why: '주입 실패(탐지 실패가 아니다): ' + e.message });
          continue;
        }
      }
      const r = runChild(SELF, work);
      const miss = wantRules.filter(x => !r.seen.has(x));
      /* 기대 규칙이 없는 케이스(정상이어야 하는 것)는 어떤 지적도 나오면 안 된다 */
      const noise = wantRules.length ? [] : [...r.seen];
      const ok = r.rc === wantRc && !miss.length && !noise.length && !r.contradiction;
      if (!ok) bad++;
      rows.push({ name, wantRc, rc: r.rc, wantRules, seen: [...r.seen].sort(), miss, noise, ok,
                  why: r.contradiction ? ('요약이 자기모순이다: ' + r.contradiction) : undefined });
    }
    /* ★방어를 **하나씩 홀로** 지운 변이체 — 그 방어가 없으면 해당 표본이 다시 rc=0 으로
       새는가를 본다. 새지 않으면 지금의 rc 는 그 방어의 산물이 아니라는 뜻이므로 공허한
       통과다. 앵커를 통짜 문자열로 적으면 이 줄 자신이 두 번째 일치가 되어 죽으니
       조각으로 이어 붙인다(2026-08-31 실측). */
    const toolSrc = fs.readFileSync(SELF, 'utf8');
    const METAS = [
      ['meta:판정불가→rc2 방어 제거', 'star-conflict-route',
       '  if (indets.' + 'length) {', '  if (false) {'],
      ['meta:데이터 모듈 default-only 방어 제거', 'pages-text-named-export',
       "    if (DATA.has(ext)) return { kind: " + "'data-named' };",
       "    if (DATA.has(ext)) return { kind: 'ok' };"],
      ['meta:런타임 모듈 manifest 방어 제거', 'runtime-manifest-broken',
       "    if (!Array.isArray(man)) return { kind: " + "'builtin-unverified', why: noList };",
       "    if (!Array.isArray(man)) return { kind: 'ok' };"],
      /* ★R9 · Node 에게 묻는 두 단을 각각 홀로 지워 본다. */
      ['meta:isBuiltin 실재 판정 제거', 'node-missing-sideeffect',
       "  try { return nodeModule.isBuiltin(spec); } catch " + '{ return false; }',
       '  return true;'],
      /* '런타임 이름 대조' 변이체는 node-unknown-export 로는 격리되지 않는다 — 방어를
         지워도 manifest 부재가 대신 막아 rc 가 그대로다. 같은 앵커를 격리되는 픽스처
         (runtime-manifest-backdoor)로 아래에서 재고 있으므로 중복을 둔다. */
      /* ★탈출구 배선 자체가 살아 있는가 — manifest 를 읽는 경로를 끈으면 (a) 가 다시
         판정 불가로 떨어져야 한다. 그러지 않으면 (a) 의 통과는 manifest 와 무관한 일이다.
         (83fc4b4 이 정확히 그 상태였다 — 배선이 끊겼는데 자기시험 20항목이 전부 PASS 였다.) */
      ['meta:탈출구 배선 끊기', 'runtime-manifest-allows',
       "const RUNTIME_EXPORTS_REL = " + "'tools/runtime-module-exports.json';",
       "const RUNTIME_EXPORTS_REL = 'tools/__nonexistent__.json';", 2],
      ['meta:node manifest 무시 되돌리기', 'runtime-manifest-backdoor',
       "    if (builtinNames && builtinNames.has" + '(spec)) {',
       '    if (false) {'],
      /* ★탈출구 쪽 방어도 홀로 지워 본다 — 목록에 없는 이름을 미달로 잡던 줄을 지우면
         manifest 를 두고도 아무 이름이나 통과하게 된다(탈출구가 뒷문이 되는 경로). */
      ['meta:manifest 목록 대조 제거', 'runtime-manifest-rejects',
       "    if (!man.includes(name)) return { kind: " + "'builtin-missing', why: R.src + ' 의 ' + spec + ' 목록' };",
       "    if (!man.includes(name)) return { kind: 'ok' };", 0],
    ];
    for (const [mname, fixture, anchor, replaced, metaWantRc = 0] of METAS) {
      const n = toolSrc.split(anchor).length - 1;
      if (n !== 1) { setupFail++; rows.push({ name: mname, wantRc: 0, rc: '주입실패',
        wantRules: [], seen: [], miss: [], noise: [], ok: false, meta: true,
        why: `주입 실패(탐지 실패가 아니다): 방어 앵커가 ${n} 곳이다(1곳이어야 한다)` }); continue; }
      const mutatedTool = path.join(stage, 'nogate_' + fixture + '.mjs');
      fs.writeFileSync(mutatedTool, toolSrc.replace(anchor, replaced));
      const work = path.join(stage, 'meta_' + fixture);
      copyTree(path.join(ROOT, 'functions'), path.join(work, 'functions'));
      try { FIXTURES[fixture][1](work); }
      catch (e) { setupFail++; rows.push({ name: mname, wantRc: 0, rc: '주입실패', wantRules: [],
        seen: [], miss: [], noise: [], ok: false, meta: true, why: '주입 실패(탐지 실패가 아니다): ' + e.message }); continue; }
      const mr = runChild(mutatedTool, work);
      /* 방어를 지우면 그 표본이 **옛 rc 로 되돌아가야** 한다 = 그 방어가 일하고 있었다.
         대개는 0(다시 샌다)이지만, 오탐을 없앤 방어라면 옛 rc 가 2 일 수도 있다. */
      const metaOk = mr.rc === metaWantRc;
      if (!metaOk) bad++;
      rows.push({ name: mname, wantRc: metaWantRc, rc: mr.rc, wantRules: [], seen: [], miss: [],
                  noise: [], ok: metaOk, meta: true });
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  console.log('# 검출력 자기시험 — 케이스마다 기대 rc 와 "어느 규칙이 잡아야 하는가" 를 못박고 귀속까지 대조한다');
  for (const r of rows) {
    /* ★Node 의 console.log 는 %-28s 같은 폭 지정을 모른다 — 그대로 찍히고 뒤 인자가 한 칸씩
       밀려 '기대rc=NaN' 같은 헛소리가 나온다(2026-08-31 실측). 폭은 손으로 맞춘다. */
    console.log('  ' + (r.ok ? 'PASS ' : '★FAIL') + ' ' + r.name.padEnd(28)
      + ' 기대rc=' + r.wantRc + ' 실제rc=' + String(r.rc)
      + ' · 잡아야 할 규칙 ' + (r.wantRules.length ? r.wantRules.join(',') : '없음')
      + ' · 실제 ' + (r.seen.length ? r.seen.join(',') : '없음')
      + (r.miss.length ? '  ← 안 잡힌 규칙 ' + r.miss.join(',') : '')
      + (r.noise.length ? '  ← 나오면 안 되는 지적 ' + r.noise.join(',') : ''));
    if (r.why) console.log('        ← ' + r.why);
    if (r.meta && !r.ok && !r.why) console.log('        ← 방어를 지웠는데도 rc 가 그대로다. 지금의 rc 는 이 방어의 산물이 아니다(공허한 통과).');
  }
  console.log('자기시험 결과: rc=%d (항목 %d · 어긋남 %d · 주입실패 %d)',
              (bad || setupFail) ? 1 : 0, rows.length, bad, setupFail);
  return (bad || setupFail) ? 1 : 0;
}

/* ── 진입 ────────────────────────────────────────────────────────────────── */
if (flag('--selftest')) process.exit(selftest());

let scanRoot = ROOT, stageDir = null, wantRule = null;
if (MUTATE) { const s = stageMutation(ROOT, MUTATE); stageDir = s.stage; scanRoot = s.stage; wantRule = s.rule; }
let rc;
try { rc = await run(scanRoot); }
finally { if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true }); }

if (MUTATE) {
  /* 뮤테이션을 걸었으면 '지정 규칙이 잡혔고 다른 규칙이 미달로 울지 않았는가' 까지 판정한다.
     판정 불가(‽)는 앞 단계가 막힌 정직한 결과이므로 잡음으로 세지 않되, 지정 규칙은 ✗나 ‽ 어느
     쪽으로든 반드시 나와야 한다. */
  const caught = failedRules.has(wantRule) || indetRules.has(wantRule);
  const otherFails = [...failedRules].filter(r => r !== wantRule);
  const okOnly = caught && otherFails.length === 0;
  console.log('  검출력 판정: 지정 규칙 [%s] · 미달 규칙 [%s] · 판정 불가 규칙 [%s] → %s',
    wantRule, [...failedRules].sort().join(',') || '없음', [...indetRules].sort().join(',') || '없음',
    okOnly ? 'OK(지정 규칙이 잡았고 다른 규칙은 미달로 울지 않았다)' : '어긋남');
  /* ★종료코드 3분할: 1=지정 규칙이 잡았다 · 3=귀속이 어긋났다 · 2=주입 실패(하네스 오류).
     주입 실패는 stageMutation 이 이미 2 로 끝낸다 — 여기서 어긋남을 3 으로 밀어 둘을 가른다. */
  process.exit(okOnly ? 1 : 3);
}
process.exit(rc);
