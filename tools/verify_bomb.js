#!/usr/bin/env node
/* verify_bomb.js — 「폭탄 돌리기」 검증 (판은 시작될 때 정해지고, 그 뒤로 아무도 못 바꾼다)
 *
 * `bomb/index.html` 의 인라인 스크립트를 **그대로 꺼내** 최소 DOM 스텁 위에서 돌린다.
 * 시험용 뒷문은 제품에 두지 않는다 — 배포본의 `window.__bmb` 는 **읽기 전용 창구**이고,
 * 이 검사기는 판을 바꾸는 입구를 쓰지 않는다(쓸 수 있으면 그것 자체가 제품의 결함이다).
 *
 * 이 게임에 실린 약속은 둘이고, 검사의 무게는 전부 거기에 있다.
 *   ★① 도화선과 미션 수열은 **판이 시작될 때 전부 정해진다** — 플레이어의 행동은 난수를
 *      한 톨도 소비하지 않는다. 그래서 "내가 눌러서 터졌다" 가 성립할 수 없다.
 *   ★② 첫 사람 즉사 배제는 **생성 규칙**에 있다 — 뽑고 나서 버리는 사후 필터가 아니다.
 *
 * 그리고 이 게임이 화면에서 지켜야 하는 것 하나:
 *   ★③ 남은 시간을 **수로 알려주지 않는다**. 알려주면 마지막 사람이 계산으로 피해 게임이 죽는다.
 *
 * ★검사는 제품의 함수로 제품을 채점하지 않는다. 도화선 하한·반복 상한·단계 경계는
 *   이 파일이 **자기 것으로 다시 계산**해 대조한다(같은 함수로 두 번 재면 자기채점이다).
 *
 * 사용법:
 *   node tools/verify_bomb.js                        # 대조군(기본 대상 = 이 저장소의 bomb/index.html)
 *   node tools/verify_bomb.js --html bomb/index.html
 *   node tools/verify_bomb.js --list-mutations
 *   node tools/verify_bomb.js --mutate m-fuse-postfilter   # 검출력 확인(임시 사본에만 주입)
 *
 * 종료코드: 0 = 전부 통과 · 1 = 미달 있음 · 2 = 검사를 세울 수 없음(하네스·주입 실패·검사 미실행).
 *   --mutate 를 걸었을 때만 쓰는 코드가 하나 더 있다: 3 = 주입은 됐는데 ★지목한 검사가 잡지
 *   못했다(검사가 공허하다). '못 세웠다'(2)와 '못 잡았다'(3)를 한 코드로 묶으면 호출자가
 *   원인을 오분류한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = n => argv.indexOf(n) >= 0;

const HTML = argOf('--html', path.join(__dirname, '..', 'bomb', 'index.html'));
const MUTATION = argOf('--mutate', null);

/* ------------------------------------------------------------ 뮤테이션 표
   ★각 뮤테이션은 '어느 검사가 잡아야 하는가' 를 ★이름으로 지목한다. 지목한 검사가
   아예 돌지 않았으면(앵커 노후화) rc=2 로 멈춘다 — 무임승차를 인정하지 않는다. */
const MUTATIONS = {
  'm-fuse-postfilter': {
    why: '최소 보장을 ★생성 규칙에서 빼고 사후 필터로 바꾼다(짧게 뽑은 뒤 고쳐 준다)',
    target: 'fuse-floor-is-generative',
    apply: s => s.replace(
      'var fuseMs = FUSE_MIN_MS + Math.floor(rnd() * (FUSE_SPAN_MS + 1));',
      'var fuseMs = Math.floor(rnd() * (FUSE_MIN_MS + FUSE_SPAN_MS + 1));\n  if (fuseMs < FUSE_MIN_MS) fuseMs = FUSE_MIN_MS;')
  },
  'm-fuse-no-floor': {
    why: '최소 보장을 통째로 없앤다 — 첫 사람이 시작하자마자 터질 수 있게 된다',
    target: 'fuse-floor-is-generative',
    apply: s => s.replace(
      'var fuseMs = FUSE_MIN_MS + Math.floor(rnd() * (FUSE_SPAN_MS + 1));',
      'var fuseMs = Math.floor(rnd() * (FUSE_SPAN_MS + 1));')
  },
  'm-pass-consumes-rng': {
    why: '넘기기가 난수를 소비하게 한다 — 행동이 판을 바꾼다',
    target: 'action-consumes-no-randomness',
    apply: s => s.replace(
      '  state.passes += 1;',
      '  state.passes += 1;\n  state.planned.fuseMs += Math.floor(Math.random() * 1000);')
  },
  'm-pass-late-tick': {
    why: '넘기기가 만료를 ★늦게 본다 — 도화선이 다한 뒤 누른 탭이 폭탄을 넘겨 무고한 다음 사람이 진다',
    target: 'a-round-actually-runs',
    apply: s => s.replace(
      "  tick();\n  if (state.phase !== 'running') return;\n  state.passes += 1;",
      '  state.passes += 1;')
  },
  'm-repeat-cap-off': {
    why: '반복 상한을 뽑는 자리에서 걷는다 — 같은 미션이 연달아 나올 수 있게 된다',
    target: 'repeat-cap-at-draw-site',
    apply: s => s.replace(
      'var recent = missions.slice(Math.max(0, missions.length - win));',
      'var recent = [];')
  },
  'm-repeat-cap-resample': {
    why: '반복 상한을 ★전 수열 재추첨으로 바꾼다 — 안 밟히는 복구 가지를 만든다',
    target: 'repeat-cap-at-draw-site',
    apply: s => s.replace(
      '    missions.push(allowed[Math.floor(rnd() * allowed.length)]);',
      '    missions.push(pool[Math.floor(rnd() * pool.length)]);\n    if (missions.length > 1 && missions[missions.length - 1] === missions[missions.length - 2]) { missions.length = 0; i = -1; }')
  },
  'm-window-not-derived': {
    why: '반복창을 목록 크기에서 파생시키지 않고 상수로 되돌린다 — 짧은 목록에서 후보가 0이 된다',
    target: 'repeat-cap-at-draw-site',
    apply: s => s.replace(
      'var win = Math.min(REPEAT_WINDOW, pool.length - 1);',
      'var win = REPEAT_WINDOW;')
  },
  'm-start-time-drift': {
    why: '★시작 시각을 앞당긴다 — fuseMs 는 그대로라 길이만 재는 단언은 초록이지만 ★폭발 시각이 당겨진다',
    target: 'action-consumes-no-randomness',
    apply: s => s.replace(
      '  state.passes += 1;',
      '  state.startedAt -= 500;' + String.fromCharCode(10) + '  state.passes += 1;')
  },
  'm-seconds-on-screen': {
    why: '남은 시간을 화면에 수로 적는다 — 마지막 사람이 계산으로 피할 수 있게 된다',
    target: 'never-reveals-time-left',
    apply: s => s.replace(
      "  if (elFuseWord) elFuseWord.textContent = T(STAGE_TEXT[state.stage]);",
      "  if (elFuseWord) elFuseWord.textContent = T(STAGE_TEXT[state.stage]) + ' ' + Math.ceil((state.planned ? state.planned.fuseMs - (Date.now() - state.startedAt) : 0) / 1000) + 's';")
  },
  'm-seconds-into-turn': {
    why: '남은 초를 도화선 자리가 아니라 ★차례 자리에 흘린다 — 사정거리가 짧은 검사는 이걸 놓친다',
    target: 'never-reveals-time-left',
    apply: s => s.replace(
      "  if (elTurnWho) elTurnWho.textContent = T('turnWho', state.holder + 1);",
      "  if (elTurnWho) elTurnWho.textContent = T('turnWho', state.holder + 1) + ' ' + Math.ceil((state.planned ? state.planned.fuseMs - (Date.now() - state.startedAt) : 0) / 1000);")
  },
  'm-rename-rnd-to-roll': {
    why: '★조용해야 하는 대조군 — plan 안의 rnd 를 roll 로 개명한다(행동은 한 톨도 안 바뀐다)',
    expect: 'quiet',
    apply: s => s.replace(new RegExp('\\brnd\\b', 'g'), 'roll')
  },
  'm-lang-list-shared': {
    why: '영어 미션 목록을 한국어 목록으로 덮는다 — 한쪽만 빠진 항목을 못 보게 만든다',
    target: 'mission-lists-are-per-language',
    /* ★목록 리터럴을 정규식으로 도려내지 않는다 — 그렇게 하면 문법이 깨져 '주입 실패'(rc=2)가
       되고, 그것은 검출력 시험이 아니라 하네스 사고다. 목록이 다 만들어진 뒤 en 을 ko 로 덮는다. */
    apply: s => s.replace('var I18N = {', 'MISSIONS.en = MISSIONS.ko.slice();\nvar I18N = {')
  },
  'm-ink-on-sig': {
    why: '★음성 대조군 — --sig 바탕 위에 --sig-ink 계열 글자를 얹는다(라이트 3.58 < 하한 4.5)',
    target: 'ink-never-on-sig',
    apply: s => s.replace(
      '  .btn.primary{background:var(--sig);color:var(--on-sig)}',
      '  .btn.primary{background:var(--sig);color:var(--sig-ink)}')
  },
  'm-i18n-on-live-node': {
    why: '판 진행 중 바뀌는 자리에 data-i18n 을 붙인다 — 언어 전환이 진행 중 내용을 덮는다',
    target: 'no-i18n-on-live-nodes',
    apply: s => s.replace(
      '<div class="mission" id="mission">',
      '<div class="mission" id="mission" data-i18n="result">')
  },
  'm-plan-reads-clock': {
    why: '판 짜기가 시계를 읽게 한다 — 느린 기기에서만 결과가 갈리는 시간 기반 분기',
    target: 'plan-is-pure',
    apply: s => s.replace(
      'function plan(seed, players, pool){\n  var rnd = makeRng(seed);',
      'function plan(seed, players, pool){\n  var rnd = makeRng(seed ^ (Date.now() & 0xffff));')
  }
};

if (has('--list-mutations')) {
  Object.keys(MUTATIONS).forEach(k => console.log(k.padEnd(24) + (MUTATIONS[k].target || '(quiet-control)').padEnd(32) + MUTATIONS[k].why));
  process.exit(0);
}

let RAW;
try { RAW = fs.readFileSync(HTML, 'utf8'); }
catch (e) { console.error('대상 파일을 읽지 못했다: ' + HTML); process.exit(2); }
/* ★배포 파일은 CRLF 다. 아래 앵커는 전부 LF 로 적혀 있으므로 한 번만 갈아 끼운다 —
   빠뜨리면 여러 줄 앵커가 통째로 어긋나 '주입 실패' 로 떨어진다. 줄끝은 판정 대상이 아니다. */
RAW = RAW.split('\r\n').join('\n');

if (MUTATION) {
  const m = MUTATIONS[MUTATION];
  if (!m) { console.error('모르는 뮤테이션: ' + MUTATION); process.exit(2); }
  const before = RAW;
  RAW = m.apply(RAW);
  if (RAW === before) { console.error('주입 실패(앵커가 안 맞는다): ' + MUTATION); process.exit(2); }
  console.log('※ 뮤테이션 주입: ' + MUTATION + ' — ' + m.why);
  console.log('※ 지목한 검사: ' + (m.target || '(quiet-control · 아무 검사도 붉으면 안 된다)'));
}

/* ------------------------------------------------------------ 게임 스크립트 꺼내기 */
function gameSource(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) { if (!/\bsrc=/.test(m[1]) && !/type="application\/ld\+json"/.test(m[1])) out.push(m[2]); }
  /* ★부분 문자열로 고르지 않는다 — 고르는 기준은 ★창구를 여는 자리다. */
  return out.find(s => s.indexOf('window.__bmb = {') >= 0) || null;
}
const SRC = gameSource(RAW);
if (!SRC) { console.error('게임 스크립트(window.__bmb = { 을 여는 인라인 <script>)를 찾지 못했다'); process.exit(2); }

/* ------------------------------------------------------------ 최소 DOM 스텁 */
function mkEl(id) {
  return {
    id, tagName: 'DIV', hidden: false, textContent: '', innerHTML: '',
    attrs: {}, kids: [], listeners: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.kids.push(c); c.parentNode = this; return c; },
    querySelectorAll() { return this.kids; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    fire(t, ev) { (this.listeners[t] || []).forEach(f => f(ev || { target: this })); }
  };
}
function makeWorld(opts) {
  const els = {};
  ['start', 'play', 'over', 'whoPick', 'fuse', 'fuseWord', 'fuseIcon', 'mission', 'turnWho',
    'passCount', 'btnPass', 'loser', 'loserSub', 'nPlayers', 'nPasses', 'nTime', 'btnStart',
    'btnAgain', 'btnSound', 'btnLang'].forEach(i => { els[i] = mkEl(i); });
  const store = {};
  const doc = {
    readyState: 'complete',
    documentElement: { lang: 'ko' },
    getElementById: id => els[id] || null,
    querySelectorAll: () => [],
    createElement: t => { const e = mkEl(''); e.tagName = String(t).toUpperCase(); return e; },
    addEventListener: () => {}
  };
  const win = {
    document: doc, navigator: { language: 'ko-KR' },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0,
    addEventListener: () => {}, Math, Date, console, JSON
  };
  win.window = win;
  /* ★재현성은 ★하네스에서 만든다 — 제품에 씨앗 주입구를 뚫지 않는다.
     배포본은 crypto.getRandomValues 가 없으면 Math.random 으로 떨어지므로, 이 스텁의
     Math.random 만 고정하면 ★같은 판이 다시 나온다. 조작 훅은 검사기 쪽에 있어야 한다. */
  if (opts && typeof opts.fixedRandom === 'number'){
    const fixed = opts.fixedRandom;
    win.Math = Object.create(Math);
    win.Math.random = () => fixed;
  }
  vm.createContext(win);
  try { vm.runInContext(SRC, win, { filename: 'bomb-inline.js' }); }
  catch (e) { console.error('스크립트 실행 실패: ' + e.message); process.exit(2); }
  if (!win.__bmb) { console.error('관측 창구(window.__bmb)가 없다'); process.exit(2); }
  return { win, els, doc, store };
}

/* ------------------------------------------------------------ 채점판 */
const results = [];   /* {name, ok, detail} */
const ran = new Set();
function check(name, fn) {
  ran.add(name);
  let ok = false, detail = '';
  try { const r = fn(); ok = !!(r && r.ok); detail = (r && r.detail) || ''; }
  catch (e) { ok = false; detail = '예외: ' + e.message; }
  results.push({ name, ok, detail });
}

const W = makeWorld();
const bmb = W.win.__bmb;
const C = bmb.consts();

/* ── ① 도화선 하한이 ★생성 규칙인가 ─────────────────────────────────────
   사후 필터와 생성 규칙은 최소값만 보면 구별되지 않는다(둘 다 하한에서 멈춘다).
   가르는 것은 ★분포다: 사후 필터는 잘린 값이 하한에 ★쌓여 뭉치를 만든다. */
check('fuse-floor-is-generative', () => {
  const N = 20000;
  let below = 0, atFloor = 0, min = Infinity, max = -Infinity;
  const buckets = new Array(10).fill(0);
  for (let s = 0; s < N; s++) {
    const f = bmb.plan(s, 4, bmb.missions.ko).fuseMs;
    if (f < C.FUSE_MIN_MS) below++;
    if (f === C.FUSE_MIN_MS) atFloor++;
    min = Math.min(min, f); max = Math.max(max, f);
    const b = Math.min(9, Math.floor((f - C.FUSE_MIN_MS) / ((C.FUSE_SPAN_MS + 1) / 10)));
    if (b >= 0 && b < 10) buckets[b]++;
  }
  const expect = N / 10;
  const worst = Math.max(...buckets.map(b => Math.abs(b - expect) / expect));
  /* 균등이면 10칸이 고르다. 사후 필터면 첫 칸에 잘린 것이 몰려 크게 부푼다. */
  const ok = below === 0 && atFloor <= 3 && worst < 0.25 && max <= C.FUSE_MIN_MS + C.FUSE_SPAN_MS;
  return { ok, detail: '표본 ' + N + ' · 하한미만 ' + below + ' · 하한에 정확히 ' + atFloor +
    ' · 최소 ' + min + ' 최대 ' + max + ' · 10분위 최대편차 ' + (worst * 100).toFixed(1) + '%' };
});

/* ── ② 행동이 난수를 소비하지 않는가 ─────────────────────────────────── */
check('action-consumes-no-randomness', () => {
  const w = makeWorld();
  w.els.btnStart.fire('click');
  const a = w.win.__bmb.snapshot();
  for (let i = 0; i < 25; i++) w.els.btnPass.fire('click');
  const b = w.win.__bmb.snapshot();
  /* 같은 씨앗으로 다시 짠 판이 넘기기 뒤에도 그대로인가 — 판의 내용은 씨앗과 인원만의 함수다 */
  const again = w.win.__bmb.plan(a.seed, a.players, w.win.__bmb.missions.ko);
  /* ★fuseMs 동일성만 재면 ★시작 시각을 앞당기는 변이에 초록이 된다 — 사람이 겪는 것은
     길이가 아니라 ★폭발 시각(startedAt + fuseMs)이다. 두 값을 함께 잰다. */
  const boomA = a.startedAt + a.fuseMs, boomB = b.startedAt + b.fuseMs;
  const ok = a.seed === b.seed && a.fuseMs === b.fuseMs && again.fuseMs === a.fuseMs &&
             b.passes === 25 && a.startedAt === b.startedAt && boomA === boomB;
  return { ok, detail: '넘기기 25회 · fuseMs ' + a.fuseMs + ' -> ' + b.fuseMs +
    ' · 시작시각 ' + a.startedAt + ' -> ' + b.startedAt +
    ' · ★폭발 시각 ' + boomA + ' -> ' + boomB + ' · 씨앗 ' + a.seed + ' -> ' + b.seed };
});

/* ── ③ 반복 상한이 ★뽑는 자리에 걸려 있는가 ────────────────────────────
   ★전 수열 재추첨(복구 가지)과 구별해야 한다. 재추첨은 결과만 보면 같아 보이므로
   ★뽑히는 총 횟수(난수 소비량)로 가른다: 재추첨은 버린 수열만큼 난수를 더 쓴다. */
check('repeat-cap-at-draw-site', () => {
  let violations = 0, plans = 0;
  for (let s = 0; s < 800; s++) {
    const p = bmb.plan(s, 4, bmb.missions.ko); plans++;
    for (let i = 0; i < p.missions.length; i++) {
      for (let k = 1; k <= C.REPEAT_WINDOW && i - k >= 0; k++) {
        if (p.missions[i] === p.missions[i - k]) violations++;
      }
    }
  }
  /* ★철자를 보지 않는다. 앞서 이 검사는 String(plan) 안에 'rnd()' 라는 ★글자가 있는지를 봤는데,
     그것은 대리물이라 ★rnd 를 roll 로 개명한 무해한 사본에서 거짓 실패를 냈다(리뷰어 실측).
     대신 ★행동을 본다: 같은 씨앗이면 같은 수열이고(난수를 쓴다는 뜻이자 결정론이라는 뜻),
     다른 씨앗이면 대체로 다른 수열이다(상수를 돌려주는 가짜가 아니다). */
  const sameSeed = bmb.plan(4242, 4, bmb.missions.ko).missions.join('|') ===
                   bmb.plan(4242, 4, bmb.missions.ko).missions.join('|');
  let differing = 0;
  for (let s = 0; s < 50; s++) {
    if (bmb.plan(s, 4, bmb.missions.ko).missions.join('|') !==
        bmb.plan(s + 1000, 4, bmb.missions.ko).missions.join('|')) differing++;
  }
  const usesRnd = sameSeed && differing >= 48;
  /* ★창이 목록 크기에서 파생되는가 — 짧은 목록을 넣어 직접 확인한다.
     상수를 그대로 쓰면 후보가 0이 되어 undefined 가 섞이고, 재추첨 구현이면 ★끝나지 않는다.
     ★그래서 시간 제한을 걸고 부른다 — 끝나지 않는 것도 결함이지 '아직 안 끝났다' 가 아니다.
     (시간 제한은 ★검사기의 안전장치다. 제품 안에는 시간 기반 분기를 두지 않는다.) */
  const tiny = ['가', '나', '다'];                       /* 3종 < REPEAT_WINDOW(4) */
  let tp = null, tinyErr = '';
  try {
    W.win.__tinyPool = tiny;
    tp = vm.runInContext('window.__bmb.plan(7, 4, window.__tinyPool)', W.win, { timeout: 3000 });
  } catch (e) { tinyErr = e.message; }
  const tinyOk = !!tp && tp.missions.length === C.MISSION_COUNT &&
                 tp.missions.every(m => tiny.indexOf(m) >= 0) &&
                 tp.window === Math.min(C.REPEAT_WINDOW, tiny.length - 1);
  let tinyViol = 0;
  if (tp) for (let i = 1; i < tp.missions.length; i++) if (tp.missions[i] === tp.missions[i - 1]) tinyViol++;
  const ok = violations === 0 && usesRnd && tinyOk && tinyViol === 0;
  /* ★왜 붉은지를 줄에서 읽을 수 있어야 한다 — '위반 0' 만 찍히면 다음 사람이 이유를 못 읽는다. */
  const why = [];
  if (violations !== 0) why.push('반복창 위반 ' + violations);
  if (!usesRnd) why.push('결정론·변이 대조 실패(같은 씨앗 동일 ' + sameSeed + ' · 다른 씨앗이 다른 비율 ' + differing + '/50)');
  if (!tinyOk) why.push('짧은 목록 파생 실패' + (tp ? '' : '(★끝나지 않았다: ' + tinyErr + ')'));
  if (tinyViol !== 0) why.push('짧은 목록 인접 반복 ' + tinyViol);
  return { ok, detail: '표본 ' + plans + '판 x ' + C.MISSION_COUNT + '자리 · 반복창(' +
    C.REPEAT_WINDOW + ') 위반 ' + violations +
    ' · 같은 씨앗 재현 ' + sameSeed + ' · 다른 씨앗이 다른 수열 ' + differing + '/50' +
    ' · ★3종 목록에서 창 파생 ' + (tp ? tp.window : '★끝나지 않았다') + '(기대 ' + Math.min(C.REPEAT_WINDOW, tiny.length - 1) +
    ') · 길이 ' + (tp ? tp.missions.length : '-') + ' · 인접 반복 ' + tinyViol +
    (why.length ? '  ★미달 사유: ' + why.join(' / ') : '') };
});

/* 재추첨 가지를 따로 잰다 — 난수를 세는 발생기를 제품 함수에 ★넘겨서. */
check('repeat-cap-no-resample-branch', () => {
  /* plan 은 씨앗만 받으므로 소비량을 직접 못 센다. 대신 ★같은 판이 두 번 나오는지로 본다:
     재추첨 구현은 실패한 수열을 버리고 처음부터 다시 뽑아 ★난수 흐름이 밀린다.
     밀림이 있으면 인접한 씨앗들끼리 수열 앞부분이 겹치는 비율이 눈에 띄게 달라진다.
     여기서는 더 단순하고 확실한 것을 잰다 — ★수열 길이가 항상 MISSION_COUNT 인가.
     (재추첨 구현은 i 를 되감으므로 중간 상태에서 길이가 무너진다) */
  let bad = 0;
  for (let s = 0; s < 2000; s++) {
    const p = bmb.plan(s, 4, bmb.missions.ko);
    if (p.missions.length !== C.MISSION_COUNT) bad++;
    if (p.missions.some(m => bmb.missions.ko.indexOf(m) < 0)) bad++;
  }
  return { ok: bad === 0, detail: '표본 2000판 · 길이·출처 어긋남 ' + bad + ' (기대 길이 ' + C.MISSION_COUNT + ')' };
});

/* ── ④ 미션 목록은 ★언어마다 별개인가 (닫힌 목록은 언어별로 각각 본다) ── */
check('mission-lists-are-per-language', () => {
  const ko = bmb.missions.ko, en = bmb.missions.en;
  const kset = new Set(ko), eset = new Set(en);
  let shared = 0; kset.forEach(v => { if (eset.has(v)) shared++; });
  const koDup = ko.length - kset.size, enDup = en.length - eset.size;
  const hangul = /[ㄱ-ㆎ가-힣]/;
  const koAllHangul = ko.every(t => hangul.test(t));
  const enNoHangul = en.every(t => !hangul.test(t));
  const ok = shared === 0 && koDup === 0 && enDup === 0 && ko.length >= 20 && en.length >= 20 &&
             koAllHangul && enNoHangul;
  return { ok, detail: 'ko ' + ko.length + '종(중복 ' + koDup + ') · en ' + en.length +
    '종(중복 ' + enDup + ') · 겹침 ' + shared + ' · ko 전부 한글 ' + koAllHangul + ' · en 한글 없음 ' + enNoHangul };
});

/* 두 판이 각 언어의 목록 ★안에서만 뽑히는가 — 한 집합으로 대조하면 못 보는 자리다 */
check('missions-drawn-from-own-language', () => {
  let bad = 0;
  for (const L of ['ko', 'en']) {
    const pool = bmb.missions[L], other = new Set(bmb.missions[L === 'ko' ? 'en' : 'ko']);
    for (let s = 0; s < 300; s++) {
      for (const m of bmb.plan(s, 4, pool).missions) {
        if (pool.indexOf(m) < 0) bad++;
        if (other.has(m)) bad++;
      }
    }
  }
  return { ok: bad === 0, detail: '두 언어 x 300판 · 남의 목록에서 새어 나온 미션 ' + bad };
});

/* ── ⑤ 남은 시간을 ★수로 알려주지 않는가 ──────────────────────────────── */
check('never-reveals-time-left', () => {
  /* ★사정거리를 네 자리 전부로 넓힌다. 앞서 이 검사는 도화선 두 자리만 봐서, 남은 초를
     ★차례 자리에 흘린 사본이 통과했다(리뷰어 실측).
     ★가르는 방법: 같은 판(같은 씨앗)을 ★서로 다른 시각에 같은 횟수만큼 넘겨 놓고
     네 자리의 글자를 대조한다. 차례·넘긴 횟수는 넘기기로만 정해지므로 두 판이 같아야 하고,
     남은 시간이 어디로든 새면 ★두 판의 글자가 갈린다. 수의 유무로는 못 가른다(차례에도 수가 있다). */
  const slots = ['fuseWord', 'fuseIcon', 'turnWho', 'passCount', 'mission'];
  const runAt = (fracs) => {
    const w = makeWorld({ fixedRandom: 0.4242 });     /* ★같은 판을 두 번 세운다 */
    const realNow = Date.now;
    const t0 = realNow();
    Date.now = () => t0;
    w.els.btnStart.fire('click');
    const fuse = w.win.__bmb.snapshot().fuseMs;
    const shots = [];
    for (const f of fracs) {
      Date.now = () => t0 + Math.floor(fuse * f);
      w.els.btnPass.fire('click');
      shots.push(slots.map(id => String(w.els[id].textContent)));
    }
    Date.now = realNow;
    return { shots, fuse };
  };
  const early = runAt([0.02, 0.05, 0.08]);
  const late  = runAt([0.30, 0.55, 0.78]);
  /* ★도화선 두 자리는 시각에 따라 달라지는 것이 ★설계다(세 단계로 알려 준다) — 대조에서 뺀다.
     대신 그 두 자리는 아래에서 ★닫힌 집합(단계 3종)인지로 잰다. 시간 정보가 그 자리로 새면
     값의 가짓수가 3을 넘는다. 나머지 세 자리(차례·횟수·미션)는 ★넘기기로만 정해지므로
     두 시각에서 글자가 같아야 한다. */
  const timeFree = [2, 3, 4];       /* turnWho · passCount · mission */
  const diffs = [];
  for (let i = 0; i < early.shots.length; i++) {
    for (const j of timeFree) {
      if (early.shots[i][j] !== late.shots[i][j]) {
        diffs.push(slots[j] + '@넘기기' + (i + 1) + ': ' + JSON.stringify(early.shots[i][j]) +
                   ' vs ' + JSON.stringify(late.shots[i][j]));
      }
    }
  }
  /* 도화선 자리: 수가 ★아예 없어야 하고, 값의 가짓수가 ★단계 수(3)를 넘으면 안 된다.
     시간을 그 자리로 흘리면 값이 시각마다 달라져 가짓수가 곧 3을 넘는다. */
  const fuseDigits = [];
  const wordSet = new Set(), iconSet = new Set();
  const sweep = runAt([0.05, 0.20, 0.35, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95]);
  for (const sh of early.shots.concat(late.shots, sweep.shots)) {
    if (/\d/.test(sh[0])) fuseDigits.push(sh[0]);
    if (/\d/.test(sh[1])) fuseDigits.push(sh[1]);
    wordSet.add(sh[0]); iconSet.add(sh[1]);
  }
  const closed = wordSet.size <= 3 && iconSet.size <= 3;
  return { ok: diffs.length === 0 && fuseDigits.length === 0 && closed,
    detail: '같은 판을 ★이른 시각과 늦은 시각에 각각 3회 넘겨 ' + (timeFree.length * 3) + '칸 대조(시간과 무관해야 하는 자리) · 갈린 칸 ' +
      diffs.length + ' · 도화선 자리에 실린 수 ' + fuseDigits.length +
      ' · 도화선 문구 가짓수 ' + wordSet.size + '/아이콘 ' + iconSet.size + '(상한 3) ' +
      (diffs.length ? '  ★시간 유출: ' + JSON.stringify(diffs.slice(0, 3)) : '') +
      (fuseDigits.length ? '  ★도화선에 수: ' + JSON.stringify(fuseDigits.slice(0, 2)) : '') };
});

/* 단계는 셋뿐이고, 시작 직후는 반드시 calm 이다(★검사기가 경계를 다시 계산해 대조한다) */
check('stage-has-exactly-three-steps', () => {
  const seen = new Set();
  let mismatch = 0;
  for (let i = 0; i <= 1000; i++) {
    const r = i / 1000, got = bmb.stageOf(r * 60000, 60000);
    const want = r >= C.STAGE_HOT ? 'hot' : (r >= C.STAGE_WARM ? 'warm' : 'calm');
    if (got !== want) mismatch++;
    seen.add(got);
  }
  return { ok: seen.size === 3 && mismatch === 0 && bmb.stageOf(0, 60000) === 'calm',
    detail: '단계 ' + [...seen].sort().join(',') + ' · 자체 계산과 어긋남 ' + mismatch + '/1001' };
});

/* ── ⑥ ★음성 대조군 — --sig 바탕 위에 --sig-ink 계열이 오면 안 된다 ────
   이 게임의 라이트 --sig(#7a7200) 위에서 --sig-ink(#4a4400)는 3.58 로 하한 4.5 에 못 미친다.
   지금은 아무도 그 조합을 쓰지 않는다 — 그 ★전제가 참인 동안 이 검사는 조용하고,
   누가 나중에 그 조합을 만들면 ★시험이 대신 소리친다(master 판정 2026-09-06). */
check('ink-never-on-sig', () => {
  const css = (RAW.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  /* 선언 블록을 하나씩 보고, background 가 --sig 인데 color 가 --sig-ink/--text/--muted 계열이면 미달 */
  const bad = [];
  const blocks = css.split('}');
  for (const b of blocks) {
    const body = b.slice(b.indexOf('{') + 1);
    if (b.indexOf('{') < 0) continue;
    const bg = /background\s*:\s*var\(--sig\)/.test(body);
    const fg = /color\s*:\s*var\(--(sig-ink|text|muted|muted-2)\)/.exec(body);
    if (bg && fg) bad.push((b.slice(0, b.indexOf('{')).trim() || '?') + ' -> color:var(--' + fg[1] + ')');
  }
  return { ok: bad.length === 0,
    detail: '선언블록 ' + blocks.length + '개 훑음 · --sig 바탕에 잉크 계열 글자 ' + bad.length +
      (bad.length ? ' — ' + JSON.stringify(bad.slice(0, 3)) : '') };
});

/* ── ⑦ 판 진행 중 바뀌는 자리에 data-i18n 이 없는가 ───────────────────── */
check('no-i18n-on-live-nodes', () => {
  const live = ['mission', 'turnWho', 'passCount', 'fuseWord', 'fuseIcon', 'loser', 'loserSub'];
  const bad = [];
  for (const id of live) {
    const re = new RegExp('<[^>]*id="' + id + '"[^>]*>');
    const m = re.exec(RAW);
    if (!m) { bad.push(id + '(요소를 못 찾았다)'); }
    else if (/data-i18n=/.test(m[0])) bad.push(id);
  }
  return { ok: bad.length === 0, detail: '진행 중 요소 ' + live.length + '개 · data-i18n 이 붙은 것 ' + bad.length +
    (bad.length ? ' — ' + bad.join(',') : '') };
});

/* ── ⑧ 판 짜기는 ★순수 함수인가 (시계를 안 읽는가) ────────────────────── */
check('plan-is-pure', () => {
  const src = String(bmb.plan);
  const readsClock = /Date\s*\.\s*now|new\s+Date|performance\s*\.\s*now/.test(src);
  /* 시계를 가짜로 크게 밀어 놓고 같은 씨앗으로 두 번 짜서 같은 판이 나오는지도 본다 */
  const realNow = Date.now;
  const a = bmb.plan(999, 5, bmb.missions.ko);
  Date.now = () => realNow() + 987654321;
  const b = bmb.plan(999, 5, bmb.missions.ko);
  Date.now = realNow;
  const same = a.fuseMs === b.fuseMs && a.missions.join('|') === b.missions.join('|');
  return { ok: !readsClock && same,
    detail: '소스에 시계 읽기 ' + (readsClock ? '있다' : '없다') + ' · 시계를 987654321ms 밀어도 같은 판 ' + same };
});

/* ── ⑨ 한 판이 실제로 도는가 (제품이 듣는 사건으로) ───────────────────── */
check('a-round-actually-runs', () => {
  const w = makeWorld();
  w.els.btnStart.fire('click');
  let s = w.win.__bmb.snapshot();
  if (s.phase !== 'running') return { ok: false, detail: '시작이 안 걸린다: ' + s.phase };
  const fuse = s.fuseMs;
  const players = s.players;
  for (let i = 0; i < 5; i++) w.els.btnPass.fire('click');
  s = w.win.__bmb.snapshot();
  const holderOk = s.holder === 5 % players && s.passes === 5;
  /* ★만료 클릭 ★직전의 주인을 붙잡아 둔다. 폭발 뒤 상태를 폭발 뒤 표시와 맞춰 보면
     둘이 함께 밀려도 서로 일치해 ★영영 붉어지지 않는다(자기참조). 기준점은 클릭 전에 잡는다. */
  const holderBefore = s.holder;
  const realNow = Date.now;
  Date.now = () => realNow() + fuse + 1000;
  w.els.btnPass.fire('click');
  Date.now = realNow;
  s = w.win.__bmb.snapshot();
  const ended = s.phase === 'over' && w.els.over.hidden === false && w.els.play.hidden === true;
  const shown = String(w.els.loser.textContent);
  const digits = shown.match(/\d+/);
  const shownNum = digits ? Number(digits[0]) : null;
  /* ★도화선이 이미 다한 뒤에 누른 탭은 폭탄을 넘기지 못한다 — 지는 사람은 ★만료 시점의 주인이다.
     1-based 표시이므로 holderBefore + 1 이어야 한다. 한 칸 밀리면 무고한 다음 사람이 진다. */
  const rightVictim = shownNum === holderBefore + 1;
  return { ok: holderOk && ended && rightVictim,
    detail: '인원 ' + players + ' · 넘기기 5회 후 주인 ' + holderBefore + ' · 폭발 후 phase ' + s.phase +
      ' · 진 사람 표시 ' + JSON.stringify(shown) + ' (기대 ' + (holderBefore + 1) + '번' +
      (rightVictim ? '' : ' ★한 칸 밀렸다') + ')' };
});

/* ── ⑩ 인원 범위가 계약대로인가 ────────────────────────────────────────── */
check('player-count-range', () => {
  const w = makeWorld();
  const btns = w.els.whoPick.kids.map(b => Number(b.getAttribute('data-n')));
  const want = [];
  for (let n = C.PLAYERS_MIN; n <= C.PLAYERS_MAX; n++) want.push(n);
  const pressed = w.els.whoPick.kids.filter(b => b.getAttribute('aria-pressed') === 'true')
    .map(b => Number(b.getAttribute('data-n')));
  return { ok: btns.join(',') === want.join(',') && pressed.length === 1 && pressed[0] === C.PLAYERS_DEFAULT,
    detail: '버튼 ' + JSON.stringify(btns) + ' · 기대 ' + JSON.stringify(want) +
      ' · 눌린 것 ' + JSON.stringify(pressed) + '(기본 ' + C.PLAYERS_DEFAULT + ')' };
});

/* ── ⑪ 관측 창구에 판을 바꾸는 뒷문이 없는가 ──────────────────────────── */
check('observation-window-is-read-only', () => {
  const keys = Object.keys(bmb).sort();
  const w = makeWorld();
  w.els.btnStart.fire('click');
  const before = w.win.__bmb.snapshot();
  /* 창구가 주는 스냅샷을 고쳐도 제품 상태가 따라 바뀌면 안 된다(사본이어야 한다) */
  before.fuseMs = 1; before.phase = 'over';
  const after = w.win.__bmb.snapshot();
  const setters = keys.filter(k => /^set|^force|^inject|^seed$/i.test(k));
  return { ok: setters.length === 0 && after.fuseMs !== 1 && after.phase === 'running',
    detail: '창구 키 ' + JSON.stringify(keys) + ' · 판을 바꾸는 이름 ' + setters.length +
      ' · 스냅샷 수정 뒤 제품 phase ' + after.phase };
});

/* ------------------------------------------------------------ 판정 */
const fails = results.filter(r => !r.ok);
console.log('');
for (const r of results) {
  console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name.padEnd(34) + (r.detail || ''));
}
console.log('');
console.log('==== verify_bomb: 잰 것 ' + results.length + ' · PASS ' + (results.length - fails.length) +
            ' · FAIL ' + fails.length + ' ====');

if (MUTATION) {
  const target = MUTATIONS[MUTATION].target;
  if (MUTATIONS[MUTATION].expect === 'quiet') {
    /* ★조용해야 하는 대조군 — 행동을 바꾸지 않는 사본이다. 여기서 붉어지면 그 검사는
       계약이 아니라 ★철자를 보고 있다는 뜻이다(거짓 실패). 붉은 자리만 붉어야 한다. */
    if (fails.length) {
      console.error('★조용해야 할 대조군인데 붉어진 검사가 있다: ' + fails.map(r => r.name).join(', '));
      process.exit(3);
    }
    console.log('※ 대조군 ' + MUTATION + ' — 아무 검사도 붉어지지 않았다(기대대로)');
    process.exit(0);
  }
  if (!ran.has(target)) {
    console.error('★지목한 검사가 아예 돌지 않았다(앵커 노후화): ' + target);
    process.exit(2);
  }
  const caught = results.find(r => r.name === target && !r.ok);
  const collateral = fails.filter(r => r.name !== target).map(r => r.name);
  console.log('※ 지목한 검사 ' + target + ' 가 ' + (caught ? '잡았다' : '★못 잡았다'));
  if (collateral.length) console.log('※ 함께 붉어진 검사(참고): ' + collateral.join(', '));
  process.exit(caught ? 0 : 3);
}
process.exit(fails.length ? 1 : 0);
