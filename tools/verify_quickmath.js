#!/usr/bin/env node
/* verify_quickmath.js — 「빠른 셈」 검증 (판은 시작될 때 정해지고, 그 뒤로 아무도 못 바꾼다)
 *
 * `quick-math/index.html` 의 인라인 스크립트를 **그대로 꺼내** 최소 DOM 스텁 위에서 돌린다.
 * 시험용 뒷문은 제품에 두지 않는다 — 배포본의 `window.__quickmath` 는 **읽기 전용 창구**이고,
 * 재현성은 **하네스가 자기 쪽에서** 만든다(스텁이 시계를 쥔다).
 *
 * 이 게임에 실린 약속 중 무게가 큰 넷:
 *   ★① 한 판의 문제·오답·보기 순서는 **판이 시작될 때 전부 정해진다** — 행동은 난수를 안 쓴다.
 *   ★② 같은 날이면 같은 판, 다른 날이면 다른 판.
 *   ★③ 재추첨 사유는 **결정론 조건**(값 범위·중복)뿐이다 — 시간·성능 기반 재시도 없음.
 *   ★④ 난이도는 **문제 번호**로만 정해진다(맞고 틀림이 아니라).
 *
 * ★검사는 제품의 함수로 제품을 채점하지 않는다 — 계단·값 범위·오답 조건은 이 파일이
 *   **자기 것으로 다시 세어** 대조한다.
 *
 * 사용법:
 *   node tools/verify_quickmath.js
 *   node tools/verify_quickmath.js --html quick-math/index.html
 *   node tools/verify_quickmath.js --only <검사이름>
 *   node tools/verify_quickmath.js --list-mutations
 *   node tools/verify_quickmath.js --mutate m-choice-consumes-rng
 *
 * 종료코드: 0 = 전부 통과 · 1 = 미달 있음 · 2 = 검사를 세울 수 없음(하네스·주입 실패)
 *   · 3 = 주입은 됐는데 ★지목한 검사가 잡지 못했다(검사가 공허하다).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = n => argv.indexOf(n) >= 0;

const HTML = argOf('--html', path.join(__dirname, '..', 'quick-math', 'index.html'));
const ONLY = argOf('--only', null);
const MUTATION = argOf('--mutate', null);

/* ------------------------------------------------------------ 뮤테이션 표
   ★각 항은 '어느 검사가 잡아야 하는지'를 못박는다(target). 다른 검사가 우연히 깨진 것은
   검출로 세지 않는다 — 그것은 무임승차다. */
const MUTATIONS = {
  'm-play-rebuilds-deck': {
    why: '정답을 맞힐 때마다 남은 문제를 맞힌 개수로 다시 굴린다 — 많이 틀린 사람과 다른 문제를 보게 된다',
    target: '행동이 난수를 소비하지 않는다',
    apply: s => s.replace('    idx++; dead = [];',
                          '    idx++; dead = []; deck = deck.slice(0, idx).concat(makeDeck(seedKeyNow + score).slice(idx));')
  },
  'm-deck-uses-clock': {
    why: '판 짜기에 시계를 섞는다 — 같은 seed 가 기기·시각마다 다른 판이 된다',
    /* ★동적으로는 안 보인다 — 하네스가 시계를 고정하기 때문이다(그것이 재현성의 조건이다).
       기기 사이의 갈라짐은 ★정적 검사가 잡는다. 지목을 그 검사로 옮긴다. */
    target: '판 짜기에 시계·성능이 안 섞인다',
    apply: s => s.replace('  const rng = mulberry32(hashStr(seedKey));',
                          '  const rng = mulberry32(hashStr(seedKey) + (Date.now() & 7));')
  },
  'm-seed-ignores-day': {
    why: '오늘의 도전 seed 에서 날짜를 뺀다 — 다른 날도 같은 판이 된다',
    target: '다른 날 = 다른 판',
    apply: s => s.replace("const dailySeedKey = (d) => 'hanpango-daily-quick-math-' + dayKey(d);",
                          "const dailySeedKey = (d) => 'hanpango-daily-quick-math-fixed';")
  },
  'm-tier-follows-score': {
    why: '난이도를 문제 번호가 아니라 맞힌 개수로 정한다',
    target: '난이도 계단은 문제 번호로만 정해진다',
    apply: s => s.replace('function tierOf(no){ return no <= 5 ? 1 : no <= 12 ? 2 : 3; }',
                          'function tierOf(no){ const n = (typeof score === "number" ? score : no); return n <= 5 ? 1 : n <= 12 ? 2 : 3; }')
  },
  'm-negative-answer': {
    why: '뺄셈에서 자리 교환을 없앤다 — 답이 음수가 된다',
    target: '값 범위와 연산 규칙',
    apply: s => s.replace("    if (op === '−' && b > a){ const s = a; a = b; b = s; }   /* 음수를 피한다 — 재추첨이 아니라 자리 교환 */", '')
  },
  'm-division-not-exact': {
    why: '나눗셈을 딱 떨어지지 않게 만든다',
    target: '값 범위와 연산 규칙',
    apply: s => s.replace("    else            { op = '÷'; a = x * y; b = y; ans = x; }",
                          "    else            { op = '÷'; a = x * y + 1; b = y; ans = x; }")
  },
  'm-wrong-delta-zero': {
    why: '오답 후보의 차이 목록에 0 을 넣는다 — 오답 자리에 정답이 들어가 보기에 정답이 둘이 된다',
    target: '보기 넷 중 정답은 정확히 하나',
    apply: s => s.replace('  const deltas = mul ? [1, -1,', '  const deltas = mul ? [0, 1, -1,')
  },
  'm-penalty-wrong-amount': {
    why: '오답 벌점을 3초가 아니라 1초로 바꾼다',
    target: '오답 벌점은 정확히 3초',
    apply: s => s.replace('    endAt -= PENALTY_MS;                    /* ★즉시 확정 */',
                          '    endAt -= 1000;')
  },
  'm-correct-does-not-advance': {
    why: '정답을 맞혀도 다음 문제로 안 넘어가게 만든다',
    target: '정답이면 즉시 다음 문제',
    apply: s => s.replace('    idx++; dead = [];', '    dead = [];')
  },
  'm-deck-short': {
    why: '선굴림 양을 60 에서 3 으로 줄인다 — 30초 안에 덱이 바닥난다',
    target: '선굴림 덱은 60문',
    apply: s => s.replace('const DECK_N = 60;', 'const DECK_N = 3;')
  },
  'm-quiet-control': {
    why: '★대조군 — 주석 한 줄만 바꾼다. 어떤 검사도 붉으면 안 된다',
    target: null,
    apply: s => s.replace('/* ======================= 소리 ======================= */',
                          '/* ======================= 소리(대조군) ======================= */')
  }
};

if (has('--list-mutations')) {
  Object.keys(MUTATIONS).forEach(k => console.log(k + '  — ' + MUTATIONS[k].why + '  [지목: ' + (MUTATIONS[k].target || '(대조군)') + ']'));
  process.exit(0);
}

let RAW;
try { RAW = fs.readFileSync(HTML, 'utf8'); }
catch (e) { console.error('대상을 읽을 수 없다: ' + HTML); process.exit(2); }

if (MUTATION) {
  const m = MUTATIONS[MUTATION];
  if (!m) { console.error('그런 뮤테이션이 없다: ' + MUTATION); process.exit(2); }
  const before = RAW;
  RAW = m.apply(RAW);
  if (RAW === before) { console.error('주입 실패(앵커가 안 맞는다): ' + MUTATION); process.exit(2); }
  console.log('※ 뮤테이션 주입: ' + MUTATION + ' — ' + m.why);
  console.log('※ 지목한 검사: ' + (m.target || '(대조군 · 아무 검사도 붉으면 안 된다)'));
}

/* ------------------------------------------------------------ 게임 스크립트 꺼내기 */
function gameSource(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) { if (!/\bsrc=/.test(m[1]) && !/type="application\/ld\+json"/.test(m[1])) out.push(m[2]); }
  /* ★부분 문자열로 고르지 않는다 — 고르는 기준은 ★창구를 여는 자리다. */
  return out.find(s => s.indexOf("window, '__quickmath'") >= 0) || null;
}
const SRC = gameSource(RAW);
if (!SRC) { console.error("게임 스크립트(window.__quickmath 창구를 여는 인라인 <script>)를 찾지 못했다"); process.exit(2); }

/* ------------------------------------------------------------ 최소 DOM 스텁 */
function mkEl(id) {
  const el = {
    id, tagName: 'DIV', hidden: false, textContent: '', value: '',
    attrs: {}, kids: [], listeners: {}, parentNode: null, disabled: false,
    style: {}, dataset: {}, offsetWidth: 1,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.kids.push(c); c.parentNode = this; return c; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    /* ★제품은 onclick 프로퍼티로도 붙인다 — 둘 다 부르지 않으면 게임이 시작조차 안 되고,
       그러면 '빈 덱끼리 같다' 로 검사가 ★공허하게 통과한다(2026-09-07 실측). */
    fire(t, ev) {
      (this.listeners[t] || []).forEach(f => f(ev || { target: this }));
      const p = this['on' + t];
      if (typeof p === 'function') p.call(this, ev || { target: this });
    },
    querySelectorAll(sel) {
      const want = String(sel).replace(/^\./, '');
      return this.kids.filter(k => k.classList.contains(want));
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  };
  let _cls = [];
  el.classList = {
    add() { for (const c of arguments) if (_cls.indexOf(c) < 0) _cls.push(c); },
    remove() { for (const c of arguments) { const i = _cls.indexOf(c); if (i >= 0) _cls.splice(i, 1); } },
    contains(c) { return _cls.indexOf(c) >= 0; },
    toggle(c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); }
  };
  Object.defineProperty(el, 'className', {
    get() { return _cls.join(' '); },
    set(v) { _cls = String(v).split(/\s+/).filter(Boolean); }
  });
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) { _html = String(v); if (_html === '') el.kids.length = 0; }
  });
  return el;
}

const IDS = ['qNo', 'scoreNow', 'timeNow', 'timeCell', 'qtext', 'opts', 'qtier', 'qcat',
  'bar', 'barFill', 'penalty', 'srSummary', 'toast', 'start', 'over',
  'btnSound', 'btnSound2', 'btnLang', 'btnLang2', 'btnDaily', 'btnStart', 'btnAgain',
  'btnShare', 'dailyHint', 'finalScore', 'finalSub', 'newBest', 'nOk', 'nBad', 'nAcc',
  'review', 'subtitle', 'adTop', 'adOver'];

function makeWorld(opts) {
  opts = opts || {};
  const els = {};
  IDS.forEach(i => { els[i] = mkEl(i); });
  /* 보기 4개 — 실제 마크업과 같은 모양(.opt 안에 .t 와 .mk) */
  for (let i = 0; i < 4; i++) {
    const b = mkEl('opt' + i);
    b.className = 'opt';
    const t = mkEl(''); t.className = 't';
    const k = mkEl(''); k.className = 'mk';
    b.appendChild(t); b.appendChild(k);
    els.opts.appendChild(b);
  }
  const store = Object.assign({}, opts.store || {});
  const rafQ = [];
  const doc = {
    readyState: 'complete',
    documentElement: { lang: 'ko' },
    getElementById: id => els[id] || null,
    querySelectorAll: () => [],
    createElement: t => { const e = mkEl(''); e.tagName = String(t).toUpperCase(); return e; },
    addEventListener: () => {}
  };
  const win = {
    document: doc, navigator: { language: 'ko-KR' },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    /* ★타이머·시계는 하네스가 쥔다 — 제품에 시간 조작 훅을 뚫지 않는다. */
    requestAnimationFrame: fn => { rafQ.push(fn); return rafQ.length; },
    cancelAnimationFrame: () => {},
    setTimeout: () => 0, clearTimeout: () => {},
    addEventListener: () => {}, Math, Date, console, JSON, Object, Array, String, Number
  };
  let clock = (typeof opts.startNow === 'number') ? opts.startNow : 1000;
  win.performance = { now: () => clock };
  win.__advance = ms => { clock += ms; };
  if (typeof opts.fixedNow === 'number') {
    const fixed = opts.fixedNow;
    win.Date = new Proxy(Date, { get(t, p) { return p === 'now' ? () => fixed : t[p]; } });
  }
  if (opts.today instanceof Date) {
    const D = opts.today;
    const Fake = function (...a) { return a.length ? new Date(...a) : new Date(D.getTime()); };
    Fake.now = () => D.getTime();
    Fake.prototype = Date.prototype;
    win.Date = Fake;
  }
  win.window = win;
  vm.createContext(win);
  try { vm.runInContext(SRC, win, { filename: 'quick-math-inline.js' }); }
  catch (e) { console.error('스크립트 실행 실패: ' + e.message); process.exit(2); }
  if (!win.__quickmath) { console.error('관측 창구(window.__quickmath)가 없다'); process.exit(2); }
  return { win, els, doc, store, rafQ, advance: win.__advance };
}

/* ------------------------------------------------------------ 검사 판 */
const results = [];
let ran = 0;
function check(name, fn) {
  if (ONLY && ONLY !== name) return;
  ran++;
  let ok = false, note = '';
  try { const r = fn(); ok = r === true || (r && r.ok === true); note = (r && r.note) || ''; }
  catch (e) { ok = false; note = '예외: ' + e.message; }
  results.push({ name, ok, note });
}

const startDaily = W => { W.els.btnDaily.fire('click'); };
const startFree = W => { W.els.btnStart.fire('click'); };
const tapOpt = (W, i) => { W.els.opts.kids[i].fire('click'); };
const deckOf = W => W.win.__quickmath.deck;
/* ★전제 검사 — 판이 실제로 짜였는가. 이걸 안 세우면 '빈 덱끼리 같다' 가 통과가 된다. */
function must(W, where) {
  const d = deckOf(W);
  if (!W.win.__quickmath.running) throw new Error(where + ': 판이 시작되지 않았다(표본 미성립)');
  if (d.length !== 60) throw new Error(where + ': 덱이 ' + d.length + '문(표본 미성립)');
  return d;
}

/* ── ① 선굴림 — 행동이 난수를 소비하지 않는다 ───────────────────────────── */
check('행동이 난수를 소비하지 않는다', () => {
  const day = new Date(2026, 0, 1, 9, 0, 0);
  const A = makeWorld({ today: day });
  startDaily(A);
  const deckA = must(A, 'A');
  const B = makeWorld({ today: day });
  startDaily(B);
  must(B, 'B');
  /* B 에서는 ★일부러 많이 틀린다 — 오답 탭이 난수를 당기면 뒤 문제가 갈라진다 */
  let taps = 0;
  for (let step = 0; step < 12; step++) {
    const q = deckOf(B)[B.win.__quickmath.idx];
    if (!q) break;
    for (let i = 0; i < 4; i++) if (i !== q.correct) { tapOpt(B, i); taps++; }
    tapOpt(B, q.correct);
  }
  const deckB = deckOf(B);
  const same = JSON.stringify(deckA) === JSON.stringify(deckB);
  return { ok: same && taps > 0, note: '오답 탭 ' + taps + '회 · 덱 ' + (same ? '동일' : '★갈라짐') };
});

/* ── ② 같은 seed = 같은 판 ──────────────────────────────────────────────── */
check('같은 seed = 같은 판', () => {
  const day = new Date(2026, 4, 17, 3, 0, 0);
  const A = makeWorld({ today: day }); startDaily(A); must(A, 'A');
  const B = makeWorld({ today: day }); startDaily(B); must(B, 'B');
  const same = JSON.stringify(deckOf(A)) === JSON.stringify(deckOf(B));
  const key = A.win.__quickmath.seedKey === B.win.__quickmath.seedKey;
  return { ok: same && key, note: 'seedKey ' + A.win.__quickmath.seedKey + ' · 덱 ' + (same ? '동일' : '★다름') };
});

/* ── ③ 같은 날은 시각이 달라도 같은 판 ─────────────────────────────────── */
check('같은 날이면 시각이 달라도 같은 판', () => {
  const A = makeWorld({ today: new Date(2026, 6, 4, 0, 0, 1) }); startDaily(A); must(A, 'A');
  const B = makeWorld({ today: new Date(2026, 6, 4, 23, 59, 59) }); startDaily(B); must(B, 'B');
  const same = JSON.stringify(deckOf(A)) === JSON.stringify(deckOf(B));
  return { ok: same, note: '00:00:01 과 23:59:59 · ' + (same ? '동일' : '★갈라짐') };
});

/* ── ④ 다른 날 = 다른 판 (씨앗 층 + 판 층을 갈라 센다) ──────────────────── */
check('다른 날 = 다른 판', () => {
  const seeds = new Set(), decks = new Set();
  const N = 120;
  for (let d = 0; d < N; d++) {
    const W = makeWorld({ today: new Date(2026, 0, 1 + d, 12, 0, 0) });
    startDaily(W);
    must(W, 'day' + d);
    seeds.add(W.win.__quickmath.seedKey);
    decks.add(JSON.stringify(deckOf(W)));
  }
  return { ok: seeds.size === N && decks.size === N,
           note: '씨앗 ' + seeds.size + '/' + N + ' · 판 ' + decks.size + '/' + N };
});

/* ── ⑤ 난이도 계단은 문제 번호로만 ────────────────────────────────────── */
check('난이도 계단은 문제 번호로만 정해진다', () => {
  const W = makeWorld({ today: new Date(2026, 2, 3) }); startDaily(W);
  const d = must(W, '계단');
  const bad = [];
  d.forEach((q, i) => {
    const no = i + 1;
    const want = no <= 5 ? 1 : no <= 12 ? 2 : 3;   /* ★검사기가 자기 것으로 다시 센다 */
    if (q.tier !== want) bad.push(no + ':' + q.tier + '≠' + want);
    if (q.no !== no) bad.push('번호 ' + q.no + '≠' + no);
  });
  /* 그리고 ★플레이 뒤에도 계단이 안 움직인다(맞힌 개수로 정해지지 않는다) */
  const W2 = makeWorld({ today: new Date(2026, 2, 3) }); startDaily(W2);
  for (let k = 0; k < 6; k++) { const q = deckOf(W2)[W2.win.__quickmath.idx]; if (q) tapOpt(W2, q.correct); }
  const after = deckOf(W2);
  const moved = after.some((q, i) => q.tier !== d[i].tier);
  return { ok: bad.length === 0 && !moved, note: bad.length ? bad.slice(0, 4).join(' ') : (moved ? '★플레이 뒤 계단 이동' : '60문 전량 일치') };
});

/* ── ⑥ 값 범위 · 뺄셈 음수 없음 · 나눗셈 딱 떨어짐 ────────────────────── */
check('값 범위와 연산 규칙', () => {
  const bad = [];
  for (let s = 0; s < 40; s++) {
    const W = makeWorld({ today: new Date(2026, 0, 1 + s * 7) }); startDaily(W); must(W, 's' + s);
    deckOf(W).forEach(q => {
      const calc = q.op === '+' ? q.a + q.b : q.op === '−' ? q.a - q.b : q.op === '×' ? q.a * q.b : q.a / q.b;
      if (calc !== q.ans) bad.push('식≠답 ' + q.a + q.op + q.b);
      if (q.ans < 0) bad.push('음수답 ' + q.a + q.op + q.b);
      if (q.op === '÷' && q.a % q.b !== 0) bad.push('나눗셈 안 떨어짐 ' + q.a + '/' + q.b);
      if (q.tier === 1 && !(q.a >= 1 && q.a <= 9 && q.b >= 1 && q.b <= 9)) bad.push('한자리 범위 ' + q.a + ',' + q.b);
      if (q.tier === 2 && !(q.a >= 10 && q.a <= 99 && q.b >= 10 && q.b <= 99)) bad.push('두자리 범위 ' + q.a + ',' + q.b);
      if (q.tier === 3 && q.op === '×' && !(q.a >= 2 && q.a <= 9 && q.b >= 2 && q.b <= 9)) bad.push('구구단 범위 ' + q.a + ',' + q.b);
    });
  }
  return { ok: bad.length === 0, note: bad.length ? (bad.length + '건 · ' + bad.slice(0, 3).join(' / ')) : '40판 x 60문 = 2,400문 전량 통과' };
});

/* ── ⑦ 보기 넷 중 정답은 정확히 하나 · 오답에 음수·중복 없음 ────────────── */
check('보기 넷 중 정답은 정확히 하나', () => {
  const bad = [];
  for (let s = 0; s < 40; s++) {
    const W = makeWorld({ today: new Date(2026, 0, 2 + s * 7) }); startDaily(W); must(W, 's' + s);
    deckOf(W).forEach(q => {
      if (q.cells.length !== 4) bad.push('보기 수 ' + q.cells.length);
      const hits = q.cells.filter(v => v === q.ans).length;
      if (hits !== 1) bad.push('정답 개수 ' + hits + ' (' + q.a + q.op + q.b + ')');
      if (q.cells[q.correct] !== q.ans) bad.push('correct 자리 어긋남');
      if (new Set(q.cells).size !== 4) bad.push('보기 중복 ' + q.cells.join(','));
      if (q.cells.some(v => v < 0)) bad.push('보기 음수 ' + q.cells.join(','));
    });
  }
  return { ok: bad.length === 0, note: bad.length ? (bad.length + '건 · ' + bad.slice(0, 3).join(' / ')) : '2,400문 전량 통과' };
});

/* ── ⑧ 오답 벌점은 정확히 3초 ─────────────────────────────────────────── */
check('오답 벌점은 정확히 3초', () => {
  const W = makeWorld({ today: new Date(2026, 3, 9) }); startDaily(W);
  const q = must(W, '벌점')[0];
  const before = W.win.__quickmath.remainMs;
  const wrong = [0, 1, 2, 3].find(i => i !== q.correct);
  tapOpt(W, wrong);
  const after = W.win.__quickmath.remainMs;
  const drop = before - after;
  return { ok: Math.abs(drop - W.win.__quickmath.penaltyMs) < 1e-6 && W.win.__quickmath.penaltyMs === 3000,
           note: '차감 ' + drop + 'ms (계약 ' + W.win.__quickmath.penaltyMs + 'ms)' };
});

/* ── ⑨ 정답이면 즉시 다음 문제 · 오답은 문제를 넘기지 않는다 ──────────── */
check('정답이면 즉시 다음 문제', () => {
  const W = makeWorld({ today: new Date(2026, 3, 10) }); startDaily(W);
  const q0 = must(W, '진행')[0];
  const wrong = [0, 1, 2, 3].find(i => i !== q0.correct);
  tapOpt(W, wrong);
  const idxAfterMiss = W.win.__quickmath.idx;
  tapOpt(W, q0.correct);
  const idxAfterHit = W.win.__quickmath.idx;
  const scored = W.win.__quickmath.score;
  return { ok: idxAfterMiss === 0 && idxAfterHit === 1 && scored === 1,
           note: '오답 뒤 idx ' + idxAfterMiss + ' · 정답 뒤 idx ' + idxAfterHit + ' · 점수 ' + scored };
});

/* ── ⑩ 같은 오답을 두 번 눌러도 두 번 깎이지 않는다 ─────────────────────── */
check('잠긴 보기는 다시 세지 않는다', () => {
  const W = makeWorld({ today: new Date(2026, 3, 11) }); startDaily(W);
  const q = must(W, '잠금')[0];
  const wrong = [0, 1, 2, 3].find(i => i !== q.correct);
  const t0 = W.win.__quickmath.remainMs;
  tapOpt(W, wrong); const t1 = W.win.__quickmath.remainMs;
  tapOpt(W, wrong); const t2 = W.win.__quickmath.remainMs;
  return { ok: (t0 - t1) === 3000 && t1 === t2 && W.win.__quickmath.missed === 1,
           note: '1회 ' + (t0 - t1) + 'ms · 2회 추가 ' + (t1 - t2) + 'ms · 오답 수 ' + W.win.__quickmath.missed };
});

/* ── ⑪ 선굴림 덱은 60문 · 한 판 30초 ──────────────────────────────────── */
check('선굴림 덱은 60문', () => {
  const W = makeWorld({ today: new Date(2026, 3, 12) }); startDaily(W);
  const k = W.win.__quickmath;
  return { ok: k.deckN === 60 && deckOf(W).length === 60 && k.roundMs === 30000,
           note: '덱 ' + deckOf(W).length + '문 · 상수 ' + k.deckN + ' · 한 판 ' + k.roundMs + 'ms' };
});

/* ── ⑫ 시간이 다 되면 판이 끝난다 ─────────────────────────────────────── */
check('시간이 다 되면 판이 끝난다', () => {
  const W = makeWorld({ today: new Date(2026, 3, 13) }); startDaily(W);
  if (!W.win.__quickmath.running) return { ok: false, note: '시작이 안 됐다' };
  W.advance(30001);
  /* rAF 는 하네스가 쥐고 있다 — 다음 프레임을 우리가 돌린다 */
  const fn = W.rafQ[W.rafQ.length - 1];
  if (typeof fn === 'function') fn();
  return { ok: W.win.__quickmath.running === false, note: '30.001초 뒤 running=' + W.win.__quickmath.running };
});

/* ── ⑬ 판 짜기에 시계가 안 섞인다(정적) ───────────────────────────────── */
check('판 짜기에 시계·성능이 안 섞인다', () => {
  const i = SRC.indexOf('function makeDeck');
  const j = SRC.indexOf('/* ======================= 판 상태');
  if (i < 0 || j < 0 || j <= i) return { ok: false, note: '★구간을 세울 수 없다' };
  /* 판을 짜는 구간(makeWrongs~makeDeck)을 통째로 본다 */
  const a = SRC.indexOf('function makeWrongs');
  const seg = SRC.slice(a, j);
  const hits = [];
  [/Date\s*\.\s*now/, /performance\s*\.\s*now/, /new\s+Date/, /setTimeout/, /Math\s*\.\s*random/].forEach(re => {
    if (re.test(seg)) hits.push(re.source);
  });
  return { ok: hits.length === 0, note: hits.length ? ('★' + hits.join(' ')) : '판 짜는 구간에 시계·전역난수 0건' };
});

/* ── ⑭ 런타임에 바뀌는 요소에 data-i18n 이 없다(정적) ──────────────────── */
check('런타임 변경 요소에 data-i18n 이 없다', () => {
  const bad = [];
  const re = /<([a-z0-9]+)([^>]*\bid="(qtext|scoreNow|timeNow|qNo|qtier|finalScore)"[^>]*)>/gi;
  let m;
  while ((m = re.exec(RAW))) { if (/data-i18n/.test(m[2])) bad.push(m[2].match(/id="([^"]+)"/)[1]); }
  return { ok: bad.length === 0, note: bad.length ? ('★' + bad.join(',')) : '식·점수·시간·번호 칸 전부 없음' };
});

/* ── ⑮ 관측 창구는 읽기 전용 ─────────────────────────────────────────── */
check('관측 창구는 읽기 전용', () => {
  const W = makeWorld({ today: new Date(2026, 3, 14) }); startDaily(W); must(W, '창구');
  const k = W.win.__quickmath;
  const before = k.score;
  try { k.score = 999; } catch (_) { /* strict 에서는 던진다 */ }
  const cmds = Object.keys(k).filter(n => typeof k[n] === 'function');
  /* 덱을 밖에서 흔들어도 제품 안이 안 바뀐다(사본을 준다) */
  const d = k.deck; d[0].ans = -12345;
  const still = k.deck[0].ans !== -12345;
  return { ok: k.score === before && cmds.length === 0 && still,
           note: '명령 ' + cmds.length + '개 · 점수 쓰기 ' + (k.score === before ? '막힘' : '★뚫림') + ' · 덱 ' + (still ? '사본' : '★원본 노출') };
});

/* ------------------------------------------------------------ 판정 */
let fail = 0;
results.forEach(r => {
  if (!r.ok) fail++;
  console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.note ? '  — ' + r.note : ''));
});
if (ran === 0) { console.error('★검사가 하나도 안 돌았다 — --only 이름을 확인하라'); process.exit(2); }
console.log('');
console.log(fail === 0 ? ('전 검사 통과 (' + ran + '종)') : ('★미달 ' + fail + ' / ' + ran));

if (MUTATION) {
  const m = MUTATIONS[MUTATION];
  if (m.target === null) {
    /* 대조군 — 아무 검사도 붉으면 안 된다 */
    process.exit(fail === 0 ? 0 : 3);
  }
  const t = results.find(r => r.name === m.target);
  if (!t) { console.error('★지목한 검사가 이 실행에 없다: ' + m.target); process.exit(2); }
  if (t.ok) { console.error('★공허 — 지목한 검사(' + m.target + ')가 이 변이를 잡지 못했다'); process.exit(3); }
  console.log('※ 지목한 검사가 잡았다: ' + m.target);
  process.exit(0);
}
process.exit(fail === 0 ? 0 : 1);
