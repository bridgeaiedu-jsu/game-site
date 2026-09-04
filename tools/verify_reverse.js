/* 반대로 눌러!(/reverse/) 검증기 — worker(238) · 2026-09-04 · 티켓 T0904-reverse
 *
 * 앞선 검증기(verify_fakeone.js·verify_justright.js)의 방식을 그대로 따른다:
 *   · 인라인 스크립트를 DOM 스텁 위에서 실제로 구동한다(vm)
 *   · 상태를 바꾸는 명령은 **제품 파일에 두지 않고** 여기서 메모리 위에만 덧붙인다(test bridge)
 *   · 판정은 배포되는 관측 창구(window.__rv)와 이 파일이 따로 셈한 값의 대조로 한다
 *   · 누르는 것은 다리가 아니라 **진짜 입력 사건**(pointerdown·keydown)으로 두드린다
 *
 * 중점 검사(티켓이 못박은 것 + ★fake-one 라운드에서 뚫렸던 두 각을 처음부터)
 *   ★① 반대 계약 — 눌러야 하는 칸이 지시가 가리키는 칸의 반대인가(네 축 전부).
 *   ★② 시간 판정 — 프레임 간격을 바꿔도 같은 도장이면 같은 판정인가. 지시가 저절로 넘어간 것이
 *       ★마감 시각으로 확정되는가(그것을 알아챈 프레임 시각이 아니라). 30초 종료가 못박혀 있는가.
 *   ★③ 간격 — 정답마다만 짧아지고 ★바닥 아래로는 안 내려가는가(운이 아니라 실력이 되게).
 *   ★④ 점수 — 정답 +1 · 오답 -1(0 바닥) · 놓침 감점 0.
 *   ★⑤ 일일 결정성(시각 축) — 가짜 벽시계를 크게 움직여도 같은 씨앗이 같은 판을 주는가.
 *       (같은 순간 두 번 물어 같은 것은 씨앗에 시각이 섞여 있어도 성립한다 — 그 그물로는 못 잡는다)
 *   ★⑥ 터치 목표 — 360px 에서 답 칸이 50px 하한을 지키는가. 숫자를 박지 않고 CSS 치수에서
 *       다시 셈해 판정한다(실브라우저 실측으로 그 셈을 보정한다).
 *   ★⑦ 색맹 안전 — 두 칸이 색이 아니라 글자와 모양으로 서로 다른가.
 *
 * ★이 하네스가 못 보는 것(정직 고지)
 *   · 레이아웃을 계산하지 않는다 — '요소가 0×0 으로 접힘' 은 실브라우저에서만 보인다.
 *   · CSS 를 파싱하지 않는다(치수 몇 개를 정규식으로 읽을 뿐이다) — 색·대비의 실제 렌더는 못 잰다.
 *   · svg 를 그리지 않는다 — 두 모양이 '사람 눈에' 구별되는지는 문자열 차이까지만 증명한다.
 *
 * 사용법: node verify_reverse.js [--html <경로>] [--mutate <이름>] [--list-mutations]
 * 종료코드: 0 = 전부 PASS · 1 = 하나라도 FAIL · 2 = 뮤테이션 주입 실패·하네스 이상(탐지 아님)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
/* 기본 대상은 **이 도구가 놓인 저장소의 /reverse/index.html** 이다 — 절대경로를 박아 두면
   worktree 를 갈아탈 때 조용히 남의 파일을 재게 된다. */
const HTML = argOf('--html', path.join(__dirname, '..', 'reverse', 'index.html'));
const MUTATION = argOf('--mutate', null);

/* ------------------------------------------------------- 뮤테이션(검출력 자기시험)
   ★각 뮤테이션은 **어느 검사가 잡아야 하는지**를 함께 적는다 — 다른 검사가 우연히 깨져서 난
   빨강은 무임승차다(장기기억 mutation-must-name-the-check-that-catches-it).
   ★'주입 실패'와 '결함 탐지'를 종료코드로 가른다(2 = 주입 실패 · 1 = 탐지).
   ★scope:'html' 은 스크립트 밖(CSS 토큰 등)을 겨냥한다 — 문서 전체에 주입한다.
   ★검사 이름에 ' — '(상세 구분자)를 쓰지 않는다 — 러너의 파서가 이름을 잘라 읽는다. */
const MUTATIONS = {
  /* ① 눌러야 하는 칸을 지시 그대로로 바꾼다 = 이 게임이 이 게임이 아니게 된다 */
  'correct-is-natural': {
    catcher: '눌러야 하는 칸은 지시가 가리키는 칸의 반대다(네 축 전부)',
    from: 'const correctIndexOf = p => 1 - p.variant;',
    to:   'const correctIndexOf = p => p.variant;'
  },
  /* ①-A ★판정이 도장을 버리고 '지금'을 쓴다 = 시계는 멀쩡한데 판정만 프레임 시각을 탄다.
        master(236) 외부 뮤테이션 R1 의 후속이다. R1 은 nowMs 를 뿌리째 프레임 누적으로 바꿔
        검사의 ★전제부터 깨뜨렸고(놓침 0), 그래서 rc=2 판정불가로 멈췄다 — fail-closed 라 안전하지만
        '프레임 독립 판정' 을 ★지목해 증명하지는 못했다. 그 좁은 자리를 이 뮤테이션이 겨냥한다:
        시계(nowMs)도 그리기도 그대로 두고, 누른 순간의 도장만 버리게 한다.
        브라우저는 우리 코드가 돌기 전에 사건에 도장을 찍으므로, 도장을 버리면 그 사이의 지연이
        통째로 기록에 섞인다(화면이 느릴수록 커진다). */
  'judge-ignores-stamp': {
    catcher: '허용오차 안쪽의 도장은 그대로 쓴다',
    from: '  const stamp = stampOf(ev);\n  settle(stamp);',
    to:   '  const stamp = nowMs();\n  settle(stamp);'
  },
  /* ② 시계를 프레임 누적으로 그린다 = 60Hz 와 144Hz 에서 다른 게임이 된다 */
  'frame-accumulate': {
    catcher: '그린 남은 시간이 매 프레임 흐른 시간과 같다(프레임 간격 불규칙)',
    from: '  paintClockAt(endAt - t);                /* ★프레임마다 흐른 시간에서 다시 계산한다 */',
    to:   '  paintClockAt(drawnLeftMs - 16.7);   /* ★프레임마다 고정량을 뺀다 = 주사율이 곧 시계가 된다 */'
  },
  /* ③ 놓침을 '마감 시각' 이 아니라 '알아챈 시각' 으로 확정한다 = 화면이 느릴수록 지시가 밀린다.
        ★프레임을 성기게 돌리면 다음 지시가 그만큼 늦게 뜬다(느린 기기가 지시를 덜 받는다). */
  'timeout-at-frame-time': {
    catcher: '지시가 저절로 넘어간 것은 마감 시각으로 확정된다(알아챈 프레임 시각이 아니다)',
    from: '    advance(dueAt);\n  }',
    to:   '    advance(limit);\n  }'
  },
  /* ④ 판정을 마지막으로 그린 값에서 낸다 = 화면이 느릴수록 남은 시간이 달라진다 */
  'end-from-drawn': {
    catcher: '30초 종료는 시작 도장 + 30,000ms 로 못박혀 있다',
    from: '  endAt = runStart + ROUND_MS;             /* ★끝나는 시각을 여기서 못박는다 */',
    to:   '  endAt = nowMs() + ROUND_MS;'
  },
  /* ⑤ 플레이 행동이 난수를 소비한다 = 사람마다 판이 갈린다 */
  'rng-on-play': {
    catcher: '플레이 행동은 난수를 한 번도 소비하지 않는다(오늘의 도전)',
    from: "    sWrong();\n    say(T('sayWrong'));",
    to:   "    sWrong();\n    Math.random();\n    say(T('sayWrong'));"
  },
  /* ⑥ 오늘의 도전 판을 날짜가 아니라 그때그때 뽑는다 */
  'seed-drift': {
    catcher: '같은 씨앗은 같은 판을 준다(지시 120개 전체)',
    from: 'const dailyPlan = seedKey => makePlan(mulberry32(hashStr(String(seedKey))));',
    to:   'const dailyPlan = seedKey => makePlan(mulberry32((Math.random() * 4294967296) >>> 0));'
  },
  /* ⑦ ★씨앗에 시각을 섞는다 = 같은 날인데 몇 시에 열었는지로 판이 갈린다.
        fake-one 라운드에서 master 가 뚫은 각이다 — 이번엔 처음부터 짝을 세워 둔다. */
  'daily-seed-uses-clock': {
    catcher: '같은 씨앗은 시각이 달라져도 같은 판을 준다(가짜 시계로 크게 벌려 확인)',
    from: 'const dailyPlan = seedKey => makePlan(mulberry32(hashStr(String(seedKey))));',
    to:   'const dailyPlan = seedKey => makePlan(mulberry32(hashStr(String(seedKey)) ^ ((Date.now()/1000)|0)));'
  },
  /* ⑧ 간격의 바닥을 없앤다 = 사람이 못 누르는 속도까지 줄어 실력이 아니라 운이 된다 */
  'no-floor': {
    catcher: '간격은 바닥값 아래로 내려가지 않는다(사람이 누를 수 있는 속도로 남는다)',
    from: '  return v < FLOOR_MS ? FLOOR_MS : v;',
    to:   '  return v;'
  },
  /* ⑨ 간격이 아예 안 줄어든다 = 반응속도 경쟁이 사라진다 */
  'interval-not-shrinking': {
    catcher: '간격은 정답이 쌓일수록 짧아진다',
    from: '  const v = START_MS - STEP_MS * correct;',
    to:   '  const v = START_MS;'
  },
  /* ⑩ 간격이 정답이 아니라 지나간 지시 수로 줄어든다 = 틀리고 놓쳐도 빨라진다 */
  'interval-shrinks-on-any': {
    catcher: '간격은 정답 수만 줄인다(오답·놓침으로는 빨라지지 않는다)',
    from: '  dueAt = at + intervalAt(right);',
    to:   '  dueAt = at + intervalAt(right + wrong + missed);'
  },
  /* ⑪ 오답에 벌이 없다 = 두 칸을 마구 두드리는 것이 최적 전략이 된다 */
  'wrong-no-penalty': {
    catcher: '오답은 하나를 깎는다',
    from: '    score = clampScore(score - WRONG_PENALTY);',
    to:   '    score = score;'
  },
  /* ⑫ 점수가 0 밑으로 내려간다 */
  'score-below-zero': {
    catcher: '점수는 0 밑으로 내려가지 않는다',
    from: 'const clampScore = v => v < 0 ? 0 : v;',
    to:   'const clampScore = v => v;'
  },
  /* ⑬ 놓침에 벌을 매긴다 = 안 누른 것을 벌하면 억제력이 아니라 무모함을 재게 된다 */
  'missed-penalized': {
    catcher: '놓친 지시는 점수를 깎지 않는다',
    from: '    missed += 1;\n    /* ★표시는 지우지 않는다',
    to:   '    missed += 1;\n    score = clampScore(score - 1);\n    /* ★표시는 지우지 않는다'
  },
  /* ⑬-A 따라잡기가 점수를 준다 = 다른 탭에 숨어 있는 것이 이득이 된다 */
  'catchup-awards-score': {
    catcher: '숨긴 구간이 점수를 주지 않는다(따라잡기로 점수가 오르지 않는다)',
    from: '    missed += 1;\n    /* ★표시는 지우지 않는다',
    to:   '    missed += 1;\n    score += 1;\n    /* ★표시는 지우지 않는다'
  },
  /* ⑭ 두 칸의 모양을 같게 만든다 = 색맹 사용자에게 두 칸이 구별되지 않는다 */
  'icons-identical': {
    catcher: '두 답 칸은 색이 아니라 글자와 모양으로 서로 다르다',
    from: "  vert:['<svg viewBox=\"0 0 40 40\" aria-hidden=\"true\"><path d=\"M8 25 L20 11 L32 25 Z\" fill=\"currentColor\"/></svg>',\n        '<svg viewBox=\"0 0 40 40\" aria-hidden=\"true\"><path d=\"M8 15 L20 29 L32 15 Z\" fill=\"currentColor\"/></svg>'],",
    to:   "  vert:['<svg viewBox=\"0 0 40 40\" aria-hidden=\"true\"><path d=\"M8 25 L20 11 L32 25 Z\" fill=\"currentColor\"/></svg>',\n        '<svg viewBox=\"0 0 40 40\" aria-hidden=\"true\"><path d=\"M8 25 L20 11 L32 25 Z\" fill=\"currentColor\"/></svg>'],"
  },
  /* ⑮ 참·거짓 명제의 참 여부를 뒤집는다 = 반대 계약이 그 축에서만 깨진다 */
  'truth-inverted': {
    catcher: '참·거짓 지시에서 명제가 참인 것과 지시가 가리키는 칸이 맞물린다',
    from: 'const truthOf = p => p.off === 0;',
    to:   'const truthOf = p => p.off !== 0;'
  },
  /* ⑯ 영어 표에서 본문 산문 키 하나를 뺀다 = EN 사용자가 그 문단만 한국어로 본다 */
  'en-prose-missing': {
    catcher: '마크업의 data-i18n 키가 ko·en 두 표에 모두 있다',
    from: "    how1:'Prompts appear one at a time",
    to:   "    how1x:'Prompts appear one at a time"
  },
  /* ⑰ 최고 기록 비교를 뒤집는다 */
  'best-worse-wins': {
    catcher: '자유 모드 최고 기록은 더 많이 맞혔을 때만 바뀐다',
    from: 'const betterThan = (a, b) => !b || a.score > b.score;',
    to:   'const betterThan = (a, b) => !b || a.score < b.score;'
  },
  /* ⑱ 하루 한 번 규칙을 깬다 */
  'daily-overwrite': {
    catcher: '오늘의 도전은 하루 한 번이다(두 번째 완주가 기록을 덮지 않는다)',
    from: '    if (!dailyDoneToday()){\n      saveDaily({ score, right, wrong, missed, axes: r.axes });',
    to:   '    if (true){\n      saveDaily({ score, right, wrong, missed, axes: r.axes });'
  },
  /* ⑲ 스트릭 리셋을 지운다 */
  'streak-never-resets': {
    catcher: '날짜가 끊기면 스트릭이 1 로 리셋된다',
    from: '  const n = (st && st.last === prevDayKey(day)) ? (st.n || 0) + 1 : 1;',
    to:   '  const n = (st.n || 0) + 1;'
  },
  /* ⑳ 도장 허용오차를 지운다 */
  'stamp-no-tolerance': {
    catcher: '허용오차를 벗어난 도장은 믿지 않고 지금 시각으로 물러선다',
    from: "  if (typeof s === 'number' && isFinite(s) && s > 0 && Math.abs(t - s) <= STAMP_TOLERANCE_MS) return s;",
    to:   "  if (typeof s === 'number' && isFinite(s)) return s;"
  },
  /* ㉑ 키 반복 가드를 지운다(화살표) */
  'repeat-guard-gone': {
    catcher: '누르고 있어서 반복 발화된 화살표 입력은 무시된다',
    from: "  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;\n  if (ev.repeat) return;",
    to:   "  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;"
  },
  /* ㉒ Enter 의 기본동작 차단을 지운다 = 뒤따르는 click 이 한 번 더 센다 */
  'key-no-preventdefault': {
    catcher: 'Enter 로 눌렀을 때 preventDefault 가 호출된다',
    from: '    ev.preventDefault();\n    onAnswer(i, ev);',
    to:   '    onAnswer(i, ev);'
  },
  /* ㉓ 창 밖 inert 부여를 지운다 */
  'inert-gone': {
    catcher: '창이 열리면 창 밖 요소에 inert 가 붙는다',
    from: "function setOutsideInert(on){\n  for (const el of document.querySelectorAll('body > header, body > main, body > section, body > footer, body > .ad-slot, body > .scores')){\n    if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');\n  }\n}",
    to:   'function setOutsideInert(on){ /* deleted */ }'
  },
  /* ㉔ ★답 칸의 높이를 손가락 하한 아래로 줄인다.
        fake-one 라운드에서 '측정으로 얻은 제약을 검사가 안 지킨다' 로 뚫린 각이다 — 처음부터 막는다. */
  'touch-target-shrunk': {
    scope: 'html',
    catcher: '답 칸은 360px 에서 짧은 변이 50px 하한을 지킨다',
    from: '  .rv-btn{min-height:96px;',
    to:   '  .rv-btn{min-height:40px;'
  },
  /* ㉕ 답 칸 사이 간격을 넓힌다 = 칸 크기 셈의 전제(CSS 치수)가 달라진다.
        ★㉔ 와 짝이다 — ㉔ 는 '50px 하한' 을, ㉕ 는 '이 셈이 실측을 재현한다' 를 각각 붉힌다. */
  'answers-gap-widened': {
    scope: 'html',
    catcher: '이 셈이 실브라우저 실측(답 칸 폭)을 재현한다',
    from: '  .rv-answers{display:grid;grid-template-columns:1fr 1fr;gap:10px;',
    to:   '  .rv-answers{display:grid;grid-template-columns:1fr 1fr;gap:16px;'
  }
};
if (argv.includes('--list-mutations')){
  for (const [k, v] of Object.entries(MUTATIONS)) console.log(k + '\t' + v.catcher);
  process.exit(0);
}

let RAW = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');

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
   제품 파일에는 관측 창구(__rv)만 배포한다. 상태를 바꾸는 명령은 여기서 IIFE 가 닫히기 직전에
   덧붙인다 — 배포본에는 남지 않는다(장기기억 debug-hooks-in-shipped-code-are-a-control-api). */
const BRIDGE = `
window.__rvTest = {
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

const IDS = ['clock','clockUnit','timeFill','stage','cue','word','answers',
             'ans0','ans1','icon0','icon1','label0','label1',
             'axisChip','scoreChip','srSummary','toast','over','start',
             'finalBig','finalLine','marks','streakLine','newBest','nRight','nWrong','nMissed','finalSub',
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

  /* ★벽시계(달력)도 하네스가 쥔다 — performance.now() 와는 다른 축이다.
     이것이 없으면 '같은 날 아무 때나 열어도 같은 판' 을 잴 수 없다. 같은 순간에 두 번 물어
     같은 답이 나오는 것은 씨앗에 시각이 섞여 있어도 성립하기 때문이다(master 236 지적).
     기본값은 진짜 지금이라 이 다리를 안 쓰는 검사들의 행동은 그대로다. */
  const RealDate = Date;
  let wall = RealDate.now();
  class DateStub extends RealDate {
    constructor(...a){ if (a.length === 0) super(wall); else super(...a); }
    static now(){ return wall; }
  }

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
    location: { href: 'https://hanpango.com/reverse/' },
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
    Number, String, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(SRC, sandbox, { filename: 'reverse-inline.js' }); }
  catch (e){ console.error('구동 실패: ' + e.stack); process.exit(2); }
  if (!win.__rv || !win.__rvTest){ console.error('관측 창구(__rv)/시험 다리(__rvTest) 없음'); process.exit(2); }

  const ansOf = i => doc.getElementById('ans' + i);
  const A = {
    rv: win.__rv, t: win.__rvTest, doc, store: localStorage,
    el: id => doc.getElementById(id),
    txt: id => doc.getElementById(id).textContent,
    rand: () => randCalls,
    resetRand: () => { randCalls = 0; },
    now: () => clock,
    advance: ms => { clock += ms; },
    /* 벽시계 조작 — 달력을 옮긴다(경과 시간 clock 과는 별개 축이다) */
    wall: () => wall,
    setWall: ms => { wall = ms; },
    frame: () => runFrame(),
    frames: () => rafQueue.size,
    runTimers,
    pendingTimers: () => timers.size,
    /* ★진짜 입력 사건으로 두드린다 — 다리로 onAnswer 를 부르지 않는다 */
    tap: (i, props) => {
      const fn = ansOf(i)._on.pointerdown;
      if (!fn) throw new Error('답 칸 pointerdown 핸들러 없음');
      fn(Object.assign({ button: 0, timeStamp: clock }, props || {}));
    },
    /* 답 칸 위에서의 키 입력(Enter·Space) */
    keyOn: (i, k, opts) => {
      const fn = ansOf(i)._on.keydown;
      if (!fn) throw new Error('답 칸 keydown 핸들러 없음');
      const o = opts || {};
      fn({ key: k, repeat: !!o.repeat, preventDefault(){ pdCount++; },
           timeStamp: ('timeStamp' in o) ? o.timeStamp : clock });
    },
    /* 문서 수준의 화살표 키 */
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
    /* ★도장은 지금과 다를 수 있다 — 브라우저는 우리 코드가 돌기 전에 사건에 도장을 찍는다.
       도장을 늘 지금과 같게 주면 '시작 시각을 도장에서 잡는가 지금에서 잡는가' 를 가를 수 없다
       (그 차이가 0 이면 어떤 구현이든 통과한다). */
    startBtn: off => doc.getElementById('btnStart').onclick({ timeStamp: clock + (off || 0) }),
    dailyBtn: off => doc.getElementById('btnDaily').onclick({ timeStamp: clock + (off || 0) }),
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

/* 지금 지시에서 '눌러야 하는 칸'과 '지시가 가리키는 칸'을 ★관측 창구에서 읽는다
   (하네스가 답을 따로 셈해 두면 그때부터 검사가 계약이 아니라 내 셈을 재게 된다) */
const curOf = A => { const s = A.rv.state(); return s.plan[s.idx]; };
const rightIdx = A => A.rv.correctIndexOf(curOf(A));
const wrongIdx = A => A.rv.naturalIndexOf(curOf(A));

/* 정해진 대본대로 친다. kind: 'right' 정답 · 'wrong' 오답 · 'skip' 놓침(마감을 넘긴다).
   ★반환값은 하네스가 따로 센 기대치다 — 제품이 낸 수치와 이것을 대조한다. */
function playScript(A, spec, framesPerStep){
  let right = 0, wrong = 0, missed = 0;
  for (const st of spec){
    if (st.kind === 'skip'){
      /* 마감을 넘기고 프레임을 한 번 돌려 따라잡게 한다(놓침은 마감 시각으로 확정된다) */
      A.advance(st.wait); A.frame();
      missed += 1;
      continue;
    }
    A.advance(st.wait);
    if (framesPerStep) for (let f = 0; f < framesPerStep; f++) A.frame();
    if (st.kind === 'right'){ A.tap(rightIdx(A)); right += 1; }
    else { A.tap(wrongIdx(A)); wrong += 1; }
  }
  return { right, wrong, missed };
}

/* ============================================================ 1. 규격과 순수 함수 */
section('1. 규격과 순수 함수 — 반대를 누르는 것이 계약이다');
{
  const A = boot();
  const C = A.rv.const();
  eq('한 판은 30초다', C.ROUND_MS, 30000);
  eq('지시 축은 넷이다', C.AXES.slice().sort(), ['dir','size','truth','vert']);
  eq('오답 벌은 1 이다', C.WRONG_PENALTY, 1);
  ok('판을 짤 때 지시를 넉넉히 뽑아 둔다(30초에 닿을 수 있는 수보다 많다)',
     C.PROMPTS > Math.ceil(C.ROUND_MS / C.FLOOR_MS), `${C.PROMPTS} > ${Math.ceil(C.ROUND_MS / C.FLOOR_MS)}`);

  /* ★이 게임의 전부 — 눌러야 하는 칸은 지시가 가리키는 칸의 반대다 */
  let bad = 0, checked = 0;
  for (const axis of C.AXES) for (const variant of [0, 1]){
    const p = { axis, variant, a: 3, b: 4, off: variant === 0 ? 0 : 1 };
    checked++;
    if (A.rv.naturalIndexOf(p) !== variant) bad++;
    if (A.rv.correctIndexOf(p) !== 1 - variant) bad++;
    if (A.rv.correctIndexOf(p) === A.rv.naturalIndexOf(p)) bad++;
  }
  ok('전제 — 네 축 x 두 방향, 여덟 경우를 전부 셈했다', checked === 8, `셈한 경우 ${checked}`);
  ok('눌러야 하는 칸은 지시가 가리키는 칸의 반대다(네 축 전부)', bad === 0, `어긋난 경우 ${bad}`);

  /* 참·거짓 — 명제가 참인 것과 지시가 가리키는 칸이 맞물려야 반대 계약이 그 축에서도 성립한다 */
  const tTrue = { axis:'truth', variant:0, a:3, b:4, off:0 };
  const tFalse = { axis:'truth', variant:1, a:3, b:4, off:2 };
  ok('참·거짓 지시에서 명제가 참인 것과 지시가 가리키는 칸이 맞물린다',
     A.rv.truthOf(tTrue) === true && A.rv.truthOf(tFalse) === false &&
     A.rv.naturalIndexOf(tTrue) === 0 && A.rv.naturalIndexOf(tFalse) === 1,
     `truthOf ${A.rv.truthOf(tTrue)}/${A.rv.truthOf(tFalse)}`);
  eq('참인 식은 실제로 참이다', A.rv.promptText(tTrue), '3 + 4 = 7');
  ok('거짓인 식은 실제로 거짓이다', A.rv.promptText(tFalse) !== '3 + 4 = 7', A.rv.promptText(tFalse));

  eq('점수는 0 밑으로 내려가지 않는다', [A.rv.clampScore(-3), A.rv.clampScore(0), A.rv.clampScore(5)], [0, 0, 5]);
}

/* ============================================================ 2. ★간격 — 짧아지되 바닥이 있다 */
section('2. ★간격 — 정답마다 짧아지고 바닥 아래로는 안 내려간다');
{
  const A = boot();
  const C = A.rv.const();
  eq('첫 지시의 간격은 시작값이다', A.rv.intervalAt(0), C.START_MS);
  const seq = Array.from({ length: 200 }, (_, n) => A.rv.intervalAt(n));
  ok('간격은 정답이 쌓일수록 짧아진다',
     seq[1] < seq[0] && seq[5] < seq[1] && seq[10] < seq[5], `${seq[0]} ${seq[1]} ${seq[5]} ${seq[10]}`);
  ok('간격은 절대 늘지 않는다(단조)', seq.every((v, i) => i === 0 || v <= seq[i - 1]));
  ok('간격은 바닥값 아래로 내려가지 않는다(사람이 누를 수 있는 속도로 남는다)',
     seq.every(v => v >= C.FLOOR_MS), `가장 짧은 값 ${Math.min(...seq)} · 바닥 ${C.FLOOR_MS}`);
  /* ★반대 방향 — 바닥이 시작값과 같으면 '짧아진다' 가 거짓이 된다(바닥이 과잉이 아님을 함께 본다) */
  ok('바닥은 시작값보다 낮다(둘이 같으면 짧아지는 일이 없다)', C.FLOOR_MS < C.START_MS,
     `바닥 ${C.FLOOR_MS} · 시작 ${C.START_MS}`);
  ok('바닥은 사람이 누를 수 있는 범위다(억제 과제 반응시간 600~900ms 를 밑돌지 않는다)',
     C.FLOOR_MS >= 600, `바닥 ${C.FLOOR_MS}ms`);
  const hitFloor = seq.findIndex(v => v === C.FLOOR_MS);
  note(`정답 ${hitFloor}개에서 바닥 ${C.FLOOR_MS}ms 에 닿는다(시작 ${C.START_MS}ms · 정답당 -${C.STEP_MS}ms)`);
}

/* ============================================================ 3. ★점수 — 정답·오답·놓침 */
section('3. ★점수 — 맞히면 +1, 틀리면 -1, 놓치면 그대로');
{
  {
    const A = boot(); A.dailyBtn();
    const got = playScript(A, [
      { wait: 200, kind: 'right' }, { wait: 200, kind: 'right' },
      { wait: 200, kind: 'wrong' }, { wait: 200, kind: 'right' }
    ], 1);
    const s = A.rv.state();
    eq('전제 — 대본대로 정답 3 · 오답 1 을 쳤다', [got.right, got.wrong], [3, 1]);
    eq('정답 수가 실제로 맞힌 횟수와 같다', s.right, got.right);
    eq('오답은 하나를 깎는다', s.score, got.right - got.wrong);
    eq('오답 수가 실제로 틀린 횟수와 같다', s.wrong, got.wrong);
  }
  /* ★0 바닥 — 처음부터 틀리기만 하면 점수는 0 에서 멈춘다 */
  {
    const A = boot(); A.dailyBtn();
    playScript(A, [{ wait: 100, kind: 'wrong' }, { wait: 100, kind: 'wrong' }, { wait: 100, kind: 'wrong' }], 1);
    eq('점수는 0 밑으로 내려가지 않는다', A.rv.state().score, 0);
    eq('그래도 오답 수는 그대로 센다(0 에서 멈춘 것과 안 틀린 것은 다르다)', A.rv.state().wrong, 3);
  }
  /* ★놓침 — 감점 없음 */
  {
    const A = boot(); A.dailyBtn();
    const C = A.rv.const();
    playScript(A, [{ wait: 200, kind: 'right' }], 1);
    const before = A.rv.state().score;
    playScript(A, [{ wait: C.START_MS + 50, kind: 'skip' }, { wait: C.START_MS + 50, kind: 'skip' }], 0);
    const s = A.rv.state();
    ok('전제 — 실제로 두 번 놓쳤다', s.missed === 2, `놓침 ${s.missed}`);
    eq('놓친 지시는 점수를 깎지 않는다', s.score, before);
    eq('놓침은 오답으로 세지 않는다', s.wrong, 0);
  }
  /* ★한 번도 안 누른 판 — 놓침 수는 30초 동안 마감이 몇 번 지나갔는가로 정해진다.
     간격이 안 줄어드니(정답 0) 시작 간격으로 나눈 몫이다. 하네스가 독립으로 셈해 대조한다. */
  {
    const A = boot(); A.dailyBtn();
    const C = A.rv.const();
    A.advance(C.ROUND_MS + 10); A.frame();
    const want = Math.floor(C.ROUND_MS / C.START_MS);
    const r = A.rv.result();
    ok('전제 — 판이 닫혔다', !!r && A.rv.state().phase === 'done');
    eq('한 번도 안 누르면 놓침 수는 30초를 시작 간격으로 나눈 몫이다', r.missed, want);
    eq('그 판의 점수는 0 이다', r.score, 0);
    note(`30000 / ${C.START_MS} = ${want}회`);
  }
}

/* ============================================================ 4. ★시간 판정 — 프레임과 무관하다 */
section('4. ★시간 판정 — 프레임 간격이 판정을 바꾸지 않는다');
{
  const spec = [
    { wait: 300, kind: 'right' }, { wait: 420, kind: 'right' }, { wait: 260, kind: 'wrong' },
    { wait: 380, kind: 'right' }, { wait: 310, kind: 'right' }, { wait: 500, kind: 'right' }
  ];
  const runs = [];
  for (const nf of [0, 1, 5, 29]){
    const A = boot(); A.dailyBtn();
    playScript(A, spec, nf);
    const s = A.rv.state();
    runs.push({ nf, score: s.score, right: s.right, wrong: s.wrong, missed: s.missed, idx: s.idx });
  }
  ok('전제 — 네 가지 프레임 수로 같은 대본을 쳤다(0·1·5·29)', runs.length === 4);
  eq('프레임 수가 달라도 점수가 같다', runs.map(r => r.score), new Array(4).fill(runs[0].score));
  eq('프레임 수가 달라도 정답·오답·놓침이 같다',
     runs.map(r => `${r.right}/${r.wrong}/${r.missed}`), new Array(4).fill(`${runs[0].right}/${runs[0].wrong}/${runs[0].missed}`));
  eq('프레임 수가 달라도 같은 지시에 서 있다', runs.map(r => r.idx), new Array(4).fill(runs[0].idx));

  /* ★그림이 흐른 시간을 따르는가 — 프레임 간격을 불규칙하게 주고 매번 대조한다 */
  {
    const A = boot(); A.dailyBtn();
    const end = A.rv.state().endAt;
    let bad = 0, seen = 0;
    for (const step of [3, 47, 5, 120, 9, 61, 8, 200, 17]){
      A.advance(step); A.frame(); seen++;
      if (Math.abs(A.rv.drawn() - (end - A.now())) > 1e-9) bad++;
    }
    ok('전제 — 프레임을 9번 돌렸다(불규칙 간격)', seen === 9, `돈 프레임 ${seen}`);
    ok('그린 남은 시간이 매 프레임 흐른 시간과 같다(프레임 간격 불규칙)', bad === 0, `어긋난 프레임 ${bad}`);
  }

  /* ★놓침은 '마감 시각' 으로 확정된다 — 알아챈 프레임 시각이 아니다.
     한참 뒤에 한 번만 프레임을 돌려도, 밀린 마감이 각자의 시각으로 순서대로 처리돼야 한다.
     그러지 않으면 다른 탭에 갔다 온 사람은 지시를 통째로 덜 받는다. */
  {
    const A = boot(); A.dailyBtn();
    const C = A.rv.const();
    const st0 = A.rv.state();
    const span = C.START_MS * 3 + 100;         /* 마감 세 번이 지나갈 만큼 */
    A.advance(span);
    A.frame();                                  /* ★그동안 프레임은 한 번도 안 돌았다 */
    const s = A.rv.state();
    eq('전제 — 판이 아직 돌고 있다(30초 안이다)', s.phase, 'running');
    eq('밀린 마감이 하나로 뭉개지지 않고 각각 처리된다', s.missed, 3);
    ok('지시가 저절로 넘어간 것은 마감 시각으로 확정된다(알아챈 프레임 시각이 아니다)',
       Math.abs(s.shownAt - (st0.runStart + C.START_MS * 3)) < 1e-9,
       `지시가 뜬 시각 ${s.shownAt - st0.runStart} (기대 ${C.START_MS * 3} · 프레임 시각이면 ${span})`);
  }
}

/* ============================================================ 5. ★30초 종료 */
section('5. ★30초 종료 — 시작 도장에서 못박힌다');
{
  {
    /* ★시작 도장을 지금보다 40ms 앞선 것으로 준다(허용오차 안) — 브라우저가 실제로 그렇게 준다.
       그래야 '끝나는 시각을 ★도장에서 잡는가, 아니면 그때의 지금에서 잡는가' 가 갈린다. */
    const A = boot(); A.dailyBtn(-40);
    const C = A.rv.const();
    const st = A.rv.state();
    ok('전제 — 시작 도장이 지금과 40ms 어긋나 있다(0 이면 이 절이 공허하다)',
       Math.abs(st.runStart - A.now()) === 40, `도장 ${st.runStart} · 지금 ${A.now()}`);
    eq('30초 종료는 시작 도장 + 30,000ms 로 못박혀 있다', st.endAt - st.runStart, C.ROUND_MS);
    playScript(A, [{ wait: 300, kind: 'right' }, { wait: 300, kind: 'right' }], 1);
    const before = A.rv.state().score;
    A.advance(C.ROUND_MS);                      /* 30초를 훌쩍 넘긴다 */
    A.frame();
    eq('30초가 지나면 판이 닫힌다', A.rv.state().phase, 'done');
    const r = A.rv.result();
    ok('결과가 30초 시각으로 확정된다', !!r && Math.abs(r.endedAt - st.endAt) < 1e-9,
       r ? `끝난 시각 ${r.endedAt - st.runStart}` : '결과 없음');
    eq('끝난 뒤의 점수는 그때까지 맞힌 개수다', r.score, before);
    /* ★끝난 뒤에 누르면 아무 일도 없어야 한다 */
    A.advance(500);
    try { A.tap(0); } catch(e){}
    eq('판이 끝난 뒤의 입력은 세지 않는다', A.rv.result().score, before);
  }
  /* ★프레임을 한 번도 안 돌려도 30초는 지나 있다 — 다음 입력이 그것을 확정한다 */
  {
    const A = boot(); A.dailyBtn();
    const C = A.rv.const();
    playScript(A, [{ wait: 200, kind: 'right' }], 0);
    A.advance(C.ROUND_MS + 5000);               /* 프레임 0회 */
    try { A.tap(0); } catch(e){}
    eq('프레임 없이 시간만 흘러도 30초에서 판이 닫힌다', A.rv.state().phase, 'done');
    ok('그 입력은 판이 닫힌 뒤라 세지 않는다', A.rv.result().score === 1, `점수 ${A.rv.result().score}`);
  }
}

/* ============================================================ 5-A. ★숨긴 구간은 이득도 손해도 아니다
   ★master(236) 조건 (4). 위 4·5절은 '놓침은 감점 없다' 와 '밀린 마감이 각자 시각으로 확정된다' 를
     각각 재지만, ★그 둘을 곱한 상황(다른 탭에 20초를 두고 돌아온 판)을 직접 재지는 않는다.
     따라잡기가 점수를 주면 탭을 숨기는 것이 이득이 되고, 감점하면 손해가 된다 — 둘 다 안 된다.
     결과적으로 남는 것은 '그 시간을 못 쓴 것' 뿐이어야 중립이다. */
section('5-A. ★숨긴 구간 — 따라잡기가 점수를 주지도 빼앗지도 않는다');
{
  const A = boot(); A.dailyBtn();
  const C = A.rv.const();
  /* 앞 5초 동안 세 개를 맞힌다 */
  playScript(A, [{ wait: 300, kind: 'right' }, { wait: 300, kind: 'right' }, { wait: 300, kind: 'right' }], 1);
  const before = A.rv.state();
  ok('전제 — 숨기기 전에 점수가 올라 있다', before.score === 3, `점수 ${before.score}`);
  const missedBefore = before.missed;

  /* ★20초 동안 프레임이 한 번도 안 돈다(탭이 숨겨진 상태) */
  A.advance(20000);
  A.frame();                                   /* 돌아왔다 */
  const after = A.rv.state();
  eq('전제 — 판은 아직 돌고 있다', after.phase, 'running');
  /* ★두 방향을 갈라 적는다 — 같은 조건을 두 번 적으면 한쪽은 공허해서 어떤 뮤테이션도
     그 하나만 붉힐 수 없다. 위는 '오르지 않는다', 아래는 '내리지 않는다' 로 각자 짝이 있다. */
  ok('숨긴 구간이 점수를 주지 않는다(따라잡기로 점수가 오르지 않는다)',
     after.score <= before.score, `${before.score} → ${after.score}`);
  ok('숨긴 구간이 점수를 빼앗지도 않는다(놓침은 무감점)',
     after.score >= before.score, `${before.score} → ${after.score}`);
  eq('정답 수도 그대로다', after.right, before.right);
  eq('오답 수도 그대로다', after.wrong, before.wrong);
  ok('그 구간은 놓침으로만 쌓인다(잃은 것은 시간뿐이다)',
     after.missed > missedBefore, `놓침 ${missedBefore} → ${after.missed}`);
  /* ★그 20초가 정말 '시간 손해' 인가 — 남은 시간이 그만큼 줄어 있어야 한다 */
  ok('숨긴 20초만큼 남은 시간이 실제로 줄어 있다',
     Math.abs((after.endAt - A.now()) - (C.ROUND_MS - 20900)) < 1e-9,
     `남은 시간 ${after.endAt - A.now()}`);
  /* ★그리고 숨긴 뒤에도 계속 칠 수 있어야 한다(따라잡기가 판을 망가뜨리지 않았다) */
  playScript(A, [{ wait: 200, kind: 'right' }], 1);
  eq('숨겼다 돌아와도 이어서 맞힐 수 있다', A.rv.state().score, before.score + 1);
}

/* ============================================================ 6. ★시드 결정론(시각 축 포함) */
section('6. ★시드 결정론 — 같은 날은 같은 판, 시각을 옮겨도 같은 판');
{
  const A = boot();
  const k = A.rv.seedKey('2026-09-04T09:00:00');
  eq('씨앗 열쇠는 날짜만으로 만들어진다', k, 'hanpango-daily-reverse-2026-09-04');
  eq('같은 날의 다른 시각도 같은 열쇠를 준다', A.rv.seedKey('2026-09-04T23:59:00'), k);
  eq('같은 씨앗은 같은 판을 준다(지시 120개 전체)',
     JSON.stringify(A.rv.plan(k)), JSON.stringify(A.rv.plan(k)));
  ok('다른 날은 다른 판을 준다',
     JSON.stringify(A.rv.plan(k)) !== JSON.stringify(A.rv.plan(A.rv.seedKey('2026-09-05T09:00:00'))));

  /* ★벽시계를 크게 움직인다 — 같은 순간 두 번 물어 같은 것은 씨앗에 시각이 섞여 있어도 성립한다.
     fake-one 라운드에서 master 가 이 각으로 뚫었다. 이번엔 처음부터 세운다. */
  const t0 = A.wall();
  const noBefore = A.rv.dailyNo();
  A.setWall(t0 + 100 * 86400000);
  ok('전제 — 가짜 벽시계가 제품에 닿는다(100일 옮기니 도전 회차가 100 늘었다)',
     A.rv.dailyNo() - noBefore === 100, `회차 ${noBefore} → ${A.rv.dailyNo()}`);
  A.setWall(t0);
  const p0 = JSON.stringify(A.rv.plan(k));
  const shots = [];
  for (const dt of [7 * 3600000, 100 * 86400000, -3 * 86400000, 1000]){
    A.setWall(t0 + dt);
    shots.push({ dt, same: JSON.stringify(A.rv.plan(k)) === p0 });
  }
  ok('전제 — 벽시계를 네 지점으로 옮겨 가며 같은 키를 물었다', shots.length === 4);
  ok('같은 씨앗은 시각이 달라져도 같은 판을 준다(가짜 시계로 크게 벌려 확인)',
     shots.every(s => s.same), shots.map(s => `${(s.dt / 3600000).toFixed(2)}h:${s.same ? 'same' : '★다름'}`).join(' '));

  /* 사용자가 실제로 밟는 길 — 같은 날 이른 시각과 늦은 시각 */
  const localBase = new Date(2026, 8, 4, 1, 0, 0).getTime();
  const B = boot(); B.setWall(localBase); B.dailyBtn();
  const early = { plan: JSON.stringify(B.rv.state().plan), day: B.rv.state().runDay, no: B.rv.state().runNo };
  const C2 = boot(); C2.setWall(localBase + 20 * 3600000); C2.dailyBtn();
  const late = { plan: JSON.stringify(C2.rv.state().plan), day: C2.rv.state().runDay, no: C2.rv.state().runNo };
  ok('전제 — 두 시각이 같은 날로 잡혔다', early.day === late.day && early.day !== '', `${early.day} vs ${late.day}`);
  ok('같은 날이면 이른 시각과 늦은 시각이 같은 판을 받는다',
     early.plan === late.plan && early.no === late.no, `회차 ${early.no} vs ${late.no}`);
  const D = boot(); D.setWall(localBase + 86400000); D.dailyBtn();
  ok('날이 바뀌면 다른 판을 받는다',
     JSON.stringify(D.rv.state().plan) !== early.plan && D.rv.state().runNo === early.no + 1,
     `회차 ${early.no} → ${D.rv.state().runNo}`);

  /* ★플레이 행동은 난수를 한 번도 소비하지 않는다 */
  {
    const E = boot(); E.dailyBtn(); E.resetRand();
    playScript(E, [
      { wait: 200, kind: 'right' }, { wait: 200, kind: 'wrong' },
      { wait: 2000, kind: 'skip' }, { wait: 200, kind: 'right' }
    ], 2);
    E.langBtn();
    eq('플레이 행동은 난수를 한 번도 소비하지 않는다(오늘의 도전)', E.rand(), 0);
  }
  {
    const F = boot(); F.resetRand(); F.startBtn();
    const after = F.rand();
    playScript(F, [{ wait: 200, kind: 'right' }, { wait: 200, kind: 'right' }], 1);
    ok('자유 모드는 판을 짤 때 난수를 한 번만 뽑는다', after === 1, `판 짤 때 ${after}회`);
    eq('그 뒤 플레이는 난수를 더 쓰지 않는다', F.rand(), after);
  }
}

/* ============================================================ 7. ★간격이 정답에만 반응한다 */
section('7. ★간격은 정답 수만 줄인다');
{
  const A = boot(); A.dailyBtn();
  const C = A.rv.const();
  const gapNow = () => { const s = A.rv.state(); return s.dueAt - s.shownAt; };
  eq('전제 — 첫 지시의 간격은 시작값이다', gapNow(), C.START_MS);
  playScript(A, [{ wait: 100, kind: 'wrong' }, { wait: 100, kind: 'wrong' }], 1);
  eq('오답만으로는 간격이 줄지 않는다', gapNow(), C.START_MS);
  playScript(A, [{ wait: C.START_MS + 50, kind: 'skip' }], 0);
  eq('놓침으로도 간격이 줄지 않는다', gapNow(), C.START_MS);
  playScript(A, [{ wait: 100, kind: 'right' }], 1);
  eq('정답 하나에 정확히 한 걸음 줄어든다', gapNow(), C.START_MS - C.STEP_MS);
  playScript(A, [{ wait: 100, kind: 'right' }, { wait: 100, kind: 'right' }], 1);
  eq('정답 셋이면 세 걸음이다', gapNow(), C.START_MS - C.STEP_MS * 3);
  eq('간격은 정답 수만 줄인다(오답·놓침으로는 빨라지지 않는다)', gapNow(), A.rv.intervalAt(A.rv.state().right));
}

/* ============================================================ 8. ★색맹 안전 — 글자와 모양이 말한다 */
section('8. ★색맹 안전 — 두 칸은 색이 아니라 글자와 모양으로 다르다');
{
  const A = boot();
  const C = A.rv.const();
  let sameShape = 0, noText = 0, noSvg = 0, checked = 0;
  /* ★네 축의 화면을 모두 세운다. 한 판을 끝까지 쳐서 축을 쫓으면 30초에 막혀 못 미치는 축이
     생긴다(첫 시도에서 2/4 만 세워졌다). 대신 그 축이 첫 지시로 나오는 날을 찾아 그 판을 연다. */
  for (const axis of C.AXES){
    let B = null;
    for (let d = 0; d < 60 && !B; d++){
      const probe = boot();
      probe.setWall(new Date(2026, 8, 4 + d, 9, 0, 0).getTime());
      /* ★state().plan 은 기동 때(옛 벽시계로) 짜인 판이다 — 벽시계를 옮긴 뒤에는
         그 날짜의 열쇠로 ★다시 짠 판을 봐야 한다. 이걸 헷갈리면 표본이 조용히 줄어든다. */
      if (probe.rv.plan(probe.rv.seedKey())[0].axis === axis) B = probe;
    }
    if (!B) continue;
    B.dailyBtn();
    if (curOf(B).axis !== axis) continue;
    checked++;
    const icons = B.rv.iconHtml();
    const labels = B.rv.answerLabels();
    if (icons[0] === icons[1]) sameShape++;
    if (!labels[0] || !labels[1] || labels[0] === labels[1]) noText++;
    if (!/<svg/.test(icons[0]) || !/<svg/.test(icons[1])) noSvg++;
  }
  ok('전제 — 네 축의 화면을 모두 세웠다(표본 0 은 통과가 아니다)', checked === 4, `세운 축 ${checked}`);
  ok('두 답 칸은 색이 아니라 글자와 모양으로 서로 다르다', sameShape === 0, `모양이 같은 축 ${sameShape}`);
  ok('두 답 칸에 서로 다른 글자가 붙어 있다', noText === 0, `글자가 없거나 같은 축 ${noText}`);
  ok('두 답 칸에 모양(svg)이 붙어 있다', noSvg === 0, `모양이 없는 축 ${noSvg}`);
  /* 지시 자체도 글로 말한다 */
  const D = boot(); D.dailyBtn();
  ok('지시에도 글자가 들어 있다(색만으로 말하지 않는다)',
     /[^<>]{1,}/.test(D.rv.wordHtml().replace(/<[^>]*>/g, '').trim()), D.rv.wordHtml().slice(0, 60));
}

/* ============================================================ 9. ★터치 목표 — 360px 에서 50px */
section('9. ★터치 목표 — 360px 에서 답 칸의 짧은 변이 50px 을 지킨다');
{
  const html = RAW;
  const VIEWPORT = 360;        /* 재는 화면 폭(티켓이 못박은 값) */
  const MIN_TOUCH = 50;        /* 손가락 하한 */
  /* ★세로 스크롤막대가 차지하는 폭. 이 게임도 본문이 길어 360px 화면에서 항상 막대가 선다.
     ★이 값은 추정이 아니라 실측이다 — 2026-09-04 iframe width=360 에서
     innerWidth(360) - documentElement.clientWidth(348) = 12 를 그대로 읽었다.
     아래 보정 단언이 이 값이 맞는지를 답 칸 폭 실측으로 다시 되짚는다. */
  const SCROLLBAR = 12;
  const mainPad = (/ {2}main\{[^}]*padding:\s*\d+px\s+(\d+)px/.exec(html) || [])[1];
  const ansCss = (/\.rv-answers\{([\s\S]*?)\}/.exec(html) || [])[1] || '';
  const gap = (/gap:(\d+)px/.exec(ansCss) || [])[1];
  const ansMax = (/max-width:min\(100%,(\d+)px\)/.exec(ansCss) || [])[1];
  const btnCss = (/\.rv-btn\{([\s\S]*?)\}/.exec(html) || [])[1] || '';
  const minH = (/min-height:(\d+)px/.exec(btnCss) || [])[1];
  const nums = [mainPad, gap, ansMax, minH].map(Number);
  ok('전제 — 답 칸의 치수 넷을 소스에서 읽었다(못 읽으면 판정 불가)',
     nums.every(v => Number.isFinite(v)),
     `main padding ${mainPad} · gap ${gap} · max-width ${ansMax} · min-height ${minH}`);
  const [mp, gp, amax, mh] = nums;
  const rowW = Math.min(VIEWPORT - SCROLLBAR - 2 * mp, amax);
  const btnW = (rowW - gp) / 2;
  const shortSide = Math.min(btnW, mh);
  /* ★보정 — 이 셈이 실브라우저가 실제로 세운 값을 재현하는가.
     재현하지 못하면 아래 50px 판정은 '내가 지어낸 수식' 위에 선 것이라 아무 뜻이 없다.
     실측은 2026-09-04 iframe width=360 에서 얻었다. */
  ok('이 셈이 실브라우저 실측(답 칸 폭)을 재현한다',
     Math.abs(btnW - 159.0) < 0.6,
     `셈한 폭 ${btnW.toFixed(2)}px · 실측 159.00px — 어긋나면 CSS 가 바뀐 것이니 다시 재라`);
  ok('답 칸은 360px 에서 짧은 변이 50px 하한을 지킨다',
     shortSide >= MIN_TOUCH, `짧은 변 ${shortSide.toFixed(2)}px(폭 ${btnW.toFixed(2)} · 높이 ${mh}) · 하한 ${MIN_TOUCH}px`);
  note(`360px 에서 답 칸 ${btnW.toFixed(2)} x ${mh}px`);
}

/* ============================================================ 10. 저장·하루 한 번·최고기록·스트릭 */
section('10. 저장 — 「오늘의 한판」 어댑터가 읽을 수 있는 형태인가');
{
  {
    const A = boot(); A.dailyBtn();
    const C = A.rv.const();
    playScript(A, [{ wait: 200, kind: 'right' }, { wait: 200, kind: 'right' }, { wait: 200, kind: 'wrong' }], 1);
    A.advance(C.ROUND_MS); A.frame();
    const raw = A.store.getItem('rv.daily');
    ok('오늘의 도전 결과가 rv.daily 에 저장된다', !!raw);
    const rec = JSON.parse(raw || '{}');
    ok('저장 레코드에 날짜가 있다', /^\d{4}-\d{2}-\d{2}$/.test(rec.date || ''), rec.date);
    ok('저장 레코드에 회차가 있다', typeof rec.no === 'number' && rec.no > 0, String(rec.no));
    ok('★어댑터가 읽는 result.score 가 수치다',
       rec.result && typeof rec.result.score === 'number' && isFinite(rec.result.score),
       JSON.stringify(rec.result && rec.result.score));
    eq('저장된 점수가 결과 화면의 값과 같다', rec.result.score, A.rv.result().score);
  }
  {
    const A = boot(); A.dailyBtn();
    const C = A.rv.const();
    playScript(A, [{ wait: 200, kind: 'right' }], 1);
    A.advance(C.ROUND_MS); A.frame();
    const first = JSON.parse(A.store.getItem('rv.daily')).result.score;
    A.againBtn();
    eq('오늘의 도전을 마치면 다시 하기는 자유 모드로 간다', A.rv.state().mode, 'free');
    /* ★두 번째 도전 경로는 '다시 하기' 로 열리지 않으므로 시험 다리로 연다 */
    A.t.begin('daily', A.now());
    playScript(A, [{ wait: 200, kind: 'right' }, { wait: 200, kind: 'right' }, { wait: 200, kind: 'right' }], 1);
    A.advance(C.ROUND_MS); A.frame();
    ok('전제 — 두 번째 도전은 첫 판과 다른 점수가 나왔다', A.rv.result().score !== first,
       `첫 판 ${first} · 두 번째 ${A.rv.result().score}`);
    eq('오늘의 도전은 하루 한 번이다(두 번째 완주가 기록을 덮지 않는다)',
       JSON.parse(A.store.getItem('rv.daily')).result.score, first);
  }
  {
    const A = boot(); const C = A.rv.const();
    A.startBtn();
    playScript(A, [{ wait: 200, kind: 'right' }, { wait: 200, kind: 'right' }], 1);
    A.advance(C.ROUND_MS); A.frame();
    const b1 = A.rv.best().score;
    A.againBtn();
    playScript(A, [{ wait: 200, kind: 'right' }], 1);
    A.advance(C.ROUND_MS); A.frame();
    const b2 = A.rv.best().score;
    A.againBtn();
    playScript(A, [{ wait: 200, kind: 'right' }, { wait: 200, kind: 'right' }, { wait: 200, kind: 'right' }], 1);
    A.advance(C.ROUND_MS); A.frame();
    const b3 = A.rv.best().score;
    eq('전제 — 첫 판이 최고 기록이 된다', b1, 2);
    eq('자유 모드 최고 기록은 더 많이 맞혔을 때만 바뀐다', b2, b1);
    eq('더 많이 맞히면 최고 기록이 바뀐다', b3, 3);
  }
  {
    const pad2s = n => String(n).padStart(2, '0');
    const keyOf = d => `${d.getFullYear()}-${pad2s(d.getMonth() + 1)}-${pad2s(d.getDate())}`;
    const daysAgo = n => { const t = new Date(); t.setDate(t.getDate() - n); return keyOf(t); };
    const cut = makeStore();
    cut.setItem('rv.streak', JSON.stringify({ last: daysAgo(3), n: 5 }));
    const A = boot({ store: cut }); const C = A.rv.const();
    A.dailyBtn(); A.advance(C.ROUND_MS); A.frame();
    ok('날짜가 끊기면 스트릭이 1 로 리셋된다', A.rv.daily().streak === 1, `스트릭 ${A.rv.daily().streak}`);
    const cont = makeStore();
    cont.setItem('rv.streak', JSON.stringify({ last: daysAgo(1), n: 5 }));
    const B = boot({ store: cont });
    B.dailyBtn(); B.advance(C.ROUND_MS); B.frame();
    ok('어제 이어서 하면 스트릭이 1 늘어난다', B.rv.daily().streak === 6, `스트릭 ${B.rv.daily().streak}`);
  }
}

/* ============================================================ 11. 저장 키 */
section('11. 저장 키 — 개인정보처리방침이 적어야 하는 목록');
{
  const A = boot(); const C = A.rv.const();
  A.dailyBtn();
  playScript(A, [{ wait: 200, kind: 'right' }], 1);
  A.advance(C.ROUND_MS); A.frame();
  A.langBtn();
  A.el('btnSound').onclick();
  A.againBtn();
  playScript(A, [{ wait: 200, kind: 'right' }], 1);
  A.advance(C.ROUND_MS); A.frame();
  eq('쓰는 키는 rv.* 넷과 사이트 공용 bp.lang 뿐이다', A.store.keys().sort(),
     ['bp.lang','rv.best','rv.daily','rv.sound','rv.streak']);
}

/* ============================================================ 12. 화면·언어 */
section('12. 화면·언어 — 진행 중 내용이 안내 문구로 덮이지 않는가');
{
  const A = boot(); A.dailyBtn();
  A.advance(1234); A.frame();
  const clockBefore = A.txt('clock');
  const promptBefore = curOf(A);
  const axisBefore = A.txt('axisChip');
  ok('전제 — 진행 중이고 시계에 숫자가 적혀 있다',
     A.rv.state().phase === 'running' && /^[0-9]+\.[0-9]$/.test(clockBefore), clockBefore);
  A.langBtn();
  eq('언어가 바뀌었다', A.rv.lang(), 'en');
  eq('진행 중 언어를 바꿔도 시계 숫자가 안내 문구로 덮이지 않는다', A.txt('clock'), clockBefore);
  eq('진행 중 언어를 바꿔도 지시 자체는 그대로다(축·어느 쪽)',
     JSON.stringify(curOf(A)), JSON.stringify(promptBefore));
  ok('딱지의 축 이름은 새 언어로 바뀐다', A.txt('axisChip') !== axisBefore,
     `${axisBefore} → ${A.txt('axisChip')}`);
  ok('두 칸의 글자도 새 언어로 바뀐다',
     A.rv.answerLabels().every(l => /^[A-Za-z /]+$/.test(l)), A.rv.answerLabels().join(' / '));
  A.advance(100); A.frame();
  ok('언어를 바꾼 뒤에도 시계가 이어서 흐른다', A.rv.drawn() < A.rv.const().ROUND_MS - 1300, String(A.rv.drawn()));
}

/* ============================================================ 13. 입력 */
section('13. 입력 — 키보드가 손가락과 같은 자리를 잰다');
{
  {
    const A = boot(); A.dailyBtn();
    A.advance(300); A.resetPd();
    A.keyOn(rightIdx(A), 'Enter');
    eq('Enter 로도 답이 들어간다', A.rv.state().right, 1);
    eq('Enter 로 눌렀을 때 preventDefault 가 호출된다', A.pd(), 1);
  }
  {
    const A = boot(); A.dailyBtn();
    A.resetPd();
    const want = rightIdx(A);
    A.key(want === 0 ? 'ArrowLeft' : 'ArrowRight');
    eq('화살표 키가 두 칸에 그대로 대응한다', A.rv.state().right, 1);
    ok('화살표는 기본동작을 막는다', A.pd() === 1, `preventDefault ${A.pd()}회`);
  }
  {
    const A = boot(); A.dailyBtn();
    A.key('ArrowLeft', { repeat: true });
    eq('누르고 있어서 반복 발화된 화살표 입력은 무시된다', A.rv.state().right + A.rv.state().wrong, 0);
    A.key(rightIdx(A) === 0 ? 'ArrowLeft' : 'ArrowRight');
    eq('반복이 아닌 첫 입력은 답으로 들어간다', A.rv.state().right, 1);
  }
  {
    const A = boot();   /* 시작 창이 떠 있는 상태 */
    A.resetPd();
    A.key('ArrowLeft');
    ok('창이 떠 있으면 화살표는 판에 닿지 않는다', A.pd() === 0 && A.rv.state().phase === 'idle',
       `preventDefault ${A.pd()}회 · phase ${A.rv.state().phase}`);
  }
  /* ★도장 — 정상 도장만 보내면 stampOf 의 물러섬 분기가 시험에서 한 번도 열리지 않는다 */
  {
    const A = boot(); A.dailyBtn();
    A.advance(300);
    A.tap(rightIdx(A), { timeStamp: A.now() + 5000 });      /* 5,000ms 어긋난 도장 */
    const s = A.rv.state();
    ok('전제 — 답이 들어갔다(도장 검사의 잴 대상)', s.right === 1, `정답 ${s.right}`);
    ok('허용오차를 벗어난 도장은 믿지 않고 지금 시각으로 물러선다',
       Math.abs(s.shownAt - (s.runStart + 300)) < 1e-9,
       `다음 지시가 뜬 시각 ${s.shownAt - s.runStart} (기대 300 · 도장을 믿었다면 5300)`);
    const B = boot(); B.dailyBtn(); B.advance(250);
    B.tap(rightIdx(B), { timeStamp: NaN });
    ok('NaN 도장은 믿지 않는다',
       Math.abs(B.rv.state().shownAt - (B.rv.state().runStart + 250)) < 1e-9,
       String(B.rv.state().shownAt - B.rv.state().runStart));
    /* ★반대 방향 — 허용오차 안쪽의 도장은 그대로 쓴다(가드가 과잉이 아님을 함께 보인다) */
    const D = boot(); D.dailyBtn(); D.advance(400);
    D.tap(rightIdx(D), { timeStamp: D.now() - 40 });
    ok('허용오차 안쪽의 도장은 그대로 쓴다',
       Math.abs(D.rv.state().shownAt - (D.rv.state().runStart + 360)) < 1e-9,
       `${D.rv.state().shownAt - D.rv.state().runStart} (기대 360 = 400-40)`);
  }
  {
    const A = boot(); A.dailyBtn();
    A.tap(0, { button: 2 });
    eq('오른쪽 버튼으로 누른 것은 세지 않는다', A.rv.state().right + A.rv.state().wrong, 0);
  }
}

/* ============================================================ 14. 창(오버레이)과 inert */
section('14. 창 — 열리면 창 밖을 가둔다');
{
  const A = boot();
  const C = A.rv.const();
  const names = A.outsideNames();
  ok('전제 — 스텁이 창 밖 요소를 6종 제공한다', names.length === 6, `제공 ${names.length}종`);
  ok('전제 — 시작 창이 떠 있다', A.rv.shown('start'));
  ok('창이 열리면 창 밖 요소에 inert 가 붙는다',
     names.every(n => A.inertOf(n) === true), names.map(n => n + '=' + A.inertOf(n)).join(' '));
  A.dailyBtn();
  ok('창이 닫히면 inert 가 걷힌다',
     names.every(n => A.inertOf(n) === false), names.map(n => n + '=' + A.inertOf(n)).join(' '));
  A.advance(C.ROUND_MS); A.frame();
  ok('결과 창이 뜨면 다시 창 밖을 가둔다',
     A.rv.shown('over') && names.every(n => A.inertOf(n) === true),
     `over=${A.rv.shown('over')}`);
}

/* ============================================================ 15. 결과·공유 */
section('15. 결과·공유 — 수치가 글자로 담기는가');
{
  const A = boot(); A.dailyBtn();
  const C = A.rv.const();
  const got = playScript(A, [
    { wait: 200, kind: 'right' }, { wait: 200, kind: 'right' }, { wait: 200, kind: 'wrong' },
    { wait: C.START_MS + 50, kind: 'skip' }, { wait: 200, kind: 'right' }
  ], 1);
  /* ★여기서 대본이 끝난 시점의 놓침을 먼저 못박는다 — 그 뒤로는 손을 놓고 30초를 흘려보내므로
     남은 지시들이 계속 마감을 넘긴다(그것도 진짜 놓침이다. 아래에서 따로 센다). */
  const midMissed = A.rv.state().missed;
  eq('대본대로 놓친 수가 그대로 잡힌다', midMissed, got.missed);
  A.advance(C.ROUND_MS); A.frame();
  const r = A.rv.result();
  eq('결과의 정답 수가 실제와 같다', r.right, got.right);
  eq('결과의 오답 수가 실제와 같다', r.wrong, got.wrong);
  ok('손을 놓고 있는 동안에도 지시는 계속 마감을 넘긴다(놓침이 는다)',
     r.missed > midMissed, `대본 뒤 ${midMissed} → 끝 ${r.missed}`);
  eq('결과 화면의 세 칸이 결과와 같다',
     [A.txt('nRight'), A.txt('nWrong'), A.txt('nMissed')],
     [String(r.right), String(r.wrong), String(r.missed)]);
  const marks = A.rv.marks();
  ok('판별 줄에 정답·오답·놓침이 숫자로 적힌다',
     marks.indexOf(String(r.right)) >= 0 && marks.indexOf(String(r.missed)) >= 0, marks.split('\n')[0]);
  ok('축별로 몇 개 나왔고 몇 개 맞혔는지도 적힌다', marks.split('\n').length >= 2, marks);
  const share = A.rv.shareText();
  ok('공유 문구에 회차가 들어간다', share.indexOf('#' + r.no) >= 0, share.split('\n')[0]);
  ok('공유 문구에 점수가 들어간다', share.indexOf(String(r.score)) >= 0);
  ok('공유 문구가 주소로 끝난다', /https:\/\/hanpango\.com\/reverse\/$/.test(share));
}

/* ============================================================ 16. 정적 검사 */
section('16. 정적 검사 — 소스에 대한 계약');
{
  const html = RAW;
  {
    const usedKeys = [...new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]))];
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
    const onlyKo = K.ko.filter(k => !en.has(k)), onlyEn = K.en.filter(k => !ko.has(k));
    ok('ko·en 두 표의 키 집합이 완전히 같다',
       onlyKo.length === 0 && onlyEn.length === 0, `ko 에만 [${onlyKo}] · en 에만 [${onlyEn}]`);
    note(`data-i18n 키 ${usedKeys.length}개 · ko 표 ${ko.size}항목 · en 표 ${en.size}항목`);
  }
  ok('data-i18n 이 런타임 갱신 요소에 붙지 않았다(시계·지시·딱지·결과 수치)',
     !/id="(clock|word|cue|axisChip|scoreChip|label0|label1|icon0|icon1|marks|finalBig|finalLine|nRight|nWrong|nMissed|finalSub|dailyHint|bestNow|modeNow|streakNowEl)"[^>]*data-i18n/.test(html) &&
     !/data-i18n[^>]*id="(clock|word|cue|axisChip|scoreChip|label0|label1|icon0|icon1|marks|finalBig|finalLine|nRight|nWrong|nMissed|finalSub|dailyHint|bestNow|modeNow|streakNowEl)"/.test(html));
  ok('전역 유틸 이름(.hint)을 쓰지 않는다', !/class="[^"]*\bhint\b/.test(html));
  ok('게임 고유 클래스에 rv- 접두가 붙어 있다',
     /class="rv-stage"/.test(html) && /class="rv-btn"/.test(html) && /class="rv-answers"/.test(html));
  ok('답 칸은 진짜 button 이다', /<button class="rv-btn" id="ans0" type="button">/.test(html));
  ok('남은 시간 막대를 CSS 애니메이션으로 만들지 않는다',
     /\.rv-fill\{transition:none!important;animation:none!important\}/.test(html));
  ok('hp-stats.js 를 defer 로 싣는다', /<script src="\/js\/hp-stats\.js" defer><\/script>/.test(html));
  ok('시작 화면에 판수 줄이 있다(처음엔 hidden)',
     /<p class="hp-stat" data-hp-line hidden data-i18n="statPlays">/.test(html));
  ok('hidden 가드가 있다', /\.hp-stat\[hidden\]\s*{[^{}]*display\s*:\s*none\s*!important[^{}]*}/.test(html));
  const st = [...html.matchAll(/statPlays:'([^']*)'/g)].map(m => m[1]);
  ok('statPlays 문안이 ko·en 두 곳에 있다', st.length === 2, String(st.length));
  ok('한국어 판수 문안이 다수파 꼴이다',
     /^오늘 <b data-hp="plays\.reverse\.today">[^<]*<\/b>판 · 누적 <b data-hp="plays\.reverse\.total">[^<]*<\/b>판$/.test(st[0] || ''), st[0]);
  ok('영어 판수 문안이 다수파 꼴이다',
     /^<b data-hp="plays\.reverse\.today">[^<]*<\/b> today · <b data-hp="plays\.reverse\.total">[^<]*<\/b> all-time$/.test(st[1] || ''), st[1]);
  const gaStarts = [...html.matchAll(/ga\('game_start'/g)].length;
  const paired = [...html.matchAll(/ga\('game_start', \{ game: GA_GAME(?![A-Za-z0-9_$])[^;\n]*\);(\s*\/\*[^*]*\*\/)?\s*\n\s*if \(window\.hpHit\) window\.hpHit\('play', GA_GAME\);/g)].length;
  ok(`hpHit('play') 가 시작 지점 ${gaStarts}곳 전부에 짝지어 있다`, paired === gaStarts && gaStarts > 0, `짝 ${paired} / 시작 ${gaStarts}`);
  const playHits = [...html.matchAll(/window\.hpHit\('play', GA_GAME\)/g)].length;
  ok('hpHit 호출이 시작 지점 수와 같다(떠도는 호출 0)', playHits === gaStarts, `호출 ${playHits} / 시작 ${gaStarts}`);
  ok('언어를 바꾼 뒤 숫자를 다시 채운다',
     /localStorage\.setItem\('bp\.lang', lang\);[\s\S]{0,240}if \(window\.hpStats\) window\.hpStats\(\)/.test(html));
  ok('검증 창구에 상태를 바꾸는 명령이 없다(관측 전용)',
     !/__rv\s*=\s*{[\s\S]*?\bbegin\s*:/.test(html) && !/__rv\s*=\s*{[\s\S]*?\btap\s*:/.test(html) &&
     !/__rvTest/.test(html), '배포본에 시험 다리가 남아 있다');
  ok('외부 스크립트는 사이트 공용 셋뿐이다(게임 로직은 외부 의존 0)',
     [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1])
       .every(u => /googlesyndication|googletagmanager|^\/js\/hp-stats\.js$/.test(u)));
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
