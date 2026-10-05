/** Scoped registration supports both the root and existing /v1/ installs. */
export function registerPwa(){
 if(!('serviceWorker' in navigator)||import.meta.env.DEV)return;
 window.addEventListener('load',()=>{
  const base=new URL(import.meta.env.BASE_URL,location.href);
  navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'}).then(registration=>{
   void registration.update().catch(()=>{});
   // No automatic reload: an open, session-only lab must not lose progress.
   document.addEventListener('visibilitychange',()=>{if(!document.hidden)void registration.update().catch(()=>{});});
  }).catch(error=>console.warn('Offline cache unavailable',error));
 },{once:true});
}
