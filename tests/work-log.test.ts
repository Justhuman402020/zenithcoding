import { describe, expect, it } from "vitest";
import {
  fileEvidence,
  messageRunId,
  parseWorkLog,
  safeLogText,
  sanitizeDetail,
  workedFor,
} from "../src/lib/work-log";
import { withWorkEvidence } from "../src/lib/work-log.server";
import { createMemoryFileStore } from "../src/lib/chat-tools.server";
import type { TraceLogger } from "../src/lib/trace.server";

describe("Reopenable work history", () => {
  it("keeps separate run identities attached to their messages", () => {
    expect(messageRunId("Done\n<!-- run:first-job -->", "m1")).toBe("j-first-job");
    expect(messageRunId("Done\n<!-- run:second-job -->", "m2")).toBe("j-second-job");
    expect(messageRunId("Older work", "old-message")).toBe("m-old-message");
  });
  it("retains old timeline and file lists without inventing diffs", () => {
    const log = parseWorkLog(
      "<!-- run:abc -->\n- 23:59:58 UTC · Read page\n- 00:00:03 UTC · Saved page\n\nFiles changed:\n- `src/page.tsx`",
    );
    expect(log.steps).toHaveLength(2);
    expect(log.files).toEqual(["src/page.tsx"]);
    expect(workedFor(log.steps)).toBe("5s");
  });
  it("captures concrete before and after file changes", () => {
    const c = fileEvidence("site.txt", "Moon\n", "Earth\n");
    expect(c.kind).toBe("edited");
    expect(c.patch).toContain("-Moon");
    expect(c.patch).toContain("+Earth");
    expect(fileEvidence("new.txt", null, "New").kind).toBe("added");
    expect(fileEvidence("old.txt", "Old", null).kind).toBe("deleted");
  });
  it("does not expose private file contents or credentials", () => {
    expect(fileEvidence(".env", "SECRET=before", "SECRET=after").patch).toBeUndefined();
    expect(safeLogText('const apiKey = "private-test-value"')).not.toContain("private-test-value");
    expect(
      sanitizeDetail({ authorization: "private-value", nested: { password: "secret-value" } }),
    ).toEqual({ authorization: "[hidden]", nested: { password: "[hidden]" } });
  });
  it("does not pretend an unavailable previous version was empty", () => {
    expect(fileEvidence("site.txt", undefined, "new").patch).toBeUndefined();
    expect(fileEvidence("sky.webp", null, "data:image/webp;base64,abc").patch).toBeUndefined();
  });
  it("persists each mutation before returning even without a browser", async () => {
    const rows: unknown[] = [];
    let flushes = 0;
    const trace: TraceLogger = {
      traceId: "test",
      log: (phase, options) => rows.push({ phase, ...options }),
      flush: async () => {
        flushes++;
      },
      time: async (_phase, fn) => fn(),
    };
    const store = withWorkEvidence(createMemoryFileStore({ "page.txt": "old" }), trace);
    await store.write("page.txt", "new");
    await store.remove("page.txt");
    expect(flushes).toBe(2);
    expect(rows).toMatchObject([
      { phase: "file.change", detail: { change: { kind: "edited" } } },
      { phase: "file.change", detail: { change: { kind: "deleted" } } },
    ]);
  });
});
