import { redirect } from "next/navigation";

// Existing bookmarks keep their cut target in the integrated editor.
export default async function CutEditorPage({
  params,
}: {
  params: Promise<{ workId: string; id: string; cutId: string }>;
}) {
  const { workId, id, cutId } = await params;
  redirect(
    `/w/${encodeURIComponent(decodeURIComponent(workId))}/episodes/${encodeURIComponent(decodeURIComponent(id))}?item=${encodeURIComponent(`cut:${decodeURIComponent(cutId)}`)}`,
  );
}
