import { redirect } from "next/navigation";

export default async function TransitionEditorPage({
  params,
}: {
  params: Promise<{ workId: string; id: string }>;
}) {
  const { workId, id } = await params;
  redirect(
    `/w/${encodeURIComponent(decodeURIComponent(workId))}/episodes/${encodeURIComponent(decodeURIComponent(id))}?transitions=1`,
  );
}
