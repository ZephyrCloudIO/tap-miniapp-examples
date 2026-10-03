import { pathToFileURL } from 'node:url';
const { AsyncBatcher } = await import(pathToFileURL(process.argv[2]).href);
import { writeFile } from 'node:fs/promises';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(bounded) {
 const start=performance.now(),batches=[];let deadline;
 const batcher=new AsyncBatcher(items=>{batches.push({atMs:+(performance.now()-start).toFixed(2),size:items.length});clearTimeout(deadline);deadline=undefined;}, {wait:100,maxSize:bounded?8:Infinity});
 for(let i=0;i<20;i++) {
  if(bounded&&!deadline)deadline=setTimeout(()=>void batcher.flush(),150);
  void batcher.addItem(i);
  await delay(30);
 }
 await delay(150);
 return {bounded,inputs:20,cadenceMs:30,quietWaitMs:100,maxSize:bounded?8:null,maxAgeMs:bounded?150:null,batches};
}
const results=[await run(false),await run(true)];
await writeFile('/tmp/tap-email-six-pass-2026-10-01/pacer-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
