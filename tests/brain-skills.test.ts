import { it, expect } from "vitest";
import { findSkill, activeSkillSection } from "../src/lib/brain-skills";
const cmds = ["spec","plan","build","test","review","simplify","ship"];
const notes = cmds.map((c) => ({ purpose: `Skill /${c}: x`, body: `body ${c}` }));
it("each of the seven commands finds its note", () => {
  for (const c of cmds) expect(findSkill(`/${c} do it`, notes)?.body).toBe(`body ${c}`);
});
it("/specs does not match /spec", () => expect(findSkill("/specs x", notes)).toBeNull());
it("plain text activates nothing", () => expect(activeSkillSection("add a form", notes)).toBe(""));
