import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),fetch:vi.fn(),keys:[{id:"key3",position:3,used:0,status:"active"}],update:vi.fn()}));
vi.mock("../src/integrations/supabase/client.server",()=>({supabaseAdmin:{rpc:mocks.rpc,from:(table:string)=>table==="custom_ai_providers"?{select:()=>({in:async()=>({data:[{id:"key3",base_url:"https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1",key_encrypted:"mock"}]})})}:{update:mocks.update}}}));
vi.mock("../src/lib/cloudflare-pool.server",()=>({loadCloudflarePool:async()=>mocks.keys,estimateNeurons:()=>200,readCloudflareCodingModel:async()=>"selected"}));
vi.mock("../src/lib/secrets-crypto.server",()=>({decryptSecret:async()=>"mock-test-token"}));
import {processSiteRequest} from "../src/lib/project-ai.server";
const job={id:"job",lease_version:1,messages:[{role:"user",content:"hello"}],model:"selected",key_position:3,key_attempt:0,provider_id:null};
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal("fetch",mocks.fetch);mocks.rpc.mockImplementation(async(name:string)=>({data:name==="claim_site_ai"?[job]:true}));mocks.update.mockImplementation(()=>{const chain:any={eq:()=>chain,select:async()=>({data:[{id:"job"}]})};return chain;});});
it("saves complete split-frame streamed reply before one ledger settlement",async()=>{
 const enc=new TextEncoder();mocks.fetch.mockResolvedValue(new Response(new ReadableStream({start(c){c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Hel'));c.enqueue(enc.encode('lo"}}]}\n\ndata: [DONE]'));c.close();}})));
 await processSiteRequest("job");
 expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({reply:"Hello"}));
 expect(mocks.rpc.mock.calls.filter(c=>c[0]==="settle_site_ai")).toHaveLength(1);
 expect(mocks.rpc).toHaveBeenCalledWith("settle_site_ai",expect.objectContaining({_outcome:"complete"}));
 expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).model).toBe("selected");
});
it("does not generate when another worker owns the request",async()=>{mocks.rpc.mockResolvedValue({data:[]});await processSiteRequest("job");expect(mocks.fetch).not.toHaveBeenCalled();});
it("persists retry rather than looping provider calls",async()=>{mocks.fetch.mockResolvedValue(new Response("too many requests",{status:429}));await processSiteRequest("job");expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(mocks.rpc).toHaveBeenCalledWith("settle_site_ai",expect.objectContaining({_outcome:"retry",_delay:60}));});
it("unknown transport outcome stops without replay",async()=>{mocks.fetch.mockRejectedValue(new Error("network"));await processSiteRequest("job");expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(mocks.rpc).toHaveBeenCalledWith("settle_site_ai",expect.objectContaining({_outcome:"uncertain"}));});