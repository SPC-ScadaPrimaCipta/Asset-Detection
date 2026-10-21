import { runDxfDetection } from '@/lib/dxf-detection';

function frameLines(layer: string, x0: number, y0: number, x1: number, y1: number): string {
  const segs: [number,number,number,number][] = [
    [x0,y0,x1,y0],[x1,y0,x1,y1],[x1,y1,x0,y1],[x0,y1,x0,y0],
    [x0,(y0+y1)/2,x1,(y0+y1)/2],[(x0+x1)/2,y0,(x0+x1)/2,y1],
  ];
  return segs.map(([ax,ay,bx,by]) =>
    ['0','LINE','8',layer,'10',String(ax),'20',String(ay),'30','0','11',String(bx),'21',String(by),'31','0'].join('\n')
  ).join('\n');
}

const dxfDoc = (body: string) =>
  Buffer.from(['0','SECTION','2','ENTITIES',body,'0','ENDSEC','0','EOF'].join('\n'),'utf-8');

const body = [
  frameLines('Level 3', 0, 0, 400, 400),
  ['0','TEXT','8','Level 6','10','200','20','100','40','2.5','1','FROM WASTE PIT W-0102'].join('\n'),
].join('\n');

const buf = dxfDoc(body);
const result = runDxfDetection(buf, []);
console.log('All detections:');
for (const d of result.detections) {
  console.log(JSON.stringify({ tag: d.assetTag, type: d.assetType, ev: d.evidence.slice(0,2) }));
}
console.log('Total:', result.detections.length);
