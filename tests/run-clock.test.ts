import { expect, it } from "vitest";
import { runClock } from "../src/lib/run-clock";
const start = "2026-11-05T01:00:00Z";
it("advances each second from the saved start", () => {
  expect(runClock({ status: "running", work_started_at: start }, Date.parse(start) + 1000).ms).toBe(1000);
  expect(runClock({ status: "running", work_started_at: start }, Date.parse(start) + 2000).ms).toBe(2000);
});
it("catches up after reload or waking", () => { expect(runClock({ status: "running", work_started_at: start }, Date.parse(start) + 90000).ms).toBe(90000); });
it("does not count queued waiting as work", () => { expect(runClock({ status: "queued" }, Date.parse(start)).ms).toBeNull(); expect(runClock({ status: "queued" }, 0).label).toBe("Waiting"); });
it("freezes paused time", () => { expect(runClock({ status: "failed", outcome: "paused", work_started_at: start, work_paused_at: "2026-11-05T01:00:30Z" }, Date.parse(start) + 90000).ms).toBe(30000); });
it("excludes recorded pause duration", () => { expect(runClock({ status: "running", work_started_at: start, work_paused_ms: 20000 }, Date.parse(start) + 90000).ms).toBe(70000); });
it("freezes final completed duration", () => { expect(runClock({ status: "completed", work_started_at: start, completed_at: "2026-11-05T01:00:45Z" }, Date.parse(start) + 90000).ms).toBe(45000); });