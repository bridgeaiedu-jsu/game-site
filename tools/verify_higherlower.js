/* 위냐 아래냐(/higher-lower/) 검증기 · worker(238) · 2026-09-04 · 티켓 T0904-higher-lower
 *
 * 앞선 검증기(verify_reverse.js·verify_fakeone.js)의 방식을 그대로 따른다:
 *   · 인라인 스크립트를 DOM 스텁 위에서 실제로 구동한다(vm)
 *   · 상태를 바꾸는 명령은 **제품 파일에 두지 않고** 여기서 메모리 위에만 덧붙인다(test bridge)
 *   · 판정은 배포되는 관측 창구(window.__hl)와 이 파일이 따로 셈한 값의 대조로 한다
 *   · 누르는 것은 다리가 아니라 **진짜 입력 사건**(pointerdown·keydown)으로 두드린다
 *
 * 중점 검사(티켓이 못박은 것)
 *   ★① 연쇄 계약 · 다음 값이 크면 위, 작으면 아래. 맞히면 그 값이 새 기준이 되고 틀리면 즉시 끝.
 *   ★② 무승부 배제 · 사후 필터가 아니라 생성 규칙으로 막혀 있는가(이웃쌍 동률 0).
 *   ★③ 차이 · 라운드가 오를수록 좁아지되 gapMin 아래로는 안 내려가는가(양방향으로 가른다).
 *   ★④ 일일 결정성(시각 축) · 가짜 벽시계를 크게 움직여도 같은 날이면 같은 판인가.
 *       (같은 순간 두 번 물어 같은 것은 씨앗에 시각이 섞여 있어도 성립한다 · 그 그물로는 못 잡는다)
 *   ★⑤ 난수 · 판을 짤 때 전부 소진하고 플레이 중에는 한 장도 안 쓰는가.
 *   ★⑥ 시간 · 이 게임의 판정에는 시간이 들어가지 않는다. 그린 시계는 흐른 시간의 함수인가.
 *   ★⑦ 터치 목표 · 360px 에서 답 칸이 50px 하한을 지키는가(숫자를 박지 않고 CSS 에서 셈한다).
 *   ★⑧ 색맹 안전 · 두 칸이 색이 아니라 글자와 모양으로 서로 다른가.
 *
 * ★이 하네스가 못 보는 것(정직 고지)
 *   · 레이아웃을 계산하지 않는다 · '요소가 0×0 으로 접힘' 은 실브라우저에서만 보인다.
 *   · CSS 를 파싱하지 않는다(치수 몇 개를 정규식으로 읽을 뿐이다) · 색·대비의 실제 렌더는 못 잰다.
 *   · svg 를 그리지 않는다 · 두 모양이 '사람 눈에' 구별되는지는 문자열 차이까지만 증명한다.
 *   · 점·막대·원의 크기가 사람 눈에 견줄 만한지는 재지 못한다(수치 대조까지다).
 *
 * 사용법: node verify_higherlower.js [--html <경로>] [--mutate <이름>] [--list-mutations]
 * 종료코드: 0 = 전부 PASS · 1 = 하나라도 FAIL · 2 = 뮤테이션 주입 실패·하네스 이상(탐지 아님)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
/* 기본 대상은 **이 도구가 놓인 저장소의 /higher-lower/index.html** 이다 · 절대경로를 박아 두면
   worktree 를 갈아탈 때 조용히 남의 파일을 재게 된다. */
const HTML = argOf('--html', path.join(__dirname, '..', 'higher-lower', 'index.html'));
const MUTATION = argOf('--mutate', null);

/* ------------------------------------------------------- 뮤테이션(검출력 자기시험)
   ★각 뮤테이션은 **어느 검사가 잡아야 하는지**를 함께 적는다 · 다른 검사가 우연히 깨져서 난
   빨강은 무임승차다(장기기억 mutation-must-name-the-check-that-catches-it).
   ★'주입 실패'와 '결함 탐지'를 종료코드로 가른다(2 = 주입 실패 · 1 = 탐지).
   ★scope:'html' 은 스크립트 밖(CSS 토큰 등)을 겨냥한다 · 문서 전체에 주입한다.
   ★검사 이름에 ' — '(공백 엠대시 공백)를 쓰지 않는다 · 러너의 FAIL 파서가 이름을 잘라 읽는다. */
const MUTATIONS = {
  /* ① 위·아래를 뒤집는다 = 이 게임이 이 게임이 아니게 된다 */
  'correct-inverted': {
    catcher: '다음 값이 크면 위 칸이 정답이고 작으면 아래 칸이 정답이다',
    from: 'const correctIndexAt = (values, i) => higherAt(values, i) ? HIGHER : LOWER;',
    to:   'const correctIndexAt = (values, i) => higherAt(values, i) ? LOWER : HIGHER;'
  },
  /* ①-A 크기 비교 자체를 뒤집는다(순수 함수 층) */
  'higher-uses-lt': {
    catcher: 'higherAt 은 다음 값이 지금 값보다 클 때만 참이다',
    from: 'const higherAt = (values, i) => values[i + 1] > values[i];',
    to:   'const higherAt = (values, i) => values[i + 1] < values[i];'
  },
  /* ② 틀려도 안 끝난다 = 연쇄 게임의 뼈가 사라진다 */
  'wrong-continues': {
    catcher: '틀리면 그 자리에서 판이 끝난다',
    from: "    say(T('sayWrong', next));\n    paintStage();\n    finishRun(stamp);",
    to:   "    say(T('sayWrong', next));\n    paintStage();"
  },
  /* ②-A 틀렸는데 다음 값을 안 보여 준다 */
  'reveal-hidden': {
    catcher: '틀리면 다음 값이 드러난다',
    from: '    revealed = true;\n    $(\'ans\' + i).classList.add(\'miss\');',
    to:   '    revealed = false;\n    $(\'ans\' + i).classList.add(\'miss\');'
  },
  /* ③ 맞혀도 기록이 안 오른다 */
  'right-not-scored': {
    catcher: '맞히면 연속 정답이 하나 오른다',
    from: '    score += 1;\n    idx += 1;',
    to:   '    score += 0;\n    idx += 1;'
  },
  /* ③-A 맞혔는데 기준이 안 넘어간다 */
  'no-advance': {
    catcher: '맞히면 그 값이 새 기준이 되어 연쇄가 이어진다',
    from: '    score += 1;\n    idx += 1;\n',
    to:   '    score += 1;\n'
  },
  /* ④ 차이가 안 좁아진다(방향 하나) */
  'gap-not-shrinking': {
    catcher: '라운드가 오를수록 두 값의 차이가 좁아진다',
    from: '  const v = s.gapStart - GAP_STEP * k;',
    to:   '  const v = s.gapStart;'
  },
  /* ④-A 바닥이 없다(반대 방향) · gap 이 0 에 닿으면 무승부가 생긴다 */
  'gap-no-floor': {
    catcher: '이웃한 두 값은 절대 같지 않다(무승부 0)',
    from: '  return v < s.gapMin ? s.gapMin : v;',
    to:   '  return v;'
  },
  /* ⑤ 범위를 벗어나도 그냥 둔다 */
  'range-escape': {
    catcher: '값은 종류마다 정해진 범위 안에 있다',
    from: '    if (next > s.max || next < s.min) next = up ? v - gap : v + gap;\n',
    to:   ''
  },
  /* ⑥ 한 판 안에서 종류가 바뀐다 */
  'kind-varies-in-run': {
    catcher: '한 판 안에서 값의 종류가 바뀌지 않는다',
    from: 'const kindNow = () => plan.kind;',
    to:   'const kindNow = () => KINDS[idx % KINDS.length];'
  },
  /* ⑦ 플레이가 난수를 소비한다 = 오늘의 도전이 사람마다 갈라진다 */
  'rng-on-play': {
    catcher: '플레이 행동은 난수를 한 번도 소비하지 않는다(오늘의 도전)',
    from: '  const ok = i === correctIndexAt(plan.values, idx);',
    to:   '  const ok = (Math.random() >= 0) && i === correctIndexAt(plan.values, idx);'
  },
  /* ⑧ 씨앗에 시각이 섞인다 = 같은 날인데 몇 시에 열었는지로 판이 갈린다 */
  'daily-seed-uses-clock': {
    catcher: '같은 씨앗은 시각이 달라져도 같은 판을 준다(가짜 시계로 크게 벌려 확인)',
    from: "const dailySeedKey = (d=new Date()) => 'hanpango-daily-higher-lower-' + dayKey(d);",
    to:   "const dailySeedKey = (d=new Date()) => 'hanpango-daily-higher-lower-' + dayKey(d) + '-' + d.getHours();"
  },
  /* ⑧-A 판이 씨앗 밖의 난수를 탄다 */
  'seed-drift': {
    catcher: '같은 씨앗은 같은 판을 준다(값 100개 전체)',
    from: '  let v = s.min + Math.floor(rnd() * (s.max - s.min + 1));',
    to:   '  let v = s.min + Math.floor(Math.random() * (s.max - s.min + 1));'
  },
  /* ⑨ 미리 뽑아 두지 않는다 = 연쇄가 길어지면 난수를 더 쓰게 된다 */
  'plan-too-short': {
    catcher: '판을 짤 때 값을 100개 전부 뽑아 둔다',
    from: 'const VALUES = 100;',
    to:   'const VALUES = 8;'
  },
  /* ⑩ 최고 기록이 더 나쁠 때도 바뀐다 */
  'best-worse-wins': {
    catcher: '자유 모드 최고 기록은 더 길게 이었을 때만 바뀐다',
    from: 'const betterThan = (a, b) => !b || a.score > b.score;',
    to:   'const betterThan = (a, b) => true;'
  },
  /* ⑩-A 오늘의 도전이 최고 기록을 건드린다 */
  'best-updates-in-daily': {
    catcher: '오늘의 도전은 최고 기록을 건드리지 않는다',
    from: '      saveDaily({ score, kind: r.kind, ms: r.ms });',
    to:   '      saveBest({ score, kind: r.kind, ms: r.ms, date: dayKey() });\n      saveDaily({ score, kind: r.kind, ms: r.ms });'
  },
  /* ⑩-B 하루 한 번이 아니다 */
  'daily-overwrite': {
    catcher: '오늘의 도전은 하루 한 번이다(두 번째 완주가 기록을 덮지 않는다)',
    from: '    if (!dailyDoneToday()){\n      saveDaily(',
    to:   '    if (true){\n      saveDaily('
  },
  /* ⑩-C 스트릭이 끊겨도 안 리셋된다 */
  'streak-never-resets': {
    catcher: '날짜가 끊기면 스트릭이 1 로 리셋된다',
    from: '  const n = (st && st.last === prevDayKey(day)) ? (st.n || 0) + 1 : 1;',
    to:   '  const n = (st.n || 0) + 1;'
  },
  /* ⑪ 그린 시계가 프레임 수를 센다 */
  'clock-frame-accumulate': {
    catcher: '그린 시간이 매 프레임 흐른 시간과 같다(프레임 간격이 불규칙해도)',
    from: '  paintClockAt(nowMs() - runStart);       /* ★프레임마다 흐른 시간에서 다시 계산한다 */',
    to:   '  paintClockAt(drawnMs + 16);'
  },
  /* ⑪-A 누른 순간의 도장을 버리고 '지금'을 쓴다 */
  'judge-ignores-stamp': {
    catcher: '허용오차 안쪽의 도장은 그대로 쓴다',
    from: '  const stamp = stampOf(ev);\n  clearMarks();',
    to:   '  const stamp = nowMs();\n  clearMarks();'
  },
  /* ⑪-B 허용오차를 없앤다 = 터무니없는 도장도 믿는다 */
  'stamp-no-tolerance': {
    catcher: '허용오차를 벗어난 도장은 믿지 않고 지금 시각으로 물러선다',
    from: '  if (typeof s === \'number\' && isFinite(s) && s > 0 && Math.abs(t - s) <= STAMP_TOLERANCE_MS) return s;',
    to:   '  if (typeof s === \'number\' && isFinite(s) && s > 0) return s;'
  },
  /* ⑫ 두 칸의 모양이 같아진다 = 색으로만 말하게 된다 */
  'icons-identical': {
    catcher: '두 답 칸은 색이 아니라 모양으로 서로 다르다',
    from: "  '<svg viewBox=\"0 0 40 40\" aria-hidden=\"true\"><path d=\"M8 13 L20 29 L32 13 Z\" fill=\"currentColor\"/></svg>'",
    to:   "  '<svg viewBox=\"0 0 40 40\" aria-hidden=\"true\"><path d=\"M8 27 L20 11 L32 27 Z\" fill=\"currentColor\"/></svg>'"
  },
  /* ⑫-A 두 칸의 글자가 같아진다 */
  'labels-identical': {
    catcher: '두 답 칸의 글자가 서로 다르다',
    from: "const ANSWER_KEY = ['wHigher', 'wLower'];",
    to:   "const ANSWER_KEY = ['wHigher', 'wHigher'];"
  },
  /* ⑬ 영어 표에서 산문 키 하나가 빠진다 */
  'en-prose-missing': {
    catcher: '마크업의 data-i18n 키가 ko·en 두 표에 모두 있다',
    from: "    tip3q:'Each form fools a different eye',\n",
    to:   ''
  },
  /* ⑭ 반복 발화된 화살표를 그대로 받는다 */
  'repeat-guard-gone': {
    catcher: '누르고 있어서 반복 발화된 화살표 입력은 무시된다',
    from: "  if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;\n  if (ev.repeat) return;",
    to:   "  if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;"
  },
  /* ⑭-A Enter 뒤에 따라오는 click 을 안 막는다 = 한 번 누른 것이 두 번 세어진다 */
  'key-no-preventdefault': {
    catcher: 'Enter 로 눌렀을 때 preventDefault 가 호출된다',
    from: '    ev.preventDefault();\n    onAnswer(i, ev);',
    to:   '    onAnswer(i, ev);'
  },
  /* ⑮ 창이 떠도 뒤가 살아 있다 */
  'inert-gone': {
    catcher: '창이 열리면 창 밖 요소에 inert 가 붙는다',
    from: '  overShown = true;\n  setOutsideInert(true);',
    to:   '  overShown = true;\n  setOutsideInert(false);'
  },
  /* ⑯ 터치 목표를 줄인다(CSS · scope html) */
  'touch-target-shrunk': {
    scope: 'html',
    catcher: '답 칸은 360px 에서 짧은 변이 50px 하한을 지킨다',
    from: '  .hl-btn{min-height:96px;',
    to:   '  .hl-btn{min-height:40px;'
  },
  /* ⑯-A 두 칸 사이를 벌린다 = 셈이 실측과 어긋난다(보정 단언이 잡는다) */
  'answers-gap-widened': {
    scope: 'html',
    catcher: '이 셈이 실브라우저 실측(답 칸 폭)을 재현한다',
    from: '  .hl-answers{display:grid;grid-template-columns:1fr 1fr;gap:10px;',
    to:   '  .hl-answers{display:grid;grid-template-columns:1fr 1fr;gap:120px;'
  }
};

if (argv.includes('--list-mutations')){
  for (const [k, v] of Object.entries(MUTATIONS)) console.log(k + '\t' + v.catcher);
  process.exit(0);
}

/* ★읽는 순간 줄끝을 LF 로 고른다 · 작업본이 CRLF 가 되면 여러 줄 앵커가 전부 어긋나
   뮤테이션이 '주입 실패'로 멈춘다(검출력 저하가 아니라 환경이 게이트를 끈 것이다). */
let RAW = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');

/* 인라인 스크립트 중 게임 본체(가장 긴 것)를 고른다 */
function gameSource(html){
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length){ console.error('인라인 스크립트를 찾지 못했다'); process.exit(2); }
  return blocks.sort((a, b) => b.length - a.length)[0];
}
/* ★뮤테이션의 사정거리는 두 가지다: 기본은 게임 스크립트(scope 없음)이고,
   ★CSS 토큰처럼 스크립트 밖에 있는 계약은 scope:'html' 로 문서 전체에 주입한다.
   주입 대상을 헷갈리면 앵커가 0회로 나와 '주입 실패'(rc=2)로 멈춘다 · 조용히 통과하지 않는다. */
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  if (!m){ console.error('알 수 없는 뮤테이션: ' + MUTATION); process.exit(2); }
  if (m.scope === 'html'){
    const n = RAW.split(m.from).length - 1;
    if (n !== 1){ console.error(`뮤테이션 주입 실패(${MUTATION}) · 앵커가 ${n}회 나타났다(1회여야 한다)`); process.exit(2); }
    RAW = RAW.replace(m.from, m.to);
  }
}
let SRC = gameSource(RAW);
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  if (m.scope !== 'html'){
    const n = SRC.split(m.from).length - 1;
    if (n !== 1){ console.error(`뮤테이션 주입 실패(${MUTATION}) · 앵커가 ${n}회 나타났다(1회여야 한다)`); process.exit(2); }
    SRC = SRC.replace(m.from, m.to);
  }
  console.log(`[mutate] ${MUTATION} 주입됨(${m.scope === 'html' ? '문서' : '스크립트'}) · 잡아야 하는 검사: ${m.catcher}`);
}

/* ------------------------------------------------------- test bridge(메모리 위에만)
   제품 파일에는 관측 창구(__hl)만 배포한다. 상태를 바꾸는 명령은 여기서 IIFE 가 닫히기 직전에
   덧붙인다 · 배포본에는 남지 않는다(장기기억 debug-hooks-in-shipped-code-are-a-control-api). */
const BRIDGE = `
window.__hlTest = {
  /* ★i18n 표를 정규식으로 읽지 않는다 · 한 줄에 키가 여럿이거나 문장 안에 콜론이 있으면
     정규식은 대리물이 된다. 실행된 객체의 실제 키 목록을 그대로 준다. */
  i18nKeys: () => ({ ko: Object.keys(I18N.ko), en: Object.keys(I18N.en) }),
  /* ★문안 값도 표에서 그대로 받는다 · 하네스가 제품 문자열을 상수로 베껴 들면 그때부터
     검사가 계약이 아니라 '내가 베껴 둔 문자열'을 재게 된다. 함수형 문안은 null 로 준다. */
  i18nText: (lang, key) => { const v = I18N[lang][key]; return typeof v === 'function' ? null : v; },
  begin: (m, stamp) => beginRun(m, stamp),
  refresh: () => refreshStart(),
  overShown: () => overShown,
  planNow: () => plan,
  freePlan: () => freePlan()
};
`;
const CLOSE = '\n})();';
if (SRC.lastIndexOf(CLOSE) < 0){ console.error('IIFE 닫는 자리를 찾지 못했다'); process.exit(2); }
SRC = SRC.slice(0, SRC.lastIndexOf(CLOSE)) + BRIDGE + CLOSE;

/* ------------------------------------------------------------ 저장소 스텁 */
function makeStore(){
  const map = new Map();
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
    id, tagName: (tag || 'DIV').toUpperCase(), dataset: {}, _text: '', _html: '',
    children: [], _attrs: {}, _classes: new Set(), _on: {}, disabled: false, onclick: null,
    hidden: false, tabIndex: -1, parent: null, type: '',
    style: { _p: {}, setProperty(k, v){ this._p[k] = v; }, getPropertyValue(k){ return this._p[k] === undefined ? '' : this._p[k]; } },
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
    addEventListener: (t, fn) => { el._on[t] = fn; },
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
    /* ★실제 DOM 은 textContent 를 쓰면 자식이 전부 사라진다. 그것을 흉내내지 않으면
       '자식을 지우고 다시 채운다' 는 코드가 스텁에서만 무한히 쌓인다(스텁 충실도). */
    get(){ return el._text; },
    set(v){ el._text = String(v); el.children.length = 0; }
  });
  Object.defineProperty(el, 'innerHTML', {
    get(){ return el._html; },
    set(v){ el._html = String(v); if (v === '') el.children.length = 0; }
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
    if (s === 'style' && el.tagName === 'STYLE') return true;
    /* ★'body > header' 꼴을 인정한다. 인정하지 않으면 제품의 setOutsideInert 가 스텁에서
       아무 요소도 못 찾아, 그 함수를 통째로 비워도 어떤 검사도 붉지 않는다. */
    const m = /^body\s*>\s*(?:(\.)?([A-Za-z][A-Za-z0-9_-]*))$/.exec(s);
    if (m && el.parent && el.parent.tagName === 'BODY'){
      if (m[1]) { if (el._classes.has(m[2])) return true; }
      else if (el.tagName === m[2].toUpperCase()) return true;
    }
  }
  return false;
}
function HTMLElementStub(){}
function PointerEventStub(){}

const IDS = ['clock','clockUnit','stage','prevSlot','prevLbl','prevVal','curSlot','curLbl','curVal',
             'answers','ans0','ans1','icon0','icon1','label0','label1',
             'kindChip','scoreChip','srSummary','toast','over','start',
             'finalBig','finalLine','marks','streakLine','newBest','nScore','nKind','nTime','finalSub',
             'btnAgain','btnShare','btnDaily','btnStart','dailyHint','kindDesc','help',
             'btnSound','btnSound2','btnLang','btnLang2','subtitle','adTop','adOver','startTitle','overTitle',
             'bestNow','modeNow','streakNowEl'];

function boot(opts){
  opts = opts || {};
  const localStorage = opts.store || makeStore();
  const els = new Map();
  const doc = {
    documentElement: null, body: null, activeElement: null, hidden: false, title: '',
    getElementById: id => { if (!els.has(id)) els.set(id, makeEl(id, doc)); return els.get(id); },
    querySelectorAll: sel => [...els.values()].filter(e => matchesSel(e, sel))
                                .concat([...els.values()].flatMap(e => e._descend().filter(c => matchesSel(c, sel)))),
    querySelector: sel => doc.querySelectorAll(sel)[0] || null,
    createElement: t => makeEl('new_' + t, doc, t),
    createDocumentFragment: () => makeEl('frag', doc, 'fragment'),
    addEventListener: (t, fn) => { doc._on = doc._on || {}; doc._on[t] = fn; },
    removeEventListener: () => {}
  };
  doc.documentElement = makeEl('html', doc);
  doc.body = makeEl('body', doc, 'body');   /* ★tagName 이 BODY 여야 'body > header' 선택자가 성립한다 */
  for (const id of IDS) doc.getElementById(id);
  doc.getElementById('over')._classes.add('overlay');
  doc.getElementById('start')._classes.add('overlay');
  doc.getElementById('start')._classes.add('show');
  for (const k of ['title','subtitle','hint','how1','dailyDesc','statPlays','secUnit']){
    const e = makeEl('i18n_' + k, doc, 'p'); e.dataset.i18n = k; els.set('i18n_' + k, e);
  }
  els.set('home', makeEl('home', doc, 'a'));

  /* ★시계 · 이 하네스가 쥐고 있다. 흐르는 것은 우리가 밀어 준 만큼뿐이다. */
  let clock = 1000;
  const perf = { now: () => clock };

  /* ★벽시계(달력)도 하네스가 쥔다 · performance.now() 와는 다른 축이다.
     이것이 없으면 '같은 날 아무 때나 열어도 같은 판' 을 잴 수 없다. 같은 순간에 두 번 물어
     같은 답이 나오는 것은 씨앗에 시각이 섞여 있어도 성립하기 때문이다. */
  const RealDate = Date;
  let wall = RealDate.now();
  class DateStub extends RealDate {
    constructor(...a){ if (a.length === 0) super(wall); else super(...a); }
    static now(){ return wall; }
  }

  /* ★프레임 · 우리가 부를 때만 돈다. 간격도 우리가 정한다(불규칙하게 줄 수 있다). */
  let rafSeq = 1;
  const rafQueue = new Map();
  const requestAnimationFrame = fn => { const id = rafSeq++; rafQueue.set(id, fn); return id; };
  const cancelAnimationFrame = id => { rafQueue.delete(id); };
  function runFrame(){
    const entries = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, fn] of entries) fn(clock);
    return entries.length;
  }

  /* 타이머 · 우리가 돌리지 않으면 영원히 안 돈다(★논리 즉시 확정을 재는 데 쓴다) */
  let tSeq = 1;
  const timers = new Map();
  const setTimeoutStub = (fn) => { const id = tSeq++; timers.set(id, fn); return id; };
  const clearTimeoutStub = id => { timers.delete(id); };
  function runTimers(){ const e = [...timers.entries()]; timers.clear(); for (const [, fn] of e) fn(); return e.length; }

  /* ★preventDefault 호출 계수기. 스텁의 빈 함수는 '호출됐다'를 증명하지 못한다
     (장기기억 stub-fidelity-decides-whether-a-check-can-fail). */
  let pdCount = 0;

  /* ★창 밖 요소 · 제품의 setOutsideInert 가 훑는 선택자에 실제로 걸리는 것을 준다.
     스텁이 아무것도 주지 않으면 그 함수는 시험에서 ★없는 것과 같다. */
  const outsideEls = {};
  for (const spec of [['header','HEADER'],['main','MAIN'],['section','SECTION'],['footer','FOOTER']]){
    const e = makeEl('outside_' + spec[0], doc, spec[1]);
    e.parent = doc.body; doc.body.children.push(e);
    els.set('outside_' + spec[0], e);
    outsideEls[spec[0]] = e;
  }
  for (const cls of ['ad-slot','scores']){
    const e = makeEl('outside_' + cls, doc, 'DIV');
    e._classes.add(cls);
    e.parent = doc.body; doc.body.children.push(e);
    els.set('outside_' + cls, e);
    outsideEls[cls] = e;
  }

  /* Math.random 계수기 · '플레이가 난수를 소비하지 않는다'를 직접 잰다 */
  let randCalls = 0;
  const realRandom = Math.random;
  const MathStub = Object.create(Math);
  MathStub.random = () => { randCalls++; return realRandom(); };

  const nav = { language: 'ko-KR' };
  const win = {
    addEventListener: () => {}, removeEventListener: () => {},
    navigator: nav, localStorage,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame, cancelAnimationFrame,
    location: { href: 'https://hanpango.com/higher-lower/' },
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    HTMLElement: HTMLElementStub, PointerEvent: PointerEventStub, document: doc,
    performance: perf
  };
  const sandbox = {
    window: win, document: doc, localStorage, navigator: nav, performance: perf,
    HTMLElement: HTMLElementStub, PointerEvent: PointerEventStub, location: win.location,
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    requestAnimationFrame, cancelAnimationFrame,
    console, Math: MathStub, Date: DateStub, JSON, Promise,
    Number, String, Array, Object, RegExp, Error, isNaN, isFinite, parseInt, parseFloat
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(SRC, sandbox, { filename: 'higher-lower-inline.js' }); }
  catch (e){ console.error('구동 실패: ' + e.stack); process.exit(2); }
  if (!win.__hl || !win.__hlTest){ console.error('관측 창구(__hl)/시험 다리(__hlTest) 없음'); process.exit(2); }

  const ansOf = i => doc.getElementById('ans' + i);
  const A = {
    hl: win.__hl, t: win.__hlTest, doc, store: localStorage,
    el: id => doc.getElementById(id),
    txt: id => doc.getElementById(id).textContent,
    rand: () => randCalls,
    resetRand: () => { randCalls = 0; },
    now: () => clock,
    advance: ms => { clock += ms; },
    /* 벽시계 조작 · 달력을 옮긴다(경과 시간 clock 과는 별개 축이다) */
    wall: () => wall,
    setWall: ms => { wall = ms; },
    frame: () => runFrame(),
    frames: () => rafQueue.size,
    runTimers,
    pendingTimers: () => timers.size,
    /* ★진짜 입력 사건으로 두드린다 · 다리로 onAnswer 를 부르지 않는다 */
    tap: (i, props) => {
      const fn = ansOf(i)._on.pointerdown;
      if (!fn) throw new Error('답 칸 pointerdown 핸들러 없음');
      fn(Object.assign({ button: 0, timeStamp: clock }, props || {}));
    },
    keyOn: (i, k, opts) => {
      const fn = ansOf(i)._on.keydown;
      if (!fn) throw new Error('답 칸 keydown 핸들러 없음');
      const o = opts || {};
      fn({ key: k, repeat: !!o.repeat, preventDefault(){ pdCount++; },
           timeStamp: ('timeStamp' in o) ? o.timeStamp : clock });
    },
    key: (k, opts) => {
      const fn = doc._on && doc._on.keydown;
      if (!fn) throw new Error('문서 keydown 핸들러 없음');
      const o = opts || {};
      fn({ key: k, repeat: !!o.repeat, ctrlKey: !!o.ctrlKey, metaKey: !!o.metaKey, altKey: !!o.altKey,
           preventDefault(){ pdCount++; },
           timeStamp: ('timeStamp' in o) ? o.timeStamp : clock });
    },
    pd: () => pdCount,
    resetPd: () => { pdCount = 0; },
    focused: () => doc.activeElement,
    inertOf: sel => { const el = outsideEls[sel]; return el ? el.hasAttribute('inert') : null; },
    outsideNames: () => Object.keys(outsideEls),
    /* ★도장은 지금과 다를 수 있다 · 브라우저는 우리 코드가 돌기 전에 사건에 도장을 찍는다.
       도장을 늘 지금과 같게 주면 '시작 시각을 도장에서 잡는가 지금에서 잡는가' 를 가를 수 없다. */
    startBtn: off => doc.getElementById('btnStart').onclick({ timeStamp: clock + (off || 0) }),
    dailyBtn: off => doc.getElementById('btnDaily').onclick({ timeStamp: clock + (off || 0) }),
    againBtn: () => doc.getElementById('btnAgain').onclick({ timeStamp: clock }),
    langBtn: () => doc.getElementById('btnLang').onclick()
  };
  return A;
}

/* ------------------------------------------------------------ ★추락은 판정이 아니다
   Node 는 잡히지 않은 예외도 exit 1 로 끝낸다 · 그러면 '검사가 결함을 잡았다' 와
   '하네스가 죽었다' 가 같은 종료코드가 되어 검출력 표가 거짓이 된다. */
process.on('uncaughtException', e => {
  console.error('\n[하네스 오류] 판정 불가(rc=2) · ' + (e && e.stack ? e.stack : e));
  process.exit(2);
});

/* ------------------------------------------------------------ 테스트 틀 */
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail){
  if (cond){ pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
const section = t => console.log('\n[' + t + ']');
const note = t => console.log('    · ' + t);

/* 지금 자리에서 '눌러야 하는 칸'을 ★관측 창구에서 읽는다
   (하네스가 답을 따로 셈해 두면 그때부터 검사가 계약이 아니라 내 셈을 재게 된다) */
const rightIdx = A => { const s = A.hl.state(); return A.hl.correctIndexAt(s.values, s.idx); };
const wrongIdx = A => 1 - rightIdx(A);

/* ============================================================ 1. 규격과 순수 함수 */
section('1. 규격과 순수 함수');
{
  const A = boot();
  const C = A.hl.const();
  eq('값의 종류는 넷이다', C.KINDS.slice().sort(), ['bar','circle','dots','number']);
  eq('판을 짤 때 값을 100개 전부 뽑아 둔다', C.VALUES, 100);
  eq('위 칸은 0번, 아래 칸은 1번이다', [C.HIGHER, C.LOWER], [0, 1]);
  ok('라운드마다 차이가 줄어드는 폭이 1 이상이다', C.GAP_STEP >= 1, String(C.GAP_STEP));

  /* ★무승부 배제의 근거는 이 두 부등식이다(생성 규칙) */
  let gapMinBad = [], spanBad = [];
  for (const k of C.KINDS){
    const s = C.SPEC[k];
    if (!(s.gapMin >= 1)) gapMinBad.push(k);
    /* 반대 방향이 언제나 범위 안이려면 (max-min) 이 2*gapStart 이상이어야 한다 */
    if (!(s.max - s.min >= 2 * s.gapStart)) spanBad.push(k);
  }
  ok('종류마다 최소 차이가 1 이상이다(같은 값이 나올 수 없는 근거)', gapMinBad.length === 0, String(gapMinBad));
  ok('종류마다 범위가 첫 차이의 두 배 이상이다(방향을 뒤집으면 언제나 범위 안이다)',
     spanBad.length === 0, String(spanBad));

  /* ★차이는 라운드가 오를수록 좁아지고 바닥 아래로는 안 내려간다 · 두 성질을 따로 잰다 */
  let notShrinking = [], belowFloor = [];
  for (const k of C.KINDS){
    const s = C.SPEC[k];
    for (let i = 0; i < 60; i++){
      const a = A.hl.gapAt(k, i), b = A.hl.gapAt(k, i + 1);
      if (b > a) notShrinking.push(k + ':' + i);
      if (b < s.gapMin) belowFloor.push(k + ':' + i);
    }
    if (A.hl.gapAt(k, 0) !== s.gapStart) notShrinking.push(k + ':start');
    if (A.hl.gapAt(k, 0) <= A.hl.gapAt(k, 10)) notShrinking.push(k + ':flat');
  }
  ok('라운드가 오를수록 두 값의 차이가 좁아진다', notShrinking.length === 0, String(notShrinking.slice(0, 6)));
  ok('차이는 종류마다 정해진 바닥값 아래로 내려가지 않는다', belowFloor.length === 0, String(belowFloor.slice(0, 6)));

  /* ★이 게임의 전부 · 다음 값이 크면 위, 작으면 아래 */
  const up = [10, 20, 30], down = [30, 20, 10];
  ok('higherAt 은 다음 값이 지금 값보다 클 때만 참이다',
     A.hl.higherAt(up, 0) === true && A.hl.higherAt(down, 0) === false,
     `up=${A.hl.higherAt(up,0)} down=${A.hl.higherAt(down,0)}`);
  ok('다음 값이 크면 위 칸이 정답이고 작으면 아래 칸이 정답이다',
     A.hl.correctIndexAt(up, 0) === C.HIGHER && A.hl.correctIndexAt(down, 0) === C.LOWER,
     `up=${A.hl.correctIndexAt(up,0)} down=${A.hl.correctIndexAt(down,0)}`);
}

/* ============================================================ 2. ★무승부는 생성 규칙으로 배제된다 */
section('2. ★판을 짜는 규칙 · 무승부 0 · 범위 준수 · 차이가 gapAt 과 일치');
{
  const A = boot();
  const C = A.hl.const();
  let ties = 0, oor = 0, gapBad = 0, pairs = 0, shortPlans = 0;
  const kinds = {};
  const DAYS = 240;
  for (let d = 0; d < DAYS; d++){
    const key = A.hl.seedKey(Date.UTC(2026, 0, 1) + d * 86400000);
    const p = A.hl.plan(key);
    kinds[p.kind] = (kinds[p.kind] || 0) + 1;
    if (p.values.length !== C.VALUES) shortPlans++;
    const s = C.SPEC[p.kind];
    for (let i = 0; i < p.values.length; i++){
      const v = p.values[i];
      if (v < s.min || v > s.max) oor++;
      if (i + 1 < p.values.length){
        pairs++;
        const g = Math.abs(p.values[i + 1] - v);
        if (g === 0) ties++;
        if (g !== A.hl.gapAt(p.kind, i)) gapBad++;
      }
    }
  }
  ok(`전제 · 이웃쌍을 충분히 셌다(${pairs}쌍)`, pairs > 20000, String(pairs));
  ok('판을 짤 때 값을 100개 전부 뽑아 둔다', shortPlans === 0, `짧은 판 ${shortPlans}개`);
  ok('이웃한 두 값은 절대 같지 않다(무승부 0)', ties === 0, `동률 ${ties}쌍 / ${pairs}쌍`);
  ok('값은 종류마다 정해진 범위 안에 있다', oor === 0, `범위 이탈 ${oor}개`);
  ok('이웃한 두 값의 차이는 그 라운드의 gapAt 과 정확히 같다', gapBad === 0, `불일치 ${gapBad}쌍`);
  ok('네 종류가 모두 나온다(씨앗이 종류를 고른다)',
     Object.keys(kinds).length === 4, JSON.stringify(kinds));
  note(`씨앗 ${DAYS}개 · 이웃쌍 ${pairs} · 종류 분포 ${JSON.stringify(kinds)}`);
}

/* ============================================================ 3. ★연쇄 계약 */
section('3. ★연쇄 · 맞히면 이어지고 틀리면 그 자리에서 끝난다');
{
  const A = boot();
  A.startBtn(0);
  const before = A.hl.state();
  eq('시작하면 첫 값이 기준이다', before.idx, 0);
  eq('시작 점수는 0 이다', before.score, 0);

  for (let n = 1; n <= 5; n++){
    A.advance(300);
    A.tap(rightIdx(A));
    const s = A.hl.state();
    if (s.score !== n || s.idx !== n){
      ok('맞히면 연속 정답이 하나 오른다', false, `${n}번째: score=${s.score} idx=${s.idx}`);
      ok('맞히면 그 값이 새 기준이 되어 연쇄가 이어진다', false, `${n}번째: idx=${s.idx}`);
      break;
    }
    if (n === 5){
      ok('맞히면 연속 정답이 하나 오른다', true);
      ok('맞히면 그 값이 새 기준이 되어 연쇄가 이어진다', true);
    }
  }
  eq('맞히는 동안 판은 계속된다', A.hl.state().phase, 'running');

  const at = A.hl.state();
  const nextValue = at.values[at.idx + 1];
  A.advance(300);
  A.tap(wrongIdx(A));
  const after = A.hl.state();
  eq('틀리면 그 자리에서 판이 끝난다', after.phase, 'done');
  /* ★판이 안 닫힌 사본에서도 하네스가 추락하지 않게 결과를 안전하게 읽는다 ·
     추락(rc=2)은 판정이 아니라 판정 불가라, 지목한 검사가 붉는 것으로만 말하게 한다. */
  const res = A.hl.result() || {};
  ok('틀려도 그때까지의 연속 정답은 기록으로 남는다', res.score === 5, `score=${res.score}`);
  ok('틀리면 다음 값이 드러난다', after.revealed === true, `revealed=${after.revealed}`);
  ok('드러난 값이 실제 다음 값이다',
     A.hl.curHtml().indexOf('>' + nextValue + '<') >= 0 || res.to === nextValue,
     `to=${res.to} want=${nextValue}`);
  eq('창이 떴다', A.hl.shown('over'), true);
}

/* ============================================================ 4. ★논리는 누른 순간 확정된다 */
section('4. ★논리 즉시 확정 · 타이머·프레임을 돌리지 않아도 판정은 끝나 있다');
{
  const A = boot();
  A.startBtn(0);
  A.advance(120);
  A.tap(wrongIdx(A));
  eq('타이머를 돌리지 않아도 판이 닫혀 있다', A.hl.state().phase, 'done');
  ok('결과가 이미 만들어져 있다', A.hl.result() !== null);
  eq('프레임을 돌리지 않아도 창이 떠 있다', A.hl.shown('over'), true);
  eq('판이 끝나면 그리기를 멈춘다', A.hl.drawing(), false);
}

/* ============================================================ 5. ★시간은 판정에 들어가지 않는다 */
section('5. ★시간 · 판정에는 안 쓰이고 그림만 흐른 시간을 따른다');
{
  /* 같은 순서로 눌렀으면 얼마나 기다렸든 결과가 같아야 한다 */
  const runOnce = (waits, framesPer) => {
    const A = boot();
    A.startBtn(0);
    const seq = [];
    for (const w of waits){
      A.advance(w);
      for (let f = 0; f < framesPer; f++){ A.advance(1); A.frame(); }
      seq.push(rightIdx(A));
      A.tap(rightIdx(A));
    }
    A.advance(50);
    A.tap(wrongIdx(A));
    const r = A.hl.result() || {};
    return { score: r.score, rounds: r.rounds, kindKnown: typeof r.kind === 'string', seq };
  };
  const slow = runOnce([2000, 9000, 40000, 300], 3);
  const fast = runOnce([5, 5, 5, 5], 60);
  ok('기다린 시간이 달라도 같은 순서로 누르면 같은 기록이 나온다',
     slow.score === fast.score && slow.rounds === fast.rounds,
     `slow=${JSON.stringify(slow)} fast=${JSON.stringify(fast)}`);
  ok('프레임 수가 달라도 같은 기록이 나온다', slow.score === 4 && fast.score === 4,
     `slow=${slow.score} fast=${fast.score}`);

  /* 그린 시계는 흐른 시간의 함수다 · 프레임 간격을 불규칙하게 준다 */
  const A = boot();
  A.startBtn(0);
  const t0 = A.now();
  let worst = 0;
  for (const step of [7, 250, 3, 900, 33, 5000, 16]){
    A.advance(step); A.frame();
    const want = A.now() - t0;
    worst = Math.max(worst, Math.abs(A.hl.drawn() - want));
  }
  ok('그린 시간이 매 프레임 흐른 시간과 같다(프레임 간격이 불규칙해도)', worst === 0, `최대 오차 ${worst}ms`);

  /* 도장 · 누른 순간의 시각으로 잰다(우리 코드가 돌기까지의 지연이 끼지 않는다) */
  const B = boot();
  B.startBtn(0);
  B.advance(1000);
  B.tap(wrongIdx(B), { timeStamp: B.now() - 400 });   /* 허용오차 안쪽의 옛 도장 */
  ok('허용오차 안쪽의 도장은 그대로 쓴다', Math.abs((B.hl.result() || {}).ms - 600) <= 1,
     `ms=${(B.hl.result() || {}).ms} want≈600`);

  const C2 = boot();
  C2.startBtn(0);
  C2.advance(1000);
  /* ★도장은 ★양수이면서 허용오차 밖이어야 한다 · 음수 도장은 앞선 s > 0 가드가 먼저 걸러
     허용오차를 지워도 결과가 같다(그 표본으로는 이 계약을 증명하지 못한다). */
  C2.tap(wrongIdx(C2), { timeStamp: C2.now() + 50000 });   /* 허용오차 밖의 미래 도장 */
  ok('허용오차를 벗어난 도장은 믿지 않고 지금 시각으로 물러선다',
     Math.abs((C2.hl.result() || {}).ms - 1000) <= 1, `ms=${(C2.hl.result() || {}).ms} want≈1000`);
}

/* ============================================================ 6. ★씨앗 결정성(시각 축 포함) */
section('6. ★일일 결정성 · 같은 날이면 몇 시에 열어도 같은 판이다');
{
  const A = boot();
  const DAY = Date.UTC(2026, 8, 4, 3, 0, 0);        /* 그날 새벽 */
  A.setWall(DAY);
  const key0 = A.hl.seedKey();
  const no0 = A.hl.dailyNo();
  const plan0 = A.hl.plan(key0);

  /* ★전제 · 가짜 시계가 제품에 닿는가. 닿지 않으면 아래 검사는 아무것도 증명하지 못한다. */
  A.setWall(DAY + 86400000 * 5);
  const movedKey = A.hl.seedKey(), movedNo = A.hl.dailyNo();
  ok('전제 · 가짜 벽시계가 제품에 닿는다(날짜를 옮기면 회차와 씨앗이 실제로 바뀐다)',
     movedKey !== key0 && movedNo === no0 + 5, `key ${key0} → ${movedKey} · no ${no0} → ${movedNo}`);
  ok('전제 · 날짜가 다르면 판도 다르다(늘 같은 판이면 아래 검사가 공허하다)',
     JSON.stringify(A.hl.plan(movedKey)) !== JSON.stringify(plan0));

  /* 같은 날 안에서 시각만 크게 옮긴다 */
  const sameDay = [
    ['+7시간', DAY + 7 * 3600000],
    ['+1초', DAY + 1000],
    ['그날 23시 59분', Date.UTC(2026, 8, 4, 14, 59, 0)]   /* KST 기준 같은 날 안쪽 */
  ];
  let drift = [];
  for (const [label, ms] of sameDay){
    A.setWall(ms);
    if (A.hl.seedKey() !== key0) { drift.push(label + '(씨앗)'); continue; }
    if (JSON.stringify(A.hl.plan(A.hl.seedKey())) !== JSON.stringify(plan0)) drift.push(label + '(판)');
  }
  ok('같은 씨앗은 시각이 달라져도 같은 판을 준다(가짜 시계로 크게 벌려 확인)',
     drift.length === 0, String(drift));

  /* 씨앗을 직접 주고 두 번 물어도 같아야 한다(순수성) */
  const twice = JSON.stringify(A.hl.plan('fixed-seed-x')) === JSON.stringify(A.hl.plan('fixed-seed-x'));
  ok('같은 씨앗은 같은 판을 준다(값 100개 전체)', twice);

  /* 다른 씨앗은 다른 난수열을 준다(씨앗이 실제로 쓰인다) */
  const d1 = A.hl.seedDraws('seed-a', 8).join(','), d2 = A.hl.seedDraws('seed-b', 8).join(',');
  ok('씨앗이 다르면 난수열도 다르다', d1 !== d2);
}

/* ============================================================ 7. ★난수는 판을 짤 때 전부 소진된다 */
section('7. ★난수 · 플레이 중에는 한 장도 쓰지 않는다');
{
  const A = boot();
  A.dailyBtn(0);
  A.resetRand();
  for (let n = 0; n < 12; n++){
    A.advance(120 + n * 37);
    A.frame();
    A.tap(rightIdx(A));
  }
  A.langBtn();
  A.frame();
  const duringPlay = A.rand();
  A.advance(50);
  A.tap(wrongIdx(A));
  const afterEnd = A.rand();
  ok('플레이 행동은 난수를 한 번도 소비하지 않는다(오늘의 도전)',
     duringPlay === 0 && afterEnd === 0, `플레이 중 ${duringPlay} · 끝난 뒤 ${afterEnd}`);

  /* 반면 자유 모드로 새 판을 열면 난수를 쓴다(위 검사가 공허하지 않다는 대조군) */
  const B = boot();
  B.resetRand();
  B.startBtn(0);
  ok('전제 · 자유 모드로 판을 여는 순간에는 난수를 쓴다(대조군)', B.rand() > 0, String(B.rand()));

  /* 연쇄가 길어져도 값이 모자라지 않는다 */
  const C3 = boot();
  C3.dailyBtn(0);
  C3.resetRand();
  let steps = 0;
  while (C3.hl.state().phase === 'running' && steps < 200){
    C3.advance(10);
    C3.tap(rightIdx(C3));
    steps++;
  }
  ok('연쇄를 끝까지 이어도 난수를 더 쓰지 않는다', C3.rand() === 0, String(C3.rand()));
  ok('값이 다 떨어지면 판이 스스로 닫힌다(추락하지 않는다)',
     C3.hl.state().phase === 'done' && steps < 200, `steps=${steps} phase=${C3.hl.state().phase}`);
  note(`끝까지 이어 간 라운드 ${steps} · 기록 ${C3.hl.result() ? (C3.hl.result() || {}).score : '?'}`);
}

/* ============================================================ 8. ★한 판 한 종류 */
section('8. ★한 판 안에서 값의 종류가 바뀌지 않는다');
{
  const A = boot();
  A.startBtn(0);
  const kind0 = A.hl.state().kind;
  const chip0 = A.hl.chips()[0];
  let changed = 0;
  for (let n = 0; n < 12; n++){
    A.advance(80);
    A.tap(rightIdx(A));
    if (A.hl.state().kind !== kind0) changed++;
    /* 화면의 딱지에도 같은 종류 이름이 남아 있어야 한다 */
    const name = chip0.split(' · ')[0];
    if (A.hl.chips()[0].split(' · ')[0] !== name) changed++;
  }
  ok('한 판 안에서 값의 종류가 바뀌지 않는다', changed === 0, `바뀐 횟수 ${changed}`);
  ok('전제 · 딱지가 종류 이름과 라운드를 함께 적는다',
     /·/.test(A.hl.chips()[0]) && A.hl.chips()[0].length > 3, A.hl.chips()[0]);
}

/* ============================================================ 9. ★값의 몸 · 종류마다 다른 모양 */
section('9. ★값의 몸 · 종류마다 다른 모양으로 그린다');
{
  const A = boot();
  const C = A.hl.const();
  const html = {};
  for (const k of C.KINDS) html[k] = A.hl.valueHtml(k, 20);
  const uniq = new Set(Object.values(html));
  ok('네 종류가 서로 다른 마크업으로 그려진다', uniq.size === 4, JSON.stringify(Object.keys(html)));
  ok('숫자 종류는 수치를 글자로 적는다', /20/.test(html.number), html.number);
  ok('점 종류는 값의 개수만큼 점을 찍는다',
     (A.hl.valueHtml('dots', 7).match(/<i>/g) || []).length === 7,
     A.hl.valueHtml('dots', 7));
  ok('막대 종류는 값에 비례하는 폭을 준다',
     /width:20%/.test(html.bar) && /width:55%/.test(A.hl.valueHtml('bar', 55)), html.bar);
  ok('원 종류는 값에 비례하는 지름을 준다',
     /width:20px/.test(html.circle) && /height:20px/.test(html.circle), html.circle);
  /* 값이 다르면 마크업도 달라야 한다(그림이 값을 따라간다) */
  let same = [];
  for (const k of C.KINDS) if (A.hl.valueHtml(k, 20) === A.hl.valueHtml(k, 21)) same.push(k);
  ok('값이 달라지면 그림도 달라진다', same.length === 0, String(same));
}

/* ============================================================ 10. ★색맹 안전 */
section('10. ★색맹 안전 · 두 칸이 글자와 모양으로 말한다');
{
  const A = boot();
  A.startBtn(0);
  const icons = A.hl.iconHtml();
  const labels = A.hl.answerLabels();
  ok('전제 · 두 칸에 실제로 모양이 들어 있다', icons.every(s => /<svg/.test(s)), JSON.stringify(icons).slice(0, 80));
  ok('두 답 칸은 색이 아니라 모양으로 서로 다르다', icons[0] !== icons[1]);
  ok('두 답 칸의 글자가 서로 다르다', labels[0] !== labels[1], JSON.stringify(labels));
  ok('전제 · 두 칸의 글자가 비어 있지 않다', labels.every(s => s && s.length > 0), JSON.stringify(labels));
  /* 표시(hit·miss)는 색 말고 클래스로도 남는다 */
  A.advance(50); A.tap(rightIdx(A));
  ok('맞힌 칸에 표시가 남는다', A.hl.marked().includes('hit'), JSON.stringify(A.hl.marked()));
  A.advance(50); A.tap(wrongIdx(A));
  ok('틀린 칸에 표시가 남는다', A.hl.marked().includes('miss'), JSON.stringify(A.hl.marked()));
}

/* ============================================================ 11. ★터치 목표 · 360px 에서 50px */
section('11. ★터치 목표 · 360px 에서 답 칸의 짧은 변이 50px 을 지킨다');
{
  const html = RAW;
  const VIEWPORT = 360;        /* 재는 화면 폭(티켓이 못박은 값) */
  const MIN_TOUCH = 50;        /* 손가락 하한 */
  /* ★세로 스크롤막대가 차지하는 폭. 이 게임도 본문이 길어 360px 화면에서 항상 막대가 선다.
     ★추정이 아니라 실측이다 · innerWidth - documentElement.clientWidth 를 직접 읽었다.
     아래 보정 단언이 이 값이 맞는지를 답 칸 폭 실측으로 다시 되짚는다. */
  const SCROLLBAR = 12;
  const REAL_BTN_W = 159.0;    /* 실브라우저 실측(2026-09-04 · iframe width=360) */
  const mainPad = (/ {2}main\{[^}]*padding:\s*\d+px\s+(\d+)px/.exec(html) || [])[1];
  const ansCss = (/\.hl-answers\{([\s\S]*?)\}/.exec(html) || [])[1] || '';
  const gap = (/gap:(\d+)px/.exec(ansCss) || [])[1];
  const ansMax = (/max-width:min\(100%,(\d+)px\)/.exec(ansCss) || [])[1];
  const btnCss = (/\.hl-btn\{([\s\S]*?)\}/.exec(html) || [])[1] || '';
  const minH = (/min-height:(\d+)px/.exec(btnCss) || [])[1];
  const nums = [mainPad, gap, ansMax, minH].map(Number);
  ok('전제 · 답 칸의 치수 넷을 소스에서 읽었다(못 읽으면 판정 불가)',
     nums.every(v => Number.isFinite(v)),
     `main padding ${mainPad} · gap ${gap} · max-width ${ansMax} · min-height ${minH}`);
  const [mp, gp, amax, mh] = nums;
  const rowW = Math.min(VIEWPORT - SCROLLBAR - 2 * mp, amax);
  const btnW = (rowW - gp) / 2;
  const shortSide = Math.min(btnW, mh);
  /* ★보정 · 이 셈이 실브라우저가 실제로 세운 값을 재현하는가.
     재현하지 못하면 아래 50px 판정은 '내가 지어낸 수식' 위에 선 것이라 아무 뜻이 없다. */
  ok('이 셈이 실브라우저 실측(답 칸 폭)을 재현한다',
     Math.abs(btnW - REAL_BTN_W) < 0.6,
     `셈한 폭 ${btnW.toFixed(2)}px · 실측 ${REAL_BTN_W.toFixed(2)}px · 어긋나면 CSS 가 바뀐 것이니 다시 재라`);
  ok('답 칸은 360px 에서 짧은 변이 50px 하한을 지킨다',
     shortSide >= MIN_TOUCH, `짧은 변 ${shortSide.toFixed(2)}px(폭 ${btnW.toFixed(2)} · 높이 ${mh}) · 하한 ${MIN_TOUCH}px`);
  note(`360px 에서 답 칸 ${btnW.toFixed(2)} x ${mh}px`);
}

/* ============================================================ 12. 저장 · 하루 한 번 · 최고기록 · 스트릭 */
section('12. 저장 · 「오늘의 한판」 어댑터가 읽을 수 있는 형태인가');
{
  const store = makeStore();
  const A = boot({ store });
  A.dailyBtn(0);
  A.advance(200); A.tap(rightIdx(A));
  A.advance(200); A.tap(rightIdx(A));
  A.advance(200); A.tap(wrongIdx(A));
  /* ★기록이 아예 없는 사본에서도 추락하지 않게 빈 객체로 받는다(추락은 판정이 아니다) */
  const rec = JSON.parse(store.getItem('hl.daily') || 'null') || {};
  ok('오늘의 도전을 마치면 hl.daily 에 기록이 남는다', store.getItem('hl.daily') !== null);
  ok('기록에 날짜와 회차가 있다', typeof rec.date === 'string' && typeof rec.no === 'number',
     JSON.stringify(rec).slice(0, 90));
  ok('기록의 result.score 가 연속 정답 수다(today 어댑터가 읽는 자리)',
     !!rec.result && rec.result.score === 2, JSON.stringify(rec.result));
  ok('오늘의 도전은 최고 기록을 건드리지 않는다', store.getItem('hl.best') === null,
     String(store.getItem('hl.best')));
  ok('오늘의 도전을 마치면 스트릭이 선다', A.hl.daily().streak >= 1, String(A.hl.daily().streak));
  eq('오늘의 도전은 마친 것으로 표시된다', A.hl.daily().done, true);

  /* 두 번째 완주가 기록을 덮지 않는다 */
  const B = boot({ store });
  B.dailyBtn(0);
  for (let n = 0; n < 6; n++){ B.advance(50); B.tap(rightIdx(B)); }
  B.advance(50); B.tap(wrongIdx(B));
  const rec2 = JSON.parse(store.getItem('hl.daily') || 'null') || {};
  ok('오늘의 도전은 하루 한 번이다(두 번째 완주가 기록을 덮지 않는다)',
     !!rec2.result && rec2.result.score === 2, JSON.stringify(rec2.result));

  /* 자유 모드에서만 최고 기록이 바뀐다 */
  const store2 = makeStore();
  const C4 = boot({ store: store2 });
  C4.startBtn(0);
  for (let n = 0; n < 4; n++){ C4.advance(50); C4.tap(rightIdx(C4)); }
  C4.advance(50); C4.tap(wrongIdx(C4));
  ok('자유 모드를 마치면 최고 기록이 선다', !!C4.hl.best() && C4.hl.best().score === 4,
     JSON.stringify(C4.hl.best()));
  ok('최고 기록 경신 표시가 뜬다', (C4.hl.result() || {}).best === true);

  const D = boot({ store: store2 });
  D.startBtn(0);
  D.advance(50); D.tap(wrongIdx(D));            /* 0연속 · 더 나쁘다 */
  ok('자유 모드 최고 기록은 더 길게 이었을 때만 바뀐다',
     (D.hl.best() || {}).score === 4 && (D.hl.result() || {}).best === false,
     `best=${JSON.stringify(D.hl.best())} flag=${(D.hl.result() || {}).best}`);
  ok('betterThan 은 더 길 때만 참이다',
     D.hl.betterThan({ score: 5 }, { score: 4 }) === true &&
     D.hl.betterThan({ score: 3 }, { score: 4 }) === false &&
     D.hl.betterThan({ score: 1 }, null) === true);

  /* 스트릭 · 날짜가 끊기면 1 로 돌아간다 */
  const store3 = makeStore();
  const E = boot({ store: store3 });
  const day0 = Date.UTC(2026, 8, 1, 3, 0, 0);
  E.setWall(day0);
  E.dailyBtn(0); E.advance(50); E.tap(wrongIdx(E));
  const s1 = (E.hl.result() || {}).streak;
  const F = boot({ store: store3 });
  F.setWall(day0 + 86400000);                    /* 이튿날 */
  F.dailyBtn(0); F.advance(50); F.tap(wrongIdx(F));
  const s2 = (F.hl.result() || {}).streak;
  const G = boot({ store: store3 });
  G.setWall(day0 + 86400000 * 5);                /* 나흘 건너뛴다 */
  G.dailyBtn(0); G.advance(50); G.tap(wrongIdx(G));
  const s3 = (G.hl.result() || {}).streak;
  ok('이어서 도전하면 스트릭이 하나 오른다', s1 === 1 && s2 === 2, `${s1} → ${s2}`);
  ok('날짜가 끊기면 스트릭이 1 로 리셋된다', s3 === 1, `${s2} → ${s3}`);
}

/* ============================================================ 13. 저장 키 */
section('13. 저장 키 · 방침에 적힌 것만 쓴다');
{
  const store = makeStore();
  const A = boot({ store });
  A.startBtn(0);
  A.advance(50); A.tap(rightIdx(A));
  A.advance(50); A.tap(wrongIdx(A));
  A.langBtn();
  A.el('btnSound').onclick();
  const B = boot({ store });
  B.dailyBtn(0);
  B.advance(50); B.tap(wrongIdx(B));
  const keys = store.keys().sort();
  eq('제품이 쓰는 저장 키는 다섯이다(게임 넷 + 사이트 공용 언어)',
     keys, ['bp.lang', 'hl.best', 'hl.daily', 'hl.sound', 'hl.streak']);
}

/* ============================================================ 14. 화면 · 언어 */
section('14. 화면과 언어');
{
  const A = boot();
  A.startBtn(0);
  A.advance(1234); A.frame();
  const drawnBefore = A.hl.drawn();
  const valBefore = A.hl.curHtml();
  const langBefore = A.hl.lang();
  A.langBtn();
  ok('언어를 바꾸면 언어가 실제로 바뀐다', A.hl.lang() !== langBefore, `${langBefore} → ${A.hl.lang()}`);
  ok('언어를 바꿔도 화면의 값은 그대로다(판이 정한 것이다)', A.hl.curHtml() === valBefore);
  ok('언어를 바꿔도 그린 시간이 안내 문구로 갈아엎어지지 않는다', A.hl.drawn() === drawnBefore,
     `${drawnBefore} → ${A.hl.drawn()}`);
  ok('언어를 바꾸면 두 칸의 글자가 새 언어로 바뀐다',
     A.hl.answerLabels().join('|') !== '위|아래' || A.hl.lang() === 'ko',
     JSON.stringify(A.hl.answerLabels()));
  ok('두 칸의 자리 이름표가 비어 있지 않다', A.hl.slotLabels().every(s => s && s.length > 0),
     JSON.stringify(A.hl.slotLabels()));
  /* 재는 중에는 결과·설명을 접는다 */
  ok('재는 중에는 판만 남긴다(body 에 상태 클래스가 붙는다)', A.hl.running() === true);
  A.advance(50); A.tap(wrongIdx(A));
  ok('판이 끝나면 그 상태 클래스가 걷힌다', A.hl.running() === false);
}

/* ============================================================ 15. 입력 */
section('15. 입력 · 누르는 순간을 재고 중복을 세지 않는다');
{
  /* 화살표 키가 두 칸에 대응한다 */
  const A = boot();
  A.startBtn(0);
  const want = rightIdx(A);
  A.advance(100);
  A.key(want === 0 ? 'ArrowUp' : 'ArrowDown');
  eq('위·아래 화살표가 두 칸에 그대로 대응한다', A.hl.state().score, 1);

  /* 반복 발화는 무시한다 */
  const before = A.hl.state().score;
  A.key(rightIdx(A) === 0 ? 'ArrowUp' : 'ArrowDown', { repeat: true });
  eq('누르고 있어서 반복 발화된 화살표 입력은 무시된다', A.hl.state().score, before);

  /* 수식 키가 눌린 화살표는 우리 것이 아니다 */
  A.key(rightIdx(A) === 0 ? 'ArrowUp' : 'ArrowDown', { ctrlKey: true });
  eq('Ctrl 과 함께 눌린 화살표는 무시한다', A.hl.state().score, before);

  /* Enter·Space 는 답 칸 위에서 받는다 · preventDefault 로 뒤따르는 click 을 막는다 */
  const B = boot();
  B.startBtn(0);
  B.resetPd();
  B.advance(100);
  B.keyOn(rightIdx(B), 'Enter');
  eq('Enter 로도 답을 고를 수 있다', B.hl.state().score, 1);
  ok('Enter 로 눌렀을 때 preventDefault 가 호출된다', B.pd() === 1, String(B.pd()));
  B.keyOn(rightIdx(B), ' ');
  eq('Space 로도 답을 고를 수 있다', B.hl.state().score, 2);

  /* 창이 떠 있으면 화살표는 창의 것이다 */
  const C5 = boot();
  C5.advance(10);
  const scoreIdle = C5.hl.state().score;
  C5.key('ArrowUp');
  eq('시작 화면이 떠 있는 동안 화살표는 판을 건드리지 않는다', C5.hl.state().score, scoreIdle);

  /* 오른쪽 버튼 클릭은 답이 아니다 */
  const D = boot();
  D.startBtn(0);
  D.advance(100);
  D.tap(rightIdx(D), { button: 2 });
  eq('오른쪽 버튼으로는 답이 눌리지 않는다', D.hl.state().score, 0);

  /* 판이 끝난 뒤의 입력은 먹지 않는다 */
  const E = boot();
  E.startBtn(0);
  E.advance(100); E.tap(wrongIdx(E));
  const done = JSON.stringify(E.hl.result());
  E.advance(100);
  E.tap(0); E.tap(1);
  eq('판이 끝난 뒤의 입력은 결과를 바꾸지 않는다', JSON.stringify(E.hl.result()), done);
}

/* ============================================================ 16. 창(오버레이)과 inert */
section('16. 창 · 열리면 뒤를 잠근다');
{
  const A = boot();
  ok('전제 · 창 밖 요소가 실제로 있다(없으면 아래 검사가 공허하다)',
     A.outsideNames().length >= 4, JSON.stringify(A.outsideNames()));
  A.startBtn(0);
  ok('판이 도는 동안에는 창 밖이 잠겨 있지 않다', A.inertOf('main') === false);
  A.advance(50); A.tap(wrongIdx(A));
  ok('창이 열리면 창 밖 요소에 inert 가 붙는다',
     A.outsideNames().every(n => A.inertOf(n) === true),
     JSON.stringify(A.outsideNames().map(n => [n, A.inertOf(n)])));
  A.againBtn();
  ok('다시 시작하면 창 밖의 잠금이 풀린다',
     A.outsideNames().every(n => A.inertOf(n) === false));
}

/* ============================================================ 17. 결과·공유 */
section('17. 결과와 공유');
{
  const A = boot();
  A.startBtn(0);
  for (let n = 0; n < 3; n++){ A.advance(400); A.tap(rightIdx(A)); }
  A.advance(400); A.tap(wrongIdx(A));
  const r = A.hl.result() || {};
  eq('결과의 연속 정답이 맞다', r.score, 3);
  eq('결과의 라운드 수는 연속 정답 + 1 이다', r.rounds, 4);
  ok('결과에 종류가 담긴다', typeof r.kind === 'string' && r.kind.length > 0, r.kind);
  ok('결과에 걸린 시간이 담긴다(곁들이 수치)', typeof r.ms === 'number' && r.ms >= 1600, String(r.ms));
  ok('결과의 마지막 두 값이 실제로 서로 다르다', r.from !== r.to, `${r.from} → ${r.to}`);
  const marks = A.hl.marks();
  ok('판별 줄에 수치가 글자로 담긴다(그림 문자만으로 말하지 않는다)',
     /3/.test(marks) && marks.length > 4, marks);
  const share = A.hl.shareText();
  ok('공유문에 주소가 붙는다', /https:\/\/hanpango\.com\/higher-lower\//.test(share), share.slice(0, 80));
  ok('공유문에 판별 줄이 들어간다', share.indexOf(marks.split('\n')[0]) >= 0, share.slice(0, 80));
  eq('결과 화면의 연속 정답 칸이 채워진다', A.txt('nScore'), '3');
  ok('결과 화면의 시간 칸이 채워진다', /^\d+\.\d$/.test(A.txt('nTime')), A.txt('nTime'));
  ok('결과 화면의 종류 칸이 채워진다', A.txt('nKind').length > 0, A.txt('nKind'));
}

/* ============================================================ 18. 정적 검사 */
section('18. 정적 검사 · 소스에 대한 계약');
{
  const html = RAW;
  {
    const usedKeys = [...new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]))];
    const K = boot().t.i18nKeys();
    const ko = new Set(K.ko), en = new Set(K.en);
    ok('전제 · ko·en 두 i18n 표를 읽었다(못 읽으면 판정 불가)', ko.size > 0 && en.size > 0,
       `ko=${ko.size} en=${en.size}`);
    ok('전제 · 마크업이 실제로 data-i18n 키를 쓰고 있다(0개면 위 검사가 공허하다)',
       usedKeys.length >= 30, `쓰인 키 ${usedKeys.length}`);
    const missKo = usedKeys.filter(k => !ko.has(k));
    const missEn = usedKeys.filter(k => !en.has(k));
    ok('마크업의 data-i18n 키가 ko·en 두 표에 모두 있다',
       missKo.length === 0 && missEn.length === 0,
       `쓰인 키 ${usedKeys.length} · ko 누락 [${missKo}] · en 누락 [${missEn}]`);
    const onlyKo = K.ko.filter(k => !en.has(k)), onlyEn = K.en.filter(k => !ko.has(k));
    ok('ko·en 두 표의 키 집합이 완전히 같다',
       onlyKo.length === 0 && onlyEn.length === 0, `ko 에만 [${onlyKo}] · en 에만 [${onlyEn}]`);
    note(`data-i18n 키 ${usedKeys.length}개 · ko 표 ${ko.size}항목 · en 표 ${en.size}항목`);
  }
  ok('data-i18n 이 런타임 갱신 요소에 붙지 않았다(시계·값·딱지·결과 수치)',
     !/id="(clock|curVal|prevVal|curLbl|prevLbl|kindChip|scoreChip|label0|label1|icon0|icon1|marks|finalBig|finalLine|nScore|nKind|nTime|finalSub|dailyHint|bestNow|modeNow|streakNowEl)"[^>]*data-i18n/.test(html) &&
     !/data-i18n[^>]*id="(clock|curVal|prevVal|curLbl|prevLbl|kindChip|scoreChip|label0|label1|icon0|icon1|marks|finalBig|finalLine|nScore|nKind|nTime|finalSub|dailyHint|bestNow|modeNow|streakNowEl)"/.test(html));
  ok('전역 유틸 이름(.hint)을 쓰지 않는다', !/class="[^"]*\bhint\b/.test(html));
  ok('게임 고유 클래스에 hl- 접두가 붙어 있다',
     /class="hl-stage"/.test(html) && /class="hl-btn"/.test(html) && /class="hl-answers"/.test(html));
  ok('답 칸은 진짜 button 이다', /<button class="hl-btn" id="ans0" type="button">/.test(html));
  ok('hp-stats.js 를 defer 로 싣는다', /<script src="\/js\/hp-stats\.js" defer><\/script>/.test(html));
  ok('시작 화면에 판수 줄이 있다(처음엔 hidden)',
     /<p class="hp-stat" data-hp-line hidden data-i18n="statPlays">/.test(html));
  ok('hidden 가드가 있다', /\.hp-stat\[hidden\]\s*{[^{}]*display\s*:\s*none\s*!important[^{}]*}/.test(html));
  const st = [...html.matchAll(/statPlays:'([^']*)'/g)].map(m => m[1]);
  ok('statPlays 문안이 ko·en 두 곳에 있다', st.length === 2, String(st.length));
  ok('한국어 판수 문안이 다수파 꼴이다',
     /^오늘 <b data-hp="plays\.higher-lower\.today">[^<]*<\/b>판 · 누적 <b data-hp="plays\.higher-lower\.total">[^<]*<\/b>판$/.test(st[0] || ''), st[0]);
  ok('영어 판수 문안이 다수파 꼴이다',
     /^<b data-hp="plays\.higher-lower\.today">[^<]*<\/b> today · <b data-hp="plays\.higher-lower\.total">[^<]*<\/b> all-time$/.test(st[1] || ''), st[1]);
  const gaStarts = [...html.matchAll(/ga\('game_start'/g)].length;
  const paired = [...html.matchAll(/ga\('game_start', \{ game: GA_GAME(?![A-Za-z0-9_$])[^;\n]*\);(\s*\/\*[^*]*\*\/)?\s*\n\s*if \(window\.hpHit\) window\.hpHit\('play', GA_GAME\);/g)].length;
  ok(`hpHit('play') 가 시작 지점 ${gaStarts}곳 전부에 짝지어 있다`, paired === gaStarts && gaStarts > 0, `짝 ${paired} / 시작 ${gaStarts}`);
  const playHits = [...html.matchAll(/window\.hpHit\('play', GA_GAME\)/g)].length;
  ok('hpHit 호출이 시작 지점 수와 같다(떠도는 호출 0)', playHits === gaStarts, `호출 ${playHits} / 시작 ${gaStarts}`);
  ok('언어를 바꾼 뒤 숫자를 다시 채운다',
     /localStorage\.setItem\('bp\.lang', lang\);[\s\S]{0,240}if \(window\.hpStats\) window\.hpStats\(\)/.test(html));
  ok('검증 창구에 상태를 바꾸는 명령이 없다(관측 전용)',
     !/__hl\s*=\s*{[\s\S]*?\bbegin\s*:/.test(html) && !/__hl\s*=\s*{[\s\S]*?\btap\s*:/.test(html) &&
     !/__hlTest/.test(html), '배포본에 시험 다리가 남아 있다');
  ok('외부 스크립트는 사이트 공용 셋뿐이다(게임 로직은 외부 의존 0)',
     [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1])
       .every(u => /googlesyndication|googletagmanager|^\/js\/hp-stats\.js$/.test(u)));
  ok('canonical 과 og:url 이 이 게임을 가리킨다',
     /<link rel="canonical" href="https:\/\/hanpango\.com\/higher-lower\/">/.test(html) &&
     /<meta property="og:url" content="https:\/\/hanpango\.com\/higher-lower\/">/.test(html));
}

/* ============================================================ 결과 */
console.log(`\n${'='.repeat(56)}`);
console.log(`PASS ${pass} · FAIL ${fail}`);
if (fail){ console.log('실패한 검사:'); for (const f of failures) console.log('  - ' + f); }
if (MUTATION){
  const c = MUTATIONS[MUTATION].catcher;
  const caught = failures.includes(c);
  console.log(`[mutate] ${MUTATION} · 지목한 검사 "${c}" 가 ${caught ? '붉었다(귀속 일치)' : '★붉지 않았다(무임승차 또는 미탐지)'}`);
}
process.exit(fail ? 1 : 0);
