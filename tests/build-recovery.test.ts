import { describe, expect, it } from "vitest";
import { recoveryHeaders } from "../src/lib/build-recovery";
import { requestCtx, keepAlive } from "../src/lib/wait-until.server";

describe("screen-off build recovery", () => {
  it("retains image build, approval and the exact OpenRouter model", () => {
    const saved = recoveryHeaders(new Headers({ "x-forge-image-build": "yes", "x-forge-mode": "build", "x-forge-approved": "yes" }), { engine: "openrouter", provider: "build-openrouter", model: "nvidia/nemotron-3.5-super-vl" });
    expect(saved["x-forge-image-build"]).toBe("yes");
    expect(saved["x-forge-approved"]).toBe("yes");
    expect(saved["x-forge-engine"]).toBe("openrouter");
    expect(saved["x-forge-model"]).toBe("build-openrouter:nvidia/nemotron-3.5-super-vl");
  });
  it("registers background completion independently of a closed viewer", async () => {
    const work: Promise<unknown>[] = [];
    let completed = false;
    let finish: (() => void) | undefined;
    const job = new Promise<void>((resolve) => { finish = resolve; }).then(() => { completed = true; });
    requestCtx.run({ waitUntil: (p) => { work.push(p); } }, () => keepAlive(job));
    expect(work.length).toBe(1);
    expect(completed).toBe(false);
    finish?.();
    await Promise.all(work);
    expect(completed).toBe(true);
  });
});