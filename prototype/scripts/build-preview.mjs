import {build} from 'vite';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
/** Build only the browser bundle. Assets stay pinned to the source commit. */
const sha=process.env.PREVIEW_SOURCE_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('PREVIEW_SOURCE_SHA must be a complete commit SHA.');
const assetBase=`https://raw.githubusercontent.com/CAPFlyingFun/TRADDOMIUM-Micro-Battle/${sha}/prototype/public/`;
await build({root:process.cwd(),base:'./',publicDir:false,define:{'import.meta.env.BASE_URL':JSON.stringify(assetBase)},build:{outDir:resolve('dist-preview'),emptyOutDir:true}});
console.log(JSON.stringify({sourceCommit:sha,assetBase,directory:'dist-preview'}));
