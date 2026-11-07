# Scrolltide / runtime MCP rules

- Runtime Scrolltide MCP connections use server-only encrypted owner-scoped OAuth storage and SDK clients, separate from the app-hosted MCP server and saved key vaults; approved project drafts are persisted into job recovery before dispatch so template use survives disconnects without exposing credentials.
- Scrolltide OAuth uses exact project-owned return hosts and origin-bound client registrations; renew registration when the origin changes, preserve account tokens, and provide a sign-in link when popups are blocked.
- Scrolltide browsing reads public shelf summaries when MCP has no pagination; authenticated MCP handles search/retrieval, keeping full-library scrolling separate from paid prompts and approved builds.
- Lazy-load Scrolltide previews separately from paid instructions.
