export type ChatImage = { type: "file"; mediaType: string; url: string };

export function canSendChat(text: string, images: ChatImage[], attachmentCount = 0) {
  return Boolean(text.trim() || images.length || attachmentCount);
}

export function chatMessageText(text: string, images: ChatImage[], attachmentCount = 0) {
  return text.trim() || (images.length ? "Please help me with this image." : attachmentCount ? "Please help me with these attachments." : "");
}

export function imageMessageContent(text: string, images: ChatImage[]) {
  return images.length ? [
    { type: "text" as const, text },
    ...images.map((image) => ({ type: "image_url" as const, image_url: { url: image.url } })),
  ] : text;
}

export function isChatImage(file: Pick<File, "type">) {
  return /^image\/(png|jpeg|webp|gif)$/.test(file.type);
}