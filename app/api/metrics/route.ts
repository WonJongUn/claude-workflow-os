import { registry } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prometheus exposition 포맷 텍스트 응답.
 * 외부 Prometheus가 scrape하거나 사이드바 모니터링 화면이 직접 파싱한다.
 */
export async function GET() {
  const body = await registry.metrics();
  return new Response(body, {
    headers: {
      "content-type": registry.contentType,
      "cache-control": "no-store",
    },
  });
}
