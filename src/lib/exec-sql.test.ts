import { describe, it, expect } from "vitest";
import { isBareOk, returnsRows, EXEC_SQL_HELPER } from "./integration-tools.server";
describe("exec_sql results", () => {
  it("spots the old helper's bare ok reply", () => { expect(isBareOk('{"ok" : true}')).toBe(true); expect(isBareOk('{"ok":true,"rows":[]}')).toBe(false); });
  it("knows which queries return rows", () => { expect(returnsRows("select 1")).toBe(true); expect(returnsRows("create table x()")).toBe(false); });
  it("new helper returns rows", () => { expect(EXEC_SQL_HELPER).toContain("'rows'"); });
});
