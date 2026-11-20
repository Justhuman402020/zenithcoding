import { useEffect, useState } from "react";
import { runClock, type RunClock } from "@/lib/run-clock";
export function useRunClock(clock: RunClock) {
  const [now, setNow] = useState(0);
  const running = clock.status === "running" && clock.outcome !== "paused";
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    if (!running) return;
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pageshow", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); window.removeEventListener("pageshow", update); };
  }, [running, clock.work_started_at]);
  return runClock(clock, now);
}