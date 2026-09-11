/* 광고 자리표시자 비노출 게이트 — 2026-09-12 · 애드센스 재신청 라운드
 *
 * 계약 (한 문장이 판정의 단일 기준이다)
 *   **`.ad-slot` 중 진짜 광고가 들어 있지 않은 자리(= `.live` 가 아닌 자리)의 글자는
 *     어느 페이지·어느 언어에서도 화면에 그려지지 않는다.**
 *
 * 왜 만들었나
 *   애드센스가 hanpango.com 을 "가치가 별로 없는 콘텐츠" 로 걸었다(2026-09-12). 승인 전에는
 *   광고가 들어올 수 없는데 28개 페이지 전부에 '광고 자리 (320×50 / 728×90)' 라고 적힌 빈
 *   점선 상자가 그려지고 있었다. 숨김 스위치는 `css/ad-slots.css` 한 곳이고, 이 게이트는
 *   ★그 스위치가 실제 렌더 결과에 닿는지를 본다.
 *
 * ★왜 문자열 검사로 때우지 않는가
 *   소스에서 '광고 자리' 를 grep 하면 ★마크업에 그 글자가 있다까지만 증명된다. 사용자가
 *   보는 것은 스타일시트가 적용된 뒤의 DOM 이다(기억: grep-proves-source-not-what-renders).
 *   그래서 이 도구는 ★진짜 브라우저를 띄우고 ★HTTP 로 띄운다 — `file://` 에서는 절대경로
 *   `/css/ad-slots.css` 가 풀리지 않아 스위치가 아예 로드되지 않는다(그 초록은 거짓이다).
 *
 * ★공허 방지 — 검출력 자기시험을 ★같이 돌린다
 *   대표 페이지 한 장에서 숨김 규칙을 ★무르게 한 뒤, 이 검사기가 자리표시자를 ★실제로
 *   본다는 것을 확인한다. 그 팔이 조용하면 이 게이트는 무엇도 증명하지 못하므로 rc=2
 *   (판정 불가)로 멈춘다. '검사 못 함' 을 통과로 세지 않는다.
 *
 * 규칙 id (지적마다 붙는다)
 *   [ad-placeholder-invisible]  .live 아닌 .ad-slot 의 글자가 화면에 없다
 *   [ad-placeholder-nogap]      숨긴 자리가 ★빈 공백을 남기지 않는다(그려진 높이 0)
 *   [ad-switch-linked]          .ad-slot 을 가진 페이지는 스위치 스타일시트를 걸고 있다
 *   [ad-placeholder-source-empty] 자리표시자 문구가 ★소스에도 없다(숨은 텍스트를 남기지 않는다)
 *   [ad-detector-armed]         검출력 자기시험 — 옛 상태(문구+보임)를 되살리면 ★두 축이 붉어진다
 *
 * exit 0=통과 · 1=미달 · 2=판정 불가(브라우저 없음·기동 실패·검출력 미증명)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.resolve(process.argv[2] || '.');
const LANGS = ['ko', 'en'];
/* 화면에 나오면 안 되는 글자 — ko·en 두 벌을 ★둘 다 센다(한쪽만 보면 다른 쪽이 샌다) */
const FORBIDDEN = ['광고 자리', 'Ad slot'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8'
};

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

const getJson = url => new Promise((res, rej) => {
  http.get(url, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); })
      .on('error', rej);
});

/* 검사 대상 = .ad-slot 을 가진 페이지 전수(하드코딩 목록이 아니라 ★트리에서 파생한다) */
function pagesWithAdSlot() {
  const out = [];
  const walk = dir => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === 'tools') continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!ent.name.endsWith('.html')) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (src.includes('class="ad-slot')) out.push(p);
    }
  };
  walk(ROOT);
  return out.sort();
}

/* ★정적 전수 — 소스에도 남기지 않는다
   숨은 텍스트는 그 자체로 좋은 신호가 아니다(master 2026-09-12). 렌더에서 안 보이는 것과
   소스에 없는 것은 다른 관문이라 ★따로 센다. 여기서 보는 것은 자리표시자 ★문구뿐이고,
   배치 규약을 적어 둔 ★설명 주석은 대상이 아니다(브리프 §2 — 기존 설명을 지우지 않는다). */
function staticSweep(pages) {
  const SPAN = /<span data-i18n="adPlaceholder2?"[^>]*>([^<]*)<\/span>/g;
  const DICT = /adPlaceholder2?\s*:\s*'([^']*)'/g;
  const fails = [];
  let spans = 0, dicts = 0;
  for (const abs of pages) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    const src = fs.readFileSync(abs, 'utf8');
    let m;
    SPAN.lastIndex = 0;
    while ((m = SPAN.exec(src))) {
      spans++;
      if (m[1].trim()) fails.push(`[ad-placeholder-source-empty] ${rel} — span 에 "${m[1].trim().slice(0, 40)}" 가 ★소스에 남아 있다`);
    }
    DICT.lastIndex = 0;
    while ((m = DICT.exec(src))) {
      dicts++;
      if (m[1].trim()) fails.push(`[ad-placeholder-source-empty] ${rel} — i18n 값에 "${m[1].trim().slice(0, 40)}" 가 ★소스에 남아 있다`);
    }
  }
  return { fails, spans, dicts };
}

/* 페이지 안에서 재는 코드 — ★그려진 결과만 본다 */
const PROBE = `(() => {
  const FORBIDDEN = ${JSON.stringify(FORBIDDEN)};
  const d = document;
  const visible = el => {
    if (!el || !el.getClientRects) return false;
    if (el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  /* 화면에 그려지는 글자만 모은다 — 숨은 조상 아래 텍스트는 세지 않는다 */
  const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
  const hits = [];
  let n;
  while ((n = walker.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (!t) continue;
    if (!FORBIDDEN.some(f => t.includes(f))) continue;
    const host = n.parentElement;
    if (!visible(host)) continue;
    const id = host.id ? '#' + host.id : '';
    hits.push({ text: t.slice(0, 60), sel: host.tagName.toLowerCase() + id });
  }
  const slots = [...d.querySelectorAll('.ad-slot')];
  const gaps = [];
  for (const s of slots) {
    if (s.classList.contains('live')) continue;
    const r = s.getBoundingClientRect();
    if (r.height > 0) gaps.push({ sel: (s.id ? '#' + s.id : '.ad-slot'), h: Math.round(r.height) });
  }
  return JSON.stringify({
    hits: hits, gaps: gaps,
    slots: slots.length,
    live: slots.filter(s => s.classList.contains('live')).length,
    linked: !!d.querySelector('link[href="/css/ad-slots.css"]'),
    switchApplied: (() => {
      const probe = d.createElement('div');
      probe.className = 'ad-slot';
      probe.textContent = 'x';
      d.body.appendChild(probe);
      const hidden = getComputedStyle(probe).display === 'none';
      probe.remove();
      return hidden;
    })(),
    lang: d.documentElement.lang || '',
    ready: d.readyState
  });
})()`;

async function main() {
  const pages = pagesWithAdSlot();
  if (pages.length === 0) {
    console.log('RUNNER: .ad-slot 을 가진 페이지가 0장이다 — 잴 대상이 없다(판정 불가).');
    process.exit(2);
  }
  const chrome = findChrome();
  if (!chrome) {
    console.log('RUNNER: 크롬 계열 브라우저를 찾지 못했다(CHROME_PATH 로 지정할 수 있다) — 판정 불가.');
    process.exit(2);
  }

  /* 자기 프로세스 안의 정적 서버 — 이 프로세스가 끝나면 같이 죽는다(고아가 남지 않는다) */
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    const abs = path.join(ROOT, path.normalize(rel).replace(/^[\\/]+/, ''));
    if (!abs.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(abs, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-placeholder-'));
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    '--window-size=412,900', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    'about:blank'
  ], { stdio: 'ignore' });
  const kill = () => {
    try { child.kill('SIGKILL'); } catch (_) {}
    if (process.platform === 'win32' && child.pid) {
      try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {}
    }
    try { server.close(); } catch (_) {}
  };
  process.on('exit', kill);

  let rc = 0;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    let dport = null;
    for (let t = 0; t < 100 && dport === null; t++) {
      await sleep(100);
      try { const l = fs.readFileSync(portFile, 'utf8').split('\n'); if (l[0]) dport = Number(l[0].trim()); } catch (_) {}
    }
    if (!dport) { console.log('RUNNER: 크롬 디버깅 포트를 얻지 못했다 — 판정 불가.'); kill(); process.exit(2); }
    let target = null;
    for (let t = 0; t < 60 && !target; t++) {
      await sleep(100);
      try { target = (await getJson(`http://127.0.0.1:${dport}/json/list`)).find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (_) {}
    }
    if (!target) { console.log('RUNNER: 크롬 페이지 대상을 찾지 못했다 — 판정 불가.'); kill(); process.exit(2); }

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

    const stat = staticSweep(pages);
    const fails = [...stat.fails];
    const rows = [];
    let measured = 0;

    for (const abs of pages) {
      const rel = '/' + path.relative(ROOT, abs).split(path.sep).join('/').replace(/index\.html$/, '');
      for (const lang of LANGS) {
        await send('Page.addScriptToEvaluateOnNewDocument',
                   { source: `try{localStorage.setItem('bp.lang', ${JSON.stringify(lang)});}catch(e){}` });
        await send('Page.navigate', { url: `http://127.0.0.1:${port}${rel}` });
        let ready = false;
        for (let t = 0; t < 120 && !ready; t++) {
          await sleep(60);
          try { ready = await evaluate('document.readyState === "complete"'); } catch (_) {}
        }
        if (!ready) { fails.push(`[ad-placeholder-invisible] ${rel} (${lang}) — 페이지가 뜨지 않았다`); continue; }
        await sleep(120);
        const raw = await evaluate(PROBE);
        const r = JSON.parse(raw);
        measured++;
        rows.push({ rel, lang, r });
        if (!r.linked) fails.push(`[ad-switch-linked] ${rel} (${lang}) — 스위치 스타일시트를 걸지 않았다`);
        if (!r.switchApplied) fails.push(`[ad-switch-linked] ${rel} (${lang}) — 스위치가 ★적용되지 않았다(로드 실패 의심)`);
        for (const h of r.hits) fails.push(`[ad-placeholder-invisible] ${rel} (${lang}) — ${h.sel} 에 "${h.text}" 가 ★보인다`);
        for (const g of r.gaps) fails.push(`[ad-placeholder-nogap] ${rel} (${lang}) — ${g.sel} 가 높이 ${g.h}px 의 ★빈 자리를 남긴다`);
      }
    }

    /* ★검출력 자기시험 — 규칙을 무르게 하면 이 검사기가 붉어져야 한다 */
    const probePage = '/' + path.relative(ROOT, pages[0]).split(path.sep).join('/').replace(/index\.html$/, '');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}${probePage}` });
    let ready2 = false;
    for (let t = 0; t < 120 && !ready2; t++) {
      await sleep(60);
      try { ready2 = await evaluate('document.readyState === "complete"'); } catch (_) {}
    }
    let armed = { hits: 0, gaps: 0 };
    if (ready2) {
      /* ★옛 상태를 그대로 되살린다 — ①숨김 규칙을 무르게 하고 ②비운 문구를 다시 채운다.
         문구를 비운 뒤로는 '보이게만' 해서는 글자 축이 설 수 없다(2026-09-12 master 추가 지시 반영).
         두 축(글자·빈자리)이 ★함께 붉어져야 이 게이트가 무엇을 지키는지 증명된다. */
      await evaluate(`(() => { const s = document.createElement('style');
        s.textContent = '.ad-slot:not(.live){display:flex !important}';
        document.head.appendChild(s);
        for (const sp of document.querySelectorAll('.ad-slot [data-i18n^="adPlaceholder"]')) {
          sp.textContent = '광고 자리 (320×50 / 728×90)';
        }
        return 1; })()`);
      await sleep(120);
      const raw2 = JSON.parse(await evaluate(PROBE));
      armed = { hits: raw2.hits.length, gaps: raw2.gaps.length };
    }
    const detectorOk = armed.hits > 0 && armed.gaps > 0;

    console.log('=== 광고 자리표시자 비노출 게이트 ===');
    console.log(`대상 페이지 ${pages.length}장 × 언어 ${LANGS.length}종 = 잰 화면 ${measured} (분모는 트리에서 파생했다)`);
    console.log(`정적 전수: 자리표시자 span ${stat.spans}개 · i18n 값 ${stat.dicts}개를 읽어 ★비어 있지 않은 것 ${stat.fails.length}건`);
    const slotTotal = rows.reduce((a, x) => a + x.r.slots, 0);
    console.log(`잰 .ad-slot 요소 ${slotTotal}개 (그 중 .live ${rows.reduce((a, x) => a + x.r.live, 0)}개 — .live 는 진짜 광고 자리라 판정에서 뺀다)`);
    console.log(`검출력 자기시험: 숨김 규칙을 무르게 한 ${probePage} 에서 자리표시자 ${armed.hits}건 · 빈자리 ${armed.gaps}건 관측` +
                (detectorOk ? ' — ★이 검사기는 실제로 잡는다' : ' — ★못 잡는다(공허)'));

    if (!detectorOk) {
      console.log('★판정 불가 — 검출력이 서지 않았다. 초록을 통과로 세지 않는다 (rc=2)');
      kill();
      process.exit(2);
    }
    if (fails.length) {
      console.log(`★미달 ${fails.length}건`);
      for (const f of fails) console.log('  ' + f);
      rc = 1;
    } else {
      console.log('★미달 0건 — 어느 페이지·어느 언어에서도 자리표시자 글자가 그려지지 않았고 빈 자리도 남지 않았다');
    }
  } catch (e) {
    console.log('RUNNER-ERROR: ' + (e && e.message ? e.message : String(e)) + ' — 판정 불가');
    kill();
    process.exit(2);
  }
  kill();
  process.exit(rc);
}

main();
