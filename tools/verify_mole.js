/* 두더지잡기(/mole/) 검증기 — worker(274) · 2026-09-12 · 티켓 29-mole
 *
 * ★이 검사는 제품보다 ★먼저 쓰였다(브리프 3절 · master 지시 2). 제품이 없는 동안에는
 *   제품 팔이 ★rc=2(판정 불가)다 — 통과로 세지 않는다. 탐지력은 `--selftest` 로 따로 증명한다.
 *
 * 방식은 형제 검증기(verify_numberbaseball.js)를 ★그대로 물려받았다:
 *   · 인라인 스크립트를 DOM 스텁 위에서 실제로 구동한다(vm)
 *   · 상태를 바꾸는 명령은 ★제품 파일에 두지 않고 이 하네스가 메모리에서만 만든다
 *   · 판정은 배포되는 관측 창구(window.__mole)와 ★이 파일이 따로 셈한 값의 대조로 한다
 *   · 누르는 것은 다리가 아니라 ★진짜 입력 사건(click)으로 두드린다
 *
 * 중점 검사(브리프가 못박은 것)
 *   ★① 한 판 60초 · 구멍 3×3
 *   ★② 같은 날 같은 씨앗 = 같은 등장 순서. 같은 KST 날 안에서 ★벽시계를 23시간 움직여도 같다
 *       (같은 순간 두 번 물어 같은 것은 씨앗에 시각이 섞여 있어도 성립한다 — 그 그물로는 못 잡는다)
 *   ★③ ★플레이가 난수를 소비하지 않는다 — Math.random 호출수를 세어 판 짜기 뒤 0 증가
 *   ★④ 시간 기반 분기 없음 — 판을 뽑는 함수 소스에 시각 읽기가 없다(정적)
 *   ★⑤ 점수식이 ★규칙 문면과 같다(폭탄 감점 · 최저 0) — 참조값은 하네스가 따로 셈한다
 *   ★⑥ ★색으로만 구별되지 않는다 — 두더지와 폭탄이 서로 다른 글자를 쓴다
 *   ★⑦ 같은 등장을 두 번 눌러도 한 번만 센다
 *
 * ★이 하네스가 못 보는 것(정직 고지)
 *   · 레이아웃을 계산하지 않는다 — 0×0 접힘·360px 넘침은 실브라우저에서만 보인다.
 *   · CSS 를 파싱하지 않는다 — 색·대비는 check_theme_contrast.mjs·check_palette.py 의 몫이다.
 *   · 애니메이션의 부드러움·소리는 재지 못한다.
 *
 * 사용법: node tools/verify_mole.js [--html <경로>] [--selftest] [--list-mutations]
 *         node tools/verify_mole.js --mutate <이름>
 * 종료코드: 0 = 전부 PASS · 1 = 하나라도 FAIL · 2 = 판정 불가(대상을 못 읽음·주입 실패 — 탐지 아님)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ARGV = process.argv.slice(2);
const has = f => ARGV.includes(f);
const valOf = (f, d) => { const i = ARGV.indexOf(f); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const ROOT = path.resolve(__dirname, '..');
const HTML = path.resolve(valOf('--html', path.join(ROOT, 'mole', 'index.html')));

let pass = 0, fail = 0, indetMsg = null;
const lines = [];
function ok(name, cond, extra){
  if (cond) { pass++; lines.push('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; lines.push('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
  return !!cond;
}
function indet(msg){ indetMsg = msg; }

/* ───────────────────────── DOM 스텁 ─────────────────────────
   ★충실도 규칙: textContent·innerHTML 을 쓰면 자식이 사라진다(실제 DOM 계약).
   흉내내지 않으면 '지우고 다시 채운다' 는 코드가 스텁에서만 무한히 쌓인다. */
function makeEl(id, doc, tag){
  const el = {
    id: id || '', tagName: String(tag || 'div').toUpperCase(), children: [], parent: null,
    dataset: {}, style: {}, _classes: new Set(), _attrs: {}, _on: {}, _text: '', _html: '',
    hidden: false, disabled: false, value: '', scrollIntoView(){},
  };
  el.classList = {
    add: c => el._classes.add(c), remove: c => el._classes.delete(c),
    contains: c => el._classes.has(c),
    toggle: (c, on) => { if (on === undefined) el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c);
                         else if (on) el._classes.add(c); else el._classes.delete(c); }
  };
  el.setAttribute = (k, v) => { el._attrs[k] = String(v); };
  el.getAttribute = k => (k in el._attrs ? el._attrs[k] : null);
  el.removeAttribute = k => { delete el._attrs[k]; };
  el.hasAttribute = k => k in el._attrs;
  el.addEventListener = (t, fn) => { (el._on[t] = el._on[t] || []).push(fn); };
  el.removeEventListener = t => { delete el._on[t]; };
  el.appendChild = c => { el.children.push(c); c.parent = el; return c; };
  el.append = (...cs) => { for (const c of cs) el.appendChild(c); };
  el.remove = () => { if (el.parent) el.parent.children = el.parent.children.filter(x => x !== el); };
  el._descend = () => { const out = []; (function walk(n){ for (const c of n.children){ out.push(c); walk(c); } })(el); return out; };
  el.querySelectorAll = sel => el._descend().filter(c => matchesSel(c, sel));
  el.querySelector = sel => el.querySelectorAll(sel)[0] || null;
  el.closest = sel => { let n = el; while (n){ if (matchesSel(n, sel)) return n; n = n.parent; } return null; };
  el.matches = sel => matchesSel(el, sel);
  el.focus = () => { doc.activeElement = el; };
  el.blur = () => {};
  el.getBoundingClientRect = () => ({ width: 40, height: 40, top: 0, left: 0, right: 40, bottom: 40 });
  el.dispatch = (type, ev) => {
    /* ★실제 DOM 은 addEventListener 와 on<type> 둘 다 부른다. 하나만 흉내내면
       제품이 집 스타일대로 onclick 을 쓸 때 ★클릭이 닿지 않아 시험이 공허해진다. */
    const fns = (el._on[type] || []).slice();
    const on = el['on' + type];
    if (typeof on === 'function') fns.push(on);
    const e = Object.assign({ type, target: el, currentTarget: el, timeStamp: 1000,
                              preventDefault(){}, stopPropagation(){} }, ev || {});
    for (const fn of fns) fn(e);
    return fns.length;
  };
  Object.defineProperty(el, 'textContent', {
    get(){ return el._text; }, set(v){ el._text = String(v); el.children.length = 0; }
  });
  Object.defineProperty(el, 'innerHTML', {
    get(){ return el._html; }, set(v){ el._html = String(v); if (v === '') el.children.length = 0; }
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
    if (!s) continue;
    if (s === el.tagName.toLowerCase()) return true;
    if (s === '[data-i18n]' && el.dataset.i18n !== undefined) return true;
    if (s === '[data-digit]' && el.dataset.digit !== undefined) return true;
    if (s.startsWith('.') && el._classes.has(s.slice(1))) return true;
    if (s.startsWith('#') && el.id === s.slice(1)) return true;
  }
  return false;
}
function makeStore(seed){
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
    _dump: () => Object.fromEntries(m)
  };
}

/* 제품 인라인 스크립트 떼어 오기 — 가장 긴 인라인 <script> 가 본체다 */
function inlineScript(raw){
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m, best = null;
  while ((m = re.exec(raw))){
    if (/\bsrc=/.test(m[1])) continue;
    if (!/window\.__mole/.test(m[2])) continue;
    if (!best || m[2].length > best.length) best = m[2];
  }
  return best;
}

/* ───────────────────────── 구동 ─────────────────────────
   wall(벽시계)·Math.random 호출수를 하네스가 쥔다. */
function boot(src, opts){
  opts = opts || {};
  const localStorage = opts.store || makeStore(opts.seedStore);
  const els = new Map();
  const doc = {
    documentElement: null, body: null, activeElement: null, hidden: false, title: '',
    getElementById: id => { if (!els.has(id)) els.set(id, makeEl(id, doc)); return els.get(id); },
    querySelectorAll: sel => [...els.values()].filter(e => matchesSel(e, sel))
      .concat([...els.values()].flatMap(e => e._descend().filter(c => matchesSel(c, sel)))),
    querySelector: sel => doc.querySelectorAll(sel)[0] || null,
    createElement: t => makeEl('new_' + t, doc, t),
    createDocumentFragment: () => makeEl('frag', doc, 'fragment'),
    addEventListener: (t, fn) => { (doc._on = doc._on || {})[t] = fn; },
    removeEventListener: () => {}
  };
  doc.documentElement = makeEl('html', doc);
  doc.body = makeEl('body', doc, 'body');

  let wall = opts.wall || Date.UTC(2026, 8, 11, 3, 0, 0);   /* 기본 = 2026-09-11 12:00 KST */
  const RealDate = Date;
  class DateStub extends RealDate {
    constructor(...a){ if (a.length === 0) super(wall); else super(...a); }
    static now(){ return wall; }
  }
  let rngCalls = 0;
  const baseRandom = () => { /* 하네스가 주는 고정 난수 — 제품이 이걸 쓰면 티가 난다 */
    rngCalls++; return 0.4242424242;
  };
  const timers = [];
  const sandbox = {
    document: doc, localStorage, Date: DateStub, Math: Object.create(Math),
    console: { log(){}, warn(){}, error(){} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: fn => { timers.push({ fn, ms: 16 }); return timers.length; },
    cancelAnimationFrame: () => {},
    navigator: { language: 'ko-KR', clipboard: { writeText: () => Promise.resolve() }, share: undefined },
    matchMedia: () => ({ matches: false, addEventListener(){}, removeEventListener(){} }),
    performance: { now: () => 1000 },
    location: { href: 'https://hanpango.com/mole/', pathname: '/mole/' },
    addEventListener(){}, removeEventListener(){},
    HTMLElement: function(){}, KeyboardEvent: function(){}, PointerEvent: function(){},
    fetch: () => Promise.reject(new Error('no network in harness'))
  };
  sandbox.Math.random = baseRandom;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  let err = null;
  try { vm.createContext(sandbox); new vm.Script(src, { filename: 'mole.js' }).runInContext(sandbox); }
  catch (e) { err = e; }
  return {
    sandbox, doc, localStorage, err, timers,
    mole: sandbox.__mole,
    rngCalls: () => rngCalls,
    setWall: ms => { wall = ms; },
    wallNow: () => wall,
    flush: () => { const t = timers.splice(0); for (const x of t) { try { x.fn(1000); } catch (_){} } return t.length; },
    el: id => doc.getElementById(id)
  };
}

/* ───────────────────────── 단언 묶음 ─────────────────────────
   ★제품과 모형에 ★같은 단언을 건다 — 그래서 제품이 없는 동안에도 탐지력을 증명할 수 있다. */
const KST = 9 * 3600000;
function kstDayStartUTC(y, m, d){ return Date.UTC(y, m, d) - KST; }   /* 그 KST 날의 00:00 = UTC-9h */

/* 하네스가 따로 셈하는 값 — 제품 코드를 부르지 않고 여기서 독립으로 계산한다.
   ★같은 함수를 빌려 쓰면 그 검사는 자기 자신을 대조하는 것이라 공허하다. */
function scoreRef(hits, bombs, penalty){ const s = hits - penalty * bombs; return s < 0 ? 0 : s; }

function runAssertions(src, label, opts){
  opts = opts || {};
  const A = boot(src, {});
  if (A.err || !A.mole){
    indet(label + ': 스크립트가 뜨지 않았거나 window.__mole 창구가 없다' + (A.err ? ' — ' + A.err.message : ''));
    return null;
  }
  const M = A.mole;
  const C = M.const();

  /* ① 계약 상수 — 브리프가 못박은 판 크기와 길이 */
  ok('[contract-consts] 한 판 60초', C.DURATION_MS === 60000, 'DURATION_MS=' + C.DURATION_MS);
  ok('[contract-consts] 구멍 3×3 = 9', C.HOLES === 9, 'HOLES=' + C.HOLES);

  /* ② 같은 키 = 같은 판 (같은 순간 두 번 물어 같은 것은 약한 증거다 — ③에서 시계를 크게 움직인다) */
  const k = '2026-09-12';
  const p1 = JSON.stringify(M.planFor(k));
  const p2 = JSON.stringify(M.planFor(k));
  ok('[plan-deterministic] 같은 키를 두 번 물으면 같은 판', p1 === p2, '길이 ' + M.planFor(k).length);

  /* ③ 다른 키 = 다른 판 (구별력이 없으면 ②는 상수를 돌려주는 함수에도 참이다) */
  const other = JSON.stringify(M.planFor('2026-09-13'));
  ok('[plan-key-sensitive] 다른 키는 다른 판', other !== p1);

  /* ④ ★시각 독립 — 같은 KST 날 안에서 벽시계를 크게 움직여도 그날의 판이 같다 */
  A.setWall(kstDayStartUTC(2026, 8, 12) + 1000);            /* 그날 00:00:01 KST */
  const early = JSON.stringify(M.planFor(M.dayKey()));
  const earlyKey = M.dayKey();
  A.setWall(kstDayStartUTC(2026, 8, 12) + 23 * 3600000);    /* 같은 날 23:00 KST */
  const lateKey = M.dayKey();
  const late = JSON.stringify(M.planFor(M.dayKey()));
  ok('[plan-no-clock] 같은 KST 날의 키가 같다', earlyKey === lateKey, earlyKey + ' / ' + lateKey);
  ok('[plan-no-clock] 23시간을 흘려도 그날의 판이 같다', early === late);

  /* ⑤ ★판을 뽑는 경로에 시계가 없다 — 정적으로 함수 소스를 읽는다
     ★창구가 감싼 함수(String(M.planFor))를 읽으면 껍데기만 보여 이 검사가 ★공허해진다
       — 자기시험에서 실제로 그렇게 새는 것을 보고 고쳤다. ★구현 소스를 내주는 창구를 요구하고,
       없으면 통과가 아니라 ★판정 불가다. */
  if (typeof M.planSrc !== 'function'){
    indet(label + ': 창구에 planSrc() 가 없다 — 구현 소스를 못 읽어 시계 정적 검사를 세울 수 없다');
    return null;
  }
  const planSrc = String(M.planSrc());
  ok('[plan-static-no-time] planFor 구현 소스에 시각 읽기가 없다',
     !/Date\s*\.\s*now|new\s+Date|performance\s*\.\s*now/.test(planSrc),
     planSrc.length + '자 검사');

  /* ⑥ 판의 모양 — 시각 오름차순 · 구멍 범위 · 머무는 시간 양수 · 판 길이 안 */
  const plan = M.planFor(k);
  let shapeBad = [];
  for (let i = 0; i < plan.length; i++){
    const e = plan[i];
    if (!(e.hole >= 0 && e.hole < C.HOLES)) shapeBad.push('hole ' + e.hole);
    if (!(e.up > 0)) shapeBad.push('up ' + e.up);
    if (!(e.t >= 0 && e.t + e.up <= C.DURATION_MS)) shapeBad.push('t ' + e.t);
    if (i > 0 && plan[i - 1].t > e.t) shapeBad.push('역순 ' + i);
    if (e.kind !== 'mole' && e.kind !== 'bomb') shapeBad.push('kind ' + e.kind);
  }
  ok('[plan-shape] 판의 모양이 계약대로다', shapeBad.length === 0,
     '이벤트 ' + plan.length + '개 · 어긋남 ' + shapeBad.length + (shapeBad.length ? ' (' + shapeBad.slice(0,3).join(', ') + ')' : ''));
  ok('[plan-shape] 함정이 실제로 섞여 있다', plan.some(e => e.kind === 'bomb'),
     '폭탄 ' + plan.filter(e => e.kind === 'bomb').length + '개');

  /* ⑦ 점수 규칙 — 화면 문면과 같은 식인가. ★참조값은 하네스가 따로 셈한다 */
  let scoreBad = 0, scoreN = 0;
  for (let h = 0; h <= 12; h++){
    for (let b = 0; b <= 6; b++){
      scoreN++;
      if (M.scoreOf(h, b) !== scoreRef(h, b, C.BOMB_PENALTY)) scoreBad++;
    }
  }
  ok('[score-rule] 점수식이 규칙 문면과 같다', scoreBad === 0,
     '대조 ' + scoreN + '쌍 · 어긋남 ' + scoreBad + ' (폭탄 감점 ' + C.BOMB_PENALTY + ' · 최저 0)');
  ok('[score-rule] 점수는 0 밑으로 내려가지 않는다', M.scoreOf(0, 5) === 0, 'scoreOf(0,5)=' + M.scoreOf(0, 5));

  /* ⑧ ★색으로만 구별되지 않는다 — 두더지와 폭탄이 서로 다른 글자를 쓴다 */
  const gm = M.glyphOf('mole'), gb = M.glyphOf('bomb');
  ok('[glyph-not-color-only] 두더지와 폭탄의 글자가 다르다', !!gm && !!gb && gm !== gb,
     'mole="' + gm + '" bomb="' + gb + '"');

  /* ⑨ ★플레이가 난수를 소비하지 않는다 — ★진짜 클릭으로 두드리고 호출수를 센다.
     ★시각을 움직이지 않으면 아무것도 올라와 있지 않아 이 검사가 공허해진다 —
     그래서 등장 시간창 안으로 벽시계를 옮긴 뒤에 누른다. */
  const before = A.rngCalls();
  const started = startRun(A);
  const afterStart = A.rngCalls();
  const st0 = A.mole.state();
  const planAtStart = JSON.stringify(st0.plan);
  const runPlan = st0.plan;
  /* ★표본은 ★모호하지 않은 등장으로 고른다 — 같은 구멍에서 창이 겹치는 등장이 있으면
     어느 것을 누른 것인지 판정할 수 없어, 겨냥하지 않은 검사가 붉어진다(자기시험에서 실제로 그랬다). */
  const clean = kind => runPlan.find(e => e.kind === kind &&
    !runPlan.some(o => o !== e && o.hole === e.hole && o.t < e.t + e.up && e.t < o.t + o.up));
  const firstMole = clean('mole');
  const firstBomb = clean('bomb');
  if (!started || !st0.running || !firstMole || !firstBomb){
    indet(label + ': 판이 시작되지 않았거나 두더지·폭탄 등장이 없어 플레이 팔을 세울 수 없다');
    return null;
  }
  const t0 = A.wallNow();
  A.setWall(t0 + firstMole.t + 50);                 /* 두더지가 올라와 있는 순간 */
  A.el('hole' + firstMole.hole).dispatch('click', {});
  const afterHit = A.mole.state();
  A.el('hole' + firstMole.hole).dispatch('click', {});   /* ★같은 등장을 한 번 더 */
  const afterTwice = A.mole.state();
  A.setWall(t0 + firstBomb.t + 50);                 /* 폭탄이 올라와 있는 순간 */
  A.el('hole' + firstBomb.hole).dispatch('click', {});
  const afterBomb = A.mole.state();
  A.setWall(t0 + firstMole.t + firstMole.up + 5000); /* 이미 내려간 뒤 */
  A.el('hole' + firstMole.hole).dispatch('click', {});
  const afterLate = A.mole.state();
  const afterPlay = A.rngCalls();

  ok('[premise] 판이 시작되고 ★누른 것이 실제로 먹혔다', afterHit.hits === 1,
     'hits=' + afterHit.hits + ' · 판 ' + runPlan.length + '개(두더지 ' +
     runPlan.filter(e => e.kind === 'mole').length + ' · 폭탄 ' + runPlan.filter(e => e.kind === 'bomb').length + ')');
  ok('[double-hit-once] 같은 등장을 두 번 눌러도 한 번만 센다', afterTwice.hits === 1,
     '두 번 누른 뒤 hits=' + afterTwice.hits);
  ok('[bomb-counts] 폭탄을 누르면 폭탄으로 센다', afterBomb.bombs === 1, 'bombs=' + afterBomb.bombs);
  ok('[late-press-noop] 내려간 뒤 누르면 아무 일도 없다',
     afterLate.hits === afterBomb.hits && afterLate.bombs === afterBomb.bombs,
     'hits ' + afterBomb.hits + '→' + afterLate.hits + ' · bombs ' + afterBomb.bombs + '→' + afterLate.bombs);
  ok('[plan-no-rng-during-play] 판 짜기 뒤 난수 소비 0',
     afterPlay === afterStart, '시작 전 ' + before + ' → 시작 후 ' + afterStart + ' → 플레이 후 ' + afterPlay);
  ok('[plan-no-rng-during-play] 플레이 뒤에도 판이 그대로',
     planAtStart === JSON.stringify(afterLate.plan));
  ok('[score-rule] 화면 점수가 식과 같다',
     afterLate.score === scoreRef(afterLate.hits, afterLate.bombs, C.BOMB_PENALTY),
     'hits ' + afterLate.hits + ' · bombs ' + afterLate.bombs + ' → ' + afterLate.score);

  return A;
}

/* 판을 시작시키는 것은 ★제품 파일이 아니라 여기서 한다 — 배포본에 조작 API 를 두지 않는다.
   ★진짜 입력 사건으로 두드린다(버튼 click). */
function startRun(A){
  const btn = A.el('btnStart');
  const n = btn.dispatch('click', {});
  A.flush();
  return n > 0;
}

/* ───────────────────────── 모형 (제품 없이 탐지력 증명) ─────────────────────────
   ★준법 모형 하나와 ★위반 모형 여럿에 ★위와 같은 단언을 건다.
   준법은 전부 초록이어야 하고, 위반은 ★겨냥한 검사만 붉어야 한다. */
function model(over){
  over = over || {};
  return `
    var HOLES = ${over.holes || 9}, DURATION_MS = ${over.duration || 60000}, BOMB_PENALTY = ${over.penalty === undefined ? 2 : over.penalty};
    var SEED_NS = 'mole:';
    function pad2(n){ return String(n).padStart(2,'0'); }
    function kstParts(d){ var k = new Date((d ? d.getTime() : Date.now()) + 9*3600000);
                          return { y:k.getUTCFullYear(), m:k.getUTCMonth(), d:k.getUTCDate() }; }
    function dayKey(d){ var k = kstParts(d); return k.y + '-' + pad2(k.m+1) + '-' + pad2(k.d); }
    function hashStr(s){ var h = 2166136261 >>> 0; for (var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
    function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    function planFor(key){
      var r = mulberry32(hashStr(SEED_NS + key ${over.clock ? "+ String(Date.now())" : ''}));
      var out = [], t = 700;
      while (t < DURATION_MS - 1000){
        var up = 900 + Math.floor(r() * 300);
        out.push({ t: t, hole: Math.floor(r() * HOLES), kind: (r() < 0.25 ? 'bomb' : 'mole'), up: up });
        t += 700 + Math.floor(r() * 400);
      }
      return out;
    }
    function scoreOf(h, b){ var s = h - ${over.penaltyFree ? 0 : 'BOMB_PENALTY'} * b; return s < 0 ? 0 : s; }
    var GLYPH = { mole: '\uD83D\uDC39', bomb: '${over.sameGlyph ? '\\uD83D\\uDC39' : '\\uD83D\\uDCA3'}' };
    var ST = { running:false, plan:[], hits:0, bombs:0, taken:{}, mode:'daily', seedKey:'', startMs:0 };
    function elapsedNow(){ return ST.running ? Math.min(DURATION_MS, Date.now() - ST.startMs) : 0; }
    function upAt(idx, el){
      for (var i=0;i<ST.plan.length;i++){ var e = ST.plan[i];
        if (e.hole === idx && el >= e.t && el < e.t + e.up) return e; }
      return null;
    }
    function start(){
      ST.seedKey = dayKey();
      ST.plan = planFor(ST.seedKey);
      ST.running = true; ST.hits = 0; ST.bombs = 0; ST.taken = {}; ST.startMs = Date.now();
    }
    document.getElementById('btnStart').onclick = start;
    for (var i = 0; i < HOLES; i++){
      (function(idx){
        document.getElementById('hole' + idx).onclick = function(){
          if (!ST.running) return;
          ${over.playRng ? 'Math.random();' : ''}
          var e = upAt(idx, elapsedNow());
          if (!e) return;
          var id = e.t + ':' + e.hole;
          ${over.doubleCount ? '' : 'if (ST.taken[id]) return; ST.taken[id] = 1;'}
          if (e.kind === 'bomb') ST.bombs++; else ST.hits++;
        };
      })(i);
    }
    window.__mole = {
      const: function(){ return { HOLES: HOLES, DURATION_MS: DURATION_MS, BOMB_PENALTY: BOMB_PENALTY, SEED_NS: SEED_NS }; },
      dayKey: function(d){ return dayKey(d ? new Date(d) : undefined); },
      planFor: function(k){ return planFor(String(k)); },
      planSrc: function(){ return String(planFor); },
      scoreOf: function(h, b){ return scoreOf(h, b); },
      glyphOf: function(k){ return GLYPH[k] || ''; },
      state: function(){ return { running: ST.running, plan: JSON.parse(JSON.stringify(ST.plan)),
                                  hits: ST.hits, bombs: ST.bombs, mode: ST.mode, seedKey: ST.seedKey,
                                  score: scoreOf(ST.hits, ST.bombs) }; }
    };
  `;
}

const MODELS = [
  ['준법 모형', model({}), []],
  ['위반: 판에 시계를 섞음', model({ clock: true }), ['plan-no-clock', 'plan-static-no-time']],
  ['위반: 플레이가 난수를 씀', model({ playRng: true }), ['plan-no-rng-during-play']],
  ['위반: 폭탄 감점 없음', model({ penaltyFree: true }), ['score-rule']],
  ['위반: 한 판 90초', model({ duration: 90000 }), ['contract-consts']],
  ['위반: 폭탄이 두더지와 같은 글자', model({ sameGlyph: true }), ['glyph-not-color-only']],
  ['위반: 중복 클릭을 두 번 셈', model({ doubleCount: true }), ['double-hit-once']],
];

function runSelfTest(){
  let bad = 0;
  console.log('=== 검출력 자기시험 — 준법 모형은 초록 · 위반 모형은 ★겨냥한 검사만 붉다 ===');
  for (const [name, src, targets] of MODELS){
    pass = 0; fail = 0; indetMsg = null; lines.length = 0;
    runAssertions(src, name);
    const reds = lines.filter(l => l.startsWith('  ✗'));
    const hitNames = reds.map(l => (l.match(/\[([a-z-]+)\]/) || [])[1]).filter(Boolean);
    let verdict;
    if (indetMsg){ verdict = '★판정 불가 — ' + indetMsg; bad++; }
    else if (targets.length === 0){
      verdict = reds.length === 0 ? 'OK (전부 초록)' : '★어긋남 — 붉은 검사 ' + reds.length + '건';
      if (reds.length) bad++;
    } else {
      const covered = targets.every(t => hitNames.includes(t));
      const strayed = hitNames.filter(h => !targets.includes(h) && h !== 'premise');
      verdict = (covered && strayed.length === 0) ? 'OK (겨냥한 것만 붉다)'
              : '★어긋남 — 겨냥 ' + targets.join(',') + ' / 실제 ' + (hitNames.join(',') || '없음');
      if (!covered || strayed.length) bad++;
    }
    console.log('  %s  PASS %d · FAIL %d — %s', name.padEnd(26), pass, fail, verdict);
  }
  console.log(bad === 0
    ? '★자기시험 통과 — 이 검사기는 여섯 가지 위반을 각각 겨냥한 자리에서 잡는다'
    : '★자기시험 실패 ' + bad + '건 — 검사기를 먼저 고쳐라');
  process.exit(bad === 0 ? 0 : 1);
}

/* ───────────────────────── 변이(제품 소스) ───────────────────────── */
const MUTATIONS = {
  'plan-clock': { from: "const r = mulberry32(hashStr(SEED_NS + key));",
                  to:   "const r = mulberry32(hashStr(SEED_NS + key + String(Date.now())));",
                  expect: ['plan-no-clock', 'plan-static-no-time'] },
  'score-bomb-free': { from: "const s = hits - BOMB_PENALTY * bombs;",
                       to:   "const s = hits - 0 * bombs;",
                       expect: ['score-rule'] },
  'duration-90': { from: "const DURATION_MS = 60000;", to: "const DURATION_MS = 90000;",
                   expect: ['contract-consts'] },
  'glyph-same': { from: "const GLYPH = { mole: '🐹', bomb: '💣' };",
                  to:   "const GLYPH = { mole: '🐹', bomb: '🐹' };",
                  expect: ['glyph-not-color-only'] },
  'double-count': { from: "if (ST.taken.has(id)) return;", to: "if (false) return;",
                    expect: ['double-hit-once'] },
  'play-rng': { from: "function onHole(idx){", to: "function onHole(idx){ Math.random();",
                expect: ['plan-no-rng-during-play'] },
};

function printAndExit(title){
  console.log('=== ' + title + ' ===');
  for (const l of lines) console.log(l);
  if (indetMsg){ console.log('★판정 불가 — ' + indetMsg + ' (rc=2 · 통과로 세지 않는다)'); process.exit(2); }
  console.log('결과: PASS ' + pass + ' · FAIL ' + fail + ' (분모 ' + (pass + fail) + ')');
  process.exit(fail ? 1 : 0);
}

if (has('--list-mutations')){
  for (const k of Object.keys(MUTATIONS)) console.log(k + '  → 겨냥: ' + MUTATIONS[k].expect.join(', '));
  process.exit(0);
}
if (has('--selftest')) runSelfTest();

if (!fs.existsSync(HTML)){
  console.log('=== 두더지잡기 검증기 ===');
  console.log('★판정 불가 — 제품이 아직 없다: ' + HTML);
  console.log('  (이 검사는 ★제품보다 먼저 쓰였다. 탐지력은 --selftest 로 따로 증명한다.)');
  process.exit(2);
}
let raw = fs.readFileSync(HTML, 'utf8');
const MUT = valOf('--mutate', null);
if (MUT){
  const m = MUTATIONS[MUT];
  if (!m){ console.log('★판정 불가 — 그런 변이가 없다: ' + MUT); process.exit(2); }
  const n = raw.split(m.from).length - 1;
  if (n !== 1){ console.log('★판정 불가 — 변이 앵커가 ' + n + '회다(1회여야 한다): ' + MUT); process.exit(2); }
  raw = raw.replace(m.from, m.to);
}
const script = inlineScript(raw);
if (!script){
  console.log('=== 두더지잡기 검증기 ===');
  console.log('★판정 불가 — window.__mole 을 두는 인라인 스크립트를 찾지 못했다');
  process.exit(2);
}
runAssertions(script, '제품');
printAndExit('두더지잡기 검증기' + (MUT ? ' [변이 ' + MUT + ']' : ''));
