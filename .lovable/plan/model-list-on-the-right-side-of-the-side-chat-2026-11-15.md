# Model list on the right side of the side chat

## What you will see

A **Models** panel on the right side of every side chat. It only shows the models for the mode that is in charge (the Chat helper setting in Admin → AI Models):

| Chat helper is on | Right panel shows | Hidden |
|---|---|---|
| Chosen models | Every model you saved with "Choose for chat", grouped under its key name (keys in saved order, models A–Z) | Ollama activated models |
| Ollama | Every activated Ollama model, with its key name | Chosen models |
| OpenRouter | No panel (the chat uses the OpenRouter model from Admin) | Both lists |

- The model this chat is using has a check mark and sits highlighted.
- Tap any model in the panel and the chat switches to it right away. The chat keeps using it until you pick another one. Each chat remembers its own model.
- Chosen models keep their delete (bin) button next to the name, like today.
- Ollama models have no delete button in the chat. Activating and turning them off stays in Admin → AI Models.
- If the list is empty, the panel says so and links to Admin → AI Models.
- When you change the Chat helper in Admin, the panel switches lists the next time you open the chat.

## Phone and PC

- **PC (wide screen):** the panel is docked on the right side of the chat, always visible, with a button to hide it.
- **Phone:** a Models button in the top bar slides the panel in from the right. Tapping a model switches and closes it.
- When the project preview is open on PC, the panel folds into the same slide-in so the chat isn't squeezed.
- The model button next to the send arrow opens this same panel, so there is one list, not two.

## Not changing

- Admin → AI Models (Choose for chat, Activate, key names, order).
- How messages are sent, Plan (Cloudflare), Build/Image build (OpenRouter or Ollama build switch).
- No automatic fallback: if the picked model fails, the chat says so; it never switches model on its own.

## Technical details

- New `src/components/ChatModelsPanel.tsx`: takes `chatEngine`, the chat, and `onChanged`.
  - `chosen` mode: uses `listChosenModels`, `setChatChosenModel`, `deleteChosenModel` (existing; order already key-saved-order + model A–Z via `chosen-models.ts`).
  - `ollama` mode: uses `listOllamaKeys`, filters `active && active_model`, switches with `setupChat({ keyId, model, initialize: true })` (posts the existing "Now using …" note).
  - `openrouter` mode: renders nothing.
- Pure helper `panelModelsFor(engine, chosenRows, ollamaKeys)` in `src/lib/chosen-models.ts` decides which list is shown; unit tests: chosen mode never returns Ollama rows, Ollama mode never returns chosen rows, OpenRouter returns none.
- `chats.$chatId.tsx`: add the docked column (`lg:` and preview closed) and a right `Sheet` for phone / preview-open; header Models button; `ChosenModelPicker` popover replaced by a button that opens the panel; the old Ollama "Model" bottom sheet is replaced by the panel.
- No database changes.
