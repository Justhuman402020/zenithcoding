import {expect,it} from "vitest";
import {eligibleSiteKeys,safeSiteProviderUrl,siteRetryDecision} from "../src/lib/site-ai-recovery-policy";
it("project 2 skips keys 1 and 2 exhausted by project 1",()=>{expect(eligibleSiteKeys([{position:2,used:9500,status:"exhausted"},{position:3,used:0,status:"waiting"},{position:1,used:9000,status:"exhausted"}],0).map(k=>k.position)).toEqual([3]);});
it("retries four times after the first rejection then hands off",()=>{for(let attempt=1;attempt<=4;attempt++)expect(siteRetryDecision(429,"rate limited",attempt).outcome).toBe("retry");expect(siteRetryDecision(429,"rate limited",5).outcome).toBe("next");});
it("daily exhaustion advances immediately rather than marking bare 429 as quota",()=>{expect(siteRetryDecision(429,"daily neuron allowance exceeded",1).outcome).toBe("quota");expect(siteRetryDecision(429,"too many requests",1).outcome).toBe("retry");});
it("honors provider waiting time",()=>expect(siteRetryDecision(429,"",1,900).delay).toBe(900));
it("does not rotate around denials",()=>{for(const status of [400,401,402,403,404,422])expect(siteRetryDecision(status,"",1).outcome).toBe("denied");});
it("does not replay ambiguous inference",()=>expect(siteRetryDecision(0,"connection lost",1).outcome).toBe("uncertain"));
it("never sends credentials to deceptive addresses",()=>{expect(safeSiteProviderUrl("https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1")).toBe(true);expect(safeSiteProviderUrl("https://evil.example/api.cloudflare.com/client/v4/accounts/abc123/ai/v1")).toBe(false);});