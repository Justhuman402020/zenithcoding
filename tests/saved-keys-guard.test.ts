import { describe, it, expect } from "vitest";
import { touchesSavedKeys } from "../src/lib/integration-tools.server";

describe("agent SQL can't delete saved keys", () => {
  it("blocks delete on admin_credentials", () => expect(touchesSavedKeys("DELETE FROM admin_credentials")).toBe(true));
  it("blocks drop of custom_ai_providers", () => expect(touchesSavedKeys("drop table custom_ai_providers")).toBe(true));
  it("blocks truncate of platform_integration_keys", () => expect(touchesSavedKeys("TRUNCATE platform_integration_keys")).toBe(true));
  it("allows normal table creation", () => expect(touchesSavedKeys("CREATE TABLE IF NOT EXISTS todos (id int)")).toBe(false));
});
