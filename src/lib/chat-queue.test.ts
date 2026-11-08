import { describe, expect, it } from "vitest";
import { editQueued, mustQueue, nextToSend, removeQueued, type QueuedMessage } from "./chat-queue";

const q = (id: string, text: string): QueuedMessage => ({ id, text, images: [], attachments: [], plan: false });

describe("side chat queue", () => {
  it("queues while the model is replying or work is running", () => {
    expect(mustQueue({ busy: true, runningWork: 0 })).toBe(true);
    expect(mustQueue({ busy: false, runningWork: 1 })).toBe(true);
    expect(mustQueue({ busy: false, runningWork: 0 })).toBe(false);
  });
  it("sends the oldest queued message as soon as the previous one finishes", () => {
    const list = [q("a", "first"), q("b", "second")];
    expect(nextToSend(list, { busy: true, runningWork: 0 })).toBeNull();
    expect(nextToSend(list, { busy: false, runningWork: 0 })?.id).toBe("a");
  });
  it("sends the edited text and skips emptied messages", () => {
    const list = editQueued([q("a", "first"), q("b", "second")], "a", "  ");
    expect(nextToSend(list, { busy: false, runningWork: 0 })?.id).toBe("b");
    expect(editQueued([q("a", "old")], "a", "new")[0]?.text).toBe("new");
    expect(removeQueued([q("a", "x"), q("b", "y")], "a").map((m) => m.id)).toEqual(["b"]);
  });
});

describe("side chat queue failures", () => {
  it("never resends a failed message by itself", () => {
    const list: QueuedMessage[] = [{ ...q("a", "first"), failed: true }, q("b", "second")];
    expect(nextToSend(list, { busy: false, runningWork: 0 })?.id).toBe("b");
    expect(nextToSend([list[0]!], { busy: false, runningWork: 0 })).toBeNull();
  });
});
