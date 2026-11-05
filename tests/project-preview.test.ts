import { describe, expect, it } from "vitest";
import { attachedPreviewProject, previewSourceFiles, projectPreviewDocument } from "../src/lib/project-preview";

describe("sidebar chat project previews", () => {
  it("does not offer a preview without an attached project", () => {
    expect(attachedPreviewProject(null, "old-project")).toBeNull();
  });
  it("closes the old preview when another project is attached", () => {
    expect(attachedPreviewProject("next-project", "old-project")).toBeNull();
    expect(attachedPreviewProject("next-project", "next-project")).toBe("next-project");
  });
  it("closes the preview when the project is removed", () => {
    expect(attachedPreviewProject(null, "current-project")).toBeNull();
  });
  it("uses current source instead of stale published output", () => {
    expect(previewSourceFiles([{ path: "index.html", content: "current" }, { path: ".code-haven-build/index.html", content: "old" }])).toEqual([{ path: "index.html", content: "current" }]);
  });
  it("includes project scripts, styles and navigation in the local preview", () => {
    const html = projectPreviewDocument([{ path: "index.html", content: '<html><head><link href="style.css"></head><body><script src="main.js"></script></body></html>' }, { path: "style.css", content: "body{margin:0}" }, { path: "main.js", content: "window.loaded=true;" }]);
    expect(html).toContain("body{margin:0}");
    expect(html).toContain("window.loaded=true");
    expect(html).toContain("forge-preview-navigate");
  });
});