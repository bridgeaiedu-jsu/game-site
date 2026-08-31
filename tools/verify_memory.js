/* 기억력 카드(/memory/) 검증기 — worker-3 · 2026-08-31 · 티켓 G-memory-cards
 *
 * 성공 기준 ①②⑥ 중 기계로 확인할 수 있는 것을 확인한다. 기존 검증기(verify_word.js)의 방식을 따른다:
 *   · 인라인 스크립트를 DOM 스텁 위에서 실제로 구동한다(vm)
 *   · 상태를 바꾸는 명령은 **제품 파일에 두지 않고** 여기서 메모리 위에만 덧붙인다(test bridge)
 *   · 판정은 배포되는 관측 창구(window.__mc)와 이 파일이 따로 셈한 값의 대조로 한다
 *
 * 중점 검사(티켓이 못박은 두 함정)
 *   ★시드 결정론 — 플레이 행동(카드 뒤집기)이 난수를 단 한 번도 소비하지 않는가.
 *     Math.random 을 계수기로 바꿔 끼우고 판을 실제로 굴려 호출 수가 0 인지 본다.
 *   ★논리 즉시 확정 — 짝이 아닐 때 '덮이는 연출'을 기다리지 않고 다음 탭이 곧바로 실행되는가.
 *     타이머를 한 번도 돌리지 않은 채 연속으로 눌러 뒤집기 수·상태가 밀리지 않는지 본다.
 *
 * 사용법: node verify_memory.js [--html <경로>] [--mutate <이름>]
 * 종료코드: 0 = 전부 PASS · 1 = 하나라도 FAIL · 2 = 뮤테이션 주입 실패(설정 오류 — 탐지 아님)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
/* 기본 대상은 **이 도구가 놓인 저장소의 /memory/index.html** 이다 — 절대경로를 박아 두면
   worktree 를 갈아탈 때 조용히 남의 파일을 재게 된다(장기기억 verify-which-tree-the-harness-measures). */
const HTML = argOf('--html', path.join(__dirname, '..', 'memory', 'index.html'));
const MUTATION = argOf('--mutate', null);

const RAW = fs.readFileSync(HTML, 'utf8');

/* 인라인 스크립트 중 게임 본체(가장 긴 것)를 고른다 */
function gameSource(html){
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length) { console.error('인라인 스크립트를 찾지 못했다'); process.exit(2); }
  return blocks.sort((a, b) => b.length - a.length)[0];
}

/* ------------------------------------------------------- 뮤테이션(검출력 자기시험)
   ★'주입 실패'와 '결함 탐지'를 종료코드로 가른다 — 주입도 안 된 뮤테이션이 '탐지됨'으로
   집계되면 검출력 표가 거짓이 된다(장기기억 mutation-harness-must-split-setup-error-from-detection). */
const MUTATIONS = {
  /* 논리 확정을 연출 뒤로 미룬다 = 티켓이 금지한 바로 그 결함 */
  'defer-commit': [
    'resolvePending();                                  /* 앞 차례가 남아 있으면 그 자리에서 확정한다 */',
    'if (second >= 0) return { ok:false, why:\'busy\' };'
  ],
  /* 플레이가 난수를 소비하게 만든다 = 시드 결정론 파괴 */
  'rng-on-play': [
    'up[i] = 1; flips++;',
    'up[i] = 1; flips++; Math.random();'
  ],
  /* 배치를 판마다 다시 섞는다 = 같은 seed 가 같은 판을 주지 않는다 */
  'seed-drift': [
    'const rnd = mulberry32(hashStr(boardSeedKey(String(seedKey))));',
    'const rnd = mulberry32((Math.random() * 4294967296) >>> 0);'
  ],
  /* 저장본 검사에서 짝 단위 정합을 뺀다 = 반쪽만 맞춘 저장본이 통과한다 */
  'slot-half-pair': [
    'for (let p = 0; p < d.P; p++) if (cnt[p] === 1) return false;      /* 반쪽만 맞춘 짝은 있을 수 없다 */',
    ''
  ],
  /* 같은 카드를 두 번 세게 한다 */
  'same-card-counts': [
    'if (i === first) return { ok:false, why:\'same\' };   /* 같은 카드를 두 번 세지 않는다 */',
    ''
  ],
  /* 최고 기록 비교를 뒤집는다 */
  'best-worse-wins': [
    'const betterThan = (a, b) => !b || a.f < b.f || (a.f === b.f && a.t < b.t);',
    'const betterThan = (a, b) => !b || a.f > b.f || (a.f === b.f && a.t < b.t);'
  ]
};
let SRC = gameSource(RAW);
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  if (!m){ console.error('알 수 없는 뮤테이션: ' + MUTATION); process.exit(2); }
  const [from, to] = m;
  const n = SRC.split(from).length - 1;
  if (n !== 1){ console.error(`뮤테이션 주입 실패(${MUTATION}) — 앵커가 ${n}회 나타났다(1회여야 한다)`); process.exit(2); }
  SRC = SRC.replace(from, to);
  console.log(`[mutate] ${MUTATION} 주입됨`);
}

/* ------------------------------------------------------- test bridge(메모리 위에만)
   제품 파일에는 관측 창구(__mc)만 배포한다. 상태를 바꾸는 명령은 여기서 IIFE 가 닫히기 직전에
   덧붙인다 — 배포본에는 남지 않는다(장기기억 debug-hooks-in-shipped-code-are-a-control-api). */
const BRIDGE = `
window.__mcTest = {
  start: (m, lv, seed) => startRun(m, lv, seed),
  daily: () => startDaily(),
  resume: () => resumeRun(),
  flip: i => flipCard(i),
  resolve: () => resolvePending(),
  setLevel: lv => setLevel(lv),
  refresh: () => refreshStart(),
  snapshot: () => snapshot(),
  save: () => saveProgress(),
  tick: ms => { const was = paused; paused = false; step(ms / 1000); paused = was; },
  end: () => endRun(),
  setElapsed: ms => { elapsed = ms; },
  firstIdx: () => first,
  secondIdx: () => second
};
`;
const CLOSE = '\n})();';
if (SRC.lastIndexOf(CLOSE) < 0){ console.error('IIFE 닫는 자리를 찾지 못했다'); process.exit(2); }
SRC = SRC.slice(0, SRC.lastIndexOf(CLOSE)) + BRIDGE + CLOSE;

/* ------------------------------------------------------------ 저장소 스텁 */
function makeStore(){
  const map = new Map();
  return {
    _map: map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    clear: () => map.clear(),
    keys: () => [...map.keys()]
  };
}

/* ------------------------------------------------------------ DOM 스텁 */
function makeEl(id, doc, tag){
  const el = {
    id, tagName: (tag || 'DIV').toUpperCase(), dataset: {}, _text: '', innerHTML: '',
    children: [], _attrs: {}, _classes: new Set(), _on: {}, disabled: false, onclick: null,
    hidden: false, tabIndex: -1, parent: null,
    style: { _p: {}, setProperty(k, v){ this._p[k] = v; }, getPropertyValue(k){ return this._p[k]; } },
    classList: {
      add: c => el._classes.add(c), remove: c => el._classes.delete(c),
      contains: c => el._classes.has(c),
      toggle: (c, on) => { if (on === undefined){ el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c); }
                           else if (on) el._classes.add(c); else el._classes.delete(c); }
    },
    setAttribute: (k, v) => { el._attrs[k] = String(v); },
    getAttribute: k => (k in el._attrs ? el._attrs[k] : null),
    removeAttribute: k => { delete el._attrs[k]; },
    hasAttribute: k => k in el._attrs,
    addEventListener: (t, fn) => { el._on[t] = fn; },
    removeEventListener: t => { delete el._on[t]; },
    querySelectorAll: sel => el._descend().filter(c => matchesSel(c, sel)),
    querySelector: sel => el._descend().find(c => matchesSel(c, sel)) || null,
    closest: sel => { let n = el; while (n){ if (matchesSel(n, sel)) return n; n = n.parent || null; } return null; },
    matches: sel => matchesSel(el, sel),
    focus: () => { doc.activeElement = el; }, blur: () => {},
    /* 진짜 DOM 과 같게 — 조각(fragment)을 붙이면 그 자식들이 옮겨 간다 */
    appendChild: c => {
      if (c.tagName === 'FRAGMENT'){ for (const k of c.children.slice()){ el.children.push(k); k.parent = el; } c.children = []; return c; }
      el.children.push(c); c.parent = el; return c;
    },
    _descend: () => { const out = []; const walk = n => { for (const c of n.children){ out.push(c); walk(c); } }; walk(el); return out; }
  };
  Object.defineProperty(el, 'textContent', {
    get(){ return el._text; },
    set(v){ el._text = String(v); if (v === '') { for (const c of el.children) c.parent = null; el.children = []; } }
  });
  Object.defineProperty(el, 'childElementCount', { get(){ return el.children.length; } });
  /* className 은 클래스 목록과 같은 것을 가리켜야 한다 — 따로 두면 .card 선택자가 헛돈다 */
  Object.defineProperty(el, 'className', {
    get(){ return [...el._classes].join(' '); },
    set(v){ el._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  });
  return el;
}
function matchesSel(el, sel){
  if (!sel) return false;
  for (const part of String(sel).split(',')){
    const s = part.trim();
    if (s === 'button' && el.tagName === 'BUTTON') return true;
    if (s === '[data-i18n]' && el.dataset.i18n !== undefined) return true;
    if (s === 'a[href="/"]' && el.tagName === 'A') return true;
    if (s.startsWith('a[href]') && el.tagName === 'A') return true;
    if (s === '.card' && el._classes.has('card')) return true;
    if (s.indexOf('button:not(') === 0 && el.tagName === 'BUTTON' && !el.disabled && !el.hidden) return true;
    if (s === '.front' && el._classes.has('front')) return true;
    if (s === '.overlay' && el._classes.has('overlay')) return true;
  }
  return false;
}
function HTMLElementStub(){}

const IDS = ['grid','flipNow','pairNow','timeNow','modeChip','bestChip','srSummary','toast','over','start',
             'finalFlips','finalReason','marks','streakLine','newBest','nFlip','nTime','nPair','finalSub',
             'btnAgain','btnShare','btnDaily','btnResumeDaily','btnStart','btnRestart','levels','lvDesc',
             'dailyHint','btnSound','btnSound2','btnLang','btnLang2','subtitle','adTop','adOver','startTitle','overTitle'];

function boot(opts){
  opts = opts || {};
  const localStorage = opts.store || makeStore();
  const els = new Map();
  const doc = {
    documentElement: null, body: null, activeElement: null, hidden: false, title: '',
    getElementById: id => { if (!els.has(id)) els.set(id, makeEl(id, doc)); return els.get(id); },
    querySelectorAll: sel => [...els.values()].filter(e => matchesSel(e, sel))
                                .concat([...els.values()].flatMap(e => e._descend().filter(c => matchesSel(c, sel)))),
    querySelector: sel => doc.querySelectorAll(sel)[0] || null,
    createElement: t => makeEl('new_' + t, doc, t),
    createDocumentFragment: () => makeEl('frag', doc, 'fragment'),
    addEventListener: () => {}, removeEventListener: () => {}
  };
  doc.documentElement = makeEl('html', doc);
  doc.body = makeEl('body', doc);
  for (const id of IDS) doc.getElementById(id);
  doc.getElementById('over')._classes.add('overlay');
  doc.getElementById('start')._classes.add('overlay');
  doc.getElementById('start')._classes.add('show');
  /* 난이도 버튼 3개 — 마크업과 같은 부모-자식으로 세운다 */
  for (const lv of ['easy','normal','hard']){
    const b = makeEl('lv_' + lv, doc, 'button');
    b.dataset.lv = lv;
    doc.getElementById('levels').appendChild(b);
  }
  /* data-i18n 요소 몇 개 — applyLang 이 실제로 훑는다 */
  for (const k of ['title','subtitle','hint','how1','dailyDesc','statPlays']){
    const e = makeEl('i18n_' + k, doc, 'p'); e.dataset.i18n = k; els.set('i18n_' + k, e);
  }
  const home = makeEl('home', doc, 'a'); els.set('home', home);

  /* Math.random 계수기 — '플레이가 난수를 소비하지 않는다'를 직접 잰다 */
  let randCalls = 0;
  const realRandom = Math.random;
  const MathStub = Object.create(Math);
  MathStub.random = () => { randCalls++; return realRandom(); };

  const nav = { language: 'ko-KR' };
  const win = {
    addEventListener: () => {}, removeEventListener: () => {},
    navigator: nav, localStorage,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    location: { href: 'https://hanpango.com/memory/' },
    setTimeout, clearTimeout, HTMLElement: HTMLElementStub, document: doc
  };
  const sandbox = {
    window: win, document: doc, localStorage, navigator: nav,
    HTMLElement: HTMLElementStub, location: win.location,
    setTimeout, clearTimeout, console, Math: MathStub, Date, JSON, Promise,
    requestAnimationFrame: win.requestAnimationFrame, cancelAnimationFrame: win.cancelAnimationFrame,
    Uint8Array, Int16Array, Number, String, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(SRC, sandbox, { filename: 'memory-inline.js' }); }
  catch (e){ console.error('구동 실패: ' + e.stack); process.exit(2); }
  if (!win.__mc || !win.__mcTest){ console.error('관측 창구(__mc)/시험 다리(__mcTest) 없음'); process.exit(2); }
  return {
    mc: win.__mc, t: win.__mcTest, doc, store: localStorage,
    txt: id => doc.getElementById(id).textContent,
    el: id => doc.getElementById(id),
    rand: () => randCalls,
    click: i => { const g = doc.getElementById('grid'); const fn = g._on.click;
                  if (!fn) throw new Error('grid click 핸들러 없음');
                  fn({ target: g.children[i] }); }
  };
}

/* ------------------------------------------------------------ 테스트 틀 */
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail){
  if (cond){ pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
const section = t => console.log('\n[' + t + ']');
const note = t => console.log('    · ' + t);

/* 판에서 '아직 안 맞춘 두 카드 중 짝이 아닌 쌍'을 고른다 */
function pickMismatch(b){
  for (let i = 0; i < b.deck.length; i++){
    if (b.done[i]) continue;
    for (let j = i + 1; j < b.deck.length; j++){
      if (b.done[j]) continue;
      if (b.deck[i] !== b.deck[j]) return [i, j];
    }
  }
  return null;
}
function pickPair(b, p){
  const out = [];
  for (let i = 0; i < b.deck.length; i++) if (b.deck[i] === p && !b.done[i]) out.push(i);
  return out;
}

/* ============================================================ 1. 판 만들기·시드 결정론 */
section('1. 판 만들기 · 시드 결정론');
{
  const A = boot();
  const K = A.mc.seedKey();
  const d1 = A.mc.buildDeck('normal', K), d2 = A.mc.buildDeck('normal', K);
  eq('같은 seed 는 같은 배치를 준다(deck)', d1.deck, d2.deck);
  eq('같은 seed 는 같은 그림을 고른다(faceIds)', d1.faceIds, d2.faceIds);

  const other = A.mc.seedKey('2026-01-02T00:00:00');
  ok('다른 날짜 seed 는 다른 배치를 준다',
     JSON.stringify(A.mc.buildDeck('normal', other).deck) !== JSON.stringify(d1.deck));

  /* 구성 검증 — 짝마다 정확히 두 장, 그림은 중복 없음 */
  for (const lv of ['easy','normal','hard']){
    const C = A.mc.const().LV[lv], N = C.C * C.R;
    const b = A.mc.buildDeck(lv, K);
    const cnt = {};
    for (const p of b.deck) cnt[p] = (cnt[p] || 0) + 1;
    const counts = Object.values(cnt);
    ok(`${lv}: 카드 수 = ${N}`, b.deck.length === N, `got=${b.deck.length}`);
    ok(`${lv}: 짝 수 = ${C.P} · 모두 정확히 2장`,
       counts.length === C.P && counts.every(v => v === 2), `counts=${JSON.stringify(counts)}`);
    ok(`${lv}: 그림 중복 없음`, new Set(b.faceIds).size === C.P);
    ok(`${lv}: 2*P = 카드 수`, C.P * 2 === N);
  }
  /* 그림은 전부 이모지(외부 이미지 0) · 이름은 ko/en 둘 다 있다 */
  const faces = A.mc.const().FACES;
  ok('그림 풀 ≥ 가장 큰 난이도의 짝 수', faces.length >= A.mc.const().LV.hard.P, `pool=${faces.length}`);
  ok('그림에 이름이 ko/en 둘 다 있다', faces.every(f => f.e && f.ko && f.en));
  ok('그림 이모지가 서로 다르다', new Set(faces.map(f => f.e)).size === faces.length);
}

/* ============================================================ 2. ★플레이는 난수를 소비하지 않는다 */
section('2. ★시드 결정론 — 플레이 행동이 난수를 소비하지 않는다');
{
  const A = boot();
  A.t.start('daily');
  const b0 = A.mc.board();
  const before = A.rand();
  /* 판을 실제로 굴린다 — 짝 맞추기·엇갈리기를 섞어 30수 이상 */
  for (let p = 0; p < 3; p++){ const [x, y] = pickPair(A.mc.board(), p); A.t.flip(x); A.t.flip(y); }
  for (let k = 0; k < 10; k++){ const mm = pickMismatch(A.mc.board()); if (!mm) break; A.t.flip(mm[0]); A.t.flip(mm[1]); }
  const after = A.rand();
  eq('플레이 중 Math.random 호출 수 = 0', after - before, 0);
  const b1 = A.mc.board();
  eq('플레이 뒤에도 배치(deck)가 그대로다', b1.deck, b0.deck);
  eq('플레이 뒤에도 그림(faceIds)이 그대로다', b1.faceIds, b0.faceIds);
  eq('배치는 seed 로 재현된다', b1.deck, A.mc.buildDeck('normal', A.mc.state().seedKey).deck);
  note(`뒤집기 ${A.mc.state().flips}회 · 맞춘 짝 ${A.mc.state().pairsDone}`);

  /* 두 대의 기기(별도 인스턴스)가 같은 날 같은 판을 받는다 */
  const B = boot();
  B.t.start('daily');
  eq('다른 기기도 같은 날 같은 배치를 받는다', B.mc.board().deck, b0.deck);
}

/* ============================================================ 3. ★논리 즉시 확정(연출만 지연) */
section('3. ★논리 즉시 확정 — 미루는 것은 화면뿐');
{
  const A = boot();
  A.t.start('free', 'normal', 'seed-commit');
  const b = A.mc.board();
  const [i, j] = pickMismatch(b);
  A.t.flip(i); A.t.flip(j);
  eq('짝이 아니면 두 장이 앞면으로 남는다', [A.mc.board().up[i], A.mc.board().up[j]], [1, 1]);
  ok('덮기 예약이 걸려 있다', A.mc.state().pending === true);
  eq('뒤집기 수 = 2', A.mc.state().flips, 2);

  /* ★타이머를 한 번도 돌리지 않은 채 세 번째 카드를 누른다 */
  let k = 0; while (k === i || k === j || A.mc.board().done[k]) k++;
  A.t.flip(k);
  const st = A.mc.state(), bb = A.mc.board();
  eq('앞의 두 장은 그 자리에서 즉시 덮인다', [bb.up[i], bb.up[j]], [0, 0]);
  eq('세 번째 카드는 곧바로 앞면이 된다', bb.up[k], 1);
  eq('뒤집기 수가 밀리지 않는다(=3)', st.flips, 3);
  eq('세 번째 카드가 새 차례의 첫 장이다', A.t.firstIdx(), k);
  ok('앞 차례의 예약은 사라졌다', st.pending === false);

  /* 빠른 연속 클릭 12번 — 화면 이벤트 경로로도 같은지 본다 */
  const B = boot();
  B.t.start('free', 'normal', 'seed-burst');
  const N = B.mc.const().LV.normal.C * B.mc.const().LV.normal.R;
  let expected = 0, prev = -1;
  for (let n = 0; n < 12; n++){
    let idx = n % N;
    if (idx === prev){ idx = (idx + 1) % N; }
    if (B.mc.board().done[idx]) continue;
    B.click(idx);
    expected++;
    prev = B.t.firstIdx() >= 0 ? B.t.firstIdx() : -1;
  }
  eq('연속 클릭 뒤 뒤집기 수가 클릭 수와 같다', B.mc.state().flips, expected);
  const up = B.mc.board().up, done = B.mc.board().done;
  const openUnmatched = up.filter((v, ix) => v === 1 && !done[ix]).length;
  ok('덮이지 않은 앞면은 최대 2장', openUnmatched <= 2, `open=${openUnmatched}`);
  eq('맞춘 카드 수는 짝수', B.mc.board().done.reduce((a, v) => a + v, 0) % 2, 0);

  /* 같은 카드를 두 번 눌러도 한 번만 센다 */
  const D = boot();
  D.t.start('free', 'normal', 'seed-same');
  D.t.flip(0); D.t.flip(0);
  eq('같은 카드 두 번 = 뒤집기 1회', D.mc.state().flips, 1);
  /* 맞춘 카드는 다시 뒤집히지 않는다 */
  const p0 = pickPair(D.mc.board(), D.mc.board().deck[0]);
  D.t.flip(p0[0] === 0 ? p0[1] : p0[0]);
  const flipsAfterMatch = D.mc.state().flips;
  D.t.flip(0);
  eq('이미 맞춘 카드는 세지 않는다', D.mc.state().flips, flipsAfterMatch);
}

/* ============================================================ 4. 짝 맞추기·완주 */
section('4. 짝 맞추기 · 완주 · 기록');
{
  const A = boot();
  A.t.start('free', 'easy', 'seed-clear');
  const P = A.mc.const().LV.easy.P, N = A.mc.const().LV.easy.C * A.mc.const().LV.easy.R;
  for (let p = 0; p < P; p++){ const [x, y] = pickPair(A.mc.board(), p); A.t.flip(x); A.t.flip(y); }
  const st = A.mc.state();
  eq('모든 짝을 맞추면 판이 끝난다', [st.running, st.over], [false, true]);
  eq('완벽 플레이의 뒤집기 수 = 카드 수', st.flips, N);
  const r = A.mc.result();
  ok('완벽 판정이 붙는다', r.perfect === true);
  eq('공유 마크가 전부 🟩', A.mc.marks().replace(/\n/g, ''), '🟩'.repeat(P));
  eq('마크 줄 수 = ceil(P/5)', A.mc.marks().split('\n').length, Math.ceil(P / 5));
  ok('최고 기록이 저장된다', A.mc.best().easy && A.mc.best().easy.f === N,
     JSON.stringify(A.mc.best().easy));
  ok('저장 키는 mc.best.easy', A.store.keys().includes('mc.best.easy'), A.store.keys().join(','));

  /* 헛돌린 판은 마크가 노랑/빨강으로 내려간다 */
  const B = boot();
  B.t.start('free', 'easy', 'seed-waste');
  const mm = pickMismatch(B.mc.board());
  for (let n = 0; n < 3; n++){ B.t.flip(mm[0]); B.t.flip(mm[1]); }
  for (let p = 0; p < P; p++){ const pr = pickPair(B.mc.board(), p); if (pr.length === 2){ B.t.flip(pr[0]); B.t.flip(pr[1]); } }
  ok('헛돌린 짝은 🟩 이 아니다', /🟨|🟥/.test(B.mc.marks()), B.mc.marks().replace(/\n/g, '|'));
  ok('헛돌린 판은 완벽이 아니다', B.mc.result().perfect === false);
}

/* ============================================================ 5. 최고 기록 비교 규칙 */
section('5. 최고 기록 비교 규칙(뒤집기 우선 · 동률이면 시간)');
{
  const A = boot();
  ok('기록이 없으면 무조건 갱신', A.mc.betterThan({ f: 99, t: 999 }, null) === true);
  ok('뒤집기가 적으면 더 좋다', A.mc.betterThan({ f: 20, t: 300 }, { f: 22, t: 10 }) === true);
  ok('뒤집기가 많으면 시간이 짧아도 아니다', A.mc.betterThan({ f: 24, t: 1 }, { f: 22, t: 300 }) === false);
  ok('동률이면 짧은 시간이 더 좋다', A.mc.betterThan({ f: 22, t: 100 }, { f: 22, t: 101 }) === true);
  ok('완전 동률은 갱신이 아니다', A.mc.betterThan({ f: 22, t: 100 }, { f: 22, t: 100 }) === false);
}

/* ============================================================ 6. 저장·복원(고장 입력 검증) */
section('6. 진행 저장·복원 — 고장 입력을 되돌려보낸다(negative case)');
{
  const A = boot();
  A.t.start('daily');
  const bd = A.mc.board();
  A.t.flip(pickPair(bd, 0)[0]); A.t.flip(pickPair(bd, 0)[1]);   /* 한 짝 맞추기 */
  const mm = pickMismatch(A.mc.board()); A.t.flip(mm[0]);        /* 한 장 뒤집어 둔 상태 */
  A.t.save();
  const snap = JSON.parse(A.store.getItem('mc.progress'));
  ok('일일 진행이 mc.progress 에 저장된다', !!snap);
  ok('정상 저장본은 통과한다', A.mc.validSlot(snap) === true);

  const bad = (name, mut) => {
    const s = JSON.parse(JSON.stringify(snap));
    mut(s);
    ok(name, A.mc.validSlot(s) === false);
  };
  bad('날짜가 다르면 거부', s => { s.runDay = '2020-01-01'; });
  bad('회차가 다르면 거부', s => { s.runNo = s.runNo + 1; });
  bad('seed 가 다르면 거부', s => { s.seedKey = s.seedKey + 'x'; });
  bad('난이도가 다르면 거부', s => { s.level = 'hard'; });
  bad('버전이 다르면 거부', s => { s.v = 2; });
  bad('모드가 자유면 거부', s => { s.mode = 'free'; });
  bad('마스크 길이가 다르면 거부', s => { s.done = s.done.slice(1); });
  bad('마스크에 0/1 이 아닌 글자가 있으면 거부', s => { s.done = 'x' + s.done.slice(1); });
  bad('반쪽만 맞춘 짝이 있으면 거부', s => {
    const i = s.done.indexOf('1');
    s.done = s.done.slice(0, i) + '0' + s.done.slice(i + 1);
  });
  bad('맞춘 카드 수보다 뒤집기가 적으면 거부', s => { s.flips = 1; s.pf = s.pf.map(() => 0); s.pf[0] = 1; });
  bad('짝별 뒤집기 합이 총합과 다르면 거부', s => { s.pf = s.pf.slice(); s.pf[0] = s.pf[0] + 5; });
  bad('짝별 배열 길이가 다르면 거부', s => { s.pf = s.pf.slice(1); });
  bad('경과가 음수면 거부', s => { s.elapsed = -1; });
  bad('이미 끝난 판은 거부', s => { s.done = '1'.repeat(s.done.length); s.flips = s.done.length;
                                    s.pf = s.pf.map(() => 2); });
  ok('null 저장본은 거부', A.mc.validSlot(null) === false);
  ok('문자열 저장본은 거부', A.mc.validSlot('nope') === false);

  /* 복원 — 맞춘 짝·뒤집기·경과가 그대로 돌아온다 */
  const flipsBefore = A.mc.state().flips, pairsBefore = A.mc.state().pairsDone;
  A.t.setElapsed(12345); A.t.save();
  const B = boot({ store: A.store });
  ok('이어하기 버튼이 뜬다', B.el('btnResumeDaily').hidden === false);
  ok('이어하기가 성공한다', B.t.resume() === true);
  eq('맞춘 짝이 복원된다', B.mc.state().pairsDone, pairsBefore);
  eq('뒤집기 수가 복원된다', B.mc.state().flips, flipsBefore);
  eq('경과 시간이 복원된다(초)', Math.round(B.mc.state().elapsed / 1000), 12);
  eq('복원된 판의 배치가 같다', B.mc.board().deck, A.mc.board().deck);

  /* 자유 모드는 진행을 저장하지 않는다 */
  const C2 = boot();
  C2.t.start('free', 'normal', 'seed-nosave');
  C2.t.flip(0); C2.t.save();
  ok('자유 모드는 mc.progress 를 만들지 않는다', C2.store.getItem('mc.progress') === null);
}

/* ============================================================ 7. 오늘의 도전 · 스트릭 */
section('7. 오늘의 도전 · 스트릭 · 하루 한 판');
{
  const A = boot();
  A.t.start('daily');
  const P = A.mc.const().LV.normal.P;
  for (let p = 0; p < P; p++){ const [x, y] = pickPair(A.mc.board(), p); A.t.flip(x); A.t.flip(y); }
  ok('완주하면 오늘의 도전이 기록된다', A.mc.daily().done === true);
  eq('스트릭이 1 이 된다', A.mc.daily().streak, 1);
  ok('진행 저장은 지워진다', A.store.getItem('mc.progress') === null);

  const B = boot({ store: A.store });
  ok('같은 날 다시 오면 새 판을 열지 않는다', B.t.daily() === false);
  ok('저장된 결과 화면이 뜬다', B.mc.shown('over') === true);
  const rec = B.mc.daily().rec;
  ok('결과에 마크가 남아 있다', typeof rec.result.marks === 'string' && rec.result.marks.length > 0);
  ok('공유 문구에 회차와 뒤집기 수가 들어간다',
     /#\d+/.test(B.mc.shareText(B.mc.result())) && /\d+/.test(B.mc.shareText(B.mc.result())),
     B.mc.shareText(B.mc.result()).split('\n')[0]);
}

/* ============================================================ 8. 저장 키(방침 고지 대상) */
section('8. 저장 키 — 방침에 고지된 것만 쓴다');
{
  const A = boot();
  A.t.start('daily'); A.t.flip(0); A.t.save();
  A.t.setLevel('hard');
  const B = boot({ store: A.store });
  B.t.start('free', 'easy', 'k');
  const P = B.mc.const().LV.easy.P;
  for (let p = 0; p < P; p++){ const [x, y] = pickPair(B.mc.board(), p); B.t.flip(x); B.t.flip(y); }
  const keys = A.store.keys().sort();
  note('실제로 쓰인 키: ' + keys.join(', '));
  const allowed = ['bp.lang','mc.sound','mc.level','mc.daily','mc.streak','mc.progress','mc.best.easy','mc.best.normal','mc.best.hard'];
  ok('허용 목록 밖의 키를 만들지 않는다', keys.every(k => allowed.includes(k)),
     keys.filter(k => !allowed.includes(k)).join(','));
  ok('언어 키는 사이트 공통(bp.lang)', keys.includes('bp.lang'));
  ok('sessionStorage 는 쓰지 않는다', !/sessionStorage/.test(SRC));
}

/* ============================================================ 9. 정적 마크업·문안 */
section('9. 정적 마크업 · ko/en 이중 문안');
{
  const markup = RAW.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  const A = boot();
  /* i18n 표 — ko 와 en 의 키 집합이 같아야 한다(한쪽 언어만 비는 일이 없게) */
  const src = SRC;
  const koKeys = [...src.matchAll(/\n\s{4}([A-Za-z0-9_]+)\s*:/g)].map(m => m[1]);
  ok('i18n 표를 읽었다', koKeys.length > 20, `keys=${koKeys.length}`);
  /* 마크업의 data-i18n 키가 두 표에 모두 있는지 — 실제 표를 sandbox 에서 꺼내 대조한다 */
  const marks = [...markup.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]);
  ok('마크업에 data-i18n 이 충분히 붙어 있다', marks.length >= 20, `n=${marks.length}`);
  const missing = [];
  for (const k of new Set(marks)){
    const inKo = new RegExp('(^|[^A-Za-z0-9_])' + k + '\\s*:').test(src.slice(src.indexOf('ko: {'), src.indexOf('en: {')));
    const inEn = new RegExp('(^|[^A-Za-z0-9_])' + k + '\\s*:').test(src.slice(src.indexOf('en: {')));
    if (!inKo || !inEn) missing.push(k + (inKo ? '' : '/ko') + (inEn ? '' : '/en'));
  }
  eq('모든 data-i18n 키가 ko·en 양쪽에 있다', missing, []);
  ok('판(grid)에는 data-i18n 을 붙이지 않았다', !/id="grid"[^>]*data-i18n/.test(markup));
  ok('canonical 이 /memory/ 를 가리킨다', /rel="canonical" href="https:\/\/hanpango\.com\/memory\/"/.test(markup));
  ok('manifest·서비스워커 등록이 있다',
     /rel="manifest"/.test(markup) && /serviceWorker/.test(RAW));
  ok('다크/라이트 theme-color 두 줄', (markup.match(/name="theme-color"/g) || []).length === 2);
  ok('prefers-color-scheme 다크 토큰 블록이 있다', /@media \(prefers-color-scheme: dark\)/.test(RAW));
  ok('prefers-reduced-motion 을 존중한다', /@media \(prefers-reduced-motion: reduce\)/.test(RAW));
  ok('맞춘 카드에 색 말고 ✓ 표식이 붙는다', /\.card\.done \.face\.front::after\{content:"✓"/.test(RAW));
  ok('뒷면은 색만이 아니라 무늬로도 구분된다', /repeating-linear-gradient/.test(RAW));

  /* 외부 요청 — 광고·GA·자체 스크립트 외에는 없다 */
  const srcs = [...RAW.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
  const allowedHosts = ['pagead2.googlesyndication.com', 'www.googletagmanager.com'];
  const bad = srcs.filter(s => /^https?:/.test(s) && !allowedHosts.some(h => s.includes(h)));
  eq('허용 밖 외부 스크립트 0', bad, []);
  ok('fetch/XHR 을 직접 쓰지 않는다', !/\bfetch\s*\(/.test(SRC) && !/XMLHttpRequest/.test(SRC));
  ok('카드 그림에 <img> 를 쓰지 않는다(오프라인 유지)', !/<img/.test(markup.split('<section class="content">')[0].split('<main>')[1] || ''));
  ok('그림은 이모지다 — 외부 이미지 0', A.mc.const().FACES.every(f => f.e.length <= 3));
}

/* ============================================================ 10. 언어 전환이 판을 지우지 않는다 */
section('10. 언어 전환 · 접근성 라벨');
{
  const A = boot();
  A.t.start('daily');
  const before = A.mc.board().deck.slice();
  const flipsBefore = A.mc.state().flips;
  A.el('btnLang').onclick();
  eq('언어를 바꿔도 판이 그대로다', A.mc.board().deck, before);
  eq('언어를 바꿔도 진행이 그대로다', A.mc.state().flips, flipsBefore);
  ok('언어가 실제로 바뀐다', A.mc.lang() === 'en');
  const g = A.el('grid');
  const lbl = g.children[0].getAttribute('aria-label');
  ok('카드마다 자리와 상태를 읽어 준다(en)', /row 1 column 1/.test(lbl) && /face down/.test(lbl), lbl);
  A.el('btnLang').onclick();
  const lbl2 = A.el('grid').children[0].getAttribute('aria-label');
  ok('카드 라벨이 ko 로 되돌아온다', /행 1 열 1/.test(lbl2) && /뒷면/.test(lbl2), lbl2);
  /* 맞춘 카드는 라벨로도 '맞춤'을 알린다(색 비의존) */
  const b = A.mc.board();
  const pr = pickPair(b, b.deck[0]);
  A.t.flip(pr[0]); A.t.flip(pr[1]);
  ok('맞춘 카드 라벨에 그림 이름과 맞춤이 들어간다',
     /맞춤/.test(A.el('grid').children[pr[0]].getAttribute('aria-label')),
     A.el('grid').children[pr[0]].getAttribute('aria-label'));
}

/* ============================================================ 결과 */
console.log(`\n${'='.repeat(52)}`);
console.log(`PASS ${pass} · FAIL ${fail}`);
if (fail){ console.log('실패: ' + failures.join(' | ')); process.exit(1); }
console.log('전부 PASS');
process.exit(0);
