import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function sourceFingerprint(root) {
  const paths=[];
  const walk=async dir=>{
    for(const entry of await readdir(join(root,dir),{withFileTypes:true})) {
      const path=join(dir,entry.name);
      if(entry.isDirectory()) await walk(path);
      else if(entry.isFile()) paths.push(path);
    }
  };
  for(const dir of ['src','topology','providers']) await walk(dir);
  paths.push('package.json','package-lock.json','config.defaults.json','scripts/build.mjs','scripts/source-fingerprint.mjs');
  const hash=createHash('sha256');
  for(const path of paths.sort()) hash.update(path).update('\0').update(await readFile(join(root,path))).update('\0');
  return hash.digest('hex');
}
