// Side-chat message queue: messages wait while the model replies or work runs,
// then go out one at a time, oldest first.
import type { ChatImage } from "./assistant-images";

export type QueuedMessage = {
  id: string;
  text: string;
  images: ChatImage[];
  attachments: Array<{ name: string; text: string }>;
  plan: boolean;
  /** Set when sending failed; it waits until you tap retry. */
  failed?: boolean;
};

/** True while a new message has to wait in the queue. */
export function mustQueue(state: { busy: boolean; runningWork: number }) {
  return state.busy || state.runningWork > 0;
}

/** The message to send now, or null while the previous one is still going. */
export function nextToSend(queue: QueuedMessage[], state: { busy: boolean; runningWork: number }) {
  if (mustQueue(state)) return null;
  return queue.find((m) => !m.failed && (m.text.trim() || m.images.length || m.attachments.length)) ?? null;
}

export function editQueued(queue: QueuedMessage[], id: string, text: string) {
  return queue.map((m) => (m.id === id ? { ...m, text } : m));
}

export function removeQueued(queue: QueuedMessage[], id: string) {
  return queue.filter((m) => m.id !== id);
}

const key = (chatId: string) => `chat-queue:${chatId}`;

export function loadQueue(chatId: string): QueuedMessage[] {
  try {
    const raw = localStorage.getItem(key(chatId));
    const list = raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
    return Array.isArray(list) ? list.filter((m) => m && typeof m.id === "string" && typeof m.text === "string") : [];
  } catch { return []; }
}

/** Keeps the queue on this device; big images may not fit, then it stays in memory only. */
export function saveQueue(chatId: string, queue: QueuedMessage[]) {
  try {
    if (queue.length) localStorage.setItem(key(chatId), JSON.stringify(queue));
    else localStorage.removeItem(key(chatId));
  } catch { /* storage full: queue still works while the page is open */ }
}
