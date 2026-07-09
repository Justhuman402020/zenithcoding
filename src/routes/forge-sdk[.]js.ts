import { createFileRoute } from "@tanstack/react-router";

// Tiny client SDK served to every published site so end-users can sign up,
// sign in, and read/write per-site data via the Forge Backend.
//
// Usage in a published site:
//   <script src="/forge-sdk.js"></script>
//   <script>
//     await Forge.auth.signUp({ email, password });
//     await Forge.db.insert("posts", { title: "hi" }, { public: true });
//     const { rows } = await Forge.db.list("posts", { scope: "public" });
//   </script>

const SDK = `(function(){
  var m = location.pathname.match(/^\\/s\\/([^/]+)/);
  var slug = m ? decodeURIComponent(m[1]) : null;
  var origin = location.origin;
  var STORAGE = "forge:site:" + (slug || "") + ":token";
  var USER_KEY = "forge:site:" + (slug || "") + ":user";
  var token = null, user = null;
  try { token = localStorage.getItem(STORAGE); } catch(e){}
  try { user = JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch(e){}

  function req(path, opts){
    opts = opts || {};
    var headers = { "content-type": "application/json" };
    if (token) headers["authorization"] = "Bearer " + token;
    return fetch(origin + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function(r){
      return r.json().then(function(j){
        if (!r.ok) throw new Error(j && j.error ? j.error : ("HTTP " + r.status));
        return j;
      });
    });
  }

  function setSession(t, u){
    token = t; user = u;
    try {
      if (t) localStorage.setItem(STORAGE, t); else localStorage.removeItem(STORAGE);
      if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); else localStorage.removeItem(USER_KEY);
    } catch(e){}
    window.dispatchEvent(new CustomEvent("forge:auth", { detail: { user: u } }));
  }

  var Forge = {
    slug: slug,
    auth: {
      user: function(){ return user; },
      signUp: function(o){
        return req("/api/public/sites/auth/signup", { method:"POST", body: Object.assign({ slug: slug }, o) })
          .then(function(r){ setSession(r.token, r.user); return r.user; });
      },
      signIn: function(o){
        return req("/api/public/sites/auth/signin", { method:"POST", body: Object.assign({ slug: slug }, o) })
          .then(function(r){ setSession(r.token, r.user); return r.user; });
      },
      signOut: function(){
        return req("/api/public/sites/auth/me", { method:"POST" }).finally(function(){ setSession(null, null); });
      },
      refresh: function(){
        return req("/api/public/sites/auth/me?slug=" + encodeURIComponent(slug || ""))
          .then(function(r){ if (r.user) setSession(token, r.user); else setSession(null, null); return r.user; });
      },
      onChange: function(cb){
        var h = function(e){ cb(e.detail.user); };
        window.addEventListener("forge:auth", h);
        return function(){ window.removeEventListener("forge:auth", h); };
      },
    },
    db: {
      list: function(collection, opts){
        opts = opts || {};
        var qs = new URLSearchParams({ slug: slug || "", collection: collection, scope: opts.scope || "public" });
        if (opts.limit) qs.set("limit", String(opts.limit));
        if (opts.offset) qs.set("offset", String(opts.offset));
        return req("/api/public/sites/data?" + qs.toString());
      },
      insert: function(collection, data, opts){
        opts = opts || {};
        return req("/api/public/sites/data", { method:"POST", body: { slug: slug, collection: collection, data: data, is_public: !!opts.public } });
      },
      update: function(id, data, opts){
        opts = opts || {};
        return req("/api/public/sites/data", { method:"PATCH", body: { slug: slug, id: id, data: data, is_public: opts.public } });
      },
      remove: function(id){
        return req("/api/public/sites/data", { method:"DELETE", body: { slug: slug, id: id } });
      },
    },
  };
  window.Forge = Forge;
})();`;

export const Route = createFileRoute("/forge-sdk.js")({
  server: {
    handlers: {
      GET: () => new Response(SDK, {
        status: 200,
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=300",
          "access-control-allow-origin": "*",
        },
      }),
    },
  },
});