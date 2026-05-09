import os from "node:os";
import path from "node:path";

export function projectRoot(): string {
  return process.env.CLAUDE_PROJECT_ROOT ?? path.join(os.homedir(), ".claude");
}

export function ticketsDir(): string {
  return path.join(process.cwd(), "tickets");
}
