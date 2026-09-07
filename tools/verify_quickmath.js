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
    apply: s => s.replace('  const rng = countingRng(mulberry32(hashStr(seedKey)));',
                          '  const rng = countingRng(mulberry32(hashStr(seedKey) + (Date.now() & 7)));')
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
  'm-choice-consumes-rng': {
    why: '보기를 고를 때 전역 난수를 한 번 당긴다 — 덱은 안 바뀌므로 ★덱 동일성 검사로는 안 보인다',
    target: '행동이 난수를 한 번도 안 당긴다(계수)',
    apply: s => s.replace('    score++; paintScore();', '    Math.random(); score++; paintScore();')
  },
  'm-miss-advances': {
    why: '오답에서도 다음 문제로 넘긴다 — master 253 이 확정한 반대 해석',
    target: '정답이면 즉시 다음 문제',   /* ★지목 = :403 의 idxAfterMiss === 0 단언 */
    apply: s => s.replace('    missed++;\r\n    dead.push(i);', '    missed++; idx++;\r\n    dead.push(i);')
  },
  'm-daily-replay-overwrites': {
    why: '완료 뒤에도 daily 버튼이 새 판을 시작한다 — R1 BLOCKING 의 원형',
    target: '완료 뒤 daily 는 새 판을 시작하지 않는다',
    apply: s => s.replace("$('btnDaily').onclick = () => { if (dailyDoneToday()){ showDailyReplay(); return; } replaying = false; startRun('daily'); };",
                          "$('btnDaily').onclick = () => { replaying = false; startRun('daily'); };")
  },
  'm-save-overwrites': {
    /* ★두 방어가 서로를 가린다 — 버튼 가드가 막고 있어서 저장 가드만 지우면 아무 일도 안 난다
       (한 줄만 지우는 변이는 ★공허했다 · 2026-09-07 실측). 그래서 ★둘 다 지운다. */
    why: '버튼 가드와 저장 가드를 ★함께 없애 그날 기록을 덮어쓰게 한다 — R1 BLOCKING 의 데이터 손실 경로',
    target: '재열람이 기록을 덮지 않는다',
    apply: s => s
      .replace("$('btnDaily').onclick = () => { if (dailyDoneToday()){ showDailyReplay(); return; } replaying = false; startRun('daily'); };",
               "$('btnDaily').onclick = () => { replaying = false; startRun('daily'); };")
      .replace('  if (dailyDoneFor(runDay)) return false;   /* ★덮어쓰지 않는다 */', '')
  },
  'm-daykey-utc': {
    why: '하루 경계를 로컬에서 UTC 로 옮긴다 — 기존 21종과 갈라진다',
    target: '하루 경계는 로컬 달력이다',
    apply: s => s.replace("function dayKey(d){ d = d || new Date(); return d.getFullYear()",
                          "function dayKey(d){ d = d || new Date(); d = new Date(d.getTime() - 12*3600*1000); return d.getFullYear()")
  },
  'm-run-belongs-to-end-day': {
    why: '판을 끝난 날에 귀속시킨다 — 자정 넘긴 판이 오늘 기록을 먹는다',
    target: '판은 시작한 날에 귀속된다',
    apply: s => s.replace('  localStorage.setItem(\'qm.daily\', JSON.stringify({ date: runDay, score: score }));',
                          '  localStorage.setItem(\'qm.daily\', JSON.stringify({ date: dayKey(), score: score }));')
  },
  'm-penalty-text-hardcoded': {
    why: '감점 배지 문구를 한국어로 박아 언어 전환에 안 따라오게 한다',
    target: '언어를 바꾸면 동적 문구가 남지 않는다',
    apply: s => s.replace("  elPenalty.textContent = T('penalty');", "  elPenalty.textContent = '−3초';")
  },
  'm-focus-after-disable': {
    why: '포커스를 옮기기 전에 버튼을 잠근다 — 키보드 사용자가 자리를 잃는다',
    target: '오답 잠금 전에 포커스를 옮긴다(정적)',
    apply: s => s.replace('    if (alive.length) alive[0].focus(); else elQ.focus();\r\n    btn.disabled = true;',
                          '    btn.disabled = true;\r\n    if (alive.length) alive[0].focus(); else elQ.focus();')
  },
  'm-replay-keeps-log': {
    why: '재열람 결과뷰가 ★직전 판의 목록을 그대로 돌려준다 — R2 Q 의 원형',
    target: '재열람에 직전 판 목록이 남지 않는다',
    apply: s => s.replace('             score: r ? r.score : 0, missed: null, log: [] };',
                          '             score: r ? r.score : 0, missed: null, log: log };')
  },
  'm-applylang-conditional-review': {
    /* ★음성 대조군으로 박제한다(2026-09-07 실측 rc=3 공허).
       뿌리 수리(resultView 가 재열람에서 빈 목록을 준다) 뒤로는 이 조건이 ★짐을 안 진다 —
       조건을 되돌려도 renderReview 가 그리는 것은 여전히 빈 목록이라 아무 검사도 안 붉는다.
       ★가짜 검출로 칸을 채우지 않고, '이건 안 잡기로 했다' 를 시험 안에 남긴다.
       ★누가 resultView 를 되돌리면 그때는 m-replay-keeps-log 가 잡는다. */
    why: '언어 전환에서 목록을 조건부로만 다시 그린다 — ★뿌리 수리 뒤에는 무해하다(대조군)',
    target: null,
    apply: s => s.replace('  renderReview();\r\n  /* ★런타임에 채워지는 문구는',
                          '  if (log.length) renderReview();\r\n  /* ★런타임에 채워지는 문구는')
  },
  'm-share-reads-live-state': {
    why: '공유문이 결과뷰 대신 ★살아 있는 변수를 읽는다 — R2 R 의 원형',
    target: '재열람 공유문이 그날 기록을 말한다',
    apply: s => s.replace('  const when = (v.mode === \'daily\') ? v.day : (lang === \'ko\' ? \'연습\' : \'practice\');',
                          '  const when = (mode === \'daily\') ? runDay : (lang === \'ko\' ? \'연습\' : \'practice\');')
  },
  'm-replay-accuracy-zero': {
    why: '모르는 오답 수를 0 으로 채운다 — 정확도 100%/0% 라는 ★거짓이 나온다',
    target: '모르는 값을 지어내지 않는다',
    apply: s => s.replace('             score: r ? r.score : 0, missed: null, log: [] };',
                          '             score: r ? r.score : 0, missed: 0, log: [] };')
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
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    /* ★제품이 포커스를 옮긴다(N) — 스텁에 없으면 제품이 예외로 죽어 ★계기가 결함을 만든다.
       ★단 포커스 판정 자체는 스텁으로 하지 않는다(실브라우저 증거가 정본이다). */
    focus() { if (this.__world) this.__world.activeElement = this; }
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
  const world = { activeElement: null };
  IDS.forEach(i => { els[i] = mkEl(i); els[i].__world = world; });
  /* 보기 4개 — 실제 마크업과 같은 모양(.opt 안에 .t 와 .mk) */
  for (let i = 0; i < 4; i++) {
    const b = mkEl('opt' + i);
    b.__world = world;
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
  /* ★전역 난수도 하네스가 센다 — 제품에 계수 훅을 뚫지 않는다(C).
     제품이 여는 것은 ★덱 난수 계수(rngUses)뿐이고 그것은 관측이다. */
  let randomCalls = 0;
  const realRandom = Math.random;
  win.Math = Object.create(Math);
  win.Math.random = () => { randomCalls++; return realRandom(); };
  win.__randomCalls = () => randomCalls;
  let clock = (typeof opts.startNow === 'number') ? opts.startNow : 1000;
  win.performance = { now: () => clock };
  win.__advance = ms => { clock += ms; };
  if (typeof opts.fixedNow === 'number') {
    const fixed = opts.fixedNow;
    win.Date = new Proxy(Date, { get(t, p) { return p === 'now' ? () => fixed : t[p]; } });
  }
  if (opts.today instanceof Date) {
    /* ★달력은 하네스가 쥔다 — 그리고 ★움직일 수 있어야 한다(O 자정 롤오버). */
    let D = opts.today;
    const Fake = function (...a) { return a.length ? new Date(...a) : new Date(D.getTime()); };
    Fake.now = () => D.getTime();
    Fake.prototype = Date.prototype;
    win.Date = Fake;
    win.__setDay = d => { D = d; };
  }
  win.window = win;
  vm.createContext(win);
  try { vm.runInContext(SRC, win, { filename: 'quick-math-inline.js' }); }
  catch (e) { console.error('스크립트 실행 실패: ' + e.message); process.exit(2); }
  if (!win.__quickmath) { console.error('관측 창구(window.__quickmath)가 없다'); process.exit(2); }
  return { win, els, doc, store, rafQ, advance: win.__advance, world,
           randomCalls: () => win.__randomCalls(), setDay: win.__setDay };
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
  /* ★그물을 id 목록으로 치지 않는다 — 새로 생긴 요소가 조용히 빠져나간다(R1 254 지적).
     ★스크립트가 textContent/innerHTML 을 채우는 id 를 ★소스에서 파생해 전량 검사한다. */
  const dyn = new Set();
  let m;
  const reA = /\$\('([A-Za-z0-9_-]+)'\)\.(?:textContent|innerHTML)\s*=/g;
  while ((m = reA.exec(SRC))) dyn.add(m[1]);
  const reB = /\b(el[A-Z][A-Za-z0-9]*)\.(?:textContent|innerHTML)\s*=/g;
  const alias = {};
  let m2;
  const reC = /\b(el[A-Z][A-Za-z0-9]*)\s*=\s*\$\('([A-Za-z0-9_-]+)'\)/g;
  while ((m2 = reC.exec(SRC))) alias[m2[1]] = m2[2];
  while ((m = reB.exec(SRC))) if (alias[m[1]]) dyn.add(alias[m[1]]);
  if (dyn.size < 5) return { ok: false, note: '★파생 실패 — 동적 id 를 ' + dyn.size + '개만 찾았다(표본 미성립)' };
  const bad = [];
  dyn.forEach(id => {
    const re = new RegExp('<[a-z0-9]+([^>]*\\bid="' + id + '"[^>]*)>', 'i');
    const t = RAW.match(re);
    if (t && /data-i18n/.test(t[1])) bad.push(id);
  });
  return { ok: bad.length === 0, note: bad.length ? ('★' + bad.join(',')) : ('소스 파생 동적 id ' + dyn.size + '개 전량 없음') };
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


/* ── C ★행동이 난수를 소비하지 않는다 — ★계수로 직접 잰다(덱 동일성은 대리물) ── */
check('행동이 난수를 한 번도 안 당긴다(계수)', () => {
  const W = makeWorld({ today: new Date(2026, 5, 6) });
  startDaily(W); must(W, '계수');
  const k = W.win.__quickmath;
  const afterBuild = k.rngUses;
  const randAfterBuild = W.randomCalls();
  if (!(afterBuild > 0)) return { ok: false, note: '★판을 짜며 덱 난수를 한 번도 안 썼다(표본 미성립)' };
  let taps = 0;
  for (let step = 0; step < 10 && k.running; step++) {
    const q = k.deck[k.idx];
    for (let i = 0; i < 4; i++) if (i !== q.correct) { tapOpt(W, i); taps++; }
    tapOpt(W, q.correct); taps++;
  }
  const dRng = k.rngUses - afterBuild;
  const dRandom = W.randomCalls() - randAfterBuild;
  return { ok: dRng === 0 && dRandom === 0 && taps > 0,
           note: '탭 ' + taps + '회 · 덱난수 +' + dRng + ' · 전역 Math.random +' + dRandom + ' (둘 다 0 이어야 한다)' };
});

/* ── B ★하루 경계의 권위 = 사용자의 로컬 달력 (기존 21/22 종과 같다) ── */
check('하루 경계는 로컬 달력이다', () => {
  const bad = [];
  [[0, 5], [8, 30], [12, 0], [22, 15], [23, 59]].forEach(([h, mi]) => {
    const W = makeWorld({ today: new Date(2026, 2, 15, h, mi) });
    startDaily(W); must(W, 'tz');
    const want = 'hanpango-daily-quick-math-2026-03-15';
    if (W.win.__quickmath.seedKey !== want) bad.push(h + ':' + mi + ' → ' + W.win.__quickmath.seedKey);
  });
  /* 정적으로도 못박는다 — 시간대 보정이 들어오면 붉어진다 */
  const seg = SRC.slice(SRC.indexOf('function dayKey'), SRC.indexOf('function dayKey') + 260);
  if (/getTimezoneOffset|toISOString|getUTC|timeZone/.test(seg)) bad.push('★dayKey 에 시간대 보정이 들어왔다');
  return { ok: bad.length === 0, note: bad.length ? bad.join(' / ') : '하루 5시각 전부 로컬 날짜와 일치 · 시간대 보정 0건' };
});

/* ── O ★판은 시작한 날에 귀속된다(자정 롤오버) ── */
check('판은 시작한 날에 귀속된다', () => {
  const D0 = new Date(2026, 6, 10, 23, 59, 0);
  const W = makeWorld({ today: D0 });
  startDaily(W); must(W, '롤오버');
  const k = W.win.__quickmath;
  const day0 = k.runDay;
  W.setDay(new Date(2026, 6, 11, 0, 1, 0));      /* 자정을 넘긴다 */
  W.advance(30001);
  const fn = W.rafQ[W.rafQ.length - 1]; if (typeof fn === 'function') fn();
  if (k.running) return { ok: false, note: '★판이 안 끝났다(표본 미성립)' };
  const rec = k.dailyRecord;
  const doneNow = k.dailyDone;
  return { ok: rec && rec.date === day0 && day0 === '2026-07-10' && doneNow === false,
           note: '저장 날짜 ' + (rec && rec.date) + ' (시작일 ' + day0 + ') · 자정 뒤 오늘 완료여부 ' + doneNow +
                 ' → 어제 판을 끝내도 오늘 판은 열려 있다' };
});

/* ── A ★하루 1회 — 완료 뒤 daily 버튼은 새 판을 시작하지 않는다 ── */
check('완료 뒤 daily 는 새 판을 시작하지 않는다', () => {
  const W = makeWorld({ today: new Date(2026, 7, 3, 10, 0, 0) });
  startDaily(W); must(W, 'A-1');
  const k = W.win.__quickmath;
  let solved = 0;
  for (let i = 0; i < 7 && k.running; i++) { const q = k.deck[k.idx]; tapOpt(W, q.correct); solved++; }
  W.advance(30001);
  const fn = W.rafQ[W.rafQ.length - 1]; if (typeof fn === 'function') fn();
  if (k.running) return { ok: false, note: '★첫 판이 안 끝났다(표본 미성립)' };
  const first = k.dailyRecord;
  if (!first || first.score !== solved) return { ok: false, note: '★첫 기록이 안 남았다(표본 미성립) ' + JSON.stringify(first) };
  W.els.btnDaily.fire('click');
  const after = k.dailyRecord;
  return { ok: k.running === false && k.replaying === true && after.score === first.score,
           note: '재클릭 뒤 running ' + k.running + ' · replaying ' + k.replaying +
                 ' · 기록 ' + first.score + ' → ' + after.score + '(그대로여야 한다)' };
});

/* ── A ★재열람은 그날 기록을 덮지 않는다(데이터 손실 봉쇄) ── */
check('재열람이 기록을 덮지 않는다', () => {
  const W = makeWorld({ today: new Date(2026, 7, 4, 9, 0, 0) });
  startDaily(W); must(W, 'A-2');
  const k = W.win.__quickmath;
  let solved = 0;
  for (let i = 0; i < 9 && k.running; i++) { const q = k.deck[k.idx]; tapOpt(W, q.correct); solved++; }
  W.advance(30001);
  const fn = W.rafQ[W.rafQ.length - 1]; if (typeof fn === 'function') fn();
  const before = W.store['qm.daily'];
  W.els.btnDaily.fire('click');        /* 재열람 */
  W.els.btnAgain.fire('click');        /* 시작 화면으로 */
  W.els.btnDaily.fire('click');        /* 또 눌러 본다 */
  /* ★여기서 멈추면 '아직 안 끝난 두 번째 판' 때문에 덮어쓰기가 관측되지 않는다 —
     가드가 뚫렸을 때 실제로 저장까지 가도록 ★시계를 끝까지 밀어 준다. */
  W.advance(30001);
  const fn2 = W.rafQ[W.rafQ.length - 1]; if (typeof fn2 === 'function') fn2();
  const after = W.store['qm.daily'];
  return { ok: before === after && JSON.parse(after).score === solved,
           note: '저장본 ' + (before === after ? '불변' : '★바뀜') + ' · 점수 ' + JSON.parse(after).score + '(맞힌 ' + solved + ')' };
});

/* ── A ★연습 모드는 완료 뒤에도 무제한이다 ── */
check('연습 모드는 완료 뒤에도 열려 있다', () => {
  const W = makeWorld({ today: new Date(2026, 7, 5, 9, 0, 0) });
  startDaily(W); must(W, 'A-3');
  const k = W.win.__quickmath;
  W.advance(30001);
  const fn = W.rafQ[W.rafQ.length - 1]; if (typeof fn === 'function') fn();
  const doneBefore = k.dailyDone;
  const rec = W.store['qm.daily'];
  startFree(W);
  const rec2 = W.store['qm.daily'];
  return { ok: doneBefore === true && k.running === true && k.mode === 'free' && rec === rec2,
           note: '완료 ' + doneBefore + ' → 연습 시작 running ' + k.running + ' mode ' + k.mode +
                 ' · 일일 저장본 ' + (rec === rec2 ? '불변' : '★건드림') };
});

/* ── E ★거울상 — 언어를 바꾸면 동적 문구가 이전 언어로 남지 않는다 ── */
check('언어를 바꾸면 동적 문구가 남지 않는다', () => {
  const W = makeWorld({ today: new Date(2026, 8, 1, 9, 0, 0) });
  startDaily(W); must(W, 'E');
  const k = W.win.__quickmath;
  const q = k.deck[0];
  tapOpt(W, [0, 1, 2, 3].find(i => i !== q.correct));   /* 오답 — penalty 문구가 채워진다 */
  W.advance(30001);
  const fn = W.rafQ[W.rafQ.length - 1]; if (typeof fn === 'function') fn();
  /* ko 사전에만 있는 값들을 모은다 — 구조로 뽑는다(id 하드코딩 아님) */
  const koDict = {}, enDict = {};
  let m;
  const grab = (name, into) => {
    const i = SRC.indexOf(name + ': {');
    const seg = SRC.slice(i, SRC.indexOf('\n  }', i));
    const re = /([A-Za-z0-9_]+)\s*:\s*'((?:[^'\\]|\\.)*)'/g;
    while ((m = re.exec(seg))) into[m[1]] = m[2];
  };
  grab('ko', koDict); grab('en', enDict);
  if (Object.keys(koDict).length < 10) return { ok: false, note: '★사전 파생 실패(표본 미성립)' };
  W.els.btnLang.fire('click');                          /* → en */
  const koOnly = Object.keys(koDict).filter(kk => enDict[kk] && enDict[kk] !== koDict[kk]).map(kk => koDict[kk]);
  const leftovers = [];
  Object.keys(W.els).forEach(id => {
    const t = (W.els[id].textContent || '').trim();
    if (t && koOnly.indexOf(t) >= 0) leftovers.push(id + '=' + t);
  });
  return { ok: leftovers.length === 0,
           note: leftovers.length ? ('★이전 언어 잔류: ' + leftovers.join(' , ')) : ('ko 전용 문구 ' + koOnly.length + '종 대조 · 잔류 0') };
});

/* ── N ★포커스를 옮기고 나서 잠근다(정적 짝 · 판정 정본은 실브라우저) ── */
check('오답 잠금 전에 포커스를 옮긴다(정적)', () => {
  const i = SRC.indexOf('function choose');
  const seg = SRC.slice(i, SRC.indexOf('optBtns.forEach((btn, i)', i));
  const f = seg.indexOf('.focus()');
  const d = seg.indexOf('btn.disabled = true');
  return { ok: f >= 0 && d >= 0 && f < d,
           note: f < 0 ? '★포커스 이동이 없다' : (d < 0 ? '★잠금이 없다' : ('focus@' + f + ' < disabled@' + d)) };
});


/* ── R2 준비 — 일일 완주 → 연습 완주 → 재열람 까지 몰아 놓은 세계를 만든다 ──
   ★재열람의 위험은 '직전 판이 남긴 상태' 다. 그래서 ★중간에 연습 판을 반드시 끼운다.
   이 도우미가 없으면 검사들이 서로 다른 표본을 쓰게 된다. */
function replayWorld(day) {
  const W = makeWorld({ today: day });
  startDaily(W); must(W, 'R2-daily');
  const k = W.win.__quickmath;
  let solved = 0;
  for (let i = 0; i < 5 && k.running; i++) { const q = k.deck[k.idx]; tapOpt(W, q.correct); solved++; }
  W.advance(30001);
  let fn = W.rafQ[W.rafQ.length - 1]; if (typeof fn === 'function') fn();
  if (k.running) return { bad: '★일일 판이 안 끝났다' };
  const rec = k.dailyRecord;
  /* ★중간에 연습 한 판 — 이것이 log·mode·score·missed 를 '남의 판' 으로 채운다 */
  W.els.btnAgain.fire('click');
  startFree(W);
  const q0 = k.deck[k.idx];
  tapOpt(W, [0, 1, 2, 3].find(i => i !== q0.correct));   /* 오답 하나 */
  tapOpt(W, k.deck[k.idx].correct);                      /* 정답 하나 */
  W.advance(30001);
  fn = W.rafQ[W.rafQ.length - 1]; if (typeof fn === 'function') fn();
  const practiceLog = k.resultView.logLen;
  /* 시작 화면으로 나갔다가 오늘의 도전을 다시 누른다 → 재열람 */
  W.els.btnAgain.fire('click');
  W.els.btnDaily.fire('click');
  return { W, k, rec, solved, practiceLog };
}

/* ── Q ★재열람 중 언어를 바꿔도 '남의 판' 목록이 되살아나지 않는다 ── */
check('재열람에 직전 판 목록이 남지 않는다', () => {
  const S = replayWorld(new Date(2026, 9, 12, 9, 0, 0));
  if (S.bad) return { ok: false, note: S.bad };
  if (!(S.practiceLog > 0)) return { ok: false, note: '★연습 판이 목록을 안 남겼다(표본 미성립)' };
  if (S.k.replaying !== true) return { ok: false, note: '★재열람 진입 실패(표본 미성립)' };
  const beforeLang = S.W.els.review.innerHTML.length;
  S.W.els.btnLang.fire('click');            /* ★여기서 되살아나던 자리 */
  const afterLang = S.W.els.review.innerHTML.length;
  return { ok: beforeLang === 0 && afterLang === 0 && S.k.resultView.logLen === 0,
           note: '연습 판 목록 ' + S.practiceLog + '건 · 재열람 목록 길이 ' + beforeLang +
                 ' → 언어 전환 뒤 ' + afterLang + ' (둘 다 0 이어야 한다)' };
});

/* ── R ★재열람 공유문은 그날의 기록을 말한다 ── */
check('재열람 공유문이 그날 기록을 말한다', () => {
  const S = replayWorld(new Date(2026, 9, 13, 9, 0, 0));
  if (S.bad) return { ok: false, note: S.bad };
  const txt = S.k.shareText;
  if (!txt) return { ok: false, note: '★공유문을 못 읽었다(표본 미성립)' };
  const hasDay = txt.indexOf(S.rec.date) >= 0;
  const hasScore = txt.indexOf(String(S.rec.score)) >= 0;
  const saysPractice = /연습|practice/.test(txt);
  return { ok: hasDay && hasScore && !saysPractice,
           note: JSON.stringify(txt) + ' · 날짜 ' + hasDay + ' · 점수 ' + hasScore + ' · 연습이라 말함 ' + saysPractice };
});

/* ── ★모르는 값을 0 으로 적지 않는다(0% 와 '모름' 은 다르다) ── */
check('모르는 값을 지어내지 않는다', () => {
  const S = replayWorld(new Date(2026, 9, 14, 9, 0, 0));
  if (S.bad) return { ok: false, note: S.bad };
  const nBad = S.W.els.nBad.textContent, nAcc = S.W.els.nAcc.textContent;
  const txt = S.k.shareText;
  const view = S.k.resultView;
  return { ok: nBad === '–' && nAcc === '–' && view.missed === null && txt.indexOf('%') < 0,
           note: 'nBad ' + JSON.stringify(nBad) + ' · nAcc ' + JSON.stringify(nAcc) +
                 ' · view.missed ' + view.missed + ' · 공유문에 % ' + (txt.indexOf('%') >= 0) };
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
