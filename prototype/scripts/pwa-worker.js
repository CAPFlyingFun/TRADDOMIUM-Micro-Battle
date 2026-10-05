/* Build substitutes shell URLs and revision. Each mount has an isolated cache. */
const shell=__SHELL__,revision=__REVISION__;
const base=new URL(self.registration.scope),prefix='tmb-hybrid:'+base.pathname+':',name=prefix+revision;
self.addEventListener('install',event=>event.waitUntil(caches.open(name).then(cache=>cache.addAll(shell.map(p=>new URL(p,base).href))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const own=(await caches.keys()).filter(k=>k.startsWith(prefix));
 // Keep the immediately preceding shell for open tabs still using old bundles.
 for(const key of own.slice(0,-2))if(key!==name)await caches.delete(key);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==base.origin||event.request.headers.has('range'))return;
 const local=url.pathname.slice(base.pathname.length);if(!url.pathname.startsWith(base.pathname)||/^(island|legacy|v1)\//.test(local))return;
 if(event.request.mode==='navigate'){
  // Never substitute the hybrid shell for a different mounted game.
  if(local!==''&&local!=='index.html')return;
  event.respondWith(fetch(event.request).catch(()=>caches.open(name).then(c=>c.match(new URL('index.html',base).href))));return;
 }
 if(local==='sw.js'||local==='version.json')return;
 event.respondWith((async()=>{
  const cache=await caches.open(name),cached=await cache.match(event.request);if(cached)return cached;
  const response=await fetch(event.request);
  if(response.ok&&['basic','default'].includes(response.type)){
   try{await cache.put(event.request,response.clone());const keys=await cache.keys();if(keys.length>260){const protectedUrls=new Set(shell.map(p=>new URL(p,base).href));const victim=keys.find(k=>!protectedUrls.has(k.url));if(victim)await cache.delete(victim);}}catch{/* Cache pressure must not prevent playback. */}
  }
  return response;
 })());
});
