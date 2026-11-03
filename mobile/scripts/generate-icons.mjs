import {Resvg} from '@resvg/resvg-js';
import {readFile,writeFile} from 'node:fs/promises';

const svg=await readFile(new URL('../public/icon.svg',import.meta.url),'utf8');
const png=size=>new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng();
await writeFile(new URL('../public/app-icon.png',import.meta.url),png(1024));
await writeFile(new URL('../public/icon-192.png',import.meta.url),png(192));
const sizes=[16,32,48,64,128,256],images=sizes.map(png),header=Buffer.alloc(6+16*sizes.length);
header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
sizes.forEach((size,i)=>{const index=6+i*16;header[index]=size===256?0:size;header[index+1]=header[index];header.writeUInt16LE(1,index+4);header.writeUInt16LE(32,index+6);header.writeUInt32LE(images[i].length,index+8);header.writeUInt32LE(offset,index+12);offset+=images[i].length;});
await writeFile(new URL('../public/app-icon.ico',import.meta.url),Buffer.concat([header,...images]));
console.log('Generated Shiye PNG and multi-resolution Windows ICO.');
