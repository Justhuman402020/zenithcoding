import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { verifyWorkspaceAccess } from "@/lib/workspace.functions";
import { supabase } from "@/integrations/supabase/client";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { ThemeBoot } from "@/components/ThemePicker";
import { Button } from "@/components/ui/button";
import { authIdentityChanged, isWorkspaceAccessDenied } from "@/lib/session-policy";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Code Haven — AI website builder and coding workspace" },
      { name: "description", content: "Plan, build, preview, and publish websites with AI coding agents, image understanding, GitHub, and your own domains." },
      { name: "theme-color", content: "#0a0a0a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Code Haven" },
      { property: "og:title", content: "Code Haven — AI website builder and coding workspace" },
      { property: "og:description", content: "Plan, build, preview, and publish websites with AI coding agents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Code Haven — AI website builder" },
      { name: "twitter:description", content: "Plan, build, preview, and publish websites with AI coding agents." },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Work+Sans:wght@300;400;500;600;700&display=swap",
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    let identity: string | null = null;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextIdentity = session?.user.id ?? null;
      if (event === "INITIAL_SESSION") { identity = nextIdentity; return; }
      if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) return;
      const changed = authIdentityChanged(identity, nextIdentity);
      identity = nextIdentity;
      if (!changed && event !== "USER_UPDATED") return;
      void router.invalidate();
      if (event !== "SIGNED_OUT") void queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <ThemeBoot />
      <WorkspaceGate><Outlet /></WorkspaceGate>
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}

function WorkspaceGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const verify = useServerFn(verifyWorkspaceAccess);
  const [allowed, setAllowed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const path = router.state.location.pathname;
  const privatePath = path === "/" || /^\/(admin|chats|p|account)(\/|$)/.test(path);
  useEffect(() => {
    if (!privatePath) return;
    let live = true;
    let checking = false;
    setAllowed(false);
    setUnavailable(false);
    async function check() {
      if (checking || !live) return;
      checking = true;
      const slow = setTimeout(() => { if (live) setUnavailable(true); }, 15_000);
      try {
        // The protected layout owns login; this check owns owner/device access.
        // Do not redirect or discard a verified session on transport failures.
        await verify();
        if (live) { setAllowed(true); setUnavailable(false); }
      } catch (error) {
        if (!live) return;
        if (isWorkspaceAccessDenied(error)) {
          setAllowed(false);
          await router.navigate({ to: "/not-available", replace: true });
        } else setUnavailable(true);
      } finally { clearTimeout(slow); checking = false; }
    }
    void check();
    const timer = setInterval(() => void check(), 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [path, privatePath, verify, router, retry]);
  return !privatePath || allowed ? children : <div className="min-h-screen flex flex-col gap-4 items-center justify-center text-muted-foreground">
    {unavailable ? <>Connection interrupted. Your sign-in has not been cleared.<Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Try again</Button></> : "Checking access…"}
  </div>;
}
