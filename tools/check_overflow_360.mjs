/* check_overflow_360.mjs — ★360px 에서 어떤 요소도 자기 컨테이너를 가로로 넘지 않는다.
 *
 * ■ 왜 만들었나 (2026-09-08 · R4 F5)
 *   결과 카드의 광고 자리 `.ad-slot.ad-rect` 가 고정 `width:300px` 인데 그것을 담는 `.card` 의
 *   clientWidth 는 360px 화면에서 **296px** 였다. `.card` 는 `overflow-y:auto` 라 가로도 auto 가 되어
 *   ★카드 안에 가로 스크롤이 생기고 광고칸 우변이 잘렸다(cardScrollW 336 · scrollableBy 40px).
 *   ★그 계약을 재는 검사가 하나도 없었다 — 실브라우저 축 리뷰가 눈으로 잡을 때까지 두 라운드를 살았다.
 *   선언 훑기(`max-width` 가 있는가)는 대리물이다. 계약은 ★렌더된 치수이므로 실브라우저로 잰다.
 *
 * ■ 계약 (한 문장)
 *   폭 360px 뷰포트에서, 스크롤 상자를 가진 모든 요소는 `scrollWidth <= clientWidth + 1` 이다
 *   (문서 자신 포함). 즉 ★가로로 밀려 잘리는 자리가 없다.
 *
 * ■ 사정거리 (★출력에 늘 적는다 — 이 게이트가 무엇을 안 봤는지 숨기지 않는다)
 *   기본 대상은 `quick-math/index.html` 한 장이다. `--pages a,b` 로 늘릴 수 있다.
 *   상태는 셋을 각각 잰다: 시작 오버레이 · 판 진행 중 · 결과 오버레이.
 *
 * ■ 사용법
 *   node tools/check_overflow_360.mjs .
 *   node tools/check_overflow_360.mjs . --width 360 --pages quick-math/index.html
 *   node tools/check_overflow_360.mjs . --selftest      ★검출력(고의 넘침을 잡는가)
 *
 * ■ 종료코드: 0 = 넘침 0 · 1 = 넘침 있음 · 2 = ★판정 불가(크롬 없음·페이지 안 뜸·상태 미도달·잘못된 호출)
 *   ★rc=2 는 통과가 아니다. 못 잰 것을 초록으로 세지 않는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const flagVal = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--width', '--pages'].includes(argv[i - 1])));
const KNOWN = ['--width', '--pages', '--selftest'];
const unknown = argv.filter(a => a.startsWith('--') && !KNOWN.includes(a));
if (unknown.length || positional.length !== 1) {
  console.log('★판정 불가 — 잘못된 호출: ' + JSON.stringify(argv));
  console.log('사용법: node tools/check_overflow_360.mjs <저장소 루트> [--width 360] [--pages a,b] [--selftest]');
  process.exit(2);
}
const ROOT = path.resolve(positional[0]);
const WIDTH = Number(flagVal('--width', '360'));
const PAGES = flagVal('--pages', 'quick-math/index.html').split(',').map(s => s.trim()).filter(Boolean);
const SELFTEST = argv.includes('--selftest');

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

/* ★페이지 안에서 재는 것 — 스크롤 상자를 가진 요소 전수.
   ★요소를 고르지 않는다(고르면 안 고른 자리가 사각이 된다). 넘침은 ★렌더된 치수로만 판정한다. */
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
  let measured = 0;
  const all = [d.documentElement, ...d.querySelectorAll('*')];
  for (const el of all){
    const cw = el.clientWidth, sw = el.scrollWidth;
    if (!cw) continue;                            /* 스크롤 상자가 없다(인라인·숨김) — 잴 것이 없다 */
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue; /* 화면에 안 그려진 자리는 표본이 아니다 */
    /* ★낭독 전용(sr-only)은 ★설계상 1px 상자에 긴 글을 담는다 — 눈에 보이는 넘침이 아니다.
       ★배제는 좁게, 그리고 ★세어서 찍는다: 표준 sr-only 지문(clip-path inset(50%) ·
       clip rect(0…) · 1px 상자 + overflow hidden)일 때만 뺀다. 그 밖의 어떤 넘침도 안 뺀다
       — 배제를 넓히면 오탐 대신 ★미탐이 그 자리에 들어온다. */
    const cs = getComputedStyle(el);
    const srOnly = /inset\(50%\)/.test(cs.clipPath || '') ||
                   /rect\(0px,?\s*0px,?\s*0px,?\s*0px\)/.test(cs.clip || '') ||
                   (cw <= 1 && el.clientHeight <= 1 && cs.overflow === 'hidden');
    if (srOnly){ skipped.push(sel(el)); continue; }
    measured++;
    if (sw > cw + 1){
      over.push({ sel: sel(el), clientW: cw, scrollW: sw, spill: sw - cw,
                  cssWidth: getComputedStyle(el).width });
    }
  }
  return JSON.stringify({ state: state, measured: measured, over: over, skipped: skipped,
                          vw: d.documentElement.clientWidth,
                          started: !!(window.__quickmath && window.__quickmath.running) });
})()`;

async function measure(htmlAbs, states) {
  const chrome = findChrome();
  if (!chrome) return { fatal: '크롬 계열 브라우저를 찾지 못했다(CHROME_PATH 로 지정할 수 있다)' };
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ovf360-'));
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    `--window-size=${WIDTH},740`, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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
    /* ★폭을 못박는다 — 창 크기만 믿지 않는다(크롬 창 장식·스크롤막대가 폭을 갉는다) */
    await send('Emulation.setDeviceMetricsOverride',
               { width: WIDTH, height: 740, deviceScaleFactor: 2, mobile: true });
    let ready = false;
    for (let t = 0; t < 100 && !ready; t++) {
      await sleep(100);
      try { ready = await evaluate('document.readyState === "complete"'); } catch (_) {}
    }
    if (!ready) return { fatal: '페이지가 뜨지 않았다: ' + htmlAbs };
    const out = [];
    for (const st of states) {
      if (st === 'playing') {
        /* ★상태를 밖에서 밀어 넣지 않는다 — 제품 버튼을 진짜 사건으로 누른다 */
        try { await evaluate("(document.getElementById('btnDaily')||{click(){}}).click(), 1"); } catch (_) {}
        await sleep(150);
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

const STATES = ['start', 'playing', 'over'];

async function checkPages(root, pages) {
  console.log(`★사정거리: 페이지 ${pages.length}장 × 상태 ${STATES.length}종 · 폭 ${WIDTH}px (이 게이트가 본 것은 여기까지다)`);
  let violations = 0, measuredTotal = 0, samples = 0;
  for (const rel of pages) {
    const abs = path.join(root, rel.split('/').join(path.sep));
    if (!fs.existsSync(abs)) { console.log('★판정 불가 — 대상이 없다: ' + rel); return 2; }
    const r = await measure(abs, STATES);
    if (r.fatal) { console.log('★판정 불가 — ' + r.fatal); return 2; }
    for (const s of r.states) {
      if (s.vw !== WIDTH) { console.log(`★판정 불가 — 뷰포트 폭이 ${s.vw}px 다(${WIDTH} 여야 한다)`); return 2; }
      if (!s.measured) { console.log(`★판정 불가 — ${rel} [${s.state}] 에서 잰 요소가 0개다(표본 미성립)`); return 2; }
      if (s.state === 'playing' && !s.started) { console.log(`★판정 불가 — ${rel} [playing] 에서 판이 시작되지 않았다(표본 미성립)`); return 2; }
      measuredTotal += s.measured; samples++;
      const mark = s.over.length ? '★넘침' : 'OK  ';
      console.log(`  ${mark} ${rel} [${s.state}] · 잰 요소 ${s.measured} · 넘침 ${s.over.length}`
                  + ` · 낭독전용 제외 ${s.skipped.length}${s.skipped.length ? ' (' + s.skipped.join(', ') + ')' : ' (없음)'}`);
      for (const o of s.over) {
        violations++;
        console.log(`      ${o.sel} — clientWidth ${o.clientW} < scrollWidth ${o.scrollW} (밀림 ${o.spill}px · css width ${o.cssWidth})`);
      }
    }
  }
  console.log('');
  console.log(`잰 표본 ${samples}종 · 잰 요소 합계 ${measuredTotal} · ★넘침 ${violations}건`);
  if (!violations) console.log('  ★넘침 없음(이 줄이 부재의 증거다 — 분모는 위의 잰 요소 수다)');
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
    /* ★고의 넘침 — 결과 카드 안에 카드보다 넓은 고정폭 블록을 넣는다(F5 가 났던 그 모양) */
    const ANCHOR = '<div class="ad-slot ad-rect" id="adOver">';
    if (src.indexOf(ANCHOR) < 0) { console.log('★판정 불가 — 자기시험 앵커를 못 찾았다'); return 2; }
    if (src.split(ANCHOR).length - 1 !== 1) { console.log('★판정 불가 — 자기시험 앵커가 유일하지 않다'); return 2; }
    const broken = path.join(stage, 'broken_' + path.basename(rel));
    fs.writeFileSync(broken, src.replace(ANCHOR, '<div style="width:400px;height:8px"></div>' + ANCHOR));
    const cases = [
      ['대조군(무변이)', quiet, 0],
      ['카드보다 넓은 고정폭 블록 주입', broken, 1]
    ];
    let bad = 0;
    console.log('검출력 자기시험 — 사례 %d건(대조군 1 포함 · 임시 사본에만 심는다)'.replace('%d', String(cases.length)));
    for (const [name, file, want] of cases) {
      const r = await measure(file, ['over']);
      let rc = 2;
      if (!r.fatal) {
        const s = r.states[0];
        rc = s.over.length ? 1 : 0;
      }
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
