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
 *   **같은 값을 두 슬롯에 그렸을 때, 값 그림의 ★칠해지는 말단 요소가 두 슬롯에서 같은 치수로
 *   그려져야 한다.** 종류마다 요소 하나를 골라 재면 '담는 상자'만 보고 '눈이 읽는 것'을 놓친다 —
 *   border-box 에서 겉 상자가 같아도 안쪽이 줄면 채움이 짧아진다(master 236 이 뚫은 자리).
 *   그래서 고르지 않고 하위 요소를 전수로 훑되, ★판정은 말단(자식이 없는 요소)으로 한다.
 *   컨테이너는 칸 폭에 맞춰 줄을 접는 배치 산물이라(좁은 칸에서 점 12개가 두 줄이 된다)
 *   잉크를 바꾸지 않는다 — 지우지 않고 '관측' 줄로 남겨 사람이 보게 한다.
 *   ★못 보는 것(정직 고지): 가상 요소(::before)와 컨테이너 사이 간격(gap)의 차이는 재지 않는다.
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
 *   0 = 두 슬롯의 자가 같다(하위 요소 전수 · 숫자 예외는 실제로 달랐다 = 잣대가 살아 있다)
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
  'cur-bar-border': {
    why: '지금 칸의 막대 트랙에만 border 를 건다(겉 상자는 같은데 안쪽이 줄어 채움이 짧아진다)',
    from: '  .sr-only{',
    to:   '  .hl-cur .hl-barwrap{border:5px solid var(--mark)}\n  .sr-only{'
  },
  /* ★음성 대조군 · 이것은 ★붉으면 안 된다.
     전역 box-sizing:border-box 라 인라인 width:v px 가 바깥 상자를 고정하고 padding 은 안으로
     먹는다 — 원의 겉지름이 그대로라 착시가 없다. master(236) 가 우회 후보로 심었다가 스스로
     취소한 건이고, 통과시키는 것이 옳다. 붉어야 할 것만 시험하면 반대 방향(오탐)이 열린 채로
     초록이 된다. */
  'cur-circle-padding': {
    expect: 'quiet',
    why: '지금 칸의 원에 padding 을 건다(border-box 라 겉지름 불변 · ★통과가 옳다)',
    from: '  .sr-only{',
    to:   '  .hl-cur .hl-circ{padding:6px}\n  .sr-only{'
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
  /* ★값 그림의 ★하위 요소를 전수로 훑는다. 종류마다 요소 하나를 골라 재면 '담는 상자'만
     보고 '눈이 읽는 것'을 놓친다 — border-box 에서 겉 상자가 같아도 안쪽이 줄면 채움이 짧아진다
     (master 236 이 .hl-cur .hl-barwrap{border:5px} 로 뚫은 자리다). 고르지 않으면 안 놓친다.
     ★슬롯 자신(#prevVal/#curVal)은 뺀다 — 칸 높이(min-height)는 설계상 다르고 그림의 자가 아니다. */
  const walk = root => [...root.querySelectorAll('*')].map(el => ({
    tag: el.tagName.toLowerCase(),
    cls: el.getAttribute('class') || '',
    leaf: el.children.length === 0,     /* ★칠해지는 말단인가 · 눈이 실제로 읽는 것이다 */
    ...rect(el)
  }));
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
    const prevEls = walk(d.getElementById('prevVal'));
    const curEls  = walk(d.getElementById('curVal'));
    if (!prevEls.length || !curEls.length){ out.errors.push('종류 ' + kind + ' 의 값 그림 요소를 찾지 못했다'); continue; }
    /* ★같은 값을 같은 함수로 그렸으니 두 쪽의 요소 구조가 같아야 한다.
       다르면 사과와 오렌지를 견주는 것이라 ★판정 불가로 올린다(통과가 아니다). */
    const shape = a => a.map(e => e.tag + '.' + e.cls).join('|');
    if (shape(prevEls) !== shape(curEls)){
      out.errors.push('종류 ' + kind + ' 의 두 슬롯 요소 구조가 다르다: ' + shape(prevEls) + ' vs ' + shape(curEls));
      continue;
    }
    out.kinds[kind] = { value: v, even: w.__hl.stageEven(), n: prevEls.length,
                        els: prevEls.map((e, i) => ({ tag: e.tag, cls: e.cls, leaf: e.leaf,
                                                      prev: { w: e.w, h: e.h },
                                                      cur:  { w: curEls[i].w, h: curEls[i].h } })) };
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
    /* ★판정은 칠해지는 말단으로 한다 — 컨테이너는 칸 폭에 맞춰 줄을 접는 ★배치 산물이라
       (좁은 칸에서 점 12개가 두 줄이 된다) 잉크를 바꾸지 않는다. 다만 지우지 않고 아래에
       관측 줄로 남긴다 — 사람이 보고 판단할 몫이다. */
    const diff = x => Math.abs(x.prev.w - x.cur.w) > TOL || Math.abs(x.prev.h - x.cur.h) > TOL;
    const leaves = e.els.filter(x => x.leaf);
    const offs = leaves.filter(diff);
    const boxOffs = e.els.filter(x => !x.leaf && diff(x));
    const same = offs.length === 0;
    const show = x => `${x.tag}${x.cls ? '.' + x.cls.split(/\s+/).join('.') : ''} ` +
                      `직전 ${x.prev.w}x${x.prev.h} · 지금 ${x.cur.w}x${x.cur.h}` +
                      ` · 차이 ${Math.abs(x.prev.w - x.cur.w).toFixed(3)}x${Math.abs(x.prev.h - x.cur.h).toFixed(3)}`;
    if (k === EXEMPT_KIND){
      exemptDiffers = !same;
      out.push(`  면제 ${k} 값 ${e.value} · 말단 ${leaves.length}개 대조 → ${same ? '전부 같다' : '다르다(강조 · 읽는 값이라 허용)'}`);
      for (const x of offs) out.push(`      · ${show(x)}`);
      continue;
    }
    out.push(`  ${same ? '✓' : '✗'} ${k} 값 ${e.value} · 하위 요소 ${e.n}개 중 ★말단 ${leaves.length}개로 판정` +
             (same ? ' · 전부 같다' : ` · 어긋난 말단 ${offs.length}개`));
    for (const x of offs) out.push(`      ✗ ${show(x)}`);
    for (const x of boxOffs) out.push(`      (관측) 담는 상자가 다르다 · ${show(x)} · 배치 산물이라 판정에 넣지 않는다`);
    if (!same) bad++;
  }
  /* ★양성 대조군 · 잣대가 차이를 볼 수 있다는 증명이다. 이것이 없으면 '전부 같다' 는 초록이
     '아무것도 못 재고 있다' 와 구별되지 않는다. */
  out.push(`  [양성 대조군] 면제 종류(${EXEMPT_KIND})가 실제로 달랐는가: ${exemptDiffers ? '그렇다(잣대가 살아 있다)' : '★아니다'}`);
  if (!exemptDiffers) return { rc: 2, lines: out.concat(['판정 불가 · 잣대가 차이를 못 본다(양성 대조군 실패)']) };
  if (bad) return { rc: 1, lines: out.concat([`미달 · 두 슬롯의 자가 갈라진 종류 ${bad}종`]) };
  return { rc: 0, lines: out.concat(['통과 · 값 그림의 하위 요소가 전부 두 슬롯에서 같은 치수로 그려진다(숫자 예외)']) };
}

/* ---------------------------------------------------------------- 자기시험 */
async function selftest(){
  const names = Object.keys(MUTATIONS);
  const loud = names.filter(n => MUTATIONS[n].expect !== 'quiet');
  const quiet = names.filter(n => MUTATIONS[n].expect === 'quiet');
  console.log(`[자기시험] 원본은 통과하고, 우회 ${loud.length}종은 붉어야 하며, ` +
              `★음성 대조군 ${quiet.length}종은 조용해야 한다.\n`);
  const base = await runOnce(null);
  console.log(base.lines.join('\n'));
  console.log(`원본 rc=${base.rc}\n`);
  if (base.rc !== 0){ console.log('★원본이 이미 미달·판정불가다 · 검출력을 세울 수 없다'); return 2; }
  const missed = [], falseAlarm = [];
  for (const name of names){
    const wantQuiet = MUTATIONS[name].expect === 'quiet';
    const r = await runOnce(name);
    const good = wantQuiet ? r.rc === 0 : r.rc === 1;
    console.log(`${good ? '✓' : '★'} ${name} rc=${r.rc} ${wantQuiet ? '[음성 대조군 · 조용해야 한다]' : ''} · ${MUTATIONS[name].why}`);
    if (!good){
      (wantQuiet ? falseAlarm : missed).push(name);
      console.log(r.lines.map(l => '    ' + l).join('\n'));
    }
  }
  console.log('');
  if (missed.length){ console.log(`검출력 실패 · 못 잡은 우회 ${missed.length}종: ${missed.join(', ')}`); return 1; }
  if (falseAlarm.length){ console.log(`★오탐 · 조용해야 할 ${falseAlarm.length}종이 붉었다: ${falseAlarm.join(', ')}`); return 1; }
  console.log(`검출력 확인 · 우회 ${loud.length}종 전부 rc=1 로 붉었고, 음성 대조군 ${quiet.length}종은 rc=0 으로 조용했다(원본 rc=0)`);
  return 0;
}

const main = async () => {
  if (argv.includes('--selftest')) process.exit(await selftest());
  const r = await runOnce(MUTATION);
  console.log(r.lines.join('\n'));
  process.exit(r.rc);
};
main().catch(e => die(2, '판정 불가 · ' + (e && e.stack ? e.stack : e)));
