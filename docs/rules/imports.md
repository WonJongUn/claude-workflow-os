# Import 경로 규칙

`tsconfig.json`에 `@/* → ./*` alias가 설정되어 있다. 이를 일관되게 사용한다.

## 언제 `@/`를 쓰나

**계층(layer)을 가로지를 때.** 예:

- `app/components/X.tsx` → `lib/types`: `import { Ticket } from "@/lib/types"`
- `app/api/.../route.ts` → `lib/...`: `import { ... } from "@/lib/..."`
- `lib/X.ts` → `lib/Y.ts`도 OK (`./Y` 도 가능; 짧은 쪽 선호)

이유: 계층 간 의존을 한눈에 파악할 수 있다. `../../../lib/types` 같은 경로는 의도가 흐려진다.

## 언제 `./`를 쓰나

**같은 모듈/폴더 내부.** 예:

- `app/components/TicketBoard.tsx` → `app/components/TicketColumn.tsx`: `./TicketColumn`
- `app/components/ui/Button.tsx` → `app/components/ui/cn.ts`: `./cn`

이유: 같은 응집 단위 안의 파일은 짧게 쓰는 게 가독성에 좋고, 폴더째 옮길 때 깨지지 않는다.

## 금지

- `../../` 두 단계 이상의 상대 경로 — 무조건 `@/` 별칭으로 바꾼다.
- 파일 확장자 포함 (`./Foo.tsx`) — Next/TS가 자동 해석.
- index 파일 명시적 import (`./ui/index`) — `./ui`로 쓴다.

## Barrel(index.ts)

- `app/components/ui/index.ts`처럼 작은 응집 단위에서만 사용.
- `lib/`에 거대 barrel 만들지 않는다. tree-shaking 손해 + 순환 의존 위험.

## 그룹/정렬

ESLint가 자동 정렬하지 않으면 수동으로 다음 순서:

1. Node/내장 (`node:fs`)
2. 외부 패키지 (`react`, `next`, `axios`)
3. `@/lib/...`
4. `@/app/...`
5. 상대 경로 (`./...`, `../...`)

각 그룹 사이 빈 줄 권장.
