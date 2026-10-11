## Third lightning icon: "Clone a site" with MiroMiro, and saved keys in Plan mode

### What I found
- Your key "MiroMiro api key" is saved in Brain → Credential Vault.
- Its note field also holds the key itself (`MIROMIRO_API_KEY=...`). Notes are shown to the agent as plain text, so the key leaks into the prompt. I'll move the value into the hidden key field and keep only a short description in the note.
- Plan mode can't use the saved keys right now. It can only read files, search the web and find images, so it can't recommend a key.
- Website cloning today grabs a rough outline (colors, headings, links) with a simple fetch. It doesn't use MiroMiro.

### What you'll get
1. **A third ⚡ icon above the chat: "Clone a site".** Tapping it turns on clone mode, and the box asks for a website link. Send "build a site like this https://..." and Code Haven knows to use MiroMiro. You don't have to guess the right words.
2. **MiroMiro fetches the full site.** The server calls MiroMiro with your saved key and gets the page's layout, text, colors, fonts and images. Then it removes scripts, trackers and MiroMiro's own extras, keeping only the design.
2b. **A MiroMiro card in Admin → Integrations & API keys.** Your current key moves there automatically. On the card you can paste, test (it shows the credits left), replace or remove keys, and add more than one. When a key runs out of credits, Code Haven moves to the next one, and the card marks it "Out of credits", so swapping in a fresh key takes one paste.
3. **Forge takes over.** The cleaned design is saved to the project Brain as a "Clone blueprint", and the coding model builds the site from it, one section at a time. This keeps it inside Qwen's token limit.
4. **Plan mode sees all saved keys.** Plan mode gets the list of saved integrations and vault keys (names and notes only, never the values). Every plan includes a "Keys this will use" line, for example "MiroMiro, to copy the site" or "Unsplash, for photos", and flags any key that's missing.
5. **Fallback:** if MiroMiro fails or its key runs out, the old simple outline is used and you get a short notice.

### Technical details
- `ChatModelControls.tsx`: add a third Zap toggle `cloneMode` and send header `x-forge-clone: 1`.
- New `src/lib/miromiro.server.ts`: read the key from `admin_credentials` (label match "miromiro") with `getIntegrationKey` fallback, then call the MiroMiro API and normalize and strip the result into a blueprint of at most about 1,500 tokens, chunked by section.
- `chat.ts`: when the clone header is set or `detectCloneUrl` matches, use MiroMiro first and `buildSiteBlueprint` as the fallback. Save the blueprint to the brain/progress note.
- Plan mode tools: add `list_saved_credentials` (names, notes, service) and include `vaultPromptSection()` in `buildPlanSystemPrompt`.
- Vault hygiene: migrate the secret out of the `notes` text into the encrypted value, and make the prompt builder hide anything that looks like `KEY=value` in notes.
- Add a `miromiro` entry to `integrations-catalog.ts` (multi-key, ordered), with a test in `admin-integrations.functions.ts` that calls `/brand?url=example.com` and returns credits left from `X-Quota-*`. Import the existing vault key as key #1.

### MiroMiro calls used (confirmed from https://miromiro.app/api/docs/introduction)
- Base `https://miromiro.app/api/v1`, every call is `GET ?url=...` with header `Authorization: Bearer <key>`. Free plan: 300 credits/month, no card.
- Available endpoints: `/code` (paste-ready Tailwind/HTML/React/Vue per section), `/brand` (colors, fonts, logo, socials), `/extract` (design tokens: colors, font sizes, radii, shadows — as JSON, CSS or Tailwind), `/images`, `/svgs`, `/fonts`, `/videos`, plus Lottie animations.
- Clone flow, in order: `/brand`, `/extract` (design tokens), `/images`, then `/code?framework=jsx` for the main sections. Save the merged result as the project's "Clone blueprint" in the Brain.
- Machine-readable OpenAPI 3.1 spec lives at `https://miromiro.app/api/openapi.json` — the integration test can validate against it. MiroMiro also offers a hosted MCP server at `https://miromiro.app/mcp`; we use the REST API directly so your saved key works.
- Key handling: the MiroMiro card in Admin → Integrations & API keys lets you paste, test, replace or remove keys anytime; when one runs out of credits it's marked "Out of credits" and the next saved key is used automatically.
- No live test that spends your MiroMiro credits unless you say so.
