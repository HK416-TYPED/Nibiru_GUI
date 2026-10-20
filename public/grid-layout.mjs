export function gridLayout(count,columns=4,labels=true){
  if(!Number.isInteger(count)||count<1||count>64)throw new Error('A grid page contains 1–64 images');
  if(![1,2,3,4,8].includes(columns))throw new Error('Unsupported grid columns');
  columns=Math.min(columns,count);
  const rows=Math.ceil(count/columns),base=512,labelBase=labels?56:0;
  const factor=Math.min(1,Math.sqrt(16000000/(columns*base*rows*(base+labelBase))),8192/(columns*base),8192/(rows*(base+labelBase)));
  const cell=Math.max(1,Math.floor(base*factor)),labelHeight=Math.floor(labelBase*factor);
  return{columns,rows,cell,labelHeight,width:columns*cell,height:rows*(cell+labelHeight)};
}

// Maximize the visible area of complete images using their actual proportions.
export function previewLayout(count,width,height,aspect=1,gap=12){
  const ratios=Array.from({length:count},(_,i)=>{
    const ratio=Array.isArray(aspect)?aspect[i]:aspect;
    return Number.isFinite(ratio)&&ratio>0?ratio:1;
  });
  let best={columns:1,rows:count},bestArea=-1;
  for(let columns=1;columns<=count;columns++){
    const rows=Math.ceil(count/columns);
    const cellWidth=Math.max(0,(width-gap*(columns-1))/columns);
    const cellHeight=Math.max(0,(height-gap*(rows-1))/rows);
    const area=ratios.reduce((total,ratio)=>{
      const imageHeight=Math.min(cellWidth/ratio,cellHeight);
      return total+imageHeight*imageHeight*ratio;
    },0);
    if(area>bestArea){bestArea=area;best={columns,rows};}
  }
  return best;
}
