"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  NotificationBell,
  NotificationProvider,
  ToastStack,
} from "./notifications";
import { ServerHealthOverlay } from "./ServerHealthOverlay";

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
