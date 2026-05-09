"use client";

import type { ReactNode } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

type ConfirmDialogProps = {
  /** 다이얼로그 표시 여부. */
  open: boolean;
  /** 헤더 제목. */
  title: string;
  /** 본문 메시지. 문자열 또는 풍부한 노드를 넣을 수 있다 (강조/리스트 등). */
  message: ReactNode;
  /** 확인 버튼 라벨. 기본 "확인". */
  confirmLabel?: string;
  /** 취소 버튼 라벨. 기본 "취소". */
  cancelLabel?: string;
  /** 확인 버튼 강조도. 위험한 작업이면 danger. */
  variant?: "primary" | "danger";
  /** 모달 크기. 기본 md. 본문에 리스트가 들어가면 lg/xl 권장. */
  size?: "md" | "lg" | "xl";
  /** 확인 클릭. */
  onConfirm: () => void;
  /** 취소 또는 백드롭/ESC 클릭. */
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "확인",
  cancelLabel = "취소",
  variant = "primary",
  size = "md",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size={size}>
      <div className="text-sm text-zinc-700 dark:text-zinc-300">{message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={variant === "danger" ? "danger" : "primary"}
          size="sm"
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
