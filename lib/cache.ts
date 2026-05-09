import { Counter, Gauge } from "prom-client";
import { registry } from "./metrics";

/**
 * 통합 인메모리 캐시. 모든 인스턴스가 같은 Prometheus 메트릭에 name 라벨로 기록한다.
 *
 * 메트릭:
 * - cache_hits_total{name}
 * - cache_misses_total{name}
 * - cache_size{name} (현재 항목 수)
 *
 * 의도적으로 단순: TTL/LRU/eviction 없음. mtime 기반 invalidation은 호출자가 set으로 직접 갱신.
 */

const cacheHitsTotal: Counter<"name"> =
  (registry.getSingleMetric("cache_hits_total") as Counter<"name"> | undefined) ??
  new Counter({
    name: "cache_hits_total",
    help: "Total cache hits by named cache.",
    labelNames: ["name"],
    registers: [registry],
  });

const cacheMissesTotal: Counter<"name"> =
  (registry.getSingleMetric("cache_misses_total") as Counter<"name"> | undefined) ??
  new Counter({
    name: "cache_misses_total",
    help: "Total cache misses by named cache.",
    labelNames: ["name"],
    registers: [registry],
  });

const cacheSize: Gauge<"name"> =
  (registry.getSingleMetric("cache_size") as Gauge<"name"> | undefined) ??
  new Gauge({
    name: "cache_size",
    help: "Number of entries currently held by named cache.",
    labelNames: ["name"],
    registers: [registry],
  });

/**
 * 이름이 부여된 인메모리 캐시. createCache로 생성하며, 모든 메서드가 같은
 * Prometheus 메트릭에 name 라벨로 기록된다. TTL/LRU 없음.
 */
export interface NamedCache<K, V> {
  /** 조회. 키 존재 시 hit, 아니면 miss로 카운트. */
  get(key: K): V | undefined;
  /** 저장. 새 키면 size 증가. */
  set(key: K, value: V): void;
  /** 키 명시 존재 여부. hit/miss 카운트 영향 없음. */
  has(key: K): boolean;
  /** 단건 삭제. 성공 시 size 감소. */
  delete(key: K): boolean;
  /** 전부 비우기. */
  clear(): void;
  /** 현재 항목 수. */
  size(): number;
}

/**
 * 새 named cache 인스턴스. 같은 name으로 여러 번 호출하면 메트릭이 합산되니
 * 이름은 모듈 단위로 유일하게 부여한다.
 */
export function createCache<K, V>(name: string): NamedCache<K, V> {
  const map = new Map<K, V>();
  // 초기 size를 한 번 게시해 차트의 시작점을 0으로 안착.
  cacheSize.set({ name }, 0);
  return {
    get(key) {
      if (map.has(key)) {
        cacheHitsTotal.inc({ name });
        return map.get(key);
      }
      cacheMissesTotal.inc({ name });
      return undefined;
    },
    set(key, value) {
      map.set(key, value);
      cacheSize.set({ name }, map.size);
    },
    has(key) {
      return map.has(key);
    },
    delete(key) {
      const ok = map.delete(key);
      if (ok) cacheSize.set({ name }, map.size);
      return ok;
    },
    clear() {
      map.clear();
      cacheSize.set({ name }, 0);
    },
    size() {
      return map.size;
    },
  };
}
