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

const MODELS_ADMIN_EMAIL = "justsamsung99@gmail.com";

export async function assertModelsAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.auth.getUser();
  if (error) throw new Error("Unable to verify model board access");
  if (data.user?.email?.toLowerCase() !== MODELS_ADMIN_EMAIL) {
    throw new Error("Forbidden: model board access is restricted");
  }
}

export async function isModelsAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.auth.getUser();
  if (error) return false;
  return data.user?.email?.toLowerCase() === MODELS_ADMIN_EMAIL;
}
