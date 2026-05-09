export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 가벼운 헬스체크. 클라이언트가 주기적으로 호출해 서버 가용성을 확인.
 * 외부 자원(파일 IO/네트워크)에 의존하지 않아야 함 — 서버 프로세스 살아있음만 확인.
 */
export async function GET() {
  return Response.json({ ok: true, ts: Date.now() });
}
