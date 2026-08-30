export async function assertOwnsProject(supabase: any, userId: string, projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("Project not found");
}