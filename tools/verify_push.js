#!/usr/bin/env node
/* verify_push.js — 「밀어서 정리」 검증.
 *
 * `push/index.html` 의 인라인 스크립트를 ★그대로 꺼내 최소 DOM 스텁 위에서 돌린다.
 * 배포본의 `window.__psh` 는 ★읽기 전용 창구다 — 이 검사기는 판을 바꾸는 입구를 쓰지 않는다.
 * (쓸 수 있다면 그것 자체가 제품의 결함이고, 그 결함을 재는 검사가 아래에 있다.)
 *
 * 이 게임이 잠근 약속은 tools/push_locked_contracts.json 에 ★밖에 있다 — 검사기 안에 두면
 * 검사기가 자기를 채점하고, 항을 지우는 것과 검사를 지우는 것이 한 손에서 일어난다.
 *
 * 사용법:
 *   node tools/verify_push.js
 *   node tools/verify_push.js --html push/index.html
 *   node tools/verify_push.js --list-mutations
 *   node tools/verify_push.js --mutate m-pull-allowed
 *
 * 종료코드: 0 = 전부 통과 · 1 = 미달 · 2 = 검사를 세울 수 없음(판정 불가)
 *           3 = (--mutate 일 때만) 주입은 됐는데 ★지목한 검사가 못 잡았다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = n => argv.indexOf(n) >= 0;

const ROOT = path.join(__dirname, '..');
const HTML = argOf('--html', path.join(ROOT, 'push', 'index.html'));
const GEN_FILE = path.join(ROOT, 'tools', 'push_gen.mjs');
const MUTATION = argOf('--mutate', null);
const TAB = String.fromCharCode(9);

/* ─────────────────────────────────────────── 뮤테이션 표
   ★각 뮤테이션은 '어느 검사가 잡아야 하는가' 를 이름으로 지목한다. */
const MUTATIONS = {
  'm-pull-allowed': {
    why: '★당기기를 허용한다 — 상자가 플레이어를 따라오게 만든다(게임의 정체가 바뀐다)',
    target: 'box-moves-only-when-pushed',
    apply: s => s.replace(
      '  } else {\n    s.hist.push({ player: s.player, boxes: s.boxes.slice(), pushes: s.pushes, steps: s.steps });\n    s.player = dest; s.steps++;\n  }',
      '  } else {\n    s.hist.push({ player: s.player, boxes: s.boxes.slice(), pushes: s.pushes, steps: s.steps });\n' +
      '    const behind = s.boxes.indexOf(s.player - d);\n    if (behind >= 0) s.boxes[behind] = s.player;\n' +
      '    s.player = dest; s.steps++;\n  }'),
  },
  'm-push-through-wall': {
    why: '벽 너머로 밀 수 있게 한다 — 상자가 벽을 뚫는다(★상자 반쪽만 겨냥한다)',
    target: 'walls-stop-boxes',
    apply: s => s.replace(
      '    if (s.wall[beyond] || s.boxes.includes(beyond)) return false;',
      '    if (s.boxes.includes(beyond)) return false;'),
  },
  'm-player-walks-through-wall': {
    why: '사람이 벽을 통과하게 한다 — ★사람 반쪽만 겨냥한다(상자 반쪽은 조용해야 한다)',
    target: 'walls-stop-the-player',
    apply: s => s.replace(
      '  if (s.wall[dest]) return false;',
      '  if (s.wall[dest] && s.boxes.indexOf(dest) >= 0) return false;'),
  },
  'm-play-consumes-randomness': {
    why: '플레이 중 난수를 소비하게 한다 — 행동이 판을 바꾼다(bomb 에서 잠근 것과 같은 계약)',
    target: 'play-consumes-no-randomness',
    apply: s => s.replace(
      '  if (solvedNow(s)) s.solved = true;',
      '  if (Math.random() < 2) s.minPushes += 0.0001;\n  if (solvedNow(s)) s.solved = true;'),
  },
  'm-plan-reads-clock': {
    why: '판 짜기가 시계를 읽게 한다 — 느린 기기에서만 결과가 갈리는 시간 기반 분기',
    target: 'plan-does-not-read-clock',
    apply: s => s.replace(
      'export function generate(seed, cfg = CFG) {'.replace('export ', ''),
      'function generate(seed, cfg = CFG) {\n  seed = (seed + (Date.now() % 2)) >>> 0;'),
  },
  'm-undo-does-not-restore': {
    why: '되돌리기가 밀기 수만 줄이고 상자는 그대로 둔다 — 되돌린 척한다',
    target: 'undo-restores-the-previous-state',
    apply: s => s.replace(
      '  s.player = h.player; s.boxes = h.boxes; s.pushes = h.pushes; s.steps = h.steps;',
      '  s.player = h.player; s.pushes = h.pushes; s.steps = h.steps;'),
  },
  'm-goal-color-only': {
    why: '목표 칸에서 ★모양과 글자를 빼고 색만 남긴다 — 색각 이상·흑백에서 자리를 못 본다',
    target: 'not-color-alone',
    apply: s => s.replace(
      '  .cell.goal{outline:2px dashed var(--goal-line);outline-offset:-4px}\n  .cell.goal::after{content:"·";color:var(--goal-line);font-weight:700}',
      '  .cell.goal{background:var(--sig-soft)}'),
  },
  'm-done-box-same-glyph': {
    why: '자리에 놓인 상자와 안 놓인 상자를 ★같은 글자로 만든다 — 색만 남는다',
    target: 'not-color-alone',
    apply: s => s.replace(
      "g.textContent = box.has(i) ? (goal.has(i) ? '✓' : '📦') : (i === s.player ? '🙂' : '');",
      "g.textContent = box.has(i) ? '📦' : (i === s.player ? '🙂' : '');"),
  },
  'm-motion-outside-media': {
    why: '움직임을 ★prefers-reduced-motion 블록 밖으로 꺼낸다 — 줄여 달라는 요청을 무시한다',
    target: 'respects-reduced-motion',
    apply: s => s.replace(
      '  @media (prefers-reduced-motion: reduce){\n    .cell{transition:none}\n  }',
      '  .cell{transition:background .12s ease}'),
  },
  'm-window-writable': {
    why: '관측 창구에 판을 바꾸는 입구를 낸다 — 배포본에 조작 API 가 남는다',
    target: 'observation-window-is-read-only',
    apply: s => s.replace(
      '  lang: () => lang,\n};',
      '  lang: () => lang,\n  setPushes: n => { state.pushes = n; },\n};'),
  },
  'm-embedded-copy-drifts': {
    why: '제품에 박힌 생성기 사본만 살짝 고친다 — 정의처와 갈라진다',
    target: 'product-copy-equals-tool-source',
    apply: s => s.replace('  MIN_PUSHES: 10,', '  MIN_PUSHES: 11,'),
  },
  'm-date-is-ignored': {
    why: '날짜를 무시하고 늘 같은 씨앗을 쓴다 — 어제와 오늘이 같은 판이 된다',
    target: 'same-date-same-board',
    apply: s => s.replace(
      "  const src = dateStr + '#' + attempt;",
      "  const src = 'fixed#' + attempt;"),
  },
  'm-no-board-on-hard-days': {
    why: '재시도가 다 실패하면 ★예비 판 대신 빈 판을 준다 — 판이 없는 날이 생긴다',
    target: 'daily-board-exists-for-any-date',
    apply: s => s.replace(
      '  const fb = parseBoard(FALLBACK_ROWS, cfg);',
      '  const fb = { wall: new Uint8Array(cfg.W * cfg.H), goals: [], boxes: [], player: 0, nBoxes: 0 };'),
  },
  'm-min-pushes-lie': {
    why: '최소 수를 한 번 더 크게 말한다 — 자랑하는 수치가 거짓이 된다',
    target: 'min-pushes-matches-independent-solver',
    apply: s => s.replace(
      '    minPushes: b.minPushes, usedFallback: !!b.usedFallback, attempts: b.attempts,',
      '    minPushes: b.minPushes + 1, usedFallback: !!b.usedFallback, attempts: b.attempts,'),
  },
  'm-clock-leaks-into-play': {
    why: '판을 읽는 자리에서 시계를 읽는다 — 허용된 한 자리 밖으로 시계가 샌다',
    target: 'clock-is-read-in-one-place',
    apply: s => s.replace(
      '  const b = dailyBoard(key);',
      '  const b = dailyBoard(key); const _t = Date.now();'),
  },
  'm-rename-local-var': {
    why: '★조용해야 하는 대조군 — 그리기 함수의 지역 변수 이름만 바꾼다(행동은 한 톨도 안 바뀐다)',
    expect: 'quiet',
    apply: s => s.replace(/\bconst goal = new Set\(s\.goals\), box = new Set\(s\.boxes\);/,
      'const goalSet0 = new Set(s.goals), box = new Set(s.boxes); const goal = goalSet0;'),
  },
};

/* ─────────────────────────────────────────── ★기대표는 정본에서 읽는다
   '어느 뮤테이션을 어느 검사가 잡아야 하는가' 는 ★계약이지 코드가 아니다. 검사기 안에 두면
   그 항의 ★검출 증명만 지워도 정본에 흔적이 남지 않는다(2026-09-07 reviewer-claude-1 적발).
   ⇒ 여기서는 ★주입 함수만 갖고, target·expect 는 tools/push_mutation_expectations.json 이 정한다.
   ★못 읽으면 rc=2 로 멈춘다 — 통과로 세지 않는다. ★양방향 대조도 여기서 한다. */
const EXPECT_FILE = path.join(ROOT, 'tools', 'push_mutation_expectations.json');
let EXPECT;
try { EXPECT = JSON.parse(fs.readFileSync(EXPECT_FILE, 'utf8')); }
catch (e) { console.error('판정 불가 — 기대표 정본을 못 읽었다(' + EXPECT_FILE + '): ' + e.message); process.exit(2); }
if (!EXPECT.mutations || typeof EXPECT.mutations !== 'object') {
  console.error('판정 불가 — 기대표 정본에 mutations 가 없다'); process.exit(2);
}
{
  const inCode = Object.keys(MUTATIONS).sort();
  const inCanon = Object.keys(EXPECT.mutations).sort();
  const onlyCode = inCode.filter(k => !inCanon.includes(k));
  const onlyCanon = inCanon.filter(k => !inCode.includes(k));
  if (onlyCode.length || onlyCanon.length) {
    console.error('판정 불가 — 기대표와 검사기가 갈렸다(★양방향 차집합): ' +
      '검사기에만 ' + JSON.stringify(onlyCode) + ' · 정본에만 ' + JSON.stringify(onlyCanon));
    process.exit(2);
  }
  for (const k of inCode) {
    const e = EXPECT.mutations[k];
    if (e.expect === 'quiet') { MUTATIONS[k].expect = 'quiet'; delete MUTATIONS[k].target; }
    else if (e.expect === 'caught-by' && e.target) { MUTATIONS[k].target = e.target; delete MUTATIONS[k].expect; }
    else { console.error('판정 불가 — 기대표 항목이 모양을 안 지킨다: ' + k + ' ' + JSON.stringify(e)); process.exit(2); }
    if (e.why) MUTATIONS[k].why = e.why;
  }
}

if (has('--list-mutations')) {
  Object.keys(MUTATIONS).forEach(k => console.log(
    [k, MUTATIONS[k].target || '(quiet-control)', MUTATIONS[k].why].join(TAB)));
  process.exit(0);
}

let RAW;
try { RAW = fs.readFileSync(HTML, 'utf8'); }
catch (e) { console.error('대상 파일을 읽지 못했다: ' + HTML); process.exit(2); }
RAW = RAW.split('\r\n').join('\n');   /* 앵커는 LF 로 적혀 있다 — 줄끝은 판정 대상이 아니다 */

if (MUTATION) {
  const m = MUTATIONS[MUTATION];
  if (!m) { console.error('모르는 뮤테이션: ' + MUTATION); process.exit(2); }
  const before = RAW;
  RAW = m.apply(RAW);
  if (RAW === before) { console.error('주입 실패(앵커가 안 맞는다): ' + MUTATION); process.exit(2); }
  console.log('※ 뮤테이션 주입: ' + MUTATION + ' — ' + m.why);
  console.log('※ 지목한 검사: ' + (m.target || '(quiet-control · 아무 검사도 붉으면 안 된다)'));
}

/* ─────────────────────────────────────────── 게임 스크립트 꺼내기 */
function gameSource(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (!/\bsrc=/.test(m[1]) && !/application\/ld\+json/.test(m[1])) out.push(m[2]);
  }
  return out.find(s => s.indexOf('window.__psh = {') >= 0) || null;
}
const SRC = gameSource(RAW);
if (!SRC) { console.error('게임 스크립트(window.__psh = { 을 여는 인라인 <script>)를 찾지 못했다'); process.exit(2); }
const GEN_REGION = (RAW.match(/\/\* GEN-BEGIN \*\/([\s\S]*?)\/\* GEN-END \*\//) || [, ''])[1];
const PLAY_SRC = SRC.replace(GEN_REGION, '');    /* 생성기 밖 = 플레이 코드 */
const CSS = (RAW.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];

/* ─────────────────────────────────────────── 최소 DOM 스텁 */
function mkEl(id) {
  const el = {
    id, tagName: 'DIV', className: '', textContent: '', innerHTML: '',
    attrs: {}, kids: [], listeners: {}, style: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.kids.push(c); c.parentNode = this; return c; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    fire(t, ev) { (this.listeners[t] || []).forEach(f => f(ev || { target: this, preventDefault(){} })); },
    querySelectorAll() { return this.kids; },
  };
  Object.defineProperty(el, 'firstChild', { get() { return this.kids[0] || null; } });
  Object.defineProperty(el, 'childElementCount', { get() { return this.kids.length; } });
  return el;
}
function makeWorld() {
  const els = {};
  const get = id => (els[id] || (els[id] = mkEl(id)));
  ['dayNo', 'minPush', 'myPush', 'undoCnt', 'board', 'up', 'down', 'left', 'right',
    'btnUndo', 'btnReset', 'btnAgain', 'btnLang', 'btnShare', 'srLive', 'over',
    'rMin', 'rMine', 'rSteps', 'rUndo', 'verdict', 'hint'].forEach(get);
  els.over.classList = { add(){}, remove(){}, contains(){ return false; } };
  const doc = {
    readyState: 'complete', documentElement: { lang: 'ko' },
    getElementById: id => {
      if (els[id]) return els[id];
      /* 제품이 만든 칸(c0…)은 판 아래에 붙는다 — 스텁도 그 자리를 뒤진다 */
      const hit = els.board.kids.find(c => c.id === id);
      return hit || null;
    },
    createElement: t => { const e = mkEl(''); e.tagName = String(t).toUpperCase(); return e; },
    querySelectorAll: sel => {
      if (sel === '#board .glyph') return els.board.kids.map(c => c.kids[0]).filter(Boolean);
      return [];               /* [data-i18n] 은 스텁에 두지 않는다 — 문안은 여기서 재지 않는다 */
    },
    addEventListener: () => {},
  };
  const store = {};
  const win = {
    document: doc, navigator: { language: 'ko-KR' },
    /* 제품이 언어를 저장한다(bp.lang) — 하네스도 그 자리를 준다. ★값을 미리 심지 않는다 */
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
    addEventListener: () => {}, Math, Date, console, JSON,
  };
  win.window = win;
  vm.createContext(win);
  try { vm.runInContext(SRC, win, { filename: 'push-inline.js' }); }
  catch (e) { console.error('스크립트 실행 실패: ' + e.message); process.exit(2); }
  if (!win.__psh) { console.error('관측 창구(window.__psh)가 없다'); process.exit(2); }
  return { win, els, doc };
}

/* ─────────────────────────────────────────── 하네스가 ★밀러 가는 길을 계산한다
   제품에 '밀어 줘' 같은 훅을 뚫지 않는다 — 창구가 주는 벽·상자·사람 위치만 보고
   검사기가 ★스스로 길을 짠 뒤 ★사람이 누르는 것과 같은 방식(버튼 click)으로 움직인다. */
function planPushes(psh, want) {
  const CFG = psh.consts(), W = CFG.W;
  const wall = psh.wall();
  const nameOf = d => (d === -W ? 'up' : d === W ? 'down' : d === -1 ? 'left' : 'right');
  const out = [];
  let s = psh.snapshot();
  const boxes = s.boxes.slice(), goals = s.goals.slice();
  let player = s.player;
  const sim = { boxes, player };
  for (let round = 0; round < want; round++) {
    let done = false;
    for (const b of sim.boxes) {
      for (const d of [-W, W, -1, 1]) {
        const stand = b - d, dest = b + d;
        if (wall[stand] || wall[dest]) continue;
        if (sim.boxes.includes(stand) || sim.boxes.includes(dest)) continue;
        const path = walk(wall, sim.boxes, sim.player, stand, W);
        if (!path) continue;
        for (const step of path) out.push(nameOf(step));
        out.push(nameOf(d));
        sim.boxes[sim.boxes.indexOf(b)] = dest;
        sim.player = b;
        done = true; break;
      }
      if (done) break;
    }
    if (!done) break;
  }
  return out;
}
function walk(wall, boxes, from, to, W) {
  if (from === to) return [];
  const block = new Set(boxes);
  const prev = new Map([[from, null]]);
  const q = [from];
  while (q.length) {
    const c = q.shift();
    for (const d of [-W, W, -1, 1]) {
      const n = c + d;
      if (wall[n] || block.has(n) || prev.has(n)) continue;
      prev.set(n, { c, d });
      if (n === to) {
        const steps = [];
        let cur = n;
        while (prev.get(cur)) { steps.unshift(prev.get(cur).d); cur = prev.get(cur).c; }
        return steps;
      }
      q.push(n);
    }
  }
  return null;
}

/* ─────────────────────────────────────────── 채점판 */
const results = [];
const ran = new Set();
function check(name, fn) {
  ran.add(name);
  let ok = false, indeterminate = false, detail = '';
  try {
    const r = fn();
    ok = !!(r && r.ok); indeterminate = !!(r && r.indeterminate); detail = (r && r.detail) || '';
  } catch (e) { ok = false; detail = '예외: ' + e.message; }
  results.push({ name, ok, indeterminate, detail });
}

async function main() {
  const { solveMinPushes } = await import(require('node:url').pathToFileURL(path.join(ROOT, 'tools', 'push_solver.mjs')).href);
  const W = makeWorld();
  const psh = W.win.__psh;
  const CFG = psh.consts();
  const dirOf = { up: -CFG.W, down: CFG.W, left: -1, right: 1 };

  /* ① 제품 사본이 정의처와 같은가 — 두 곳에 적힌 코드는 언젠가 갈라진다 */
  check('product-copy-equals-tool-source', () => {
    const tool = fs.readFileSync(GEN_FILE, 'utf8').split('\r\n').join('\n').replace(/^export /gm, '');
    const inPage = GEN_REGION.replace(/^\n/, '').replace(/\n$/, '');
    return { ok: inPage.trim() === tool.trim(),
      detail: '도구 ' + tool.length + '자 · 제품 사본 ' + inPage.trim().length + '자 · 같은가 ' + (inPage.trim() === tool.trim()) };
  });

  /* ② 같은 씨앗(날짜)은 같은 판 · 다른 날짜는 다른 판 */
  check('same-date-same-board', () => {
    const a = psh.boardFor('2027-03-14'), b = psh.boardFor('2027-03-14'), c = psh.boardFor('2027-03-15');
    const key = x => x.boxes.join(',') + '|' + x.goals.join(',') + '|' + x.player + '|' + x.minPushes;
    return { ok: key(a) === key(b) && key(a) !== key(c),
      detail: '같은 날짜 두 번 같음 ' + (key(a) === key(b)) + ' · 다른 날짜 다름 ' + (key(a) !== key(c)) };
  });

  /* ③ 판 짜기는 시계를 읽지 않는다 — 생성기 구역에 시계 호출이 없다 */
  check('plan-does-not-read-clock', () => {
    const bad = ['Date.now', 'new Date', 'performance.now'].filter(t => GEN_REGION.indexOf(t) >= 0);
    return { ok: bad.length === 0, detail: '생성기 구역의 시계 호출 ' + JSON.stringify(bad) };
  });

  /* ④ 플레이는 난수를 소비하지 않는다 — 플레이 코드에 난수가 없고, 눌러도 판이 안 바뀐다 */
  check('play-consumes-no-randomness', () => {
    const inSource = PLAY_SRC.indexOf('Math.random') >= 0;
    const before = psh.snapshot();
    for (const k of ['right', 'down', 'left', 'up', 'right', 'up']) W.els[k].fire('click');
    const after = psh.snapshot();
    const planSame = before.minPushes === after.minPushes && before.goals.join() === after.goals.join();
    return { ok: !inSource && planSame,
      detail: '플레이 코드의 Math.random ' + (inSource ? '있다' : '없다') +
        ' · 여섯 번 눌러도 최소 수·목표 그대로 ' + planSame };
  });

  /* ⑤ 최소 수는 ★독립 계기가 다시 푼 값과 같아야 한다(제품 주장을 제품으로 채점하지 않는다).
     ★창구가 주는 벽은 ★오늘 판의 것이라, 여기서는 오늘 판을 다시 푼다 —
     다른 날짜의 ★전수 대조는 도구 층(push_dates.mjs)이 맡는다. 못 재는 것을 잰 척하지 않는다. */
  check('min-pushes-matches-independent-solver', () => {
    const today = psh.snapshot();
    const wall = Uint8Array.from(psh.wall());
    /* ★상한은 하네스가 낮출 수 있다 — 그래야 ★판정 불가 경로를 실제로 밟아 볼 수 있다(T0913 P3).
       제품에는 훅이 없다: 상한은 ★검사기 쪽 풀이기의 인자다. */
    const cap = Number(process.env.PUSH_SOLVER_CAP || 200000);
    const fwd = solveMinPushes(wall, today.boxes, today.player, today.goals, CFG, cap);
    if (fwd === -2) {
      return { ok: false, indeterminate: true,
        detail: '★못 쟀다(판정 불가): 독립 풀이기가 상태 상한 ' + cap + ' 을 넘겼다 — ' +
          '못 쟀다는 것과 틀렸다는 것은 다르다' };
    }
    const same = fwd === today.minPushes;
    return { ok: fwd > 0 && same,
      detail: '오늘 판(' + today.key + '): 제품 ' + today.minPushes + '밀기 · ★독립 풀이기 ' + fwd +
        '밀기 · 일치 ' + same + ' (다른 날짜 전수는 push_dates.mjs 가 맡는다)' };
  });

  /* ⑥ 어떤 날짜에도 판이 있다 — 표본 날짜로 창구를 통해 확인 */
  check('daily-board-exists-for-any-date', () => {
    let bad = 0, n = 0, fallback = 0, maxTry = 0;
    for (let m = 1; m <= 12; m++) for (const d of [1, 11, 21]) {
      const key = '2027-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const b = psh.boardFor(key); n++;
      if (!b || !b.boxes.length || !(b.minPushes > 0)) bad++;
      if (b.usedFallback) fallback++;
      maxTry = Math.max(maxTry, b.attempts || 0);
    }
    /* ★예비 판 가지를 ★실제로 밟는다 — 안 밟히는 가지는 공허해서 뮤테이션이 통과한다.
       제품에 훅을 뚫지 않고, ★순수 질의 boardFor 에 상수를 주입해 재시도를 1 로 낮춘다. */
    const forced = psh.boardFor('2027-01-01', { SEED_TRIES: 1, MIN_PUSHES: 9999 });
    const fbOk = !!forced && forced.usedFallback && forced.boxes.length > 0 && forced.minPushes > 0;
    return { ok: bad === 0 && fbOk,
      detail: '표본 ' + n + '일 · 판 없는 날 ' + bad + ' · 예비 판 ' + fallback +
      ' · 관측 최대 시도 ' + maxTry + '(상한 ' + CFG.SEED_TRIES + ' · ★이 값은 표본의 운이다)' +
      ' · ★예비 판 가지 강제 진입: 판 있음 ' + fbOk +
      (forced ? '(상자 ' + forced.boxes.length + ' · 최소 ' + forced.minPushes + '밀기)' : '') };
  });

  /* ⑦ 상자는 ★밀릴 때만 움직인다(당기기 없음) */
  check('box-moves-only-when-pushed', () => {
    /* ★상자를 실제로 밀어 봐야 이 검사에 뜻이 생긴다 — 밀기 0회면 그 초록은 ★공허하다.
       마구 눌러서는 상자에 닿지 않으므로, ★하네스가 길을 계산해 밀러 간다(계산은 검사기 몫이다).
       아래 판정에서 ★밀기 0회면 통과로 세지 않는다. */
    const seq = planPushes(psh, 6);
    let moves = 0, bad = 0, pushes = 0;
    for (const k of seq) {
      const b0 = psh.snapshot();
      W.els[k].fire('click');
      const b1 = psh.snapshot();
      if (b0.player === b1.player && b0.boxes.join() === b1.boxes.join()) continue;   /* 막힌 방향 */
      moves++;
      const moved = b1.boxes.filter((x, i) => x !== b0.boxes[i]);
      if (!moved.length) continue;
      pushes++;
      /* 상자가 움직였다면 ①딱 하나여야 하고 ②플레이어가 방금 들어간 칸에서 ★같은 방향으로 한 칸 */
      const d = dirOf[k];
      const from = b1.player, to = from + d;
      const okOne = moved.length === 1 && moved[0] === to;
      if (!okOne) bad++;
    }
    return { ok: bad === 0 && pushes > 0,
      detail: '실제 이동 ' + moves + '회 · 그중 상자 이동 ' + pushes + '회(★0이면 공허라 통과로 안 센다) · ★규칙 위반 ' + bad +
        ' (상자는 플레이어가 들어간 칸에서 같은 방향 한 칸으로만 움직여야 한다)' };
  });

  /* ⑧-1 벽은 ★사람을 막는다.
     ★앞선 판에서 나는 사람 시험과 상자 시험을 ★OR 로 묶어 'measured' 하나로 판정했다 —
     그러면 상자 쪽이 0회여도 사람 쪽만으로 초록이 된다. ★OR 은 각각보다 항상 헐겁다
     (2026-09-07 reviewer-claude-1 적발 · master 확인). 그래서 ★둘로 갈랐고,
     ★각 반쪽은 자기 시도 수가 0이면 그 반쪽만 ★판정 불가(통과 아님)로 끝난다. */
  check('walls-stop-the-player', () => {
    const W2 = makeWorld(), p = W2.win.__psh;
    const wall = p.wall(), CFG2 = p.consts(), Wd = CFG2.W;
    const nameOf = d => (d === -Wd ? 'up' : d === Wd ? 'down' : d === -1 ? 'left' : 'right');
    const s0 = p.snapshot();
    let target = null, into = null;
    for (let cell = 0; cell < wall.length && !target; cell++) {
      if (wall[cell] || s0.boxes.includes(cell)) continue;
      for (const d of [-Wd, Wd, -1, 1]) {
        if (!wall[cell + d]) continue;
        const path = walk(wall, s0.boxes, s0.player, cell, Wd);
        if (!path) continue;
        target = { cell, path }; into = d; break;
      }
    }
    if (!target) {
      return { ok: false, indeterminate: true,
        detail: '★못 쟀다: 벽에 붙을 수 있는 칸으로 가는 길이 없다(이 반쪽은 통과로 세지 않는다)' };
    }
    for (const step of target.path) W2.els[nameOf(step)].fire('click');
    const a0 = p.snapshot();
    W2.els[nameOf(into)].fire('click');
    const a1 = p.snapshot();
    let bad = 0;
    if (a1.player !== a0.player) bad++;                 /* 벽으로 걸어 들어갔다 */
    if (wall[a1.player]) bad++;
    if (a1.boxes.join() !== a0.boxes.join()) bad++;     /* 벽을 밀며 상자가 움직였다 */
    return { ok: bad === 0,
      detail: '벽 앞까지 ' + target.path.length + '걸음 걸어가 벽 쪽으로 1회 눌렀다 · ★위반 ' + bad };
  });

  /* ⑧-2 벽은 ★상자를 막는다. 상자를 ★벽에 닿을 때까지 밀어 본다. */
  check('walls-stop-boxes', () => {
    const W2 = makeWorld(), p = W2.win.__psh;
    const wall = p.wall(), CFG2 = p.consts(), Wd = CFG2.W;
    const nameOf = d => (d === -Wd ? 'up' : d === Wd ? 'down' : d === -1 ? 'left' : 'right');
    const s0 = p.snapshot();
    /* 그 방향으로 계속 밀면 ★언젠가 벽에 닿는 상자를 고른다(중간에 다른 상자가 없어야 한다) */
    let plan = null;
    for (const b of s0.boxes) {
      for (const d of [-Wd, Wd, -1, 1]) {
        const stand = b - d, dest = b + d;
        if (wall[stand] || s0.boxes.includes(stand)) continue;
        /* ★첫 칸이 이미 막혔으면 고르지 않는다 — 그 상자는 '밀면 언젠가 벽에 닿는 상자'가
           아니라 ★이미 벽에 닿아 한 칸도 못 미는 상자다. 고르면 아래 밀기 루프가 0회로 끝나
           '못 쟀다'가 되는데, 판에 밀 수 있는 다른 상자가 있어도 그렇다(2026-09-08 실측:
           48일 표본 중 16일에서 그렇게 됐고 그중 14일은 다른 상자로 잴 수 있었다).
           ★가드의 형태는 발명하지 않는다 — 같은 파일 planPushes() 가 이미 쓰는 그 줄이다. */
        if (wall[dest] || s0.boxes.includes(dest)) continue;
        let cur = b + d, hitsWall = false;
        while (true) {
          if (wall[cur]) { hitsWall = true; break; }
          if (s0.boxes.includes(cur)) break;
          cur += d;
        }
        if (!hitsWall) continue;
        const path = walk(wall, s0.boxes, s0.player, stand, Wd);
        if (!path) continue;
        plan = { b, d, path }; break;
      }
      if (plan) break;
    }
    if (!plan) {
      return { ok: false, indeterminate: true,
        detail: '★못 쟀다: 밀어서 벽에 닿게 할 수 있는 상자가 이 판에 없다(이 반쪽은 통과로 세지 않는다)' };
    }
    for (const step of plan.path) W2.els[nameOf(step)].fire('click');
    let pushes = 0, bad = 0, guard = 0;
    while (guard++ < 12) {
      const b0 = p.snapshot();
      W2.els[nameOf(plan.d)].fire('click');
      const b1 = p.snapshot();
      if (b1.boxes.some(x => wall[x])) bad++;           /* 상자가 벽 안으로 */
      if (wall[b1.player]) bad++;
      if (b0.boxes.join() === b1.boxes.join()) break;   /* 상자가 멈췄다(벽에 닿았다) */
      pushes++;
    }
    if (pushes === 0) {
      return { ok: false, indeterminate: true,
        detail: '★못 쟀다: 고른 상자를 한 번도 밀지 못했다(이 반쪽은 통과로 세지 않는다)' };
    }
    return { ok: bad === 0,
      detail: '상자를 벽 쪽으로 ' + pushes + '회 밀어 멈출 때까지 갔다 · ★벽을 뚫은 횟수 ' + bad };
  });
  /* ⑨ 되돌리기는 ★직전 상태를 그대로 되돌린다 */
  check('undo-restores-the-previous-state', () => {
    /* ★상자를 민 뒤에 되돌려야 뜻이 생긴다 — 걸음만 되돌리는 것은 상자 복원을 재지 못한다.
       그래서 하네스가 ★밀기까지 간 다음 되돌린다. 밀기 뒤 되돌림 0회면 통과로 세지 않는다. */
    const W3 = makeWorld(), p = W3.win.__psh;
    let checked = 0, bad = 0, afterPush = 0;
    const seq = planPushes(p, 3);
    for (const k of seq) {
      const b0 = p.snapshot();
      W3.els[k].fire('click');
      const b1 = p.snapshot();
      if (b0.player === b1.player && b0.boxes.join() === b1.boxes.join()) continue;
      const wasPush = b0.boxes.join() !== b1.boxes.join();
      W3.els.btnUndo.fire('click');
      const b2 = p.snapshot();
      checked++;
      if (wasPush) afterPush++;
      if (b2.player !== b0.player || b2.boxes.join() !== b0.boxes.join() || b2.pushes !== b0.pushes) bad++;
      if (!wasPush) { W3.els[k].fire('click'); }        /* 걸음은 다시 밟아 길을 잇는다 */
    }
    return { ok: checked > 0 && afterPush > 0 && bad === 0,
      detail: '되돌린 횟수 ' + checked + ' · 그중 ★상자를 민 뒤 되돌린 것 ' + afterPush +
        '(0이면 공허라 통과로 안 센다) · 복원 실패 ' + bad };
  });

  /* ⑩ 색만으로 알리지 않는다 — 글자와 모양이 함께 말한다 */
  check('not-color-alone', () => {
    const glyphs = psh.glyphs().filter(Boolean);
    const hasBox = glyphs.includes('📦'), hasMan = glyphs.includes('🙂');
    const goalDashed = /\.cell\.goal\{[^}]*dashed/.test(CSS);
    const goalGlyph = /\.cell\.goal::after\{[^}]*content\s*:/.test(CSS);
    const doneGlyphDiffers = /goal\.has\(i\) \? '✓' : '📦'/.test(PLAY_SRC);
    return { ok: hasBox && hasMan && goalDashed && goalGlyph && doneGlyphDiffers,
      detail: '상자 글자 ' + hasBox + ' · 사람 글자 ' + hasMan + ' · 목표 점선 ' + goalDashed +
        ' · 목표 글자 ' + goalGlyph + ' · 맞은 상자 글자 구별 ' + doneGlyphDiffers };
  });

  /* ⑪ 움직임 줄이기 존중 */
  check('respects-reduced-motion', () => {
    const anims = (CSS.match(/transition\s*:/g) || []).length;
    const block = (CSS.match(/@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?)\n  \}/) || [, ''])[1];
    const off = /transition\s*:\s*none/.test(block);
    return { ok: anims > 0 && off, detail: 'transition ' + anims + '개 · reduced-motion 블록에서 끔 ' + off };
  });

  /* ⑫ 관측 창구는 읽기 전용이다 */
  check('observation-window-is-read-only', () => {
    const keys = Object.keys(psh).sort();
    const setters = keys.filter(k => /^set|^force|^inject|^seed$/i.test(k));
    const snap = psh.snapshot();
    snap.pushes = 9999; snap.boxes[0] = -1;
    const after = psh.snapshot();
    return { ok: setters.length === 0 && after.pushes !== 9999 && after.boxes[0] !== -1,
      detail: '창구 키 ' + JSON.stringify(keys) + ' · 판을 바꾸는 이름 ' + setters.length +
        ' · 스냅샷을 고쳐도 제품 그대로 ' + (after.pushes !== 9999) };
  });

  /* ⑬ 오늘 판은 시계를 ★한 곳에서만 읽는다 */
  check('clock-is-read-in-one-place', () => {
    /* ★몇 번 나오나로 세지 않는다 — 서식만 바뀌어도 흔들린다. ★어느 줄에 나오는지로 잰다.
       허용되는 자리는 todayKey 정의와 관측 창구뿐이다(둘 다 날짜를 ★문자열로 만들어 넘긴다). */
    const NL2 = String.fromCharCode(10);
    const rows = PLAY_SRC.split(NL2).map((t, i) => ({ n: i + 1, t }))
      .filter(r => /new Date\(|Date\.now|performance\.now/.test(r.t));
    const allowed = r => /function todayKey|now\.getTime|todayKey: iso/.test(r.t);
    const stray = rows.filter(r => !allowed(r));
    return { ok: rows.length > 0 && stray.length === 0,
      detail: '시계를 읽는 줄 ' + rows.length + '개 · ★허용 밖 ' + stray.length +
        (stray.length ? ' → ' + stray.map(r => r.n + ':' + r.t.trim().slice(0, 44)).join(' | ') : '') };
  });

  /* ─────────────────────────────── 판정 */
  const indets = results.filter(r => r.indeterminate);
  const fails = results.filter(r => !r.ok && !r.indeterminate);
  for (const r of results) {
    console.log((r.indeterminate ? '  INDET ' : (r.ok ? '  PASS  ' : '  FAIL  ')) +
      r.name.padEnd(34) + ' ' + r.detail);
  }
  console.log('');
  console.log('==== verify_push: 잰 것 ' + results.length + ' · PASS ' +
    (results.length - fails.length - indets.length) + ' · FAIL ' + fails.length +
    ' · ★INDET(못 쟀다) ' + indets.length + ' ====');

  if (MUTATION) {
    const m = MUTATIONS[MUTATION];
    if (m.expect === 'quiet') {
      if (indets.length) {
        console.error('★대조군인데 못 잰 검사가 있다: ' + indets.map(r => r.name).join(', '));
        process.exit(2);
      }
      if (fails.length) {
        console.error('★조용해야 할 대조군인데 붉어진 검사가 있다: ' + fails.map(r => r.name).join(', '));
        process.exit(3);
      }
      console.log('※ 대조군 ' + MUTATION + ' — 아무 검사도 붉어지지 않았다(기대대로)');
      process.exit(0);
    }
    if (!ran.has(m.target)) { console.error('★지목한 검사가 아예 돌지 않았다: ' + m.target); process.exit(2); }
    const t = results.find(r => r.name === m.target);
    if (t.indeterminate) { console.error('★지목한 검사를 못 쟀다(판정 불가): ' + m.target); process.exit(2); }
    console.log('※ 지목한 검사 ' + m.target + ' 가 ' + (t.ok ? '★못 잡았다' : '잡았다'));
    process.exit(t.ok ? 3 : 0);
  }
  if (indets.length) {
    console.error('★판정 불가가 있다 — 통과로 세지 않는다(rc=2): ' + indets.map(r => r.name).join(', '));
    process.exit(2);
  }
  process.exit(fails.length ? 1 : 0);
}

main().catch(e => { console.error('하네스 실패: ' + (e && e.stack || e)); process.exit(2); });
