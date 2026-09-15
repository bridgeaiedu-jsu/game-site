/* 함께 탈출(/talchul/) 검증기 — 2026-09-16 · 34번째 게임(기획 보고서 신규 3순위)
 *
 * ★이 검사는 제품보다 ★먼저 쓰였다. 제품이 없는 동안에는 rc=2(판정 불가)다 — 통과로 세지 않는다.
 *   탐지력은 `--selftest` 로 따로 증명한다.
 *
 * 보고서가 못박은 계약을 그대로 잰다(7절 「함께 탈출」)
 *   ★① 같은 KST 날 = 같은 판. 벽시계를 23시간 40분 옮겨도 같다
 *   ★② 두 말의 자리·문 상태·차례를 ★함께 훑어 해답이 있는지 확인한다
 *       — 이 파일이 ★자기 너비우선 탐색으로 다시 푼다(제품 말을 믿지 않는다)
 *   ★③ 제품이 말하는 최소 총 이동 수가 ★내 탐색의 최소와 같다
 *   ★④ ★문 장치가 장식이 아니다 — 문을 닫아 두면(문 칸을 못 지나가게 하면) 그 판은 ★안 풀린다.
 *       그리고 최소 수순에서 ★두 말이 모두 움직인다.
 *       ★처음에 쓴 '한쪽 말만 움직여서 풀리는가'는 ★공허했다(실측) — 승리 조건이 두 말 모두
 *       자기 출구에 서는 것이라, 한 말을 못 박으면 어떤 판이든 자동으로 '안 풀린다'가 된다.
 *       재는 대상을 ★문의 필요성으로 바꿨다. 이것이 보고서가 말한 '한쪽 조작만으로 끝나는 판'의
 *       실질이다 — 두 사람이 서로를 필요로 하지 않으면 협동이 아니다.
 *   ★⑤ ★영구적으로 갇히는 자리가 없다 — 닿을 수 있는 어느 상태에서도 목표에 아직 닿는다
 *   ★⑥ 문이 닫힐 칸에 말이 있으면 ★닫힘을 보류한다(그 말이 갇히지 않는다)
 *   ★⑦ ★한 말만 자기 출구에 서면 아직 끝이 아니다 — ★둘이 동시에 서야 끝난다.
 *       차례 넘기기는 허용되고 이동 수에 들지 않는다.
 *       ★보고서에서 의도적으로 벗어난 자리: 보고서는 "출구 칸에 들어간 말은 이동을 마친다"고
 *       적었다. 그 규칙을 그대로 두면 ★먼저 들어간 쪽이 동료를 영구히 가두는 판이 생긴다.
 *       그래서 출구 칸을 ★되돌아 나올 수 있는 보통 칸으로 두고 승리 조건만 ★동시에로 바꿨다.
 *       그 대가로 ⑤(갇히는 자리 0)를 ★계약으로 요구할 수 있게 됐다.
 *   ★⑧ 되돌리기는 한 수만 되돌린다
 *   ★⑨ 벽·대각·닫힌 문·동료가 선 칸으로의 입력은 무효이고 ★이동 수가 늘지 않는다
 *   ★⑩ 판을 짜는 데 난수를 쓰지 않고, 그 함수에 시각 읽기가 없다
 *
 * ★못 보는 것(정직 고지): 두 사람이 실제로 대화하며 노는 재미, 역할 버튼의 손맛은 재지 못한다.
 *   그것은 짧은 사용성 관찰의 몫이다(보고서도 그렇게 적었다).
 *
 * 규칙 표기(제품과 공유하는 약속)
 *   판은 w×h. walls 는 지나갈 수 없는 칸. doors 는 {cell, sw} — ★sw 칸에 말이 서 있는 동안만
 *   cell 로 ★들어갈 수 있다. 이미 cell 에 서 있는 말은 문이 닫혀도 ★쫓겨나지 않는다(보류).
 *   한 수 = 한 말이 상하좌우 한 칸. 차례 넘기기는 이동 수에 들지 않는다.
 *
 * 사용법: node tools/verify_talchul.js [--html <경로>] [--selftest] [--list-mutations]
 * 종료코드: 0 통과 · 1 미달 · 2 판정 불가
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const ARGV = process.argv.slice(2);
const has = f => ARGV.includes(f);
const valOf = (f, d) => { const i = ARGV.indexOf(f); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const ROOT = path.resolve(__dirname, '..');
const HTML = path.resolve(valOf('--html', path.join(ROOT, 'talchul', 'index.html')));

let pass = 0, fail = 0, indetMsg = null;
const lines = [];
function ok(name, cond, extra){
  if (cond) { pass++; lines.push('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; lines.push('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
  return !!cond;
}
function indet(msg){ indetMsg = msg; }

/* ───────── 독립 탐색기 ─────────
   상태는 (빨간 말 자리, 파란 말 자리)다. 차례는 ★넘길 수 있으므로 최소 이동 수를 가르지 않는다
   — 그래서 상태에서 뺐다. 이 선택은 제품과 같은 약속이고, 아래 ⑦ 검사로 따로 확인한다. */
function stepsOf(b){
  const { w, h } = b;
  const wallSet = new Set(b.walls);
  const doorOf = new Map(b.doors.map(d => [d.cell, d.sw]));
  const nbr = i => {
    const x = i % w, y = (i / w) | 0, out = [];
    if (y > 0) out.push(i - w);
    if (x < w - 1) out.push(i + 1);
    if (y < h - 1) out.push(i + w);
    if (x > 0) out.push(i - 1);
    return out.filter(j => !wallSet.has(j));
  };
  /* 한 수 — who 0=빨강 1=파랑. 규칙을 어기면 null 을 준다. */
  return function move(state, who, to){
    const [r, bl] = state;
    const from = who === 0 ? r : bl;
    const other = who === 0 ? bl : r;
    if (!nbr(from).includes(to)) return null;
    if (to === other) return null;
    if (doorOf.has(to)){
      const sw = doorOf.get(to);
      /* ★들어가려면 그 문의 스위치에 누군가 서 있어야 한다 */
      if (r !== sw && bl !== sw) return null;
    }
    return who === 0 ? [to, bl] : [r, to];
  };
}
function bfs(b){
  const move = stepsOf(b);
  const start = [b.red, b.blue];
  const key = s => s[0] * 1000 + s[1];
  const dist = new Map([[key(start), 0]]);
  const from = new Map();
  const q = [start];
  let goal = null;
  for (let qi = 0; qi < q.length; qi++){
    const s = q[qi];
    if (s[0] === b.redExit && s[1] === b.blueExit){ goal = s; break; }
    for (const who of [0, 1]){
      const at = who === 0 ? s[0] : s[1];
      const x = at % b.w, y = (at / b.w) | 0;
      const cands = [];
      if (y > 0) cands.push(at - b.w);
      if (x < b.w - 1) cands.push(at + 1);
      if (y < b.h - 1) cands.push(at + b.w);
      if (x > 0) cands.push(at - 1);
      for (const to of cands){
        const ns = move(s, who, to);
        if (!ns) continue;
        const k = key(ns);
        if (dist.has(k)) continue;
        dist.set(k, dist.get(key(s)) + 1);
        from.set(k, [s, who, to]);
        q.push(ns);
      }
    }
  }
  return { goal, dist, from, key, reached: q };
}
function bestMoves(b){
  const { goal, dist, key } = bfs(b);
  return goal ? dist.get(key(goal)) : null;
}
/* ★한쪽만 움직여서 끝나는가 — 한 말을 못 박아 두고 다른 말만 움직여 본다 */
function soloSolvable(b){
  const move = stepsOf(b);
  for (const who of [0, 1]){
    const start = [b.red, b.blue];
    const seen = new Set([start[0] * 1000 + start[1]]);
    const q = [start];
    let done = false;
    for (let qi = 0; qi < q.length && !done; qi++){
      const s = q[qi];
      if (s[0] === b.redExit && s[1] === b.blueExit){ done = true; break; }
      const at = who === 0 ? s[0] : s[1];
      const x = at % b.w, y = (at / b.w) | 0;
      const cands = [];
      if (y > 0) cands.push(at - b.w);
      if (x < b.w - 1) cands.push(at + 1);
      if (y < b.h - 1) cands.push(at + b.w);
      if (x > 0) cands.push(at - 1);
      for (const to of cands){
        const ns = move(s, who, to);
        if (!ns) continue;
        const k = ns[0] * 1000 + ns[1];
        if (seen.has(k)) continue;
        seen.add(k); q.push(ns);
      }
    }
    if (done) return true;
  }
  return false;
}
/* ★문을 ★닫아 둔 채로도 풀리는가 — 풀린다면 그 판의 문은 장식이고 협동이 아니다.
   문 칸을 아예 못 지나가는 칸으로 두고 같은 탐색을 돌린다. */
function shutSolvable(b){
  const shut = JSON.parse(JSON.stringify(b));
  shut.walls = shut.walls.concat(shut.doors.map(d => d.cell));
  shut.doors = [];
  return bestMoves(shut) !== null;
}

/* ★닿을 수 있는 자리 가운데 목표에 다시 못 닿는 곳(영구히 갇힘)을 센다 */
function deadStates(b){
  const { dist, key } = bfs(b);
  const move = stepsOf(b);
  const all = [...dist.keys()].map(k => [Math.floor(k / 1000), k % 1000]);
  let dead = 0;
  const memo = new Map();
  const canReach = s => {
    const k = key(s);
    if (memo.has(k)) return memo.get(k);
    const seen = new Set([k]);
    const q = [s];
    let good = false;
    for (let qi = 0; qi < q.length && !good; qi++){
      const cur = q[qi];
      if (cur[0] === b.redExit && cur[1] === b.blueExit){ good = true; break; }
      for (const who of [0, 1]){
        const at = who === 0 ? cur[0] : cur[1];
        const x = at % b.w, y = (at / b.w) | 0;
        const cands = [];
        if (y > 0) cands.push(at - b.w);
        if (x < b.w - 1) cands.push(at + 1);
        if (y < b.h - 1) cands.push(at + b.w);
        if (x > 0) cands.push(at - 1);
        for (const to of cands){
          const ns = move(cur, who, to);
          if (!ns) continue;
          const nk = key(ns);
          if (seen.has(nk)) continue;
          seen.add(nk); q.push(ns);
        }
      }
    }
    memo.set(k, good);
    return good;
  };
  for (const s of all) if (!canReach(s)) dead++;
  return { dead, total: all.length };
}

/* ───────── DOM 스텁 ───────── */
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
    const fns = (el._on[type] || []).slice();
    const on = el['on' + type];
    if (typeof on === 'function') fns.push(on);
    const e = Object.assign({ type, target: el, currentTarget: el, timeStamp: 1000,
                              preventDefault(){}, stopPropagation(){} }, ev || {});
    for (const fn of fns) fn(e);
    return fns.length;
  };
  Object.defineProperty(el, 'textContent', { get(){ return el._text; }, set(v){ el._text = String(v); el.children.length = 0; } });
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = String(v); if (v === '') el.children.length = 0; } });
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
    if (s === '[data-cell]' && el.dataset.cell !== undefined) return true;
    if (s.startsWith('.') && el._classes.has(s.slice(1))) return true;
    if (s.startsWith('#') && el.id === s.slice(1)) return true;
  }
  return false;
}
function makeStore(seed){
  const m = new Map(Object.entries(seed || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
           removeItem: k => { m.delete(k); }, clear: () => m.clear(), _dump: () => Object.fromEntries(m) };
}
function inlineScript(raw){
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m, best = null;
  while ((m = re.exec(raw))){
    if (/\bsrc=/.test(m[1])) continue;
    if (!/window\.__talchul/.test(m[2])) continue;
    if (!best || m[2].length > best.length) best = m[2];
  }
  return best;
}
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
  const wall = opts.wall || Date.UTC(2026, 8, 18, 3, 0, 0);
  const RealDate = Date;
  class DateStub extends RealDate {
    constructor(...a){ if (a.length === 0) super(wall); else super(...a); }
    static now(){ return wall; }
  }
  let rngCalls = 0;
  const sandbox = {
    document: doc, localStorage, Date: DateStub, Math: Object.create(Math),
    console: { log(){}, warn(){}, error(){} },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    navigator: { language: 'ko-KR', clipboard: { writeText: () => Promise.resolve() } },
    matchMedia: () => ({ matches: false, addEventListener(){}, removeEventListener(){} }),
    performance: { now: () => 1000 },
    location: { href: 'https://hanpango.com/talchul/', pathname: '/talchul/' },
    addEventListener(){}, removeEventListener(){},
    HTMLElement: function(){}, KeyboardEvent: function(){}, PointerEvent: function(){},
    fetch: () => Promise.reject(new Error('no network in harness'))
  };
  sandbox.Math.random = () => { rngCalls++; return 0.4242424242; };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  let err = null;
  try { vm.createContext(sandbox); new vm.Script(src, { filename: 'talchul.js' }).runInContext(sandbox); }
  catch (e) { err = e; }
  return { sandbox, doc, localStorage, err, api: sandbox.__talchul, rngCalls: () => rngCalls };
}

/* ───────── 검사 ───────── */
function run(htmlPath){
  let raw;
  try { raw = fs.readFileSync(htmlPath, 'utf8'); }
  catch (_) { indet(`제품을 읽지 못했다: ${htmlPath} — 아직 없는 단계라면 정상이다(검사가 제품보다 먼저 쓰였다)`); return; }
  const src = inlineScript(raw);
  if (!src) { indet('window.__talchul 을 여는 인라인 스크립트를 못 찾았다'); return; }
  const H = boot(src);
  if (H.err) { indet('제품 스크립트가 하네스에서 실행되지 않았다: ' + H.err.message); return; }
  const A = H.api;
  if (!A || typeof A.boardFor !== 'function') { indet('관측 창구 window.__talchul.boardFor 가 없다'); return; }

  const days = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'];
  const boards = days.map(d => A.boardFor(d));

  /* 판의 생김새 */
  const shape = [];
  for (let i = 0; i < boards.length; i++){
    const b = boards[i], n = b.w * b.h;
    const marks = [b.red, b.blue, b.redExit, b.blueExit, ...b.doors.map(d => d.cell), ...b.doors.map(d => d.sw)];
    if (new Set(marks).size !== marks.length) shape.push(`${days[i]} 겹치는 칸`);
    if (marks.some(c => c < 0 || c >= n)) shape.push(`${days[i]} 판 밖 칸`);
    const wallSet = new Set(b.walls);
    if (marks.some(c => wallSet.has(c))) shape.push(`${days[i]} 벽 위의 칸`);
    if (b.doors.length < 1 || b.doors.length > 2) shape.push(`${days[i]} 문 ${b.doors.length}쌍`);
  }
  ok('두 말·두 출구·스위치와 문이 서로 다른 칸이고 벽이 아니다(문은 1~2쌍)', shape.length === 0, shape.slice(0, 3).join(', '));

  /* ②③ 해답과 최소 이동 수 */
  const noSolve = [], bestBad = [];
  for (let i = 0; i < boards.length; i++){
    const mine = bestMoves(boards[i]);
    if (mine === null) noSolve.push(days[i]);
    else if (mine !== boards[i].best) bestBad.push(`${days[i]} 제품 ${boards[i].best} ≠ 내 계산 ${mine}`);
  }
  ok('두 말의 자리를 함께 훑어 해답이 있다(독립 너비우선 탐색)', noSolve.length === 0, noSolve.join(', '));
  ok('제품이 말하는 최소 총 이동 수가 내 계산과 같다', bestBad.length === 0, bestBad.slice(0, 2).join(', '));

  /* ★계기 점검(공허 방지) — 「문을 닫아도 풀리는가」를 재는 자가 ★실제로 반응하는지 먼저 본다.
     아래 판의 문은 옆길이 있어 ★없어도 그만이다. 그런 판을 '장식이 아니다'라고 말하면 안 된다. */
  {
    /* 4×2 · 문은 0번 칸 옆(1)이고 스위치는 5. 문을 닫아도 아랫줄로 ★돌아갈 수 있다. */
    const decor = { w: 4, h: 2, walls: [], red: 0, blue: 4, redExit: 3, blueExit: 7,
                    doors: [{ cell: 1, sw: 5 }] };
    ok('문 필요성 계기가 실제로 반응한다(양성 대조 — 없어도 그만인 문은 통과시키지 않는다)',
       shutSolvable(decor) === true);
  }

  /* ④ 문이 장식이 아니다 · 최소 수순에서 두 말이 모두 움직인다 */
  const decorDoors = boards.map((b, i) => [days[i], shutSolvable(b)]).filter(x => x[1]).map(x => x[0]);
  ok('문을 닫아 두면 풀리지 않는다(문 장치가 장식이 아니다)', decorDoors.length === 0, decorDoors.join(', '));

  /* ⑤ 영구적으로 갇히는 자리가 없다 */
  const stuck = [];
  for (let i = 0; i < boards.length; i++){
    const d = deadStates(boards[i]);
    if (d.dead > 0) stuck.push(`${days[i]} ${d.dead}/${d.total}`);
  }
  ok('영구적으로 갇히는 자리가 없다(닿는 모든 상태에서 목표에 아직 닿는다)', stuck.length === 0, stuck.slice(0, 3).join(', '));

  /* ① 같은 날 = 같은 판 */
  const sig = b => `${b.w}x${b.h}|${b.red}>${b.redExit}|${b.blue}>${b.blueExit}|${b.walls.join(',')}|${b.doors.map(d => d.cell + ':' + d.sw).join(',')}|${b.best}`;
  ok('같은 날을 두 번 물으면 같은 판이다', sig(A.boardFor(days[0])) === sig(boards[0]));
  const H2 = boot(src, { wall: Date.UTC(2026, 8, 17, 15, 10, 0) });   /* 2026-09-18 00:10 KST */
  const H3 = boot(src, { wall: Date.UTC(2026, 8, 18, 14, 50, 0) });   /* 2026-09-18 23:50 KST */
  const k2 = H2.api.todayKey(), k3 = H3.api.todayKey();
  ok('KST 하루 경계를 23시간 40분 움직여도 같은 날이다', k2 === k3 && k2 === '2026-09-18', `${k2} / ${k3}`);
  ok('같은 날이면 벽시계가 달라도 같은 판이다', sig(H2.api.boardFor(k2)) === sig(H3.api.boardFor(k3)));
  const sigs = new Set(boards.map(sig));
  ok('날짜가 다르면 판도 다르다', sigs.size === boards.length, `${sigs.size}/${boards.length}`);

  /* ⑩ 난수·시계 */
  const H4 = boot(src);
  const before = H4.rngCalls();
  H4.api.boardFor('2026-10-05');
  H4.api.boardFor('2026-10-06');
  ok('판을 짜는 데 난수를 당기지 않는다', H4.rngCalls() === before, `호출 ${H4.rngCalls() - before}회`);
  ok('판을 짜는 함수에 시각 읽기가 없다',
     !/Date\s*\.\s*now|new\s+Date\s*\(\s*\)|performance\s*\.\s*now/.test(String(A.boardSrc())));

  const b0 = boards[0];

  /* 제품이 내놓는 해답 수순이 실제로 규칙을 지키고 끝난다 */
  const plan = A.solveMoves(b0);
  let planOk = false, planLen = -1;
  if (Array.isArray(plan)){
    const move = stepsOf(b0);
    let s = [b0.red, b0.blue];
    planOk = true;
    for (const [who, to] of plan){
      const ns = move(s, who, to);
      if (!ns){ planOk = false; break; }
      s = ns;
    }
    planLen = plan.length;
    planOk = planOk && s[0] === b0.redExit && s[1] === b0.blueExit;
  }
  ok('제품이 내놓은 수순이 내 규칙으로도 그대로 끝난다', planOk, `${planLen}수`);
  ok('그 수순의 길이가 최소와 같다', planLen === b0.best, `${planLen} / 최소 ${b0.best}`);
  const bothMove = Array.isArray(plan) && plan.some(m => m[0] === 0) && plan.some(m => m[0] === 1);
  ok('최소 수순에서 두 말이 모두 움직인다', bothMove,
     Array.isArray(plan) ? `빨강 ${plan.filter(m => m[0] === 0).length}수 · 파랑 ${plan.filter(m => m[0] === 1).length}수` : '수순 없음');

  /* ⑥ 닫힘 보류 */
  const defer = A.deferProbe(b0);
  ok('문이 닫힐 칸에 말이 있으면 닫힘을 보류한다(그 말이 갇히지 않는다)',
     defer.stayedOnDoor === true && defer.couldLeave === true, JSON.stringify(defer));

  /* ⑦ 한 말만 들어와서는 끝이 아니다 · 차례 넘기기 */
  const fin = A.winProbe(b0);
  ok('한 말만 자기 출구에 서면 아직 끝이 아니다(둘이 동시에 서야 끝난다)',
     fin.redOnly === false && fin.blueOnly === false && fin.both === true, JSON.stringify(fin));
  const ps = A.passProbe(b0);
  ok('차례 넘기기는 허용되고 이동 수에 들지 않는다',
     ps.turnChanged === true && ps.movesBefore === ps.movesAfter, JSON.stringify(ps));

  /* ⑨ 무효 입력 */
  const bad = A.invalidProbe(b0);
  ok('벽·대각·닫힌 문·동료 칸 입력은 무효이고 이동 수가 늘지 않는다',
     bad.wallRejected && bad.diagRejected && bad.closedDoorRejected && bad.mateRejected && bad.movesUnchanged,
     JSON.stringify(bad));

  /* ⑧ 되돌리기 */
  const u = A.undoProbe(b0);
  ok('되돌리기는 한 수만 되돌린다', u.before - u.after === 1 && u.posBack === true, `${u.before} → ${u.after}`);
}

/* ───────── 자기시험 ───────── */
const MUTATIONS = [
  { name: 'best-off-by-one', why: '최소 총 이동 수를 1 크게 말한다', catches: '제품이 말하는 최소 총 이동 수가 내 계산과 같다',
    apply: s => s.replace('best: shortest(board),', 'best: shortest(board) + 1,') },
  { name: 'rng-in-board', why: '판을 짜는 자리에서 난수를 당긴다', catches: '판을 짜는 데 난수를 당기지 않는다',
    apply: s => s.replace('function boardFor(key){', 'function boardFor(key){ Math.random();') },
  { name: 'clock-in-board', why: '판을 짜는 함수가 시계를 읽는다', catches: '판을 짜는 함수에 시각 읽기가 없다',
    apply: s => s.replace('function boardFor(key){', 'function boardFor(key){ const _t = Date.now();') },
  { name: 'closed-door-passable', why: '스위치를 안 밟아도 닫힌 문으로 들어간다',
    catches: '벽·대각·닫힌 문·동료 칸 입력은 무효이고 이동 수가 늘지 않는다',
    apply: s => s.replace('if (st.red !== d.sw && st.blue !== d.sw) return { ok: false, why: \'door\' };', '') },
  { name: 'win-on-one', why: '한 말만 출구에 서도 끝났다고 말한다',
    catches: '한 말만 자기 출구에 서면 아직 끝이 아니다(둘이 동시에 서야 끝난다)',
    apply: s => s.replace('return st.red === b.redExit && st.blue === b.blueExit;',
                          'return st.red === b.redExit || st.blue === b.blueExit;') },
  { name: 'mate-passthrough', why: '동료가 선 칸을 그냥 지나간다', catches: '벽·대각·닫힌 문·동료 칸 입력은 무효이고 이동 수가 늘지 않는다',
    apply: s => s.replace('if (to === other) return { ok: false, why: \'mate\' };', '') },
  { name: 'undo-two', why: '되돌리기가 두 수를 되돌린다', catches: '되돌리기는 한 수만 되돌린다',
    apply: s => s.replace('st.log.pop();', 'st.log.pop(); st.log.pop();') },
  { name: 'pass-costs-a-move', why: '차례를 넘기는 것을 한 수로 센다', catches: '차례 넘기기는 허용되고 이동 수에 들지 않는다',
    apply: s => s.replace('function passTurn(st){', 'function passTurn(st){ st.log.push({ who: st.turn, from: -1, to: -1 });') },
  /* ★거름망을 ★없애는 것으로는 부족하다 — 그 자리의 첫 후보가 이미 조건을 만족하면
     뮤테이션이 ★무력해서 rc=0 이 나온다(실측). 그래서 거름망을 ★뒤집어 나쁜 판만 내게 한다. */
  { name: 'decor-doors-allowed', why: '문이 없어도 풀리는 판을 걸러내지 않는다',
    catches: '문을 닫아 두면 풀리지 않는다(문 장치가 장식이 아니다)',
    apply: s => s.replace('if (shutSolvable(board)) continue;', '') },
  { name: 'dead-only', why: '영구히 갇히는 자리가 있는 판만 골라 낸다(거름망을 뒤집었다)',
    catches: '영구적으로 갇히는 자리가 없다(닿는 모든 상태에서 목표에 아직 닿는다)',
    apply: s => s.replace('if (deadCount(board) !== 0) continue;', 'if (deadCount(board) === 0) continue;') },
];

function selftest(){
  let raw;
  try { raw = fs.readFileSync(HTML, 'utf8'); }
  catch (_) { console.log('★판정 불가 — 제품이 아직 없어 자기시험을 세울 수 없다'); return 2; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talchul-selftest-'));
  let mism = 0, inject = 0;
  console.log('함께 탈출 검증기 자기시험 — 뮤테이션 ' + MUTATIONS.length + '종');
  for (const mu of MUTATIONS){
    const mutated = mu.apply(raw);
    if (mutated === raw){ inject++; console.log(`  ★주입 실패  ${mu.name} — 앵커를 못 찾았다`); continue; }
    const p = path.join(dir, mu.name + '.html');
    fs.writeFileSync(p, mutated);
    const r = spawnSync(process.execPath, [__filename, '--html', p], { encoding: 'utf8' });
    const caught = r.status === 1 && r.stdout.includes('✗ ' + mu.catches);
    if (caught) console.log(`  ✓ ${mu.name} — ${mu.why} → 「${mu.catches}」가 잡았다`);
    else { mism++; console.log(`  ✗ ${mu.name} — ${mu.why} → 기대한 규칙이 안 잡았다(rc=${r.status})`); }
  }
  console.log(`\n결과: 어긋남 ${mism} · 주입실패 ${inject}`);
  return inject ? 2 : (mism ? 1 : 0);
}

if (has('--list-mutations')){ for (const m of MUTATIONS) console.log(`${m.name}\t${m.why}\t→ ${m.catches}`); process.exit(0); }
if (has('--selftest')) process.exit(selftest());

console.log('함께 탈출 검증기 — ' + path.relative(ROOT, HTML));
run(HTML);
for (const l of lines) console.log(l);
if (indetMsg){ console.log('\n★판정 불가 — ' + indetMsg); process.exit(2); }
console.log(`\n결과: 통과 ${pass} · 미달 ${fail}`);
process.exit(fail ? 1 : 0);
