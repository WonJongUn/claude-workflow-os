"use client";

import { useState } from "react";
import {
  getSoundVolume,
  isSoundEnabled,
  playNotificationSound,
  setSoundEnabled,
  setSoundVolume,
} from "./notifications/sound";

/**
 * 알림 사운드 설정 — localStorage만 만지므로 서버 저장 흐름과 분리.
 * 같은 페이지의 SettingsForm과 동일한 grid 레이아웃을 사용해 시각적으로 통일.
 */
export function NotificationSoundSettings() {
  // localStorage는 SSR에서 접근 불가 — useState lazy init은 클라 1회만 실행되므로 안전.
  // useEffect로 사후 동기화하면 첫 프레임에 잘못된 값이 보였다가 바뀌어 깜빡임이 생긴다.
  const [enabled, setEnabled] = useState(() =>
    typeof window === "undefined" ? true : isSoundEnabled(),
  );
  const [volume, setVolume] = useState(() =>
    typeof window === "undefined" ? 0.18 : getSoundVolume(),
  );

  const handleEnabled = (next: boolean) => {
    setEnabled(next);
    setSoundEnabled(next);
  };
  const handleVolume = (next: number) => {
    setVolume(next);
    setSoundVolume(next);
  };

  return (
    <section className="grid grid-cols-1 gap-4 border-t border-zinc-200 py-6 first:border-t-0 first:pt-0 md:grid-cols-[14rem_1fr] md:gap-8 dark:border-zinc-800">
      <header className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          알림 사운드
        </h2>
        <p className="text-xs text-zinc-500">
          토스트가 뜰 때 짧은 알림음을 재생합니다. 설정은 이 브라우저에만 저장됩니다.
        </p>
      </header>
      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <span>알림음 켜기</span>
        </label>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span>볼륨</span>
            <span className="font-mono tabular-nums">
              {Math.round(volume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            onChange={(e) => handleVolume(Number(e.target.value) / 100)}
            disabled={!enabled}
            className="w-full"
          />
          <button
            type="button"
            onClick={() => playNotificationSound()}
            disabled={!enabled || volume === 0}
            className="mt-1 inline-flex h-7 w-fit items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            샘플 재생
          </button>
        </div>
      </div>
    </section>
  );
}
