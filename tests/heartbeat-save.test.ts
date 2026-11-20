import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Database update builders only send when awaited/then'd; a bare `void builder` never saves,
// which made live runs look dead after 90s and the server started a duplicate copy.
describe("run heartbeat", () => {
  it("every fire-and-forget chat_jobs update is actually sent", () => {
    const src = readFileSync("src/routes/api/public/chat.ts", "utf8");
    const blocks = src.split("void supabaseAdmin").slice(1).map((b) => b.split(";")[0]);
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(b).toContain(".then(");
  });
});
