import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { ThesisView } from "./thesis-view";

export default function ThesisPage({ params }: PageProps<"/thesis/[symbol]">) {
  return (
    <Suspense fallback={<div className="space-y-3 p-4"><Skeleton className="h-8 w-40" />{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 w-full rounded-2xl" />)}</div>}>
      <ThesisView params={params} />
    </Suspense>
  );
}
