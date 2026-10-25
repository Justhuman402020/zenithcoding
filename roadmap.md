# Roadmap

- [ ] Move editor builds to a database-owned starter so phone disconnects cannot end the initial build request; preserve owner-only access and explicit approval.

- [x] Harden screen-off recovery: await saved inputs/timer, retain original media and actual OpenRouter selection, refresh restart claim heartbeat; 25 targeted tests passed without inference.
- [ ] Verify a real screen-off build finishes on the published runtime: requires explicit approval for live inference; background recovery safeguards verified with synthetic tests only.

- [x] Stop transient owner/device checks redirecting signed-in users; prevent overlapping checks and remove registration controls. Owner browser retained access after reload and offline interruption; 11 tests pass. Account-creation trigger restricts new accounts to the owner.
- [ ] Verify shared-preview refresh-token rotation across devices: generated auth storage is integration-managed; genuine revoked/missing refresh tokens still require sign-in again.

- [x] Add explicit editor Image build routing, preserve image + caption delivery, remove misleading Qwen notices, and expand model About metadata; 30 tests pass and signed-in intercepted image request verified without inference.

- [x] Add full build-key OpenRouter catalog search and model information; verified 467 real models, search/About on desktop and phone, and 27 regression tests without inference.
- [x] Show image support only from declared image inputs and mark Free only when OpenRouter reports zero pricing; validate saved image choices against the activated key catalog.
- [ ] Verify VL answers with a real image: attachment path corrected and regression-tested; waiting for explicit approval for live image inference.

- [x] Restrict workspace and server requests to the owner; add Security password and device controls.
- [x] Unify Cloudflare usage ledger and shared neuron log, including plan steps and account totals.
- [x] Use approved OpenRouter models for chat/image approvals and build engine snapshots, preserving pool rules.
- [x] Preserve an Admin switch to revert chat to its previous Ollama setup.
- [x] Keep successful edits in project chat and failed/partial attempts only in assistant logs; verify approval/decline with mocked tests and signed-in browser.
- [ ] Verify a live approved plan→build and real Neuron reconciliation: waiting for manually selected OpenRouter text/VL models and explicit approval to spend Neurons.
- [ ] Verify password change and other-device revocation: requires an owner-chosen password and permission to revoke real sessions.

- [x] Add saved Cloudflare coding/vision model settings and project visual briefs.
- [x] Add working model discovery, refresh, and editor lightning pickers.
- [x] Add vision-planner handoff into Brain and Cloudflare coding flow.
- [x] Add home Plan, Build, and ZIP entry choices plus 20 starters.
- [x] Add ZIP project explanation and media/file gallery flow.
- [x] Rename visible product branding and metadata to Code Haven with purple F icons.
- [x] Verify model controls, core flows, mobile layout, tests, and preview logs.
- [x] ZIP picker accepts all zip types and refreshes on tap.
- [x] Lightweight phone editor for huge pastes.
- [x] Agent execute_sql + attach_credential tools.
- [x] Image parts preserved for vision models (image + file shapes).
- [x] Admin Brain: global rules + credential vault with Test & Scan Models / import.
