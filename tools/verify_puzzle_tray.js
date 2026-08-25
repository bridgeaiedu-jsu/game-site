/* 블록 퍼즐 트레이 색 검증기 — 2026-08-23 · T0823-rainbow
 *
 * 무엇을 검증하나
 *   ① 한 트레이에 놓이는 세 조각의 색이 **항상 서로 다른가**(무지개 7색 순환 배정의 약속).
 *   ② 색 배정 규칙이 '조각 종류 → 7색 순환' 인가(겹치지 않을 때는 종류가 색을 정한다).
 *   ③ 색을 바꾸면서 **뽑히는 모양은 하나도 달라지지 않았는가**(게임 로직 불변).
 *      같은 난수 흐름을 넣고 바뀌기 전 파일(git HEAD)과 모양 순서를 통째로 대조한다.
 *
 * 어떻게 검증하나
 *   배포되는 index.html 안의 <script> 를 **그대로 꺼내** 최소 DOM 스텁 위에서 돌리고,
 *   실제 refillTray() 를 호출해 그 결과(tray)를 읽는다. 사본을 만들어 재지 않는다.
 *
 * 사용법:
 *   node verify_puzzle_tray.js --html <경로> [--baseline <바뀌기 전 파일>] [--rounds 5000]
 *   node verify_puzzle_tray.js --html <경로> --mutate no-dedup   # 방어를 빼면 정말 FAIL 이 나는가
 *
 * 종료코드: 0 = 전부 PASS · 1 = FAIL 있음 · 2 = 검사를 세울 수 없음(스크립트 구동 실패 등)
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const HTML = argOf('--html', null);
const BASELINE = argOf('--baseline', null);
const ROUNDS = parseInt(argOf('--rounds', '5000'), 10);
const MUTATE = argOf('--mutate', null);

if (!HTML) { console.error('--html 이 필요하다'); process.exit(2); }

/* 고의 결함 — 이 검증기가 정말로 잡아내는지 확인하는 용도다(원본 파일은 건드리지 않는다). */
const MUTATIONS = {
  'no-dedup': ['트레이 색 겹침 방지를 제거',
               '  if (taken){ for (let i = 0; i < COLORS.length && taken.indexOf(COLORS[k]) >= 0; i++) k = (k + 1) % COLORS.length; }',
               '  /* 방어 제거(고의) */'],
  'random-color': ['색을 조각 종류가 아니라 난수로 배정',
                   '  let k = s % COLORS.length;',
                   '  let k = Math.floor(Math.random() * COLORS.length);'],
};

function extractScript(file, mutation) {
  let html;
  try { html = fs.readFileSync(file, 'utf8'); }
  catch (e) { console.error('파일을 읽지 못했다: ' + file); process.exit(2); }
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
  const [desc, from, to] = m;
  const n = src.split(from).length - 1;
  if (n !== 1) { console.error('뮤테이션 앵커가 %d 곳(1곳이어야 한다): %s', n, mutation); process.exit(2); }
  console.log('  ★고의 결함 주입: %s — %s', mutation, desc);
  return src.split(from).join(to);
}

/* ------------------------------------------------------- 최소 DOM 스텁 */
function makeCtx() {
  const noop = () => {};
  return { setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop,
           moveTo: noop, lineTo: noop, arcTo: noop, arc: noop, rect: noop, roundRect: noop,
           quadraticCurveTo: noop, bezierCurveTo: noop, ellipse: noop, closePath: noop,
           fill: noop, stroke: noop, clip: noop, translate: noop, scale: noop, rotate: noop,
           save: noop, restore: noop, drawImage: noop, measureText: () => ({ width: 0 }),
           fillText: noop, strokeText: noop, createLinearGradient: () => ({ addColorStop: noop }),
           fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '' };
}
function makeEl(id) {
  const el = {
    id, tagName: 'DIV', dataset: {}, style: {}, textContent: '', innerHTML: '', value: '',
    width: 300, height: 300, isConnected: true, children: [], _attrs: {}, _classes: new Set(),
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
    getBoundingClientRect: () => ({ width: el.width, height: el.height, top: 0, left: 0,
                                    right: el.width, bottom: el.height }),
    getContext: () => makeCtx(),
    focus: () => {}, blur: () => {}, setPointerCapture: () => {}, releasePointerCapture: () => {},
    appendChild: c => { el.children.push(c); return c; },
  };
  return el;
}

/* 토큰 값 대신 토큰 이름을 그대로 돌려준다 — 이 검사는 '어떤 토큰이 배정됐는가' 만 보면 된다.
   (실제 색 값이 규격을 지키는지는 check_rainbow.py 가 따로 계산으로 판정한다.) */
function makeSandbox(seed) {
  const els = new Map();
  const el = id => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const doc = {
    documentElement: makeEl('html'), body: makeEl('body'), activeElement: null, hidden: false,
    title: '', getElementById: id => el(id), querySelectorAll: () => [], querySelector: () => null,
    createElement: () => makeEl('created'), addEventListener: () => {}, removeEventListener: () => {},
  };
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); }, clear: () => store.clear(),
  };
  /* 난수는 고정된 흐름으로 바꾼다 — 그래야 '모양 순서가 그대로인가' 를 대조할 수 있다. */
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const MathStub = Object.create(Math);
  MathStub.random = rand;
  const win = {
    addEventListener: () => {}, removeEventListener: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, devicePixelRatio: 1,
    navigator: { language: 'ko-KR' }, localStorage,
    getComputedStyle: () => ({ getPropertyValue: n => n, visibility: 'visible' }),
    location: { href: 'https://hanpango.com/block-puzzle/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    document: doc, matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    AudioContext: function () { return { createOscillator: () => ({ connect: () => {}, start: () => {}, stop: () => {}, frequency: { value: 0 } }),
                                          createGain: () => ({ connect: () => {}, gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } }),
                                          currentTime: 0, destination: {} }; },
  };
  const sandbox = {
    window: win, document: doc, localStorage, navigator: win.navigator,
    getComputedStyle: win.getComputedStyle, requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame, location: win.location,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout,
    setInterval: win.setInterval, clearInterval: win.clearInterval,
    matchMedia: win.matchMedia, console, Math: MathStub, Date, JSON,
    AudioContext: win.AudioContext, webkitAudioContext: win.AudioContext,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function boot(file, seed, mutation) {
  const src = extractScript(file, mutation);
  const sandbox = makeSandbox(seed);
  try { vm.runInContext(src, sandbox, { filename: file }); }
  catch (e) { console.error('구동 실패(%s): %s', file, e.message); process.exit(2); }
  return sandbox;
}

/* ------------------------------------------------------------ 테스트 틀 */
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
};

console.log('=== 블록 퍼즐 트레이 색 검증 ===');
console.log('  대상: ' + HTML);
console.log('  트레이 ' + ROUNDS + '벌을 실제 refillTray() 로 만들어 본다.');
console.log('');

const box = boot(HTML, 20260823, MUTATE);
let trays;
try {
  trays = vm.runInContext(
    '(function(){ const out=[]; for(let i=0;i<' + ROUNDS + ';i++){ refillTray();' +
    ' out.push(tray.map(p=>({token:p.token||p.color, shape:JSON.stringify(p.shape)}))); } return out; })()',
    box);
} catch (e) {
  console.error('refillTray 를 부르지 못했다: ' + e.message);
  process.exit(2);
}

/* ① 세 조각의 색이 서로 다른가 */
let dup = 0, firstDup = null;
for (let i = 0; i < trays.length; i++) {
  const t = new Set(trays[i].map(p => p.token));
  if (t.size !== 3) { dup++; if (!firstDup) firstDup = JSON.stringify(trays[i]); }
}
ok('트레이 ' + ROUNDS + '벌 모두 세 조각의 색이 서로 다르다', dup === 0,
   dup + '벌에서 색이 겹쳤다 (예: ' + firstDup + ')');

/* 색이 실제로 7가지가 다 쓰이는가 — 한 색으로 몰리면 '무지개' 가 아니다 */
const count = {};
for (const t of trays) for (const p of t) count[p.token] = (count[p.token] || 0) + 1;
const used = Object.keys(count).sort();
ok('7색이 모두 쓰인다', used.length === 7, '쓰인 색 ' + used.length + '가지: ' + used.join(' '));
console.log('        색별 사용 횟수: ' + used.map(k => k + '=' + count[k]).join(' '));

/* ② 같은 모양은 (겹치지 않는 한) 늘 같은 색 — 트레이 첫 조각은 절대 밀리지 않으므로 그것으로 본다 */
const baseOf = new Map();
let ruleBreak = 0, ruleEx = null;
for (const t of trays) {
  const p = t[0];
  if (!baseOf.has(p.shape)) baseOf.set(p.shape, p.token);
  else if (baseOf.get(p.shape) !== p.token) {
    ruleBreak++;
    if (!ruleEx) ruleEx = p.shape + ' → ' + baseOf.get(p.shape) + ' / ' + p.token;
  }
}
ok('조각 종류가 색을 정한다(트레이 첫 조각 기준 · 종류 ' + baseOf.size + '가지)', ruleBreak === 0,
   ruleBreak + '건 어긋남 (예: ' + ruleEx + ')');

/* ③ 게임 로직 불변 — 같은 난수 흐름에서 뽑히는 모양 순서가 바뀌기 전과 똑같은가 */
if (BASELINE) {
  const old = boot(BASELINE, 20260823, null);
  let oldTrays;
  try {
    oldTrays = vm.runInContext(
      '(function(){ const out=[]; for(let i=0;i<' + ROUNDS + ';i++){ refillTray();' +
      ' out.push(tray.map(p=>JSON.stringify(p.shape))); } return out; })()', old);
  } catch (e) { console.error('바뀌기 전 파일 구동 실패: ' + e.message); process.exit(2); }
  const nowShapes = trays.map(t => t.map(p => p.shape));
  let diff = -1;
  for (let i = 0; i < ROUNDS; i++) {
    if (JSON.stringify(nowShapes[i]) !== JSON.stringify(oldTrays[i])) { diff = i; break; }
  }
  ok('같은 난수 흐름에서 뽑히는 모양 ' + (ROUNDS * 3) + '개가 바뀌기 전과 완전히 같다', diff < 0,
     diff >= 0 ? (diff + 1) + '번째 트레이부터 달라졌다' : '');
} else {
  console.log('  (건너뜀) --baseline 을 주면 바뀌기 전 파일과 모양 순서를 대조한다');
}

console.log('');
console.log('==== 결과: PASS ' + pass + ' · FAIL ' + fail + ' ====');
process.exit(fail ? 1 : 0);
