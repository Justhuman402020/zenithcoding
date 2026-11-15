# Side chat: "Chosen models" mode

## What you'll get

**Admin → AI Models → "Side chat is powered by"** gets a third choice:
- Ollama (today's behavior)
- OpenRouter (today's behavior)
- **Chosen models** (new)

**Admin → Chosen models list (new section, same page)**
- Every saved key (Ollama helper keys and OpenRouter keys) shows its models, sorted A to Z.
- Each model row ends with a **Test** button. Test sends one tiny message.
  - Works: marked **Good** (green) and a **Save for chat** button appears.
  - Fails: marked **Not working: choose another model**, with the short reason (offline, missing model, out of credit).
- Saved models appear in one "Chosen for chat" list. Each has a delete (trash) button next to its name.
- You can save as many as you like.

**In the side chat (only when Admin is set to "Chosen models")**
- A new model-list button next to the send button opens your saved models.
- A new chat starts on the model you used last.
- Each chat remembers its own model. Picking another model mid-chat (for example Gemini, then Mistral, then Ollama) switches it from the next message on. The earlier messages stay as context.
- The chat header shows which model is answering. Each reply is labeled with the model that wrote it.
- You can also delete a saved model from this list using the trash button next to its name.
- If the chosen model stops working, the reply says so and asks you to pick another. It never switches by itself.

## Unchanged
- Plan stays Cloudflare only. Build and Image build keep their OpenRouter and Ollama switches.
- Brain keys and existing key-saving flows stay the same. Key values are never shown.
- The side chat can still only read your projects and send work to the build model.

## Technical details
- New table `chat_chosen_models`: owner, provider (`ollama`|`openrouter`), key id, model id, label, last test status/time, plus GRANTs and owner-only RLS.
- New column `chats.chosen_model_id`, nullable. Workspace setting `chatEngine` adds the value `chosen`.
- Server functions: `listKeyModels` (per key, sorted A to Z with localeCompare), `testChatModel` (single short completion and no tools, which also runs for Ollama), `saveChosenModel`, `deleteChosenModel`, `setChatModel(chatId, chosenId)`.
- In `assistant.functions.ts`, when `chatEngine==='chosen'`, read the chat's chosen row and route to the Ollama native client or OpenRouter with that key and model. The context budget follows the provider. There is no fallback.
- Saved replies store the model name. Tests cover the A-to-Z sort, routing with no silent fallback, and that deleting a model clears it from chats.
