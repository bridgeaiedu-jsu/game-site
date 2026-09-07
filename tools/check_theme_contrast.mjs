/* check_theme_contrast.mjs — ★두 테마(라이트·다크)에서 글자 대비가 계약을 지키는가.
 *
 * ■ 왜 만들었나 (2026-09-08 · R6 B5)
 *   「빠른 셈」 본문(문제식·보기·감점 배지·결과 숫자)의 ★테마별 대비를 재는 검사가 0건이었다.
 *   `check_palette.py`·`check_rainbow.py` 는 대문 팔레트·무지개 토큰을 보고,
 *   `check_card_render.js` 는 대문 카드 색의 다크 우선순위를 보는 ★수동 검사다.
 *   그리고 두 라운드 동안 "다크는 강제할 수단이 없다" 고 적혀 있었는데 — ★그건 틀렸다.
 *   이미 CDP 로 페이지를 띄우고 있으므로 `Emulation.setEmulatedMedia` 로 다크를 강제하고
 *   `getComputedStyle` 로 ★렌더된 색을 그대로 읽으면 된다. ★못 하는 게 아니라 안 세운 것이었다.
 *
 * ■ 계약 (한 문장)
 *   보이는 글자마다 ★그려진 전경색과 ★그려진 배경색의 대비비가 WCAG 하한을 넘는다 —
 *   보통 글자 4.5:1 · 큰 글자(24px 이상, 또는 굵고 18.66px 이상) 3:1. ★두 테마 모두에서.
 *
 * ■ 어떻게 재나 (대리물 금지)
 *   선언 훑기(어떤 토큰을 썼는가)가 아니라 ★computed 값을 읽는다. 배경은 조상으로 올라가며
 *   ★불투명한 첫 배경을 찾고, 반투명 전경은 그 배경 위에 ★합성해서 계산한다.
 *   요소를 고르지 않는다 — ★자기 글자를 가진 보이는 요소 전수다(sr-only 는 사유와 함께 뺀다).
 *
 * ■ 사정거리 (출력 첫 줄에 적는다)
 *   페이지 × 테마 2 × 상태 3. 기본 대상은 `quick-math/index.html`.
 *   `over` 상태는 ★실제로 판을 끝내서(오답으로 시간을 태워) 제품이 그린 결과 화면을 잰다.
 *
 * ■ 사용법
 *   node tools/check_theme_contrast.mjs .
 *   node tools/check_theme_contrast.mjs . --themes dark --lang en
 *   node tools/check_theme_contrast.mjs . --selftest        ★검출력(고의 저대비를 잡는가)
 *
 * ■ 종료코드: 0 = 위반 0 · 1 = 위반 있음 · 2 = ★판정 불가(크롬 없음·페이지 안 뜸·표본 미성립·
 *   테마 강제 실패·잘못된 호출). ★rc=2 는 통과가 아니다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const VALUE_FLAGS = ['--pages', '--lang', '--themes', '--width'];
const flagVal = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.includes(argv[i - 1])));
const KNOWN = VALUE_FLAGS.concat(['--selftest']);
const unknown = argv.filter(a => a.startsWith('--') && !KNOWN.includes(a));
const THEMES = flagVal('--themes', 'light,dark').split(',').map(s => s.trim()).filter(Boolean);
const LANG = flagVal('--lang', 'ko');
if (unknown.length || positional.length !== 1 || THEMES.some(t => !['light', 'dark'].includes(t)) ||
    !['ko', 'en'].includes(LANG)) {
  console.log('★판정 불가 — 잘못된 호출: ' + JSON.stringify(argv));
  console.log('사용법: node tools/check_theme_contrast.mjs <저장소 루트> [--themes light,dark] [--lang ko|en] [--width 360] [--selftest]');
  process.exit(2);
}
const ROOT = path.resolve(positional[0]);
const WIDTH = Number(flagVal('--width', '360'));
const PAGES = flagVal('--pages', 'quick-math/index.html').split(',').map(s => s.trim()).filter(Boolean);
const SELFTEST = argv.includes('--selftest');
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

const PROBE = state => `(() => {
  const d = document;
  const show = id => { const el = d.getElementById(id); if (el) el.classList.add('show'); };
  const hide = id => { const el = d.getElementById(id); if (el) el.classList.remove('show'); };
  const state = ${JSON.stringify(state)};
  if (state === 'start'){ show('start'); hide('over'); }
  if (state === 'playing'){ hide('start'); hide('over'); }
  if (state === 'over'){ hide('start'); show('over'); }
  void d.body.offsetHeight;

  const parse = c => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(s => parseFloat(s.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({          /* 반투명 전경을 배경 위에 ★합성한다 */
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1
  });
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
                            return (hi + 0.05) / (lo + 0.05); };
  const bgOf = el => {                 /* ★그려진 배경 — 불투명한 첫 조상까지 올라간다 */
    let cur = el, acc = null;
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (c.a >= 1) return acc; }
      cur = cur.parentElement;
    }
    const html = parse(getComputedStyle(d.documentElement).backgroundColor);
    const base = (html && html.a >= 1) ? html : { r: 255, g: 255, b: 255, a: 1 };
    return acc ? over(acc, base) : base;
  };
  const sel = el => {
    const id = el.id ? '#' + el.id : '';
    const cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2).map(c => '.' + c).join('');
    return el.tagName.toLowerCase() + id + cls;
  };

  const rows = [], skipped = [];
  let measured = 0;
  for (const el of d.querySelectorAll('*')) {
    /* ★자기 글자를 가진 요소만 — 자식의 글자는 그 자식에서 잰다(중복·오귀속 방지) */
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
    const srOnly = /inset\\(50%\\)/.test(cs.clipPath || '') ||
                   /rect\\(0px,?\\s*0px,?\\s*0px,?\\s*0px\\)/.test(cs.clip || '');
    if (srOnly) { skipped.push(sel(el)); continue; }
    const fg0 = parse(cs.color);
    if (!fg0) continue;
    const bg = bgOf(el);
    const fg = fg0.a < 1 ? over(fg0, bg) : fg0;
    const size = parseFloat(cs.fontSize) || 16;
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (weight >= 700 && size >= 18.66);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, bg);
    measured++;
    rows.push({ sel: sel(el), text: own.slice(0, 18), size: size, weight: weight, large: large,
                need: need, ratio: Math.round(got * 100) / 100,
                fg: cs.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(v => Math.round(v)).join(',') + ')',
                ok: got + 0.005 >= need });
  }
  return JSON.stringify({ state: state, measured: measured, skipped: skipped, rows: rows,
                          scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
                          lang: d.documentElement.lang,
                          reviewRows: d.querySelectorAll('#review li').length,
                          running: !!(window.__quickmath && window.__quickmath.running) });
})()`;

const PLAY_TO_END = `(() => {
  const k = window.__quickmath;
  const opts = () => [...document.querySelectorAll('#opts .opt')];
  let guard = 0;
  while (k && k.running && guard++ < 400) {
    const q = k.deck[k.idx];
    const wrong = [0,1,2,3].filter(i => i !== q.correct && !opts()[i].disabled)[0];
    if (wrong === undefined) { opts()[q.correct].click(); continue; }
    opts()[wrong].click();
  }
  return JSON.stringify({ running: !!(k && k.running), reviewRows: document.querySelectorAll('#review li').length });
})()`;

async function measure(htmlAbs, theme) {
  const chrome = findChrome();
  if (!chrome) return { fatal: '크롬 계열 브라우저를 찾지 못했다(CHROME_PATH 로 지정할 수 있다)' };
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-contrast-'));
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
    await send('Page.enable', {});
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 740, deviceScaleFactor: 2, mobile: true });
    /* ★테마를 강제한다 — 두 라운드 동안 "수단이 없다" 고 적혀 있던 자리가 여기다 */
    await send('Emulation.setEmulatedMedia',
               { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await send('Page.addScriptToEvaluateOnNewDocument',
               { source: `try{localStorage.setItem('bp.lang', ${JSON.stringify(LANG)});}catch(e){}` });
    await send('Page.reload', { ignoreCache: true });
    let ready = false;
    for (let t = 0; t < 120 && !ready; t++) {
      await sleep(100);
      try { ready = await evaluate('document.readyState === "complete"'); } catch (_) {}
    }
    if (!ready) return { fatal: '페이지가 뜨지 않았다: ' + htmlAbs };
    const out = [];
    for (const st of STATES) {
      if (st === 'playing') {
        try { await evaluate("(document.getElementById('btnDaily')||{click(){}}).click(), 1"); } catch (_) {}
        await sleep(200);
      }
      if (st === 'over') {
        const r = JSON.parse(await evaluate(PLAY_TO_END) || '{}');
        if (r.running || !r.reviewRows) {
          return { fatal: '판을 끝내 결과 화면을 만들지 못했다(running=' + r.running + ' · 오답행 ' + r.reviewRows + ')' };
        }
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

async function run(root, pages) {
  console.log(`★사정거리: 페이지 ${pages.length}장 × ★테마 ${THEMES.length}(${THEMES.join(',')}) × 상태 ${STATES.length}(${STATES.join(',')})`
              + ` · 폭 ${WIDTH}px · 언어 ${LANG} — 이 게이트가 본 것은 여기까지다`);
  console.log('  하한: 보통 글자 4.5:1 · 큰 글자(24px+ 또는 굵고 18.66px+) 3:1 — ★선언이 아니라 렌더된 색으로 잰다');
  let bad = 0, total = 0, samples = 0;
  for (const rel of pages) {
    const abs = path.join(root, rel.split('/').join(path.sep));
    if (!fs.existsSync(abs)) { console.log('★판정 불가 — 대상이 없다: ' + rel); return 2; }
    for (const theme of THEMES) {
      const r = await measure(abs, theme);
      if (r.fatal) { console.log('★판정 불가 — ' + r.fatal); return 2; }
      for (const s of r.states) {
        if (s.scheme !== theme) { console.log(`★판정 불가 — 테마 강제 실패(요청 ${theme} · 페이지가 본 것 ${s.scheme})`); return 2; }
        if (s.lang !== LANG) { console.log(`★판정 불가 — 언어 고정 실패(요청 ${LANG} · 문서 ${s.lang})`); return 2; }
        if (!s.measured) { console.log(`★판정 불가 — ${rel} [${theme}/${s.state}] 에서 잰 글자 요소가 0개다(표본 미성립)`); return 2; }
        const viol = s.rows.filter(x => !x.ok);
        bad += viol.length; total += s.measured; samples++;
        const worst = s.rows.slice().sort((a, b) => a.ratio - b.ratio)[0];
        console.log(`  ${viol.length ? '★위반' : 'OK  '} ${rel} [${theme} · ${s.state}] · 잰 글자 ${s.measured} · 위반 ${viol.length}`
                    + ` · 낭독전용 제외 ${s.skipped.length}`
                    + (worst ? ` · ★최저 대비 ${worst.ratio}:1 (${worst.sel} "${worst.text}" · 하한 ${worst.need})` : ''));
        for (const v of viol) {
          console.log(`      ${v.sel} "${v.text}" — ${v.ratio}:1 < ${v.need}:1 · 글자 ${v.size}px/${v.weight} · ${v.fg} on ${v.bg}`);
        }
      }
    }
  }
  console.log('');
  console.log(`잰 표본 ${samples}종 · 잰 글자 요소 합계 ${total} · ★위반 ${bad}건`);
  if (!bad) console.log('  ★위반 없음(이 줄이 부재의 증거다 — 분모는 위의 잰 글자 수다)');
  return bad ? 1 : 0;
}

async function selftest(root) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-selftest-'));
  try {
    const rel = PAGES[0];
    const src = fs.readFileSync(path.join(root, rel.split('/').join(path.sep)), 'utf8');
    fs.mkdirSync(path.join(stage, path.dirname(rel)), { recursive: true });
    const quiet = path.join(stage, rel);
    fs.writeFileSync(quiet, src);
    /* ★고의 저대비 — 카드 글자를 배경에 가깝게 만든다(다크·라이트 둘 다에서 걸려야 한다) */
    const ANCHOR = '</head>';
    if (src.split(ANCHOR).length - 1 !== 1) { console.log('★판정 불가 — 자기시험 앵커가 유일하지 않다'); return 2; }
    const broken = path.join(stage, 'broken_' + path.basename(rel));
    fs.writeFileSync(broken, src.replace(ANCHOR,
      '<style>.card .sub{color:#8a8a8a;background:#909090}</style>' + ANCHOR));
    /* ★고대비로 덮는 사본 — '주입하면 늘어난다' 의 거울상이다(줄이는 방향도 보여야 잣대가 산다) */
    const fixed = path.join(stage, 'fixed_' + path.basename(rel));
    fs.writeFileSync(fixed, src.replace(ANCHOR,
      '<style>*{color:#000!important;background-color:#fff!important}</style>' + ANCHOR));
    const count = async file => {
      const r = await measure(file, THEMES[0]);
      if (r.fatal) return { err: r.fatal };
      return { n: r.states.reduce((acc, s) => acc + s.rows.filter(x => !x.ok).length, 0) };
    };
    /* ★기준선을 먼저 세운다 — 제품에 이미 위반이 있으면 '무변이 = 0' 은 참이 아니다.
       그래서 판정은 ★절대수가 아니라 기준선 대비 ★증가·감소로 한다(2026-09-08 R6). */
    const base = await count(quiet);
    if (base.err) { console.log('★판정 불가 — 기준선을 못 쟀다: ' + base.err); return 2; }
    const worse = await count(broken);
    if (worse.err) { console.log('★판정 불가 — 주입본을 못 쟀다: ' + worse.err); return 2; }
    const better = await count(fixed);
    if (better.err) { console.log('★판정 불가 — 고대비본을 못 쟀다: ' + better.err); return 2; }
    const cases = [
      ['기준선(무변이) — 지금 제품의 위반 수', base.n >= 0, `위반 ${base.n}건`],
      ['★저대비 주입 — 기준선보다 늘어야 한다', worse.n > base.n, `위반 ${worse.n} > 기준선 ${base.n}`],
      ['★고대비 덮기 — 위반이 0 이어야 한다', better.n === 0, `위반 ${better.n}`]
    ];
    let bad = 0;
    console.log(`검출력 자기시험 — 사례 ${cases.length}건(임시 사본에만 심는다 · 판정은 ★기준선 대비다)`);
    for (const [name, ok, detail] of cases) {
      if (!ok) bad++;
      console.log(`  [${ok ? 'OK ' : '★어긋남'}] ${name} — ${detail}`);
    }
    console.log('');
    console.log(`==== 자기시험 사례 ${cases.length}건 · 어긋남 ${bad}건 ====`);
    return bad ? 1 : 0;
  } finally {
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch (_) {}
  }
}

const rc = SELFTEST ? await selftest(ROOT) : await run(ROOT, PAGES);
process.exit(rc);
