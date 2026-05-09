"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { SystemCheck } from "@/app/api/system-check/route";

const api = axios.create({
  baseURL: "/api",
  headers: { "content-type": "application/json" },
});

async function fetchSystemCheck(): Promise<SystemCheck> {
  const { data } = await api.get<SystemCheck>("/system-check");
  return data;
}

/**
 * 외부 도구 설치 여부 조회. 설정 페이지에서 옵션 활성화 가부에 사용.
 * 사용자가 외부에서 설치/제거할 수 있으므로 30초 staleTime 정도가 적당.
 */
export function useSystemCheck(): {
  check: SystemCheck | undefined;
  isLoading: boolean;
  refetch: () => void;
} {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["system-check"],
    queryFn: fetchSystemCheck,
    staleTime: 30_000,
  });
  return { check: data, isLoading, refetch: () => void refetch() };
}
