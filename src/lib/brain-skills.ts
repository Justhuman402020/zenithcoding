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
