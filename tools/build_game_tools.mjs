#!/usr/bin/env node
/* build_game_tools.mjs — 라이어 제시어 뽑기(/liar/words/)와 첫 낱말 평가기(/word/first/)를 ★게임 코드에서 만든다.
 *
 * 계약(한 문장): 두 도구가 쓰는 제시어·낱말 목록·채점은 게임이 실제로 쓰는 것과 ★같다.
 *   - 라이어: liar/index.html 의 TOPICS 를 평가해 한국어 낱말만 페이지에 끼운다.
 *   - 낱말: word/index.html 의 ANSWERS_RAW·GUESSES_RAW 로 first.json 을, 자모·채점 코드는 글자 그대로 페이지에 끼운다.
 *   - 표: 페이지의 AUTO 표시 사이를 이 도구가 쓴다. 손으로 고치지 말 것.
 *
 * 사용법
 *   node tools/build_game_tools.mjs .           (만들기)
 *   node tools/build_game_tools.mjs . --check   (게이트 — 다시 만든 결과가 저장본과 다르면 실패)
 * 종료코드: 0 = 일치 · 1 = 어긋남 · 2 = 게임 코드를 읽지 못해 판정 불가(★통과가 아니다).
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const check = process.argv.includes('--check');
const P = rel => path.join(root, rel);
const num = n => n.toLocaleString('en-US');

function between(src, from, to) {
  const a = src.indexOf(from);
  const b = a < 0 ? -1 : src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('구간을 찾지 못했다: ' + from);
  return src.slice(a, b);
}
function apply(page, open, close, body) {
  const a = page.indexOf(open), b = page.indexOf(close);
  if (a < 0 || b < a) throw new Error('표시를 찾지 못했다: ' + open);
  return page.slice(0, a + open.length) + '\n' + body + '\n' + page.slice(b);
}
const html = (page, name, body) => apply(page, `<!--AUTO:${name}-->`, `<!--/AUTO:${name}-->`, body);
const code = (page, name, body) => apply(page, `/*AUTO:${name}*/`, `/*/AUTO:${name}*/`, body);

/* ── 라이어 ── */
function buildLiar() {
  const src = fs.readFileSync(P('liar/index.html'), 'utf8');
  const a = src.indexOf('var TOPICS = [');
  const b = src.indexOf('\n];', a);
  if (a < 0 || b < 0) throw new Error('TOPICS 를 찾지 못했다');
  const TOPICS = new Function(src.slice(a, b + 3) + '\nreturn TOPICS;')();
  const data = TOPICS.map(t => ({ id: t.id, ko: t.ko, words: t.words.map(p => p[0]) }));
  const total = data.reduce((s, t) => s + t.words.length, 0);
  const stats = `<ul class="facts">
<li><b>${num(data.length)}</b><span>주제</span></li>
<li><b>${num(total)}</b><span>제시어</span></li>
</ul>`;
  const rows = data.map(t => `<tr><td class="end">${t.ko}</td><td>${t.words.length}</td><td class="ex">${t.words.slice(0, 6).join(' · ')}</td></tr>`).join('\n');
  const table = `<table>
<thead><tr><th>주제</th><th>제시어</th><th>예</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
  const outputs = {};
  let page = fs.readFileSync(P('liar/words/index.html'), 'utf8');
  const before = page;
  page = html(page, 'stats', stats);
  page = html(page, 'topics', table);
  page = code(page, 'data', 'var TOPICS = ' + JSON.stringify(data) + ';');
  outputs['liar/words/index.html'] = { before, after: page };
  console.log('라이어: 주제 ' + data.length + ' · 제시어 ' + total);
  return outputs;
}

/* ── 오늘의 낱말 ── */
function buildWord() {
  const src = fs.readFileSync(P('word/index.html'), 'utf8');
  const jamoSrc = between(src, 'const CHO = [', '/* ======================= 두벌식 조합기').trimEnd();
  const scoreSrc = between(src, 'function score(guessSlots, answerSlots){', '/* ======================= 단어 자료').trimEnd();
  const rawSrc = between(src, 'const ANSWERS_RAW = ', 'const ANSWERS = [];').trimEnd();
  const ev = new Function(jamoSrc + '\n' + scoreSrc + '\n' + rawSrc + '\nreturn {toSlots, score, ANSWERS_RAW, GUESSES_RAW};')();
  const cut = s => { const o = []; for (let i = 0; i + 1 < s.length; i += 2) o.push(s.substr(i, 2)); return o; };
  const answers = cut(ev.ANSWERS_RAW);
  const guesses = [...new Set(cut(ev.GUESSES_RAW))];
  const ansSlots = answers.map(ev.toSlots);
  const evaluate = word => {
    const g = ev.toSlots(word), buckets = new Map();
    for (const a of ansSlots) {
      const k = ev.score(g, a).join();
      buckets.set(k, (buckets.get(k) || 0) + 1);
    }
    let sq = 0;
    for (const v of buckets.values()) sq += v * v;
    return { w: word, sq, combos: buckets.size };
  };
  const res = guesses.map(evaluate).sort((x, y) => x.sq - y.sq || (x.w < y.w ? -1 : 1));
  const avg = x => (x.sq / answers.length).toFixed(1);
  const json = JSON.stringify({ answers: ev.ANSWERS_RAW, ranked: res.map(x => x.w).join('') }) + '\n';
  const mid = res[Math.floor(res.length / 2)], last = res[res.length - 1];
  const stats = `<ul class="facts">
<li><b>${num(answers.length)}</b><span>정답 낱말</span></li>
<li><b>${num(res.length)}</b><span>넣을 수 있는 낱말</span></li>
<li><b>${avg(res[0])}개</b><span>가장 좋은 첫 낱말 뒤 남는 후보</span></li>
<li><b>${avg(mid)}개</b><span>한가운데 순위 낱말 뒤 남는 후보</span></li>
</ul>`;
  const row = (x, i) => `<tr><td>${num(i + 1)}</td><td class="end">${x.w}</td><td>${avg(x)}</td><td>${x.combos}</td></tr>`;
  const head = '<thead><tr><th>순위</th><th>낱말</th><th>남는 후보</th><th>색 조합</th></tr></thead>';
  const top = `<table>
${head}
<tbody>
${res.slice(0, 30).map(row).join('\n')}
</tbody>
</table>`;
  const worst = `<table>
${head}
<tbody>
${res.slice(-10).map((x, i) => row(x, res.length - 10 + i)).join('\n')}
</tbody>
</table>`;
  let page = fs.readFileSync(P('word/first/index.html'), 'utf8');
  const before = page;
  page = html(page, 'stats', stats);
  page = html(page, 'top', top);
  page = html(page, 'worst', worst);
  page = code(page, 'rule', jamoSrc + '\n' + scoreSrc);
  console.log('낱말: 정답 ' + answers.length + ' · 입력 ' + res.length + ' · 1위 ' + res[0].w + ' ' + avg(res[0]) + '(' + res[0].combos +
    ') · 가운데 ' + mid.w + ' ' + avg(mid) + ' · 꼴찌 ' + last.w + ' ' + avg(last));
  return {
    'word/first/index.html': { before, after: page },
    'word/first/first.json': { before: fs.existsSync(P('word/first/first.json')) ? fs.readFileSync(P('word/first/first.json'), 'utf8') : null, after: json },
  };
}

function main() {
  let outputs;
  try { outputs = { ...buildLiar(), ...buildWord() }; }
  catch (e) { console.error('판정 불가: ' + e.message); process.exitCode = 2; return; }
  const stale = Object.keys(outputs).filter(k => outputs[k].before !== outputs[k].after);
  if (check) {
    if (stale.length) {
      console.error('어긋남: ' + stale.join(', ') + ' — node tools/build_game_tools.mjs . 로 다시 만들 것');
      process.exitCode = 1;
      return;
    }
    console.log('통과: 두 도구의 목록·채점·표가 게임 코드와 같다');
    return;
  }
  for (const k of stale) fs.writeFileSync(P(k), outputs[k].after);
  console.log('만들었다: ' + (stale.join(', ') || '바뀐 것 없음'));
}

main();
