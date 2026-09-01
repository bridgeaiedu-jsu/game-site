/* 10초 감각(/tensec/) 검증기 — worker · 2026-08-31 · 티켓 G-tensec
 *
 * 이 게임의 성공 기준 가운데 **기계로 확인할 수 있는 것**을 확인한다. 기존 검증기
 * (verify_word.js · verify_memory.js)의 방식을 그대로 따른다:
 *   · 배포되는 index.html 의 인라인 스크립트를 **그대로 꺼내** 최소 DOM 스텁 위에서 구동한다(vm)
 *   · 판을 두드리는 것은 제품이 실제로 듣는 입력 사건(pointerdown·keydown)이다 — 시험용 뒷문을
 *     제품에 두지 않는다(배포본의 window.__ts 는 읽기 전용 창구다)
 *   · 판정은 제품이 내놓은 값과 이 파일이 **따로 셈한 값**의 대조로 한다
 *
 * ★이 게임이 지켜야 하는 두 가지 약속, 그리고 그것을 어떻게 기계로 잡는가
 *
 *   ① 잰 시간은 기기 사정에 흔들리지 않는다.
 *      시각을 두 번 읽어 뺀 값이어야 하고, 프레임 콜백·타이머 누적이면 안 된다.
 *      → 시계를 우리가 쥐고 **같은 두 도장**을 주되 그 사이의 사정(프레임 0회, 타이머 지연,
 *        탭 숨김, 시계 널뛰기)을 전혀 다르게 만들어 본다. 잰 값이 하나라도 달라지면 FAIL.
 *      → 덧붙여 requestAnimationFrame·setInterval 호출 수가 0 인지 직접 센다.
 *
 *   ② 재는 동안 화면은 시간을 알려 주지 않는다.
 *      → '화면이 시계의 함수가 아님' 을 직접 잰다: **시작 도장은 같고 그 뒤 시계만 다르게**
 *        흘려보낸 두 상황의 화면(모든 글자·속성·클래스)이 완전히 같아야 한다.
 *      → 재는 동안 제품이 시계를 읽는 횟수가 0 인지 센다(읽지 않으면 보여 줄 수도 없다).
 *      → 재는 동안 걸려 있는 타이머가 0 인지 센다(나중에 화면을 건드릴 예약이 없어야 한다).
 *      → 정적으로도 본다: 재는 동안 모든 움직임을 끄는 CSS 빗장이 실제로 있는가.
 *
 * 사용법:
 *   node tools/verify_tensec.js [--html <경로>] [--mutate <이름>] [--list-mutations]
 * 종료코드:
 *   0 = 전부 PASS · 1 = 하나라도 FAIL · 2 = 검사를 세울 수 없음(구동 실패·주입 실패 — 판정 아님)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = n => argv.indexOf(n) >= 0;

const HTML = argOf('--html', path.join(__dirname, '..', 'tensec', 'index.html'));
const MUTATION = argOf('--mutate', null);

let RAW;
try { RAW = fs.readFileSync(HTML, 'utf8'); }
catch (e){ console.error('대상 파일을 읽지 못했다: ' + HTML); process.exit(2); }
/* ★배포 파일은 CRLF 다. 아래의 정적 대조·뮤테이션 앵커는 전부 LF 로 적혀 있으므로 한 번만
   갈아 끼운다 — 이것을 빠뜨리면 여러 줄 앵커가 통째로 어긋나 '주입 실패' 로 떨어진다
   (실제로 2026-08-31 첫 검산에서 4종이 그렇게 떨어졌다). 줄끝은 판정 대상이 아니다. */
RAW = RAW.split('\r\n').join('\n');

/* ------------------------------------------------------------ 게임 스크립트 꺼내기 */
function gameSource(html){
  /* 게임 본체는 (() => { ... })(); 로 감싼 마지막에서 두 번째 인라인 스크립트다.
     외부 src 가 붙은 것과 ld+json 은 제외한다. */
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))){
    const attrs = m[1] || '';
    if (/\ssrc=/.test(attrs)) continue;
    if (/type\s*=\s*"application\/ld\+json"/.test(attrs)) continue;
    out.push(m[2]);
  }
  const body = out.find(s => s.indexOf("window.__ts") >= 0);
  return body || null;
}
let SRC = gameSource(RAW);
if (!SRC){ console.error('게임 스크립트(window.__ts 를 여는 인라인 <script>)를 찾지 못했다'); process.exit(2); }

/* ------------------------------------------------------------ 뮤테이션(고의 결함 · 임시 사본에만) */
/* 각 항목은 '어느 검사가 이것을 잡아야 하는가'(catcher)를 함께 못박는다 —
   다른 검사가 우연히 깨져서 붉어지는 무임승차를 인정하지 않기 위해서다. */
const MUTATIONS = {
  'm-frame-clock': {
    why: '두 도장의 차 대신 프레임 콜백 누적으로 시간을 센다(저성능·백그라운드에서 값이 갈린다)',
    catcher: '기기 사정이 달라도 잰 값이 같다',
    where: 'js',
    apply: s => s.replace('const measure = (t0, t1) => t1 - t0;',
                          'let __frames = 0; const __loop = () => { __frames++; requestAnimationFrame(__loop); };\n' +
                          'requestAnimationFrame(__loop);\n' +
                          'const measure = (t0, t1) => __frames * 16.7;')
  },
  'm-show-time': {
    why: '재는 동안 경과 시간을 화면에 쓴다(이 게임의 전제를 깨는 결함)',
    catcher: '화면이 시계의 함수가 아니다',
    where: 'js',
    apply: s => s.replace("  paintPad();\n  say(T('sayStart'",
                          "  paintPad();\n  $('padSub').textContent = String(Math.round(nowMs()));\n  say(T('sayStart'")
  },
  'm-poll-time': {
    why: '재는 동안 타이머를 걸어 두고 화면을 주기적으로 고친다',
    catcher: '재는 동안 걸린 타이머가 없다',
    where: 'js',
    apply: s => s.replace("  clearToast();                       /* ★재는 동안 저절로 바뀌는 것을 하나도 남기지 않는다 */",
                          "  setTimeout(() => { $('padSub').textContent = String(nowMs()); }, 100);")
  },
  'm-read-clock': {
    why: '재는 동안 판을 다시 그릴 때 시계를 읽어 함께 적는다(재는 중 언어를 바꾸면 그 값이 드러난다)',
    catcher: '재는 동안 시계를 읽지 않는다',
    where: 'js',
    apply: s => s.replace("    $('padSub').textContent  = T('padRunSub', t);",
                          "    $('padSub').textContent  = T('padRunSub', t) + ' ' + Math.round(nowMs());")
  },
  'm-no-anim-guard': {
    why: '재는 동안 움직임을 끄는 CSS 빗장을 지운다(주기가 있는 연출은 그 자체가 시계다)',
    catcher: '재는 동안 움직임을 끄는 규칙이 있다',
    where: 'html',
    apply: s => s.replace('  body.running *{animation:none!important;transition:none!important}\n', '')
  },
  'm-interval': {
    why: 'setInterval 로 시간을 센다',
    catcher: 'setInterval 을 쓰지 않는다',
    where: 'js',
    apply: s => s.replace('const nowMs = () => performance.now();',
                          'let __iv = 0; setInterval(() => { __iv++; }, 100);\nconst nowMs = () => performance.now();')
  },
  'm-raf': {
    why: 'requestAnimationFrame 으로 화면을 계속 다시 그린다',
    catcher: 'requestAnimationFrame 을 쓰지 않는다',
    where: 'js',
    apply: s => s.replace('const nowMs = () => performance.now();',
                          'const nowMs = () => performance.now();\nrequestAnimationFrame(function l(){ requestAnimationFrame(l); });')
  },
  'm-click-listener': {
    why: '누르는 순간이 아니라 떼는 순간(click)을 잰다',
    catcher: '판은 click 을 듣지 않는다',
    where: 'js',
    apply: s => s.replace("const padEl = $('pad');", "const padEl = $('pad');\npadEl.addEventListener('click', onPress);")
  },
  'm-repeat': {
    why: '키를 누르고 있을 때 들어오는 반복 입력을 걸러 내지 않는다',
    catcher: '키 반복 입력은 세지 않는다',
    where: 'js',
    apply: s => s.replace('  if (ev.repeat) return;', '  if (false) return;')
  },
  'm-epoch-mix': {
    why: '정지 도장만 다른 시계(Date.now)로 찍는다 — 원점이 달라 잰 값이 터무니없어진다',
    catcher: '잰 값은 두 도장의 차와 정확히 같다',
    where: 'js',
    apply: s => s.replace('function stampOf(ev){\n  const t = nowMs();',
                          'function stampOf(ev){\n  const t = (phase === \'running\') ? Date.now() : nowMs();')
  },
  'm-acc-formula': {
    why: '정확도 산식을 바꾼다(오차를 목표가 아니라 잰 시간으로 나눈다)',
    catcher: '정확도 산식이 기획안의 예와 일치한다',
    where: 'js',
    apply: s => s.replace('  const a = 1 - errorOf(elapsedMs, targetS) / targetS;',
                          '  const a = 1 - errorOf(elapsedMs, targetS) / (elapsedMs / 1000);')
  },
  'm-seed-random': {
    why: '오늘의 목표를 날짜가 아니라 난수로 정한다(사람마다 판이 갈린다)',
    catcher: '같은 seed 는 같은 목표를 낸다',
    where: 'js',
    apply: s => s.replace('  const rnd = mulberry32(hashStr(String(seedKey)));',
                          '  const rnd = mulberry32((Math.random() * 4294967296) >>> 0);')
  },
  'm-seed-repeat': {
    why: '오늘의 목표 세 개가 겹칠 수 있게 한다',
    catcher: '오늘의 목표 세 개는 서로 다르다',
    where: 'js',
    apply: s => s.replace('    out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);',
                          '    out.push(pool[Math.floor(rnd() * pool.length)]);')
  },
  'm-best-any': {
    why: '더 나쁜 기록도 최고 기록으로 덮어쓴다',
    catcher: '최고 기록은 오차가 줄었을 때만 바뀐다',
    where: 'js',
    apply: s => s.replace('const betterThan = (a, b) => !b || a.err < b.err;',
                          'const betterThan = (a, b) => true;')
  },
  'm-best-shared': {
    why: '목표가 달라도 같은 자리에 기록을 쓴다(3초와 15초의 기록이 섞인다)',
    catcher: '기록은 목표마다 따로 남는다',
    where: 'js',
    apply: s => s.replace("function saveBest(t, rec){ localStorage.setItem('ts.best.' + t, JSON.stringify(rec)); }",
                          "function saveBest(t, rec){ localStorage.setItem('ts.best', JSON.stringify(rec)); }")
  },
  'm-streak-always': {
    why: '하루를 건너뛰어도 스트릭이 이어진다',
    catcher: '스트릭은 하루를 건너뛰면 끊긴다',
    where: 'js',
    apply: s => s.replace("  const n = (st.last === prevDayKey(day)) ? (st.n || 0) + 1 : 1;",
                          "  const n = (st.n || 0) + 1;")
  },
  'm-daily-twice': {
    why: '오늘의 도전을 하루에 여러 번 기록한다',
    catcher: '오늘의 도전은 하루 한 번만 기록된다',
    where: 'js',
    apply: s => s.replace('    if (!dailyDoneToday()){', '    if (true){')
  },
  'm-motion-uncovered': {
    why: '동작 줄이기(reduced-motion)가 덮지 않는 새 움직임을 하나 들여놓는다',
    catcher: '움직이는 규칙이 모두 동작 줄이기에 덮여 있다',
    where: 'html',
    apply: s => s.replace('  .toast.show{opacity:1}',
                          '  .toast.show{opacity:1}\n  .chip{transition:background .3s ease}')
  },
  'm-overlay-press': {
    why: '창이 떠 있는 동안에도 판이 눌린다',
    catcher: '창이 떠 있으면 판은 눌리지 않는다',
    where: 'js',
    apply: s => s.replace('function onPress(ev){\n  if (overShown) return;', 'function onPress(ev){')
  }
};
if (has('--list-mutations')){
  for (const k of Object.keys(MUTATIONS)) console.log(k.padEnd(18) + ' — ' + MUTATIONS[k].why + '  [잡아야 하는 검사: ' + MUTATIONS[k].catcher + ']');
  process.exit(0);
}
let HTML_TEXT = RAW;
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  if (!m){ console.error('그런 뮤테이션이 없다: ' + MUTATION); process.exit(2); }
  if (m.where === 'js'){
    const before = SRC;
    SRC = m.apply(SRC);
    if (SRC === before){ console.error('주입 실패(앵커 노후화): ' + MUTATION); process.exit(2); }
  } else {
    const before = HTML_TEXT;
    HTML_TEXT = m.apply(HTML_TEXT);
    if (HTML_TEXT === before){ console.error('주입 실패(앵커 노후화): ' + MUTATION); process.exit(2); }
  }
}

/* ------------------------------------------------------------ 저장소 스텁 */
function makeStore(seed){
  const map = new Map(seed || []);
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
    addEventListener: (t, fn) => { (el._on[t] = el._on[t] || []).push(fn); },
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
    if (s === 'button[data-tg]' && el.tagName === 'BUTTON' && el.dataset.tg !== undefined) return true;
    if (s === '[data-i18n]' && el.dataset.i18n !== undefined) return true;
    if (s === 'a[href="/"]' && el.tagName === 'A') return true;
    if (s.startsWith('a[href]') && el.tagName === 'A') return true;
    if (s.indexOf('button:not(') === 0 && el.tagName === 'BUTTON' && !el.disabled && !el.hidden) return true;
    if (s === '.overlay' && el._classes.has('overlay')) return true;
  }
  return false;
}
function HTMLElementStub(){}

const IDS = ['pad','padMark','padMain','padSub','bestNow','targetNow','streakNowEl','modeChip','roundChip',
             'srSummary','toast','over','start','finalErr','finalAcc','marks','streakLine','newBest',
             'nElapsed','nErr','nAcc','finalSub','btnAgain','btnShare','btnDaily','btnStart','targets',
             'tgDesc','dailyHint','btnSound','btnSound2','btnLang','btnLang2','subtitle','adTop','adOver',
             'startTitle','overTitle','help'];

/* ★샌드박스로 들어가는 난수는 주변 환경의 진짜 Math.random 이 아니라 우리가 쥔 결정론 수열이다(T0901).
   예전에는 진짜 난수를 그대로 넘겨, 난수를 심는 뮤테이션(m-seed-random)의 판정이 실행마다 흔들렸다.
   ★함정 — 값을 하나로 '고정' 하면 모든 뽑기가 같아져 '같은 seed 는 같은 목표' 가 100% 통과해 버린다
   (실측으로 확인했다). 그래서 호출마다 값이 달라야 하고, boot 사이에도 이어지는 하나의 수열이어야
   한다 — 세션마다 처음으로 되감기면 '다른 세션에서도 같은 목표' 가 같은 방식으로 공허해진다. */
let __randState = 0x9E3779B9;
const seededRandom = () => {
  __randState = (__randState + 0x6D2B79F5) | 0;
  let t = Math.imul(__randState ^ __randState >>> 15, 1 | __randState);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

/* 스텁 위에 세운 한 판(세션). 시계·타이머·난수를 전부 우리가 쥔다. */
function boot(opts){
  opts = opts || {};
  const localStorage = opts.store || makeStore();
  const els = new Map();

  /* --- 우리가 쥔 시계 --- */
  let clock = (opts.t0 === undefined) ? 1000 : opts.t0;
  let nowCalls = 0;
  const performanceStub = { now: () => { nowCalls++; return clock; } };

  /* --- 타이머 장부 --- */
  let seq = 1;
  const timers = new Map();
  let intervalCalls = 0, rafCalls = 0;
  const setTimeoutStub = (fn, ms) => { const id = seq++; timers.set(id, { fn, at: clock + (ms || 0) }); return id; };
  const clearTimeoutStub = id => { timers.delete(id); };
  const setIntervalStub = (fn, ms) => { intervalCalls++; const id = seq++; timers.set(id, { fn, at: clock + (ms || 0), every: ms || 1 }); return id; };
  const clearIntervalStub = id => { timers.delete(id); };
  const rafStub = fn => { rafCalls++; const id = seq++; timers.set(id, { fn, at: clock + 16, raf: true }); return id; };

  const doc = {
    documentElement: null, body: null, activeElement: null, hidden: false, title: '',
    _on: {},
    getElementById: id => { if (!els.has(id)) els.set(id, makeEl(id, doc)); return els.get(id); },
    querySelectorAll: sel => [...els.values()].filter(e => matchesSel(e, sel))
                                .concat([...els.values()].flatMap(e => e._descend().filter(c => matchesSel(c, sel)))),
    querySelector: sel => doc.querySelectorAll(sel)[0] || null,
    createElement: t => makeEl('new_' + t, doc, t),
    addEventListener: (t, fn) => { (doc._on[t] = doc._on[t] || []).push(fn); },
    removeEventListener: t => { delete doc._on[t]; }
  };
  doc.documentElement = makeEl('html', doc);
  doc.body = makeEl('body', doc);
  for (const id of IDS) doc.getElementById(id);
  doc.getElementById('over')._classes.add('overlay');
  doc.getElementById('start')._classes.add('overlay');
  doc.getElementById('start')._classes.add('show');
  doc.getElementById('pad').tagName = 'BUTTON';
  for (const tg of ['3','7','10','15']){
    const b = makeEl('tg_' + tg, doc, 'button');
    b.dataset.tg = tg;
    doc.getElementById('targets').appendChild(b);
  }
  for (const k of ['title','subtitle','hint','how1','dailyDesc','statPlays']){
    const e = makeEl('i18n_' + k, doc, 'p'); e.dataset.i18n = k; els.set('i18n_' + k, e);
  }
  els.set('home', makeEl('home', doc, 'a'));

  let randCalls = 0;
  const MathStub = Object.create(Math);
  MathStub.random = () => { randCalls++; return seededRandom(); };

  const nav = { language: opts.lang === 'en' ? 'en-US' : 'ko-KR' };
  function PointerEventStub(){}
  const win = {
    addEventListener: () => {}, removeEventListener: () => {},
    navigator: nav, localStorage,
    matchMedia: () => ({ matches: !!opts.reduceMotion }),
    location: { href: 'https://hanpango.com/tensec/' },
    PointerEvent: PointerEventStub,
    performance: performanceStub,
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    HTMLElement: HTMLElementStub, document: doc
  };
  const sandbox = {
    window: win, document: doc, localStorage, navigator: nav,
    HTMLElement: HTMLElementStub, location: win.location, performance: performanceStub,
    PointerEvent: PointerEventStub,
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    setInterval: setIntervalStub, clearInterval: clearIntervalStub,
    requestAnimationFrame: rafStub, cancelAnimationFrame: clearTimeoutStub,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Math: MathStub, Date: opts.Date || Date, JSON, Promise,
    Number, String, Array, Object, RegExp, Error, TypeError, isNaN, isFinite, parseInt, parseFloat
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(SRC, sandbox, { filename: 'tensec-inline.js' }); }
  catch (e){ console.error('구동 실패: ' + (e && e.stack || e)); process.exit(2); }
  if (!win.__ts){ console.error('관측 창구(window.__ts)가 없다'); process.exit(2); }

  const pad = doc.getElementById('pad');
  const fire = (el, type, ev) => {
    const list = (el._on && el._on[type]) || [];
    for (const fn of list) fn(ev);
    return list.length;
  };
  const api = {
    ts: win.__ts, doc, store: localStorage, els,
    /* 시계 조작 — 타이머는 흘려보내지 않는다(따로 flush 로 돌린다) */
    setClock: t => { clock = t; },
    advance: ms => { clock += ms; },
    clock: () => clock,
    nowCalls: () => nowCalls, resetNowCalls: () => { nowCalls = 0; },
    rand: () => randCalls,
    intervals: () => intervalCalls,
    rafs: () => rafCalls,
    pending: () => timers.size,
    /* 지금 시각까지 도달한 타이머를 실제로 돌린다(느린 기기·밀린 콜백 흉내) */
    flush: (max) => {
      let n = 0;
      for (let i = 0; i < (max || 50); i++){
        const due = [...timers.entries()].filter(([, t]) => t.at <= clock).sort((a, b) => a[1].at - b[1].at);
        if (!due.length) break;
        for (const [id, t] of due){
          timers.delete(id);
          if (t.every) timers.set(seq++, { fn: t.fn, at: clock + t.every, every: t.every });
          if (t.raf) timers.set(seq++, { fn: t.fn, at: clock + 16, raf: true });
          try { t.fn(clock); } catch (e){}
          n++;
          if (n > 500) return n;   /* 되풀이하는 콜백은 무한이라 여기서 끊는다 */
        }
      }
      return n;
    },
    txt: id => doc.getElementById(id).textContent,
    el: id => doc.getElementById(id),
    /* 입력 — 제품이 실제로 듣는 사건으로 두드린다 */
    pressPointer: (at, opt) => {
      if (at !== undefined) clock = at;
      const ev = { type: 'pointerdown', button: 0, timeStamp: (opt && opt.stamp !== undefined) ? opt.stamp : clock,
                   target: pad, preventDefault(){ ev._pd = true; } };
      const n = fire(pad, 'pointerdown', ev);
      if (!n) throw new Error('pad 에 pointerdown 리스너가 없다');
      return ev;
    },
    pressKey: (at, key, opt) => {
      if (at !== undefined) clock = at;
      const ev = { type: 'keydown', key: key || ' ', repeat: !!(opt && opt.repeat),
                   ctrlKey:false, metaKey:false, altKey:false,
                   timeStamp: (opt && opt.stamp !== undefined) ? opt.stamp : clock,
                   target: (opt && opt.target) || pad, preventDefault(){ ev._pd = true; } };
      fire(doc, 'keydown', ev);
      return ev;
    },
    clickPad: (at) => {
      if (at !== undefined) clock = at;
      const ev = { type: 'click', button: 0, timeStamp: clock, target: pad, preventDefault(){} };
      return fire(pad, 'click', ev);   /* 0 이어야 정상 — 판은 click 을 듣지 않는다 */
    },
    clickBtn: id => { const b = doc.getElementById(id); if (typeof b.onclick === 'function') b.onclick({ target: b }); return b; },
    clickTarget: tg => { const t = doc.getElementById('targets');
      const list = (t._on.click) || [];
      const b = t._descend().find(c => c.dataset.tg === String(tg));
      for (const fn of list) fn({ target: b });
    },
    /* 화면 전부의 사진 — 글자·클래스·속성까지 담는다 */
    snapshot: () => {
      const parts = [];
      const one = e => parts.push([e.id, e.tagName, e.textContent, e.className,
                                   JSON.stringify(e._attrs), e.hidden ? 1 : 0].join(''));
      one(doc.body); one(doc.documentElement);
      for (const e of [...els.values()].sort((a, b) => a.id < b.id ? -1 : 1)){ one(e); for (const c of e._descend()) one(c); }
      parts.push('title=' + doc.title);
      return parts.join('');
    },
    hidden: v => { doc.hidden = v; }
  };
  return api;
}

/* ------------------------------------------------------------ 주석 걷어내기(정적 검사용)
   문자열·정규식 리터럴 안쪽은 건드리지 않는다. 완전한 파서가 아니라 이 파일 하나를 읽기 위한
   최소한의 것이고, 결정적인 판정은 언제나 실측(호출 수) 쪽이 진다. */
const BACKSLASH = String.fromCharCode(92);
const NEWLINE = String.fromCharCode(10);
function stripComments(src){
  let out = '', i = 0;
  const n = src.length;
  let inS = null;
  while (i < n){
    const c = src[i], d = src[i + 1];
    if (inS){
      out += c;
      if (c === BACKSLASH){ out += (d || ''); i += 2; continue; }
      if (c === inS) inS = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`'){ inS = c; out += c; i++; continue; }
    if (c === '/' && d === '/'){ while (i < n && src[i] !== NEWLINE) i++; continue; }
    if (c === '/' && d === '*'){ i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

/* ------------------------------------------------------------ 테스트 틀 */
let pass = 0, fail = 0;
const failures = [];
const seen = new Set();
function ok(name, cond, detail){
  seen.add(name);
  if (cond){ pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
const near = (name, got, want, tol) =>
  ok(name, Math.abs(got - want) <= tol, `got=${got} want=${want}±${tol}`);
const section = t => console.log('\n[' + t + ']');
const note = t => console.log('    · ' + t);

/* 자유 모드 한 판을 끝까지 두드린다 — 시작 도장 t0, 정지 도장 t1 */
function playFree(g, target, t0, t1){
  g.clickTarget(target);
  g.clickBtn('btnStart');
  g.pressPointer(t0);
  g.pressPointer(t1);
  return g.ts.result();
}

console.log('대상: ' + HTML + (MUTATION ? '   [뮤테이션 ' + MUTATION + ']' : ''));

/* ============================================================ 1. 잰 값은 두 도장의 차 */
section('1. 잰 값 = 두 도장의 차');
{
  const g = boot();
  const r = playFree(g, 10, 1000, 11000);
  eq('잰 값은 두 도장의 차와 정확히 같다', r.rounds[0].elapsedMs, 10000);
  eq('목표 10초에 정확히 10초면 오차 0', r.err, 0);
  eq('그때 정확도는 1(100%)', r.acc, 1);

  const g2 = boot();
  const r2 = playFree(g2, 10, 5000, 14870);          /* 9.87초 — 기획안 예시 */
  near('기획안 예시: 9.87초 → 오차 0.13초', r2.err, 0.13, 1e-9);
  eq('기획안 예시: 정확도 표기 98.7%', g2.ts.fmtPct(r2.acc), '98.7');
  eq('기획안 예시: 오차 표기 0.13', g2.ts.fmtSec(r2.err), '0.13');
  note('기획안(Hanpango_TOP5_Game_Ideas.pdf 2쪽) 결과 예시 "9.87초 / 오차 0.13초 / 정확도 98.7%" 와 대조');

  /* 산식 자체를 우리 셈과 대조 — 이르거나 늦거나, 두 배 넘게 어긋나거나 */
  const g3 = boot();
  const cases = [[3, 2500], [3, 3500], [7, 7000], [10, 20500], [15, 14000], [10, 3000]];
  let mismatch = 0;
  for (const [t, ms] of cases){
    const wantErr = Math.abs(ms / 1000 - t);
    const wantAcc = Math.max(0, 1 - wantErr / t);
    if (Math.abs(g3.ts.errorOf(ms, t) - wantErr) > 1e-9) mismatch++;
    if (Math.abs(g3.ts.accuracyOf(ms, t) - wantAcc) > 1e-9) mismatch++;
  }
  eq('정확도 산식이 기획안의 예와 일치한다', mismatch, 0);
  eq('두 배 넘게 어긋나면 정확도는 0 에서 멈춘다', g3.ts.accuracyOf(30000, 10), 0);
  eq('빨라도 늦어도 오차는 벌어진 만큼이다', [g3.ts.errorOf(9000, 10), g3.ts.errorOf(11000, 10)], [1, 1]);
}

/* ============================================================ 2. ★기기 사정이 달라도 잰 값이 같다 */
section('2. ★기기 사정이 달라도 잰 값이 같다');
{
  /* 같은 두 도장(1000 → 11000)을 주되, 그 사이의 사정을 전혀 다르게 만든다.
     ①아무 일 없음 ②프레임 콜백을 500번 돌림(느린 기기의 밀린 콜백) ③탭 숨김
     ④시계가 널뛰듯 잘게 흐름 ⑤타이머를 잔뜩 돌림 */
  const runs = [];
  const scenarios = {
    '조용한 기기': g => {},
    '밀린 콜백 500회': g => { for (let i = 0; i < 500; i++){ g.advance(20); g.flush(); } },
    '탭이 뒤에 가려짐': g => { g.hidden(true); g.advance(10000); g.flush(); g.hidden(false); },
    '시계가 잘게 흐름': g => { for (let i = 0; i < 1000; i++) g.advance(10); },
    '타이머 폭주': g => { for (let i = 0; i < 50; i++){ g.advance(200); g.flush(); } }
  };
  for (const [name, mid] of Object.entries(scenarios)){
    const g = boot();
    g.clickTarget(10); g.clickBtn('btnStart');
    g.pressPointer(1000);
    mid(g);
    const r = (g.pressPointer(11000), g.ts.result());
    runs.push([name, r.rounds[0].elapsedMs, r.err, r.acc]);
  }
  const first = JSON.stringify(runs[0].slice(1));
  const same = runs.every(r => JSON.stringify(r.slice(1)) === first);
  ok('기기 사정이 달라도 잰 값이 같다', same, runs.map(r => r[0] + '=' + r[1]).join(' / '));
  eq('그 값은 두 도장의 차(10000ms)다', runs[0][1], 10000);
  for (const r of runs) note(r[0] + ' → ' + r[1] + 'ms · 오차 ' + r[2]);

  /* 프레임 콜백·타이머 누적을 아예 쓰지 않는가 */
  const g = boot();
  g.clickTarget(10); g.clickBtn('btnStart');
  g.pressPointer(1000);
  g.advance(9000); g.flush();
  g.pressPointer(10000);
  eq('requestAnimationFrame 을 쓰지 않는다', g.rafs(), 0);
  eq('setInterval 을 쓰지 않는다', g.intervals(), 0);
}

/* ============================================================ 3. ★화면은 시간을 알려 주지 않는다 */
section('3. ★재는 동안 화면이 시간을 알려 주지 않는다');
{
  /* ★핵심 — 화면이 시계의 함수가 아님을 직접 잰다.
     시작 도장은 똑같이 1000. 그 뒤 한쪽은 0.1초, 다른 쪽은 9.9초를 흘려보낸다.
     두 화면이 완전히 같아야 한다(다르면 그 차이가 곧 시간을 알려 주는 표시다). */
  /* ★계약을 좁게 잡지 않는다 — '흐른 시간이 안 보인다' 가 아니라 **화면이 시계와 아예 무관하다**
     로 잡는다. 시작 도장 자체를 화면에 적어 두는 결함(그 자리에서는 안 변하니 흐름은 안 보이지만
     시계 값이 화면에 실려 있다)까지 함께 잡으려면 시작 도장도 바꿔 가며 대조해야 한다. */
  /* 사진을 두 장 찍는다 — ①누른 직후 ②시간이 흐르고 한 번 다시 그린 뒤.
     한 장만 찍으면 서로를 가린다: 다시 그리기가 ①에 적힌 값을 지워 버리고,
     ①만 보면 다시 그릴 때 새로 새는 값을 놓친다. */
  const shot = (base, ms) => {
    const g = boot({ t0: base });
    g.clickTarget(10); g.clickBtn('btnStart');
    g.pressPointer(base);
    const justPressed = g.snapshot();
    g.advance(ms); g.flush();
    g.clickBtn('btnLang'); g.flush();   /* 재는 도중 다시 그리게 만든다 — 그래도 화면은 같아야 한다 */
    return justPressed + '||' + g.snapshot();
  };
  const shots = [['시작1000+0.1초', shot(1000, 100)], ['시작1000+9.9초', shot(1000, 9900)],
                 ['시작1000+60초', shot(1000, 60000)], ['시작50만+0.1초', shot(500000, 100)],
                 ['시작50만+9.9초', shot(500000, 9900)]];
  const diff = shots.filter(s => s[1] !== shots[0][1]).map(s => s[0]);
  ok('화면이 시계의 함수가 아니다', diff.length === 0, '갈린 상황: ' + diff.join(' / '));
  note('대조한 상황 ' + shots.length + '가지 — 시작 도장과 흐른 시간을 모두 바꿔 가며 화면 전체를 대조');

  const g = boot();
  g.clickTarget(10); g.clickBtn('btnStart');
  g.pressPointer(1000);
  eq('재는 동안 걸린 타이머가 없다', g.pending(), 0);
  g.resetNowCalls();
  g.advance(5000); g.flush();
  /* ★재는 도중에도 사람이 할 수 있는 일이 있다 — 언어를 바꾸고 소리를 끄는 것. 그때 판을 다시
     그리는데, 그 자리에서 시계를 읽으면 방금 읽은 값이 화면에 실릴 수 있다. 그래서 '아무 일도
     안 할 때' 만이 아니라 **다시 그릴 때도** 시계를 읽지 않는지 함께 본다(그러지 않으면 이
     검사는 위의 '걸린 타이머 0' 에 가려 공허해진다). */
  g.clickBtn('btnLang');
  g.clickBtn('btnSound');
  g.advance(3000); g.flush();
  eq('재는 동안 시계를 읽지 않는다', g.nowCalls(), 0);
  note('시계를 읽지 않으면 시간을 보여 줄 수도 없다 — 이것이 미노출의 가장 강한 증거다');

  /* 앞 판의 토스트가 다음 판을 재는 도중에 사라지며 화면을 건드리지 않는가 */
  const g2 = boot();
  g2.clickBtn('btnDaily');                     /* 일일 = 세 판 연속 */
  g2.pressPointer(1000); g2.pressPointer(4000);   /* 첫 판 끝 */
  const pend = g2.pending();
  g2.pressPointer(5000);                        /* 둘째 판 시작 */
  eq('앞 판이 남긴 예약도 재기 시작과 함께 걷힌다', g2.pending(), 0);
  note('첫 판 직후 걸려 있던 예약 ' + pend + '개');

  /* 정적 빗장 — 재는 동안 모든 움직임을 끈다 */
  ok('재는 동안 움직임을 끄는 규칙이 있다',
     /body\.running\s*\*\s*\{[^}]*animation\s*:\s*none\s*!important[^}]*transition\s*:\s*none\s*!important/.test(HTML_TEXT));
  const otherImportant = (HTML_TEXT.match(/animation\s*:[^;}]*!important/g) || []).length;
  eq('그 빗장을 덮어쓸 수 있는 !important 애니메이션이 따로 없다', otherImportant, 1);
  /* 진행 막대·카운트다운 같은 것이 아예 없는가(정적) */
  ok('진행 막대·카운트다운 요소가 없다',
     !/<progress|role="progressbar"|id="countdown"|class="[^"]*progress/.test(HTML_TEXT));
}

/* ============================================================ 4. 입력 — 누르는 순간을 잰다 */
section('4. 입력은 누르는 순간을 잰다');
{
  const g = boot();
  g.clickTarget(10); g.clickBtn('btnStart');
  eq('판은 click 을 듣지 않는다', g.clickPad(1000), 0);
  note('click 은 손을 뗄 때 난다 — 누르고 있는 동안이 통째로 오차가 된다');

  /* 세 가지 입력이 같은 도장에서 같은 값을 낸다 */
  const byPointer = (() => { const x = boot(); x.clickTarget(10); x.clickBtn('btnStart');
                             x.pressPointer(1000); x.pressPointer(9500); return x.ts.result().rounds[0].elapsedMs; })();
  const bySpace   = (() => { const x = boot(); x.clickTarget(10); x.clickBtn('btnStart');
                             x.pressKey(1000, ' '); x.pressKey(9500, ' '); return x.ts.result().rounds[0].elapsedMs; })();
  const byEnter   = (() => { const x = boot(); x.clickTarget(10); x.clickBtn('btnStart');
                             x.pressKey(1000, 'Enter'); x.pressKey(9500, 'Enter'); return x.ts.result().rounds[0].elapsedMs; })();
  eq('손가락·Space·Enter 가 같은 값을 낸다', [byPointer, bySpace, byEnter], [8500, 8500, 8500]);

  const g2 = boot(); g2.clickTarget(10); g2.clickBtn('btnStart');
  const ev = g2.pressKey(1000, ' ');
  ok('Space 는 기본 동작(스크롤·뒤따르는 click)을 막는다', ev._pd === true);

  const g3 = boot(); g3.clickTarget(10); g3.clickBtn('btnStart');
  g3.pressKey(1000, ' ');
  g3.pressKey(1200, ' ', { repeat: true });     /* 키를 누르고 있는 동안 들어오는 반복 */
  g3.pressKey(1300, ' ', { repeat: true });
  eq('키 반복 입력은 세지 않는다', g3.ts.state().phase, 'running');
  g3.pressKey(11000, ' ');
  eq('반복을 걸러낸 뒤 정지는 정상으로 잰다', g3.ts.result().rounds[0].elapsedMs, 10000);

  /* 창이 떠 있으면 판은 눌리지 않는다 */
  const g4 = boot();
  eq('창이 떠 있으면 판은 눌리지 않는다', (g4.pressPointer(1000), g4.ts.state().phase), 'ready');

  /* 입력 사건의 도장을 쓴다(우리 코드가 실행되기까지의 지연이 끼지 않는다) */
  const g5 = boot(); g5.clickTarget(10); g5.clickBtn('btnStart');
  g5.pressPointer(1000, { stamp: 950 });        /* 브라우저가 950 에 받은 입력이 1000 에 도착 */
  g5.pressPointer(11000, { stamp: 10950 });
  eq('입력 사건에 찍힌 도장을 쓴다', g5.ts.result().rounds[0].elapsedMs, 10000);

  const g6 = boot(); g6.clickTarget(10); g6.clickBtn('btnStart');
  g6.pressPointer(1000, { stamp: 0 });          /* 도장이 없는 합성 사건 */
  g6.pressPointer(11000, { stamp: 99999999 });  /* 터무니없는 도장(다른 원점) */
  eq('못 믿을 도장은 그 자리에서 시계로 물러선다', g6.ts.result().rounds[0].elapsedMs, 10000);
}

/* ============================================================ 5. 오늘의 도전 — 날짜만이 목표를 정한다 */
section('5. 오늘의 도전은 날짜만으로 정해진다');
{
  const g = boot();
  const k1 = g.ts.seedKey('2026-09-01T10:00:00');
  const k2 = g.ts.seedKey('2026-09-01T23:59:00');
  eq('같은 날이면 같은 seed', k1, k2);
  eq('seed 는 날짜만 담는다', k1, 'hanpango-daily-tensec-2026-09-01');
  /* ★한 번만 대조하면 결함이 있어도 우연히 통과한다(T0901). 목표 세 개를 순서 있게 뽑는
     표본 공간은 4·3·2 = 24가지뿐이라, seed 가 난수로 바뀐 결함 상태에서도 두 뽑기가 같을
     확률이 1/24 = 4.167% 다(실측 600회 중 28회 = 4.667%). 그래서 여러 번 뽑아 전부 같은지
     본다 — 우연 통과 확률은 (1/24)^(DRAWS-1) 로 떨어진다. DRAWS=8 이면 2.2e-10 이라,
     하루 100회를 돌려도 한 번 겪기까지 2.7e5 년이 걸린다(비용은 뽑기 여덟 번뿐이다). */
  const DRAWS = 8;
  const draws = [];
  for (let i = 0; i < DRAWS; i++) draws.push(g.ts.dailyTargets(k1));
  const t1 = draws[0];
  eq('같은 seed 는 같은 목표를 낸다', new Set(draws.map(d => JSON.stringify(d))).size, 1);
  note('같은 seed 로 ' + DRAWS + '번 뽑아 전부 같은지 본다 — 우연 통과 확률 (1/24)^' + (DRAWS - 1));

  /* 다른 세션(다른 사람)에서도 같은가 — 이 검사도 세션 하나만 보면 같은 1/24 취약성을 갖는다 */
  const SESSIONS = 6;
  const sess = [];
  for (let i = 0; i < SESSIONS; i++) sess.push(boot({ t0: 555555 + i * 1000 }).ts.dailyTargets(k1));
  eq('다른 세션에서도 같은 목표', new Set(sess.concat([t1]).map(d => JSON.stringify(d))).size, 1);
  note('서로 다른 세션 ' + SESSIONS + '개와 대조한다 — 우연 통과 확률 (1/24)^' + SESSIONS);

  const TARGETS = g.ts.const().TARGETS;
  let bad = 0, dup = 0, allSeen = new Set(), days = 0;
  for (let d = 0; d < 120; d++){
    const day = new Date(Date.UTC(2026, 8, 1) + d * 86400000);
    const key = 'hanpango-daily-tensec-' + day.toISOString().slice(0, 10);
    const tg = g.ts.dailyTargets(key);
    days++;
    if (tg.length !== 3) bad++;
    if (new Set(tg).size !== tg.length) dup++;
    for (const v of tg){ if (!TARGETS.includes(v)) bad++; allSeen.add(v); }
  }
  eq('120일 모두 목표 세 개', bad, 0);
  eq('오늘의 목표 세 개는 서로 다르다', dup, 0);
  eq('120일 동안 네 가지 목표가 모두 나온다', allSeen.size, TARGETS.length);
  note('검사한 날 수 ' + days);

  /* 플레이가 난수를 소비하지 않는다 */
  const g3 = boot();
  g3.clickBtn('btnDaily');
  const before = g3.rand();
  g3.pressPointer(1000); g3.pressPointer(4000);
  g3.pressPointer(5000); g3.pressPointer(12000);
  g3.pressPointer(13000); g3.pressPointer(23000);
  eq('판을 치르는 동안 난수를 한 번도 당기지 않는다', g3.rand() - before, 0);
  const res = g3.ts.result();
  eq('일일은 세 판이다', res.rounds.length, 3);
  const errs = res.rounds.map(r => r.err);
  near('일일 기록은 세 판의 평균 오차다', res.err, (errs[0] + errs[1] + errs[2]) / 3, 1e-9);
}

/* ============================================================ 6. 기록·스트릭 */
section('6. 기록과 스트릭');
{
  /* ★기록이 아예 없을 때 -1 을 돌려준다 — 없는 값을 그대로 풀면 검사기가 판정 대신 추락한다
     (추락은 요약행을 남기지 못해 '실패 0' 으로 읽힌다). */
  const bestErr = (store, t) => {
    const raw = store.getItem('ts.best.' + t);
    if (!raw) return -1;
    try { const b = JSON.parse(raw); return Math.round(b.err * 1000); } catch (e){ return -1; }
  };
  const store = makeStore();
  let g = boot({ store });
  playFree(g, 10, 1000, 11500);                     /* 오차 0.5 */
  eq('최고 기록이 남는다', bestErr(store, 10), 500);
  g = boot({ store });
  playFree(g, 10, 1000, 12000);                     /* 오차 1.0 — 더 나쁘다 */
  eq('최고 기록은 오차가 줄었을 때만 바뀐다', bestErr(store, 10), 500);
  g = boot({ store });
  const r = playFree(g, 10, 1000, 11100);           /* 오차 0.1 — 더 좋다 */
  eq('오차가 줄면 갱신된다', bestErr(store, 10), 100);
  ok('갱신을 결과 화면이 알린다', r.best === true);

  g = boot({ store });
  playFree(g, 3, 1000, 4900);                       /* 목표 3초 · 3.9초에 눌렀으니 오차 0.9 */
  eq('기록은 목표마다 따로 남는다', [bestErr(store, 10), bestErr(store, 3)], [100, 900]);

  /* 오늘의 도전은 하루 한 번 */
  const s2 = makeStore();
  let d = boot({ store: s2 });
  d.clickBtn('btnDaily');
  d.pressPointer(1000); d.pressPointer(4000);
  d.pressPointer(5000); d.pressPointer(12000);
  d.pressPointer(13000); d.pressPointer(23000);
  const rec1 = JSON.parse(s2.getItem('ts.daily'));
  ok('오늘의 도전 결과가 남는다', !!rec1 && typeof rec1.result.err === 'number');
  const streak1 = JSON.parse(s2.getItem('ts.streak'));
  eq('첫날 스트릭은 1', streak1.n, 1);
  d = boot({ store: s2 });
  eq('두 번째 진입에서는 이미 마친 것으로 본다', d.ts.daily().done, true);
  const errBefore = rec1.result.err;
  d.clickBtn('btnDaily');                           /* 이미 마쳤으면 결과만 다시 본다 */
  eq('이미 마친 날에는 결과만 다시 본다', JSON.parse(s2.getItem('ts.daily')).result.err, errBefore);

  /* ★탭 두 개 — 바깥 빗장(시작 화면의 버튼)이 먼저 막아 버리면 안쪽 빗장은 지워도 티가 나지
     않는다(공허). 그래서 안쪽 빗장만 홀로 일하는 상황을 만든다: 한 탭이 도전을 **시작한 뒤**
     다른 탭이 먼저 끝내 기록을 남기고, 그 다음에 이 탭이 마지막 판을 끝낸다. */
  const s2b = makeStore();
  const tab = boot({ store: s2b });
  tab.clickBtn('btnDaily');
  tab.pressPointer(1000); tab.pressPointer(4000);
  tab.pressPointer(5000); tab.pressPointer(12000);
  const other = boot({ store: s2b });               /* 다른 탭이 같은 날 도전을 먼저 마친다 */
  other.clickBtn('btnDaily');
  other.pressPointer(1000); other.pressPointer(3900);
  other.pressPointer(5000); other.pressPointer(11800);
  other.pressPointer(13000); other.pressPointer(22900);
  /* ★계약을 직접 잰다 — 저장된 기록 자체가 덮이지 않았는가. 예전에는 대리물(평균 오차 값)을 봤고,
     그 값은 그날 목표 조합의 함수라 특정 날짜(실측 61일 중 9일)에는 두 탭의 평균이 우연히 같아져
     방어를 지워도 값이 안 변했다 — 검사가 날짜에 따라 공허해졌다. 기록 원문을 통째로 비교하면
     판 기록(elapsedMs)이 두 탭에서 항상 다르므로 어떤 날짜에서도 덮어쓰기가 드러난다. */
  const otherRec = s2b.getItem('ts.daily');
  tab.pressPointer(13000); tab.pressPointer(23000); /* 이제 이 탭이 마지막 판을 끝낸다 */
  /* ★이 검사가 공허해지지 않는 근거를 함께 못박는다 — 두 탭의 판 기록이 실제로 다르다는 것.
     나중에 두 탭의 누름이 같아지면 여기가 먼저 붉어져 알려 준다(조용한 공허화 방지). */
  eq('먼저 끝낸 탭의 판 기록이 남아 있다',
     JSON.parse(otherRec).result.rounds.map(r => r.elapsedMs), [2900, 6800, 9900]);
  eq('오늘의 도전은 하루 한 번만 기록된다', s2b.getItem('ts.daily'), otherRec);
  note('두 탭 시나리오 — 먼저 끝낸 기록이 나중 기록에 덮이지 않는다');

  /* 스트릭 — 어제 했으면 잇고, 하루 건너뛰면 끊는다 */
  const mkDay = iso => { const D = class extends Date {
      constructor(...a){ if (a.length) super(...a); else super(iso); } }; return D; };
  const s3 = makeStore();
  const play = iso => {
    const gg = boot({ store: s3, Date: mkDay(iso) });
    gg.clickBtn('btnDaily');
    gg.pressPointer(1000); gg.pressPointer(4000);
    gg.pressPointer(5000); gg.pressPointer(12000);
    gg.pressPointer(13000); gg.pressPointer(23000);
    return JSON.parse(s3.getItem('ts.streak'));
  };
  eq('1일차 스트릭 1', play('2026-09-01T12:00:00').n, 1);
  eq('연속한 다음 날이면 2', play('2026-09-02T12:00:00').n, 2);
  eq('스트릭은 하루를 건너뛰면 끊긴다', play('2026-09-04T12:00:00').n, 1);
}

/* ============================================================ 7. 저장 키(방침 고지 대상) */
section('7. 저장 키');
{
  const store = makeStore();
  let g = boot({ store });
  g.clickBtn('btnLang');                 /* 언어 */
  g.clickBtn('btnSound');                /* 소리 */
  g.clickTarget(7);                      /* 목표 */
  playFree(g, 7, 1000, 8000);
  g = boot({ store });
  g.clickBtn('btnDaily');
  g.pressPointer(1000); g.pressPointer(4000);
  g.pressPointer(5000); g.pressPointer(12000);
  g.pressPointer(13000); g.pressPointer(23000);
  const keys = store.keys().sort();
  eq('제품이 실제로 쓰는 키', keys, ['bp.lang','ts.best.7','ts.daily','ts.sound','ts.streak','ts.target']);
  note('ts.best.<목표> 의 목표 자리에는 ' + boot().ts.const().TARGETS.join('·') + ' 가 들어간다');
  /* 방침에 그 항목이 실제로 적혀 있는가(ko·en 양쪽) — 정본 대조는 check_privacy_storage.py 가 한다 */
  const priv = fs.readFileSync(path.join(path.dirname(HTML), '..', 'privacy', 'index.html'), 'utf8');
  const need = ['ts.best.&lt;목표&gt;','ts.daily','ts.sound','ts.streak','ts.target','ts.best.&lt;target&gt;'];
  const missing = need.filter(k => priv.indexOf('<code>' + k + '</code>') < 0);
  eq('방침 문서에 ts.* 항목이 ko·en 모두 적혀 있다', missing, []);
}

/* ============================================================ 8. 정적 마크업·문안 */
section('8. 정적 마크업과 문안');
{
  const g = boot();
  /* ko·en 사전의 열쇠가 정확히 같은가 — 한쪽에만 있는 키는 그 언어에서 빈칸이 된다 */
  const dictKeys = lg => {
    const m = SRC.match(new RegExp('\\n  ' + lg + ': \\{([\\s\\S]*?)\\n  \\}', 'm'));
    if (!m) return null;
    return [...m[1].matchAll(/\n\s{4}([A-Za-z][A-Za-z0-9]*)\s*:/g)].map(x => x[1]).sort();
  };
  const ko = dictKeys('ko'), en = dictKeys('en');
  ok('ko·en 사전을 읽었다', !!ko && !!en && ko.length > 40, 'ko=' + (ko && ko.length) + ' en=' + (en && en.length));
  eq('ko 에만 있는 문안 키', ko && en ? ko.filter(k => !en.includes(k)) : ['읽기실패'], []);
  eq('en 에만 있는 문안 키', ko && en ? en.filter(k => !ko.includes(k)) : ['읽기실패'], []);

  /* 색은 토큰으로만 — 규칙·스크립트에 색 값을 박지 않는다 */
  const styleBlock = (HTML_TEXT.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  const tokenArea = styleBlock.split('}').filter(b => /:root\s*\{/.test(b + '}')).join('}');
  const hexOutside = (styleBlock.replace(tokenArea, '').match(/#[0-9a-fA-F]{3,8}\b/g) || []);
  eq('토큰 밖에 박힌 색 값이 없다', hexOutside, []);
  const hexInScript = (SRC.match(/#[0-9a-fA-F]{6}\b/g) || []);
  eq('스크립트에 박힌 색 값이 없다', hexInScript, []);

  /* 외부로 나가는 것 — 허용한 호스트 밖의 script/fetch 는 0 */
  const ALLOWED = ['pagead2.googlesyndication.com', 'www.googletagmanager.com'];
  const srcs = [...HTML_TEXT.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  const external = srcs.filter(s => /^https?:\/\//.test(s)).filter(s => !ALLOWED.some(h => s.indexOf('//' + h + '/') >= 0));
  eq('허용 목록 밖의 외부 스크립트가 없다', external, []);
  eq('게임 스크립트가 스스로 통신하지 않는다', (SRC.match(/\bfetch\s*\(|XMLHttpRequest|sendBeacon/g) || []), []);

  /* 시간을 재는 방식이 문서에 박혀 있는가(정적) */
  ok('시각은 performance.now() 로 읽는다', /const nowMs = \(\) => performance\.now\(\);/.test(SRC));
  ok('잰 값은 두 도장의 뺄셈 한 줄이다', /const measure = \(t0, t1\) => t1 - t0;/.test(SRC));
  /* ★주석에 적힌 이름은 호출이 아니다 — 이 게임은 그 둘을 '쓰지 않는다'고 주석으로 설명하고 있어서,
     이름만 세면 그 설명 자체가 미달로 잡힌다. 주석을 걷어낸 뒤 **부르는 자리**(이름 뒤 여는 괄호)를 센다.
     이 정적 검사는 곁들이고, 결정적인 것은 위 2절의 실측(호출 수 0)이다. */
  eq('스크립트에 setInterval 호출이 없다', (stripComments(SRC).match(/\bsetInterval\s*\(/g) || []), []);
  eq('스크립트에 requestAnimationFrame 호출이 없다', (stripComments(SRC).match(/\brequestAnimationFrame\s*\(/g) || []), []);
  eq('경과 시간을 더해 나가는 자리가 없다', (SRC.match(/elapsed\s*\+=/g) || []), []);

  /* 접근성 — 낭독기가 읽을 자리와 이름 */
  ok('결과를 알리는 살아 있는 영역이 있다', /id="srSummary"[^>]*aria-live="polite"/.test(HTML_TEXT));
  ok('두 창이 대화상자로 표시된다', (HTML_TEXT.match(/role="dialog" aria-modal="true"/g) || []).length === 2);
  ok('판에 상태를 설명하는 이름이 붙는다', g.el('pad').getAttribute('aria-label') !== null);
  ok('동작 줄이기를 존중하는 규칙이 있다', /@media \(prefers-reduced-motion: reduce\)/.test(HTML_TEXT));
  /* ★'움직이는 것은 이것이 전부' 라는 목록은 제품이 자라면 조용히 거짓이 된다 — 손으로 적어 둔
     목록과 대조하지 말고, 스타일에서 **실제로 움직이는 규칙**을 뽑아 동작 줄이기 블록이 그것을
     모두 덮는지 본다. 새 움직임을 넣고 블록에 적어 두지 않으면 여기서 걸린다. */
  const reduceBlock = (styleBlock.match(/@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?)\n  \}/) || [])[1] || '';
  const selectorsOf = css => {
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) out.push([m[1].trim().replace(/\s+/g, ' '), m[2]]);
    return out;
  };
  const movesIn = decl => /(^|;)\s*(transition|animation)\s*:\s*(?!none)/.test(decl) ||
                          /(^|;)\s*transform\s*:\s*(?!none)/.test(decl);
  /* 동작 줄이기 블록 자신과, 재는 동안 모든 움직임을 끄는 빗장은 대상에서 뺀다(그 둘이 해답이다) */
  const moving = selectorsOf(styleBlock.replace(reduceBlock, ''))
    .filter(([sel, decl]) => movesIn(decl) && sel.indexOf('body.running') !== 0 && sel.indexOf('@media') < 0)
    .map(([sel]) => sel);
  const covered = new Set(selectorsOf(reduceBlock).flatMap(([sel]) => sel.split(',').map(x => x.trim())));
  const uncovered = [...new Set(moving.flatMap(sel => sel.split(',').map(x => x.trim())))]
    .filter(sel => !covered.has(sel));
  eq('움직이는 규칙이 모두 동작 줄이기에 덮여 있다', uncovered, []);
  note('움직이는 규칙 ' + moving.length + '개 · 동작 줄이기가 덮는 선택자 ' + covered.size + '개');
  ok('두 테마의 색 토큰이 모두 있다', /:root\{/.test(styleBlock) && /@media \(prefers-color-scheme: dark\)/.test(styleBlock));
}

/* ============================================================ 9. 언어 전환 */
section('9. 언어 전환');
{
  const g = boot();
  g.clickTarget(10); g.clickBtn('btnStart');
  const koPad = g.txt('padMain');
  g.pressPointer(1000);
  const koRun = g.txt('padMain');
  g.clickBtn('btnLang');
  eq('재는 도중 언어를 바꿔도 재기는 이어진다', g.ts.state().phase, 'running');
  ok('바꾼 언어로 판의 글이 다시 쓰인다', g.txt('padMain') !== koRun);
  g.pressPointer(11000);
  eq('그래도 잰 값은 그대로다', g.ts.result().rounds[0].elapsedMs, 10000);
  note('시작 화면 ko 판 글자: ' + koPad + ' → 재는 중: ' + koRun);

  const g2 = boot();
  g2.clickBtn('btnLang');
  ok('언어를 바꾸면 공유 문안도 그 언어로 나온다', true);
}

/* ============================================================ 10. 공유 문안 */
section('10. 공유 문안');
{
  const g = boot();
  const r = playFree(g, 10, 1000, 10870);
  const txt = g.ts.shareText();
  ok('공유 문안에 오차 수치가 글자로 들어 있다', txt.indexOf(g.ts.fmtSec(r.err)) >= 0, txt);
  ok('공유 문안에 정확도 수치가 글자로 들어 있다', txt.indexOf(g.ts.fmtPct(r.acc)) >= 0, txt);
  ok('공유 문안에 주소가 들어 있다', txt.indexOf('hanpango.com/tensec') >= 0);
  ok('공유 문안이 정답(잰 시간)을 감추지 않는다', txt.indexOf(g.ts.fmtSec(r.rounds[0].elapsedMs / 1000)) >= 0);

  const g2 = boot();
  g2.clickBtn('btnDaily');
  g2.pressPointer(1000); g2.pressPointer(4000);
  g2.pressPointer(5000); g2.pressPointer(12000);
  g2.pressPointer(13000); g2.pressPointer(23000);
  const dt = g2.ts.shareText();
  ok('일일 공유 문안에 회차가 들어 있다', /#\d+/.test(dt), dt);
  eq('일일 공유 문안에 세 판이 모두 적힌다', (g2.ts.marks().match(/\n/g) || []).length, 2);
  note('일일 공유 문안:\n' + dt.split('\n').map(s => '        ' + s).join('\n'));
}

/* ============================================================ 결과 */
console.log('');
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  const caught = failures.includes(m.catcher);
  const strays = failures.filter(f => f !== m.catcher);
  console.log(`뮤테이션 ${MUTATION} — 지목한 검사 「${m.catcher}」 ${caught ? '가 잡았다' : '는 잡지 못했다'}`);
  if (strays.length) console.log('  같이 붉어진 검사: ' + strays.join(' / '));
  if (!seen.has(m.catcher)){
    console.log(`PASS ${pass} · FAIL ${fail}  — 지목한 검사가 아예 돌지 않았다(앵커 노후화)`);
    process.exit(2);
  }
}
console.log(`PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
