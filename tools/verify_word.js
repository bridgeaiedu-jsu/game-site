/* 오늘의 낱말(/word/) 검증기 — worker-2 · 2026-08-23
 *
 * 성공 기준 ①~⑧ 을 기계로 확인한다. 정본 규약(블록 낙하 R6)의 검증 방식을 따른다:
 *   · 공유 저장소 하나 위에서 여러 '탭'(인스턴스)을 띄운다
 *   · Web Locks 를 모의해 임계구역·비교-교환(CAS)을 실제로 밟는다
 *   · 가짜 시계로 날짜를 바꿔 일일 결정성·만료를 본다
 *
 * 사용법: node verify_word.js [--html <경로>] [--mutate <이름>]
 * 종료코드: 0 = 전부 PASS · 1 = 하나라도 FAIL · 2 = 뮤테이션 주입 실패(설정 오류 — 탐지 아님)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
/* 기본 대상은 **이 도구가 놓인 저장소의 /word/index.html** 이다 — 특정 작업 트리의 절대경로를
   박아 두면 저장소를 옮기거나 worktree 를 갈아탈 때 조용히 남의 파일을 재게 된다. */
const HTML = argOf('--html', path.join(__dirname, '..', 'word', 'index.html'));
const MUTATION = argOf('--mutate', null);

/* 허용 목록 — 광고 스크립트는 제품 결정으로 들어온 외부 요청이다(d460a92 · 7개 페이지 전부).
   검사를 통째로 끄는 대신 **여기 적힌 호스트만** 예외로 둔다. 목록 밖의 외부 요청은 여전히 0
   이어야 하고, fetch·XHR 은 예외 없이 0 이다. 목록은 이 한 곳에만 둔다 — 검사 안에 호스트를
   흩뿌리면 다음 사람이 조용히 늘려도 아무도 알아채지 못한다. */
const ALLOWED_EXTERNAL_SCRIPT_HOSTS = ['pagead2.googlesyndication.com'];

/* --------------------------------------------------- 고의 결함(뮤테이션) */
/* ★대상 파일의 줄바꿈을 실측해 쓴다 — CRLF 로 못박으면 LF 파일에서 앵커가 통째로 어긋나
   '주입 실패'가 무더기로 나고 검출력이 조용히 0 이 된다. */
const RAW = fs.readFileSync(HTML, 'utf8');
const NL = RAW.indexOf(String.fromCharCode(13, 10)) >= 0 ? String.fromCharCode(13, 10) : String.fromCharCode(10);
const MUTATIONS = {
  'w-score-no-pool': ['중복 자모 배정 제거 — 정답에 든 개수보다 많이 노랑이 뜬다',
    '    if (pool[g] > 0){ pool[g]--; out[i] = \'near\'; }',
    '    if (answerSlots.indexOf(g) >= 0){ out[i] = \'near\'; }'],
  /* ★빈칸(·) 특례는 두 곳이 서로를 가린다: 정답 쪽 풀에 빈칸을 안 넣는 줄과 추측 쪽에서
     빈칸을 건너뛰는 줄. 한 줄만 뒤집으면 다른 줄이 막아 주어 행동이 바뀌지 않는다(공허).
     그래서 채점 함수 전체를 '빈칸 특례가 없는 판본'으로 갈아 끼운다. */
  'w-score-no-empty-rule': ['빈칸(·) 특례 제거 — 빈칸이 다른 자리에서 노랑으로 샌다',
    '    const a = answerSlots[i];' + NL + '    if (a !== EMPTY) pool[a] = (pool[a] || 0) + 1;'
      + NL + '  }' + NL + '  for (let i = 0; i < n; i++){' + NL + "    if (out[i] === 'hit') continue;"
      + NL + '    const g = guessSlots[i];' + NL + '    if (g === EMPTY) continue;',
    '    const a = answerSlots[i];' + NL + '    pool[a] = (pool[a] || 0) + 1;'
      + NL + '  }' + NL + '  for (let i = 0; i < n; i++){' + NL + "    if (out[i] === 'hit') continue;"
      + NL + '    const g = guessSlots[i];'],
  'w-answer-modulo-hash': ['날짜 해시 모듈로로 정답 선택 — 순서 무중복 보장이 깨진다',
    'const answerFor = no => ANSWERS[((no - 1) % ANSWERS.length + ANSWERS.length) % ANSWERS.length];',
    'const answerFor = no => ANSWERS[hashStr(\'x\' + no) % ANSWERS.length];'],
  'w-no-cas': ['비교-교환 제거 — 갈라진 두 탭이 서로의 진행을 덮는다',
    '  if (!casOk(prev)){ rejectWhy = \'fork\'; return false; }',
    '  if (false){ rejectWhy = \'fork\'; return false; }'],
  'w-rev-not-monotonic': ['리비전을 올리지 않는다 — 남의 쓰기를 알아볼 표지가 사라진다',
    '    nextRun.rev = runRev + 1;',
    '    nextRun.rev = runRev;'],
  'w-no-list-check': ['목록 밖 낱말도 받아 준다',
    '  if (!inList(w)){ toast(T(\'notInList\')); shakeRow(); sBad(); return; }',
    '  if (false){ toast(T(\'notInList\')); shakeRow(); sBad(); return; }'],
  'w-share-leaks-answer': ['공유 문자열에 정답을 넣는다',
    '  return head + grid + \'\\n\' + location.href.split(\'#\')[0];',
    '  return head + grid + \'\\n\' + answer + \'\\n\' + location.href.split(\'#\')[0];'],
  'w-buttons-not-disabled': ['준비 중에도 시작 창 버튼을 잠그지 않는다',
    "  $('btnDaily').disabled = preparing;" + NL + "  $('btnFree').disabled = preparing;",
    "  $('btnDaily').disabled = false;" + NL + "  $('btnFree').disabled = false;"],
  'w-nested-no-parent-inert': ['중첩 시 부모 오버레이를 잠그지 않는다 — 탭·낭독기가 부모로 샌다',
    '  setOverlayLocked(ovTop(), true);              /* 부모가 있으면 배경으로 잠근다 */',
    '  /* 부모를 잠그지 않는다 */;'],
  'w-nested-no-focus-restore': ['자식을 닫아도 초점을 되돌리지 않는다 — 숨은 버튼에 초점이 남는다',
    '    if (back) focusSafely(back);',
    '    if (false) focusSafely(back);'],
  'w-nested-parent-stays-modal': ['부모의 aria-modal 을 내리지 않는다 — 활성 모달이 둘이 된다',
    "  if (on){ el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); el.setAttribute('aria-modal', 'false'); }",
    "  if (on){ el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }"],
  'w-profanity-in-guesses': ['금칙 표면형을 허용 추측어로 되돌린다',
    'const GUESSES = new Set();',
    "const GUESSES = new Set(['새끼','시발','지랄']);"],
  'w-profanity-in-answers': ['금칙 표면형을 일일 정답 목록에 되돌린다',
    'const ANSWERS = [];',
    "const ANSWERS = ['새끼'];"],
  'w-jong-split-3syllable': ['받침 넘김 경계 완화 — 세 글자가 만들어진다',
    '      if (comp.done.length >= 1) return false;' + NL + '      let moved = comp.jong, keep = \'\';',
    '      if (comp.done.length >= 9) return false;' + NL + '      let moved = comp.jong, keep = \'\';']
};

/* --------------------------------------------------------- 스크립트 추출 */
/* ★HTML/CSS 를 겨냥한 뮤테이션 — 대비·출처 링크는 <script> 밖에 있어서
   스크립트만 갈아 끼우는 통로로는 검출력을 세울 수 없다. */
const MUTATIONS_HTML = {
  'w-kb-miss-low-contrast': ['화면 자판 miss 글자색을 R1 값(#8fa79a·3.292:1)으로 되돌린다',
    '.kb button.miss{background:var(--miss);border-color:var(--miss);color:#cfe0d6}',
    '.kb button.miss{background:var(--miss);border-color:var(--miss);color:#8fa79a}'],
  'w-source-href-ko-dropped': ['ko 출처에서 원문(학습용 어휘 목록) 링크를 없앤다',
    'dataCredit:\'단어 자료: 국립국어원 <a href="https://www.korean.go.kr/front/etcData/etcDataView.do?etc_seq=71"',
    'dataCredit:\'단어 자료: 국립국어원 <a href="#"'],
  'w-license-href-en-dropped': ['en 출처에서 공공누리 제1유형 조건 링크를 없앤다',
    '<a href="https://www.kogl.or.kr/info/license.do" target="_blank" rel="noopener noreferrer external">KOGL Type 1 (Attribution)</a>',
    '<span>KOGL Type 1 (Attribution)</span>']
};
function mutateHtml(text){
  if (!MUTATION || !MUTATIONS_HTML[MUTATION]) return text;
  const [desc, from, to] = MUTATIONS_HTML[MUTATION];
  const n = text.split(from).length - 1;
  if (n !== 1) { console.error(`뮤테이션 앵커가 ${n}곳 — 정확히 1곳이어야 한다: ${MUTATION}`); process.exit(2); }
  console.log(`## 뮤테이션 주입(HTML): ${MUTATION} — ${desc}`);
  return text.replace(from, to);
}
const html = mutateHtml(RAW);
const blocks = [...html.matchAll(/<script(?![^>]*type=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let SRC = blocks.reduce((a, b) => (b.length > a.length ? b : a), '');
if (SRC.length < 10000) { console.error('추출 실패'); process.exit(1); }

if (MUTATION) {
  const m = MUTATIONS[MUTATION];
  if (!m) {
    if (MUTATIONS_HTML[MUTATION]) { /* HTML 쪽에서 이미 주입했다 */ }
    else { console.error('알 수 없는 뮤테이션: ' + MUTATION); process.exit(2); }
  }
  const [desc, from, to] = m || [null, null, null];
  if (m) {
  const n = SRC.split(from).length - 1;
  if (n !== 1) { console.error(`뮤테이션 앵커가 ${n}곳 — 정확히 1곳이어야 한다: ${MUTATION}`); process.exit(2); }
  SRC = SRC.replace(from, to);
  console.log(`## 뮤테이션 주입: ${MUTATION} — ${desc}`);
  }
}

/* ------------------------------------------------------------ 가짜 시계 */
const RealDate = Date;
let CLOCK = null;
function setClock(iso) { CLOCK = iso === null ? null : new RealDate(iso).getTime(); }
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0 && CLOCK !== null) super(CLOCK); else super(...a); }
  static now() { return CLOCK !== null ? CLOCK : RealDate.now(); }
}

/* ---------------------------------------------------------- 저장소(공유) */
const storeMap = new Map();
let writeHistory = [];
const localStorage = {
  getItem: k => (storeMap.has(k) ? storeMap.get(k) : null),
  setItem: (k, v) => {
    storeMap.set(k, String(v));
    if (k === 'wd.daily') {
      let o = null; try { o = JSON.parse(String(v)); } catch (_) {}
      const run = o && o.run;
      writeHistory.push({ date: o && o.date, hasResult: !!(o && o.result), hasRun: !!run,
                          rev: run ? (run.rev | 0) : null, runId: run ? run.runId : null,
                          tries: run && Array.isArray(run.guesses) ? run.guesses.length : null });
    }
  },
  removeItem: k => { storeMap.delete(k); },
  clear: () => storeMap.clear(),
  keys: () => [...storeMap.keys()]
};
const rawDaily = () => { try { return JSON.parse(localStorage.getItem('wd.daily') || 'null'); } catch (_) { return null; } };
const curRev = () => { const r = rawDaily(); return r && r.run ? (r.run.rev | 0) : null; };

/* ------------------------------------------------- Web Locks 모의 구현 */
function makeLockManager() {
  const tail = new Map();
  return {
    request(name, opts, cb) {
      const prev = tail.get(name) || Promise.resolve();
      let release;
      const held = new Promise(res => { release = res; });
      tail.set(name, prev.then(() => held));
      return prev.then(() => {
        let out;
        try { out = cb(); } finally { }
        return Promise.resolve(out).finally(() => release());
      });
    }
  };
}

/* ------------------------------------------------------------ DOM 스텁 */
function makeEl(id, doc, tag) {
  const el = {
    id, tagName: (tag || 'DIV').toUpperCase(), dataset: {}, style: {}, _text: '', innerHTML: '',
    isConnected: true, children: [], _attrs: {}, _classes: new Set(), disabled: false, onclick: null,
    classList: {
      add: c => el._classes.add(c), remove: c => el._classes.delete(c),
      contains: c => el._classes.has(c),
      toggle: (c, on) => { if (on === undefined) { el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c); }
                           else if (on) el._classes.add(c); else el._classes.delete(c); }
    },
    setAttribute: (k, v) => { el._attrs[k] = String(v); },
    getAttribute: k => (k in el._attrs ? el._attrs[k] : null),
    removeAttribute: k => { delete el._attrs[k]; },
    hasAttribute: k => k in el._attrs,
    addEventListener: () => {}, removeEventListener: () => {},
    querySelectorAll: sel => el._descend().filter(c => matchesSel(c, sel)),
    querySelector: sel => el._descend().find(c => matchesSel(c, sel)) || null,
    /* ★부모 사슬을 실제로 걷는다 — closest 가 늘 null 이면 '숨은 요소인가·inert 안인가'를
       가릴 수 없어 초점 검사가 공허하게 통과한다(codex R1 issue#5). */
    closest: sel => { let n = el; while (n) { if (matchesSel(n, sel)) return n; n = n.parent || null; } return null; },
    matches: sel => matchesSel(el, sel),
    getBoundingClientRect: () => (visibleNow(el) ? { width: 40, height: 40, top: 0, left: 0 }
                                                 : { width: 0, height: 0, top: 0, left: 0 }),
    /* 브라우저는 숨은·inert 요소에 초점을 주지 않는다 — 스텁도 같게 굴어야 실측이 된다 */
    focus: () => { if (!visibleNow(el) || inertNow(el)) return; doc.activeElement = el; }, blur: () => {},
    appendChild: c => { el.children.push(c); c.parent = el; return c; },
    _descend: () => { const out = []; const walk = n => { for (const c of n.children) { out.push(c); walk(c); } }; walk(el); return out; }
  };
  Object.defineProperty(el, 'textContent', {
    get(){ return el._text; },
    set(v){ el._text = String(v); }
  });
  Object.defineProperty(el, 'offsetWidth', { get(){ return 100; } });
  return el;
}
function matchesSel(el, sel) {
  if (!sel) return false;
  for (const part of sel.split(',')) {
    const s = part.trim();
    if (s === 'button' && el.tagName === 'BUTTON') return true;
    if (s === '[data-i18n]' && el.dataset.i18n !== undefined) return true;
    if (s === 'a[href="/"]' && el.tagName === 'A') return true;
    if (s.startsWith('a[href]') && el.tagName === 'A') return true;
    if (s === 'input' && el.tagName === 'INPUT') return true;
    if (s === 'select' && el.tagName === 'SELECT') return true;
    if (s === 'textarea' && el.tagName === 'TEXTAREA') return true;
    if (s === '[tabindex]' && el.hasAttribute('tabindex')) return true;
    if (s === '.overlay' && el._classes.has('overlay')) return true;
    if (s === '.overlay:not(.show)' && el._classes.has('overlay') && !el._classes.has('show')) return true;
    if (s === '[inert]' && el.hasAttribute('inert')) return true;
  }
  return false;
}
/* 오버레이 안에 있는데 그 오버레이가 열려 있지 않으면 화면에 없다(display:none) */
function visibleNow(el) {
  let n = el;
  while (n) { if (n._classes && n._classes.has('overlay') && !n._classes.has('show')) return false; n = n.parent || null; }
  return true;
}
function inertNow(el) {
  let n = el;
  while (n) { if (n.hasAttribute && n.hasAttribute('inert')) return true; n = n.parent || null; }
  return false;
}
function HTMLElementStub() {}
HTMLElementStub.prototype = { inert: undefined };

function boot(locks) {
  const els = new Map();
  const doc = {
    documentElement: null, body: null, activeElement: null, hidden: false, title: '',
    getElementById: id => { if (!els.has(id)) els.set(id, makeEl(id, doc)); return els.get(id); },
    querySelectorAll: sel => [...els.values()].filter(e => matchesSel(e, sel)),
    querySelector: sel => [...els.values()].find(e => matchesSel(e, sel)) || null,
    createElement: t => makeEl('new_' + t, doc, t),
    addEventListener: () => {}, removeEventListener: () => {}
  };
  doc.documentElement = makeEl('html', doc);
  doc.body = makeEl('body', doc);
  /* 페이지 마크업이 처음부터 갖고 있는 것들 — 스텁은 HTML 을 파싱하지 않으므로 손으로 맞춘다 */
  /* ★오버레이와 그 안의 버튼을 실제 부모-자식으로 세운다(마크업과 같은 사슬).
     이게 없으면 '숨은 버튼에 초점이 남았다'를 구분하지 못한다. */
  const OVERLAY_KIDS = { start: ['btnDaily','btnFree'], help: ['btnHelpClose'],
                         over: ['btnShare','btnAgain','btnStats2'], stats: ['btnStatsClose'] };
  for (const ovId of Object.keys(OVERLAY_KIDS)) {
    const ov = doc.getElementById(ovId);
    ov._classes.add('overlay');
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    for (const kid of OVERLAY_KIDS[ovId]) { const b = doc.getElementById(kid); b.tagName = 'BUTTON'; ov.appendChild(b); }
    doc.body.children.push(ov);
  }
  doc.getElementById('start')._classes.add('show');
  /* ko 본문 문단은 마크업에서 읽어 오므로 자리만 만들어 준다 */
  for (const k of ['how1','how2','how3','how4','dailyDesc']) {
    const e = makeEl('p_' + k, doc, 'p');
    e.dataset.i18n = k; e.innerHTML = '(' + k + ')';
    els.set('p_' + k, e);
  }
  doc.body.children = [doc.getElementById('board'), doc.getElementById('kb')];

  const nav = { language: 'ko-KR' };
  if (locks) nav.locks = locks;
  const win = {
    addEventListener: (t, fn) => { if (t === 'keydown') win._keydown = fn; },
    removeEventListener: () => {},
    devicePixelRatio: 1, navigator: nav, localStorage,
    getComputedStyle: (e) => ({ visibility: (e && !visibleNow(e)) ? 'hidden' : 'visible' }),
    location: { href: 'https://hanpango.com/word/' },
    setTimeout, clearTimeout, HTMLElement: HTMLElementStub, document: doc
  };
  const sandbox = {
    window: win, document: doc, localStorage, navigator: nav,
    getComputedStyle: win.getComputedStyle, HTMLElement: HTMLElementStub,
    location: win.location, setTimeout, clearTimeout, console, Math,
    Date: FakeDate, JSON, Promise
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(SRC, sandbox, { filename: 'word-inline.js' }); }
  catch (e) { console.error('구동 실패: ' + e.stack); process.exit(1); }
  if (!win.__wd) { console.error('window.__wd 훅 없음'); process.exit(1); }
  const txt = id => doc.getElementById(id).textContent;
  const shown = id => doc.getElementById(id)._classes.has('show');
  const el = id => doc.getElementById(id);
  return { wd: win.__wd, doc, txt, shown, el, win };
}

const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

/* ------------------------------------------------------------ 테스트 틀 */
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
const section = t => console.log('\n[' + t + ']');
const note = t => console.log('    · ' + t);

/* 잠금을 붙잡아 대기 창을 넓힌다 */
function holdLock(locks) {
  let release;
  const held = new Promise(r => { release = r; });
  locks.request('wd.daily', { mode: 'exclusive' }, () => held);
  return () => release();
}
const press = (t, id) => { const f = t.el(id).onclick; if (typeof f !== 'function') return false; f(); return true; };

(async () => {
console.log('# 오늘의 낱말 검증 — 성공 기준 ①~⑧');
console.log('# 대상: ' + HTML);

/* ============================================ 0. 정적 스캔 */
section('0. 정적 스캔 — 규약·금지선');
{
  ok('★상표 명칭을 쓰지 않는다(Wordle·워들)',
     !/wordle/i.test(html) && html.indexOf('워들') < 0, '금지 명칭이 문서에 있다');
  const keys = [...SRC.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\('([^']+)'/g)].map(m => m[1]);
  eq('★저장 키는 정확히 wd 4개 + bp.lang', [...new Set(keys)].sort(),
     ['bp.lang', 'wd.daily', 'wd.sound', 'wd.stats', 'wd.streak']);
  /* 주석 안 자리표시자는 요청을 내지 않으므로 걷어내고 본다. 그리고 **호스트**로 판정한다 —
     질의 문자열(client=…)이 바뀌었다고 통과·불통과가 흔들리면 안 된다. */
  const extScriptHosts = [...html.replace(/<!--[\s\S]*?-->/g, '')
    .matchAll(/<script[^>]+src=["'](https?:\/\/[^"']+)["']/gi)]
    .map(m => { try { return new URL(m[1]).hostname; } catch (e) { return m[1]; } });
  const strayHosts = [...new Set(extScriptHosts
    .filter(h => ALLOWED_EXTERNAL_SCRIPT_HOSTS.indexOf(h) < 0))];
  const strayRuntime = [];
  if (/\bfetch\s*\(/.test(SRC)) strayRuntime.push('fetch(');
  if (/XMLHttpRequest/.test(SRC)) strayRuntime.push('XMLHttpRequest');
  ok('★런타임 외부 요청이 없다(fetch·XHR·허용 목록 밖 외부 script src)',
     strayRuntime.length === 0 && strayHosts.length === 0,
     '외부 요청 흔적: ' + strayRuntime.concat(strayHosts).join(', '));
  ok('ADSENSE 자리 3곳', (html.match(/ADSENSE \(/g) || []).length === 3,
     `${(html.match(/ADSENSE \(/g) || []).length}곳`);
  /* 마크업 안의 링크만 센다 — 스크립트의 선택자 문자열까지 세면 3곳으로 보인다 */
  const markup = html.slice(0, html.indexOf('<script>'));
  ok('🏠 다른 게임 링크 2곳', (markup.match(/data-i18n="home"/g) || []).length === 2,
     `${(markup.match(/data-i18n="home"/g) || []).length}곳`);
  ok('핀치줌을 막지 않는다',
     !/user-scalable\s*=\s*no/.test(html) && !/maximum-scale/.test(html));
  ok('theme-color 가 있다', /name="theme-color"/.test(html));
  ok('보드가 grid 역할을 쓴다',
     /role="grid"/.test(html) && /'role', 'row'/.test(SRC) && /'role', 'gridcell'/.test(SRC));
  ok('오버레이 4개가 dialog·aria-modal 이다',
     (html.match(/role="dialog" aria-modal="true"/g) || []).length === 4);
  ok('바깥을 inert 로 막는다', /setOutsideInert/.test(SRC) && /inert/.test(SRC));
  ok('aria-live 요약이 있다', /aria-live="polite"/.test(html));
  /* ★공공누리 제1유형은 '가능하면 출처 웹사이트 링크'를 요구한다 — 기관명 문자열이 있는지가
     아니라 두 원문 href 와 라이선스 href 가 **정확한 자리(정적 마크업·ko·en)** 에 있는지 본다.
     (codex R1 issue#2 — 문자열 존재 검사는 링크 부재를 통과시켰다) */
  const HREF_A = 'https://www.korean.go.kr/front/etcData/etcDataView.do?etc_seq=71';
  const HREF_B = 'https://www.korean.go.kr/front/etcData/etcDataView.do?etc_seq=60';
  const HREF_L = 'https://www.kogl.or.kr/info/license.do';
  const hasHref = (s, u) => s.indexOf('href="' + u + '"') >= 0;
  const markupAll = html.slice(0, html.indexOf('<script>'));
  const credZone = (() => {   /* 정적 마크업의 출처 표시 블록 */
    const i = markupAll.indexOf('data-i18n="dataCredit"');
    return i < 0 ? '' : markupAll.slice(i, markupAll.indexOf('</div>', i));
  })();
  const dictZone = tag => {   /* ko/en 사전의 dataCredit 값 */
    const re = new RegExp("dataCredit:'([^']*)'", 'g');
    const all = [...SRC.matchAll(re)].map(m => m[1]);
    return all[tag] || '';
  };
  ok('★정적 출처 표시에 A 자료 원문 링크가 있다', hasHref(credZone, HREF_A), credZone.slice(0, 120));
  ok('★정적 출처 표시에 B 자료 원문 링크가 있다', hasHref(credZone, HREF_B), credZone.slice(0, 120));
  ok('★정적 출처 표시에 공공누리 제1유형 조건 링크가 있다', hasHref(credZone, HREF_L), credZone.slice(0, 120));
  ok('정적 출처 표시에 기관·저작물명·연도가 있다',
     /국립국어원/.test(credZone) && /한국어 학습용 어휘 목록/.test(credZone) &&
     /현대 국어 사용 빈도 조사/.test(credZone) && /2003/.test(credZone) && /2002/.test(credZone));
  ok('출처 표시가 ko·en 양쪽에 있다', (SRC.match(/dataCredit:/g) || []).length === 2);
  for (const [i, name] of [[0, 'ko'], [1, 'en']]) {
    const z = dictZone(i);
    ok(`★${name} 출처에 A 자료 원문 링크가 있다`, hasHref(z, HREF_A), z.slice(0, 100));
    ok(`★${name} 출처에 B 자료 원문 링크가 있다`, hasHref(z, HREF_B), z.slice(0, 100));
    ok(`★${name} 출처에 공공누리 제1유형 조건 링크가 있다`, hasHref(z, HREF_L), z.slice(0, 100));
  }
  ok('출처 링크는 새 탭·noopener 로 연다', (html.match(/rel="noopener noreferrer external"/g) || []).length >= 9,
     `${(html.match(/rel="noopener noreferrer external"/g) || []).length}곳`);
  ok('물리 자판이 code 기반이다(IME 무관)', /e\.code/.test(SRC) && /KeyQ/.test(SRC));
  ok('비교-교환(CAS)이 있다', /function casOk\(/.test(SRC) && /rejectWhy = 'fork'/.test(SRC));
  ok('Web Locks 임계구역과 재진입 보호가 있다',
     /navigator\.locks/.test(SRC) && /lockDepth/.test(SRC));
}

/* ============================================ 1. 자모 분해·조합 왕복 */
section('1. 자모 분해/조합 — 정답 목록 100단어 왕복');
{
  storeMap.clear(); writeHistory = [];
  const locks = makeLockManager();
  setClock('2026-08-23T09:00:00');
  const A = boot(locks);
  const sizes = A.wd.listSizes();
  ok('정답 목록 800개 이상', sizes.answers >= 800, JSON.stringify(sizes));
  ok('허용 추측어 3000개 이상', sizes.guesses >= 3000, JSON.stringify(sizes));

  let bad = 0, dot = 0, first = null;
  for (let i = 0; i < 100; i++){
    const w = A.wd.answerFor(i + 1);
    const s = A.wd.slots(w);
    if (s.length !== 6) { bad++; continue; }
    if (s[2] === '·') dot++;
    const back = A.wd.fromSlots(s);
    if (back !== w){ bad++; if (!first) first = [w, s, back]; }
  }
  eq('★100단어 분해→조합 왕복 불일치 0', bad, 0);
  note('앞 100단어 중 첫 글자 받침 없음: ' + dot + '개');
  if (first) note('첫 불일치: ' + JSON.stringify(first));

  eq('받침 없는 글자는 · 로 채운다', A.wd.slots('바다'), ['ㅂ','ㅏ','·','ㄷ','ㅏ','·']);
  eq('겹받침은 한 칸에 한 자모다', A.wd.slots('값어')[2], 'ㅄ');
  eq('이중모음도 한 칸이다', A.wd.slots('과일')[1], 'ㅘ');
  eq('종성 있는 글자', A.wd.slots('학교'), ['ㅎ','ㅏ','ㄱ','ㄱ','ㅛ','·']);
}

/* ============================================ 2. 채점 오라클 */
section('2. 채점 — 중복 자모 처리 포함 200케이스');
{
  const locks = makeLockManager();
  const A = boot(locks);
  const S = (g, a) => A.wd.score(g, a).map(x => x[0]).join('');   /* h/n/m */

  eq('정답과 같으면 전부 정확', S('바다','바다'), 'hhhhhh');
  eq('아무것도 안 맞으면 전부 없음', S('국수','바다').replace(/[^m]/g,'').length >= 4, true);
  /* 받침 없음(·)은 자리 맞으면 초록, 노랑 후보로는 쓰지 않는다 */
  const r1 = A.wd.score('나무','바다');
  eq("'나무' vs '바다' — 받침 빈칸 두 곳이 자리 맞아 초록", [r1[2], r1[5]], ['hit','hit']);
  /* ㅏ 는 정답에 두 번 있다 → 두 번까지만 색이 난다 */
  const r2 = A.wd.score('아사','바다');
  eq("'아사' vs '바다' — ㅏ 두 개가 각각 자리 맞음", [r2[1], r2[4]], ['hit','hit']);
  /* 정답에 한 번뿐인 자모를 두 곳에 넣으면 한 곳만 색이 난다 */
  const r3 = A.wd.score('기기','기차');
  eq("'기기' vs '기차' — 첫 칸만 정확", [r3[0], r3[1]], ['hit','hit']);
  /* ★빈칸(·) 특례 — 정답에 남아 있는 빈칸이 다른 자리의 빈칸을 노랑으로 물들이면 안 된다.
     '학교'는 둘째 글자에 받침이 없고(빈칸), '가족'은 첫째 글자에 받침이 없다.
     빈칸 특례가 빠지면 '가족'의 3번째 칸(빈칸)이 노랑이 된다. */
  const r4 = A.wd.score('가족','학교');
  eq("★'가족' vs '학교' — 빈칸은 다른 자리로 옮겨 붙지 않는다", r4[2], 'miss');
  eq("'가족' vs '학교' — ㄱ 은 두 곳에서 위치 다름", [r4[0], r4[5]], ['near','near']);
  ok("'기기' vs '기차' — 남은 ㄱ 은 색이 나지 않는다", r3[3] === 'miss',
     JSON.stringify(r3));

  /* ★무작위 200케이스 오라클 대조 — 검증기 안에 독립 구현을 두고 결과를 맞춰 본다 */
  const CHO = A.wd.jamo().CHO, EMPTY = A.wd.jamo().EMPTY;
  function oracle(gs, as){
    const n = as.length, out = new Array(n).fill('miss'), left = [];
    for (let i = 0; i < n; i++){
      if (gs[i] === as[i]) out[i] = 'hit';
      else if (as[i] !== EMPTY) left.push(as[i]);
    }
    for (let i = 0; i < n; i++){
      if (out[i] !== 'miss' || gs[i] === EMPTY) continue;
      const k = left.indexOf(gs[i]);
      if (k >= 0){ left.splice(k, 1); out[i] = 'near'; }
    }
    return out;
  }
  let mismatch = 0, sample = null, nearCount = 0;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let t = 0; t < 200; t++){
    const g = A.wd.answerFor(1 + Math.floor(rnd() * 1000));
    const a = A.wd.answerFor(1 + Math.floor(rnd() * 1000));
    const got = A.wd.score(g, a);
    const want = oracle(A.wd.slots(g), A.wd.slots(a));
    nearCount += got.filter(x => x === 'near').length;
    if (JSON.stringify(got) !== JSON.stringify(want)){
      mismatch++;
      if (!sample) sample = { g, a, got, want };
    }
  }
  eq('★200케이스 오라클 불일치 0', mismatch, 0);
  ok('표본에 위치 다름(노랑)이 실제로 나왔다(공허한 시험 방지)', nearCount > 20, 'near=' + nearCount);
  if (sample) note('첫 불일치: ' + JSON.stringify(sample));
}

/* ============================================ 3. 두벌식 조합기 */
section('3. 두벌식 조합 — 겹받침·이중모음·지우기');
{
  const A = boot(makeLockManager());
  const type = s => { A.wd.clear(); return A.wd.type(s); };
  eq('바다', type('ㅂㅏㄷㅏ'), '바다');
  eq('학교', type('ㅎㅏㄱㄱㅛ'), '학교');
  eq('이중모음 과일', type('ㄱㅗㅏㅇㅣㄹ'), '과일');
  eq('겹받침 없다', type('ㅇㅓㅂㅅㄷㅏ'), '없다');
  eq('받침이 다음 글자로 넘어간다', type('ㅁㅜㄴㅓ'), '무너');
  eq('첫소리만 친 상태', type('ㄱ'), 'ㄱ');
  eq('★두 글자를 넘겨 세 글자가 되지 않는다', type('ㅂㅏㄷㅏㄱㅏ').length <= 2, true);
  A.wd.clear(); A.wd.type('ㅂㅏㄷㅏ');
  A.wd.back(); eq('지우기 한 번 — 모음이 빠진다', A.wd.typed(), '바ㄷ');
  A.wd.back(); eq('지우기 두 번 — 둘째 글자가 사라진다', A.wd.typed(), '바');
  A.wd.clear(); A.wd.type('ㅇㅓㅂㅅ');
  A.wd.back(); eq('겹받침은 한 자모씩 지워진다', A.wd.typed(), '업');
  A.wd.clear(); A.wd.type('ㄱㅗㅏ');
  A.wd.back(); eq('이중모음도 한 자모씩 지워진다', A.wd.typed(), '고');
}

/* ============================================ 4. 일일 결정성 */
section('4. 일일 도전 — 같은 날 같은 낱말 · 날짜별 상이 · 무중복');
{
  storeMap.clear(); writeHistory = [];
  const locks = makeLockManager();
  setClock('2026-08-24T09:00:00');
  const A = boot(locks), B = boot(locks);
  eq('두 인스턴스가 같은 날 같은 낱말을 가리킨다',
     A.wd.answerFor(A.wd.dailyNo()), B.wd.answerFor(B.wd.dailyNo()));
  const n1 = A.wd.dailyNo();                 /* ★시계를 옮기기 전에 읽어 둔다 — dailyNo 는 지금 시각을 본다 */
  const d1 = A.wd.answerFor(n1);
  setClock('2026-08-25T09:00:00');
  const C = boot(locks);
  const d2 = C.wd.answerFor(C.wd.dailyNo());
  ok('★다음 날은 다른 낱말이다', d1 !== d2, `${d1} / ${d2}`);
  eq('도전 번호는 날짜에서 나온다', [n1, C.wd.dailyNo()], [2, 3]);
  eq('시드 키에 날짜가 들어간다', A.wd.seedKey('2026-08-24'), 'hanpango-daily-word-2026-08-24');
  /* ★무중복 — 목록 길이만큼 돌 때까지 같은 낱말이 다시 나오지 않는다 */
  const n = A.wd.listSizes().answers;
  const seen = new Set();
  let dup = 0;
  for (let i = 1; i <= n; i++){ const w = A.wd.answerFor(i); if (seen.has(w)) dup++; seen.add(w); }
  eq('★한 바퀴(' + n + '일) 동안 중복 0', dup, 0);
  eq('한 바퀴 뒤에는 처음으로 돌아온다', A.wd.answerFor(n + 1), A.wd.answerFor(1));
}

/* ============================================ 5. 목록 검사·제출 */
section('5. 제출 — 목록 밖 낱말 거부 · 정답 맞히기');
{
  storeMap.clear(); writeHistory = [];
  const locks = makeLockManager();
  setClock('2026-08-24T09:00:00');
  const A = boot(locks);
  press(A, 'btnDaily');
  await flush();
  const st0 = A.wd.state();
  eq('일일 판이 열렸다', [st0.mode, st0.running, st0.over], ['daily', true, false]);
  const ans = st0.answer;
  ok('오늘의 정답이 허용 목록에 있다', A.wd.inList(ans), ans);

  /* ★목록에 '없는' 두 글자 낱말을 실제로 찾아서 넣는다.
     미완성 입력을 넣으면 '두 글자를 채우라'는 다른 경로로 빠져 목록 검사가 공허해진다. */
  const J = A.wd.jamo();
  let notWord = null;
  for (let i = 0; i < J.CHO.length && !notWord; i++){
    for (let j = 0; j < J.JUNG.length && !notWord; j++){
      const one = A.wd.join(J.CHO[i], J.JUNG[j], '');
      const cand = one + one;
      if (one && !A.wd.inList(cand)) notWord = cand;
    }
  }
  ok('목록 밖 두 글자 낱말을 찾았다(시험 전제)', !!notWord, String(notWord));
  A.wd.clear();
  for (const ch of notWord){ const s = A.wd.split(ch); A.wd.feed(s[0]); A.wd.feed(s[1]); if (s[2]) A.wd.feed(s[2]); }
  const typed = A.wd.typed();
  eq('입력은 두 글자로 완성됐다(전제 확인)', typed, notWord);
  const before = A.wd.state().tries;
  A.wd.submit();
  eq('★목록 밖 낱말은 시도로 세지 않는다', A.wd.state().tries, before);
  eq('목록 밖 낱말은 저장에도 남지 않는다', storeMap.has('wd.daily') ? rawDaily().run.guesses.length : 0, before);
  note('목록 밖 입력: ' + typed);

  /* 실제 목록에 있는 다른 낱말 — 시도가 하나 는다 */
  let other = null;
  for (let i = 1; i <= 50; i++){ const w = A.wd.answerFor(i); if (w !== ans){ other = w; break; } }
  A.wd.clear();
  for (const ch of other) { const s = A.wd.split(ch); A.wd.feed(s[0]); A.wd.feed(s[1]); if (s[2]) A.wd.feed(s[2]); }
  A.wd.submit();
  await flush();
  eq('★목록 안 낱말은 시도가 하나 는다', A.wd.state().tries, before + 1);
  eq('시도가 저장에 반영된다', rawDaily().run.guesses.length, 1);

  /* 정답 제출 → 승리 */
  A.wd.clear();
  for (const ch of ans) { const s = A.wd.split(ch); A.wd.feed(s[0]); A.wd.feed(s[1]); if (s[2]) A.wd.feed(s[2]); }
  A.wd.submit();
  await flush();
  const st = A.wd.state();
  eq('★정답을 맞히면 끝난다', [st.over, st.won], [true, true]);
  const rec = rawDaily();
  ok('결과가 기록된다', !!rec.result, JSON.stringify(rec).slice(0, 200));
  eq('결과에 시도 수가 담긴다', rec.result.tries, 2);
  eq('진행은 비워진다', rec.run, null);
  eq('★연속 기록이 1 이 된다', JSON.parse(storeMap.get('wd.streak')).n, 1);
  const s2 = JSON.parse(storeMap.get('wd.stats'));
  eq('통계에 승리가 쌓인다', [s2.played, s2.wins, s2.dist[1]], [1, 1, 1]);

  /* ★공유 문자열에 정답이 없어야 한다 */
  const sh = A.wd.share();
  ok('★공유 문자열에 정답이 들어 있지 않다', sh.indexOf(ans) < 0, sh);
  ok('공유 문자열은 색 이모지 격자다', /🟩|🟨|⬜/.test(sh), sh);
  eq('공유 격자 줄 수 = 시도 수', sh.split('\n').filter(l => /^[🟩🟨⬜]+$/.test(l)).length, 2);
}

/* ============================================ 6. 복원·CAS */
section('6. 저장·복원·비교-교환 — 두 탭이 같은 판을 갈라 쥔다');
{
  storeMap.clear(); writeHistory = [];
  const locks = makeLockManager();
  setClock('2026-08-24T09:00:00');
  const A = boot(locks);
  press(A, 'btnDaily');
  await flush();
  eq('최초 커밋 리비전 1', curRev(), 1);
  const ans = A.wd.state().answer;
  const other = A.wd.answerFor(A.wd.dailyNo() === 1 ? 2 : 1);
  A.wd.clear();
  for (const ch of other) { const s = A.wd.split(ch); A.wd.feed(s[0]); A.wd.feed(s[1]); if (s[2]) A.wd.feed(s[2]); }
  A.wd.submit();
  await flush();
  eq('한 번 시도한 뒤 리비전 2', curRev(), 2);

  /* 새 탭이 이어받는다 */
  const B = boot(locks);
  press(B, 'btnDaily');
  await flush();
  eq('★새 탭이 진행을 그대로 복원한다', B.wd.state().guesses, [other]);
  eq('복원한 탭이 리비전을 승계한다', B.wd.runInfo().rev, 2);
  eq('복원한 탭도 같은 정답을 본다', B.wd.state().answer, ans);
  eq('복원만으로는 쓰기가 없다', curRev(), 2);

  /* ★두 탭이 서로 다른 낱말로 갈라진다 — 한 쪽만 살아야 한다 */
  const w1 = A.wd.answerFor(5), w2 = A.wd.answerFor(6);
  A.wd.clear();
  for (const ch of w1) { const s = A.wd.split(ch); A.wd.feed(s[0]); A.wd.feed(s[1]); if (s[2]) A.wd.feed(s[2]); }
  A.wd.submit();
  await flush();
  B.wd.clear();
  for (const ch of w2) { const s = B.wd.split(ch); B.wd.feed(s[0]); B.wd.feed(s[1]); if (s[2]) B.wd.feed(s[2]); }
  B.wd.submit();
  await flush();
  eq('★리비전은 한 번만 올라갔다', curRev(), 3);
  eq('★기록에 남은 시도는 먼저 쓴 탭의 것이다', rawDaily().run.guesses, [other, w1]);
  eq('★늦게 쓴 탭은 만료된다', B.wd.expiry(), { expired: true, why: 'fork' });
  eq('먼저 쓴 탭은 살아 있다', A.wd.expiry().expired, false);
  ok('만료 안내가 다른 탭 진행을 말한다', /다른 탭/.test(B.txt('overTitle')), B.txt('overTitle'));
}

/* ============================================ 7. 준비 중 버튼 잠금 */
section('7. 준비 중 — 시작 창 버튼 이중 방어');
{
  storeMap.clear(); writeHistory = [];
  const locks = makeLockManager();
  setClock('2026-08-24T09:00:00');
  const A = boot(locks);
  eq('처음에는 버튼이 열려 있다', A.wd.btnState(), { daily: false, free: false });
  const release = holdLock(locks);
  await flush(2);
  press(A, 'btnDaily');
  await flush(3);
  eq('★준비 중에는 두 버튼이 잠긴다', A.wd.btnState(), { daily: true, free: true });
  eq('준비 중 표시', A.wd.lockState().preparing, true);
  eq('아직 저장이 없다', storeMap.has('wd.daily'), false);
  /* disabled 를 우회해 핸들러를 직접 부른다 */
  press(A, 'btnFree'); press(A, 'btnDaily');
  await flush(2);
  const during = A.wd.state();
  eq('★자유 모드가 시작되지 않는다', [during.mode, during.running], ['free', false]);
  ok('시작 창이 그대로 떠 있다', A.shown('start'));
  eq('저장도 없다', storeMap.has('wd.daily'), false);
  release();
  await flush();
  const after = A.wd.state();
  eq('★커밋 뒤 정확히 한 경로만 열린다', [after.mode, after.running, after.over], ['daily', true, false]);
  eq('★버튼 잠금이 풀린다', A.wd.btnState(), { daily: false, free: false });
  eq('커밋된 리비전 1', curRev(), 1);
}

/* ============================================ 8. 이미 끝낸 날 · 만료 */
section('8. 이미 끝낸 날 결과 표시 · 지난 날짜 만료');
{
  storeMap.clear(); writeHistory = [];
  setClock('2026-08-24T09:00:00');
  const locks = makeLockManager();
  storeMap.set('wd.daily', JSON.stringify({
    date: '2026-08-24', no: 2, run: null,
    result: { date:'2026-08-24', no:2, win:true, tries:3, marks:['mmmmmm','nnmmhh','hhhhhh'], streak:4 }
  }));
  const A = boot(locks);
  press(A, 'btnDaily');
  await flush();
  ok('결과 창이 뜬다', A.shown('over'));
  eq('★새 판을 만들지 않는다(기록 그대로)', rawDaily().result.tries, 3);
  eq('시도 수가 표시된다', /3/.test(A.txt('finalSub')), true);
  const sh = A.wd.share();
  eq('복원한 결과도 공유 격자가 3줄이다',
     sh.split('\n').filter(l => /^[🟩🟨⬜]+$/.test(l)).length, 3);
  ok('★복원한 공유 문자열에도 정답이 없다', sh.indexOf(A.wd.state().answer) < 0, sh);

  /* 지난 날짜 판이 더 최신 기록 앞에서 만료된다 */
  storeMap.clear(); writeHistory = [];
  setClock('2026-08-23T23:59:00');
  const G = boot(locks);
  press(G, 'btnDaily');
  await flush();
  eq('어제 판을 시작했다', G.wd.state().chalDate, '2026-08-23');
  storeMap.set('wd.daily', JSON.stringify({
    date: '2026-08-24', no: 2, result: null,
    run: { guesses: ['바다'], date: '2026-08-24', no: 2, runId: G.wd.runInfo().runId, rev: G.wd.runInfo().rev, parentRev: 0 }
  }));
  const keep = storeMap.get('wd.daily');
  setClock('2026-08-24T00:01:00');
  const w = G.wd.answerFor(9);
  G.wd.clear();
  for (const ch of w) { const s = G.wd.split(ch); G.wd.feed(s[0]); G.wd.feed(s[1]); if (s[2]) G.wd.feed(s[2]); }
  G.wd.submit();
  await flush();
  eq('★더 최신 날짜 기록은 한 글자도 바뀌지 않았다', storeMap.get('wd.daily'), keep);
  eq('★어제 탭은 날짜 사유로 만료된다', G.wd.expiry(), { expired: true, why: 'date' });
}

/* ============================================ 9. 자유 모드 */
section('9. 자유 모드 — 일일 기록과 무관');
{
  storeMap.clear(); writeHistory = [];
  const locks = makeLockManager();
  setClock('2026-08-24T09:00:00');
  const A = boot(locks);
  press(A, 'btnDaily');
  await flush();
  const dailyAns = A.wd.state().answer;
  const before = storeMap.get('wd.daily');
  const F = boot(locks);
  F.wd.newFree();
  const st = F.wd.state();
  eq('자유 모드로 들어간다', [st.mode, st.running], ['free', true]);
  ok('자유 모드 정답도 목록 안이다', F.wd.inList(st.answer), st.answer);
  const w = F.wd.answerFor(3);
  F.wd.clear();
  for (const ch of w) { const s = F.wd.split(ch); F.wd.feed(s[0]); F.wd.feed(s[1]); if (s[2]) F.wd.feed(s[2]); }
  F.wd.submit();
  await flush();
  eq('★자유 모드는 일일 기록을 건드리지 않는다', storeMap.get('wd.daily'), before);
  eq('자유 모드는 통계도 건드리지 않는다', storeMap.has('wd.stats'), false);
  note('일일 정답과 자유 정답: ' + dailyAns + ' / ' + st.answer);
}

/* ============================================ 10. 키보드 색 누적 */
section('10. 키보드 색 — 정확 > 위치 다름 > 없음 순으로만 올라간다');
{
  storeMap.clear(); writeHistory = [];
  const locks = makeLockManager();
  setClock('2026-08-24T09:00:00');
  const A = boot(locks);
  press(A, 'btnDaily');
  await flush();
  const ans = A.wd.state().answer;
  const aslots = A.wd.slots(ans);
  const w = A.wd.answerFor(11) === ans ? A.wd.answerFor(12) : A.wd.answerFor(11);
  A.wd.clear();
  for (const ch of w) { const s = A.wd.split(ch); A.wd.feed(s[0]); A.wd.feed(s[1]); if (s[2]) A.wd.feed(s[2]); }
  A.wd.submit();
  await flush();
  const ks = A.wd.state().keyState;
  const marks = A.wd.state().rows[0];
  const gslots = A.wd.slots(w);
  let wrong = 0;
  for (let i = 0; i < 6; i++){
    if (gslots[i] === '·') continue;
    const rank = { miss:1, near:2, hit:3 };
    if (!ks[gslots[i]] || rank[ks[gslots[i]]] < rank[marks[i]]) wrong++;
  }
  eq('★시도한 자모가 전부 키 색에 반영됐다', wrong, 0);
  ok('빈칸(·)은 키 색에 들어가지 않는다', !('·' in ks), JSON.stringify(Object.keys(ks)));
  note('키 색: ' + JSON.stringify(ks));
}

/* ============================================ 11. 금칙 표면형(비속어) 0 */
section('11. 금칙 표면형 — 정답·허용 추측어 두 배열 전수');
{
  /* ★검증기는 생성기(build_lists.py)와 **따로** 목록 사본을 들고 대조한다.
     같은 파일을 읽으면 목록에서 낱말이 빠지는 순간 검사도 같이 눈이 먼다. */
  const BANNED = new Set(['갈보','감금','강간','강도','개년','개놈','개새','개판','걸레','검둥','겁탈','고문','고환','관음','광년','구타','근친','깜둥','낙태','남창','납치','년놈','노름','노예','놈년','능욕','도박','도살','독살','되놈','등신','마약','매독','매음','매춘','몰카','미친','바보','방화','백정','변태','병신','보지','불구','불륜','불알','사기','사창','사체','사형','살인','살해','상놈','새끼','색골','색마','성교','성기','성병','성폭','섹스','소경','소아','시발','시신','시체','시팔','쌍년','쌍놈','씨바','씨발','씨불','씨팔','씹새','씹질','씹창','아편','애자','야동','야설','양아','양키','왜놈','유곽','유방','유서','윤간','음경','음독','음란','음부','인질','자살','자위','자지','자해','잡년','잡놈','잡종','장님','절도','정사','정액','젖통','존나','종놈','좆나','좆도','주검','지랄','짱깨','참수','창녀','창놈','처녀','총격','총살','추행','치매','치한','칼침','코카','콘돔','쿠데','타살','테러','투신','튀기','폭력','폭탄','폭행','학살','할복','항문','협박','호로','화간','화냥','후레','흉기','히로']);
  const rawOf = name => {
    const m = SRC.match(new RegExp('const ' + name + " = '([^']*)'"));
    return m ? m[1] : '';
  };
  const words = s => { const out = []; for (let i = 0; i + 1 < s.length; i += 2) out.push(s.substr(i, 2)); return out; };
  const ansRaw = rawOf('ANSWERS_RAW'), gueRaw = rawOf('GUESSES_RAW');
  ok('내장 배열을 읽었다(시험 전제)', ansRaw.length > 2000 && gueRaw.length > 10000,
     `answers=${ansRaw.length}자 guesses=${gueRaw.length}자`);
  /* 정적 배열 전수 + 런타임이 실제로 고르는 값 전수 — 두 갈래로 본다 */
  const ansStatic = words(ansRaw), gueStatic = words(gueRaw);
  const leakA = ansStatic.filter(w => BANNED.has(w));
  const leakG = gueStatic.filter(w => BANNED.has(w));
  eq('★정답 배열에 금칙 표면형 0', leakA, []);
  eq('★허용 추측어 배열에 금칙 표면형 0', leakG, []);
  {
    storeMap.clear(); writeHistory = [];
    setClock('2026-08-23T09:00:00');
    const T = boot(makeLockManager());
    const n = T.wd.listSizes().answers;
    let runtimeLeak = [], accepted = [];
    for (let no = 1; no <= n; no++) { const w = T.wd.answerFor(no); if (BANNED.has(w)) runtimeLeak.push([no, w]); }
    for (const w of BANNED) if (T.wd.inList(w)) accepted.push(w);
    eq('★런타임이 고르는 일일 정답 전수(1..N)에도 금칙 표면형 0', runtimeLeak, []);
    eq('★금칙 표면형은 유효 추측으로도 받아들이지 않는다', accepted, []);
    ok('금칙 목록이 codex 가 지목한 세 표면형을 담고 있다(시험 전제)',
       BANNED.has('새끼') && BANNED.has('시발') && BANNED.has('지랄'));
    note(`금칙 목록 ${BANNED.size}개 대조 · 정답 ${ansStatic.length}개 · 허용 ${gueStatic.length}개`);
  }
}

/* ============================================ 12. 색 대비(WCAG) */
section('12. 색 대비 — 화면 자판·낱말 칸 상태별 글자/배경');
{
  const vars = {};
  {
    const root = (html.match(/:root\{([\s\S]*?)\}/) || [null, ''])[1];
    for (const m of root.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  }
  const resolve = v => {
    let s = String(v).trim(), guard = 0;
    while (/var\(/.test(s) && guard++ < 5) s = s.replace(/var\((--[a-z0-9-]+)\)/g, (_, k) => (vars[k] || '').trim());
    return s.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  };
  const ruleOf = sel => {
    const i = html.indexOf(sel + '{');
    if (i < 0) return null;
    const body = html.slice(i + sel.length + 1, html.indexOf('}', i));
    const out = {};
    for (const d of body.split(';')) { const k = d.slice(0, d.indexOf(':')).trim(); if (k) out[k] = d.slice(d.indexOf(':') + 1).trim(); }
    return out;
  };
  const lum = hex => {
    const h = hex.replace('#', '');
    const c = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
  const cases = [
    ['화면 자판 miss', '.kb button.miss', null],
    ['화면 자판 hit', '.kb button.hit', null],
    ['화면 자판 near', '.kb button.near', null],
    ['낱말 칸 miss', '.cell.miss', null],
    ['낱말 칸 hit', '.cell.hit', null],
    ['낱말 칸 near', '.cell.near', null]
  ];
  for (const [name, sel] of cases) {
    const r = ruleOf(sel);
    ok(`${name} 규칙을 찾았다(시험 전제)`, !!r && !!r.color && !!r.background, sel);
    if (!r || !r.color || !r.background) continue;
    const fg = resolve(r.color), bg = resolve(r.background);
    const cr = ratio(fg, bg);
    ok(`★${name} 대비 4.5:1 이상`, cr >= 4.5, `${fg} on ${bg} = ${cr.toFixed(3)}:1`);
    note(`${name}: ${fg} on ${bg} = ${cr.toFixed(3)}:1`);
  }
  {
    const kb = ruleOf('.kb button');
    const fg = resolve((kb && kb.color) || ''), bg = resolve((kb && kb.background) || '');
    const cr = ratio(fg, bg);
    ok('★화면 자판 기본 대비 4.5:1 이상', cr >= 4.5, `${fg} on ${bg} = ${cr.toFixed(3)}:1`);
    note(`화면 자판 기본: ${fg} on ${bg} = ${cr.toFixed(3)}:1`);
  }
}

/* ============================================ 13. 중첩 오버레이 — 초점·inert·모달 계약 */
section('13. 중첩 dialog — 첫 방문 help→start · 결과 over→stats');
{
  const modalOpen = t => ['over','stats','help','start']
    .filter(id => t.el(id)._classes.has('show') && t.el(id).getAttribute('aria-modal') === 'true');
  const inertOn = (t, id) => t.el(id).hasAttribute('inert');

  /* ── 경로 1: 첫 방문 — start 위에 help 가 겹친다 ── */
  storeMap.clear(); writeHistory = [];
  setClock('2026-08-23T09:00:00');
  const A = boot(makeLockManager());
  await flush();
  eq('첫 방문에 두 오버레이가 겹친다(시험 전제)',
     A.wd.ovStack().map(s => s.id), ['start', 'help']);
  ok('시작 창과 도움말이 둘 다 보인다(시험 전제)', A.shown('start') && A.shown('help'));
  ok('★겹친 동안 부모(start)가 inert 다', inertOn(A, 'start'));
  ok('★겹친 동안 자식(help)은 inert 가 아니다', !inertOn(A, 'help'));
  eq('★활성 aria-modal dialog 는 하나뿐이다', modalOpen(A), ['help']);
  ok('★부모 안의 버튼은 초점 대상이 아니다(inert 실측)',
     (() => { A.doc.getElementById('btnDaily').focus();
              return A.doc.activeElement !== A.doc.getElementById('btnDaily'); })());
  const helpClose = A.doc.getElementById('btnHelpClose');
  helpClose.focus();
  ok('도움말 닫기 버튼에 초점이 있다(시험 전제)', A.doc.activeElement === helpClose);
  ok('도움말 닫기 버튼을 눌렀다', press(A, 'btnHelpClose'));
  await flush();
  ok('도움말이 닫혔다', !A.shown('help'));
  ok('시작 창은 그대로 열려 있다', A.shown('start'));
  ok('★자식을 닫으면 부모(start)의 inert 가 풀린다', !inertOn(A, 'start'));
  eq('★활성 aria-modal dialog 는 다시 하나(start)', modalOpen(A), ['start']);
  ok('★닫은 버튼은 이제 화면에 없다(시험 전제 — 여기에 초점이 남으면 갇힌다)',
     A.doc.activeElement !== helpClose && !visibleNow(helpClose));
  {
    const a = A.doc.activeElement;
    ok('★초점이 부모 안의 보이는·초점가능 컨트롤로 돌아왔다',
       !!a && visibleNow(a) && !inertNow(a) && a.closest('.overlay') === A.el('start'),
       a ? `activeElement=#${a.id} visible=${visibleNow(a)} inert=${inertNow(a)}` : 'activeElement=null');
    note('경로1 복귀 초점: #' + (a ? a.id : 'null'));
  }

  /* ── 경로 2: 결과(over) 위에 통계(stats) 가 겹친다 ── */
  storeMap.clear(); writeHistory = [];
  /* 두 번째 방문을 만든다 — 통계 키가 있으면 첫 방문 도움말이 자동으로 뜨지 않는다 */
  storeMap.set('wd.stats', '{"played":0,"wins":0,"dist":[0,0,0,0,0,0]}');
  setClock('2026-08-24T09:00:00');
  const B = boot(makeLockManager());
  await flush();
  ok('두 번째 방문이라 도움말이 자동으로 뜨지 않는다(시험 전제)', !B.shown('help'));
  ok('일일 도전을 시작했다', press(B, 'btnDaily'));
  await flush();
  {
    const ans = B.wd.state().answer;
    for (const ch of ans) { const s = B.wd.split(ch); B.wd.feed(s[0]); B.wd.feed(s[1]); if (s[2]) B.wd.feed(s[2]); }
    B.wd.submit();
    await flush();
    ok('맞혀서 결과 창이 떴다(시험 전제)', B.shown('over') && B.wd.state().won, JSON.stringify({ over: B.shown('over'), won: B.wd.state().won, ans }));
  }
  eq('결과 창만 열려 있다(시험 전제)', B.wd.ovStack().map(s => s.id), ['over']);
  const stats2 = B.doc.getElementById('btnStats2');
  stats2.focus();
  ok('결과 창의 통계 버튼에 초점이 있다(시험 전제)', B.doc.activeElement === stats2);
  ok('통계 보기를 눌렀다', press(B, 'btnStats2'));
  await flush();
  eq('★통계가 결과 위에 겹쳐 열렸다', B.wd.ovStack().map(s => s.id), ['over', 'stats']);
  ok('★겹친 동안 부모(over)가 inert 다', inertOn(B, 'over'));
  eq('★활성 aria-modal dialog 는 하나(stats)', modalOpen(B), ['stats']);
  ok('★부모 안의 공유 버튼은 초점 대상이 아니다',
     (() => { B.doc.getElementById('btnShare').focus();
              return B.doc.activeElement !== B.doc.getElementById('btnShare'); })());
  ok('통계 닫기를 눌렀다', press(B, 'btnStatsClose'));
  await flush();
  ok('통계가 닫혔다', !B.shown('stats'));
  ok('결과 창은 그대로 열려 있다', B.shown('over'));
  ok('★부모(over)의 inert 가 풀린다', !inertOn(B, 'over'));
  eq('★활성 aria-modal dialog 는 다시 하나(over)', modalOpen(B), ['over']);
  {
    const a = B.doc.activeElement;
    ok('★초점이 통계를 연 버튼(btnStats2)으로 정확히 되돌아왔다',
       a === stats2 && visibleNow(a) && !inertNow(a),
       a ? `activeElement=#${a.id} visible=${visibleNow(a)} inert=${inertNow(a)}` : 'activeElement=null');
    note('경로2 복귀 초점: #' + (a ? a.id : 'null'));
  }
  /* 마지막으로 결과 창까지 닫으면 바깥 inert 가 풀리고 초점이 페이지로 돌아온다 */
  ok('결과 창을 닫았다(다시 하기)', press(B, 'btnAgain'));
  await flush();
  ok('★모든 오버레이가 닫히면 바깥 inert 가 풀린다',
     !B.el('board').hasAttribute('inert') && !B.el('kb').hasAttribute('inert'));
  eq('오버레이 스택이 비었다', B.wd.ovStack(), []);
}

/* ------------------------------------------------------------------ 요약 */
console.log(`\n==== 오늘의 낱말 검증 결과: PASS ${pass} · FAIL ${fail} ====`);
if (fail) { console.log('실패 항목:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
})();
