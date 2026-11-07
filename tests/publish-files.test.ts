import { describe, expect, it } from "vitest";
import { buildStoragePath, publishedFilePath } from "../src/lib/publish-files";

describe("publish artifact paths", () => {
  it("preserves source index.html when saving a generated index.html", () => {
    const rows = new Map([["index.html", "source"]]);
    rows.set(buildStoragePath("index.html"), "built");
    expect(rows.size).toBe(2);
    expect(rows.get("index.html")).toBe("source");
    expect(rows.get(".code-haven-build/index.html")).toBe("built");
  });
  it("repeated publishes replace artifacts without duplicate keys", () => {
    const rows = new Map<string, string>();
    rows.set(buildStoragePath("./index.html"), "first");
    rows.set(buildStoragePath("/index.html"), "second");
    expect(rows.size).toBe(1);
    expect(rows.get(".code-haven-build/index.html")).toBe("second");
  });
  it("serves original asset paths for both new and legacy built files", () => {
    expect(publishedFilePath({path: buildStoragePath("assets/moon.webp"),kind:"build"})).toBe("assets/moon.webp");
    expect(publishedFilePath({path:"index.html",kind:"build"})).toBe("index.html");
    expect(publishedFilePath({path:".code-haven-build/source.txt",kind:"source"})).toBe(".code-haven-build/source.txt");
  });
});