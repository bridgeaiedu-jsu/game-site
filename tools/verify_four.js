#!/usr/bin/env node
/* verify_four.js — 「넷이 한판」 검증 (판은 시작될 때 정해지고, 그 뒤로 아무도 못 바꾼다)
 *
 * `four/index.html` 의 인라인 스크립트를 **그대로 꺼내** 최소 DOM 스텁 위에서 돌린다.
 * 시험용 뒷문은 제품에 두지 않는다 — 배포본의 `window.__four` 는 **읽기 전용 창구**이고,
 * 재현성은 **하네스가 자기 쪽에서** 만든다(스텁의 타이머를 쥐면 된다).
 *
 * 이 게임에 실린 약속 중 무게가 큰 셋:
 *   ★① 5라운드의 표식·대기시간은 **판이 시작될 때 전부 정해진다** — 행동은 난수를 소비하지 않는다.
 *   ★② 판정은 **칸별 독립**이다 — 폰 하나에 손가락이 넷이어도 동시 터치가 결과를 가르지 않는다.
 *   ★③ 대기 하한과 ✕ 횟수·3연속 금지는 **뽑는 자리에서** 걸린다(사후 필터·전 수열 재추첨 아님).
 *
 * ★잠근 항의 정본은 이 파일이 아니라 `tools/four_locked_contracts.json` 이다.
 *   검사기가 목록을 들고 있으면 항을 지우는 것과 검사를 지우는 것이 한 손에서 일어난다.
 *   여기서는 **읽어서 대조만** 한다(양방향 차집합은 run_mutations_four.py 가 판정한다).
 *
 * ★검사는 제품의 함수로 제품을 채점하지 않는다. ✕ 횟수·연속 길이·대기 하한은 이 파일이
 *   **자기 것으로 다시 세어** 대조한다.
 *
 * 사용법:
 *   node tools/verify_four.js                          # 대조군(기본 대상 = 이 저장소의 four/index.html)
 *   node tools/verify_four.js --html four/index.html
 *   node tools/verify_four.js --only <검사이름>
 *   node tools/verify_four.js --list-mutations
 *   node tools/verify_four.js --mutate m-press-consumes-rng
 *
 * 종료코드: 0 = 전부 통과 · 1 = 미달 있음 · 2 = 검사를 세울 수 없음(하네스·주입 실패·검사 미실행)
 *   · 3 = 주입은 됐는데 ★지목한 검사가 잡지 못했다(검사가 공허하다).
 *   '못 세웠다'(2)와 '못 잡았다'(3)를 한 코드로 묶으면 호출자가 원인을 오분류한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = n => argv.indexOf(n) >= 0;

const HTML = argOf('--html', path.join(__dirname, '..', 'four', 'index.html'));
const ONLY = argOf('--only', null);
const MUTATION = argOf('--mutate', null);
const SEEDS = Number(argOf('--seeds', 3000));

/* ------------------------------------------------------------ 뮤테이션 표
   ★각 뮤테이션은 '어느 검사가 잡아야 하는가' 를 ★이름으로 지목한다. 지목한 검사가
   아예 돌지 않았으면(앵커 노후화) rc=2 로 멈춘다 — 무임승차를 인정하지 않는다. */
const MUTATIONS = {
  'm-press-consumes-rng': {
    why: '누름이 난수를 소비하게 한다 — 행동이 판을 바꾼다',
    target: 'action-consumes-no-randomness',
    apply: s => s.replace(
      '  state.locked[i] = true;\n  state.scores[i] += res.delta;',
      '  state.locked[i] = true;\n  state.planned.rounds[state.round].waitMs += Math.floor(Math.random() * 500);\n  state.scores[i] += res.delta;')
  },
  'm-wait-postfilter': {
    why: '대기 하한을 ★생성 규칙에서 빼고 사후 필터로 바꾼다(짧게 뽑은 뒤 고쳐 준다)',
    target: 'wait-floor-is-generative',
    apply: s => s.replace(
      'var waitMs = WAIT_MIN_MS + Math.floor(rnd() * (WAIT_SPAN_MS + 1));',
      'var waitMs = Math.floor(rnd() * (WAIT_MIN_MS + WAIT_SPAN_MS + 1));\n    if (waitMs < WAIT_MIN_MS) waitMs = WAIT_MIN_MS;')
  },
  'm-wait-no-floor': {
    why: '대기 하한을 통째로 없앤다 — 신호가 시작하자마자 뜰 수 있게 된다',
    target: 'wait-floor-is-generative',
    apply: s => s.replace(
      'var waitMs = WAIT_MIN_MS + Math.floor(rnd() * (WAIT_SPAN_MS + 1));',
      'var waitMs = Math.floor(rnd() * (WAIT_SPAN_MS + 1));')
  },
  'm-seed-ignores-players': {
    why: 'seed 에서 인원을 뺀다 — 3인 판과 4인 판이 같은 씨앗을 받는다',
    target: 'player-count-splits-the-plan',
    apply: s => s.replace("var str = dayKey + '#' + players;", "var str = dayKey + '#';")
  },
  'm-plan-reads-clock': {
    why: '판 짜기가 시계를 읽게 한다 — 느린 기기에서만 결과가 갈리는 시간 기반 분기',
    target: 'plan-is-pure',
    apply: s => s.replace(
      'function plan(seed, players) {\n  var rnd = makeRng(seed);',
      'function plan(seed, players) {\n  var rnd = makeRng(seed ^ (Date.now() & 0xffff));')
  },
  'm-mute-cap-removed': {
    why: '✕ 상한을 없앤다 — 판의 절반이 ✕ 가 될 수 있다',
    target: 'mute-count-in-range',
    apply: s => s.replace('if (muteUsed < MUTE_MAX) cands.push(MUTE);', 'cands.push(MUTE);')
  },
  'm-mute-floor-removed': {
    why: '✕ 하한을 없앤다 — ✕ 가 한 번도 안 나오는 판이 생긴다',
    target: 'mute-count-in-range',
    apply: s => s.replace('if (needMute >= left) {', 'if (false) {')
  },
  'm-mute-resample': {
    why: '✕ 하한을 ★뽑는 자리가 아니라 ★전 수열 재추첨으로 맞춘다 — 안 밟히는 복구 가지가 생긴다',
    target: 'mute-quota-at-draw-site',
    apply: s => s
      .replace('    if (needMute >= left) {', '    if (false) {')
      .replace(
        '  return { seed: seed >>> 0, players: players, rounds: rounds };',
        '  var mc = 0;\n  for (var z = 0; z < rounds.length; z++) if (rounds[z].mark === MUTE) mc++;\n  if (mc < MUTE_MIN) return plan((seed + 1) >>> 0, players);\n  return { seed: seed >>> 0, players: players, rounds: rounds };')
  },
  'm-run-cap-removed': {
    why: '3연속 금지를 없앤다 — 한 사람만 계속 주인공이 되는 판이 생긴다',
    target: 'no-three-in-a-row',
    apply: s => s.replace('if (a === m && b === m) continue;', 'if (false) continue;')
  },
  'm-run-cap-resample': {
    why: '3연속 금지를 ★뽑는 자리가 아니라 ★재귀 재추첨으로 맞춘다',
    target: 'no-three-in-a-row-at-draw-site',
    apply: s => s
      .replace('if (a === m && b === m) continue;', 'if (false) continue;')
      .replace(
        '    var pick = cands[Math.floor(rnd() * cands.length)];',
        '    var pick = cands[Math.floor(rnd() * cands.length)];\n    if (rounds.length >= 2 && rounds[rounds.length - 1].mark === pick && rounds[rounds.length - 2].mark === pick) return plan((seed + 7) >>> 0, players);')
  },
  'm-first-press-wins': {
    why: '판정을 ★먼저 누른 사람 기준으로 바꾼다 — 멀티터치 순서가 점수를 가른다',
    target: 'scoring-is-per-lane-independent',
    apply: s => s.replace(
      '  if (state.locked[i]) return;',
      '  if (state.locked[i]) return;\n  for (var z = 0; z < state.players; z++) if (state.locked[z]) return;')
  },
  'm-false-start-ends-round': {
    why: '부정출발이 ★모든 칸을 잠근다 — 한 사람의 실수가 다른 칸의 기회를 없앤다',
    target: 'false-start-locks-only-that-lane',
    apply: s => s.replace(
      '  state.locked[i] = true;\n  state.scores[i] += res.delta;',
      "  state.locked[i] = true;\n  if (res.kind === 'false-start') { for (var z = 0; z < state.players; z++) state.locked[z] = true; }\n  state.scores[i] += res.delta;")
  },
  'm-press-target-is-center': {
    why: '누르는 대상을 ★가운데로 옮긴다 — 자기 칸이 아니라 한 점을 넷이 다투게 된다',
    target: 'press-target-is-own-lane',
    apply: s => s.replace(
      '  <div class="center" id="center">',
      '  <div class="center" id="center" role="button" tabindex="0">')
  },
  'm-i18n-on-live-node': {
    why: '판 진행 중 바뀌는 자리에 data-i18n 을 붙인다 — 언어 전환이 진행 중 내용을 덮는다',
    target: 'no-i18n-on-live-nodes',
    apply: s => s.replace(
      '<span class="glyph" id="centerGlyph">',
      '<span class="glyph" id="centerGlyph" data-i18n="result">')
  },
  'm-color-only-signal': {
    why: '가운데 신호에서 ★글자를 빼고 색·테두리만 남긴다 — 색만으로 알리게 된다',
    target: 'accessibility-not-color-alone',
    apply: s => s.replace(
      "  w.textContent = mk === MUTE ? T('centerMute') : fill(T('centerMark'), { mark: markWord(mk) });",
      "  w.textContent = '';")
  },
  'm-aria-frozen-korean': {
    why: 'aria-label 을 한국어로 굳힌다 — 화면은 영어인데 스크린리더만 한국어를 읽는다',
    target: 'aria-follows-language',
    apply: s => s.replace(
      "    el.setAttribute('aria-label', fill(T('ariaLane'), { n: i + 1, mark: markWord(MARKS[i]) }));",
      "    el.setAttribute('aria-label', (i + 1) + '번 자리 · 표식 ' + MARKS[i]);")
  },
  'm-aria-hardcoded-markup': {
    why: '마크업에 한국어 aria-label 을 직접 박는다 — 사전을 거치지 않는 자리가 생긴다',
    target: 'no-hardcoded-korean-aria',
    apply: s => s.replace(
      '<div class="who" id="whoPick" role="group" data-i18n-aria="ariaWho">',
      '<div class="who" id="whoPick" role="group" aria-label="인원 선택">')
  },
  'm-player-change-keeps-plan': {
    why: '판 도중 인원을 바꿔도 ★그 판을 이어간다 — 앞은 3인 뒤는 4인인 잡종 판이 된다',
    target: 'player-change-restarts-the-plan',
    apply: s => s.replace(
      "  if (changed && (state.phase === 'wait' || state.phase === 'signal' || state.phase === 'between')) {",
      '  if (false) {')
  },
  'm-ink-on-sig': {
    why: '주색 바탕 위 글자를 --sig-ink 로 바꾼다 — 잉크를 바탕 위에 얹는다',
    target: 'ink-never-on-sig',
    apply: s => s.replace(
      '  .btn.primary{background:var(--sig);color:var(--on-sig);border-color:var(--sig)}',
      '  .btn.primary{background:var(--sig);color:var(--sig-ink);border-color:var(--sig)}')
  },
  'm-backdoor-setter': {
    why: '관측 창구에 ★판을 바꾸는 입구를 뚫는다 — 배포본에 조작 API 가 생긴다',
    target: 'observation-window-is-read-only',
    apply: s => s.replace(
      '  snapshot: function () {',
      '  setPlan: function (p) { state.planned = p; },\n  snapshot: function () {')
  },
  'm-seed-not-daily': {
    why: 'seed 에 시계를 섞는다 — 같은 날 같은 인원인데 부를 때마다 다른 판이 된다',
    target: 'same-day-same-players-same-plan',
    apply: s => s.replace(
      'function seedOf(dayKey, players) {\n  var s = 2166136261 >>> 0;',
      'function seedOf(dayKey, players) {\n  var s = (2166136261 ^ Date.now()) >>> 0;')
  },
  'm-player-range-shrunk': {
    why: '인원 상한을 3 으로 줄인다 — 4인 버튼이 사라진다(화면 초기 상태가 계약과 어긋난다)',
    target: 'player-count-range',
    apply: s => s.replace(
      'var PLAYERS_MIN = 3, PLAYERS_MAX = 4, PLAYERS_DEFAULT = 3;',
      'var PLAYERS_MIN = 3, PLAYERS_MAX = 3, PLAYERS_DEFAULT = 3;')
  },
  'm-round-never-advances': {
    why: '라운드가 넘어가지 않는다 — 판이 영원히 첫 라운드에 머문다',
    target: 'a-round-actually-runs',
    apply: s => s.replace('  state.round += 1;', '  state.round += 0;')
  },
  'm-seed-ignores-day': {
    why: 'seed 에서 ★날짜를 뺀다 — 모든 날이 같은 판이 된다(오늘의 판이 거짓이 된다)',
    target: 'different-day-different-plan',
    apply: s => s.replace("var str = dayKey + '#' + players;", "var str = '#' + players;")
  },
  'm-quiet-control': {
    why: '주석 한 줄만 바꾼다 — ★아무 검사도 붉으면 안 된다(음성 대조군)',
    target: null,
    apply: s => s.replace('/* ── 상태 ─', '/* ── 상태(대조군) ─')
  }
};

if (has('--list-mutations')) {
  /* ★기계가 읽는 출력은 칸 너비에 기대지 않는다 — 구분자는 탭이다. */
  Object.keys(MUTATIONS).forEach(k => console.log(
    [k, MUTATIONS[k].target || '(quiet-control)', MUTATIONS[k].why].join(String.fromCharCode(9))));
  process.exit(0);
}

let RAW;
try { RAW = fs.readFileSync(HTML, 'utf8'); }
catch (e) { console.error('대상 파일을 읽지 못했다: ' + HTML); process.exit(2); }
/* ★배포 파일은 CRLF 다. 앵커는 전부 LF 로 적혀 있으므로 한 번만 갈아 끼운다 —
   빠뜨리면 여러 줄 앵커가 통째로 어긋나 '주입 실패' 로 떨어진다. 줄끝은 판정 대상이 아니다. */
RAW = RAW.split('\r\n').join('\n');

if (MUTATION) {
  const m = MUTATIONS[MUTATION];
  if (!m) { console.error('모르는 뮤테이션: ' + MUTATION); process.exit(2); }
  const before = RAW;
  RAW = m.apply(RAW);
  if (RAW === before) { console.error('주입 실패(앵커가 안 맞는다): ' + MUTATION); process.exit(2); }
  console.log('※ 뮤테이션 주입: ' + MUTATION + ' — ' + m.why);
  console.log('※ 지목한 검사: ' + (m.target || '(quiet-control · 아무 검사도 붉으면 안 된다)'));
}

/* ------------------------------------------------------------ 게임 스크립트 꺼내기 */
function gameSource(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) { if (!/\bsrc=/.test(m[1]) && !/type="application\/ld\+json"/.test(m[1])) out.push(m[2]); }
  /* ★부분 문자열로 고르지 않는다 — 고르는 기준은 ★창구를 여는 자리다. */
  return out.find(s => s.indexOf('window.__four = {') >= 0) || null;
}
const SRC = gameSource(RAW);
if (!SRC) { console.error('게임 스크립트(window.__four = { 을 여는 인라인 <script>)를 찾지 못했다'); process.exit(2); }

/* ------------------------------------------------------------ 최소 DOM 스텁 */
function mkEl(id) {
  /* ★innerHTML 은 접근자다 — 실제 DOM 에서 '' 를 넣으면 자식이 사라진다.
     값만 담는 스텁이면 paintWho 가 두 번 불릴 때 버튼이 ★두 벌로 쌓여, 제품이 아니라
     ★내 계기가 만든 거짓을 검사가 붉게 본다(2026-09-07 실측). */
  const el = {
    id, tagName: 'DIV', hidden: false, textContent: '',
    attrs: {}, kids: [], listeners: {}, parentNode: null, className: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.kids.push(c); c.parentNode = this; return c; },
    querySelectorAll() { return this.kids; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    fire(t, ev) { (this.listeners[t] || []).forEach(f => f(ev || { target: this })); }
  };
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) { _html = String(v); if (_html === '') el.kids.length = 0; }
  });
  return el;
}
const IDS = ['start', 'play', 'over', 'whoPick', 'board', 'lane0', 'lane1', 'lane2', 'lane3',
  'center', 'centerGlyph', 'centerWord', 'roundNo', 'phaseWord', 'rankBody', 'nPlayers',
  'nRounds', 'nTime', 'btnStart', 'btnAgain', 'btnSound', 'btnLang', 'btnQuit', 'subtitle'];

function makeWorld() {
  const els = {};
  IDS.forEach(i => { els[i] = mkEl(i); });
  /* 칸에는 span 3개(표식·자리·증감)가 있다 — 실제 마크업과 같은 모양으로 만든다 */
  ['lane0', 'lane1', 'lane2', 'lane3'].forEach(i => { for (let k = 0; k < 3; k++) els[i].appendChild(mkEl('')); });
  const store = {};
  /* ★타이머는 하네스가 쥔다 — 제품에 시간 조작 훅을 뚫지 않는다. */
  const timers = [];
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
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    addEventListener: () => {}, Math, Date, console, JSON
  };
  win.window = win;
  vm.createContext(win);
  try { vm.runInContext(SRC, win, { filename: 'four-inline.js' }); }
  catch (e) { console.error('스크립트 실행 실패: ' + e.message); process.exit(2); }
  if (!win.__four) { console.error('관측 창구(window.__four)가 없다'); process.exit(2); }
  return { win, els, doc, store, timers };
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

const W0 = makeWorld();
const C = W0.win.__four.consts();
const MARKS = W0.win.__four.marks;

/* 잠근 항 정본을 ★읽는다(검사기 안에 목록을 들고 있지 않는다) */
let CANON = null;
try {
  CANON = JSON.parse(fs.readFileSync(path.join(__dirname, 'four_locked_contracts.json'), 'utf8'));
} catch (e) { CANON = null; }

/* ── ① 선굴림 — 행동이 난수를 소비하지 않는다 ───────────────────────────── */
check('action-consumes-no-randomness', () => {
  const W = makeWorld();
  W.els.btnStart.fire('click');
  const before = JSON.stringify(W.win.__four.snapshot().rounds);
  if (!before || before === 'null') return { ok: false, note: '시작 후 수열이 없다' };
  /* 대기 중 누름 · 신호 중 누름 · 여러 라운드를 굴려도 수열은 그대로여야 한다 */
  W.els.lane0.fire('click');
  W.els.lane1.fire('click');
  let guard = 0;
  while (W.timers.length && guard++ < 40) W.timers.shift().fn();
  const after = JSON.stringify(W.win.__four.snapshot().rounds);
  return { ok: after === before, note: after === before ? '수열 불변' : '수열이 바뀌었다' };
});

/* ── ② 오늘의 판 — 같은 날·같은 인원이면 같은 수열 ─────────────────────── */
check('same-day-same-players-same-plan', () => {
  const f = W0.win.__four;
  /* ★같은 순간에 두 번 물으면 시각 독립을 증명하지 못한다 — 시계를 ★크게 벌려 두 번 잰다.
     (2026-09-07: seed 에 시계를 섞는 뮤테이션이 이 검사를 그냥 통과했다. 두 호출이 같은
      밀리초 안에 있었기 때문이다.) */
  const realNow = Date.now;
  let n = 0;
  try {
    for (const day of ['2026-09-07', '2026-01-01', '2026-12-31']) {
      for (const p of [3, 4]) {
        Date.now = () => 1757000000000;
        const a = JSON.stringify(f.plan(f.seedOf(day, p), p).rounds);
        Date.now = () => 1757000000000 + 86400000 * 211;   /* 211일 뒤 */
        const b = JSON.stringify(f.plan(f.seedOf(day, p), p).rounds);
        n++;
        if (a !== b) return { ok: false, note: day + '/' + p + ' — 시계를 옮기니 판이 갈렸다' };
      }
    }
  } finally { Date.now = realNow; }
  return { ok: true, note: '3일 x 2인원 = ' + n + '쌍 · 시계를 211일 옮겨도 같다' };
});

/* ── ②-b ★다른 날짜면 다른 판 (ⓐ 의 거울상) ────────────────────────────
   ⓐ(같은 날 같은 판)만 세우면 ★날짜를 무시하는 seedOf 가 통과한다 — 모든 날이 같은 판이어도
   '같은 날에 같다' 는 참이기 때문이다. 그래서 반대 방향을 함께 단언한다.
   ★씨앗 층은 결정론으로 못박고(전부 달라야 한다), 판 층은 ★세어서 찍는다 —
   서로 다른 씨앗이 같은 수열을 낼 확률은 0 이 아니므로 '전부 다르다' 로 박으면 언젠가 흔들린다. */
check('different-day-different-plan', () => {
  const f = W0.win.__four;
  const days = [];
  for (let d = 0; d < 120; d++) {
    const dt = new Date(Date.UTC(2026, 0, 1) + d * 86400000);
    days.push(dt.toISOString().slice(0, 10));
  }
  for (const p of [3, 4]) {
    const seeds = days.map(d => f.seedOf(d, p));
    const uniqSeeds = new Set(seeds);
    if (uniqSeeds.size !== days.length) {
      return { ok: false, note: p + '인 · 120일의 씨앗 중 서로 같은 것이 있다(고유 '
        + uniqSeeds.size + ') — 날짜가 판을 가르지 않는다' };
    }
  }
  const plans3 = days.map(d => JSON.stringify(f.plan(f.seedOf(d, 3), 3).rounds));
  const uniq3 = new Set(plans3).size;
  const plans4 = days.map(d => JSON.stringify(f.plan(f.seedOf(d, 4), 4).rounds));
  const uniq4 = new Set(plans4).size;
  /* 판 층은 ★비율로 본다 — 우연한 충돌 몇 건은 결함이 아니지만, 무더기로 같아지면 결함이다. */
  const ok = uniq3 >= days.length * 0.9 && uniq4 >= days.length * 0.9;
  return { ok, note: '120일 · 씨앗은 3인·4인 모두 ★전부 다름 · 수열 고유 3인 '
    + uniq3 + '/120 · 4인 ' + uniq4 + '/120' };
});

/* ── ③ 인원이 수열을 가른다 ──────────────────────────────────────────────
   ★한 날짜만 보면 우연히 같을 수 있다 — 여러 날짜로 재고 '전부 다르다' 를 요구한다. */
check('player-count-splits-the-plan', () => {
  const f = W0.win.__four;
  let same = 0, n = 0;
  for (let d = 1; d <= 60; d++) {
    const day = '2026-' + (d <= 30 ? '03' : '04') + '-' + String((d - 1) % 30 + 1).padStart(2, '0');
    const a = JSON.stringify(f.plan(f.seedOf(day, 3), 3).rounds);
    const b = JSON.stringify(f.plan(f.seedOf(day, 4), 4).rounds);
    n++; if (a === b) same++;
  }
  return { ok: same === 0, note: '잰 날짜 ' + n + ' · 3인=4인인 날 ' + same };
});

/* ── ④ 인원 변경은 새 판이다 ────────────────────────────────────────────── */
check('player-change-restarts-the-plan', () => {
  const W = makeWorld();
  W.els.btnStart.fire('click');
  const s1 = W.win.__four.snapshot();
  if (s1.phase !== 'wait') return { ok: false, note: '판이 시작되지 않았다: ' + s1.phase };
  /* 판 도중에 인원을 바꾼다 */
  W.els.whoPick.fire('click', { target: { tagName: 'BUTTON', getAttribute: () => '4' } });
  const s2 = W.win.__four.snapshot();
  const dropped = (s2.phase === 'idle' && s2.rounds === null);
  return { ok: dropped, note: dropped ? '그 판을 버리고 시작 화면으로 돌아갔다' : '판이 이어졌다: ' + s2.phase };
});

/* ── ⑤ 대기 하한은 생성 규칙이다 ────────────────────────────────────────
   사후 필터는 ★하한값에 봉우리를 만든다(잘린 것이 전부 그 값으로 몰린다).
   생성 규칙이면 하한값의 빈도는 다른 값과 ★같다(1/(SPAN+1)). 그 차이로 가른다. */
check('wait-floor-is-generative', () => {
  const f = W0.win.__four;
  let atFloor = 0, total = 0, below = 0;
  for (let s = 0; s < SEEDS; s++) {
    const p = f.plan(s, 3);
    for (const r of p.rounds) {
      total++;
      if (r.waitMs < C.WAIT_MIN_MS) below++;
      if (r.waitMs === C.WAIT_MIN_MS) atFloor++;
    }
  }
  if (below > 0) return { ok: false, note: '하한 미만 ' + below + '건' };
  const expect = total / (C.WAIT_SPAN_MS + 1);
  const ratio = atFloor / (expect || 1);
  /* 사후 필터면 하한 빈도가 기대의 수십 배가 된다. 3배를 넘으면 봉우리로 본다. */
  return { ok: ratio < 3, note: '하한값 빈도 ' + atFloor + ' · 기대 ' + expect.toFixed(1) + ' · 배율 ' + ratio.toFixed(2) };
});

/* ── ⑥ ✕ 횟수 하한·상한 (★내가 다시 센다) ──────────────────────────────── */
check('mute-count-in-range', () => {
  const f = W0.win.__four;
  let bad = 0, dist = {};
  for (const players of [3, 4]) {
    for (let s = 0; s < SEEDS; s++) {
      let m = 0;
      for (const r of f.plan(s, players).rounds) if (r.mark === C.MUTE) m++;
      dist[m] = (dist[m] || 0) + 1;
      if (m < C.MUTE_MIN || m > C.MUTE_MAX) bad++;
    }
  }
  return { ok: bad === 0, note: '분포 ' + JSON.stringify(dist) + ' · 범위 밖 ' + bad };
});

/* ── ⑦ ✕ 하한을 ★뽑는 자리에서 걸었는가(재추첨이 아닌가) ────────────────
   재추첨이면 ★seed 가 만든 수열이 버려지고 다른 seed 의 수열이 나온다.
   그래서 '이 seed 의 첫 라운드' 가 rnd 첫 값으로 설명되지 않는다 — 그 불일치로 가른다. */
check('mute-quota-at-draw-site', () => {
  const f = W0.win.__four;
  let mismatch = 0, n = 0;
  for (let s = 0; s < 400; s++) {
    const rnd = f.makeRng(s);
    const first = rnd();               /* 하네스가 자기 것으로 첫 값을 굴린다 */
    const pool = MARKS.slice(0, 3);
    const cands = [C.MUTE].concat(pool);
    const expect = cands[Math.floor(first * cands.length)];
    const got = f.plan(s, 3).rounds[0].mark;
    n++;
    if (got !== expect) mismatch++;
  }
  return { ok: mismatch === 0, note: '첫 라운드가 첫 난수로 설명되는가 — 어긋남 ' + mismatch + '/' + n };
});

/* ── ⑧ 같은 표식 3연속 금지 (★내가 다시 센다) ──────────────────────────── */
check('no-three-in-a-row', () => {
  const f = W0.win.__four;
  let bad = 0, maxRun = 0;
  for (const players of [3, 4]) {
    for (let s = 0; s < SEEDS; s++) {
      const rs = f.plan(s, players).rounds;
      let run = 1;
      for (let i = 1; i < rs.length; i++) {
        if (rs[i].mark !== C.MUTE && rs[i].mark === rs[i - 1].mark) run++; else run = 1;
        if (run > maxRun) maxRun = run;
        if (run > C.RUN_CAP) bad++;
      }
    }
  }
  return { ok: bad === 0, note: '최대 연속 ' + maxRun + ' (상한 ' + C.RUN_CAP + ') · 위반 ' + bad };
});

/* ── ⑨ 3연속 금지도 ★뽑는 자리에서 걸었는가 ────────────────────────────
   재추첨이면 seed 가 바뀌므로 ★대기시간 수열까지 통째로 달라진다.
   뽑는 자리에서 걸면 대기시간은 rnd 의 짝수번째 값으로 그대로 설명된다. */
check('no-three-in-a-row-at-draw-site', () => {
  const f = W0.win.__four;
  let mismatch = 0, n = 0;
  for (let s = 0; s < 400; s++) {
    const rnd = f.makeRng(s);
    rnd();                                   /* 첫 표식 자리 */
    const w0 = C.WAIT_MIN_MS + Math.floor(rnd() * (C.WAIT_SPAN_MS + 1));
    const got = f.plan(s, 3).rounds[0].waitMs;
    n++;
    if (got !== w0) mismatch++;
  }
  return { ok: mismatch === 0, note: '첫 대기시간이 둘째 난수로 설명되는가 — 어긋남 ' + mismatch + '/' + n };
});

/* ── ⑩ 판정은 칸별 독립이다 ─────────────────────────────────────────────
   ★같은 라운드에서 두 칸이 누른다. 순서를 뒤집어도 두 칸의 점수가 같아야 한다. */
check('scoring-is-per-lane-independent', () => {
  function run(order) {
    const W = makeWorld();
    W.els.btnStart.fire('click');
    W.timers.shift().fn();                    /* 대기 만료 → 신호 */
    for (const i of order) W.els['lane' + i].fire('click');
    return W.win.__four.snapshot().scores.slice();
  }
  const a = run([0, 1]);
  const b = run([1, 0]);
  const same = JSON.stringify(a) === JSON.stringify(b);
  const bothScored = a[0] !== 0 || a[1] !== 0;
  if (!bothScored) return { ok: false, note: '두 칸 모두 0점이라 판정이 공허하다' };
  return { ok: same, note: '순서 [0,1] ' + JSON.stringify(a) + ' · [1,0] ' + JSON.stringify(b) };
});

/* ── ⑪ 부정출발은 그 칸만 잠근다 ────────────────────────────────────────── */
check('false-start-locks-only-that-lane', () => {
  const W = makeWorld();
  W.els.btnStart.fire('click');
  W.els.lane0.fire('click');                  /* 대기 중 누름 = 부정출발 */
  const s1 = W.win.__four.snapshot();
  if (s1.scores[0] !== -1) return { ok: false, note: '부정출발 점수가 -1 이 아니다: ' + s1.scores[0] };
  if (s1.locked[0] !== true) return { ok: false, note: '부정출발 칸이 안 잠겼다' };
  const others = s1.locked.slice(1).some(v => v === true);
  if (others) return { ok: false, note: '다른 칸까지 잠겼다 — 칸별 독립이 깨졌다' };
  /* 그리고 다른 칸은 이 라운드에서 ★여전히 점수를 낼 수 있어야 한다 */
  W.timers.shift().fn();
  const sig = W.win.__four.snapshot().rounds[0].mark;
  const owner = MARKS.indexOf(sig);
  if (sig !== C.MUTE && owner >= 1 && owner < s1.players) {
    W.els['lane' + owner].fire('click');
    const s2 = W.win.__four.snapshot();
    if (s2.scores[owner] !== 1) return { ok: false, note: '다른 칸이 점수를 못 냈다' };
    return { ok: true, note: '부정출발 칸만 잠기고 ' + owner + '번 칸은 +1 을 냈다' };
  }
  return { ok: true, note: '부정출발 칸만 잠겼다(이 seed 의 첫 신호는 ' + sig + ')' };
});

/* ── ⑫ 누름의 대상은 자기 칸이다 ────────────────────────────────────────
   ★가운데는 누르는 자리가 아니다: 버튼 역할도 처리기도 없어야 한다. */
check('press-target-is-own-lane', () => {
  const laneRole = /<div class="lane" id="lane0" role="button"/.test(RAW);
  const centerHasRole = /<div class="center" id="center"[^>]*role="button"/.test(RAW);
  const centerNoPointer = /\.center\{[^}]*pointer-events:none/.test(RAW);
  const W = makeWorld();
  const centerListeners = Object.keys(W.els.center.listeners).length;
  const ok = laneRole && !centerHasRole && centerNoPointer && centerListeners === 0;
  return { ok, note: '칸 role=button ' + laneRole + ' · 가운데 role ' + centerHasRole
    + ' · pointer-events:none ' + centerNoPointer + ' · 가운데 처리기 ' + centerListeners };
});

/* ── ⑬ 진행 중 바뀌는 자리에 data-i18n 이 없다 ─────────────────────────── */
check('no-i18n-on-live-nodes', () => {
  const live = ['roundNo', 'phaseWord', 'centerGlyph', 'centerWord', 'rankBody'];
  const bad = [];
  for (const id of live) {
    const re = new RegExp('id="' + id + '"[^>]*data-i18n=');
    const re2 = new RegExp('data-i18n="[^"]*"[^>]*id="' + id + '"');
    if (re.test(RAW) || re2.test(RAW)) bad.push(id);
  }
  return { ok: bad.length === 0, note: bad.length ? '붙은 곳: ' + bad.join(',') : '잰 자리 ' + live.length + '개 · 0건' };
});

/* ── ⑭ 색만으로 알리지 않는다 ───────────────────────────────────────────
   신호가 뜬 순간 ★글자가 함께 있어야 한다(모양은 글리프로 이미 갈린다). */
check('accessibility-not-color-alone', () => {
  const W = makeWorld();
  W.els.btnStart.fire('click');
  W.timers.shift().fn();
  const glyph = W.els.centerGlyph.textContent;
  const word = W.els.centerWord.textContent;
  const kind = W.els.center.getAttribute('data-kind');
  if (!glyph) return { ok: false, note: '모양이 비었다' };
  if (!word) return { ok: false, note: '글자가 비었다 — 색·모양만 남았다' };
  return { ok: true, note: '모양 "' + glyph + '" + 글자 "' + word + '" (kind=' + kind + ')' };
});

/* ── ⑮ aria 가 언어를 따라간다 ─────────────────────────────────────────── */
check('aria-follows-language', () => {
  const W = makeWorld();
  const ko = W.els.lane0.getAttribute('aria-label');
  W.els.btnLang.fire('click');                 /* ko → en */
  const en = W.els.lane0.getAttribute('aria-label');
  if (!ko || !en) return { ok: false, note: 'aria-label 이 비었다' };
  if (ko === en) return { ok: false, note: '언어를 바꿔도 같다: ' + ko };
  const koHasHangul = /[가-힣]/.test(ko);
  const enHasHangul = /[가-힣]/.test(en);
  return { ok: koHasHangul && !enHasHangul, note: 'ko="' + ko + '" en="' + en + '"' };
});

/* ── ⑯ 마크업에 한국어 aria-label 을 박지 않았다 ───────────────────────── */
check('no-hardcoded-korean-aria', () => {
  const hits = [];
  const re = /aria-label="([^"]*)"/g;
  let m;
  while ((m = re.exec(RAW))) if (/[가-힣]/.test(m[1])) hits.push(m[1]);
  return { ok: hits.length === 0, note: hits.length ? '박힌 한국어 aria: ' + hits.join(' | ') : '0건(전부 data-i18n-aria 를 거친다)' };
});

/* ── ⑰ 판 짜기는 시계를 읽지 않는다 ─────────────────────────────────────
   ★시계를 크게 벌려 두 번 부른다 — 같은 순간에 두 번 물으면 시각 독립을 증명하지 못한다. */
check('plan-is-pure', () => {
  const f = W0.win.__four;
  const a = JSON.stringify(f.plan(12345, 3).rounds);
  const realNow = Date.now;
  let b;
  try {
    Date.now = () => realNow() + 86400000 * 137;   /* 137일 뒤로 옮긴다 */
    b = JSON.stringify(f.plan(12345, 3).rounds);
  } finally { Date.now = realNow; }
  return { ok: a === b, note: a === b ? '시계를 137일 옮겨도 같다' : '시계에 따라 판이 갈린다' };
});

/* ── ⑱ --sig 바탕 위에 잉크를 얹지 않는다 ──────────────────────────────── */
check('ink-never-on-sig', () => {
  const bad = [];
  const re = /\{[^{}]*background:var\(--sig\)[^{}]*\}/g;
  let m;
  while ((m = re.exec(RAW))) if (/color:var\(--sig-ink\)/.test(m[0])) bad.push(m[0].slice(0, 70));
  return { ok: bad.length === 0, note: bad.length ? bad.join(' | ') : '주색 바탕 규칙에서 잉크 사용 0건' };
});

/* ── ⑲ 관측 창구는 읽기 전용이다 ───────────────────────────────────────── */
check('observation-window-is-read-only', () => {
  const W = makeWorld();
  const keys = Object.keys(W.win.__four);
  const writers = keys.filter(k => /^(set|apply|inject|force|put|write|load)/i.test(k));
  if (writers.length) return { ok: false, note: '쓰기 입구: ' + writers.join(',') };
  /* 스냅샷이 ★사본인가 — 받은 배열을 고쳐도 안쪽 상태가 안 바뀌어야 한다 */
  W.els.btnStart.fire('click');
  const snap = W.win.__four.snapshot();
  snap.scores[0] = 999;
  if (snap.rounds) snap.rounds[0].mark = 'tampered';
  const again = W.win.__four.snapshot();
  const leaked = again.scores[0] === 999 || (again.rounds && again.rounds[0].mark === 'tampered');
  return { ok: !leaked, note: leaked ? '스냅샷을 고치면 안쪽이 바뀐다' : '창구 ' + keys.length + '개 · 쓰기 입구 0 · 스냅샷은 사본' };
});

/* ── 보조: 인원 버튼 구성(잠근 항이 아니다 — 정본 auxiliary 에 선언돼 있다) ── */
check('player-count-range', () => {
  /* ★기대는 제품 상수가 아니라 ★정본에서 읽는다 — 제품에서 가져오면 제품이 범위를 줄일 때
     기대도 함께 줄어 이 검사는 영원히 통과한다(자기참조 · 2026-09-07 실측). */
  if (!CANON || !CANON.declared || !CANON.declared.player_range) {
    return { ok: false, note: '정본에 declared.player_range 가 없다 — 판정을 세울 수 없다' };
  }
  const want = CANON.declared.player_range;
  const W = makeWorld();
  const btns = W.els.whoPick.kids.map(b => b.getAttribute('data-n'));
  const expect = [];
  for (let n = want.min; n <= want.max; n++) expect.push(String(n));
  const okBtn = JSON.stringify(btns) === JSON.stringify(expect);
  const okConst = C.PLAYERS_MIN === want.min && C.PLAYERS_MAX === want.max
    && C.PLAYERS_DEFAULT === want.default;
  return { ok: okBtn && okConst,
    note: '버튼 ' + JSON.stringify(btns) + ' · 정본 기대 ' + JSON.stringify(expect)
      + ' · 상수(' + C.PLAYERS_MIN + '..' + C.PLAYERS_MAX + ' 기본 ' + C.PLAYERS_DEFAULT + ') 일치 ' + okConst };
});

/* ── 보조: 라운드가 실제로 굴렀는가(하네스 자기시험) ───────────────────── */
check('a-round-actually-runs', () => {
  const W = makeWorld();
  W.els.btnStart.fire('click');
  let steps = 0, guard = 0;
  while (W.timers.length && guard++ < 60) { W.timers.shift().fn(); steps++; }
  const s = W.win.__four.snapshot();
  return { ok: s.phase === 'over' && s.round === C.ROUNDS,
    note: '타이머 ' + steps + '회 · 끝 국면 ' + s.phase + ' · 치른 라운드 ' + s.round };
});

/* ------------------------------------------------------------ 판정 */
if (ONLY && ran === 0) {
  console.error('rc=2 — 지목한 검사가 없다(앵커 노후화): ' + ONLY);
  process.exit(2);
}
console.log('');
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log('  [' + (r.ok ? 'PASS' : 'FAIL') + '] ' + r.name + (r.note ? ' — ' + r.note : ''));
}
if (CANON) {
  const borne = new Set();
  CANON.items.forEach(it => it.bearing_checks.forEach(c => borne.add(c)));
  CANON.auxiliary.forEach(a => borne.add(a.name));
  const mine = new Set(results.map(r => r.name));
  const onlyCanon = [...borne].filter(x => !mine.has(x) && !ONLY);
  const onlyMine = [...mine].filter(x => !borne.has(x));
  if (onlyCanon.length || onlyMine.length) {
    console.log('  ※ 정본 대조: 정본에만 ' + JSON.stringify(onlyCanon) + ' · 검사기에만 ' + JSON.stringify(onlyMine));
  } else if (!ONLY) {
    console.log('  ※ 정본 대조: 양방향 차집합 0 (항이 짊어진 검사 ' + borne.size + '개 전부 여기 있다)');
  }
} else {
  console.log('  ※ 정본(tools/four_locked_contracts.json)을 읽지 못했다 — 대조를 세우지 못했다');
}
console.log('');
console.log('==== verify_four: 잰 것 ' + results.length + ' · PASS ' + (results.length - fail)
  + ' · FAIL ' + fail + ' ====');

if (MUTATION) {
  const target = MUTATIONS[MUTATION].target;
  if (!target) {
    if (fail > 0) { console.error('★음성 대조군인데 붉었다 — 검사가 무관한 변화에 반응한다'); process.exit(1); }
    process.exit(0);
  }
  const hit = results.find(r => r.name === target);
  if (!hit) { console.error('rc=2 — 지목한 검사가 돌지 않았다: ' + target); process.exit(2); }
  if (hit.ok) { console.error('rc=3 — 주입은 됐는데 ★' + target + ' 이 잡지 못했다(검사가 공허하다)'); process.exit(3); }
  console.log('★지목한 검사가 잡았다: ' + target);
  process.exit(0);
}
process.exit(fail ? 1 : 0);
