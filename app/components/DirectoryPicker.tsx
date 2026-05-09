"use client";

import { useEffect, useState } from "react";
import type { DirListing } from "@/lib/fs-browse";
import { Badge, Button, Modal, cn, inputBaseClass } from "./ui";
import { browseFs } from "./project-client";

type DirectoryPickerProps = {
  /** 모달 표시 여부. */
  open: boolean;
  /** 닫기 (취소 또는 선택 완료 후 호출자가 닫음). */
  onClose: () => void;
  /** 선택 확정 시 호출. 절대 경로를 전달. */
  onSelect: (absolutePath: string) => void;
  /** 시작 경로. 미지정 시 사용자 홈. */
  initialPath?: string;
};

/**
 * 서버 파일시스템 디렉토리 브라우저. 한 단계씩 내려가며 폴더를 선택한다.
 * .claude 디렉토리가 있는 폴더에는 표식을 보여준다.
 */
export function DirectoryPicker({
  open,
  onClose,
  onSelect,
  initialPath,
}: DirectoryPickerProps) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!open) return;
    void load(initialPath);
  }, [open, initialPath]);

  async function load(target?: string) {
    try {
      const data = await browseFs(target);
      setListing(data);
      setManual(data.path);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function selectCurrent() {
    if (!listing) return;
    onSelect(listing.path);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="폴더 선택" size="lg">
      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <input
          className={cn(inputBaseClass, "flex-1 font-mono text-xs")}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void load(manual);
            }
          }}
          placeholder="/Users/..."
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void load(manual)}
        >
          이동
        </Button>
      </div>

      <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!listing?.parent}
          onClick={() => listing?.parent && void load(listing.parent)}
        >
          ↑ 상위
        </Button>
        {listing?.hasClaude && <Badge variant="success">.claude 있음</Badge>}
      </div>

      <ul className="scroll-thin mb-4 max-h-80 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        {listing?.entries.length === 0 && (
          <li className="px-3 py-2 text-xs text-zinc-500">비어 있음</li>
        )}
        {listing?.entries
          .filter((e) => e.isDir)
          .map((entry) => (
            <li key={entry.name}>
              <button
                type="button"
                onClick={() =>
                  listing && void load(joinPath(listing.path, entry.name))
                }
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                <span className="font-mono text-xs">▸</span>
                <span className="truncate">{entry.name}</span>
              </button>
            </li>
          ))}
      </ul>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button type="button" size="sm" onClick={selectCurrent}>
          이 폴더 선택
        </Button>
      </div>
    </Modal>
  );
}

function joinPath(base: string, name: string): string {
  if (base.endsWith("/")) return `${base}${name}`;
  return `${base}/${name}`;
}
