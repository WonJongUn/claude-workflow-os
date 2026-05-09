# 렌더링 최적화 규칙

UI는 즉각 반응해야 한다. 큰 비용은 측정하고 의도적으로 지불한다.

## 기본 원칙

- **Server Component 우선**: 상호작용·브라우저 API가 필요할 때만 `"use client"`. 데이터 페칭/마크업은 서버에서.
- **클라이언트 번들 최소화**: 무거운 라이브러리(차트/마크다운/에디터 등)는 동적 import (`next/dynamic`) + `ssr: false` 옵션 검토.
- **이미지/폰트는 Next 최적화 사용**: `next/image`, `next/font`. raw `<img>` 금지.

## React 렌더 비용

- 부모가 리렌더되면 자식도 리렌더된다는 사실을 인지한다. 큰 리스트의 부모를 자주 갱신하지 말 것.
- **메모이제이션은 측정 후**: `useMemo`/`useCallback`/`React.memo`는 자동이 아니다. 다음일 때만 적용:
  - 자식이 `React.memo`이고, props가 매번 새 참조였던 경우
  - 무거운 계산 (`O(n log n)` 이상)을 매 렌더 반복할 때
  - 리스트 아이템 컴포넌트가 수십 개 이상일 때
- 그 외에는 메모를 추가하지 않는다 — 메모 자체가 비용이고 코드 노이즈다.

## 리스트

- `key`는 안정적인 도메인 ID (`ticket.id`). 인덱스 금지.
- 200개 이상 가능성이 있으면 가상화 (`@tanstack/react-virtual`) 검토.
- 카드 컴포넌트는 가능한 한 `React.memo` 후보. props가 단순 props가 되도록 부모에서 콜백을 안정화 (`useCallback` 또는 ref 전달).

## 데이터 페칭

- TanStack Query 캐시가 진실의 원천. 같은 데이터에 두 번 `fetch` 금지.
- 변경은 `setQueryData`로 즉시 반영. `invalidateQueries`는 정합성 의심 시에만.
- SSE 이벤트는 `setQueryData` 머지. **refetch 트리거 금지** — 서버 라운드트립 낭비.
- SSE/WebSocket이 가능한 도메인에서 폴링 금지. 단, **파일시스템 변화처럼 push 소스가 없는** 데이터(세션 jsonl, 컨텍스트 파일)는 5초 폴링 + 백그라운드 탭 멈춤 + 포커스 시 즉시 갱신 (design.md "갱신·로딩 표시" 참조).

## React Query 키

- 도메인 단위로 키를 분할 (`["tickets"]`, `["tickets", id]`, `["context"]`).
- 한 화면이 여러 키를 구독해도 OK — 키별 캐시 수명을 따로 다룰 수 있다.

## 상태 위치

- 상태는 사용 지점에 가깝게. 폼 입력 상태를 부모에 두지 말 것 (불필요한 부모 리렌더).
- 보드 전체가 알 필요 없는 카드 로컬 UI 상태(예: 펼침 토글)는 카드 안에서 관리.

## 비용이 큰 작업

- 큰 JSON/마크다운 파싱은 가급적 서버에서 (route handler 또는 server component).
- 클라에서 불가피하면 Web Worker 검토.
- 디바운스/쓰로틀: 입력 → 네트워크 가는 흐름에 적용 (300ms 기본).

## 측정

- 의심되는 부분만 React DevTools Profiler로 확인 후 최적화. **추측으로 최적화 금지**.
- production build로 측정한다 (`pnpm build && pnpm start`). dev mode 수치는 신뢰하지 않는다.
- 서버 라우트는 `/monitoring` 페이지의 라우트별 p99 레이턴시 차트로 본다 (prom-client + `withMetrics`).

## 서버 캐시

반복 호출이 많은 disk IO/파싱은 `lib/cache.ts`의 `createCache(name)`을 사용한다.

- 자체 `Map`으로 인라인 캐시 만들지 말 것 — 메트릭(`cache_hits_total`, `cache_misses_total`, `cache_size`)이 누락된다.
- invalidation 키는 **mtime+size** 조합을 권장. jsonl처럼 append-only면 mtime만으로도 안전.
- **여러 파일이 한 응답에 합쳐지는 경우(세션 메인 + 서브에이전트 등)**는 단일 파일 mtime/size로 부족. `readSessionBundle`처럼 모든 구성 파일의 `(path, mtime, size)`를 정렬해 직렬화한 **fingerprint** 문자열을 키로 쓴다.
- TTL 기반 캐시는 stale을 허용해 도메인이 깨질 수 있으니, 가능하면 mtime 기반으로.
- 캐시 이름은 `kebab-case`로 모듈 단위 유일하게 (`replay-task-timeline`, `runtime-statuses` 등). 같은 이름을 여러 인스턴스가 공유하면 메트릭이 합산된다.
- **Eviction 주의**: 외부에서 파일이 삭제되면 mtime 기반 캐시는 stat 실패로 stale 엔트리를 갖게 된다. 영구 누적이 우려되면 stat 실패 분기에서 `cache.delete(key)` 호출하거나, 주기적으로 prune.

### 304 Not Modified

큰 응답(jsonl 본문 등)을 5초마다 다시 보내는 라우트는 ETag로 304 처리한다. 클라(브라우저)가 자동으로 `If-None-Match`를 보내고, 일치하면 서버는 본문 없이 `304`로 응답한다.

ETag 형식: **`"<schemaVersion>-<contentHash>"`**

- `schemaVersion`은 응답 JSON shape이 바뀔 때 bump한다 (예: `v1` → `v2`). 그러면 브라우저가 가지고 있던 옛 etag와 매치되지 않아 새 본문을 받게 된다 — shape 변경 시 캐시 자동 무효화.
- `contentHash`는 본문 fingerprint(파일 mtime+size 합산 해시 등)에서 파생. 파일이 변하면 자동 무효화.

```ts
const SCHEMA_VERSION = "v2"; // 응답 shape 바뀔 때 bump
const etag = `"${SCHEMA_VERSION}-${hashString(bundle.fingerprint)}"`;
if (request.headers.get("if-none-match") === etag) {
  return new Response(null, { status: 304, headers: { etag, "cache-control": "private, max-age=0, must-revalidate" } });
}
```

```ts
const cache = createCache<string, { mtimeMs: number; size: number; result: T }>("my-cache");
const stat = await fs.stat(p);
const c = cache.get(p);
if (c && c.mtimeMs === stat.mtimeMs && c.size === stat.size) return c.result;
const result = await heavyParse(p);
cache.set(p, { mtimeMs: stat.mtimeMs, size: stat.size, result });
return result;
```

## 디스크 IO

- 같은 디렉토리의 여러 파일을 처리할 땐 `Promise.all`로 병렬화. for 루프 안 직렬 stat/readFile은 N×latency.
- `fs.readdir({ withFileTypes: true })`로 한 번에 메타데이터 + 디렉토리 구분.
- 모든 프로젝트 디렉토리를 매 요청마다 스캔하는 패턴은 캐시 후보 (`runtime-statuses`, `session-path`).

## 합본 본문의 시간 정렬

세션 본문은 메인 jsonl 뒤에 서브에이전트 jsonl을 파일 순서로 concat한 결과 (`readSessionBundle`)라 **라인 순서가 시간순이 아니다**. 시간순 가정을 하는 모든 파서/뷰는 파싱 후 ts로 정렬해야 한다.

- `parseLog` (SessionLogView): ts ASC, ts 없는 라인은 안정 정렬.
- `parseConversation`: ts DESC (최신이 위).
- `buildTrace` (V2): ts ASC, 그 위에서 turn 경계 결정.
- 카운터/스트림 상태 머신(replay 등)은 사이드체인 라인을 skip해야 id 충돌이 없음 (`replaySessionTaskTimeline`).

## 금지

- 컴포넌트 함수 안에서 객체/배열을 매번 새로 만들어 자식에 props로 내림 (`<Card data={{...x}} />`)
- 부모 컴포넌트가 SSE/타이머로 1초마다 setState (자식 모두 리렌더)
- 무지성 `useMemo`/`useCallback` (의존성 실수로 stale 캡처 위험만 추가)
- `console.log`를 production 코드에 남김
