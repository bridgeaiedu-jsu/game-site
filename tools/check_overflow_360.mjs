/* check_overflow_360.mjs — ★360px 에서 어떤 요소도 자기 컨테이너를 가로로 넘지 않는다.
 *
 * ■ 왜 만들었나 (2026-09-08 · R4 F5)
 *   결과 카드의 광고 자리 `.ad-slot.ad-rect` 가 고정 `width:300px` 인데 그것을 담는 `.card` 의
 *   clientWidth 는 360px 화면에서 **296px** 였다. `.card` 는 `overflow-y:auto` 라 가로도 auto 가 되어
 *   ★카드 안에 가로 스크롤이 생기고 광고칸 우변이 잘렸다. ★그 계약을 재는 검사가 하나도 없었다.
 *   선언 훑기(`max-width` 가 있는가)는 대리물이다. 계약은 ★렌더된 치수이므로 실브라우저로 잰다.
 *
 * ■ R5(2026-09-08)에서 ★측정 조건이 셋 다 좁았다는 것이 드러났다 — 그래서 넓혔다
 *   F10 ★자리표시자만 쟀다: `#adOver` 안에 있는 것이 `<span>` 텍스트라 알아서 접힌다.
 *        실배포에는 ★고정 300×250 프레임이 들어간다 → `--with-real-ad` 로 그 조건을 만든다.
 *   F11 ★언어가 기계 로케일로 정해졌다: 제품이 `localStorage bp.lang` 또는 `navigator.language`
 *        로 언어를 정하는데 게이트는 새 프로파일로 열어 ★한 언어만 쟀다 → `--lang` 으로 못박고
 *        기본값은 ★두 언어 다 잰다. 사정거리 줄에 언어를 적는다.
 *   F12 ★한 번도 플레이 안 한 빈 화면을 쟀다: 보기 버튼은 대시, 오답 목록은 빈 채였다
 *        → `--worst-content` 로 ★최악 폭 내용을 심고 ★MutationObserver 로 유지시킨다
 *        (한 번만 심으면 페이지가 되돌린다 — 리뷰어의 h2 vs h2b 가 그 증거다).
 *
 * ■ 계약 (한 문장)
 *   폭 360px 뷰포트에서, 스크롤 상자를 가진 모든 요소는 `scrollWidth <= clientWidth + 1` 이다
 *   (문서 자신 포함). 즉 ★가로로 밀려 잘리는 자리가 없다.
 *
 * ■ 사정거리 (★출력 첫 줄에 늘 적는다 — 이 게이트가 무엇을 안 봤는지 숨기지 않는다)
 *   페이지 × ★언어 × ★시나리오 × 상태의 곱을 전부 적는다. 기본은
 *   `quick-math/index.html` × {ko,en} × {기본, 실광고, 최악내용} × {시작, 진행중, 결과}.
 *
 * ■ 사용법
 *   node tools/check_overflow_360.mjs .
 *   node tools/check_overflow_360.mjs . --lang ko            (한 언어만)
 *   node tools/check_overflow_360.mjs . --scenarios base,real-ad
 *   node tools/check_overflow_360.mjs . --pages quick-math/index.html --width 360
 *   node tools/check_overflow_360.mjs . --selftest           ★검출력(고의 넘침을 잡는가)
 *
 * ■ 종료코드: 0 = 넘침 0 · 1 = 넘침 있음 · 2 = ★판정 불가(크롬 없음·페이지 안 뜸·상태 미도달·
 *   언어가 요청과 다름·잘못된 호출). ★rc=2 는 통과가 아니다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const VALUE_FLAGS = ['--width', '--pages', '--lang', '--scenarios', '--observe-widths'];
const flagVal = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.includes(argv[i - 1])));
const KNOWN = VALUE_FLAGS.concat(['--selftest']);
const unknown = argv.filter(a => a.startsWith('--') && !KNOWN.includes(a));
const LANGS = flagVal('--lang', 'ko,en').split(',').map(s => s.trim()).filter(Boolean);
const SCENARIOS = flagVal('--scenarios', 'base,real-ad,worst-content').split(',').map(s => s.trim()).filter(Boolean);
const OK_LANGS = ['ko', 'en'];
const OK_SCEN = ['base', 'real-ad', 'worst-content'];
if (unknown.length || positional.length !== 1 ||
    LANGS.some(l => !OK_LANGS.includes(l)) || SCENARIOS.some(s => !OK_SCEN.includes(s))) {
  console.log('★판정 불가 — 잘못된 호출: ' + JSON.stringify(argv));
  console.log('사용법: node tools/check_overflow_360.mjs <저장소 루트> [--width 360] [--pages a,b]'
              + ' [--lang ko,en] [--scenarios base,real-ad,worst-content] [--selftest]');
  process.exit(2);
}
const ROOT = path.resolve(positional[0]);
const WIDTH = Number(flagVal('--width', '360'));
const PAGES = flagVal('--pages', 'quick-math/index.html').split(',').map(s => s.trim()).filter(Boolean);
const SELFTEST = argv.includes('--selftest');
/* ★계약 폭은 360px(모바일) 하나다 — 그 폭만 ★판정한다.
   더 좁은 폭은 ★관측으로만 적는다: 계약을 넓히는 것은 오너 결정이지 이 도구의 재량이 아니다.
   대신 ★여유(px)를 늘 찍어서 '얼마나 아슬아슬한가' 가 보이게 한다(2026-09-08 R6 B4). */
const OBSERVE = flagVal('--observe-widths', '320,344,352').split(',')
                  .map(s => Number(s.trim())).filter(n => n > 0 && n !== WIDTH);
const STATES = ['start', 'playing', 'over'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((res, rej) => {
  http.get(url, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); })
      .on('error', rej);
});

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  return null;
}

/* ★문서가 뜨기 ★전에 심는 스크립트 — 언어를 못박고, 시나리오 내용을 ★유지시킨다.
   유지가 핵심이다: 한 번만 심으면 제품이 다시 그리며 되돌려서, 잰 것은 다시 빈 화면이 된다. */
const bootScript = (lang, scenario) => `(() => {
  try { localStorage.setItem('bp.lang', ${JSON.stringify(lang)}); } catch (e) {}
  const scenario = ${JSON.stringify(scenario)};
  /* ★최악내용은 이제 ★심지 않는다 — 제품이 직접 그리게 한다(2026-09-08 R6 B2·B3).
     앞서는 평문 <li> 를 심었는데 제품의 실제 행은 마커 span + rq/ra 라 ★더 넓었고,
     가장 넓은 문제식은 #qtext 에 안 심어 ★한 번도 렌더되지 않았다.
     ⇒ Node 쪽에서 ★진짜로 플레이한다(가장 넓은 문제까지 정답 · 오답으로 시간을 태워 종료). */
  const apply = () => {
    if (scenario === 'real-ad') {
      /* ★실배포 조건 — 자리표시자 텍스트가 아니라 ★고정 300×250 프레임이 들어간다 */
      const slot = document.getElementById('adOver');
      if (slot && !slot.querySelector('iframe.__probe_ad')) {
        slot.textContent = '';
        const f = document.createElement('iframe');
        f.className = '__probe_ad';
        f.setAttribute('width', '300');
        f.setAttribute('height', '250');
        f.style.cssText = 'width:300px;height:250px;border:0';
        slot.appendChild(f);
      }
    }
  };
  if (scenario === 'real-ad') {
    const start = () => {
      apply();
      /* ★유지 — 제품이 다시 그릴 때마다 되돌려 놓는다(리뷰어 h2 vs h2b 가 가른 자리) */
      const mo = new MutationObserver(() => apply());
      mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      window.__probe_persist = mo;
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})()`;

const PROBE = state => `(() => {
  const d = document;
  const show = id => { const el = d.getElementById(id); if (el) el.classList.add('show'); };
  const hide = id => { const el = d.getElementById(id); if (el) el.classList.remove('show'); };
  const state = ${JSON.stringify(state)};
  if (state === 'start'){ show('start'); hide('over'); }
  if (state === 'playing'){ hide('start'); hide('over'); }
  if (state === 'over'){ hide('start'); show('over'); }
  void d.body.offsetHeight;                       /* 레이아웃 확정 */
  const sel = el => {
    if (el === d.documentElement) return 'html';
    const id = el.id ? '#' + el.id : '';
    const cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 3).map(c => '.' + c).join('');
    return el.tagName.toLowerCase() + id + cls;
  };
  const over = [];
  const skipped = [];
  let tight = null;
  let measured = 0;
  const all = [d.documentElement, ...d.querySelectorAll('*')];
  for (const el of all){
    const cw = el.clientWidth, sw = el.scrollWidth;
    if (!cw) continue;                            /* 스크롤 상자가 없다(인라인·숨김) — 잴 것이 없다 */
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue; /* 화면에 안 그려진 자리는 표본이 아니다 */
    /* ★낭독 전용(sr-only)은 ★설계상 1px 상자에 긴 글을 담는다 — 눈에 보이는 넘침이 아니다.
       ★배제는 좁게, 그리고 ★세어서 찍는다. 그 밖의 어떤 넘침도 안 뺀다 —
       배제를 넓히면 오탐 대신 ★미탐이 그 자리에 들어온다. */
    const cs = getComputedStyle(el);
    const srOnly = /inset\\(50%\\)/.test(cs.clipPath || '') ||
                   /rect\\(0px,?\\s*0px,?\\s*0px,?\\s*0px\\)/.test(cs.clip || '') ||
                   (cw <= 1 && el.clientHeight <= 1 && cs.overflow === 'hidden');
    if (srOnly){ skipped.push(sel(el)); continue; }
    measured++;
    /* ★여유 = clientWidth - scrollWidth. 가장 작은 자리를 기억한다(음수면 그것이 넘침이다) */
    if (tight === null || (cw - sw) < tight.slack) tight = { sel: sel(el), slack: cw - sw, clientW: cw };
    if (sw > cw + 1){
      over.push({ sel: sel(el), clientW: cw, scrollW: sw, spill: sw - cw, cssWidth: cs.width });
    }
  }
  return JSON.stringify({ state: state, measured: measured, over: over, skipped: skipped,
                          tight: tight,
                          vw: d.documentElement.clientWidth,
                          lang: d.documentElement.lang,
                          adKid: !!d.querySelector('#adOver iframe.__probe_ad'),
                          optLen: (d.querySelector('#opts .t') || {}).textContent || '',
                          qtext: (d.getElementById('qtext') || {}).textContent || '',
                          reviewRows: d.querySelectorAll('#review li').length,
                          started: !!(window.__quickmath && window.__quickmath.running) });
})()`;

async function measure(htmlAbs, states, opts) {
  const { lang, scenario } = opts;
  const width = opts.width || WIDTH;
  const chrome = findChrome();
  if (!chrome) return { fatal: '크롬 계열 브라우저를 찾지 못했다(CHROME_PATH 로 지정할 수 있다)' };
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ovf360-'));
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    `--window-size=${width},740`, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--allow-file-access-from-files', pathToFileURL(htmlAbs).href
  ], { stdio: 'ignore' });
  const kill = () => {
    try { child.kill('SIGKILL'); } catch (_) {}
    if (process.platform === 'win32' && child.pid) {
      try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {}
    }
  };
  process.on('exit', kill);
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    let port = null;
    for (let t = 0; t < 100 && port === null; t++) {
      await sleep(100);
      try { const l = fs.readFileSync(portFile, 'utf8').split('\n'); if (l[0]) port = Number(l[0].trim()); } catch (_) {}
    }
    if (!port) return { fatal: '크롬 디버깅 포트를 얻지 못했다(기동 실패)' };
    let target = null;
    for (let t = 0; t < 60 && !target; t++) {
      await sleep(100);
      try { target = (await getJson(`http://127.0.0.1:${port}/json/list`)).find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (_) {}
    }
    if (!target) return { fatal: '크롬 페이지 대상을 찾지 못했다' };
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); setTimeout(() => rej(new Error('ws timeout')), 10000); });
    let id = 0;
    const pending = new Map();
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (_) { return; } if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params) => new Promise((res, rej) => {
      const myId = ++id; pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
      setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); rej(new Error(method + ' 응답 없음')); } }, 30000);
    });
    const evaluate = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error('페이지 예외: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    await send('Page.enable', {});
    await send('Emulation.setDeviceMetricsOverride',
               { width: width, height: 740, deviceScaleFactor: 2, mobile: true });
    /* ★언어·시나리오는 ★문서가 뜨기 전에 심고 ★다시 읽는다 — 로드된 뒤에 넣으면
       제품이 이미 언어를 정한 뒤라 그 기계의 로케일이 그대로 이긴다(R5 F11). */
    await send('Page.addScriptToEvaluateOnNewDocument', { source: bootScript(lang, scenario) });
    await send('Page.reload', { ignoreCache: true });
    let ready = false;
    for (let t = 0; t < 120 && !ready; t++) {
      await sleep(100);
      try { ready = await evaluate('document.readyState === "complete"'); } catch (_) {}
    }
    if (!ready) return { fatal: '페이지가 뜨지 않았다: ' + htmlAbs };
    /* ★제품 버튼을 ★진짜 사건으로 누른다 — 상태를 밖에서 밀어 넣지 않는다.
       가장 넓은 문제식까지 정답으로 진행하고(B3), 결과 화면은 ★오답으로 시간을 태워 만든다(B2).
       (오답 하나가 3초를 깎으므로 10회면 30초 판이 끝난다 — 실시간을 기다리지 않는다.) */
    const PLAY_TO_WIDEST = `(() => {
      const k = window.__quickmath;
      if (!k || !k.deck || !k.deck.length) return JSON.stringify({ ok: false, why: '덱이 없다' });
      let want = 0, best = -1;
      k.deck.forEach((q, i) => { const t = (q.a + ' ' + q.op + ' ' + q.b).length; if (t > best) { best = t; want = i; } });
      const opts = () => [...document.querySelectorAll('#opts .opt')];
      let guard = 0;
      while (k.idx < want && k.running && guard++ < 200) {
        const q = k.deck[k.idx];
        opts()[q.correct].click();
      }
      return JSON.stringify({ ok: k.idx === want, idx: k.idx, want: want,
                              qtext: (document.getElementById('qtext') || {}).textContent || '' });
    })()`;
    const PLAY_TO_END = `(() => {
      const k = window.__quickmath;
      /* ★'over' 만 재는 호출(자기시험)에서는 판이 아직 안 섰다 — 여기서 시작한다 */
      if (k && !k.running && !document.querySelectorAll('#review li').length) {
        const b = document.getElementById('btnDaily');
        if (b) b.click();
      }
      const opts = () => [...document.querySelectorAll('#opts .opt')];
      let guard = 0;
      while (k.running && guard++ < 400) {
        const q = k.deck[k.idx];
        const wrong = [0,1,2,3].filter(i => i !== q.correct && !opts()[i].disabled)[0];
        if (wrong === undefined) { opts()[q.correct].click(); continue; }
        opts()[wrong].click();
      }
      return JSON.stringify({ running: k.running,
                              reviewRows: document.querySelectorAll('#review li').length });
    })()`;
    const out = [];
    for (const st of states) {
      if (st === 'playing') {
        try { await evaluate("(document.getElementById('btnDaily')||{click(){}}).click(), 1"); } catch (_) {}
        await sleep(200);
        if (scenario === 'worst-content') {
          const r = JSON.parse(await evaluate(PLAY_TO_WIDEST) || '{}');
          if (!r.ok) return { fatal: '가장 넓은 문제까지 진행하지 못했다(' + (r.why || ('idx ' + r.idx + '/' + r.want)) + ')' };
          out.__widest = r.qtext;
        }
      }
      if (st === 'over' && scenario === 'worst-content') {
        const r = JSON.parse(await evaluate(PLAY_TO_END) || '{}');
        if (r.running || !r.reviewRows) {
          return { fatal: '판을 끝내 결과 화면을 만들지 못했다(running=' + r.running + ' · 오답행 ' + r.reviewRows + ')' };
        }
        out.__reviewRows = r.reviewRows;
      }
      const raw = await evaluate(PROBE(st));
      if (!raw) return { fatal: '상태 ' + st + ' 의 측정 결과를 받지 못했다' };
      out.push(JSON.parse(raw));
    }
    try { ws.close(); } catch (_) {}
    return { states: out };
  } catch (e) {
    return { fatal: String(e && e.message ? e.message : e) };
  } finally {
    kill();
    try { process.removeListener('exit', kill); } catch (_) {}
    for (let t = 0; t < 5; t++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch (_) { await sleep(200); }
    }
  }
}

const SCEN_LABEL = { 'base': '기본(자리표시자)', 'real-ad': '★실광고(고정 300×250 프레임)',
                     'worst-content': '★실제 플레이(가장 넓은 문제식까지 진행 · 오답으로 판을 끝내 실제 오답목록)' };

async function checkPages(root, pages) {
  console.log(`★사정거리: 페이지 ${pages.length}장 × ★언어 ${LANGS.length}(${LANGS.join(',')})`
              + ` × ★시나리오 ${SCENARIOS.length}(${SCENARIOS.join(',')}) × 상태 ${STATES.length}(${STATES.join(',')})`
              + ` · 폭 ${WIDTH}px — 이 게이트가 본 것은 여기까지다`);
  let violations = 0, measuredTotal = 0, samples = 0;
  for (const rel of pages) {
    const abs = path.join(root, rel.split('/').join(path.sep));
    if (!fs.existsSync(abs)) { console.log('★판정 불가 — 대상이 없다: ' + rel); return 2; }
    for (const lang of LANGS) {
      for (const scen of SCENARIOS) {
        const r = await measure(abs, STATES, { lang, scenario: scen });
        if (r.fatal) { console.log('★판정 불가 — ' + r.fatal); return 2; }
        for (const s of r.states) {
          if (s.vw !== WIDTH) { console.log(`★판정 불가 — 뷰포트 폭이 ${s.vw}px 다(${WIDTH} 여야 한다)`); return 2; }
          if (s.lang !== lang) { console.log(`★판정 불가 — 요청 언어 ${lang} 인데 문서 언어가 ${s.lang} 다(언어 고정 실패)`); return 2; }
          if (!s.measured) { console.log(`★판정 불가 — ${rel} [${lang}/${scen}/${s.state}] 에서 잰 요소가 0개다(표본 미성립)`); return 2; }
          if (s.state === 'playing' && !s.started) { console.log(`★판정 불가 — ${rel} [${lang}/${scen}/playing] 에서 판이 시작되지 않았다(표본 미성립)`); return 2; }
          if (scen === 'real-ad' && s.state === 'over' && !s.adKid) { console.log(`★판정 불가 — 실광고 프레임이 심기지 않았다(표본 미성립)`); return 2; }
          if (scen === 'worst-content' && s.state === 'playing' && !s.qtext) {
            console.log('★판정 불가 — 문제식이 비어 있다(표본 미성립)'); return 2;
          }
          if (scen === 'worst-content' && s.state === 'over' && !s.reviewRows) {
            console.log('★판정 불가 — 결과 화면에 제품이 그린 오답 행이 없다(표본 미성립)'); return 2;
          }
          measuredTotal += s.measured; samples++;
          const mark = s.over.length ? '★넘침' : 'OK  ';
          console.log(`  ${mark} ${rel} [${lang} · ${SCEN_LABEL[scen]} · ${s.state}] · 잰 요소 ${s.measured} · 넘침 ${s.over.length}`
                      + ` · 낭독전용 제외 ${s.skipped.length}`
                      + (scen === 'worst-content' && s.state === 'playing' ? ` · ★제품이 그린 최대 폭 문제식 "${s.qtext}"` : '')
                      + (scen === 'worst-content' && s.state === 'over' ? ` · ★제품이 그린 오답 행 ${s.reviewRows}개` : '')
                      + (s.tight ? ` · ★최소 여유 ${s.tight.slack}px (${s.tight.sel})` : '')
                      + (scen === 'real-ad' && s.state === 'over' ? ' · 실광고 프레임 심김' : ''));
          for (const o of s.over) {
            violations++;
            console.log(`      ${o.sel} — clientWidth ${o.clientW} < scrollWidth ${o.scrollW} (밀림 ${o.spill}px · css width ${o.cssWidth})`);
          }
        }
      }
    }
  }
  console.log('');
  console.log(`잰 표본 ${samples}종 · 잰 요소 합계 ${measuredTotal} · ★넘침 ${violations}건  [계약 폭 ${WIDTH}px — 여기까지가 판정이다]`);
  if (!violations) console.log('  ★넘침 없음(이 줄이 부재의 증거다 — 분모는 위의 잰 요소 수다)');

  /* ★관측 폭 — 계약 밖이라 ★판정에 넣지 않는다. 다만 '얼마나 아슬아슬한가' 를 숨기지 않는다. */
  if (OBSERVE.length) {
    console.log('');
    console.log(`★관측(판정 아님) — 계약 밖 폭 ${OBSERVE.join(',')}px · 계약 확대는 ★오너 결정이다`);
    for (const w of OBSERVE) {
      for (const rel of pages) {
        const abs = path.join(root, rel.split('/').join(path.sep));
        const r = await measure(abs, ['over'], { lang: LANGS[0], scenario: 'real-ad', width: w });
        if (r.fatal) { console.log(`  ${w}px — 관측 실패: ${r.fatal}`); continue; }
        const s = r.states[0];
        const tight = s.tight ? `최소 여유 ${s.tight.slack}px (${s.tight.sel})` : '여유 미상';
        console.log(`  ${w}px · ${rel} [${LANGS[0]} · 실광고 · over] — 넘침 ${s.over.length}건 · ${tight}`);
        for (const o of s.over) {
          console.log(`      ${o.sel} — clientWidth ${o.clientW} < scrollWidth ${o.scrollW} (밀림 ${o.spill}px)`);
        }
      }
    }
  }
  return violations ? 1 : 0;
}

/* ─────────────────────────────────────────────────────── 검출력 자기시험 */
async function selftest(root) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ovf360-selftest-'));
  try {
    const rel = PAGES[0];
    const src = fs.readFileSync(path.join(root, rel.split('/').join(path.sep)), 'utf8');
    const dir = path.join(stage, path.dirname(rel));
    fs.mkdirSync(dir, { recursive: true });
    const quiet = path.join(stage, rel);
    fs.writeFileSync(quiet, src);
    const ANCHOR = '<div class="ad-slot ad-rect" id="adOver">';
    if (src.split(ANCHOR).length - 1 !== 1) { console.log('★판정 불가 — 자기시험 앵커가 유일하지 않다'); return 2; }
    const broken = path.join(stage, 'broken_' + path.basename(rel));
    fs.writeFileSync(broken, src.replace(ANCHOR, '<div style="width:400px;height:8px"></div>' + ANCHOR));
    const cases = [
      ['대조군(무변이 · 기본 시나리오)', quiet, 'base', 0],
      ['카드보다 넓은 고정폭 블록 주입', broken, 'base', 1],
      /* ★시나리오 자신이 살아 있는가 — 심는 것이 실제로 심겼는지 표본 성립으로 확인된다 */
      ['대조군(무변이 · ★실광고 시나리오)', quiet, 'real-ad', 0],
      ['대조군(무변이 · ★최악내용 시나리오)', quiet, 'worst-content', 0]
    ];
    let bad = 0;
    console.log(`검출력 자기시험 — 사례 ${cases.length}건(대조군 3 포함 · 임시 사본에만 심는다)`);
    for (const [name, file, scen, want] of cases) {
      const r = await measure(file, ['over'], { lang: LANGS[0], scenario: scen });
      let rc = 2;
      if (!r.fatal) rc = r.states[0].over.length ? 1 : 0;
      const ok = rc === want;
      if (!ok) bad++;
      console.log(`  [${ok ? 'OK ' : '★어긋남'}] ${name} — rc=${rc} · 기대 ${want}${r.fatal ? ' · ' + r.fatal : ''}`);
    }
    console.log('');
    console.log(`==== 자기시험 사례 ${cases.length}건 · 어긋남 ${bad}건 ====`);
    return bad ? 1 : 0;
  } finally {
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch (_) {}
  }
}

const rc = SELFTEST ? await selftest(ROOT) : await checkPages(ROOT, PAGES);
process.exit(rc);
