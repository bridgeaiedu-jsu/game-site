/* 공개 카운터 — 페이지 검사기(test_pages.mjs)의 **검출력** 자기시험
 *
 * 왜 필요한가 — 검사기를 고쳐 FAIL 을 없앨 때, 진짜로 고친 것인지 규칙을 느슨하게 풀어
 * 눈감게 한 것인지는 통과 화면만 봐서는 구별되지 않는다. 그래서 **일부러 고장 낸 사본**을
 * 만들어 돌리고, 그 고장을 **어느 규칙이 잡아야 하는지 이름으로 못박아** 대조한다.
 * (뮤테이션이 다른 규칙을 우연히 깨뜨려 exit 1 이 나는 '무임승차'를 막는다.)
 *
 * 하는 일
 *   ① 검사기가 읽는 파일만 임시 폴더로 복사한다(제품 트리는 읽기만 한다 — 절대 건드리지 않는다).
 *   ② 뮤테이션 하나를 주입한다.
 *   ③ 그 사본을 대상으로 test_pages.mjs 를 돌려 FAIL 로 떨어진 규칙 이름을 모은다.
 *   ④ '잡아야 할 규칙 집합' 과 **정확히 같은지** 본다 — 더 적어도(미탐지) 더 많아도(오탐) 어긋남이다.
 *
 * 사용법: node tools/counter/test_pages_negative.mjs [저장소 경로]
 * 종료코드: 0 = 전부 기대대로 · 1 = 검출력 어긋남 · 2 = 주입 실패(설정 오류 — 탐지 실패가 아니다)
 *   ★2 를 1 과 나눠 두는 이유: 주입도 안 된 뮤테이션이 '탐지됨' 으로 집계되면 검출력 표가 거짓이 된다.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2] || path.join(HERE, '..', '..'));
const CHECKER = path.join(HERE, 'test_pages.mjs');

const GAMES = JSON.parse(fs.readFileSync(path.join(ROOT, 'games.json'), 'utf8')).map(g => g.id);
/* 검사기가 실제로 읽는 파일만 복사한다 — 썸네일·이미지까지 옮기면 느리기만 하고 얻는 것이 없다. */
const FILES = ['games.json', 'index.html', 'about/index.html', 'privacy/index.html',
               'js/hp-stats.js', 'sw.js', ...GAMES.map(g => g + '/index.html')];

function makeCopy(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-negcase-'));
  for (const f of FILES){
    const dst = path.join(dir, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), dst);
  }
  return dir;
}

/* 한 곳만, 정확히 한 번 바꾼다 — 앵커가 0회거나 2회 이상이면 주입 실패(exit 2)다.
   ★'유일성을 먼저 증명' 하지 않으면 엉뚱한 자리가 바뀌어 시험이 거짓말을 한다. */
function edit(dir, file, from, to){
  const p = path.join(dir, file);
  const s = fs.readFileSync(p, 'utf8');
  /* ★이 저장소의 파일은 CRLF 다 — 앵커의 줄바꿈을 파일 쪽 줄바꿈에 맞춘다.
     맞추지 않으면 멀쩡한 앵커가 0회로 잡혀 '탐지 실패' 가 아니라 '주입 실패' 로 떨어진다. */
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  from = from.replace(/\r?\n/g, eol);
  to = to.replace(/\r?\n/g, eol);
  const n = s.split(from).length - 1;
  if (n !== 1) return { ok: false, why: `앵커가 ${n}회 (1회여야 한다) — ${file}` };
  fs.writeFileSync(p, s.replace(from, to));
  return { ok: true };
}

const PAIR_RULE  = "hpHit('play') 가 시작 지점 1곳 전부에 짝지어 있다";
const COUNT_RULE = "hpHit('play') 호출이 시작 지점 수와 같다(떠도는 호출 0)";
const GUARD_RULE = 'hpHit 은 있는지 보고 부른다(없어도 게임이 안 깨진다)';
const KO_RULE    = '한국어 문안 (오늘 N판 · 누적 N판)';
const EN_RULE    = '영어 문안 (N today · N all-time)';
const POINT_RULE = '두 문안 모두 이 게임의 today·total 을 가리킨다';

/* 각 뮤테이션은 '무엇을 고장 냈는가' 와 '어느 규칙이 그것을 잡아야 하는가' 를 함께 적는다. */
const CASES = [
  {
    name: 'unpair-hphit',
    what: '판수 발화를 시작 지점에서 두 줄 떨어뜨린다(호출 수는 그대로 · 붙어 있지 않다)',
    catches: [PAIR_RULE],
    apply: d => edit(d, 'memory/index.html',
      "  if (window.hpHit) window.hpHit('play', GA_GAME);\n  saveProgress();",
      "  saveProgress();\n  prevTs = 0;\n  if (window.hpHit) window.hpHit('play', GA_GAME);")
  },
  {
    name: 'stray-hphit',
    what: '시작 지점과 무관한 자리에 판수 발화를 하나 더 넣는다(붙은 짝은 그대로 1)',
    catches: [COUNT_RULE],
    apply: d => edit(d, 'memory/index.html',
      "function toggleSound(){\n  soundOn = !soundOn;",
      "function toggleSound(){\n  if (window.hpHit) window.hpHit('play', GA_GAME);\n  soundOn = !soundOn;")
  },
  {
    name: 'ga-other-const',
    what: "게임 이름을 GA_GAME 이 아닌 다른 상수(GA_GAME2)로 보낸다",
    catches: [PAIR_RULE],
    apply: d => edit(d, 'memory/index.html',
      "ga('game_start', { game: GA_GAME, level });",
      "ga('game_start', { game: GA_GAME2, level });")
  },
  {
    name: 'unguarded-hphit',
    what: '있는지 보지 않고 바로 부른다(스크립트가 막히면 게임이 깨진다)',
    catches: [PAIR_RULE, GUARD_RULE],
    apply: d => edit(d, 'memory/index.html',
      "  if (window.hpHit) window.hpHit('play', GA_GAME);",
      "  window.hpHit('play', GA_GAME);")
  },
  {
    name: 'en-copy-reversed',
    what: "영어 문안을 소수파 꼴(Today <b>N</b> · total <b>N</b>)로 되돌린다",
    catches: [EN_RULE],
    apply: d => edit(d, 'memory/index.html',
      'statPlays:\'<b data-hp="plays.memory.today">–</b> today · <b data-hp="plays.memory.total">–</b> all-time\'',
      'statPlays:\'Today <b data-hp="plays.memory.today">–</b> · total <b data-hp="plays.memory.total">–</b>\'')
  },
  {
    name: 'en-copy-half',
    what: '영어 문안에서 누적(all-time) 쪽을 통째로 뺀다',
    catches: [POINT_RULE, EN_RULE],
    apply: d => edit(d, 'memory/index.html',
      'statPlays:\'<b data-hp="plays.memory.today">–</b> today · <b data-hp="plays.memory.total">–</b> all-time\'',
      'statPlays:\'<b data-hp="plays.memory.today">–</b> today\'')
  },
  {
    name: 'ko-copy-reversed',
    what: '한국어 문안의 낱말 차례를 뒤집는다(오늘 N판 → N판 오늘)',
    catches: [KO_RULE],
    apply: d => edit(d, 'memory/index.html',
      'statPlays:\'오늘 <b data-hp="plays.memory.today">–</b>판 · 누적 <b data-hp="plays.memory.total">–</b>판\'',
      'statPlays:\'<b data-hp="plays.memory.today">–</b>판 오늘 · <b data-hp="plays.memory.total">–</b>판 누적\'')
  },
  {
    name: 'en-copy-loose-order',
    what: '낱말은 다 있지만 숫자 두 개가 한데 붙어 있는 꼴 — 옛 부분문자열 규칙이라면 그대로 통과했다',
    catches: [EN_RULE],
    apply: d => edit(d, 'memory/index.html',
      'statPlays:\'<b data-hp="plays.memory.today">–</b> today · <b data-hp="plays.memory.total">–</b> all-time\'',
      'statPlays:\'<b data-hp="plays.memory.today">–</b><b data-hp="plays.memory.total">–</b> today · plays all-time\'')
  },
  {
    name: 'en-copy-other-game',
    what: '영어 문안이 다른 게임(word)의 숫자를 가리키게 한다',
    catches: [POINT_RULE, EN_RULE],
    apply: d => edit(d, 'memory/index.html',
      'statPlays:\'<b data-hp="plays.memory.today">–</b> today · <b data-hp="plays.memory.total">–</b> all-time\'',
      'statPlays:\'<b data-hp="plays.word.today">–</b> today · <b data-hp="plays.word.total">–</b> all-time\'')
  }
];

function runChecker(dir){
  const r = spawnSync(process.execPath, [CHECKER, dir], { encoding: 'utf8' });
  if (r.error) return { crash: String(r.error) };
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = [...out.matchAll(/^ {2}FAIL {2}(.+?)(?: — .*)?$/gm)].map(m => m[1].trim());
  return { rc: r.status, fails, out };
}

let bad = 0, setupFail = 0;
const rows = [];

/* ── 대조군: 손대지 않은 사본은 반드시 FAIL 0 이어야 한다 ────────────────────
   이것이 깨지면 아래 결과는 전부 의미가 없다(뮤테이션 때문인지 원래 그런지 모른다). */
{
  const dir = makeCopy();
  const r = runChecker(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  const okc = r.rc === 0 && r.fails.length === 0;
  if (!okc) bad++;
  console.log(`${okc ? 'PASS' : 'FAIL'}  [대조군] 손대지 않은 사본 — rc=${r.rc} · FAIL ${r.fails.length}건 ${r.fails.join(' | ')}`);
}

for (const c of CASES){
  const dir = makeCopy();
  const inj = c.apply(dir);
  if (!inj.ok){
    fs.rmSync(dir, { recursive: true, force: true });
    setupFail++;
    console.log(`SETUP-FAIL  ${c.name} — 주입 실패: ${inj.why}`);
    continue;
  }
  const r = runChecker(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  const got = [...new Set(r.fails)].sort();
  const want = [...new Set(c.catches)].sort();
  const same = JSON.stringify(got) === JSON.stringify(want) && r.rc === 1;
  if (!same) bad++;
  rows.push({ name: c.name, rc: r.rc, want, got, same });
  console.log(`${same ? 'PASS' : 'FAIL'}  ${c.name} — ${c.what}`);
  console.log(`        rc=${r.rc} · 잡아야 할 규칙 ${JSON.stringify(want)}`);
  console.log(`        실제로 잡은 규칙 ${JSON.stringify(got)}`);
}

console.log(`\n==== 검출력 자기시험: 사례 ${CASES.length}건 · 어긋남 ${bad}건 · 주입실패 ${setupFail}건 ====`);
if (setupFail) process.exit(2);
process.exit(bad ? 1 : 0);
