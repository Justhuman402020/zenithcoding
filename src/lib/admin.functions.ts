import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual } from "node:crypto";

type AdminSession = { unlocked?: boolean; unlockedAt?: number };

function sessionConfig() {
  const password = process.env.FORGE_ADMIN_SESSION_SECRET;
  if (!password) throw new Error("FORGE_ADMIN_SESSION_SECRET is not set");
  return {
    password,
    name: "forge-admin",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

function keyMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export const getAdminStatus = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<AdminSession>(sessionConfig());
  return { unlocked: !!session.data.unlocked, unlockedAt: session.data.unlockedAt ?? null };
});

export const unlockAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: { key: string }) => {
    if (typeof data?.key !== "string" || data.key.length === 0 || data.key.length > 512) {
      throw new Error("Invalid key");
    }
    return { key: data.key };
  })
  .handler(async ({ data }) => {
    const expected = process.env.FORGE_ADMIN_KEY;
    if (!expected) throw new Error("FORGE_ADMIN_KEY is not set on the server");
    if (!keyMatches(data.key, expected)) return { ok: false as const };
    const session = await useSession<AdminSession>(sessionConfig());
    await session.update({ unlocked: true, unlockedAt: Date.now() });
    return { ok: true as const };
  });

export const lockAdmin = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<AdminSession>(sessionConfig());
  await session.clear();
  return { ok: true as const };
});