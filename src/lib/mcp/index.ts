import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProjects from "./tools/list-projects";
import createProject from "./tools/create-project";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "code-haven",
  title: "Code Haven",
  version: "0.1.0",
  instructions:
    "Tools for Code Haven, an AI website builder. Use `list_projects` to see the user's projects and `create_project` to start a new one.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProjects, createProject],
});
