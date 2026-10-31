import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { inspectBrainZip, referenceFileContent } from "../src/lib/brain-zip";
import { createBrainZipTools, copyReferenceFile } from "../src/lib/brain-zip.server";

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
  it("cannot overwrite the site's existing navigation with reference source", async () => {
    let current = '<a href="/my-shop">Shop</a>';
    const result = await copyReferenceFile([{ path: "index.html", content: '<a href="/template">Template</a>' }], "index.html", "index.html", {
      list: async () => ["index.html"], read: async () => ({ content: current }),
      write: async (path, content) => { current = content; return { ok: true, path, bytes: content.length }; }, remove: async () => ({ ok: true }),
    });
    expect(result).toHaveProperty("error");
    expect(current).toBe('<a href="/my-shop">Shop</a>');
  });
  it("copies original reference images without changing their bytes", async () => {
    let saved = "";
    await copyReferenceFile([{ path: "moon.png", content: "data:image/png;base64,iVBORw==" }], "moon.png", "public/reference-moon.png", {
      list: async () => [], read: async () => ({}),
      write: async (path, content) => { saved = content; return { ok: true, path, bytes: content.length }; }, remove: async () => ({ ok: true }),
    });
    expect(saved).toBe("data:image/png;base64,iVBORw==");
  });
  it("does not provide copying in the read-only planning tool set", () => {
    const tools = createBrainZipTools({}, "project", { list: async () => [], read: async () => ({}), write: async () => ({ ok: true, path: "", bytes: 0 }), remove: async () => ({ ok: true }) });
    expect(Object.keys(tools.readTools)).toEqual(["list_brain_zips", "list_brain_zip_files", "read_brain_zip_file"]);
    expect(tools.readTools).not.toHaveProperty("copy_brain_zip_file");
  });
});