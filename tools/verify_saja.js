/* 사자성어 퀴즈(/saja/) 검증기 — 2026-09-14 · 31번째 게임
 *
 * ★이 검사는 제품보다 ★먼저 쓰였다. 제품이 없는 동안에는 rc=2(판정 불가)다 — 통과로 세지 않는다.
 *   탐지력은 `--selftest` 로 따로 증명한다(고의 결함을 심어 이 검사가 실제로 붉어지는지 본다).
 *
 * 방식은 형제 검증기(verify_mole.js · verify_numberbaseball.js)를 그대로 물려받았다:
 *   · 인라인 스크립트를 DOM 스텁 위에서 실제로 구동한다(vm)
 *   · 판정은 배포되는 관측 창구(window.__saja)와 ★이 파일이 따로 셈한 값의 대조로 한다
 *   · 벽시계와 Math.random 은 하네스가 쥔다 — 제품이 그것을 당기면 수로 드러난다
 *
 * 계약(이 게임이 지켜야 하는 것)
 *   ★① 한 판 10문제 · 유형 비율 고정(뜻 고르기 4 · 성어 고르기 3 · 빈칸 3)
 *   ★② 같은 KST 날 = 같은 문제·같은 보기 순서. 같은 날 안에서 ★벽시계를 23시간 옮겨도 같다
 *   ★③ 날짜가 다르면 문제도 다르다 — 이어지는 7일의 성어가 서로 겹치지 않는다
 *   ★④ 라운드 안에서 같은 성어가 두 번 나오지 않는다
 *   ★⑤ 보기는 넷이고 서로 다르며 정답은 ★정확히 하나다(ansIdx 와도 맞는다)
 *   ★⑥ 빈칸 문제는 가린 자리가 한 곳이고, 보기 넷이 서로 다른 ★한 글자이며, 정답 글자가 원래 글자다
 *   ★⑦ 라운드를 짜는 데 ★난수를 쓰지 않는다(하네스 Math.random 호출 0) — 날짜만으로 정해진다
 *   ★⑧ 라운드를 짜는 함수 소스에 ★시각 읽기가 없다(정적) — 날짜 문자열만 받는다
 *   ★⑨ 점수는 맞힌 개수이고 오답 감점이 없다
 *   ★⑩ 은행 무결성 — 성어는 한글 네 글자·한자 네 자, 뜻과 쓰임이 있고, id·성어가 중복되지 않는다
 *
 * ★이 하네스가 못 보는 것(정직 고지)
 *   · 레이아웃을 계산하지 않는다 — 360px 넘침·접힘은 실브라우저에서만 보인다.
 *   · CSS 를 파싱하지 않는다 — 색·대비는 check_theme_contrast.mjs · check_palette.py 의 몫이다.
 *   · 뜻이 ★사실로 맞는지는 재지 못한다 — 그것은 사람이 읽어 판단한다.
 *
 * 사용법: node tools/verify_saja.js [--html <경로>] [--selftest] [--list-mutations] [--mutate <이름>]
 * 종료코드: 0 = 전부 PASS · 1 = 하나라도 FAIL · 2 = 판정 불가(대상을 못 읽음·주입 실패 — 탐지 아님)
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
const HTML = path.resolve(valOf('--html', path.join(ROOT, 'saja', 'index.html')));

let pass = 0, fail = 0, indetMsg = null;
const lines = [];
const failedNames = [];
function ok(name, cond, extra){
  if (cond) { pass++; lines.push('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; failedNames.push(name); lines.push('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
  return !!cond;
}
function indet(msg){ indetMsg = msg; }

/* ───────────────────────── DOM 스텁 ─────────────────────────
   ★충실도 규칙: textContent·innerHTML 을 쓰면 자식이 사라진다(실제 DOM 계약). */
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

/* 제품 인라인 스크립트 떼어 오기 — 관측 창구를 여는 인라인 <script> 가 본체다 */
function inlineScript(raw){
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m, best = null;
  while ((m = re.exec(raw))){
    if (/\bsrc=/.test(m[1])) continue;
    if (!/window\.__saja/.test(m[2])) continue;
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

  let wall = opts.wall || Date.UTC(2026, 8, 15, 3, 0, 0);   /* 기본 = 2026-09-15 12:00 KST */
  const RealDate = Date;
  class DateStub extends RealDate {
    constructor(...a){ if (a.length === 0) super(wall); else super(...a); }
    static now(){ return wall; }
  }
  let rngCalls = 0;
  const baseRandom = () => { rngCalls++; return 0.4242424242; };
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
    location: { href: 'https://hanpango.com/saja/', pathname: '/saja/' },
    addEventListener(){}, removeEventListener(){},
    HTMLElement: function(){}, KeyboardEvent: function(){}, PointerEvent: function(){},
    fetch: () => Promise.reject(new Error('no network in harness'))
  };
  sandbox.Math.random = baseRandom;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  let err = null;
  try { vm.createContext(sandbox); new vm.Script(src, { filename: 'saja.js' }).runInContext(sandbox); }
  catch (e) { err = e; }
  return {
    sandbox, doc, localStorage, err, timers,
    saja: sandbox.__saja,
    rngCalls: () => rngCalls,
    setWall: ms => { wall = ms; }
  };
}

/* ───────────────────────── 검사 본문 ───────────────────────── */
const TYPE_MEAN = 'mean';   /* 성어 → 뜻 고르기 */
const TYPE_IDIOM = 'idiom'; /* 뜻 → 성어 고르기 */
const TYPE_BLANK = 'blank'; /* 빈칸 한 글자 채우기 */

function run(htmlPath){
  let raw;
  try { raw = fs.readFileSync(htmlPath, 'utf8'); }
  catch (_) { indet(`제품을 읽지 못했다: ${htmlPath} — 아직 없는 단계라면 이것이 정상이다(검사가 제품보다 먼저 쓰였다)`); return; }
  const src = inlineScript(raw);
  if (!src) { indet('window.__saja 를 여는 인라인 스크립트를 못 찾았다'); return; }

  const H = boot(src);
  if (H.err) { indet('제품 스크립트가 하네스에서 실행되지 않았다: ' + H.err.message); return; }
  const S = H.saja;
  if (!S || typeof S.roundFor !== 'function') { indet('관측 창구 window.__saja.roundFor 가 없다'); return; }

  const C = S.const();
  ok('한 판 문항 수 10', C.N_Q === 10, `N_Q=${C.N_Q}`);

  /* ⑩ 은행 무결성 */
  const bank = S.bank();
  const ids = new Set(), ks = new Set();
  let bad = [];
  for (const it of bank){
    if (!/^[가-힣]{4}$/.test(it.k)) bad.push(`${it.id} 성어`);
    if (!/^[一-鿿]{4}$/.test(it.h)) bad.push(`${it.id} 한자`);
    if (!it.m || it.m.length < 8) bad.push(`${it.id} 뜻`);
    if (!it.u || it.u.length < 8) bad.push(`${it.id} 쓰임`);
    if (ids.has(it.id)) bad.push(`${it.id} id중복`); ids.add(it.id);
    if (ks.has(it.k)) bad.push(`${it.k} 성어중복`); ks.add(it.k);
  }
  ok('은행 무결성(네 글자·한자·뜻·쓰임·중복 없음)', bad.length === 0, bad.length ? bad.slice(0, 4).join(', ') : `${bank.length}개`);
  ok('은행이 한 주기를 채울 만큼 있다(100개 이상)', bank.length >= 100, `${bank.length}개`);

  /* ①④⑤⑥ 라운드 구조 — 여러 날을 돌며 본다 */
  const days = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'];
  const rounds = days.map(d => S.roundFor(d));
  let structBad = [], mixBad = [], optBad = [], blankBad = [], dupBad = [];
  for (let i = 0; i < rounds.length; i++){
    const r = rounds[i];
    if (r.length !== 10) structBad.push(`${days[i]} ${r.length}문항`);
    const mix = { [TYPE_MEAN]: 0, [TYPE_IDIOM]: 0, [TYPE_BLANK]: 0 };
    const seen = new Set();
    for (const q of r){
      if (mix[q.type] === undefined) mixBad.push(`${days[i]} 알 수 없는 유형 ${q.type}`);
      else mix[q.type]++;
      if (seen.has(q.k)) dupBad.push(`${days[i]} ${q.k}`);
      seen.add(q.k);
      const texts = q.opts.map(o => o.t);
      const oks = q.opts.filter(o => o.ok).length;
      if (q.opts.length !== 4) optBad.push(`${days[i]} 보기 ${q.opts.length}개`);
      if (new Set(texts).size !== texts.length) optBad.push(`${days[i]} 보기 중복 (${q.k})`);
      if (oks !== 1) optBad.push(`${days[i]} 정답 ${oks}개 (${q.k})`);
      if (!q.opts[q.ansIdx] || !q.opts[q.ansIdx].ok) optBad.push(`${days[i]} ansIdx 어긋남 (${q.k})`);
      if (q.type === TYPE_BLANK){
        const blanks = (q.prompt.match(/□/g) || []).length;
        if (blanks !== 1) blankBad.push(`${days[i]} □ ${blanks}개`);
        if (texts.some(t => [...String(t)].length !== 1)) blankBad.push(`${days[i]} 보기가 한 글자가 아니다`);
        const answer = q.opts[q.ansIdx].t;
        const pos = [...q.prompt].indexOf('□');
        if (pos < 0 || [...q.k][pos] !== answer) blankBad.push(`${days[i]} 정답 글자가 원래 글자와 다르다 (${q.k})`);
      }
    }
    if (mix[TYPE_MEAN] !== 4 || mix[TYPE_IDIOM] !== 3 || mix[TYPE_BLANK] !== 3)
      mixBad.push(`${days[i]} ${mix[TYPE_MEAN]}/${mix[TYPE_IDIOM]}/${mix[TYPE_BLANK]}`);
  }
  ok('한 판은 10문항이다', structBad.length === 0, structBad.join(', '));
  ok('유형 비율이 4·3·3 으로 고정이다', mixBad.length === 0, mixBad.slice(0, 3).join(', '));
  ok('한 판에 같은 성어가 두 번 나오지 않는다', dupBad.length === 0, dupBad.slice(0, 3).join(', '));
  ok('보기는 넷이고 서로 다르며 정답이 정확히 하나다', optBad.length === 0, optBad.slice(0, 3).join(', '));
  ok('빈칸 문제는 가린 자리가 한 곳이고 정답이 그 글자다', blankBad.length === 0, blankBad.slice(0, 3).join(', '));

  /* ② 같은 날 = 같은 판 (벽시계를 옮겨도) */
  const key = r => r.map(q => `${q.id}:${q.type}:${q.opts.map(o => o.t).join('|')}`).join(',');
  const a1 = key(S.roundFor('2026-09-15'));
  const a2 = key(S.roundFor('2026-09-15'));
  ok('같은 날을 두 번 물으면 같은 판이다', a1 === a2);

  const H2 = boot(src, { wall: Date.UTC(2026, 8, 14, 15, 10, 0) });   /* 2026-09-15 00:10 KST */
  const H3 = boot(src, { wall: Date.UTC(2026, 8, 15, 14, 50, 0) });   /* 2026-09-15 23:50 KST */
  const d2 = H2.saja.dayKey(), d3 = H3.saja.dayKey();
  ok('KST 하루 경계를 23시간 40분 움직여도 같은 날이다', d2 === d3 && d2 === '2026-09-15', `${d2} / ${d3}`);
  ok('같은 날이면 벽시계가 달라도 같은 판이다', key(H2.saja.roundFor(d2)) === key(H3.saja.roundFor(d3)));

  /* ③ 날짜가 다르면 문제도 다르다 */
  let overlap = [];
  for (let i = 0; i < rounds.length; i++){
    for (let j = i + 1; j < rounds.length; j++){
      const A = new Set(rounds[i].map(q => q.k));
      const dup = rounds[j].map(q => q.k).filter(k => A.has(k));
      if (dup.length) overlap.push(`${days[i]}↔${days[j]} ${dup.length}개`);
    }
  }
  ok('이어지는 7일의 성어가 겹치지 않는다', overlap.length === 0, overlap.slice(0, 3).join(', '));

  /* ⑦ 난수를 쓰지 않는다 */
  const H4 = boot(src);
  const before = H4.rngCalls();
  H4.saja.roundFor('2026-09-16');
  H4.saja.roundFor('2026-09-17');
  ok('판을 짜는 데 난수를 당기지 않는다', H4.rngCalls() === before, `호출 ${H4.rngCalls() - before}회`);

  /* ⑧ 정적 — 판을 짜는 함수 소스에 시각 읽기가 없다 */
  const rsrc = String(S.roundSrc());
  const clock = /Date\s*\.\s*now|new\s+Date\s*\(\s*\)|performance\s*\.\s*now/.test(rsrc);
  ok('판을 짜는 함수에 시각 읽기가 없다', !clock, clock ? '소스에 시계가 있다' : '');

  /* ⑨ 점수식 */
  const sc = S.scoreOf([true, false, true, true, false, false, false, false, false, false]);
  ok('점수는 맞힌 개수이고 감점이 없다', sc === 3, `scoreOf=${sc}`);
  ok('0점이 바닥이다', S.scoreOf(new Array(10).fill(false)) === 0);
}

/* ───────────────────────── 자기시험(탐지력) ───────────────────────── */
const MUTATIONS = [
  { name: 'mix-ratio', why: '유형 비율을 4·3·3 에서 5·3·2 로 바꾼다',
    catches: '유형 비율이 4·3·3 으로 고정이다',
    apply: s => s.replace("const TYPE_PLAN = ['mean','mean','mean','mean','idiom','idiom','idiom','blank','blank','blank'];",
                          "const TYPE_PLAN = ['mean','mean','mean','mean','mean','idiom','idiom','idiom','blank','blank'];") },
  { name: 'rng-in-round', why: '판을 짜는 자리에서 난수를 당긴다',
    catches: '판을 짜는 데 난수를 당기지 않는다',
    apply: s => s.replace('function roundFor(key){', 'function roundFor(key){ Math.random();') },
  { name: 'clock-in-round', why: '판을 짜는 함수가 시계를 읽는다',
    catches: '판을 짜는 함수에 시각 읽기가 없다',
    apply: s => s.replace('function roundFor(key){', 'function roundFor(key){ const _t = Date.now();') },
  { name: 'score-penalty', why: '오답에 감점을 넣는다',
    catches: '점수는 맞힌 개수이고 감점이 없다',
    apply: s => s.replace('const scoreOf = oks => oks.filter(Boolean).length;',
                          'const scoreOf = oks => oks.filter(Boolean).length - oks.filter(o => !o).length;') },
  { name: 'dup-in-round', why: '한 판에 같은 성어가 두 번 나오게 한다',
    catches: '한 판에 같은 성어가 두 번 나오지 않는다',
    apply: s => s.replace('const idxs = dailyIndices(key);', 'const idxs = dailyIndices(key); idxs[1] = idxs[0];') },
  { name: 'two-answers', why: '보기 넷 가운데 정답을 둘로 만든다',
    catches: '보기는 넷이고 서로 다르며 정답이 정확히 하나다',
    apply: s => s.replace('return { t: src[p], ok: p === 0 };', 'return { t: src[p], ok: p === 0 || p === 1 };') },
];

function selftest(){
  let raw;
  try { raw = fs.readFileSync(HTML, 'utf8'); }
  catch (_) { console.log('★판정 불가 — 제품이 아직 없어 자기시험을 세울 수 없다'); return 2; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saja-selftest-'));
  let mism = 0, inject = 0;
  console.log('사자성어 검증기 자기시험 — 뮤테이션 ' + MUTATIONS.length + '종');
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

/* ───────────────────────── 진입 ───────────────────────── */
if (has('--list-mutations')){
  for (const m of MUTATIONS) console.log(`${m.name}\t${m.why}\t→ ${m.catches}`);
  process.exit(0);
}
if (has('--selftest')) process.exit(selftest());
if (has('--mutate')){
  const name = valOf('--mutate', '');
  const mu = MUTATIONS.find(m => m.name === name);
  if (!mu){ console.log('그런 뮤테이션이 없다: ' + name); process.exit(2); }
  const raw = fs.readFileSync(HTML, 'utf8');
  const out = mu.apply(raw);
  if (out === raw){ console.log('주입 실패 — 앵커를 못 찾았다'); process.exit(2); }
  const p = path.join(os.tmpdir(), 'saja-mutant.html');
  fs.writeFileSync(p, out);
  console.log(p);
  process.exit(0);
}

console.log('사자성어 퀴즈 검증기 — ' + path.relative(ROOT, HTML));
run(HTML);
for (const l of lines) console.log(l);
if (indetMsg){
  console.log('\n★판정 불가 — ' + indetMsg);
  process.exit(2);
}
console.log(`\n결과: 통과 ${pass} · 미달 ${fail}`);
process.exit(fail ? 1 : 0);
