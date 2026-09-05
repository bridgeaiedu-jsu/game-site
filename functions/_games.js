/* 게임 목록 — Pages Functions 의 **유일한** 런타임 출처.
 *
 * 화면이 쓰는 원본은 루트 `games.json` 이다. Functions 는 빌드가 없어 그 JSON 을 모듈로
 * 들여올 수 있는지 이 저장소에서 확인할 수단이 없어(wrangler·네트워크 없음), 런타임은
 * 순수 JS 인 이 파일 하나만 본다. hit.js·stats.js 는 목록을 따로 갖지 않는다.
 *
 * 두 곳이 어긋나는 일은 시험이 막는다 — `tools/counter/test_functions.mjs` 가 이 배열과
 * `games.json` 의 id 배열이 순서까지 같은지 검사해, 다르면 FAIL 한다. 게임을 더할 때
 * 손으로 적는 곳은 games.json 과 이 파일 둘뿐이고, 하나를 잊으면 시험에서 걸린다.
 *
 * ★이 파일이 라우트로 생기지 않는 이유는 **파일 이름이 아니라 `onRequest` 계열 export 가
 * 없기 때문**이다. Pages 의 라우트 생성기는 `onRequest*` 를 내보내는 모듈만 라우트 표에
 * 넣는다(workers-sdk `packages/pages-functions/src/routing/filepath-routing.ts`).
 * 앞의 `_` 는 '라우트가 아닌 보조 파일' 이라는 **명명 관례**일 뿐, 그 자체가 막아 주지 않는다.
 * 그러니 이 파일에 `onRequest` 를 붙이지 마라 — 붙이는 순간 `/_games` 가 진짜 라우트가 된다.
 * 라우트가 아니어도 hit.js·stats.js 가 이 파일을 import 하므로 그 의존성을 따라 함께
 * 번들된다(Pages 는 핸들러와 가져온 모듈을 하나의 ES module Worker 로 묶는다).
 */

export const GAMES = ['block-puzzle', '2048', 'block-drop', 'word', 'shooting', 'brick-breaker', 'estimate', 'sudoku', 'nonsense', 'wordchain', 'minesweeper', 'ladder', 'memory', 'nonogram', 'tensec', 'stop', 'just-right', 'fake-one', 'reverse', 'higher-lower', 'how-many', 'together', 'gomoku'];
