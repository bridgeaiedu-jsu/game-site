/* 규칙 찾기(/gyuchik/) 검증기 — 2026-09-16 · 35번째 게임(기획 보고서 신규 4순위)
 *
 * ★이 검사는 제품보다 ★먼저 쓰였다. 제품이 없는 동안에는 rc=2(판정 불가)다 — 통과로 세지 않는다.
 *   탐지력은 `--selftest` 로 따로 증명한다.
 *
 * 보고서가 못박은 계약을 그대로 잰다(8절 「규칙 찾기」)
 *   ★① 같은 KST 날 = 같은 5문제와 ★같은 보기 차례
 *   ★② 한 판은 5문제 · 규칙군은 ★선언한 넷 안에 있다(반복·이동·증가·교대)
 *   ★③ 보기는 넷이고 서로 다르며 ★정답이 정확히 하나다
 *   ★④ 제품이 말하는 정답이 ★내가 규칙군을 따로 이어 본 다음 칸과 같다
 *   ★⑤ ★모호하지 않다. 두 겹으로 잰다.
 *       ㉮ 문제마다: 예시 셋과 들어맞는 다른 규칙군이 ★다른 보기를 정답으로 만들지 않는다.
 *       ㉯ 규칙군 자체: ★가능한 예시 셋을 ★전수로 훑어(칸 수·모양 수에서 나오는 모든 조합)
 *          두 규칙군이 ★같은 예시에 맞으면서 ★다른 다음 칸을 내는 경우가 0 임을 보인다.
 *       ★㉮만으로는 공허하다(실측) — 지금 네 규칙군은 서로 다른 값 하나씩을 바꾸도록 설계돼
 *       구조적으로 겹치지 않는다. 그래서 ㉮는 늘 초록이다. ㉯가 ★그 구조를 증명하는 자리이고,
 *       나중에 겹치는 규칙군을 더하면 ㉯가 붉어진다. 탐지력은 ★일부러 겹치는 다섯째 규칙을
 *       끼워 넣어 ㉯가 반응하는지로 증명한다(양성 대조).
 *       보고서 표현대로, ★모든 수학적 해석에 유일하다고는 주장하지 않는다.
 *   ★⑥ 이어지는 7일의 문제 겹침 0
 *   ★⑦ 판을 짜는 데 난수를 쓰지 않고, 그 함수에 시각 읽기가 없다
 *   ★⑧ 점수는 맞힌 개수다 — 감점도 시간 가산도 없다
 *   ★⑨ 힌트는 ★규칙군만 알려 주고 정답 보기를 가리키지 않는다
 *   ★⑩ 틀려도 판이 끝나지 않는다 · 한 문제에 제출은 ★한 번이다
 *   ★⑪ 해설이 모든 문제에 있고 ★정답 자체를 적지 않는다
 *   ★⑫ 화면이 문제 데이터 그대로 그린다 — 칸 수 = SLOTS · 채운 칸 = count · 표식 자리 = pos,
 *       이동 해설의 칸 수가 예시에서 따로 잰 이동 거리와 같다(2026-09-23: 5칸 문제를 4칸으로 그렸다)
 *
 * ★못 보는 것(정직 고지): "사람이 보기에 그럴듯한가", 검수자가 다른 합리적 답을 찾아내는가는
 *   재지 못한다. 그것은 보고서가 말한 사람 검수의 몫이다.
 *
 * 문제 표기(제품과 공유하는 약속)
 *   한 칸(panel)은 { count, pos, shape } 다 — count 는 왼쪽부터 채운 칸 수(1~SLOTS),
 *   pos 는 표식이 놓인 자리(0~SLOTS-1), shape 는 모양 번호(0~2). SLOTS=5.
 *   (9/23 까지 이 주석은 1~4·0~3 이라 적혀 있었고, 제품도 화면을 4칸만 그렸다 — ⑫가 그 자리다)
 *   문제는 panels[0..2] 를 보여 주고 panels[3] 을 맞히는 것이다.
 *
 * 사용법: node tools/verify_gyuchik.js [--html <경로>] [--selftest] [--list-mutations]
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
const HTML = path.resolve(valOf('--html', path.join(ROOT, 'gyuchik', 'index.html')));

let pass = 0, fail = 0, indetMsg = null;
const lines = [];
function ok(name, cond, extra){
  if (cond) { pass++; lines.push('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; lines.push('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
  return !!cond;
}
function indet(msg){ indetMsg = msg; }

/* ───────── 독립 규칙 엔진 ─────────
   ★제품과 따로 쓴다. 규칙군 넷을 여기서 다시 구현하고, 예시 셋과 들어맞는 ★모든 규칙의
   다음 칸을 모아 본다. 제품이 '정답'이라 말한 것을 믿지 않는다. */
const FAMILIES = ['repeat', 'move', 'grow', 'alt'];
/* ★이 값은 제품에서 읽지 않고 ★여기서 따로 선언한다 — 아래 검사에서 제품 선언과 대조한다.
   베껴 오면 그 순간 이 검사는 계약이 아니라 사본을 잰다. */
const SLOTS = 5, SHAPES = 3;
const eq = (a, b) => a.count === b.count && a.pos === b.pos && a.shape === b.shape;

/* 예시 셋이 그 규칙군과 들어맞는가 · 맞으면 다음 칸을 준다(아니면 null) */
function continueBy(fam, ex){
  const [a, b, c] = ex;
  /* ★양성 대조용 가짜 규칙 — 어떤 예시에나 맞고 마지막 칸을 그대로 되풀이한다.
     선언한 넷과 반드시 겹치므로, 이것을 끼웠을 때 전수 대조가 ★붉어져야 한다. */
  if (fam === 'lazy') return { count: c.count, pos: c.pos, shape: c.shape };
  const ok4 = p => p.count >= 1 && p.count <= SLOTS && p.pos >= 0 && p.pos < SLOTS && p.shape >= 0 && p.shape < SHAPES;
  if (fam === 'repeat'){
    if (!eq(a, b) || !eq(b, c)) return null;
    return { count: c.count, pos: c.pos, shape: c.shape };
  }
  if (fam === 'move'){
    /* 표식만 한 칸씩 옮긴다(4칸을 돌아온다). 나머지는 그대로. */
    const d = (b.pos - a.pos + SLOTS) % SLOTS;
    if (d === 0) return null;
    if ((c.pos - b.pos + SLOTS) % SLOTS !== d) return null;
    if (a.count !== b.count || b.count !== c.count) return null;
    if (a.shape !== b.shape || b.shape !== c.shape) return null;
    return { count: c.count, pos: (c.pos + d) % SLOTS, shape: c.shape };
  }
  if (fam === 'grow'){
    /* 채운 칸 수가 일정하게 는다. 나머지는 그대로. */
    const d = b.count - a.count;
    if (d === 0) return null;
    if (c.count - b.count !== d) return null;
    if (a.pos !== b.pos || b.pos !== c.pos) return null;
    if (a.shape !== b.shape || b.shape !== c.shape) return null;
    const out = { count: c.count + d, pos: c.pos, shape: c.shape };
    return ok4(out) ? out : null;
  }
  if (fam === 'alt'){
    /* 모양이 두 값 사이를 오간다. 나머지는 그대로. */
    if (a.shape === b.shape) return null;
    if (c.shape !== a.shape) return null;
    if (a.count !== b.count || b.count !== c.count) return null;
    if (a.pos !== b.pos || b.pos !== c.pos) return null;
    return { count: c.count, pos: c.pos, shape: b.shape };
  }
  return null;
}
/* ★규칙군끼리 겹치는가 — 가능한 예시 셋을 ★전수로 훑는다.
   한 칸은 (count 1..SLOTS) × (pos 0..SLOTS-1) × (shape 0..SHAPES-1) 가지이고 예시는 셋이다.
   겹친다 = 두 규칙군이 같은 예시 셋에 맞으면서 ★다른 다음 칸을 낸다. */
function conflictScan(families){
  const panels = [];
  for (let c = 1; c <= SLOTS; c++)
    for (let p = 0; p < SLOTS; p++)
      for (let s = 0; s < SHAPES; s++) panels.push({ count: c, pos: p, shape: s });
  const hits = [];
  let tried = 0;
  for (const a of panels) for (const b of panels) for (const c of panels){
    tried++;
    const ex = [a, b, c];
    let first = null;
    for (const f of families){
      const n = continueBy(f, ex, families);
      if (!n) continue;
      if (!first) first = { f, n };
      else if (!eq(first.n, n)) hits.push(`${first.f}/${f}`);
    }
  }
  return { hits, tried };
}

/* 예시 셋과 들어맞는 ★모든 규칙군의 다음 칸 */
function allContinuations(ex){
  const out = [];
  for (const f of FAMILIES){
    const n = continueBy(f, ex);
    if (n) out.push({ fam: f, next: n });
  }
  return out;
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
    if (s === '[data-opt]' && el.dataset.opt !== undefined) return true;
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
    if (!/window\.__gyuchik/.test(m[2])) continue;
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
  const wall = opts.wall || Date.UTC(2026, 8, 19, 3, 0, 0);
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
    location: { href: 'https://hanpango.com/gyuchik/', pathname: '/gyuchik/' },
    addEventListener(){}, removeEventListener(){},
    HTMLElement: function(){}, KeyboardEvent: function(){}, PointerEvent: function(){},
    fetch: () => Promise.reject(new Error('no network in harness'))
  };
  sandbox.Math.random = () => { rngCalls++; return 0.4242424242; };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  let err = null;
  try { vm.createContext(sandbox); new vm.Script(src, { filename: 'gyuchik.js' }).runInContext(sandbox); }
  catch (e) { err = e; }
  return { sandbox, doc, localStorage, err, api: sandbox.__gyuchik, rngCalls: () => rngCalls };
}

/* ───────── 검사 ───────── */
function run(htmlPath){
  let raw;
  try { raw = fs.readFileSync(htmlPath, 'utf8'); }
  catch (_) { indet(`제품을 읽지 못했다: ${htmlPath} — 아직 없는 단계라면 정상이다(검사가 제품보다 먼저 쓰였다)`); return; }
  const src = inlineScript(raw);
  if (!src) { indet('window.__gyuchik 을 여는 인라인 스크립트를 못 찾았다'); return; }
  const H = boot(src);
  if (H.err) { indet('제품 스크립트가 하네스에서 실행되지 않았다: ' + H.err.message); return; }
  const A = H.api;
  if (!A || typeof A.roundFor !== 'function') { indet('관측 창구 window.__gyuchik.roundFor 가 없다'); return; }

  /* 제품이 선언한 판의 크기가 ★내가 가정한 것과 같은가 — 다르면 아래 전수 대조가 헛것이 된다 */
  const C = A.consts();
  ok('제품이 선언한 칸 수·모양 수가 내가 따로 가정한 값과 같다',
     C.SLOTS === SLOTS && C.SHAPES === SHAPES, `제품 ${C.SLOTS}칸·${C.SHAPES}모양 / 내 가정 ${SLOTS}·${SHAPES}`);

  /* ⑤㉯ 규칙군끼리 겹치지 않는가 — ★전수 대조 */
  const scan = conflictScan(FAMILIES);
  ok('선언한 네 규칙군은 서로 겹치지 않는다(가능한 예시 셋을 전수로 확인)',
     scan.hits.length === 0, `예시 ${scan.tried.toLocaleString('en-US')}가지 · 충돌 ${scan.hits.length}`);
  /* ★양성 대조 — 일부러 겹치는 다섯째 규칙을 끼우면 이 자가 ★반응해야 한다 */
  const scan2 = conflictScan(FAMILIES.concat(['lazy']));
  ok('겹침 계기가 실제로 반응한다(양성 대조 — 일부러 겹치는 규칙을 끼웠다)',
     scan2.hits.length > 0, `충돌 ${scan2.hits.length}`);

  const days = ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];
  const rounds = days.map(d => A.roundFor(d));

  /* ② 문항 수와 규칙군 */
  const shape = [];
  for (let i = 0; i < rounds.length; i++){
    const r = rounds[i];
    if (!Array.isArray(r.items) || r.items.length !== 5) shape.push(`${days[i]} 문항 ${r.items && r.items.length}`);
    for (const q of (r.items || [])){
      if (!FAMILIES.includes(q.fam)) shape.push(`${days[i]} 모르는 규칙군 ${q.fam}`);
      if (!Array.isArray(q.examples) || q.examples.length !== 3) shape.push(`${days[i]} 예시 ${q.examples && q.examples.length}`);
      if (!Array.isArray(q.options) || q.options.length !== 4) shape.push(`${days[i]} 보기 ${q.options && q.options.length}`);
    }
  }
  ok('한 판은 5문제 · 예시 셋 · 보기 넷이고 규칙군은 선언한 넷 안에 있다', shape.length === 0, shape.slice(0, 3).join(', '));

  /* ③ 보기가 서로 다르고 정답이 정확히 하나 */
  const optionProblems = q => {
    const bad = [];
    const sigs = q.options.map(o => `${o.count}/${o.pos}/${o.shape}`);
    if (new Set(sigs).size !== 4) bad.push('보기 겹침');
    const hits = q.options.filter(o => eq(o, q.options[q.answer])).length;
    if (hits !== 1) bad.push(`정답과 같은 보기 ${hits}개`);
    if (!(q.answer >= 0 && q.answer < 4)) bad.push(`정답 번호 ${q.answer}`);
    return bad;
  };
  /* ★계기 점검(공허 방지) — 일부러 겹친 보기를 넣으면 이 자가 ★반응해야 한다.
     제품의 오답 만들기는 이미 서로 겹치지 않게 짜여 있어, 거름망을 떼는 뮤테이션이 ★무력하다(실측).
     그래서 탐지력을 여기서 ★양성 대조로 증명한다. */
  {
    const p = { count: 2, pos: 1, shape: 0 };
    const dup = { answer: 0, options: [p, { ...p }, { count: 3, pos: 1, shape: 0 }, { count: 2, pos: 2, shape: 0 }] };
    ok('보기 겹침 계기가 실제로 반응한다(양성 대조)', optionProblems(dup).length > 0, optionProblems(dup).join(', '));
  }
  const optBad = [];
  for (let i = 0; i < rounds.length; i++){
    for (let k = 0; k < rounds[i].items.length; k++){
      for (const b of optionProblems(rounds[i].items[k])) optBad.push(`${days[i]}#${k + 1} ${b}`);
    }
  }
  ok('보기 넷이 서로 다르고 정답이 정확히 하나다', optBad.length === 0, optBad.slice(0, 3).join(', '));

  /* ④ 제품의 정답 = 내가 규칙군으로 따로 이어 본 다음 칸 */
  const ansBad = [];
  for (let i = 0; i < rounds.length; i++){
    for (let k = 0; k < rounds[i].items.length; k++){
      const q = rounds[i].items[k];
      const mine = continueBy(q.fam, q.examples);
      if (!mine){ ansBad.push(`${days[i]}#${k + 1} 예시가 ${q.fam} 과 안 맞는다`); continue; }
      if (!eq(mine, q.options[q.answer])) ansBad.push(`${days[i]}#${k + 1} 제품 정답과 내 계산이 다르다`);
    }
  }
  ok('제품이 말하는 정답이 내가 따로 이어 본 다음 칸과 같다', ansBad.length === 0, ansBad.slice(0, 3).join(', '));

  /* ⑤ 모호하지 않다 */
  const ambig = [];
  for (let i = 0; i < rounds.length; i++){
    for (let k = 0; k < rounds[i].items.length; k++){
      const q = rounds[i].items[k];
      const cont = allContinuations(q.examples);
      const answer = q.options[q.answer];
      for (const c of cont){
        if (eq(c.next, answer)) continue;
        /* 다른 규칙이 ★보기 안의 다른 칸을 정답으로 만들면 그 문제는 모호하다 */
        if (q.options.some(o => eq(o, c.next))) ambig.push(`${days[i]}#${k + 1} ${c.fam} 도 성립하고 다른 보기를 가리킨다`);
      }
    }
  }
  ok('예시 셋과 맞는 다른 규칙이 다른 보기를 정답으로 만들지 않는다(모호함 0)', ambig.length === 0, ambig.slice(0, 3).join(', '));

  /* ① 같은 날 = 같은 판(보기 차례까지) */
  const sig = r => r.items.map(q => `${q.fam}|${q.examples.map(p => `${p.count}.${p.pos}.${p.shape}`).join('-')}|${q.options.map(o => `${o.count}.${o.pos}.${o.shape}`).join('-')}|${q.answer}`).join('//');
  ok('같은 날을 두 번 물으면 같은 판이다(보기 차례까지)', sig(A.roundFor(days[0])) === sig(rounds[0]));
  const H2 = boot(src, { wall: Date.UTC(2026, 8, 18, 15, 10, 0) });   /* 2026-09-19 00:10 KST */
  const H3 = boot(src, { wall: Date.UTC(2026, 8, 19, 14, 50, 0) });   /* 2026-09-19 23:50 KST */
  const k2 = H2.api.todayKey(), k3 = H3.api.todayKey();
  ok('KST 하루 경계를 23시간 40분 움직여도 같은 날이다', k2 === k3 && k2 === '2026-09-19', `${k2} / ${k3}`);
  ok('같은 날이면 벽시계가 달라도 같은 판이다', sig(H2.api.roundFor(k2)) === sig(H3.api.roundFor(k3)));

  /* ⑥ 이어지는 7일 겹침 0 */
  const seen = new Map();
  let dup = 0;
  for (let i = 0; i < rounds.length; i++){
    for (const q of rounds[i].items){
      const key = `${q.fam}|${q.examples.map(p => `${p.count}.${p.pos}.${p.shape}`).join('-')}`;
      if (seen.has(key)) dup++;
      else seen.set(key, days[i]);
    }
  }
  ok('이어지는 7일의 문제가 겹치지 않는다', dup === 0, `겹침 ${dup} / 35문제`);

  /* ⑦ 난수·시계 */
  const H4 = boot(src);
  const before = H4.rngCalls();
  H4.api.roundFor('2026-10-10');
  H4.api.roundFor('2026-10-11');
  ok('판을 짜는 데 난수를 당기지 않는다', H4.rngCalls() === before, `호출 ${H4.rngCalls() - before}회`);
  ok('판을 짜는 함수에 시각 읽기가 없다',
     !/Date\s*\.\s*now|new\s+Date\s*\(\s*\)|performance\s*\.\s*now/.test(String(A.roundSrc())));

  /* ⑧ 점수 = 맞힌 개수 */
  const sc = A.scoreProbe(rounds[0]);
  ok('점수는 맞힌 개수다(감점·시간 가산 없음)',
     sc.allRight === 5 && sc.allWrong === 0 && sc.mixed === 3 && sc.timeIgnored === true, JSON.stringify(sc));

  /* ⑨ 힌트는 규칙군만 알려 준다 */
  const hint = A.hintProbe(rounds[0]);
  ok('힌트는 규칙군만 알려 주고 정답 보기를 가리키지 않는다',
     hint.namesFamily === true && hint.revealsOption === false, JSON.stringify(hint));

  /* ⑩ 틀려도 끝나지 않는다 · 제출은 한 번 */
  const sub = A.submitProbe(rounds[0]);
  ok('틀려도 판이 끝나지 않고, 한 문제에 제출은 한 번이다',
     sub.stillRunning === true && sub.secondSubmitIgnored === true, JSON.stringify(sub));

  /* ⑪ 해설 */
  const exBad = [];
  for (let i = 0; i < rounds.length; i++){
    for (let k = 0; k < rounds[i].items.length; k++){
      const q = rounds[i].items[k];
      const t = A.explainOf(q, 'ko');
      if (!t || t.length < 6) exBad.push(`${days[i]}#${k + 1} 해설 없음`);
      else {
        const a = q.options[q.answer];
        /* ★해설이 정답 칸을 그대로 적으면 그것은 해설이 아니라 답이다 */
        if (t.includes(`${a.count}/${a.pos}/${a.shape}`)) exBad.push(`${days[i]}#${k + 1} 해설에 정답이 그대로 있다`);
      }
    }
  }
  ok('모든 문제에 해설이 있고 정답 칸을 그대로 적지 않는다', exBad.length === 0, exBad.slice(0, 3).join(', '));

  /* ⑫ 그림 = 데이터 */
  if (typeof A.panelProbe !== 'function') { indet('관측 창구 window.__gyuchik.panelProbe 가 없다'); return; }
  const drawBad = [];
  let drawn = 0;
  for (let i = 0; i < rounds.length; i++){
    for (let k = 0; k < rounds[i].items.length; k++){
      const q = rounds[i].items[k];
      for (const p of q.examples.concat(q.options)){
        drawn++;
        const g = A.panelProbe(p);
        if (g.slots !== SLOTS || g.filled !== p.count || g.mark !== p.pos)
          drawBad.push(`${days[i]}#${k + 1} 데이터 ${p.count}/${p.pos} → 그림 ${g.slots}칸·채움 ${g.filled}·표식 ${g.mark}`);
      }
      if (q.fam === 'move'){
        const d = (q.examples[1].pos - q.examples[0].pos + SLOTS) % SLOTS;
        if (!A.explainOf(q, 'ko').includes(`${d}칸`)) drawBad.push(`${days[i]}#${k + 1} 이동 해설이 ${d}칸이 아니다`);
      }
    }
  }
  ok('화면이 문제 데이터 그대로 그린다(칸 수·채운 칸·표식 자리·이동 해설)', drawBad.length === 0,
     drawBad.length ? drawBad.slice(0, 3).join(', ') : `패널 ${drawn}개`);
}

/* ───────── 자기시험 ───────── */
const MUTATIONS = [
  { name: 'draw-4-slots', why: '칸을 4개만 그린다(9/23 실제 결함)', catches: '화면이 문제 데이터 그대로 그린다(칸 수·채운 칸·표식 자리·이동 해설)',
    apply: s => s.replace('for (let s = 0; s < SLOTS; s++){', 'for (let s = 0; s < 4; s++){') },
  { name: 'explain-mod-4', why: '이동 해설을 4칸 기준으로 센다(9/23 실제 결함)', catches: '화면이 문제 데이터 그대로 그린다(칸 수·채운 칸·표식 자리·이동 해설)',
    apply: s => s.replace('(q.examples[1].pos - q.examples[0].pos + SLOTS) % SLOTS', '(q.examples[1].pos - q.examples[0].pos + 4) % 4') },
  { name: 'answer-off', why: '정답을 한 칸 옆 보기로 돌린다', catches: '제품이 말하는 정답이 내가 따로 이어 본 다음 칸과 같다',
    apply: s => s.replace('answer: options.indexOf(right),', 'answer: (options.indexOf(right) + 1) % 4,') },
  { name: 'rng-in-round', why: '판을 짜는 자리에서 난수를 당긴다', catches: '판을 짜는 데 난수를 당기지 않는다',
    apply: s => s.replace('function roundFor(key){', 'function roundFor(key){ Math.random();') },
  { name: 'clock-in-round', why: '판을 짜는 함수가 시계를 읽는다', catches: '판을 짜는 함수에 시각 읽기가 없다',
    apply: s => s.replace('function roundFor(key){', 'function roundFor(key){ const _t = Date.now();') },
  /* ★「모호함 거름망」과 「보기 겹침 거름망」에는 뮤테이션을 두지 않는다 — 둘 다 ★무력하다.
     지금 네 규칙군은 서로 다른 값 하나씩만 바꾸도록 설계돼 ★구조적으로 겹치지 않고(위 전수 대조),
     오답 셋도 정답과 서로에 대해 이미 걸러져 나오므로 겹칠 수가 없다. 거름망을 없애도 판이
     그대로 나온다. 두 계약의 탐지력은 ★본검사의 양성 대조(겹치는 규칙을 일부러 끼워 보기)와
     그대로 나온다. 두 계약의 탐지력은 ★본검사의 ★양성 대조 둘로 대신 증명한다
     (겹치는 규칙을 일부러 끼워 보기 · 일부러 겹친 보기를 넣어 보기). 무력한 뮤테이션을 통과로 세지 않는다. */
  { name: 'score-penalty', why: '틀리면 점수를 깎는다', catches: '점수는 맞힌 개수다(감점·시간 가산 없음)',
    apply: s => s.replace('const scoreOf = picks => picks.filter(p => p && p.right).length;',
                          'const scoreOf = picks => picks.filter(p => p && p.right).length - picks.filter(p => p && !p.right).length;') },
  { name: 'hint-reveals', why: '힌트가 정답 보기를 가리킨다', catches: '힌트는 규칙군만 알려 주고 정답 보기를 가리키지 않는다',
    apply: s => s.replace('return { fam: q.fam };', 'return { fam: q.fam, option: q.answer };') },
  { name: 'wrong-ends-round', why: '틀리면 판이 끝난다', catches: '틀려도 판이 끝나지 않고, 한 문제에 제출은 한 번이다',
    apply: s => s.replace('if (st.picks[i]) return { ok: false, why: \'already\' };',
                          'if (st.picks[i]) return { ok: false, why: \'already\' };\n  if (idx !== q.answer) st.over = true;') },
  { name: 'seven-day-overlap', why: '목록을 짚는 자리를 날마다 옮기지 않는다', catches: '이어지는 7일의 문제가 겹치지 않는다',
    apply: s => s.replace('const base = dayNumber(key) * 2;', 'const base = 0;') },
];

function selftest(){
  let raw;
  try { raw = fs.readFileSync(HTML, 'utf8'); }
  catch (_) { console.log('★판정 불가 — 제품이 아직 없어 자기시험을 세울 수 없다'); return 2; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gyuchik-selftest-'));
  let mism = 0, inject = 0;
  console.log('규칙 찾기 검증기 자기시험 — 뮤테이션 ' + MUTATIONS.length + '종');
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

console.log('규칙 찾기 검증기 — ' + path.relative(ROOT, HTML));
run(HTML);
for (const l of lines) console.log(l);
if (indetMsg){ console.log('\n★판정 불가 — ' + indetMsg); process.exit(2); }
console.log(`\n결과: 통과 ${pass} · 미달 ${fail}`);
process.exit(fail ? 1 : 0);
