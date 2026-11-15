import { describe, expect, it } from "vitest";
import { chatRoute, handoffPlanPrompt, parseChatProposal } from "./chat-handoff";
import { HELPER_TOOLS, runHelperTool } from "./assistant-policy";

describe("side chat proposals", () => {
  it("reads a new project plan with its name", () => {
    const r = parseChatProposal('Here is the plan.\n<new-project name="Sunny Bakery">1. Home page\n2. Menu</new-project>\nSend to build? Yes / No');
    expect(r.proposal).toEqual({ kind: "new_project", name: "Sunny Bakery", prompt: "1. Home page\n2. Menu" });
    expect(r.text).not.toContain("<new-project");
  });
  it("reads a fix for the attached project, including the older edit tag", () => {
    expect(parseChatProposal("<send-to-build>Fix the header in index.html</send-to-build>").proposal).toEqual({ kind: "handoff", prompt: "Fix the header in index.html" });
    expect(parseChatProposal("<edit>Fix app.js</edit>").proposal).toEqual({ kind: "handoff", prompt: "Fix app.js" });
  });
  it("ignores plain answers and empty tags", () => {
    expect(parseChatProposal("Your site looks fine.").proposal).toBeNull();
    expect(parseChatProposal('<new-project name="X">  </new-project>').proposal).toBeNull();
  });
});

describe("chat images go to the model in charge", () => {
  it("Ollama and Chosen models get the image themselves, never OpenRouter", () => {
    expect(chatRoute("ollama", true)).toBe("ollama");
    expect(chatRoute("chosen", true)).toBe("chosen");
  });
  it("an OpenRouter chat uses the OpenRouter image model only when an image is sent", () => {
    expect(chatRoute("openrouter", true)).toBe("openrouter-image");
    expect(chatRoute("openrouter", false)).toBe("openrouter-text");
  });
});

describe("handoff to Cloudflare Plan", () => {
  it("carries the whole chat plan to the build screen", () => {
    const plan = "1. Home page\n2. Contact form";
    expect(handoffPlanPrompt("new_project", plan, "Sunny Bakery")).toContain(plan);
    expect(handoffPlanPrompt("new_project", plan, "Sunny Bakery")).toContain("Sunny Bakery");
  });
});

describe("chat can read the Brain and key names, never change them", () => {
  const info = { brain: "Always use dark mode.", keys: "Admin Brain vault: Tavily (api)", projects: "Bakery" };
  it("reads Brain rules and saved key names", () => {
    expect(runHelperTool("read_brain", "", [], { build: "", jobs: [], preview: [] }, 12000, info)).toContain("dark mode");
    expect(runHelperTool("list_saved_keys", "", [], { build: "", jobs: [], preview: [] }, 12000, info)).toContain("Tavily");
  });
  it("has no tool that deletes or changes keys or files", () => {
    expect(HELPER_TOOLS.map((t) => t.function.name).some((n) => /write|edit|delete|remove|update|set_|sql|publish|build/i.test(n))).toBe(false);
  });
});
