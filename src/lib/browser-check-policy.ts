// Pure rules for "Test it like a real visitor". No network here, so all rules are unit-testable.

export const PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;
/** One test opens the page a handful of times (phone, scrolled, desktop, report). */
export const PREVIEW_TOKEN_MAX_USES = 8;
export const MAX_FIX_ROUNDS = 3;

export type Findings = {
  brokenImages: string[];
  pageErrors: string[];
  failedLoads: string[];
  imageCount: number;
  pageHeight: number;
};

export type CheckShot = { label: string; url: string };

export function tokenUsable(t: { expires_at: string; uses: number }, now = Date.now()): boolean {
  return new Date(t.expires_at).getTime() > now && t.uses < PREVIEW_TOKEN_MAX_USES;
}

/** Decides whether another automatic fix round may start. */
export function nextFixRound(roundsDone: number): { allowed: boolean; reason?: string } {
  if (roundsDone >= MAX_FIX_ROUNDS) {
    return { allowed: false, reason: `Stopped after ${MAX_FIX_ROUNDS} fix rounds — the same problems kept coming back, so it needs a closer look.` };
  }
  return { allowed: true };
}

export function issueCount(f: Findings): number {
  return f.brokenImages.length + f.pageErrors.length + f.failedLoads.length;
}

const SECRET_RE = /(sk-[a-z0-9_-]{10,}|sb_secret_[a-z0-9_-]+|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]+\.[a-z0-9_-]+|(?:api[_-]?key|token|password|secret)=([^&\s"']+))/gi;
/** Strips anything that looks like a key or token before it reaches chat or logs. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_RE, (m) => (m.includes("=") ? m.split("=")[0] + "=[hidden]" : "[hidden]"));
}

export function cleanFindings(raw: unknown): Findings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : []).map((x) => redactSecrets(String(x)).slice(0, 300)).filter(Boolean).slice(0, 30);
  return {
    brokenImages: list(r.brokenImages),
    pageErrors: list(r.pageErrors),
    failedLoads: list(r.failedLoads),
    imageCount: Number(r.imageCount) || 0,
    pageHeight: Number(r.pageHeight) || 0,
  };
}

export function findingsMessage(f: Findings): string {
  const lines: string[] = [];
  if (f.brokenImages.length) lines.push(`Broken pictures:\n${f.brokenImages.map((s) => `- ${s}`).join("\n")}`);
  if (f.pageErrors.length) lines.push(`Page errors:\n${f.pageErrors.map((s) => `- ${s}`).join("\n")}`);
  if (f.failedLoads.length) lines.push(`Files that failed to load:\n${f.failedLoads.map((s) => `- ${s}`).join("\n")}`);
  return lines.join("\n\n");
}

/** Runs inside the tested page; writes a JSON report into #__ch_report. */
export const REPORTER_SCRIPT = `(()=>{var R={pageErrors:[],failedLoads:[]};
addEventListener('error',function(e){var t=e.target;if(t&&t!==window&&(t.src||t.href)){R.failedLoads.push(String(t.src||t.href).slice(0,200))}else{R.pageErrors.push(String(e.message||e.error||'error').slice(0,300))}},true);
addEventListener('unhandledrejection',function(e){R.pageErrors.push('Unhandled: '+String(e.reason&&e.reason.message||e.reason).slice(0,280))});
function out(){var im=[].slice.call(document.images);var b=im.filter(function(i){return i.complete&&i.naturalWidth===0}).map(function(i){return (i.getAttribute('src')||'').slice(0,120)});
var el=document.getElementById('__ch_report');if(!el){el=document.createElement('pre');el.id='__ch_report';el.style.display='none';(document.body||document.documentElement).appendChild(el)}
el.textContent=JSON.stringify({brokenImages:b,pageErrors:R.pageErrors,failedLoads:R.failedLoads,imageCount:im.length,pageHeight:document.documentElement.scrollHeight})}
window.__chReport=out;setInterval(out,500);
var s=new URLSearchParams(location.search).get('__scroll');if(s)addEventListener('load',function(){setTimeout(function(){scrollTo(0,Number(s))},800)});})();`;

export function injectReporter(html: string): string {
  const tag = `<script>${REPORTER_SCRIPT}</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  return tag + html;
}
