/* 딱 맞춰!(/just-right/) 검증기 — worker-3 · 2026-09-04 · 티켓 T0904-justright
 *
 * 기존 검증기(verify_memory.js·verify_tensec.js)의 방식을 그대로 따른다:
 *   · 인라인 스크립트를 DOM 스텁 위에서 실제로 구동한다(vm)
 *   · 상태를 바꾸는 명령은 **제품 파일에 두지 않고** 여기서 메모리 위에만 덧붙인다(test bridge)
 *   · 판정은 배포되는 관측 창구(window.__jr)와 이 파일이 따로 셈한 값의 대조로 한다
 *   · 누르는 것은 다리가 아니라 **진짜 입력 사건**(pointerdown)으로 두드린다
 *
 * 중점 검사(브리프가 못박은 함정)
 *   ★3-1 프레임 독립 판정 — 프레임 간격을 바꿔도 **같은 시각에 누르면 같은 오차**가 나오는가.
 *        그리고 판정이 '마지막으로 그린 위치'가 아니라 '누른 순간의 시각'에서 나오는가.
 *   ★3-2 시드 결정론 — 같은 날짜 씨앗이 같은 판을 주는가. 플레이 행동이 난수를 소비하지 않는가.
 *   ★3-3 논리 즉시 확정 — 타이머를 한 번도 돌리지 않고 연속으로 눌러도 라운드가 밀리지 않는가.
 *
 * ★이 하네스가 못 보는 것(정직 고지)
 *   · 레이아웃을 계산하지 않는다 — '요소가 0×0 으로 접힘' 은 실브라우저에서만 보인다.
 *   · CSS 는 파싱하지 않는다 — 클래스 이름 충돌은 아래 정적 검사에서 이름 수준으로만 본다.
 *
 * 사용법: node verify_justright.js [--html <경로>] [--mutate <이름>] [--list-mutations]
 * 종료코드: 0 = 전부 PASS · 1 = 하나라도 FAIL · 2 = 뮤테이션 주입 실패·하네스 이상(탐지 아님)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
/* 기본 대상은 **이 도구가 놓인 저장소의 /just-right/index.html** 이다 — 절대경로를 박아 두면
   worktree 를 갈아탈 때 조용히 남의 파일을 재게 된다. */
const HTML = argOf('--html', path.join(__dirname, '..', 'just-right', 'index.html'));
const MUTATION = argOf('--mutate', null);

/* ------------------------------------------------------- 뮤테이션(검출력 자기시험)
   ★각 뮤테이션은 **어느 검사가 잡아야 하는지**를 함께 적는다 — 다른 검사가 우연히 깨져서 난
   빨강은 무임승차다(장기기억 mutation-must-name-the-check-that-catches-it).
   ★'주입 실패'와 '결함 탐지'를 종료코드로 가른다(2 = 주입 실패 · 1 = 탐지). */
const MUTATIONS = {
  /* ① 그리기가 프레임을 누적한다 = 60Hz 와 144Hz 에서 다른 게임이 된다 */
  'frame-accumulate': {
    catcher: '그린 위치가 매 프레임 posAt 과 같다(프레임 간격 불규칙)',
    from: '  paintAt(nowMs() - startStamp);          /* ★프레임마다 경과 시간에서 다시 계산한다 */',
    to:   '  paintAt(drawnAt + 16.7);   /* ★프레임마다 고정량을 더한다 = 주사율이 곧 속도가 된다 */'
  },
  /* ② 판정이 마지막으로 그린 위치를 쓴다 = 화면이 느릴수록 오차가 커진다 */
  'judge-from-drawn': {
    catcher: '판정은 마지막으로 그린 위치가 아니라 누른 순간의 시각에서 나온다',
    from:   '  const pos = posAt(r.variant, r.periodMs, elapsedMs);\n  const err = errorOf(pos, r.target);',
    to:     '  const pos = drawnPos;\n  const err = errorOf(pos, r.target);'
  },
  /* ③ 플레이 행동이 난수를 소비한다 = 사람마다 판이 갈린다 */
  'rng-on-play': {
    catcher: '플레이 행동은 난수를 한 번도 소비하지 않는다(오늘의 도전)',
    from:   '  sStop();\n  say(T(\'sayEnd\'',
    to:     '  sStop();\n  Math.random();\n  say(T(\'sayEnd\''
  },
  /* ④ 오늘의 도전 판을 날짜가 아니라 그때그때 뽑는다 = 같은 날 사람마다 다른 문제 */
  'seed-drift': {
    catcher: '같은 씨앗은 같은 판을 준다(3라운드 전체)',
    from:   'const dailyPlan = seedKey => makePlan(mulberry32(hashStr(String(seedKey))));',
    to:     'const dailyPlan = seedKey => makePlan(mulberry32((Math.random() * 4294967296) >>> 0));'
  },
  /* ⑤ 라운드 확정을 연출 뒤로 미룬다 = 빠른 입력이 낡은 상태 위에서 실행된다 */
  'defer-commit': {
    catcher: '타이머를 돌리지 않고 연속으로 눌러도 라운드가 밀리지 않는다',
    from:   '  rounds.push({ variant: r.variant, periodMs: r.periodMs, target: r.target, pos, err, acc, elapsedMs });',
    to:     '  setTimeout(() => rounds.push({ variant: r.variant, periodMs: r.periodMs, target: r.target, pos, err, acc, elapsedMs }), 400);'
  },
  /* ⑩ 영어 표에서 본문 산문 키 하나를 뺀다 = EN 사용자가 그 문단만 한국어로 본다
        (2026-09-04 실브라우저 EN 360px 캡처가 실제로 잡아낸 결함의 재현) */
  'en-prose-missing': {
    catcher: '마크업의 data-i18n 키가 ko·en 두 표에 모두 있다',
    from:    "    how1:'Press the pad in the middle once",
    to:      "    how1x:'Press the pad in the middle once"
  },
  /* ⑨ 정지 직후 다음 라운드를 그려 버린다 = 어디서 멈췄는지 사용자가 볼 수 없다 */
  'reset-on-stop': {
    catcher: '정지한 자리가 다음 라운드를 시작할 때까지 화면에 남는다',
    from:   "    $('roundChip').textContent = T('roundChip', roundIdx + 1, plan.length || ROUNDS);",
    to:     "    layoutRound(); paintAt(0);"
  },
  /* ⑥ 정확도를 목표 자리와 무관한 고정 분모로 환산한다 = 가장자리 목표가 거저 높은 점수를 준다 */
  'acc-no-normalize': {
    catcher: '정확도는 그 라운드의 최대 오차로 환산한다(목표 자리와 무관하게 0~1)',
    from:   '  const a = 1 - errorOf(pos, target) / m;',
    to:     '  const a = 1 - errorOf(pos, target);'
  },
  /* ⑦ 최고 기록 비교를 뒤집는다 */
  'best-worse-wins': {
    catcher: '자유 모드 최고 기록은 더 높은 정확도일 때만 바뀐다',
    from:   'const betterThan = (a, b) => !b || a.acc > b.acc;',
    to:     'const betterThan = (a, b) => !b || a.acc < b.acc;'
  },
  /* ⑧ 하루 한 번 규칙을 깬다 = 두 번째 도전이 그날 기록을 덮는다 */
  'daily-overwrite': {
    catcher: '오늘의 도전은 하루 한 번 — 두 번째 완주가 기록을 덮지 않는다',
    from:   '    if (!dailyDoneToday()){\n      saveDaily({ acc: avgAcc, err: avgErr, rounds: r.rounds });',
    to:     '    if (true){\n      saveDaily({ acc: avgAcc, err: avgErr, rounds: r.rounds });'
  }
};
if (argv.includes('--list-mutations')){
  for (const [k, v] of Object.entries(MUTATIONS)) console.log(k + '\t' + v.catcher);
  process.exit(0);
}

const RAW = fs.readFileSync(HTML, 'utf8');

/* 인라인 스크립트 중 게임 본체(가장 긴 것)를 고른다 */
function gameSource(html){
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length){ console.error('인라인 스크립트를 찾지 못했다'); process.exit(2); }
  return blocks.sort((a, b) => b.length - a.length)[0];
}
let SRC = gameSource(RAW);
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  if (!m){ console.error('알 수 없는 뮤테이션: ' + MUTATION); process.exit(2); }
  const n = SRC.split(m.from).length - 1;
  if (n !== 1){ console.error(`뮤테이션 주입 실패(${MUTATION}) — 앵커가 ${n}회 나타났다(1회여야 한다)`); process.exit(2); }
  SRC = SRC.replace(m.from, m.to);
  console.log(`[mutate] ${MUTATION} 주입됨 — 잡아야 하는 검사: ${m.catcher}`);
}

/* ------------------------------------------------------- test bridge(메모리 위에만)
   제품 파일에는 관측 창구(__jr)만 배포한다. 상태를 바꾸는 명령은 여기서 IIFE 가 닫히기 직전에
   덧붙인다 — 배포본에는 남지 않는다(장기기억 debug-hooks-in-shipped-code-are-a-control-api). */
const BRIDGE = `
window.__jrTest = {
  /* ★i18n 표를 정규식으로 읽지 않는다 — 한 줄에 키가 여럿이거나 문장 안에 콜론이 있으면
     정규식은 대리물이 된다. 실행된 객체의 실제 키 목록을 그대로 준다. */
  i18nKeys: () => ({ ko: Object.keys(I18N.ko), en: Object.keys(I18N.en) }),
  begin: m => beginRun(m),
  refresh: () => refreshStart(),
  overShown: () => overShown,
  planNow: () => plan,
  freePlan: () => freePlan()
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
    appendChild: c => { el.children.push(c); c.parent = el; return c; },
    _descend: () => { const out = []; const walk = n => { for (const c of n.children){ out.push(c); walk(c); } }; walk(el); return out; }
  };
  Object.defineProperty(el, 'textContent', {
    get(){ return el._text; },
    set(v){ el._text = String(v); }
  });
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
    if (s.indexOf('button:not(') === 0 && el.tagName === 'BUTTON' && !el.disabled && !el.hidden) return true;
    if (s === '.overlay' && el._classes.has('overlay')) return true;
  }
  return false;
}
function HTMLElementStub(){}
function PointerEventStub(){}

const IDS = ['pad','padMain','padSub','varChip','roundChip','srSummary','toast','over','start',
             'stageBar','stageGauge','barTrack','barZone','barGoal','barMarker',
             'gaugeTrack','gaugeZone','gaugeGoal','gaugeFill',
             'finalAccBig','finalErrLine','marks','streakLine','newBest','nRounds','nErr','nAcc','finalSub',
             'btnAgain','btnShare','btnDaily','btnStart','dailyHint','varDesc','help',
             'btnSound','btnSound2','btnLang','btnLang2','subtitle','adTop','adOver','startTitle','overTitle',
             'bestNow','modeNow','streakNowEl'];

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
    addEventListener: (t, fn) => { doc._on = doc._on || {}; doc._on[t] = fn; },
    removeEventListener: () => {}
  };
  doc.documentElement = makeEl('html', doc);
  doc.body = makeEl('body', doc);
  for (const id of IDS) doc.getElementById(id);
  doc.getElementById('pad').tagName = 'BUTTON';
  doc.getElementById('over')._classes.add('overlay');
  doc.getElementById('start')._classes.add('overlay');
  doc.getElementById('start')._classes.add('show');
  for (const k of ['title','subtitle','hint','how1','dailyDesc','statPlays']){
    const e = makeEl('i18n_' + k, doc, 'p'); e.dataset.i18n = k; els.set('i18n_' + k, e);
  }
  els.set('home', makeEl('home', doc, 'a'));

  /* ★시계 — 이 하네스가 쥐고 있다. 흐르는 것은 우리가 밀어 준 만큼뿐이다. */
  let clock = 1000;
  const perf = { now: () => clock };

  /* ★프레임 — 우리가 부를 때만 돈다. 간격도 우리가 정한다(불규칙하게 줄 수 있다). */
  let rafSeq = 1;
  const rafQueue = new Map();
  const requestAnimationFrame = fn => { const id = rafSeq++; rafQueue.set(id, fn); return id; };
  const cancelAnimationFrame = id => { rafQueue.delete(id); };
  function runFrame(){
    const entries = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, fn] of entries) fn(clock);
    return entries.length;
  }

  /* 타이머 — 우리가 돌리지 않으면 영원히 안 돈다(★논리 즉시 확정을 재는 데 쓴다) */
  let tSeq = 1;
  const timers = new Map();
  const setTimeoutStub = (fn, ms) => { const id = tSeq++; timers.set(id, fn); return id; };
  const clearTimeoutStub = id => { timers.delete(id); };
  function runTimers(){ const e = [...timers.entries()]; timers.clear(); for (const [, fn] of e) fn(); return e.length; }

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
    requestAnimationFrame, cancelAnimationFrame,
    location: { href: 'https://hanpango.com/just-right/' },
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    HTMLElement: HTMLElementStub, PointerEvent: PointerEventStub, document: doc,
    performance: perf
  };
  const sandbox = {
    window: win, document: doc, localStorage, navigator: nav, performance: perf,
    HTMLElement: HTMLElementStub, PointerEvent: PointerEventStub, location: win.location,
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    requestAnimationFrame, cancelAnimationFrame,
    console, Math: MathStub, Date, JSON, Promise,
    Number, String, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(SRC, sandbox, { filename: 'just-right-inline.js' }); }
  catch (e){ console.error('구동 실패: ' + e.stack); process.exit(2); }
  if (!win.__jr || !win.__jrTest){ console.error('관측 창구(__jr)/시험 다리(__jrTest) 없음'); process.exit(2); }

  const pad = doc.getElementById('pad');
  return {
    jr: win.__jr, t: win.__jrTest, doc, store: localStorage,
    el: id => doc.getElementById(id),
    txt: id => doc.getElementById(id).textContent,
    rand: () => randCalls,
    resetRand: () => { randCalls = 0; },
    now: () => clock,
    advance: ms => { clock += ms; },
    frame: () => runFrame(),
    frames: () => rafQueue.size,
    runTimers,
    pendingTimers: () => timers.size,
    /* ★진짜 입력 사건으로 두드린다 — 다리로 pressStart/pressStop 을 부르지 않는다 */
    press: stampOffset => {
      const fn = pad._on.pointerdown;
      if (!fn) throw new Error('pad pointerdown 핸들러 없음');
      fn({ button: 0, timeStamp: clock + (stampOffset || 0) });
    },
    key: k => {
      const fn = doc._on && doc._on.keydown;
      if (!fn) throw new Error('keydown 핸들러 없음');
      fn({ key: k || ' ', repeat: false, target: pad, preventDefault(){}, timeStamp: clock });
    },
    startBtn: () => doc.getElementById('btnStart').onclick(),
    dailyBtn: () => doc.getElementById('btnDaily').onclick(),
    againBtn: () => doc.getElementById('btnAgain').onclick()
  };
}

/* ------------------------------------------------------------ ★추락은 판정이 아니다
   Node 는 잡히지 않은 예외도 exit 1 로 끝낸다 — 그러면 '검사가 결함을 잡았다' 와
   '하네스가 죽었다' 가 같은 종료코드가 되어 검출력 표가 거짓이 된다.
   예외는 전부 exit 2(판정 불가)로 올린다. */
process.on('uncaughtException', e => {
  console.error('\n[하네스 오류] 판정 불가(rc=2) — ' + (e && e.stack ? e.stack : e));
  process.exit(2);
});

/* ------------------------------------------------------------ 테스트 틀 */
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail){
  if (cond){ pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
const near = (name, got, want, tol) =>
  ok(name, Math.abs(got - want) <= tol, `got=${got} want=${want} tol=${tol}`);
const section = t => console.log('\n[' + t + ']');
const note = t => console.log('    · ' + t);

/* 한 판(3라운드)을 정해진 대기 시간으로 끝까지 친다. 프레임 수는 인자로 준다. */
function playRun(A, waits, framesPerRound){
  const out = [];
  for (let i = 0; i < waits.length; i++){
    A.press(0);                       /* 시작 */
    const wait = waits[i];
    const nf = framesPerRound == null ? 0 : framesPerRound;
    if (nf > 0){
      const step = wait / nf;
      for (let f = 0; f < nf; f++){ A.advance(step); A.frame(); }
    } else {
      A.advance(wait);
    }
    A.press(0);                       /* 정지 */
    out.push(A.jr.state().rounds[i] || null);   /* ★확정이 미뤄졌으면 null — 여기서 죽지 않고 검사가 판정한다 */
  }
  return out;
}

/* ============================================================ 1. 순수 함수 — 위치·오차·정확도 */
section('1. 순수 함수 — 위치는 시간의 함수다');
{
  const A = boot();
  const P = 1600;
  near('bar: 경과 0 이면 왼쪽 끝(0)', A.jr.posAt('bar', P, 0), 0, 1e-9);
  near('bar: 4분의 1 주기면 절반(0.5)', A.jr.posAt('bar', P, P / 4), 0.5, 1e-9);
  near('bar: 절반 주기면 오른쪽 끝(1)', A.jr.posAt('bar', P, P / 2), 1, 1e-9);
  near('bar: 4분의 3 주기면 다시 절반', A.jr.posAt('bar', P, P * 0.75), 0.5, 1e-9);
  near('bar: 한 주기면 처음으로 돌아온다', A.jr.posAt('bar', P, P), 0, 1e-9);
  near('gauge: 경과 0 이면 0', A.jr.posAt('gauge', P, 0), 0, 1e-9);
  near('gauge: 절반 주기면 0.5', A.jr.posAt('gauge', P, P / 2), 0.5, 1e-9);
  near('gauge: 한 주기면 0 으로 되감긴다', A.jr.posAt('gauge', P, P), 0, 1e-9);
  ok('bar 위치는 항상 0~1 안에 있다',
     Array.from({length: 400}, (_, i) => A.jr.posAt('bar', P, i * 7.3)).every(v => v >= -1e-12 && v <= 1 + 1e-12));
  ok('gauge 위치는 항상 0~1 안에 있다',
     Array.from({length: 400}, (_, i) => A.jr.posAt('gauge', P, i * 7.3)).every(v => v >= -1e-12 && v < 1 + 1e-12));
  /* ★같은 경과 시간이면 몇 번을 물어도 같은 값이다(호출 횟수·순서에 의존하지 않는다) */
  ok('같은 경과 시간은 항상 같은 위치를 준다',
     [0, 13.7, 250, 999.9, 1600, 4321].every(e =>
       A.jr.posAt('bar', P, e) === A.jr.posAt('bar', P, e) &&
       A.jr.posAt('gauge', P, e) === A.jr.posAt('gauge', P, e)));

  eq('오차는 목표와의 거리다', +A.jr.errorOf(0.7, 0.3).toFixed(9), 0.4);
  eq('최대 오차는 목표에서 먼 쪽 끝까지다(0.3 → 0.7)', +A.jr.maxErrorOf(0.3).toFixed(9), 0.7);
  eq('최대 오차는 목표에서 먼 쪽 끝까지다(0.8 → 0.8)', +A.jr.maxErrorOf(0.8).toFixed(9), 0.8);
  near('목표에 정확히 맞으면 정확도 1', A.jr.accuracyOf(0.42, 0.42), 1, 1e-12);
  /* ★목표 자리가 달라도 눈금이 같다 — 가장 먼 끝이 0% 다 */
  ok('정확도는 그 라운드의 최대 오차로 환산한다(목표 자리와 무관하게 0~1)',
     Math.abs(A.jr.accuracyOf(1, 0.3) - 0) < 1e-12 &&
     Math.abs(A.jr.accuracyOf(0, 0.8) - 0) < 1e-12 &&
     Math.abs(A.jr.accuracyOf(0.65, 0.3) - (1 - 0.35 / 0.7)) < 1e-12,
     `acc(1,0.3)=${A.jr.accuracyOf(1, 0.3)} acc(0,0.8)=${A.jr.accuracyOf(0, 0.8)} acc(0.65,0.3)=${A.jr.accuracyOf(0.65, 0.3)}`);
  ok('정확도는 0 아래로 내려가지 않는다', A.jr.accuracyOf(1, 0.5) >= 0 && A.jr.accuracyOf(0, 0.5) >= 0);
}

/* ============================================================ 2. ★프레임 독립 판정 (3-1) */
section('2. ★프레임 독립 판정 — 프레임 간격이 판정을 바꾸지 않는다');
{
  /* 같은 시각(1,234ms 뒤)에 누르되, 한쪽은 프레임을 3번만 그리고 다른 쪽은 90번 그린다.
     프레임 수는 화면 주사율·기기 속도의 대리물이다. */
  const WAIT = 1234;
  const A = boot(); A.startBtn();
  const planA = A.jr.state().plan;
  A.press(0); for (let i = 0; i < 3; i++){ A.advance(WAIT / 3); A.frame(); } A.press(0);
  const rA = A.jr.state().rounds[0];

  const B = boot(); B.startBtn();
  /* 두 판의 문제가 달라도 되도록, 같은 문제를 쓰는 daily 로 비교한다(전제를 맞춘다) */
  const C = boot(); C.dailyBtn();
  const D = boot(); D.dailyBtn();
  eq('전제 — 두 판이 같은 문제를 받았다(오늘의 도전)', C.jr.state().plan, D.jr.state().plan);

  C.press(0); for (let i = 0; i < 3;  i++){ C.advance(WAIT / 3);  C.frame(); } C.press(0);
  D.press(0); for (let i = 0; i < 90; i++){ D.advance(WAIT / 90); D.frame(); } D.press(0);
  const rc = C.jr.state().rounds[0] || null, rd = D.jr.state().rounds[0] || null;
  /* ★전제를 먼저 세운다 — 라운드가 확정되지 않았다면 아래 비교는 잴 대상이 0개다(공허한 초록 금지) */
  ok('전제 — 두 판 모두 라운드를 확정했다(잴 대상이 있다)', !!rc && !!rd,
     `C=${rc ? 1 : 0} D=${rd ? 1 : 0}`);
  ok('프레임 3번과 90번이 같은 오차를 낸다',
     !!rc && !!rd && rc.err.toFixed(12) === rd.err.toFixed(12),
     rc && rd ? `${rc.err} vs ${rd.err}` : '★잴 대상 0 — 판정 불가는 통과가 아니다');
  ok('프레임 3번과 90번이 같은 정확도를 낸다',
     !!rc && !!rd && rc.acc.toFixed(12) === rd.acc.toFixed(12),
     rc && rd ? `${rc.acc} vs ${rd.acc}` : '★잴 대상 0 — 판정 불가는 통과가 아니다');
  if (rc) note(`오차 ${rc.err.toFixed(6)} · 정확도 ${(rc.acc * 100).toFixed(3)}% · 경과 ${WAIT}ms`);

  /* ★프레임을 한 번도 안 그려도 판정은 같다 — 그림과 판정이 분리돼 있다는 뜻이다 */
  const E = boot(); E.dailyBtn();
  E.press(0); E.advance(WAIT); E.press(0);
  const rE = E.jr.state().rounds[0] || null;
  ok('프레임을 한 번도 그리지 않아도 같은 오차',
     !!rE && !!rc && rE.err.toFixed(12) === rc.err.toFixed(12),
     rE && rc ? `${rE.err} vs ${rc.err}` : '★잴 대상 0 — 판정 불가는 통과가 아니다');

  /* ★그린 위치가 매 프레임 posAt 을 따르는가 — 간격을 불규칙하게 준다 */
  const F = boot(); F.dailyBtn();
  const r0 = F.jr.state().plan[0];
  F.press(0);
  const steps = [7, 33, 4, 120, 61, 9, 250, 16, 3, 88];
  let elapsed = 0, allMatch = true, worst = 0;
  for (const s of steps){
    F.advance(s); elapsed += s; F.frame();
    const want = F.jr.posAt(r0.variant, r0.periodMs, elapsed);
    const got = F.jr.drawn();
    worst = Math.max(worst, Math.abs(got.pos - want), Math.abs(got.elapsedMs - elapsed));
    if (Math.abs(got.pos - want) > 1e-9 || Math.abs(got.elapsedMs - elapsed) > 1e-9) allMatch = false;
  }
  ok('그린 위치가 매 프레임 posAt 과 같다(프레임 간격 불규칙)', allMatch, `최대 어긋남 ${worst}`);
  note(`프레임 간격 ${steps.join('·')}ms — 총 ${elapsed}ms`);

  /* ★판정이 '마지막으로 그린 위치'를 쓰지 않는다 — 그림을 멈춘 뒤 시간을 더 흘려 누른다 */
  const G = boot(); G.dailyBtn();
  const g0 = G.jr.state().plan[0];
  G.press(0);
  G.advance(100); G.frame();               /* 여기까지만 그린다 */
  const drawnAt100 = G.jr.drawn().pos;
  G.advance(400);                          /* 그림 없이 400ms 가 더 흐른다(느린 화면) */
  G.press(0);
  const rg = G.jr.state().rounds[0] || { pos: NaN, err: NaN };
  const wantPos = G.jr.posAt(g0.variant, g0.periodMs, 500);
  const staleErr = G.jr.errorOf(drawnAt100, g0.target);
  ok('판정은 마지막으로 그린 위치가 아니라 누른 순간의 시각에서 나온다',
     Math.abs(rg.pos - wantPos) < 1e-9 && Math.abs(rg.err - staleErr) > 1e-6,
     `판정 pos=${rg.pos} · 500ms 위치=${wantPos} · 마지막 그림 pos=${drawnAt100}`);
  note(`낡은 그림으로 쟀다면 오차 ${staleErr.toFixed(6)} 이었을 것 — 실제 판정 오차 ${rg.err.toFixed(6)}`);
}

/* ============================================================ 3. ★시드 결정론 (3-2) */
section('3. ★시드 결정론 — 같은 날은 같은 판, 플레이는 난수를 안 쓴다');
{
  const A = boot();
  const K = A.jr.seedKey();
  eq('같은 씨앗은 같은 판을 준다(3라운드 전체)', A.jr.plan(K), A.jr.plan(K));
  ok('다른 날짜 씨앗은 다른 판을 준다',
     JSON.stringify(A.jr.plan(A.jr.seedKey('2026-01-02T00:00:00'))) !== JSON.stringify(A.jr.plan(K)));
  const p = A.jr.plan(K);
  eq('오늘의 도전은 3라운드다', p.length, A.jr.const().ROUNDS);
  ok('유형은 두 가지 중 하나다', p.every(r => A.jr.const().VARIANTS.includes(r.variant)));
  ok('목표 자리는 정해진 범위 안이다', p.every(r => r.target >= A.jr.const().TARGET_MIN - 1e-9 && r.target <= A.jr.const().TARGET_MAX + 1e-9),
     JSON.stringify(p.map(r => r.target)));
  ok('주기는 500ms 이상이다', p.every(r => r.periodMs >= 500), JSON.stringify(p.map(r => r.periodMs)));
  /* 씨앗이 실제로 갈라 놓는지 — 20일치를 뽑아 서로 다른 판이 충분히 나오는지 본다 */
  const days = Array.from({length: 20}, (_, i) => A.jr.plan(A.jr.seedKey(`2026-03-${String(i + 1).padStart(2,'0')}T00:00:00`)));
  const uniq = new Set(days.map(d => JSON.stringify(d)));
  ok('20일치 판이 서로 다르다(같은 판 반복 없음)', uniq.size === 20, `서로 다른 판 ${uniq.size}/20`);

  /* ★플레이 행동이 난수를 소비하지 않는다 — 오늘의 도전을 끝까지 치면서 센다 */
  const B = boot();
  B.dailyBtn();
  B.resetRand();                                   /* 판을 짜는 데 쓴 난수는 세지 않는다(씨앗 기반이라 0이어야 하지만) */
  playRun(B, [700, 900, 1100], 5);
  eq('플레이 행동은 난수를 한 번도 소비하지 않는다(오늘의 도전)', B.rand(), 0);
  ok('세 라운드가 다 기록됐다', B.jr.state().rounds.length === 3, String(B.jr.state().rounds.length));

  /* 같은 날짜로 두 번 돌리면 판정 값까지 같아야 한다(같은 시각에 누르면) */
  const C = boot(); C.dailyBtn();
  const D = boot(); D.dailyBtn();
  const rc = playRun(C, [700, 900, 1100], 3);
  const rd = playRun(D, [700, 900, 1100], 11);
  const shape = rs => rs.map(r => r ? [r.err.toFixed(12), r.acc.toFixed(12)] : null);
  ok('전제 — 비교한 두 판이 모두 세 라운드를 확정했다', rc.every(Boolean) && rd.every(Boolean),
     `C=${rc.filter(Boolean).length}/3 D=${rd.filter(Boolean).length}/3`);
  eq('같은 날·같은 시각 입력이면 세 라운드 결과가 같다', shape(rc), shape(rd));

  /* 자유 모드는 판을 짤 때만 난수를 쓴다 */
  const E = boot();
  E.startBtn();
  const usedAtStart = E.rand();
  E.resetRand();
  playRun(E, [600, 800, 1000], 4);
  ok('자유 모드도 플레이 중에는 난수를 안 쓴다', E.rand() === 0, String(E.rand()));
  ok('자유 모드는 판을 짤 때 난수를 쓴다(씨앗 대신 무작위)', usedAtStart > 0, String(usedAtStart));
}

/* ============================================================ 4. ★논리 즉시 확정 (3-3) */
section('4. ★논리 즉시 확정 — 연출을 기다리지 않는다');
{
  const A = boot(); A.dailyBtn();
  /* 타이머를 한 번도 돌리지 않고, 프레임도 그리지 않고, 세 라운드를 연속으로 친다 */
  A.press(0); A.advance(500);  A.press(0);
  A.press(0); A.advance(700);  A.press(0);
  A.press(0); A.advance(900);  A.press(0);
  const st = A.jr.state();
  ok('타이머를 돌리지 않고 연속으로 눌러도 라운드가 밀리지 않는다', st.rounds.length === 3,
     `기록된 라운드 ${st.rounds.length}`);
  ok('세 라운드가 끝나면 결과 창이 뜬다', A.jr.shown('over'));
  ok('결과가 즉시 확정된다(타이머 없이도 result 가 있다)', !!A.jr.result());
  /* 라운드 사이에 대기 시간이 얼마든 끼어도 판정은 각 라운드의 경과로만 난다 */
  const B = boot(); B.dailyBtn();
  const p = B.jr.state().plan;
  B.press(0); B.advance(333); B.press(0);
  B.advance(5000);                                   /* 라운드 사이에 5초를 흘려 본다 */
  B.press(0); B.advance(333); B.press(0);
  /* ★정지한 자리가 남아 있어야 사용자가 자기 오차를 눈으로 본다(실브라우저에서 잡힌 결함) */
  const C2 = boot(); C2.dailyBtn();
  C2.press(0); C2.advance(437); C2.press(0);
  const r0 = C2.jr.state().rounds[0] || null;
  const drawnAfterStop = C2.jr.drawn();
  ok('전제 — 첫 라운드가 확정됐다(잴 대상이 있다)', !!r0, `확정 ${C2.jr.state().rounds.length}`);
  ok('정지한 자리가 다음 라운드를 시작할 때까지 화면에 남는다',
     !!r0 && Math.abs(drawnAfterStop.pos - r0.pos) < 1e-9,
     r0 ? `그린 위치 ${drawnAfterStop.pos} · 판정 위치 ${r0.pos}` : '★잴 대상 0 — 판정 불가는 통과가 아니다');
  ok('다음 라운드를 시작하면 그 라운드의 무대가 0 에서 다시 선다',
     (() => { C2.press(0); const d = C2.jr.drawn(); return Math.abs(d.pos - 0) < 1e-9 && d.elapsedMs === 0; })(),
     JSON.stringify(C2.jr.drawn()));
  ok('라운드 사이에도 남은 라운드 수가 칩에 보인다', C2.txt('roundChip') !== '', C2.txt('roundChip'));

  const r = B.jr.state().rounds;
  ok('전제 — 두 번째 라운드가 확정돼 있다(잴 대상이 있다)', !!r[1], `확정된 라운드 ${r.length}`);
  near('라운드 사이의 대기는 판정에 섞이지 않는다',
       r[1] ? r[1].err : NaN, B.jr.errorOf(B.jr.posAt(p[1].variant, p[1].periodMs, 333), p[1].target), 1e-9);
}

/* ============================================================ 5. 저장·오늘의 한판 어댑터 계약 */
section('5. 저장 레코드 — 「오늘의 한판」 어댑터가 읽을 수 있는 형태인가');
{
  const A = boot(); A.dailyBtn();
  playRun(A, [600, 800, 1000], 2);
  const raw = A.store.getItem('jr.daily');
  ok('jr.daily 가 저장됐다', !!raw);
  const rec = JSON.parse(raw);
  const today = new Date();
  const dk = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  eq('date 가 오늘이다(허브의 dayKey 와 같은 계산식)', rec.date, dk);
  ok('result 가 있다 — wrapped 어댑터의 완료 조건', !!rec.result);
  ok('result.acc 가 유한한 수다(허브가 정확도로 찍는다)',
     typeof rec.result.acc === 'number' && isFinite(rec.result.acc), String(rec.result && rec.result.acc));
  ok('result.rounds 가 3개다', !!rec.result && Array.isArray(rec.result.rounds) && rec.result.rounds.length === 3,
     rec.result ? String((rec.result.rounds || []).length) : 'result 없음');
  /* 허브 어댑터가 실제로 하는 판독을 그대로 흉내 낸다 */
  const hub = (r, todayKey) => {
    if (!r || r.date !== todayKey) return { done:false };
    if (!r.result) return { done:false };
    const v = r.result.acc;
    if (typeof v !== 'number' || !isFinite(v)) return { done:true, value:null };
    return { done:true, value: (Math.round(v * 1000) / 10).toFixed(1) };
  };
  const read = hub(rec, dk);
  ok('허브 판독 흉내 — 완료로 읽힌다', read.done === true);
  ok('허브 판독 흉내 — 값이 나온다', read.value !== null, String(read.value));

  /* 하루 한 번 */
  const before = A.store.getItem('jr.daily');
  A.againBtn();                                       /* 이미 오늘 도전을 마쳤으니 자유 모드로 간다 */
  eq('완료 뒤 다시 하기는 자유 모드로 간다', A.jr.state().mode, 'free');
  const B = boot({ store: A.store });
  B.dailyBtn();
  playRun(B, [100, 100, 100], 1);
  eq('오늘의 도전은 하루 한 번 — 두 번째 완주가 기록을 덮지 않는다', B.store.getItem('jr.daily'), before);

  /* 스트릭 */
  const C = boot();
  C.dailyBtn(); playRun(C, [500, 500, 500], 1);
  eq('첫 도전이면 스트릭 1', C.jr.daily().streak, 1);

  /* 자유 모드 최고 기록 */
  const D = boot();
  D.startBtn(); playRun(D, [123, 456, 789], 1);
  const best1 = D.jr.best();
  ok('자유 모드 최고 기록이 저장된다', !!best1 && typeof best1.acc === 'number');
  const E = boot({ store: D.store });
  E.startBtn(); playRun(E, [7, 11, 13], 1);
  const best2 = E.jr.best();
  const eRes = E.jr.result();
  const eAcc = eRes ? eRes.acc : null;
  ok('전제 — 두 판 모두 결과가 확정됐다(잴 대상이 있다)', !!best1 && !!best2 && eAcc !== null,
     `best1=${!!best1} best2=${!!best2} result=${!!eRes}`);
  ok('자유 모드 최고 기록은 더 높은 정확도일 때만 바뀐다',
     !!best1 && !!best2 && eAcc !== null &&
     best2.acc >= best1.acc && best2.acc === Math.max(best1.acc, eAcc),
     best1 && best2 && eAcc !== null ? `이전 ${best1.acc} · 이번 판 ${eAcc} · 지금 ${best2.acc}`
                                     : '★잴 대상 0 — 판정 불가는 통과가 아니다');
  ok('betterThan 은 더 높은 정확도만 참이다',
     E.jr.betterThan({acc:0.9}, {acc:0.8}) === true && E.jr.betterThan({acc:0.7}, {acc:0.8}) === false);
}

/* ============================================================ 6. 저장 키 — 방침 대조 대상 */
section('6. 저장 키 — 쓰는 키가 정확히 무엇인가');
{
  const A = boot();
  A.dailyBtn(); playRun(A, [300, 400, 500], 1);
  const B = boot({ store: A.store });
  B.startBtn(); playRun(B, [300, 400, 500], 1);
  B.el('btnSound').onclick();                        /* 소리 설정도 저장된다 */
  B.el('btnLang').onclick();                         /* 언어도 저장된다(사이트 공용 키) */
  const keys = B.store.keys().sort();
  eq('제품이 쓰는 저장 키는 이 다섯뿐이다', keys, ['bp.lang','jr.best','jr.daily','jr.sound','jr.streak']);
  note('jr.* 네 개 + 사이트 공용 bp.lang — 개인정보 항목 0');
}

/* ============================================================ 7. 화면·언어 */
section('7. 화면·언어 — 진행 중 내용이 안내 문구로 덮이지 않는가');
{
  const A = boot(); A.dailyBtn();
  A.press(0); A.advance(300); A.frame();
  const mainBefore = A.txt('padMain'), chipBefore = A.txt('varChip');
  A.el('btnLang').onclick();                          /* 재는 도중에 언어를 바꾼다 */
  ok('언어를 바꿔도 판의 글이 안내 문구로 갈아엎어지지 않는다',
     A.txt('padMain') !== '' && A.txt('padMain') !== mainBefore || A.jr.lang() === 'en',
     `before=${mainBefore} after=${A.txt('padMain')}`);
  ok('진행 중에도 라운드 칩이 비지 않는다', A.txt('roundChip') !== '');
  ok('유형 칩이 언어를 따라 바뀐다', A.txt('varChip') !== chipBefore, `${chipBefore} → ${A.txt('varChip')}`);
  A.press(0);                                          /* 언어를 바꾼 뒤에도 정지가 정상 동작한다 */
  ok('언어 전환 뒤에도 라운드가 정상적으로 기록된다', A.jr.state().rounds.length === 1);

  const B = boot(); B.dailyBtn();
  B.press(0);
  ok('시작하면 body 에 진행 표시가 붙는다', B.jr.running());
  B.advance(200); B.press(0);
  ok('정지하면 진행 표시가 걷힌다', !B.jr.running());
  ok('정지하면 그리기가 멈춘다', !B.jr.drawing());
  ok('낭독기 요약이 채워진다', B.txt('srSummary') !== '');
}

/* ============================================================ 8. 입력 경로 */
section('8. 입력 — 키보드와 포인터가 같은 자리를 잰다');
{
  const A = boot(); A.dailyBtn();
  A.key(' '); A.advance(400); A.key(' ');
  const viaKey = A.jr.state().rounds[0] || null;
  const B = boot(); B.dailyBtn();
  B.press(0); B.advance(400); B.press(0);
  const viaPointer = B.jr.state().rounds[0] || null;
  ok('전제 — 두 입력 경로 모두 라운드를 확정했다', !!viaKey && !!viaPointer,
     `key=${viaKey ? 1 : 0} pointer=${viaPointer ? 1 : 0}`);
  ok('Space 로 친 판정과 포인터로 친 판정이 같다',
     !!viaKey && !!viaPointer &&
     viaKey.err.toFixed(12) === viaPointer.err.toFixed(12) &&
     viaKey.acc.toFixed(12) === viaPointer.acc.toFixed(12),
     viaKey && viaPointer ? `${viaKey.err} vs ${viaPointer.err}` : '★잴 대상 0 — 판정 불가는 통과가 아니다');

  /* 창이 떠 있는 동안의 입력은 판에 닿지 않는다 */
  const C = boot();
  C.press(0);
  eq('시작 창이 떠 있으면 판 입력이 무시된다', C.jr.state().rounds.length, 0);
  ok('시작 창이 떠 있는 동안은 진행 표시도 없다', !C.jr.running());
}

/* ============================================================ 9. 정적 검사 — 마크업·클래스·문구 */
section('9. 정적 검사 — 소스에 대한 계약');
{
  const html = RAW;
  /* ★마크업이 쓰는 키가 두 언어 표에 다 있는가 — 없으면 그 요소는 ★기본 한국어 HTML 이 그대로 남는다.
     실브라우저 EN 캡처에서 본문 산문이 한국어로 남아 있던 것이 이 검사가 없어서 새어 나온 자리다. */
  {
    const usedKeys = [...new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]))];
    /* ★표는 실행해서 읽는다(정규식 파싱은 한 줄 여러 키·문장 속 콜론에서 어긋난다) */
    const K = boot().t.i18nKeys();
    const ko = new Set(K.ko), en = new Set(K.en);
    ok('전제 — ko·en 두 i18n 표를 읽었다(못 읽으면 판정 불가)', !!ko && !!en,
       `ko=${ko ? ko.size : 'null'} en=${en ? en.size : 'null'}`);
    const missKo = ko ? usedKeys.filter(k => !ko.has(k)) : usedKeys;
    const missEn = en ? usedKeys.filter(k => !en.has(k)) : usedKeys;
    ok('마크업의 data-i18n 키가 ko·en 두 표에 모두 있다',
       !!ko && !!en && missKo.length === 0 && missEn.length === 0,
       `쓰인 키 ${usedKeys.length} · ko 누락 [${missKo}] · en 누락 [${missEn}]`);
    note(`data-i18n 키 ${usedKeys.length}개 · ko 표 ${ko ? ko.size : '?'}항목 · en 표 ${en ? en.size : '?'}항목`);
  }
  ok('data-i18n 이 런타임 갱신 요소에 붙지 않았다(판·칩·결과 수치)',
     !/id="(padMain|padSub|varChip|roundChip|marks|finalAccBig|finalErrLine|nRounds|nErr|nAcc|finalSub|dailyHint|bestNow|modeNow|streakNowEl)"[^>]*data-i18n/.test(html) &&
     !/data-i18n[^>]*id="(padMain|padSub|varChip|roundChip|marks|finalAccBig|finalErrLine|nRounds|nErr|nAcc|finalSub|dailyHint|bestNow|modeNow|streakNowEl)"/.test(html));
  ok('전역 유틸 이름(.hint)을 쓰지 않는다 — 상태 이름과 겹치는 자리를 만들지 않았다',
     !/class="[^"]*\bhint\b/.test(html), '클래스 hint 사용');
  ok('게임 고유 클래스에 jr- 접두가 붙어 있다',
     /class="jr-pad"/.test(html) && /class="jr-track"/.test(html) && /class="jr-gauge"/.test(html));
  ok('hp-stats.js 를 defer 로 싣는다', /<script src="\/js\/hp-stats\.js" defer><\/script>/.test(html));
  ok('시작 화면에 판수 줄이 있다(처음엔 hidden)',
     /<p class="hp-stat" data-hp-line hidden data-i18n="statPlays">/.test(html));
  ok('hidden 가드가 있다', /\.hp-stat\[hidden\]\s*{[^{}]*display\s*:\s*none\s*!important[^{}]*}/.test(html));
  const st = [...html.matchAll(/statPlays:'([^']*)'/g)].map(m => m[1]);
  ok('statPlays 문안이 ko·en 두 곳에 있다', st.length === 2, String(st.length));
  ok('한국어 판수 문안이 다수파 꼴이다',
     /^오늘 <b data-hp="plays\.just-right\.today">[^<]*<\/b>판 · 누적 <b data-hp="plays\.just-right\.total">[^<]*<\/b>판$/.test(st[0] || ''), st[0]);
  ok('영어 판수 문안이 다수파 꼴이다',
     /^<b data-hp="plays\.just-right\.today">[^<]*<\/b> today · <b data-hp="plays\.just-right\.total">[^<]*<\/b> all-time$/.test(st[1] || ''), st[1]);
  const gaStarts = [...html.matchAll(/ga\('game_start'/g)].length;
  const paired = [...html.matchAll(/ga\('game_start', \{ game: GA_GAME(?![A-Za-z0-9_$])[^;\n]*\);(\s*\/\*[^*]*\*\/)?\s*\n\s*if \(window\.hpHit\) window\.hpHit\('play', GA_GAME\);/g)].length;
  ok(`hpHit('play') 가 시작 지점 ${gaStarts}곳 전부에 짝지어 있다`, paired === gaStarts && gaStarts > 0, `짝 ${paired} / 시작 ${gaStarts}`);
  const playHits = [...html.matchAll(/window\.hpHit\('play', GA_GAME\)/g)].length;
  ok('hpHit 호출이 시작 지점 수와 같다(떠도는 호출 0)', playHits === gaStarts, `호출 ${playHits} / 시작 ${gaStarts}`);
  ok('언어를 바꾼 뒤 숫자를 다시 채운다',
     /localStorage\.setItem\('bp\.lang', lang\);[\s\S]{0,240}if \(window\.hpStats\) window\.hpStats\(\)/.test(html));
  ok('검증 창구에 상태를 바꾸는 명령이 없다(관측 전용)',
     !/__jr\s*=\s*{[\s\S]*?\bbegin\s*:/.test(html) && !/__jr\s*=\s*{[\s\S]*?\bpress\s*:/.test(html) &&
     !/__jrTest/.test(html), '배포본에 시험 다리가 남아 있다');
  ok('외부 스크립트는 사이트 공용 셋뿐이다(게임 로직은 외부 의존 0)',
     [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1])
       .every(u => /googlesyndication|googletagmanager|^\/js\/hp-stats\.js$/.test(u)));
  ok('결과·게이지 위치를 CSS 애니메이션으로 만들지 않는다',
     /\.jr-marker,\.jr-fill\{transition:none!important;animation:none!important\}/.test(html));
}

/* ============================================================ 결과 */
console.log(`\n${'='.repeat(56)}`);
console.log(`PASS ${pass} · FAIL ${fail}`);
if (fail){ console.log('실패한 검사:'); for (const f of failures) console.log('  - ' + f); }
if (MUTATION){
  const c = MUTATIONS[MUTATION].catcher;
  const caught = failures.includes(c);
  console.log(`[mutate] ${MUTATION} — 지목한 검사 "${c}" 가 ${caught ? '붉었다(귀속 일치)' : '★붉지 않았다(무임승차 또는 미탐지)'}`);
}
process.exit(fail ? 1 : 0);
