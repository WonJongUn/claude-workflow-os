"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  NotificationBell,
  NotificationProvider,
  ToastStack,
} from "./notifications";
import { ServerHealthOverlay } from "./ServerHealthOverlay";

/**
 * 앱 전역 클라이언트 컨텍스트. RootLayout에서 한 번만 마운트한다.
 * QueryClient는 useState lazy init으로 dev hot reload 시에도 한 번만 만들어진다.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <NotificationProvider>
        {children}
        <NotificationBell />
        <ToastStack />
        <ServerHealthOverlay />
      </NotificationProvider>
    </QueryClientProvider>
  );
}
