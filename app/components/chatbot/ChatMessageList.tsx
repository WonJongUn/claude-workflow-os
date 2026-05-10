"use client";

import { useEffect, useRef } from "react";
import { Bot, Wrench } from "lucide-react";
import { cn } from "@/app/components/ui/cn";
import { SessionMarkdown } from "@/app/components/SessionMarkdown";
import type { ChatMessage } from "./use-chatbot";

/**
 * 챗봇 메시지 스크롤 영역. 새 메시지/스트리밍 청크가 들어오면 하단으로 자동 스크롤.
 * 사용자가 위로 스크롤한 상태면 자동 스크롤하지 않는다(읽는 중 방해 방지).
 */
export function ChatMessageList({
  messages,
  isStreaming,
}: {
  /** 누적 메시지. 시간순 오름차순. */
  messages: ChatMessage[];
  /** 응답 스트리밍 중. 아래 점 인디케이터 표시. */
  isStreaming: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottomRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      }}
      className="scroll-thin flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3"
    >
      {messages.length === 0 ? (
        <div className="grid h-full place-items-center text-center text-xs text-zinc-500">
          무엇이든 물어보세요.
          <br />
          닫아도 다음에 열면 이어집니다.
        </div>
      ) : (
        messages.map((m) => <MessageBubble key={m.id} message={m} />)
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex items-start gap-2",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <div
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
        >
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] space-y-1.5 px-3 py-2 text-sm",
          isUser
            ? "rounded-2xl rounded-tr-sm bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "rounded-2xl rounded-tl-sm bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100",
        )}
      >
        {message.blocks.length === 0 && message.pending ? (
          <PendingDots />
        ) : (
          message.blocks.map((b, i) =>
            b.kind === "text" ? (
              isUser ? (
                <div key={i} className="whitespace-pre-wrap break-words">
                  {b.text}
                </div>
              ) : (
                <SessionMarkdown key={i} text={b.text} />
              )
            ) : (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400"
              >
                <Wrench className="h-3 w-3 shrink-0" aria-hidden />
                <span className="font-semibold">{b.name}</span>
                {b.summary && (
                  <span className="truncate text-zinc-500">{b.summary}</span>
                )}
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}

function PendingDots() {
  return (
    <div className="flex gap-1 py-1" aria-label="응답 중">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
    </div>
  );
}
