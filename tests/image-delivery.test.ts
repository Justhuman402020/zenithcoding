import { describe, expect, it } from "vitest";
import { attachedImageUrls, imageReaderRef, editorRequestChoice } from "../src/lib/image-delivery";

describe("image delivery", () => {
  it("routes Image build with captions to OpenRouter, never Cloudflare", () => {
    expect(editorRequestChoice("image", true)).toEqual({ mode: "build", engine: "openrouter", imageBuild: true });
  });
  it("routes ordinary Build and Plan to Cloudflare", () => {
    expect(editorRequestChoice("build", false)).toEqual({ mode: "build", engine: "openrouter", imageBuild: false });
    expect(editorRequestChoice("plan", false)).toEqual({ mode: "plan", engine: "cloudflare", imageBuild: false });
  });
  it("keeps an attached image build on VL even with text", () => {
    expect(editorRequestChoice("build", true)).toEqual({ mode: "build", engine: "openrouter", imageBuild: true });
  });
  it("preserves current SDK and legacy image attachments", () => {
    expect(attachedImageUrls([{ role: "user", parts: [
      { type: "file", mediaType: "image/jpeg", url: "data:image/jpeg;base64,YQ==" },
      { type: "image", image: "https://example.com/legacy.png" },
      { type: "file", mimeType: "image/png", url: "https://example.com/file.png" },
    ] }])).toEqual(["data:image/jpeg;base64,YQ==", "https://example.com/legacy.png", "https://example.com/file.png"]);
  });
  it("does not reuse old images or non-image files", () => {
    expect(attachedImageUrls([{ role: "user", parts: [{ type: "image", image: "old" }] }, { role: "user", parts: [{ type: "file", mediaType: "text/plain", url: "file" }] }])).toEqual([]);
  });
  it("uses the chosen image reader and preserves running job snapshots", () => {
    const vl = { provider: "build-openrouter", model: "nvidia/vl" };
    const text = { provider: "build-openrouter", model: "nvidia/text" };
    expect(imageReaderRef(null, vl, text)).toEqual(vl);
    expect(imageReaderRef(text, vl, null)).toEqual(text);
  });
});