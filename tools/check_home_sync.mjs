/* 대문 동기 게이트 — 2026-09-02 · T0902-home-sync
 *
 * 왜 만들었나 — 게이트가 없어서 태어난 결함
 *   16번째 게임 「멈춰!」(stop)를 낼 때 stop 레인이 `index.html` 을 아예 건드리지 않았다. 그래서
 *   `games.json`(16) · `functions/_games.js`(16) 에는 stop 이 있는데 대문 `index.html` 의
 *   **noscript 카드 목록(15)** 과 **FALLBACK 배열(15)** 에는 없었다. index.html 은
 *   fetch('/games.json') 으로 카드를 그리므로 자바스크립트를 켠 사람에게는 보였고, 그래서
 *   아무 시험도 울지 않았다. 못 보는 쪽은 noscript 사용자 · 원본 HTML 을 읽는 크롤러 ·
 *   fetch 가 실패한(오프라인·file://) 사용자다.
 *
 *   index.html 은 스스로 "이 noscript 목록은 FALLBACK 배열 · 루트 games.json 과 내용이 같아야
 *   한다(3곳 동기)" 고 **주석으로 적어 두었다.** 규약은 있었고 그것을 지키는 장치가 없었다.
 *   기존 `tools/counter/test_pages.mjs` 의 대문 관련 단언은 '목록의 게임에 모두 페이지가 있다'
 *   **한 방향**뿐이라(games.json → 파일 존재) 이 축을 볼 수 없었다. 이 도구는 기존 검사의
 *   보강이 아니라 **없던 축**이다.
 *
 * ★설계 원칙 1 — 양방향으로 센다
 *   `games.json` → 대문 한 방향만 보면 게임을 **뺐을 때** 대문에 남은 유령 항목을 못 잡는다.
 *   그래서 자리마다 두 방향을 모두 센다: 정본에 있는데 없다 / 대문에 있는데 정본에 없다.
 *
 * ★설계 원칙 2 — 자리마다 따로 세고, 지목 검사명을 나눈다
 *   noscript 와 FALLBACK 을 합쳐 세면 **한쪽만 고쳐도 통과하는 구멍**이 생긴다. 네 자리를 각각
 *   독립으로 대조하고 규칙 id 를 따로 둔다 — 어느 자리가 어긋났는지 판정문이 말해야 한다.
 *
 * ★설계 원칙 3 — 못 읽은 자리는 통과로 세지 않는다
 *   noscript 블록이 안 보이거나 FALLBACK 리터럴을 못 읽으면 '위반 0' 이 아니라 **판정 불가**다.
 *   (`tools/check_functions.mjs` · `tools/check_privacy_storage.py` 와 같은 계약)
 *
 * 규칙 (지적마다 [규칙id] 가 붙는다 — 뮤테이션이 이 id 로 귀속을 대조한다)
 *   [noscript-ids]      대문 noscript 카드의 id 목록이 games.json 과 같다(양방향 · 순서까지)
 *   [fallback-ids]      대문 FALLBACK 배열의 id 목록이 games.json 과 같다(양방향 · 순서까지)
 *   [functions-ids]     functions/_games.js 의 GAMES 가 games.json 과 같다(양방향 · 순서까지)
 *   [noscript-content]  양쪽에 다 있는 id 의 카드 내용이 games.json 과 같다
 *                       (경로 · 썸네일 · 이미지 크기 · 제목 ko/en · 설명 ko/en · 플레이타임 · 오늘의 도전 배지)
 *   [fallback-content]  양쪽에 다 있는 id 의 FALLBACK 항목이 games.json 항목과 **완전히 같다**(깊은 비교)
 *
 * ★이 도구가 못 보는 것(정직한 한계)
 *   · 자바스크립트가 실제로 무엇을 그리는지는 보지 않는다. 이 도구는 **원본 HTML 의 마크업**과
 *     JSON·JS 데이터를 대조할 뿐이고, 실행 후 DOM 은 실브라우저로만 확인된다.
 *   · noscript 카드의 `alt` 문구는 games.json 에서 파생되지 않으므로(2048 의 alt 는 제목과 다르다)
 *     대조하지 않는다.
 *   · 이미지 크기는 games.json 에 없다. 그래서 정본과 대조하는 대신 **카드끼리 같은 값인지**만
 *     본다(상수를 이 파일에 박지 않기 위해서다).
 *   · FALLBACK 리터럴은 텍스트로 잘라 내어 값으로 평가한다. 그 자리에 데이터가 아닌 코드가
 *     들어오면 이 도구는 그것을 실행하게 된다 — 데이터 리터럴로 유지하라.
 *
 * 사용법:
 *   node tools/check_home_sync.mjs [저장소 경로]
 *   node tools/check_home_sync.mjs [저장소 경로] --mutate <이름>   (검출력 확인 · 아래 MUTATIONS)
 *   node tools/check_home_sync.mjs [저장소 경로] --selftest        (뮤테이션 전량 자동 확인)
 *
 * 종료코드: 0 미달 0 · 1 미달 발견 · 2 판정 불가(또는 뮤테이션 주입 실패)
 *           --mutate 일 때: 1 지정 규칙이 잡았다 · 3 귀속이 어긋났다 · 2 주입 실패
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const has = n => argv.indexOf(n) >= 0;
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const MUTATE = argOf('--mutate', null);
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--mutate');
const ROOT = positional[0] || process.cwd();

/* ── 채점판 ──────────────────────────────────────────────────────────────── */
const failedRules = new Set();
const indetRules = new Set();
let failCount = 0, indetCount = 0, passCount = 0;
function bad(rule, msg){ failedRules.add(rule); failCount++; console.log('  ✗ [' + rule + '] ' + msg); }
function indet(rule, why){ indetRules.add(rule); indetCount++; console.log('  ‽ [' + rule + '] 판정 불가 — ' + why); }
function good(rule, msg){ passCount++; console.log('  ✓ [' + rule + '] ' + msg); }

/* ── 읽기 ────────────────────────────────────────────────────────────────── */
function readText(root, rel){
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); }
  catch { return null; }
}
function readGames(root){
  const raw = readText(root, 'games.json');
  if (raw === null) return { err: 'games.json 을 읽지 못했다' };
  let v;
  try { v = JSON.parse(raw); } catch (e){ return { err: 'games.json 이 JSON 이 아니다: ' + e.message }; }
  if (!Array.isArray(v) || !v.length) return { err: 'games.json 이 비어 있거나 배열이 아니다' };
  if (v.some(g => typeof g.id !== 'string')) return { err: 'games.json 항목에 id 가 없다' };
  return { list: v };
}
function readNoscript(html){
  if (html === null) return { err: 'index.html 을 읽지 못했다' };
  const i = html.indexOf('<noscript>');
  const j = html.indexOf('</noscript>', i);
  if (i < 0 || j < 0) return { err: 'index.html 에서 noscript 블록을 찾지 못했다' };
  const block = html.slice(i, j);
  const cards = [...block.matchAll(/<li><a class="card" href="([^"]+)">([\s\S]*?)<\/a><\/li>/g)];
  if (!cards.length) return { err: 'noscript 블록 안에서 카드를 하나도 읽지 못했다' };
  const out = cards.map(m => {
    const href = m[1], body = m[2];
    const img = /<img src="([^"]+)" alt="([^"]*)" width="(\d+)" height="(\d+)"/.exec(body);
    const h2 = /<h2>([\s\S]*?)<\/h2>/.exec(body);
    const p = /<p>([\s\S]*?)<\/p>/.exec(body);
    const badges = [...body.matchAll(/<span class="badge(?: daily)?">([\s\S]*?)<\/span>/g)].map(b => b[1]);
    return {
      id: href.replace(/^\//, '').replace(/\/$/, ''),
      href, thumb: img && img[1], width: img && img[3], height: img && img[4],
      h2: h2 && h2[1], desc: p && p[1], badges
    };
  });
  return { list: out };
}
/* FALLBACK 리터럴이 차지하는 구간을 돌려준다(읽기와 뮤테이션이 같은 자리를 보게 하려고 함께 쓴다).
   ★끝을 '}];' 라는 붙어 있는 세 글자로 찾으면, 사이에 줄바꿈·공백이 하나만 들어와도 못 찾고
   '판정 불가' 가 되어 버린다 — 실제로 뮤테이션이 배열을 예쁘게 다시 쓰자 그 일이 났다.
   그래서 공백을 허용하는 모양으로 끝을 찾는다. */
function fallbackSpan(html){
  const head = 'const FALLBACK = ';
  const s = html.indexOf(head);
  if (s < 0) return null;
  const re = /\}\s*\]\s*;/g;
  re.lastIndex = s;
  const m = re.exec(html);
  if (!m) return null;
  return { head, from: s + head.length, to: m.index + m[0].length - 1 };   /* 끝의 ; 는 뺀다 */
}
function readFallback(html){
  if (html === null) return { err: 'index.html 을 읽지 못했다' };
  const span = fallbackSpan(html);
  if (span === null) return { err: 'index.html 에서 FALLBACK 선언 또는 그 끝을 찾지 못했다' };
  const lit = html.slice(span.from, span.to);
  let v;
  try { v = Function('return ' + lit)(); }
  catch (err){ return { err: 'FALLBACK 리터럴을 값으로 읽지 못했다: ' + err.message }; }
  if (!Array.isArray(v) || !v.length) return { err: 'FALLBACK 이 비어 있거나 배열이 아니다' };
  return { list: v };
}
function readFunctions(root){
  const raw = readText(root, path.join('functions', '_games.js'));
  if (raw === null) return { err: 'functions/_games.js 를 읽지 못했다' };
  const m = /export const GAMES\s*=\s*\[([\s\S]*?)\]\s*;/.exec(raw);
  if (!m) return { err: 'functions/_games.js 에서 GAMES 배열을 찾지 못했다' };
  const ids = [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] !== undefined ? x[1] : x[2]);
  if (!ids.length) return { err: 'GAMES 배열이 비어 있다' };
  return { list: ids };
}

/* ── 대조 ────────────────────────────────────────────────────────────────── */
/* ★양방향으로 센다 — 한 방향만 보면 '뺐는데 대문에 남은 유령' 을 못 잡는다. */
function compareIds(rule, where, want, got){
  const missing = want.filter(x => got.indexOf(x) < 0);          /* 정본에 있는데 이 자리에 없다 */
  const extra = got.filter(x => want.indexOf(x) < 0);            /* 이 자리에 있는데 정본에 없다 */
  let orderAt = -1;
  if (!missing.length && !extra.length){
    for (let i = 0; i < want.length; i++) if (want[i] !== got[i]){ orderAt = i; break; }
  }
  if (missing.length || extra.length || orderAt >= 0){
    const parts = [];
    if (missing.length) parts.push('games.json 에 있는데 ' + where + ' 에 없다: ' + missing.join(', '));
    if (extra.length) parts.push(where + ' 에 있는데 games.json 에 없다: ' + extra.join(', '));
    if (orderAt >= 0) parts.push('순서가 다르다 — ' + orderAt + '번째가 games.json 은 ' + want[orderAt] + ' 인데 ' + where + ' 은 ' + got[orderAt]);
    bad(rule, where + ' 목록이 games.json 과 다르다(' + want.length + ' 대 ' + got.length + '). ' + parts.join(' · '));
    return false;
  }
  good(rule, where + ' 목록이 games.json 과 같다 — ' + want.length + '개 · 순서까지 일치');
  return true;
}
const norm = o => JSON.stringify(o, Object.keys(o).sort());

function run(root){
  console.log('대문 동기 게이트 — 대상 ' + root);
  const html = readText(root, 'index.html');
  const G = readGames(root), N = readNoscript(html), F = readFallback(html), U = readFunctions(root);

  /* 정본을 못 읽으면 아무 자리도 판정할 수 없다 — 통과로 접지 않고 전부 판정 불가로 올린다. */
  if (G.err){
    for (const r of ['noscript-ids', 'fallback-ids', 'functions-ids', 'noscript-content', 'fallback-content']) indet(r, G.err);
    return 2;
  }
  const wantIds = G.list.map(g => g.id);
  const byId = new Map(G.list.map(g => [g.id, g]));
  console.log('  · games.json ' + wantIds.length + '개(정본)');

  if (N.err) { indet('noscript-ids', N.err); indet('noscript-content', N.err); }
  else {
    compareIds('noscript-ids', 'noscript 카드', wantIds, N.list.map(c => c.id));
    /* 내용 대조는 **양쪽에 다 있는 id** 만 본다 — 없는 것은 위 목록 규칙이 이미 말했다.
       여기서 또 울면 한 결함이 두 규칙을 붉혀 귀속이 흐려진다. */
    const sizes = new Set(N.list.map(c => c.width + 'x' + c.height));
    const problems = [];
    for (const c of N.list){
      const g = byId.get(c.id);
      if (!g) continue;
      const t = g.title.ko + ' / ' + g.title.en;
      const d = g.desc.ko + '<br>' + g.desc.en;
      const pt = g.playtime.ko + ' / ' + g.playtime.en;
      if (c.href !== g.path) problems.push(c.id + ' 경로 ' + c.href + ' ≠ ' + g.path);
      if (c.thumb !== g.thumb) problems.push(c.id + ' 썸네일 ' + c.thumb + ' ≠ ' + g.thumb);
      if (c.h2 !== t) problems.push(c.id + ' 제목 ' + JSON.stringify(c.h2) + ' ≠ ' + JSON.stringify(t));
      if (c.desc !== d) problems.push(c.id + ' 설명이 games.json 과 다르다');
      if (c.badges[0] !== pt) problems.push(c.id + ' 플레이타임 ' + JSON.stringify(c.badges[0]) + ' ≠ ' + JSON.stringify(pt));
      const hasDaily = c.badges.some(b => b.indexOf('Daily challenge') >= 0);
      if (hasDaily !== !!g.daily) problems.push(c.id + ' 오늘의 도전 배지 ' + hasDaily + ' ≠ games.json ' + !!g.daily);
    }
    if (sizes.size !== 1) problems.push('카드 이미지 크기가 제각각이다: ' + [...sizes].join(', '));
    if (problems.length) bad('noscript-content', 'noscript 카드 내용이 games.json 과 다르다 — ' + problems.join(' · '));
    else good('noscript-content', 'noscript 카드 ' + N.list.length + '개의 경로·썸네일·크기(' + [...sizes][0] + ')·제목·설명·배지가 games.json 과 같다');
  }

  if (F.err) { indet('fallback-ids', F.err); indet('fallback-content', F.err); }
  else {
    compareIds('fallback-ids', 'FALLBACK 배열', wantIds, F.list.map(x => x.id));
    const problems = [];
    for (const f of F.list){
      const g = byId.get(f.id);
      if (!g) continue;
      if (norm(f) !== norm(g)) problems.push(f.id + ' 항목이 games.json 과 다르다');
    }
    if (problems.length) bad('fallback-content', 'FALLBACK 항목이 games.json 과 다르다 — ' + problems.join(' · '));
    else good('fallback-content', 'FALLBACK ' + F.list.length + '개 항목이 games.json 과 완전히 같다(깊은 비교)');
  }

  if (U.err) indet('functions-ids', U.err);
  else compareIds('functions-ids', 'functions/_games.js GAMES', wantIds, U.list);

  console.log('결과: 통과 ' + passCount + ' · 미달 ' + failCount + ' · 판정 불가 ' + indetCount);
  if (indetCount) return 2;
  return failCount ? 1 : 0;
}

/* ── 뮤테이션(검출력 확인) ───────────────────────────────────────────────── */
/* ★한 자리만 건드린 변이는 **그 자리를 지목하는 규칙**으로만 붉어져야 한다.
   다른 규칙이 대신 붉으면 무임승차다. games.json 은 정본이므로 거기서 빼면 세 자리가 함께 붉는다. */
const MUTATIONS = {
  'drop-json': {
    why: 'games.json 에서 마지막 항목을 뺀다(정본이 줄면 세 자리가 함께 어긋난다)',
    rules: ['noscript-ids', 'fallback-ids', 'functions-ids'],
    apply(stage){
      const p = path.join(stage, 'games.json');
      const v = JSON.parse(fs.readFileSync(p, 'utf8'));
      v.pop();
      fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');
      return true;
    }
  },
  'drop-noscript': {
    why: 'noscript 에서만 마지막 카드를 뺀다',
    rules: ['noscript-ids'],
    apply(stage){
      const p = path.join(stage, 'index.html');
      const s = fs.readFileSync(p, 'utf8');
      const i = s.indexOf('<noscript>'), j = s.indexOf('</noscript>', i);
      if (i < 0 || j < 0) return false;
      const block = s.slice(i, j);
      const cards = [...block.matchAll(/<li><a class="card"[\s\S]*?<\/a><\/li>/g)];
      if (!cards.length) return false;
      const last = cards[cards.length - 1][0];
      fs.writeFileSync(p, s.slice(0, i) + block.replace(last, '') + s.slice(j), 'utf8');
      return true;
    }
  },
  'drop-fallback': {
    why: 'FALLBACK 에서만 마지막 항목을 뺀다',
    rules: ['fallback-ids'],
    apply(stage){
      const p = path.join(stage, 'index.html');
      const s = fs.readFileSync(p, 'utf8');
      const span = fallbackSpan(s);
      if (span === null) return false;
      const v = Function('return ' + s.slice(span.from, span.to))();
      v.pop();
      return writeBack(p, s, span.from, span.to, JSON.stringify(v, null, 2));
    }
  },
  'drop-functions': {
    why: 'functions/_games.js GAMES 에서만 마지막 id 를 뺀다',
    rules: ['functions-ids'],
    apply(stage){
      const p = path.join(stage, 'functions', '_games.js');
      const s = fs.readFileSync(p, 'utf8');
      const m = /export const GAMES\s*=\s*\[([\s\S]*?)\]\s*;/.exec(s);
      if (!m) return false;
      const ids = [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] !== undefined ? x[1] : x[2]);
      ids.pop();
      const next = 'export const GAMES = [' + ids.map(x => "'" + x + "'").join(', ') + '];';
      fs.writeFileSync(p, s.slice(0, m.index) + next + s.slice(m.index + m[0].length), 'utf8');
      return true;
    }
  },
  'swap-noscript': {
    why: 'noscript 에서 마지막 두 카드의 순서만 뒤바꾼다(집합은 같고 순서만 다르다)',
    rules: ['noscript-ids'],
    apply(stage){
      const p = path.join(stage, 'index.html');
      const s = fs.readFileSync(p, 'utf8');
      const i = s.indexOf('<noscript>'), j = s.indexOf('</noscript>', i);
      if (i < 0 || j < 0) return false;
      const block = s.slice(i, j);
      const cards = [...block.matchAll(/<li><a class="card"[\s\S]*?<\/a><\/li>/g)];
      if (cards.length < 2) return false;
      const a = cards[cards.length - 2][0], b = cards[cards.length - 1][0];
      const swapped = block.replace(a, '@@A@@').replace(b, a).replace('@@A@@', b);
      fs.writeFileSync(p, s.slice(0, i) + swapped + s.slice(j), 'utf8');
      return true;
    }
  },
  'title-noscript': {
    why: 'noscript 마지막 카드의 제목만 다르게 한다(집합·순서는 그대로)',
    rules: ['noscript-content'],
    apply(stage){
      const p = path.join(stage, 'index.html');
      const s = fs.readFileSync(p, 'utf8');
      const i = s.indexOf('<noscript>'), j = s.indexOf('</noscript>', i);
      if (i < 0 || j < 0) return false;
      const block = s.slice(i, j);
      const cards = [...block.matchAll(/<li><a class="card"[\s\S]*?<\/a><\/li>/g)];
      if (!cards.length) return false;
      const last = cards[cards.length - 1][0];
      const changed = last.replace(/<h2>([\s\S]*?)<\/h2>/, '<h2>$1 (틀린 제목)</h2>');
      if (changed === last) return false;
      fs.writeFileSync(p, s.slice(0, i) + block.replace(last, changed) + s.slice(j), 'utf8');
      return true;
    }
  }
};
function writeBack(p, s, from, to, text){
  fs.writeFileSync(p, s.slice(0, from) + text + s.slice(to), 'utf8');
  return true;
}
/* 대조에 쓰는 세 파일만 임시 폴더로 복사한다(원본은 절대 건드리지 않는다). */
function stage(root){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-sync-'));
  fs.mkdirSync(path.join(dir, 'functions'), { recursive: true });
  for (const rel of ['games.json', 'index.html', path.join('functions', '_games.js')]){
    fs.copyFileSync(path.join(root, rel), path.join(dir, rel));
  }
  return dir;
}
function resetScore(){ failedRules.clear(); indetRules.clear(); failCount = indetCount = passCount = 0; }

/* ── 진입 ────────────────────────────────────────────────────────────────── */
if (has('--selftest')){
  console.log('자기시험 — 뮤테이션마다 지목 규칙만 붉는지 본다(무임승차 0 이 합격선)');
  let bads = 0, setupFail = 0;
  const rows = [];
  for (const [name, m] of Object.entries(MUTATIONS)){
    const dir = stage(ROOT);
    let injected = false;
    try { injected = m.apply(dir); } catch (e){ injected = false; }
    if (!injected){ setupFail++; rows.push({ name, ok: false, why: '주입 실패(앵커 노후화)' }); fs.rmSync(dir, { recursive: true, force: true }); continue; }
    resetScore();
    const silent = console.log; console.log = () => {};
    let rc;
    try { rc = run(dir); } finally { console.log = silent; fs.rmSync(dir, { recursive: true, force: true }); }
    const seen = [...failedRules].sort();
    const want = m.rules.slice().sort();
    const miss = want.filter(r => seen.indexOf(r) < 0);
    const noise = seen.filter(r => want.indexOf(r) < 0);
    const ok = rc === 1 && !miss.length && !noise.length;
    if (!ok) bads++;
    rows.push({ name, ok, rc, want, seen, miss, noise, why: m.why });
  }
  for (const r of rows){
    console.log('  ' + (r.ok ? 'PASS ' : '★FAIL') + ' ' + r.name.padEnd(16)
      + ' rc=' + String(r.rc)
      + ' · 잡아야 할 규칙 ' + (r.want ? r.want.join(',') : '-')
      + ' · 실제 ' + (r.seen && r.seen.length ? r.seen.join(',') : '없음')
      + (r.miss && r.miss.length ? '  ← 안 잡힌 규칙 ' + r.miss.join(',') : '')
      + (r.noise && r.noise.length ? '  ← 무임승차(나오면 안 되는 지적) ' + r.noise.join(',') : ''));
    if (r.why) console.log('        ← ' + r.why);
  }
  console.log('자기시험 결과: 항목 ' + rows.length + ' · 어긋남 ' + bads + ' · 주입 실패 ' + setupFail);
  process.exit((bads || setupFail) ? 1 : 0);
}

if (MUTATE){
  const m = MUTATIONS[MUTATE];
  if (!m){ console.error('그런 뮤테이션이 없다: ' + MUTATE); process.exit(2); }
  const dir = stage(ROOT);
  let injected = false;
  try { injected = m.apply(dir); } catch (e){ console.error('주입 중 오류: ' + e.message); injected = false; }
  if (!injected){ fs.rmSync(dir, { recursive: true, force: true }); console.error('주입 실패(앵커 노후화): ' + MUTATE); process.exit(2); }
  let rc;
  try { rc = run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const seen = [...failedRules].sort();
  const want = m.rules.slice().sort();
  const miss = want.filter(r => seen.indexOf(r) < 0);
  const noise = seen.filter(r => want.indexOf(r) < 0);
  console.log('  검출력 판정: 지정 규칙 [' + want.join(',') + '] · 실제 미달 규칙 [' + (seen.join(',') || '없음') + ']'
    + (miss.length ? ' ← 안 잡힘 ' + miss.join(',') : '')
    + (noise.length ? ' ← 무임승차 ' + noise.join(',') : ''));
  process.exit((rc === 1 && !miss.length && !noise.length) ? 1 : 3);
}

process.exit(run(ROOT));
