/* 한붓 배달(/hanbut/) 검증기 — 2026-09-15 · 32번째 게임(기획 보고서 신규 1순위)
 *
 * ★이 검사는 제품보다 ★먼저 쓰였다. 제품이 없는 동안에는 rc=2(판정 불가)다 — 통과로 세지 않는다.
 *   탐지력은 `--selftest` 로 따로 증명한다.
 *
 * 무엇을 재는가(계약)
 *   ★① 같은 KST 날 = 같은 판. 같은 날 안에서 벽시계를 23시간 넘게 옮겨도 같다
 *   ★② 그 판에는 해답이 ★있다 — 이 파일이 ★자기 솔버로 다시 푼다(제품 말을 믿지 않는다)
 *   ★③ 제품이 말하는 최단 이동 수가 ★내 솔버의 최단과 같다(독립 계기의 대조)
 *   ★④ 시작·출구·배달 지점은 서로 다른 칸이고 벽이 아니다 · 배달 지점 수가 규격과 같다
 *   ★⑤ 판을 짜는 데 난수를 쓰지 않는다(하네스 Math.random 호출 0) — 날짜만으로 정해진다
 *   ★⑥ 판을 짜는 함수 소스에 ★시각 읽기가 없다(정적)
 *   ★⑦ 추가 이동 수 = 내 이동 수 − 최단 (음수가 될 수 없다)
 *   ★⑧ 되돌리기는 ★한 칸만 되돌린다
 *   ★⑨ 벽·대각·이미 지난 칸으로의 입력은 무효이고 ★벌점이 없다(이동 수가 안 는다)
 *
 * ★못 보는 것(정직 고지): 레이아웃·색·손가락 드래그의 감각은 재지 못한다. 그것은 실브라우저의 몫이다.
 *
 * 사용법: node tools/verify_hanbut.js [--html <경로>] [--selftest] [--list-mutations] [--mutate <이름>]
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
const HTML = path.resolve(valOf('--html', path.join(ROOT, 'hanbut', 'index.html')));

let pass = 0, fail = 0, indetMsg = null;
const lines = [];
function ok(name, cond, extra){
  if (cond) { pass++; lines.push('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; lines.push('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
  return !!cond;
}
function indet(msg){ indetMsg = msg; }

/* ───────── 독립 솔버 ─────────
   제품과 ★다른 사람이 쓴 것처럼 따로 푼다. 칸을 다시 밟을 수 없으므로 (칸, 지나온 칸 집합) 이
   상태다. 칸 수가 작아(≤36) 깊이우선 + 가지치기로 정확한 최소를 구한다.
   ★가지치기: 지금까지의 최선보다 길어지면 버린다. 남은 배달을 다 못 채울 수 없는 경우도 버린다. */
function solveShortest(board){
  const { w, h, start, exit, walls, deliveries } = board;
  const wallSet = new Set(walls);
  const delivSet = new Set(deliveries);
  const nbr = i => {
    const x = i % w, y = (i / w) | 0;
    const out = [];
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (y > 0) out.push(i - w);
    if (y < h - 1) out.push(i + w);
    return out.filter(j => !wallSet.has(j));
  };
  let best = Infinity;
  const seen = new Set();
  const stack = [{ at: start, visited: new Set([start]), got: delivSet.has(start) ? 1 : 0, moves: 0 }];
  /* 너비우선이 아니라 깊이우선이지만 best 로 자르므로 최소를 놓치지 않는다. */
  (function dfs(at, visited, got, moves){
    if (moves >= best) return;
    if (at === exit && got === delivSet.size){ best = Math.min(best, moves); return; }
    const key = at + '|' + got + '|' + [...visited].sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    for (const j of nbr(at)){
      if (visited.has(j)) continue;
      visited.add(j);
      dfs(j, visited, got + (delivSet.has(j) ? 1 : 0), moves + 1);
      visited.delete(j);
    }
  })(start, new Set([start]), delivSet.has(start) ? 1 : 0, 0);
  void stack;
  return Number.isFinite(best) ? best : null;
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
    if (!/window\.__hanbut/.test(m[2])) continue;
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
  let wall = opts.wall || Date.UTC(2026, 8, 16, 3, 0, 0);
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
    location: { href: 'https://hanpango.com/hanbut/', pathname: '/hanbut/' },
    addEventListener(){}, removeEventListener(){},
    HTMLElement: function(){}, KeyboardEvent: function(){}, PointerEvent: function(){},
    fetch: () => Promise.reject(new Error('no network in harness'))
  };
  sandbox.Math.random = () => { rngCalls++; return 0.4242424242; };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  let err = null;
  try { vm.createContext(sandbox); new vm.Script(src, { filename: 'hanbut.js' }).runInContext(sandbox); }
  catch (e) { err = e; }
  return { sandbox, doc, localStorage, err, api: sandbox.__hanbut, rngCalls: () => rngCalls };
}

/* ───────── 검사 ───────── */
function run(htmlPath){
  let raw;
  try { raw = fs.readFileSync(htmlPath, 'utf8'); }
  catch (_) { indet(`제품을 읽지 못했다: ${htmlPath} — 아직 없는 단계라면 정상이다(검사가 제품보다 먼저 쓰였다)`); return; }
  const src = inlineScript(raw);
  if (!src) { indet('window.__hanbut 을 여는 인라인 스크립트를 못 찾았다'); return; }
  const H = boot(src);
  if (H.err) { indet('제품 스크립트가 하네스에서 실행되지 않았다: ' + H.err.message); return; }
  const A = H.api;
  if (!A || typeof A.boardFor !== 'function') { indet('관측 창구 window.__hanbut.boardFor 가 없다'); return; }

  const C = A.consts();
  const days = ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
  const boards = days.map(d => A.boardFor(d));

  /* ④ 판의 생김새 */
  let shape = [];
  for (let i = 0; i < boards.length; i++){
    const b = boards[i], n = b.w * b.h;
    const wallSet = new Set(b.walls);
    const cells = [b.start, b.exit, ...b.deliveries];
    if (new Set(cells).size !== cells.length) shape.push(`${days[i]} 겹치는 칸`);
    if (cells.some(c => c < 0 || c >= n)) shape.push(`${days[i]} 판 밖 칸`);
    if (cells.some(c => wallSet.has(c))) shape.push(`${days[i]} 벽 위의 칸`);
    if (b.deliveries.length < C.MIN_DELIVERIES || b.deliveries.length > C.MAX_DELIVERIES) shape.push(`${days[i]} 배달 ${b.deliveries.length}곳`);
  }
  ok('시작·출구·배달은 서로 다른 칸이고 벽이 아니다', shape.length === 0, shape.slice(0, 3).join(', '));

  /* ②③ 해답 존재와 최단 — 내 솔버로 다시 푼다 */
  let solveBad = [], bestBad = [];
  for (let i = 0; i < boards.length; i++){
    const mine = solveShortest(boards[i]);
    if (mine === null) solveBad.push(days[i]);
    else if (mine !== boards[i].best) bestBad.push(`${days[i]} 제품 ${boards[i].best} ≠ 내 계산 ${mine}`);
  }
  ok('그날의 판은 반드시 풀린다(독립 솔버로 확인)', solveBad.length === 0, solveBad.join(', '));
  ok('제품이 말하는 최단 이동 수가 내 계산과 같다', bestBad.length === 0, bestBad.slice(0, 2).join(', '));

  /* ① 같은 날 = 같은 판 */
  const sig = b => `${b.w}x${b.h}|${b.start}|${b.exit}|${b.deliveries.join(',')}|${b.walls.join(',')}|${b.best}`;
  ok('같은 날을 두 번 물으면 같은 판이다', sig(A.boardFor(days[0])) === sig(boards[0]));
  const H2 = boot(src, { wall: Date.UTC(2026, 8, 15, 15, 10, 0) });   /* 2026-09-16 00:10 KST */
  const H3 = boot(src, { wall: Date.UTC(2026, 8, 16, 14, 50, 0) });   /* 2026-09-16 23:50 KST */
  const k2 = H2.api.todayKey(), k3 = H3.api.todayKey();
  ok('KST 하루 경계를 23시간 40분 움직여도 같은 날이다', k2 === k3 && k2 === '2026-09-16', `${k2} / ${k3}`);
  ok('같은 날이면 벽시계가 달라도 같은 판이다', sig(H2.api.boardFor(k2)) === sig(H3.api.boardFor(k3)));

  /* 날짜가 다르면 판도 다르다 */
  const sigs = new Set(boards.map(sig));
  ok('날짜가 다르면 판도 다르다', sigs.size === boards.length, `${sigs.size}/${boards.length}`);

  /* ⑤ 난수 비소비 */
  const H4 = boot(src);
  const before = H4.rngCalls();
  H4.api.boardFor('2026-09-21');
  H4.api.boardFor('2026-09-22');
  ok('판을 짜는 데 난수를 당기지 않는다', H4.rngCalls() === before, `호출 ${H4.rngCalls() - before}회`);

  /* ⑥ 정적 — 시각 읽기 없음 */
  const bsrc = String(A.boardSrc());
  ok('판을 짜는 함수에 시각 읽기가 없다', !/Date\s*\.\s*now|new\s+Date\s*\(\s*\)|performance\s*\.\s*now/.test(bsrc));

  /* ⑦⑧⑨ 순수 판정 — 걸음 규칙 */
  const b0 = boards[0];
  const step = (pathCells) => A.walk(b0, pathCells);
  const straight = A.solvePath(b0);        /* 제품이 내놓는 한 해답 경로(검증용 순수 함수) */
  ok('제품이 내놓은 해답 경로가 실제로 규칙을 지킨다', straight !== null && step(straight).done === true,
     straight ? `길이 ${straight.length - 1}` : '경로 없음');
  if (straight){
    const r = step(straight);
    ok('추가 이동 수 = 내 이동 − 최단', r.moves - b0.best === r.extra, `이동 ${r.moves} · 최단 ${b0.best} · 추가 ${r.extra}`);
    ok('추가 이동 수는 음수가 될 수 없다', r.extra >= 0);
    /* ⑨ 무효 입력 — 벽·대각·재방문 */
    const bad = A.invalidProbe(b0);
    ok('벽·대각·재방문 입력은 무효이고 이동 수가 늘지 않는다',
       bad.wallRejected && bad.diagRejected && bad.revisitRejected && bad.movesUnchanged,
       JSON.stringify(bad));
    /* ⑧ 되돌리기 */
    const u = A.undoProbe(b0);
    ok('되돌리기는 한 칸만 되돌린다', u.before - u.after === 1, `${u.before} → ${u.after}`);
  }
}

/* ───────── 자기시험 ───────── */
const MUTATIONS = [
  { name: 'best-off-by-one', why: '최단 이동 수를 1 크게 말한다', catches: '제품이 말하는 최단 이동 수가 내 계산과 같다',
    apply: s => s.replace('best: shortestOf(board),', 'best: shortestOf(board) + 1,') },
  { name: 'rng-in-board', why: '판을 짜는 자리에서 난수를 당긴다', catches: '판을 짜는 데 난수를 당기지 않는다',
    apply: s => s.replace('function boardFor(key){', 'function boardFor(key){ Math.random();') },
  { name: 'clock-in-board', why: '판을 짜는 함수가 시계를 읽는다', catches: '판을 짜는 함수에 시각 읽기가 없다',
    apply: s => s.replace('function boardFor(key){', 'function boardFor(key){ const _t = Date.now();') },
  { name: 'allow-revisit', why: '이미 지난 칸을 다시 밟게 허용한다', catches: '벽·대각·재방문 입력은 무효이고 이동 수가 늘지 않는다',
    apply: s => s.replace('if (st.path.includes(next)) return { ok: false, why: \'revisit\' };', '') },
  { name: 'undo-two', why: '되돌리기가 두 칸을 되돌린다', catches: '되돌리기는 한 칸만 되돌린다',
    apply: s => s.replace('st.path.pop();', 'st.path.pop(); st.path.pop();') },
];

function selftest(){
  let raw;
  try { raw = fs.readFileSync(HTML, 'utf8'); }
  catch (_) { console.log('★판정 불가 — 제품이 아직 없어 자기시험을 세울 수 없다'); return 2; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanbut-selftest-'));
  let mism = 0, inject = 0;
  console.log('한붓 배달 검증기 자기시험 — 뮤테이션 ' + MUTATIONS.length + '종');
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

console.log('한붓 배달 검증기 — ' + path.relative(ROOT, HTML));
run(HTML);
for (const l of lines) console.log(l);
if (indetMsg){ console.log('\n★판정 불가 — ' + indetMsg); process.exit(2); }
console.log(`\n결과: 통과 ${pass} · 미달 ${fail}`);
process.exit(fail ? 1 : 0);
