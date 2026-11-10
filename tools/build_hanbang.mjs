#!/usr/bin/env node
/* build_hanbang.mjs — 한방단어 검색기(/wordchain/hanbang/)의 데이터와 표를 ★게임 코드에서 뽑아 만든다.
 *
 * 계약(한 문장): 검색기가 쓰는 사전과 두음법칙은 끝말잇기 게임이 실제로 쓰는 것과 ★같다.
 *   - 사전: wordchain/index.html 의 `const DICT = [...]` 를 그대로 평가해 words.json 을 만든다.
 *   - 규칙: 같은 파일의 두음법칙 코드(CHO ~ alts)를 글자 그대로 페이지 스크립트에 끼운다.
 *   - 표: 페이지의 AUTO 표시 사이를 이 도구가 쓴다. 손으로 고치지 말 것.
 *
 * 사용법
 *   node tools/build_hanbang.mjs .           (만들기)
 *   node tools/build_hanbang.mjs . --check   (게이트 — 다시 만든 결과가 저장본과 다르면 실패)
 * 종료코드: 0 = 일치 · 1 = 어긋남 · 2 = 게임 코드를 읽지 못해 판정 불가(★통과가 아니다).
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const check = process.argv.includes('--check');
const gamePath = path.join(root, 'wordchain/index.html');
const pagePath = path.join(root, 'wordchain/hanbang/index.html');
const wordsPath = path.join(root, 'wordchain/hanbang/words.json');

function indeterminate(msg) { console.error('판정 불가: ' + msg); process.exitCode = 2; }

function extract(src) {
  const a = src.indexOf('const DICT = [');
  const aEnd = a < 0 ? -1 : src.indexOf('\n];', a);
  const b = src.indexOf("const CHO = [");
  const c = src.indexOf('/* 한글 완성형만으로 된 문자열인가 */');
  if (a < 0 || aEnd < 0 || b < 0 || c < 0 || c < b) return null;
  return { dictSrc: src.slice(a, aEnd + 3), ruleSrc: src.slice(b, c).trimEnd() };
}

function compute(dictSrc, ruleSrc) {
  const DICT = new Function(dictSrc + '\nreturn DICT;')();
  const alts = new Function(ruleSrc + '\nreturn alts;')();
  const words = [];
  for (const g of DICT) {
    const n = g.s.length / g.L;
    for (let i = 0; i < n; i++) words.push({ w: g.s.substr(i * g.L, g.L), common: i < g.ne + g.na });
  }
  const byFirst = new Map();
  for (const x of words) byFirst.set(x.w[0], (byFirst.get(x.w[0]) || 0) + 1);
  const nextOf = ch => alts(ch).reduce((sum, f) => sum + (byFirst.get(f) || 0), 0);
  const byEnd = new Map();
  for (const x of words) {
    const e = x.w[x.w.length - 1];
    if (!byEnd.has(e)) byEnd.set(e, []);
    byEnd.get(e).push(x);
  }
  const ends = [...byEnd.entries()].map(([ch, list]) => ({
    ch, list, next: nextOf(ch),
    examples: [...list.filter(x => x.common), ...list.filter(x => !x.common)].slice(0, 4).map(x => x.w),
  }));
  const order = (p, q) => q.list.length - p.list.length || (p.ch < q.ch ? -1 : 1);
  const dead = ends.filter(e => e.next === 0).sort(order);
  const near = ends.filter(e => e.next >= 1 && e.next <= 3).sort(order);
  const rescued = ends
    .filter(e => e.next > 0 && !byFirst.has(e.ch))
    .sort((p, q) => q.next - p.next || (p.ch < q.ch ? -1 : 1));
  const stats = {
    words: words.length,
    common: words.filter(x => x.common).length,
    ends: ends.length,
    dead: dead.length,
    deadWords: dead.reduce((s, e) => s + e.list.length, 0),
    deadCommon: dead.reduce((s, e) => s + e.list.filter(x => x.common).length, 0),
    near: near.length,
    nearWords: near.reduce((s, e) => s + e.list.length, 0),
    rescued: rescued.length,
  };
  return { DICT, alts, dead, near, rescued, stats };
}

const num = n => n.toLocaleString('en-US');
const rows = (list, withNext) => list.map(e =>
  `<tr><td class="end">${e.ch}</td><td>${e.list.length}</td>` +
  (withNext ? `<td>${e.next}</td>` : '') +
  `<td class="ex">${e.examples.join(' · ')}</td></tr>`).join('\n');

function blocks(r) {
  const s = r.stats;
  const pct = (s.deadWords / s.words * 100).toFixed(1);
  const top = r.dead.slice(0, 20);
  const rest = r.dead.slice(20);
  const rescuedTop = r.rescued.slice(0, 8);
  return {
    stats: `<ul class="facts">
<li><b>${num(s.words)}</b><span>사전의 명사</span></li>
<li><b>${num(s.ends)}</b><span>끝 글자 종류</span></li>
<li><b>${num(s.dead)}</b><span>이을 말 없는 끝 글자</span></li>
<li><b>${num(s.deadWords)}</b><span>한방단어 (${pct}%)</span></li>
</ul>`,
    dead: `<table>
<thead><tr><th>끝 글자</th><th>한방단어</th><th>낱말 예</th></tr></thead>
<tbody>
${rows(top, false)}
</tbody>
</table>
<details><summary>나머지 끝 글자 ${num(rest.length)}개 모두 보기</summary>
<table>
<thead><tr><th>끝 글자</th><th>한방단어</th><th>낱말 예</th></tr></thead>
<tbody>
${rows(rest, false)}
</tbody>
</table>
</details>`,
    near: `<p>이을 말이 1~3개뿐인 끝 글자는 ${num(s.near)}개이고, 여기에 해당하는 낱말은 ${num(s.nearWords)}개입니다. 상대가 그 몇 개를 떠올리지 못하면 한방단어와 같은 결과가 납니다.</p>
<details><summary>거의 한방인 끝 글자 ${num(s.near)}개 보기</summary>
<table>
<thead><tr><th>끝 글자</th><th>낱말 수</th><th>이을 말</th><th>낱말 예</th></tr></thead>
<tbody>
${rows(r.near, true)}
</tbody>
</table>
</details>`,
    rescued: `<p>그 글자로 시작하는 낱말은 사전에 없지만, 두음법칙 덕분에 이어지는 끝 글자가 ${num(s.rescued)}개 있습니다. 이을 말이 많은 순서로 여덟 개를 골랐습니다.</p>
<table>
<thead><tr><th>끝 글자</th><th>낱말 수</th><th>이을 말</th><th>낱말 예</th></tr></thead>
<tbody>
${rows(rescuedTop, true)}
</tbody>
</table>`,
  };
}

function apply(page, name, body) {
  const open = `<!--AUTO:${name}-->`, close = `<!--/AUTO:${name}-->`;
  const a = page.indexOf(open), b = page.indexOf(close);
  if (a < 0 || b < a) throw new Error('표시를 찾지 못했다: ' + name);
  return page.slice(0, a + open.length) + '\n' + body + '\n' + page.slice(b);
}

function main() {
  if (!fs.existsSync(gamePath)) return indeterminate('wordchain/index.html 없음');
  const parts = extract(fs.readFileSync(gamePath, 'utf8'));
  if (!parts) return indeterminate('게임 코드에서 사전·두음법칙 구간을 찾지 못했다');
  let r;
  try { r = compute(parts.dictSrc, parts.ruleSrc); }
  catch (e) { return indeterminate('게임 코드 평가 실패: ' + e.message); }

  const json = JSON.stringify(r.DICT.map(g => ({ L: g.L, c: g.ne + g.na, s: g.s }))) + '\n';
  const b = blocks(r);
  const stale = [];
  const statsLine = '사전 ' + num(r.stats.words) + ' · 끝 글자 ' + num(r.stats.ends) + ' · 한방 끝글자 ' + num(r.stats.dead) +
    ' · 한방단어 ' + num(r.stats.deadWords) + ' · 흔한 말 중 한방 ' + num(r.stats.deadCommon) + ' · 거의 한방 끝글자 ' + num(r.stats.near) +
    ' · 두음으로 살아나는 끝글자 ' + num(r.stats.rescued);
  console.log(statsLine);

  if (!fs.existsSync(pagePath)) {
    if (check) return indeterminate('wordchain/hanbang/index.html 없음');
    return;
  }
  const before = fs.readFileSync(pagePath, 'utf8');
  let page = before;
  for (const k of Object.keys(b)) page = apply(page, k, b[k]);
  const ro = '/*AUTO:rule*/', rc = '/*/AUTO:rule*/';
  const ra = page.indexOf(ro), rb = page.indexOf(rc);
  if (ra < 0 || rb < ra) return indeterminate('페이지에 규칙 표시가 없다');
  page = page.slice(0, ra + ro.length) + '\n' + parts.ruleSrc + '\n' + page.slice(rb);

  if (check) {
    if (page !== before) stale.push('wordchain/hanbang/index.html');
    if (!fs.existsSync(wordsPath) || fs.readFileSync(wordsPath, 'utf8') !== json) stale.push('wordchain/hanbang/words.json');
    if (stale.length) {
      console.error('어긋남: ' + stale.join(', ') + ' — node tools/build_hanbang.mjs . 로 다시 만들 것');
      process.exitCode = 1;
      return;
    }
    console.log('통과: 검색기의 사전·두음법칙·표가 게임 코드와 같다');
    return;
  }
  fs.writeFileSync(wordsPath, json);
  fs.writeFileSync(pagePath, page);
  console.log('만들었다: words.json ' + json.length + '자 · index.html');
}

main();
