# Modern build approval popup

## What changes
Right now the build approval uses the phone's built-in popup, which shows "boostallsocial.org says" with **Cancel** / **OK**. It will be replaced with Code Haven's own centered card:

- Title: **Code Haven** with the Code Haven logo/icon
- Message: the same wording as today
  - "Send this build to your selected OpenRouter model?"
  - "Send the image and text to your selected OpenRouter image model?"
  - "Use Cloudflare for this request? Yes approves Neuron usage."
- Small badge showing where it goes (OpenRouter, OpenRouter image, or Cloudflare), with that provider's icon
- Two buttons: **Deny** (outlined) and **Approve** (filled)
- Rounded card, soft shadow, blurred dim background, smooth fade/zoom in, uses your current theme colors, fits phone screens

## Behaviour (unchanged)
- Approve sends the request exactly as now; Deny stops it ("Request not approved").
- Tapping outside or the back button counts as Deny.
- No other popups (delete, revert) change.

## Technical details
- New `BuildApprovalDialog.tsx` built on the existing alert-dialog component, opened through a promise-based `requestApproval(choice)` helper.
- Replace the single `window.confirm` at `p.$projectId.tsx` line 887 with `await requestApproval(choice)`; routing, engines and models untouched.
- Only theme tokens for colors.
