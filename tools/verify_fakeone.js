/* 가짜 하나(/fake-one/) 검증기 — worker(238) · 2026-09-04 · 티켓 T0904-fake-one
 *
 * 기존 검증기(verify_justright.js·verify_tensec.js)의 방식을 그대로 따른다:
 *   · 인라인 스크립트를 DOM 스텁 위에서 실제로 구동한다(vm)
 *   · 상태를 바꾸는 명령은 **제품 파일에 두지 않고** 여기서 메모리 위에만 덧붙인다(test bridge)
 *   · 판정은 배포되는 관측 창구(window.__fo)와 이 파일이 따로 셈한 값의 대조로 한다
 *   · 누르는 것은 다리가 아니라 **진짜 입력 사건**(pointerdown·keydown)으로 두드린다
 *
 * 중점 검사(티켓이 못박은 것)
 *   ★① 시간 판정 — 프레임 간격을 바꿔도 **같은 시각에 누르면 같은 기록**이 나오는가.
 *       그리고 기록이 '마지막으로 그린 시계'가 아니라 '누른 순간의 시각'에서 나오는가.
 *   ★② 시드 결정론 — 같은 날짜 씨앗이 같은 판을 주는가. 플레이 행동이 난수를 소비하지 않는가.
 *   ★③ 격자 계약 — 다른 칸이 **정확히 하나**인가. 한 라운드가 차이축을 **하나만** 쓰는가.
 *   ★④ 벌점 — 오답 1회가 총 기록에 정확히 2초를 더하고, 라운드는 넘어가지 않는가.
 *
 * ★이 하네스가 못 보는 것(정직 고지)
 *   · 레이아웃을 계산하지 않는다 — '요소가 0×0 으로 접힘' 은 실브라우저에서만 보인다.
 *   · CSS 는 파싱하지 않는다 — 클래스 이름 충돌은 아래 정적 검사에서 이름 수준으로만 본다.
 *   · svg 를 그리지 않는다 — 두 칸의 그림이 '사람 눈에' 구별되는지는 재지 못한다(문자열 차이까지다).
 *
 * 사용법: node verify_fakeone.js [--html <경로>] [--mutate <이름>] [--list-mutations]
 * 종료코드: 0 = 전부 PASS · 1 = 하나라도 FAIL · 2 = 뮤테이션 주입 실패·하네스 이상(탐지 아님)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
/* 기본 대상은 **이 도구가 놓인 저장소의 /fake-one/index.html** 이다 — 절대경로를 박아 두면
   worktree 를 갈아탈 때 조용히 남의 파일을 재게 된다. */
const HTML = argOf('--html', path.join(__dirname, '..', 'fake-one', 'index.html'));
const MUTATION = argOf('--mutate', null);

/* ------------------------------------------------------- 뮤테이션(검출력 자기시험)
   ★각 뮤테이션은 **어느 검사가 잡아야 하는지**를 함께 적는다 — 다른 검사가 우연히 깨져서 난
   빨강은 무임승차다(장기기억 mutation-must-name-the-check-that-catches-it).
   ★'주입 실패'와 '결함 탐지'를 종료코드로 가른다(2 = 주입 실패 · 1 = 탐지). */
const MUTATIONS = {
  /* ① 시계가 프레임을 누적한다 = 60Hz 와 144Hz 에서 다른 게임이 된다 */
  'frame-accumulate': {
    catcher: '그린 시계가 매 프레임 흐른 시간과 같다(프레임 간격 불규칙)',
    from: '  paintClockAt(elapsedAt(nowMs()));      /* ★프레임마다 흐른 시간에서 다시 계산한다 */',
    to:   '  paintClockAt(drawnMs + 16.7);   /* ★프레임마다 고정량을 더한다 = 주사율이 곧 시계가 된다 */'
  },
  /* ② 기록이 마지막으로 그린 시계를 쓴다 = 화면이 느릴수록 기록이 달라진다 */
  'judge-from-drawn': {
    catcher: '총 기록은 마지막으로 그린 시계가 아니라 누른 순간의 도장에서 나온다',
    from: '  const totalMs = totalOf(roundMs, wrongTotal);',
    to:   '  const totalMs = drawnMs;'
  },
  /* ③ 플레이 행동이 난수를 소비한다 = 사람마다 판이 갈린다 */
  'rng-on-play': {
    catcher: '플레이 행동은 난수를 한 번도 소비하지 않는다(오늘의 도전)',
    from: '    sWrong();\n    say(T(\'sayWrong\'));',
    to:   '    sWrong();\n    Math.random();\n    say(T(\'sayWrong\'));'
  },
  /* ④ 오늘의 도전 판을 날짜가 아니라 그때그때 뽑는다 = 같은 날 사람마다 다른 문제 */
  'seed-drift': {
    catcher: '같은 씨앗은 같은 판을 준다(8라운드 전체)',
    from: 'const dailyPlan = seedKey => makePlan(mulberry32(hashStr(String(seedKey))));',
    to:   'const dailyPlan = seedKey => makePlan(mulberry32((Math.random() * 4294967296) >>> 0));'
  },
  /* ⑤ 벌점 확정을 연출 뒤로 미룬다 = 빠른 입력이 낡은 상태 위에서 실행된다 */
  'defer-commit': {
    catcher: '타이머를 한 번도 돌리지 않아도 오답 벌점이 즉시 확정된다',
    from: '    wrongTotal += 1;\n    roundWrong += 1;',
    to:   '    setTimeout(() => { wrongTotal += 1; roundWrong += 1; }, 300);'
  },
  /* ⑥ 벌점을 총 기록에 넣지 않는다 = 찍어서 훑는 것이 이득이 된다 */
  'penalty-not-counted': {
    catcher: '오답 1회는 총 기록에 정확히 2초를 더한다',
    from: 'const totalOf = (roundMs, wrong) => sum(roundMs) + PENALTY_MS * wrong;',
    to:   'const totalOf = (roundMs, wrong) => sum(roundMs);'
  },
  /* ⑦ 오답인데 라운드가 넘어간다 = 찾지 않아도 판이 진행된다 */
  'wrong-advances-round': {
    catcher: '오답을 눌러도 라운드는 넘어가지 않는다',
    from: '    say(T(\'sayWrong\'));\n    return;',
    to:   '    say(T(\'sayWrong\'));\n    if (roundIdx + 1 < plan.length){ roundIdx += 1; layoutRound(); }\n    return;'
  },
  /* ⑧ 가짜가 둘이 된다 = "정확히 하나" 라는 이 게임의 전제가 무너진다 */
  'two-fakes': {
    catcher: '격자에서 나머지와 다른 칸은 정확히 하나다(그려진 그림으로 셈)',
    from: '  const fake = i === round.fakeIndex;',
    to:   '  const fake = i === round.fakeIndex || i === (round.fakeIndex + 1) % round.cells;'
  },
  /* ⑨ 한 라운드가 두 축을 섞는다 = 무엇을 보고 찾았는지가 흐려진다 */
  'axis-mix': {
    catcher: '한 라운드는 차이축을 하나만 쓴다(가짜는 그 축 하나만 어긋난다)',
    from: '    rot:    round.baseRot + (round.axis === \'rot\' ? d : 0),',
    to:   '    rot:    round.baseRot + (round.axis === \'rot\' || round.axis === \'color\' ? d : 0),'
  },
  /* ⑩ 차이가 라운드를 따라 줄지 않는다 = 뒤 라운드가 앞보다 쉬워진다 */
  'diff-not-shrinking': {
    catcher: '라운드가 오를수록 차이가 작아진다(amt 가 라운드마다 줄어든다)',
    from: '    const amt = base * (0.9 + rnd() * 0.1);',
    to:   '    const amt = 0.5 * (0.9 + rnd() * 0.1);'
  },
  /* ⑪ 격자가 커지지 않는다 */
  'grid-not-growing': {
    catcher: '라운드가 오를수록 격자가 커진다',
    from: '    const grid = GRIDS[i];',
    to:   '    const grid = GRIDS[0];'
  },
  /* ⑫ 축 배분이 무너진다 = 한 축만 여덟 번 나오는 퇴화 판이 가능해진다 */
  'axis-balance-broken': {
    catcher: '여덟 라운드에 네 축이 두 번씩 쓰인다',
    from: '  for (let k = 0; k < AXIS_REPEAT; k++) for (const a of AXES) bag.push(a);',
    to:   '  for (let k = 0; k < AXIS_REPEAT * AXES.length; k++) bag.push(AXES[0]);'
  },
  /* ⑬ 영어 표에서 본문 산문 키 하나를 뺀다 = EN 사용자가 그 문단만 한국어로 본다
        (just-right 가 실제로 낸 결함의 재현) */
  'en-prose-missing': {
    catcher: '마크업의 data-i18n 키가 ko·en 두 표에 모두 있다',
    from: '    how1:\'A grid fills with identical shapes',
    to:   '    how1x:\'A grid fills with identical shapes'
  },
  /* ⑭ 최고 기록 비교를 뒤집는다 = 느린 판이 최고 기록이 된다 */
  'best-worse-wins': {
    catcher: '자유 모드 최고 기록은 더 짧은 시간일 때만 바뀐다',
    from: 'const betterThan = (a, b) => !b || a.ms < b.ms;',
    to:   'const betterThan = (a, b) => !b || a.ms > b.ms;'
  },
  /* ⑮ 하루 한 번 규칙을 깬다 = 두 번째 도전이 그날 기록을 덮는다 */
  'daily-overwrite': {
    catcher: '오늘의 도전은 하루 한 번이다(두 번째 완주가 기록을 덮지 않는다)',
    from: '    if (!dailyDoneToday()){\n      saveDaily({ ms: totalMs, wrong: wrongTotal, rounds: r.rounds });',
    to:   '    if (true){\n      saveDaily({ ms: totalMs, wrong: wrongTotal, rounds: r.rounds });'
  },
  /* ⑯ 스트릭 리셋을 지운다 = 하루를 건너뛰어도 연속으로 센다 */
  'streak-never-resets': {
    catcher: '날짜가 끊기면 스트릭이 1 로 리셋된다',
    from: '  const n = (st && st.last === prevDayKey(day)) ? (st.n || 0) + 1 : 1;',
    to:   '  const n = (st.n || 0) + 1;'
  },
  /* ⑰ 도장 허용오차를 지운다 = 터무니없는 timeStamp 를 그대로 믿는다 */
  'stamp-no-tolerance': {
    catcher: '허용오차를 벗어난 도장은 믿지 않고 지금 시각으로 물러선다',
    from: '  if (typeof s === \'number\' && isFinite(s) && s > 0 && Math.abs(t - s) <= STAMP_TOLERANCE_MS) return s;',
    to:   '  if (typeof s === \'number\' && isFinite(s)) return s;'
  },
  /* ⑱ 키 반복 가드를 지운다 = 스페이스를 누르고 있으면 판이 저절로 굴러간다 */
  'repeat-guard-gone': {
    catcher: '누르고 있어서 반복 발화된 키 입력은 무시된다',
    from: '    if (ev.repeat) return;                 /* 누르고 있으면 반복해서 들어온다 — 첫 번째만 센다 */',
    to:   '    /* repeat guard deleted */'
  },
  /* ⑲ Enter 의 기본동작 차단을 지운다 = 뒤따르는 click 이 한 번 더 센다 */
  'key-no-preventdefault': {
    catcher: 'Enter 로 눌렀을 때 preventDefault 가 호출된다',
    from: '    ev.preventDefault();\n    onCell(i, ev);',
    to:   '    onCell(i, ev);'
  },
  /* ⑳ 창 밖 inert 부여를 지운다 = 창이 떠 있는데 배경으로 초점이 빠진다 */
  'inert-gone': {
    catcher: '창이 열리면 창 밖 요소에 inert 가 붙는다',
    from: 'function setOutsideInert(on){\n  for (const el of document.querySelectorAll(\'body > header, body > main, body > section, body > footer, body > .ad-slot, body > .scores\')){\n    if (on) el.setAttribute(\'inert\', \'\'); else el.removeAttribute(\'inert\');\n  }\n}',
    to:   'function setOutsideInert(on){ /* deleted */ }'
  },
  /* ㉑ 언어 전환이 격자를 다시 세운다 = 눌린 자리 표시와 초점이 사라진다.
        ★그림 문자열은 다시 세워도 똑같으므로 '그림 대조'로는 잡히지 않는다 —
          잡는 것은 '눌린 자리 표시가 살아남는가' 다(짝을 정확히 겨냥한다). */
  /* ㉒ 다크 도형 색의 채도를 올려 sRGB 밖으로 내보낸다 = 브라우저가 색을 끌어당기며 밝기 차가 줄어든다.
        ★이것이 실브라우저 픽셀 측정이 실제로 잡아낸 결함이다(선언 0.1118 → 렌더 0.0991). */
  'fig-out-of-gamut': {
    scope: 'html',
    catcher: '색상축의 모든 밝기 단계가 sRGB 안에 있다(잘리면 렌더된 차이가 선언보다 줄어든다)',
    from: '      --fig-l:0.68; --fig-c:0.10; --fig-h:288;',
    to:   '      --fig-l:0.68; --fig-c:0.16; --fig-h:288;'
  },
  /* ㉓ 다크 도형 색을 어둡게 내려 칸 바탕과의 대비를 깬다 = 도형이 바탕에 잠긴다.
        ★㉒ 와 짝이다 — 하나는 감마를, 하나는 대비를 깬다. 둘이 각각 다른 검사를 붉혀야
          두 단언이 서로에게 무임승차하고 있지 않다는 것이 드러난다. */
  'fig-low-contrast': {
    scope: 'html',
    catcher: '색상축의 모든 밝기 단계가 칸 바탕 대비 3:1 을 넘는다',
    from: '      --fig-l:0.68; --fig-c:0.10; --fig-h:288;',
    to:   '      --fig-l:0.42; --fig-c:0.10; --fig-h:288;'
  },
  'lang-rebuilds-board': {
    catcher: '진행 중 언어를 바꿔도 눌린 자리 표시가 사라지지 않는다',
    from: '  const r = curRound();\n  $(\'axisChip\').textContent = axisName(r.axis);',
    to:   '  layoutRound();\n  const r = curRound();\n  $(\'axisChip\').textContent = axisName(r.axis);'
  }
};
if (argv.includes('--list-mutations')){
  for (const [k, v] of Object.entries(MUTATIONS)) console.log(k + '\t' + v.catcher);
  process.exit(0);
}

let RAW = fs.readFileSync(HTML, 'utf8');

/* 인라인 스크립트 중 게임 본체(가장 긴 것)를 고른다 */
function gameSource(html){
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length){ console.error('인라인 스크립트를 찾지 못했다'); process.exit(2); }
  return blocks.sort((a, b) => b.length - a.length)[0];
}
/* ★뮤테이션의 사정거리는 두 가지다: 기본은 게임 스크립트(scope 없음)이고,
   ★CSS 토큰처럼 스크립트 밖에 있는 계약은 scope:'html' 로 문서 전체에 주입한다.
   주입 대상을 헷갈리면 앵커가 0회로 나와 '주입 실패'(rc=2)로 멈춘다 — 조용히 통과하지 않는다. */
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  if (!m){ console.error('알 수 없는 뮤테이션: ' + MUTATION); process.exit(2); }
  if (m.scope === 'html'){
    const n = RAW.split(m.from).length - 1;
    if (n !== 1){ console.error(`뮤테이션 주입 실패(${MUTATION}) — 앵커가 ${n}회 나타났다(1회여야 한다)`); process.exit(2); }
    RAW = RAW.replace(m.from, m.to);
  }
}
let SRC = gameSource(RAW);
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  if (m.scope !== 'html'){
    const n = SRC.split(m.from).length - 1;
    if (n !== 1){ console.error(`뮤테이션 주입 실패(${MUTATION}) — 앵커가 ${n}회 나타났다(1회여야 한다)`); process.exit(2); }
    SRC = SRC.replace(m.from, m.to);
  }
  console.log(`[mutate] ${MUTATION} 주입됨(${m.scope === 'html' ? '문서' : '스크립트'}) — 잡아야 하는 검사: ${m.catcher}`);
}

/* ------------------------------------------------------- test bridge(메모리 위에만)
   제품 파일에는 관측 창구(__fo)만 배포한다. 상태를 바꾸는 명령은 여기서 IIFE 가 닫히기 직전에
   덧붙인다 — 배포본에는 남지 않는다(장기기억 debug-hooks-in-shipped-code-are-a-control-api). */
const BRIDGE = `
window.__foTest = {
  /* ★i18n 표를 정규식으로 읽지 않는다 — 한 줄에 키가 여럿이거나 문장 안에 콜론이 있으면
     정규식은 대리물이 된다. 실행된 객체의 실제 키 목록을 그대로 준다. */
  i18nKeys: () => ({ ko: Object.keys(I18N.ko), en: Object.keys(I18N.en) }),
  /* ★문안 값도 표에서 그대로 받는다 — 하네스가 제품 문자열을 상수로 베껴 들면 그때부터
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
    /* ★innerHTML='' 도 자식을 지운다 — 격자를 다시 세우는 코드가 이 계약 위에 서 있다. */
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

const IDS = ['board','clock','clockUnit','penaltyLine','axisChip','roundChip','srSummary','toast','over','start',
             'finalBig','finalWrongLine','marks','streakLine','newBest','nRounds','nWrong','nPenalty','finalSub',
             'btnAgain','btnShare','btnDaily','btnStart','dailyHint','axisDesc','help',
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

  /* ★시계 — 이 하네스가 쥐고 있다. 흐르는 것은 우리가 밀어 준 만큼뿐이다. */
  let clock = 1000;
  const perf = { now: () => clock };

  /* ★프레임 — 우리가 부를 때만 돈다. 간격도 우리가 정한다(불규칙하게 줄 수 있다). */
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

  /* 타이머 — 우리가 돌리지 않으면 영원히 안 돈다(★논리 즉시 확정을 재는 데 쓴다) */
  let tSeq = 1;
  const timers = new Map();
  const setTimeoutStub = (fn) => { const id = tSeq++; timers.set(id, fn); return id; };
  const clearTimeoutStub = id => { timers.delete(id); };
  function runTimers(){ const e = [...timers.entries()]; timers.clear(); for (const [, fn] of e) fn(); return e.length; }

  /* ★preventDefault 호출 계수기. 스텁의 빈 함수는 '호출됐다'를 증명하지 못한다
     (장기기억 stub-fidelity-decides-whether-a-check-can-fail). */
  let pdCount = 0;

  /* ★창 밖 요소 — 제품의 setOutsideInert 가 훑는 선택자에 실제로 걸리는 것을 준다.
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

  /* Math.random 계수기 — '플레이가 난수를 소비하지 않는다'를 직접 잰다 */
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
    location: { href: 'https://hanpango.com/fake-one/' },
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    HTMLElement: HTMLElementStub, PointerEvent: PointerEventStub, document: doc,
    performance: perf
  };
  const sandbox = {
    window: win, document: doc, localStorage, navigator: nav, performance: perf,
    HTMLElement: HTMLElementStub, PointerEvent: PointerEventStub, location: win.location,
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    requestAnimationFrame, cancelAnimationFrame,
    console, Math: MathStub, Date, JSON, Promise,
    Number, String, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(SRC, sandbox, { filename: 'fake-one-inline.js' }); }
  catch (e){ console.error('구동 실패: ' + e.stack); process.exit(2); }
  if (!win.__fo || !win.__foTest){ console.error('관측 창구(__fo)/시험 다리(__foTest) 없음'); process.exit(2); }

  const board = doc.getElementById('board');
  const cellAt = i => board.children[i];
  const A = {
    fo: win.__fo, t: win.__foTest, doc, store: localStorage,
    el: id => doc.getElementById(id),
    txt: id => doc.getElementById(id).textContent,
    rand: () => randCalls,
    resetRand: () => { randCalls = 0; },
    now: () => clock,
    advance: ms => { clock += ms; },
    frame: () => runFrame(),
    frames: () => rafQueue.size,
    runTimers,
    pendingTimers: () => timers.size,
    cells: () => board.children.length,
    /* ★진짜 입력 사건으로 두드린다 — 다리로 onCell 을 부르지 않는다 */
    tap: (i, props) => {
      const el = cellAt(i);
      if (!el) throw new Error('칸 ' + i + ' 없음(칸 수 ' + board.children.length + ')');
      const fn = el._on.pointerdown;
      if (!fn) throw new Error('칸 pointerdown 핸들러 없음');
      fn(Object.assign({ button: 0, timeStamp: clock }, props || {}));
    },
    key: (i, k, opts) => {
      const el = cellAt(i);
      if (!el) throw new Error('칸 ' + i + ' 없음');
      const fn = el._on.keydown;
      if (!fn) throw new Error('칸 keydown 핸들러 없음');
      const o = opts || {};
      fn({ key: k, repeat: !!o.repeat,
           preventDefault(){ pdCount++; },
           timeStamp: ('timeStamp' in o) ? o.timeStamp : clock });
    },
    pd: () => pdCount,
    resetPd: () => { pdCount = 0; },
    focused: () => doc.activeElement,
    focusCell: i => { const el = cellAt(i); if (el) el.focus(); },
    inertOf: sel => { const el = outsideEls[sel]; return el ? el.hasAttribute('inert') : null; },
    outsideNames: () => Object.keys(outsideEls),
    startBtn: () => doc.getElementById('btnStart').onclick({ timeStamp: clock }),
    dailyBtn: () => doc.getElementById('btnDaily').onclick({ timeStamp: clock }),
    againBtn: () => doc.getElementById('btnAgain').onclick({ timeStamp: clock }),
    langBtn: () => doc.getElementById('btnLang').onclick()
  };
  return A;
}

/* ------------------------------------------------------------ ★추락은 판정이 아니다
   Node 는 잡히지 않은 예외도 exit 1 로 끝낸다 — 그러면 '검사가 결함을 잡았다' 와
   '하네스가 죽었다' 가 같은 종료코드가 되어 검출력 표가 거짓이 된다.
   예외는 전부 exit 2(판정 불가)로 올린다. */
process.on('uncaughtException', e => {
  console.error('\n[하네스 오류] 판정 불가(rc=2) — ' + (e && e.stack ? e.stack : e));
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
const near = (name, got, want, tol) =>
  ok(name, Math.abs(got - want) <= tol, `got=${got} want=${want} tol=${tol}`);
const section = t => console.log('\n[' + t + ']');
const note = t => console.log('    · ' + t);

/* 판이 굴러가는 동안 '지금 라운드의 가짜 자리'를 관측 창구에서 읽는다(하네스가 답을 따로 셈하지 않는다) */
const fakeIdxNow = A => { const s = A.fo.state(); return s.plan[s.roundIdx].fakeIndex; };
/* 가짜가 아닌 아무 칸 하나 */
const wrongIdxNow = A => { const f = fakeIdxNow(A); return f === 0 ? 1 : 0; };

/* 한 판(8라운드)을 정해진 대기 시간·프레임 수·오답 수로 끝까지 친다.
   ★반환값은 우리가 밀어 준 시간의 합이다 — 제품이 낸 기록과 이것을 대조한다. */
function playRun(A, opts){
  opts = opts || {};
  const waits = opts.waits || new Array(8).fill(300);
  const framesPerRound = opts.frames == null ? 0 : opts.frames;
  const wrongs = opts.wrongs || new Array(8).fill(0);
  let pushed = 0, wrongTotal = 0;
  for (let i = 0; i < waits.length; i++){
    const wait = waits[i];
    if (framesPerRound > 0){
      /* ★프레임 간격을 불규칙하게 준다 — 고른 간격이면 '프레임 수 = 시간' 인 구현도 통과한다 */
      let spent = 0;
      for (let f = 0; f < framesPerRound; f++){
        const step = (f === framesPerRound - 1) ? (wait - spent) : Math.round(wait / framesPerRound * (0.4 + (f % 3) * 0.45));
        A.advance(step); spent += step; A.frame();
      }
      if (spent < wait){ A.advance(wait - spent); spent = wait; }
    } else {
      A.advance(wait);
    }
    pushed += wait;
    for (let w = 0; w < (wrongs[i] || 0); w++){ A.tap(wrongIdxNow(A)); wrongTotal += 1; }
    A.tap(fakeIdxNow(A));
  }
  return { pushed, wrongTotal };
}

/* ============================================================ 1. 규격과 순수 함수 */
section('1. 규격과 순수 함수 — 총 기록은 시간의 합에 벌점을 더한 것이다');
{
  const A = boot();
  const C = A.fo.const();
  eq('한 판은 8라운드다', C.ROUNDS, 8);
  eq('차이축은 넷이다', C.AXES.slice().sort(), ['color','gap','rot','size']);
  eq('네 축이 두 번씩 쓰인다(8 = 4 x 2)', C.AXIS_REPEAT * C.AXES.length, C.ROUNDS);
  eq('격자 크기표가 라운드 수만큼 있다', C.GRIDS.length, C.ROUNDS);
  ok('격자는 줄지 않는다', C.GRIDS.every((g, i) => i === 0 || g >= C.GRIDS[i - 1]), JSON.stringify(C.GRIDS));
  ok('격자는 실제로 커진다(첫 라운드보다 마지막이 크다)', C.GRIDS[C.ROUNDS - 1] > C.GRIDS[0],
     `${C.GRIDS[0]} → ${C.GRIDS[C.ROUNDS - 1]}`);
  eq('오답 벌점은 2초다', C.PENALTY_MS, 2000);
  eq('기울기 축은 회전 대칭이 없는 도형을 쓴다(원이면 기울기가 안 보인다)', C.SHAPE_OF.rot, 'chev');

  /* ★총 기록 — 순수 함수. 하네스가 자기 셈으로 재검한다 */
  eq('오답이 없으면 총 기록은 라운드 시간의 합이다', A.fo.totalOf([1000, 2000, 500], 0), 3500);
  eq('오답 1회는 정확히 2초를 더한다', A.fo.totalOf([1000], 1) - A.fo.totalOf([1000], 0), 2000);
  eq('오답 3회는 정확히 6초를 더한다', A.fo.totalOf([1000], 3) - A.fo.totalOf([1000], 0), 6000);

  /* 차이의 크기 — amt 가 클수록(쉬울수록) 축마다 차이가 크다 */
  for (const ax of C.AXES){
    ok(`${ax}: 차이의 크기가 amt 를 따라 커진다`, A.fo.delta(ax, 1) > A.fo.delta(ax, 0),
       `delta(1)=${A.fo.delta(ax,1)} delta(0)=${A.fo.delta(ax,0)}`);
    ok(`${ax}: 가장 어려운 라운드에서도 차이가 0 이 아니다`, A.fo.delta(ax, 0) > 0, String(A.fo.delta(ax, 0)));
  }
}

/* ============================================================ 2. 판 — 격자 계약 */
section('2. ★격자 계약 — 다른 칸은 정확히 하나, 축은 하나');
{
  const A = boot();
  const C = A.fo.const();
  const FIELDS = ['dL','scale','rot','gap'];
  const AXIS_FIELD = { color:'dL', size:'scale', rot:'rot', gap:'gap' };
  /* 여러 날짜의 판을 한꺼번에 본다 — 하루치만 보면 그날 우연히 성립한 것을 계약으로 착각한다 */
  const keys = ['2026-09-04','2026-09-05','2026-12-31','2027-03-01','2026-08-23'].map(d => 'hanpango-daily-fake-one-' + d);
  let planCount = 0, roundCount = 0;
  let oneFake = true, oneAxis = true, shrink = true, grows = true, balance = true, inRange = true;
  const seen = [];
  for (const k of keys){
    const p = A.fo.plan(k);
    planCount++;
    if (p.length !== C.ROUNDS){ oneFake = false; break; }
    const bag = {};
    for (let i = 0; i < p.length; i++){
      const r = p[i];
      roundCount++;
      bag[r.axis] = (bag[r.axis] || 0) + 1;
      if (r.grid !== C.GRIDS[i]) grows = false;
      if (!(r.fakeIndex >= 0 && r.fakeIndex < r.cells)) inRange = false;
      if (i > 0 && !(p[i - 1].amt > r.amt)) shrink = false;
      /* 그려질 값이 나머지와 다른 칸이 정확히 하나이고, 그 하나가 그 라운드의 축 하나만 어긋난다 */
      const base = A.fo.specOf(r, r.fakeIndex === 0 ? 1 : 0);
      let diffCells = 0;
      for (let c = 0; c < r.cells; c++){
        const s = A.fo.specOf(r, c);
        const diffs = FIELDS.filter(f => s[f] !== base[f]);
        if (diffs.length > 0){
          diffCells++;
          if (c !== r.fakeIndex) oneFake = false;
          if (diffs.length !== 1 || diffs[0] !== AXIS_FIELD[r.axis]) oneAxis = false;
        }
      }
      if (diffCells !== 1) oneFake = false;
    }
    for (const a of C.AXES) if (bag[a] !== C.AXIS_REPEAT) balance = false;
    seen.push(p.map(r => r.axis).join(','));
  }
  ok('전제 — 판 5벌 · 라운드 40개를 실제로 셈했다(표본 0 은 통과가 아니다)',
     planCount === 5 && roundCount === 40, `판 ${planCount} · 라운드 ${roundCount}`);
  ok('격자에서 나머지와 다른 칸은 정확히 하나다(specOf 로 셈)', oneFake);
  ok('한 라운드는 차이축을 하나만 쓴다(가짜는 그 축 하나만 어긋난다)', oneAxis);
  ok('라운드가 오를수록 차이가 작아진다(amt 가 라운드마다 줄어든다)', shrink);
  ok('라운드가 오를수록 격자가 커진다', grows);
  ok('여덟 라운드에 네 축이 두 번씩 쓰인다', balance, seen[0]);
  ok('가짜 자리는 격자 안이다', inRange);
  note('축 순서 표본: ' + seen.slice(0, 3).join(' | '));
}

/* ============================================================ 3. 그려진 그림 — 화면에 실제로 들어간 것 */
section('3. ★그려진 그림 — 사용자가 보는 격자에서 다른 칸을 센다');
{
  const A = boot();
  A.dailyBtn();
  const seenAxes = new Set();
  let bad = 0, checked = 0;
  for (let round = 0; round < 8; round++){
    const st = A.fo.state();
    const r = st.plan[st.roundIdx];
    const html = A.fo.cellHtml();
    checked++;
    seenAxes.add(r.axis);
    if (html.length !== r.cells) bad++;
    const groups = new Map();
    for (let i = 0; i < html.length; i++){
      const g = groups.get(html[i]) || [];
      g.push(i); groups.set(html[i], g);
    }
    const singles = [...groups.values()].filter(g => g.length === 1);
    if (groups.size !== 2 || singles.length !== 1 || singles[0][0] !== r.fakeIndex) bad++;
    A.advance(100);
    A.tap(r.fakeIndex);
  }
  ok('전제 — 여덟 라운드의 그림을 모두 보았다', checked === 8, `본 라운드 ${checked}`);
  ok('격자에서 나머지와 다른 칸은 정확히 하나다(그려진 그림으로 셈)', bad === 0, `어긋난 라운드 ${bad}`);
  ok('한 판에서 네 축이 모두 나온다', seenAxes.size === 4, [...seenAxes].join(','));
  ok('칸 수가 격자 크기의 제곱이다(마지막 라운드까지)', A.fo.result() !== null);
}

/* ============================================================ 3-A. ★색상축 — 지각 균등 척도 위에서 움직인다 */
section('3-A. ★색상축 — 차이를 OKLCH L(지각 밝기)로 정의한다');
{
  const A = boot();
  const C = A.fo.const();
  /* ★이 축의 계약: 색이 움직이는 폭은 ΔL 하나로 적히고, 그 값에 테마를 가르는 분기가 없다.
     ★그래서 라이트·다크가 ★같은 ΔL 을 받는다 — RGB 배율은 두 테마에서 체감이 갈라진다.
     ★두 테마의 화면이 실제로 같은 차이로 보이는지(렌더된 색)는 이 하네스가 못 잰다 —
       실브라우저 측정으로 따로 증거를 남긴다(위 '못 보는 것' 고지와 같은 선). */
  const keys = ['2026-09-04','2026-09-05','2026-11-20'].map(d => 'hanpango-daily-fake-one-' + d);
  let seen = 0, badFake = 0, badPlain = 0;
  let minD = Infinity, maxD = 0;
  for (const k of keys){
    for (const r of A.fo.plan(k)){
      if (r.axis !== 'color') continue;
      seen++;
      const fake = A.fo.cellSvg(A.fo.specOf(r, r.fakeIndex));
      const plain = A.fo.cellSvg(A.fo.specOf(r, r.fakeIndex === 0 ? 1 : 0));
      const m = /color:oklch\(calc\(var\(--fig-l\) ([+-]) ([0-9.]+)\) var\(--fig-c\) var\(--fig-h\)\)/.exec(fake);
      if (!m) badFake++;
      else { const d = Number(m[2]); if (d < minD) minD = d; if (d > maxD) maxD = d; }
      /* 나머지 칸은 색을 얹지 않는다 — 칸이 가진 색(currentColor)을 그대로 쓴다 */
      if (/color:oklch/.test(plain)) badPlain++;
    }
  }
  ok('전제 — 색상축 라운드를 실제로 6개 보았다(표본 0 은 통과가 아니다)', seen === 6, `본 라운드 ${seen}`);
  ok('가짜 칸의 색은 같은 색의 L 만 옮긴 값이다(OKLCH)', badFake === 0, `어긋난 라운드 ${badFake}`);
  ok('나머지 칸에는 색을 따로 얹지 않는다(칸 색을 그대로 물려받는다)', badPlain === 0, `어긋난 라운드 ${badPlain}`);
  ok('ΔL 은 delta 표의 범위 안이다', seen > 0 && minD >= C.PENALTY_MS * 0 + A.fo.delta('color', 0) - 1e-9 &&
     maxD <= A.fo.delta('color', 1) + 1e-9, `ΔL ${minD.toFixed(4)}~${maxD.toFixed(4)} · 표 ${A.fo.delta('color',0)}~${A.fo.delta('color',1)}`);
  /* ★ΔL 이 0~1 밖으로 나가지 않는다 — 양 테마의 기준 L 에서 ±최대치를 더해도 잘리지 않아야 한다 */
  {
    const html = RAW;
    const lightL = Number((/--fig-l:([0-9.]+)/.exec(html) || [])[1]);
    const darkL = Number((/--fig-l:([0-9.]+)/g && [...html.matchAll(/--fig-l:([0-9.]+)/g)][1] || [])[1]);
    const dmax = A.fo.delta('color', 1);
    ok('전제 — 두 테마의 기준 L 을 소스에서 읽었다', isFinite(lightL) && isFinite(darkL),
       `light=${lightL} dark=${darkL}`);
    ok('두 테마의 기준 L 이 서로 다르다(다크가 더 밝다)', darkL > lightL, `${lightL} vs ${darkL}`);
    ok('양 테마에서 ±최대 ΔL 을 더해도 L 이 0~1 안에 남는다(잘리면 차이가 줄어든다)',
       lightL - dmax > 0 && lightL + dmax < 1 && darkL - dmax > 0 && darkL + dmax < 1,
       `ΔLmax=${dmax} · light ${(lightL-dmax).toFixed(3)}~${(lightL+dmax).toFixed(3)} · dark ${(darkL-dmax).toFixed(3)}~${(darkL+dmax).toFixed(3)}`);
    ok('색을 만드는 자리에 테마를 가르는 분기가 없다(두 테마가 같은 ΔL 을 받는다)',
       [...html.matchAll(/color:oklch\(calc\(var\(--fig-l\)/g)].length === 1 &&
       !/dark[\s\S]{0,80}dL|dL[\s\S]{0,80}prefers-color-scheme/.test(html));
  }
}

/* ============================================================ 3-B. ★색상축이 실제로 화면에 온전히 나오는가
   ★위 3-A 는 '차이를 ΔL 하나로 적었다' 까지만 증명한다. 적은 값이 화면에 그대로 나오는지는 별개다 —
     OKLCH 색이 sRGB 밖으로 나가면 브라우저가 감마 안으로 끌어당기면서 ★밝기 차가 줄어든다.
     그러면 두 테마가 같은 ΔL 을 받고도 다른 차이로 보인다(2026-09-04 실브라우저 실측:
     다크 --fig-c 0.14 에서 선언 0.1118 → 렌더 0.0991 · 라이트는 0.1108 · 어긋남 0.0117).
   ★그래서 여기서 OKLCH→sRGB 를 이 하네스가 ★독립 구현으로 계산해, 두 테마의 모든 밝기 단계가
     감마 안에 있는지(잘림 0)와 칸 바탕 대비 3:1 을 넘는지를 결정론으로 못박는다.
     실브라우저 픽셀 측정은 이 계산이 맞다는 것을 한 번 확인해 주는 증거이고, 되풀이 판정은 이 절이 한다. */
section('3-B. ★색상축 — 두 테마의 모든 밝기 단계가 sRGB 안에 있고 대비를 지킨다');
{
  const A = boot();
  const html = RAW;
  /* OKLCH → 선형 sRGB (하네스 독립 구현 · 제품은 이 계산을 갖고 있지 않다) */
  const oklchToLinear = (L, C, Hdeg) => {
    const h = Hdeg * Math.PI / 180;
    const a = C * Math.cos(h), b = C * Math.sin(h);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return [ 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s ];
  };
  const inGamut = rgb => rgb.every(v => v >= -0.0005 && v <= 1.0005);
  const relLum = rgb => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const hexLinear = hex => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
      const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
  };
  const contrast = (x, y) => { const a = relLum(x) + 0.05, b = relLum(y) + 0.05; return a > b ? a / b : b / a; };

  /* 두 테마의 값을 소스에서 읽는다 — 라이트가 먼저, 다크가 그다음이다(선언 순서) */
  const figs = [...html.matchAll(/--fig-l:([0-9.]+);\s*--fig-c:([0-9.]+);\s*--fig-h:([0-9.]+);/g)]
                 .map(m => ({ L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) }));
  const cells = [...html.matchAll(/--cell:(#[0-9a-fA-F]{6});/g)].map(m => m[1]);
  ok('전제 — 두 테마의 도형 색과 칸 바탕을 소스에서 읽었다(못 읽으면 판정 불가)',
     figs.length === 2 && cells.length === 2,
     `fig ${figs.length}벌 · cell ${cells.length}벌`);

  const dMin = A.fo.delta('color', 0), dMax = A.fo.delta('color', 1);
  const names = ['라이트', '다크'];
  let outOfGamut = [], lowContrast = [], worst = Infinity;
  for (let t = 0; t < Math.min(figs.length, cells.length); t++){
    const f = figs[t], bgLin = hexLinear(cells[t]);
    for (const d of [0, dMin, dMax]){
      for (const dir of (d === 0 ? [1] : [-1, 1])){
        const L = f.L + d * dir;
        const rgb = oklchToLinear(L, f.C, f.H);
        if (!inGamut(rgb)) outOfGamut.push(`${names[t]} L=${L.toFixed(3)}`);
        else {
          const c = contrast(rgb, bgLin);
          if (c < worst) worst = c;
          if (c < 3) lowContrast.push(`${names[t]} L=${L.toFixed(3)} 대비 ${c.toFixed(2)}`);
        }
      }
    }
  }
  ok('전제 — 두 테마 x 다섯 밝기 단계를 실제로 계산했다', figs.length === 2 && cells.length === 2);
  ok('색상축의 모든 밝기 단계가 sRGB 안에 있다(잘리면 렌더된 차이가 선언보다 줄어든다)',
     outOfGamut.length === 0, `감마 밖 ${outOfGamut.length}건: ${outOfGamut.join(' · ')}`);
  ok('색상축의 모든 밝기 단계가 칸 바탕 대비 3:1 을 넘는다',
     lowContrast.length === 0, `미달 ${lowContrast.length}건: ${lowContrast.join(' · ')}`);
  note(`ΔL 범위 ${dMin.toFixed(3)}~${dMax.toFixed(3)} · 최저 대비 ${isFinite(worst) ? worst.toFixed(2) : 'n/a'}:1`);
}

/* ============================================================ 4. ★시간 판정 — 프레임과 무관하다 */
section('4. ★시간 판정 — 프레임 간격이 기록을 바꾸지 않는다');
{
  const waits = [420, 380, 500, 640, 700, 810, 920, 1000];
  const runs = [];
  for (const nf of [0, 1, 7, 33]){
    const A = boot();
    A.dailyBtn();
    const got = playRun(A, { waits, frames: nf });
    const res = A.fo.result();
    runs.push({ nf, ms: res.ms, rounds: res.rounds.map(x => x.ms), pushed: got.pushed });
  }
  ok('전제 — 네 가지 프레임 수로 같은 판을 쳤다(0·1·7·33)', runs.length === 4);
  eq('프레임 수가 달라도 총 기록이 같다', runs.map(r => r.ms), new Array(4).fill(runs[0].ms));
  eq('프레임 수가 달라도 라운드별 시간이 같다',
     runs.map(r => JSON.stringify(r.rounds)), new Array(4).fill(JSON.stringify(runs[0].rounds)));
  eq('총 기록은 우리가 밀어 준 시간의 합과 정확히 같다', runs[0].ms, runs[0].pushed);
  eq('라운드별 시간은 우리가 밀어 준 대기와 정확히 같다', runs[0].rounds, waits);
  note(`총 기록 ${runs[0].ms}ms · 밀어 준 합 ${runs[0].pushed}ms`);

  /* ★그림이 흐른 시간을 따르는가 — 프레임 간격을 불규칙하게 주고 매번 대조한다 */
  {
    const A = boot();
    A.dailyBtn();
    let bad = 0, seen = 0;
    const t0 = A.now();
    for (const step of [3, 47, 5, 120, 9, 61, 8, 200, 17]){
      A.advance(step); A.frame(); seen++;
      if (Math.abs(A.fo.drawn() - (A.now() - t0)) > 1e-9) bad++;
    }
    ok('전제 — 프레임을 9번 돌렸다(불규칙 간격)', seen === 9, `돈 프레임 ${seen}`);
    ok('그린 시계가 매 프레임 흐른 시간과 같다(프레임 간격 불규칙)', bad === 0, `어긋난 프레임 ${bad}`);
  }
  /* ★기록이 '마지막으로 그린 시계'에서 나오면 안 된다 — 마지막 라운드에서 프레임을 한 번도 돌리지 않는다 */
  {
    const A = boot();
    A.dailyBtn();
    for (let i = 0; i < 7; i++){ A.advance(200); A.frame(); A.tap(fakeIdxNow(A)); }
    A.advance(1500);                       /* ★여기서는 한 프레임도 돌리지 않는다 */
    const drawnBefore = A.fo.drawn();
    A.tap(fakeIdxNow(A));
    const res = A.fo.result();
    ok('전제 — 마지막 라운드에서 그림이 낡아 있다(1,500ms 만큼)',
       Math.abs((7 * 200) - drawnBefore) < 1e-9, `그린 값 ${drawnBefore} · 실제 ${7 * 200 + 1500}`);
    eq('총 기록은 마지막으로 그린 시계가 아니라 누른 순간의 도장에서 나온다', res.ms, 7 * 200 + 1500);
  }
}

/* ============================================================ 5. ★시드 결정론 */
section('5. ★시드 결정론 — 같은 날은 같은 판, 플레이는 난수를 안 쓴다');
{
  const A = boot();
  const k = A.fo.seedKey('2026-09-04T09:00:00');
  eq('씨앗 열쇠는 날짜만으로 만들어진다', k, 'hanpango-daily-fake-one-2026-09-04');
  eq('같은 날의 다른 시각도 같은 열쇠를 준다', A.fo.seedKey('2026-09-04T23:59:00'), k);
  eq('같은 씨앗은 같은 판을 준다(8라운드 전체)',
     JSON.stringify(A.fo.plan(k)), JSON.stringify(A.fo.plan(k)));
  ok('다른 날은 다른 판을 준다',
     JSON.stringify(A.fo.plan(k)) !== JSON.stringify(A.fo.plan(A.fo.seedKey('2026-09-05T09:00:00'))));
  eq('같은 씨앗의 난수 흐름이 같다', A.fo.seedDraws(k, 12), A.fo.seedDraws(k, 12));

  /* ★플레이 행동은 난수를 한 번도 소비하지 않는다 — 오답까지 섞어 끝까지 친다 */
  {
    const B = boot();
    B.dailyBtn();
    B.resetRand();
    const got = playRun(B, { waits: new Array(8).fill(250), frames: 3, wrongs: [0,2,0,1,0,0,3,0] });
    ok('전제 — 이 판에서 오답을 6회 눌렀다', got.wrongTotal === 6, `오답 ${got.wrongTotal}`);
    ok('전제 — 판이 끝났다(결과가 있다)', !!B.fo.result());
    eq('플레이 행동은 난수를 한 번도 소비하지 않는다(오늘의 도전)', B.rand(), 0);
    B.langBtn();
    eq('언어를 바꿔도 난수를 쓰지 않는다', B.rand(), 0);
  }
  /* 자유 모드는 판을 짤 때 딱 한 번만 뽑는다(원천만 다르다) */
  {
    const C = boot();
    C.resetRand();
    C.startBtn();
    const after = C.rand();
    playRun(C, { waits: new Array(8).fill(120), frames: 2 });
    ok('자유 모드는 판을 짤 때 난수를 한 번만 뽑는다', after === 1, `판 짤 때 ${after}회`);
    eq('그 뒤 플레이는 난수를 더 쓰지 않는다', C.rand(), after);
  }
}

/* ============================================================ 6. ★오답과 벌점 */
section('6. ★오답 — 2초를 더하고 라운드는 넘어가지 않는다');
{
  {
    const A = boot();
    A.dailyBtn();
    const before = A.fo.state();
    A.advance(100);
    A.tap(wrongIdxNow(A));
    const after = A.fo.state();
    eq('오답을 눌러도 라운드는 넘어가지 않는다', after.roundIdx, before.roundIdx);
    eq('오답 수가 즉시 1 이 된다(타이머를 돌리지 않았다)', after.wrong, 1);
    eq('타이머를 한 번도 돌리지 않아도 오답 벌점이 즉시 확정된다',
       A.fo.drawn(), 100 + 2000);
    eq('잘못 누른 칸에만 표시가 붙는다', A.fo.badIdx(), [wrongIdxNow(A)]);
    eq('전제 — 아직 돌지 않은 타이머가 없다(연출에 기대지 않았다)', A.pendingTimers(), 0);
  }
  /* 오답 수를 바꿔 가며 총 기록을 대조한다 — 벌점이 실제로 2초씩 붙는지 */
  {
    const waits = new Array(8).fill(200);
    const rows = [];
    for (const wrongs of [[0,0,0,0,0,0,0,0], [1,0,0,0,0,0,0,0], [0,3,0,0,2,0,0,1]]){
      const A = boot();
      A.dailyBtn();
      const got = playRun(A, { waits, frames: 2, wrongs });
      const r = A.fo.result();
      rows.push({ n: got.wrongTotal, ms: r.ms, want: got.pushed + 2000 * got.wrongTotal, wrong: r.wrong });
    }
    ok('전제 — 오답 0·1·6 세 판을 쳤다', rows.map(r => r.n).join(',') === '0,1,6', rows.map(r => r.n).join(','));
    eq('오답 1회는 총 기록에 정확히 2초를 더한다', rows.map(r => r.ms), rows.map(r => r.want));
    eq('결과에 적힌 오답 수가 실제로 누른 횟수와 같다', rows.map(r => r.wrong), rows.map(r => r.n));
    eq('오답 6회는 12초를 더한다', rows[2].ms - (rows[2].want - 12000), 12000);
  }
  /* ★반대 방향 — 벌점이 과잉이 아님을 함께 보인다(오답 0 인 판에는 한 푼도 붙지 않는다) */
  {
    const A = boot();
    A.dailyBtn();
    const got = playRun(A, { waits: new Array(8).fill(150), frames: 1 });
    eq('오답이 없으면 벌점은 0 이다', A.fo.result().penaltyMs, 0);
    eq('오답이 없으면 총 기록은 시간의 합 그대로다', A.fo.result().ms, got.pushed);
  }
}

/* ============================================================ 7. ★논리 즉시 확정 */
section('7. ★논리 즉시 확정 — 연출을 기다리지 않는다');
{
  const A = boot();
  A.dailyBtn();
  /* 시간을 한 톨도 흘리지 않고, 프레임·타이머도 한 번도 돌리지 않고 연속으로 친다 */
  for (let i = 0; i < 8; i++){ A.tap(wrongIdxNow(A)); A.tap(fakeIdxNow(A)); }
  const r = A.fo.result();
  ok('타이머를 한 번도 돌리지 않아도 여덟 라운드가 끝난다', !!r && r.rounds.length === 8,
     r ? `라운드 ${r.rounds.length}` : '결과 없음');
  eq('그 판의 총 기록은 벌점뿐이다(흐른 시간 0 · 오답 8)', r ? r.ms : -1, 8 * 2000);
  eq('아직 돌지 않은 타이머가 없다', A.pendingTimers(), 0);
}

/* ============================================================ 8. 저장 레코드와 하루 한 번 */
section('8. 저장 — 「오늘의 한판」 어댑터가 읽을 수 있는 형태인가');
{
  {
    const A = boot();
    A.dailyBtn();
    playRun(A, { waits: new Array(8).fill(250), frames: 1, wrongs: [0,1,0,0,0,0,0,0] });
    const raw = A.store.getItem('fo.daily');
    ok('오늘의 도전 결과가 fo.daily 에 저장된다', !!raw);
    const rec = JSON.parse(raw || '{}');
    ok('저장 레코드에 날짜가 있다', typeof rec.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rec.date), rec.date);
    ok('저장 레코드에 회차가 있다', typeof rec.no === 'number' && rec.no > 0, String(rec.no));
    ok('★어댑터가 읽는 result.ms 가 수치다', rec.result && typeof rec.result.ms === 'number' && isFinite(rec.result.ms),
       JSON.stringify(rec.result && rec.result.ms));
    eq('저장된 총 시간이 결과 화면의 값과 같다', rec.result.ms, A.fo.result().ms);
    eq('저장된 오답 수가 결과와 같다', rec.result.wrong, A.fo.result().wrong);
  }
  /* ★하루 한 번 — 두 번째 완주가 그날 기록을 덮지 않는다 */
  {
    const A = boot();
    A.dailyBtn();
    playRun(A, { waits: new Array(8).fill(200), frames: 1 });
    const first = JSON.parse(A.store.getItem('fo.daily')).result.ms;
    /* ★'다시 하기' 는 오늘의 도전을 마친 뒤에는 자유 모드로 간다 — 그것만으로는
       '두 번째 도전이 그날 기록을 덮는가' 를 재지 못한다(그 길이 안 열린다).
       그래서 시험 다리로 두 번째 도전을 강제로 연다 — 사용자가 페이지를 다시 열어
       오늘의 도전을 한 번 더 치는 경로와 같다. */
    A.againBtn();
    eq('오늘의 도전을 마치면 다시 하기는 자유 모드로 간다', A.fo.state().mode, 'free');
    A.t.begin('daily', A.now());
    playRun(A, { waits: new Array(8).fill(900), frames: 1 });
    const second = JSON.parse(A.store.getItem('fo.daily')).result.ms;
    ok('전제 — 두 번째 도전은 첫 판과 다른 시간이 나왔다(덮였다면 값이 달라진다)',
       (8 * 900) !== first && A.fo.result().ms === 8 * 900,
       `첫 판 ${first} · 두 번째 판의 결과 ${A.fo.result().ms}`);
    eq('오늘의 도전은 하루 한 번이다(두 번째 완주가 기록을 덮지 않는다)', second, first);
  }
  /* ★자유 모드 최고 기록은 더 짧을 때만 바뀐다 */
  {
    const A = boot();
    A.startBtn();
    playRun(A, { waits: new Array(8).fill(500), frames: 1 });
    const b1 = A.fo.best().ms;
    A.againBtn();
    playRun(A, { waits: new Array(8).fill(900), frames: 1 });   /* 더 느린 판 */
    const b2 = A.fo.best().ms;
    A.againBtn();
    playRun(A, { waits: new Array(8).fill(120), frames: 1 });   /* 더 빠른 판 */
    const b3 = A.fo.best().ms;
    eq('전제 — 첫 판이 최고 기록이 된다', b1, 8 * 500);
    eq('자유 모드 최고 기록은 더 짧은 시간일 때만 바뀐다', b2, b1);
    eq('더 짧은 판이 나오면 최고 기록이 바뀐다', b3, 8 * 120);
  }
  /* 스트릭 — 끊기면 1, 이어지면 +1 */
  {
    const pad2s = n => String(n).padStart(2, '0');
    const keyOf = d => `${d.getFullYear()}-${pad2s(d.getMonth() + 1)}-${pad2s(d.getDate())}`;
    const daysAgo = n => { const t = new Date(); t.setDate(t.getDate() - n); return keyOf(t); };

    const cut = makeStore();
    cut.setItem('fo.streak', JSON.stringify({ last: daysAgo(3), n: 5 }));
    const A = boot({ store: cut }); A.dailyBtn();
    playRun(A, { waits: new Array(8).fill(120), frames: 1 });
    ok('날짜가 끊기면 스트릭이 1 로 리셋된다', A.fo.daily().streak === 1,
       `스트릭 ${A.fo.daily().streak} · 저장된 앞 기록 ${daysAgo(3)} 5일`);

    const cont = makeStore();
    cont.setItem('fo.streak', JSON.stringify({ last: daysAgo(1), n: 5 }));
    const B = boot({ store: cont }); B.dailyBtn();
    playRun(B, { waits: new Array(8).fill(120), frames: 1 });
    ok('어제 이어서 하면 스트릭이 1 늘어난다', B.fo.daily().streak === 6, `스트릭 ${B.fo.daily().streak}`);
  }
}

/* ============================================================ 9. 저장 키 — 쓰는 키가 정확히 무엇인가 */
section('9. 저장 키 — 개인정보처리방침이 적어야 하는 목록');
{
  const A = boot();
  A.dailyBtn();
  playRun(A, { waits: new Array(8).fill(120), frames: 1 });
  A.langBtn();
  A.el('btnSound').onclick();
  A.againBtn();
  playRun(A, { waits: new Array(8).fill(120), frames: 1 });
  const keys = A.store.keys().sort();
  eq('쓰는 키는 fo.* 넷과 사이트 공용 bp.lang 뿐이다', keys,
     ['bp.lang','fo.best','fo.daily','fo.sound','fo.streak']);
}

/* ============================================================ 10. 화면·언어 */
section('10. 화면·언어 — 진행 중 내용이 안내 문구로 덮이지 않는가');
{
  const A = boot();
  A.dailyBtn();
  A.advance(1234); A.frame();
  A.tap(wrongIdxNow(A));                        /* 눌린 자리 표시를 남긴다 */
  const clockBefore = A.txt('clock');
  const htmlBefore = JSON.stringify(A.fo.cellHtml());
  const badBefore = A.fo.badIdx();
  const axisBefore = A.txt('axisChip');
  ok('전제 — 진행 중이고 시계에 숫자가 적혀 있다',
     A.fo.state().phase === 'running' && /^[0-9]+\.[0-9]{2}$/.test(clockBefore), clockBefore);
  ok('전제 — 눌린 자리 표시가 하나 있다', badBefore.length === 1, JSON.stringify(badBefore));
  A.langBtn();
  eq('언어가 바뀌었다', A.fo.lang(), 'en');
  eq('진행 중 언어를 바꿔도 시계 숫자가 안내 문구로 덮이지 않는다', A.txt('clock'), clockBefore);
  eq('진행 중 언어를 바꿔도 눌린 자리 표시가 사라지지 않는다', A.fo.badIdx(), badBefore);
  eq('진행 중 언어를 바꿔도 격자의 그림은 그대로다', JSON.stringify(A.fo.cellHtml()), htmlBefore);
  ok('딱지의 축 이름은 새 언어로 바뀐다', A.txt('axisChip') !== axisBefore,
     `${axisBefore} → ${A.txt('axisChip')}`);
  ok('칸의 낭독 이름도 새 언어로 바뀐다',
     /^row \d+, column \d+$/.test(A.el('board').children[0].getAttribute('aria-label')),
     A.el('board').children[0].getAttribute('aria-label'));
  /* 시계를 계속 밀어도 값이 이어진다(언어 전환이 원점을 흔들지 않는다) */
  A.advance(100); A.frame();
  ok('언어를 바꾼 뒤에도 시계가 이어서 흐른다', A.fo.drawn() > 1234 + 2000, String(A.fo.drawn()));
}

/* ============================================================ 11. 입력 — 키보드 */
section('11. 입력 — 키보드가 손가락과 같은 자리를 잰다');
{
  {
    const A = boot();
    A.dailyBtn();
    A.advance(300);
    A.resetPd();
    A.key(fakeIdxNow(A), 'Enter');
    eq('Enter 로도 라운드가 넘어간다', A.fo.state().roundIdx, 1);
    eq('Enter 로 눌렀을 때 preventDefault 가 호출된다', A.pd(), 1);
    eq('키로 잰 시간이 손가락과 같은 자리다', A.fo.state().rounds[0].ms, 300);
  }
  {
    const A = boot();
    A.dailyBtn();
    A.key(fakeIdxNow(A), 'Enter', { repeat: true });
    eq('누르고 있어서 반복 발화된 키 입력은 무시된다', A.fo.state().roundIdx, 0);
    A.key(fakeIdxNow(A), 'Enter');
    eq('반복이 아닌 첫 키 입력은 라운드를 넘긴다', A.fo.state().roundIdx, 1);
  }
  {
    const A = boot();
    A.dailyBtn();
    A.resetPd();
    A.focusCell(0);
    A.key(0, 'ArrowRight');
    ok('화살표로 옆 칸에 초점이 옮겨간다', A.focused() === A.el('board').children[1]);
    ok('화살표는 기본동작을 막는다(화면이 딸려 스크롤되지 않는다)', A.pd() === 1, `preventDefault ${A.pd()}회`);
    A.focusCell(0);
    A.key(0, 'ArrowLeft');
    ok('줄의 왼쪽 끝에서 왼쪽 화살표는 넘어가지 않는다', A.focused() === A.el('board').children[0]);
    A.resetPd();
    A.key(0, 'a');
    ok('다른 키는 기본동작을 막지 않는다', A.pd() === 0, `preventDefault ${A.pd()}회`);
  }
  /* ★도장 — 정상 도장만 보내면 stampOf 의 물러섬 분기가 시험에서 한 번도 열리지 않는다 */
  {
    const A = boot(); A.dailyBtn();
    A.advance(300);
    A.tap(fakeIdxNow(A), { timeStamp: A.now() + 5000 });      /* 5,000ms 어긋난 도장 */
    const r = A.fo.state().rounds[0] || null;
    ok('전제 — 라운드가 확정됐다(도장 검사의 잴 대상)', !!r, `확정 ${A.fo.state().rounds.length}`);
    ok('허용오차를 벗어난 도장은 믿지 않고 지금 시각으로 물러선다',
       !!r && Math.abs(r.ms - 300) < 1e-9,
       r ? `라운드 시간 ${r.ms} (기대 300 · 도장을 믿었다면 5300)` : '★잴 대상 0 — 판정 불가는 통과가 아니다');
    note(`허용오차 ${A.fo.const().STAMP_TOLERANCE_MS}ms`);

    const B = boot(); B.dailyBtn();
    B.advance(250); B.tap(fakeIdxNow(B), { timeStamp: undefined });
    ok('도장이 없으면 지금 시각으로 잰다', Math.abs(B.fo.state().rounds[0].ms - 250) < 1e-9,
       String(B.fo.state().rounds[0].ms));
    const C = boot(); C.dailyBtn();
    C.advance(120); C.tap(fakeIdxNow(C), { timeStamp: NaN });
    ok('NaN 도장은 믿지 않는다', Math.abs(C.fo.state().rounds[0].ms - 120) < 1e-9,
       String(C.fo.state().rounds[0].ms));
    /* ★반대 방향 — 허용오차 안쪽의 도장은 그대로 쓴다(그래야 이 가드가 과잉이 아니다) */
    const D = boot(); D.dailyBtn();
    D.advance(400); D.tap(fakeIdxNow(D), { timeStamp: D.now() - 40 });
    ok('허용오차 안쪽의 도장은 그대로 쓴다(입력 지연이 기록에 안 섞인다)',
       Math.abs(D.fo.state().rounds[0].ms - 360) < 1e-9,
       `${D.fo.state().rounds[0].ms} (기대 360 = 400-40)`);
  }
  /* 오른쪽 버튼 클릭은 세지 않는다 */
  {
    const A = boot(); A.dailyBtn();
    A.tap(wrongIdxNow(A), { button: 2 });
    eq('오른쪽 버튼으로 누른 것은 세지 않는다', A.fo.state().wrong, 0);
  }
}

/* ============================================================ 12. 창(오버레이)과 inert */
section('12. 창 — 열리면 창 밖을 가둔다');
{
  const A = boot();
  const names = A.outsideNames();
  ok('전제 — 스텁이 창 밖 요소를 6종 제공한다(없으면 이 절은 판정 불가)',
     names.length === 6, `제공 ${names.length}종: ${names.join(',')}`);
  ok('전제 — 시작 창이 떠 있다', A.fo.shown('start'));
  ok('창이 열리면 창 밖 요소에 inert 가 붙는다',
     names.length === 6 && names.every(n => A.inertOf(n) === true),
     names.map(n => n + '=' + A.inertOf(n)).join(' '));
  A.dailyBtn();
  ok('창이 닫히면 inert 가 걷힌다',
     names.length === 6 && names.every(n => A.inertOf(n) === false),
     names.map(n => n + '=' + A.inertOf(n)).join(' '));
  ok('판을 시작하면 첫 칸에 초점이 간다(키보드로 바로 이어서 할 수 있다)',
     A.focused() === A.el('board').children[0]);
  playRun(A, { waits: new Array(8).fill(120), frames: 1 });
  ok('결과 창이 뜨면 다시 창 밖을 가둔다',
     A.fo.shown('over') && names.every(n => A.inertOf(n) === true),
     `over=${A.fo.shown('over')} · ` + names.map(n => n + '=' + A.inertOf(n)).join(' '));
  ok('결과 창이 떠 있는 동안에는 칸을 눌러도 반응하지 않는다', (() => {
    const before = JSON.stringify(A.fo.state().rounds);
    try { A.tap(0); } catch(e){ return true; }
    return JSON.stringify(A.fo.state().rounds) === before;
  })());
}

/* ============================================================ 13. 결과·공유 문안 */
section('13. 결과·공유 — 수치가 글자로 담기는가');
{
  const A = boot();
  A.dailyBtn();
  const got = playRun(A, { waits: new Array(8).fill(430), frames: 2, wrongs: [0,0,2,0,0,0,0,0] });
  const r = A.fo.result();
  const marks = A.fo.marks();
  eq('판별 줄이 라운드 수만큼 있다', marks.split('\n').length, 8);
  ok('판별 줄에 라운드별 시간이 숫자로 적힌다', /0\.43/.test(marks), marks.split('\n')[0]);
  ok('오답이 난 라운드에는 오답 수가 적힌다', /오답 2|2 miss/.test(marks),
     marks.split('\n')[2]);
  const share = A.fo.shareText();
  ok('공유 문구에 회차가 들어간다', share.indexOf('#' + r.no) >= 0, share.split('\n')[0]);
  ok('공유 문구에 총 시간이 들어간다', share.indexOf(A.fo.fmtSec(r.ms)) >= 0);
  ok('공유 문구가 주소로 끝난다', /https:\/\/hanpango\.com\/fake-one\/$/.test(share));
  eq('결과 화면의 벌점 칸이 실제 벌점과 같다', A.txt('nPenalty'), A.fo.fmtSec(2 * 2000));
  eq('결과 화면의 오답 칸이 실제 오답 수와 같다', A.txt('nWrong'), String(got.wrongTotal));
  eq('결과 화면의 라운드 칸이 8 이다', A.txt('nRounds'), '8');
}

/* ============================================================ 14. 정적 검사 — 소스에 대한 계약 */
section('14. 정적 검사 — 소스에 대한 계약');
{
  const html = RAW;
  /* ★마크업이 쓰는 키가 두 언어 표에 다 있는가 — 없으면 그 요소는 ★기본 한국어 HTML 이 그대로 남는다.
     just-right 의 EN 화면에 한국어가 남아 있던 것이 이 검사가 없어서 새어 나온 자리다. */
  {
    const usedKeys = [...new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]))];
    /* ★표는 실행해서 읽는다(정규식 파싱은 한 줄 여러 키·문장 속 콜론에서 어긋난다) */
    const K = boot().t.i18nKeys();
    const ko = new Set(K.ko), en = new Set(K.en);
    ok('전제 — ko·en 두 i18n 표를 읽었다(못 읽으면 판정 불가)', ko.size > 0 && en.size > 0,
       `ko=${ko.size} en=${en.size}`);
    ok('전제 — 마크업이 실제로 data-i18n 키를 쓰고 있다(0개면 위 검사가 공허하다)',
       usedKeys.length >= 30, `쓰인 키 ${usedKeys.length}`);
    const missKo = usedKeys.filter(k => !ko.has(k));
    const missEn = usedKeys.filter(k => !en.has(k));
    ok('마크업의 data-i18n 키가 ko·en 두 표에 모두 있다',
       missKo.length === 0 && missEn.length === 0,
       `쓰인 키 ${usedKeys.length} · ko 누락 [${missKo}] · en 누락 [${missEn}]`);
    /* ★두 표의 키 집합 자체가 같아야 한다 — 마크업이 아직 안 쓰는 키가 한쪽에만 있으면
       그 키를 쓰는 날 EN 화면이 조용히 한국어로 남는다(닫힌 목록은 제품이 자라면 썩는다). */
    const onlyKo = K.ko.filter(k => !en.has(k)), onlyEn = K.en.filter(k => !ko.has(k));
    ok('ko·en 두 표의 키 집합이 완전히 같다',
       onlyKo.length === 0 && onlyEn.length === 0, `ko 에만 [${onlyKo}] · en 에만 [${onlyEn}]`);
    note(`data-i18n 키 ${usedKeys.length}개 · ko 표 ${ko.size}항목 · en 표 ${en.size}항목`);
  }
  ok('data-i18n 이 런타임 갱신 요소에 붙지 않았다(시계·딱지·결과 수치)',
     !/id="(clock|axisChip|roundChip|penaltyLine|marks|finalBig|finalWrongLine|nRounds|nWrong|nPenalty|finalSub|dailyHint|bestNow|modeNow|streakNowEl)"[^>]*data-i18n/.test(html) &&
     !/data-i18n[^>]*id="(clock|axisChip|roundChip|penaltyLine|marks|finalBig|finalWrongLine|nRounds|nWrong|nPenalty|finalSub|dailyHint|bestNow|modeNow|streakNowEl)"/.test(html));
  ok('전역 유틸 이름(.hint)을 쓰지 않는다 — 상태 이름과 겹치는 자리를 만들지 않았다',
     !/class="[^"]*\bhint\b/.test(html), '클래스 hint 사용');
  ok('게임 고유 클래스에 fo- 접두가 붙어 있다',
     /class="fo-board"/.test(html) && /class="fo-clock"/.test(html) && /'fo-cell'/.test(html));
  ok('칸은 진짜 button 이다(Tab·낭독기가 그대로 쓴다)', /createElement\('button'\)/.test(html));
  ok('svg 를 block 으로 못박았다(inline 기본값은 칸 안에서 줄바꿈 여백을 만든다)',
     /\.fo-cell svg\{display:block/.test(html));
  ok('hp-stats.js 를 defer 로 싣는다', /<script src="\/js\/hp-stats\.js" defer><\/script>/.test(html));
  ok('시작 화면에 판수 줄이 있다(처음엔 hidden)',
     /<p class="hp-stat" data-hp-line hidden data-i18n="statPlays">/.test(html));
  ok('hidden 가드가 있다', /\.hp-stat\[hidden\]\s*{[^{}]*display\s*:\s*none\s*!important[^{}]*}/.test(html));
  const st = [...html.matchAll(/statPlays:'([^']*)'/g)].map(m => m[1]);
  ok('statPlays 문안이 ko·en 두 곳에 있다', st.length === 2, String(st.length));
  ok('한국어 판수 문안이 다수파 꼴이다',
     /^오늘 <b data-hp="plays\.fake-one\.today">[^<]*<\/b>판 · 누적 <b data-hp="plays\.fake-one\.total">[^<]*<\/b>판$/.test(st[0] || ''), st[0]);
  ok('영어 판수 문안이 다수파 꼴이다',
     /^<b data-hp="plays\.fake-one\.today">[^<]*<\/b> today · <b data-hp="plays\.fake-one\.total">[^<]*<\/b> all-time$/.test(st[1] || ''), st[1]);
  const gaStarts = [...html.matchAll(/ga\('game_start'/g)].length;
  const paired = [...html.matchAll(/ga\('game_start', \{ game: GA_GAME(?![A-Za-z0-9_$])[^;\n]*\);(\s*\/\*[^*]*\*\/)?\s*\n\s*if \(window\.hpHit\) window\.hpHit\('play', GA_GAME\);/g)].length;
  ok(`hpHit('play') 가 시작 지점 ${gaStarts}곳 전부에 짝지어 있다`, paired === gaStarts && gaStarts > 0, `짝 ${paired} / 시작 ${gaStarts}`);
  const playHits = [...html.matchAll(/window\.hpHit\('play', GA_GAME\)/g)].length;
  ok('hpHit 호출이 시작 지점 수와 같다(떠도는 호출 0)', playHits === gaStarts, `호출 ${playHits} / 시작 ${gaStarts}`);
  ok('언어를 바꾼 뒤 숫자를 다시 채운다',
     /localStorage\.setItem\('bp\.lang', lang\);[\s\S]{0,240}if \(window\.hpStats\) window\.hpStats\(\)/.test(html));
  ok('검증 창구에 상태를 바꾸는 명령이 없다(관측 전용)',
     !/__fo\s*=\s*{[\s\S]*?\bbegin\s*:/.test(html) && !/__fo\s*=\s*{[\s\S]*?\btap\s*:/.test(html) &&
     !/__foTest/.test(html), '배포본에 시험 다리가 남아 있다');
  ok('외부 스크립트는 사이트 공용 셋뿐이다(게임 로직은 외부 의존 0)',
     [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1])
       .every(u => /googlesyndication|googletagmanager|^\/js\/hp-stats\.js$/.test(u)));
  ok('칸의 움직임을 CSS 애니메이션으로 되돌릴 수 있게 해 두었다(감속 선호 존중)',
     /prefers-reduced-motion[\s\S]{0,320}\.fo-cell\.bad\{animation:none\}/.test(html));
}

/* ============================================================ 결과 */
console.log(`\n${'='.repeat(56)}`);
console.log(`PASS ${pass} · FAIL ${fail}`);
if (fail){ console.log('실패한 검사:'); for (const f of failures) console.log('  - ' + f); }
if (MUTATION){
  const c = MUTATIONS[MUTATION].catcher;
  const caught = failures.includes(c);
  console.log(`[mutate] ${MUTATION} — 지목한 검사 "${c}" 가 ${caught ? '붉었다(귀속 일치)' : '★붉지 않았다(무임승차 또는 미탐지)'}`);
}
process.exit(fail ? 1 : 0);
