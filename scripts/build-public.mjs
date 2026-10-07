import {readdir,mkdir,cp} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),out=path.join(root,'dist');
await mkdir(out,{recursive:true});
for(const e of await readdir(root,{withFileTypes:true})){
 if(e.isFile()&&/\.(html|css|js)$/.test(e.name)&&!e.name.startsWith('middleware'))
  await cp(path.join(root,e.name),path.join(out,e.name));
}
for(const dir of ['assets','vendor','data_tiles','data_3d','selection'])await cp(path.join(root,dir),path.join(out,dir),{recursive:true});
console.log('Frontend copied; API source, tests and credentials excluded.');
