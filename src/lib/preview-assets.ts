// Makes a project's own pictures, fonts and media load inside the editor preview.
// The preview is an inline (srcdoc) frame, so "/layers/sky.webp" would otherwise be
// requested from Code Haven's own site and fail. Files are mapped by project path and
// served from inside the frame instead.

export type PreviewFile = { path: string; content: string };

const ASSET_EXT = /\.(png|jpe?g|gif|webp|avif|apng|svg|ico|bmp|mp4|webm|ogg|mp3|wav|m4a|woff2?|ttf|otf|eot|json|txt|glb|gltf|hdr|wasm)$/i;

const MIME: Record<string, string> = {
  svg: "image/svg+xml", json: "application/json", txt: "text/plain", gltf: "model/gltf+json",
};

function clean(path: string): string {
  return path.trim().replace(/^\.{0,2}\/+/, "").replace(/\/+/g, "/");
}

function asDataUrl(path: string, content: string): string {
  if (content.startsWith("data:")) return content;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return `data:${MIME[ext] || "text/plain"};charset=utf-8,${encodeURIComponent(content)}`;
}

/** Project path (as the site would request it, without leading slash) -> data URL. */
export function previewAssetMap(files: PreviewFile[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of files) {
    const p = clean(f.path);
    if (!ASSET_EXT.test(p) && !f.content.startsWith("data:")) continue;
    if (p === "index.html" || /^assets\/index-[^/]+\.(js|css)$/.test(p)) continue;
    const url = asDataUrl(p, f.content);
    // Vite serves public/x at /x; keep both spellings reachable.
    const served = p.startsWith("public/") ? p.slice(7) : p;
    if (!(served in map)) map[served] = url;
  }
  return map;
}

/** Same lookup the in-frame runtime uses: strips origin, query, ./, /, public/ and leading folders. */
export function assetKey(map: Record<string, string>, raw: string): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s || /^(data:|blob:|#|javascript:|mailto:|tel:)/i.test(s)) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "").replace(/^\/\/[^/]+/, "");
  s = s.split("#")[0].split("?")[0].replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "");
  try { s = decodeURIComponent(s); } catch { /* keep raw */ }
  while (s) {
    if (s in map) return s;
    if (s.startsWith("public/") && s.slice(7) in map) return s.slice(7);
    const i = s.indexOf("/");
    if (i < 0) return null;
    s = s.slice(i + 1);
  }
  return null;
}

const ATTRS = ["src", "srcset", "href", "poster", "xlink:href"];

function runtimeScript(map: Record<string, string>): string {
  const json = JSON.stringify(map).replace(/</g, "\\u003c");
  return `<script data-ch-assets>(function(){var A=${json};var B={};
function key(raw){if(typeof raw!=="string")return null;var s=raw.trim();if(!s||/^(data:|blob:|#|javascript:|mailto:|tel:)/i.test(s))return null;s=s.replace(/^[a-z][a-z0-9+.-]*:\\/\\/[^/]+/i,"").replace(/^\\/\\/[^/]+/,"");s=s.split("#")[0].split("?")[0].replace(/^(\\.\\.?\\/)+/,"").replace(/^\\/+/,"");try{s=decodeURIComponent(s)}catch(e){}while(s){if(Object.prototype.hasOwnProperty.call(A,s))return s;if(s.indexOf("public/")===0&&Object.prototype.hasOwnProperty.call(A,s.slice(7)))return s.slice(7);var i=s.indexOf("/");if(i<0)return null;s=s.slice(i+1);}return null;}
function url(k){if(B[k])return B[k];var d=A[k];try{var c=d.indexOf(",");var head=d.slice(5,c);if(/;base64$/.test(head)){var bin=atob(d.slice(c+1));var n=bin.length;var u=new Uint8Array(n);for(var j=0;j<n;j++)u[j]=bin.charCodeAt(j);B[k]=URL.createObjectURL(new Blob([u],{type:head.replace(/;base64$/,"")}));}else B[k]=d;}catch(e){B[k]=d;}return B[k];}
function one(v){var k=key(v);return k?url(k):v;}
function set(v){if(/^data:/i.test(String(v).trim()))return v;return String(v).split(",").map(function(p){var t=p.trim();if(!t)return p;var sp=t.search(/\\s/);var u=sp<0?t:t.slice(0,sp);var r=sp<0?"":t.slice(sp);return one(u)+r;}).join(", ");}
function css(v){return String(v).replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/g,function(m,q,u){var k=key(u);return k?'url("'+url(k)+'")':m;});}
function fix(name,v){if(v==null)return v;name=String(name).toLowerCase();if(name==="srcset"||name==="imagesrcset")return set(v);if(name==="style")return css(v);if(name==="src"||name==="href"||name==="xlink:href"||name==="poster"||name==="data")return one(String(v));return v;}
window.__chAsset=one;
var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(this.tagName==="A"&&String(n).toLowerCase()==="href")return sa.call(this,n,v);return sa.call(this,n,fix(n,v));};
var sn=Element.prototype.setAttributeNS;Element.prototype.setAttributeNS=function(ns,n,v){return sn.call(this,ns,n,fix(n,v));};
function prop(C,p,kind){if(!C)return;var d=Object.getOwnPropertyDescriptor(C.prototype,p);if(!d||!d.set)return;Object.defineProperty(C.prototype,p,{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,kind==="set"?set(v):one(String(v)));}});}
prop(window.HTMLImageElement,"src");prop(window.HTMLImageElement,"srcset","set");prop(window.HTMLSourceElement,"src");prop(window.HTMLSourceElement,"srcset","set");prop(window.HTMLMediaElement,"src");prop(window.HTMLVideoElement,"poster");prop(window.HTMLLinkElement,"href");prop(window.HTMLInputElement,"src");
var sp=CSSStyleDeclaration.prototype.setProperty;CSSStyleDeclaration.prototype.setProperty=function(n,v,p){return sp.call(this,n,typeof v==="string"?css(v):v,p);};
["background","backgroundImage","maskImage","webkitMaskImage","listStyleImage","borderImage","borderImageSource","content","cursor"].forEach(function(p){var d=Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype,p);if(!d||!d.set)return;Object.defineProperty(CSSStyleDeclaration.prototype,p,{configurable:true,get:d.get,set:function(v){d.set.call(this,typeof v==="string"?css(v):v);}});});
var of=window.fetch;if(of)window.fetch=function(i,o){if(typeof i==="string"||i instanceof URL){var k=key(String(i));if(k)return of.call(this,url(k),o);}else if(i&&i.url){var k2=key(i.url);if(k2)return of.call(this,url(k2),o);}return of.apply(this,arguments);};
var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){var a=Array.prototype.slice.call(arguments);var k=key(String(u));if(k)a[1]=url(k);return xo.apply(this,a);};
function restore(el){if(!el||el.nodeType!==1)return;for(var i=0;i<${ATTRS.length};i++){var n=${JSON.stringify(ATTRS)}[i];var a="data-ch-asset-"+n.replace(":","-");if(el.hasAttribute(a)){var v=el.getAttribute(a);el.removeAttribute(a);el.setAttribute(n,v);}}for(var j=0;j<5;j++){var n=["src","srcset","href","poster","xlink:href"][j];if(el.tagName!=="A"&&el.hasAttribute(n)){var old=el.getAttribute(n);var next=fix(n,old);if(next!==old)el.setAttribute(n,next);}}if(el.hasAttribute("style")){var oldStyle=el.getAttribute("style");var newStyle=css(oldStyle);if(newStyle!==oldStyle)el.setAttribute("style",newStyle);}if(el.tagName==="STYLE"&&/url\\(/.test(el.textContent||"")){var t=css(el.textContent);if(t!==el.textContent)el.textContent=t;}}
function walk(n){restore(n);if(n.querySelectorAll){var l=n.querySelectorAll("[src],[srcset],[href],[poster],[xlink\\:href],[style],[data-ch-asset-src],[data-ch-asset-srcset],[data-ch-asset-href],[data-ch-asset-poster],[data-ch-asset-xlink-href],style");for(var i=0;i<l.length;i++)restore(l[i]);}}
new MutationObserver(function(ms){ms.forEach(function(m){if(m.type==="characterData"){var p=m.target.parentNode;if(p&&p.tagName==="STYLE")restore(p);}m.addedNodes&&m.addedNodes.forEach(function(n){if(n.nodeType===1)walk(n);else if(n.parentNode&&n.parentNode.tagName==="STYLE")restore(n.parentNode);});});}).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
document.addEventListener("DOMContentLoaded",function(){walk(document.documentElement);});
})();<\/script>`;
}

/**
 * Rewrites the preview page so the project's own files load: static attributes are
 * parked (so the browser never requests the wrong address) and restored by the runtime.
 */
export function injectPreviewAssets(html: string, files: PreviewFile[]): string {
  const map = previewAssetMap(files);
  if (!Object.keys(map).length) return html;
  const parked = html.replace(/<(?!a[\s>])([a-z][a-z0-9-]*)(\s[^<>]*?)?>/gi, (tag, name: string, attrs?: string) => {
    if (!attrs || /^(script|meta)$/i.test(name)) return tag;
    const next = attrs.replace(/(\s)(src|srcset|href|poster|xlink:href)=(["'])([^"']*)\3/gi, (m, sp, attr: string, q, value: string) => {
      const lower = attr.toLowerCase();
      const hit = lower === "srcset"
        ? value.split(",").some((part) => assetKey(map, part.trim().split(/\s+/)[0] || ""))
        : assetKey(map, value);
      return hit ? `${sp}data-ch-asset-${lower.replace(":", "-")}=${q}${value}${q}` : m;
    });
    return next === attrs ? tag : `<${name}${next}>`;
  });
  const script = runtimeScript(map);
  if (/<head[^>]*>/i.test(parked)) return parked.replace(/<head[^>]*>/i, (h) => `${h}${script}`);
  return `${script}${parked}`;
}
