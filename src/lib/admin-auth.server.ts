export async function assertAdminRole(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export async function isAdminRole(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });

  if (error) throw new Error(error.message);
  return !!data;
}