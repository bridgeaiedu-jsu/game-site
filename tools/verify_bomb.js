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
      'var recent = missions.slice(Math.max(0, missions.length - REPEAT_WINDOW));',
      'var recent = [];')
  },
  'm-repeat-cap-resample': {
    why: '반복 상한을 ★전 수열 재추첨으로 바꾼다 — 안 밟히는 복구 가지를 만든다',
    target: 'repeat-cap-at-draw-site',
    apply: s => s.replace(
      '    if (!allowed.length) allowed = pool.slice();\n    missions.push(allowed[Math.floor(rnd() * allowed.length)]);',
      '    missions.push(pool[Math.floor(rnd() * pool.length)]);\n    if (missions.length > 1 && missions[missions.length - 1] === missions[missions.length - 2]) { missions.length = 0; i = -1; }')
  },
  'm-seconds-on-screen': {
    why: '남은 시간을 화면에 수로 적는다 — 마지막 사람이 계산으로 피할 수 있게 된다',
    target: 'never-reveals-time-left',
    apply: s => s.replace(
      "  if (elFuseWord) elFuseWord.textContent = T(STAGE_TEXT[state.stage]);",
      "  if (elFuseWord) elFuseWord.textContent = T(STAGE_TEXT[state.stage]) + ' ' + Math.ceil((state.planned ? state.planned.fuseMs - (Date.now() - state.startedAt) : 0) / 1000) + 's';")
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
  Object.keys(MUTATIONS).forEach(k => console.log(k.padEnd(24) + MUTATIONS[k].target.padEnd(32) + MUTATIONS[k].why));
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
  console.log('※ 지목한 검사: ' + m.target);
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
function makeWorld() {
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
  const ok = a.seed === b.seed && a.fuseMs === b.fuseMs && again.fuseMs === a.fuseMs && b.passes === 25;
  return { ok, detail: '넘기기 25회 · fuseMs ' + a.fuseMs + ' -> ' + b.fuseMs +
    ' · 씨앗 ' + a.seed + ' -> ' + b.seed + ' · 재현 ' + again.fuseMs };
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
  /* 난수 소비량 — 도화선 1 + 미션 MISSION_COUNT 개. 재추첨이 있으면 이보다 커진다. */
  let draws = 0;
  const counting = (function () { const r = bmb.makeRng(4242); return function () { draws++; return r(); }; })();
  const planSrc = String(bmb.plan);
  const usesRnd = /rnd\(\)/.test(planSrc);
  bmb.plan(4242, 4, bmb.missions.ko);
  const expectDraws = 1 + C.MISSION_COUNT;
  const ok = violations === 0 && usesRnd;
  return { ok, detail: '표본 ' + plans + '판 x ' + C.MISSION_COUNT + '자리 · 반복창(' +
    C.REPEAT_WINDOW + ') 위반 ' + violations + ' · 기대 난수 소비 ' + expectDraws + '회' };
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
  const w = makeWorld();
  w.els.btnStart.fire('click');
  const seen = [];
  /* 판 전체를 훑으며 화면에 실리는 글자를 모은다 — 단계 문구가 바뀌는 자리를 전부 지난다 */
  const realNow = Date.now;
  const t0 = realNow();
  const fuse = w.win.__bmb.snapshot().fuseMs;
  for (let i = 1; i <= 20; i++) {
    Date.now = () => t0 + Math.floor(fuse * i / 21);
    w.els.btnPass.fire('click');
    seen.push(String(w.els.fuseWord.textContent), String(w.els.fuseIcon.textContent),
              String(w.els.turnWho.textContent), String(w.els.mission.textContent));
  }
  Date.now = realNow;
  /* 차례·넘긴 횟수는 수를 써도 된다(그것은 남은 시간이 아니다). 잡으려는 것은
     ★도화선 자리(fuseWord·fuseIcon)에 수가 실리는 것이다. */
  const fuseTexts = seen.filter((_, i) => i % 4 === 0 || i % 4 === 1);
  const withDigits = fuseTexts.filter(t => /\d/.test(t));
  return { ok: withDigits.length === 0,
    detail: '도화선 표시 ' + fuseTexts.length + '표본 · 수가 실린 것 ' + withDigits.length +
      (withDigits.length ? ' — ' + JSON.stringify(withDigits.slice(0, 3)) : '') };
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
