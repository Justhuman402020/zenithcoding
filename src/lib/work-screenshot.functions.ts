import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
export const getWorkScreenshot=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(d=>z.object({projectId:z.string().uuid(),runId:z.string().max(100)}).parse(d)).handler(async({data,context})=>{
  const db=context.supabase;
  const {data:project}=await db.from("projects").select("id").eq("id",data.projectId).eq("user_id",context.userId).maybeSingle();if(!project)return null;
  const kind=data.runId.slice(0,2),id=data.runId.slice(2);
  if(!["j-","k-"].includes(kind))return null;
  const {data:job}=await db.from("chat_jobs").select("id").eq("project_id",data.projectId).eq("user_id",context.userId).eq(kind==="k-"?"request_key":"id",id).maybeSingle();if(!job)return null;
  const {data:checks}=await db.from("browser_checks").select("screenshots,visual_phase,visual_status").eq("job_id",job.id).eq("user_id",context.userId).order("created_at",{ascending:false}).limit(3);
  for(const check of checks??[]){const shots=check.screenshots as Array<{url:string;label:string}>|null;const shot=shots?.[0];if(!shot?.url)continue;const {data:link}=await db.storage.from("browser-checks").createSignedUrl(shot.url,3600);if(link)return {url:link.signedUrl,label:shot.label,phase:check.visual_phase,status:check.visual_status};}
  return null;
});