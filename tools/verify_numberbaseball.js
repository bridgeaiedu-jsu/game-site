/* 숫자야구(/number-baseball/) 검증기 — worker(274) · 2026-09-11 · 티켓 28-number-baseball
 *
 * 기존 검증기(verify_fakeone.js·verify_justright.js)의 방식을 그대로 따른다:
 *   · 인라인 스크립트를 DOM 스텁 위에서 실제로 구동한다(vm)
 *   · 상태를 바꾸는 명령은 **제품 파일에 두지 않고** 여기서 메모리 위에만 덧붙인다
 *   · 판정은 배포되는 관측 창구(window.__nb)와 이 파일이 따로 셈한 값의 대조로 한다
 *   · 누르는 것은 다리가 아니라 **진짜 입력 사건**(keydown·click)으로 두드린다
 *
 * ★이 검사가 제품보다 먼저 쓰였다(브리프 5절 · master 지시 2). 그래서 제품이 없는 동안에도
 *   ★자기 탐지력을 증명할 수 있게 만들었다 — `--selftest` 는 이 파일 안의 ★준법 모형과
 *   ★위반 모형들에 같은 단언을 걸어, 준법은 초록·위반은 ★겨냥한 검사만 붉은지 본다.
 *   제품이 없을 때 제품 팔은 ★rc=2(판정 불가)다. ★통과로 세지 않는다.
 *
 * 중점 검사(브리프가 못박은 것)
 *   ★① 같은 날 같은 씨앗 = 같은 답. 같은 KST 날 안에서 ★벽시계를 크게 움직여도 답이 같다
 *       (같은 순간 두 번 물어 같은 것은 씨앗에 시각이 섞여 있어도 성립한다 — 그 그물로는 못 잡는다)
 *   ★② 플레이가 난수를 소비하지 않는다 — Math.random 호출수를 세어 ★판 짜기 뒤 0 증가
 *   ★③ 시간 기반 재시도 없음 — 답을 뽑는 경로에 시각 읽기가 없다(정적) + 느린 기기 모사(동적)
 *   ★④ 답의 모양 — 0~9 중 ★서로 다른 4개 · ★첫 자리 0 허용(날짜 전수로 실제 0 시작이 나온다)
 *   ★⑤ 판정 — 자리+숫자=스트라이크 · 숫자만=볼 · 하나도 없으면 아웃(무작위 대조 전수)
 *   ★⑥ 10회 안 4스트라이크 승리 · 10회 소진=패 · 그 뒤 입력 무시
 *   ★⑦ 같은 숫자 두 번은 ★제출 전에 막고 사유를 남긴다(시도 횟수 불소모)
 *
 * ★이 하네스가 못 보는 것(정직 고지)
 *   · 레이아웃을 계산하지 않는다 — 0×0 접힘·360px 넘침은 실브라우저에서만 보인다.
 *   · CSS 를 파싱하지 않는다 — 색·대비는 check_theme_contrast.mjs·check_palette.py 의 몫이다.
 *   · 공유 문안이 사람 눈에 읽히는지는 재지 못한다(문자열 모양까지다).
 *
 * 사용법: node tools/verify_numberbaseball.js [--html <경로>] [--selftest] [--list-mutations]
 *         node tools/verify_numberbaseball.js --mutate <이름>     (제품 소스에 변이를 넣어 붉어지는지)
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
const HTML = path.resolve(valOf('--html', path.join(ROOT, 'number-baseball', 'index.html')));

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
    if (!/window\.__nb/.test(m[2])) continue;
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
    location: { href: 'https://hanpango.com/number-baseball/', pathname: '/number-baseball/' },
    addEventListener(){}, removeEventListener(){},
    HTMLElement: function(){}, KeyboardEvent: function(){}, PointerEvent: function(){},
    fetch: () => Promise.reject(new Error('no network in harness'))
  };
  sandbox.Math.random = baseRandom;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  let err = null;
  try { vm.createContext(sandbox); new vm.Script(src, { filename: 'number-baseball.js' }).runInContext(sandbox); }
  catch (e) { err = e; }
  return {
    sandbox, doc, localStorage, err, timers,
    nb: sandbox.__nb,
    rngCalls: () => rngCalls,
    setWall: ms => { wall = ms; },
    wallNow: () => wall,
    flush: () => { const t = timers.splice(0); for (const x of t) { try { x.fn(1000); } catch (_){} } return t.length; },
    el: id => doc.getElementById(id)
  };
}

/* ───────────────────────── 단언 묶음 ─────────────────────────
   ★제품과 모형에 ★같은 단언을 건다(그래서 탐지력을 제품 없이도 증명할 수 있다). */
const KST = 9 * 3600000;
function kstDayStartUTC(y, m, d){ return Date.UTC(y, m, d) - KST; }   /* 그 KST 날의 00:00 = UTC-9h */

function runAssertions(src, label, opts){
  opts = opts || {};
  const A = boot(src, {});
  if (A.err) { ok(`[${label}] 스크립트가 구동된다`, false, String(A.err.message || A.err).slice(0, 120)); return; }
  const nb = A.nb;
  if (!nb) { ok(`[${label}] 관측 창구 window.__nb 가 열린다`, false, '없다'); return; }
  ok(`[${label}] 관측 창구 window.__nb 가 열린다`, true);

  const need = ['dayKey', 'dailyNo', 'answerFor', 'judge', 'state'];
  const missing = need.filter(k => typeof nb[k] !== 'function');
  if (!ok(`[${label}] 창구가 필요한 함수를 전부 준다`, missing.length === 0,
          missing.length ? '없는 것: ' + missing.join(',') : need.join(','))) return;

  /* ① 같은 KST 날 안에서 벽시계를 크게 움직여도 같은 답 */
  const day0 = kstDayStartUTC(2026, 8, 11);
  const moments = [day0 + 1000, day0 + 6 * 3600000, day0 + 12 * 3600000, day0 + 86399000];
  const keys = [], answers = [];
  for (const t of moments){
    const B = boot(src, { wall: t });
    keys.push(B.nb.dayKey());
    answers.push(B.nb.answerFor(B.nb.dayKey()));
  }
  ok(`[${label}] ① 같은 KST 날이면 dayKey 가 하나다`, new Set(keys).size === 1, keys.join(' / '));
  ok(`[${label}] ① 같은 KST 날이면 답이 하나다(벽시계를 23시간 59분 움직여도)`,
     new Set(answers).size === 1, answers.join(' / '));

  /* ① 같은 씨앗 재구축 6회 동일 */
  const rebuilt = [];
  for (let i = 0; i < 6; i++){
    const B = boot(src, { wall: day0 + 3 * 3600000 });
    rebuilt.push(B.nb.answerFor('2026-09-11'));
  }
  ok(`[${label}] ① 같은 dayKey 로 6번 다시 지어도 같은 답`, new Set(rebuilt).size === 1, rebuilt[0]);

  /* ④ 답의 모양 — 날짜 400일 전수 */
  const days = [];
  for (let i = 0; i < 400; i++){
    const t = kstDayStartUTC(2026, 0, 1) + i * 86400000 + 3600000;
    const k = new Date(t + KST);
    days.push(`${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`);
  }
  const all = days.map(d => nb.answerFor(d));
  const shapeBad = all.filter(a => !(typeof a === 'string' && /^\d{4}$/.test(a) && new Set(a).size === 4));
  ok(`[${label}] ④ 답은 전부 서로 다른 숫자 4개다(분모 ${all.length}일)`, shapeBad.length === 0,
     shapeBad.length ? '어긋남 ' + shapeBad.length + '건 예: ' + shapeBad[0] : '어긋남 0');
  const zeroLead = all.filter(a => typeof a === 'string' && a[0] === '0').length;
  ok(`[${label}] ④ 첫 자리 0 이 실제로 나온다(브리프: 허용)`, zeroLead > 0, `${zeroLead}/${all.length}일`);
  const distinctDays = new Set(all).size;
  ok(`[${label}] ④ 날마다 답이 고르게 갈린다(같은 답이 전부는 아니다)`, distinctDays > all.length * 0.5,
     `서로 다른 답 ${distinctDays}/${all.length}`);

  /* ⑤ 판정 — 무작위 아닌 전수 대조(브루트포스 기준값) */
  function refJudge(ans, g){
    let s = 0, b = 0;
    for (let i = 0; i < 4; i++){
      if (g[i] === ans[i]) s++;
      else if (ans.indexOf(g[i]) >= 0) b++;
    }
    return { s, b, out: s === 0 && b === 0 };
  }
  const fixed = [
    ['0123', '0123', { s: 4, b: 0 }], ['0123', '3210', { s: 0, b: 4 }],
    ['0123', '0132', { s: 2, b: 2 }], ['0123', '4567', { s: 0, b: 0 }],
    ['5678', '5091', { s: 1, b: 0 }], ['9087', '7890', { s: 0, b: 4 }]
  ];
  let jbad = 0, jlast = '';
  for (const [a, g, want] of fixed){
    const got = nb.judge(a, g);
    if (!got || got.s !== want.s || got.b !== want.b){ jbad++; jlast = `${a}/${g} 기대 ${want.s}S${want.b}B 실제 ${got && got.s}S${got && got.b}B`; }
  }
  ok(`[${label}] ⑤ 손으로 적은 판정 6건이 맞다`, jbad === 0, jbad ? jlast : '어긋남 0');
  let pbad = 0, plast = '';
  let n = 0;
  for (const a of all.slice(0, 40)){
    for (let g = 0; g < 10000; g += 137){
      const gs = String(g).padStart(4, '0');
      if (new Set(gs).size !== 4) continue;
      const want = refJudge(a, gs), got = nb.judge(a, gs);
      n++;
      if (!got || got.s !== want.s || got.b !== want.b || !!got.out !== want.out){
        pbad++; plast = `${a}/${gs} 기대 ${want.s}S${want.b}B out=${want.out} 실제 ${got && got.s}S${got && got.b}B out=${got && got.out}`;
      }
    }
  }
  ok(`[${label}] ⑤ 판정이 기준 셈과 전수 일치(분모 ${n}쌍 · 아웃 포함)`, pbad === 0, pbad ? plast : '어긋남 0');

  /* ③ 정적 — 답을 뽑는 경로에 시각 읽기·시간 예산 재시도가 없다 */
  const drawPath = (src.match(/function answerFor[\s\S]{0,1200}?\n\}/) || [''])[0];
  ok(`[${label}] ③ 답 뽑는 경로에 시각 읽기가 없다(Date.now·performance.now)`,
     drawPath.length > 0 && !/Date\.now\(|performance\.now\(|new Date\(\)/.test(drawPath),
     drawPath.length ? '길이 ' + drawPath.length + '자' : 'answerFor 를 못 떼어 왔다');
  ok(`[${label}] ③ 답 뽑는 경로에 시간 예산 재시도가 없다`,
     drawPath.length > 0 && !/(budget|deadline|timeout|elapsed)/i.test(drawPath));
  ok(`[${label}] ③ 답 뽑는 경로가 Math.random 을 쓰지 않는다(씨앗 난수만)`,
     drawPath.length > 0 && !/Math\.random/.test(drawPath));

  /* ② 플레이가 난수를 소비하지 않는다 — 진짜 입력 사건으로 열 번 둔다.
     ★판은 ★시작 버튼을 진짜로 눌러서 연다(조작 API 를 쓰지 않는다). 누르지 않으면 제품이
     입력을 옳게 무시하므로 아래 칸들이 ★공허하게 통과한다(1회차에 실제로 그렇게 통과했다). */
  const P = boot(src, { wall: day0 + 3 * 3600000 });
  const startedBy = startRun(P);
  ok(`[${label}] ② 시작 버튼을 눌러 판이 실제로 열렸다(조작 API 없이)`,
     startedBy !== null && P.nb.state().running === true, '경로: ' + startedBy);
  const before = P.rngCalls();
  const ansNow = P.nb.state().answer || P.nb.answerFor(P.nb.dayKey());
  const typed = ['0123', '4567', '8901', '2345', '6789', '1357'];
  const triesBefore = P.nb.state().tries;
  let played = 0;
  for (const g of typed){
    if (P.nb.state().over) break;
    const okType = typeKeys(P, g);
    if (okType) played++;
  }
  const after = P.rngCalls();
  const triesAfter = P.nb.state().tries;
  /* ★비공허 증명 — 입력이 제품에 닿아 ★시도수가 실제로 늘었는가. 이 칸이 붉으면 아래 ②⑦ 판정은
     '통과' 가 아니라 ★관측 불가다(대상이 발생하지 않았다). */
  ok(`[${label}] ② 입력이 제품에 닿아 시도수가 늘었다(공허 방지)`, triesAfter > triesBefore,
     `시도 ${triesBefore} → ${triesAfter} · 입력 ${played}판`);
  ok(`[${label}] ② 제품에 상태를 바꾸는 조작 API 가 없다(관측 창구만)`,
     typeof P.nb.submitForTest !== 'function' && typeof P.nb.setAnswer !== 'function');
  ok(`[${label}] ② 플레이 동안 Math.random 호출이 0 증가(${played}판 입력)`, after === before,
     `판 짜기 전 ${before} → 플레이 뒤 ${after}`);
  const ansAfter = P.nb.state().answer || P.nb.answerFor(P.nb.dayKey());
  ok(`[${label}] ② 플레이 뒤에도 오늘의 답이 그대로다`, ansAfter === ansNow, `${ansNow} → ${ansAfter}`);

  /* ⑥⑦ 규칙 — 입력으로 확인(창구는 관측만) */
  if (played > 0){
    const st = P.nb.state();
    ok(`[${label}] ⑥ 시도 상한이 10이다`, st.maxTries === 10, '상한 ' + st.maxTries);
    const dupe = (() => {
      const Q = boot(src, { wall: day0 + 3 * 3600000 });
      if (startRun(Q) === null) return { ok: false, why: '판을 열지 못했다' };
      const t0 = Q.nb.state().tries;
      typeKeys(Q, '1123');
      const t1 = Q.nb.state().tries;
      /* ★중복이 ★실제로 거부됐는지까지 본다 — 시도수가 그대로인 것만으로는 '입력이 아예 닿지
         않았다' 와 구별되지 않는다(사유 표시를 함께 요구한다). */
      const note = Q.nb.state().note;
      const good = (t0 === t1) && note === 'dupe';
      return { ok: good, why: `시도 ${t0} → ${t1} · 사유 '${note}'` };
    })();
    ok(`[${label}] ⑦ 같은 숫자 두 번은 시도를 소모하지 않고 사유를 남긴다`, dupe.ok, dupe.why);
  } else {
    ok(`[${label}] ⑥⑦ 입력 경로로 규칙을 확인했다`, false, '입력 사건이 제품에 닿지 않았다(스텁 배선 확인 필요)');
  }
}

/* 판을 ★진짜 클릭으로 연다 — 오늘의 도전 버튼을 누른다. 누를 수 없으면 null.
   ★조작 API(startDaily 같은 것)를 쓰지 않는다: 제품에 그런 훅을 남기지 않는 것이 계약이다. */
function startRun(P){
  const b = P.el('btnDaily');
  if (!b) return null;
  const n = b.dispatch('click', { button: 0 });
  P.flush();
  if (P.nb.state().running) return `btnDaily 클릭(청취자 ${n}개)`;
  const f = P.el('btnStart');
  if (f){
    const n2 = f.dispatch('click', { button: 0 });
    P.flush();
    if (P.nb.state().running) return `btnStart 클릭(청취자 ${n2}개)`;
  }
  return null;
}

/* 진짜 입력 사건으로 네 자리를 치고 제출한다 */
function typeKeys(P, digits){
  const doc = P.doc;
  const fire = key => {
    const hs = (doc._on && doc._on.keydown) ? 1 : 0;
    if (hs) doc._on.keydown({ key, preventDefault(){}, stopPropagation(){} });
    return hs;
  };
  let reached = 0;
  for (const ch of digits) reached += fire(ch);
  reached += fire('Enter');
  P.flush();
  return reached > 0;
}

/* ───────────────────────── 모형(자기시험용) ───────────────────────── */
const MODEL_OK = `
var pad2 = function(n){ return String(n).padStart(2,'0'); };
function kstParts(d){ var k = new Date((d ? d.getTime() : Date.now()) + 9*3600000);
  return { y:k.getUTCFullYear(), m:k.getUTCMonth(), d:k.getUTCDate() }; }
function dayKey(d){ var k = kstParts(d); return k.y + '-' + pad2(k.m+1) + '-' + pad2(k.d); }
var DAILY_EPOCH = Date.UTC(2026, 7, 23);
function dailyNo(d){ var k = kstParts(d); return Math.floor((Date.UTC(k.y,k.m,k.d) - DAILY_EPOCH)/86400000) + 1; }
function hashStr(s){ var h = 2166136261 >>> 0; for (var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function answerFor(key){
  var r = mulberry32(hashStr('nb|' + key));
  var pool = [0,1,2,3,4,5,6,7,8,9], out = '';
  for (var i=0;i<4;i++){ var j = Math.floor(r() * pool.length); out += pool.splice(j,1)[0]; }
  return out;
}
function judge(ans, g){ var s=0,b=0; for (var i=0;i<4;i++){ if (g[i]===ans[i]) s++; else if (ans.indexOf(g[i])>=0) b++; }
  return { s:s, b:b, out:(s===0&&b===0) }; }
var ST = { answer: answerFor(dayKey()), tries: 0, maxTries: 10, guesses: [], over:false, won:false, note:'', running:false };
var buf = '';
/* ★제품과 같은 모양 — 시작 버튼을 눌러야 판이 열리고, 그 전에는 입력을 무시한다. */
document.getElementById('btnDaily').addEventListener('click', function(){ ST.running = true; });
document.addEventListener('keydown', function(e){
  if (!ST.running || ST.over) return;
  if (/^[0-9]$/.test(e.key)){ if (buf.length < 4) buf += e.key; return; }
  if (e.key === 'Enter'){
    if (buf.length !== 4){ ST.note = 'short'; return; }
    if (new Set(buf.split('')).size !== 4){ ST.note = 'dupe'; buf=''; return; }
    var v = judge(ST.answer, buf);
    ST.tries++; ST.guesses.push({ g: buf, s: v.s, b: v.b });
    if (v.s === 4){ ST.won = true; ST.over = true; }
    else if (ST.tries >= ST.maxTries){ ST.over = true; }
    buf = '';
  }
});
window.__nb = { dayKey: dayKey, dailyNo: dailyNo, answerFor: answerFor, judge: judge,
  state: function(){ return { answer: ST.answer, tries: ST.tries, maxTries: ST.maxTries,
    guesses: ST.guesses.slice(), over: ST.over, won: ST.won, note: ST.note,
    running: ST.running }; } };
`;
/* 위반 모형 — 각각 ★한 가지만 어긋난다(겨냥한 검사만 붉어야 한다) */
const MODEL_BAD = {
  'seed-has-clock': MODEL_OK.replace("mulberry32(hashStr('nb|' + key))",
    "mulberry32(hashStr('nb|' + key + '|' + Date.now()))"),
  'play-consumes-rng': MODEL_OK.replace("var v = judge(ST.answer, buf);",
    "var v = judge(ST.answer, buf); var _noise = Math.random();"),
  'dupe-consumes-try': MODEL_OK.replace("if (new Set(buf.split('')).size !== 4){ ST.note = 'dupe'; buf=''; return; }",
    "if (new Set(buf.split('')).size !== 4){ ST.note = 'dupe'; ST.tries++; buf=''; return; }"),
  'answer-allows-repeat': MODEL_OK.replace(
    "var pool = [0,1,2,3,4,5,6,7,8,9], out = '';\n  for (var i=0;i<4;i++){ var j = Math.floor(r() * pool.length); out += pool.splice(j,1)[0]; }",
    "var out = '';\n  for (var i=0;i<4;i++){ out += Math.floor(r() * 10); }"),
  'judge-ball-wrong': MODEL_OK.replace("else if (ans.indexOf(g[i])>=0) b++;", "else if (ans.indexOf(g[i])>0) b++;"),
  'max-tries-12': MODEL_OK.replace('maxTries: 10', 'maxTries: 12'),
  'time-retry': MODEL_OK.replace("  var r = mulberry32(hashStr('nb|' + key));",
    "  var r = mulberry32(hashStr('nb|' + key));\n  var deadline = Date.now() + 5; while (Date.now() > deadline) { r(); }")
};

/* ───────────────────────── 실행 ───────────────────────── */
function printAndExit(title){
  console.log(title);
  for (const l of lines) console.log(l);
  console.log(`결과: 통과 ${pass} · 미달 ${fail}` + (indetMsg ? ` · 판정 불가(${indetMsg})` : ''));
  if (indetMsg) process.exit(2);
  process.exit(fail ? 1 : 0);
}

if (has('--list-mutations')){
  console.log('변이 목록(모형 기반 자기시험용):');
  for (const k of Object.keys(MODEL_BAD)) console.log('  ' + k);
  process.exit(0);
}

if (has('--selftest')){
  /* ★탐지력 자기시험 — 제품이 없어도 이 검사가 무엇을 잡는지 보인다. */
  console.log('=== 숫자야구 검증기 자기시험(모형 기반 · 제품 없이 탐지력 증명) ===');
  const rows = [];
  for (const [name, src] of [['MODEL_OK(준법)', MODEL_OK], ...Object.entries(MODEL_BAD)]){
    pass = 0; fail = 0; lines.length = 0; indetMsg = null;
    runAssertions(src, name);
    rows.push({ name, pass, fail, detail: lines.filter(l => l.startsWith('  ✗')).map(l => l.slice(4)) });
  }
  const w = Math.max(...rows.map(r => r.name.length));
  let bad = 0;
  for (const r of rows){
    const wantRed = r.name !== 'MODEL_OK(준법)';
    const isRed = r.fail > 0;
    const good = wantRed === isRed;
    if (!good) bad++;
    console.log(`${r.name.padEnd(w)} | 통과 ${String(r.pass).padStart(2)} · 미달 ${String(r.fail).padStart(2)} | ` +
      (good ? 'PASS' : '★FAIL') + (r.detail.length ? ' | 붉은 검사: ' + r.detail.map(d => d.split(' — ')[0]).join(' / ') : ''));
  }
  console.log();
  console.log(`분모: 모형 ${rows.length}개(준법 1 + 위반 ${rows.length - 1}) · 기대 어긋남 ${bad}건`);
  console.log(`판정: ${bad === 0 ? 'ALL AS PREDICTED — 준법은 초록 · 위반은 붉다' : '★예측과 다르다'}`);
  process.exit(bad === 0 ? 0 : 1);
}

/* 제품 팔 */
let RAW = null;
try { RAW = fs.readFileSync(HTML, 'utf8'); }
catch (e) { console.log('=== 숫자야구 검증기 ===');
  console.log(`  ‽ 대상을 읽지 못했다: ${HTML}`);
  console.log('결과: 통과 0 · 미달 0 · 판정 불가(제품 파일이 없다 — ★통과로 세지 않는다)');
  process.exit(2); }

let SRC = inlineScript(RAW);
if (!SRC){ console.log('=== 숫자야구 검증기 ===');
  console.log('  ‽ window.__nb 를 여는 인라인 <script> 를 찾지 못했다');
  console.log('결과: 판정 불가'); process.exit(2); }

const MUT = valOf('--mutate', null);
if (MUT){
  const table = {
    'seed-has-clock': [/mulberry32\(hashStr\(SEED_NS \+ key\)\)/, "mulberry32(hashStr(SEED_NS + key + '|' + Date.now()))"],
    'play-consumes-rng': [/const v = judge\(ST\.answer, g\);/, 'const v = judge(ST.answer, g); void Math.random();'],
    'dupe-consumes-try': [/ST\.note = 'dupe';/, "ST.note = 'dupe'; ST.tries++;"],
    'max-tries-12': [/const MAX_TRIES = 10;/, 'const MAX_TRIES = 12;'],
    'judge-ball-wrong': [/else if \(ans\.indexOf\(g\[i\]\) >= 0\) b\+\+;/, 'else if (ans.indexOf(g[i]) > 0) b++;']
  };
  const ent = table[MUT];
  if (!ent){ console.log(`주입 실패 — 모르는 변이: ${MUT}`); process.exit(2); }
  const hits = SRC.match(new RegExp(ent[0].source, 'g'));
  if (!hits || hits.length !== 1){
    console.log(`주입 실패 — 앵커가 유일하지 않다(${hits ? hits.length : 0}건): ${MUT}`); process.exit(2);
  }
  SRC = SRC.replace(ent[0], ent[1]);
  console.log(`=== 숫자야구 검증기 · 변이 주입: ${MUT} ===`);
} else {
  console.log('=== 숫자야구 검증기 (제품) ===');
}
runAssertions(SRC, '제품');
printAndExit('');
