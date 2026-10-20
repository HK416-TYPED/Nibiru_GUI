import {el,button,t} from './ui.mjs';
export function singleImageViewer(state,actions,batch) {
  const selected=Math.min(state.imageIndices[batch.id]||0,batch.images.length-1);
  const dots=el('div',{class:'image-dots','aria-label':t(state,'选择图片','Choose image')});
  const scroll=el('div',{class:'single-scroll',tabindex:0,'aria-label':t(state,'上下滚动切换图片','Scroll vertically to change image')});
  function select(index,smooth=true) {
    scroll.scrollTo({top:index*scroll.clientHeight,behavior:smooth&&!matchMedia('(prefers-reduced-motion:reduce)').matches?'smooth':'instant'});
  }
  batch.images.forEach((image,index)=>{
    dots.append(button('',()=>select(index),'image-dot',{'aria-label':t(state,`第 ${index+1} 张图片`,`Image ${index+1}`),'aria-current':index===selected?'true':'false',title:`${index+1} / ${batch.images.length}`}));
    scroll.append(el('section',{class:'single-slide'},button(el('img',{src:image.url,alt:batch.prompt,loading:index===selected?'eager':'lazy'}),()=>actions.showImage(image,batch),'single-image',{'aria-label':t(state,`放大图片 ${index+1}`,`View image ${index+1}`)}),el('span',{class:'single-counter',text:`${index+1} / ${batch.images.length}`})));
  });
  scroll.addEventListener('scroll',()=>{
    const index=Math.max(0,Math.min(batch.images.length-1,Math.round(scroll.scrollTop/Math.max(1,scroll.clientHeight))));
    actions.setImageIndex(batch.id,index);
    [...dots.children].forEach((dot,i)=>dot.setAttribute('aria-current',String(i===index)));
  },{passive:true});
  scroll.addEventListener('keydown',event=>{
    if(['ArrowDown','PageDown','ArrowUp','PageUp'].includes(event.key)){event.preventDefault();const current=state.imageIndices[batch.id]||0;select(Math.max(0,Math.min(batch.images.length-1,current+(['ArrowDown','PageDown'].includes(event.key)?1:-1))));}
  });
  requestAnimationFrame(()=>{if(scroll.isConnected)select(selected,false);});
  return el('div',{class:'single-view'},dots,scroll);
}
