import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
export const Route = createFileRoute("/not-available")({
  head: () => ({ meta: [{ title: "Not available — Code Haven" }, { name: "description", content: "This Code Haven workspace is private." }, { property: "og:title", content: "Not available — Code Haven" }, { property: "og:description", content: "This workspace is private." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: () => <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background"><h1 className="text-2xl font-semibold">Not available</h1><p className="text-muted-foreground">This workspace is private.</p><Button variant="outline" onClick={async () => { await supabase.auth.signOut(); window.location.assign("/auth"); }}>Back to sign in</Button></main>,
});