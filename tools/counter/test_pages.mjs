/* 공개 카운터 — 페이지 붙임새 단위 시험 (포털 · 게임 4종 · 인라인 스크립트 문법)
 *
 * 페이지가 카운터를 제대로 물고 있는지 본다: 클라이언트를 싣는가, 숫자 자리(data-hp)가
 * 제자리에 있고 처음엔 감춰져 있는가, ko·en 문안이 둘 다 있는가, 발화가 시작 지점마다
 * 짝지어 있는가, 다시 그린 뒤 숫자를 다시 채우는가. tile() 은 실제로 실행해 결과를 읽는다.
 *
 * 사용법: node tools/counter/test_pages.mjs [저장소 경로]
 * 종료코드: 0 = 전부 PASS · 1 = FAIL 있음
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const ROOT = process.argv[2] || '.';
const GAMES = ['block-puzzle', '2048', 'block-drop', 'word'];
const PAGES = ['index.html', ...GAMES.map(g => g + '/index.html'), 'about/index.html', 'privacy/index.html'];
const read = f => fs.readFileSync(path.resolve(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c){ pass++; console.log('  PASS  ' + n); }
                          else { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };

console.log('== 포털 (index.html) ==');
{
  const html = read('index.html');
  ok('hp-stats.js 를 defer 로 싣는다', /<script src="\/js\/hp-stats\.js" defer><\/script>/.test(html));
  ok('헤더 아래 방문 줄이 있다', /<p class="hp-stat" data-hp-line hidden data-i18n="statVisits">/.test(html));
  const all = [...html.matchAll(/statVisits:'([^']*)'/g)].map(m => m[1]);
  ok('statVisits 문안이 ko·en 두 곳에 있다', all.length === 2, String(all.length));
  ok('두 문안 모두 visits.today·visits.total 을 가리킨다',
     all.every(t => t.includes('data-hp="visits.today"') && t.includes('data-hp="visits.total"')), JSON.stringify(all));
  ok('한국어 문안 (오늘 방문 · 누적)', all[0].includes('오늘 방문') && all[0].includes('누적'), all[0]);
  ok('영어 문안 (visits today · all-time)', /visits today/.test(all[1]) && /all-time/.test(all[1]), all[1]);

  /* tile()·playLine() 을 실제로 돌려 본다 */
  const fnSrc = [/function playLine\(g\)\{[\s\S]*?\n\}/, /function tile\(g\)\{[\s\S]*?\n\}/]
    .map(re => (html.match(re) || [''])[0]).join('\n');
  ok('playLine·tile 을 꺼냈다', fnSrc.includes('playLine') && fnSrc.includes('function tile'));
  const ctx = vm.createContext({ esc: s => String(s), T: () => 'daily', lang: 'ko' });
  vm.runInContext(fnSrc, ctx);
  const g = { path: '/2048/', thumb: '/2048/thumb.webp', title: { ko: '2048' }, desc: { ko: '설명' },
              playtime: { ko: '2~5분' }, daily: true };
  let out = vm.runInContext('tile(' + JSON.stringify(g) + ')', ctx);
  ok('타일에 오늘·누적 판수 자리가 들어간다',
     out.includes('data-hp="plays.2048.today"') && out.includes('data-hp="plays.2048.total"'));
  ok('타일 줄도 처음엔 hidden', /<span class="hp-stat" data-hp-line hidden>/.test(out));
  ok('한국어 타일 문안 (오늘 N판 · 누적 N판)', /오늘 .*판 · 누적 .*판/.test(out));
  ctx.lang = 'en';
  out = vm.runInContext('tile(' + JSON.stringify(g) + ')', ctx);
  ok('영어 타일 문안 (N today · N all-time)', /today · .*all-time/.test(out));
  out = vm.runInContext('tile(' + JSON.stringify(Object.assign({}, g, { path: '/block-drop/' })) + ')', ctx);
  ok('게임 이름을 주소에서 뽑는다 (/block-drop/ → block-drop)', out.includes('data-hp="plays.block-drop.today"'));

  ok('다시 그린 뒤 숫자를 다시 채운다(render 끝에서 hpStats)',
     /innerHTML = games\.map\(tile\)[\s\S]{0,220}window\.hpStats\(\)/.test(html));
  ok('방문은 화면이 준비된 뒤 한 번 부른다', /hpVisit[\s\S]{0,160}DOMContentLoaded', hpVisit\)/.test(html));
  ok('hpHit·hpStats 는 있는지 보고 부른다',
     /if \(window\.hpStats\) window\.hpStats\(\)/.test(html) && /if \(window\.hpHit\) window\.hpHit\('visit'\)/.test(html));
}

for (const KEY of GAMES){
  console.log('\n== ' + KEY + ' ==');
  const html = read(KEY + '/index.html');
  ok('hp-stats.js 를 defer 로 싣는다', /<script src="\/js\/hp-stats\.js" defer><\/script>/.test(html));
  ok('시작 화면에 판수 줄이 있다(처음엔 hidden)',
     /<p class="hp-stat" data-hp-line hidden data-i18n="statPlays">/.test(html));
  const st = [...html.matchAll(/statPlays:'([^']*)'/g)].map(m => m[1]);
  ok('statPlays 문안이 ko·en 두 곳에 있다', st.length === 2, String(st.length));
  ok('두 문안 모두 이 게임의 today·total 을 가리킨다',
     st.every(t => t.includes(`data-hp="plays.${KEY}.today"`) && t.includes(`data-hp="plays.${KEY}.total"`)),
     JSON.stringify(st));
  ok('한국어 문안 (오늘 N판 · 누적 N판)', /오늘 .*판 · 누적 .*판/.test(st[0]), st[0]);
  ok('영어 문안 (N today · N all-time)', /today · .*all-time/.test(st[1]), st[1]);
  ok('언어를 바꾼 뒤 숫자를 다시 채운다',
     /localStorage\.setItem\('bp\.lang', lang\);[\s\S]{0,240}if \(window\.hpStats\) window\.hpStats\(\)/.test(html));
  const gaStarts = [...html.matchAll(/ga\('game_start'/g)].length;
  const paired = [...html.matchAll(/ga\('game_start', \{ game: GA_GAME \}\);(\s*\/\*[^*]*\*\/)?\s*\n\s*if \(window\.hpHit\) window\.hpHit\('play', GA_GAME\);/g)].length;
  ok(`hpHit('play') 가 시작 지점 ${gaStarts}곳 전부에 짝지어 있다`, paired === gaStarts && gaStarts > 0,
     `짝 ${paired} / 시작 ${gaStarts}`);
  ok('hpHit 은 있는지 보고 부른다(없어도 게임이 안 깨진다)',
     !/[^)]\s*window\.hpHit\('play'/.test(html.replace(/if \(window\.hpHit\) window\.hpHit\('play'/g, '')));
}

console.log('\n== hidden 가드 (숨긴 줄이 정말 숨는가) ==');
{
  /* 'hidden' 은 브라우저 기본값 [hidden]{display:none} 으로만 걸려 있다 — 선택자가 조금이라도
     더 센 규칙이 display 를 선언하면 그 기본값을 덮어, 숫자를 못 받은 줄이 그대로 보인다.
     그래서 display 를 선언한 페이지에는 반드시 [hidden] 가드가 함께 있어야 한다. */
  for (const p of ['index.html', ...GAMES.map(g => g + '/index.html')]){
    const html = read(p);
    const withoutGuard = html.replace(/\.hp-stat\[hidden\][^{}]*{[^{}]*}/g, '');
    const declaresDisplay = /\.hp-stat[^{}]*{[^{}]*display[^{}]*}/.test(withoutGuard);
    const guarded = /\.hp-stat\[hidden\]\s*{[^{}]*display\s*:\s*none\s*!important[^{}]*}/.test(html);
    ok(p.padEnd(22) + ' hidden 가드 규칙이 있다', guarded);
    ok(p.padEnd(22) + ' display 선언이 hidden 을 이기지 못한다', !declaresDisplay || guarded,
       'display 선언=' + declaresDisplay + ' · 가드=' + guarded);
  }
}

console.log('\n== 인라인 스크립트 문법 ==');
{
  let n = 0, bad = 0;
  for (const p of PAGES){
    const html = read(p);
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)){
      n++;
      if (/application\/ld\+json/.test(m[0])){
        try { JSON.parse(m[1]); } catch (e){ bad++; console.log('    ' + p + ' JSON 오류: ' + e.message); }
        continue;
      }
      try { new vm.Script(m[1]); } catch (e){ bad++; console.log('    ' + p + ' 문법 오류: ' + e.message); }
    }
  }
  ok(`${PAGES.length}개 페이지 · 인라인 스크립트 ${n}개 문법 0오류`, bad === 0, String(bad));
  let badFile = 0;
  for (const f of ['js/hp-stats.js', 'sw.js']){
    try { new vm.Script(read(f)); } catch (e){ badFile++; console.log('    ' + f + ' 문법 오류: ' + e.message); }
  }
  ok('js/hp-stats.js · sw.js 문법 0오류', badFile === 0, String(badFile));
}

console.log('\n==== 페이지 붙임새 단위 시험: PASS ' + pass + ' · FAIL ' + fail + ' ====');
process.exit(fail ? 1 : 0);
