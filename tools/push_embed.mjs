/* push_embed.mjs — 생성기 사본을 제품에 ★기계로 넣는다(손으로 베끼지 않는다).
 *
 * ★왜: 같은 코드가 두 곳에 있으면 언젠가 갈라진다. 정의처는 tools/push_gen.mjs 하나이고,
 * 제품 push/index.html 의 GEN-BEGIN…GEN-END 사이는 ★그 파일에서 기계로 만든 사본이다.
 * ★변환 규칙은 한 줄뿐이다: 행머리의 'export ' 를 뗀다(인라인 모듈에는 내보낼 곳이 없다).
 * ★검사기(verify_push.js)가 ★같은 변환을 적용해 두 사본이 같은지 대조한다.
 *
 * 종료코드: 0 = 이미 같거나 새로 넣었다 · 1 = 표식을 못 찾았다
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.dirname(here);
const GEN = path.join(ROOT, 'tools', 'push_gen.mjs');
const HTML = path.join(ROOT, 'push', 'index.html');
const BEGIN = '/* GEN-BEGIN */';
const END = '/* GEN-END */';

export function embedBody(genSource) {
  return genSource.replace(/^export /gm, '');       /* ★변환 규칙은 이 한 줄이다 */
}

const gen = fs.readFileSync(GEN, 'utf8');
const html = fs.readFileSync(HTML, 'utf8');
const i = html.indexOf(BEGIN), j = html.indexOf(END);
if (i < 0 || j < 0 || j < i) { console.error('★표식을 못 찾았다: ' + BEGIN + ' … ' + END); process.exit(1); }

const body = embedBody(gen);
const next = html.slice(0, i + BEGIN.length) + '\n' + body + '\n' + html.slice(j);
if (next === html) { console.log('이미 같다 — 바꾸지 않았다.'); process.exit(0); }
fs.writeFileSync(HTML, next);
console.log('생성기 사본을 넣었다: %d바이트 → %s', body.length, path.relative(ROOT, HTML));
