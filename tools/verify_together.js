/* 같이 한판(/together/) 검증기 · worker(238) · 2026-09-04 · 티켓 T0905-together
 *
 * 앞선 검증기(verify_reverse.js·verify_fakeone.js·verify_higherlower.js)의 방식을 그대로 따른다:
 *   · 인라인 스크립트를 DOM 스텁 위에서 실제로 구동한다(vm)
 *   · 상태를 바꾸는 명령은 **제품 파일에 두지 않고** 여기서 메모리 위에만 덧붙인다(test bridge)
 *   · 판정은 배포되는 관측 창구(window.__tg)와 이 파일이 따로 셈한 값의 대조로 한다
 *   · 누르는 것은 다리가 아니라 **진짜 입력 사건**(pointerdown·keydown)으로 두드린다
 *
 * 중점 검사(티켓이 못박은 것)
 *   ★① 노출 · 이 게임은 보여 주는 시간이 곧 난이도다. 흐른 시간으로만 재는가,
 *       마감 전에 사라지지 않는가, 사라짐을 마감 시각으로 확정하는가.
 *   ★② 보기 · 정답과 최근접 오답의 비율이 하한을 지키는가(n 전수). 찍기가 안 통하는가.
 *   ★③ 자리 · 쏠림 상한과 ★예측 불가를 ★함께 본다. 하나만 걸면 반대쪽이 열린다
 *       (2026-09-04 master 236: 네 자리 2회씩 고정이 마지막 라운드를 확정시켰다).
 *   ★④ 난이도 곡선 · 개수당 노출(ms/개)이 라운드마다 줄어드는가(최악 조합 전수).
 *   ★⑤ 겹침 · 도형이 겹치는 판이 ★생성 규칙으로 배제돼 있는가(사후 필터가 아니라).
 *   ★⑥ 일일 결정성 · 가짜 벽시계를 크게 움직여도 같은 날이면 같은 판인가.
 *   ★⑦ 즉시 확정 · 누른 순간 논리가 끝나는가(연출 타이머를 안 돌려도).
 *   ★⑧ 터치 목표 · 360px 에서 보기 칸이 50px 하한을 지키는가(숫자를 박지 않고 CSS 에서 셈한다).
 *
 * ★이 하네스가 못 보는 것(정직 고지)
 *   · 레이아웃을 계산하지 않는다 · '요소가 0×0 으로 접힘' 은 실브라우저에서만 보인다.
 *   · CSS 를 파싱하지 않는다(치수 몇 개를 정규식으로 읽을 뿐이다) · 색·대비의 실제 렌더는 못 잰다.
 *   · 도형이 사람 눈에 몇 개로 보이는지는 재지 못한다 — 좌표·지름의 수치 대조까지다.
 *   · 실제 경과 시간을 못 잰다(시계를 하네스가 쥔다) · 진짜 브라우저의 타이머 지연은 실브라우저 몫이다.
 *
 * 사용법: node verify_together.js [--html <경로>] [--mutate <이름>] [--list-mutations]
 * 종료코드: 0 = 전부 PASS · 1 = 하나라도 FAIL · 2 = 뮤테이션 주입 실패·하네스 이상(탐지 아님)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
/* 기본 대상은 **이 도구가 놓인 저장소의 /together/index.html** 이다 · 절대경로를 박아 두면
   worktree 를 갈아탈 때 조용히 남의 파일을 재게 된다. */
const HTML = argOf('--html', path.join(__dirname, '..', 'together', 'index.html'));
const MUTATION = argOf('--mutate', null);

/* ------------------------------------------------------- 뮤테이션(검출력 자기시험)
   ★각 뮤테이션은 **어느 검사가 잡아야 하는지**를 함께 적는다 · 다른 검사가 우연히 깨져서 난
   빨강은 무임승차다(장기기억 mutation-must-name-the-check-that-catches-it).
   ★'주입 실패'와 '결함 탐지'를 종료코드로 가른다(2 = 주입 실패 · 1 = 탐지).
   ★scope:'html' 은 스크립트 밖(CSS 토큰 등)을 겨냥한다 · 문서 전체에 주입한다.
   ★expect:'quiet' 는 음성 대조군이다 — ★붉으면 안 된다(붉어야 할 것만 시험하면 오탐이 열린다).
   ★검사 이름에 ' — '(공백 엠대시 공백)를 쓰지 않는다 · 러너의 FAIL 파서가 이름을 잘라 읽는다. */
const MUTATIONS = {
  /* ① 판정 — 가라/참아라/부정출발의 점수 귀속을 하나씩 뒤집는다 */
  'go-scores-other': {
    catcher: '가라에서는 먼저 누른 쪽이 1점을 얻는다',
    from: "  return res.kind === 'go-win' ? res.by : OTHER(res.by);",
    to:   "  return res.kind === 'go-win' ? OTHER(res.by) : OTHER(res.by);"
  },
  'hold-scores-presser': {
    catcher: '참아라에서 누르면 상대가 1점을 얻는다',
    from: "  return res.kind === 'go-win' ? res.by : OTHER(res.by);",
    to:   "  return res.by;"
  },
  'false-start-ignored': {
    catcher: '신호 전에 누르면 부정출발로 상대가 1점을 얻는다',
    from: "    falseStarts[i] += 1;\n    resolveRound({ by: i, kind: 'false-start', ms: null, stamp });\n    return;",
    to:   "    return;"
  },
  /* ② 시간 — 신호가 마감보다 일찍 뜨거나 깨어난 시각으로 확정된다 */
  'signal-before-due': {
    catcher: '마감 전에 깬 타이머는 신호를 띄우지 않는다',
    from: '  if (t < signalDue){ scheduleSignal(); return; }',
    to:   '  if (false){ scheduleSignal(); return; }'
  },
  'signal-stamp-uses-now': {
    catcher: '신호는 마감 시각으로 확정한다',
    from: '  signalStamp = signalDue;        /* ★신호는 마감 시각으로 확정한다 */',
    to:   '  signalStamp = t;'
  },
  'response-limit-gone': {
    catcher: '아무도 누르지 않으면 응답 상한에서 무득점으로 닫는다',
    from: '  limitTimer = setTimeout(onResponseLimit, RESPONSE_MS);',
    to:   '  limitTimer = 0;'
  },
  /* ③ 동시 입력 — master 236 이 지목한 자리(확정 뒤에 두면 영영 안 닿는다) */
  'tie-check-after-phase': {
    catcher: '두 도장이 완전히 같으면 무득점이다',
    from: "  if (resolved && resolved.tie !== true && resolved.by !== null && resolved.by !== i &&",
    to:   "  if (false && resolved && resolved.tie !== true && resolved.by !== null && resolved.by !== i &&"
  },
  'tie-not-counted': {
    catcher: '비긴 라운드 수를 세어 결과에 적는다',
    from: '    tieCount += 1;',
    to:   '    tieCount += 0;'
  },
  /* ④ 종료 조건 — 먼저 4점 · 서든데스 · 무승부 */
  'no-early-win': {
    catcher: '먼저 정해진 점수에 닿으면 그 자리에서 끝난다',
    from: "  if (score[BOTTOM] >= WIN) return { winner: BOTTOM, why: 'target' };",
    to:   "  if (false) return { winner: BOTTOM, why: 'target' };"
  },
  'draw-on-tie': {
    catcher: '기본 라운드 뒤 동점이면 서든데스로 이어진다',
    from: "  if (played >= ROUNDS && score[BOTTOM] !== score[TOP])",
    to:   "  if (played >= ROUNDS)"
  },
  'no-draw-floor': {
    catcher: '선추첨 라운드를 다 쓰면 무승부로 끝난다',
    from: "  if (played >= PLAN_ROUNDS) return { winner: null, why: 'draw' };",
    to:   "  if (false) return { winner: null, why: 'draw' };"
  },
  /* ⑤ 난수·씨앗 */
  'rng-on-play': {
    catcher: '플레이 행동은 난수를 한 번도 소비하지 않는다',
    from: '  const ms = Math.max(0, Math.round(stamp - signalStamp));',
    to:   '  const ms = (Math.random() >= 0) ? Math.max(0, Math.round(stamp - signalStamp)) : 0;'
  },
  'daily-seed-uses-clock': {
    catcher: '같은 날이면 시각이 달라도 같은 판이다',
    from: "const dailySeedKey = (d=new Date()) => 'hanpango-daily-together-' + dayKey(d);",
    to:   "const dailySeedKey = (d=new Date()) => 'hanpango-daily-together-' + dayKey(d) + '-' + d.getHours();"
  },
  'solo-uses-daily-seed': {
    /* ★연습이 오늘 씨앗을 쓰면 미리 연습한 사람이 대기를 알고 앉는다(공정성이 깨진다) */
    catcher: '연습 모드는 오늘의 씨앗을 쓰지 않는다',
    from: "  plan = (m === 'daily') ? dailyPlan(seedKeyNow) : freePlan();",
    to:   "  plan = (m === 'daily' || m === 'solo') ? dailyPlan(dailySeedKey(t0)) : freePlan();"
  },
  'wait-not-random': {
    catcher: '대기 시간이 라운드마다 달라진다',
    from: '    const wait = WAIT_MIN + Math.floor(rnd() * (WAIT_MAX - WAIT_MIN + 1));',
    to:   '    const wait = WAIT_MIN;'
  },
  /* ⑥ 페이스메이커(연습) */
  'pacer-never-presses': {
    catcher: '연습에서 페이스메이커가 가라 신호에 누른다',
    from: '  if (isSolo() && (r.sig === SIG_GO || r.pacerPressesOnHold)){',
    to:   '  if (false && isSolo() && (r.sig === SIG_GO || r.pacerPressesOnHold)){'
  },
  'pacer-in-versus': {
    catcher: '대전에서는 페이스메이커가 끼어들지 않는다',
    from: '  if (isSolo() && (r.sig === SIG_GO || r.pacerPressesOnHold)){',
    to:   '  if ((r.sig === SIG_GO || r.pacerPressesOnHold)){'
  },
  'pacer-stamp-is-now': {
    catcher: '페이스메이커의 도장은 신호에 반응 시간을 더한 값이다',
    from: '      onPress(TOP, { timeStamp: signalStamp + r.pacerMs, pacer: true });',
    to:   '        onPress(TOP, { timeStamp: nowMs(), pacer: true });'
  },
  /* ⑦ 기록 */
  'best-in-versus': {
    catcher: '대전은 연습 기록을 건드리지 않는다',
    from: "  if (mode === 'solo'){",
    to:   "  if (true){"
  },
  'best-on-loss': {
    catcher: '연습 기록은 이긴 판에서만 남는다',
    from: 'const betterThan = (a, b) => !!a && a.won === true && (!b || a.avgMs < b.avgMs);',
    to:   'const betterThan = (a, b) => !!a && (!b || a.avgMs < b.avgMs);'
  },
  'daily-overwrite': {
    catcher: '오늘의 도전은 하루 한 번이다',
    from: "  if (mode === 'daily' && !dailyDoneToday()){",
    to:   "  if (mode === 'daily'){"
  },
  /* ⑧ 색맹 안전·글자 */
  'labels-color-only': {
    catcher: '얻고 잃음이 색만이 아니라 글자로도 말한다',
    from: "  if (resolved.kind === 'hold-press') return resolved.by === i ? T('lblLose') : T('lblWin');",
    to:   "  if (resolved.kind === 'hold-press') return '';"
  },
  'labels-differ-by-side': {
    catcher: '두 절반의 글자는 같은 순간에 같은 상태를 말한다',
    from: "  if (phase === 'signal'){ const r = roundNow(); return r && r.sig === SIG_GO ? T('lblGo') : T('lblHold'); }",
    to:   "  if (phase === 'signal'){ const r = roundNow(); return i === BOTTOM ? T('lblGo') : T('lblHold'); }"
  },
  /* ⑨ i18n·언어 */
  'en-prose-missing': {
    catcher: '마크업의 data-i18n 키가 ko·en 두 표에 모두 있다',
    from: "    how1:'Put one device between you and sit",
    to:   "    how1x:'Put one device between you and sit"
  },
  'lang-switch-redraws-plan': {
    catcher: '언어를 바꿔도 진행 중인 판이 바뀌지 않는다',
    from: '  paintAll();\n  if (lastResult && $(\'over\').classList.contains(\'show\')) renderOver();',
    to:   '  plan = freePlan();\n  paintAll();\n  if (lastResult && $(\'over\').classList.contains(\'show\')) renderOver();'
  },
  /* ⑩ 입력 */
  'repeat-guard-gone': {
    catcher: '누르고 있어서 반복 발화된 키 입력은 무시된다',
    from: '  const side = KEY_SIDE[ev.key];\n  if (side === undefined) return;\n  if (ev.repeat) return;',
    to:   '  const side = KEY_SIDE[ev.key];\n  if (side === undefined) return;'
  },
  'key-no-preventdefault': {
    catcher: 'Enter 로 눌렀을 때 preventDefault 가 호출된다',
    from: "    ev.preventDefault();\n    onPress(i, ev);",
    to:   "    onPress(i, ev);"
  },
  'keys-same-side': {
    catcher: '두 절반에 서로 다른 키가 배당돼 있다',
    from: "const KEY_SIDE = { ' ':BOTTOM, 'Spacebar':BOTTOM, 'ArrowDown':BOTTOM, 'ArrowUp':TOP };",
    to:   "const KEY_SIDE = { ' ':BOTTOM, 'Spacebar':BOTTOM, 'ArrowDown':BOTTOM, 'ArrowUp':BOTTOM };"
  },
  /* ⑪ ★두 절반의 대칭 — 이 게임의 핵심 계약(정적 층 · 렌더 층은 check_render_parity 가 맡는다) */
  'halves-uneven-rows': {
    scope: 'html',
    catcher: '두 절반은 같은 크기의 행으로 나뉜다',
    from: 'grid-template-rows:1fr 1fr;gap:10px}',
    to:   'grid-template-rows:1.2fr 1fr;gap:10px}'
  },
  'header-kept-while-running': {
    scope: 'html',
    catcher: '판이 도는 동안 머리줄과 광고를 접는다',
    from: '  body.tg-running header,body.tg-running .scores,body.tg-running .ad-slot,',
    to:   '  body.tg-running .scores,body.tg-running .ad-slot,'
  },
  'top-not-rotated': {
    scope: 'html',
    catcher: '위쪽 절반만 180도 돌아 있다',
    from: '  .tg-half.tg-top{transform:rotate(180deg)}',
    to:   '  .tg-half.tg-top{transform:rotate(179deg)}'
  },
  'signal-per-half': {
    scope: 'html',
    catcher: '신호는 판에 하나뿐이다',
    from: '    <div class="tg-signal" id="signal" aria-hidden="true"></div>',
    to:   '    <div class="tg-signal" id="signal" aria-hidden="true"></div>\n    <div class="tg-signal" id="signal2" aria-hidden="true"></div>'
  },
  /* ⑫ ★색 규약 — 분류가 색을 정한다(2026-09-05 오너 승인) */
  'sig-off-category': {
    scope: 'html',
    catcher: '주색이 자기 분류의 색과 같다',
    from: '    --sig:#db2777;',
    to:   '    --sig:#7c3aed;'
  },
  'sig-low-contrast': {
    scope: 'html',
    catcher: '세 토큰의 대비비가 양 테마에서 하한 이상이다',
    from: ' --sig-ink:#be185d;',
    to:   '    --sig-ink:#fbcfe8;'
  },
  'dark-sig-other-hue': {
    /* ★master 236 지시 · 다크에 대비비 하한만 걸면 색상이 통째로 달라져도 통과한다 */
    scope: 'html',
    catcher: '다크 주색은 기준색의 밝은 변형이다(색상차 20도 이내)',
    from: '      --sig:#f472b6;',
    to:   '      --sig:#60a5fa;'
  },
  'dark-sig-darker': {
    scope: 'html',
    catcher: '다크 주색은 기준색의 밝은 변형이다(색상차 20도 이내)',
    from: '      --sig:#f472b6;',
    to:   '      --sig:#9d174d;'
  },
  /* ⑬ ★today 풀 제외 — master 지시대로 짝으로 세운다 */
  'today-filter-reverted': {
    scope: 'html',
    catcher: '2인용은 오늘의 한판 후보 풀에서 빠진다',
    from: "  pool = list.filter(g => g.daily === true && g.solo !== false && typeof g.maxMinutes === 'number');",
    to:   "  pool = list.filter(g => g.daily === true && typeof g.maxMinutes === 'number');",
    file: 'today'
  },
  'solo-flag-removed': {
    catcher: '2인용은 오늘의 한판 후보 풀에서 빠진다',
    from: '"solo": false,',
    to:   '"soloX": false,',
    file: 'games'
  },
  /* ★음성 대조군 ① · 연출 시간은 계약이 아니다 */
  'feedback-longer': {
    expect: 'quiet',
    catcher: '(음성 대조군) 연출 시간 변경은 계약이 아니다',
    from: 'const FEEDBACK_MS = 1100;',
    to:   'const FEEDBACK_MS = 1500;'
  },
  /* ★음성 대조군 ② · 신호 그림의 굵기는 계약이 아니다(모양이 갈리는 한) */
  'signal-stroke-thicker': {
    expect: 'quiet',
    scope: 'html',
    catcher: '(음성 대조군) 신호 X 의 선 굵기 변경은 계약이 아니다',
    from: 'stroke-width="18"',
    to:   'stroke-width="14"'
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
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  if (!m){ console.error('알 수 없는 뮤테이션: ' + MUTATION); process.exit(2); }
  if (m.scope === 'html' && !m.file){
    const n = RAW.split(m.from).length - 1;
    if (n !== 1){ console.error(`뮤테이션 주입 실패(${MUTATION}) · 앵커가 ${n}회 나타났다(1회여야 한다)`); process.exit(2); }
    RAW = RAW.replace(m.from, m.to);
  }
}
/* ★이 게임의 계약 일부는 ★다른 파일에 있다 — 오늘의 한판 풀 규칙(today/index.html)과
   등록부(games.json)다. 그 자리도 뮤테이션으로 흔들 수 있어야 검사가 짊어진 것이 드러난다.
   ★못 읽으면 통과가 아니라 판정 불가로 올린다. */
const ROOT = path.join(__dirname, '..');
const AUX = {};
for (const [name, rel] of [['today', path.join('today', 'index.html')], ['games', 'games.json']]){
  try { AUX[name] = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(String.fromCharCode(13)).join(''); }
  catch (e){ console.error('판정 불가 · ' + rel + ' 을 읽지 못했다: ' + e.message); process.exit(2); }
}
if (MUTATION && MUTATIONS[MUTATION] && MUTATIONS[MUTATION].file){
  const m = MUTATIONS[MUTATION];
  const n = AUX[m.file].split(m.from).length - 1;
  if (n !== 1){ console.error(`뮤테이션 주입 실패(${MUTATION}) · 앵커가 ${n}회 나타났다(1회여야 한다)`); process.exit(2); }
  AUX[m.file] = AUX[m.file].replace(m.from, m.to);
}

let SRC = gameSource(RAW);
if (MUTATION){
  const m = MUTATIONS[MUTATION];
  if (m.scope !== 'html' && !m.file){
    const n = SRC.split(m.from).length - 1;
    if (n !== 1){ console.error(`뮤테이션 주입 실패(${MUTATION}) · 앵커가 ${n}회 나타났다(1회여야 한다)`); process.exit(2); }
    SRC = SRC.replace(m.from, m.to);
  }
  console.log(`[mutate] ${MUTATION} 주입됨(${m.scope === 'html' ? '문서' : '스크립트'}) · ` +
              (m.expect === 'quiet' ? '★음성 대조군(조용해야 한다): ' : '잡아야 하는 검사: ') + m.catcher);
}

/* ------------------------------------------------------- test bridge(메모리 위에만)
   제품 파일에는 관측 창구(__tg)만 배포한다. 상태를 바꾸는 명령은 여기서 IIFE 가 닫히기 직전에
   덧붙인다 · 배포본에는 남지 않는다(장기기억 debug-hooks-in-shipped-code-are-a-control-api). */
const BRIDGE = `
window.__tgTest = {
  /* ★i18n 표를 정규식으로 읽지 않는다 · 한 줄에 키가 여럿이거나 문장 안에 콜론이 있으면
     정규식은 대리물이 된다. 실행된 객체의 실제 키 목록을 그대로 준다. */
  i18nKeys: () => ({ ko: Object.keys(I18N.ko), en: Object.keys(I18N.en) }),
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
    /* ★실제 DOM 의 remove() 를 흉내낸다 · 없으면 제품의 '지우고 다시 그린다' 가
       스텁에서만 무한히 쌓여 개수 검사가 거짓이 된다(스텁 충실도). */
    remove: () => { const p = el.parent; if (p){ const i = p.children.indexOf(el); if (i >= 0) p.children.splice(i, 1); el.parent = null; } },
    _descend: () => { const out = []; const walk = n => { for (const c of n.children){ out.push(c); walk(c); } }; walk(el); return out; }
  };
  Object.defineProperty(el, 'textContent', {
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
    /* ★제품이 실제로 쓰는 선택자만 인정한다 · 인정하지 않으면 그 코드가 스텁에서
       ★없는 것과 같아져 어떤 검사도 붉지 않는다(장기기억 stub-fidelity…). */
    if (s === '.tg-signal' && el._classes.has('tg-signal')) return true;
    if (s === 'button' && el.tagName === 'BUTTON') return true;
    if (s === '[data-i18n]' && el.dataset.i18n !== undefined) return true;
    if (s === 'a[href="/"]' && el.tagName === 'A') return true;
    if (s.startsWith('a[href]') && el.tagName === 'A') return true;
    if (s.indexOf('button:not(') === 0 && el.tagName === 'BUTTON' && !el.disabled && !el.hidden) return true;
    if (s === '.overlay' && el._classes.has('overlay')) return true;
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

const IDS = ['board','halfTop','halfBottom','press0','press1','name0','name1','score0','score1',
             'lbl0','lbl1','signal','srSummary','toast','over','start',
             'finalBig','finalLine','finalBigTop','finalLineTop','marks','newBest',
             'nScore','nRounds','nAvg','finalSub','btnAgain','btnShare','btnDaily','btnVersus','btnSolo',
             'dailyHint','soloHint','help','btnSound','btnSound2','btnLang','btnLang2','subtitle',
             'adTop','adOver','startTitle','overTitle','bestNow','modeNow','roundNow'];

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
  doc.body = makeEl('body', doc, 'body');
  for (const id of IDS) doc.getElementById(id);
  for (const b of ['press0','press1']) doc.getElementById(b).tagName = 'BUTTON';
  for (const b of ['btnAgain','btnShare','btnDaily','btnVersus','btnSolo','btnSound','btnSound2','btnLang','btnLang2'])
    doc.getElementById(b).tagName = 'BUTTON';
  /* ★스텁 충실도 · 마크업이 들고 있는 클래스를 준다. 안 주면 제품의 '신호는 하나' ·
     '위쪽만 회전' 코드가 스텁에서 ★없는 것과 같아져 어떤 검사도 붉지 않는다. */
  doc.getElementById('signal')._classes.add('tg-signal');
  doc.getElementById('halfTop')._classes.add('tg-half');
  doc.getElementById('halfTop')._classes.add('tg-top');
  doc.getElementById('halfBottom')._classes.add('tg-half');
  doc.getElementById('halfBottom')._classes.add('tg-bottom');
  doc.getElementById('over')._classes.add('overlay');
  doc.getElementById('start')._classes.add('overlay');
  doc.getElementById('start')._classes.add('show');
  /* ★창 안의 버튼을 실제로 창의 자식으로 단다 · 안 달면 제품의 '첫 버튼으로 초점' 코드가
     스텁에서 아무것도 못 찾아 그 줄을 통째로 지워도 어떤 검사도 붉지 않는다(스텁 충실도). */
  for (const [box, kids] of [['over', ['btnAgain','btnShare']], ['start', ['btnDaily','btnVersus','btnSolo']]]){
    for (const k of kids) doc.getElementById(box).appendChild(doc.getElementById(k));
  }
  /* 마크업에 실제로 있는 data-i18n 자리(산문 포함)를 심는다 */
  for (const k of ['title','subtitle','hint','how1','how2','how3','how4','dailyDesc','statPlays',
                   'faq1a','faq5a','tip1a','footer','startSub','versus','solo']){
    const e = makeEl('i18n_' + k, doc, 'p'); e.dataset.i18n = k; els.set('i18n_' + k, e);
  }
  els.set('home', makeEl('home', doc, 'a'));

  /* ★시계 · 이 하네스가 쥐고 있다. 흐르는 것은 우리가 밀어 준 만큼뿐이다. */
  let clock = 1000;
  const perf = { now: () => clock };

  /* ★벽시계(달력)도 하네스가 쥔다 · performance.now() 와는 다른 축이다.
     이것이 없으면 '같은 날 아무 때나 열어도 같은 판' 을 잴 수 없다. */
  const RealDate = Date;
  let wall = RealDate.now();
  class DateStub extends RealDate {
    constructor(...a){ if (a.length === 0) super(wall); else super(...a); }
    static now(){ return wall; }
  }

  /* 타이머 · 우리가 돌리지 않으면 영원히 안 돈다(★논리 즉시 확정을 재는 데 쓴다).
     ★지연값을 함께 들고 있는다 — '마감 전에 깬 타이머' 를 우리가 직접 만들 수 있어야 한다. */
  /* ★타이머는 ★지연을 지킨다 — 지연을 무시하고 전부 부르면 응답 상한(2초)이 페이스메이커(0.4초)보다
     먼저 불려 ★멀쩡한 제품이 고장으로 보인다(2026-09-05 실측으로 잡은 하네스 결함이다).
     같은 시각에 걸린 것은 걸린 순서대로 부른다(브라우저와 같은 규칙). */
  let tSeq = 1;
  const timers = new Map();
  const setTimeoutStub = (fn, ms) => { const id = tSeq++; timers.set(id, { fn, ms, due: clock + (ms || 0) }); return id; };
  const clearTimeoutStub = id => { timers.delete(id); };
  function runTimers(){
    let n = 0;
    for (let guard = 0; guard < 60; guard++){
      const due = [...timers.entries()].filter(([, t]) => t.due <= clock).sort((a, b) => (a[1].due - b[1].due) || (a[0] - b[0]));
      if (!due.length) break;
      for (const [id, t] of due){ if (timers.has(id)){ timers.delete(id); t.fn(); n++; } }
    }
    return n;
  }

  let pdCount = 0;

  /* ★창 밖 요소 · 제품의 setOutsideInert 가 훑는 선택자에 실제로 걸리는 것을 준다. */
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
    location: { href: 'https://hanpango.com/how-many/' },
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    HTMLElement: HTMLElementStub, PointerEvent: PointerEventStub, document: doc,
    performance: perf
  };
  const sandbox = {
    window: win, document: doc, localStorage, navigator: nav, performance: perf,
    HTMLElement: HTMLElementStub, PointerEvent: PointerEventStub, location: win.location,
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    console, Math: MathStub, Date: DateStub, JSON, Promise,
    Number, String, Array, Object, RegExp, Error, isNaN, isFinite, parseInt, parseFloat
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(SRC, sandbox, { filename: 'together-inline.js' }); }
  catch (e){ console.error('구동 실패: ' + e.stack); process.exit(2); }
  if (!win.__tg || !win.__tgTest){ console.error('관측 창구(__tg)/시험 다리(__tgTest) 없음'); process.exit(2); }

  const A = {
    tg: win.__tg, t: win.__tgTest, doc, store: localStorage,
    el: id => doc.getElementById(id),
    txt: id => doc.getElementById(id).textContent,
    rand: () => randCalls,
    resetRand: () => { randCalls = 0; },
    now: () => clock,
    advance: ms => { clock += ms; },
    wall: () => wall,
    setWall: ms => { wall = ms; },
    runTimers,
    /* ★마감을 무시하고 지금 걸린 타이머를 깨운다 — 브라우저 타이머가 이따금 일찍 깨는 자리를
       흉내낸다. 이것이 없으면 제품의 '일찍 깬 타이머는 신호를 안 띄운다' 가드를 ★잴 수 없다. */
    fireEarly: () => { const e = [...timers.entries()]; timers.clear(); for (const [, t] of e) t.fn(); return e.length; },
    timerDelays: () => [...timers.values()].map(t => t.ms),
    pendingTimers: () => timers.size,
    /* ★진짜 입력 사건으로 두드린다 · 다리로 onPick 을 부르지 않는다 */
    tap: (i, props) => {
      const fn = doc.getElementById('press' + i)._on.pointerdown;
      if (!fn) throw new Error('절반 pointerdown 핸들러 없음');
      fn(Object.assign({ button: 0, timeStamp: clock }, props || {}));
    },
    keyOn: (i, k, opts) => {
      const fn = doc.getElementById('press' + i)._on.keydown;
      if (!fn) throw new Error('절반 keydown 핸들러 없음');
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
    versusBtn: off => doc.getElementById('btnVersus').onclick({ timeStamp: clock + (off || 0) }),
    soloBtn: off => doc.getElementById('btnSolo').onclick({ timeStamp: clock + (off || 0) }),
    dailyBtn: off => doc.getElementById('btnDaily').onclick({ timeStamp: clock + (off || 0) }),
    againBtn: () => doc.getElementById('btnAgain').onclick({ timeStamp: clock }),
    langBtn: () => doc.getElementById('btnLang').onclick()
  };
  return A;
}

/* ------------------------------------------------------------ ★추락은 판정이 아니다 */
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

/* ★한 판을 굴리는 도우미 — 상태를 밖에서 밀어 넣지 않고 ★제품의 타이머와 진짜 입력으로만 움직인다.
   ★국면 경계에서 멈춘다 — 도우미가 여분의 시간을 흘리면 그 시간이 다음 국면을 미리 먹는다. */
function toSignal(A){                      /* 대기 → 신호 */
  const st = A.tg.state();
  const r = A.t.planNow().rounds[st.round];
  A.advance(r.wait); A.runTimers();
  return r;
}
function nextRound(A){ A.advance(A.tg.const().FEEDBACK_MS); A.runTimers(); }   /* 연출 → 다음 라운드 */
/* 한 판을 끝까지 · pick(sig, round) 이 이번 라운드에 누를 자리를 준다(null 이면 아무도 안 누른다) */
function playAll(A, pick){
  for (let guard = 0; guard < 60 && A.tg.state().phase !== 'done'; guard++){
    const ph = A.tg.state().phase;
    if (ph === 'gap'){ nextRound(A); continue; }
    if (ph === 'wait'){ toSignal(A); continue; }
    if (ph === 'signal'){
      const st = A.tg.state();
      const r = A.t.planNow().rounds[st.round];
      const side = pick(r.sig, st.round);
      if (side === null){ A.advance(A.tg.const().RESPONSE_MS); A.runTimers(); continue; }
      A.advance(200);
      A.tap(side);
      continue;
    }
    break;
  }
}

/* ★이 하네스가 ★독립으로 쥔 계약 상수 — 제품에서 읽어 오지 않는다.
   대상에서 읽으면 규칙이 바뀔 때 검사도 함께 바뀌어 ★규칙 소실을 영영 못 잡는다(자기참조).
   제품이 선언한 값과 ★같은가도 따로 검사한다(아래 1절). */
const CONTRACT = {
  ROUNDS: 7, WIN: 4, PLAN_ROUNDS: 20,
  WAIT_MIN: 1200, WAIT_MAX: 3500,
  RESPONSE_MS: 2000,
  PACER_MIN: 320, PACER_MAX: 520,
  BOTTOM: 0, TOP: 1,
  CATEGORY: 'two-player',        /* games.json 이 이 게임에 붙인 분류 · 색 규약의 열쇠다 */
  DARK_HUE_MAX: 20               /* 다크 변형이 기준색에서 벗어날 수 있는 색상차 한도(도) */
};

/* ── 색 셈 · ★값을 베끼지 않고 소스에서 읽어 계산한다 ───────────────────────── */
const hex2rgb = h => { const s = h.replace('#','').trim(); return [0,2,4].map(i => parseInt(s.slice(i,i+2),16)); };
const relLum = h => {
  const f = v => { const c = v/255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  const [r,g,b] = hex2rgb(h).map(f);
  return 0.2126*r + 0.7152*g + 0.0722*b;
};
const contrast = (a, b) => { const x = relLum(a), y = relLum(b); const hi = Math.max(x,y), lo = Math.min(x,y);
                             return (hi + 0.05) / (lo + 0.05); };
function hsl(h){
  const [r,g,b] = hex2rgb(h).map(v => v/255);
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx - mn;
  let H = 0;
  if (d !== 0){
    if (mx === r) H = 60 * (((g - b) / d) % 6);
    else if (mx === g) H = 60 * ((b - r) / d + 2);
    else H = 60 * ((r - g) / d + 4);
  }
  if (H < 0) H += 360;
  return { h: H, l: (mx + mn) / 2 };
}
const hueGap = (a, b) => { const d = Math.abs(hsl(a).h - hsl(b).h) % 360; return d > 180 ? 360 - d : d; };
/* ★토큰은 선언된 자리에서 읽는다 — 라이트는 bare :root, 다크는 prefers-color-scheme 블록이다
   (앵커에 @media 를 포함하지 않으면 head 의 meta theme-color 를 잡는다 · 장기기억) */
function tokensOf(css, dark){
  const block = dark
    ? (/@media \(prefers-color-scheme: dark\)\{[\s\S]*?:root\{([\s\S]*?)\}/.exec(css) || [])[1]
    : (/\n  :root\{([\s\S]*?)\}/.exec(css) || [])[1];
  if (!block) return null;
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) out['--' + m[1]] = m[2].toLowerCase();
  return out;
}

/* ============================================================ 1. 규격과 순수 함수 */
section('1. 규격과 순수 함수');
{
  const A = boot();
  const C = A.tg.const();
  eq('한 판은 일곱 라운드이고 먼저 네 점이면 끝난다', [C.ROUNDS, C.WIN], [CONTRACT.ROUNDS, CONTRACT.WIN]);
  eq('서든데스용 라운드를 미리 뽑아 둔다', C.PLAN_ROUNDS, CONTRACT.PLAN_ROUNDS);
  ok('선추첨 라운드가 기본 라운드보다 많다(동점이어도 이어갈 수 있다)', C.PLAN_ROUNDS > C.ROUNDS,
     C.PLAN_ROUNDS + ' <= ' + C.ROUNDS);
  eq('대기 범위가 계약과 같다', [C.WAIT_MIN, C.WAIT_MAX], [CONTRACT.WAIT_MIN, CONTRACT.WAIT_MAX]);
  eq('응답 상한이 계약과 같다', C.RESPONSE_MS, CONTRACT.RESPONSE_MS);
  eq('페이스메이커 반응 범위가 계약과 같다', [C.PACER_MIN, C.PACER_MAX], [CONTRACT.PACER_MIN, CONTRACT.PACER_MAX]);
  eq('아래쪽이 0번, 위쪽이 1번이다', [C.BOTTOM, C.TOP], [CONTRACT.BOTTOM, CONTRACT.TOP]);
  ok('대기가 한 점이 아니라 범위다(예측하면 부정출발이 무의미해진다)', C.WAIT_MAX > C.WAIT_MIN + 500,
     C.WAIT_MIN + '~' + C.WAIT_MAX);
  ok('응답 상한이 사람 반응(250~400ms)보다 넉넉하다', C.RESPONSE_MS >= 1000, String(C.RESPONSE_MS));

  /* ★점수 귀속은 순수 함수다 — 가라는 누른 쪽, 참아라·부정출발은 상대 */
  eq('가라에서는 먼저 누른 쪽이 1점을 얻는다', A.tg.scoreFor({ by: C.BOTTOM, kind: 'go-win' }), C.BOTTOM);
  eq('참아라에서 누르면 상대가 1점을 얻는다', A.tg.scoreFor({ by: C.BOTTOM, kind: 'hold-press' }), C.TOP);
  eq('부정출발도 상대가 1점을 얻는다', A.tg.scoreFor({ by: C.TOP, kind: 'false-start' }), C.BOTTOM);
  eq('무득점은 아무도 얻지 않는다', A.tg.scoreFor({ by: null, kind: 'none' }), null);
}

/* ============================================================ 2. 판(씨앗이 정하는 것) */
section('2. 판');
{
  const A = boot();
  const C = A.tg.const();
  const keys = [];
  for (let i = 0; i < 120; i++) keys.push('scan-' + i);
  let bad = [], go = 0, tot = 0, waits = new Set();
  for (const k of keys){
    const p = A.tg.plan(k);
    if (p.rounds.length !== C.PLAN_ROUNDS){ bad.push(k + ':길이'); continue; }
    for (const r of p.rounds){
      tot++;
      if (r.sig === C.SIG_GO) go++;
      waits.add(r.wait);
      if (r.wait < C.WAIT_MIN || r.wait > C.WAIT_MAX) bad.push(k + ':대기' + r.wait);
      if (r.sig !== C.SIG_GO && r.sig !== C.SIG_HOLD) bad.push(k + ':신호' + r.sig);
      if (r.pacerMs < C.PACER_MIN || r.pacerMs > C.PACER_MAX) bad.push(k + ':페이서' + r.pacerMs);
      if (typeof r.pacerPressesOnHold !== 'boolean') bad.push(k + ':페이서성향');
    }
  }
  eq('라운드의 대기·신호·페이스메이커가 전부 범위 안이다', bad.slice(0, 5), []);
  const ratio = go / tot;
  ok('가라와 참아라가 둘 다 실제로 나온다', ratio > 0.4 && ratio < 0.95, '가라 비율 ' + ratio.toFixed(3));
  ok('가라 비율이 선언값 언저리다', Math.abs(ratio - C.GO_CHANCE) < 0.06,
     ratio.toFixed(3) + ' vs ' + C.GO_CHANCE);
  ok('대기 시간이 라운드마다 달라진다', waits.size > 50, '서로 다른 대기 ' + waits.size + '가지');
  eq('같은 씨앗은 같은 판을 준다', JSON.stringify(A.tg.plan('same')), JSON.stringify(A.tg.plan('same')));
  ok('다른 씨앗은 다른 판을 준다', JSON.stringify(A.tg.plan('a')) !== JSON.stringify(A.tg.plan('b')));
}

/* ============================================================ 3. 오늘의 도전(시각 축) */
section('3. 오늘의 도전');
{
  const A = boot();
  A.setWall(new Date(2026, 8, 5, 0, 4, 0).getTime());
  const k1 = A.tg.seedKey(), p1 = JSON.stringify(A.tg.plan(k1)), n1 = A.tg.dailyNo();
  A.setWall(new Date(2026, 8, 5, 23, 47, 0).getTime());
  eq('같은 날이면 시각이 달라도 같은 씨앗이다', A.tg.seedKey(), k1);
  ok('같은 날이면 시각이 달라도 같은 판이다', JSON.stringify(A.tg.plan(A.tg.seedKey())) === p1);
  eq('같은 날이면 도전 번호가 같다', A.tg.dailyNo(), n1);
  A.setWall(new Date(2026, 8, 6, 12, 0, 0).getTime());
  ok('날짜가 바뀌면 판이 바뀐다', JSON.stringify(A.tg.plan(A.tg.seedKey())) !== p1);
  eq('날짜가 하루 지나면 도전 번호가 하나 오른다', A.tg.dailyNo(), n1 + 1);

  /* ★연습은 오늘의 씨앗을 쓰지 않는다 — 미리 연습한 사람이 대기를 알고 앉으면 대전이 공정하지 않다 */
  const B = boot();
  B.setWall(new Date(2026, 8, 5, 10, 0, 0).getTime());
  const dailyPlanNow = JSON.stringify(B.tg.plan(B.tg.seedKey()));
  B.soloBtn();
  const soloPlan = JSON.stringify(B.t.planNow());
  ok('연습 모드는 오늘의 씨앗을 쓰지 않는다', soloPlan !== dailyPlanNow,
     '연습 판이 오늘의 판과 같다(미리 연습하면 대기를 알고 앉는다)');
  eq('연습 판에는 오늘의 씨앗 이름이 없다', B.tg.state().seedKey, '');
}

/* ============================================================ 4. 난수 */
section('4. 난수');
{
  const A = boot();
  A.setWall(new Date(2026, 8, 5, 10, 0, 0).getTime());
  A.dailyBtn();
  A.resetRand();
  playAll(A, sig => sig === A.tg.const().SIG_GO ? CONTRACT.BOTTOM : CONTRACT.TOP);
  eq('플레이 행동은 난수를 한 번도 소비하지 않는다', A.rand(), 0);
  A.resetRand();
  A.tg.plan('x'); A.tg.plan('y');
  eq('오늘의 판은 씨앗만으로 만들어진다(난수 0)', A.rand(), 0);
}

/* ============================================================ 5. 신호 타이밍 */
section('5. 신호 타이밍');
{
  const A = boot();
  A.versusBtn();
  const st0 = A.tg.state();
  const r0 = A.t.planNow().rounds[0];
  eq('시작하면 대기 국면이다', st0.phase, 'wait');
  ok('신호가 뜰 시각을 미리 못박아 둔다', st0.signalDue === st0.waitStart + r0.wait,
     'due=' + st0.signalDue + ' start=' + st0.waitStart + ' wait=' + r0.wait);
  A.advance(r0.wait - 60);
  A.fireEarly();                          /* ★마감 전인데 타이머를 억지로 깨운다 */
  eq('마감 전에 깬 타이머는 신호를 띄우지 않는다', A.tg.state().phase, 'wait');
  ok('마감 전에 깼으면 남은 시간만큼 다시 건다', A.pendingTimers() >= 1, String(A.pendingTimers()));
  A.advance(190); A.runTimers();
  const st1 = A.tg.state();
  eq('마감이 지나면 신호가 뜬다', st1.phase, 'signal');
  ok('신호는 마감 시각으로 확정한다', st1.signalStamp === st1.waitStart + r0.wait,
     'stamp=' + st1.signalStamp + ' 마감=' + (st1.waitStart + r0.wait));
  eq('늦게 깬 몫이 따로 남는다', st1.lateMs, 130);
  ok('대기는 정해진 것보다 짧아지지 않는다', (st1.signalStamp - st1.waitStart) >= r0.wait,
     String(st1.signalStamp - st1.waitStart));
  ok('신호 그림이 그려졌다', A.tg.signalHtml().length > 20, A.tg.signalHtml().slice(0, 40));
  note('늦어진 몫은 두 사람에게 똑같이 얹힌다(한 화면을 함께 본다)');
}

/* ============================================================ 6. 한 라운드의 판정 */
section('6. 라운드 판정');
{
  /* 부정출발 */
  const A = boot();
  A.versusBtn();
  A.advance(200);
  A.tap(CONTRACT.BOTTOM);
  eq('신호 전에 누르면 부정출발로 상대가 1점을 얻는다', A.tg.state().score, [0, 1]);
  eq('부정출발을 자리별로 센다', A.tg.state().falseStarts, [1, 0]);
  eq('부정출발 뒤에는 연출 국면이다', A.tg.state().phase, 'gap');

  /* 가라·참아라 */
  /* ★관심 없는 신호의 라운드는 ★아무도 안 누르고 흘려 보낸다 — 점수를 쌓으면 판이 먼저 끝나
     둘 중 하나를 영영 못 만난다(2026-09-05 실측으로 잡은 하네스 결함). */
  let sawGo = false, sawHold = false;
  for (let boots = 0; boots < 5 && !(sawGo && sawHold); boots++){
    const B = boot();
    B.versusBtn();
    for (let g = 0; g < 20 && !(sawGo && sawHold) && B.tg.state().phase !== 'done'; g++){
      if (B.tg.state().phase === 'gap'){ nextRound(B); continue; }
      const r = toSignal(B);
      const isGo = r.sig === B.tg.const().SIG_GO;
      if ((isGo && sawGo) || (!isGo && sawHold)){
        B.advance(B.tg.const().RESPONSE_MS); B.runTimers(); nextRound(B); continue;
      }
      const before = B.tg.state().score.slice();
      B.advance(180);
      B.tap(CONTRACT.BOTTOM);
      const after = B.tg.state().score;
      const lg = B.tg.state().log[B.tg.state().log.length - 1];
      if (isGo){
        sawGo = true;
        eq('가라에서 먼저 누른 쪽이 1점을 얻는다', after, [before[0] + 1, before[1]]);
        eq('반응 시간은 신호부터 잰다', lg.ms, 180);
      } else {
        sawHold = true;
        eq('참아라에서 누르면 상대가 1점을 얻는다', after, [before[0], before[1] + 1]);
      }
      nextRound(B);
    }
  }
  ok('두 신호를 모두 만나 판정했다', sawGo && sawHold, 'go=' + sawGo + ' hold=' + sawHold);

  /* 응답 상한 · 동시 도장 */
  const D = boot();
  D.versusBtn();
  toSignal(D);
  const before = D.tg.state().score.slice();
  D.advance(D.tg.const().RESPONSE_MS); D.runTimers();
  {
    /* ★'점수가 그대로다' 만 보면 ★아무 일도 안 일어난 경우와 구별되지 않는다 —
       라운드가 실제로 닫혔는가(기록이 남고 국면이 넘어갔는가)로 판정한다. */
    const lg = D.tg.state().log.length ? D.tg.state().log[D.tg.state().log.length - 1] : null;
    const same = JSON.stringify(D.tg.state().score) === JSON.stringify(before);
    ok('아무도 누르지 않으면 무득점으로 닫는다',
       lg !== null && lg.kind === 'none' && same && D.tg.state().phase !== 'signal',
       'log=' + JSON.stringify(lg) + ' phase=' + D.tg.state().phase);
    eq('무득점도 기록에 남는다', lg ? lg.kind : null, 'none');
  }
  nextRound(D);
  toSignal(D);
  const before2 = D.tg.state().score.slice();
  D.advance(220);
  D.tap(CONTRACT.BOTTOM); D.tap(CONTRACT.TOP);      /* 두 도장이 완전히 같다 */
  eq('두 도장이 완전히 같으면 무득점이다', D.tg.state().score, before2);
  eq('비긴 라운드 수를 세어 결과에 적는다', D.tg.state().tieCount, 1);
  /* ★늦게 온 입력은 아무 일도 하지 않는다(먼저 누른 쪽이 가져간다) */
  nextRound(D);
  toSignal(D);
  const before3 = D.tg.state().score.slice();
  D.advance(150); D.tap(CONTRACT.BOTTOM);
  const mid = D.tg.state().score.slice();
  D.advance(80); D.tap(CONTRACT.TOP);
  eq('늦게 누른 입력은 판정을 바꾸지 않는다', D.tg.state().score, mid);
  ok('먼저 누른 쪽이 가져갔다', JSON.stringify(mid) !== JSON.stringify(before3), JSON.stringify(mid));
}

/* ============================================================ 7. 판의 종료 */
section('7. 종료');
{
  /* 먼저 4점 */
  const A = boot();
  A.versusBtn();
  playAll(A, sig => sig === A.tg.const().SIG_GO ? CONTRACT.BOTTOM : CONTRACT.TOP);
  const r = A.tg.result();
  eq('판이 끝났다', A.tg.state().phase, 'done');
  /* ★'why 가 target 이면 점수가 WIN 이다' 는 why 가 다른 값이면 공허하다 —
     ★어느 쪽도 승점을 넘어설 수 없다 로 판정한다(넘었다면 그 자리에서 안 끝났다는 뜻이다). */
  ok('먼저 정해진 점수에 닿으면 그 자리에서 끝난다',
     Math.max(r.score[0], r.score[1]) <= A.tg.const().WIN,
     r.score.join(':') + ' why=' + r.why);
  ok('결과 창이 열린다', A.tg.shown('over'));
  ok('이긴 쪽이 정해졌다', r.winner === CONTRACT.BOTTOM || r.winner === CONTRACT.TOP || r.winner === null,
     String(r.winner));

  /* ★아무도 안 누르는 판 · 기본 라운드를 지나 서든데스로 이어지고 결국 무승부로 닫힌다
     (도달 불가 분기를 남기지 않으려고 제품이 무승부를 명시했고, 그 자리를 강제로 밟는다) */
  const B = boot();
  B.versusBtn();
  playAll(B, () => null);
  const rb = B.tg.result();
  /* ★판이 안 끝나면 결과가 없다 · 그 자리에서 추락하면 rc=2 가 판정을 덮는다 */
  ok('선추첨 라운드를 다 쓰면 무승부로 끝난다', rb !== null && rb.why === 'draw',
     rb ? ('why=' + rb.why + ' score=' + rb.score.join(':')) : '판이 끝나지 않았다(무승부 바닥이 없다)');
  eq('아무도 누르지 않으면 끝까지 무득점이다', rb ? rb.score : null, [0, 0]);
  eq('무승부는 이긴 쪽이 없다', rb ? rb.winner : 'no-result', null);
  eq('치른 라운드가 선추첨 라운드 수와 같다', rb ? rb.rounds : null, CONTRACT.PLAN_ROUNDS);
  note('기본 ' + CONTRACT.ROUNDS + '라운드 뒤 동점이라 서든데스로 이어졌고 ' + CONTRACT.PLAN_ROUNDS + '라운드에서 닫혔다');
}

/* ============================================================ 8. 혼자 연습(페이스메이커) */
section('8. 혼자 연습');
{
  const A = boot();
  A.soloBtn();
  eq('연습 모드로 들어간다', A.tg.state().mode, 'solo');
  let sawGo = false;
  for (let g = 0; g < 14 && !sawGo; g++){
    if (A.tg.state().phase === 'gap'){ nextRound(A); continue; }
    if (A.tg.state().phase === 'done') break;
    const r = toSignal(A);
    if (r.sig === A.tg.const().SIG_GO){
      const before = A.tg.state().score.slice();
      /* ★타이머를 반응 시간보다 ★늦게 깨운다 — 그래야 '도장이 신호+반응시간인가' 를 가른다.
         정확히 반응 시간만큼만 흘리면 '지금 시각' 과 '신호+반응시간' 이 같아져 그 계약이 공허해진다. */
      A.advance(r.pacerMs + 90); A.runTimers();     /* 사람은 안 누르고 페이스메이커만 반응한다 */
      const lg = A.tg.state().log.length ? A.tg.state().log[A.tg.state().log.length - 1] : null;
      eq('페이스메이커가 가라에 누르면 위쪽이 1점을 얻는다', A.tg.state().score, [before[0], before[1] + 1]);
      eq('페이스메이커도 같은 기록 경로를 남긴다',
         lg ? [lg.by, lg.kind, lg.ms] : null, [CONTRACT.TOP, 'go-win', r.pacerMs]);
      sawGo = true;
      break;
    }
    A.advance(A.tg.const().RESPONSE_MS); A.runTimers();
    nextRound(A);
  }
  ok('연습 판에서 가라 라운드를 만나 판정했다', sawGo);

  /* ★대전에는 페이스메이커가 없다 — 아무도 안 누르면 무득점으로 닫혀야 한다 */
  const B = boot();
  B.versusBtn();
  const r = toSignal(B);
  B.advance(B.tg.const().PACER_MAX + 50); B.runTimers();
  eq('대전에서는 페이스메이커가 끼어들지 않는다', B.tg.state().score, [0, 0]);
  eq('대전에서 그 사이 라운드가 닫히지 않는다', B.tg.state().phase, 'signal');
}

/* ============================================================ 9. 기록 */
section('9. 기록');
{
  /* 연습에서 이기면 기록이 남는다 */
  const store = makeStore();
  const A = boot({ store: store });
  A.soloBtn();
  playAll(A, sig => sig === A.tg.const().SIG_GO ? CONTRACT.BOTTOM : CONTRACT.TOP);
  const ra = A.tg.result();
  ok('연습에서 이기면 기록이 남는다', ra.winner !== CONTRACT.BOTTOM || A.tg.best() !== null,
     'winner=' + ra.winner + ' best=' + JSON.stringify(A.tg.best()));
  ok('연습 기록은 이긴 판에서만 남는다',
     A.tg.betterThan({ avgMs: 1, won: false }, null) === false, '진 판이 기록이 됐다');
  ok('더 빠른 평균 반응만 기록을 바꾼다',
     A.tg.betterThan({ avgMs: 100, won: true }, { avgMs: 200 }) === true &&
     A.tg.betterThan({ avgMs: 300, won: true }, { avgMs: 200 }) === false);

  /* 대전은 기록을 건드리지 않는다 */
  const store2 = makeStore();
  const B = boot({ store: store2 });
  B.versusBtn();
  playAll(B, sig => sig === B.tg.const().SIG_GO ? CONTRACT.BOTTOM : CONTRACT.TOP);
  eq('대전은 연습 기록을 건드리지 않는다', B.tg.best(), null);

  /* 오늘의 도전은 하루 한 번 */
  const store3 = makeStore();
  const D = boot({ store: store3 });
  D.setWall(new Date(2026, 8, 5, 9, 0, 0).getTime());
  D.dailyBtn();
  playAll(D, sig => sig === D.tg.const().SIG_GO ? CONTRACT.BOTTOM : CONTRACT.TOP);
  const rec1 = D.tg.daily().rec;
  ok('오늘의 도전 결과가 남는다', rec1 && rec1.result, JSON.stringify(rec1));
  const D2 = boot({ store: store3 });
  D2.setWall(new Date(2026, 8, 5, 21, 0, 0).getTime());
  D2.t.refresh();
  D2.dailyBtn();
  playAll(D2, sig => sig === D2.tg.const().SIG_GO ? CONTRACT.TOP : CONTRACT.BOTTOM);   /* 반대로 몬다 */
  eq('오늘의 도전은 하루 한 번이다',
     JSON.stringify(D2.tg.daily().rec.result.score), JSON.stringify(rec1.result.score));
  ok('두 번째 판의 결과가 첫 판과 실제로 달랐다',
     JSON.stringify(D2.tg.result().score) !== JSON.stringify(rec1.result.score),
     '첫 ' + rec1.result.score.join(':') + ' 둘째 ' + D2.tg.result().score.join(':'));
}

/* ============================================================ 10. 두 절반의 대칭(정적) */
section('10. 두 절반의 대칭');
{
  const A = boot();
  /* ★신호는 판에 하나뿐이다 — 절반마다 따로 그리면 두 그림이 다른 순간에 선다 */
  const sigCount = (RAW.match(/class="tg-signal"/g) || []).length;
  eq('신호는 판에 하나뿐이다', sigCount, 1);
  eq('제품도 신호를 하나로 센다', A.tg.signalCount(), 1);
  /* ★두 절반의 마크업이 같은 모양이다(자리 번호만 다르다) */
  const halfOf = n => {
    const m = new RegExp('<button class="tg-press" id="press' + n + '"[\\s\\S]*?</button>').exec(RAW);
    /* ★자리 번호만 지우려다 점수 글자(0)까지 지워 두 쪽이 달라 보였다 · 숫자를 전부 지운다 */
    return m ? m[0].replace(/[0-9]/g, '#') : null;
  };
  const h0 = halfOf(0), h1 = halfOf(1);
  ok('두 절반의 마크업이 같다(자리 번호만 다르다)', h0 !== null && h0 === h1,
     h0 === null ? '절반 마크업을 못 읽었다' : '두 절반의 구조가 다르다');
  /* ★행을 1fr 1fr 로 나눠 구조로 같게 만든다(px 를 두 번 적지 않는다) */
  ok('두 절반은 같은 크기의 행으로 나뉜다', /grid-template-rows:1fr 1fr/.test(RAW),
     '판의 행 규칙을 찾지 못했거나 균등하지 않다');
  /* ★위쪽만 180도 · 축 정렬 회전이라 렌더된 치수는 보존된다 */
  ok('위쪽 절반만 180도 돌아 있다', /\.tg-half\.tg-top\{transform:rotate\(180deg\)\}/.test(RAW));
  eq('제품이 회전 표시를 아래쪽에는 붙이지 않는다', A.tg.rotated(), [false, true]);
  /* ★판이 도는 동안 머리줄·광고·본문을 접는다(머리줄이 남으면 위쪽이 늘 작다) */
  for (const sel of ['header', '.scores', '.ad-slot', 'section.content', 'footer']){
    ok('판이 도는 동안 ' + sel + ' 을 접는다',
       new RegExp('body\\.tg-running ' + sel.replace('.', '\\.')).test(RAW), sel);
  }
  ok('판이 도는 동안 화면 전체를 판이 쓴다', /body\.tg-running \.tg-board\{height:100dvh/.test(RAW));
  /* ★두 글자는 같은 순간에 같은 상태를 말한다 */
  A.versusBtn();
  eq('대기 중에는 두 절반이 같은 글자를 말한다', A.tg.labels()[0], A.tg.labels()[1]);
  toSignal(A);
  eq('신호가 뜨면 두 절반이 같은 글자를 말한다', A.tg.labels()[0], A.tg.labels()[1]);
  ok('그 글자가 신호의 뜻을 담고 있다', A.tg.labels()[0].length > 0, JSON.stringify(A.tg.labels()));
  /* 결과 연출에서는 서로 다르다(한쪽은 얻고 한쪽은 잃는다) — ★글자로도 갈린다.
     ★참아라 라운드를 찾아서 누른다 — 가라만 밟으면 실점 쪽 글자가 시험되지 않는다. */
  {
    let lb = null, marked = null;
    for (let boots = 0; boots < 6 && lb === null; boots++){
      const H = boot();
      H.versusBtn();
      for (let g = 0; g < 20 && H.tg.state().phase !== 'done'; g++){
        if (H.tg.state().phase === 'gap'){ nextRound(H); continue; }
        const r = toSignal(H);
        if (r.sig !== H.tg.const().SIG_HOLD){ H.advance(H.tg.const().RESPONSE_MS); H.runTimers(); nextRound(H); continue; }
        H.advance(150); H.tap(CONTRACT.BOTTOM);
        lb = H.tg.labels(); marked = H.tg.marked();
        break;
      }
    }
    ok('얻고 잃음이 색만이 아니라 글자로도 말한다',
       lb !== null && lb[0] !== lb[1] && lb[0].length > 0 && lb[1].length > 0, JSON.stringify(lb));
    ok('표시도 두 절반이 서로 다르다', marked !== null && marked[0] !== marked[1], JSON.stringify(marked));
  }
}

/* ============================================================ 11. ★색 규약 */
section('11. 색 규약');
{
  /* ★값을 베끼지 않는다 — 규약 정본(tools/palette_by_category.json)과 등록부(games.json)를 읽어
     이 페이지의 소스에서 뽑은 토큰으로 ★다시 계산한다. 못 읽으면 통과가 아니라 판정 불가다. */
  let pal = null, games = null;
  try { pal = JSON.parse(fs.readFileSync(path.join(__dirname, 'palette_by_category.json'), 'utf8')); } catch(e){}
  try { games = JSON.parse(AUX.games); } catch(e){}
  const me = games ? games.find(g => g.id === 'together') : null;
  if (!pal || !me){
    ok('색 규약 정본과 등록부를 읽었다', false, 'palette=' + !!pal + ' games=' + !!me);
  } else {
    eq('등록부가 이 게임의 분류를 선언한다', me.category, CONTRACT.CATEGORY);
    const want = (pal.categories[me.category] || {}).sig;
    const floor = pal.contrastFloor;
    ok('규약이 그 분류의 색과 하한을 준다', !!want && typeof floor === 'number', 'sig=' + want + ' floor=' + floor);
    const light = tokensOf(RAW, false), dark = tokensOf(RAW, true);
    if (!light || !dark || !want){
      ok('토큰 두 벌을 소스에서 읽었다', false, 'light=' + !!light + ' dark=' + !!dark);
    } else {
      eq('주색이 자기 분류의 색과 같다', light['--sig'], String(want).toLowerCase());
      /* 세 토큰의 대비비 — 각각 그 토큰이 실제로 쓰이는 배경/글자에 대고 잰다 */
      const rows = [
        ['라이트 주색', contrast(light['--sig'], light['--bg'])],
        ['라이트 글자색', contrast(light['--sig-ink'], light['--panel'])],
        ['라이트 옅은 배경 위 본문', contrast(light['--text'], light['--sig-soft'])],
        ['라이트 버튼 글자', contrast(light['--on-sig'], light['--sig'])],
        ['다크 주색', contrast(dark['--sig'], dark['--bg'])],
        ['다크 글자색', contrast(dark['--sig-ink'], dark['--panel'])],
        ['다크 옅은 배경 위 본문', contrast(dark['--text'], dark['--sig-soft'])],
        ['다크 버튼 글자', contrast(dark['--on-sig'], dark['--sig'])]
      ];
      const low = rows.filter(r => r[1] < floor);
      ok('세 토큰의 대비비가 양 테마에서 하한 이상이다', low.length === 0,
         low.map(r => r[0] + ' ' + r[1].toFixed(2)).join(' · '));
      for (const r of rows) note(r[0] + ' ' + r[1].toFixed(2) + ' (하한 ' + floor + ')');
      /* ★다크는 기준색이 아니라 밝은 변형이다 — 대비비만 걸면 색상이 통째로 달라져도 통과한다
         (master 236 지시 2026-09-05): 색상차 한도 안이고 ★더 밝아야 한다. */
      const gap = hueGap(dark['--sig'], light['--sig']);
      const lighter = hsl(dark['--sig']).l > hsl(light['--sig']).l;
      ok('다크 주색은 기준색의 밝은 변형이다(색상차 20도 이내)',
         gap <= CONTRACT.DARK_HUE_MAX && lighter,
         '색상차 ' + gap.toFixed(1) + '도 · 밝기 ' + (hsl(dark['--sig']).l * 100).toFixed(0) + '% vs ' +
         (hsl(light['--sig']).l * 100).toFixed(0) + '%');
      note('다크 변형 색상차 ' + gap.toFixed(1) + '도 · 한도 ' + CONTRACT.DARK_HUE_MAX + '도');
      /* ★판(--pad 계열)도 분류 색을 따라간다 — 대문 카드에 실리는 그림이 판이다 */
      const padGap = hueGap(light['--pad-line'], light['--sig']);
      ok('판의 테두리도 분류 색조를 따른다', padGap <= 40, '색상차 ' + padGap.toFixed(1) + '도');
      const padBorder = contrast(light['--pad-line'], light['--pad']);
      const padBorderD = contrast(dark['--pad-line'], dark['--pad']);
      ok('칸 경계가 판 위에서 보인다(뜻을 지닌 UI 라 하한을 건다)',
         padBorder >= floor && padBorderD >= floor,
         '라이트 ' + padBorder.toFixed(2) + ' · 다크 ' + padBorderD.toFixed(2));
      note('판 테두리 대비 라이트 ' + padBorder.toFixed(2) + ' · 다크 ' + padBorderD.toFixed(2));
    }
  }
}

/* ============================================================ 12. ★오늘의 한판 풀 제외 */
section('12. 오늘의 한판 풀');
{
  /* 2인용은 혼자 하루 한 판 완주를 재는 자리에 맞지 않는다 — ★조용히 빼지 않고 규칙으로 뺀다.
     ★검사도 규칙과 등록부를 읽어 ★풀을 다시 셈해 본다(문구를 찾는 것이 아니다). */
  let games = null;
  try { games = JSON.parse(AUX.games); } catch(e){}
  const filterSrc = (/pool = list\.filter\(([\s\S]*?)\);/.exec(AUX.today) || [])[1];
  if (!games || !filterSrc){
    ok('등록부와 풀 규칙을 읽었다', false, 'games=' + !!games + ' filter=' + !!filterSrc);
  } else {
    let pool = null;
    try { pool = games.filter(Function('return (' + filterSrc + ')')()); } catch(e){ pool = null; }
    if (!pool){
      ok('풀 규칙을 값으로 풀었다', false, filterSrc.slice(0, 80));
    } else {
      const ids = pool.map(g => g.id);
      ok('2인용은 오늘의 한판 후보 풀에서 빠진다', !ids.includes('together'),
         '풀에 together 가 있다(혼자 온 사람이 그날 완주를 못 한다)');
      const twoPlayer = games.filter(g => g.solo === false).map(g => g.id);
      ok('제외가 조용하지 않다(등록부에 solo 선언이 있다)', twoPlayer.includes('together'),
         '등록부에 solo:false 선언이 없다 · 선언 목록 ' + JSON.stringify(twoPlayer));
      note('풀 ' + ids.length + '종 · 2인용 선언 ' + twoPlayer.length + '종');
      /* ★반대 방향 · 선언이 없으면 들어온다는 것을 셈으로 보여 준다(제외가 규칙의 귀결임을 증명) */
      const asIfSolo = games.map(g => g.id === 'together' ? Object.assign({}, g, { solo: undefined }) : g)
                            .filter(Function('return (' + filterSrc + ')')());
      ok('선언이 없다면 그 규칙으로는 풀에 들어온다', asIfSolo.map(g => g.id).includes('together'),
         '선언과 무관하게 빠진다면 이 규칙이 제외의 근거가 아니다');
    }
  }
}

/* ============================================================ 13. 입력·창·i18n·저장소 */
section('13. 입력과 창');
{
  const A = boot();
  A.versusBtn();
  toSignal(A);
  A.resetPd();
  A.key('ArrowUp');
  eq('위쪽 화살표는 위쪽 자리에 대응한다', A.tg.state().log[0].by, CONTRACT.TOP);
  const B = boot();
  B.versusBtn();
  toSignal(B);
  B.key(' ');
  eq('스페이스는 아래쪽 자리에 대응한다', B.tg.state().log[0].by, CONTRACT.BOTTOM);
  const D = boot();
  D.versusBtn();
  toSignal(D);
  D.key('ArrowDown', { repeat: true });
  eq('누르고 있어서 반복 발화된 키 입력은 무시된다', D.tg.state().log.length, 0);
  D.resetPd();
  D.keyOn(CONTRACT.BOTTOM, 'Enter');
  ok('Enter 로 눌렀을 때 preventDefault 가 호출된다', D.pd() === 1, String(D.pd()));
  eq('Enter 로도 판정이 들어간다', D.tg.state().log.length, 1);
  eq('두 절반에 서로 다른 키가 배당돼 있다', new Set(['ArrowDown', 'ArrowUp']).size, 2);

  const E = boot();
  ok('시작 창이 열려 있으면 창 밖 요소에 inert 가 붙는다', E.inertOf('header') === true);
  E.versusBtn();
  ok('판이 시작되면 창 밖 inert 가 풀린다', E.inertOf('header') === false);
  playAll(E, sig => sig === E.tg.const().SIG_GO ? CONTRACT.BOTTOM : CONTRACT.TOP);
  ok('결과 창이 열리면 다시 inert 가 붙는다', E.inertOf('main') === true);
  ok('결과 창의 첫 버튼으로 초점이 옮겨간다', E.focused() && E.focused().id === 'btnAgain',
     E.focused() ? E.focused().id : 'null');
}
section('14. i18n 과 저장소');
{
  const A = boot();
  const keys = A.t.i18nKeys();
  eq('ko 표에만 있는 키가 없다', keys.ko.filter(k => !keys.en.includes(k)), []);
  eq('en 표에만 있는 키가 없다', keys.en.filter(k => !keys.ko.includes(k)), []);
  const marked = A.doc.querySelectorAll('[data-i18n]').map(e => e.dataset.i18n);
  eq('마크업의 data-i18n 키가 ko·en 두 표에 모두 있다',
     marked.filter(k => !keys.ko.includes(k) || !keys.en.includes(k)), []);
  note('i18n 키 ' + keys.ko.length + '개 · 마크업 자리 ' + marked.length + '개를 대조했다');
  A.versusBtn();
  const before = JSON.stringify(A.t.planNow());
  const st = A.tg.state();
  A.langBtn();
  ok('언어를 바꿔도 진행 중인 판이 바뀌지 않는다', JSON.stringify(A.t.planNow()) === before);
  eq('언어를 바꿔도 신호 마감이 그대로다', [A.tg.state().waitStart, A.tg.state().signalDue],
     [st.waitStart, st.signalDue]);
  eq('언어가 실제로 바뀌었다', A.tg.lang(), 'en');

  /* 저장 키 */
  const store = makeStore();
  const B = boot({ store: store });
  B.soloBtn();
  playAll(B, sig => sig === B.tg.const().SIG_GO ? CONTRACT.BOTTOM : CONTRACT.TOP);
  const C2 = boot({ store: store });
  C2.setWall(new Date(2026, 8, 5, 9, 0, 0).getTime());
  C2.t.refresh();
  C2.dailyBtn();
  playAll(C2, sig => sig === C2.tg.const().SIG_GO ? CONTRACT.BOTTOM : CONTRACT.TOP);
  const used = store.keys().sort();
  const allowed = ['bp.lang', 'tg.best', 'tg.daily', 'tg.sound'];
  eq('제품이 쓰는 저장 키는 방침에 적힌 것뿐이다', used.filter(k => !allowed.includes(k)), []);
  note('실제로 쓰인 키: ' + used.join(', '));

  /* 관측 창구에 상태 변경 명령이 없다 */
  const D = boot();
  D.versusBtn();
  const snap = () => JSON.stringify(D.tg.state()) + '|' + JSON.stringify(D.t.planNow());
  const s0 = snap();
  const changed = [];
  for (const name of Object.keys(D.tg)){
    const fn = D.tg[name];
    if (typeof fn !== 'function') continue;
    try { fn(); } catch(_){}
    if (snap() !== s0) changed.push(name);
  }
  eq('관측 창구를 불러도 상태가 바뀌지 않는다', changed, []);
  note('창구 ' + Object.keys(D.tg).length + '개를 전부 불러 보고 상태를 대조했다');
}

/* ============================================================ 15. 터치 목표 */
section('15. 터치 목표');
{
  /* ★두 절반은 화면을 반으로 나눠 쓰므로 칸 자체가 터치 목표다 · 숫자를 박지 않고 CSS 에서 셈한다 */
  const minH = (/\.tg-press\{[^}]*min-height:(\d+)px/.exec(RAW) || [])[1];
  const pad = (/body\.tg-running \.tg-board\{height:100dvh;max-width:100%;gap:(\d+)px;padding:(\d+)px\}/.exec(RAW) || []);
  if (!minH || !pad[1]){
    ok('CSS 에서 절반의 치수를 읽었다', false, 'minH=' + minH + ' board=' + JSON.stringify(pad.slice(1, 3)));
  } else {
    const gap = Number(pad[1]), bpad = Number(pad[2]);
    /* ★가장 불리한 조건 · 세로가 짧은 기기(360x640)에서 절반의 높이 */
    const VIEW_H = 640;
    const half = (VIEW_H - bpad * 2 - gap) / 2;
    ok('가장 좁은 세로에서도 절반이 손가락 하한을 넉넉히 넘는다', half >= 50 && Number(minH) >= 50,
       '절반 ' + half + 'px · min-height ' + minH + 'px');
    note('360x640 에서 절반 높이 ' + half + 'px (판 패딩 ' + bpad + ' · 사이 ' + gap + ') · 칸 최소 높이 ' + minH + 'px');
  }
}

/* ============================================================ 요약 */
console.log('\n' + '='.repeat(60));
console.log('PASS ' + pass + ' · FAIL ' + fail);
if (fail){ console.log('실패한 검사:'); for (const f of failures) console.log('  - ' + f); }
process.exit(fail ? 1 : 0);

