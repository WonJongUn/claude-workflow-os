import os from "node:os";
import path from "node:path";

/**
 * 글로벌 Claude 컨텍스트 루트(.claude 디렉토리) 절대 경로.
 * CLAUDE_PROJECT_ROOT 환경변수로 오버라이드 가능 (테스트/멀티 환경).
 * 미설정 시 ~/.claude.
 */
export function projectRoot(): string {
  return process.env.CLAUDE_PROJECT_ROOT ?? path.join(os.homedir(), ".claude");
}

/**
 * 티켓 JSON과 부속 파일(.projects.json, .subscriptions.json 등)이 저장되는
 * 작업 디렉토리. 항상 프로세스 cwd 기준의 ./tickets.
 */
export function ticketsDir(): string {
  return path.join(process.cwd(), "tickets");
}
