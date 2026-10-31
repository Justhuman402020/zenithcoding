import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { brainZipContext, inspectBrainZip, referenceFileContent } from "../src/lib/brain-zip";
import { createBrainZipTools } from "../src/lib/brain-zip.server";

describe("Project Brain ZIP references", () => {
  it("preserves reference source, original media and hidden files without editing a project", async () => {
    const files = await inspectBrainZip(zipSync({ "design/index.html": strToU8('<a href="/shop">Shop</a>'), "design/.env": strToU8("TOKEN=private"), "design/moon.png": new Uint8Array([137, 80, 78, 71]) }), "design.zip");
    expect(files.find(f => f.path === "index.html")?.content).toContain('/shop');
    expect(files.find(f => f.path === "moon.png")?.content).toBe("data:image/png;base64,iVBORw==");
    expect(files.map(f => f.path)).toContain(".env");
  });
  it("never gives environment values to the selected model", () => {
    expect(referenceFileContent(".env.local", "API_KEY=private-value")).not.toContain("private-value");
  });
  it("rejects unsafe archive paths", async () => {
    await expect(inspectBrainZip(zipSync({ "../outside.ts": strToU8("x") }), "bad.zip")).rejects.toThrow("unsafe");
  });
  it("keeps every original navigation destination when describing reference redesigns", () => {
    expect(brainZipContext([{ id: "ref", name: "design.zip", byte_size: 20, created_at: "", manifest: [] }])).toContain("preserve ALL existing navigation destinations and behavior");
  });
  it("does not provide copying in the read-only planning tool set", () => {
    const tools = createBrainZipTools({}, "project", { list: async () => [], read: async () => ({}), write: async () => ({ ok: true, path: "", bytes: 0 }), remove: async () => ({ ok: true }) });
    expect(Object.keys(tools.readTools)).toEqual(["list_brain_zips", "list_brain_zip_files", "read_brain_zip_file"]);
    expect(tools.readTools).not.toHaveProperty("copy_brain_zip_file");
  });
});