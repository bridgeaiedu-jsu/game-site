/* 두 슬롯의 ★렌더된 치수 대조 게이트 · worker(238) · 2026-09-04 · 티켓 T0904-higher-lower
 *
 * 왜 이 도구가 따로 있나 — master(236) 가 밖에서 심은 우회 ③이 뚫었기 때문이다.
 *   verify_higherlower.js 9-A 는 `.hl-cur` 로 시작하며 width/height/font-size/transform/scale 을
 *   선언하는 규칙을 훑는다. 그런데 `.hl-cur .hl-dots i{zoom:1.3}` 은 요소를 실제로 1.3배로
 *   그리면서도 그 목록에 없어 ★rc=0 으로 통과했다. 근인은 명확하다:
 *     ★선언 이름 훑기는 대리물이고, 계약은 ★렌더된 치수다.
 *   금지 목록은 원리적으로 못 닫는다(zoom·padding·border-width·aspect-ratio·inline-size…
 *   계속 는다). 그래서 이 도구는 목록을 늘리는 대신 ★실브라우저가 실제로 세운 치수를 잰다 —
 *   어떤 CSS 수단이든 한 번에 걸린다.
 *
 * 계약 (이 한 문장이 판정의 단일 기준이다)
 *   **같은 값을 두 슬롯에 그렸을 때, 값 그림의 렌더된 치수가 두 슬롯에서 같아야 한다.**
 *   예외는 하나뿐이다 — 숫자(.hl-num)는 길이로 견주는 것이 아니라 ★읽는 값이라 글자 크기
 *   강조를 허용한다. 그 예외는 ★양성 대조군으로도 쓴다: 숫자가 실제로 달라야 이 잣대가
 *   '차이를 볼 수 있다'는 것이 증명된다(안 그러면 전부 같다는 초록이 공허하다).
 *
 * 층 분리 — 선언 훑기(verify 9-A)는 지우지 않는다
 *   그쪽은 브라우저 없이 도는 ★값싼 조기 경보이고, 이쪽은 느리지만 ★계약 자체를 재는 잣대다.
 *   둘은 층이 다르므로 한 도구에 얹지 않는다(하나에 두 계약을 얹으면 그것이 다음 라운드의 병이 된다).
 *
 * 어떻게 재나
 *   Chrome 을 headless 로 띄우고 CDP(Node 22 의 전역 WebSocket)로 붙어, 제품 자신의 경로로
 *   그 종류의 판을 연 뒤(자유 모드 버튼을 눌러 씨앗이 그 종류를 고를 때까지) 두 슬롯에
 *   ★같은 값을 제품의 valueHtml 로 그려 넣고 getBoundingClientRect 를 읽는다.
 *   두 요소가 ★같은 페이지 안에 있으므로 확대율·dpr 은 서로 상쇄된다.
 *
 * 사용법:
 *   node tools/check_render_parity.mjs [--html <경로>] [--mutate <이름>] [--list-mutations] [--selftest]
 * 종료코드:
 *   0 = 두 슬롯의 자가 같다(숫자 예외는 실제로 달랐다 = 잣대가 살아 있다)
 *   1 = 미달(자가 갈라졌다)
 *   2 = 판정 불가(크롬 없음·구동 실패·종류 도달 실패·측정 불가) — ★통과로 세지 않는다
 */
'use strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const HTML = path.resolve(argOf('--html', path.join(__dirname, '..', 'higher-lower', 'index.html')));
const MUTATION = argOf('--mutate', null);

/* ---------------------------------------------------------------- 뮤테이션
   ★master(236) 가 밖에서 심어 준 우회를 그대로 가져다 쓴다. zoom 이 이 도구의 존재 이유다. */
const MUTATIONS = {
  'cur-dots-zoom': {
    why: '지금 칸의 점에만 zoom 을 건다(선언 훑기가 못 보던 바로 그 수단)',
    from: '  .sr-only{',
    to:   '  .hl-cur .hl-dots i{zoom:1.3}\n  .sr-only{'
  },
  'cur-circle-scale': {
    why: '지금 칸의 원에만 transform:scale 을 건다',
    from: '  .sr-only{',
    to:   '  .hl-cur .hl-circ{transform:scale(1.3)}\n  .sr-only{'
  },
  'bar-track-uneven': {
    why: '막대 판의 균등 격자를 도로 벌린다(트랙 폭이 갈라진다)',
    from: '  .hl-stage.hl-even{grid-template-columns:1fr 1fr}',
    to:   '  .hl-stage.hl-even{grid-template-columns:1fr 1.6fr}'
  }
};

if (argv.includes('--list-mutations')){
  for (const [k, v] of Object.entries(MUTATIONS)) console.log(k + '\t' + v.why);
  process.exit(0);
}

const die = (code, msg) => { console.error(msg); process.exit(code); };

/* ---------------------------------------------------------------- 크롬 찾기 */
function findChrome(){
  const cands = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch(_){} }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((res, rej) => {
  http.get(url, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch(e){ rej(e); } }); })
      .on('error', rej);
});

/* ---------------------------------------------------------------- 페이지에서 잴 것
   ★같은 값을 두 슬롯에 그리고 잰다. 값이 다르면 그림도 다른 것이 당연해 자를 못 가른다. */
const PROBE = `(async () => {
  const d = document, w = window;
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect();
                       return { w: +r.width.toFixed(3), h: +r.height.toFixed(3) }; };
  const out = { kinds: {}, errors: [] };
  const KINDS = w.__hl.const().KINDS;
  const PROBE_VALUE = { number: 42, bar: 60, dots: 12, circle: 60 };
  for (const kind of KINDS){
    let reached = false;
    for (let t = 0; t < 600; t++){
      d.getElementById('start').classList.add('show');
      d.getElementById('btnStart').click();
      if (w.__hl.state().kind === kind){ reached = true; break; }
    }
    if (!reached){ out.errors.push('종류 ' + kind + ' 에 도달하지 못했다'); continue; }
    const v = PROBE_VALUE[kind];
    if (v === undefined){ out.errors.push('종류 ' + kind + ' 의 표본 값이 없다'); continue; }
    /* ★두 슬롯에 제품 자신의 valueHtml 로 ★같은 값을 그린다 */
    d.getElementById('prevVal').innerHTML = w.__hl.valueHtml(kind, v);
    d.getElementById('curVal').innerHTML = w.__hl.valueHtml(kind, v);
    /* 레이아웃이 확정되게 강제로 한 번 읽는다 */
    void d.body.offsetHeight;
    const sel = { number: '.hl-num', bar: '.hl-barwrap', dots: '.hl-dots i', circle: '.hl-circ' }[kind];
    const prev = rect(d.querySelector('#prevVal ' + sel));
    const cur  = rect(d.querySelector('#curVal ' + sel));
    if (!prev || !cur){ out.errors.push('종류 ' + kind + ' 의 값 그림(' + sel + ')을 찾지 못했다'); continue; }
    const extra = {};
    if (kind === 'bar') extra.fill = rect(d.querySelector('#curVal .hl-barfill'));
    if (kind === 'dots') extra.count = [d.querySelectorAll('#prevVal .hl-dots i').length,
                                        d.querySelectorAll('#curVal .hl-dots i').length];
    out.kinds[kind] = { value: v, sel, prev, cur, even: w.__hl.stageEven(), ...extra };
  }
  out.dpr = w.devicePixelRatio;
  return JSON.stringify(out);
})()`;

/* ---------------------------------------------------------------- CDP 로 한 번 재기 */
async function measure(htmlPath){
  const chrome = findChrome();
  if (!chrome) return { fatal: '크롬 계열 브라우저를 찾지 못했다(CHROME_PATH 로 지정할 수 있다)' };
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-parity-'));
  const url = pathToFileURL(htmlPath).href;
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--allow-file-access-from-files', url
  ], { stdio: 'ignore' });
  /* ★고아를 남기지 않는다 — 어떤 경로로 끝나든 죽인다 */
  const kill = () => { try { child.kill('SIGKILL'); } catch(_){}
                       if (process.platform === 'win32' && child.pid){
                         try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch(_){}
                       } };
  process.on('exit', kill);
  try {
    /* DevToolsActivePort 파일에서 실제 포트를 읽는다(포트 0 = 크롬이 고른다) */
    const portFile = path.join(profile, 'DevToolsActivePort');
    let port = null;
    for (let t = 0; t < 100 && port === null; t++){
      await sleep(100);
      try { const l = fs.readFileSync(portFile, 'utf8').split('\n'); if (l[0]) port = Number(l[0].trim()); } catch(_){}
    }
    if (!port) return { fatal: '크롬 디버깅 포트를 얻지 못했다(기동 실패)' };

    let target = null;
    for (let t = 0; t < 60 && !target; t++){
      await sleep(100);
      try { target = (await getJson(`http://127.0.0.1:${port}/json/list`)).find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch(_){}
    }
    if (!target) return { fatal: '크롬 페이지 대상을 찾지 못했다' };

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); setTimeout(() => rej(new Error('ws timeout')), 10000); })
      .catch(e => { throw new Error('CDP 접속 실패: ' + e.message); });
    let id = 0;
    const pending = new Map();
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch(_){ return; }
      if (m.id && pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params) => new Promise((res, rej) => {
      const myId = ++id;
      pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
      setTimeout(() => { if (pending.has(myId)){ pending.delete(myId); rej(new Error(method + ' 응답 없음')); } }, 30000);
    });
    const evaluate = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error('페이지 예외: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    /* 페이지가 뜨고 관측 창구가 설 때까지 기다린다 */
    let ready = false;
    for (let t = 0; t < 100 && !ready; t++){
      await sleep(100);
      try { ready = await evaluate('document.readyState === "complete" && !!window.__hl'); } catch(_){}
    }
    if (!ready) return { fatal: '페이지가 뜨지 않았거나 관측 창구(__hl)가 서지 않았다' };

    const raw = await evaluate(PROBE);
    try { ws.close(); } catch(_){}
    if (!raw) return { fatal: '측정 결과를 받지 못했다' };
    return JSON.parse(raw);
  } catch (e){
    return { fatal: String(e && e.message ? e.message : e) };
  } finally {
    kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch(_){}
  }
}

/* ---------------------------------------------------------------- 판정 */
const TOL = 0.5;                 /* 서브픽셀 허용 오차(px) */
const EXEMPT_KIND = 'number';    /* ★유일한 예외 · 길이가 아니라 읽는 값이다 */

async function runOnce(mutation){
  let target = HTML, tmp = null;
  if (mutation){
    const m = MUTATIONS[mutation];
    if (!m) return { rc: 2, lines: ['알 수 없는 뮤테이션: ' + mutation] };
    const src = fs.readFileSync(HTML, 'utf8');
    const n = src.split(m.from).length - 1;
    if (n !== 1) return { rc: 2, lines: [`뮤테이션 주입 실패(${mutation}) · 앵커가 ${n}회 나타났다(1회여야 한다)`] };
    tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hl-mut-')), 'index.html');
    fs.writeFileSync(tmp, src.replace(m.from, m.to));
    target = tmp;
  }
  const out = [];
  const res = await measure(target);
  if (tmp) { try { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); } catch(_){} }
  if (res.fatal) return { rc: 2, lines: ['판정 불가 · ' + res.fatal] };
  if (res.errors && res.errors.length) return { rc: 2, lines: ['판정 불가 · ' + res.errors.join(' / ')] };

  const kinds = Object.keys(res.kinds);
  if (kinds.length < 4) return { rc: 2, lines: [`판정 불가 · 잰 종류가 ${kinds.length}종이다(4종이어야 한다)`] };

  let bad = 0, exemptDiffers = false;
  out.push(`대상 ${target}`);
  out.push(`devicePixelRatio ${res.dpr} · 허용 오차 ${TOL}px · 두 요소가 같은 페이지 안에 있어 확대율은 상쇄된다`);
  for (const k of kinds){
    const e = res.kinds[k];
    const dw = Math.abs(e.prev.w - e.cur.w), dh = Math.abs(e.prev.h - e.cur.h);
    const same = dw <= TOL && dh <= TOL;
    const extra = e.count ? ` · 점 개수 ${e.count[0]}/${e.count[1]}` : (e.fill ? ` · 채움 ${e.fill.w}` : '');
    if (k === EXEMPT_KIND){
      exemptDiffers = !same;
      out.push(`  면제 ${k} (${e.sel}) 값 ${e.value} · 직전 ${e.prev.w}x${e.prev.h} · 지금 ${e.cur.w}x${e.cur.h}` +
               ` → ${same ? '같다' : '다르다(강조 · 읽는 값이라 허용)'}`);
      continue;
    }
    out.push(`  ${same ? '✓' : '✗'} ${k} (${e.sel}) 값 ${e.value} · 직전 ${e.prev.w}x${e.prev.h} · 지금 ${e.cur.w}x${e.cur.h}` +
             ` · 차이 ${dw.toFixed(3)}x${dh.toFixed(3)}${extra}`);
    if (!same) bad++;
  }
  /* ★양성 대조군 · 잣대가 차이를 볼 수 있다는 증명이다. 이것이 없으면 '전부 같다' 는 초록이
     '아무것도 못 재고 있다' 와 구별되지 않는다. */
  out.push(`  [양성 대조군] 면제 종류(${EXEMPT_KIND})가 실제로 달랐는가: ${exemptDiffers ? '그렇다(잣대가 살아 있다)' : '★아니다'}`);
  if (!exemptDiffers) return { rc: 2, lines: out.concat(['판정 불가 · 잣대가 차이를 못 본다(양성 대조군 실패)']) };
  if (bad) return { rc: 1, lines: out.concat([`미달 · 두 슬롯의 자가 갈라진 종류 ${bad}종`]) };
  return { rc: 0, lines: out.concat(['통과 · 값 그림의 렌더된 치수가 두 슬롯에서 같다(숫자 예외)']) };
}

/* ---------------------------------------------------------------- 자기시험 */
async function selftest(){
  console.log('[자기시험] 원본은 통과하고, 심어 둔 우회 3종은 전부 붉어야 한다.\n');
  const base = await runOnce(null);
  console.log(base.lines.join('\n'));
  console.log(`원본 rc=${base.rc}\n`);
  if (base.rc !== 0){ console.log('★원본이 이미 미달·판정불가다 · 검출력을 세울 수 없다'); return 2; }
  let bad = [];
  for (const name of Object.keys(MUTATIONS)){
    const r = await runOnce(name);
    const okDetect = r.rc === 1;
    console.log(`${okDetect ? '✓' : '★'} ${name} rc=${r.rc} · ${MUTATIONS[name].why}`);
    if (!okDetect){ bad.push(name); console.log(r.lines.map(l => '    ' + l).join('\n')); }
  }
  console.log('');
  if (bad.length){ console.log(`검출력 실패 · 못 잡은 우회 ${bad.length}종: ${bad.join(', ')}`); return 1; }
  console.log(`검출력 확인 · 우회 ${Object.keys(MUTATIONS).length}종 전부 rc=1 로 붉었다(원본은 rc=0)`);
  return 0;
}

const main = async () => {
  if (argv.includes('--selftest')) process.exit(await selftest());
  const r = await runOnce(MUTATION);
  console.log(r.lines.join('\n'));
  process.exit(r.rc);
};
main().catch(e => die(2, '판정 불가 · ' + (e && e.stack ? e.stack : e)));
