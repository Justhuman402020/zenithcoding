import { describe, expect, it } from "vitest";
import { canSendChat, chatMessageText, imageMessageContent, isChatImage } from "../src/lib/assistant-images";

const image = { type: "file" as const, mediaType: "image/png", url: "data:image/png;base64,YQ==" };

describe("sidebar chat images", () => {
  it("allows an image without typed text to be sent", () => {
    expect(canSendChat("", [image])).toBe(true);
    expect(canSendChat(" ", [])).toBe(false);
    expect(chatMessageText("", [image])).not.toBe("");
  });
  it("delivers the actual image and its caption to the reader", () => {
    expect(imageMessageContent("What is in this screenshot?", [image])).toEqual([
      { type: "text", text: "What is in this screenshot?" },
      { type: "image_url", image_url: { url: image.url } },
    ]);
    expect(imageMessageContent("Hello", [])).toBe("Hello");
  });
  it("recognizes clipboard images rather than treating them as text files", () => {
    expect(isChatImage({ type: "image/png" })).toBe(true);
    expect(isChatImage({ type: "text/plain" })).toBe(false);
  });
});