/* 남도 특산물 받기(/namdo/) 검증기 — 2026-11-24 · 오너 직접 지시로 38종째
 *
 * ★이 검사는 제품보다 ★먼저 쓰였다. 제품이 없으면 rc=2(판정 불가)다 — 통과로 세지 않는다.
 *   탐지력은 `--selftest` 로 따로 증명한다(고의 결함을 심은 사본마다 rc=1 이 나와야 한다).
 *
 * 원본은 오너가 건넨 전체화면 단일 파일 게임이다. 사이트 페이지로 옮기며 ★그림·소리·규칙·밸런스는
 * 그대로 두고, 페이지로서 깨지는 자리만 고쳤다. 이 검증기가 지키는 것은 그 두 줄이다.
 *
 * 중점 검사
 *   ★① 밸런스 보존 — 특산물 다섯 가지의 비중·점수, 하트 3, 10개마다 선물(50점·10초), 무적 1.5초,
 *       방해물 확률·생성 간격·낙하 시간 식이 원본 값 그대로다(제품의 순수 함수를 직접 부른다)
 *   ★② 페이지를 망가뜨리지 않는다 — html/body 전역 overflow:hidden·touch-action:none 금지,
 *       무대의 touch-action:none 은 ★판 진행 중에만, 화살표·스페이스 가로채기는 ★판 진행 중에만,
 *       시작 키는 ★무대가 화면에 보일 때만
 *   ★③ 무대가 화면 밖으로 밀려나면 판이 멈춘다(스크롤해 글을 읽는 동안 하트를 잃지 않게)
 *   ★④ 저장 키는 사이트 규약(namdo.best · namdo.sound · bp.lang)뿐이다 — 원본의 namdoBest 금지
 *   ★⑤ 설명 글의 숫자가 ★코드에서 나온다 — 확률·기대 점수·하한 도달 시각·점프 높이는 이 하네스가
 *       제품 상수로 다시 셈하고, 몬테카를로 숫자(data-sim)는 고정 씨앗으로 다시 돌려 ±4% 안인지 본다
 *   ★⑥ ko/en 문안 키가 같다 · 글꼴(OFL) 저작자 표기가 있다
 *
 * ★이 하네스가 못 보는 것(정직 고지)
 *   · 레이아웃·픽셀을 계산하지 않는다 — 360px 넘침과 실제 손맛은 실브라우저 몫이다.
 *   · 소리를 재지 않는다(AudioContext 가 없으면 제품이 조용히 넘어가는 것만 본다).
 *
 * 사용법: node tools/verify_namdo.js [--html <경로>] [--selftest] [--list-mutations]
 * 종료코드: 0 = 전부 PASS · 1 = 하나라도 FAIL · 2 = 판정 불가(대상을 못 읽음·주입 실패 — 탐지 아님)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ARGV = process.argv.slice(2);
const has = f => ARGV.includes(f);
const valOf = (f, d) => { const i = ARGV.indexOf(f); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const ROOT = path.resolve(__dirname, '..');
const HTML = path.resolve(valOf('--html', path.join(ROOT, 'namdo', 'index.html')));

/* 원본(오너 파일)의 값 — ★여기 적은 것은 기대값이다. 제품이 이 값을 바꾸면 밸런스가 바뀐 것이다. */
const ORIGINAL = {
  items: [['pear', 10, 24], ['gulbi', 30, 12], ['tea', 15, 20], ['goguma', 10, 24], ['abalone', 25, 14]],
  bads: ['stone', 'bug'],
  hearts: 3, giftEvery: 10, giftSeconds: 10, giftBonus: 50, invSeconds: 1.5,
  bad: [[0, 0.18], [25, 0.28], [50, 0.38], [120, 0.38]],
  spawn: [[0, 1.05], [30, 0.72], [100, 0.36]],
  fall: [[0, 3.2], [50, 2.0], [100, 1.45]],
  jumpV: 150, gravity: 430, walk: 105, magnet: 110
};

let pass = 0, fail = 0;
const lines = [];
function ok(name, cond, extra){
  if (cond) { pass++; lines.push('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; lines.push('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
  return !!cond;
}
function indet(msg){ console.log('판정 불가: ' + msg); process.exit(2); }

/* ───────────────────────── 고정 씨앗 난수 ───────────────────────── */
function mulberry32(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ───────────────────────── DOM 스텁 ───────────────────────── */
function makeEnv(seed){
  let now = 0;
  const timers = [];
  const rafQ = [];
  const store = new Map();
  const ioCbs = [];
  const winOn = {}, docOn = {};
  const els = new Map();
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  function makeEl(tag, id){
    const el = {
      tagName: String(tag || 'div').toUpperCase(), id: id || '', style: {}, dataset: {}, _cls: new Set(), _on: {},
      textContent: '', innerHTML: '', width: 0, height: 0, children: [], clientWidth: 340, clientHeight: 450,
      classList: null,
      addEventListener(t, fn){ (this._on[t] = this._on[t] || []).push(fn); },
      removeEventListener(){}, appendChild(c){ this.children.push(c); return c; }, remove(){},
      setAttribute(){}, getAttribute(){ return null; }, focus(){}, blur(){},
      setPointerCapture(){}, releasePointerCapture(){},
      getBoundingClientRect(){ return { left: 0, top: 0, width: 340, height: 450, right: 340, bottom: 450 }; },
      getContext(){ return ctx2d; }, toDataURL(){ return 'data:image/png;base64,'; },
      querySelectorAll(){ return []; }, querySelector(){ return null; },
      click(){ fire(this, 'click', {}); }
    };
    el.classList = { add: c => el._cls.add(c), remove: c => el._cls.delete(c), contains: c => el._cls.has(c),
      toggle: (c, on) => { const v = on === undefined ? !el._cls.has(c) : !!on; v ? el._cls.add(c) : el._cls.delete(c); return v; } };
    return el;
  }
  function byId(id){ if (!els.has(id)) els.set(id, makeEl('div', id)); return els.get(id); }
  function fire(target, type, ev){
    const e = Object.assign({ type, target, currentTarget: target, defaultPrevented: false,
      preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){}, pointerId: 1, clientX: 10, clientY: 10 }, ev);
    for (const fn of (target._on[type] || [])) fn(e);
    return e;
  }
  const body = makeEl('body', 'body');
  const document = {
    hidden: false, title: '', readyState: 'complete', body,
    documentElement: makeEl('html', 'html'),
    getElementById: byId,
    querySelector: s => (s && s[0] === '#') ? byId(s.slice(1)) : makeEl('div'),
    querySelectorAll: () => [],
    createElement: t => makeEl(t),
    addEventListener: (t, fn) => { (docOn[t] = docOn[t] || []).push(fn); },
    removeEventListener(){}
  };
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); }
  };
  const rnd = mulberry32(seed);
  const MathX = Object.create(Math); MathX.random = rnd;
  const win = {
    document, localStorage, Math: MathX, console, JSON, Date, Object, Array, Number, String, Set, Map, Promise, Symbol, Proxy,
    navigator: { language: 'ko-KR' },
    innerWidth: 360, innerHeight: 640, devicePixelRatio: 1,
    performance: { now: () => now },
    requestAnimationFrame: fn => { rafQ.push(fn); return rafQ.length; },
    cancelAnimationFrame(){},
    setTimeout: (fn, ms) => { timers.push({ at: now + (ms || 0), fn }); return timers.length; },
    clearTimeout(){}, setInterval: () => 0, clearInterval(){},
    matchMedia: q => ({ matches: false, media: q, addEventListener(){}, addListener(){} }),
    addEventListener: (t, fn) => { (winOn[t] = winOn[t] || []).push(fn); },
    removeEventListener(){},
    ResizeObserver: function(){ return { observe(){}, disconnect(){} }; },
    IntersectionObserver: function(cb){ ioCbs.push(cb); return { observe(){}, disconnect(){} }; },
    gtag(){}, dataLayer: []
  };
  win.window = win; win.self = win; win.globalThis = win;
  const api = {
    win, document, store, byId,
    key(type, key){
      const e = { type, key, target: body, defaultPrevented: false, preventDefault(){ this.defaultPrevented = true; } };
      for (const fn of (winOn[type] || [])) fn(e);
      for (const fn of (docOn[type] || [])) fn(e);
      return e;
    },
    visible(ratio){ for (const cb of ioCbs) cb([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]); },
    frames(n, dtMs){
      for (let i = 0; i < n; i++){
        now += dtMs || (1000 / 60);
        timers.sort((a, b) => a.at - b.at);
        while (timers.length && timers[0].at <= now) timers.shift().fn();
        const q = rafQ.splice(0, rafQ.length);
        for (const fn of q) fn(now);
      }
    },
    click(id){ return fire(byId(id), 'click', {}); }
  };
  return api;
}

function scriptsOf(html){
  return [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}
function gameScript(html){
  const s = scriptsOf(html).filter(t => t.includes('__namdo'));
  return s.length === 1 ? s[0] : null;
}
function boot(html, seed){
  const env = makeEnv(seed || 12345);
  const src = gameScript(html);
  if (!src) return null;
  const ctx = vm.createContext(env.win);
  vm.runInContext(src, ctx, { timeout: 5000 });
  env.N = env.win.__namdo;
  return env;
}

/* ───────────────────────── 문안·숫자 파생 ───────────────────────── */
const r1 = x => (Math.round(x * 10) / 10).toFixed(1);
function textOf(s){ return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' '); }
/* I18N 객체의 ko/en 블록에서 키 목록을 뽑는다 — 값은 '…' 또는 함수 */
function i18nKeys(src, lang){
  const a = src.indexOf('\n  ' + lang + ': {');
  if (a < 0) return null;
  const b = src.indexOf('\n  }', a);
  const body = src.slice(src.indexOf('{', a) + 1, b);   /* 여는 줄(ko: {)은 빼고 본문만 */
  return [...body.matchAll(/(?:^|[\s,{])([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map(m => m[1]).filter((k, i, arr) => arr.indexOf(k) === i).sort();
}
/* 몬테카를로 — 완벽한 플레이(좋은 것은 전부 받고 나쁜 것은 전부 피함)가 T초 동안 얻는 것.
   ★생성 규칙은 제품의 순수 함수(spawnBase·badChance)와 상수(ITEMS 비중·점수)를 그대로 쓴다. */
function simulate(N, T, runs, seed){
  const rnd = mulberry32(seed);
  const C = N.const();
  const W = C.ITEMS.reduce((s, d) => s + d.w, 0);
  let goods = 0, bads = 0, score = 0;
  const dt = 1 / 60;
  for (let r = 0; r < runs; r++){
    let t = 0, spawnT = 0.6, caught = 0, sc = 0;
    while (t < T){
      t += dt; spawnT -= dt;
      if (spawnT <= 0){
        spawnT = N.spawnBase(t) * (0.75 + rnd() * 0.5);
        if (rnd() < N.badChance(t)) { bads++; rnd(); }
        else {
          let x = rnd() * W, d = C.ITEMS[0];
          for (const it of C.ITEMS){ if ((x -= it.w) < 0){ d = it; break; } }
          goods++; caught++; sc += d.pts;
          if (caught % C.GIFT_EVERY === 0) sc += C.GIFT_BONUS;
        }
      }
    }
    score += sc;
  }
  return { goods: goods / runs, bads: bads / runs, score: score / runs };
}

/* ───────────────────────── 본 검사 ───────────────────────── */
function runChecks(htmlPath){
  if (!fs.existsSync(htmlPath)) indet('제품이 없다: ' + htmlPath);
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes('__namdo')) indet('관측 창구 window.__namdo 가 없다 — 검사할 수 없다');

  console.log('== 정적 계약 ==');
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
  ok('html/body 에 전역 overflow:hidden 이 없다', !/(?:^|[},\s])(?:html\s*,\s*)?body\s*\{[^}]*overflow\s*:\s*hidden/m.test(css) && !/html\s*\{[^}]*overflow\s*:\s*hidden/.test(css));
  ok('html/body 에 touch-action:none 이 없다', !/(?:html|body)[^{]*\{[^}]*touch-action\s*:\s*none/.test(css));
  ok('무대의 touch-action:none 은 판 진행 중(.playing)에만', /#stage\.playing\s*\{[^}]*touch-action\s*:\s*none/.test(css) && !/#stage\s*\{[^}]*touch-action\s*:\s*none/.test(css));
  ok('갈무리11 글꼴 두 굵기를 내장한다(외부 요청 0)', (css.match(/@font-face\{font-family:'Galmuri11';src:url\(data:font\/woff2;base64,/g) || []).length === 2);
  ok('글꼴 저작자·OFL 표기가 페이지에 있다', /Lee Minseo|이민서/.test(html) && /Open Font License/.test(html));
  const keys = [...new Set([...html.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*'([^']+)'/g)].map(m => m[1]))].sort();
  ok('저장 키는 namdo.best · namdo.sound · bp.lang 뿐이다', JSON.stringify(keys) === JSON.stringify(['bp.lang', 'namdo.best', 'namdo.sound']), keys.join(','));
  ok('원본 저장 키 namdoBest 가 남아 있지 않다', !html.includes('namdoBest'));
  const src = gameScript(html) || '';
  const ko = i18nKeys(src, 'ko'), en = i18nKeys(src, 'en');
  ok('I18N ko/en 키가 같다', ko && en && ko.length > 20 && JSON.stringify(ko) === JSON.stringify(en),
     ko && en ? `ko ${ko.length} · en ${en.length}` + (JSON.stringify(ko) === JSON.stringify(en) ? '' : ' · 차이 ' +
       ko.filter(k => !en.includes(k)).concat(en.filter(k => !ko.includes(k))).join(',')) : '못 읽음');

  console.log('== 실행: 밸런스 보존 ==');
  let env;
  try { env = boot(html, 7); } catch (e) { ok('제품 스크립트가 스텁 위에서 돈다', false, e.message); return; }
  if (!env || !env.N) indet('제품 스크립트를 찾지 못했다');
  const N = env.N, C = N.const();
  ok('특산물 다섯 가지의 이름표·점수·비중이 원본 그대로', JSON.stringify(C.ITEMS.map(d => [d.k, d.pts, d.w])) === JSON.stringify(ORIGINAL.items),
     JSON.stringify(C.ITEMS.map(d => [d.k, d.pts, d.w])));
  ok('방해물은 돌멩이·벌레 둘', JSON.stringify(C.BADS.map(d => d.k)) === JSON.stringify(ORIGINAL.bads));
  ok('하트 3 · 10개마다 선물 · 선물 50점 · 효과 10초 · 무적 1.5초',
     C.HEARTS === ORIGINAL.hearts && C.GIFT_EVERY === ORIGINAL.giftEvery && C.GIFT_BONUS === ORIGINAL.giftBonus &&
     C.GIFT_SECONDS === ORIGINAL.giftSeconds && C.INV_SECONDS === ORIGINAL.invSeconds, JSON.stringify(C));
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok('방해물 확률 식 = min(0.38, 0.18 + 0.004t)', ORIGINAL.bad.every(([t, v]) => near(N.badChance(t), v)), ORIGINAL.bad.map(([t]) => N.badChance(t)).join(','));
  ok('생성 간격 기준 식 = max(0.36, 1.05 − 0.011t)', ORIGINAL.spawn.every(([t, v]) => near(N.spawnBase(t), v)), ORIGINAL.spawn.map(([t]) => N.spawnBase(t)).join(','));
  ok('낙하 시간 식 = max(1.45, 3.2 − 0.024t)', ORIGINAL.fall.every(([t, v]) => near(N.fallTime(t), v)), ORIGINAL.fall.map(([t]) => N.fallTime(t)).join(','));
  ok('점프·중력·걷기·자석 속도가 원본 그대로', C.JUMP_V === ORIGINAL.jumpV && C.GRAVITY === ORIGINAL.gravity && C.WALK === ORIGINAL.walk && C.MAGNET === ORIGINAL.magnet,
     [C.JUMP_V, C.GRAVITY, C.WALK, C.MAGNET].join(','));

  console.log('== 실행: 페이지 위의 게임 ==');
  ok('처음엔 대기 상태', N.state().state === 'ready');
  let e = env.key('keydown', 'ArrowLeft');
  ok('대기 중 화살표는 페이지 스크롤을 막지 않는다', !e.defaultPrevented);
  env.visible(0);
  e = env.key('keydown', ' ');
  ok('무대가 화면에 없을 때 스페이스는 판을 열지 않고 스크롤도 막지 않는다', N.state().state === 'ready' && !e.defaultPrevented);
  env.visible(1);
  e = env.key('keydown', ' ');
  ok('무대가 보일 때 스페이스로 판이 열린다', N.state().state === 'play' && e.defaultPrevented);
  ok('판 진행 중 무대에 .playing(터치 가로채기)이 붙는다', env.byId('stage').classList.contains('playing'));
  e = env.key('keydown', 'ArrowRight'); env.key('keyup', 'ArrowRight');
  ok('판 진행 중 화살표는 게임이 가져간다', e.defaultPrevented);
  env.frames(30);
  env.visible(0.1);
  ok('무대가 화면 밖으로 밀려나면 멈춘다', N.state().state === 'pause');
  ok('멈춘 동안 터치 가로채기가 풀린다', !env.byId('stage').classList.contains('playing'));
  e = env.key('keydown', 'ArrowLeft');
  ok('멈춘 동안 화살표는 페이지에 돌려준다', !e.defaultPrevented);
  env.visible(1);
  env.click('resumeBtn');
  ok('계속하기로 이어진다', N.state().state === 'play');
  /* 가만히 서 있으면 결국 방해물에 맞아 끝난다 — 끝 처리와 기록 저장을 본다 */
  let guard = 0;
  while (N.state().state === 'play' && guard < 60 * 900){ env.frames(60); guard += 60; }
  const st = N.state();
  ok('하트를 다 잃으면 판이 끝난다', st.state === 'over' && st.hearts === 0, `state=${st.state} hearts=${st.hearts} 경과 ${Math.round(st.elapsed)}초`);
  ok('끝나면 터치 가로채기가 풀린다', !env.byId('stage').classList.contains('playing'));
  const saved = env.store.get('namdo.best');
  ok('최고 기록이 namdo.best 에 저장된다(점수가 있을 때)', st.score === 0 ? saved == null : Number(saved) === st.score, `score=${st.score} saved=${saved}`);
  e = env.key('keydown', 'ArrowDown');
  ok('끝난 뒤 화살표는 페이지에 돌려준다', !e.defaultPrevented);

  console.log('== 설명 글의 숫자(코드에서 셈) ==');
  const W = C.ITEMS.reduce((s, d) => s + d.w, 0);
  const ev = C.ITEMS.reduce((s, d) => s + d.w * d.pts, 0) / W;
  const capT = (0.38 - N.badChance(0)) / ((N.badChance(10) - N.badChance(0)) / 10);
  const spawnFloorT = (N.spawnBase(0) - 0.36) / ((N.spawnBase(0) - N.spawnBase(10)) / 10);
  const fallFloorT = (N.fallTime(0) - 1.45) / ((N.fallTime(0) - N.fallTime(10)) / 10);
  const peak = C.JUMP_V * C.JUMP_V / (2 * C.GRAVITY);
  const air = 2 * C.JUMP_V / C.GRAVITY;
  const want = [
    ...C.ITEMS.map(d => r1(d.w / W * 100) + '%'),
    r1(ev), String(Math.round(capT)), r1(spawnFloorT), r1(fallFloorT), r1(peak), air.toFixed(2)
  ];
  const doc = (html.match(/<section class="doc"[\s\S]*?<\/section>/) || [''])[0];
  const koDoc = textOf(doc);
  const enBlock = src.slice(src.indexOf('\n  en: {'));
  for (const w of want){
    ok(`문서(ko)와 문안(en)에 ${w} 가 있다`, koDoc.includes(w) && enBlock.includes(w));
  }
  const sims = [...doc.matchAll(/data-sim="([a-z0-9]+)">([0-9.,]+)</g)].map(m => [m[1], Number(m[2].replace(/,/g, ''))]);
  const enSims = [...enBlock.matchAll(/data-sim="([a-z0-9]+)">([0-9.,]+)</g)].map(m => [m[1], Number(m[2].replace(/,/g, ''))]);
  ok('몬테카를로 숫자가 ko·en 양쪽에 같은 값으로 있다', sims.length >= 3 && JSON.stringify(sims) === JSON.stringify(enSims), JSON.stringify(sims) + ' / ' + JSON.stringify(enSims));
  const cache = {};
  for (const [k, v] of sims){
    const m = k.match(/^(goods|bads|score)(\d+)$/);
    if (!ok(`data-sim="${k}" 의 이름을 읽는다`, !!m)) continue;
    const T = Number(m[2]);
    const s = cache[T] || (cache[T] = simulate(N, T, 4000, 20261124));
    const got = s[m[1]];
    ok(`data-sim ${k}=${v} 가 고정 씨앗 재계산 ${got.toFixed(1)} 의 ±4% 안`, Math.abs(got - v) <= Math.max(0.04 * got, 0.6));
  }
}

/* ───────────────────────── 자기시험 ───────────────────────── */
const MUTATIONS = {
  'global-overflow': ['html,body{', 'html,body{overflow:hidden;', '전역 overflow:hidden 을 되살린다'],
  'old-key': ["'namdo.best'", "'namdoBest'", '원본 저장 키로 되돌린다'],
  'weight-drift': ["{k:'pear',pts:10,w:24", "{k:'pear',pts:10,w:30", '나주 배 비중을 바꾼다(문서 숫자와 어긋난다)'],
  'key-grab': ["if (!ownsKeys()) return;", "", '판 밖에서도 키를 가로챈다'],
  'no-offscreen-pause': ["if (state === 'play' && ratio < 0.35) pause(true);", '', '화면 밖 멈춤을 뺀다'],
  'sticky-touch': ["stage.classList.toggle('playing', s === 'play');", "stage.classList.add('playing');", '터치 가로채기를 풀지 않는다'],
  'sim-drift': ['data-sim="goods60">', 'data-sim="goods60">1', '몬테카를로 숫자를 부풀린다']
};
function selftest(){
  if (!fs.existsSync(HTML)) indet('제품이 없어 자기시험을 세울 수 없다');
  const base = fs.readFileSync(HTML, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'namdo-mut-'));
  let caught = 0, total = 0, broken = 0;
  const one = (name, text) => {
    const f = path.join(dir, name + '.html');
    fs.writeFileSync(f, text);
    return spawnSync(process.execPath, [__filename, '--html', f], { encoding: 'utf8' }).status;
  };
  const clean = one('clean', base);
  console.log(`  대조군(원본 그대로) rc=${clean}`);
  for (const [name, [from, to, why]] of Object.entries(MUTATIONS)){
    total++;
    if (!base.includes(from)) { broken++; console.log(`  ! ${name}: 주입 자리를 못 찾았다 — ${why}`); continue; }
    const rc = one(name, base.split(from).join(to));
    if (rc === 1) caught++;
    console.log(`  ${rc === 1 ? '✓' : '✗'} ${name} rc=${rc} — ${why}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`자기시험: 검출 ${caught}/${total} · 주입 실패 ${broken} · 대조군 rc=${clean}`);
  if (broken || clean !== 0) process.exit(2);
  process.exit(caught === total ? 0 : 1);
}

if (has('--list-mutations')) { for (const [k, v] of Object.entries(MUTATIONS)) console.log(k + ' — ' + v[2]); process.exit(0); }
if (has('--selftest')) selftest();
else {
  runChecks(HTML);
  console.log(lines.join('\n'));
  console.log(`\n==== verify_namdo: PASS ${pass} · FAIL ${fail} ====`);
  process.exit(fail ? 1 : 0);
}
