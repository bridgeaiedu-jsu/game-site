/* 돌려 맞춰(/dolryeo/) 검증기 — 2026-09-16 · 33번째 게임(기획 보고서 신규 2순위)
 *
 * ★이 검사는 제품보다 ★먼저 쓰였다. 제품이 없는 동안에는 rc=2(판정 불가)다 — 통과로 세지 않는다.
 *   탐지력은 `--selftest` 로 따로 증명한다.
 *
 * 보고서가 못박은 계약을 그대로 잰다(6절 「돌려 맞춰」)
 *   ★① 같은 KST 날 = 같은 판(배치·처음 방향·잠금 조각까지). 벽시계를 23시간 40분 옮겨도 같다
 *   ★② 판정은 ★정답 방향과의 일치가 아니라 ★실제 연결 상태다
 *       — 이 파일이 ★자기 연결 판정기로 다시 읽어 제품의 done 과 대조한다
 *   ★③ 직선 조각의 180도 회전은 ★같은 상태다(대칭). 굽은 조각은 네 방향이 모두 다르다
 *   ★④ 그 판에는 해답이 ★있다 — 전체 방향 상태를 훑어 확인한다(잠긴 조각은 고정)
 *   ★⑤ 제품이 말하는 최소 회전 수가 ★내 전수 탐색의 최소와 같다
 *   ★⑥ 판을 짜는 데 난수를 쓰지 않는다(하네스 Math.random 호출 0) — 날짜만으로 정해진다
 *   ★⑦ 판을 짜는 함수 소스에 ★시각 읽기가 없다(정적)
 *   ★⑧ 잠긴 조각은 눌러도 돌지 않고 ★회전 수가 늘지 않는다(벌점 없음)
 *   ★⑨ 시작과 무관한 ★고립 고리는 완성으로 세지 않는다 — 길이 시작에서 출구까지 ★이어져야 한다
 *   ★⑩ 이어진 길의 끝이 ★판 밖이나 빈 칸으로 새면 완성이 아니다
 *   ★⑪ 되돌리기는 회전 한 번만 되돌린다
 *   ★⑫ 연속으로 눌러도 판정이 빠지지 않는다 — 네 번 돌리면 처음 상태로 돌아온다
 *
 * ★못 보는 것(정직 고지): 선 굵기·화살표·색의 구별, 손가락 탭의 감각은 재지 못한다.
 *   그것은 실브라우저와 사람의 몫이다.
 *
 * 조각 표기(제품과 공유하는 약속)
 *   한 조각은 ★열린 방향 넷의 비트다 — 1=위 2=오른쪽 4=아래 8=왼쪽.
 *   직선은 5(위아래) 또는 10(좌우) · 굽은 것은 3 6 12 9 · 0은 빈 칸(벽).
 *   시계 방향 90도 회전 = ((m << 1) | (m >> 3)) & 15.
 *
 * 사용법: node tools/verify_dolryeo.js [--html <경로>] [--selftest] [--list-mutations]
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
const HTML = path.resolve(valOf('--html', path.join(ROOT, 'dolryeo', 'index.html')));

let pass = 0, fail = 0, indetMsg = null;
const lines = [];
function ok(name, cond, extra){
  if (cond) { pass++; lines.push('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; lines.push('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
  return !!cond;
}
function indet(msg){ indetMsg = msg; }

/* ───────── 독립 판정기 ─────────
   ★제품과 따로 쓴다. 제품이 '되었다' 고 말하는 것을 믿지 않고 여기서 다시 읽는다. */
const UP = 1, RIGHT = 2, DOWN = 4, LEFT = 8;
const rot1 = m => ((m << 1) | (m >> 3)) & 15;
const rotN = (m, n) => { let v = m; for (let i = 0; i < ((n % 4) + 4) % 4; i++) v = rot1(v); return v; };
/* 한 조각의 ★서로 다른 방향 수 — 직선은 2, 굽은 것은 4, 빈 칸은 1 */
function distinctOrients(m){
  const seen = new Set();
  let v = m;
  for (let i = 0; i < 4; i++){ seen.add(v); v = rot1(v); }
  return seen.size;
}
/* 격자 위에서 시작에서 출구까지 ★실제로 이어지는가 + 이어진 길이 새지 않는가.
   ★고립 고리는 시작에서 닿지 않으므로 자연히 빠진다. */
function connected(b, cells){
  const { w, h, start, exit } = b;
  const opp = { [UP]: DOWN, [RIGHT]: LEFT, [DOWN]: UP, [LEFT]: RIGHT };
  const delta = { [UP]: -w, [RIGHT]: 1, [DOWN]: w, [LEFT]: -1 };
  const edgeOk = (i, d) => {
    const x = i % w, y = (i / w) | 0;
    if (d === UP) return y > 0;
    if (d === DOWN) return y < h - 1;
    if (d === LEFT) return x > 0;
    return x < w - 1;
  };
  const seen = new Set([start]);
  const stack = [start];
  let leak = false;
  while (stack.length){
    const at = stack.pop();
    for (const d of [UP, RIGHT, DOWN, LEFT]){
      if (!(cells[at] & d)) continue;
      /* ★판 밖으로 열린 입은 샌 것이다 — 시작·출구의 바깥 포트는 제품이 따로 표시한다 */
      if (!edgeOk(at, d)){
        if (!(at === start && d === b.startPort) && !(at === exit && d === b.exitPort)) leak = true;
        continue;
      }
      const j = at + delta[d];
      /* ★맞은편이 마주 열려 있지 않으면 새는 것이다 */
      if (!(cells[j] & opp[d])){ leak = true; continue; }
      if (!seen.has(j)){ seen.add(j); stack.push(j); }
    }
  }
  return { reaches: seen.has(exit), leak, seen };
}
function solvedBy(b, cells){
  const r = connected(b, cells);
  return r.reaches && !r.leak;
}
/* 전체 방향 상태 전수 탐색 — 잠긴 조각은 고정, 나머지는 각자 서로 다른 방향만 훑는다.
   ★최소 회전 수: 지금 방향에서 목표 방향까지 시계 방향으로 몇 번 도는가의 합. */
function bestRotations(b, cells){
  const n = b.w * b.h;
  const free = [];
  for (let i = 0; i < n; i++){
    if (cells[i] === 0) continue;
    if (b.locked.includes(i)) continue;
    const k = distinctOrients(cells[i]);
    if (k > 1) free.push({ i, k });
  }
  if (free.length > 20) return { best: null, why: '탐색 폭이 너무 넓다(자유 조각 ' + free.length + ')' };
  const cur = cells.slice();
  let best = Infinity;
  (function walk(idx, turns){
    if (turns >= best) return;
    if (idx === free.length){
      if (solvedBy(b, cur)) best = Math.min(best, turns);
      return;
    }
    const { i, k } = free[idx];
    const keep = cur[i];
    for (let t = 0; t < k; t++){
      cur[i] = rotN(keep, t);
      walk(idx + 1, turns + t);
    }
    cur[i] = keep;
  })(0, 0);
  return { best: Number.isFinite(best) ? best : null, why: null };
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
    if (!/window\.__dolryeo/.test(m[2])) continue;
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
  const wall = opts.wall || Date.UTC(2026, 8, 17, 3, 0, 0);
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
    location: { href: 'https://hanpango.com/dolryeo/', pathname: '/dolryeo/' },
    addEventListener(){}, removeEventListener(){},
    HTMLElement: function(){}, KeyboardEvent: function(){}, PointerEvent: function(){},
    fetch: () => Promise.reject(new Error('no network in harness'))
  };
  sandbox.Math.random = () => { rngCalls++; return 0.4242424242; };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  let err = null;
  try { vm.createContext(sandbox); new vm.Script(src, { filename: 'dolryeo.js' }).runInContext(sandbox); }
  catch (e) { err = e; }
  return { sandbox, doc, localStorage, err, api: sandbox.__dolryeo, rngCalls: () => rngCalls };
}

/* ───────── 검사 ───────── */
function run(htmlPath){
  let raw;
  try { raw = fs.readFileSync(htmlPath, 'utf8'); }
  catch (_) { indet(`제품을 읽지 못했다: ${htmlPath} — 아직 없는 단계라면 정상이다(검사가 제품보다 먼저 쓰였다)`); return; }
  const src = inlineScript(raw);
  if (!src) { indet('window.__dolryeo 를 여는 인라인 스크립트를 못 찾았다'); return; }
  const H = boot(src);
  if (H.err) { indet('제품 스크립트가 하네스에서 실행되지 않았다: ' + H.err.message); return; }
  const A = H.api;
  if (!A || typeof A.boardFor !== 'function') { indet('관측 창구 window.__dolryeo.boardFor 가 없다'); return; }

  const days = ['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'];
  const boards = days.map(d => A.boardFor(d));

  /* 판의 생김새 — 조각 표기가 약속대로인가 */
  let shape = [];
  for (let i = 0; i < boards.length; i++){
    const b = boards[i], n = b.w * b.h;
    if (b.cells.length !== n) shape.push(`${days[i]} 칸 수 ${b.cells.length}≠${n}`);
    if (b.cells.some(m => m < 0 || m > 15)) shape.push(`${days[i]} 조각 값이 0~15 밖`);
    if (b.start < 0 || b.start >= n || b.exit < 0 || b.exit >= n) shape.push(`${days[i]} 시작·출구가 판 밖`);
    if (b.start === b.exit) shape.push(`${days[i]} 시작과 출구가 같은 칸`);
    if (b.cells[b.start] === 0 || b.cells[b.exit] === 0) shape.push(`${days[i]} 시작·출구가 빈 칸`);
    if (b.locked.some(x => x < 0 || x >= n)) shape.push(`${days[i]} 잠금 칸이 판 밖`);
    /* ★최초 출시 범위: 분기 조각을 넣지 않는다(열린 입이 셋 이상인 조각 0) */
    const branch = b.cells.filter(m => [m & 1, (m >> 1) & 1, (m >> 2) & 1, (m >> 3) & 1].reduce((a, c) => a + c, 0) >= 3);
    if (branch.length) shape.push(`${days[i]} 분기 조각 ${branch.length}개`);
  }
  ok('조각·시작·출구가 약속한 표기 안에 있다(분기 조각 0)', shape.length === 0, shape.slice(0, 3).join(', '));

  /* ④ 해답 존재 · ⑤ 최소 회전 수 */
  let noSolve = [], bestBad = [];
  for (let i = 0; i < boards.length; i++){
    const b = boards[i];
    const r = bestRotations(b, b.cells);
    if (r.why) { indet(`전수 탐색을 세울 수 없다: ${days[i]} ${r.why}`); return; }
    if (r.best === null) noSolve.push(days[i]);
    else if (r.best !== b.best) bestBad.push(`${days[i]} 제품 ${b.best} ≠ 내 계산 ${r.best}`);
  }
  ok('그날의 판은 반드시 맞출 수 있다(전체 방향 전수 탐색)', noSolve.length === 0, noSolve.join(', '));
  ok('제품이 말하는 최소 회전 수가 내 계산과 같다', bestBad.length === 0, bestBad.slice(0, 2).join(', '));

  /* ① 같은 날 = 같은 판 */
  const sig = b => `${b.w}x${b.h}|${b.start}:${b.startPort}|${b.exit}:${b.exitPort}|${b.cells.join(',')}|${b.locked.join(',')}|${b.best}`;
  ok('같은 날을 두 번 물으면 같은 판이다', sig(A.boardFor(days[0])) === sig(boards[0]));
  const H2 = boot(src, { wall: Date.UTC(2026, 8, 16, 15, 10, 0) });   /* 2026-09-17 00:10 KST */
  const H3 = boot(src, { wall: Date.UTC(2026, 8, 17, 14, 50, 0) });   /* 2026-09-17 23:50 KST */
  const k2 = H2.api.todayKey(), k3 = H3.api.todayKey();
  ok('KST 하루 경계를 23시간 40분 움직여도 같은 날이다', k2 === k3 && k2 === '2026-09-17', `${k2} / ${k3}`);
  ok('같은 날이면 벽시계가 달라도 같은 판이다', sig(H2.api.boardFor(k2)) === sig(H3.api.boardFor(k3)));
  const sigs = new Set(boards.map(sig));
  ok('날짜가 다르면 판도 다르다', sigs.size === boards.length, `${sigs.size}/${boards.length}`);

  /* ⑥ 난수 비소비 */
  const H4 = boot(src);
  const before = H4.rngCalls();
  H4.api.boardFor('2026-09-30');
  H4.api.boardFor('2026-10-01');
  ok('판을 짜는 데 난수를 당기지 않는다', H4.rngCalls() === before, `호출 ${H4.rngCalls() - before}회`);

  /* ⑦ 정적 — 시각 읽기 없음 */
  const bsrc = String(A.boardSrc());
  ok('판을 짜는 함수에 시각 읽기가 없다', !/Date\s*\.\s*now|new\s+Date\s*\(\s*\)|performance\s*\.\s*now/.test(bsrc));

  /* ③ 대칭 — 직선의 180도는 같은 상태, 굽은 것은 네 방향이 다르다 */
  const symm = A.orientCount ? [5, 10, 3, 6, 12, 9, 0].map(m => [m, A.orientCount(m)]) : null;
  if (symm){
    const want = { 5: 2, 10: 2, 3: 4, 6: 4, 12: 4, 9: 4, 0: 1 };
    const badSym = symm.filter(([m, k]) => k !== want[m]).map(([m, k]) => `${m}→${k}(기대 ${want[m]})`);
    ok('직선의 180도 회전은 같은 상태다(굽은 조각은 네 방향)', badSym.length === 0, badSym.join(', '));
  } else {
    ok('직선의 180도 회전은 같은 상태다(굽은 조각은 네 방향)', false, 'orientCount 창구가 없다');
  }

  /* ② 판정은 연결 상태다 — 내 판정기와 제품의 done 을 대조 */
  const b0 = boards[0];
  const sol = A.solveCells(b0);
  let judgeBad = [];
  if (!Array.isArray(sol)) judgeBad.push('solveCells 가 배열을 주지 않는다');
  else {
    if (A.isSolved(b0, sol) !== solvedBy(b0, sol)) judgeBad.push('해답 상태에서 제품과 내 판정이 다르다');
    if (!solvedBy(b0, sol)) judgeBad.push('제품이 내놓은 해답이 내 판정으로는 안 풀린다');
    /* ★한 조각만 어긋나게 돌리면 완성이 깨져야 한다 */
    const idx = sol.findIndex((m, i) => m !== 0 && !b0.locked.includes(i) && distinctOrients(m) > 1);
    if (idx >= 0){
      const broken = sol.slice();
      broken[idx] = rot1(broken[idx]);
      if (A.isSolved(b0, broken) !== solvedBy(b0, broken)) judgeBad.push('한 조각을 어긋나게 돌린 상태에서 판정이 다르다');
      if (A.isSolved(b0, broken)) judgeBad.push('어긋난 상태를 완성이라 말한다');
    }
  }
  ok('판정이 방향 일치가 아니라 실제 연결 상태다(독립 판정기와 대조)', judgeBad.length === 0, judgeBad.slice(0, 2).join(', '));

  /* ★②의 결정적 자리 — ★검증기가 직접 지은 판 위에서 ★두 가지 다른 배치를 물어본다.
     제품이 만든 판은 길이 하나뿐이라 '정답 일치'와 '연결 판정'이 같은 답을 낸다.
     그러면 그 차이를 잴 수 없다. 그래서 여기서는 ★답이 둘인 판을 세운다. */
  {
    const synth = {
      w: 3, h: 3, start: 0, exit: 2, startPort: LEFT, exitPort: RIGHT, locked: [],
      /* 제품이 '정답'을 박아 두었다면 그것은 윗줄 직선 셋일 것이다 */
      answer: [10, 10, 10, 0, 0, 0, 0, 0, 0],
      cells: [10, 10, 10, 0, 0, 0, 0, 0, 0],
    };
    /* ㉮ 윗줄로 곧장 — 이어진다 */
    const straight = [10, 10, 10, 0, 0, 0, 0, 0, 0];
    /* ㉯ 아래로 돌아서 — ★모양은 다른데 역시 이어진다(답이 여럿이라는 계약) */
    const detour = [LEFT | DOWN, DOWN | RIGHT, LEFT | RIGHT, UP | RIGHT, LEFT | UP, 0, 0, 0, 0];
    /* ㉰ 출구에는 닿는데 한 입이 빈 칸으로 ★샌다 */
    const leaky = [10, 10 | DOWN, 10, 0, 0, 0, 0, 0, 0];
    const rows = [
      ['곧장 이은 배치', straight, true],
      ['돌아서 이은 다른 배치', detour, true],
      ['출구엔 닿지만 한 입이 새는 배치', leaky, false],
    ];
    const bad = [];
    for (const [nm, cells, want] of rows){
      const mine = solvedBy(synth, cells);
      const prod = A.isSolved(synth, cells);
      if (mine !== want) bad.push(`${nm}: 내 판정 ${mine}(기대 ${want}) — 검사기 쪽이 틀렸다`);
      if (prod !== want) bad.push(`${nm}: 제품 ${prod}(기대 ${want})`);
    }
    ok('답이 하나로 박혀 있지 않다 — 다른 배치로 이어도 완성이고, 새면 완성이 아니다',
       bad.length === 0, bad.slice(0, 2).join(' · '));
  }

  /* ⑨⑩ 고립 고리와 새는 끝 — 억지 상태를 만들어 물어본다 */
  if (A.probeIsolatedRing && A.probeLeak){
    /* ★제품이 만든 상태를 ★내 판정기로 다시 읽는다 — 제품의 자기 보고만 믿지 않는다 */
    const ring = A.probeIsolatedRing(b0);
    ok('시작과 무관한 고립 고리는 완성이 아니다',
       ring.productSolved === false && solvedBy(b0, ring.cells) === false,
       `제품 ${ring.productSolved} · 내 판정 ${solvedBy(b0, ring.cells)}`);
    const leak = A.probeLeak(b0);
    ok('이어진 길의 끝이 새면 완성이 아니다',
       leak.productSolved === false && solvedBy(b0, leak.cells) === false,
       `제품 ${leak.productSolved} · 내 판정 ${solvedBy(b0, leak.cells)}`);
  } else {
    ok('시작과 무관한 고립 고리는 완성이 아니다', false, 'probeIsolatedRing 창구가 없다');
    ok('이어진 길의 끝이 새면 완성이 아니다', false, 'probeLeak 창구가 없다');
  }

  /* ⑧ 잠긴 조각 · ⑪ 되돌리기 · ⑫ 네 번 = 제자리 */
  /* ★잠금 조각이 하나도 없는 판으로 재면 이 검사는 ★빈 검사다 — 통과로 세지 않는다 */
  const bLock = boards.find(b => b.locked.length > 0);
  if (!bLock) { indet('닷새의 판 어디에도 잠금 조각이 없다 — 잠금 계약을 잴 수 없다'); return; }
  const lock = A.lockProbe(bLock);
  ok('잠긴 조각은 눌러도 돌지 않고 회전 수가 늘지 않는다',
     lock.unchanged === true && lock.turnsBefore === lock.turnsAfter && !lock.note,
     JSON.stringify(lock));
  const u = A.undoProbe(b0);
  ok('되돌리기는 회전 한 번만 되돌린다', u.before - u.after === 1 && u.cellBack === true, `${u.before} → ${u.after}`);
  const four = A.fourTapProbe(b0);
  ok('연속으로 네 번 돌리면 처음 상태로 돌아온다(판정 누락 없음)',
     four.sameCells === true && four.turns === 4 && four.judged === 4, JSON.stringify(four));
}

/* ───────── 자기시험 ───────── */
const MUTATIONS = [
  { name: 'best-off-by-one', why: '최소 회전 수를 1 크게 말한다', catches: '제품이 말하는 최소 회전 수가 내 계산과 같다',
    apply: s => s.replace('best: bestTurns(cells, board),', 'best: bestTurns(cells, board) + 1,') },
  { name: 'rng-in-board', why: '판을 짜는 자리에서 난수를 당긴다', catches: '판을 짜는 데 난수를 당기지 않는다',
    apply: s => s.replace('function boardFor(key){', 'function boardFor(key){ Math.random();') },
  { name: 'clock-in-board', why: '판을 짜는 함수가 시계를 읽는다', catches: '판을 짜는 함수에 시각 읽기가 없다',
    apply: s => s.replace('function boardFor(key){', 'function boardFor(key){ const _t = Date.now();') },
  { name: 'straight-four-ways', why: '직선 조각도 네 방향이 다 다르다고 센다(대칭 무시)',
    catches: '직선의 180도 회전은 같은 상태다(굽은 조각은 네 방향)',
    apply: s => s.replace('function orientCount(m){', 'function orientCount(m){ if (m === 5 || m === 10) return 4;') },
  { name: 'judge-by-target', why: '연결 상태 대신 정답 방향과의 일치로 판정한다',
    catches: '답이 하나로 박혀 있지 않다 — 다른 배치로 이어도 완성이고, 새면 완성이 아니다',
    apply: s => s.replace('function isSolved(b, cells){', 'function isSolved(b, cells){ return cells.join() === (b.answer || []).join();') },
  { name: 'ring-counts', why: '시작에서 닿지 않는 고리도 완성으로 센다',
    catches: '시작과 무관한 고립 고리는 완성이 아니다',
    apply: s => s.replace('return r.reachesExit && !r.leak;', 'return !r.leak;') },
  { name: 'leak-ignored', why: '길 끝이 새는 것을 눈감는다',
    catches: '답이 하나로 박혀 있지 않다 — 다른 배치로 이어도 완성이고, 새면 완성이 아니다',
    apply: s => s.replace('return r.reachesExit && !r.leak;', 'return r.reachesExit;') },
  { name: 'locked-rotates', why: '잠긴 조각도 돌아간다', catches: '잠긴 조각은 눌러도 돌지 않고 회전 수가 늘지 않는다',
    apply: s => s.replace('if (b.locked.includes(i)) return { ok: false, why: \'locked\' };', '') },
  { name: 'undo-two', why: '되돌리기가 두 번을 되돌린다', catches: '되돌리기는 회전 한 번만 되돌린다',
    apply: s => s.replace('st.log.pop();', 'st.log.pop(); st.log.pop();') },
];

function selftest(){
  let raw;
  try { raw = fs.readFileSync(HTML, 'utf8'); }
  catch (_) { console.log('★판정 불가 — 제품이 아직 없어 자기시험을 세울 수 없다'); return 2; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dolryeo-selftest-'));
  let mism = 0, inject = 0;
  console.log('돌려 맞춰 검증기 자기시험 — 뮤테이션 ' + MUTATIONS.length + '종');
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

console.log('돌려 맞춰 검증기 — ' + path.relative(ROOT, HTML));
run(HTML);
for (const l of lines) console.log(l);
if (indetMsg){ console.log('\n★판정 불가 — ' + indetMsg); process.exit(2); }
console.log(`\n결과: 통과 ${pass} · 미달 ${fail}`);
process.exit(fail ? 1 : 0);
