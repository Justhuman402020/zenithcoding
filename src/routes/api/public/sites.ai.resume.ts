import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
export const Route=createFileRoute("/api/public/sites/ai/resume")({server:{handlers:{POST:async({request})=>{
  const token=request.headers.get("x-resume-token");
  if(!token)return new Response("Unauthorized",{status:401});
  const {supabaseAdmin:db}=await import("@/integrations/supabase/client.server");
  const {data:config}=await db.from("job_resume_config").select("token").eq("id","default").single();
  if(!config||token!==config.token)return new Response("Unauthorized",{status:401});
  const input=z.object({requestId:z.string().uuid()}).safeParse(await request.json().catch(()=>null));
  if(!input.success)return new Response("Invalid request",{status:400});
  await (await import("@/lib/project-ai.server")).processSiteRequest(input.data.requestId);
  return Response.json({ok:true});
}}}});