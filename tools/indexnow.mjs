/**
 * IndexNow — 바뀐 주소를 빙(·Yandex)에 즉시 알린다.
 *
 *   node tools/indexnow.mjs                          사이트맵의 주소 전부
 *   node tools/indexnow.mjs https://hanpango.com/read/liar-game-words/   특정 주소만(여러 개)
 *
 * 왜(2026-10-04): 애드센스 「가치가 별로 없는 콘텐츠」 2차 거절 뒤 대응. 빙 웹마스터에
 * 등록 흔적이 없었다(msvalidate·키 파일 0). 빙 색인은 ChatGPT·Copilot 검색에도 쓰인다.
 * ⚠️ 구글·네이버는 IndexNow 를 받지 않는다 — 그쪽은 서치콘솔·서치어드바이저에서 사람이 요청한다.
 *
 * 키는 발급받는 것이 아니라 정하는 것이다. 루트의 `<32자 hex>.txt` 가 소유 증명이다.
 * 🔴 그 파일을 지우면 제출이 전부 거부된다.
 * ⚠️ 윈도우 Git Bash 는 `/read/…` 같은 인자를 C:/… 경로로 바꿔 버린다(imonesaju 9/19 사고).
 *    그래서 **전체 주소만** 받고, hanpango.com 이 아닌 주소는 거절한다.
 */
import { readFileSync, readdirSync } from 'node:fs';

const HOST = 'hanpango.com';
const ORIGIN = `https://${HOST}`;

const keyFile = readdirSync('.').find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error('루트에 IndexNow 키 파일(<32자hex>.txt)이 없습니다.');
const key = readFileSync(keyFile, 'utf8').trim();
if (key !== keyFile.slice(0, -4)) throw new Error(`키 파일 이름과 내용이 다릅니다: ${keyFile}`);

const args = process.argv.slice(2);
const urls = args.length
  ? args
  : [...readFileSync('sitemap.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const bad = urls.filter((u) => !u.startsWith(`${ORIGIN}/`) && u !== ORIGIN);
if (bad.length) {
  console.error('hanpango.com 전체 주소가 아닌 인자가 있습니다:', bad.join(' '));
  process.exitCode = 2;
} else {
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key, keyLocation: `${ORIGIN}/${keyFile}`, urlList: urls }),
  });
  console.log(`제출 ${urls.length}건 · HTTP ${res.status} ${res.status === 200 || res.status === 202 ? '· 접수됨' : '· 확인 필요'}`);
  // 200/202 라도 주소가 쓰레기면 의미가 없다(9/19) — 위에서 origin 을 검사한 이유
  process.exitCode = res.status === 200 || res.status === 202 ? 0 : 1;
}
