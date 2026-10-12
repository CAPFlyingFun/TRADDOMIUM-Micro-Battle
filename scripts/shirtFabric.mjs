/** Fine cotton jersey PBR, baked onto the tee without changing its surface. */
import sharp from 'sharp';
import { Matrix4, Vector3 } from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { pathToFileURL } from 'node:url';
import { rename } from 'node:fs/promises';

const fract=x=>x-Math.floor(x);
// Two curved yarn legs per stitch, staggered between rows. Both tile borders
// meet exactly; the narrow ridges supply relief rather than painted shadows.
function yarn(u,v){
  const row=Math.floor(v),y=fract(v),x=fract(u+(row%2)*.5);
  const spread=.19+.16*Math.cos(y*Math.PI*2);
  const distance=Math.min(Math.abs(x-(.5-spread)),Math.abs(x-(.5+spread)));
  return Math.exp(-((distance/.075)**2));
}
export async function shirtFabric(doc,{correction=new Matrix4(),log=()=>{}}={}){
  const shirt=doc.getRoot().listMeshes()[0].listPrimitives().find(p=>p.getMaterial()?.getName()==='shirt');
  const material=shirt.getMaterial(),P=shirt.getAttribute('POSITION'),V=shirt.getAttribute('TEXCOORD_0');
  const count=P.getCount(),uv=new Float32Array(count*2),q=[],point=new Vector3();
  // A 1.4 mm stitch, four stitches per tile. The second UV set crosses the
  // upper/lower artwork seam continuously, avoiding changes in knit density.
  for(let i=0;i<count;i++){
    P.getElement(i,q);point.fromArray(q).applyMatrix4(correction);
    uv[i*2]=Math.atan2(point.x,point.z)*.2/.0056;
    uv[i*2+1]=point.y/.0056;
  }
  shirt.setAttribute('TEXCOORD_1',doc.createAccessor('shirt-jersey-uv').setBuffer(P.getBuffer()).setType('VEC2').setArray(uv));
  const size=128,normal=Buffer.alloc(size*size*3),rough=Buffer.alloc(size*size*3);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size*4,v=y/size*4,h=yarn(u,v),step=4/size;
    const dx=(yarn(u+step,v)-yarn(u-step,v))*.26,dy=(yarn(u,v+step)-yarn(u,v-step))*.26,l=Math.hypot(dx,dy,1),i=(y*size+x)*3;
    normal.set([Math.round(127.5-127.5*dx/l),Math.round(127.5-127.5*dy/l),Math.round(127.5+127.5/l)],i);
    rough.set([255,Math.round(255*(.91-.12*h)),0],i);
  }
  const png=data=>sharp(data,{raw:{width:size,height:size,channels:3}}).png().toBuffer();
  material.setNormalTexture(doc.createTexture('shirt-jersey-normal').setImage(await png(normal)).setMimeType('image/png')).setNormalScale(.65);
  material.getNormalTextureInfo().setTexCoord(1).setWrapS(10497).setWrapT(10497);
  material.setMetallicRoughnessTexture(doc.createTexture('shirt-jersey-roughness').setImage(await png(rough)).setMimeType('image/png')).setRoughnessFactor(1).setMetallicFactor(0);
  material.getMetallicRoughnessTextureInfo().setTexCoord(1).setWrapS(10497).setWrapT(10497);
  // Add restrained yarn colour grain to the existing colour artwork. Rasterise
  // its own UV triangles, sampling the same physical stitch coordinates.
  const texture=material.getBaseColorTexture(),source=await sharp(texture.getImage()).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const {width,height,channels}=source.info,grain=new Float32Array(width*height).fill(1),indices=shirt.getIndices().getArray(),a=[],b=[],c=[];
  for(let f=0;f<indices.length;f+=3){
    const ids=[indices[f],indices[f+1],indices[f+2]];V.getElement(ids[0],a);V.getElement(ids[1],b);V.getElement(ids[2],c);
    const ax=a[0]*width,ay=a[1]*height,bx=b[0]*width,by=b[1]*height,cx=c[0]*width,cy=c[1]*height,den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
    if(Math.abs(den)<1e-6)continue;
    for(let y=Math.max(0,Math.floor(Math.min(ay,by,cy)));y<=Math.min(height-1,Math.ceil(Math.max(ay,by,cy)));y++)
    for(let x=Math.max(0,Math.floor(Math.min(ax,bx,cx)));x<=Math.min(width-1,Math.ceil(Math.max(ax,bx,cx)));x++){
      const wa=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/den,wb=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/den,wc=1-wa-wb;
      if(Math.min(wa,wb,wc)<0)continue;
      const u=(uv[ids[0]*2]*wa+uv[ids[1]*2]*wb+uv[ids[2]*2]*wc)*4,v=(uv[ids[0]*2+1]*wa+uv[ids[1]*2+1]*wb+uv[ids[2]*2+1]*wc)*4;
      grain[y*width+x]=.975+.04*yarn(u,v);
    }
  }
  for(let i=0;i<grain.length;i++)for(let c=0;c<3;c++)source.data[i*channels+c]=Math.min(255,Math.round(source.data[i*channels+c]*grain[i]));
  texture.setImage(await sharp(source.data,{raw:{width,height,channels}}).png().toBuffer()).setMimeType('image/png');
  material.setExtras({...material.getExtras(),fabric:'cotton-jersey',stitchMillimetres:1.4});
  log('shirt: 1.4 mm jersey knit, yarn normal relief and matte roughness');
}
async function main(){
  await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
  const file='public/models/sarah-base.glb',doc=await io.read(file),skin=doc.getRoot().listSkins()[0],v=[];
  skin.getInverseBindMatrices().getElement(0,v);
  const correction=new Matrix4().fromArray(skin.listJoints()[0].getWorldMatrix()).multiply(new Matrix4().fromArray(v));
  await shirtFabric(doc,{correction,log:console.log});
  await io.write('public/models/sarah-fabric.tmp.glb',doc);await rename('public/models/sarah-fabric.tmp.glb',file);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
