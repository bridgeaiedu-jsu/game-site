/* 단어 다리(/dari/) 검증기 — 2026-09-16 · 36번째 게임(기획 보고서 신규 5순위)
 *
 * ★이 검사는 제품보다 ★먼저 쓰였다. 제품이 없는 동안에는 rc=2(판정 불가)다 — 통과로 세지 않는다.
 *   탐지력은 `--selftest` 로 따로 증명한다.
 *
 * ★보고서가 이 게임에 건 출시 조건부터 적는다(9절 마지막 문단)
 *   "검수한 두 음절 일반 명사로 시작하며 … 사전 이용 조건과 재배포 가능 범위를 확인한다.
 *    한국어 검수 부담이 크므로 앞선 게임 이후에 개발하며, 허용어 기준이 정리되기 전에는 출시하지 않는다."
 *   ★이 저장소는 그 기준을 ★이미 갖고 있다 — 끝말잇기(wordchain)의 사전이고, 초성 맞히기가
 *   같은 바이트를 옮겨 쓰고 있다(chosung/index.html 주석 · 설계 §9 "게임 간 독립성 우선").
 *   그래서 이 게임도 ★그 사전의 두 글자 묶음을 그대로 쓰고, 아래 ⑫ 로 그 사실을 잰다.
 *
 * 재는 계약
 *   ★① 같은 KST 날 = 같은 시작·목표. 벽시계를 23시간 40분 옮겨도 같다
 *   ★② 그 문제는 풀린다 — 이 파일이 ★자기 너비우선 탐색으로 다시 푼다
 *   ★③ 제품이 말하는 최단 변환 횟수가 ★내 탐색의 최단과 같다
 *   ★④ 시작·목표는 서로 다르고 ★검수 상용어(쉬움 묶음) 안에 있으며 두 글자 한글이다
 *   ★⑤ 최단이 규격 범위 안이다
 *   ★⑥ 이어지는 7일의 문제(시작·목표 짝)가 겹치지 않는다
 *   ★⑦ 판을 짜는 데 난수를 쓰지 않고, 그 함수에 시각 읽기가 없다
 *   ★⑧ ★두 음절이 다 바뀐 말은 막고 ★이유를 말하며 시도를 깎지 않는다
 *   ★⑨ ★사전에 없는 말도 같다 · 앞서 쓴 말을 되풀이하는 것도 막는다
 *   ★⑩ ★정답 경로는 여럿이다 — 최단이 아닌 올바른 길도 완주로 인정된다
 *   ★⑪ 힌트는 단계적이다 — 1단계는 ★바꿀 자리만, 2단계라야 말을 준다. 힌트 수를 따로 센다
 *   ★⑫ 사전은 두 글자 한글뿐이고 중복이 없으며 ★쉬움 묶음은 그 부분집합이다
 *
 * ★못 보는 것(정직 고지): 그 말이 정말 표준어인지, 뜻이 자연스러운지는 재지 못한다.
 *   이 검사는 ★이 저장소가 이미 쓰는 사전과 ★같은 것을 쓰는지까지만 본다.
 *   ★풀이는 제품을 믿지 않고 따로 하지만 ★사전 자체는 공유한다 — 그 한계를 여기 적어 둔다.
 *
 * 사용법: node tools/verify_dari.js [--html <경로>] [--selftest] [--list-mutations]
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
const HTML = path.resolve(valOf('--html', path.join(ROOT, 'dari', 'index.html')));

let pass = 0, fail = 0, indetMsg = null;
const lines = [];
function ok(name, cond, extra){
  if (cond) { pass++; lines.push('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; lines.push('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
  return !!cond;
}
function indet(msg){ indetMsg = msg; }

/* ───────── 독립 탐색기 ─────────
   ★사전은 제품과 같은 것을 쓰되(공유가 불가피하다) ★길찾기는 여기서 따로 한다.
   한 글자만 다른 말끼리 이어 붙인 그래프를 만들고 너비우선으로 최단을 잰다. */
function buildGraph(words){
  const set = new Set(words);
  const byFirstFixed = new Map();   /* 첫 글자가 같은 말들 — 둘째 글자만 다르다 */
  const bySecondFixed = new Map();  /* 둘째 글자가 같은 말들 — 첫 글자만 다르다 */
  for (const w of words){
    const a = w[0], b = w[1];
    if (!byFirstFixed.has(a)) byFirstFixed.set(a, []);
    byFirstFixed.get(a).push(w);
    if (!bySecondFixed.has(b)) bySecondFixed.set(b, []);
    bySecondFixed.get(b).push(w);
  }
  const nbr = w => {
    const out = [];
    for (const x of (byFirstFixed.get(w[0]) || [])) if (x !== w) out.push(x);
    for (const x of (bySecondFixed.get(w[1]) || [])) if (x !== w) out.push(x);
    return out;
  };
  return { set, nbr };
}
function shortestSteps(g, start, goal){
  if (start === goal) return 0;
  const dist = new Map([[start, 0]]);
  const q = [start];
  for (let i = 0; i < q.length; i++){
    const w = q[i];
    const d = dist.get(w);
    for (const x of g.nbr(w)){
      if (dist.has(x)) continue;
      dist.set(x, d + 1);
      if (x === goal) return d + 1;
      q.push(x);
    }
  }
  return null;
}
/* 한 걸음이 규칙에 맞는가 — 글자 하나만 바뀌고, 사전에 있고, 앞서 쓴 말이 아니다 */
function stepOk(g, path, word){
  const prev = path[path.length - 1];
  if (word.length !== prev.length) return { ok: false, why: 'length' };
  let diff = 0;
  for (let i = 0; i < prev.length; i++) if (prev[i] !== word[i]) diff++;
  if (diff !== 1) return { ok: false, why: diff === 0 ? 'same' : 'two' };
  if (!g.set.has(word)) return { ok: false, why: 'unknown' };
  if (path.includes(word)) return { ok: false, why: 'repeat' };
  return { ok: true };
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
    if (!/window\.__dari/.test(m[2])) continue;
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
  const wall = opts.wall || Date.UTC(2026, 8, 20, 3, 0, 0);
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
    location: { href: 'https://hanpango.com/dari/', pathname: '/dari/' },
    addEventListener(){}, removeEventListener(){},
    HTMLElement: function(){}, KeyboardEvent: function(){}, PointerEvent: function(){},
    fetch: () => Promise.reject(new Error('no network in harness'))
  };
  sandbox.Math.random = () => { rngCalls++; return 0.4242424242; };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  let err = null;
  try { vm.createContext(sandbox); new vm.Script(src, { filename: 'dari.js' }).runInContext(sandbox); }
  catch (e) { err = e; }
  return { sandbox, doc, localStorage, err, api: sandbox.__dari, rngCalls: () => rngCalls };
}

/* ───────── 검사 ───────── */
function run(htmlPath){
  let raw;
  try { raw = fs.readFileSync(htmlPath, 'utf8'); }
  catch (_) { indet(`제품을 읽지 못했다: ${htmlPath} — 아직 없는 단계라면 정상이다(검사가 제품보다 먼저 쓰였다)`); return; }
  const src = inlineScript(raw);
  if (!src) { indet('window.__dari 를 여는 인라인 스크립트를 못 찾았다'); return; }
  const H = boot(src);
  if (H.err) { indet('제품 스크립트가 하네스에서 실행되지 않았다: ' + H.err.message); return; }
  const A = H.api;
  if (!A || typeof A.puzzleFor !== 'function') { indet('관측 창구 window.__dari.puzzleFor 가 없다'); return; }

  /* ⑫ 사전 — 두 글자 한글 · 중복 없음 · 쉬움 묶음은 부분집합 */
  const words = A.dictWords();
  const easy = A.easyWords();
  if (!Array.isArray(words) || words.length < 1000) { indet(`사전이 너무 작다(${words && words.length})`); return; }
  const badShape = words.filter(w => !/^[가-힣]{2}$/.test(w));
  const dupes = words.length - new Set(words).size;
  const setAll = new Set(words);
  const easyOut = easy.filter(w => !setAll.has(w));
  ok('사전은 두 글자 한글뿐이고 중복이 없으며 쉬움 묶음은 그 부분집합이다',
     badShape.length === 0 && dupes === 0 && easyOut.length === 0,
     `말 ${words.length}개 · 쉬움 ${easy.length}개 · 모양 어긋남 ${badShape.length} · 중복 ${dupes} · 밖 ${easyOut.length}`);

  /* ★이 사전이 ★이 저장소가 이미 쓰는 것과 같은가 — 끝말잇기의 두 글자 묶음과 대조한다.
     (보고서가 건 출시 조건 "허용어 기준"이 이미 정리돼 있다는 사실을 ★값으로 확인하는 자리다) */
  {
    let same = null, note = '';
    try {
      const wc = fs.readFileSync(path.join(ROOT, 'wordchain', 'index.html'), 'utf8');
      const m = /\{L:2,[^}]*?s:'([가-힣]+)'/.exec(wc);
      if (!m) note = '끝말잇기에서 두 글자 묶음을 못 찾았다';
      else {
        const wcWords = m[1].match(/.{2}/g) || [];
        same = wcWords.length === words.length && wcWords.every((w, i) => w === words[i]);
        note = `끝말잇기 ${wcWords.length}개 / 이 게임 ${words.length}개`;
      }
    } catch (e) { note = '끝말잇기 페이지를 못 읽었다: ' + e.message; }
    if (same === null) indet('사전 출처 대조를 세울 수 없다 — ' + note);
    else ok('사전이 이 저장소가 이미 쓰는 끝말잇기 사전의 두 글자 묶음과 바이트 그대로 같다', same, note);
  }
  if (indetMsg) return;

  const g = buildGraph(words);
  const easySet = new Set(easy);
  const days = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'];
  const puzzles = days.map(d => A.puzzleFor(d));
  const C = A.consts();

  /* ④ 시작·목표 */
  const shapeBad = [];
  for (let i = 0; i < puzzles.length; i++){
    const p = puzzles[i];
    if (p.start === p.goal) shapeBad.push(`${days[i]} 시작=목표`);
    if (!/^[가-힣]{2}$/.test(p.start) || !/^[가-힣]{2}$/.test(p.goal)) shapeBad.push(`${days[i]} 두 글자 한글이 아니다`);
    if (!easySet.has(p.start) || !easySet.has(p.goal)) shapeBad.push(`${days[i]} 검수 상용어 밖`);
  }
  ok('시작·목표는 서로 다르고 두 글자 한글이며 검수 상용어 안에 있다', shapeBad.length === 0, shapeBad.slice(0, 3).join(', '));

  /* ②③⑤ 풀린다 · 최단 대조 · 규격 범위 */
  const noSolve = [], bestBad = [], rangeBad = [];
  for (let i = 0; i < puzzles.length; i++){
    const p = puzzles[i];
    const mine = shortestSteps(g, p.start, p.goal);
    if (mine === null) noSolve.push(days[i]);
    else {
      if (mine !== p.best) bestBad.push(`${days[i]} 제품 ${p.best} ≠ 내 계산 ${mine}`);
      if (mine < C.MIN_STEPS || mine > C.MAX_STEPS) rangeBad.push(`${days[i]} ${mine}단계`);
    }
  }
  ok('그날의 문제는 풀린다(독립 너비우선 탐색)', noSolve.length === 0, noSolve.join(', '));
  ok('제품이 말하는 최단 변환 횟수가 내 계산과 같다', bestBad.length === 0, bestBad.slice(0, 2).join(', '));
  ok(`최단이 규격 범위 안이다(${C.MIN_STEPS}~${C.MAX_STEPS}단계)`, rangeBad.length === 0, rangeBad.slice(0, 3).join(', '));

  /* ① 같은 날 = 같은 문제 */
  const sig = p => `${p.start}>${p.goal}|${p.best}`;
  ok('같은 날을 두 번 물으면 같은 문제다', sig(A.puzzleFor(days[0])) === sig(puzzles[0]));
  const H2 = boot(src, { wall: Date.UTC(2026, 8, 19, 15, 10, 0) });   /* 2026-09-20 00:10 KST */
  const H3 = boot(src, { wall: Date.UTC(2026, 8, 20, 14, 50, 0) });   /* 2026-09-20 23:50 KST */
  const k2 = H2.api.todayKey(), k3 = H3.api.todayKey();
  ok('KST 하루 경계를 23시간 40분 움직여도 같은 날이다', k2 === k3 && k2 === '2026-09-20', `${k2} / ${k3}`);
  ok('같은 날이면 벽시계가 달라도 같은 문제다', sig(H2.api.puzzleFor(k2)) === sig(H3.api.puzzleFor(k3)));

  /* ⑥ 7일 겹침 0 */
  const seen = new Set();
  let dup = 0;
  for (const p of puzzles){ const k = `${p.start}>${p.goal}`; if (seen.has(k)) dup++; else seen.add(k); }
  ok('이어지는 7일의 문제가 겹치지 않는다', dup === 0, `겹침 ${dup} / 7일`);

  /* ⑦ 난수·시계 */
  const H4 = boot(src);
  const before = H4.rngCalls();
  H4.api.puzzleFor('2026-10-15');
  H4.api.puzzleFor('2026-10-16');
  ok('문제를 고르는 데 난수를 당기지 않는다', H4.rngCalls() === before, `호출 ${H4.rngCalls() - before}회`);
  ok('문제를 고르는 함수에 시각 읽기가 없다',
     !/Date\s*\.\s*now|new\s+Date\s*\(\s*\)|performance\s*\.\s*now/.test(String(A.puzzleSrc())));

  const p0 = puzzles[0];

  /* 제품이 내놓는 길이 내 규칙으로도 그대로 끝난다 */
  const plan = A.solvePath(p0);
  let planOk = false;
  if (Array.isArray(plan) && plan[0] === p0.start && plan[plan.length - 1] === p0.goal){
    planOk = true;
    for (let i = 1; i < plan.length; i++){
      const r = stepOk(g, plan.slice(0, i), plan[i]);
      if (!r.ok){ planOk = false; break; }
    }
  }
  ok('제품이 내놓은 길이 내 규칙으로도 그대로 이어진다', planOk, Array.isArray(plan) ? plan.join(' → ') : '길 없음');
  ok('그 길의 길이가 최단과 같다', Array.isArray(plan) && plan.length - 1 === p0.best,
     Array.isArray(plan) ? `${plan.length - 1} / 최단 ${p0.best}` : '');

  /* ⑧⑨ 무효 입력 */
  const bad = A.rejectProbe(p0);
  ok('두 음절이 다 바뀐 말·사전에 없는 말·되풀이하는 말은 막고 이유를 말한다',
     bad.twoChanged === 'two' && bad.unknown === 'unknown' && bad.repeat === 'repeat', JSON.stringify(bad));
  ok('막힌 입력은 변환 횟수를 늘리지 않는다', bad.stepsUnchanged === true, JSON.stringify(bad));

  /* ⑩ 정답 경로는 여럿이다 */
  const alt = A.altPathProbe(p0);
  if (alt.note) ok('최단이 아닌 올바른 길도 완주로 인정된다', true, '이 문제에는 더 긴 우회길이 없다 — ' + alt.note);
  else ok('최단이 아닌 올바른 길도 완주로 인정된다',
          alt.done === true && alt.steps > p0.best, JSON.stringify(alt));

  /* ⑪ 힌트는 단계적이다 */
  const hint = A.hintProbe(p0);
  ok('힌트 1단계는 바꿀 자리만 알려 주고 말을 주지 않는다',
     hint.level1HasPosition === true && hint.level1HasWord === false, JSON.stringify(hint));
  ok('힌트 2단계라야 말을 주고, 힌트 수가 따로 센다',
     hint.level2HasWord === true && hint.counted === 2, JSON.stringify(hint));
}

/* ───────── 자기시험 ───────── */
const MUTATIONS = [
  { name: 'best-off-by-one', why: '최단 변환 횟수를 1 크게 말한다', catches: '제품이 말하는 최단 변환 횟수가 내 계산과 같다',
    apply: s => s.replace('best: shortestOf(start, goal) };', 'best: shortestOf(start, goal) + 1 };') },
  { name: 'rng-in-puzzle', why: '문제를 고르는 자리에서 난수를 당긴다', catches: '문제를 고르는 데 난수를 당기지 않는다',
    apply: s => s.replace('function puzzleFor(key){', 'function puzzleFor(key){ Math.random();') },
  { name: 'clock-in-puzzle', why: '문제를 고르는 함수가 시계를 읽는다', catches: '문제를 고르는 함수에 시각 읽기가 없다',
    apply: s => s.replace('function puzzleFor(key){', 'function puzzleFor(key){ const _t = Date.now();') },
  { name: 'allow-two-changes', why: '두 음절이 다 바뀐 말을 받아 준다',
    catches: '두 음절이 다 바뀐 말·사전에 없는 말·되풀이하는 말은 막고 이유를 말한다',
    apply: s => s.replace("if (diff !== 1) return { ok: false, why: diff === 0 ? 'same' : 'two' };", '') },
  { name: 'allow-unknown-word', why: '사전에 없는 말을 받아 준다',
    catches: '두 음절이 다 바뀐 말·사전에 없는 말·되풀이하는 말은 막고 이유를 말한다',
    apply: s => s.replace("if (!WORDS.has(word)) return { ok: false, why: 'unknown' };", '') },
  { name: 'reject-costs-a-step', why: '막힌 입력에도 변환 횟수가 오른다', catches: '막힌 입력은 변환 횟수를 늘리지 않는다',
    apply: s => s.replace('function stepInto(st, word){', 'function stepInto(st, word){ st.path.push(word);') },
  { name: 'only-shortest-counts', why: '최단 길이 아니면 완주로 안 쳐 준다', catches: '최단이 아닌 올바른 길도 완주로 인정된다',
    apply: s => s.replace('const isDone = (p, st) => st.path[st.path.length - 1] === p.goal;',
                          'const isDone = (p, st) => st.path[st.path.length - 1] === p.goal && st.path.length - 1 === p.best;') },
  { name: 'hint1-gives-word', why: '힌트 1단계가 곧장 말을 준다', catches: '힌트 1단계는 바꿀 자리만 알려 주고 말을 주지 않는다',
    apply: s => s.replace('return { level: 1, pos: posOf(p, st) };', 'return { level: 1, pos: posOf(p, st), word: nextWordOf(p, st) };') },
  { name: 'seven-day-overlap', why: '목록을 짚는 자리를 날마다 옮기지 않는다', catches: '이어지는 7일의 문제가 겹치지 않는다',
    apply: s => s.replace('const idx = dayNumber(key) % PAIRS.length;', 'const idx = 0;') },
];

function selftest(){
  let raw;
  try { raw = fs.readFileSync(HTML, 'utf8'); }
  catch (_) { console.log('★판정 불가 — 제품이 아직 없어 자기시험을 세울 수 없다'); return 2; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dari-selftest-'));
  let mism = 0, inject = 0;
  console.log('단어 다리 검증기 자기시험 — 뮤테이션 ' + MUTATIONS.length + '종');
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

console.log('단어 다리 검증기 — ' + path.relative(ROOT, HTML));
run(HTML);
for (const l of lines) console.log(l);
if (indetMsg){ console.log('\n★판정 불가 — ' + indetMsg); process.exit(2); }
console.log(`\n결과: 통과 ${pass} · 미달 ${fail}`);
process.exit(fail ? 1 : 0);
