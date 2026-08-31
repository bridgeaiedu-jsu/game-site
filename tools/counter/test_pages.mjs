/* 공개 카운터 — 페이지 붙임새 단위 시험 (포털 · games.json 의 게임 전종 · 인라인 스크립트 문법)
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
/* 게임 목록은 루트 games.json 에서 받아 온다. 여기에 옮겨 적으면 새 게임을 더할 때 이
   파일을 잊기 쉽고, 그러면 검사는 통과하는데 정작 새 게임은 한 줄도 안 본 채 지나간다
   (「슛팅」 때 실제로 밟은 함정이다). */
const GAMES = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'games.json'), 'utf8')).map(g => g.id);
const read = f => fs.readFileSync(path.resolve(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c){ pass++; console.log('  PASS  ' + n); }
                          else { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };

console.log('== 게임 목록 (games.json 에서 파생) ==');
/* 목록이 비면 아래 게임별 검사가 한 번도 안 돌고 그대로 PASS 로 끝난다 — 목록이
   실제로 채워졌음을 먼저 못박는다. */
ok('games.json 에서 게임 ' + GAMES.length + '개를 읽었다',
   GAMES.length > 0 && GAMES.every(g => typeof g === 'string' && g), JSON.stringify(GAMES));
/* 목록에 있는데 페이지가 없으면 그것은 검사기 고장이 아니라 사이트 결함이다 — 포털 타일이
   404 로 간다. 읽다가 터지게 두면 종료코드가 '판정 실패' 와 '검사기 오류' 를 뭉개므로,
   FAIL 로 세우고 그 게임의 나머지 검사는 건너뛴다. */
const MISSING = GAMES.filter(g => !fs.existsSync(path.resolve(ROOT, g + '/index.html')));
ok('목록의 게임에 모두 페이지가 있다', MISSING.length === 0, '페이지 없음: ' + MISSING.join(', '));
const PLAYABLE = GAMES.filter(g => MISSING.indexOf(g) < 0);
const PAGES = ['index.html', ...PLAYABLE.map(g => g + '/index.html'), 'about/index.html', 'privacy/index.html'];

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

for (const KEY of PLAYABLE){
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
  /* ★문안은 '어느 낱말이 들어 있나' 가 아니라 **숫자 자리와 낱말 차례** 까지가 계약이다.
     게임 13종 전수 대조 결과 ko 는 13/13, en 은 10/13 이 아래 한 가지 꼴을 쓰고, 포털이
     타일과 방문 줄에 찍는 문안도 같은 꼴이다(`${today} today · ${total} all-time`).
     예전 규칙은 `today · … all-time` 이라는 **부분 문자열**만 봤다. 소수파 문안
     (`Today <b>N</b> · total <b>N</b>`)은 그 규칙으로도 걸렸지만, 그것은 우연히 낱말이
     안 맞았을 뿐이다 — 낱말만 어딘가에 있으면 숫자가 <b> 밖에 있든 두 숫자가 붙어 있든
     그대로 통과한다(자기시험 en-copy-loose-order 가 그 꼴을 실제로 만들어 보여 준다).
     대리물이 아니라 계약을 재도록 <b> 자리와 낱말 차례까지 함께 못박는다. */
  const koCopy = new RegExp(`^오늘 <b data-hp="plays\\.${KEY}\\.today">[^<]*</b>판 · 누적 <b data-hp="plays\\.${KEY}\\.total">[^<]*</b>판$`);
  const enCopy = new RegExp(`^<b data-hp="plays\\.${KEY}\\.today">[^<]*</b> today · <b data-hp="plays\\.${KEY}\\.total">[^<]*</b> all-time$`);
  ok('한국어 문안 (오늘 N판 · 누적 N판)', koCopy.test(st[0] || ''), st[0]);
  ok('영어 문안 (N today · N all-time)', enCopy.test(st[1] || ''), st[1]);
  ok('언어를 바꾼 뒤 숫자를 다시 채운다',
     /localStorage\.setItem\('bp\.lang', lang\);[\s\S]{0,240}if \(window\.hpStats\) window\.hpStats\(\)/.test(html));
  const gaStarts = [...html.matchAll(/ga\('game_start'/g)].length;
  /* ★GA 이벤트에 게임마다 다른 추가 인자(level·size·players 등)를 붙이는 것은 정상이다 —
     예전 정규식은 `{ game: GA_GAME }` 딱 그 모양만 인정해서, 추가 인자를 넘기는 페이지
     (sudoku·wordchain·minesweeper·ladder·memory)를 '짝이 없다'고 잘못 잡았다(도구 노후).
     그래서 인자 목록은 열어 주되 **느슨해지지 않도록** 두 가지를 그대로 요구한다:
       · 첫 항목이 반드시 `game: GA_GAME` 상수일 것 — 뒤에 식별자 글자가 이어지면 다른 상수다
       · `[^;\n]*` 로 **같은 줄·같은 문장 안**에서만 인자를 허용할 것(다른 문장을 삼키지 못한다)
     그 다음 줄에 가드가 붙은 hpHit('play', GA_GAME) 이 와야 한다는 조건은 그대로다. */
  const paired = [...html.matchAll(/ga\('game_start', \{ game: GA_GAME(?![A-Za-z0-9_$])[^;\n]*\);(\s*\/\*[^*]*\*\/)?\s*\n\s*if \(window\.hpHit\) window\.hpHit\('play', GA_GAME\);/g)].length;
  ok(`hpHit('play') 가 시작 지점 ${gaStarts}곳 전부에 짝지어 있다`, paired === gaStarts && gaStarts > 0,
     `짝 ${paired} / 시작 ${gaStarts}`);
  /* ★짝 검사는 '시작 지점 옆에 붙은 호출' 만 센다 — 엉뚱한 자리에 하나 더 있는 호출은
     짝 수와 시작 수가 같아도 통과한다. 총량을 함께 못박아 판수가 부풀려 세어지는 경로를
     막는다. 전 13종 실측에서 시작 수와 호출 수가 모두 같다(1:1 · block-drop·word 는 2:2). */
  const playHits = [...html.matchAll(/window\.hpHit\('play', GA_GAME\)/g)].length;
  ok(`hpHit('play') 호출이 시작 지점 수와 같다(떠도는 호출 0)`, playHits === gaStarts,
     `호출 ${playHits} / 시작 ${gaStarts}`);
  ok('hpHit 은 있는지 보고 부른다(없어도 게임이 안 깨진다)',
     !/[^)]\s*window\.hpHit\('play'/.test(html.replace(/if \(window\.hpHit\) window\.hpHit\('play'/g, '')));
}

console.log('\n== hidden 가드 (숨긴 줄이 정말 숨는가) ==');
{
  /* 'hidden' 은 브라우저 기본값 [hidden]{display:none} 으로만 걸려 있다 — 선택자가 조금이라도
     더 센 규칙이 display 를 선언하면 그 기본값을 덮어, 숫자를 못 받은 줄이 그대로 보인다.
     그래서 display 를 선언한 페이지에는 반드시 [hidden] 가드가 함께 있어야 한다. */
  for (const p of ['index.html', ...PLAYABLE.map(g => g + '/index.html')]){
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
