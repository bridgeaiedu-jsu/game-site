#!/usr/bin/env node
/* verify_stop.js — 「멈춰!」 검증 (겹치는 순간을 어떻게 재고, 판을 언제 확정하는가)
 *
 * `stop/index.html` 의 인라인 스크립트를 **그대로 꺼내** 최소 DOM 스텁 위에서 돌리고, 제품이
 * 실제로 듣는 입력 사건(pointerdown·keydown)으로 판을 두드린다. 시험용 뒷문은 제품에 두지
 * 않는다 — 배포본의 `window.__st` 는 읽기 전용 창구이고, 이 검사기는 판정에 쓰는 셈을
 * **자기 것으로 따로 들고 와** 대조한다(같은 함수로 두 번 재면 자기채점이다).
 *
 * 이 게임에 실린 약속은 넷이고, 검사의 무게는 거기에 있다.
 *   ① **위치는 프레임 수가 아니라 경과 시간의 함수다.** 기기가 느리든 탭이 가려지든 같은
 *      두 도장이면 같은 판정이 나와야 한다.
 *   ② **판은 시작할 때 통째로 확정된다.** 종류의 차례·목표·속도·방향·허용폭까지 전부.
 *      플레이는 난수를 단 한 번도 당기지 않는다.
 *   ③ **환산 점수 옆에 원값이 함께 있다.** 라운드마다 허용폭 대비 0~100 으로 환산하되,
 *      몇 px·몇 도 벗어났는지를 숨기지 않는다.
 *   ④ **동작 줄이기는 연출만 줄인다.** 속도·허용폭·점수·판정에는 닿지 않는다.
 *
 * 사용법:
 *   node tools/verify_stop.js                         # 대조군(기본 대상 = 이 저장소의 stop/index.html)
 *   node tools/verify_stop.js --html stop/index.html
 *   node tools/verify_stop.js --list-mutations
 *   node tools/verify_stop.js --mutate m-frame-clock  # 검출력 확인(임시 사본에만 주입)
 *
 * 종료코드: 0 = 전부 통과 · 1 = 미달 있음 · 2 = 검사를 세울 수 없음(하네스·주입 실패).
 * ★뮤테이션을 걸면 '지목한 검사가 잡았는가' 까지 이 도구가 스스로 판정한다 — 지목한 검사가
 *   아예 돌지 않았으면(앵커 노후화) rc=2 로 멈춘다. 무임승차를 인정하지 않기 위해서다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = n => argv.indexOf(n) >= 0;

const HTML = argOf('--html', path.join(__dirname, '..', 'stop', 'index.html'));
const MUTATION = argOf('--mutate', null);

let RAW;
try { RAW = fs.readFileSync(HTML, 'utf8'); }
catch (e){ console.error('대상 파일을 읽지 못했다: ' + HTML); process.exit(2); }
/* ★배포 파일은 CRLF 다. 아래 정적 대조·뮤테이션 앵커는 전부 LF 로 적혀 있으므로 한 번만 갈아
   끼운다 — 빠뜨리면 여러 줄 앵커가 통째로 어긋나 '주입 실패' 로 떨어진다. 줄끝은 판정 대상이 아니다. */
RAW = RAW.split('\r\n').join('\n');

/* ------------------------------------------------------------ 게임 스크립트 꺼내기 */
function gameSource(html){
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))){
    const attrs = m[1] || '';
    if (/\ssrc=/.test(attrs)) continue;
    if (/type\s*=\s*"application\/ld\+json"/.test(attrs)) continue;
    out.push(m[2]);
  }
  return out.find(s => s.indexOf('window.__st') >= 0) || null;
}
let SRC = gameSource(RAW);
if (!SRC){ console.error('게임 스크립트(window.__st 를 여는 인라인 <script>)를 찾지 못했다'); process.exit(2); }

/* ------------------------------------------------------------ 뮤테이션(고의 결함 · 임시 사본에만)
   각 항목은 '어느 검사가 이것을 잡아야 하는가'(catcher)를 함께 못박는다 — 다른 검사가 우연히
   깨져서 붉어지는 무임승차를 인정하지 않기 위해서다. */
const MUTATIONS = {
  'm-frame-clock': {
    why: '대상의 위치를 경과 시간이 아니라 프레임 콜백 누적으로 만든다(느린 기기·가려진 탭에서 값이 갈린다)',
    catcher: '기기 사정이 달라도 같은 도장이면 같은 판정이다',
    where: 'js',
    apply: s => s.replace('function valueAt(r, t){\n  const sec = (t > 0 ? t : 0) / 1000;',
                          'let __frames = 0; const __fl = () => { __frames++; requestAnimationFrame(__fl); }; requestAnimationFrame(__fl);\n' +
                          'function valueAt(r, t){\n  const sec = __frames * 0.0167;')
  },
  'm-interval': {
    why: 'setInterval 로 진행을 센다',
    catcher: 'setInterval 을 쓰지 않는다',
    where: 'js',
    apply: s => s.replace('function startLoop(){ if (!rafId) rafId = requestAnimationFrame(loop); }',
                          'function startLoop(){ if (!rafId) rafId = requestAnimationFrame(loop); setInterval(() => {}, 50); }')
  },
  'm-play-consumes-rng': {
    why: '라운드를 시작할 때마다 난수를 당긴다(같은 seed 인데 사람마다 판이 갈라진다)',
    catcher: '플레이 중 Math.random 도 부르지 않았다',
    where: 'js',
    apply: s => s.replace('  phase = \'running\';\n  roundT0 = nowMs();',
                          '  phase = \'running\';\n  board[roundIdx].speed += Math.random() * 0.0001;\n  roundT0 = nowMs();')
  },
  'm-tol-drift': {
    why: '결과에 적는 허용폭을 판의 값이 아니라 그 라운드에서 벗어난 양에 맞춰 적는다(허용폭이 플레이 결과로 바뀐다)',
    catcher: '허용폭은 판을 짤 때 확정되고 플레이로 바뀌지 않는다',
    where: 'js',
    apply: s => s.replace('  results.push({ kind: r.kind, diff, score, tol: r.tol,',
                          '  results.push({ kind: r.kind, diff, score, tol: (missed ? r.tol : diff * 1.5),')
  },
  'm-board-drift': {
    why: '누를 때마다 판(속도)을 슬쩍 고친다 — 난수를 당기지는 않지만 판이 플레이로 달라진다',
    catcher: '판 자체가 처음 그대로다(허용폭 포함)',
    where: 'js',
    apply: s => s.replace('  phase = \'gap\';\n  results.push(',
                          '  phase = \'gap\';\n  board[roundIdx].speed *= 1.0001;\n  results.push(')
  },
  'm-tol-narrow': {
    why: '허용폭을 기획안 예시가 정한 눈금보다 훨씬 좁게 잡는다(3px 차이가 97점이 되지 않는다)',
    catcher: '기획안 예시대로 지점 3px 차이가 97점 언저리다(≥95점)',
    where: 'js',
    apply: s => s.replace('const TOL_SPOT = [88, 112];', 'const TOL_SPOT = [10, 18];')
  },
  'm-kind-runtime': {
    why: '라운드 종류를 판을 짤 때가 아니라 라운드를 시작할 때 고른다(유형 배치가 난수 소비가 된다)',
    catcher: '한 판의 구성이 지점2·크기2·각도1 이다',
    where: 'js',
    apply: s => s.replace('    out.push({ kind, target, tol, speed, dir, start });',
                          '    out.push({ kind: (i === 4 ? \'spot\' : kind), target, tol, speed, dir, start });')
  },
  'm-order-fixed': {
    why: '종류의 차례를 seed 로 섞지 않고 늘 같은 순서로 둔다',
    catcher: '종류의 차례도 seed 가 정한다',
    where: 'js',
    apply: s => s.replace('  const kinds = KINDS.slice();\n  for (let i = kinds.length - 1; i > 0; i--){',
                          '  const kinds = KINDS.slice();\n  for (let i = -1; i > 0; i--){')
  },
  'm-score-not-normalized': {
    why: '허용폭 대비 정규화를 버리고 벗어난 값을 100 에서 그냥 뺀다(라운드마다 다른 기준이 사라진다)',
    catcher: '환산 점수가 허용폭 대비 정규화다(독립 재계산과 일치)',
    where: 'js',
    apply: s => s.replace('  return Math.round((1 - diff / tol) * 1000) / 10;',
                          '  return Math.round((100 - diff) * 10) / 10;')
  },
  'm-avg-not-mean': {
    why: '다섯 라운드의 평균 대신 가장 좋은 라운드를 최종 점수로 쓴다',
    catcher: '최종 점수가 다섯 라운드의 평균이다',
    where: 'js',
    apply: s => s.replace('  const avg = mean(scores);',
                          '  const avg = scores.length ? Math.max.apply(null, scores) : 0;')
  },
  'm-no-raw-value': {
    why: '결과에서 원값(몇 px·몇 도)을 지우고 환산 점수만 남긴다',
    catcher: '결과에 환산 점수와 원값이 함께 나온다',
    where: 'js',
    apply: s => s.replace("    roundVal: (d, u, s) => `${d}${u} · ${s}점`,",
                          "    roundVal: (d, u, s) => `${s}점`,")
  },
  'm-double-press': {
    why: '라운드가 끝난 뒤에도 같은 입력을 계속 받아들인다(연타가 낡은 상태 위에서 실행된다)',
    catcher: '라운드가 끝난 뒤의 연타는 아무 일도 하지 않는다',
    where: 'js',
    /* ★겨냥할 곳을 고르는 데 두 번 틀렸고, 그 두 번이 이 뮤테이션의 모양을 정했다.
       이 방어는 **두 겹**이다 — `onPress` 의 이른 반환과 `endRound` 첫 줄의 같은 조건.
       한쪽만 지우면 남은 쪽이 그대로 막아 **관측 가능한 변화가 0** 이고(둘 다 실측으로 미탐지),
       그런 뮤테이션은 검사기가 아니라 뮤테이션이 공허한 것이다. 그래서 **두 겹을 함께** 걷어낸다 —
       이것이 '연타를 막는 방어가 없는 제품' 이라는 결함의 진짜 모양이다.
       ★한쪽 앵커만 맞은 반쪽 주입은 주입 실패로 되돌린다(반쯤 깨진 사본으로 검출력을 논하지 않는다). */
    apply: s => {
      const A = "  if (phase !== 'running') return;      /* 라운드 사이·결과 중의 연타는 다음 라운드를 앞당기지 않는다 */\n";
      const B = "function endRound(stamp){\n  if (phase !== 'running') return;\n";
      const a = s.replace(A, '');
      if (a === s) return s;
      const b = a.replace(B, 'function endRound(stamp){\n');
      if (b === a) return s;
      return b;
    }
  },
  'm-no-limit': {
    why: '10초 제한을 없앤다(누르지 않으면 판이 끝나지 않는다)',
    catcher: '10초가 지나면 0점으로 넘어간다',
    where: 'js',
    apply: s => s.replace('  limitTimer = setTimeout(() => { limitTimer = 0; endRound(null); }, ROUND_LIMIT_MS);\n', '')
  },
  'm-reduce-changes-speed': {
    why: '동작 줄이기에서 속도를 반으로 낮춘다(판정이 설정에 따라 갈린다)',
    catcher: '동작 줄이기가 판정·허용폭·점수에 닿지 않는다',
    where: 'js',
    apply: s => s.replace('function valueAt(r, t){\n  const sec = (t > 0 ? t : 0) / 1000;',
                          'function valueAt(r, t){\n  const sec = (t > 0 ? t : 0) / 1000 * (reduceMotion() ? 0.5 : 1);')
  },
  'm-fast-blink': {
    why: '초당 3회를 넘는 깜빡임을 넣는다(WCAG 2.3.1 위반)',
    catcher: '초당 3회를 넘는 깜빡임이 없다',
    where: 'html',
    apply: s => s.replace('  .pad:active{transform:scale(.995)}',
                          '  .pad:active{transform:scale(.995)}\n  @keyframes bl{0%{opacity:1}50%{opacity:0}100%{opacity:1}}\n  .padcap{animation:bl .2s linear infinite}')
  },
  'm-slider': {
    why: '슬라이더 입력을 되살린다(「눈대중」과 같은 게임이 된다)',
    catcher: '슬라이더·수치 입력이 없다',
    where: 'html',
    apply: s => s.replace('    <p class="padcap" id="padCap">',
                          '    <input type="range" id="guess" min="0" max="100">\n    <p class="padcap" id="padCap">')
  },
  'm-no-again': {
    why: '결과 화면의 「다시 하기」가 아무 일도 하지 않게 만든다(한 번의 조작으로 다음 판이 시작되지 않는다)',
    catcher: '결과 화면에서 한 번의 조작으로 다음 판이 시작된다',
    where: 'js',
    apply: s => s.replace("$('btnAgain').onclick = () => {\n  hide('over');",
                          "$('btnAgain').onclick = () => {\n  return;\n  hide('over');")
  },
  'm-field-scale': {
    why: '판 크기를 화면 폭에 따라 늘린다(원값 px 이 기기마다 달라진다)',
    catcher: '판 크기가 300 으로 고정이다',
    where: 'js',
    apply: s => s.replace('const FIELD = 300;', 'const FIELD = (typeof window !== "undefined" && window.innerWidth) ? window.innerWidth : 300;')
  }
};
if (has('--list-mutations')){
  for (const k of Object.keys(MUTATIONS)) console.log(k.padEnd(24) + ' — ' + MUTATIONS[k].why + '  [잡아야 하는 검사: ' + MUTATIONS[k].catcher + ']');
  process.exit(0);
}
let HTML_TEXT = RAW;
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  if (!m){ console.error('그런 뮤테이션이 없다: ' + MUTATION); process.exit(2); }
  if (m.where === 'js'){
    const before = SRC;
    SRC = m.apply(SRC);
    if (SRC === before){ console.error('주입 실패(앵커 노후화): ' + MUTATION); process.exit(2); }
  } else {
    const before = HTML_TEXT;
    HTML_TEXT = m.apply(HTML_TEXT);
    if (HTML_TEXT === before){ console.error('주입 실패(앵커 노후화): ' + MUTATION); process.exit(2); }
  }
}

/* ------------------------------------------------------------ 저장소 스텁 */
function makeStore(seed){
  const map = new Map(seed || []);
  return {
    _map: map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    clear: () => map.clear(),
    keys: () => [...map.keys()]
  };
}

/* ------------------------------------------------------------ DOM 스텁 */
function makeEl(id, doc, tag){
  const el = {
    id, tagName: (tag || 'DIV').toUpperCase(), dataset: {}, _text: '', innerHTML: '',
    children: [], _attrs: {}, _classes: new Set(), _on: {}, disabled: false, onclick: null,
    hidden: false, tabIndex: -1, parent: null,
    style: { _p: {}, setProperty(k, v){ this._p[k] = v; }, getPropertyValue(k){ return this._p[k]; } },
    classList: {
      add: c => el._classes.add(c), remove: c => el._classes.delete(c),
      contains: c => el._classes.has(c),
      toggle: (c, on) => { if (on === undefined){ el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c); }
                           else if (on) el._classes.add(c); else el._classes.delete(c); }
    },
    setAttribute: (k, v) => { el._attrs[k] = String(v); },
    getAttribute: k => (k in el._attrs ? el._attrs[k] : null),
    removeAttribute: k => { delete el._attrs[k]; },
    hasAttribute: k => k in el._attrs,
    addEventListener: (t, fn) => { (el._on[t] = el._on[t] || []).push(fn); },
    removeEventListener: t => { delete el._on[t]; },
    querySelectorAll: sel => el._descend().filter(c => matchesSel(c, sel)),
    querySelector: sel => el._descend().find(c => matchesSel(c, sel)) || null,
    closest: sel => { let n = el; while (n){ if (matchesSel(n, sel)) return n; n = n.parent || null; } return null; },
    matches: sel => matchesSel(el, sel),
    focus: () => { doc.activeElement = el; }, blur: () => {},
    appendChild: c => { el.children.push(c); c.parent = el; return c; },
    _descend: () => { const out = []; const walk = n => { for (const c of n.children){ out.push(c); walk(c); } }; walk(el); return out; }
  };
  Object.defineProperty(el, 'textContent', {
    get(){ return el._text; },
    set(v){ el._text = String(v); if (String(v) === '') el.children.length = 0; }
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
    if (s === 'button' && el.tagName === 'BUTTON') return true;
    if (s === '[data-i18n]' && el.dataset.i18n !== undefined) return true;
    if (s === 'a[href="/"]' && el.tagName === 'A') return true;
    if (s.startsWith('a[href]') && el.tagName === 'A') return true;
    if (s.indexOf('button:not(') === 0 && el.tagName === 'BUTTON' && !el.disabled && !el.hidden) return true;
    if (s === '.overlay' && el._classes.has('overlay')) return true;
  }
  return false;
}
function HTMLElementStub(){}

const IDS = ['pad','cv','padCap','capMain','capSub','bestNow','roundNow','streakNowEl','modeChip','kindChip',
             'srSummary','toast','over','start','finalAvg','finalSub','roundList','streakLine','newBest',
             'nAvg','nTop','nMiss','btnAgain','btnShare','btnDaily','btnStart','dailyHint',
             'btnSound','btnSound2','btnLang','btnLang2','subtitle','adTop','adOver',
             'startTitle','overTitle','help'];

/* ★샌드박스로 들어가는 난수는 주변 환경의 진짜 Math.random 이 아니라 우리가 쥔 결정론 수열이다.
   호출마다 값이 달라야 하고(고정하면 '연습 모드는 매번 다른 판' 이 공허해진다) boot 사이에도
   이어지는 하나의 수열이어야 한다(세션마다 되감으면 '다른 세션은 다른 판' 이 같은 방식으로 공허해진다). */
let __randState = 0x9E3779B9;
const seededRandom = () => {
  __randState = (__randState + 0x6D2B79F5) | 0;
  let t = Math.imul(__randState ^ __randState >>> 15, 1 | __randState);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

/* ------------------------------------------------------------ 캔버스 스텁(연출 관측용)
   그리기 명령을 낱낱이 적어 둔다 — '동작 줄이기에서 연출이 실제로 줄었는가' 와
   '그래도 주된 표식의 자리는 같은가' 를 같은 판에서 함께 재기 위해서다. */
function makeCtx(log){
  const rec = (name) => function(){ log.push([name].concat([].slice.call(arguments).map(v => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)).join(' ')); };
  return {
    globalAlpha: 1, strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: '',
    setTransform: rec('setTransform'), clearRect: rec('clearRect'),
    beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'),
    arc: rec('arc'), stroke: rec('stroke'), fill: rec('fill'),
    closePath: rec('closePath'), setLineDash: rec('setLineDash')
  };
}

/* 스텁 위에 세운 한 판(세션). 시계·타이머·난수를 전부 우리가 쥔다. */
function boot(opts){
  opts = opts || {};
  const localStorage = opts.store || makeStore();
  const els = new Map();
  const drawLog = [];

  /* --- 우리가 쥔 시계 --- */
  let clock = (opts.t0 === undefined) ? 1000 : opts.t0;
  let nowCalls = 0;
  const performanceStub = { now: () => { nowCalls++; return clock; } };

  /* --- 타이머 장부 --- ★rAF 는 한 번만 부른다(다시 걸어 주는 것은 제품의 몫이다) */
  let seq = 1;
  const timers = new Map();
  let intervalCalls = 0, rafCalls = 0;
  const setTimeoutStub = (fn, ms) => { const id = seq++; timers.set(id, { fn, at: clock + (ms || 0) }); return id; };
  const clearTimeoutStub = id => { timers.delete(id); };
  const setIntervalStub = (fn, ms) => { intervalCalls++; const id = seq++; timers.set(id, { fn, at: clock + (ms || 0), every: ms || 1 }); return id; };
  const clearIntervalStub = id => { timers.delete(id); };
  const rafStub = fn => { rafCalls++; const id = seq++; timers.set(id, { fn, at: clock + 16, raf: true }); return id; };

  const doc = {
    documentElement: null, body: null, activeElement: null, hidden: false, title: '',
    _on: {},
    getElementById: id => { if (!els.has(id)) els.set(id, makeEl(id, doc)); return els.get(id); },
    querySelectorAll: sel => [...els.values()].filter(e => matchesSel(e, sel))
                                .concat([...els.values()].flatMap(e => e._descend().filter(c => matchesSel(c, sel)))),
    querySelector: sel => doc.querySelectorAll(sel)[0] || null,
    createElement: t => makeEl('new_' + t, doc, t),
    addEventListener: (t, fn) => { (doc._on[t] = doc._on[t] || []).push(fn); },
    removeEventListener: t => { delete doc._on[t]; }
  };
  doc.documentElement = makeEl('html', doc);
  doc.body = makeEl('body', doc);
  for (const id of IDS) doc.getElementById(id);
  doc.getElementById('over')._classes.add('overlay');
  doc.getElementById('start')._classes.add('overlay');
  doc.getElementById('start')._classes.add('show');
  doc.getElementById('pad').tagName = 'BUTTON';
  const cvEl = doc.getElementById('cv');
  cvEl.tagName = 'CANVAS';
  cvEl.getContext = () => (opts.noCanvas ? null : makeCtx(drawLog));
  for (const k of ['title','subtitle','hint','how1','dailyDesc','statPlays','motionNote']){
    const e = makeEl('i18n_' + k, doc, 'p'); e.dataset.i18n = k; els.set('i18n_' + k, e);
  }
  els.set('home', makeEl('home', doc, 'a'));

  let randCalls = 0;
  const MathStub = Object.create(Math);
  MathStub.random = () => { randCalls++; return seededRandom(); };

  const nav = { language: opts.lang === 'en' ? 'en-US' : 'ko-KR' };
  function PointerEventStub(){}
  const win = {
    addEventListener: () => {}, removeEventListener: () => {},
    navigator: nav, localStorage,
    matchMedia: () => ({ matches: !!opts.reduceMotion }),
    location: { href: 'https://hanpango.com/stop/' },
    PointerEvent: PointerEventStub,
    performance: performanceStub,
    devicePixelRatio: opts.dpr || 1,
    innerWidth: opts.innerWidth || 1024,
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    HTMLElement: HTMLElementStub, document: doc
  };
  const sandbox = {
    window: win, document: doc, localStorage, navigator: nav,
    HTMLElement: HTMLElementStub, location: win.location, performance: performanceStub,
    PointerEvent: PointerEventStub,
    getComputedStyle: () => ({ getPropertyValue: () => '#123456' }),
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    setInterval: setIntervalStub, clearInterval: clearIntervalStub,
    requestAnimationFrame: rafStub, cancelAnimationFrame: clearTimeoutStub,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Math: MathStub, Date: opts.Date || Date, JSON, Promise,
    Number, String, Array, Object, RegExp, Error, TypeError, isNaN, isFinite, parseInt, parseFloat
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(SRC, sandbox, { filename: 'stop-inline.js' }); }
  catch (e){ console.error('구동 실패: ' + (e && e.stack || e)); process.exit(2); }
  if (!win.__st){ console.error('관측 창구(window.__st)가 없다'); process.exit(2); }

  const pad = doc.getElementById('pad');
  const fire = (el, type, ev) => {
    const list = (el._on && el._on[type]) || [];
    for (const fn of list) fn(ev);
    return list.length;
  };
  const api = {
    st: win.__st, doc, store: localStorage, els, drawLog,
    setClock: t => { clock = t; },
    advance: ms => { clock += ms; },
    clock: () => clock,
    nowCalls: () => nowCalls, resetNowCalls: () => { nowCalls = 0; },
    rand: () => randCalls,
    intervals: () => intervalCalls,
    rafs: () => rafCalls,
    pending: () => timers.size,
    /* 지금 시각까지 도달한 타이머를 실제로 돌린다(밀린 콜백·느린 기기 흉내).
       ★rAF 는 되걸지 않는다 — 제품이 스스로 다시 걸어야 이어진다. */
    flush: (max) => {
      let n = 0;
      for (let i = 0; i < (max || 60); i++){
        const due = [...timers.entries()].filter(([, t]) => t.at <= clock).sort((a, b) => a[1].at - b[1].at);
        if (!due.length) break;
        for (const [id, t] of due){
          timers.delete(id);
          if (t.every) timers.set(seq++, { fn: t.fn, at: clock + t.every, every: t.every });
          try { t.fn(clock); } catch (e){}
          n++;
          if (n > 800) return n;
        }
      }
      return n;
    },
    txt: id => doc.getElementById(id).textContent,
    el: id => doc.getElementById(id),
    rowsText: () => doc.getElementById('roundList').children.map(r => r.children.map(c => c.textContent).join(' ')),
    pressPointer: (at, opt) => {
      if (at !== undefined) clock = at;
      const ev = { type: 'pointerdown', button: 0, timeStamp: (opt && opt.stamp !== undefined) ? opt.stamp : clock,
                   target: pad, preventDefault(){ ev._pd = true; } };
      const n = fire(pad, 'pointerdown', ev);
      if (!n) throw new Error('pad 에 pointerdown 리스너가 없다');
      return ev;
    },
    pressKey: (at, key, opt) => {
      if (at !== undefined) clock = at;
      const ev = { type: 'keydown', key: key || ' ', repeat: !!(opt && opt.repeat),
                   ctrlKey:false, metaKey:false, altKey:false,
                   timeStamp: (opt && opt.stamp !== undefined) ? opt.stamp : clock,
                   target: (opt && opt.target) || pad, preventDefault(){ ev._pd = true; } };
      fire(doc, 'keydown', ev);
      return ev;
    },
    clickPad: (at) => {
      if (at !== undefined) clock = at;
      const ev = { type: 'click', button: 0, timeStamp: clock, target: pad, preventDefault(){} };
      return fire(pad, 'click', ev);   /* 0 이어야 정상 — 판은 click 을 듣지 않는다 */
    },
    clickBtn: id => { const b = doc.getElementById(id); if (typeof b.onclick === 'function') b.onclick({ target: b }); return b; },
    snapshot: () => {
      const parts = [];
      const one = e => parts.push([e.id, e.tagName, e.textContent, e.className,
                                   JSON.stringify(e._attrs), e.hidden ? 1 : 0].join(''));
      one(doc.body); one(doc.documentElement);
      for (const e of [...els.values()].sort((a, b) => a.id < b.id ? -1 : 1)){ one(e); for (const c of e._descend()) one(c); }
      parts.push('title=' + doc.title);
      return parts.join('');
    },
    hidden: v => { doc.hidden = v; }
  };
  return api;
}

/* ------------------------------------------------------------ ★독립 셈 (자기채점 금지)
   제품의 함수를 부르지 않고 **여기서 다시 계산한다.** 같은 함수로 두 번 재면 증거가 되지 못한다.
   아래 상수는 이 파일이 리터럴로 쥔 기대값이며, 제품에서 파생시키지 않는다. */
const EXP = {
  FIELD: 300, TRACK_X0: 30, TRACK_X1: 270, TRACK_LEN: 240, TRACK_Y: 150,
  CX: 150, CY: 150, RMIN: 22, RMAX: 124, ROUNDS: 5, ROUND_LIMIT_MS: 10000, GAP_MS: 800,
  KINDS_COUNT: { spot: 2, size: 2, angle: 1 }
};
function xTri(p){ const q = ((p % 2) + 2) % 2; return q <= 1 ? q : 2 - q; }
function xValue(r, t){
  const sec = (t > 0 ? t : 0) / 1000;
  if (r.kind === 'spot') return xTri(r.start + r.dir * r.speed * sec / EXP.TRACK_LEN);
  if (r.kind === 'size') return EXP.RMIN + xTri((r.start - EXP.RMIN) / (EXP.RMAX - EXP.RMIN) + r.dir * r.speed * sec / (EXP.RMAX - EXP.RMIN)) * (EXP.RMAX - EXP.RMIN);
  return ((r.start + r.dir * r.speed * sec) % 360 + 360) % 360;
}
function xDiff(r, t){
  const v = xValue(r, t);
  if (r.kind === 'spot') return Math.abs(v - r.target) * EXP.TRACK_LEN;
  if (r.kind === 'size') return Math.abs(v - r.target);
  const d = Math.abs(v - r.target) % 360;
  return d > 180 ? 360 - d : d;
}
function xScore(diff, tol){
  if (!(tol > 0)) return 0;
  if (diff >= tol) return 0;
  return Math.round((1 - diff / tol) * 1000) / 10;
}
const xMean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

/* ------------------------------------------------------------ 함수 본문 떼어내기(정적 검사용)
   중괄호를 세어 함수 하나의 본문만 꺼낸다. 완전한 파서가 아니라 이 파일 하나를 읽기 위한
   최소한의 것이고, 머리글이 안 보이면 **통과가 아니라 판정 불가**로 올린다. */
function funcBody(src, header){
  const i = src.indexOf(header);
  if (i < 0) return null;
  let j = src.indexOf('{', i);
  if (j < 0) return null;
  let depth = 0;
  for (let k = j; k < src.length; k++){
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}'){ depth--; if (depth === 0) return src.slice(j, k + 1); }
  }
  return null;
}

/* ------------------------------------------------------------ 채점판 */
let pass = 0, fail = 0, indet = 0;
const failures = [];
const seen = new Set();
function ok(name, cond, detail){
  seen.add(name);
  if (cond){ pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
/* ★판정 불가는 통과로 세지 않는다 — 별도로 세고 종료코드를 2 로 올린다. */
function cannot(name, why){ seen.add(name); indet++; console.log('  INDET ' + name + ' — ' + why); }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
const near = (name, got, want, tol) => ok(name, Math.abs(got - want) <= tol, 'got=' + got + ' want=' + want);
const section = t => console.log('\n[' + t + ']');
const note = t => console.log('    · ' + t);

/* 한 라운드를 눌러서 끝내고 다음 라운드로 넘어간다(라운드 사이 쉼까지 흘려 보낸다) */
function playRound(g, afterMs){
  const t0 = g.st.state().roundT0;
  g.setClock(t0 + afterMs);
  g.pressPointer(t0 + afterMs);
  g.advance(EXP.GAP_MS + 5);
  g.flush();
}
function startPractice(g){ g.clickBtn('btnStart'); }
/* ★두 세션의 판을 **같게** 두어야 하는 검사는 반드시 이 문을 쓴다.
   연습 모드는 (설계대로) 세션마다 다른 판을 짜므로, 연습 모드로 두 세션을 비교하면
   무엇을 재든 '다르다' 가 나온다 — 대상이 아니라 측정 조건이 만든 거짓 고장이다. */
function startDaily(g){ g.clickBtn('btnDaily'); }
/* 날짜를 못박은 시계 — 오늘의 판이 실행 시각(자정 넘김)에 흔들리지 않게 한다 */
function fixedDate(ms){
  const R = Date;
  function D(a, b, c, d, e, f, g2){
    if (arguments.length === 0) return new R(ms);
    if (arguments.length === 1) return new R(a);
    return new R(a, b, c || 1, d || 0, e || 0, f || 0, g2 || 0);
  }
  D.now = () => ms;
  D.UTC = R.UTC; D.parse = R.parse; D.prototype = R.prototype;
  return D;
}
const FIXED_MS = new Date(2026, 8, 2, 10, 30, 0).getTime();   /* 2026-09-02 10:30 (지역시) */

/* ============================================================ 1. 시계 — 판정의 기준 */
section('1. 판정은 두 도장의 차로만 만들어진다');
{
  const g = boot({});
  startPractice(g);
  const st0 = g.st.state();
  ok('연습 모드를 시작하면 첫 라운드가 돈다', st0.phase === 'running' && st0.roundIdx === 0, JSON.stringify(st0.phase));
  eq('한 판은 다섯 라운드다', st0.board.length, EXP.ROUNDS);
  const r0 = st0.board[0], t0 = st0.roundT0;
  g.pressPointer(t0 + 1234);
  const res = g.st.state().results;
  eq('누른 뒤 라운드 결과가 하나 쌓인다', res.length, 1);
  near('잰 경과 시간은 (누른 도장 − 라운드 시작)이다', res[0].atMs, 1234, 0.001);
  near('벗어난 양이 독립 재계산과 같다', res[0].diff, xDiff(r0, 1234), 1e-9);
  near('환산 점수가 독립 재계산과 같다', res[0].score, xScore(xDiff(r0, 1234), r0.tol), 1e-9);
  ok('setInterval 을 쓰지 않는다', g.intervals() === 0, '호출 ' + g.intervals() + '회');
  note('rAF 호출 ' + g.rafs() + '회 — 그리기 전용이라 0 이 아니어도 된다(판정은 위에서 도장으로만 났다)');
}

/* ============================================================ 2. 기기 사정 */
section('2. 기기 사정이 달라도 같은 도장이면 같은 판정이다');
{
  /* 같은 seed 의 같은 판을 다섯 가지 사정에서 똑같이 두드린다. 값이 하나라도 갈리면 FAIL. */
  const scenes = [
    { name: '조용한 기기', prep: () => {} },
    { name: '밀린 프레임 콜백 500회', prep: g => { for (let i = 0; i < 500; i++){ g.advance(1); g.flush(3); } } },
    { name: '탭이 뒤에 가려짐(프레임 콜백 0)', prep: g => { g.hidden(true); } },
    { name: '시계가 잘게 흐름', prep: g => { for (let i = 0; i < 200; i++) g.advance(0.5); } },
    { name: '타이머 폭주', prep: g => { for (let i = 0; i < 50; i++){ g.advance(2); g.flush(10); } } }
  ];
  const out = [], boards = [];
  for (const sc of scenes){
    /* ★오늘의 판으로 연다 — 다섯 세션이 **같은 판**을 받아야 '사정만 달랐다' 가 성립한다.
       연습 모드로 열면 세션마다 판이 달라 무엇을 재도 어긋나고, 그것은 제품 고장이 아니라
       측정 조건이 만든 거짓 고장이다(2026-09-02 실측으로 밟았다). */
    const g = boot({ store: makeStore([['bp.lang','ko']]), Date: fixedDate(FIXED_MS) });
    startDaily(g);
    const st = g.st.state(), t0 = st.roundT0;
    boards.push(JSON.stringify(st.board));
    sc.prep(g);
    /* ★사정과 무관하게 **같은 두 도장**을 준다 — 도장이 같은데 결과가 갈리면 시계를 잘못 쓴 것이다 */
    g.setClock(t0 + 2000);
    g.pressPointer(t0 + 2000, { stamp: t0 + 2000 });
    const r = g.st.state().results[0];
    out.push(r ? [Math.round(r.diff * 1e6), Math.round(r.score * 1e6), Math.round(r.atMs * 1e6)].join('/') : 'none');
  }
  /* ★먼저 '다섯 세션이 정말 같은 판을 받았는가' 를 못박는다 — 이것이 깨지면 아래 판정은
     통과하든 실패하든 아무것도 증명하지 못한다(공허한 비교를 통과로 세지 않는다). */
  ok('다섯 세션이 같은 판을 받았다(비교의 전제)', new Set(boards).size === 1, '서로 다른 판 ' + new Set(boards).size + '가지');
  ok('기기 사정이 달라도 같은 도장이면 같은 판정이다', new Set(out).size === 1, JSON.stringify(out));
  scenes.forEach((s, i) => note(s.name + ' → ' + out[i]));
}

/* ============================================================ 3. 판은 시작할 때 통째로 확정된다 */
section('3. 판은 시작할 때 통째로 확정된다 (seed)');
{
  const g = boot({});
  const a = g.st.dealBoard('key-alpha');
  const b = g.st.dealBoard('key-alpha');
  const c = g.st.dealBoard('key-beta');
  eq('같은 seed 는 같은 판이다', JSON.stringify(a), JSON.stringify(b));
  ok('다른 seed 는 다른 판이다', JSON.stringify(a) !== JSON.stringify(c));
  /* 구성 — 200개 seed 전수 */
  let compOk = true, orderSet = new Set(), bad = null;
  for (let i = 0; i < 200; i++){
    const bd = g.st.dealBoard('seed-' + i);
    const cnt = { spot: 0, size: 0, angle: 0 };
    for (const r of bd) cnt[r.kind] = (cnt[r.kind] || 0) + 1;
    if (JSON.stringify(cnt) !== JSON.stringify(EXP.KINDS_COUNT)){ compOk = false; bad = JSON.stringify(cnt); break; }
    orderSet.add(bd.map(r => r.kind).join(','));
  }
  ok('한 판의 구성이 지점2·크기2·각도1 이다', compOk, 'seed 200개 전수 · 어긋난 구성=' + bad);
  ok('종류의 차례도 seed 가 정한다', orderSet.size > 1, '서로 다른 차례 ' + orderSet.size + '가지 / seed 200개');
  note('관측된 차례 ' + orderSet.size + '가지 (5개 자리에 2·2·1 을 놓는 경우의 수는 30가지)');
  /* 날짜만이 오늘의 판을 정한다 — 120일 전수 */
  const keys = new Set(), boards = new Set();
  for (let i = 0; i < 120; i++){
    const d = new Date(2026, 8, 2); d.setDate(d.getDate() + i);
    const k = g.st.seedKey(d.getTime());
    keys.add(k); boards.add(JSON.stringify(g.st.dealBoard(k)));
  }
  eq('날짜 120일이 저마다 다른 seed 키를 낸다', keys.size, 120);
  ok('그 판들도 서로 다르다', boards.size >= 118, '서로 다른 판 ' + boards.size + '/120');
  /* 같은 날짜는 시각과 무관하게 같은 키 */
  const k1 = g.st.seedKey(new Date(2026, 8, 2, 0, 0, 1).getTime());
  const k2 = g.st.seedKey(new Date(2026, 8, 2, 23, 59, 59).getTime());
  eq('같은 날이면 몇 시에 열어도 같은 판이다', k1, k2);
}

/* ============================================================ 4. ★플레이가 판을 바꾸지 않는다 */
section('4. 플레이가 난수를 당기지 않는다 (판이 갈라지지 않는다)');
{
  const g = boot({});
  startPractice(g);
  const drawsAfterDeal = g.st.draws();
  const randAfterDeal = g.rand();
  const boardBefore = JSON.stringify(g.st.state().board);
  for (let i = 0; i < EXP.ROUNDS; i++){
    if (g.st.state().phase !== 'running') break;
    playRound(g, 900 + i * 130);
  }
  const st = g.st.state();
  eq('다섯 라운드를 다 치렀다', st.results.length, EXP.ROUNDS);
  eq('판을 짠 뒤로 seed 난수를 한 번도 더 당기지 않았다', g.st.draws(), drawsAfterDeal);
  eq('플레이 중 Math.random 도 부르지 않았다', g.rand(), randAfterDeal);
  eq('판 자체가 처음 그대로다(허용폭 포함)', JSON.stringify(st.board), boardBefore);
  /* 결과에 적힌 허용폭이 판의 허용폭과 같은가 */
  let tolOk = true;
  st.results.forEach((r, i) => { if (Math.abs(r.tol - st.board[i].tol) > 1e-12) tolOk = false; });
  ok('허용폭은 판을 짤 때 확정되고 플레이로 바뀌지 않는다', tolOk);
}

/* ============================================================ 5. 채점 */
section('5. 채점 — 허용폭 대비 정규화 · 원값 병기');
{
  const g = boot({ store: makeStore([['bp.lang','ko']]) });
  startPractice(g);
  const board = g.st.state().board.slice();
  const presses = [1100, 1500, 2100, 900, 1700];
  for (let i = 0; i < EXP.ROUNDS; i++){
    if (g.st.state().phase !== 'running') break;
    playRound(g, presses[i]);
  }
  g.flush();
  const res = g.st.result();
  ok('다섯 라운드를 마치면 결과가 나온다', !!res && g.st.shown('over'));
  if (res){
    /* 독립 재계산 — 제품 함수를 부르지 않는다 */
    const want = board.map((r, i) => xScore(xDiff(r, presses[i]), r.tol));
    const got = res.rounds.map(r => r.score);
    let same = true;
    for (let i = 0; i < want.length; i++) if (Math.abs(want[i] - got[i]) > 1e-9) same = false;
    ok('환산 점수가 허용폭 대비 정규화다(독립 재계산과 일치)', same, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
    near('최종 점수가 다섯 라운드의 평균이다', res.avg, xMean(got), 1e-9);
    /* 경계 — 허용폭만큼 벗어나면 0점, 딱 맞으면 100점 */
    near('정확히 겹치면 100점', g.st.scoreOf(0, 12), 100, 1e-9);
    near('허용폭만큼 벗어나면 0점', g.st.scoreOf(12, 12), 0, 1e-9);
    near('허용폭을 넘어서면 0점에서 멈춘다', g.st.scoreOf(40, 12), 0, 1e-9);
    near('허용폭의 절반이면 50점', g.st.scoreOf(6, 12), 50, 1e-9);
    /* ★기획안 3쪽 결과 예시 "목표에서 3px 차이 / 정확도 97점" 은 채점의 **눈금**을 정한다 —
       1 − 3/tol = 0.97 이면 tol ≈ 100px 이다. 허용폭을 그보다 좁게 잡으면 3px 차이가 97점이
       되지 않아 원문 예시가 재현되지 않는다. 그래서 지점 라운드 전수로 확인한다.
       ★기대값(3px·97점)은 이 파일이 원문에서 읽어 리터럴로 쥔 것이지 제품에서 파생시킨 것이 아니다. */
    let worst = 100, spotSeen = 0;
    for (let i = 0; i < 200; i++){
      for (const r of g.st.dealBoard('tol-scale-' + i)){
        if (r.kind !== 'spot') continue;
        spotSeen++;
        const s = xScore(3, r.tol);
        if (s < worst) worst = s;
      }
    }
    ok('기획안 예시대로 지점 3px 차이가 97점 언저리다(≥95점)', spotSeen >= 300 && worst >= 95,
       '지점 라운드 ' + spotSeen + '개 · 가장 낮은 점수 ' + worst);
    note('허용폭 범위 — 지점 ' + JSON.stringify(g.st.const().TOL_SPOT) + 'px · 크기 ' +
         JSON.stringify(g.st.const().TOL_SIZE) + 'px · 각도 ' + JSON.stringify(g.st.const().TOL_ANGLE) + '°');
    /* 원값 병기 — 화면 글로 확인한다 */
    const rows = g.rowsText();
    eq('결과에 라운드 다섯 줄이 있다', rows.length, EXP.ROUNDS);
    const rawOk = rows.every(t => /\d+\.\d\d(px|°)/.test(t));
    const scoreOk = rows.every(t => /\d+\.\d점/.test(t));
    ok('결과에 환산 점수와 원값이 함께 나온다', rawOk && scoreOk, JSON.stringify(rows.slice(0, 2)));
    ok('최종 점수 표시가 기획안 예시 형식이다(평균 N.N점)', /^\d+\.\d점$/.test(g.txt('finalAvg')), g.txt('finalAvg'));
    note('결과 줄 보기: ' + rows[0]);
    note('공유 문안 첫 줄: ' + String(g.st.shareText()).split('\n')[0]);
  }
}

/* ============================================================ 6. 입력 */
section('6. 입력 — 누르는 순간을 재고, 논리는 즉시 확정한다');
{
  /* 손가락과 키보드가 같은 결과를 낸다 */
  const g1 = boot({}); startPractice(g1);
  const t1 = g1.st.state().roundT0; g1.pressPointer(t1 + 1500);
  const g2 = boot({}); startPractice(g2);
  const t2 = g2.st.state().roundT0; g2.pressKey(t2 + 1500, ' ');
  const a = g1.st.state().results[0], b = g2.st.state().results[0];
  ok('키보드(Space)가 손가락과 똑같이 처리된다', !!a && !!b && Math.abs(a.atMs - b.atMs) < 1e-9, JSON.stringify([a && a.atMs, b && b.atMs]));
  const g3 = boot({}); startPractice(g3);
  const t3 = g3.st.state().roundT0; g3.pressKey(t3 + 1500, 'Enter');
  ok('Enter 도 똑같이 처리된다', g3.st.state().results.length === 1);
  const g4 = boot({}); startPractice(g4);
  const t4 = g4.st.state().roundT0;
  g4.pressKey(t4 + 1200, ' ', { repeat: true });
  ok('키를 누르고 있을 때의 반복 입력은 세지 않는다', g4.st.state().results.length === 0);
  const g5 = boot({}); startPractice(g5);
  ok('판은 click 을 듣지 않는다(손을 뗄 때가 아니라 누를 때를 잰다)', g5.clickPad(g5.clock() + 100) === 0);

  /* ★연타 — 라운드가 끝난 뒤의 입력은 아무 일도 하지 않는다 */
  const g6 = boot({}); startPractice(g6);
  const t6 = g6.st.state().roundT0;
  g6.pressPointer(t6 + 1000);
  g6.pressPointer(t6 + 1001);
  g6.pressPointer(t6 + 1002);
  eq('라운드가 끝난 뒤의 연타는 아무 일도 하지 않는다', g6.st.state().results.length, 1);
  eq('연타가 다음 라운드를 앞당기지도 않는다', g6.st.state().roundIdx, 0);

  /* 10초 제한 */
  const g7 = boot({}); startPractice(g7);
  const t7 = g7.st.state().roundT0;
  g7.setClock(t7 + EXP.ROUND_LIMIT_MS + 1);
  g7.flush();
  const r7 = g7.st.state().results[0];
  ok('10초가 지나면 0점으로 넘어간다', !!r7 && r7.missed === true && r7.score === 0, JSON.stringify(r7));
}

/* ============================================================ 7. 접근성 — 동작 줄이기·깜빡임 */
section('7. 동작 줄이기는 연출만 줄인다 (판정·속도·허용폭·점수 불변)');
{
  /* ① 동적 — 같은 판·같은 도장으로 두 번, 설정만 바꾼다 */
  const mk = reduce => {
    /* ★같은 판이어야 설정만 다른 비교가 된다 — 연습 모드는 세션마다 판이 달라 쓸 수 없다 */
    const g = boot({ reduceMotion: reduce, store: makeStore([['bp.lang','ko']]), Date: fixedDate(FIXED_MS) });
    startDaily(g);
    const st = g.st.state(), t0 = st.roundT0;
    const board = JSON.stringify(st.board);
    g.pressPointer(t0 + 1800, { stamp: t0 + 1800 });
    const r = g.st.state().results[0];
    return { board, r, draws: g.drawLog.length, reduce: g.st.reduceMotion() };
  };
  const off = mk(false), on = mk(true);
  ok('동작 줄이기 설정이 스텁에 실제로 전달됐다', off.reduce === false && on.reduce === true, JSON.stringify([off.reduce, on.reduce]));
  eq('같은 seed 라면 설정과 무관하게 같은 판이다', off.board, on.board);
  ok('동작 줄이기가 판정·허용폭·점수에 닿지 않는다',
     !!off.r && !!on.r && Math.abs(off.r.diff - on.r.diff) < 1e-12 && Math.abs(off.r.score - on.r.score) < 1e-12,
     JSON.stringify([off.r && off.r.diff, on.r && on.r.diff]));
  /* ② 그런데 연출은 실제로 줄어야 한다 — 줄지 않으면 (c)안을 지키지 않은 것이다 */
  ok('동작 줄이기에서 비필수 연출(잔상)이 실제로 줄어든다', on.draws < off.draws, '그리기 명령 ' + on.draws + ' < ' + off.draws);
  note('그리기 명령 수 — 보통 ' + off.draws + ' · 동작 줄이기 ' + on.draws);

  /* ③ 정적 — 판정 함수 어디에도 reduceMotion 이 없다 */
  const JUDGE = ['function tri(p){', 'function valueAt(r, t){', 'function diffAt(r, t){',
                 'function scoreOf(diff, tol){', 'function dealBoard(seedKey){',
                 'function startRound(){', 'function endRound(stamp){', 'function finishRun(){'];
  let missing = [], touched = [];
  for (const h of JUDGE){
    const body = funcBody(SRC, h);
    if (body === null){ missing.push(h); continue; }
    if (body.indexOf('reduceMotion') >= 0) touched.push(h);
  }
  if (missing.length) cannot('판정 함수에 동작 줄이기 분기가 없다', '함수 머리글을 찾지 못했다(앵커 노후화): ' + missing.join(' | '));
  else ok('판정 함수에 동작 줄이기 분기가 없다', touched.length === 0, '닿은 함수: ' + touched.join(' | '));

  /* ④ 깜빡임 — 반복되는 애니메이션의 주기가 3Hz 를 넘지 않는다(WCAG 2.3.1/2.3.2) */
  const anims = [...HTML_TEXT.matchAll(/animation\s*:\s*([^;}]+)/g)].map(m => m[1].trim());
  const fast = anims.filter(a => {
    if (!/infinite/.test(a)) return false;
    const t = /([\d.]+)m?s/.exec(a);
    if (!t) return false;
    const sec = /ms/.test(a) ? parseFloat(t[1]) / 1000 : parseFloat(t[1]);
    return sec > 0 && sec < 0.334;     /* 한 주기 0.334초 미만 = 초당 3회 초과 */
  });
  ok('초당 3회를 넘는 깜빡임이 없다', fast.length === 0, JSON.stringify(fast));
  note('반복 애니메이션 선언 ' + anims.filter(a => /infinite/.test(a)).length + '건 · 전체 animation 선언 ' + anims.length + '건');
  ok('동작 줄이기 미디어 블록이 있다', /@media \(prefers-reduced-motion: reduce\)/.test(HTML_TEXT));
}

/* ============================================================ 8. 「눈대중」과의 경계 */
section('8. 「눈대중」과의 경계 — 슬라이더 없음 · 정지 화면 아님');
{
  const g = boot({});
  ok('슬라이더·수치 입력이 없다',
     !/<input[^>]*type\s*=\s*"(range|number)"/i.test(HTML_TEXT) && !/<input\b/i.test(HTML_TEXT),
     (HTML_TEXT.match(/<input[^>]*>/gi) || []).join(' '));
  /* 대상이 실제로 움직이는가 — 다섯 라운드 전부에서 시간에 따라 값이 변해야 한다 */
  const bd = g.st.dealBoard('motion-probe');
  let movingAll = true, still = [];
  bd.forEach((r, i) => {
    const v0 = xValue(r, 0), v1 = xValue(r, 250), v2 = xValue(r, 700);
    if (Math.abs(v0 - v1) < 1e-6 && Math.abs(v0 - v2) < 1e-6){ movingAll = false; still.push(i + ':' + r.kind); }
  });
  ok('다섯 라운드 모두 대상이 시간에 따라 움직인다', movingAll, still.join(','));
  /* 판 크기 고정 — 원값 px 이 기기마다 달라지지 않는다 */
  const g2 = boot({ innerWidth: 1600 });
  const g3 = boot({ innerWidth: 320 });
  eq('판 크기가 300 으로 고정이다', [g2.st.const().FIELD, g3.st.const().FIELD], [EXP.FIELD, EXP.FIELD]);
  eq('궤도 길이도 고정이다', g2.st.const().TRACK_LEN, EXP.TRACK_LEN);
}

/* ============================================================ 9. 이어서 한 판 더 (기획안 7쪽) */
section('9. 결과 화면에서 한 번의 조작으로 다음 판이 시작된다');
{
  const g = boot({});
  startPractice(g);
  for (let i = 0; i < EXP.ROUNDS; i++){ if (g.st.state().phase !== 'running') break; playRound(g, 1000 + i * 90); }
  g.flush();
  ok('한 판이 끝나면 결과 창이 뜬다', g.st.shown('over') && g.st.state().phase === 'done');
  const before = JSON.stringify(g.st.state().board);
  g.clickBtn('btnAgain');
  const st = g.st.state();
  ok('결과 화면에서 한 번의 조작으로 다음 판이 시작된다',
     st.phase === 'running' && st.roundIdx === 0 && st.results.length === 0, JSON.stringify([st.phase, st.roundIdx]));
  ok('그 다음 판은 새로 짜인 판이다(연습 모드는 매번 다른 판)', JSON.stringify(st.board) !== before);
  ok('결과 창에 다른 게임으로 가는 길이 있다', /<a class="btn ghost" href="\/"/.test(HTML_TEXT));
}

/* ============================================================ 10. 저장 키·방침·문안 */
section('10. 저장 키 · 언어 문안 · 외부 요청');
{
  const g = boot({ store: makeStore([['bp.lang','ko']]) });
  startPractice(g);
  for (let i = 0; i < EXP.ROUNDS; i++){ if (g.st.state().phase !== 'running') break; playRound(g, 1200); }
  g.flush();
  g.clickBtn('btnSound');
  const keys = g.store.keys().sort();
  /* ★기대 목록은 이 파일이 독립 리터럴로 쥔다 — 제품에서 파생시키면 키를 지울 때 시험도 함께 사라진다 */
  const EXPECT_KEYS = ['bp.lang', 'st.best', 'st.sound'];
  eq('연습 한 판 뒤 저장되는 키가 예상과 같다', keys, EXPECT_KEYS);
  ok('이 게임의 키는 모두 st. 로 시작한다', keys.filter(k => k !== 'bp.lang').every(k => k.indexOf('st.') === 0), JSON.stringify(keys));
  note('오늘의 판을 치르면 st.daily·st.streak 가 더해진다(아래에서 따로 확인한다)');

  /* 오늘의 판까지 치러 보고 키를 다시 센다 */
  const g2 = boot({ store: makeStore([['bp.lang','ko']]) });
  g2.clickBtn('btnDaily');
  for (let i = 0; i < EXP.ROUNDS; i++){ if (g2.st.state().phase !== 'running') break; playRound(g2, 1300); }
  g2.flush();
  const keys2 = g2.store.keys().sort();
  eq('오늘의 판 뒤 저장되는 키가 예상과 같다', keys2, ['bp.lang', 'st.daily', 'st.streak']);
  ok('오늘의 판을 마치면 그날 기록으로 남는다', g2.st.daily().done === true);
  ok('스트릭이 1 이상으로 쌓인다', g2.st.daily().streak >= 1, String(g2.st.daily().streak));

  /* ko·en 문안 키가 정확히 짝을 이룬다 */
  const koKeys = [...SRC.matchAll(/\n    ([A-Za-z0-9_]+):/g)].map(m => m[1]);
  const g3 = boot({ lang: 'en' });
  ok('영어로 열면 영어가 기본이다', g3.st.lang() === 'en', g3.st.lang());
  const i18nBlock = SRC.slice(SRC.indexOf('const I18N = {'), SRC.indexOf('/* 언어 키는 사이트 공통'));
  const koPart = i18nBlock.slice(i18nBlock.indexOf('ko: {'), i18nBlock.indexOf('en: {'));
  const enPart = i18nBlock.slice(i18nBlock.indexOf('en: {'));
  const kk = new Set([...koPart.matchAll(/\n    ([A-Za-z0-9_]+)\s*:/g)].map(m => m[1]));
  const ek = new Set([...enPart.matchAll(/\n    ([A-Za-z0-9_]+)\s*:/g)].map(m => m[1]));
  if (kk.size < 20 || ek.size < 20) cannot('ko·en 문안 키가 정확히 짝을 이룬다', '문안 블록을 못 읽었다(ko ' + kk.size + ' · en ' + ek.size + ')');
  else {
    const onlyKo = [...kk].filter(k => !ek.has(k));
    const onlyEn = [...ek].filter(k => !kk.has(k));
    ok('ko·en 문안 키가 정확히 짝을 이룬다', onlyKo.length === 0 && onlyEn.length === 0,
       'ko 에만: ' + onlyKo.join(',') + ' · en 에만: ' + onlyEn.join(','));
    note('문안 키 ' + kk.size + '쌍');
  }
  void koKeys;

  /* 외부 요청 0 — 게임 스크립트는 네트워크를 부르지 않는다 */
  ok('게임 스크립트가 외부로 요청을 보내지 않는다',
     !/\bfetch\s*\(/.test(SRC) && !/XMLHttpRequest/.test(SRC) && !/navigator\.sendBeacon/.test(SRC));
}

/* ============================================================ 11. 정적 마크업 */
section('11. 정적 마크업 — 계약이 문서에 남아 있는가');
{
  ok('판이 300×300 CSS px 로 고정 선언돼 있다', /\.pad\{width:300px;height:300px/.test(HTML_TEXT));
  ok('캔버스가 300×300 으로 선언돼 있다', /<canvas id="cv" width="300" height="300">/.test(HTML_TEXT));
  ok('진행 중 내용에 data-i18n 을 붙이지 않았다(언어 전환이 판의 글을 덮지 않는다)',
     !/id="capMain"[^>]*data-i18n/.test(HTML_TEXT) && !/id="capSub"[^>]*data-i18n/.test(HTML_TEXT));
  ok('판수 줄이 처음엔 감춰져 있다', /<p class="hp-stat" data-hp-line hidden data-i18n="statPlays">/.test(HTML_TEXT));
  ok('감춘 줄이 정말 감춰지는 가드가 있다', /\.hp-stat\[hidden\]\s*\{display:none!important\}/.test(HTML_TEXT));
  ok('움직임에 대한 사전 고지가 시작 화면에 있다', /data-i18n="motionNote"/.test(HTML_TEXT));
  ok('목표에 색 말고 모양 표식(삼각)이 함께 붙는다', /function triMark\(/.test(SRC) && (SRC.match(/triMark\(/g) || []).length >= 4,
     '호출 ' + ((SRC.match(/triMark\(/g) || []).length - 1) + '곳');
  ok('관측 창구에 상태를 바꾸는 명령이 없다',
     !/__st\s*=\s*\{[\s\S]*?(start|press|stop|set[A-Z])\w*\s*:/.test(SRC.slice(SRC.indexOf('window.__st'))),
     '창구는 읽기 전용이어야 한다');
}

/* ============================================================ 결과 */
console.log('');
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  const ran = seen.has(m.catcher);
  const caught = failures.indexOf(m.catcher) >= 0;
  console.log('뮤테이션 ' + MUTATION + ' — 잡아야 하는 검사: ' + m.catcher);
  if (!ran){
    console.log('==== 판정 불가: 지목한 검사가 돌지 않았다(앵커 노후화) ====');
    process.exit(2);
  }
  console.log(caught ? '  → 지목한 검사가 잡았다' : '  → ★지목한 검사가 잡지 못했다(다른 검사만 붉어졌다면 무임승차다)');
  console.log('==== 멈춰! 검증: PASS ' + pass + ' · FAIL ' + fail + ' · INDET ' + indet + ' ====');
  if (indet) process.exit(2);
  /* ★종료코드는 대조군과 같은 뜻을 유지한다 — 0 은 '아무것도 못 잡았다'(미탐지)이지
     '뮤테이션이니까 괜찮다' 가 아니다. 지목 여부는 위 줄이 말하고, 무임승차 판정은 러너가 한다. */
  process.exit(fail ? 1 : 0);
}
console.log('==== 멈춰! 검증: PASS ' + pass + ' · FAIL ' + fail + ' · INDET ' + indet + ' ====');
if (failures.length) console.log('미달: ' + failures.join(' | '));
if (indet) process.exit(2);
process.exit(fail ? 1 : 0);
