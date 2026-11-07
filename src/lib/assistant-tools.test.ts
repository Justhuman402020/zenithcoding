import { describe, expect, it } from "vitest";
import { HELPER_TOOLS, HELPER_TOOL_NAMES, runHelperTool } from "./assistant-policy";

const files = [
  { path: "index.html", content: "<h1>Music artist</h1>\n<script src=app.js></script>" },
  { path: "src/app.js", content: "const track = 1;\nconsole.log(track)" },
  { path: ".env", content: "API_KEY=supersecret" },
];
const errors = { build: "src/app.js:2 missing export", jobs: ["build failed"], preview: ["[problems] button clipped"] };

describe("chat helper tools are look-only", () => {
  it("offers only reading tools, never writing", () => {
    const names = HELPER_TOOLS.map((t) => t.function.name);
    expect(names).toEqual([...HELPER_TOOL_NAMES]);
    expect(names.some((n) => /write|edit|delete|create|sql|publish/i.test(n))).toBe(false);
  });
  it("reads any file in full and hides .env values", () => {
    expect(runHelperTool("read_file", '{"path":"app.js"}', files, errors)).toContain("console.log(track)");
    const env = runHelperTool("read_file", '{"path":".env"}', files, errors);
    expect(env).not.toContain("supersecret");
  });
  it("searches across files and shows project errors", () => {
    expect(runHelperTool("search_files", '{"query":"track"}', files, errors)).toContain("src/app.js:1");
    const out = runHelperTool("project_errors", "", files, errors);
    expect(out).toContain("missing export");
    expect(out).toContain("button clipped");
  });
  it("refuses unknown tools such as write_file and points to the build model", () => {
    expect(runHelperTool("write_file", '{"path":"index.html"}', files, errors)).toMatch(/cannot edit/);
  });
});

import { shouldRetryTunnel, HELPER_TOOL_OUTPUT } from "./assistant-policy";
describe("PC model tunnel retries", () => {
  it("asks again twice when the tunnel gives up (524), then stops", () => {
    expect(shouldRetryTunnel(524, 0)).toBe(true);
    expect(shouldRetryTunnel(524, 1)).toBe(true);
    expect(shouldRetryTunnel(524, 2)).toBe(false);
  });
  it("does not retry real errors like a wrong key", () => {
    expect(shouldRetryTunnel(401, 0)).toBe(false);
    expect(shouldRetryTunnel(530, 0)).toBe(false);
  });
  it("sends PC models shorter tool answers than OpenRouter", () => {
    expect(HELPER_TOOL_OUTPUT.ollama).toBeLessThan(HELPER_TOOL_OUTPUT.openrouter);
  });
});
