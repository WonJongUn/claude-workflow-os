/**
 * Prometheus exposition 텍스트 파서.
 * 작은 부분집합만 지원: HELP/TYPE 라인 + `name{labels} value` 본문 라인.
 * 우리 자체 /api/metrics 응답을 다루는 용도라 quoted-value escape도 단순 처리.
 */

export type MetricSample = {
  /** 라벨 맵. 라벨 없으면 빈 객체. */
  labels: Record<string, string>;
  /** 숫자 값. NaN은 제외. */
  value: number;
};

/** 한 메트릭 패밀리(같은 이름의 여러 샘플 묶음). HELP/TYPE 라인에서 메타가 채워진다. */
export type MetricFamily = {
  /** 메트릭 이름 (e.g. "http_requests_total"). */
  name: string;
  /** HELP 라인에서 추출한 사람 읽기용 설명. */
  help?: string;
  /** TYPE 라인에서 추출한 메트릭 종류. */
  type?: "counter" | "gauge" | "histogram" | "summary" | "untyped";
  /** 라벨 조합별 샘플들. 빈 배열일 수 있다. */
  samples: MetricSample[];
};

/**
 * 텍스트 본문을 메트릭 패밀리 맵으로 파싱.
 */
export function parsePrometheus(text: string): Map<string, MetricFamily> {
  const families = new Map<string, MetricFamily>();

  function ensure(name: string): MetricFamily {
    let f = families.get(name);
    if (!f) {
      f = { name, samples: [] };
      families.set(name, f);
    }
    return f;
  }

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.startsWith("# HELP ")) {
      const rest = line.slice(7);
      const sp = rest.indexOf(" ");
      if (sp > 0) {
        const name = rest.slice(0, sp);
        ensure(name).help = rest.slice(sp + 1);
      }
      continue;
    }
    if (line.startsWith("# TYPE ")) {
      const rest = line.slice(7);
      const sp = rest.indexOf(" ");
      if (sp > 0) {
        const name = rest.slice(0, sp);
        const t = rest.slice(sp + 1) as MetricFamily["type"];
        ensure(name).type = t;
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    const sample = parseSample(line);
    if (sample) ensure(sample.name).samples.push({ labels: sample.labels, value: sample.value });
  }
  return families;
}

function parseSample(
  line: string,
): { name: string; labels: Record<string, string>; value: number } | null {
  // 형식: name{a="b",c="d"} value [timestamp]  또는  name value
  const braceStart = line.indexOf("{");
  let name: string;
  let labels: Record<string, string> = {};
  let rest: string;
  if (braceStart >= 0) {
    name = line.slice(0, braceStart);
    const braceEnd = line.indexOf("}", braceStart);
    if (braceEnd < 0) return null;
    labels = parseLabels(line.slice(braceStart + 1, braceEnd));
    rest = line.slice(braceEnd + 1).trim();
  } else {
    const sp = line.indexOf(" ");
    if (sp < 0) return null;
    name = line.slice(0, sp);
    rest = line.slice(sp + 1).trim();
  }
  const valueStr = rest.split(/\s+/)[0];
  const value = Number(valueStr);
  if (!Number.isFinite(value)) return null;
  return { name, labels, value };
}

function parseLabels(body: string): Record<string, string> {
  // 단순 파서: a="b",c="d". 값에 escape된 따옴표는 우리 generator에서 안 씀.
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out[m[1]!] = m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return out;
}

/**
 * 패밀리에서 첫 sample의 값을 꺼내는 헬퍼. 없으면 undefined.
 */
export function firstValue(
  families: Map<string, MetricFamily>,
  name: string,
  labelMatch?: (labels: Record<string, string>) => boolean,
): number | undefined {
  const f = families.get(name);
  if (!f) return undefined;
  const s = labelMatch
    ? f.samples.find((s) => labelMatch(s.labels))
    : f.samples[0];
  return s?.value;
}
