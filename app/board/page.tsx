import { CreateTicketButton } from "../components/CreateTicketButton";
import { TicketBoard } from "../components/TicketBoard";

export default function BoardPage() {
  return (
    <div className="flex w-full flex-col gap-6 py-6 pl-8 pr-16 2xl:pl-12 2xl:pr-20">
      <header className="flex items-baseline justify-between gap-4">
        <div className="flex flex-col">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            칸반보드
          </h1>
          <p className="text-xs text-zinc-500">
            티켓 상태 전이는 컬럼 카드의 액션 버튼으로 진행합니다.
          </p>
        </div>
        <CreateTicketButton />
      </header>
      <TicketBoard />
    </div>
  );
}
