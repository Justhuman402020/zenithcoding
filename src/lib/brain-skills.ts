// Brain notes titled "Skill /name: ..." become slash commands the user can type.
type Note = { purpose: string; body: string };

export function findSkill(text: string, notes: Note[]): Note | null {
  const cmd = /^\s*\/([a-z][\w-]*)/i.exec(text)?.[1]?.toLowerCase();
  if (!cmd) return null;
  return notes.find((n) => new RegExp(`skill\\s*/${cmd}\\b`, "i").test(n.purpose) && n.body.trim()) ?? null;
}

export function activeSkillSection(text: string, notes: Note[]): string {
  const skill = findSkill(text, notes);
  if (!skill) return "";
  return `\n\n## ACTIVE SKILL — overrides the action-first rules above\nThe user typed ${/^\s*(\/\S+)/.exec(text)?.[1]}. Follow this skill exactly, step by step, before doing anything else. If it says to write a spec, plan, review or confirm first, do that and do NOT edit files until the user approves.\n### ${skill.purpose}\n${skill.body.trim()}`;
}

export type SkillItem = { command: string; title: string; summary: string };

/** Every Brain note titled "Skill /name: ..." as a pickable slash command (new ones appear automatically). */
export function listSkills(notes: Note[]): SkillItem[] {
  const out: SkillItem[] = [];
  const seen = new Set<string>();
  for (const n of notes) {
    const m = /skill\s*\/([a-z][\w-]*)\s*:?\s*(.*)/i.exec(n.purpose);
    if (!m || !n.body.trim()) continue;
    const command = m[1]!.toLowerCase();
    if (seen.has(command)) continue;
    seen.add(command);
    out.push({ command, title: m[2]?.trim() || command, summary: n.body.trim().split("\n").find((l) => l.trim())?.slice(0, 120) ?? "" });
  }
  return out;
}
