(()=>{
const root=document.getElementById('photoApp');
if(!root)return;
const $=id=>root.querySelector('#'+id)||document.getElementById(id), canvas=$('canvas'),ctx=canvas.getContext('2d');
const colors=['#f5e642','#ed3029','#2878f0','#32a852','#8b5cf6','#ffffff'];
const MARK_SCALE=1.6; // 标注线条粗细及端点大小统一倍率

// ==================================================
// 全局字号控制：文字、长度标注、箭头、线条统一倍率
// 屏幕预览与图片导出共用同一套计算公式
// ==================================================

function markLineWidth(width,scale=fontScale){
 return Math.max(.8,width/850)*scale*MARK_SCALE;
}

function markArrowSize(width,scale=fontScale){
 return Math.max(5,width/115)*scale*MARK_SCALE;
}

function markDotRadius(width,scale=fontScale){
 return (
   Math.max(3,width/260)*MARK_SCALE*scale +
   Math.max(2.5,Math.max(5,width/115)*MARK_SCALE*scale*.34)
 )/2;
}

function dimensionFontSize(width,scale=fontScale){
 return Math.max(13,width/55)*scale;
}

// 不再使用旧文字对象保存的固定字号，全部跟随全局字号
function annotationTextSize(item,width){
 return dimensionFontSize(width,fontScale);
}
let color='#ed3029',fontScale=1.2,arrowStyle=(window.LinuoBase?.getStorage('linuo_arrow_style','dot'))||'dot',lineStyle=(window.LinuoBase?.getStorage('linuo_line_style','dashed'))||'dashed',labelStyle=localStorage.getItem('linuo_label_style')||'white',photo=null,photoBaseData='',photoName='照片',dims=[],texts=[],history=[],redoStack=[],mode='idle',firstPoint=null,pendingDim=null,selected=-1,selectedText=-1,editingDimIndex=-1,textStart=null,livePoint=null,longPressTimer=null,longPressFired=false,photos=[],currentPhotoIndex=-1,view={scale:1,x:0,y:0},pointer=null;
if(labelStyle==='yellow')labelStyle='white';
const toast=m=>{const t=$('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2100)};

function sharedInput(){return window.LinuoSharedInput||null;}
function setKeyFromShared(value){
 const val=String(value??'0').slice(0,9)||'0';
 $('valueInput').value=val;
 if(pendingDim){pendingDim.value=val;render()}
 else if(editingDimIndex>=0&&dims[editingDimIndex]){dims[editingDimIndex].value=val;render()}
}
function openNumericKeyboard(initialValue='0'){
 const api=sharedInput();
 if(!api||typeof api.openNumericInput!=='function'){toast('量房共享数字键盘尚未就绪');return false;}
 setKeyFromShared(initialValue);
 return api.openNumericInput({
  value:String(initialValue??'0'),
  onInput:value=>setKeyFromShared(value),
  onConfirm:value=>{setKeyFromShared(value);confirmNumeric();closeNumericKeyboard();$('valueInput').blur();}
 });
}
function closeNumericKeyboard(){const api=sharedInput();if(api&&typeof api.closeNumericInput==='function')api.closeNumericInput();}
colors.forEach(c=>{const b=document.createElement('button');b.className='swatch'+(c===color?' active':'');b.dataset.color=c;b.style.background=c;b.onclick=()=>{color=c;root.querySelectorAll('.swatch').forEach(x=>x.classList.remove('active'));b.classList.add('active');if(selected>=0){dims[selected].color=c;render()}else if(selectedText>=0&&texts[selectedText]){texts[selectedText].color=c;render();snapshot();}};$('colors').append(b)});
// 字号按钮：全局统一调整所有已有标注及后续新增标注
root.querySelectorAll('.fontbtn').forEach(b=>{
 b.onclick=()=>{
   const next=Number(b.dataset.size);

   if(!Number.isFinite(next)||next<=0)return;

   // 修改全局字号倍率
   fontScale=next;

   // 更新字号按钮选中状态
   root.querySelectorAll('.fontbtn').forEach(x=>{
     x.classList.toggle('active',x===b);
   });

   // 重新绘制全部文字、尺寸线、箭头和引线
   render();
 };
});

$('returnMeasureBtn').onclick=()=>{
 const api=sharedInput();if(api&&typeof api.closePhotoAnnotation==='function'){api.closePhotoAnnotation();return;}
 if(history.length>1)history.back();else toast('请使用浏览器返回按钮退出');
};
$('arrowStyle').value=arrowStyle;$('lineStyle').value=lineStyle;$('labelStyle').value=labelStyle;
$('arrowStyle').onchange=()=>{arrowStyle=$('arrowStyle').value;localStorage.setItem('linuo_arrow_style',arrowStyle);window.dispatchEvent(new CustomEvent('linuo-annotation-style-change'));render()};
$('lineStyle').onchange=()=>{lineStyle=$('lineStyle').value;localStorage.setItem('linuo_line_style',lineStyle);window.dispatchEvent(new CustomEvent('linuo-annotation-style-change'));render()};
$('labelStyle').onchange=()=>{labelStyle=$('labelStyle').value;localStorage.setItem('linuo_label_style',labelStyle);render()};
$('confirmAnnotationSettings').onclick=()=>{arrowStyle=$('arrowStyle').value;lineStyle=$('lineStyle').value;labelStyle=$('labelStyle').value;localStorage.setItem('linuo_arrow_style',arrowStyle);localStorage.setItem('linuo_line_style',lineStyle);localStorage.setItem('linuo_label_style',labelStyle);window.dispatchEvent(new CustomEvent('linuo-annotation-style-change'));toast('标注样式已保存')};

function snapshot(){history.push(JSON.stringify({dims,texts}));if(history.length>60)history.shift();redoStack=[]}
function restore(s){const o=JSON.parse(s);dims=o.dims;texts=o.texts;selected=-1;render()}
function resizeCanvas(){if(!photo)return;const stage=$('stage'),w=stage.clientWidth,h=stage.clientHeight;let s=Math.min(w/photo.width,h/photo.height);canvas.width=photo.width;canvas.height=photo.height;canvas.style.width=(photo.width*s)+'px';canvas.style.height=(photo.height*s)+'px';view={scale:1,x:0,y:0};applyView();render()}
function applyView(){canvas.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`;}
function render(){
 if(!photo)return;
 ctx.clearRect(0,0,canvas.width,canvas.height);
 ctx.drawImage(photo,0,0);
 dims.forEach((d,i)=>drawDim(d,i===selected));
 if(pendingDim)drawDim(pendingDim,true);
 if(pointer?.kind==='drawSecond'&&firstPoint){
   drawDim({x1:firstPoint.x,y1:firstPoint.y,x2:pointer.current.x,y2:pointer.current.y,value:'',color,offset:0,textOffset:0},false);
 }

 // 第一端点预览：拖动时跟随手指，松开后保留已确定的第一点标记
 const firstMark=pointer?.kind==='drawFirst'?pointer.current:(mode==='draw'&&firstPoint?firstPoint:null);

 if(firstMark){
   const r=Math.max(8,canvas.width/100),arm=r*1.6;

   ctx.save();
   ctx.strokeStyle='#ef3c9b';
   ctx.lineWidth=Math.max(2,canvas.width/500);

   ctx.beginPath();
   ctx.arc(firstMark.x,firstMark.y,r,0,Math.PI*2);

   ctx.moveTo(firstMark.x-arm,firstMark.y);
   ctx.lineTo(firstMark.x+arm,firstMark.y);

   ctx.moveTo(firstMark.x,firstMark.y-arm);
   ctx.lineTo(firstMark.x,firstMark.y+arm);

   ctx.stroke();
   ctx.restore();
 }
 // 文字工具第一点定位标记
const textFirstMark=pointer?.kind==='textFirst'
  ?pointer.current
  :(mode==='text'&&textStart?textStart:null);

if(textFirstMark){
   const r=Math.max(8,canvas.width/100),arm=r*1.6;

   ctx.save();
   ctx.strokeStyle='#ef3c9b';
   ctx.lineWidth=Math.max(2,canvas.width/500);

   ctx.beginPath();
   ctx.arc(textFirstMark.x,textFirstMark.y,r,0,Math.PI*2);

   ctx.moveTo(textFirstMark.x-arm,textFirstMark.y);
   ctx.lineTo(textFirstMark.x+arm,textFirstMark.y);

   ctx.moveTo(textFirstMark.x,textFirstMark.y-arm);
   ctx.lineTo(textFirstMark.x,textFirstMark.y+arm);

   ctx.stroke();
   ctx.restore();
}
 if(pointer?.kind==='textLeader'&&textStart){
   const q=pointer.current;ctx.save();ctx.strokeStyle=color;ctx.lineWidth=markLineWidth(canvas.width,fontScale);ctx.setLineDash(lineStyle==='dashed'?[6*fontScale,4*fontScale]:[]);ctx.beginPath();ctx.moveTo(textStart.x,textStart.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.restore();
 }
 texts.forEach((t,i)=>drawTextItem(t,i===selectedText));
 $('valueBar').value=selected>=0?`${dims[selected].value}`:'—';
 if(currentPhotoIndex>=0&&photos[currentPhotoIndex]){
  photos[currentPhotoIndex].dims=JSON.parse(JSON.stringify(dims));
  photos[currentPhotoIndex].texts=JSON.parse(JSON.stringify(texts));
 }
}
function drawLabelPlateOn(target,x,y,text,fs,color,rotation=0){
 target.save();
 target.translate(x,y);
 target.rotate(rotation);
 target.font=`bold ${fs}px Arial,sans-serif`;
 const tw=target.measureText(text).width,pad=fs*.32,h=fs*1.45;
 const plate=labelStyle==='white'?'rgba(255,255,255,.82)':labelStyle==='blue'?'rgba(40,120,240,.72)':labelStyle==='black'?'rgba(0,0,0,.72)':'transparent';
 if(labelStyle!=='none'){
   target.fillStyle=plate;
   target.fillRect(-tw/2-pad,-h/2,tw+pad*2,h);
 }
 target.fillStyle=color;
 target.textAlign='center';
 target.textBaseline='middle';
 target.fillText(text,0,0);
 target.restore();
}
function drawLabelPlate(x,y,text,fs,color,rotation=0){
 drawLabelPlateOn(ctx,x,y,text,fs,color,rotation);
}

// 尺寸标注只保留一套绘制逻辑：屏幕和导出都调用本函数
function drawDimOn(target,d,sel,w){
 const dx=d.x2-d.x1,dy=d.y2-d.y1,len=Math.hypot(dx,dy)||1;
 const nx=-dy/len,ny=dx/len,offset=d.offset||0;
 const ax=d.x1+nx*offset,ay=d.y1+ny*offset;
 const bx=d.x2+nx*offset,by=d.y2+ny*offset;
 // 长度标注跟随全局字号倍率

 const scale=fontScale;

 target.save();
 target.strokeStyle=d.color;
 target.fillStyle=d.color;
 // 选中时只显示控制点，不额外加粗，保证编辑画面与导出线宽一致
 target.lineWidth=markLineWidth(w,scale);
 target.setLineDash(lineStyle==='dashed'?[7*scale,5*scale]:[]);
 target.beginPath();
 target.moveTo(ax,ay);
 target.lineTo(bx,by);
 target.stroke();
 target.setLineDash([]);

 const head=markArrowSize(w,scale),a=Math.atan2(by-ay,bx-ax);
 function endpoint(px,py,ang){
   if(arrowStyle==='arrow'){
     target.beginPath();
     target.moveTo(px,py);
     target.lineTo(px-head*Math.cos(ang-.45),py-head*Math.sin(ang-.45));
     target.lineTo(px-head*Math.cos(ang+.45),py-head*Math.sin(ang+.45));
     target.closePath();
     target.fill();
   }else if(arrowStyle==='tick'){
     const tx=-Math.sin(ang),ty=Math.cos(ang);
     target.beginPath();
     target.moveTo(px-tx*head*.7,py-ty*head*.7);
     target.lineTo(px+tx*head*.7,py+ty*head*.7);
     target.stroke();
   }else{
     target.beginPath();
     target.arc(px,py,Math.max(2.5,head*.34),0,Math.PI*2);
     target.fill();
   }
 }
 endpoint(ax,ay,a+Math.PI);
 endpoint(bx,by,a);

 target.setLineDash(lineStyle==='dashed'?[7*scale,5*scale]:[]);
 target.beginPath();
 target.moveTo(d.x1,d.y1);
 target.lineTo(ax,ay);
 target.moveTo(d.x2,d.y2);
 target.lineTo(bx,by);
 target.stroke();
 target.setLineDash([]);

 const mx=(ax+bx)/2,my=(ay+by)/2;
 const label=`${d.value??''}`,fs=dimensionFontSize(w,scale);
 const tx=mx+nx*(d.textOffset||0),ty=my+ny*(d.textOffset||0);
 let rot=a;
 if(rot>Math.PI/2||rot< -Math.PI/2)rot+=Math.PI;
 if(label)drawLabelPlateOn(target,tx,ty,label,fs,d.color,rot);

// 选中控制点：取消中间文字控制点，两侧端点放大1.5倍
// 控制点仅用于编辑，不写入导出图片
if(sel){
  const rr=Math.max(8,w/115)*1.5;

  for(const [hx,hy] of [[d.x1,d.y1],[d.x2,d.y2]]){
    target.beginPath();
    target.arc(hx,hy,rr,0,Math.PI*2);
    target.fillStyle='rgba(255,255,255,.82)';
    target.fill();
    target.lineWidth=Math.max(1.5,w/650);
    target.strokeStyle=d.color;
    target.stroke();
  }
}
 target.restore();
}
function drawDim(d,sel){
 drawDimOn(ctx,d,sel,canvas.width);
}

// 文字标注也只保留一套绘制逻辑，屏幕和导出共用字号、引线和圆点算法
function drawTextItemOn(target,t,sel,w){
 const fs=annotationTextSize(t,w);
 target.save();
 if(Number.isFinite(t.anchorX)&&Number.isFinite(t.anchorY)){
   target.strokeStyle=t.color;
   target.lineWidth=markLineWidth(w,fontScale);
   target.setLineDash(lineStyle==='dashed'?[6*fontScale,4*fontScale]:[]);
   target.beginPath();
   target.moveTo(t.anchorX,t.anchorY);
   target.lineTo(t.x,t.y);
   target.stroke();
   target.setLineDash([]);

   target.beginPath();
target.arc(t.anchorX,t.anchorY,Math.max(2.5,markArrowSize(w,fontScale)*.34),0,Math.PI*2);
   target.fillStyle=t.color;
   target.fill();
 }
 target.font=`bold ${fs}px sans-serif`;
 target.textAlign='center';
 target.textBaseline='middle';
 const textWidth=target.measureText(t.text).width,pad=fs*.35,h=fs*1.5;
 if(labelStyle!=='none'){
   target.fillStyle=labelStyle==='blue'?'rgba(40,120,240,.72)':labelStyle==='black'?'rgba(0,0,0,.72)':'rgba(255,255,255,.82)';
   target.fillRect(t.x-textWidth/2-pad,t.y-h/2,textWidth+pad*2,h);
 }
 target.fillStyle=t.color;
 target.fillText(t.text,t.x,t.y);
 if(sel){
   target.strokeStyle='#4d83f5';
   target.lineWidth=2;
   target.strokeRect(t.x-textWidth/2-pad-3,t.y-h/2-3,textWidth+2*pad+6,h+6);
 }
 target.restore();
}
function drawTextItem(t,sel){
 drawTextItemOn(ctx,t,sel,canvas.width);
}

function loadFile(file){if(!file)return Promise.resolve();cacheCurrentPhotoToGallery();closeNumericKeyboard();return new Promise(resolve=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{const scale=900/Math.max(1,img.naturalHeight),w=Math.max(1,Math.round(img.naturalWidth*scale)),h=900,c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);photoBaseData=c.toDataURL('image/jpeg',.88);const compressed=new Image();compressed.onload=()=>{photo=compressed;photoName=file.name||'现场照片';dims=[];texts=[];history=[];redoStack=[];selected=-1;selectedText=-1;editingDimIndex=-1;pendingDim=null;firstPoint=null;textStart=null;pointer=null;hideMagnifier();$('empty').classList.add('hidden');canvas.classList.remove('hidden');$('hint').textContent=`照片已压缩至 ${w}×${h}；点击长度后选择两个端点`;resizeCanvas();addPhotoRecord();URL.revokeObjectURL(url);resolve()};compressed.onerror=()=>{URL.revokeObjectURL(url);toast('图片压缩失败');resolve()};compressed.src=photoBaseData};img.onerror=()=>{URL.revokeObjectURL(url);toast('图片读取失败');resolve()};img.src=url})}
function addPhotoRecord(){const data=exportData();photos.push({name:photoName,base:photoBaseData,data,thumb:data,dims:JSON.parse(JSON.stringify(dims)),texts:JSON.parse(JSON.stringify(texts))});currentPhotoIndex=photos.length-1;renderGallery()}
function cacheCurrentPhotoToGallery(){if(!photo||currentPhotoIndex<0||!photos[currentPhotoIndex])return false;try{const r=photos[currentPhotoIndex],data=exportData();r.name=photoName;r.base=photoBaseData||r.base;r.data=data;r.thumb=data;r.dims=JSON.parse(JSON.stringify(dims||[]));r.texts=JSON.parse(JSON.stringify(texts||[]));return true}catch(e){console.error('照片库缓存失败',e);return false}}
function exportData(){
 const c=document.createElement('canvas');
 c.width=photo.width;
 c.height=photo.height;
 const x=c.getContext('2d');
 x.drawImage(photo,0,0);
 // 仅导出实际标注，不导出编辑用的选中控制点
 dims.forEach(d=>drawDimOn(x,d,false,c.width));
 texts.forEach(t=>drawTextItemOn(x,t,false,c.width));
 return c.toDataURL('image/jpeg',.94);
}

function loadPhotoFromRecord(index){
 const p=photos[index];if(!p)return toast('照片记录不存在');
 // 切换到另一张照片前，先把当前照片刚追加的标注合成回照片库，避免切换丢失。
 if(currentPhotoIndex>=0&&currentPhotoIndex!==index)cacheCurrentPhotoToGallery();
 // 优先读取未标注的原图，再把尺寸与文字作为可继续编辑的图层恢复。
 const rawSrc=p.base||p.raw||p.original||p.photo||'';
 const src=rawSrc||p.data||p.thumb;if(!src)return toast('照片数据为空，无法重新加载');
 const hasSeparateAnnotations=!!rawSrc;
 const im=new Image();
 im.onload=()=>{
  try{
   closeNumericKeyboard();
   photo=im;photoBaseData=rawSrc||src;photoName=p.name||'照片';currentPhotoIndex=index;
   // 老记录若只有合成图，则不重复叠加旧标注；仍可在该图片上继续增加新标记。
   dims=hasSeparateAnnotations?JSON.parse(JSON.stringify(p.dims||[])):[];
   texts=hasSeparateAnnotations?JSON.parse(JSON.stringify(p.texts||[])):[];
   mode='idle';firstPoint=null;pendingDim=null;selected=-1;selectedText=-1;editingDimIndex=-1;textStart=null;livePoint=null;pointer=null;
   history=[];redoStack=[];
   $('canvas').classList.remove('hidden');$('empty').classList.add('hidden');
   $('hint').textContent='已重新加载照片，可继续添加尺寸标注或文字标记';
   $('gallery').classList.remove('show');
   resizeCanvas();snapshot();render();toast('照片已加载，可继续添加尺寸或标记');
  }catch(err){console.error('照片库重新加载失败',err);toast('照片加载失败，请重新选择');}
 };
 im.onerror=()=>toast('照片读取失败，请重新选择');
 im.src=src;
}
function renderGallery(){
 const grid=$('galleryGrid');grid.innerHTML='';
 photos.forEach((p,i)=>{
  const card=document.createElement('div');card.className='thumb';card.dataset.index=String(i);card.title='点击重新加载并继续标注';
  const img=document.createElement('img');img.src=p.thumb||p.data||p.base||p.raw||p.original||p.photo;img.alt=p.name||`照片${i+1}`;
  const check=document.createElement('input');check.type='checkbox';check.className='photo-select';check.dataset.i=String(i);check.checked=true;
  const name=document.createElement('small');name.textContent=p.name||`照片${i+1}`;
  const del=document.createElement('button');del.type='button';del.className='photo-delete-btn';del.dataset.deletePhoto=String(i);del.textContent='删除';
  card.append(img,check,name,del);grid.append(card);
 });
}

function batch(){
 const checks=[...root.querySelectorAll('.photo-select:checked')];
 if(!checks.length)return toast('请先勾选需要导出的照片');
 const chosen=checks.map(c=>photos[Number(c.dataset.i)]).filter(Boolean);
 if(!chosen.length)return toast('没有可导出的照片');
 chosen.forEach((p,i)=>setTimeout(()=>downloadData(p.data||p.thumb||p.base,cleanName(p.name)+'_标注.jpg'),i*450));
 toast(`已开始导出 ${chosen.length} 张照片`);
}
$('openGallery').onclick=()=>{
 cacheCurrentPhotoToGallery();
 $('gallery').classList.add('show');renderGallery();
};
$('closeGallery').onclick=()=>$('gallery').classList.remove('show');
$('selectAll').onclick=()=>{
  const boxes=[...root.querySelectorAll('.photo-select')];
  const allChecked=boxes.length&&boxes.every(x=>x.checked);
  boxes.forEach(x=>x.checked=!allChecked);
  $('selectAll').textContent=allChecked?'全选':'取消全选';
};
$('galleryGrid').addEventListener('change',e=>{
 if(e.target.matches('.photo-select')){
  const boxes=[...root.querySelectorAll('.photo-select')];
  $('selectAll').textContent=boxes.length&&boxes.every(x=>x.checked)?'取消全选':'全选';
 }
});
$('galleryGrid').addEventListener('click',e=>{
 const btn=e.target.closest('[data-delete-photo]');
 if(btn){
  const i=Number(btn.dataset.deletePhoto);if(!Number.isInteger(i)||!photos[i])return;
  if(!confirm(`确定删除“${photos[i].name||'这张照片'}”吗？`))return;
  photos.splice(i,1);
  if(currentPhotoIndex===i){currentPhotoIndex=-1;photo=null;photoBaseData='';dims=[];texts=[];$('canvas').classList.add('hidden');$('empty').classList.remove('hidden');}
  else if(currentPhotoIndex>i)currentPhotoIndex--;
  renderGallery();toast('照片已从照片库删除');return;
 }
 if(e.target.closest('.photo-select'))return;
 const card=e.target.closest('.thumb');if(!card)return;
 loadPhotoFromRecord(Number(card.dataset.index));
});
$('batchSave').onclick=batch;
$('deleteSelected').onclick=()=>{const ids=[...root.querySelectorAll('.photo-select:checked')].map(x=>Number(x.dataset.i)).sort((a,b)=>b-a);if(!ids.length)return toast('请先勾选要删除的照片');if(!confirm(`确定删除选中的 ${ids.length} 张照片吗？`))return;ids.forEach(i=>photos.splice(i,1));currentPhotoIndex=-1;photo=null;photoBaseData='';dims=[];texts=[];$('canvas').classList.add('hidden');$('empty').classList.remove('hidden');renderGallery();toast(`已删除 ${ids.length} 张照片`);};
let activeCameraStream=null,cameraDevices=[],selectedCameraId='',defaultCameraId=localStorage.getItem('linuo_default_camera_id')||'';
async function stopCameraPreview(){if(activeCameraStream){activeCameraStream.getTracks().forEach(t=>t.stop());activeCameraStream=null}$('cameraVideo').srcObject=null}
window.addEventListener('pagehide',()=>{if(activeCameraStream){activeCameraStream.getTracks().forEach(t=>t.stop());activeCameraStream=null}});
function renderCameraChoiceButtons(){
 const holder=$('cameraChoiceButtons');if(!holder)return;
 holder.innerHTML='';
 if(!cameraDevices.length){holder.textContent='未检测到可用镜头';return}
 cameraDevices.forEach((device,index)=>{
  const button=document.createElement('button');button.type='button';
  button.className='camera-choice-btn'+(device.deviceId===selectedCameraId?' active':'');
  button.textContent=String(index+1);button.title=device.label||`摄像头 ${index+1}`;
  button.setAttribute('aria-label',`选择镜头 ${index+1}：${device.label||'摄像头'}`);
  button.onclick=()=>changeCamera(device.deviceId);
  holder.appendChild(button);
 });
}
async function enumerateCameraChoices(){
 if(!navigator.mediaDevices?.getUserMedia){toast('当前浏览器不支持网页摄像头选择');return}
 try{
  if(!activeCameraStream)activeCameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
  const all=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
  const saved=all.find(d=>d.deviceId===defaultCameraId);
  const current=activeCameraStream?.getVideoTracks?.()[0]?.getSettings?.()?.deviceId;
  const rearMain=all.find(d=>d.deviceId!==saved?.deviceId&&/(back|rear|environment|后置|主摄|1x|广角)/i.test(d.label||''));
  const systemMain=rearMain||(current&&current!==saved?.deviceId?all.find(d=>d.deviceId===current):null);
  cameraDevices=[saved,systemMain,...all.filter(d=>d!==saved&&d!==systemMain)].filter(Boolean);
  if(!cameraDevices.length)cameraDevices=all;
  if(!cameraDevices.some(d=>d.deviceId===selectedCameraId))selectedCameraId=(saved||systemMain||cameraDevices[0]||{}).deviceId||current||'';
  renderCameraChoiceButtons();
  $('cameraVideo').srcObject=activeCameraStream;await $('cameraVideo').play().catch(()=>{});
 }catch(err){toast('无法读取摄像头列表：'+(err.message||err))}
}
async function openCameraSettings(){
 $('cameraModal').classList.add('show');$('cameraModal').querySelector('.camera-head b').textContent='设置 · 镜头与标注样式';
 $('saveCamera').style.display='';$('captureCamera').style.display='none';$('cameraChoiceButtons').style.display='flex';$('switchCamera').style.display='';$('annotationSettings').classList.remove('hidden');
 $('cameraHelp').textContent='点击数字按钮切换镜头；当前选中的镜头可设为默认镜头。不同手机开放的镜头数量不同。';
 await enumerateCameraChoices();
 if(selectedCameraId)await changeCamera(selectedCameraId);
}
async function changeCamera(id=selectedCameraId){
 if(!id)return;
 selectedCameraId=id;renderCameraChoiceButtons();await stopCameraPreview();
 try{
  activeCameraStream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:id}},audio:false});
  $('cameraVideo').srcObject=activeCameraStream;await $('cameraVideo').play();
 }catch(e){toast('该镜头无法预览：'+e.message);await enumerateCameraChoices()}
}
$('closeCamera').onclick=async()=>{$('cameraModal').classList.remove('show');await stopCameraPreview()};
$('switchCamera').onclick=()=>{
 if(cameraDevices.length>1){const ix=cameraDevices.findIndex(d=>d.deviceId===selectedCameraId);changeCamera(cameraDevices[(ix+1+cameraDevices.length)%cameraDevices.length].deviceId)}
 else toast('浏览器只提供一个摄像头入口');
};
$('saveCamera').onclick=async()=>{
 const chosen=selectedCameraId;if(!chosen)return toast('请先选择镜头');
 defaultCameraId=chosen;localStorage.setItem('linuo_default_camera_id',defaultCameraId);
 await changeCamera(chosen);await enumerateCameraChoices();toast('默认镜头已保存；下次拍照优先调用');
};
$('settingsBtn').onclick=openCameraSettings;
async function openCameraPicker(){
 if(!navigator.mediaDevices?.getUserMedia){$('cameraInput').click();return}
 try{
  await stopCameraPreview();
  const constraints=defaultCameraId?{deviceId:{exact:defaultCameraId}}:{facingMode:{ideal:'environment'}};
  activeCameraStream=await navigator.mediaDevices.getUserMedia({video:constraints,audio:false});
  const v=$('cameraVideo');v.srcObject=activeCameraStream;await v.play();
  const track=activeCameraStream.getVideoTracks()[0],settings=track.getSettings();
  selectedCameraId=settings.deviceId||selectedCameraId;
  if(defaultCameraId&&settings.deviceId!==defaultCameraId){toast('默认镜头不可用，已改用系统后置镜头');defaultCameraId='';localStorage.removeItem('linuo_default_camera_id')}
  $('cameraModal').classList.add('show');$('cameraModal').querySelector('.camera-head b').textContent='拍摄照片';
  $('saveCamera').style.display='none';$('captureCamera').style.display='';$('cameraChoiceButtons').style.display='none';$('switchCamera').style.display='none';$('annotationSettings').classList.add('hidden');$('cameraHelp').textContent='正在使用设置中保存的默认镜头。';
  await enumerateCameraChoices();
 }catch(err){toast('无法调用所选镜头：'+(err.message||err));await stopCameraPreview();$('cameraInput').click()}
}
$('captureCamera').onclick=async()=>{
 const v=$('cameraVideo');if(!v.videoWidth)return toast('相机尚未准备好');
 const c=document.createElement('canvas'),sc=Math.min(1,1200/Math.max(v.videoWidth,v.videoHeight));
 c.width=Math.round(v.videoWidth*sc);c.height=Math.round(v.videoHeight*sc);c.getContext('2d').drawImage(v,0,0,c.width,c.height);
 const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.88));const f=new File([blob],`现场照片_${Date.now()}.jpg`,{type:'image/jpeg'});
 $('cameraModal').classList.remove('show');await stopCameraPreview();await loadFile(f);
};
// 图片按钮：统一选择拍照或从相册导入
$('sourceBtn').onclick=()=>{

  // 防止重复打开选择菜单
  if($('photoSourcePicker')){
    $('photoSourcePicker').remove();
    return;
  }

  const mask=document.createElement('div');
  mask.id='photoSourcePicker';

  mask.style.cssText=`
    position:fixed;
    inset:0;
    z-index:100000;
    display:flex;
    align-items:flex-end;
    justify-content:center;
    padding:16px;
    background:rgba(15,23,42,.28);
  `;

  const card=document.createElement('div');

  card.style.cssText=`
    width:min(420px,100%);
    padding:16px;
    background:#fff;
    border-radius:16px;
    box-shadow:0 8px 30px rgba(0,0,0,.18);
    display:grid;
    gap:10px;
  `;

  card.innerHTML=`
    <div style="font-size:15px;font-weight:700;text-align:center;padding:4px;">
      选择图片来源
    </div>

    <button id="photoSourceCamera"
      style="height:46px;border:0;border-radius:10px;background:#1677e8;color:#fff;font-size:15px;">
      拍照
    </button>

    <button id="photoSourceAlbum"
      style="height:46px;border:1px solid #dce5f0;border-radius:10px;background:#f5f8fc;color:#26384e;font-size:15px;">
      从相册选择
    </button>

    <button id="photoSourceCancel"
      style="height:40px;border:0;border-radius:10px;background:#eef2f7;color:#526174;font-size:14px;">
      取消
    </button>
  `;

  mask.appendChild(card);
  document.body.appendChild(mask);

  mask.onclick=e=>{
    if(e.target===mask)mask.remove();
  };

  $('photoSourceCamera').onclick=()=>{
    mask.remove();
    openCameraPicker();
  };

  $('photoSourceAlbum').onclick=()=>{
    mask.remove();

    const input=$('albumInput');

    if(!input)return toast('相册选择控件未加载');

    input.value='';

    try{
      input.click();
    }catch(err){
      toast('无法打开相册：'+(err.message||err));
    }
  };

  $('photoSourceCancel').onclick=()=>{
    mask.remove();
  };
};
$('cameraInput').onchange=e=>loadFile(e.target.files[0]);
if($('albumInput'))$('albumInput').onchange=async e=>{const files=[...e.target.files];e.target.value='';if(!files.length)return;toast(`正在读取 ${files.length} 张照片…`);for(const f of files)await loadFile(f);};
function cleanName(n){return (n||'照片').replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|]/g,'_')}

function dataURLtoBlob(data){
 const arr=String(data).split(',');
 const mime=(arr[0].match(/:(.*?);/)||[])[1]||'image/jpeg';
 const bstr=atob(arr[1]||'');
 const u8=new Uint8Array(bstr.length);
 for(let i=0;i<bstr.length;i++)u8[i]=bstr.charCodeAt(i);
 return new Blob([u8],{type:mime});
}

function downloadData(data,name){
 try{
  let url=data,revoke=null;
  if(String(data).startsWith('data:')){
   url=URL.createObjectURL(dataURLtoBlob(data));
   revoke=url;
  }
  const a=document.createElement('a');
  a.href=url;a.download=name;a.rel='noopener';a.style.display='none';
  document.body.appendChild(a);a.click();a.remove();
  if(revoke)setTimeout(()=>URL.revokeObjectURL(revoke),8000);
  return true;
 }catch(e){toast('下载失败：'+(e.message||e));return false}
}

function saveCurrent(){
 if(!photo)return toast('请先拍照或从相册选择照片');
 let data;
 try{data=exportData()}catch(e){return toast('生成图片失败：'+(e.message||e))}
 if(currentPhotoIndex>=0&&photos[currentPhotoIndex]){
  photos[currentPhotoIndex].data=data;
  photos[currentPhotoIndex].thumb=data;
  photos[currentPhotoIndex].dims=JSON.parse(JSON.stringify(dims));
 }
 const name=cleanName(photoName)+'_标注.jpg';
 if(downloadData(data,name))toast('已开始下载：'+name);
}
$('saveBtn').onclick=saveCurrent;
$('drawBtn').onclick=()=>{if(!photo)return toast('请先拍照或从相册选择照片');closeNumericKeyboard();mode='draw';pendingDim=null;firstPoint=null;pointer=null;editingDimIndex=-1;hideMagnifier();$('drawBtn').classList.add('active');$('centerPanBtn').classList.remove('active');$('editBtn').classList.remove('active');$('editPanel').classList.remove('show');$('hint').textContent='长度标注：按住滑动选择第一点，松开确定；再按住滑动选择第二点，松开后输入数值';toast('长度标注已启动：选择第一点');};
$('centerPanBtn').onclick=()=>{closeNumericKeyboard();mode='pan';hideMagnifier();$('centerPanBtn').classList.add('active');$('drawBtn').classList.remove('active');$('editBtn').classList.remove('active');$('hint').textContent='移动模式：可拖动照片查看';};
$('editBtn').onclick=()=>{
 closeNumericKeyboard();
 if(!photo)return toast('请先拍照或从相册选择照片');
 if(pendingDim){
  pendingDim=null;firstPoint=null;pointer=null;mode='idle';
  
  hideMagnifier();render();toast('已取消当前未确认的尺寸');return;
 }
 if(selected<0&&selectedText<0){
  mode='idle';pointer=null;hideMagnifier();
  $('drawBtn').classList.remove('active');$('centerPanBtn').classList.remove('active');
  $('editPanel').classList.remove('show');
  $('hint').textContent='点击照片上的尺寸线或文字选中，再点“删除”即可移除';
  render();toast('请先点击选中要删除的标注');return;
 }
 snapshot();
 if(selectedText>=0){texts.splice(selectedText,1);selectedText=-1}
 if(selected>=0){dims.splice(selected,1);selected=-1}
 editingDimIndex=-1;pointer=null;hideMagnifier();
 
 $('hint').textContent='已删除选中标注；可继续点击其它标注删除，或点“长度”添加新尺寸';
 render();toast('已删除选中标注');
};
// 居中/移动：先将照片恢复居中，再进入移动模式
$('centerPanBtn').onclick=()=>{

  if(!photo)return toast('请先选择照片');

  closeNumericKeyboard();

  // 恢复照片默认居中比例和位置
  view={
    scale:1,
    x:0,
    y:0
  };

  resizeCanvas();

  canvas.style.transform='translate(0px, 0px) scale(1)';

  // 自动进入照片移动模式
  mode='pan';

  pointer=null;

  hideMagnifier();

  $('centerPanBtn').classList.add('active');
  $('drawBtn').classList.remove('active');
  $('editBtn').classList.remove('active');

  $('editPanel').classList.remove('show');

  $('hint').textContent='照片已居中，现在可以直接拖动照片调整位置';

  toast('照片已居中，移动模式已启动');
};
function pos(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}}
function setKey(v){
 const val=String(v||'').slice(0,9)||'0';
 $('valueInput').value=val;
 if(pendingDim){pendingDim.value=val;render()}
 else if(editingDimIndex>=0&&dims[editingDimIndex]){dims[editingDimIndex].value=val;render()}
}
function confirmNumeric(){
 if(pendingDim){
  snapshot();pendingDim.value=$('valueInput').value||pendingDim.value||'0';dims.push(pendingDim);selected=dims.length-1;selectedText=-1;pendingDim=null;firstPoint=null;mode='idle';$('drawBtn').classList.remove('active');render();hideMagnifier();$('hint').textContent='本条尺寸已确认。点击“长度”命令可添加下一条';closeNumericKeyboard();toast('尺寸已确认');
 }else if(editingDimIndex>=0){editingDimIndex=-1;render();closeNumericKeyboard();toast('尺寸文字已更新')}
 else toast('请先选择尺寸线的两个端点');
}
function showMagnifier(p){
 const m=$('magnifier'),mx=m.getContext('2d'),src=46;
 m.style.display='block';mx.clearRect(0,0,220,220);
 const sx=Math.max(0,Math.min(canvas.width-src,p.x-src/2)),sy=Math.max(0,Math.min(canvas.height-src,p.y-src/2));
 mx.drawImage(canvas,sx,sy,src,src,0,0,220,220);
 mx.strokeStyle='#ef3c9b';mx.lineWidth=3;mx.beginPath();mx.moveTo(110,0);mx.lineTo(110,220);mx.moveTo(0,110);mx.lineTo(220,110);mx.stroke();
 mx.beginPath();mx.arc(110,110,8,0,Math.PI*2);mx.stroke();
}
function hideMagnifier(){$('magnifier').style.display='none'}
function openDimValueEditor(index){
 if(index<0||!dims[index])return;
 snapshot();selected=index;editingDimIndex=index;setKey(String(dims[index].value));
 openNumericKeyboard(String(dims[index].value));
 $('hint').textContent='正在编辑尺寸文字：输入数字后点击确认';
 render();
}
async function openTextEditor(index){
 if(index<0||!texts[index])return;
 const value=window.LinuoDialog?await window.LinuoDialog.input('编辑文字内容','请输入标注文字',texts[index].text):null;
 if(value===null)return;
 snapshot();texts[index].text=value;selectedText=index;render();
}
function pos(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}}
function nearestDimHandle(p){
 let hit=-1,handle=-1,best=Infinity;
 dims.forEach((d,i)=>{
  const dx=d.x2-d.x1,dy=d.y2-d.y1,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
  const mx=(d.x1+d.x2)/2+nx*(d.textOffset||0),my=(d.y1+d.y2)/2+ny*(d.textOffset||0);
  [[d.x1,d.y1,0],[d.x2,d.y2,1],[mx,my,2]].forEach(([x,y,j])=>{const dist=Math.hypot(p.x-x,p.y-y);if(dist<best){best=dist;hit=i;handle=j}});
 });
 return {hit,handle,best};
}
function nearestText(p){
 let hit=-1,best=Infinity;
 texts.forEach((t,i)=>{const fs=annotationTextSize(t,canvas.width),w=Math.max(fs*2,ctx.measureText(t.text).width+fs),d=Math.hypot(p.x-t.x,p.y-t.y);if(d<best&&d<Math.max(32,w*.65)){best=d;hit=i}});
 return hit;
}
canvas.addEventListener('pointerdown',e=>{
 if(!photo)return;
 const p=pos(e);
 if(mode==='pan'){pointer={kind:'pan',x:e.clientX,y:e.clientY,ox:view.x,oy:view.y};canvas.setPointerCapture(e.pointerId);return}
 if(mode==='draw'){
   if(pendingDim){
     pendingDim.x2=p.x;pendingDim.y2=p.y;
     pointer={kind:'drawSecond',current:p,fromPending:true};livePoint=p;
     canvas.setPointerCapture(e.pointerId);
     $('hint').textContent='已放下第二点：点击或拖动可调整第二点位置，确认数值后完成标注';
     render();showMagnifier(p);return;
   }
   if(!firstPoint){

     // 第一端点先进入预览状态，松开手指才确定
     pointer={
       kind:'drawFirst',
       current:p
     };

     livePoint=p;

     // 捕获手指，保证滑出照片边缘仍然能够接收移动事件
     canvas.setPointerCapture(e.pointerId);

     $('hint').textContent='滑动选择第一点，右上角放大镜同步定位；松开手指确定第一点';

     render();
     showMagnifier(p);
     return;
   }
   pointer={kind:'drawSecond',current:p};livePoint=p;canvas.setPointerCapture(e.pointerId);render();showMagnifier(p);return;
 }
if(mode==='text'){

   // 第一点：按住滑动预览，松开才确定
   if(!textStart){

     pointer={
       kind:'textFirst',
       current:p
     };

     canvas.setPointerCapture(e.pointerId);

     $('hint').textContent='按住滑动选择文字引线第一点，放大镜同步跟随；松开确定第一点';

     render();
     showMagnifier(p);
     return;
   }

   // 第二点：选择文字放置位置
   pointer={
     kind:'textLeader',
     current:p
   };

   canvas.setPointerCapture(e.pointerId);

   $('hint').textContent='第一点已确定：按住滑动选择文字位置，松开后输入文字';

   render();
   showMagnifier(p);
   return;
}
 const textHit=nearestText(p);
 if(textHit>=0){
   selectedText=textHit;pointer={kind:'textHold',index:textHit,start:p,last:p,moved:false,snapshotTaken:false};
   longPressFired=false;
   longPressTimer=setTimeout(()=>{if(pointer?.kind==='textHold'&&!pointer.moved){longPressFired=true;pointer=null;openTextEditor(textHit)}},560);
   render();canvas.setPointerCapture(e.pointerId);return;
 }
 const {hit,handle,best}=nearestDimHandle(p);
 const handleLimit=Math.max(28,canvas.width*.035);
 if(hit>=0&&best<handleLimit){
   selected=hit;selectedText=-1;pointer={kind:handle===2?'dimLabelHold':'handle',index:hit,handle,start:p,last:p,moved:false,snapshotTaken:false};
   longPressFired=false;
   if(handle===2){
     longPressTimer=setTimeout(()=>{if(pointer?.kind==='dimLabelHold'&&!pointer.moved){longPressFired=true;pointer=null;openDimValueEditor(hit)}},560);
   }
   canvas.setPointerCapture(e.pointerId);render();return;
 }
 let lineHit=-1,lineBest=Infinity;
 dims.forEach((d,i)=>{const dx=d.x2-d.x1,dy=d.y2-d.y1,t=Math.max(0,Math.min(1,((p.x-d.x1)*dx+(p.y-d.y1)*dy)/(dx*dx+dy*dy||1))),dd=Math.hypot(p.x-d.x1-t*dx,p.y-d.y1-t*dy);if(dd<lineBest){lineBest=dd;lineHit=i}});
 selected=lineBest<canvas.width*.035?lineHit:-1;selectedText=-1;render();
});
canvas.addEventListener('pointermove',e=>{
 if(!photo)return;
 const p=pos(e);
 if(pointer?.kind==='pan'){
   view.x=pointer.ox+(e.clientX-pointer.x);
   view.y=pointer.oy+(e.clientY-pointer.y);
   applyView();
   return;
 }

 // 第一端点跟随手指实时移动
 if(pointer?.kind==='drawFirst'){
   pointer.current=p;
   livePoint=p;

   // 刷新第一点预览
   render();

   // 放大镜同步跟随当前手指位置
   showMagnifier(p);
   return;
 }

 if(pointer?.kind==='drawSecond'){
   pointer.current=p;livePoint=p;
   if(pointer.fromPending&&pendingDim){pendingDim.x2=p.x;pendingDim.y2=p.y}
   render();showMagnifier(p);return;
 }
 // 文字第一点实时跟随手指
if(pointer?.kind==='textFirst'){
   pointer.current=p;
   livePoint=p;

   render();
   showMagnifier(p);
   return;
}
 if(pointer?.kind==='textLeader'){
   pointer.current=p;render();showMagnifier(p);return;
 }
 // 长度标注文字只允许长按修改数值，不允许拖动改变文字位置
 if(pointer?.kind==='dimLabelHold'){
   const moved=Math.hypot(p.x-pointer.start.x,p.y-pointer.start.y);
   if(moved>Math.max(5,canvas.width*.004)){
     pointer.moved=true;
     if(longPressTimer){
       clearTimeout(longPressTimer);
       longPressTimer=null;
     }
   }
   return;
 }

 if(pointer?.kind==='textHold'||pointer?.kind==='handle'){
   const moved=Math.hypot(p.x-pointer.start.x,p.y-pointer.start.y);
   if(moved>Math.max(5,canvas.width*.004)){
     pointer.moved=true;
     if(longPressTimer){
       clearTimeout(longPressTimer);
       longPressTimer=null;
     }
     if(!pointer.snapshotTaken){
       snapshot();
       pointer.snapshotTaken=true;
     }

     if(pointer.kind==='textHold'){
       const t=texts[pointer.index];
       t.x=p.x;
       t.y=p.y;
       pointer.last=p;
       render();
       showMagnifier(p);
       return;
     }

     const d=dims[pointer.index];

     if(pointer.handle===0){
       d.x1=p.x;
       d.y1=p.y;
     }
     else if(pointer.handle===1){
       d.x2=p.x;
       d.y2=p.y;
     }

     pointer.last=p;
     render();
     showMagnifier(p);
   }
 }
});
canvas.addEventListener('pointerup',async e=>{
 const p=pos(e),old=pointer;
 if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null}
 // 第一端点：手指松开时正式确定
 if(old?.kind==='drawFirst'){

   // 以松开瞬间的坐标作为最终第一点
   firstPoint=p;
   livePoint=p;
   pointer=null;

   $('hint').textContent='第一点已确定：按住并拖动选择第二点，右上角放大镜辅助定位，松开完成';

   render();

   // 保留放大镜，继续辅助第二点定位
   showMagnifier(p);

   return;
 }

 if(old?.kind==='drawSecond'){
   if(old.fromPending){
     pendingDim.x2=p.x;pendingDim.y2=p.y;pointer=null;
     render();showMagnifier(p);return;
   }
   pendingDim={x1:firstPoint.x,y1:firstPoint.y,x2:p.x,y2:p.y,value:'0',color,offset:0,textOffset:0};
   firstPoint=null;pointer=null;$('valueInput').value='0';
   $('hint').textContent='输入数值后点击确认；确认前再次点击照片可调整第二点';render();showMagnifier(p);openNumericKeyboard('0');return;
 }
 // 文字第一点：手指松开正式确定
if(old?.kind==='textFirst'){

   textStart=p;
   livePoint=p;
   pointer=null;

   $('hint').textContent='文字引线第一点已确定：再按住滑动选择文字位置，松开后输入文字';

   render();
   showMagnifier(p);
   return;
}
 if(old?.kind==='textLeader'){
const end=p;
pointer=null;
hideMagnifier();
   const value=window.LinuoDialog?await window.LinuoDialog.input('添加文字标注','请输入标注文字',''):null;
   if(value&&value.trim()){
     snapshot();texts.push({text:value.trim(),x:end.x,y:end.y,anchorX:textStart.x,anchorY:textStart.y,color,size:Math.max(18,canvas.width/55)*fontScale});
     selectedText=texts.length-1;render();toast('文字标注已添加');
   }
   textStart=null;mode='idle';$('editBtn').classList.remove('active');$('hint').textContent='文字已完成。再次点击“文字”命令可添加下一条';return;
 }
 if(old?.kind==='textHold'&&!old.moved&&!longPressFired){selectedText=old.index;selected=-1;render()}
 if(old?.kind==='dimLabelHold'&&!old.moved&&!longPressFired){selected=old.index;render()}
 pointer=null;
});
canvas.addEventListener('pointercancel',()=>{

 const wasFirst=pointer?.kind==='drawFirst';
 const wasTextFirst=pointer?.kind==='textFirst';
 const wasTextLeader=pointer?.kind==='textLeader';

 if(longPressTimer)clearTimeout(longPressTimer);

 longPressTimer=null;
 pointer=null;

 // 长度第一点取消
 if(wasFirst){
   livePoint=null;
   hideMagnifier();
   render();
   $('hint').textContent='第一点选择已取消，请重新按住滑动选择';
 }

 // 文字第一点取消
 if(wasTextFirst){
   textStart=null;
   livePoint=null;
   hideMagnifier();
   render();
   $('hint').textContent='文字引线第一点选择已取消，请重新选择';
 }

 // 文字第二点取消，保留已经确定的第一点
 if(wasTextLeader){
   hideMagnifier();
   render();
   $('hint').textContent='文字位置选择已取消，可以重新按住滑动选择文字位置';
 }

});
$('stage').addEventListener('wheel',e=>{if(!photo)return;e.preventDefault();view.scale=Math.max(1,Math.min(4,view.scale*(e.deltaY<0?1.08:.92)));applyView()},{passive:false});
// 点击当前尺寸输入框，调用量房公用数字键盘
$('valueBar').addEventListener('click',()=>{

  if(!photo){
    return toast('请先拍照或选择照片');
  }

  if(selected<0 || !dims[selected]){
    return toast('请先点击照片上的尺寸标注');
  }

  // 打开当前选中尺寸的数字编辑器
  openDimValueEditor(selected);

});
$('applyValue').onclick=()=>{if(selected<0)return toast('请先选择一条尺寸线');snapshot();dims[selected].value=$('valueInput').value||'0';render()};
$('deleteDim').onclick=()=>{if(selected<0)return toast('请先选择尺寸线');snapshot();dims.splice(selected,1);selected=-1;render()};
$('clearDims').onclick=()=>{if(!dims.length&&!texts.length)return toast('当前没有标注');if(!confirm('确定清空当前照片的全部尺寸和文字标注吗？'))return;snapshot();dims=[];texts=[];selected=-1;pendingDim=null;firstPoint=null;render();toast('已清空全部标注')};
const photoUndo=$('photoUndo'),photoRedo=$('photoRedo');
if(photoUndo)photoUndo.onclick=e=>{e.preventDefault();e.stopPropagation();if(!history.length)return toast('没有可撤销的标注');redoStack.push(JSON.stringify({dims,texts}));restore(history.pop());};
if(photoRedo)photoRedo.onclick=e=>{e.preventDefault();e.stopPropagation();if(!redoStack.length)return toast('没有可恢复的标注');history.push(JSON.stringify({dims,texts}));restore(redoStack.pop());};
$('addText').onclick=()=>{
 if(!photo)return toast('请先拍照或从相册选择照片');

 closeNumericKeyboard();

 mode='text';
 textStart=null;
 pointer=null;
 selectedText=-1;

 $('drawBtn').classList.remove('active');
 $('centerPanBtn').classList.remove('active');
 $('editBtn').classList.remove('active');
 $('editPanel').classList.remove('show');

 hideMagnifier();
 render();

 $('hint').textContent='文字标注：按住滑动选择引线第一点，松开确定；再按住滑动选择文字位置，松开后输入文字';

 toast('文字工具已启动：先选择引线第一点');
};
$('btConnect').onclick=()=>{
 const api=sharedInput();
 if(!api||typeof api.connectBluetooth!=='function')return toast('量房蓝牙共享服务尚未就绪');
 api.connectBluetooth().catch(err=>toast('蓝牙连接失败：'+(err.message||err)));
};
const sharedApi=sharedInput();
if(sharedApi&&typeof sharedApi.subscribeBluetoothState==='function'){
 sharedApi.subscribeBluetoothState(connected=>{
  const button=$('btConnect');if(!button)return;
  button.classList.toggle('bt-connected',!!connected);
  button.setAttribute('aria-pressed',connected?'true':'false');
  button.title=connected?'蓝牙已连接':'连接蓝牙测距仪';
 });
}
window.addEventListener('resize',()=>{if(photo&&root.closest('#photoAnnotationOverlay')?.classList.contains('open'))resizeCanvas()});

function resetSession(){
 closeNumericKeyboard();
 if(activeCameraStream){activeCameraStream.getTracks().forEach(t=>t.stop());activeCameraStream=null;}
 $('cameraVideo').srcObject=null;
 photo=null;photoBaseData='';photoName='照片';dims=[];texts=[];history=[];redoStack=[];mode='idle';firstPoint=null;pendingDim=null;selected=-1;selectedText=-1;editingDimIndex=-1;textStart=null;livePoint=null;pointer=null;currentPhotoIndex=-1;view={scale:1,x:0,y:0};
 $('canvas').classList.add('hidden');$('empty').classList.remove('hidden');$('gallery').classList.remove('show');$('cameraModal').classList.remove('show');$('editPanel').classList.remove('show');$('hint').textContent='先拍照或选择照片';$('valueInput').value='';$('valueBar').value='—';$('drawBtn').classList.remove('active');$('centerPanBtn').classList.remove('active');$('editBtn').classList.remove('active');$('magnifier').style.display='none';
 color='#ed3029';fontScale=1.2;arrowStyle=window.LinuoBase?.getStorage('linuo_arrow_style','dot')||'dot';lineStyle=window.LinuoBase?.getStorage('linuo_line_style','dashed')||'dashed';labelStyle=localStorage.getItem('linuo_label_style')||'white';
 root.querySelectorAll('.swatch').forEach(b=>b.classList.toggle('active',b.dataset.color===color));
root.querySelectorAll('.fontbtn').forEach(b=>
 b.classList.toggle('active',Number(b.dataset.size)===fontScale)
);
 $('arrowStyle').value=arrowStyle;$('lineStyle').value=lineStyle;$('labelStyle').value=labelStyle;
 $('cameraInput').value='';if($('albumInput'))$('albumInput').value='';
}
function openPage(){resetSession();root.closest('#photoAnnotationOverlay').classList.add('open');root.closest('#photoAnnotationOverlay').setAttribute('aria-hidden','false');setTimeout(()=>{const overlay=root.closest('#photoAnnotationOverlay');if(overlay&&overlay.classList.contains('open')){if(photo)resizeCanvas();}},40);}
function closePage(){cacheCurrentPhotoToGallery();closeNumericKeyboard();if(activeCameraStream){activeCameraStream.getTracks().forEach(t=>t.stop());activeCameraStream=null;}$('cameraVideo').srcObject=null;$('cameraModal').classList.remove('show');root.closest('#photoAnnotationOverlay').classList.remove('open');root.closest('#photoAnnotationOverlay').setAttribute('aria-hidden','true');}
window.LinuoPhotoAnnotation={open:openPage,close:closePage};

/* 底部工具图标支持向上滑动激活，行为与量房工具栏一致 */
(function enablePhotoToolSwipe(){
 const nav=document.querySelector('#photoApp .bottom');if(!nav)return;
 let start=null,suppressClick=false,internalClick=false;
 nav.querySelectorAll('.tool').forEach(btn=>{
  btn.addEventListener('touchstart',e=>{const q=e.touches&&e.touches[0];if(q)start={x:q.clientX,y:q.clientY,btn};},{passive:true});
  btn.addEventListener('touchend',e=>{
   if(!start)return;const q=e.changedTouches&&e.changedTouches[0],s=start;start=null;
   if(q&&s.y-q.clientY>28&&Math.abs(q.clientX-s.x)<70){
    suppressClick=true;internalClick=true;btn.click();internalClick=false;setTimeout(()=>suppressClick=false,450);
   }
  },{passive:true});
  btn.addEventListener('click',e=>{if(suppressClick&&!internalClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}},true);
 });
})();

})();
