/* 공개 카운터 — 적중 기록. POST /api/hit  {type:'visit'|'play', game?}
 *
 * 세는 것은 **횟수뿐**이다. 방문 1회·판 시작 1회를 (날짜, 종류, 게임) 칸에 1 더한다.
 * 누가 눌렀는지는 어디에도 남기지 않는다 — IP·User-Agent·식별자 어느 것도 저장하지 않는다.
 *
 * 응답: 204(성공·본문 없음) · 400(입력 오류) · 403(다른 사이트에서 부름) · 405(POST 아님)
 *       413(본문이 너무 큼) · 500(예외 — 본문 없음)
 * 남용 방어는 Cloudflare Rate Limiting 이 맡는다(/api/hit · IP당 10초 30건).
 */

const GAMES = ['block-puzzle', '2048', 'block-drop', 'word', 'shooting'];
const HOST = 'hanpango.com';
const MAX_BODY = 256;               /* 본문은 짧은 JSON 하나면 충분하다 — 바이트 기준 */

/* 테이블은 isolate 당 한 번만 만든다 — 요청마다 DDL 을 던지면 쓸데없이 느려진다.
   (모듈 변수는 그 isolate 가 사는 동안 유지된다.) */
let tableReady = false;
async function ensureTable(db){
  if (tableReady) return;
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS hits (day TEXT, kind TEXT, game TEXT, n INTEGER, PRIMARY KEY(day, kind, game))'
  ).run();
  tableReady = true;
}

/* 하루의 경계는 한국 시간(UTC+9)으로 긋는다 — 오너와 방문자가 보는 '오늘' 이 같아야 한다. */
function kstDay(now){
  const t = new Date(now.getTime() + 9 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate());
}

/* 이 사이트에서 부른 것인가 — Origin 이 없으면 Referer 로 본다(sendBeacon 은 Origin 을 붙인다). */
function sameSite(request){
  const pick = v => { try { return new URL(v).hostname; } catch (e) { return null; } };
  const host = pick(request.headers.get('Origin')) || pick(request.headers.get('Referer'));
  return host === HOST;
}

export async function onRequest(context){
  const { request, env } = context;
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  if (!sameSite(request)) return new Response(null, { status: 403 });

  /* ★상한은 **바이트**로 잰다. 문자열 길이로 재면 한글 한 글자가 1 로 세어져 UTF-8 로는
     세 배까지 커진 본문이 통과한다. 그리고 다 읽은 뒤에 재면 이미 다 받은 셈이라 상한이
     상한 노릇을 못 한다 — 미리 알 수 있으면 읽기 전에 끊고, 아니면 읽으면서 끊는다. */
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) return new Response(null, { status: 413 });
  if (!request.body) return new Response(null, { status: 400 });

  let bytes;
  try {
    const reader = request.body.getReader();
    const chunks = [];
    let n = 0;
    for (;;){
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > MAX_BODY){ await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(value);
    }
    bytes = new Uint8Array(n);
    let at = 0;
    for (const c of chunks){ bytes.set(c, at); at += c.length; }
  } catch (e) {
    return new Response(null, { status: 400 });
  }

  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes) || '{}'); }
  catch (e) { return new Response(null, { status: 400 }); }
  if (!data || typeof data !== 'object') return new Response(null, { status: 400 });

  const kind = data.type;
  if (kind !== 'visit' && kind !== 'play') return new Response(null, { status: 400 });
  /* play 는 어느 게임인지 반드시 있어야 하고, 아는 이름이어야 한다 — 모르는 이름을 받아 주면
     남이 만든 칸이 표에 쌓인다. visit 은 게임이 없으므로 빈 문자열로 못박는다. */
  const game = kind === 'play' ? data.game : '';
  if (kind === 'play' && GAMES.indexOf(game) < 0) return new Response(null, { status: 400 });

  try {
    await ensureTable(env.DB);
    await env.DB.prepare(
      'INSERT INTO hits (day, kind, game, n) VALUES (?, ?, ?, 1) ' +
      'ON CONFLICT(day, kind, game) DO UPDATE SET n = n + 1'
    ).bind(kstDay(new Date()), kind, game).run();
  } catch (e) {
    return new Response(null, { status: 500 });   /* 무엇이 틀렸는지 밖으로 흘리지 않는다 */
  }
  return new Response(null, { status: 204 });
}
