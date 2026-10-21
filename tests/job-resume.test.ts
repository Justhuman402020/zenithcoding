import { describe, it, expect } from "vitest";
import { shouldResume, MAX_AUTO_RESUMES } from "../src/routes/api/public/jobs.resume";
const now = Date.now();
const base = { status: "running", auto_resumes: 0, resume_payload: { messages: [] }, updated_at: new Date(now - 91_000).toISOString() };
describe("server build restarts", () => {
  it("restarts a build silent for over 90 seconds", () => expect(shouldResume(base, now)).toBe(true));
  it("leaves a build alone that reported in under 90 seconds ago", () =>
    expect(shouldResume({ ...base, updated_at: new Date(now - 60_000).toISOString() }, now)).toBe(false));
  it("stops after 6 restarts", () => {
    expect(MAX_AUTO_RESUMES).toBe(6);
    expect(shouldResume({ ...base, auto_resumes: 6 }, now)).toBe(false);
  });
  it("never restarts finished builds", () => expect(shouldResume({ ...base, status: "completed" }, now)).toBe(false));
});
import { AUTO_RESUME_ENABLED } from "../src/routes/api/public/jobs.resume";
describe("automatic restarts", () => {
  it("are on for cut-off builds", () => expect(AUTO_RESUME_ENABLED).toBe(true));
  it("never restart a paused build (waits for Retry / Approve)", () => {
    expect(shouldResume({ ...base, outcome: "paused" }, now)).toBe(false);
    expect(shouldResume({ ...base, paused_at_key: 3 }, now)).toBe(false);
  });
});
