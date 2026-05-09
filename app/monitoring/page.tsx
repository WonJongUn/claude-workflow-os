"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  RefreshControl,
  Tooltip,
  cn,
} from "@/app/components/ui";
import { firstValue, parsePrometheus, type MetricFamily } from "./parse";

/** 시계열 한 점. */
type Point = { ts: number; value: number };

/** 한 시리즈의 누적 시계열. */
type Series = { label: string; color: string; points: Point[] };

const POLL_MS = 5_000;
const MAX_POINTS = 60; // 5분 (5s × 60).

/**
 * /api/metrics를 5초 주기로 폴링해 직접 파싱한 뒤 자체 차트로 렌더링.
 * 외부 Prometheus/Grafana 없이도 단일 화면에서 핵심 지표를 본다.
 */
export default function MonitoringPage() {
  const { data: families, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["metrics"],
    queryFn: async () => {
      const res = await axios.get<string>("/api/metrics", {
        responseType: "text",
        transformResponse: (v) => v,
      });
      return parsePrometheus(res.data);
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const series = useTimeSeries(families);
  const apiSeries = useApiSeries(families);

  return (
    <div className="flex w-full flex-col gap-5 py-5 pl-6 pr-16">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            모니터링
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Next.js 서버 프로세스의 Prometheus 메트릭. 5초 간격으로 갱신.
          </p>
        </div>
        <RefreshControl
          onClick={() => void refetch()}
          isFetching={isFetching}
          timestamp={dataUpdatedAt}
        />
      </header>

      {!families ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          로딩 중…
        </div>
      ) : (
        <>
          <Section title="Infra">
            <SnapshotCard families={families} />
            <ChartCard
              title="CPU 사용률"
              unit="cores"
              series={series.cpu}
              decimals={3}
              metricNames={[
                "process_cpu_user_seconds_total",
                "process_cpu_system_seconds_total",
              ]}
              families={families}
            />
            <ChartCard
              title="RSS 메모리"
              unit="MB"
              series={series.memory}
              decimals={1}
              metricNames={["process_resident_memory_bytes"]}
              families={families}
            />
            <ChartCard
              title="이벤트 루프 지연"
              unit="ms"
              series={series.eventLoop}
              decimals={2}
              metricNames={[
                "nodejs_eventloop_lag_p99_seconds",
                "nodejs_eventloop_lag_mean_seconds",
              ]}
              families={families}
            />
          </Section>
          <Section title="API" cols={2}>
            <ChartCard
              title="라우트별 p99 레이턴시"
              unit="ms"
              series={apiSeries.latency}
              decimals={1}
              metricNames={["http_request_duration_seconds"]}
              families={families}
            />
            <ChartCard
              title="라우트별 요청률"
              unit="req/s"
              series={apiSeries.rate}
              decimals={2}
              metricNames={["http_requests_total"]}
              families={families}
            />
            <ApiLatencyCard families={families} />
            <ApiRequestRateCard families={families} />
          </Section>
          <Section title="Cache" cols={2}>
            <CacheHitRateCard families={families} />
          </Section>
        </>
      )}
    </div>
  );
}

/**
 * named cache 별 hit/miss/size + 히트율 표.
 */
function CacheHitRateCard({ families }: { families: Map<string, MetricFamily> }) {
  const rows = useMemo(() => buildCacheRows(families), [families]);
  return (
    <Card>
      <CardHeader>
        <MetricTitle
          title="캐시 히트율 (누적)"
          metricNames={["cache_hits_total", "cache_misses_total", "cache_size"]}
          families={families}
        />
        <span className="font-mono text-[11px] text-zinc-500">%</span>
      </CardHeader>
      <CardBody className="p-0">
        {rows.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-zinc-500">
            아직 캐시 활동이 없습니다.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">name</th>
                <th className="px-3 py-1.5 text-right font-medium">size</th>
                <th className="px-3 py-1.5 text-right font-medium">hits</th>
                <th className="px-3 py-1.5 text-right font-medium">miss</th>
                <th className="px-3 py-1.5 text-right font-medium">hit %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="px-3 py-1.5 font-mono">{r.name}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{r.size}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400">
                    {r.hits}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-amber-600 dark:text-amber-400">
                    {r.misses}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {r.hits + r.misses === 0
                      ? "-"
                      : ((r.hits / (r.hits + r.misses)) * 100).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

type CacheRow = { name: string; hits: number; misses: number; size: number };

function buildCacheRows(families: Map<string, MetricFamily>): CacheRow[] {
  const hitsF = families.get("cache_hits_total");
  const missesF = families.get("cache_misses_total");
  const sizeF = families.get("cache_size");
  const names = new Set<string>();
  const hits = new Map<string, number>();
  const misses = new Map<string, number>();
  const size = new Map<string, number>();
  for (const s of hitsF?.samples ?? []) {
    const name = s.labels.name ?? "?";
    names.add(name);
    hits.set(name, (hits.get(name) ?? 0) + s.value);
  }
  for (const s of missesF?.samples ?? []) {
    const name = s.labels.name ?? "?";
    names.add(name);
    misses.set(name, (misses.get(name) ?? 0) + s.value);
  }
  for (const s of sizeF?.samples ?? []) {
    const name = s.labels.name ?? "?";
    names.add(name);
    size.set(name, s.value);
  }
  return [...names]
    .map((name) => ({
      name,
      hits: hits.get(name) ?? 0,
      misses: misses.get(name) ?? 0,
      size: size.get(name) ?? 0,
    }))
    .sort((a, b) => b.hits + b.misses - (a.hits + a.misses));
}

/**
 * 같은 도메인 카드들을 묶는 섹션. 헤더 + 격자.
 */
function Section({
  title,
  children,
  cols = 3,
}: {
  title: string;
  children: React.ReactNode;
  /** 격자 열 수 (xl 이상). 기본 3, 카드 높이 정렬을 원하면 같은 행 안에 같은 종류만 두기. */
  cols?: 2 | 3;
}) {
  // grid-cols-[repeat(N,minmax(0,360px))]로 카드가 일정 폭 이상으로 커지지 않게 한다.
  // 좁은 화면(sm 이하)에서는 1열로 떨어진다.
  const grid =
    cols === 2
      ? "grid gap-3 grid-cols-1 sm:grid-cols-[repeat(2,minmax(0,720px))]"
      : "grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,720px))]";
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h2>
      <div className={grid}>{children}</div>
    </section>
  );
}

/**
 * 현재 스냅샷 카드 (단일 값들).
 */
function SnapshotCard({ families }: { families: Map<string, MetricFamily> }) {
  const uptime = firstValue(families, "process_start_time_seconds");
  const heapUsed = firstValue(families, "nodejs_heap_size_used_bytes");
  const heapTotal = firstValue(families, "nodejs_heap_size_total_bytes");
  const handles = firstValue(families, "nodejs_active_handles_total");
  const requests = firstValue(families, "nodejs_active_requests_total");

  const startEpoch = uptime ? uptime * 1000 : undefined;
  const uptimeSec = useUptimeSec(startEpoch);

  return (
    <Card>
      <CardHeader>
        <MetricTitle
          title="프로세스 스냅샷"
          metricNames={[
            "process_start_time_seconds",
            "nodejs_heap_size_used_bytes",
            "nodejs_heap_size_total_bytes",
            "nodejs_active_handles_total",
            "nodejs_active_requests_total",
          ]}
          families={families}
        />
      </CardHeader>
      <CardBody className="grid grid-cols-2 gap-y-2 text-xs">
        <Stat label="가동 시간" value={uptimeSec ? formatDuration(uptimeSec) : "-"} />
        <Stat
          label="V8 heap"
          value={
            heapUsed !== undefined && heapTotal !== undefined
              ? `${(heapUsed / 1e6).toFixed(1)} / ${(heapTotal / 1e6).toFixed(1)} MB`
              : "-"
          }
        />
        <Stat label="Active handles" value={handles?.toString() ?? "-"} />
        <Stat label="Active requests" value={requests?.toString() ?? "-"} />
      </CardBody>
    </Card>
  );
}

/**
 * 시작 epoch(ms)로부터의 가동 시간(초)을 1초 간격으로 갱신.
 * Date.now()는 impure라 effect 안에서만 호출.
 */
function useUptimeSec(startEpoch: number | undefined): number | undefined {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!startEpoch) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startEpoch]);
  if (!startEpoch || now === null) return undefined;
  return (now - startEpoch) / 1000;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="text-zinc-500">{label}</div>
      <div className="text-right font-mono text-zinc-900 dark:text-zinc-100">{value}</div>
    </>
  );
}

/**
 * 라우트별 누적 sum/count로 평균 레이턴시(ms)를 계산하고 표로 노출.
 * 정확한 분위수가 필요하면 histogram 버킷을 추가 분석해야 하지만,
 * 로컬 도구의 한눈 보기에는 평균 + 요청 수로 충분.
 */
function ApiLatencyCard({ families }: { families: Map<string, MetricFamily> }) {
  const rows = useMemo(() => buildApiRows(families), [families]);

  return (
    <Card>
      <CardHeader>
        <MetricTitle
          title="라우트별 p99 레이턴시 (누적)"
          metricNames={["http_request_duration_seconds"]}
          families={families}
        />
        <span className="font-mono text-[11px] text-zinc-500">ms</span>
      </CardHeader>
      <CardBody className="p-0">
        {rows.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-zinc-500">
            아직 요청 기록이 없습니다.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">route</th>
                <th className="px-3 py-1.5 text-right font-medium">method</th>
                <th className="px-3 py-1.5 text-right font-medium">count</th>
                <th className="px-3 py-1.5 text-right font-medium">p99 ms</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {rows.map((r) => (
                <tr key={`${r.route}|${r.method}`}>
                  <td className="px-3 py-1.5 font-mono">{r.route}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-500">
                    {r.method}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">{r.count}</td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {r.p99Sec !== undefined ? (r.p99Sec * 1000).toFixed(1) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * 라우트별 누적 요청 수 + 상태 분포.
 */
function ApiRequestRateCard({ families }: { families: Map<string, MetricFamily> }) {
  const byRoute = useMemo(() => buildRequestStats(families), [families]);

  return (
    <Card>
      <CardHeader>
        <MetricTitle
          title="라우트별 요청 수"
          metricNames={["http_requests_total"]}
          families={families}
        />
        <span className="font-mono text-[11px] text-zinc-500">total</span>
      </CardHeader>
      <CardBody className="p-0">
        {byRoute.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-zinc-500">
            아직 요청 기록이 없습니다.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">route</th>
                <th className="px-3 py-1.5 text-right font-medium">2xx</th>
                <th className="px-3 py-1.5 text-right font-medium">4xx</th>
                <th className="px-3 py-1.5 text-right font-medium">5xx</th>
                <th className="px-3 py-1.5 text-right font-medium">total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {byRoute.map((r) => (
                <tr key={r.route}>
                  <td className="px-3 py-1.5 font-mono">{r.route}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400">
                    {r.s2xx}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-amber-600 dark:text-amber-400">
                    {r.s4xx}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-red-600 dark:text-red-400">
                    {r.s5xx}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

type ApiRow = {
  route: string;
  method: string;
  count: number;
  /** 누적 bucket으로 추정한 p99 (초). */
  p99Sec: number | undefined;
};

function buildApiRows(families: Map<string, MetricFamily>): ApiRow[] {
  const bucketF = families.get("http_request_duration_seconds_bucket");
  const countF = families.get("http_request_duration_seconds_count");
  if (!bucketF || !countF) return [];
  const bucketsByKey = new Map<string, { le: number; cum: number }[]>();
  const countByKey = new Map<string, number>();
  const meta = new Map<string, { route: string; method: string }>();
  for (const s of bucketF.samples) {
    const route = s.labels.route ?? "?";
    const method = s.labels.method ?? "?";
    const k = `${route}|${method}`;
    const leLabel = s.labels.le ?? "+Inf";
    const le = leLabel === "+Inf" ? Infinity : Number(leLabel);
    let arr = bucketsByKey.get(k);
    if (!arr) {
      arr = [];
      bucketsByKey.set(k, arr);
    }
    arr.push({ le, cum: s.value });
    meta.set(k, { route, method });
  }
  for (const arr of bucketsByKey.values()) arr.sort((a, b) => a.le - b.le);
  for (const s of countF.samples) {
    const route = s.labels.route ?? "?";
    const method = s.labels.method ?? "?";
    const k = `${route}|${method}`;
    countByKey.set(k, (countByKey.get(k) ?? 0) + s.value);
  }
  const rows: ApiRow[] = [];
  for (const [k, m] of meta) {
    const count = countByKey.get(k) ?? 0;
    if (count === 0) continue;
    const buckets = bucketsByKey.get(k) ?? [];
    const p99Sec = quantileFromBuckets(buckets, count, 0.99);
    rows.push({ route: m.route, method: m.method, count, p99Sec });
  }
  rows.sort((a, b) => (b.p99Sec ?? 0) - (a.p99Sec ?? 0));
  return rows;
}

type RequestRow = {
  route: string;
  s2xx: number;
  s4xx: number;
  s5xx: number;
  total: number;
};

function buildRequestStats(families: Map<string, MetricFamily>): RequestRow[] {
  const f = families.get("http_requests_total");
  if (!f) return [];
  const byRoute = new Map<string, RequestRow>();
  for (const s of f.samples) {
    const route = s.labels.route ?? "?";
    const status = Number(s.labels.status ?? "0");
    const cur =
      byRoute.get(route) ??
      ({ route, s2xx: 0, s4xx: 0, s5xx: 0, total: 0 } as RequestRow);
    cur.total += s.value;
    if (status >= 200 && status < 300) cur.s2xx += s.value;
    else if (status >= 400 && status < 500) cur.s4xx += s.value;
    else if (status >= 500) cur.s5xx += s.value;
    byRoute.set(route, cur);
  }
  return [...byRoute.values()].sort((a, b) => b.total - a.total);
}

/**
 * 누적된 시리즈를 카드 한 장으로 렌더. 빈 시리즈는 placeholder.
 */
function ChartCard({
  title,
  unit,
  series,
  decimals,
  metricNames,
  families,
}: {
  title: string;
  unit: string;
  series: Series[];
  decimals: number;
  /** 이 카드가 시각화하는 메트릭 이름들. 호버 시 help 텍스트를 표시. */
  metricNames?: readonly string[];
  /** help 텍스트 lookup용. */
  families?: Map<string, MetricFamily>;
}) {
  return (
    <Card>
      <CardHeader>
        <MetricTitle title={title} metricNames={metricNames} families={families} />
        <span className="font-mono text-[11px] text-zinc-500">{unit}</span>
      </CardHeader>
      <CardBody>
        <Chart series={series} unit={unit} decimals={decimals} />
      </CardBody>
    </Card>
  );
}

/**
 * CardTitle을 Tooltip으로 감싸 호버 시 메트릭 이름과 HELP 문구를 보여준다.
 * metricNames가 없거나 families에 매칭되는 항목이 없으면 plain title.
 */
function MetricTitle({
  title,
  metricNames,
  families,
}: {
  title: string;
  metricNames?: readonly string[];
  families?: Map<string, MetricFamily>;
}) {
  const helps =
    metricNames && families
      ? metricNames
          .map((n) => ({ name: n, help: families.get(n)?.help }))
          .filter((x) => x.help)
      : [];
  if (helps.length === 0) {
    return <CardTitle>{title}</CardTitle>;
  }
  const content = (
    <div className="flex flex-col gap-1.5 max-w-xs text-left">
      {helps.map((h) => (
        <div key={h.name}>
          <div className="font-mono text-[10px] text-zinc-300">{h.name}</div>
          <div className="text-[11px] leading-snug">{h.help}</div>
        </div>
      ))}
    </div>
  );
  return (
    <Tooltip content={content}>
      <CardTitle>
        <span className="underline decoration-dotted decoration-zinc-300 underline-offset-4 dark:decoration-zinc-600">
          {title}
        </span>
      </CardTitle>
    </Tooltip>
  );
}

/**
 * SVG 라인 차트. 여러 시리즈를 한 평면에 겹쳐 그린다.
 */
function Chart({
  series,
  unit,
  decimals,
}: {
  series: Series[];
  /** 범례에 표시할 단위. */
  unit: string;
  /** 표시 소수자릿수. */
  decimals: number;
}) {
  // 솔로 모드: 한 시리즈만 보고 싶을 때 그 라벨로 set, 다시 누르면 null로 모두 표시.
  const [soloLabel, setSoloLabel] = useState<string | null>(null);
  const visibleSeries = soloLabel
    ? series.filter((s) => s.label === soloLabel)
    : series;
  // 호버 crosshair: SVG viewBox 좌표계 기준 x. null이면 미호버.
  const [hoverX, setHoverX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 560;
  const H = 100;
  const PAD_L = 40;
  const PAD_R = 6;
  const PAD_T = 6;
  const PAD_B = 14;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const allPoints = visibleSeries.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    return (
      <div className="flex h-[100px] items-center justify-center text-xs text-zinc-500">
        아직 데이터가 없습니다.
      </div>
    );
  }
  const minTs = Math.min(...allPoints.map((p) => p.ts));
  const maxTs = Math.max(...allPoints.map((p) => p.ts));
  const tsSpan = Math.max(1, maxTs - minTs);

  // yMax는 raw max로 nice 라운드. ticks도 같은 step으로 생성해 차트 밖으로 안 나가게.
  const rawMax = Math.max(0, ...allPoints.map((p) => p.value));
  const { yMax, ticks } = makeYAxis(rawMax);

  // 마우스 → viewBox x 변환. SVG의 client BBox를 viewBox 비율로 환산.
  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const xVb = ratio * W;
    if (xVb < PAD_L || xVb > W - PAD_R) {
      setHoverX(null);
      return;
    }
    setHoverX(xVb);
  }

  // 호버 x → 가장 가까운 ts와 시리즈별 값.
  const hover = hoverX !== null ? buildHover(hoverX) : null;
  function buildHover(xVb: number) {
    const ratio = (xVb - PAD_L) / innerW;
    const targetTs = minTs + ratio * tsSpan;
    const items = visibleSeries
      .map((s) => {
        if (s.points.length === 0) return null;
        let best = s.points[0]!;
        let bestDist = Math.abs(best.ts - targetTs);
        for (const p of s.points) {
          const d = Math.abs(p.ts - targetTs);
          if (d < bestDist) {
            bestDist = d;
            best = p;
          }
        }
        return { series: s, point: best };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (items.length === 0) return null;
    // 모든 시리즈 중 호버 ts에 가장 가까운 한 점 기준으로 시각/세로선 위치를 정한다.
    const anchor = items.reduce((a, b) =>
      Math.abs(a.point.ts - targetTs) < Math.abs(b.point.ts - targetTs) ? a : b,
    );
    const lineX = PAD_L + ((anchor.point.ts - minTs) / tsSpan) * innerW;
    return { items, anchor, lineX };
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverX(null)}
      >
        {/* 그리드 + Y축 라벨 */}
        {ticks.map((t, i) => {
          const y = PAD_T + innerH - (t / yMax) * innerH;
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y}
                y2={y}
                className="stroke-zinc-200 dark:stroke-zinc-800"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 4}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-zinc-500 font-mono text-[9px]"
              >
                {t.toFixed(decimals)}
              </text>
            </g>
          );
        })}
        {/* 시리즈 라인 */}
        {visibleSeries.map((s) => {
          if (s.points.length === 0) return null;
          const d = s.points
            .map((p, idx) => {
              const x = PAD_L + ((p.ts - minTs) / tsSpan) * innerW;
              const y =
                PAD_T + innerH - Math.min(1, p.value / yMax) * innerH;
              return `${idx === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(" ");
          return (
            <path
              key={s.label}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
        {/* 호버 crosshair: 가까운 시점의 세로선 + 시리즈별 점. */}
        {hover && (
          <g>
            <line
              x1={hover.lineX}
              x2={hover.lineX}
              y1={PAD_T}
              y2={PAD_T + innerH}
              className="stroke-zinc-400 dark:stroke-zinc-600"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            {hover.items.map(({ series: s, point: p }) => {
              const cy = PAD_T + innerH - Math.min(1, p.value / yMax) * innerH;
              return (
                <circle
                  key={s.label}
                  cx={hover.lineX}
                  cy={cy}
                  r={3}
                  fill={s.color}
                  className="stroke-white dark:stroke-zinc-950"
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        )}
        {/* X축 시간 라벨 — 양 끝은 부모 안쪽으로 anchor 분기. 중간 tick은 균등 분포. */}
        {(() => {
          const xTickCount = 4;
          const yLabel = H - PAD_B + 12;
          return Array.from({ length: xTickCount + 1 }, (_, i) => i).map((i) => {
            const ratio = i / xTickCount;
            const tsAt = minTs + tsSpan * ratio;
            const label = formatClockTime(tsAt);
            const x = PAD_L + ratio * innerW;
            const anchor =
              i === 0 ? "start" : i === xTickCount ? "end" : "middle";
            return (
              <text
                key={i}
                x={x}
                y={yLabel}
                textAnchor={anchor}
                className="fill-zinc-500 font-mono text-[9px]"
              >
                {label}
              </text>
            );
          });
        })()}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-zinc-200 bg-white/95 px-2 py-1 text-[10px] shadow-md dark:border-zinc-700 dark:bg-zinc-900/95"
          style={{
            left: `${(hover.lineX / W) * 100}%`,
            top: 0,
            transform:
              hover.lineX / W > 0.7 ? "translateX(-100%)" : "translateX(8px)",
          }}
        >
          <div className="mb-1 font-mono text-zinc-500">
            {formatClockTime(hover.anchor.point.ts)}
          </div>
          <div className="flex flex-col gap-0.5">
            {hover.items.map(({ series: s, point: p }) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="text-zinc-500">{s.label}</span>
                <span className="font-mono text-zinc-900 dark:text-zinc-100">
                  {p.value.toFixed(decimals)} {unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        {series.map((s) => {
          const last = s.points[s.points.length - 1];
          const isSolo = soloLabel === s.label;
          const isDimmed = soloLabel !== null && !isSolo;
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => setSoloLabel(isSolo ? null : s.label)}
              title={
                isSolo
                  ? "다시 눌러 모든 시리즈 보기"
                  : "이 시리즈만 보기"
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors",
                isSolo
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-900",
                isDimmed && "opacity-50",
              )}
            >
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="text-zinc-500">{s.label}</span>
              <span className="font-mono text-zinc-700 dark:text-zinc-300">
                {last ? `${last.value.toFixed(decimals)} ${unit}` : "-"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 폴링 데이터에서 시계열 시리즈를 누적. 마지막 N개 포인트만 보존.
 *
 * - cpu: process_cpu_seconds_total 도함수 (cores).
 * - memory: process_resident_memory_bytes (MB).
 * - eventLoop: nodejs_eventloop_lag_p99_seconds (ms).
 */
function useTimeSeries(families: Map<string, MetricFamily> | undefined) {
  const [series, setSeries] = useState<{
    cpu: Series[];
    memory: Series[];
    eventLoop: Series[];
  }>(() => initialSeries());

  // 직전 cpu 누적값을 보관해 차분으로 cores 계산.
  const lastCpuRef = useRef<{ user: number; system: number; ts: number } | null>(null);

  useEffect(() => {
    if (!families) return;
    const ts = Date.now();
    const userTotal =
      firstValue(families, "process_cpu_user_seconds_total") ??
      firstValue(families, "process_cpu_seconds_total");
    const systemTotal = firstValue(families, "process_cpu_system_seconds_total");
    const rss = firstValue(families, "process_resident_memory_bytes");
    const elP99 =
      firstValue(families, "nodejs_eventloop_lag_p99_seconds") ??
      firstValue(families, "nodejs_eventloop_lag_seconds");
    const elMean = firstValue(families, "nodejs_eventloop_lag_mean_seconds");

    let cpuUser: number | undefined;
    let cpuSys: number | undefined;
    if (userTotal !== undefined && lastCpuRef.current) {
      const dt = (ts - lastCpuRef.current.ts) / 1000;
      if (dt > 0) {
        cpuUser = (userTotal - lastCpuRef.current.user) / dt;
        if (systemTotal !== undefined)
          cpuSys = (systemTotal - lastCpuRef.current.system) / dt;
      }
    }
    if (userTotal !== undefined) {
      lastCpuRef.current = {
        user: userTotal,
        system: systemTotal ?? 0,
        ts,
      };
    }

     
    setSeries((prev) => ({
      cpu: appendMulti(
        prev.cpu,
        [
          { label: "user", color: "#0ea5e9", value: cpuUser },
          { label: "system", color: "#a855f7", value: cpuSys },
        ],
        ts,
      ),
      memory: appendMulti(
        prev.memory,
        [
          {
            label: "RSS",
            color: "#10b981",
            value: rss !== undefined ? rss / 1e6 : undefined,
          },
        ],
        ts,
      ),
      eventLoop: appendMulti(
        prev.eventLoop,
        [
          {
            label: "p99",
            color: "#f97316",
            value: elP99 !== undefined ? elP99 * 1000 : undefined,
          },
          {
            label: "mean",
            color: "#facc15",
            value: elMean !== undefined ? elMean * 1000 : undefined,
          },
        ],
        ts,
      ),
    }));
  }, [families]);

  return series;
}

function initialSeries() {
  return {
    cpu: [
      { label: "user", color: "#0ea5e9", points: [] as Point[] },
      { label: "system", color: "#a855f7", points: [] as Point[] },
    ],
    memory: [{ label: "RSS", color: "#10b981", points: [] as Point[] }],
    eventLoop: [
      { label: "p99", color: "#f97316", points: [] as Point[] },
      { label: "mean", color: "#facc15", points: [] as Point[] },
    ],
  };
}

/**
 * 라우트별 p99 레이턴시(ms)와 요청률(req/s)을 시계열로 누적.
 * - p99: bucket cumulative count의 *interval 차분*에서 99분위 보간 — 최근 폴링 윈도우 기준.
 * - 요청률: (count_now - count_prev) / dt.
 * 라우트는 동적이라 새 라우트가 등장하면 색상 풀에서 자동 할당.
 */
function useApiSeries(families: Map<string, MetricFamily> | undefined): {
  latency: Series[];
  rate: Series[];
} {
  const [series, setSeries] = useState<{ latency: Series[]; rate: Series[] }>({
    latency: [],
    rate: [],
  });
  // 라우트별 직전 누적 bucket counts + count + ts를 보관해 차분 계산.
  const lastRef = useRef<
    Map<
      string,
      { buckets: { le: number; cum: number }[]; count: number; ts: number }
    >
  >(new Map());

  useEffect(() => {
    if (!families) return;
    const ts = Date.now();
    const bucketF = families.get("http_request_duration_seconds_bucket");
    const countF = families.get("http_request_duration_seconds_count");
    if (!bucketF || !countF) return;

    // route|method 키별 bucket 시퀀스(le 오름차순) + 누적 count.
    const bucketsByKey = new Map<string, { le: number; cum: number }[]>();
    const countByKey = new Map<string, number>();
    for (const s of bucketF.samples) {
      const route = s.labels.route ?? "?";
      const method = s.labels.method ?? "?";
      const k = `${method} ${route}`;
      const leLabel = s.labels.le ?? "+Inf";
      const le = leLabel === "+Inf" ? Infinity : Number(leLabel);
      let arr = bucketsByKey.get(k);
      if (!arr) {
        arr = [];
        bucketsByKey.set(k, arr);
      }
      arr.push({ le, cum: s.value });
    }
    for (const arr of bucketsByKey.values()) arr.sort((a, b) => a.le - b.le);
    for (const s of countF.samples) {
      const route = s.labels.route ?? "?";
      const method = s.labels.method ?? "?";
      const k = `${method} ${route}`;
      countByKey.set(k, (countByKey.get(k) ?? 0) + s.value);
    }

    const latencyUpdates: { label: string; value: number | undefined }[] = [];
    const rateUpdates: { label: string; value: number | undefined }[] = [];
    for (const [k, bucketsNow] of bucketsByKey) {
      const countNow = countByKey.get(k) ?? 0;
      const prev = lastRef.current.get(k);
      if (prev) {
        const dCount = countNow - prev.count;
        const dt = (ts - prev.ts) / 1000;
        const reqPerSec = dt > 0 ? dCount / dt : 0;
        // bucket 차분으로 interval 동안의 p99 산출.
        const deltaBuckets = subtractBuckets(bucketsNow, prev.buckets);
        const p99Sec = quantileFromBuckets(deltaBuckets, dCount, 0.99);
        if (p99Sec !== undefined) {
          latencyUpdates.push({ label: k, value: p99Sec * 1000 });
        }
        rateUpdates.push({ label: k, value: reqPerSec });
      }
      lastRef.current.set(k, { buckets: bucketsNow, count: countNow, ts });
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeries((prev) => ({
      latency: ensureAndAppend(prev.latency, latencyUpdates, ts),
      rate: ensureAndAppend(prev.rate, rateUpdates, ts),
    }));
  }, [families]);

  return series;
}

/**
 * 두 bucket 시퀀스(le 오름차순, 같은 le 셋)의 cum 차분.
 * 결과도 cumulative이며 음수가 되면 0으로 클램프 (관측 시작/리셋 대비).
 */
function subtractBuckets(
  now: { le: number; cum: number }[],
  prev: { le: number; cum: number }[],
): { le: number; cum: number }[] {
  const prevMap = new Map(prev.map((b) => [b.le, b.cum]));
  return now.map((b) => ({
    le: b.le,
    cum: Math.max(0, b.cum - (prevMap.get(b.le) ?? 0)),
  }));
}

/**
 * Prometheus histogram_quantile과 동일한 선형 보간으로 q분위 추정.
 * cumulative buckets는 le 오름차순 + 마지막 +Inf bucket 포함이어야 한다.
 */
function quantileFromBuckets(
  buckets: { le: number; cum: number }[],
  totalCount: number,
  q: number,
): number | undefined {
  if (buckets.length < 2 || totalCount <= 0) return undefined;
  const target = q * totalCount;
  // 마지막 +Inf cumulative를 totalCount로 신뢰.
  for (let i = 0; i < buckets.length; i++) {
    const cur = buckets[i]!;
    if (cur.cum >= target) {
      const prev = i === 0 ? { le: 0, cum: 0 } : buckets[i - 1]!;
      const lower = prev.le;
      const upper = cur.le;
      if (!Number.isFinite(upper)) return lower;
      const cumLower = prev.cum;
      const cumUpper = cur.cum;
      const frac =
        cumUpper - cumLower > 0 ? (target - cumLower) / (cumUpper - cumLower) : 0;
      return lower + (upper - lower) * frac;
    }
  }
  return undefined;
}

/**
 * 시리즈 셋에 새 데이터를 append. 등장하지 않은 라벨은 즉석에서 시리즈 추가.
 */
function ensureAndAppend(
  prev: Series[],
  updates: { label: string; value: number | undefined }[],
  ts: number,
): Series[] {
  const map = new Map(prev.map((s) => [s.label, s]));
  for (const u of updates) {
    if (u.value === undefined) continue;
    let s = map.get(u.label);
    if (!s) {
      s = {
        label: u.label,
        color: pickColor(map.size),
        points: [],
      };
      map.set(u.label, s);
    }
    const next = [...s.points, { ts, value: u.value }];
    if (next.length > MAX_POINTS) next.splice(0, next.length - MAX_POINTS);
    map.set(u.label, { ...s, points: next });
  }
  return [...map.values()];
}

const SERIES_COLOR_POOL = [
  "#0ea5e9",
  "#10b981",
  "#f97316",
  "#a855f7",
  "#ef4444",
  "#facc15",
  "#06b6d4",
  "#84cc16",
  "#ec4899",
  "#6366f1",
];

function pickColor(idx: number): string {
  return SERIES_COLOR_POOL[idx % SERIES_COLOR_POOL.length]!;
}

function appendMulti(
  prev: Series[],
  updates: { label: string; color: string; value: number | undefined }[],
  ts: number,
): Series[] {
  return prev.map((s) => {
    const upd = updates.find((u) => u.label === s.label);
    if (!upd || upd.value === undefined) return s;
    const next = [...s.points, { ts, value: upd.value }];
    if (next.length > MAX_POINTS) next.splice(0, next.length - MAX_POINTS);
    return { ...s, points: next };
  });
}

/**
 * Y축 nice 스케일. yMax와 ticks가 같은 step으로 정확히 끝까지 떨어지도록 보장한다.
 * (이전에 max를 약간 부풀려 곱하면 ticks가 yMax 위로 튀어 차트 밖에 라벨이 나갔다.)
 */
function makeYAxis(rawMax: number): { yMax: number; ticks: number[] } {
  const safe = rawMax <= 0 ? 1 : rawMax;
  // 원하는 tick 수를 4로 두고 step을 nice ceil로 정한 뒤 yMax = step*4.
  const step = niceCeil(safe / 4);
  const yMax = step * 4;
  const ticks = [0, step, step * 2, step * 3, yMax];
  return { yMax, ticks };
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const norm = v / base;
  let nice: number;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

/** HH:MM:SS 형식. x축 시간 라벨에 사용. */
function formatClockTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(0)}초`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m < 60) return `${m}분 ${s}초`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}시간 ${mm}분`;
}
