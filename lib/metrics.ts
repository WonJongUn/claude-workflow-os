import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

/**
 * 단일 Prometheus Registry. Hot reload(dev) 시 중복 등록을 막기 위해 globalThis에 캐싱.
 * Node.js 기본 메트릭(CPU/메모리/이벤트 루프/GC/heap)이 자동으로 수집된다.
 */
declare global {
   
  var __metricsRegistry: Registry | undefined;
}

function buildRegistry(): Registry {
  const r = new Registry();
  collectDefaultMetrics({ register: r });
  return r;
}

/**
 * 프로세스 단일 Prometheus Registry. 모든 메트릭이 여기에 등록된다.
 * dev hot reload에서 중복 등록되지 않도록 globalThis 캐시를 사용.
 * `/api/metrics`가 `registry.metrics()`로 직렬화해 노출.
 */
export const registry: Registry =
  globalThis.__metricsRegistry ?? (globalThis.__metricsRegistry = buildRegistry());

/**
 * 라우트별 요청 수 카운터.
 */
const httpRequestsTotal: Counter<"route" | "method" | "status"> =
  (registry.getSingleMetric("http_requests_total") as
    | Counter<"route" | "method" | "status">
    | undefined) ??
  new Counter({
    name: "http_requests_total",
    help: "Total HTTP requests by route/method/status.",
    labelNames: ["route", "method", "status"],
    registers: [registry],
  });

/**
 * 라우트별 처리 시간 히스토그램(초). 평균은 sum/count, 분위수는 percentile().
 */
const httpRequestDurationSeconds: Histogram<"route" | "method"> =
  (registry.getSingleMetric("http_request_duration_seconds") as
    | Histogram<"route" | "method">
    | undefined) ??
  new Histogram({
    name: "http_request_duration_seconds",
    help: "Request duration in seconds, partitioned by route/method.",
    labelNames: ["route", "method"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

/**
 * Route handler를 감싸 요청 수와 응답 시간을 자동 측정.
 *
 * 사용:
 *   export const GET = withMetrics("/api/sessions/:id", _GET);
 *
 * route는 동적 세그먼트를 정규화한 패턴 문자열(:id 등)로 넘겨야 라벨 카디널리티가 폭주하지 않는다.
 */
export function withMetrics<Args extends unknown[]>(
  route: string,
  handler: (...args: Args) => Promise<Response> | Response,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    const req = args[0] as { method?: string } | undefined;
    const method = req?.method ?? "GET";
    const start = process.hrtime.bigint();
    let status = 0;
    try {
      const res = await handler(...args);
      status = res.status;
      return res;
    } catch (err) {
      status = 500;
      throw err;
    } finally {
      const dur = Number(process.hrtime.bigint() - start) / 1e9;
      httpRequestDurationSeconds.observe({ route, method }, dur);
      httpRequestsTotal.inc({ route, method, status: String(status) });
    }
  };
}
