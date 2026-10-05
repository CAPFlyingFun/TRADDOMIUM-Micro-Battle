import {createHash} from 'node:crypto';import {readdirSync,readFileSync} from 'node:fs';import {join} from 'node:path';
/** Any shell OR asset change invalidates stable public URLs in the offline cache. */
export function pwaRevision(root){
 const hash=createHash('sha256');
 function walk(relative=''){
  for(const entry of readdirSync(join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const key=relative?relative+'/'+entry.name:entry.name;
   if(entry.isDirectory())walk(key);
   else if(!['sw.js','version.json'].includes(key))hash.update(key).update('\0').update(readFileSync(join(root,key)));
  }
 }
 walk();return hash.digest('hex').slice(0,12);
}
