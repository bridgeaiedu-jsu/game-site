/* 노노그램 판 검증기 — 2026-08-31 · G-nonogram
 *
 * 무엇을 검증하나
 *   ① 생성기가 낸 판의 단서가 그 판의 해에서 실제로 뽑은 단서와 **한 자리도 어긋나지 않는가**.
 *   ② 그 단서를 만족하는 답이 **정확히 하나뿐인가**. ★이때 게임이 판을 고를 때 쓴 줄 추론기가
 *      아니라, 그것과 **방법이 겹치지 않는 별도 탐색**(가로줄 완성 배치 나열 + 세로줄 앞부분
 *      가지치기)으로 센다. 같은 방법으로 두 번 재면 '스스로 채점' 이 되어 증거가 되지 못한다.
 *   ③ 빈 줄(단서 0)이 없고, 단서 개수가 판형별 상한(MAXCLUE)을 넘지 않는가 —
 *      이 상한이 곧 화면의 단서칸 폭이라, 넘으면 360px 에서 칸이 손가락보다 작아진다.
 *   ④ 어려움 판이 '가로·세로 왕복 추론을 HARD_ROUNDS 번 이상 돌아야 풀린다' 는 조건을 지키는가.
 *   ⑤ **같은 seed 는 같은 판** 인가(두 번 불러 해시 대조) · 오늘의 도전 seed 가 날짜만으로 정해지는가.
 *   ⑥ 배포 파일이 **플레이 중 난수를 당기지 않는가**(정적 대조) — 난수 호출은 판을 짜는 자리와
 *      자유 모드 seed 추첨 한 곳뿐이어야 한다. 플레이 행동이 난수를 소비하면 같은 날짜에
 *      사람마다 다른 판이 나온다.
 *   ⑦ 검증기 자신의 검출력 — 답이 둘인 것으로 알려진 판(2×2 바둑판)을 실제로 '2' 로 세는가.
 *      (세지 못하면 ② 의 PASS 는 아무것도 증명하지 못한다.)
 *
 * 어떻게 검증하나
 *   배포되는 index.html 안의 <script> 를 **그대로 꺼내** 최소 DOM 스텁 위에서 돌리고,
 *   실제 makePuzzle()·countSolutions() 를 호출해 결과를 읽는다. 사본을 만들어 재지 않는다.
 *
 * 사용법:
 *   node verify_nonogram.js --html <경로> [--seeds 60]
 *   node verify_nonogram.js --html <경로> --mutate no-unique-gate   # 방어를 빼면 정말 FAIL 이 나는가
 *
 * 종료코드: 0 = 전부 PASS · 1 = FAIL 있음 · 2 = 검사를 세울 수 없음(스크립트 구동 실패 등)
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const HTML = argOf('--html', null);
const SEEDS = parseInt(argOf('--seeds', '60'), 10);
const MUTATE = argOf('--mutate', null);

if (!HTML) { console.error('--html 이 필요하다'); process.exit(2); }

/* 고의 결함 — 이 검증기가 정말로 잡아내는지 확인하는 용도다(원본 파일은 건드리지 않는다).
   각 항목: [설명, 교체목록] · 교체 하나 = [찾을 문자열, 바꿀 문자열, 나와야 할 곳 수(생략 시 1)].
   실제 개수가 다르면 앵커가 늙은 것이니 조용히 넘기지 않고 rc=2 로 멈춘다.
   ★한 결함이 두 곳을 함께 바꿔야 재현되는 경우가 있어(예: 분기를 밟게 하고 그 분기의 값을 망가뜨리기)
   교체를 목록으로 받는다 — 한 곳만 바꾸면 다른 관문이 계속 막아 결함이 드러나지 않는다. */
const MUTATIONS = {
  /* 유일해 관문 제거 — 줄 추론으로 안 풀리는 판도 그냥 내보낸다 → ② 가 FAIL 이어야 한다 */
  'no-unique-gate': ['유일해 관문(줄 추론 완주 확인) 제거', [
    ["    if (!res.solved) continue;              /* 줄 추론으로 안 끝나면 = 유일해 보장 못 함 → 버린다 */",
     '    /* 관문 제거(고의) */']]],
  /* 난이도 관문 제거 → ④ 가 FAIL 이어야 한다 */
  'no-hard-gate': ['어려움 난이도 관문(왕복 추론 횟수) 제거', [
    ['    if (res.rounds >= needRounds) return info;', '    return info;']]],
  /* 단서 개수 상한 제거 → ③ 이 FAIL 이어야 한다.
     ★이 줄은 본 생성 고리와 완화 고리 두 곳에 똑같이 있다 — 한 곳만 지우면 다른 고리가 계속 막아
     결함이 드러나지 않는다. 그래서 '2곳' 을 못박고 둘 다 지운다(개수가 다르면 앵커 노후화로 rc=2). */
  'no-clue-cap': ['단서 개수 상한(MAXCLUE) 제거', [
    ['    if (maxClueLen(rows) > maxc || maxClueLen(cols) > maxc) continue;',
     '    /* 상한 제거(고의) */', 2]]],
  /* ★최종 보루 분기 강제 도달 — 후보 생성 상한을 0 으로 만들면 두 생성 고리가 한 번도 돌지 않아
     모든 판이 고정 보루 판으로 나온다. 실사용에서는 600회 후보가 전부 탈락해야 닿는 자리라
     이 뮤테이션이 없으면 그 분기는 영영 측정되지 않는다(codex R6 조언).
     기대: ①②②'③③' 이 그대로 PASS — 보루 판도 같은 계약을 지킨다.
     (⑤' '다른 seed → 다른 판' 은 이 빌드에서 성립할 수 없으므로 SKIP 으로 빠진다.) */
  'force-fallback': ['후보 생성 상한을 0 으로 만들어 최종 보루 분기를 강제로 밟는다', [
    ['const GEN_MAX_TRIES = 300;', 'const GEN_MAX_TRIES = 0;']]],
  /* ★보루 판 자체를 예전의 비유일 X자 판으로 되돌린다 + 그 분기를 밟게 한다.
     기대: 고정 판이 관문에서 걸려 makePuzzle 이 null 을 돌려주고, 검증기는 '판 생성 실패' 로
     FAIL 한다. 비유일 판이 판정을 통과해 나가는 일은 없어야 한다(fail-closed 확인). */
  'force-bad-fallback': ['최종 보루 분기를 밟게 하고 그 고정 판을 비유일 판(X자)으로 되돌린다', [
    ['const GEN_MAX_TRIES = 300;', 'const GEN_MAX_TRIES = 0;'],
    ["  5:  '0010001110111110111000100',", "  5:  '1000101010001000101010001',"],
    ["  10: '0011001100011111111011111111111111111111111111111101111111100111111110001111110000011110000000110000'", "  10: '1000000001010000001000100001000001001000000011000000001100000001001000001000010001000000101000000001'"]]],
};

function readHtml(file){
  try { return fs.readFileSync(file, 'utf8'); }
  catch (e) { console.error('파일을 읽지 못했다: ' + file); process.exit(2); }
}
function extractScript(html, file, mutation) {
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let src = blocks.sort((a, b) => b.length - a.length)[0];
  if (!src) { console.error('인라인 스크립트를 찾지 못했다: ' + file); process.exit(2); }
  /* 이 게임의 스크립트는 통째로 즉시실행 함수((() => { ... })();) 안에 들어 있다.
     껍데기 안의 이름은 밖에서 부를 수 없으므로 **껍데기만** 벗겨 같은 코드를 그대로 돌린다.
     (본문은 한 글자도 바꾸지 않는다. 껍데기를 못 찾으면 검사를 세울 수 없다고 보고 중단한다.) */
  const trimmed = src.trim();
  const HEAD = '(() => {', TAIL = '})();';
  if (!trimmed.startsWith(HEAD) || !trimmed.endsWith(TAIL)) {
    console.error('즉시실행 함수 껍데기를 찾지 못했다 — 검사를 세울 수 없다: ' + file);
    process.exit(2);
  }
  src = trimmed.slice(HEAD.length, trimmed.length - TAIL.length);
  if (!mutation) return src;
  const m = MUTATIONS[mutation];
  if (!m) { console.error('모르는 뮤테이션: ' + mutation); process.exit(2); }
  const [desc, edits] = m;
  for (const [from, to, want] of edits){
    const need = want || 1;
    const n = src.split(from).length - 1;
    if (n !== need) { console.error('뮤테이션 앵커가 %d 곳(%d곳이어야 한다): %s ← %s', n, need, mutation, from.trim().slice(0, 60)); process.exit(2); }
    src = src.split(from).join(to);
  }
  console.log('  ★고의 결함 주입: %s — %s (교체 규칙 %d개)', mutation, desc, edits.length);
  return src;
}

/* ------------------------------------------------------- 최소 DOM 스텁 */
function makeEl(id) {
  const el = {
    id, tagName: 'DIV', dataset: {}, textContent: '', innerHTML: '', value: '', type: '',
    hidden: false, disabled: false, tabIndex: 0, isConnected: true, children: [], _attrs: {}, _classes: new Set(),
    style: { setProperty: () => {}, removeProperty: () => {}, getPropertyValue: () => '' },
    classList: { add: c => el._classes.add(c), remove: c => el._classes.delete(c),
                 contains: c => el._classes.has(c),
                 toggle: (c, on) => (on === undefined ? (el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c))
                                                      : (on ? el._classes.add(c) : el._classes.delete(c))) },
    setAttribute: (k, v) => { el._attrs[k] = String(v); },
    getAttribute: k => (k in el._attrs ? el._attrs[k] : null),
    removeAttribute: k => { delete el._attrs[k]; },
    hasAttribute: k => k in el._attrs,
    addEventListener: () => {}, removeEventListener: () => {},
    querySelectorAll: () => [], querySelector: () => null, closest: () => null, matches: () => false,
    getBoundingClientRect: () => ({ width: 360, height: 360, top: 0, left: 0, right: 360, bottom: 360 }),
    focus: () => {}, blur: () => {}, setPointerCapture: () => {}, releasePointerCapture: () => {},
    appendChild: c => { el.children.push(c); return c; },
    get offsetWidth(){ return 360; },
  };
  return el;
}
function makeSandbox() {
  const els = new Map();
  const el = id => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const doc = {
    documentElement: makeEl('html'), body: makeEl('body'), activeElement: null, hidden: false,
    title: '', getElementById: id => el(id), querySelectorAll: () => [], querySelector: () => null,
    createElement: () => makeEl('created'), createDocumentFragment: () => makeEl('frag'),
    elementFromPoint: () => null,
    addEventListener: () => {}, removeEventListener: () => {},
  };
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); }, clear: () => store.clear(),
  };
  const win = {
    addEventListener: () => {}, removeEventListener: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, devicePixelRatio: 1,
    navigator: { language: 'ko-KR', share: null, clipboard: null, vibrate: () => {} }, localStorage,
    getComputedStyle: () => ({ getPropertyValue: n => n, visibility: 'visible' }),
    location: { href: 'https://hanpango.com/nonogram/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    document: doc, matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    AudioContext: function () { return { createOscillator: () => ({ connect: () => {}, start: () => {}, stop: () => {}, frequency: { value: 0 } }),
                                          createGain: () => ({ connect: () => {}, gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } }),
                                          state: 'running', resume: () => {}, currentTime: 0, destination: {} }; },
  };
  const sandbox = {
    window: win, document: doc, localStorage, navigator: win.navigator,
    getComputedStyle: win.getComputedStyle, requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame, location: win.location,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout,
    setInterval: win.setInterval, clearInterval: win.clearInterval,
    matchMedia: win.matchMedia, console, Math, Date, JSON,
    AudioContext: win.AudioContext, webkitAudioContext: win.AudioContext,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}
function boot(file, html, mutation) {
  const src = extractScript(html, file, mutation);
  const sandbox = makeSandbox();
  try { vm.runInContext(src, sandbox, { filename: file }); }
  catch (e) { console.error('구동 실패(%s): %s', file, e.message); process.exit(2); }
  if (!sandbox.window.__ng) { console.error('관측 창구(window.__ng) 가 없다 — 검사를 세울 수 없다'); process.exit(2); }
  return sandbox;
}

/* ------------------------------------------------------------ 테스트 틀 */
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
};

const html = readHtml(HTML);
console.log('=== 노노그램 판 검증 ===');
console.log('  대상: ' + HTML);
console.log('  판형×난이도 6조합 × seed ' + SEEDS + '개 = ' + (6 * SEEDS) + '판을 실제 makePuzzle() 로 만들어 본다.');
console.log('');

const box = boot(HTML, html, MUTATE);
const NG = box.window.__ng;
const K = NG.const();

/* ⑦ 먼저 검증기의 검출력을 확인한다 — 답이 둘인 판을 '2' 로 세지 못하면 아래 ② 는 무의미하다.
   2×2 에 가로 단서 [1],[1] · 세로 단서 [1],[1] 은 대각선 두 가지가 모두 답이다(널리 알려진 사실). */
{
  const two = NG.countSolutions([[1],[1]], [[1],[1]], 2, 5);
  ok('검출력 자기시험 — 답이 둘인 2×2 판을 2 로 센다', two === 2, '센 값 ' + two);
  /* 답이 하나뿐인 판도 1 로 세는가(반대 방향 · 3×3 십자) */
  const one = NG.countSolutions([[1],[3],[1]], [[1],[3],[1]], 3, 5);
  ok('검출력 자기시험 — 답이 하나뿐인 3×3 십자를 1 로 센다', one === 1, '센 값 ' + one);
}

/* ①②③④ 다판 검사 */
const bad = { clue:[], uniq:[], empty:[], cap:[], hard:[], solve:[], none:[] };
let made = 0, fallbacks = 0, fixedUsed = 0;
const roundsBy = {};
for (const size of K.SIZES){
  for (const level of K.LEVELS){
    const key = size + '/' + level;
    roundsBy[key] = [];
    for (let s = 0; s < SEEDS; s++){
      const seed = `verify-${size}-${level}-${s}`;
      const info = NG.makePuzzle(size, level, seed);
      made++;
      /* ★판을 유일해로 만들지 못하면 생성기는 null 을 돌려준다(fail-closed) — 게임은 시작하지 않는다.
         여기서는 예외로 죽지 말고 '판이 안 나왔다' 는 사실만 세고 넘어간다. 비유일 판이 나오는 것과
         판이 안 나오는 것은 전혀 다른 사건이라, 뭉뚱그리면 어느 쪽인지 알 수 없게 된다. */
      if (!info){ bad.none.push(seed); continue; }
      if (info.fallback) fallbacks++;
      if (info.fixed) fixedUsed++;
      roundsBy[key].push(info.rounds);
      const N = info.size;
      /* ① 단서가 해에서 뽑은 단서와 같은가 */
      const re = NG.cluesOf(info.solution, N);
      const same = JSON.stringify(re) === JSON.stringify({ rows: info.rows, cols: info.cols });
      if (!same) bad.clue.push(seed);
      /* ③ 빈 줄 없음 · 단서 개수 상한 */
      const len = cl => (cl.length === 1 && cl[0] === 0) ? 0 : cl.length;
      const all = info.rows.concat(info.cols);
      if (all.some(cl => len(cl) === 0)) bad.empty.push(seed);
      if (all.some(cl => len(cl) > K.MAXCLUE[N])) bad.cap.push(seed + ' (최대 ' + Math.max(...all.map(len)) + ')');
      /* ② 답이 정확히 하나 — ★줄 추론기가 아닌 독립 탐색으로 센다 */
      const cnt = NG.countSolutions(info.rows, info.cols, N, 2);
      if (cnt !== 1) bad.uniq.push(seed + ' (답 ' + (cnt >= 2 ? '2개 이상' : cnt + '개') + ')');
      /* 줄 추론으로도 끝까지 풀리는가(찍기 없이 사람이 풀 수 있다는 계약) */
      if (!NG.lineSolve(info.rows, info.cols, N).solved) bad.solve.push(seed);
      /* ④ 어려움 관문 */
      if (level === 'hard' && !info.fallback && info.rounds < K.HARD_ROUNDS[N]) bad.hard.push(seed + ' (라운드 ' + info.rounds + ')');
    }
  }
}
const first = a => a.slice(0, 3).join(', ') + (a.length > 3 ? ` 외 ${a.length - 3}건` : '');
/* ★실제로 **판정한** 판 수. 판이 하나도 안 나온 빌드에서 '위반 0건' 은 지켰다는 뜻이 아니라
   잰 것이 없다는 뜻이다 — 관측 0건을 통과로 세지 않는다. */
const judged = made - bad.none.length;
ok(`① 단서 정합 — ${judged}판 모두 해에서 뽑은 단서와 일치`, judged > 0 && bad.clue.length === 0,
   judged ? (bad.clue.length + '판 불일치: ' + first(bad.clue)) : '판정한 판이 0개다(잰 것이 없다)');
ok(`①' 판 생성 — ${made}판 모두 판이 나왔다(유일해를 못 만들어 멈춘 판 0)`, bad.none.length === 0,
   bad.none.length + '판 생성 실패: ' + first(bad.none));
ok(`② 유일해 — ${judged}판 모두 독립 탐색으로 센 답이 정확히 1개`, judged > 0 && bad.uniq.length === 0,
   judged ? (bad.uniq.length + '판 위반: ' + first(bad.uniq)) : '판정한 판이 0개다(잰 것이 없다)');
ok(`②' 찍기 없이 풀림 — ${judged}판 모두 줄 추론만으로 완주`, judged > 0 && bad.solve.length === 0,
   judged ? (bad.solve.length + '판 위반: ' + first(bad.solve)) : '판정한 판이 0개다(잰 것이 없다)');
ok(`③ 빈 줄 없음 — ${judged}판 모두 모든 줄에 단서가 있다`, judged > 0 && bad.empty.length === 0,
   judged ? (bad.empty.length + '판 위반: ' + first(bad.empty)) : '판정한 판이 0개다(잰 것이 없다)');
ok(`③' 단서 개수 상한(5×5≤${K.MAXCLUE[5]} · 10×10≤${K.MAXCLUE[10]})`, judged > 0 && bad.cap.length === 0,
   judged ? (bad.cap.length + '판 위반: ' + first(bad.cap)) : '판정한 판이 0개다(잰 것이 없다)');
ok(`④ 어려움 관문 — 왕복 추론 5×5≥${K.HARD_ROUNDS[5]} · 10×10≥${K.HARD_ROUNDS[10]}`, judged > 0 && bad.hard.length === 0,
   judged ? (bad.hard.length + '판 위반: ' + first(bad.hard)) : '판정한 판이 0개다(잰 것이 없다)');

/* ⑤ 결정론 */
{
  const a = NG.makePuzzle(10, 'normal', 'det-check-1');
  const b = NG.makePuzzle(10, 'normal', 'det-check-1');
  const c = NG.makePuzzle(10, 'normal', 'det-check-2');
  ok('⑤ 같은 seed → 같은 판', !!a && !!b && a.hash === b.hash && a.solution.join('') === b.solution.join(''),
     a && b ? `${a.hash} vs ${b.hash}` : '판이 나오지 않았다');
  /* ★고정 보루 판은 seed 와 무관하게 같은 그림이다 — 그 빌드에서는 이 대조가 성립하지 않으므로
     통과로 접지 말고 건너뛴 사실을 남긴다(관측하지 않은 것을 통과로 세지 않는다). */
  if (a && c && (a.fixed || c.fixed)){
    console.log("  SKIP  ⑤' 다른 seed → 다른 판 — 이 빌드는 모든 판이 고정 보루 판이라 대조가 성립하지 않는다");
  } else {
    ok("⑤' 다른 seed → 다른 판", !!a && !!c && a.hash !== c.hash, a && c ? ('같은 해시가 나왔다: ' + a.hash) : '판이 나오지 않았다');
  }
  const k1 = NG.seedKey('2026-09-01T00:30:00'), k2 = NG.seedKey('2026-09-01T23:30:00'), k3 = NG.seedKey('2026-09-02T00:30:00');
  ok('⑤" 오늘의 도전 seed 는 날짜만으로 정해진다', k1 === k2 && k1 !== k3, `${k1} / ${k2} / ${k3}`);
  const d1 = NG.makePuzzle(K.DAILY_SIZE, K.DAILY_LEVEL, k1);
  const d2 = NG.makePuzzle(K.DAILY_SIZE, K.DAILY_LEVEL, k2);
  ok('⑤‴ 같은 날짜의 오늘의 도전은 같은 그림', !!d1 && !!d2 && d1.hash === d2.hash,
     d1 && d2 ? `${d1.hash} vs ${d2.hash}` : '판이 나오지 않았다');
}

/* ⑥ 플레이 중 난수 소비 금지 — 배포 파일 정적 대조.
   Math.random 은 '자유 모드 seed 추첨' 한 곳만 허용한다. 판을 짜는 난수는 mulberry32(seed) 다. */
{
  const scriptSrc = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).join('\n');
  const hits = (scriptSrc.match(/Math\s*\.\s*random\s*\(/g) || []).length;
  ok('⑥ Math.random 호출은 자유 모드 seed 추첨 1곳뿐', hits === 1, hits + '곳에서 불린다(플레이 중 난수 소비 의심)');
  const inMake = /function makePuzzle[\s\S]*?\n}/.exec(scriptSrc);
  ok("⑥' 생성기 안에서는 Math.random 을 쓰지 않는다(seed 난수만)",
     !!inMake && !/Math\s*\.\s*random/.test(inMake[0]), '생성기 본문에서 Math.random 이 보인다');
}

/* ⑦ 최종 보루(고정 판) — 실사용에서는 600회 후보가 전부 탈락해야 닿는 분기라, 다판 검사만으로는
   **영영 측정되지 않는다**. 도달 확률이 낮다는 것은 유일해 보장이 아니므로(codex R6), 그 분기의
   산출물을 여기서 직접, 매 실행 잰다. 답 개수는 limit 2 가 아니라 20 까지 세어 '정확히 1' 을 못박는다. */
{
  const len = cl => (cl.length === 1 && cl[0] === 0) ? 0 : cl.length;
  for (const N of K.SIZES){
    const info = NG.fixedFallback(N, 'normal', 'fallback-check');
    ok(`⑦ ${N}×${N} 최종 보루 판이 관문을 통과해 나온다`, !!info, '판이 null 이다 — 고정 판이 관문에서 걸렸다');
    if (!info) continue;
    const re = NG.cluesOf(info.solution, N);
    ok(`⑦' ${N}×${N} 보루 판의 단서가 해에서 뽑은 단서와 같다`,
       JSON.stringify(re) === JSON.stringify({ rows: info.rows, cols: info.cols }));
    const all = info.rows.concat(info.cols);
    ok(`⑦" ${N}×${N} 보루 판에 빈 줄이 없고 단서 개수가 상한(${K.MAXCLUE[N]}) 이내다`,
       !all.some(cl => len(cl) === 0) && !all.some(cl => len(cl) > K.MAXCLUE[N]),
       '최대 ' + Math.max(...all.map(len)));
    ok(`⑦‴ ${N}×${N} 보루 판은 줄 추론만으로 완주한다(찍기 없이 풀린다)`,
       NG.lineSolve(info.rows, info.cols, N).solved);
    const cnt = NG.countSolutions(info.rows, info.cols, N, 20);
    ok(`⑦⁗ ${N}×${N} 보루 판의 답이 정확히 1개(20까지 세어 확인)`, cnt === 1, '센 값 ' + cnt);
    ok(`⑦⁵ ${N}×${N} 보루 판에 fixed 표시가 붙는다(로그에서 구별된다)`, info.fixed === true);
  }
}

/* 참고 수치 — 판정에는 쓰지 않는다 */
console.log('');
console.log('  · 만든 판 ' + made + '개 · 난이도 관문을 못 넘겨 완화된 판(fallback) ' + fallbacks +
            '개 · 그중 최종 보루 고정 판 ' + fixedUsed + '개 · 유일해를 못 만들어 멈춘 판 ' + bad.none.length + '개');
for (const k of Object.keys(roundsBy)){
  const a = roundsBy[k];
  console.log(`  · ${k} 왕복 추론 라운드 최소 ${Math.min(...a)} · 평균 ${(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2)} · 최대 ${Math.max(...a)}`);
}
console.log('');
console.log(`결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
