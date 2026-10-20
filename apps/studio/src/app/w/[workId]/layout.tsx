import type { ReactNode } from "react";
import { WorkPresence } from "@/components/work-presence";
import { workPageData } from "@/lib/page-data";

// Every page of one webtoon: remembers it as the last opened work and reports
// the page to the agent panel.
export default async function WorkLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workId: string }>;
}) {
  const { workId } = await params;
  const data = await workPageData(workId);
  return (
    <>
      {data.kind === "ok" && (
        <WorkPresence workId={data.work.id} title={data.loaded.project.webtoon.title} />
      )}
      {children}
    </>
  );
}
