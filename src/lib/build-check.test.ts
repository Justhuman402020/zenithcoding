import { describe, expect, it } from "vitest";
import { checkProjectBuild } from "./build-check";

describe("checkProjectBuild", () => {
  it("catches the missing cloudflareHost export", () => {
    const r = checkProjectBuild([
      { path: "src/lib/cloudflare.ts", content: "export function cloudflareReady() { return true }\nexport async function chatStream() {}" },
      { path: "src/ui/HealthCheck.tsx", content: "import {useState} from 'react';\nimport {chatStream, cloudflareHost, cloudflareReady} from '../lib/cloudflare';" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([{ file: "src/ui/HealthCheck.tsx", line: 2, message: 'No matching export in "src/lib/cloudflare.ts" for import "cloudflareHost"' }]);
  });

  it("passes when every import exists, including aliases, defaults and re-exports", () => {
    const r = checkProjectBuild([
      { path: "src/lib/a.ts", content: "export const a = 1;\nexport type T = string;" },
      { path: "src/lib/index.ts", content: "export * from './a';" },
      { path: "src/App.tsx", content: "export default function App() { return null }" },
      { path: "src/main.tsx", content: "import App from './App';\nimport { a, type T } from '@/lib';\nimport './index.css';" },
    ]);
    expect(r).toMatchObject({ ok: true, issues: [] });
  });

  it("reports a missing local module", () => {
    const r = checkProjectBuild([{ path: "src/main.tsx", content: "import App from './Missing';" }]);
    expect(r.issues[0]?.message).toBe('Could not resolve "./Missing"');
  });
});
