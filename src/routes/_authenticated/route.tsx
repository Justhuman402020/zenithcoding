import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { isSessionRejected } from "@/lib/session-policy";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // The saved session is local; a flaky connection must never sign the owner out.
    const { data: local } = await supabase.auth.getSession();
    const sessionUser = local.session?.user;
    if (!sessionUser) throw redirect({ to: "/auth" });
    const { data, error } = await supabase.auth.getUser();
    if (data.user) return { user: data.user };
    if (isSessionRejected(error)) throw redirect({ to: "/auth" });
    return { user: sessionUser };
  },
  component: () => <Outlet />,
});
