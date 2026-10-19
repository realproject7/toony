import { redirect } from "next/navigation";

// The episode list lives on the story page. Old links land on its section.
export default async function EpisodesRedirect({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const { workId } = await params;
  redirect(`/w/${workId}#episodes`);
}
