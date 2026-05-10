/**
 * Next.js 부트 훅. Node.js 런타임에서 한 번만 호출되어 백그라운드 워커를 시작한다.
 * Edge 런타임에서는 child_process를 쓸 수 없으므로 명시적으로 분기한다.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTicketWorker } = await import("./lib/ticket-worker");
  startTicketWorker();
}
