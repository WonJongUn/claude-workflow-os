#!/bin/sh
# PreToolUse hook — Edit/Write/MultiEdit/NotebookEdit 직전에 실행.
# 가장 최근 TodoWrite 호출에 in_progress 상태의 todo 가 하나도 없으면 block (exit 2).
#
# 의도: 코드를 수정하기 전에 TodoWrite 로 작업을 in_progress 상태로 잡는 절차를 강제.
# 외부 의존성 없음 — POSIX sh + awk 만 사용.
#
# 우회: 환경변수 CLAUDE_REQUIRE_TASK_BYPASS=1.

[ "${CLAUDE_REQUIRE_TASK_BYPASS:-}" = "1" ] && exit 0

input=$(cat)

# tool_name 이 Edit 계열일 때만 검사. 그 외에는 통과.
case "$input" in
  *'"tool_name":"Edit"'*) ;;
  *'"tool_name":"Write"'*) ;;
  *'"tool_name":"MultiEdit"'*) ;;
  *'"tool_name":"NotebookEdit"'*) ;;
  *) exit 0 ;;
esac

# transcript 경로 추출. 없거나 실파일 없으면 통과 (정상 동작 보장).
transcript=$(printf '%s' "$input" | sed -n 's/.*"transcript_path":"\([^"]*\)".*/\1/p' | head -n 1)
[ -z "$transcript" ] && exit 0
[ -f "$transcript" ] || exit 0

# 가장 최근 TodoWrite 호출 라인을 찾아 in_progress 개수 카운트.
# transcript 가 jsonl 이라 한 라인 = 한 메시지. TodoWrite 호출의 todos 배열은
# 그 라인 안에 인라인으로 직렬화되어 있으므로 line scope 만 보면 충분.
inprog=$(awk '
  /"name":"TodoWrite"/ { last = $0 }
  END {
    if (last == "") { print "NO_TODOWRITE"; exit }
    count = 0
    n = split(last, parts, /"status":"in_progress"/)
    if (n > 1) count = n - 1
    print count
  }
' "$transcript")

# 세션 시작 직후 — 아직 한 번도 TodoWrite 안 부른 케이스는 통과.
[ "$inprog" = "NO_TODOWRITE" ] && exit 0

# in_progress 개수가 0 이면 block.
if [ "${inprog:-0}" -eq 0 ] 2>/dev/null; then
  printf '%s\n' "[require-task] Edit/Write 차단: in_progress 상태인 todo 가 없습니다. TodoWrite 로 작업을 in_progress 로 표시한 뒤 다시 시도하세요. (긴급 우회: CLAUDE_REQUIRE_TASK_BYPASS=1)" >&2
  exit 2
fi

exit 0
