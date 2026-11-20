import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
export const Route=createFileRoute("/api/public/sites/ai/resume")({server:{handlers:{POST:async({request})=>{
  const token=request.headers.get("x-resume-token");
  if(!token)return new Response("Unauthorized",{status:401});
  if(!(await (await import("@/lib/job-resume.server")).verifyResumeToken(token)))return new Response("Unauthorized",{status:401});
  if(Number(request.headers.get("content-length")??0)>1024)return new Response("Request too large",{status:413});
  const input=z.object({requestId:z.string().uuid()}).safeParse(await request.json().catch(()=>null));
  if(!input.success)return new Response("Invalid request",{status:400});
  await (await import("@/lib/project-ai.server")).processSiteRequest(input.data.requestId);
  return Response.json({ok:true});
}}}});