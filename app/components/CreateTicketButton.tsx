"use client";

import { useState } from "react";
import { FilePlus2 } from "lucide-react";
import { Button, Modal } from "./ui";
import { NewTicketForm } from "./NewTicketForm";

/** "새 티켓" CTA 버튼 + NewTicketForm 모달 묶음. 보드 헤더에서 사용. */
export function CreateTicketButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  return (
    <>
      <Button size="md" onClick={() => setOpen(true)}>
        <FilePlus2 className="mr-1.5 h-4 w-4" aria-hidden />
        새 티켓
      </Button>
      <Modal open={open} onClose={close} title="새 티켓 생성" size="lg">
        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        <NewTicketForm onClose={close} onError={setError} />
      </Modal>
    </>
  );
}
