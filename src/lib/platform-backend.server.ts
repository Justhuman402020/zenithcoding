// Copies the admin-saved backend credentials into a newly created project.
// Server-only: used by project creation paths (templates, imports, prompts).

const CONNECTION_ID = "global";

export async function seedPlatformBackend(projectId: string, userId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret, encryptSecret } = await import("./secrets-crypto.server");
    const { data: row } = await supabaseAdmin
      .from("platform_supabase_connection")
      .select("project_url, anon_key_encrypted, service_key_encrypted")
      .eq("id", CONNECTION_ID)
      .maybeSingle();
    if (!row) return false;

    const anonKey = await decryptSecret(row.anon_key_encrypted as string);
    let serviceKey: string | null = null;
    if (row.service_key_encrypted) {
      try {
        serviceKey = await decryptSecret(row.service_key_encrypted as string);
      } catch {
        serviceKey = null;
      }
    }

    const rows = [
      {
        key: "VITE_SUPABASE_URL",
        value: row.project_url as string,
        expose_to_client: true,
        description: "Backend address for signup, login and data",
      },
      {
        key: "VITE_SUPABASE_ANON_KEY",
        value: anonKey,
        expose_to_client: true,
        description: "Public backend key used by the site",
      },
      ...(serviceKey
        ? [
            {
              key: "SUPABASE_SERVICE_ROLE_KEY",
              value: serviceKey,
              expose_to_client: false,
              description: "Private backend key (server only)",
            },
          ]
        : []),
    ];

    for (const r of rows) {
      await supabaseAdmin.from("project_secrets").upsert(
        {
          project_id: projectId,
          user_id: userId,
          key: r.key,
          value_encrypted: await encryptSecret(r.value),
          expose_to_client: r.expose_to_client,
          description: r.description,
        },
        { onConflict: "project_id,key" },
      );
    }
    return true;
  } catch {
    return false;
  }
}
