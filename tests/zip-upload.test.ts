import { describe, expect, it } from "vitest";
import { batchRows, uploadRows, type UploadRow } from "../src/lib/zip-upload";
import { zipCheckDecision } from "../src/lib/zip-check";

const row = (path: string, size: number): UploadRow => ({ project_id: "p", user_id: "u", path, content: "x".repeat(size) });

describe("ZIP upload", () => {
  it("keeps each request under the byte budget", () => {
    const batches = batchRows([row("a", 400), row("b", 400), row("c", 400)], 1000, 25);
    expect(batches.map((b) => b.length)).toEqual([2, 1]);
  });

  it("retries a stuck request and reports progress to 100%", async () => {
    let calls = 0;
    const progress: number[] = [];
    await uploadRows([row("a", 10)], async () => (++calls < 2 ? { error: { message: "network" } } : { error: null }), (d) => progress.push(d), { wait: async () => {} });
    expect(calls).toBe(2);
    expect(progress).toEqual([0, 1]);
  });

  it("stops with a clear reason after 3 failed tries instead of hanging", async () => {
    await expect(uploadRows([row("a", 10)], async () => ({ error: { message: "offline" } }), () => {}, { wait: async () => {} })).rejects.toThrow(/0 of 1 files/);
  });
});

describe("ZIP check", () => {
  it("passes when there are no errors", () => {
    expect(zipCheckDecision({ roundsUsed: 0 }).action).toBe("pass");
  });
  it("fixes a found error immediately", () => {
    expect(zipCheckDecision({ buildError: "bad import", roundsUsed: 0 })).toMatchObject({ action: "fix", round: 1 });
  });
  it("stops after 3 automatic fixes", () => {
    expect(zipCheckDecision({ previewError: "boom", roundsUsed: 3 }).action).toBe("stop");
  });
});
