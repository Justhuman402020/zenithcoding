# Chosen models from your saved AI Models keys (replan)

The Ollama chat setup stays exactly as it is. The change: models on your saved keys in **Admin → AI Models** (Google AI Studio #1, Mistral, OpenRouter and the rest) can also power the side chat.

## Admin → AI Models (the key cards in your screenshot)
- Inside each key card, models are listed A to Z.
- Each model row gets a **Choose for chat** button next to "Use this". "Use this" keeps doing what it does today for builds.
- Tapping **Choose for chat** sends that model one tiny test message:
  - Works: the row shows **Good** and the model is saved to your chat list.
  - Fails: the row shows **Not working: choose another model**, with a short reason (no credit, model unavailable, key rejected). Nothing is saved.
- A model already saved shows **Saved for chat**.
- I'll remove the separate "Chosen models for side chat" section I added last time, since it only listed Ollama and OpenRouter.

## Admin "Chat helper" setting
The same three choices:
- **Ollama**: unchanged.
- **OpenRouter**: unchanged.
- **Chosen models**: the side chat uses the models you saved above.

## Side chat (only when set to Chosen models)
- The model-list button next to send lists every saved model and the key it came from.
- Tap a model to switch the chat to it from the next message on. Earlier messages stay as context.
- A trash button next to each name deletes that model from the list.
- Each chat remembers its own model. A new chat starts on the model you used last.
- The top of the chat shows the current model, and each reply notes which model wrote it.
- If the model fails, the reply says so and asks you to choose another. It never switches by itself.

## Unchanged
Plan stays on Cloudflare only. Build and Image build keep their current switches. Brain keys and key saving stay the same. The Ollama chat helper keys and their flow are untouched. Key values are never shown.

## Technical details
- `chat_chosen_models.provider` widens from `ollama|openrouter` to any registry provider id. `key_ref` = registry provider id, `provider` = `registry`. Existing Ollama rows keep working. This is an additive migration that relaxes the CHECK.
- `chosenChat` routes `registry` rows through `loadProviderRegistry()` (plus the project-secret keys the board already reads), calling `${baseURL}/chat/completions` with that key and model. There is no fallback.
- New `testAndChooseModel({ provider, model })` server function: it checks the admin, runs a one-message test, and saves on success. On the board, rows are sorted per key with `sortModelsAZ` order.
- Remove `<ChosenModelsAdmin />` from the AI Models page. The picker and chat code stay.
- Tests: A-to-Z order inside a key, no silent fallback, and a failed test saves nothing.
