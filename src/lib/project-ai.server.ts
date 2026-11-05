import { estimateNeurons, loadCloudflarePool, readCloudflareCodingModel } from "./cloudflare-pool.server";
import { pickSiteChatModel } from "./project-ai-policy";
import { eligibleSiteKeys, safeSiteProviderUrl, siteRetryDecision } from "./site-ai-recovery-policy";

type Msg = { role: string; content: string };
export async function hashSiteToken(token: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2,"0")).join("");
}
export function newSiteToken() { return "chai_"+Array.from(crypto.getRandomValues(new Uint8Array(24)),x=>x.toString(16).padStart(2,"0")).join(""); }

/** One leased attempt per invocation. Database-owned retries survive viewer disconnect. */
export async function processSiteRequest(id: string) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: claimed, error } = await db.rpc("claim_site_ai", { _id: id });
  if (error) throw new Error("Could not claim site AI request");
  const job = claimed?.[0];
  if (!job) return;
  const settle = async (outcome: string, message: string | null, neurons = 0, delay = 1) => {
    const { error } = await db.rpc("settle_site_ai", { _id: id, _version: job.lease_version, _outcome: outcome, _error: message ?? "", _neurons: neurons, _delay: delay });
    if (error) throw new Error("Could not save site AI outcome");
  };
  const messages = job.messages as Msg[];
  const input = Math.ceil(messages.reduce((n,m)=>n+m.content.length,0)/4);
  const cost = estimateNeurons(input,2000);
  const pool = eligibleSiteKeys(await loadCloudflarePool(),job.key_position);
  const { data: providers } = await db.from("custom_ai_providers").select("id,base_url,key_encrypted").in("id",pool.map(k=>k.id));
  const { decryptSecret } = await import("./secrets-crypto.server");
  for (const key of pool) {
    const row = providers?.find(p=>p.id===key.id);
    if (!row || !safeSiteProviderUrl(row.base_url)) { await settle("denied","Cloudflare provider address is invalid. Check the saved account address."); return; }
    const { data: reserved, error } = await db.rpc("reserve_site_ai",{_id:id,_version:job.lease_version,_provider:key.id,_position:key.position,_cost:cost,_observed:key.used});
    if (error) throw new Error("Could not reserve shared Cloudflare allowance");
    if (!reserved) continue;
    const token = (await decryptSecret(row.key_encrypted)).replace(/^Bearer\s+/i,"").trim();
    let response: Response;
    try {
      response = await fetch(`${row.base_url.replace(/\/$/,"")}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({model:job.model,messages,stream:true,max_tokens:2000})});
    } catch { await settle("uncertain","Connection interrupted; provider outcome is unknown. No duplicate generation was sent.",cost); return; }
    if (!response.ok) {
      const body = await response.text();
      const attempts = job.provider_id===key.id ? job.key_attempt+1 : 1;
      const retryHeader = response.headers.get("retry-after");
      const retrySeconds = retryHeader ? (Number(retryHeader)||Math.max(0,Math.ceil((Date.parse(retryHeader)-Date.now())/1000))) : 0;
      const decision = siteRetryDecision(response.status,body,attempts,retrySeconds);
      await settle(decision.outcome,`Key #${key.position}: Cloudflare ${response.status}. ${decision.outcome==="retry" ? `Retry ${attempts}/4 scheduled.` : decision.outcome==="next" ? "Trying the next key after cooldown." : decision.outcome==="quota" ? "Daily quota used; moving to the next key." : "Request stopped; check provider access or request settings."}`,decision.outcome==="uncertain" ? cost : 0,decision.delay);
      return;
    }
    let reply="",pending="",done=false;
    const decoder=new TextDecoder();
    const heartbeat=setInterval(()=>{void db.from("site_ai_requests").update({lease_until:new Date(Date.now()+180000).toISOString(),updated_at:new Date().toISOString()}).eq("id",id).eq("lease_version",job.lease_version).eq("status","running").then(()=>undefined,()=>undefined);},20000);
    try {
      if (!response.body) throw new Error("Empty provider stream");
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        pending+=decoder.decode(chunk,{stream:true});
        const frames=pending.split(/\r?\n\r?\n/);pending=frames.pop()??"";
        for(const frame of frames) for(const line of frame.split(/\r?\n/)) {
          if(!line.startsWith("data:")) continue;
          const data=line.slice(5).trim();if(data==="[DONE]"){done=true;continue;}
          const parsed=JSON.parse(data);if(parsed.error) throw new Error("Provider stream rejected");
          reply+=parsed.choices?.[0]?.delta?.content??"";
        }
        const {error}=await db.from("site_ai_requests").update({reply,updated_at:new Date().toISOString()}).eq("id",id).eq("lease_version",job.lease_version).eq("status","running");
        if(error) throw new Error("Could not save partial reply");
      }
      if(!done||!reply.trim()) throw new Error("Incomplete provider reply");
      await settle("complete",null,estimateNeurons(input,Math.ceil(reply.length/4)));
    } catch { await settle("uncertain","Reply interrupted. Saved partial text retained; no duplicate generation sent.",cost); }
    finally { clearInterval(heartbeat); }
    return;
  }
  await settle("wait","All eligible keys are used, reserved or cooling down. Waiting automatically.",0,60);
}

export async function runSiteChat(opts:{projectId:string;userId:string;messages:Msg[];stream:boolean;model?:string|null;requestKey?:string}) {
  const {supabaseAdmin:db}=await import("@/integrations/supabase/client.server");
  const model=pickSiteChatModel(opts.model,await readCloudflareCodingModel());
  const {data:id,error}=await db.rpc("admit_site_ai",{_project:opts.projectId,_user:opts.userId,_key:opts.requestKey??crypto.randomUUID(),_messages:opts.messages,_model:model});
  if(error||!id) return {ok:false as const,status:/limit/i.test(error?.message??"")?429:503,error:error?.message??"Could not save AI request"};
  const {error:dispatchError}=await db.rpc("dispatch_site_ai",{_id:id});
  if(dispatchError) return {ok:false as const,status:503,error:"Request saved; automatic recovery will retry starting it."};
  const read=async()=>{const {data}=await db.from("site_ai_requests").select("status,reply,error,next_attempt_at").eq("id",id).single();return data;};
  if(!opts.stream){
    for(let i=0;i<60;i++){const state=await read();if(state?.status==="completed")return {ok:true as const,reply:state.reply};if(state?.status==="failed")return {ok:false as const,status:502,error:state.error??"AI request failed"};await new Promise(r=>setTimeout(r,1000));}
    return {ok:false as const,status:202,error:"Request continues in the background.",requestId:id};
  }
  const encoder=new TextEncoder();let cancelled=false;
  const body=new ReadableStream<Uint8Array>({async start(controller){let cursor=0;try{while(!cancelled){const state=await read();if(!state)throw new Error("Saved request missing");if(state.reply.length>cursor){controller.enqueue(encoder.encode(`data: ${JSON.stringify({choices:[{delta:{content:state.reply.slice(cursor)}}],requestId:id})}\n\n`));cursor=state.reply.length;}if(state.status==="completed"){controller.enqueue(encoder.encode("data: [DONE]\n\n"));break;}if(state.status==="failed"){controller.enqueue(encoder.encode(`data: ${JSON.stringify({error:state.error,requestId:id})}\n\ndata: [DONE]\n\n`));break;}controller.enqueue(encoder.encode(`: ${state.status} ${id}\n\n`));await new Promise(r=>setTimeout(r,1500));}if(!cancelled)controller.close();}catch{if(!cancelled)controller.error(new Error("Reconnect using the same request ID to read saved progress."));}},cancel(){cancelled=true;}});
  return {ok:true as const,body,requestId:id};
}