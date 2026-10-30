"use client";

import { SWRConfig } from "swr";
import { fetcher } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: true, dedupingInterval: 30_000, errorRetryCount: 2 }}>
      {children}
    </SWRConfig>
  );
}
