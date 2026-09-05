#!/usr/bin/env node
/* verify_gomoku.js — 「오목 한판」 검증 (이겼다고 말할 때만 이겼는가)
 *
 * `gomoku/index.html` 의 인라인 스크립트를 **그대로 꺼내** 최소 DOM 스텁 위에서 돌리고, 제품이
 * 실제로 듣는 입력 사건(pointerdown·keydown)으로 판을 두드린다. 시험용 뒷문은 제품에 두지
 * 않는다 — 배포본의 `window.__gm` 은 읽기 전용 창구이고, 이 검사기는 승리 판정을
 * **자기 것으로 따로 구현해** 대조한다(같은 함수로 두 번 재면 자기채점이다).
 *
 * 이 게임에 실린 약속은 하나이고, 검사의 무게는 전부 거기에 있다.
 *   ★**이겼다고 말할 때만 이겼고, 이겼으면 반드시 이겼다고 말한다.**
 * 그래서 이 검사기는 화면에 줄이 그려졌는가가 아니라 **판정 함수가 옳은가**를 잰다. 그리고
 * ★거짓 양성(안 이겼는데 이겼다고 함)을 거짓 음성보다 무겁게 다룬다 — 거짓 양성은 게임을
 * 그 자리에서 끝내 버리기 때문이다. 무작위 대조(differential)와 손으로 적은 표본을 함께 쓴다.
 *
 * 사용법:
 *   node tools/verify_gomoku.js                          # 대조군(기본 대상 = 이 저장소의 gomoku/index.html)
 *   node tools/verify_gomoku.js --html gomoku/index.html
 *   node tools/verify_gomoku.js --list-mutations
 *   node tools/verify_gomoku.js --mutate m-four-wins     # 검출력 확인(임시 사본에만 주입)
 *
 * 종료코드: 0 = 전부 통과 · 1 = 미달 있음 · 2 = 검사를 세울 수 없음(하네스·주입 실패·검사 미실행).
 *   ★--mutate 를 걸었을 때만 쓰는 코드가 하나 더 있다: 3 = 주입은 됐는데 ★지목한 검사가 잡지
 *   못했다(검사가 공허하다). '못 세웠다'(2)와 '못 잡았다'(3)를 한 코드로 묶으면 자동 호출자가
 *   원인을 오분류한다.
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

const HTML = argOf('--html', path.join(__dirname, '..', 'gomoku', 'index.html'));
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
  /* ★부분 문자열로 고르지 않는다 — head 인라인에도 window.__gmPayload 가 있어 그쪽이 먼저 잡힌다.
     고르는 기준은 ★창구를 여는 자리다(window.__gm = {). */
  return out.find(s => s.indexOf('window.__gm = {') >= 0) || null;
}
let SRC = gameSource(RAW);
if (!SRC){ console.error('게임 스크립트(window.__gm = { 을 여는 인라인 <script>)를 찾지 못했다'); process.exit(2); }

/* ------------------------------------------------------------ 뮤테이션(고의 결함 · 임시 사본에만)
   각 항목은 '어느 검사가 이것을 잡아야 하는가'(catcher)를 함께 못박는다 — 다른 검사가 우연히
   깨져서 붉어지는 무임승차를 인정하지 않기 위해서다.
   ★거짓 양성 쪽(안 이겼는데 이겼다고 하는 결함)을 반드시 포함한다(티켓 4-★). */
const MUTATIONS = {
  'm-four-wins': {
    why: '★거짓 양성 — 넷을 다섯으로 센다(WIN_LEN 이상 → WIN_LEN-1 이상)',
    catcher: '넷은 승리가 아니다(거짓 양성 0)',
    apply: s => s.replace('if (line.length >= WIN_LEN) return { stone: board[idx], dir: [dx, dy], line };',
                          'if (line.length >= WIN_LEN - 1) return { stone: board[idx], dir: [dx, dy], line };')
  },
  'm-wrap-edge': {
    why: '★거짓 양성 — 좌표 대신 칸 번호로 가로를 세어 판의 오른쪽 끝에서 다음 줄로 넘어간다',
    catcher: '판을 넘어가는 줄은 이어진 것이 아니다(가장자리 거짓 양성 0)',
    apply: s => s.replace('const idxAt = (x, y) => (inBoard(x, y) ? y * N + x : -1);',
                          'const idxAt = (x, y) => { const j = y * N + x; return (j >= 0 && j < CELLS) ? j : -1; };')
  },
  'm-mixed-stone': {
    why: '★거짓 양성 — 색을 보지 않고 돌이 있기만 하면 이어진 것으로 센다',
    catcher: '상대 돌이 낀 줄은 이어진 것이 아니다(거짓 양성 0)',
    apply: s => s.replace('    if (j < 0 || board[j] !== stone) break;\n    line.push(j);',
                          '    if (j < 0 || !board[j]) break;\n    line.push(j);')
  },
  'm-exact-five': {
    why: '거짓 음성 — 정확히 다섯만 승리로 보아 장목(여섯 이상)을 놓친다',
    catcher: '여섯 이상(장목)도 승리다',
    apply: s => s.replace('if (line.length >= WIN_LEN) return { stone: board[idx], dir: [dx, dy], line };',
                          'if (line.length === WIN_LEN) return { stone: board[idx], dir: [dx, dy], line };')
  },
  'm-one-way': {
    why: '거짓 음성 — 한 방향으로만 뻗어 가운데에 끼워 넣은 다섯을 놓친다',
    catcher: '가운데에 끼워 넣은 다섯도 잡는다',
    apply: s => s.replace('  for (let k = 1; k < N; k++){\n    const j = idxAt(x0 - dx * k, y0 - dy * k);\n    if (j < 0 || board[j] !== stone) break;\n    line.unshift(j);\n  }\n  return line;',
                          '  return line;')
  },
  'm-turn-parity': {
    why: '차례가 번갈아 가지 않는다(언제나 흑)',
    catcher: '차례가 흑·백으로 번갈아 간다',
    apply: s => s.replace('const stoneOfTurn = n => (n % 2 === 0 ? BLACK : WHITE);',
                          'const stoneOfTurn = n => BLACK;')
  },
  'm-occupied': {
    why: '이미 돌이 있는 자리에 덮어 둘 수 있다',
    catcher: '이미 돌이 있는 자리에는 못 둔다',
    apply: s => s.replace("  if (cells[idx] !== EMPTY) return 'occupied';",
                          "  if (false) return 'occupied';")
  },
  'm-play-after-end': {
    why: '판이 끝난 뒤에도 계속 둘 수 있다',
    catcher: '판이 끝난 뒤에는 못 둔다',
    apply: s => s.replace("function place(idx){\n  if (ended) return 'ended';",
                          "function place(idx){\n  if (false) return 'ended';")
  },
  'm-undo-unlimited': {
    why: '무르기 횟수 제한이 사라진다',
    catcher: '무르기는 한 판에 한 번뿐이다',
    apply: s => s.replace("  if (undoLeft <= 0) return 'used';",
                          "  if (false) return 'used';")
  },
  'm-undo-two': {
    why: '무르기가 직전 한 수가 아니라 두 수를 되돌린다',
    catcher: '무르기는 직전 한 수만 되돌린다',
    apply: s => s.replace('  const idx = moves.pop();\n  cells[idx] = EMPTY;',
                          '  const idx = moves.pop();\n  cells[idx] = EMPTY;\n  if (moves.length){ const j = moves.pop(); cells[j] = EMPTY; }')
  },
  'm-no-swap': {
    why: '다시 하기를 눌러도 선공이 교대되지 않는다(흑 유리가 갚아지지 않는다)',
    catcher: '다시 하기는 선공을 교대한다',
    apply: s => s.replace('  if (swap) blackPlayer = (blackPlayer === 1 ? 2 : 1);',
                          '  if (false) blackPlayer = (blackPlayer === 1 ? 2 : 1);')
  },
  'm-stale-mark': {
    why: '마지막 수 표식이 옛 자리에 남는다(어디에 두었는지 알 수 없다)',
    catcher: '마지막 수 표식은 방금 둔 자리 하나뿐이다',
    apply: s => s.replace('    const wantMark = (i === last);',
                          '    const wantMark = (i === last) || el.children.length > 0;')
  },
  'm-win-line-paint': {
    why: '이긴 줄 표시가 판정이 돌려준 줄과 다른 자리에 붙는다',
    catcher: '이긴 줄 표시는 판정의 줄과 같은 자리다',
    apply: s => s.replace("    el.classList.toggle('win', lineSet.indexOf(i) >= 0);",
                          "    el.classList.toggle('win', lineSet.length > 0 && cells[i] === lineSet.length);")
  },
  'm-draw-never': {
    why: '225자리가 다 차도 무승부로 끝나지 않는다',
    catcher: '판이 다 차면 무승부로 끝난다',
    apply: s => s.replace("  else if (moves.length === CELLS){ ended = 'draw'; winInfo = null; endStamp = nowMs(); }",
                          "  else if (false){ ended = 'draw'; winInfo = null; endStamp = nowMs(); }")
  },
  /* ── ② 링크 이어두기 — ★거부해야 할 것을 통과시키는 쪽이 위험하다 */
  'm-link-range': {
    why: '★불법 통과 — 판 밖 칸 번호(>=225)를 걸러내지 않는다',
    catcher: '불법 수열은 거부한다(판을 그리지 않는다)',
    apply: s => s.replace("    if (!(idx >= 0 && idx < CELLS)) return { ok: false, why: 'range' };   /* ② 판 밖 */",
                          "    if (false) return { ok: false, why: 'range' };")
  },
  'm-link-dup': {
    why: '★불법 통과 — 같은 자리에 두 번 둔 수열을 받아들인다',
    catcher: '불법 수열은 거부한다(판을 그리지 않는다)',
    apply: s => s.replace("    if (b[idx] !== EMPTY) return { ok: false, why: 'dup' };               /* ③ 겹침 */",
                          "    if (false) return { ok: false, why: 'dup' };")
  },
  'm-link-afterend': {
    why: '★불법 통과 — 이미 끝난 판 뒤의 수를 받아들인다',
    catcher: '불법 수열은 거부한다(판을 그리지 않는다)',
    apply: s => s.replace("    if (ended) return { ok: false, why: 'afterend' };                     /* ④ 끝난 뒤의 수 */",
                          "    if (false) return { ok: false, why: 'afterend' };")
  },
  'm-link-b64': {
    why: '★불법 통과 — 알파벳 밖 글자를 0 으로 접어 넣는다(깨진 링크가 판이 된다)',
    catcher: '불법 수열은 거부한다(판을 그리지 않는다)',
    apply: s => s.replace("    if (v < 0) return null;                 /* ① 알파벳 밖 글자 — 해독하지 않는다 */",
                          "    if (v < 0) continue;")
  },
  'm-link-roundtrip': {
    why: '왕복이 깨진다(마지막 한 바이트를 흘린다)',
    catcher: '링크 수열은 왕복해도 그대로다',
    apply: s => s.replace('function encodeMoves(list){ return b64urlFromBytes(Array.from(list).map(v => v | 0)); }',
                          'function encodeMoves(list){ const a = Array.from(list).map(v => v | 0); return b64urlFromBytes(a.slice(0, Math.max(0, a.length - 1))); }')
  },
  'm-link-undo-others': {
    why: '받은 수(남의 수)까지 무를 수 있다',
    catcher: '받은 수는 무를 수 없다',
    apply: s => s.replace("  if (moves.length <= baseLen) return 'notyours';",
                          "  if (false) return 'notyours';")
  },
  'm-link-relay-keeps-start': {
    why: '★245 가 찾은 결함 그대로 — 이미 열린 탭의 relay 경로만 적재 절차를 따로 들고 시작 화면을 안 걷는다',
    catcher: '열린 탭에 링크가 오면 시작 화면을 걷고 판을 드러낸다',
    apply: s => s.replace("window.addEventListener('gm:payload', e => {\n  takePayload((e && e.detail) ? String(e.detail) : (window.__gmPayload || ''));\n});",
                          "window.addEventListener('gm:payload', e => {\n" +
                          "  const p = (e && e.detail) ? String(e.detail) : (window.__gmPayload || '');\n" +
                          "  if (!p) return;\n  const why = adopt(p);\n  if (why){ toast(T('badLink')); return; }\n" +
                          "  hide('over'); toast(T('linkAdopted')); paint();\n  if (ended) { renderOver(); show('over'); }\n});")
  },
  'm-link-draw-anyway': {
    why: '불법 링크인데도 판을 그린다(거부가 무력해진다)',
    catcher: '불법 링크로는 판을 만들지 않는다',
    apply: s => s.replace("  const why = adopt(p);\n  if (why){ toast(T('badLink')); return false; }",
                          "  const why = adopt(p);\n  if (why){ toast(T('badLink')); moves = [0, 1, 2]; cells = replay(moves); linkMode = true; hide('start'); return true; }")
  },
  /* ── ★음성 대조군 — 계약이 아닌 것을 건드린다. 이쪽은 ★조용해야(rc=0) 한다.
     붉어야 할 것만 시험하면 '무엇을 건드려도 붉는' 검사기가 만점을 받는다. */
  'n-beep-freq': {
    quiet: true,
    why: '착수음의 높이를 바꾼다 — 소리의 음높이는 계약이 아니다(승패·규칙 어디에도 안 걸린다)',
    apply: s => s.replace("const sPlace = stone => { beep(stone === BLACK ? 420 : 520, .05, 'sine', .035); vib(8); };",
                          "const sPlace = stone => { beep(stone === BLACK ? 300 : 900, .05, 'sine', .035); vib(8); };")
  },
  'n-star-points': {
    quiet: true,
    why: '화점(별)의 자리를 옮긴다 — 판의 장식이고 착수·판정에 관여하지 않는다',
    apply: s => s.replace('const STARS = [3, 7, 11].flatMap(y => [3, 7, 11].map(x => y * N + x));',
                          'const STARS = [2, 7, 12].flatMap(y => [2, 7, 12].map(x => y * N + x));')
  },
  'n-toast-ms': {
    quiet: true,
    why: '안내 쪽지가 사라지는 시간을 줄인다 — 연출 시간이고 판정에 닿지 않는다',
    apply: s => s.replace("toastTimer = setTimeout(() => { toastTimer = 0; t.classList.remove('show'); }, 1800);",
                          "toastTimer = setTimeout(() => { toastTimer = 0; t.classList.remove('show'); }, 900);")
  }
};

if (has('--list-mutations')){
  for (const [k, v] of Object.entries(MUTATIONS))
    console.log(k + '\t' + (v.quiet ? 'quiet' : 'red') + '\t' + v.why + '\t[' + (v.catcher || '-') + ']');
  process.exit(0);
}
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  if (!m){ console.error('그런 뮤테이션이 없다: ' + MUTATION); process.exit(2); }
  const before = SRC;
  SRC = m.apply(SRC);
  if (SRC === before){ console.error('주입 실패(앵커 노후화): ' + MUTATION); process.exit(2); }
}

/* ------------------------------------------------------------ DOM 스텁 */
function makeEl(id, doc, tag){
  const el = {
    id, tagName: (tag || 'DIV').toUpperCase(), dataset: {}, _text: '', innerHTML: '',
    children: [], _attrs: {}, _classes: new Set(), _on: {}, disabled: false, onclick: null,
    hidden: false, tabIndex: -1, parent: null, type: '',
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
    if (s === '[data-i18n]' && el.dataset.i18n !== undefined) return true;
    if (s === 'a[href="/"]' && el.tagName === 'A') return true;
    if (s.indexOf('button:not(') === 0 && el.tagName === 'BUTTON' && !el.disabled && !el.hidden) return true;
    if (s.indexOf('body >') === 0) return false;   /* inert 대상은 스텁에 두지 않는다 */
  }
  return false;
}
function HTMLElementStub(){}

const IDS = ['grid', 'board', 'bar', 'turnDot', 'turnText', 'turnSub', 'countText',
             'btnUndo', 'btnNew', 'btnStart', 'btnAgain', 'btnShare', 'startHint',
             'over', 'start', 'overTitle', 'finalBig', 'finalBigTop', 'finalLine', 'finalLineTop',
             'nMoves', 'nTime', 'nNext', 'finalSub', 'srSummary', 'toast', 'help',
             'btnSound', 'btnSound2', 'btnLang', 'btnLang2', 'subtitle', 'adTop', 'adOver', 'startTitle'];

function makeStore(){
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    _map: m
  };
}

/* 스텁 위에 세운 한 판(세션). 시계·타이머를 전부 우리가 쥔다. */
function boot(opts){
  opts = opts || {};
  const localStorage = opts.store || makeStore();
  const els = new Map();

  let clock = 1000;
  const performanceStub = { now: () => clock };
  let seq = 1;
  const timers = new Map();
  const setTimeoutStub = (fn, ms) => { const id = seq++; timers.set(id, { fn, at: clock + (ms || 0) }); return id; };
  const clearTimeoutStub = id => { timers.delete(id); };

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
  for (const k of ['title', 'subtitle', 'hint', 'how1', 'statPlays']){
    const e = makeEl('i18n_' + k, doc, 'p'); e.dataset.i18n = k; els.set('i18n_' + k, e);
  }

  const nav = { language: opts.lang === 'en' ? 'en-US' : 'ko-KR' };
  const winOn = {};
  const win = {
    /* ★기록해 둔다 — 무시하면 window 사건으로만 도달하는 경로(gm:payload)가 통째로 검사 밖이 된다.
       실제로 그 자리에 결함이 살아 있었다(reviewer-gemini(245) 2026-09-05). */
    addEventListener: (t, fn) => { (winOn[t] = winOn[t] || []).push(fn); },
    removeEventListener: t => { delete winOn[t]; },
    navigator: nav, localStorage,
    matchMedia: () => ({ matches: !!opts.reduceMotion }),
    location: { href: 'https://hanpango.com/gomoku/', origin: 'https://hanpango.com',
                pathname: '/gomoku/', search: '', hash: opts.hash || '' },
    __gmPayload: opts.payload || null,
    history: { replaceState: () => {} },
    performance: performanceStub,
    confirm: () => (opts.confirm === undefined ? true : opts.confirm),
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    HTMLElement: HTMLElementStub, document: doc
  };
  const sandbox = {
    window: win, document: doc, localStorage, navigator: nav,
    history: win.history,
    HTMLElement: HTMLElementStub, location: win.location, performance: performanceStub,
    getComputedStyle: () => ({ getPropertyValue: () => '#123456' }),
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: fn => setTimeoutStub(fn, 16), cancelAnimationFrame: clearTimeoutStub,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Math, Date, JSON, Promise, Number, String, Array, Object, RegExp, Error, TypeError,
    isNaN, isFinite, parseInt, parseFloat
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(SRC, sandbox, { filename: 'gomoku-inline.js' }); }
  catch (e){ console.error('구동 실패: ' + (e && e.stack || e)); process.exit(2); }
  if (!win.__gm){ console.error('관측 창구(window.__gm)가 없다'); process.exit(2); }

  const grid = doc.getElementById('grid');
  const fire = (el, type, ev) => {
    const list = (el._on && el._on[type]) || [];
    for (const fn of list) fn(ev || {});
    return list.length;
  };
  const api = {
    gm: win.__gm, doc, store: localStorage, grid,
    /* 제품이 실제로 듣는 window 사건을 밖에서 쏜다(합성 상태 주입이 아니다) */
    fireWin: (type, ev) => { const l = winOn[type] || []; for (const fn of l) fn(ev || {}); return l.length; },
    advance: ms => { clock += ms; },
    /* ★제품이 실제로 듣는 사건으로 둔다 — 상태를 직접 밀어 넣지 않는다 */
    tap: i => fire(grid.children[i], 'pointerdown', { button: 0 }),
    key: (i, key) => fire(grid.children[i], 'keydown', { key, repeat: false, preventDefault(){} }),
    click: id => { const b = doc.getElementById(id); if (b.onclick) b.onclick({}); return !!b.onclick; },
    txt: id => doc.getElementById(id).textContent,
    el: id => doc.getElementById(id)
  };
  return api;
}

/* ------------------------------------------------------------ ★하네스가 따로 들고 있는 승리 판정
   제품과 같은 함수를 두 번 부르면 자기채점이다. 그래서 여기서 ★독립 구현으로 다시 센다 —
   구현 방법도 일부러 다르게 잡았다(제품은 '방금 둔 수를 지나는 줄' 을 양쪽으로 뻗어 세고,
   여기서는 판 전체를 훑으며 ★모든 시작점에서 다섯 칸 창을 미끄러뜨린다). */
function refWinLines(board, n, need){
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const out = [];
  for (let y = 0; y < n; y++){
    for (let x = 0; x < n; x++){
      const s = board[y * n + x];
      if (!s) continue;
      for (const [dx, dy] of dirs){
        /* 이 자리가 그 방향으로 줄의 ★시작점일 때만 센다(같은 줄을 여러 번 세지 않는다) */
        const px = x - dx, py = y - dy;
        if (px >= 0 && py >= 0 && px < n && py < n && board[py * n + px] === s) continue;
        let len = 0;
        const cells = [];
        for (let k = 0; ; k++){
          const cx = x + dx * k, cy = y + dy * k;
          if (cx < 0 || cy < 0 || cx >= n || cy >= n) break;
          if (board[cy * n + cx] !== s) break;
          cells.push(cy * n + cx);
          len++;
        }
        if (len >= need) out.push({ stone: s, dir: [dx, dy], cells });
      }
    }
  }
  return out;
}
/* 그 자리를 지나는 이긴 줄 ★전부. ★한 자리에서 두 줄이 동시에 성립할 수 있다(가로로도 다섯,
   대각으로도 여섯). 계약은 '이겼는가' 이지 '어느 줄로 이겼는가' 가 아니므로 목록으로 답한다. */
function refJudgeAll(board, idx, n, need){
  return refWinLines(board, n, need).filter(w => w.cells.indexOf(idx) >= 0);
}
/* 제품이 돌려준 줄이 ★그 자체로 성립하는가 — 같은 색 · 그 방향으로 연속 · 그 자리를 지남 · 다섯 이상 */
function lineIsReal(board, idx, got, n, need){
  if (!got || !got.line || got.line.length < need) return '길이가 ' + need + ' 미만이다';
  if (got.line.indexOf(idx) < 0) return '방금 둔 자리를 지나지 않는다';
  const stone = board[idx];
  if (got.stone !== stone) return '돌 색이 다르다';
  const [dx, dy] = got.dir;
  for (let k = 0; k < got.line.length; k++){
    const c = got.line[k];
    if (board[c] !== stone) return '줄 안에 다른 색이 있다';
    if (k > 0){
      const px = got.line[k - 1] % n, py = (got.line[k - 1] / n) | 0;
      if ((c % n) !== px + dx || (((c / n) | 0)) !== py + dy) return '그 방향으로 연속이 아니다';
    }
  }
  return null;
}

/* ------------------------------------------------------------ 결과 장부 */
let pass = 0, fail = 0, indet = 0;
const ran = new Set();
const failedChecks = new Set();
function ok(name, msg){ pass++; ran.add(name); console.log('  ✓ [' + name + '] ' + msg); }
function bad(name, msg){ fail++; ran.add(name); failedChecks.add(name); console.log('  ✗ [' + name + '] ' + msg); }
function ind(name, msg){ indet++; ran.add(name); console.log('  ? [' + name + '] ' + msg); }

/* ------------------------------------------------------------ 표본 만들기 도우미 */
const N = 15;
function emptyBoard(){ return new Array(N * N).fill(0); }
function put(board, list, stone){ for (const [x, y] of list) board[y * N + x] = stone; return board; }
function seg(x, y, dx, dy, k){ const out = []; for (let i = 0; i < k; i++) out.push([x + dx * i, y + dy * i]); return out; }

/* =====================================================================
   검사 (가) — 승리 판정
   ===================================================================== */
function checkJudge(api){
  const gm = api.gm;
  const C = gm.const();
  if (C.N !== N || C.WIN_LEN !== 5){
    ind('판정-규격', '판 크기·승리 길이가 예상과 다르다 — N=' + C.N + ' WIN_LEN=' + C.WIN_LEN);
    return;
  }

  /* ── ① 네 방향 × 자리(가운데·네 변·네 모서리)에서 다섯이 잡히는가 */
  const dirs = [[1, 0, '가로'], [0, 1, '세로'], [1, 1, '대각↘'], [1, -1, '대각↗']];
  const spots = [];
  for (const [dx, dy, dn] of dirs){
    /* 그 방향으로 다섯이 판 안에 들어가는 시작점을 ★전수로 만든다(가장자리를 빠뜨리지 않는다) */
    for (let y = 0; y < N; y++){
      for (let x = 0; x < N; x++){
        const ex = x + dx * 4, ey = y + dy * 4;
        if (ex < 0 || ey < 0 || ex >= N || ey >= N) continue;
        spots.push([x, y, dx, dy, dn]);
      }
    }
  }
  let miss = 0, missOne = null;
  for (const [x, y, dx, dy] of spots){
    const cells = seg(x, y, dx, dy, 5);
    for (let last = 0; last < 5; last++){          /* ★마지막에 둔 수의 자리를 다섯 가지로 바꿔 본다 */
      const b = put(emptyBoard(), cells, 1);
      const idx = (y + dy * last) * N + (x + dx * last);
      const got = gm.judge(b, idx);
      if (!got || got.line.length < 5){ miss++; if (!missOne) missOne = { x, y, dx, dy, last }; }
    }
  }
  if (miss) bad('판정-다섯', '다섯을 놓친 표본 ' + miss + '건 — 예: ' + JSON.stringify(missOne));
  else ok('판정-다섯', '네 방향 × 판 전역 시작점 ' + spots.length + '자리 × 마지막 수 위치 5가지 = '
                     + (spots.length * 5) + '표본 전부 승리로 잡았다(가장자리·모서리 포함)');

  /* 가운데에 끼워 넣은 다섯 — 한 방향으로만 뻗는 구현을 잡는 자리 */
  {
    const b = put(emptyBoard(), [[5, 7], [6, 7], [8, 7], [9, 7]], 1);
    b[7 * N + 7] = 1;
    const got = gm.judge(b, 7 * N + 7);
    if (got && got.line.length === 5) ok('가운데에 끼워 넣은 다섯도 잡는다', '양쪽에 둘씩 있는 줄의 가운데를 메웠다');
    else bad('가운데에 끼워 넣은 다섯도 잡는다', '가운데를 메운 다섯을 놓쳤다 — ' + JSON.stringify(got));
  }

  /* ── ② ★거짓 양성 — 넷은 승리가 아니다 */
  {
    let wrong = 0, one = null;
    for (const [x, y, dx, dy] of spots){
      const cells = seg(x, y, dx, dy, 4);
      const b = put(emptyBoard(), cells, 1);
      const idx = (y + dy * 3) * N + (x + dx * 3);
      const got = gm.judge(b, idx);
      if (got){ wrong++; if (!one) one = { x, y, dx, dy, got }; }
    }
    if (wrong) bad('넷은 승리가 아니다(거짓 양성 0)', '넷을 승리로 센 표본 ' + wrong + '건 — 예: ' + JSON.stringify(one));
    else ok('넷은 승리가 아니다(거짓 양성 0)', '네 방향 × ' + spots.length + '자리의 넷 전부 승리가 아니다');
  }

  /* ── ③ ★거짓 양성 — 판을 넘어가는 줄(칸 번호로 세면 생기는 결함) */
  {
    /* 오른쪽 끝 세 칸 + 다음 줄 왼쪽 두 칸 = 칸 번호로는 연속 5칸이지만 ★가로줄이 아니다 */
    let wrong = 0, one = null;
    for (let y = 0; y < N - 1; y++){
      for (let split = 1; split <= 4; split++){
        const b = emptyBoard();
        const cells = [];
        for (let k = 0; k < split; k++) cells.push([N - split + k, y]);
        for (let k = 0; k < 5 - split; k++) cells.push([k, y + 1]);
        put(b, cells, 1);
        for (const [cx, cy] of cells){
          const got = gm.judge(b, cy * N + cx);
          if (got){ wrong++; if (!one) one = { y, split, cells, got }; }
        }
      }
    }
    if (wrong) bad('판을 넘어가는 줄은 이어진 것이 아니다(가장자리 거짓 양성 0)',
                   '줄을 넘어간 다섯 칸을 승리로 센 표본 ' + wrong + '건 — 예: ' + JSON.stringify(one));
    else ok('판을 넘어가는 줄은 이어진 것이 아니다(가장자리 거짓 양성 0)',
            '오른쪽 끝에서 다음 줄로 이어지는 배치 ' + ((N - 1) * 4) + '종 전부 승리가 아니다');
  }

  /* ── ④ ★거짓 양성 — 끊긴 줄과 상대 돌이 낀 줄 */
  {
    const b1 = put(emptyBoard(), [[3, 5], [4, 5], [5, 5], [7, 5], [8, 5]], 1);   /* ●●●○●● 모양(한 칸 빔) */
    const g1 = gm.judge(b1, 5 * N + 5);
    const b2 = put(emptyBoard(), [[3, 6], [4, 6], [5, 6], [7, 6], [8, 6]], 1);
    put(b2, [[6, 6]], 2);                                                        /* 사이에 상대 돌 */
    const g2 = gm.judge(b2, 6 * N + 5);
    const g2b = gm.judge(b2, 6 * N + 6);
    if (g1) bad('끊긴 줄은 이어진 것이 아니다', '한 칸 빈 줄을 승리로 셌다 — ' + JSON.stringify(g1));
    else ok('끊긴 줄은 이어진 것이 아니다', '●●●○●● 배치는 승리가 아니다');
    if (g2 || g2b) bad('상대 돌이 낀 줄은 이어진 것이 아니다(거짓 양성 0)', '상대 돌이 낀 줄을 승리로 셌다 — ' + JSON.stringify(g2 || g2b));
    else ok('상대 돌이 낀 줄은 이어진 것이 아니다(거짓 양성 0)', '가운데 상대 돌이 있는 다섯 칸은 승리가 아니다');
  }

  /* ── ⑤ 장목(여섯 이상)도 승리다 */
  {
    let missed = 0, one = null;
    for (const len of [6, 7, 8]){
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]){
        const y0 = dy === -1 ? 10 : 2;
        const cells = seg(2, y0, dx, dy, len);
        if (cells.some(([cx, cy]) => cx < 0 || cy < 0 || cx >= N || cy >= N)) continue;
        const b = put(emptyBoard(), cells, 1);
        for (const [cx, cy] of cells){
          const got = gm.judge(b, cy * N + cx);
          if (!got || got.line.length !== len){ missed++; if (!one) one = { len, dx, dy, got }; }
        }
      }
    }
    if (missed) bad('여섯 이상(장목)도 승리다', '장목을 놓친 표본 ' + missed + '건 — 예: ' + JSON.stringify(one));
    else ok('여섯 이상(장목)도 승리다', '길이 6·7·8 × 네 방향 전부 승리로 잡고 줄 길이도 그대로 돌려준다');
  }

  /* ── ⑥ ★무작위 대조 — 제품의 판정과 하네스의 독립 구현이 모든 자리에서 같은 답을 내는가 */
  {
    let seedState = 0x2f6e2b1;
    const rnd = () => { seedState = (seedState * 1103515245 + 12345) & 0x7fffffff; return seedState / 0x7fffffff; };
    let diff = 0, one = null, boards = 0, checked = 0, positives = 0;
    for (let t = 0; t < 400; t++){
      const b = emptyBoard();
      const density = 0.12 + rnd() * 0.5;
      for (let i = 0; i < N * N; i++){ if (rnd() < density) b[i] = rnd() < 0.5 ? 1 : 2; }
      boards++;
      for (let i = 0; i < N * N; i++){
        if (!b[i]) continue;
        checked++;
        const got = gm.judge(b, i);
        const want = refJudgeAll(b, i, N, 5);
        if (want.length) positives++;
        let why = null;
        if (!got && want.length) why = '독립 구현은 승리라는데 제품은 아니라고 했다(거짓 음성)';
        else if (got && !want.length) why = '★제품은 승리라는데 독립 구현은 아니라고 했다(거짓 양성)';
        else if (got){
          why = lineIsReal(b, i, got, N, 5);
          if (!why){
            const key = got.line.slice().sort((a, c) => a - c).join(',');
            if (!want.some(w => w.cells.slice().sort((a, c) => a - c).join(',') === key))
              why = '돌려준 줄이 독립 구현이 찾은 줄 목록에 없다';
          }
        }
        if (why){ diff++; if (!one) one = { idx: i, why, got, want }; }
      }
    }
    if (diff) bad('독립 구현과 답이 같다', '어긋난 자리 ' + diff + '건 — 예: ' + JSON.stringify(one));
    else ok('독립 구현과 답이 같다', '무작위 판 ' + boards + '개 · 돌 놓인 자리 ' + checked
                                   + '곳을 전부 대조했다(그중 승리로 잡힌 자리 ' + positives + '곳) — 어긋남 0');
  }
}

/* =====================================================================
   검사 (나) — 규칙 불변식 (제품을 실제 입력으로 두드린다)
   ===================================================================== */
function checkRules(){
  const api = boot({});
  api.click('btnStart');
  const gm = api.gm;

  /* 차례는 흑부터 번갈아 간다 */
  {
    const seqCells = [7 * N + 7, 7 * N + 8, 8 * N + 7, 8 * N + 8, 9 * N + 7];
    const stones = [];
    for (const i of seqCells){ api.tap(i); stones.push(gm.cells()[i]); }
    const want = [1, 2, 1, 2, 1];
    if (stones.join(',') === want.join(',')) ok('차례가 흑·백으로 번갈아 간다', '다섯 수의 색이 ' + stones.join('') + ' (1=흑 · 흑선)');
    else bad('차례가 흑·백으로 번갈아 간다', '색이 ' + stones.join(',') + ' 로 나왔다(기대 ' + want.join(',') + ')');
  }

  /* 이미 돌이 있는 자리에는 못 둔다 */
  {
    const before = gm.state().moves.slice();
    api.tap(7 * N + 7);
    const after = gm.state().moves;
    if (after.length === before.length) ok('이미 돌이 있는 자리에는 못 둔다', '수열 길이가 ' + before.length + ' 에서 늘지 않았다');
    else bad('이미 돌이 있는 자리에는 못 둔다', '수열이 ' + before.length + ' → ' + after.length + ' 로 늘었다');
  }

  /* 파생물(cells)이 진실(수열)에서 벗어나지 않는다 */
  {
    const st = gm.state();
    const same = JSON.stringify(gm.cells()) === JSON.stringify(gm.replay(st.moves));
    if (same) ok('판은 언제나 수열을 다시 그린 것과 같다', '수 ' + st.moves.length + '개 기준 일치');
    else bad('판은 언제나 수열을 다시 그린 것과 같다', 'cells 와 replay(moves)가 다르다');
  }

  /* 마지막 수 표식 — 방금 둔 자리 하나뿐 */
  {
    const st = gm.state();
    const last = st.moves[st.moves.length - 1];
    const marked = gm.markedCells();
    if (marked.length === 1 && marked[0] === last) ok('마지막 수 표식은 방금 둔 자리 하나뿐이다', '표식 자리 ' + marked[0] + ' = 마지막 수');
    else bad('마지막 수 표식은 방금 둔 자리 하나뿐이다', '표식 ' + JSON.stringify(marked) + ' · 마지막 수 ' + last);
  }

  /* 무르기 — 한 판에 한 번, 직전 한 수만 */
  {
    const before = api.gm.state();
    api.click('btnUndo');
    const after = api.gm.state();
    const oneBack = (after.moves.length === before.moves.length - 1)
                 && (after.moves.join(',') === before.moves.slice(0, -1).join(','))
                 && (api.gm.cells()[before.moves[before.moves.length - 1]] === 0);
    if (oneBack) ok('무르기는 직전 한 수만 되돌린다', '수 ' + before.moves.length + ' → ' + after.moves.length + ' · 그 자리가 비었다');
    else bad('무르기는 직전 한 수만 되돌린다', JSON.stringify({ before: before.moves, after: after.moves }));

    const mid = api.gm.state();
    api.click('btnUndo');
    const last = api.gm.state();
    if (last.moves.length === mid.moves.length && last.undoLeft === 0)
      ok('무르기는 한 판에 한 번뿐이다', '두 번째 무르기가 수열을 건드리지 않았다(남은 횟수 0)');
    else bad('무르기는 한 판에 한 번뿐이다', '두 번째 무르기가 먹었다 — ' + JSON.stringify({ mid: mid.moves.length, last: last.moves.length, left: last.undoLeft }));

    if (api.gm.undoDisabled()) ok('무르기를 다 쓰면 버튼이 잠긴다', 'btnUndo disabled = true');
    else bad('무르기를 다 쓰면 버튼이 잠긴다', 'btnUndo 가 아직 눌린다');
  }

  /* 판이 끝난 뒤에는 못 둔다 · 이긴 줄 표시 · 무르기 불가 */
  {
    const a = boot({});
    a.click('btnStart');
    /* 흑 (3,3)~(7,3) 가로 다섯 · 백은 멀리 둔다 */
    const blacks = [[3, 3], [4, 3], [5, 3], [6, 3], [7, 3]];
    const whites = [[3, 10], [4, 10], [5, 10], [6, 10]];
    for (let k = 0; k < 5; k++){
      a.tap(blacks[k][1] * N + blacks[k][0]);
      if (k < 4) a.tap(whites[k][1] * N + whites[k][0]);
    }
    const st = a.gm.state();
    if (st.ended === 'win' && st.win && st.win.line.length === 5 && st.win.stone === 1)
      ok('다섯을 이으면 그 자리에서 이긴다', '9수째에 흑 승리로 끝났다(줄 ' + JSON.stringify(st.win.line) + ')');
    else bad('다섯을 이으면 그 자리에서 이긴다', JSON.stringify(st));

    const painted = a.gm.winCells().join(',');
    const judged = (st.win ? st.win.line.slice().sort((x, y) => x - y) : []).join(',');
    if (painted && painted === judged) ok('이긴 줄 표시는 판정의 줄과 같은 자리다', '표시 ' + painted);
    else bad('이긴 줄 표시는 판정의 줄과 같은 자리다', '표시 ' + painted + ' · 판정 ' + judged);

    if (a.gm.shown('over')) ok('판이 끝나면 결과 창이 뜬다', 'over.show = true');
    else bad('판이 끝나면 결과 창이 뜬다', '결과 창이 뜨지 않았다');

    /* ★표본이 계약에 도달하게 만든다 — 결과 창이 떠 있는 동안은 UI 가드(overShown)가 먼저 막아
       '판이 끝났으니 못 둔다' 는 ★규칙 가드가 밟히지 않는다. 두 가드가 서로를 가리면 규칙 쪽
       뮤테이션이 공허하게 통과한다. 제품의 '판 보기' 로 창을 닫아 판을 살아 있는 채로 만든 뒤 둔다. */
    a.click('btnBoard');
    if (a.gm.overShown() === false && a.gm.shown('over') === false)
      ok('판 보기로 결과 창을 닫고 판을 볼 수 있다', 'over 가 닫히고 화면 가드도 풀렸다');
    else bad('판 보기로 결과 창을 닫고 판을 볼 수 있다', 'over=' + a.gm.shown('over') + ' overShown=' + a.gm.overShown());
    if (a.gm.winCells().length === 5) ok('창을 닫아도 이긴 줄 표시가 남는다', '표시 5칸');
    else bad('창을 닫아도 이긴 줄 표시가 남는다', '표시 ' + a.gm.winCells().length + '칸');

    const n0 = a.gm.state().moves.length;
    a.tap(12 * N + 12);
    if (a.gm.state().moves.length === n0) ok('판이 끝난 뒤에는 못 둔다', '결과 창을 닫은 뒤 누른 수도 수열에 들어가지 않았다(규칙이 막았다)');
    else bad('판이 끝난 뒤에는 못 둔다', '끝난 뒤에도 수가 들어갔다(' + n0 + ' → ' + a.gm.state().moves.length + ')');

    a.click('btnUndo');
    if (a.gm.state().moves.length === n0) ok('판이 끝난 뒤에는 무를 수 없다', '끝난 판의 수열이 그대로다');
    else bad('판이 끝난 뒤에는 무를 수 없다', '끝난 뒤 무르기가 먹었다');

    /* 다시 하기 = 선공 교대 */
    const beforeP = a.gm.state().blackPlayer;
    a.click('btnAgain');
    const s2 = a.gm.state();
    if (s2.blackPlayer !== beforeP && s2.moves.length === 0 && s2.ended === null && s2.undoLeft === 1)
      ok('다시 하기는 선공을 교대한다', '흑을 잡은 사람 ' + beforeP + ' → ' + s2.blackPlayer + ' · 판이 비고 무르기가 돌아왔다');
    else bad('다시 하기는 선공을 교대한다', JSON.stringify({ beforeP, after: s2.blackPlayer, moves: s2.moves.length, ended: s2.ended, undoLeft: s2.undoLeft }));
  }

  /* 판이 다 차면 무승부 — 승리 없이 225수를 채운다 */
  {
    const a = boot({});
    a.click('btnStart');
    /* ★승리 없이 판을 채우는 색칠: 색을 g(x + 2y) = ((x + 2y) mod 4 < 2) 로 정한다.
       그러면 네 방향의 연속 길이가 전부 2 이하다 — 가로는 t 가 1씩(TTFF), 세로는 2씩(TFTF),
       대각↘ 은 3씩(≡ -1), 대각↗ 은 -1씩 움직이기 때문이다. ★이 성질은 말로 두지 않고
       아래에서 하네스의 독립 구현으로 ★최종 판에 다섯 줄이 0개임을 먼저 단언한다.
       (중간 판은 최종 판의 부분집합이므로, 최종 판에 없으면 중간에도 없다.)
       흑이 선수라 흑 113 · 백 112 여야 한다 — 개수가 어긋나면 억지로 밀지 않고 판정 불가로 멈춘다. */
    const g = (x, y) => (((x + 2 * y) % 4) < 2);
    let listA = [], listB = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) (g(x, y) ? listA : listB).push(y * N + x);
    let wantBlack = null, wantWhite = null;
    if (listA.length === 113 && listB.length === 112){ wantBlack = listA; wantWhite = listB; }
    else if (listB.length === 113 && listA.length === 112){ wantBlack = listB; wantWhite = listA; }
    if (!wantBlack){
      ind('판이 다 차면 무승부로 끝난다', '채움 색칠의 개수가 113/112 가 아니다(' + listA.length + '/' + listB.length + ') — 표본을 세울 수 없다');
      return;
    }
    const finalBoard = emptyBoard();
    for (const i of wantBlack) finalBoard[i] = 1;
    for (const i of wantWhite) finalBoard[i] = 2;
    const stray = refWinLines(finalBoard, N, 5);
    if (stray.length){
      ind('판이 다 차면 무승부로 끝난다', '채움 색칠에 다섯 줄이 ' + stray.length + '개 있다 — 이 표본으로는 무승부를 못 만든다');
      return;
    }
    let bi = 0, wi = 0, guard = 0;
    while ((bi < wantBlack.length || wi < wantWhite.length) && guard++ < 400){
      const st = a.gm.state();
      if (st.ended) break;
      /* ★목록을 넘겨 짚지 않는다 — 차례가 한쪽으로만 오는 결함(뮤테이션)에서는 한 목록이 먼저
         바닥난다. 여기서 예외로 죽으면 요약행에 도달하지 못해 '탐지' 로 세지 못한다. */
      const pick = st.turn === 1 ? wantBlack[bi++] : wantWhite[wi++];
      if (pick === undefined) break;
      a.tap(pick);
    }
    const st = a.gm.state();
    if (st.ended === 'draw' && st.moves.length === N * N)
      ok('판이 다 차면 무승부로 끝난다', '225수를 채우고 무승부로 끝났다');
    else if (st.ended === 'win')
      ind('판이 다 차면 무승부로 끝난다', '채우는 순서가 승리를 만들어 무승부까지 못 갔다(' + st.moves.length + '수) — 표본 설계 문제다');
    else
      bad('판이 다 차면 무승부로 끝난다', JSON.stringify({ ended: st.ended, moves: st.moves.length }));
  }
}

/* =====================================================================
   검사 (다) — 화면에 실제로 들어간 글(차례 표시)
   ===================================================================== */
function checkChrome(){
  const a = boot({});
  a.click('btnStart');
  const first = a.gm.turnText();
  a.tap(7 * N + 7);
  const second = a.gm.turnText();
  if (first && second && first !== second)
    ok('차례 표시가 수를 둘 때마다 바뀐다', '"' + first + '" → "' + second + '"');
  else bad('차례 표시가 수를 둘 때마다 바뀐다', '"' + first + '" → "' + second + '"');

  const st = a.gm.state();
  const cnt = a.gm.countText();
  if (cnt.indexOf(String(st.moves.length)) >= 0) ok('둔 수가 화면 숫자와 같다', '"' + cnt + '" · 수열 ' + st.moves.length);
  else bad('둔 수가 화면 숫자와 같다', '"' + cnt + '" 에 ' + st.moves.length + ' 이 없다');

  /* 키보드 — 화살표로 옮기고 Enter 로 둔다 */
  const b = boot({});
  b.click('btnStart');
  const start = b.gm.cursor();
  b.key(start, 'ArrowRight');
  const moved = b.gm.cursor();
  b.key(moved, 'Enter');
  const st2 = b.gm.state();
  if (moved === start + 1 && st2.moves.length === 1 && st2.moves[0] === moved)
    ok('키보드로 옮기고 둘 수 있다', '커서 ' + start + ' → ' + moved + ' 에 착수');
  else bad('키보드로 옮기고 둘 수 있다', JSON.stringify({ start, moved, moves: st2.moves }));

  /* 초점은 커서 한 곳만 받는다(225개가 전부 탭 정거장이 되면 키보드가 못 쓴다) */
  const tab = b.gm.tabbable();
  if (tab.length === 1 && tab[0] === b.gm.cursor()) ok('탭 정거장은 커서 한 곳뿐이다', '자리 ' + tab[0]);
  else bad('탭 정거장은 커서 한 곳뿐이다', JSON.stringify(tab).slice(0, 80));
}


/* =====================================================================
   검사 (라) — ② 링크 이어두기 (남이 만든 URL 을 믿지 않는다)
   ===================================================================== */
function checkLink(){
  const api = boot({});
  const gm = api.gm;

  /* 왕복 — 인코드한 것을 디코드하면 같은 수열이 나온다 */
  {
    const seqs = [[112], [112, 113, 127, 128], [0, 224, 14, 210, 7, 100, 3, 9]];
    let bad0 = 0, one = null;
    for (const seq of seqs){
      const got = gm.decode(gm.encode(seq));
      if (!got.ok || got.moves.join(',') !== seq.join(',')){ bad0++; if (!one) one = { seq, got }; }
    }
    /* ★길이별 왕복은 ★부호화만 잰다(codec) — 규칙 검증(decode)까지 태우면 표본 자체가
       다섯을 잇는 순간 '옳은 거부' 가 붉게 찍힌다(실제로 그랬다 · 붉은 것은 표본이었다).
       길이가 3의 배수가 아닐 때 패딩 자리에서 잘 깨지므로 1~40 을 전부 돌린다. */
    for (let n = 1; n <= 40; n++){
      const seq = Array.from({ length: n }, (_, i) => (i * 7 + 3) % (N * N));
      const back = gm.codec(gm.encode(seq));
      if (!back || back.join(',') !== seq.join(',')){ bad0++; if (!one) one = { n, back }; }
    }
    if (bad0) bad('링크 수열은 왕복해도 그대로다', '어긋난 표본 ' + bad0 + '건 — 예: ' + JSON.stringify(one));
    else ok('링크 수열은 왕복해도 그대로다', '손으로 적은 합법 수열 3종은 decode 까지, 길이 1~40 은 부호화(codec)로 — 전부 그대로 돌아온다');
  }

  /* 용량 — 60수 링크가 URL 실용 한계 안에 있는가(티켓 §3 의 계산을 ★다시 잰다) */
  {
    const seq = Array.from({ length: 60 }, (_, i) => (i * 3 + 5) % N * N);
    const url = gm.link(seq);
    const payload = gm.encode(seq);
    if (payload.length <= 84 && url.length <= 2000)
      ok('60수 링크가 URL 한계 안에 있다', '수열 60바이트 → base64url ' + payload.length + '자 · 링크 전체 ' + url.length + '자(한계 2,000)');
    else bad('60수 링크가 URL 한계 안에 있다', 'payload ' + payload.length + '자 · url ' + url.length + '자');
  }

  /* ★불법 수열 — 거부해야 한다(판을 그리지 않는다) */
  {
    const cases = [
      ['base64', '깨진 글자가 섞였다', 'AAA*BBB'],
      ['base64', '남은 비트가 한 글자를 넘는다(잘린 문자열)', 'AAAAA'],
      ['range', '칸 번호가 판 밖이다(>=225)', gm.encode([112, 250])],
      ['dup', '같은 자리에 두 번 두었다', gm.encode([112, 113, 112])],
      ['afterend', '이미 끝난 판 뒤에 수가 더 있다', gm.encode([45, 60, 46, 61, 47, 62, 48, 63, 49, 80])],
      ['empty', '수가 하나도 없다', '']
    ];
    let wrong = 0, one = null;
    for (const [why, what, payload] of cases){
      const got = gm.decode(payload);
      if (got.ok || got.why !== why){ wrong++; if (!one) one = { what, want: why, got }; }
    }
    if (wrong) bad('불법 수열은 거부한다(판을 그리지 않는다)', '어긋남 ' + wrong + '건 — 예: ' + JSON.stringify(one));
    else ok('불법 수열은 거부한다(판을 그리지 않는다)', '깨진 base64 2종 · 판 밖 · 중복 · 끝난 뒤의 수 · 빈 수열 — 여섯 표본 전부 사유까지 맞게 거부');
  }

  /* 받은 판을 이어받는다 — 판이 그려지고, 차례는 수열이 정한다 */
  {
    const seq = [112, 113, 127, 128, 142];
    const a = boot({ payload: gm.encode(seq) });
    const st = a.gm.state();
    if (st.moves.join(',') === seq.join(',') && a.gm.linkMode() && a.gm.baseLen() === seq.length && !a.gm.shown('start'))
      ok('받은 링크로 판을 이어받는다', seq.length + '수를 그대로 이어받고 시작 화면을 지났다');
    else bad('받은 링크로 판을 이어받는다', JSON.stringify({ moves: st.moves, linkMode: a.gm.linkMode(), baseLen: a.gm.baseLen() }));

    /* ★받은 수는 무를 수 없다 — 무르기는 내가 둔 수의 구제 수단이다 */
    const before = a.gm.state().moves.length;
    a.click('btnUndo');
    if (a.gm.state().moves.length === before) ok('받은 수는 무를 수 없다', '수열 ' + before + ' 그대로');
    else bad('받은 수는 무를 수 없다', '남의 수가 물러졌다(' + before + ' → ' + a.gm.state().moves.length + ')');

    /* 내가 한 수 둔 뒤에는 그 한 수만 무를 수 있다 */
    a.tap(50);
    const mine = a.gm.state().moves.length;
    a.click('btnUndo');
    const after = a.gm.state();
    if (mine === before + 1 && after.moves.length === before) ok('받은 판에서도 내가 둔 수는 무를 수 있다', before + '+1 → ' + after.moves.length);
    else bad('받은 판에서도 내가 둔 수는 무를 수 있다', JSON.stringify({ before, mine, after: after.moves.length }));
  }

  /* ★불법 링크로는 판을 만들지 않는다 — 시작 화면에 머문다 */
  {
    const a = boot({ payload: 'AAA*BBB' });
    const st = a.gm.state();
    if (st.moves.length === 0 && a.gm.shown('start') && !a.gm.linkMode())
      ok('불법 링크로는 판을 만들지 않는다', '수열 0 · 시작 화면 그대로');
    else bad('불법 링크로는 판을 만들지 않는다', JSON.stringify({ moves: st.moves.length, start: a.gm.shown('start'), linkMode: a.gm.linkMode() }));
  }

  /* ★이미 열린 탭의 주소가 링크로 바뀌는 경로 — 시작 화면이 판을 덮은 채로 남으면 안 된다.
     받는 사람의 브라우저가 이미 /gomoku/ 를 연 탭을 재사용하면 이 길로 온다(드문 길이 아니다).
     최초 적재(bootFromHash)만 보고 통과시키면 이 자리가 통째로 검사 밖에 남는다. */
  {
    const a = boot({});                       /* 시작 화면이 뜬 상태(링크 없이 들어온 탭) */
    const startedShown = a.gm.shown('start');
    const fired = a.fireWin('gm:payload', { detail: gm.encode([112, 113, 127, 128, 142]) });
    const st = a.gm.state();
    if (!fired) ind('열린 탭에 링크가 오면 시작 화면을 걷고 판을 드러낸다', 'gm:payload 리스너가 등록돼 있지 않다');
    else if (startedShown && !a.gm.shown('start') && st.moves.length === 5 && a.gm.linkMode() && st.started)
      ok('열린 탭에 링크가 오면 시작 화면을 걷고 판을 드러낸다', '시작 화면 걷힘 · 5수 이어받음 · started=true');
    else
      bad('열린 탭에 링크가 오면 시작 화면을 걷고 판을 드러낸다',
          JSON.stringify({ startedShown, start: a.gm.shown('start'), moves: st.moves.length, linkMode: a.gm.linkMode(), started: st.started }));
  }

  /* 같은 경로로 온 ★불법 링크는 여전히 거부한다(고치다 반대 방향을 열지 않았는지 본다) */
  {
    const a = boot({});
    a.fireWin('gm:payload', { detail: 'AAA*BBB' });
    const st = a.gm.state();
    if (st.moves.length === 0 && a.gm.shown('start') && !a.gm.linkMode())
      ok('열린 탭에 온 불법 링크는 거부한다', '수열 0 · 시작 화면 그대로');
    else
      bad('열린 탭에 온 불법 링크는 거부한다', JSON.stringify({ moves: st.moves.length, start: a.gm.shown('start') }));
  }

  /* 링크 버튼은 한 수라도 두어야 열린다 */
  {
    const a = boot({});
    a.click('btnStart');
    const before = a.gm.linkDisabled();
    a.tap(112);
    const after = a.gm.linkDisabled();
    if (before === true && after === false) ok('링크 버튼은 한 수부터 열린다', '0수 잠김 → 1수 열림');
    else bad('링크 버튼은 한 수부터 열린다', '0수 ' + before + ' · 1수 ' + after);
  }
}

/* ------------------------------------------------------------ 실행 */
console.log('오목 한판 검증 — 대상 ' + HTML + (MUTATION ? ('  [뮤테이션 ' + MUTATION + ']') : ''));
console.log('');
console.log('(가) 승리 판정 — 계약이 사는 자리');
checkJudge(boot({}));
console.log('');
console.log('(나) 규칙 불변식');
checkRules();
console.log('');
console.log('(다) 화면과 키보드');
checkChrome();
console.log('');
console.log('(라) 링크 이어두기 — 남이 만든 URL');
checkLink();
console.log('');
console.log('결과: 통과 ' + pass + ' · 미달 ' + fail + ' · 판정 불가 ' + indet);

if (MUTATION && MUTATIONS[MUTATION].quiet){
  /* ★음성 대조군 — 계약이 아닌 것을 건드렸으므로 평소와 같아야 한다(rc=0) */
  console.log('★음성 대조군 ' + MUTATION + ' — 계약이 아닌 자리다. 조용해야 통과다.');
  process.exit(fail ? 1 : (indet ? 2 : 0));
}
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  if (!ran.has(m.catcher)){
    console.log('★지목한 검사가 돌지 않았다(앵커 노후화 또는 검사 소실): [' + m.catcher + ']');
    process.exit(2);
  }
  if (failedChecks.has(m.catcher)){
    console.log('★뮤테이션 ' + MUTATION + ' 을 지목한 검사가 잡았다: [' + m.catcher + ']');
    process.exit(1);     /* rc=1 — 정상 검출(기대값) */
  }
  console.log('★뮤테이션 ' + MUTATION + ' 을 지목한 검사가 잡지 못했다(무임승차 인정 안 함): [' + m.catcher + ']');
  process.exit(3);       /* rc=3 — 검출력 없음(검사가 공허하다) · rc=2(판정 불가)와 가른다 */
}
process.exit(fail ? 1 : (indet ? 2 : 0));
