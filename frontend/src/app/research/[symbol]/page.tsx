import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { Deck } from "./deck";

export default function ResearchPage({ params }: PageProps<"/research/[symbol]">) {
  return (
    <Suspense fallback={<div className="space-y-3 p-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full rounded-2xl" /></div>}>
      <Deck params={params} />
    </Suspense>
  );
}
