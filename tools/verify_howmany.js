/* 몇 개였지(/how-many/) 검증기 · worker(238) · 2026-09-04 · 티켓 T0904-howmany
 *
 * 앞선 검증기(verify_reverse.js·verify_fakeone.js·verify_higherlower.js)의 방식을 그대로 따른다:
 *   · 인라인 스크립트를 DOM 스텁 위에서 실제로 구동한다(vm)
 *   · 상태를 바꾸는 명령은 **제품 파일에 두지 않고** 여기서 메모리 위에만 덧붙인다(test bridge)
 *   · 판정은 배포되는 관측 창구(window.__hm)와 이 파일이 따로 셈한 값의 대조로 한다
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
 * 사용법: node verify_howmany.js [--html <경로>] [--mutate <이름>] [--list-mutations]
 * 종료코드: 0 = 전부 PASS · 1 = 하나라도 FAIL · 2 = 뮤테이션 주입 실패·하네스 이상(탐지 아님)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
/* 기본 대상은 **이 도구가 놓인 저장소의 /how-many/index.html** 이다 · 절대경로를 박아 두면
   worktree 를 갈아탈 때 조용히 남의 파일을 재게 된다. */
const HTML = argOf('--html', path.join(__dirname, '..', 'how-many', 'index.html'));
const MUTATION = argOf('--mutate', null);

/* ------------------------------------------------------- 뮤테이션(검출력 자기시험)
   ★각 뮤테이션은 **어느 검사가 잡아야 하는지**를 함께 적는다 · 다른 검사가 우연히 깨져서 난
   빨강은 무임승차다(장기기억 mutation-must-name-the-check-that-catches-it).
   ★'주입 실패'와 '결함 탐지'를 종료코드로 가른다(2 = 주입 실패 · 1 = 탐지).
   ★scope:'html' 은 스크립트 밖(CSS 토큰 등)을 겨냥한다 · 문서 전체에 주입한다.
   ★expect:'quiet' 는 음성 대조군이다 — ★붉으면 안 된다(붉어야 할 것만 시험하면 오탐이 열린다).
   ★검사 이름에 ' — '(공백 엠대시 공백)를 쓰지 않는다 · 러너의 FAIL 파서가 이름을 잘라 읽는다. */
const MUTATIONS = {
  /* ① 보기 간격 — 되돌리기 둘. 둘 다 하한 1.10 을 못 지킨다(전 구간 최소 1.0833·1.0667) */
  'gap-uses-round': {
    catcher: '정답과 최근접 오답의 비율이 하한을 지킨다',
    from: 'const gapFor = n => Math.max(1, Math.ceil(n / 8));',
    to:   'const gapFor = n => Math.max(1, Math.round(n / 8));'
  },
  'gap-uses-tenth': {
    catcher: '정답과 최근접 오답의 비율이 하한을 지킨다',
    from: 'const gapFor = n => Math.max(1, Math.ceil(n / 8));',
    to:   'const gapFor = n => Math.max(1, Math.round(n / 10));'
  },
  /* ①-A 보기 넷의 구성이 어긋난다(정답이 보기에 없다) */
  'options-drop-answer': {
    catcher: '보기 넷은 정답을 둘째로 하는 등차 넷이다',
    from: 'const optionsFor = n => { const d = gapFor(n); return [n - d, n, n + d, n + 2 * d]; };',
    to:   'const optionsFor = n => { const d = gapFor(n); return [n - d, n + d, n + 2 * d, n + 3 * d]; };'
  },
  /* ② 난이도 곡선 — 노출이 안 줄어든다 */
  'exposure-not-shrinking': {
    catcher: '개수당 노출이 라운드마다 줄어든다',
    from: 'const EXPOSURE_MS  = [1200, 1100, 1000, 900, 800, 700, 600, 500];',
    to:   'const EXPOSURE_MS  = [1200, 1100, 1000, 900, 800, 900, 600, 500];'
  },
  /* ②-A 개수 구간이 벌어진다 = 단조가 구조로 보장되지 않는다 */
  'ranges-detached': {
    catcher: '개수 구간이 서로 맞닿는다',
    from: 'const COUNT_RANGE  = [[7,9], [9,11], [11,13], [13,15], [15,17], [17,19], [19,21], [21,24]];',
    to:   'const COUNT_RANGE  = [[7,9], [10,12], [11,13], [13,15], [15,17], [17,19], [19,21], [21,24]];'
  },
  /* ②-B 노출 바닥이 내려간다 */
  'exposure-floor-lowered': {
    catcher: '노출의 바닥이 선언된 값과 같다',
    from: 'const EXPOSURE_MS  = [1200, 1100, 1000, 900, 800, 700, 600, 500];',
    to:   'const EXPOSURE_MS  = [1200, 1100, 1000, 900, 800, 700, 600, 300];'
  },
  /* ③ 자리 — ★master 236 이 지목한 짝. 2회씩 고정으로 되돌리면 예측 가능성이 열린다 */
  'slots-fixed-two-each': {
    catcher: '자리 예측 불가(관측 상한 기준)',
    from: '  const slots = [], used = [0, 0, 0, 0];',
    to:   '  const slots = []; const used = [0, 0, 0, 0]; if (ROUNDS === 8){\n' +
          '    for (let b = 0; b < 2; b++){ const perm = shuffleInPlace([0,1,2,3], rnd); for (const s of perm) slots.push(s); }\n' +
          '    for (const s of slots) used[s]++;\n' +
          '  } else'
  },
  /* ③-A' 상한을 4 로 올린다 = 한 자리가 판의 절반을 차지할 수 있다(master 236 지시 2026-09-04).
     ★예측 불가 검사는 조용하고(capHat=4 면 최소 후보 3) ★쏠림 검사만 붉어야 한다 —
     두 검사가 서로 다른 축을 지킨다는 증거다. */
  'slot-cap-four': {
    catcher: '정답 자리 쏠림이 상한 안이다',
    from: 'const SLOT_CAP = 3;',
    to:   'const SLOT_CAP = 4;'
  },
  /* ③-A 상한이 사라진다 = 한 자리에 다 몰릴 수 있다(반대 방향) */
  'slot-cap-gone': {
    catcher: '정답 자리 쏠림이 상한 안이다',
    from: '    for (let s = 0; s < OPTIONS; s++) if (used[s] < SLOT_CAP) allowed.push(s);',
    to:   '    for (let s = 0; s < OPTIONS; s++) allowed.push(s);'
  },
  /* ③-B 나머지 보기를 크기순으로 둔다 = 오름차순이 깨진 자리가 정답이라는 실마리 */
  'others-sorted': {
    catcher: '나머지 세 보기의 자리가 늘 크기순은 아니다',
    from: '    const others = shuffleInPlace(all.filter(v => v !== n), rnd);',
    to:   '    const others = all.filter(v => v !== n);'
  },
  /* ④ 겹침 — 흔들림이 칸을 넘는다 / 도형이 커진다(두 방향) */
  'jitter-too-wide': {
    catcher: '도형이 서로 겹치지 않는다',
    from: 'const JITTER = 0.25;',
    to:   'const JITTER = 0.6;'
  },
  'dot-too-big': {
    catcher: '도형이 서로 겹치지 않는다',
    from: 'const DOT_PCT = 5.2;',
    to:   'const DOT_PCT = 9.5;'
  },
  /* ④-A 한 칸에 둘이 들어간다 */
  'cells-reused': {
    catcher: '도형은 서로 다른 칸에 하나씩 놓인다',
    from: '      const cell = cells[i];',
    to:   '      const cell = cells[i % 3];'
  },
  /* ⑤ 노출 — 마감 전에 사라진다(조기 기상 가드 제거) */
  'hide-before-due': {
    catcher: '마감 전에 깬 타이머는 사라지게 하지 않는다',
    from: '  if (t < hideDue){ scheduleHide(); return; }',
    to:   '  if (false){ scheduleHide(); return; }'
  },
  /* ⑤-A 사라짐을 마감이 아니라 깨어난 시각으로 확정한다 */
  'hide-stamp-uses-now': {
    catcher: '사라짐은 마감 시각으로 확정한다',
    from: '  hideStamp = hideDue;          /* ★사라짐은 마감 시각으로 확정한다 */',
    to:   '  hideStamp = t;'
  },
  /* ⑥ 반응 시간을 노출 시작부터 잰다 = 오래 본 사람이 손해를 본다 */
  'rt-from-show': {
    catcher: '반응 시간은 마감부터 잰다',
    from: '  const ms = Math.max(0, Math.round(stamp - hideStamp));',
    to:   '  const ms = Math.max(0, Math.round(stamp - showStamp));'
  },
  /* ⑦ 맞혀도 점수가 안 오른다 */
  'right-not-scored': {
    catcher: '맞히면 그 자리에서 점수가 오른다',
    from: '  if (ok) score += 1;',
    to:   '  if (ok) score += 0;'
  },
  /* ⑦-A 논리를 연출 타이머 뒤로 미룬다 = 빠른 입력이 낡은 상태 위에서 돈다 */
  'commit-deferred': {
    catcher: '논리는 누른 순간 확정된다',
    from: '  picks.push({ round: round + 1, n: r.n, pick: r.options[i], ok, ms });\n  if (ok) score += 1;',
    to:   '  setTimeout(() => { picks.push({ round: round + 1, n: r.n, pick: r.options[i], ok, ms }); if (ok) score += 1; }, 0);'
  },
  /* ⑧ 보는 중에도 보기가 열려 있다 */
  'answers-open-during-show': {
    catcher: '보는 중에는 보기가 잠긴다',
    from: "  const open = phase === 'ask';",
    to:   "  const open = phase === 'ask' || phase === 'show';"
  },
  /* ⑨ 플레이가 난수를 소비한다 = 오늘의 도전이 사람마다 갈라진다 */
  'rng-on-play': {
    catcher: '플레이 행동은 난수를 한 번도 소비하지 않는다',
    from: '  const ok = i === r.answer;',
    to:   '  const ok = (Math.random() >= 0) && i === r.answer;'
  },
  /* ⑩ 씨앗에 시각이 섞인다 = 같은 날인데 몇 시에 열었는지로 판이 갈린다 */
  'daily-seed-uses-clock': {
    catcher: '같은 날이면 시각이 달라도 같은 판이다',
    from: "const dailySeedKey = (d=new Date()) => 'hanpango-daily-how-many-' + dayKey(d);",
    to:   "const dailySeedKey = (d=new Date()) => 'hanpango-daily-how-many-' + dayKey(d) + '-' + d.getHours();"
  },
  /* ⑪ 오늘의 도전이 최고 기록을 건드린다 */
  'best-updates-in-daily': {
    catcher: '오늘의 도전은 최고 기록을 건드리지 않는다',
    from: "  if (mode === 'daily'){\n    if (!dailyDoneToday()){",
    to:   "  if (mode === 'daily'){\n    saveBest({ score, avgMs, ms: r.ms, date: dayKey() });\n    if (!dailyDoneToday()){"
  },
  /* ⑪-A 동점일 때 평균 반응을 안 본다 */
  'tie-ignores-avg': {
    catcher: '같은 점수면 평균 반응이 빠른 쪽이 최고 기록이다',
    from: 'const betterThan = (a, b) => !b || a.score > b.score ||\n  (a.score === b.score && typeof b.avgMs === \'number\' && isFinite(b.avgMs) && a.avgMs < b.avgMs);',
    to:   'const betterThan = (a, b) => !b || a.score > b.score;'
  },
  /* ⑪-B 오늘의 도전이 하루 한 번이 아니다 */
  'daily-overwrite': {
    catcher: '오늘의 도전은 하루 한 번이다',
    from: '    if (!dailyDoneToday()){\n      saveDaily({ score, rounds: answered, ms: r.ms, avgMs });',
    to:   '    if (true){\n      saveDaily({ score, rounds: answered, ms: r.ms, avgMs });'
  },
  /* ⑫ 맞고 틀림을 색만으로 말한다 */
  'marks-color-only': {
    catcher: '맞고 틀림이 색만이 아니라 글자로도 말한다',
    from: "  $('mk' + i).textContent = ok ? '○' : '✕';",
    to:   "  $('mk' + i).textContent = '';"
  },
  /* ⑫-A 틀렸을 때 정답 자리를 안 알려 준다 */
  'answer-not-revealed': {
    catcher: '틀리면 정답 자리에도 표가 붙는다',
    from: "  if (!ok){ $('ans' + r.answer).classList.add('hit'); $('mk' + r.answer).textContent = '○'; }",
    to:   "  if (false){ $('ans' + r.answer).classList.add('hit'); $('mk' + r.answer).textContent = '○'; }"
  },
  /* ⑬ 반복 발화 가드가 사라진다 */
  'repeat-guard-gone': {
    catcher: '누르고 있어서 반복 발화된 숫자 입력은 무시된다',
    from: "  const k = '1234'.indexOf(ev.key);\n  if (k < 0) return;\n  if (ev.repeat) return;",
    to:   "  const k = '1234'.indexOf(ev.key);\n  if (k < 0) return;"
  },
  /* ⑬-A Enter 로 눌렀을 때 뒤따르는 click 을 안 막는다 = 한 번이 두 번 세어진다 */
  'key-no-preventdefault': {
    catcher: 'Enter 로 눌렀을 때 preventDefault 가 호출된다',
    from: "    ev.preventDefault();\n    onPick(i, ev);",
    to:   "    onPick(i, ev);"
  },
  /* ⑭ 창이 열려도 창 밖이 살아 있다 */
  'inert-gone': {
    catcher: '시작 창이 열려 있으면 창 밖 요소에 inert 가 붙는다',
    from: "    if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');",
    to:   "    if (false) el.setAttribute('inert', ''); else el.removeAttribute('inert');"
  },
  /* ⑮ 영문 표에서 산문 키가 빠진다 */
  'en-prose-missing': {
    catcher: '마크업의 data-i18n 키가 ko·en 두 표에 모두 있다',
    from: "    how1:'A round comes in two halves.",
    to:   "    how1x:'A round comes in two halves."
  },
  /* ⑯ 언어를 바꾸면 진행 중인 판이 바뀐다 */
  'lang-switch-redraws-plan': {
    catcher: '언어를 바꿔도 진행 중인 판이 바뀌지 않는다',
    from: '  paintOptions(); paintChips();\n  if (lastResult',
    to:   '  plan = freePlan();\n  paintOptions(); paintChips();\n  if (lastResult'
  },
  /* ⑰ CSS — 터치 목표가 줄어든다(스크립트 밖 계약) */
  'touch-target-shrunk': {
    scope: 'html',
    catcher: '보기 칸은 360px 에서 짧은 변이 50px 하한을 지킨다',
    from: '  .hm-btn{min-height:64px;',
    to:   '  .hm-btn{min-height:30px;'
  },
  /* ⑰-A CSS — 칸 사이 간격이 벌어지면 폭 셈이 무너진다 */
  'answers-gap-widened': {
    scope: 'html',
    catcher: '이 셈이 실브라우저 실측(보기 칸 폭)을 재현한다',
    from: '  .hm-answers{display:grid;grid-template-columns:1fr 1fr;gap:10px;',
    to:   '  .hm-answers{display:grid;grid-template-columns:1fr 1fr;gap:130px;'
  },
  /* ★음성 대조군 ① · 연출 시간은 계약이 아니다 — 붉으면 안 된다.
     정답을 보여 주는 시간이 길고 짧은 것은 취향이고, 논리는 이미 누른 순간 확정됐다.
     이 대조군이 있어야 '연출까지 계약으로 굳히는' 과잉 판정이 생겼을 때 붉어 알려 준다. */
  'feedback-longer': {
    expect: 'quiet',
    catcher: '(음성 대조군) 연출 시간 변경은 계약이 아니다',
    from: 'const FEEDBACK_MS = 900;',
    to:   'const FEEDBACK_MS = 1400;'
  },
  /* ★음성 대조군 ② · 도형 색은 계약이 아니다(색으로 가려야 하는 것이 이 게임엔 없다).
     ★단 지름·자리는 계약이다 — 그것을 건드리는 뮤테이션은 위에서 붉게 잡힌다. */
  'dot-color-changed': {
    expect: 'quiet',
    scope: 'html',
    catcher: '(음성 대조군) 도형 색 변경은 계약이 아니다',
    from: '  .hm-dot{position:absolute;width:5.2%;aspect-ratio:1;border-radius:50%;background:var(--mark);',
    to:   '  .hm-dot{position:absolute;width:5.2%;aspect-ratio:1;border-radius:50%;background:var(--sig-ink);'
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
  console.log(`[mutate] ${MUTATION} 주입됨(${m.scope === 'html' ? '문서' : '스크립트'}) · ` +
              (m.expect === 'quiet' ? '★음성 대조군(조용해야 한다): ' : '잡아야 하는 검사: ') + m.catcher);
}

/* ------------------------------------------------------- test bridge(메모리 위에만)
   제품 파일에는 관측 창구(__hm)만 배포한다. 상태를 바꾸는 명령은 여기서 IIFE 가 닫히기 직전에
   덧붙인다 · 배포본에는 남지 않는다(장기기억 debug-hooks-in-shipped-code-are-a-control-api). */
const BRIDGE = `
window.__hmTest = {
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
    if ((s === '#stage .hm-dot' || s === '.hm-dot') && el._classes.has('hm-dot')) return true;
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

const IDS = ['stage','veil','answers','ans0','ans1','ans2','ans3','opt0','opt1','opt2','opt3',
             'mk0','mk1','mk2','mk3','roundChip','scoreChip','srSummary','toast','over','start',
             'finalBig','finalLine','marks','streakLine','newBest','nScore','nAvg','nTime','finalSub',
             'btnAgain','btnShare','btnDaily','btnStart','dailyHint','ruleNote','help',
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
  doc.body = makeEl('body', doc, 'body');
  for (const id of IDS) doc.getElementById(id);
  for (let i = 0; i < 4; i++) doc.getElementById('ans' + i).tagName = 'BUTTON';
  for (const b of ['btnAgain','btnShare','btnDaily','btnStart','btnSound','btnSound2','btnLang','btnLang2'])
    doc.getElementById(b).tagName = 'BUTTON';
  doc.getElementById('over')._classes.add('overlay');
  doc.getElementById('start')._classes.add('overlay');
  doc.getElementById('start')._classes.add('show');
  /* ★창 안의 버튼을 실제로 창의 자식으로 단다 · 안 달면 제품의 '첫 버튼으로 초점' 코드가
     스텁에서 아무것도 못 찾아 그 줄을 통째로 지워도 어떤 검사도 붉지 않는다(스텁 충실도). */
  for (const [box, kids] of [['over', ['btnAgain','btnShare']], ['start', ['btnDaily','btnStart']]]){
    for (const k of kids) doc.getElementById(box).appendChild(doc.getElementById(k));
  }
  /* 마크업에 실제로 있는 data-i18n 자리(산문 포함)를 심는다 */
  for (const k of ['title','subtitle','hint','how1','how2','how3','how4','dailyDesc','statPlays',
                   'faq1a','faq5a','tip1a','footer','startSub','ruleNote']){
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
  let tSeq = 1;
  const timers = new Map();
  const setTimeoutStub = (fn, ms) => { const id = tSeq++; timers.set(id, { fn, ms }); return id; };
  const clearTimeoutStub = id => { timers.delete(id); };
  function runTimers(){ const e = [...timers.values()]; timers.clear(); for (const t of e) t.fn(); return e.length; }

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
  try { vm.runInContext(SRC, sandbox, { filename: 'how-many-inline.js' }); }
  catch (e){ console.error('구동 실패: ' + e.stack); process.exit(2); }
  if (!win.__hm || !win.__hmTest){ console.error('관측 창구(__hm)/시험 다리(__hmTest) 없음'); process.exit(2); }

  const A = {
    hm: win.__hm, t: win.__hmTest, doc, store: localStorage,
    el: id => doc.getElementById(id),
    txt: id => doc.getElementById(id).textContent,
    rand: () => randCalls,
    resetRand: () => { randCalls = 0; },
    now: () => clock,
    advance: ms => { clock += ms; },
    wall: () => wall,
    setWall: ms => { wall = ms; },
    runTimers,
    timerDelays: () => [...timers.values()].map(t => t.ms),
    pendingTimers: () => timers.size,
    /* ★진짜 입력 사건으로 두드린다 · 다리로 onPick 을 부르지 않는다 */
    tap: (i, props) => {
      const fn = doc.getElementById('ans' + i)._on.pointerdown;
      if (!fn) throw new Error('보기 칸 pointerdown 핸들러 없음');
      fn(Object.assign({ button: 0, timeStamp: clock }, props || {}));
    },
    keyOn: (i, k, opts) => {
      const fn = doc.getElementById('ans' + i)._on.keydown;
      if (!fn) throw new Error('보기 칸 keydown 핸들러 없음');
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
    startBtn: off => doc.getElementById('btnStart').onclick({ timeStamp: clock + (off || 0) }),
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

/* ★한 판을 끝까지 치른다 · 답은 관측 창구가 준 자리에서 읽는다(하네스가 답을 따로 셈해 두면
   그때부터 검사가 계약이 아니라 내 셈을 재게 된다). rightPick=false 면 일부러 틀린다. */
function playRound(A, rightPick, waitMs){
  const st = A.hm.state();
  const r = A.t.planNow().rounds[st.round];
  A.advance(waitMs === undefined ? 0 : waitMs);
  A.runTimers();                                  /* 노출 마감 */
  A.advance(200);
  const pick = rightPick === false ? (r.answer + 1) % 4 : r.answer;
  A.tap(pick);
  return { r, pick };
}
function playAll(A, rightPick){
  for (let i = 0; i < 8; i++){
    const st = A.hm.state();
    if (st.phase === 'done') break;
    playRound(A, rightPick, A.t.planNow().rounds[st.round].exposure + 10);
    if (A.hm.state().phase === 'gap') A.runTimers();   /* 연출이 끝나고 다음 라운드로 */
  }
}

/* ★이 하네스가 ★독립으로 쥔 계약 상수 — 제품에서 읽어 오지 않는다.
   대상에서 읽으면 규칙이 바뀔 때 검사도 함께 바뀌어 ★규칙 소실을 영영 못 잡는다(자기참조).
   제품이 선언한 값과 ★같은가도 따로 검사한다(아래 1절). */
const CONTRACT = {
  ROUNDS: 8, OPTIONS: 4,
  EXPOSURE: [1200, 1100, 1000, 900, 800, 700, 600, 500],
  RANGE: [[7,9], [9,11], [11,13], [13,15], [15,17], [17,19], [19,21], [21,24]],
  FLOOR_MS: 500,
  NEAREST_MIN: 1.10,     /* ★정답 대 최근접 오답 비율의 하한(설계값 1.1250 바로 아래) */
  SLOT_CAP: 3,           /* ★한 자리가 여덟 라운드에서 세 번을 넘지 않는다 */
  MIN_CANDIDATES: 2      /* ★어느 시점에도 다음 라운드 후보 자리가 둘 이상이다 */
};
const gapOf = n => Math.max(1, Math.ceil(n / 8));   /* 하네스가 따로 셈한다 */

/* ============================================================ 1. 규격과 순수 함수 */
section('1. 규격과 순수 함수');
{
  const A = boot();
  const C = A.hm.const();
  eq('한 판은 여덟 라운드이고 보기는 넷이다', [C.ROUNDS, C.OPTIONS], [CONTRACT.ROUNDS, CONTRACT.OPTIONS]);
  eq('라운드별 노출 표가 계약과 같다', C.EXPOSURE_MS, CONTRACT.EXPOSURE);
  eq('라운드별 개수 구간 표가 계약과 같다', C.COUNT_RANGE, CONTRACT.RANGE);
  eq('제품이 선언한 자리 상한이 계약과 같다', C.SLOT_CAP, CONTRACT.SLOT_CAP);

  ok('노출은 라운드가 오를수록 줄어든다',
     C.EXPOSURE_MS.every((v, i) => i === 0 || C.EXPOSURE_MS[i - 1] > v), JSON.stringify(C.EXPOSURE_MS));
  eq('노출의 바닥이 선언된 값과 같다', Math.min(...C.EXPOSURE_MS), C.MIN_EXPOSURE_MS);
  ok('노출의 바닥이 계약 하한 아래로 내려가지 않는다', Math.min(...C.EXPOSURE_MS) >= CONTRACT.FLOOR_MS,
     String(Math.min(...C.EXPOSURE_MS)));

  /* ★구간이 맞닿아야 ms/개 단조가 '노출이 줄기만 하면' 성립한다(구조로 보장) */
  const detached = C.COUNT_RANGE.map((r, i) => i === 0 ? null : (C.COUNT_RANGE[i-1][1] === r[0] ? null : i))
                                .filter(x => x !== null);
  eq('개수 구간이 서로 맞닿는다', detached, []);
  /* ★최악의 조합으로 잰다 — k 가 최대 개수를 뽑고 k+1 이 최소 개수를 뽑는 경우 */
  const badPairs = [];
  for (let k = 0; k + 1 < C.ROUNDS; k++){
    const a = C.EXPOSURE_MS[k] / C.COUNT_RANGE[k][1];
    const b = C.EXPOSURE_MS[k+1] / C.COUNT_RANGE[k+1][0];
    if (!(a > b)) badPairs.push('R' + (k+1) + '->R' + (k+2) + ' ' + a.toFixed(2) + '<=' + b.toFixed(2));
  }
  eq('개수당 노출이 라운드마다 줄어든다', badPairs, []);

  /* ★보기 — 쓰이는 전 구간(n=7~24)을 전수로 훑는다. 몇 점만 보면 '최소'가 참이 아니다. */
  const lo = Math.min(...C.COUNT_RANGE.map(r => r[0])), hi = Math.max(...C.COUNT_RANGE.map(r => r[1]));
  let nearestMin = Infinity, nearestAt = 0, pairMin = Infinity;
  const shapeBad = [], gapBad = [];
  for (let n = lo; n <= hi; n++){
    const d = gapOf(n);
    const opts = A.hm.optionsFor(n);
    if (JSON.stringify(opts) !== JSON.stringify([n - d, n, n + d, n + 2 * d])) shapeBad.push(n);
    if (A.hm.gapFor(n) !== d) gapBad.push(n);
    /* ★비율은 ★제품이 실제로 내놓은 보기에서 잰다 · 하네스가 셈한 d 로 재면 제품이 간격을
       바꿔도(round·n/10 로 되돌려도) 이 검사는 조용해진다(자기 셈을 재는 검사가 된다). */
    const sorted = opts.slice().sort((a, b) => a - b);
    const near = Math.min(...sorted.filter(v => v !== n).map(v => v > n ? v / n : n / v));
    if (near < nearestMin){ nearestMin = near; nearestAt = n; }
    for (let q = 1; q < sorted.length; q++) pairMin = Math.min(pairMin, sorted[q] / sorted[q - 1]);
  }
  eq('보기 간격이 개수의 8분의 1(올림)과 같다', gapBad, []);
  eq('보기 넷은 정답을 둘째로 하는 등차 넷이다', shapeBad, []);
  ok('정답과 최근접 오답의 비율이 하한을 지킨다', nearestMin >= CONTRACT.NEAREST_MIN,
     '최소 ' + nearestMin.toFixed(4) + ' (n=' + nearestAt + ') < ' + CONTRACT.NEAREST_MIN);
  note('정답 대 최근접 오답 최소 ' + nearestMin.toFixed(4) + ' (n=' + nearestAt + ')'
       + ' · 보기끼리 최근접 최소 ' + pairMin.toFixed(4) + ' (부수 관측 · 둘 다 오답이라 공정성 계약이 아니다)');

  /* ★겹침의 근거 — 칸 수와 최소 중심거리. 무대는 4:3 이라 세로 백분율은 0.75 를 곱해 환산한다. */
  ok('격자 칸 수가 최대 개수 이상이다', C.GRID_COLS * C.GRID_ROWS >= hi,
     C.GRID_COLS + 'x' + C.GRID_ROWS + ' < ' + hi);
  const cw = 100 / C.GRID_COLS, ch = (100 * 0.75) / C.GRID_ROWS;
  const minCenter = Math.min(cw, ch) * (1 - 2 * C.JITTER);
  ok('이웃 칸 중심의 최소 거리가 도형 지름보다 크다', minCenter > C.DOT_PCT,
     '최소중심거리 ' + minCenter.toFixed(3) + '%W <= 지름 ' + C.DOT_PCT + '%W');
  note('최소 중심거리 ' + minCenter.toFixed(3) + '%W · 지름 ' + C.DOT_PCT + '%W · 여유 '
       + (minCenter - C.DOT_PCT).toFixed(3) + '%W');
}

/* ============================================================ 2. 판(씨앗이 정하는 것) */
section('2. 판');
{
  const A = boot();
  const C = A.hm.const();
  const KEYS = [];
  for (let i = 0; i < 200; i++) KEYS.push('scan-' + i);
  const stats = [];
  const rangeBad = [], spotBad = [], overlapBad = [], cellBad = [], optBad = [], capBad = [];
  let ascendingOthers = 0;
  for (const key of KEYS){
    const p = A.hm.plan(key);
    if (p.rounds.length !== C.ROUNDS){ rangeBad.push(key + ':라운드수'); continue; }
    const counts = [0, 0, 0, 0];
    p.rounds.forEach((r, i) => {
      counts[r.answer]++;
      if (r.n < C.COUNT_RANGE[i][0] || r.n > C.COUNT_RANGE[i][1]) rangeBad.push(key + '/R' + (i+1) + ':' + r.n);
      if (r.exposure !== C.EXPOSURE_MS[i]) rangeBad.push(key + '/R' + (i+1) + ':노출');
      if (r.spots.length !== r.n) spotBad.push(key + '/R' + (i+1));
      /* 보기 — 정답 자리에 개수가 있고 넷이 서로 다르며 등차 넷과 같은 집합이다 */
      const want = A.hm.optionsFor(r.n).slice().sort((a, b) => a - b).join(',');
      const got = r.options.slice().sort((a, b) => a - b).join(',');
      if (r.options[r.answer] !== r.n || new Set(r.options).size !== 4 || got !== want) optBad.push(key + '/R' + (i+1));
      /* 나머지 셋이 크기순으로만 놓여 있으면 실마리가 된다 — 몇 판이나 그런지 센다 */
      const others = r.options.filter((_, s) => s !== r.answer);
      if (others.every((v, s) => s === 0 || others[s-1] < v)) ascendingOthers++;
      /* 자리 — 서로 다른 칸에 하나씩 · 칸 안에서만 흔들린다 */
      const cells = new Set();
      for (const sp of r.spots){
        const col = Math.floor(sp.x / (100 / C.GRID_COLS));
        const row = Math.floor(sp.y / (100 / C.GRID_ROWS));
        cells.add(col + ',' + row);
      }
      if (cells.size !== r.spots.length) cellBad.push(key + '/R' + (i+1));
      /* 겹침 — 중심거리를 전수로 잰다(세로는 4:3 환산) */
      for (let a = 0; a < r.spots.length; a++) for (let b = a + 1; b < r.spots.length; b++){
        const dx = r.spots[a].x - r.spots[b].x;
        const dy = (r.spots[a].y - r.spots[b].y) * 0.75;
        if (Math.hypot(dx, dy) <= C.DOT_PCT) overlapBad.push(key + '/R' + (i+1));
      }
    });
    if (counts.some(c => c > CONTRACT.SLOT_CAP)) capBad.push(key + ':' + counts.join('/'));
    stats.push({ key: key, counts: counts, seq: p.rounds.map(r => r.answer) });
  }
  eq('라운드마다 개수가 그 구간 안이고 노출이 표와 같다', rangeBad.slice(0, 5), []);
  eq('도형 자리 수가 개수와 같다', spotBad.slice(0, 5), []);
  eq('도형은 서로 다른 칸에 하나씩 놓인다', cellBad.slice(0, 5), []);
  eq('도형이 서로 겹치지 않는다', overlapBad.slice(0, 5), []);
  eq('보기 넷은 서로 다르고 정답 자리에 개수가 있다', optBad.slice(0, 5), []);
  eq('정답 자리 쏠림이 상한 안이다', capBad.slice(0, 5), []);
  /* ★나머지 셋이 늘 크기순이면(=섞이지 않으면) 오름차순이 깨진 자리가 정답이라는 실마리가 된다.
     섞였다면 3! = 6 가지 중 오름차순은 1/6 쯤이어야 한다 — '늘 그렇다'만 붉힌다. */
  const totalRounds = stats.length * C.ROUNDS;
  ok('나머지 세 보기의 자리가 늘 크기순은 아니다', ascendingOthers < totalRounds * 0.5,
     ascendingOthers + '/' + totalRounds + ' 라운드가 크기순');
  note('나머지 셋이 크기순인 라운드 ' + ascendingOthers + '/' + totalRounds + ' (섞였다면 1/6 언저리)');

  /* ★자리 예측 불가 — 공격자의 모형을 ★관측에서 세운다(제품 규칙을 베끼지 않는다).
     여러 판을 본 사람은 '한 자리가 최대 몇 번 나오는가'(capHat)를 알게 되고, 그 상한으로
     소진된 자리를 지워 후보를 좁힌다. 어느 시점에도 후보가 하나로 줄면 그 라운드는
     개수를 보지 않고도 맞는다(2026-09-04 master 236 이 지목한 자리). */
  const capHat = Math.max(...stats.map(s => Math.max(...s.counts)));
  let minCand = CONTRACT.OPTIONS, worst = null;
  for (const st of stats){
    const used = [0, 0, 0, 0];
    for (const a of st.seq){
      const cand = used.filter(c => c < capHat).length;
      if (cand < minCand){ minCand = cand; worst = st.key; }
      used[a]++;
    }
  }
  ok('자리 예측 불가(관측 상한 기준)', minCand >= CONTRACT.MIN_CANDIDATES,
     'capHat=' + capHat + ' 최소후보=' + minCand + ' @' + worst);
  note('관측 상한 capHat=' + capHat + ' · 최소 후보 자리 ' + minCand + ' (씨앗 ' + stats.length + '개)');
  const shapes = new Set(stats.map(s => s.counts.slice().sort().join(',')));
  ok('자리 분포가 판마다 달라진다', shapes.size >= 2, [...shapes].slice(0, 6).join(' | '));

  /* 씨앗 결정성 */
  eq('같은 씨앗은 같은 판을 준다', JSON.stringify(A.hm.plan('same')), JSON.stringify(A.hm.plan('same')));
  ok('다른 씨앗은 다른 판을 준다', JSON.stringify(A.hm.plan('a')) !== JSON.stringify(A.hm.plan('b')));
}

/* ============================================================ 3. 오늘의 도전(시각 축) */
section('3. 오늘의 도전');
{
  const A = boot();
  /* ★같은 날 아무 때나 열어도 같은 판인가 · 가짜 벽시계를 크게 옮겨 확인한다.
     같은 순간에 두 번 물어 같은 것은 씨앗에 시각이 섞여 있어도 성립한다(그 그물로는 못 잡는다). */
  A.setWall(new Date(2026, 8, 4, 0, 3, 0).getTime());
  const k1 = A.hm.seedKey(), p1 = JSON.stringify(A.hm.plan(k1)), n1 = A.hm.dailyNo();
  A.setWall(new Date(2026, 8, 4, 23, 51, 0).getTime());
  const k2 = A.hm.seedKey(), p2 = JSON.stringify(A.hm.plan(k2)), n2 = A.hm.dailyNo();
  eq('같은 날이면 시각이 달라도 같은 씨앗이다', k1, k2);
  ok('같은 날이면 시각이 달라도 같은 판이다', p1 === p2);
  eq('같은 날이면 도전 번호가 같다', n1, n2);
  A.setWall(new Date(2026, 8, 5, 12, 0, 0).getTime());
  ok('날짜가 바뀌면 판이 바뀐다', JSON.stringify(A.hm.plan(A.hm.seedKey())) !== p1);
  eq('날짜가 하루 지나면 도전 번호가 하나 오른다', A.hm.dailyNo(), n1 + 1);
}

/* ============================================================ 4. 난수 */
section('4. 난수');
{
  const A = boot();
  A.setWall(new Date(2026, 8, 4, 10, 0, 0).getTime());
  A.dailyBtn();
  A.resetRand();
  playAll(A, true);
  eq('플레이 행동은 난수를 한 번도 소비하지 않는다', A.rand(), 0);
  A.resetRand();
  A.hm.plan('x'); A.hm.plan('y');
  eq('오늘의 도전 판은 씨앗만으로 만들어진다(난수 0)', A.rand(), 0);
}

/* ============================================================ 5. 노출 시간 */
section('5. 노출 시간');
{
  const A = boot();
  A.startBtn();
  const st0 = A.hm.state();
  const exp0 = A.t.planNow().rounds[0].exposure;
  eq('시작하면 도형이 보이는 국면이다', st0.phase, 'show');
  eq('도형이 판에 그려져 있다', A.hm.dotCount(), A.t.planNow().rounds[0].n);
  ok('사라질 시각을 미리 못박아 둔다', st0.hideDue === st0.showStamp + exp0,
     'hideDue=' + st0.hideDue + ' showStamp=' + st0.showStamp + ' exp=' + exp0);
  ok('가림막이 아직 없다', !A.hm.veiled());

  /* ★마감 전에 깬 타이머 · 마감까지 50ms 남긴 채로 타이머만 돌린다 */
  A.advance(exp0 - 50);
  A.runTimers();
  eq('마감 전에 깬 타이머는 사라지게 하지 않는다', A.hm.state().phase, 'show');
  ok('마감 전에 깼으면 남은 시간만큼 다시 건다', A.pendingTimers() === 1, String(A.pendingTimers()));
  ok('마감 전에는 가림막이 없다', !A.hm.veiled());

  /* ★늦게 깬 타이머 · 마감을 120ms 넘겨 깨운다 */
  A.advance(170);
  A.runTimers();
  const st1 = A.hm.state();
  eq('마감이 지나면 도형이 사라진다', st1.phase, 'ask');
  ok('가림막이 덮였다', A.hm.veiled());
  ok('사라짐은 마감 시각으로 확정한다', st1.hideStamp === st1.showStamp + exp0,
     'hideStamp=' + st1.hideStamp + ' 마감=' + (st1.showStamp + exp0));
  eq('늦게 깬 몫이 따로 남는다', st1.lateMs, 120);
  ok('노출은 정해진 시간보다 짧지 않다', (st1.hideStamp + st1.lateMs) - st1.showStamp >= exp0,
     '실노출 ' + ((st1.hideStamp + st1.lateMs) - st1.showStamp) + ' < ' + exp0);
  note('늦어진 몫은 반응 시간 쪽에 얹힌다(플레이어에게 불리하지 않다)');
}

/* ============================================================ 6. 한 판 */
section('6. 한 판');
{
  const A = boot();
  A.startBtn();
  const exp0 = A.t.planNow().rounds[0].exposure;
  /* ★마감에 정확히 맞춰 깨운다 — 늦은 몫 0 에서 재야 반응 시간의 원점이 마감임을 가른다 */
  A.advance(exp0); A.runTimers();
  const r0 = A.t.planNow().rounds[0];
  /* ★논리 즉시 확정 · 연출 타이머를 ★안 돌린 채로 점수·기록이 이미 반영돼야 한다 */
  A.advance(250);
  A.tap(r0.answer);
  const stAfter = A.hm.state();
  eq('맞히면 그 자리에서 점수가 오른다', stAfter.score, 1);
  eq('논리는 누른 순간 확정된다', stAfter.picks.length, 1);
  eq('반응 시간은 마감부터 잰다', stAfter.picks[0] ? stAfter.picks[0].ms : null, 250);
  eq('맞힌 자리에 표가 붙는다', A.hm.optionMarks()[r0.answer], '○');
  eq('국면이 연출로 넘어간다', stAfter.phase, 'gap');
  A.runTimers();
  eq('연출이 끝나면 다음 라운드가 열린다', A.hm.state().round, 1);
  eq('다음 라운드는 다시 도형이 보이는 국면이다', A.hm.state().phase, 'show');

  /* 틀린 라운드 — 점수가 안 오르고 정답 자리도 알려 준다 */
  const r1 = A.t.planNow().rounds[1];
  A.advance(r1.exposure + 5); A.runTimers();
  A.advance(100);
  const wrong = (r1.answer + 1) % 4;
  A.tap(wrong);
  eq('틀리면 점수가 오르지 않는다', A.hm.state().score, 1);
  eq('틀린 자리에 표가 붙는다', A.hm.optionMarks()[wrong], '✕');
  eq('틀리면 정답 자리에도 표가 붙는다', A.hm.optionMarks()[r1.answer], '○');
  ok('맞고 틀림이 색만이 아니라 글자로도 말한다',
     A.hm.optionMarks().filter(Boolean).length >= 2 && A.hm.marked()[wrong] === 'miss',
     JSON.stringify([A.hm.optionMarks(), A.hm.marked()]));

  /* 끝까지 */
  A.runTimers();
  playAll(A, true);
  const res = A.hm.result();
  eq('여덟 라운드를 치르면 판이 끝난다', A.hm.state().phase, 'done');
  eq('치른 라운드 수가 여덟이다', res.rounds, 8);
  eq('기록은 맞힌 라운드 수다', res.score, 7);
  ok('결과 창이 열린다', A.hm.shown('over'));
  ok('평균 반응이 라운드 반응의 평균이다',
     res.avgMs === Math.round(res.picks.reduce((s, p) => s + p.ms, 0) / res.picks.length),
     'avg=' + res.avgMs + ' picks=' + res.picks.map(p => p.ms).join(','));
}

/* ============================================================ 7. 잠금과 입력 */
section('7. 잠금과 입력');
{
  const A = boot();
  A.startBtn();
  /* ★보는 중 · 손가락이 미리 닿아도 아무 일이 없어야 한다 */
  eq('보는 중에는 보기가 잠긴다', A.hm.optionsDisabled(), [true, true, true, true]);
  A.tap(0);
  eq('보는 중에 눌러도 기록이 남지 않는다', A.hm.state().picks.length, 0);
  A.key('1');
  eq('보는 중에는 숫자 키도 먹지 않는다', A.hm.state().picks.length, 0);

  A.advance(A.t.planNow().rounds[0].exposure + 5); A.runTimers();
  eq('보기가 열리면 잠금이 풀린다', A.hm.optionsDisabled(), [false, false, false, false]);
  A.advance(80);
  A.key('2');
  eq('숫자 키 1~4가 보기 넷에 대응한다', A.hm.state().picks.length, 1);
  /* ★기록이 비어 있어도 판정으로 남긴다 · 여기서 추락하면 앞의 FAIL 이 rc=2 에 묻혀
     '검사가 결함을 잡았다' 와 '하네스가 죽었다' 가 같은 종료코드가 된다. */
  eq('누른 자리가 숫자 키가 가리킨 자리다',
     A.hm.state().picks[0] ? A.hm.state().picks[0].pick : null, A.t.planNow().rounds[0].options[1]);
  A.runTimers();

  /* 반복 발화 · Enter 의 preventDefault */
  A.advance(A.t.planNow().rounds[1].exposure + 5); A.runTimers();
  const before = A.hm.state().picks.length;
  A.key('1', { repeat: true });
  eq('누르고 있어서 반복 발화된 숫자 입력은 무시된다', A.hm.state().picks.length, before);
  A.resetPd();
  A.keyOn(0, 'Enter');
  ok('Enter 로 눌렀을 때 preventDefault 가 호출된다', A.pd() === 1, String(A.pd()));
  eq('Enter 로도 답이 들어간다', A.hm.state().picks.length, before + 1);
}

/* ============================================================ 8. 창과 접근성 */
section('8. 창과 접근성');
{
  const A = boot();
  ok('시작 창이 열려 있으면 창 밖 요소에 inert 가 붙는다', A.inertOf('header') === true);
  A.startBtn();
  ok('판이 시작되면 창 밖 inert 가 풀린다', A.inertOf('header') === false);
  playAll(A, true);
  ok('결과 창이 열리면 다시 inert 가 붙는다', A.inertOf('main') === true);
  ok('결과 창의 첫 버튼으로 초점이 옮겨간다', A.focused() && A.focused().id === 'btnAgain',
     A.focused() ? A.focused().id : 'null');
}

/* ============================================================ 9. 기록 */
section('9. 기록');
{
  /* 자유 모드 · 더 많이 맞혔을 때만 바뀐다 */
  const A = boot();
  A.startBtn(); playAll(A, false);
  const first = A.hm.best();
  ok('자유 모드는 최고 기록을 남긴다', first !== null, JSON.stringify(first));
  ok('더 적게 맞힌 판은 최고 기록을 덮지 않는다',
     A.hm.betterThan({ score: first.score - 1, avgMs: 1 }, first) === false);
  ok('더 많이 맞힌 판은 최고 기록이 된다',
     A.hm.betterThan({ score: first.score + 1, avgMs: 99999 }, first) === true);
  ok('같은 점수면 평균 반응이 빠른 쪽이 최고 기록이다',
     A.hm.betterThan({ score: first.score, avgMs: first.avgMs - 1 }, first) === true &&
     A.hm.betterThan({ score: first.score, avgMs: first.avgMs + 1 }, first) === false,
     JSON.stringify(first));

  /* 오늘의 도전 · 최고 기록을 건드리지 않는다 · 하루 한 번 */
  const dailyStore = makeStore();
  const B = boot({ store: dailyStore });
  B.setWall(new Date(2026, 8, 4, 9, 0, 0).getTime());
  B.dailyBtn(); playAll(B, true);
  eq('오늘의 도전은 최고 기록을 건드리지 않는다', B.hm.best(), null);
  const rec1 = B.hm.daily().rec;
  ok('오늘의 도전 결과가 남는다', rec1 && rec1.result && typeof rec1.result.score === 'number',
     JSON.stringify(rec1));
  eq('스트릭이 하루치 쌓인다', B.hm.daily().streak, 1);
  /* ★두 번째 완주가 기록을 덮지 않는다 · 결과 창의 '다시 하기' 는 자유 모드로 가므로
     그 길로는 이 계약을 못 잰다(조용한 통과). 사람이 페이지를 다시 열어 도전을 누르는 길을
     그대로 흉내낸다 — 같은 저장소를 이어받은 새 기동이다. */
  const B2 = boot({ store: dailyStore });
  B2.setWall(new Date(2026, 8, 4, 21, 0, 0).getTime());
  B2.t.refresh();
  B2.dailyBtn(); playAll(B2, false);
  eq('오늘의 도전은 하루 한 번이다', B2.hm.daily().rec.result.score, rec1.result.score);
  ok('두 번째 완주의 점수가 첫 판과 실제로 달랐다', B2.hm.result().score !== rec1.result.score,
     'first=' + rec1.result.score + ' second=' + B2.hm.result().score);

  /* 날짜가 끊기면 스트릭이 1 로 리셋된다 */
  const D = boot();
  D.setWall(new Date(2026, 8, 1, 9, 0, 0).getTime());
  D.dailyBtn(); playAll(D, true);
  eq('첫날 스트릭은 1 이다', D.hm.daily().streak, 1);
  D.setWall(new Date(2026, 8, 5, 9, 0, 0).getTime());
  D.t.refresh();
  /* ★결과 창을 닫고 시작한다 · 창이 떠 있는 동안의 입력은 제품이 무시하므로(overShown)
     창을 안 닫고 다시 시작하면 판이 한 라운드도 안 돌아 '조용한 통과'가 된다. */
  D.againBtn(); playAll(D, true);
  eq('날짜가 끊기면 스트릭이 1 로 리셋된다', D.hm.daily().streak, 1);
}

/* ============================================================ 10. i18n */
section('10. i18n');
{
  const A = boot();
  const keys = A.t.i18nKeys();
  const koOnly = keys.ko.filter(k => !keys.en.includes(k));
  const enOnly = keys.en.filter(k => !keys.ko.includes(k));
  eq('ko 표에만 있는 키가 없다', koOnly, []);
  eq('en 표에만 있는 키가 없다', enOnly, []);
  const marked = A.doc.querySelectorAll('[data-i18n]').map(e => e.dataset.i18n);
  const missing = marked.filter(k => !keys.ko.includes(k) || !keys.en.includes(k));
  eq('마크업의 data-i18n 키가 ko·en 두 표에 모두 있다', missing, []);
  note('i18n 키 ' + keys.ko.length + '개 · 마크업 자리 ' + marked.length + '개를 대조했다');

  /* ★언어를 바꿔도 진행 중인 판이 바뀌지 않는다(개수·보기·자리) */
  A.startBtn();
  const before = JSON.stringify(A.t.planNow());
  const stBefore = A.hm.state();
  A.langBtn();
  ok('언어를 바꿔도 진행 중인 판이 바뀌지 않는다', JSON.stringify(A.t.planNow()) === before);
  const stAfter = A.hm.state();
  eq('언어를 바꿔도 노출 마감이 그대로다', [stAfter.showStamp, stAfter.hideDue], [stBefore.showStamp, stBefore.hideDue]);
  eq('언어가 실제로 바뀌었다', A.hm.lang(), 'en');
}

/* ============================================================ 11. 저장소와 창구 */
section('11. 저장소와 창구');
{
  /* ★한 저장소를 두 번의 기동이 나눠 쓴다 · 결과 창에서 오늘의 도전으로 가는 길은 제품에 없고
     (다시 하기는 자유 모드로 간다) 사람은 페이지를 다시 열어 도전을 누른다. 그 길을 그대로 흉내낸다 —
     그래야 daily·streak 키까지 ★실제로 쓰인다(안 그러면 키 검사가 조용한 통과가 된다). */
  const store = makeStore();
  const A = boot({ store: store });
  A.startBtn(); playAll(A, true);
  const A2 = boot({ store: store });
  A2.setWall(new Date(2026, 8, 4, 9, 0, 0).getTime());
  A2.t.refresh();
  A2.dailyBtn(); playAll(A2, true);
  const keys = store.keys().sort();
  ok('오늘의 도전까지 돌아 네 키가 모두 쓰였다',
     ['hm.best','hm.daily','hm.streak','bp.lang'].every(k => keys.includes(k)), keys.join(','));
  const allowed = ['bp.lang', 'hm.best', 'hm.daily', 'hm.sound', 'hm.streak'];
  eq('제품이 쓰는 저장 키는 방침에 적힌 다섯뿐이다', keys.filter(k => !allowed.includes(k)), []);
  note('실제로 쓰인 키: ' + keys.join(', '));

  /* ★관측 창구에는 상태를 바꾸는 명령이 없어야 한다(배포본에 조작 API 를 두지 않는다).
     이름으로 거르지 않고 ★불러 본 뒤 상태가 변했는지로 판정한다. */
  const B = boot();
  B.startBtn();
  const snap = () => JSON.stringify(B.hm.state()) + '|' + JSON.stringify(B.t.planNow()) + '|' + B.hm.dotCount();
  const s0 = snap();
  const changed = [];
  for (const name of Object.keys(B.hm)){
    const fn = B.hm[name];
    if (typeof fn !== 'function') continue;
    try { fn(); } catch (_){ /* 인자가 필요한 창구는 던질 수 있다 · 그것도 상태를 안 바꾼다 */ }
    if (snap() !== s0) changed.push(name);
  }
  eq('관측 창구를 불러도 상태가 바뀌지 않는다', changed, []);
  note('창구 ' + Object.keys(B.hm).length + '개를 전부 불러 보고 상태를 대조했다');
}

/* ============================================================ 12. CSS 로 셈하는 터치 목표 */
section('12. 터치 목표');
{
  /* ★숫자를 박지 않고 CSS 에서 읽어 셈한다 · 실브라우저 실측은 액션 5 가 따로 한다.
     main 좌우 패딩과 판 너비 상한, 칸 사이 간격 셋으로 보기 칸의 폭이 정해진다. */
  const css = RAW;
  const pad = /main\{width:100%;max-width:520px;padding:4px (\d+)px/.exec(css);
  const cap = /\.hm-answers\{display:grid;grid-template-columns:1fr 1fr;gap:(\d+)px;width:100%;max-width:min\(100%,(\d+)px\)\}/.exec(css);
  const minH = /\.hm-btn\{min-height:(\d+)px/.exec(css);
  if (!pad || !cap || !minH){
    ok('CSS 에서 터치 목표를 셈할 세 치수를 읽었다', false,
       'pad=' + !!pad + ' answers=' + !!cap + ' minH=' + !!minH);
  } else {
    const padPx = Number(pad[1]), gap = Number(cap[1]), maxW = Number(cap[2]), h = Number(minH[1]);
    const VIEW = 360;
    /* ★실측은 ★그 실측이 성립한 조건과 함께 저장한다 · 스크롤막대 폭이 뷰포트를 갉아먹으므로
       그 값을 빼고 셈해야 실측과 맞는다(장기기억 store-a-calibration-with-its-conditions). */
    const CALIB = [
      { when: 'headless Chrome 360x780 · dpr 1 · 확대 100% · 2026-09-04 실측', sb: 15, btnW: 157.5, btnH: 64 }
    ];
    const btnWidthAt = sb => (Math.min(VIEW - sb - 2 * padPx, maxW) - gap) / 2;
    const off = CALIB.map(c => ({ c: c, got: btnWidthAt(c.sb), diff: Math.abs(btnWidthAt(c.sb) - c.btnW) }));
    ok('이 셈이 실브라우저 실측(보기 칸 폭)을 재현한다', off.every(o => o.diff <= 1),
       off.map(o => o.c.when + ' 셈=' + o.got + ' 실측=' + o.c.btnW).join(' | '));
    for (const c of CALIB) note('실측 조건 ' + c.when + ' · 스크롤막대 ' + c.sb + 'px · 칸 ' + c.btnW + ' x ' + c.btnH + 'px');
    /* ★하한 판정은 ★가장 불리한 조건(스크롤막대가 가장 넓은 실측)으로 한다 */
    const worstSb = Math.max(...CALIB.map(c => c.sb));
    const w = btnWidthAt(worstSb);
    ok('보기 칸은 360px 에서 짧은 변이 50px 하한을 지킨다', Math.min(w, h) >= 50,
       '폭 ' + w + 'px · 높이 ' + h + 'px');
    note('360px(스크롤막대 ' + worstSb + 'px)에서 보기 칸 ' + w + ' x ' + h + 'px (판 좌우 패딩 ' + padPx + ' · 칸 사이 ' + gap + ' · 상한 ' + maxW + ')');
  }
}

/* ============================================================ 요약 */
console.log('\n' + '='.repeat(60));
console.log('PASS ' + pass + ' · FAIL ' + fail);
if (fail){ console.log('실패한 검사:'); for (const f of failures) console.log('  - ' + f); }
process.exit(fail ? 1 : 0);
