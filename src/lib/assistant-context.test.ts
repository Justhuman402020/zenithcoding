import { describe, expect, it } from "vitest";
import { fitHelperContext, HELPER_CONTEXT_LIMIT } from "./assistant-policy";

describe("chat helper context", () => {
  it("keeps the attached project when long Brain notes overflow the Ollama limit", () => {
    const out = fitHelperContext({
      core: ["You are the Code Haven chat helper."],
      project: ['ATTACHED PROJECT: "Invoice generator"', "--- src/App.tsx\nexport default function App() {}"],
      extra: [`Brain rules:\n${"x".repeat(20000)}`],
    }, HELPER_CONTEXT_LIMIT.ollama);
    expect(out).toContain('ATTACHED PROJECT: "Invoice generator"');
    expect(out).toContain("--- src/App.tsx");
    expect(out.length).toBe(9000);
  });

  it("puts the project before the owner's other projects list", () => {
    const out = fitHelperContext({ core: ["core"], project: ["ATTACHED PROJECT"], extra: ["Owner's other projects"] }, 60000);
    expect(out.indexOf("ATTACHED PROJECT")).toBeLessThan(out.indexOf("Owner's other projects"));
  });
});
