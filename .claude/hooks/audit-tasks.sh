#!/bin/sh
# Stop hook — 턴 종료 시 가장 최근 TodoWrite 호출에 pending/in_progress todo 가
# 남아있으면 block (exit 2). 작업 마감을 강제하기 위함.
#
# 외부 의존성 없음 — POSIX sh + awk 만 사용.
#
# 우회: 환경변수 CLAUDE_AUDIT_TASKS_BYPASS=1.

[ "${CLAUDE_AUDIT_TASKS_BYPASS:-}" = "1" ] && exit 0

input=$(cat)

# 무한 루프 방지: 같은 Stop 훅이 이미 한 번 작동해 reentry 한 케이스는 통과.
case "$input" in
  *'"stop_hook_active":true'*) exit 0 ;;
esac

transcript=$(printf '%s' "$input" | sed -n 's/.*"transcript_path":"\([^"]*\)".*/\1/p' | head -n 1)
[ -z "$transcript" ] && exit 0
[ -f "$transcript" ] || exit 0

# 가장 최근 TodoWrite 라인에서 pending/in_progress 항목의 content 를 모은다.
# 출력 포맷: 첫 줄 = 미완료 개수, 이후 줄들 = "  - <content>" (최대 8개).
report=$(awk '
  /"name":"TodoWrite"/ { last = $0 }
  END {
    if (last == "") exit
    # todos 배열의 각 항목은 {"content":"...","status":"...","activeForm":"..."} 모양.
    # status 가 pending/in_progress 인 항목의 content 를 추출.
    leftover_count = 0
    rest = last
    while (match(rest, /"content":"[^"]*","status":"(pending|in_progress)"/)) {
      hit = substr(rest, RSTART, RLENGTH)
      if (sub(/.*"content":"/, "", hit)) {
        sub(/","status":".*/, "", hit)
        leftover_count++
        if (leftover_count <= 8) leftovers[leftover_count] = hit
      }
      rest = substr(rest, RSTART + RLENGTH)
    }
    if (leftover_count == 0) exit
    print leftover_count
    for (i = 1; i <= leftover_count && i <= 8; i++) print "  - " leftovers[i]
    if (leftover_count > 8) print "  ... and " (leftover_count - 8) " more"
  }
' "$transcript")

# 미완료 없음 → 통과.
[ -z "$report" ] && exit 0

count=$(printf '%s\n' "$report" | head -n 1)
list=$(printf '%s\n' "$report" | tail -n +2)

{
  printf '%s\n' "[audit-tasks] 미완료 todo 가 ${count}개 남아있습니다. 모두 completed 로 닫은 뒤 다시 종료하세요. (긴급 우회: CLAUDE_AUDIT_TASKS_BYPASS=1)"
  printf '%s\n' "$list"
} >&2
exit 2
