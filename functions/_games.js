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
 * 파일 이름이 `_` 로 시작하는 것은 Pages 가 이것을 라우트가 아닌 보조 모듈로 두게 하려는
 * 것이다(`_middleware.js` 와 같은 자리). 배포 후 `/api/hit`·`/api/stats` 가 평소대로
 * 응답하는지 한 번 확인할 것.
 */

export const GAMES = ['block-puzzle', '2048', 'block-drop', 'word', 'shooting'];
