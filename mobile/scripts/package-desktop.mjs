import {packager} from '@electron/packager';
import {mkdir,cp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';

const pkg=JSON.parse(await readFile('package.json','utf8'));
const stage=path.resolve('.desktop-stage');
await mkdir(stage,{recursive:true});
for(const file of ['dist','desktop','proxy.js','src/default-sources.json'])await cp(file,path.join(stage,file),{recursive:true});
await writeFile(path.join(stage,'package.json'),JSON.stringify({name:'shiye-reader',productName:'拾页',version:pkg.version,type:'module',main:'desktop/main.mjs',license:'MIT'}));
await writeFile(path.join(stage,'使用说明.txt'),'拾页 Windows 本机版\r\n\r\n解压整个文件夹后，双击 拾页.exe。请保留旁边的文件。\r\n无需安装 Node、Python 或代理软件。搜索和下载需要能够访问书源的网络。\r\n书库保存在当前 Windows 用户的 AppData\\Roaming\\ShiyeReader，更新程序时保留。\r\n换电脑或清理用户数据前，在本地书架导出 TXT 或备份书库。\r\n');
const paths=await packager({dir:stage,name:'拾页',platform:'win32',arch:'x64',electronVersion:pkg.devDependencies.electron,out:'desktop-out',overwrite:true,asar:true,prune:false,download:process.env.ELECTRON_MIRROR?{mirrorOptions:{mirror:process.env.ELECTRON_MIRROR}}:undefined});
for(const dir of paths)await cp(path.join(stage,'使用说明.txt'),path.join(dir,'使用说明.txt'));
console.log(paths.join('\n'));
