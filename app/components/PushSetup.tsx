"use client";

import { useEffect } from "react";
import {
  fetchPushPublicKey,
  registerPushSubscription,
} from "./ticket-client";

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; ++i) view[i] = raw.charCodeAt(i);
  return buf;
}

async function setupPush(): Promise<void> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return;
  }
  const reg = await navigator.serviceWorker.register("/sw.js");

  if (Notification.permission === "default") {
    const result = await Notification.requestPermission();
    if (result !== "granted") return;
  } else if (Notification.permission !== "granted") {
    return;
  }

  const publicKey = await fetchPushPublicKey();
  if (!publicKey) return;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBuffer(publicKey),
    });
  }
  await registerPushSubscription(sub.toJSON());
}

/**
 * mount 시 1회 Service Worker 등록 + Web Push 구독 시도. 실패는 콘솔 경고만 (UI 영향 없음).
 * 렌더링 결과 없음 — side-effect-only 컴포넌트.
 */
export function PushSetup() {
  useEffect(() => {
    setupPush().catch((err: unknown) => {
      console.warn("[PushSetup] failed", err);
    });
  }, []);
  return null;
}
