import { describe, expect, it } from "vitest";
import { canTypecheck, createStallTracker, isBlockedUrl, parseTscOutput, readSandboxResult, searchFiles, selectSandboxFiles } from "./agent-tools-policy";

describe("agent tool rules", () => {
  it("parses tsc errors into file:line issues", () => {
    const out = "src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\nnoise\n";
    expect(parseTscOutput(out)).toEqual([{ file: "src/App.tsx", line: 12, message: "TS2322 Type 'string' is not assignable to type 'number'." }]);
  });
  it("typechecks only projects with package.json and TS files", () => {
    expect(canTypecheck(["package.json", "src/main.tsx"])).toBe(true);
    expect(canTypecheck(["index.html", "src/main.tsx"])).toBe(false);
    expect(canTypecheck(["package.json", "index.js"])).toBe(false);
  });
  it("never sends lockfiles, media or path escapes to the sandbox", () => {
    const picked = selectSandboxFiles([
      { path: "src/a.ts", content: "x" }, { path: "bun.lockb", content: "x" },
      { path: "public/a.png", content: "x" }, { path: "../evil.ts", content: "x" },
    ]).map((f) => f.path);
    expect(picked).toEqual(["src/a.ts"]);
  });
  it("caps search results at 200", () => {
    const rows = [{ path: "a.ts", content: Array(500).fill("foo").join("\n") }];
    const r = searchFiles(rows, "foo", { max: 1000 });
    expect(r.ok && r.matches.length).toBe(200);
    expect(r.ok && r.truncated).toBe(true);
  });
  it("blocks private and non-https addresses", () => {
    expect(isBlockedUrl("http://example.com")).toBe(true);
    expect(isBlockedUrl("https://localhost/x")).toBe(true);
    expect(isBlockedUrl("https://169.254.169.254/latest")).toBe(true);
    expect(isBlockedUrl("https://192.168.1.4")).toBe(true);
    expect(isBlockedUrl("https://docs.example.com/page")).toBe(false);
  });
  it("flags a stall only when the same call fails twice in a row", () => {
    const s = createStallTracker();
    expect(s.record("read_file:a", true)).toBe(false);
    expect(s.record("read_file:a", true)).toBe(true);
    expect(s.record("read_file:b", true)).toBe(false);
    expect(s.record("read_file:b", false)).toBe(false);
    expect(s.record("read_file:b", true)).toBe(false);
  });
  it("reads the sandbox result marker", () => {
    expect(readSandboxResult('npm noise\n@@RESULT@@{"install":0,"installTail":"","code":0,"out":"ok"}')?.out).toBe("ok");
    expect(readSandboxResult("nothing")).toBeNull();
  });
});
