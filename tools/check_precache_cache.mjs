/* 프리캐시-캐시버전 게이트 — 2026-09-02 · T0902-precache-cache-gate
 *
 * 왜 만들었나 — 오늘 하루에 두 번 사람이 마지막 방벽이었다
 *   ① 16번째 게임 stop 출고 때 대문 index.html 이 바뀌었고, CACHE v35→v36 은 사람이 따로 알아채 올렸다.
 *   ② /about/ 를 고친 커밋 `8d65c60` 에서 **기존 게이트 23종이 전부 rc=0 인데 CACHE 는 v36 그대로**였다.
 *      /about/ 은 sw.js 의 PRECACHE 항목이라, 그대로 냈으면 **v36 캐시를 가진 재방문자는 낡은 소개를
 *      계속 봤다.** 출고 직전 사람이 손으로 잡아 v37 로 올렸다(`be23d74`).
 *   sw.js 는 스스로 "파일을 추가/변경하면 CACHE 문자열을 올려라" 고 주석에 적어 두었다.
 *   규약은 있었고 그것을 지키는 장치가 없었다 — 이 도구가 그 장치다.
 *
 * 무엇을 재는가 (계약 한 줄)
 *   **base..head 가 PRECACHE 에 실린 자원을 바꿨다면, 같은 구간에서 CACHE 문자열도 바뀌어 있어야 한다.**
 *
 * ★설계 원칙 1 — 비교 기준은 git 이다
 *   파일 내용을 추측하지 않는다. `git diff --name-only base..head` 로 바뀐 파일을 얻고,
 *   PRECACHE 는 **head 시점의 sw.js** 에서 읽는다(지금 나가는 계약이 그것이므로).
 *
 * ★설계 원칙 2 — 디렉터리 형태로 매핑한다 (이 도구의 핵심)
 *   PRECACHE 는 '/about/' 처럼 **디렉터리 형태만** 담는다. 파일 형태를 넣으면 Cloudflare Pages 가
 *   308 을 돌려주어 addAll 이 통째로 reject 되기 때문이다(sw.js 주석 · 2026-08-26 실측).
 *   그래서 `about/index.html` 변경은 **'/about/' 항목의 변경으로 매핑되어야 한다.**
 *   여기서 틀리면 오늘의 결함(8d65c60)을 그대로 놓친다.
 *
 * ★설계 원칙 3 — 못 읽은 것은 통과로 세지 않는다
 *   PRECACHE 배열이나 CACHE 문자열을 못 뽑으면 '위반 0' 이 아니라 **판정 불가(rc=2)** 다.
 *   git 호출이 실패해도 마찬가지다. (`tools/check_home_sync.mjs` · `tools/check_functions.mjs` 와 같은 계약)
 *
 * 규칙
 *   [precache-cache-bump]  PRECACHE 대상이 바뀌었으면 CACHE 문자열도 바뀌어 있다
 *                          (지적문은 어떤 파일이 어떤 PRECACHE 항목에 걸렸는지 이름을 댄다)
 *
 * ★이 도구가 못 보는 것(정직한 한계)
 *   · **실브라우저에서 구버전 캐시가 실제로 지워지는지는 못 본다.** 이 도구가 재는 것은
 *     '버전 문자열이 올랐는가' 뿐이고, 재방문자의 캐시가 갈아 끼워지는 것은 실브라우저로만 확인된다.
 *   · CACHE 가 **의미 있게** 올랐는지는 안 본다. 값이 달라지기만 하면 통과다(v37→v36 도 통과다).
 *   · PRECACHE 에 없는 자원(예: /nonogram/thumb 이 아닌 내부 스크립트)은 애초에 이 계약 밖이다.
 *   · 커밋 하나가 아니라 base..head **구간**을 잰다. 구간 안에서 올렸다 내렸다 하면 양끝만 본다.
 *
 * 사용법:
 *   node tools/check_precache_cache.mjs [저장소 경로] [--base <ref>] [--head <ref>]
 *        기본값 base=HEAD^ · head=HEAD
 *   node tools/check_precache_cache.mjs [저장소 경로] --mutate <이름>   (검출력 확인 · 아래 MUTATIONS)
 *   node tools/check_precache_cache.mjs [저장소 경로] --selftest        (뮤테이션 전량 자동 확인)
 *
 * 종료코드: 0 미달 0 · 1 미달 발견 · 2 판정 불가(또는 뮤테이션 주입 실패)
 *           ★--mutate 일 때는 형제 도구와 다르다 — 뮤테이션마다 기대 rc 가 다르기 때문이다(오탐 0 을
 *           증명하는 뮤테이션은 rc=0 이 정답이다). 0 기대대로 · 3 기대와 어긋남 · 2 주입 실패.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const has = n => argv.indexOf(n) >= 0;
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const MUTATE = argOf('--mutate', null);
const FLAGS_WITH_VALUE = ['--mutate', '--base', '--head'];
const positional = argv.filter((a, i) => !a.startsWith('--') && FLAGS_WITH_VALUE.indexOf(argv[i - 1]) < 0);
const ROOT = positional[0] || process.cwd();
const BASE = argOf('--base', 'HEAD^');
const HEAD = argOf('--head', 'HEAD');

/* ── 채점판 ──────────────────────────────────────────────────────────────── */
const failedRules = new Set();
const indetRules = new Set();
let failCount = 0, indetCount = 0, passCount = 0;
function bad(rule, msg){ failedRules.add(rule); failCount++; console.log('  ✗ [' + rule + '] ' + msg); }
function indet(rule, why){ indetRules.add(rule); indetCount++; console.log('  ‽ [' + rule + '] 판정 불가 — ' + why); }
function good(rule, msg){ passCount++; console.log('  ✓ [' + rule + '] ' + msg); }

/* ── git ─────────────────────────────────────────────────────────────────── */
function git(root, args){
  try { return { out: execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e){ return { err: 'git ' + args.join(' ') + ' 가 실패했다: ' + String(e.stderr || e.message).trim().split('\n')[0] }; }
}

/* ── 읽기 ────────────────────────────────────────────────────────────────── */
/* sw.js 는 **작업 트리가 아니라 지정한 커밋에서** 읽는다 — 옛 구간을 재려면 그때의 계약을 봐야 한다. */
function swAt(root, ref){
  const r = git(root, ['show', ref + ':sw.js']);
  if (r.err) return { err: ref + ' 의 sw.js 를 읽지 못했다(' + r.err + ')' };
  return { text: r.out };
}
function parseCache(text, ref){
  const m = /const CACHE\s*=\s*'([^']*)'/.exec(text) || /const CACHE\s*=\s*"([^"]*)"/.exec(text);
  if (!m) return { err: ref + ' 의 sw.js 에서 CACHE 문자열을 찾지 못했다' };
  return { value: m[1] };
}
/* PRECACHE 항목은 **하드코딩하지 않는다** — sw.js 에서만 읽는다. */
function parsePrecache(text, ref){
  const s = text.indexOf('const PRECACHE');
  if (s < 0) return { err: ref + ' 의 sw.js 에서 PRECACHE 선언을 찾지 못했다' };
  const open = text.indexOf('[', s);
  const close = text.indexOf('];', open);
  if (open < 0 || close < 0) return { err: ref + ' 의 sw.js 에서 PRECACHE 배열의 끝을 찾지 못했다' };
  const lit = text.slice(open, close + 1);
  const items = [...lit.matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] !== undefined ? x[1] : x[2]);
  if (!items.length) return { err: ref + ' 의 PRECACHE 배열이 비어 있다' };
  return { items };
}

/* ★핵심 — 바뀐 파일 하나가 어떤 PRECACHE 항목(URL)으로 나가는가.
   PRECACHE 가 디렉터리 형태만 담으므로 index.html 은 **그 디렉터리 주소로도** 대응시킨다.
   이 매핑이 없으면 about/index.html 변경이 '/about/' 에 걸리지 않아 오늘의 결함을 놓친다. */
function urlCandidates(repoRelPath){
  const p = repoRelPath.replace(/\\/g, '/');
  const out = ['/' + p];
  if (p === 'index.html' || p.endsWith('/index.html')){
    out.push('/' + p.slice(0, p.length - 'index.html'.length));   /* 'about/index.html' → '/about/' · 'index.html' → '/' */
  }
  return out;
}

/* ── 판정 ────────────────────────────────────────────────────────────────── */
function run(root, base, head){
  console.log('프리캐시-캐시버전 게이트 — 대상 ' + root + ' · 구간 ' + base + '..' + head);

  const swHead = swAt(root, head);
  if (swHead.err){ indet('precache-cache-bump', swHead.err); return 2; }
  const P = parsePrecache(swHead.text, head);
  if (P.err){ indet('precache-cache-bump', P.err); return 2; }
  const cHead = parseCache(swHead.text, head);
  if (cHead.err){ indet('precache-cache-bump', cHead.err); return 2; }

  const swBase = swAt(root, base);
  if (swBase.err){ indet('precache-cache-bump', swBase.err); return 2; }
  const cBase = parseCache(swBase.text, base);
  if (cBase.err){ indet('precache-cache-bump', cBase.err); return 2; }

  const d = git(root, ['diff', '--name-only', base + '..' + head]);
  if (d.err){ indet('precache-cache-bump', d.err); return 2; }
  const changed = d.out.split('\n').map(x => x.trim()).filter(Boolean);

  const precache = new Set(P.items);
  console.log('  · ' + head + ' 의 PRECACHE ' + P.items.length + '항목 · CACHE ' + cBase.value + ' → ' + cHead.value);
  console.log('  · 바뀐 파일 ' + changed.length + '개');

  const hits = [];
  for (const f of changed){
    for (const u of urlCandidates(f)){
      if (precache.has(u)){ hits.push({ file: f, url: u }); break; }
    }
  }

  if (!hits.length){
    good('precache-cache-bump', '이 구간은 PRECACHE 대상 자원을 바꾸지 않았다 — CACHE 를 올릴 의무가 없다(바뀐 파일 ' + changed.length + '개 중 0개가 프리캐시 대상)');
  } else if (cBase.value === cHead.value){
    bad('precache-cache-bump', 'PRECACHE 대상이 바뀌었는데 CACHE 가 그대로다(' + cHead.value + ') — 재방문자는 낡은 사본을 계속 본다. 걸린 것: '
      + hits.map(h => h.file + ' → PRECACHE 항목 ' + h.url).join(' · '));
  } else {
    good('precache-cache-bump', 'PRECACHE 대상 ' + hits.length + '건이 바뀌었고 CACHE 도 올랐다(' + cBase.value + ' → ' + cHead.value + '). 걸린 것: '
      + hits.map(h => h.file + ' → ' + h.url).join(' · '));
  }

  console.log('결과: 통과 ' + passCount + ' · 미달 ' + failCount + ' · 판정 불가 ' + indetCount);
  if (indetCount) return 2;
  return failCount ? 1 : 0;
}

/* ── 뮤테이션(검출력 확인) ───────────────────────────────────────────────── */
/* 임시 git 저장소를 만들어 '기준 커밋 → 변이 커밋' 두 개를 쌓고 그 구간을 잰다.
   ★기대값이 뮤테이션마다 다르다 — 오탐 0 을 증명하는 항목은 rc=0 이 정답이다. */
const MUTATIONS = {
  'touch-precache-no-bump': {
    why: '프리캐시 대상(about/index.html)을 바꾸고 CACHE 는 안 올린다 — 오늘 8d65c60 의 형태다',
    expect: { rc: 1, fail: ['precache-cache-bump'], indet: [] },
    apply(dir){
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      return commit(dir, 'about 만 고친다');
    }
  },
  'touch-precache-with-bump': {
    why: '프리캐시 대상을 바꾸고 CACHE 도 올린다 — 정상 출고의 모양(붉으면 안 된다)',
    expect: { rc: 0, fail: [], indet: [] },
    apply(dir){
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      if (!bumpCache(path.join(dir, 'sw.js'))) return false;
      return commit(dir, 'about 을 고치고 CACHE 도 올린다');
    }
  },
  'touch-nonprecache': {
    why: '프리캐시 대상이 아닌 파일만 바꾼다 — 오탐 0 확인(붉으면 안 된다)',
    expect: { rc: 0, fail: [], indet: [] },
    apply(dir){
      appendLine(path.join(dir, 'tools', 'README.md'), '변이');
      return commit(dir, '프리캐시와 무관한 파일만 고친다');
    }
  },
  'bump-only': {
    why: 'CACHE 만 올리고 프리캐시 대상은 안 바꾼다 — 무해하므로 붉으면 안 된다',
    expect: { rc: 0, fail: [], indet: [] },
    apply(dir){
      if (!bumpCache(path.join(dir, 'sw.js'))) return false;
      return commit(dir, 'CACHE 만 올린다');
    }
  },
  'unreadable-cache': {
    why: 'head 의 sw.js 에서 CACHE 문자열을 읽을 수 없게 만든다 — 통과가 아니라 판정 불가여야 한다(설계 원칙 3)',
    expect: { rc: 2, fail: [], indet: ['precache-cache-bump'] },
    apply(dir){
      const p = path.join(dir, 'sw.js');
      const s = fs.readFileSync(p, 'utf8');
      const next = s.replace(/const CACHE\s*=\s*'[^']*';/, 'const CACHE = makeCacheName();');
      if (next === s) return false;
      fs.writeFileSync(p, next, 'utf8');
      appendLine(path.join(dir, 'about', 'index.html'), '<!-- 변이 -->');
      return commit(dir, 'CACHE 를 읽을 수 없게 만든다');
    }
  }
};
function appendLine(p, line){
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + line + '\r\n', 'utf8');
}
function bumpCache(p){
  const s = fs.readFileSync(p, 'utf8');
  const m = /(const CACHE\s*=\s*')([^']*)(')/.exec(s);
  if (!m) return false;
  fs.writeFileSync(p, s.replace(m[0], m[1] + m[2] + '-bumped' + m[3]), 'utf8');
  return true;
}
function commit(dir, msg){
  const a = git(dir, ['add', '-A']);
  if (a.err) return false;
  const c = git(dir, ['commit', '-q', '-m', msg]);
  return !c.err;
}
/* 대조에 쓰는 파일만 임시 git 저장소로 옮긴다(원본 저장소는 절대 건드리지 않는다). */
function stageRepo(root){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precache-cache-'));
  fs.mkdirSync(path.join(dir, 'about'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(root, 'sw.js'), path.join(dir, 'sw.js'));
  fs.copyFileSync(path.join(root, 'about', 'index.html'), path.join(dir, 'about', 'index.html'));
  fs.writeFileSync(path.join(dir, 'tools', 'README.md'), '기준 시점\r\n', 'utf8');
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'gate@local'], ['config', 'user.name', 'gate'],
                      ['add', '-A'], ['commit', '-q', '-m', '기준']]){
    const r = git(dir, args);
    if (r.err) return null;
  }
  return dir;
}
function resetScore(){ failedRules.clear(); indetRules.clear(); failCount = indetCount = passCount = 0; }
function judge(m, rc){
  const seenFail = [...failedRules].sort(), seenIndet = [...indetRules].sort();
  const wantFail = m.expect.fail.slice().sort(), wantIndet = m.expect.indet.slice().sort();
  const ok = rc === m.expect.rc
    && seenFail.join(',') === wantFail.join(',')
    && seenIndet.join(',') === wantIndet.join(',');
  return { ok, rc, seenFail, seenIndet, wantFail, wantIndet };
}

/* ── 진입 ────────────────────────────────────────────────────────────────── */
if (has('--selftest')){
  console.log('자기시험 — 뮤테이션마다 기대한 rc 와 규칙이 그대로 나오는지 본다(어긋남 0 이 합격선)');
  let bads = 0, setupFail = 0;
  const rows = [];
  for (const [name, m] of Object.entries(MUTATIONS)){
    const dir = stageRepo(ROOT);
    if (dir === null){ setupFail++; rows.push({ name, ok: false, why: '임시 저장소를 만들지 못했다' }); continue; }
    let injected = false;
    try { injected = m.apply(dir); } catch (e){ injected = false; }
    if (!injected){ setupFail++; rows.push({ name, ok: false, why: '주입 실패(앵커 노후화)' }); fs.rmSync(dir, { recursive: true, force: true }); continue; }
    resetScore();
    const silent = console.log; console.log = () => {};
    let rc;
    try { rc = run(dir, 'HEAD^', 'HEAD'); } finally { console.log = silent; fs.rmSync(dir, { recursive: true, force: true }); }
    const v = judge(m, rc);
    if (!v.ok) bads++;
    rows.push({ name, why: m.why, ...v });
  }
  for (const r of rows){
    console.log('  ' + (r.ok ? 'PASS ' : '★FAIL') + ' ' + r.name.padEnd(24)
      + ' rc=' + String(r.rc) + '(기대 ' + (r.wantFail ? MUTATIONS[r.name].expect.rc : '-') + ')'
      + ' · 미달 ' + (r.seenFail && r.seenFail.length ? r.seenFail.join(',') : '없음')
      + '(기대 ' + (r.wantFail && r.wantFail.length ? r.wantFail.join(',') : '없음') + ')'
      + ' · 판정불가 ' + (r.seenIndet && r.seenIndet.length ? r.seenIndet.join(',') : '없음')
      + '(기대 ' + (r.wantIndet && r.wantIndet.length ? r.wantIndet.join(',') : '없음') + ')');
    if (r.why) console.log('        ← ' + r.why);
  }
  console.log('자기시험 결과: 항목 ' + rows.length + ' · 어긋남 ' + bads + ' · 주입 실패 ' + setupFail);
  process.exit((bads || setupFail) ? 1 : 0);
}

if (MUTATE){
  const m = MUTATIONS[MUTATE];
  if (!m){ console.error('그런 뮤테이션이 없다: ' + MUTATE); process.exit(2); }
  const dir = stageRepo(ROOT);
  if (dir === null){ console.error('임시 저장소를 만들지 못했다'); process.exit(2); }
  let injected = false;
  try { injected = m.apply(dir); } catch (e){ console.error('주입 중 오류: ' + e.message); injected = false; }
  if (!injected){ fs.rmSync(dir, { recursive: true, force: true }); console.error('주입 실패(앵커 노후화): ' + MUTATE); process.exit(2); }
  let rc;
  try { rc = run(dir, 'HEAD^', 'HEAD'); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const v = judge(m, rc);
  console.log('  검출력 판정: rc=' + rc + '(기대 ' + m.expect.rc + ')'
    + ' · 미달 [' + (v.seenFail.join(',') || '없음') + '](기대 [' + (v.wantFail.join(',') || '없음') + '])'
    + ' · 판정불가 [' + (v.seenIndet.join(',') || '없음') + '](기대 [' + (v.wantIndet.join(',') || '없음') + '])'
    + ' → ' + (v.ok ? '기대대로' : '★어긋남'));
  process.exit(v.ok ? 0 : 3);
}

process.exit(run(ROOT, BASE, HEAD));
