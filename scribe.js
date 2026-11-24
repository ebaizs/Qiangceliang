/* 立诺量房后台计算模块：几何计算、门洞几何和数据文件构建。 */
(function(global){
  'use strict';
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  function snap5(v){const n=Number(v);if(!Number.isFinite(n))return v;return Math.round(n/5)*5;}
  function arcControlPoint(w){
    const mx=(w.a.x+w.b.x)/2,my=(w.a.y+w.b.y)/2;
    const dx=w.b.x-w.a.x,dy=w.b.y-w.a.y,L=Math.hypot(dx,dy)||1;
    const nx=-dy/L,ny=dx/L,bg=w.bulge||0;
    return {x:mx+nx*2*bg,y:my+ny*2*bg};
  }
  function pointOnWall(w,t){
    if(!w||!w.a||!w.b)return {x:0,y:0};
    if(!w.arc||!w.bulge)return {x:w.a.x+(w.b.x-w.a.x)*t,y:w.a.y+(w.b.y-w.a.y)*t};
    const c=arcControlPoint(w),u=1-t;
    return {x:u*u*w.a.x+2*u*t*c.x+t*t*w.b.x,y:u*u*w.a.y+2*u*t*c.y+t*t*w.b.y};
  }
  function wallCurveLength(w){
    if(!w||!w.a||!w.b)return 0;
    if(!w.arc||!w.bulge)return distance(w.a,w.b);
    let L=0,prev=w.a;
    for(let i=1;i<=24;i++){const q=pointOnWall(w,i/24);L+=distance(prev,q);prev=q;}
    return L;
  }
  function pointInPolygon(pt,poly){
    if(!pt||!Array.isArray(poly)||poly.length<3)return false;
    let inside=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const xi=poly[i].x,yi=poly[i].y,xj=poly[j].x,yj=poly[j].y;
      if(((yi>pt.y)!==(yj>pt.y))&&(pt.x<(xj-xi)*(pt.y-yi)/(yj-yi)+xi))inside=!inside;
    }
    return inside;
  }
  function pointOnPolygonBoundary(pt,poly,tol=3){
    if(!pt||!Array.isArray(poly)||poly.length<2)return false;
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,ll=dx*dx+dy*dy||1;
      const u=Math.max(0,Math.min(1,((pt.x-a.x)*dx+(pt.y-a.y)*dy)/ll));
      if(Math.hypot(pt.x-(a.x+u*dx),pt.y-(a.y+u*dy))<=tol)return true;
    }
    return false;
  }
  function segmentIntersection(a1,a2,b1,b2){
    const d1x=a2.x-a1.x,d1y=a2.y-a1.y,d2x=b2.x-b1.x,d2y=b2.y-b1.y;
    const den=d1x*d2y-d1y*d2x;if(Math.abs(den)<1e-9)return null;
    const t=((b1.x-a1.x)*d2y-(b1.y-a1.y)*d2x)/den;
    const u=((b1.x-a1.x)*d1y-(b1.y-a1.y)*d1x)/den;
    const eps=1e-8;if(t>=-eps&&t<=1+eps&&u>=-eps&&u<=1+eps){const tc=Math.max(0,Math.min(1,t));return {x:a1.x+d1x*tc,y:a1.y+d1y*tc};}
    return null;
  }
  function distanceToSegment(p,a,b){
    const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
    let u=l?((p.x-a.x)*dx+(p.y-a.y)*dy)/l:0;u=Math.max(0,Math.min(1,u));
    return Math.hypot(p.x-(a.x+u*dx),p.y-(a.y+u*dy));
  }
  function openingJambs(w,it,defaultThick,getBlankSide){
    if(!w||!w.a||!w.b){return Array.isArray(it&&it.jambs)?it.jambs:[];}
    const L=Number(w.len)||distance(w.a,w.b)||1;
    const width=Math.max(0,Number(it&&it.width)||0),h=width/(2*L);
    const t=Number(it&&it.t)||0,ts=[Math.max(0,Math.min(1,t-h)),Math.max(0,Math.min(1,t+h))];
    const e=.002,th=Math.max(1,Number(it&&it.frameThick)||Number(w.thick)||Number(defaultThick)||220);
    return ts.map(tt=>{
      const q=pointOnWall(w,tt),a=pointOnWall(w,Math.max(0,tt-e)),b=pointOnWall(w,Math.min(1,tt+e));
      let dx=b.x-a.x,dy=b.y-a.y,ll=Math.hypot(dx,dy)||1;dx/=ll;dy/=ll;
      const nx=-dy,ny=dx,side=(Number(it&&it.side)||(typeof getBlankSide==='function'?getBlankSide(w,tt):1));
      return {a:{x:q.x,y:q.y},b:{x:q.x+nx*th*side,y:q.y+ny*th*side}};
    });
  }
  function escapeDXF(value){
    if(value===null||value===undefined)return '';
    return String(value).replace(/[^\x00-\x7F]/g,ch=>'\\U+'+ch.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0'));
  }
  function safeExportName(value){return String(value||'立诺量房项目').replace(/[\\/:*?"<>|\s]+/g,'_').replace(/^_+|_+$/g,'')||'立诺量房项目';}
  function serializeJSON(state,meta){
    if(!state||typeof state!=='object')throw new Error('项目状态无效');
    const payload=Object.assign({},state,{__meta:Object.assign({app:'立诺量房',version:'V0.44+',schema:3,exportedAt:new Date().toISOString()},meta||{})});
    return JSON.stringify(payload,null,2);
  }
/* DXF实体构建：仅负责根据项目状态计算实体，不操作页面或浏览器下载。 */
  function buildDXF(state, helpers){
    const S = state || {};
    const h = helpers || {};
    const types = h.types || {};
    const pointTypes = h.pointTypes || {};
    const posOnWall = h.posOnWall;
    const getPointPos = h.getPointPos;
    const getOpeningJambs = h.getOpeningJambs;
    const dxfLabel = h.dxfLabel;
    const getBlankSide = h.getBlankSide;
    const entryDoorGeometry = h.entryDoorGeometry;
    const entryDoorEndpointConnected = h.entryDoorEndpointConnected;
    const entryDoorEndpointIsClosedRegion = h.entryDoorEndpointIsClosedRegion || entryDoorEndpointConnected;
    const dist = api.distance;
  const esc=escapeDXF;
  const out=[
    '0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC',
    // 定义图层及图层颜色
    '0','SECTION','2','TABLES',
      '0','TABLE','2','LAYER','70','4',
        '0','LAYER','2',esc('墙体'),'70','0','62','7','6','CONTINUOUS',
        '0','LAYER','2',esc('门窗'),'70','0','62','1','6','CONTINUOUS',
        '0','LAYER','2',esc('文本'),'70','0','62','3','6','CONTINUOUS',
        '0','LAYER','2',esc('符号'),'70','0','62','2','6','CONTINUOUS',
      '0','ENDTAB',
    '0','ENDSEC',
    '0','SECTION','2','ENTITIES'
  ];
  
  // 移除 color 参数，使所有实体颜色默认随层
  const line=(a,b,layer='墙体') => {
    out.push('0','LINE','8',esc(layer),
             '10',String(a.x),'20',String(a.y),'30','0',
             '11',String(b.x),'21',String(b.y),'31','0');
  };
  const dashedLine=(a,b,layer='门窗')=>{
    const len=dist(a,b);if(len<1)return;const ux=(b.x-a.x)/len,uy=(b.y-a.y)/len;
    const dash=55,gap=35;let at=0;
    while(at<len){const end=Math.min(len,at+dash);line({x:a.x+ux*at,y:a.y+uy*at},{x:a.x+ux*end,y:a.y+uy*end},layer);at=end+gap;}
  };
  const circle=(c,r,layer='符号')=>out.push('0','CIRCLE','8',esc(layer),'10',String(c.x),'20',String(c.y),'30','0','40',String(r));
  const arcPolyline=(center,r,a1,a2,layer='门窗',steps=16)=>{
    // 与画布门扇开启弧采用相同的圆心、半径和方向
    let delta=a2-a1;while(delta<0)delta+=Math.PI*2;while(delta>Math.PI*2)delta-=Math.PI*2;
    let prev={x:center.x+r*Math.cos(a1),y:center.y+r*Math.sin(a1)};
    for(let i=1;i<=steps;i++){const a=a1+delta*i/steps;const q={x:center.x+r*Math.cos(a),y:center.y+r*Math.sin(a)};line(prev,q,layer);prev=q;}
  };
  S.walls.forEach((w,wi)=>{
    const L=Math.max(1,Number(w.len)||dist(w.a,w.b));
    const gaps=(S.items||[]).filter(it=>it.wall===wi&&['opening','window','bay','special'].includes(it.type))
      .map(it=>[Math.max(0,(Number(it.t)||0)-(Number(it.width)||0)/(2*L)),Math.min(1,(Number(it.t)||0)+(Number(it.width)||0)/(2*L))])
      .sort((a,b)=>a[0]-b[0]);
    const ranges=[];let at=0;
    gaps.forEach(([a,b])=>{if(a>at)ranges.push([at,a]);at=Math.max(at,b);});
    if(at<1)ranges.push([at,1]);
    ranges.forEach(([t0,t1])=>{
      if(t1-t0<1e-6)return;
      if(w.arc&&w.bulge){
        const steps=Math.max(4,Math.ceil(32*(t1-t0)));
        let prev=posOnWall(w,t0);
        for(let k=1;k<=steps;k++){
          const q=posOnWall(w,t0+(t1-t0)*k/steps);
          line(prev,q,'墙体');prev=q;
        }
      }else{
        line(posOnWall(w,t0),posOnWall(w,t1),'墙体');
      }
    });
  });
  // 自动生成的入户门矩形与两个 50mm 起点标识一并写入 DXF。
  if(S.entryDoor&&S.entryDoor.a&&S.entryDoor.b){
    const d=S.entryDoor,geo=entryDoorGeometry(),a=d.a,b=d.b,c=geo.c,e=geo.e;
    const L=Math.hypot(b.x-a.x,b.y-a.y)||Number(d.width)||900;
    const th=Math.max(1,Number(d.thick)||Number(S.defaultWallThick)||220);
    // 洞口分界线采用虚线；门框其余三边仍为实体线。
    dashedLine(a,b,'门窗');line(b,c,'门窗');line(c,e,'门窗');line(e,a,'门窗');
    if(!entryDoorEndpointConnected(a)&&!entryDoorEndpointIsClosedRegion(a))circle(a,25,'符号');if(!entryDoorEndpointConnected(b)&&!entryDoorEndpointIsClosedRegion(b))circle(b,25,'符号');
    out.push('0','TEXT','8',esc('文本'),'10',String((a.x+b.x)/2),'20',String((a.y+b.y)/2+th/2),'30','0','40','100','1',esc('TD'+String(Math.round(d.width||L)).padStart(4,'0')+'H'+(d.height||2100)));
  }
  S.items.forEach(it=>{
    if(types[it.type]&&S.walls[it.wall]){
      const w=S.walls[it.wall];
      const L=w.len||1;
      const t=Math.max(0.0001,Math.min(0.9999,it.t));
      const e=0.004/L;
      const c1=posOnWall(w,Math.max(0,t-e));
      const c2=posOnWall(w,Math.min(1,t+e));
      let ux=c2.x-c1.x,uy=c2.y-c1.y;
      const ul=Math.hypot(ux,uy)||1;ux/=ul;uy/=ul;
      // 画布屏幕坐标的法线转换到DXF世界坐标（Y轴向上）
      const nx=uy,ny=-ux;
      const c=posOnWall(w,t);
      const h=it.width/2;
      const A={x:c.x-ux*h,y:c.y-uy*h};
      const B={x:c.x+ux*h,y:c.y+uy*h};
      const side=it.side||1;
      /* 文字方向沿墙：切线角限制在 ±90°，位置沿法线偏移 */
      const wallAng=Math.atan2(uy,ux);
      let textAng=wallAng*180/Math.PI;
      if(textAng>90) textAng-=180;
      if(textAng<-90) textAng+=180;
      let tx=nx, ty=ny;
      if(ty<0||(ty===0&&tx<0)){tx=-tx;ty=-ty;}
      const textX=c.x+tx*70;
      const textY=c.y+ty*70;
      // DXF 中以简洁轮廓区分门、垭口、推拉门、窗及电箱
      const blankSide=Number(it.side)||getBlankSide(w,t);
      const frame=Math.max(1,Number(it.frameThick)||Number(w.thick)||Number(S.defaultWallThick)||220);
      const O1={x:A.x+nx*frame*blankSide,y:A.y+ny*frame*blankSide},O2={x:B.x+nx*frame*blankSide,y:B.y+ny*frame*blankSide};
      if(it.type==='door'){
        line(O1,O2,'门窗');line(A,O1,'门窗');
        line(A,{x:A.x+ux*h,y:A.y-uy*h},'门窗');
        const a1=Math.atan2(uy,ux),a2=Math.atan2(ny*side,nx*side);
        // 按画布的屏幕角度递增绘制，转换为DXF世界坐标时反转Y轴
        let delta=a2-a1;while(delta<0)delta+=Math.PI*2;while(delta>Math.PI*2)delta-=Math.PI*2;
        let prev={x:A.x+h*Math.cos(a1),y:A.y-h*Math.sin(a1)};
        for(let k=1;k<=16;k++){const ang=a1+delta*k/16;const q={x:A.x+h*Math.cos(ang),y:A.y-h*Math.sin(ang)};line(prev,q,'门窗');prev=q;}
      }else if(it.type==='opening'){
        // 门洞图例以矩形表示，不创建门厚长度短墙线。
        const jambs=getOpeningJambs(it);
        if(jambs.length===2){
          // 门洞左右两个墙面端点自动连线，外侧两个端点也自动连线，闭合为矩形图例。
          line(jambs[0].a,jambs[1].a,'门窗');
          line(jambs[1].a,jambs[1].b,'门窗');
          line(jambs[1].b,jambs[0].b,'门窗');
          line(jambs[0].b,jambs[0].a,'门窗');
          const jambInset=Math.min(24,h*.28);
          if(jambInset>1){
            const T0={x:ux*jambInset,y:uy*jambInset},T1={x:-ux*jambInset,y:-uy*jambInset};
            line({x:jambs[0].a.x+T0.x,y:jambs[0].a.y+T0.y},{x:jambs[0].b.x+T0.x,y:jambs[0].b.y+T0.y},'门窗');
            line({x:jambs[1].a.x+T1.x,y:jambs[1].a.y+T1.y},{x:jambs[1].b.x+T1.x,y:jambs[1].b.y+T1.y},'门窗');
          }
        }
      }else if(it.type==='window'||it.type==='special'){
        // Canvas中窗体沿屏幕法线向外侧偏移；DXF的世界Y轴向上，法线符号需反转后保持同向。
        const winSide=-blankSide,d1=frame*.5*winSide,d2=frame*winSide;
        const C1={x:A.x+nx*d2,y:A.y+ny*d2},C2={x:B.x+nx*d2,y:B.y+ny*d2};
        line(A,B,'门窗');line(B,C2,'门窗');line(C2,C1,'门窗');line(C1,A,'门窗');
        line({x:A.x+nx*d1,y:A.y+ny*d1},{x:B.x+nx*d1,y:B.y+ny*d1},'门窗');
      }else if(it.type==='bay'){
        // 飘窗DXF仅输出矩形外框，与画布图案一致。
        const baySide=-blankSide,
              d=(Number(it.depth)||0)*baySide,
              C1={x:A.x+nx*d,y:A.y+ny*d},
              C2={x:B.x+nx*d,y:B.y+ny*d};
        line(A,B,'门窗');line(A,C1,'门窗');line(B,C2,'门窗');line(C1,C2,'门窗');
      }else if(it.type==='powerBox'||it.type==='weakBox'){
        const d=(it.frameThick||30)*side,C1={x:A.x+nx*d,y:A.y+ny*d},C2={x:B.x+nx*d,y:B.y+ny*d};
        line(A,B,'符号');line(B,C2,'符号');line(C2,C1,'符号');line(C1,A,'符号');
        if(it.type==='powerBox'){line(A,C2,'符号');line(B,C1,'符号');}
        else out.push('0','CIRCLE','8',esc('符号'),'10',String((A.x+B.x+C1.x+C2.x)/4),'20',String((A.y+B.y+C1.y+C2.y)/4),'30','0','40',String(Math.max(12,it.width*.12)));
      }
      out.push('0','TEXT','8',esc('文本'),
        '10',String(textX),'20',String(textY),'30','0',
        '40','120','50',String(textAng),
        '72','1','73','1','11',String(textX),'21',String(textY),'31','0',
        '1',esc(dxfLabel(it)));
    }else if(pointTypes[it.type]&&it.p){
      const pos=getPointPos(it);
      if(!pos)return;
      // 柱放入墙体图层，其他点状构件放入符号图层
      let pLayer = '符号';
      let pColor = 2; // 黄色
       if (it.type === 'column') {
        pLayer = '墙体';
      }
      
      if(pos.kind==='rect'){
        const {x0,y0,L,W}=pos;
        line({x:x0,y:y0},{x:x0+L,y:y0}, pLayer);
        line({x:x0+L,y:y0},{x:x0+L,y:y0+W}, pLayer);
        line({x:x0+L,y:y0+W},{x:x0,y:y0+W}, pLayer);
        line({x:x0,y:y0+W},{x:x0,y:y0}, pLayer);
      }else{
        out.push('0','CIRCLE','8',esc(pLayer),
          '10',String(pos.cx),'20',String(pos.cy),'30','0',
          '40',String(pos.r));
      }
      
      // 点状构件采用与画布一致的特征图形
      if(pos.kind==='rect'){
        const {x0,y0,L,W}=pos;
        if(it.type==='chimney'){
          line({x:x0,y:y0},{x:x0+L,y:y0+W},pLayer);
          line({x:x0+L,y:y0},{x:x0,y:y0+W},pLayer);
          const ix=x0+L*.18,iy=y0+W*.18,iw=L*.64,ih=W*.64;
          line({x:ix,y:iy},{x:ix+iw,y:iy},pLayer);line({x:ix+iw,y:iy},{x:ix+iw,y:iy+ih},pLayer);
          line({x:ix+iw,y:iy+ih},{x:ix,y:iy+ih},pLayer);line({x:ix,y:iy+ih},{x:ix,y:iy},pLayer);
        }
      }else if(it.type==='sewer'){
        circle({x:pos.cx,y:pos.cy},pos.r*.68,pLayer);
        circle({x:pos.cx,y:pos.cy},pos.r*.2,pLayer);
      }else if(it.type==='drain'){
        // 椭圆轮廓与画布一致（DXF以短线段近似椭圆）
        let prev={x:pos.cx+pos.r*.48,y:pos.cy};
        for(let k=1;k<=24;k++){const a=Math.PI*2*k/24;const q={x:pos.cx+pos.r*.48*Math.cos(a),y:pos.cy-pos.r*.68*Math.sin(a)};line(prev,q,pLayer);prev=q;}
        line({x:pos.cx-pos.r*.3,y:pos.cy-pos.r*.78},{x:pos.cx+pos.r*.3,y:pos.cy-pos.r*.78},pLayer);
      }else if(it.type==='floorDrain'){
        const d=pos.r*.58;
        line({x:pos.cx-d,y:pos.cy-d},{x:pos.cx+d,y:pos.cy+d},pLayer);
        line({x:pos.cx+d,y:pos.cy-d},{x:pos.cx-d,y:pos.cy+d},pLayer);
        line({x:pos.cx,y:pos.cy-pos.r*.78},{x:pos.cx,y:pos.cy+pos.r*.78},pLayer);
        line({x:pos.cx-pos.r*.78,y:pos.cy},{x:pos.cx+pos.r*.78,y:pos.cy},pLayer);
      }

      // 点状构件文字标注放入文本图层
      out.push('0','TEXT','8',esc('文本'),'10',String(pos.cx+70),'20',String(pos.cy+70),'30','0','40','120',
        '72','1','73','1','11',String(pos.cx+70),'21',String(pos.cy+70),'31','0',
        '1',esc(it.label||pointTypes[it.type]));
    }
  });
   S.texts.forEach(t=>{
    const deg = (t.angle||0) * 180 / Math.PI;
    out.push('0','TEXT','8',esc('文本'),'10',String(t.p.x),'20',String(t.p.y),'30','0','40','120',
      '50',String(deg),
      '72','1','73','1','11',String(t.p.x),'21',String(t.p.y),'31','0',
      '1',esc(t.text));
  });
  

  // 添加当前层高文本到图纸右上角
  let tX = 20, tY = 20;
  if(S.walls.length){
    const xs=[], ys=[];
    S.walls.forEach(w=>{xs.push(w.a.x,w.b.x);ys.push(w.a.y,w.b.y)});
    tX = Math.max(...xs) + 20;
    tY = Math.max(...ys) + 20; // DXF的Y轴向上为正，向右和向上各偏移20
  }
  out.push('0','TEXT','8',esc('文本'),'10',String(tX),'20',String(tY),'30','0','40','120','50','0',
    '72','1','73','1','11',String(tX),'21',String(tY),'31','0',
    '1',esc('层高'+S.height));
  
  out.push('0','ENDSEC','0','EOF');

    return out.join('\r\n');
  }

  const api={snap5,distance,arcControlPoint,pointOnWall,wallCurveLength,pointInPolygon,pointOnPolygonBoundary,segmentIntersection,distanceToSegment,openingJambs,escapeDXF,safeExportName,serializeJSON,buildDXF};
  global.LinuoScribe=Object.freeze(api);
})(window);


/* ===== 门窗模块 ===== */
/* 立诺量房门窗与入户门模块：负责门窗几何、门洞连接线和入户门绘制。 */
(function(global){
  'use strict';
  function create(env){
    const getState=()=>env.getState();
    const getCtx=()=>env.getCanvasContext();
    const dist=env.distance;

    function getOpeningJambs(it){
      const S=getState();
      const w=S.walls&&S.walls[it&&it.wall];
      return env.ScribeEngine.openingJambs(w,it,S.defaultWallThick||220,env.getBlankSide);
    }

    // 门洞外侧两端之间的连接线作为虚拟几何边保存，不插入实体墙数组，避免改变原墙线和墙长统计。
    function getOpeningBridgeLine(it){
      const jambs=getOpeningJambs(it);
      if(!Array.isArray(jambs)||jambs.length!==2)return null;
      // 连接两侧门框外端点，形成门洞外沿的闭合线。
      return {a:{x:jambs[0].b.x,y:jambs[0].b.y},b:{x:jambs[1].b.x,y:jambs[1].b.y}};
    }
    function getOpeningEndpointLine(it){
      const jambs=getOpeningJambs(it);
      if(!Array.isArray(jambs)||jambs.length!==2)return null;
      // 同时记录墙面一侧的两个洞口端点连线；不加入实体墙数组，避免重复计量。
      return {a:{x:jambs[0].a.x,y:jambs[0].a.y},b:{x:jambs[1].a.x,y:jambs[1].a.y}};
    }
    function syncOpeningBridgeLine(it){
      if(!it||it.type!=='opening')return null;
      const jambs=getOpeningJambs(it);
      if(!Array.isArray(jambs)||jambs.length!==2)return null;
      it.jambs=jambs.map(s=>({a:{...s.a},b:{...s.b}}));
      it.endpointLine={a:{...jambs[0].a},b:{...jambs[1].a}};
      it.linkLine={a:{...jambs[0].b},b:{...jambs[1].b}};
      return it.linkLine;
    }

    function getEntryDoorPoints(){
      const d=getState().entryDoor;
      if(!d||!d.a||!d.b)return [];
      return [{x:d.a.x,y:d.a.y},{x:d.b.x,y:d.b.y}];
    }

    
function getEntryInsideSide(){
  const S=getState(),d=S.entryDoor;
  if(!d||!d.a||!d.b)return 1;

  // 已经确定过入户门方向，永久保持，不再重新计算。
  if(d.insideSideLocked===true){
    return Number(d.insideSide)===-1?-1:1;
  }

  const dx=d.b.x-d.a.x;
  const dy=d.b.y-d.a.y;
  const baseLen=Math.hypot(dx,dy)||1;

  let plus=0,minus=0;

  // 分别记录门的两个端点是否已经连接墙线。
  const connectedEnds={a:false,b:false};

  (S.walls||[]).forEach(w=>{
    if(!w||!w.a||!w.b||w.openingJamb)return;

    [[w.a,w.b],[w.b,w.a]].forEach(([end,other])=>{

      const da=dist(end,d.a);
      const db=dist(end,d.b);

      if(da<=5)connectedEnds.a=true;
      else if(db<=5)connectedEnds.b=true;
      else return;

      const vx=other.x-end.x;
      const vy=other.y-end.y;
      const ll=Math.hypot(vx,vy)||1;

      const cross=(dx*vy-dy*vx)/(baseLen*ll);

      if(Math.abs(cross)<0.18)return;

      const weight=Math.min(ll,1200);

      if(cross>0)plus+=weight;
      else minus+=weight;
    });
  });

  // 只有一个端点连接时，才允许首次确定入户门方向。
  // 两个端点同时连接后，禁止根据新的墙线重新翻转。
  const onlyOneConnected=
    connectedEnds.a!==connectedEnds.b;

  if(onlyOneConnected){

    if(plus>minus*1.15&&plus>0){
      d.insideSide=1;
      d.insideSideLocked=true;
      env.persist();

    }else if(minus>plus*1.15&&minus>0){
      d.insideSide=-1;
      d.insideSideLocked=true;
      env.persist();
    }
  }

  return Number(d.insideSide)===-1?-1:1;
}


    function entryDoorGeometry(){
      const S=getState(),d=S.entryDoor;
      if(!d||!d.a||!d.b)return null;
      const dx=d.b.x-d.a.x,dy=d.b.y-d.a.y,L=Math.hypot(dx,dy)||1;
      const nx=-dy/L,ny=dx/L,th=Math.max(1,Number(d.thick)||Number(S.defaultWallThick)||220);
      const side=getEntryInsideSide();
      return {a:{...d.a},b:{...d.b},c:{x:d.b.x+nx*th*side,y:d.b.y+ny*th*side},e:{x:d.a.x+nx*th*side,y:d.a.y+ny*th*side},side};
    }

    function hitEntryDoor(p){
      const g=entryDoorGeometry();if(!g)return false;
      const poly=[env.screen(g.a),env.screen(g.b),env.screen(g.c),env.screen(g.e)];
      let inside=false;
      for(let i=0,j=poly.length-1;i<poly.length;j=i++){
        const a=poly[i],b=poly[j];
        const cross=((a.y>p.y)!==(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y||1e-9)+a.x);
        if(cross)inside=!inside;
      }
      if(!inside)return false;
      const endRadius=Math.max(12,25*env.getScale()+6);
      return dist(p,env.screen(g.a))>endRadius&&dist(p,env.screen(g.b))>endRadius;
    }

    function drawEntryDoor(){
      const S=getState(),d=S.entryDoor,g=entryDoorGeometry();if(!d||!g)return;
      const c=getCtx(),a=env.screen(g.a),b=env.screen(g.b),p2=env.screen(g.c),p3=env.screen(g.e);
      c.save();
      c.fillStyle='rgba(40,120,223,.10)';c.strokeStyle='#2878df';c.lineWidth=1.8;
      c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.lineTo(p2.x,p2.y);c.lineTo(p3.x,p3.y);c.closePath();c.fill();c.stroke();
      c.strokeStyle='#2878df';c.lineWidth=2;c.setLineDash([6,4]);
      c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();c.setLineDash([]);
      c.fillStyle='#1677e8';c.font='7.7px sans-serif';c.textAlign='center';
      c.fillText(Math.round(Number(d.width)||Math.hypot(d.b.x-d.a.x,d.b.y-d.a.y))+'×'+Math.round(Number(d.height)||2100),(a.x+b.x+p2.x+p3.x)/4,(a.y+b.y+p2.y+p3.y)/4);
      const r=Math.max(1,25*env.getScale());
      [{s:a,w:g.a},{s:b,w:g.b}].forEach(item=>{
        // 端点一旦与任意墙线连接，立即取消红色端点标识。
        if(env.entryDoorEndpointConnected && env.entryDoorEndpointConnected(item.w))return;
        if(env.entryDoorEndpointIsClosedRegion && env.entryDoorEndpointIsClosedRegion(item.w))return;
        c.beginPath();c.arc(item.s.x,item.s.y,r,0,Math.PI*2);c.fillStyle='rgba(255,255,255,.98)';c.fill();c.strokeStyle='#e53935';c.lineWidth=2;c.stroke();
        c.beginPath();c.arc(item.s.x,item.s.y,4.4,0,Math.PI*2);c.fillStyle='#e53935';c.fill();
      });
      c.restore();
    }

    function drawOpening(it,w,P,scrLen){
      const S=getState(),c=getCtx(),scale=env.getScale();
      const L=w.len||1,t=it.t,e=.004;
      const p1=env.pointOnPath(P,Math.max(0,t-e)),p2=env.pointOnPath(P,Math.min(1,t+e));
      let ux=p2.x-p1.x,uy=p2.y-p1.y;const ul=Math.hypot(ux,uy)||1;ux/=ul;uy/=ul;
      const nx=-uy,ny=ux,center=env.pointOnPath(P,t),halfPx=Math.max(1,(Number(it.width)||0)/(2*L)*scrLen);
      const A={x:center.x-ux*halfPx,y:center.y-uy*halfPx};
      const B={x:center.x+ux*halfPx,y:center.y+uy*halfPx};
      const side=Number(it.side)||env.getBlankSide(w,t)||1;
      // 屏幕法线与世界坐标Y轴方向相反；负号使图例方向与DXF世界坐标一致。
      const sign=-side;
      const thick=Math.max(1,Number(it.frameThick)||Number(w.thick)||Number(S.defaultWallThick)||220);
      const line=(a,b)=>{c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();};
      const offset=(p,d)=>({x:p.x+nx*d,y:p.y+ny*d});
      const poly=(points)=>{c.beginPath();c.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++)c.lineTo(points[i].x,points[i].y);c.closePath();c.stroke();};
      let symbolDepth=thick*scale;
      c.save();c.strokeStyle='#2878df';c.lineWidth=1.7;c.lineCap='round';c.lineJoin='round';
      if(it.type==='powerBox'||it.type==='weakBox'){
        const d=Math.max(2,Math.min(4,(it.frameThick||30)*scale))*side;
        const C1={x:A.x+nx*d,y:A.y+ny*d},C2={x:B.x+nx*d,y:B.y+ny*d};
        poly([A,B,C2,C1]);
        // 弱电箱直接复用强电箱的完整预览比例和内部交叉线，避免图形过小。
        line(A,C2);line(B,C1);
      }else if(it.type==='opening'){
        const C=offset(A,symbolDepth*sign),D=offset(B,symbolDepth*sign);
        // 门洞：按墙厚绘制闭合矩形，并在两端加入门框短线。
        poly([A,B,D,C]);
        const inset=Math.min(24*scale,halfPx*.28);
        if(inset>1.2){
          line({x:A.x+ux*inset,y:A.y+uy*inset},{x:C.x+ux*inset,y:C.y+uy*inset});
          line({x:B.x-ux*inset,y:B.y-uy*inset},{x:D.x-ux*inset,y:D.y-uy*inset});
        }
        symbolDepth=thick*scale;
      }else if(it.type==='window'||it.type==='special'){
        const C=offset(A,symbolDepth*sign),D=offset(B,symbolDepth*sign);
        // 窗及特殊标识：矩形框内增加一道横向分格线。
        poly([A,B,D,C]);
        if(it.type==='special'){
          line(A,D);
        }else{
          line(offset(A,symbolDepth*sign*.5),offset(B,symbolDepth*sign*.5));
        }
            }else if(it.type==='bay'){
        const depth=Math.max(1,Number(it.depth)||600)*scale;
        const C=offset(A,depth*sign),D=offset(B,depth*sign);
        // 飘窗仅保留矩形外框。
        poly([A,B,D,C]);
        symbolDepth=depth;
      }
      c.restore();

      // 宽度尺寸线：黄色尺寸线、端部斜刻度；构件名称保持绿色，便于与墙线区分。
      if(['opening','window','bay'].includes(it.type)){
        const dimGap=Math.max(2,4*scale),dimOffset=(symbolDepth+dimGap)*sign;
        const DA=offset(A,dimOffset),DB=offset(B,dimOffset),EA=offset(A,symbolDepth*sign),EB=offset(B,symbolDepth*sign);
        c.save();c.strokeStyle='#d6b900';c.fillStyle='#26364b';c.lineWidth=1;c.font='7.7px sans-serif';c.textAlign='center';c.textBaseline='middle';
        let ang=Math.atan2(uy,ux);if(ang>Math.PI/2||ang<-Math.PI/2)ang+=Math.PI;
        c.save();c.translate((DA.x+DB.x)/2,(DA.y+DB.y)/2);c.rotate(ang);c.fillText(String(Math.round(Number(it.width)||0)),0,0);c.restore();
        if(it.type==='opening'){
          // 墙厚文字放在门洞矩形的几何中心，避免偏离门洞。
          const TP=offset({x:(A.x+B.x)/2,y:(A.y+B.y)/2},symbolDepth*sign*.5);
          let wallAng=Math.atan2(uy,ux);if(wallAng>Math.PI/2||wallAng<-Math.PI/2)wallAng+=Math.PI;
          c.save();c.translate(TP.x,TP.y);c.rotate(wallAng);c.fillStyle='#64748b';c.font='7.7px sans-serif';c.textAlign='center';c.textBaseline='middle';
          c.fillText(String(Math.round(thick))+'(厚)',0,0);c.restore();
        }
        if(it.type==='bay'){
          const sideP=offset({x:B.x,y:B.y},symbolDepth*sign*.5);
          c.save();c.translate(sideP.x+nx*10,sideP.y+ny*10);c.rotate(Math.atan2(ny,nx));c.fillStyle='#64748b';c.font='7px sans-serif';c.fillText(String(Math.round(Number(it.depth)||0)),0,0);c.restore();
        }
        c.restore();
      }else{
        // 构件名称不在画布显示，仅保留构件轮廓和尺寸数字。

      }

      // 门洞每个外端点独立管理：只要该端点作为起点成功画出墙线，立即隐藏自己的红圈。
      if(it.type==='opening'){
        const jambs=getOpeningJambs(it);
        const ends=jambs.length===2?[jambs[0].b,jambs[1].b]:[];
        const active=ends.filter(q=>!(env.openingEndpointStartUsed&&env.openingEndpointStartUsed(q))&&!(env.openingEndpointConnected&&env.openingEndpointConnected(it,q)));
        c.save();c.strokeStyle='#e53935';c.fillStyle='rgba(255,255,255,.96)';c.lineWidth=1.6;
        const rr=Math.max(1,25*scale);active.forEach(q=>{const z=env.screen(q);c.beginPath();c.arc(z.x,z.y,rr,0,Math.PI*2);c.fill();c.stroke();});c.restore();
      }
    }

    async function itemEditor(hit,type){
      const S=getState(),$=env.$,w=S.walls[hit.i];
      if(w)env.zoomToWorldPoint(env.posOnWall(w,hit.t));
      const isOpening=type==='opening'||type==='door'||type==='sliding';
      if(isOpening)type='opening';
      const isBox=type==='powerBox'||type==='weakBox',isWin=type==='window'||type==='bay'||type==='special',isBay=type==='bay';
      const defaults={
        opening:{width:900,height:2100,thick:S.defaultWallThick||w?.thick||220},
        window:{width:1500,height:2000,sill:700,thick:w?.thick||S.defaultWallThick||220},special:{width:1500,height:2000,sill:0,thick:w?.thick||S.defaultWallThick||220,name:'特殊标识'},
        bay:{width:1800,height:2000,sill:700,depth:600},
        powerBox:{width:400,height:600,sill:1600,thick:30},weakBox:{width:300,height:400,sill:300,thick:30}
      };
      const last=(S.lastInputs&&S.lastInputs[type])||{},def=Object.assign({},defaults[type]||{},last);
      if(type==='special'){const entered=await window.LinuoDialog.input('特殊标识名称','请输入标识名称',def.name||'特殊标识');if(entered===null)return;def.name=String(entered).trim()||'特殊标识';if(env.setMandatorySetupLock)env.setMandatorySetupLock(true);}
      const escAttr=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
      const defEdgeSide=last.edgeSide==='right'?'right':'left',edge=Math.round(Math.min(hit.t,1-hit.t)*w.len);
      env.panel((env.types[type]||type)+'参数',`
        <div class="grid5">
          <div class="f"><label>宽度</label><input id="iw" type="number" value="${def.width}"></div>
          <div class="f"><label>高度</label><input id="iheight" type="number" value="${Number(def.height)||2100}"></div>
          ${isOpening?`<div class="f"><label>墙厚</label><input id="ithick" type="number" value="${def.thick||w.thick||S.defaultWallThick||220}"></div>`:''}
          ${(isWin||isBox)?`<div class="f"><label>距地</label><input id="isill" type="number" value="${def.sill||0}"></div>`:''}
          ${isBay?`<div class="f"><label>深度</label><input id="idepth" type="number" value="${def.depth||600}"></div>`:''}
          <div class="f"><label>距边</label><input id="iedge" type="number" value="${edge}"></div>
        </div>
        <div class="actions" style="display:none;"><button class="primary" id="place">确定</button></div>
        <div class="hint">${isOpening?'门洞两侧保持原墙线连续，并自动连接门洞外侧两个端点。':isWin?'窗按默认墙厚向非闭合空间偏移半墙厚及整墙厚两条窗线。':'电箱厚度默认为30mm。'}</div>
      `);
      const pheadEl=$('phead'),dirHeadBtn=document.createElement('button');
      dirHeadBtn.id='iedgeside';dirHeadBtn.dataset.v=defEdgeSide;dirHeadBtn.textContent=defEdgeSide==='left'?'从起点':'从终点';
      dirHeadBtn.style.cssText='flex:0 0 auto;margin:0 4px;height:28px;padding:0 10px;border-radius:8px;background:#1677e8;color:#fff;border:1px solid #1677e8;font-size:12px;font-weight:700;white-space:nowrap;';
      if(pheadEl)pheadEl.appendChild(dirHeadBtn);
      const refresh=()=>{
        const width=Number($('iw').value)||def.width,ed=Number($('iedge').value)||0,side=dirHeadBtn.dataset.v;
        const t=side==='left'?(ed+width/2)/w.len:1-(ed+width/2)/w.len;
        const thick=isOpening?(Number($('ithick')?.value)||w.thick||S.defaultWallThick||220):(isBox?30:(isWin?(w.thick||S.defaultWallThick||220):(Number($('iheight')?.value)||w.thick||220)));
        env.setPreview({kind:'opening',type,wallIdx:hit.i,t:Math.max(.001,Math.min(.999,t)),width,side:env.getBlankSide(w,t),frameThick:thick,endKey:side==='left'?'a':'b'});
        env.draw();
      };
      dirHeadBtn.onclick=()=>{const v=dirHeadBtn.dataset.v==='left'?'right':'left';dirHeadBtn.dataset.v=v;dirHeadBtn.textContent=v==='left'?'从起点':'从终点';refresh();};
      ['iw','iedge','ithick','iheight'].forEach(id=>{const el=$(id);if(el)el.addEventListener('input',refresh);});
      refresh();
      $('place').onclick=()=>{
        const width=Number($('iw').value),edge2=Number($('iedge').value),side=dirHeadBtn.dataset.v;
        if(width<=0||edge2<0)return alert('请检查宽度和距边尺寸');
        const t=side==='left'?(edge2+width/2)/w.len:1-(edge2+width/2)/w.len;
        // 最后一个参数确认时统一校验：构件宽度及距边组合不得越过宿主墙线。
        if(t<=0||t>=1||width>w.len||edge2+width/2>w.len+0.01){
          env.setPreview(null);env.draw();return alert('构件超出墙体范围，未添加。请调整宽度或距边尺寸。');
        }
        const finalHeight=Number($('iheight')?.value)||Number(def.height)||0;
        const finalDepth=isBay?(Number($('idepth')?.value)||0):0;
        if(finalHeight<0||finalDepth<0)return alert('高度或深度参数无效，未添加构件。');
        env.saveUndo();
        const thick=isOpening?(Number($('ithick')?.value)||w.thick||S.defaultWallThick||220):(isBox?30:(isWin?(w.thick||S.defaultWallThick||220):(Number($('iheight')?.value)||w.thick||220)));
        const newItem={type,wall:hit.i,t,width,edge:edge2,edgeSide:side,height:Number($('iheight')?.value)||Number(def.height)|| (isOpening?2100:0),
          sill:(isWin||isBox)?(Number($('isill')?.value)||0):0,depth:isBay?(Number($('idepth')?.value)||0):0,
          side:env.getBlankSide(w,t),frameThick:thick,label:env.types[type],name:type==='special'?(String(def.name||'特殊标识').trim()||'特殊标识'):''};
        if(isOpening){newItem._openingKey='opening_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);syncOpeningBridgeLine(newItem);}
        S.items.push(newItem);
        // 构件仅附着在原墙线上：添加时绝不运行墙线求交分割，也不改动宿主墙数组。
        if(isOpening)syncOpeningBridgeLine(newItem);
        env.persist();env.scheduleAutoSelect();
        if(type==='special'&&env.setMandatorySetupLock)env.setMandatorySetupLock(false);
        S.lastInputs=S.lastInputs||{};S.lastInputs[type]={width:newItem.width,height:newItem.height,sill:newItem.sill,depth:newItem.depth,edgeSide:newItem.edgeSide,side:newItem.side,thick:newItem.frameThick,name:newItem.name};
        env.setPreview(null);env.draw();env.closePanel();env.clearWallChain();env.setTool('wall');env.fitCanvas();
      };
    }

    function editPlacedItem(idx){
      const S=getState(),$=env.$,it=S.items[idx];if(!it)return;
      if(env.types[it.type]){
        const w=S.walls[it.wall];if(!w)return;
        const isBox=it.type==='powerBox'||it.type==='weakBox',isOpening=it.type==='opening';
        const isWin=['window','bay','special'].includes(it.type),isBay=it.type==='bay';
        const escAttr=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
        const edge=Math.round((it.edgeSide==='right'?(1-it.t):it.t)*w.len-it.width/2),curSide=it.edgeSide==='right'?'right':'left';
        env.panel(env.types[it.type]+'编辑',`
          <div class="grid5">
            <div class="f"><label>宽度</label><input id="eiw" type="number" value="${it.width}"></div>
            <div class="f"><label>高度</label><input id="eih" type="number" value="${Number(it.height)|| (isOpening?2100:2400)}"></div>
            ${isOpening?`<div class="f"><label>墙厚</label><input id="eithick" type="number" value="${it.frameThick||w.thick||S.defaultWallThick||220}"></div>`:''}
            ${(isWin||isBox)?`<div class="f"><label>距地</label><input id="eisill" type="number" value="${it.sill||0}"></div>`:''}
            ${isBay?`<div class="f"><label>深度</label><input id="eidepth" type="number" value="${it.depth||600}"></div>`:''}

            <div class="f"><label>距边</label><input id="eiedge" type="number" value="${Math.max(0,edge)}"></div>
          </div>
          <div class="actions"><button class="primary" id="saveItem">保存修改</button><button class="danger" id="delItem">删除构件</button></div>
          <div class="hint">修改参数将同步更新画布、门洞连接线与尺寸记忆。</div>
        `);
        const pheadEl=$('phead'),tgSide=document.createElement('button');
        tgSide.id='eiside';tgSide.dataset.v=curSide;tgSide.textContent=curSide==='left'?'从起点':'从终点';
        tgSide.style.cssText='flex:0 0 auto;margin:0 4px;height:28px;padding:0 10px;border-radius:8px;background:#1677e8;color:#fff;border:1px solid #1677e8;font-size:12px;font-weight:700;white-space:nowrap;';
        if(pheadEl)pheadEl.appendChild(tgSide);
        const refresh=()=>{
          const width=Number($('eiw').value)||it.width,ed=Number($('eiedge').value)||0,side=tgSide.dataset.v;
          const t=side==='left'?(ed+width/2)/w.len:1-(ed+width/2)/w.len;
          const pThick=isOpening?(Number($('eithick')?.value)||w.thick||S.defaultWallThick||220):(isBox?30:(isWin?(w.thick||S.defaultWallThick||220):(Number($('eih')?.value)||w.thick||220)));
          env.setPreview({kind:'opening',type:it.type,wallIdx:it.wall,t:Math.max(.001,Math.min(.999,t)),width,side:env.getBlankSide(w,t),frameThick:pThick,endKey:side==='left'?'a':'b'});
          env.draw();
        };
        tgSide.onclick=()=>{const v=tgSide.dataset.v==='left'?'right':'left';tgSide.dataset.v=v;tgSide.textContent=v==='left'?'从起点':'从终点';refresh();};
        ['eiw','eiedge','eih','eithick'].forEach(id=>{const el=$(id);if(el)el.addEventListener('input',refresh);});refresh();
        $('saveItem').onclick=()=>{
          const width=Number($('eiw').value),ed=Number($('eiedge').value),side=tgSide.dataset.v;
          if(width<=0||ed<0)return alert('参数无效');
          const t=side==='left'?(ed+width/2)/w.len:1-(ed+width/2)/w.len;
          if(t<=0||t>=1||width>w.len)return alert('构件超出墙体范围');
          env.saveUndo();it.width=width;it.edge=ed;it.edgeSide=side;it.t=t;
          if($('eih'))it.height=Number($('eih').value)||0;
          if($('eithick'))it.frameThick=Number($('eithick').value)||w.thick||S.defaultWallThick||220;
          if($('eisill'))it.sill=Number($('eisill').value)||0;
          if($('eidepth'))it.depth=Number($('eidepth').value)||0;
          if(it.type==='special')it.name=String($('eispecialName')?.value||'特殊标识').trim()||'特殊标识';
          if(isBox)it.frameThick=30;else if(isOpening)it.frameThick=Number($('eithick')?.value)||w.thick||S.defaultWallThick||220;else if(isWin)it.frameThick=w.thick||S.defaultWallThick||220;else it.frameThick=Number($('eih')?.value)||w.thick||220;
          it.side=env.getBlankSide(w,t);
          if(isOpening)syncOpeningBridgeLine(it);
          S.lastInputs=S.lastInputs||{};S.lastInputs[it.type]={width:it.width,height:it.height,sill:it.sill,depth:it.depth,edgeSide:it.edgeSide,side:it.side,thick:it.frameThick,name:it.name};
          env.setPreview(null);env.persist();env.draw();env.closePanel();
        };
        const btnDel=$('delItem');
        if(btnDel)btnDel.onclick=()=>{
          env.saveUndo();
          if(typeof env.removeItemAt==='function')env.removeItemAt(idx);
          else S.items.splice(idx,1);
          env.setPreview(null);env.persist();env.draw();env.closePanel();
        };
      }else env.openPointEditor(it);
    }

    function entryDoorEditor(){
      const S=getState(),$=env.$,d=S.entryDoor;if(!d)return;
      const L=Math.round(dist(d.a,d.b));
      env.panel('入户门参数',`
        <div class="grid4" style="grid-template-columns:repeat(2,minmax(0,1fr));">
          <div class="f"><label>门宽</label><input id="entryWidth" type="number" min="100" value="${d.width||L}"></div>
          <div class="f"><label>门高</label><input id="entryDoorHeight" type="number" min="100" value="${d.height||2100}"></div>
        </div>
        <button class="primary" id="saveEntryDoor" style="display:none">保存参数</button>
        <div class="hint">修改门宽以门洞中心为基准；输入完成后按数字键盘 ✓ 保存。墙厚沿用原有设置，不在此处修改。</div>
      `);
      $('saveEntryDoor').onclick=()=>{
        const width=Math.max(100,Number($('entryWidth').value)||L),height=Math.max(100,Number($('entryDoorHeight').value)||2100);
        const cx=(d.a.x+d.b.x)/2,cy=(d.a.y+d.b.y)/2,dx=d.b.x-d.a.x,dy=d.b.y-d.a.y,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;
        env.saveUndo();d.a={x:cx-ux*width/2,y:cy-uy*width/2};d.b={x:cx+ux*width/2,y:cy+uy*width/2};
        d.width=Math.round(dist(d.a,d.b));d.height=height;env.persist();env.closePanel();env.draw();env.showToast('入户门参数已更新');
      };
    }

    return {getOpeningJambs,getOpeningBridgeLine,getOpeningEndpointLine,syncOpeningBridgeLine,getEntryDoorPoints,getEntryInsideSide,entryDoorGeometry,hitEntryDoor,drawEntryDoor,drawOpening,itemEditor,editPlacedItem,entryDoorEditor};
  }
  global.LinuoDoorModule={create};
})(window);


/* ===== 其它构件模块 ===== */
/* 立诺量房其它构件模块：点状构件位置计算、轮廓绘制及墙端占位计算。 */
(function(global){
  'use strict';
  const pointTypes=Object.freeze({drain:'马桶',floorDrain:'地漏',groundDrain:'地面下水',sewer:'立管',column:'柱',chimney:'烟道'});
  function create(env){
    function getPointPos(it){
      const base=it&&it.p;if(!base)return null;
      const mx=Number(it.marginX)||0,my=Number(it.marginY)||0;
      if(it.type==='column'||it.type==='chimney'){
        const L=Number(it.length)||it.size||300,Wd=Number(it.width)||it.size||300;
        let x0,y0;
        if(it.marginXSide==='left')x0=base.x+mx;else x0=base.x-mx-L;
        if(it.marginYSide==='top')y0=base.y-my-Wd;else y0=base.y+my;
        return {kind:'rect',x0,y0,L,W:Wd,cx:x0+L/2,cy:y0+Wd/2};
      }
      const size=Number(it.size)||110,r=size/2;
      let cx,cy;
      if(it.marginXSide==='left')cx=base.x+mx+r;else cx=base.x-mx-r;
      if(it.marginYSide==='top')cy=base.y-my-r;else cy=base.y+my+r;
      return {kind:'circle',cx,cy,r};
    }
    function getOutlinePoints(it){
      const pos=getPointPos(it);if(!pos)return [];
      if(pos.kind==='rect')return [
        {x:pos.x0,y:pos.y0},{x:pos.x0+pos.L,y:pos.y0},
        {x:pos.x0+pos.L,y:pos.y0+pos.W},{x:pos.x0,y:pos.y0+pos.W}
      ];
      return [
        {x:pos.cx-pos.r,y:pos.cy-pos.r},{x:pos.cx+pos.r,y:pos.cy-pos.r},
        {x:pos.cx+pos.r,y:pos.cy+pos.r},{x:pos.cx-pos.r,y:pos.cy+pos.r}
      ];
    }
    function wallEndBlockLengthOnWall(w,it){
      const dx=w.b.x-w.a.x,dy=w.b.y-w.a.y,len=Math.hypot(dx,dy)||1;
      const ux=Math.abs(dx/len),uy=Math.abs(dy/len);
      const objL=Math.max(0,Number(it.length)||Number(it.size)||300),objW=Math.max(0,Number(it.width)||Number(it.size)||300);
      return ux*objL+uy*objW;
    }
    function drawPointItem(it){
      const pos=getPointPos(it);if(!pos)return;
      const c=env.getCanvasContext(),scale=env.getScale(),origin=env.getOrigin(),screen=env.screen;
      const p=screen({x:pos.cx,y:pos.cy});
      c.save();c.lineWidth=1.8;c.strokeStyle='#2878df';c.fillStyle='rgba(255,255,255,.94)';
      if(pos.kind==='rect'){
        const x=origin.x+pos.x0*scale,y=origin.y-(pos.y0+pos.W)*scale,w=pos.L*scale,h=pos.W*scale;
        c.fillRect(x,y,w,h);c.strokeRect(x,y,w,h);
        if(it.type==='chimney'){
          c.beginPath();c.moveTo(x,y);c.lineTo(x+w,y+h);c.moveTo(x+w,y);c.lineTo(x,y+h);c.rect(x+w*.18,y+h*.18,w*.64,h*.64);c.stroke();
        }else{
          // 柱仅使用简洁矩形标识，不再绘制内部套框与十字线。
        }
        c.fillStyle='#0a9f60';c.font='7px -apple-system,BlinkMacSystemFont,sans-serif';c.textAlign='center';
        c.fillText(Math.round(pos.L),x+w/2,y-6);
        c.save();c.translate(x+w+10,y+h/2);c.rotate(-Math.PI/2);c.fillText(Math.round(pos.W),0,0);c.restore();
        const baseP=screen(it.p),mx=Number(it.marginX)||0,my=Number(it.marginY)||0;c.fillStyle='#e53935';
        if(mx>0){const exX=baseP.x+(it.marginXSide==='left'?mx:-mx)*scale;c.textAlign='center';c.fillText(Math.round(mx),(baseP.x+exX)/2,baseP.y+14);}
        if(my>0){const exY=baseP.y+(it.marginYSide==='top'?-my:my)*scale;c.textAlign='right';c.fillText(Math.round(my),baseP.x-6,(baseP.y+exY)/2+4);}
      }else{
        const r=Math.max(5,pos.r*scale);c.beginPath();c.arc(p.x,p.y,r,0,Math.PI*2);c.fill();c.stroke();
        if(it.type==='sewer'){c.beginPath();c.arc(p.x,p.y,r*.68,0,Math.PI*2);c.stroke();c.beginPath();c.arc(p.x,p.y,Math.max(1.8,r*.2),0,Math.PI*2);c.stroke();}
        else if(it.type==='drain'){c.beginPath();c.ellipse(p.x,p.y,r*.48,r*.68,0,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(p.x-r*.3,p.y+r*.78);c.lineTo(p.x+r*.3,p.y+r*.78);c.stroke();}
        else if(it.type==='floorDrain'){const d=r*.58;c.beginPath();c.moveTo(p.x-d,p.y-d);c.lineTo(p.x+d,p.y+d);c.moveTo(p.x+d,p.y-d);c.lineTo(p.x-d,p.y+d);c.moveTo(p.x,p.y-r*.78);c.lineTo(p.x,p.y+r*.78);c.moveTo(p.x-r*.78,p.y);c.lineTo(p.x+r*.78,p.y);c.stroke();}
        else if(it.type==='groundDrain'){c.beginPath();c.arc(p.x,p.y,r*.55,0,Math.PI*2);c.stroke();c.lineWidth=2;c.beginPath();c.moveTo(p.x-r*.55,p.y);c.lineTo(p.x+r*.55,p.y);c.moveTo(p.x,p.y-r*.55);c.lineTo(p.x,p.y+r*.55);c.stroke();}
      }
      // 画布仅显示构件图形与尺寸，不显示构件名称。
      c.restore();
    }
    function openPointEditor(it){
      const S=env.getState(),$=env.$;
      env.setPointEditIndex(S.items.indexOf(it));
      if(it.type==='floorDrain')it.size=75;
      if(it.type==='drain')it.size=110;
      if(it.type==='groundDrain'&&!it.size)it.size=110;
      const editSnapshot=JSON.stringify(S),isRect=it.type==='column'||it.type==='chimney';
      let sizeInputs='';
      if(isRect){
        sizeInputs=`<div class="f"><label>长度</label><input id="dlen" type="number" value="${it.length||it.size||300}"></div><div class="f"><label>宽度</label><input id="dwid" type="number" value="${it.width||it.size||300}"></div>`;
      }else if(it.type==='sewer'||it.type==='groundDrain'){
        const dOpts=it.type==='sewer'?[50,75,110,160,200]:[50,75,110,160];
        sizeInputs=`<div class="f"><label>管径</label><select id="ddia" style="height:32px;padding:0 4px;font-size:12px;">${dOpts.map(sz=>`<option value="${sz}" ${it.size==sz?'selected':''}>${sz}</option>`).join('')}</select></div>`;
      }
      env.panel(pointTypes[it.type]+'标注',`
        <div class="grid5">
          <div class="f"><label>名称</label><input id="dn" value="${it.label||pointTypes[it.type]}"></div>
          ${sizeInputs}
          <div class="f"><label>左右边距</label><input id="dleft" type="number" value="${it.marginX||0}"></div>
          <div class="f"><label>上下边距</label><input id="dtop" type="number" value="${it.marginY||0}"></div>
        </div>
        <div class="actions"><button class="primary" id="dsave">完成编辑</button></div>
        <div class="hint">构件位置保持锁定；通过尺寸和边距数值调整位置与大小。边距为基准线到构件对应边的距离。</div>
      `);
      const refresh=()=>{
        if($('dlen'))it.length=Number($('dlen').value)||it.length;
        if($('dwid'))it.width=Number($('dwid').value)||it.width;
        if($('ddia'))it.size=Number($('ddia').value)||it.size;
        it.label=$('dn').value;it.marginX=Number($('dleft').value)||0;it.marginY=Number($('dtop').value)||0;
        env.setPreview({kind:'point',it:{...it}});env.draw();
      };
      ['dlen','dwid','ddia','dleft','dtop','dn'].forEach(id=>{
        const el=$(id);if(el){el.addEventListener('input',refresh);el.addEventListener('change',refresh);}
      });
      refresh();
      const btnSave=$('dsave')||document.querySelector('#globalActions #dsave');
      if(btnSave)btnSave.onclick=()=>{
        it.label=$('dn').value;
        if($('dlen'))it.length=Number($('dlen').value)||it.length;
        if($('dwid'))it.width=Number($('dwid').value)||it.width;
        if($('ddia'))it.size=Number($('ddia').value)||it.size;
        it.marginX=Number($('dleft').value)||0;it.marginY=Number($('dtop').value)||0;
        const now=JSON.stringify(S);if(now!==editSnapshot)env.pushUndoSnapshot(editSnapshot);
        env.setPreview(null);env.persist();env.draw();env.closePanel();env.setTool('select');env.fitCanvas();
      };
    }

    return {getPointPos,getOutlinePoints,wallEndBlockLengthOnWall,drawPointItem,openPointEditor,pointTypes};
  }
  global.LinuoOtherModule={create,pointTypes};
})(window);


/* ===== 导入导出模块 ===== */
/* 立诺量房导入导出模块：统一负责 Blob 下载、DXF 构建及 JSON 导入/导出。 */
(function(global){
  'use strict';
  function create(env){
    const $=env.$;
    const getState=()=>env.getState();

    function downloadFileBlob(blob,filename){
      let url=null,a=null;
      try{
        if(!blob||typeof global.Blob==='undefined')throw new Error('导出文件数据无效');
        if(global.navigator&&global.navigator.msSaveOrOpenBlob){global.navigator.msSaveOrOpenBlob(blob,filename);return true;}
        if(!global.URL||typeof global.URL.createObjectURL!=='function')throw new Error('当前浏览器不支持文件下载');
        url=global.URL.createObjectURL(blob);
        a=global.document.createElement('a');
        a.href=url;a.download=filename;a.rel='noopener';
        a.style.cssText='position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
        (global.document.body||global.document.documentElement).appendChild(a);
        // 必须在按钮的同步点击调用栈内立即触发，不能先经过异步分享或文件选择流程。
        a.click();
        global.setTimeout(()=>{
          try{if(a&&a.parentNode)a.parentNode.removeChild(a);}catch(e){}
          try{if(url)global.URL.revokeObjectURL(url);}catch(e){}
        },30000);
        return true;
      }catch(err){
        console.error('文件下载调用失败',err);
        try{if(a&&a.parentNode)a.parentNode.removeChild(a);}catch(e){}
        try{if(url&&global.URL)global.URL.revokeObjectURL(url);}catch(e){}
        return false;
      }
    }

    function exportDXF(){
      try{
        const S=getState();
        const dxfText=env.ScribeEngine.buildDXF(S,{
          types:env.types,pointTypes:env.pointTypes,posOnWall:env.posOnWall,
          getPointPos:env.getPointPos,getOpeningJambs:env.getOpeningJambs,
          dxfLabel:env.dxfLabel,getBlankSide:env.getBlankSide,
          entryDoorGeometry:env.entryDoorGeometry,
          entryDoorEndpointConnected:env.entryDoorEndpointConnected,
          entryDoorEndpointIsClosedRegion:env.entryDoorEndpointIsClosedRegion
        });
        if(typeof dxfText!=='string'||!dxfText.includes('0\r\nEOF')&&!dxfText.includes('0\nEOF'))throw new Error('DXF内容生成不完整');
        const blob=new global.Blob([dxfText],{type:'application/dxf;charset=utf-8'});
        const ok=downloadFileBlob(blob,'DXF_'+env.ScribeEngine.safeExportName(S.projectName||'立诺量房平面图')+'.dxf');
        if(ok)env.showToast('DXF下载已触发，请查看浏览器下载记录');
        else alert('DXF文件已生成，但浏览器未能触发下载，请使用Chrome或Edge重试。');
        return !!ok;
      }catch(err){
        console.error('DXF导出失败',err);
        alert('DXF导出失败：'+(err&&err.message?err.message:err));
        return false;
      }
    }

    async function exportJSON(){
      try{
        const S=getState();
        let payload;
        const choice=global.LinuoDialog?await global.LinuoDialog.show('导出 JSON','请选择需要导出的内容：',[
          {label:'导出全部',value:'all',primary:true},{label:'导出当前',value:'current'},{label:'取消',value:'cancel'}
        ]):'current';
        if(choice==='cancel'||choice===false)return false;
        const stamp=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return '图纸_'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes());};
        if(choice==='current'){
          // 导出副本必须带图纸名称；原项目没有名称时以导出文件名作为图纸名称写入 JSON。
          const exportState=Object.assign({},S);
          const currentName=String(S.projectName||'').trim();
          exportState.projectName=(!currentName||currentName==='未命名图纸'||currentName==='立诺量房项目')?stamp():currentName;
          payload=JSON.parse(env.ScribeEngine.serializeJSON(exportState,{app:'立诺量房',version:'V0.45',schema:4,exportedAt:new Date().toISOString()}));
        }else{
          let records=[];try{records=JSON.parse(global.localStorage.getItem('linuo_measure_projects_v1')||'[]');}catch(e){}
          if(!Array.isArray(records)||!records.length)records=[S];
          records=records.map((r,i)=>Object.assign({},r,{projectName:String(r&&r.projectName||'').trim()||('图纸_'+(i+1))}));
          payload={__meta:{app:'立诺量房',version:'V0.45',schema:4,exportedAt:new Date().toISOString(),type:'project_collection'},projects:records};
        }
        const jsonText=JSON.stringify(payload,null,2);
        JSON.parse(jsonText);
        const blob=new global.Blob([jsonText],{type:'application/json;charset=utf-8'});
        const name=payload.projects?'全部图纸记录':'当前图纸';
        const drawingName=payload.projects?'多图纸':payload.projectName;
        const ok=downloadFileBlob(blob,'JSON_'+env.ScribeEngine.safeExportName(name+'_'+drawingName)+'.json');
        if(ok)env.showToast('JSON下载已触发，图纸名称已写入文件');
        else alert('JSON文件已生成，但浏览器未能触发下载，请使用Chrome或Edge重试。');
        return !!ok;
      }catch(err){
        console.error('JSON导出失败',err);
        alert('JSON导出失败：'+(err&&err.message?err.message:err));
        return false;
      }
    }

    async function importJSONData(input,sourceFileName=''){
      let raw;
      if(typeof input==='string'){
        const jsonText=input.replace(/^\uFEFF/,'').trim();
        raw=JSON.parse(jsonText);
      }else raw=input;
      if(Array.isArray(raw))raw={projects:raw};
      if(raw&&Array.isArray(raw.projects)){
        if(!raw.projects.length)throw new Error('JSON中没有可导入的图纸记录');
        const names=raw.projects.map((p,i)=>(i+1)+'. '+(p.projectName||'未命名图纸')).join('\\n');
        const picked=global.LinuoDialog?await global.LinuoDialog.input('选择导入图纸','请输入要导入的序号：\\n'+names,'1'): '1';
        if(picked===null)return null;
        const n=Number(picked);if(!Number.isInteger(n)||n<1||n>raw.projects.length)throw new Error('图纸序号无效');
        raw=raw.projects[n-1];
      }
      if(raw&&raw.state&&typeof raw.state==='object')raw=raw.state;
      if(raw&&raw.data&&typeof raw.data==='object')raw=raw.data;
      if(raw&&raw.project&&typeof raw.project==='object')raw=raw.project;
      if(raw&&raw.payload&&typeof raw.payload==='object')raw=raw.payload;
      if(!raw||typeof raw!=='object')throw new Error('JSON内容不是有效的图纸对象');
      if(!Array.isArray(raw.walls)&&raw.state&&Array.isArray(raw.state.walls))raw=raw.state;
      if(!Array.isArray(raw.walls))throw new Error('JSON缺少有效的墙体数组（walls）');
      const current=getState();
      const importMode=global.LinuoDialog?await global.LinuoDialog.show('导入方式','默认采用合并模式：导入墙线、构件、文字和尺寸追加到当前图纸，不清除现有内容。同名或重叠内容不会自动去重。',[
        {label:'合并导入（默认）',value:'merge',primary:true},{label:'覆盖当前图纸',value:'replace'},{label:'取消',value:'cancel'}
      ]):'merge';
      if(importMode==='cancel'||importMode===false)return null;
      const doMerge=importMode!=='replace';
      const currentWalls=Array.isArray(current.walls)?current.walls:[];
      const rawDefaultThick=Number(raw.defaultWallThick);
      const importedDefaultThick=rawDefaultThick>0?((!raw.wallThicknessDefaultUpgraded&&rawDefaultThick===120)?220:rawDefaultThick):220;
      const walls=raw.walls.filter(w=>w&&w.a&&w.b&&!w.openingJamb).map(w=>{
        const a={x:Number(w.a.x)||0,y:Number(w.a.y)||0},b={x:Number(w.b.x)||0,y:Number(w.b.y)||0};
        const len=Number(w.len);
        return Object.assign({},w,{a,b,len:Number.isFinite(len)&&len>0?len:env.distance(a,b),thick:Number(w.thick)||importedDefaultThick,arc:!!w.arc,bulge:Number(w.bulge)||0});
      });
      const importedItems=Array.isArray(raw.items)?raw.items.map(it=>{
        const item=Object.assign({},it);
        // 合并时墙体追加在原墙体后面，必须同步平移构件的墙索引。
        if(doMerge&&Number.isInteger(item.wall))item.wall+=currentWalls.length;
        if(doMerge&&Number.isInteger(item.attachedWall))item.attachedWall+=currentWalls.length;
        return item;
      }):[];
      const importedTexts=Array.isArray(raw.texts)?raw.texts.map(t=>Object.assign({},t)):[];
      const importedMeasures=Array.isArray(raw.measures)?raw.measures.filter(m=>m&&m.a&&m.b):[];
      env.saveUndo();
      const next=Object.assign({},current,raw,{
        walls:doMerge?[...currentWalls,...walls]:walls,
        items:doMerge?[...(Array.isArray(current.items)?current.items:[]),...importedItems]:importedItems,
        texts:doMerge?[...(Array.isArray(current.texts)?current.texts:[]),...importedTexts]:importedTexts,
        measures:doMerge?[...(Array.isArray(current.measures)?current.measures:[]),...importedMeasures]:importedMeasures,
        height:doMerge?(Number(current.height)||Number(raw.height)||2700):(Number(raw.height)>0?Number(raw.height):2700),
        defaultWallThick:doMerge?(Number(current.defaultWallThick)||importedDefaultThick):importedDefaultThick,
        wallThicknessDefaultUpgraded:true,
        lastInputs:doMerge?Object.assign({},current.lastInputs||{},raw.lastInputs||{}):(raw.lastInputs&&typeof raw.lastInputs==='object'?raw.lastInputs:{}),
        btService:raw.btService||current.btService||'3ab10100-f831-4395-b29d-570977d5bf94',
        btChar:raw.btChar||current.btChar||'3ab10101-f831-4395-b29d-570977d5bf94',
        btDeviceId:raw.btDeviceId||current.btDeviceId||null,
        projectName:doMerge?(String(current.projectName||'').trim()||String(raw.projectName||'').trim()||String(sourceFileName||'').trim()||'未命名图纸'):(String(raw.projectName||'').trim()||String(sourceFileName||'').trim()||'未命名图纸'),
        roomNames:doMerge?Object.assign({},current.roomNames||{},raw.roomNames||{}):(raw.roomNames&&typeof raw.roomNames==='object'?raw.roomNames:{}),
        // 当前数据结构只支持一个入户门；合并时保留当前门，如当前没有则采用导入门。
        entryDoor:doMerge?(current.entryDoor||(raw.entryDoor&&raw.entryDoor.a&&raw.entryDoor.b?Object.assign({},raw.entryDoor,{a:{...raw.entryDoor.a},b:{...raw.entryDoor.b}}):null)):(raw.entryDoor&&raw.entryDoor.a&&raw.entryDoor.b?Object.assign({},raw.entryDoor,{a:{...raw.entryDoor.a},b:{...raw.entryDoor.b}}):null)
      });
      delete next.__meta;
      env.setState(next);
      env.normalizeLegacyItems();
      const S=getState();
      // 导入只恢复数据，不运行旧版门洞桥接线/全局求交算法；这两项会改写墙数组，
      // 造成导入后墙线被拆段、构件索引错位甚至出现空白。构件仅保留附着引用与参数。
      (S.walls||[]).forEach(w=>{if(w&&Object.prototype.hasOwnProperty.call(w,'openingHostKey'))delete w.openingHostKey;});
      (S.items||[]).forEach(it=>{
        if(!it||typeof it!=='object')return;
        if(it.type==='opening'&&!it._openingKey)it._openingKey='opening_import_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
        if(Number.isInteger(it.wall)&&it.wall>=S.walls.length)it.wall=-1;
        if(Number.isInteger(it.attachedWall)&&it.attachedWall>=S.walls.length)it.attachedWall=-1;
      });
      env.clearWallChain();
      env.resetImportInteraction();
      if($('heightInp'))$('heightInp').value=S.height;
      if($('projectNameInp'))$('projectNameInp').value=S.projectName;
      env.persist();env.closePanel();env.fitCanvas();env.draw();env.showToast(doMerge?'JSON已合并到当前图纸':'JSON已覆盖当前图纸');
      return S;
    }

        // ============================================================
    // 云端备份 / 恢复
    // 云端固定路径：shuju/{companyId}/celiang/celiang.json
    // ============================================================

    const CLOUD_PROJECTS_KEY = 'linuo_measure_projects_v1';
    const CLOUD_MANAGEMENT_USERS = ['admin', 'qiyu'];
    const CLOUD_MANAGEMENT_COMPANY = 'linuo';

    function cloneCloudValue(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    // 读取本地已保存图纸
    function readLocalProjectRecords() {
      try {
        const value = JSON.parse(
          global.localStorage.getItem(CLOUD_PROJECTS_KEY) || '[]'
        );

        return Array.isArray(value)
          ? value.filter(item =>
              item &&
              typeof item === 'object' &&
              Array.isArray(item.walls)
            ).map(cloneCloudValue)
          : [];

      } catch (error) {
        console.warn('[云恢复] 本地图纸列表读取失败：', error);
        return [];
      }
    }

    // 写入本地图纸列表
    function writeLocalProjectRecords(records) {
      if (!Array.isArray(records)) {
        throw new Error('本地图纸列表格式不正确');
      }

      global.localStorage.setItem(
        CLOUD_PROJECTS_KEY,
        JSON.stringify(records)
      );
    }

    // 获取图纸唯一识别标记
    function projectRecordKey(record) {
      const name = String(
        record && record.projectName || ''
      ).trim().toLocaleLowerCase();

      if (name) return 'name:' + name;

      return record && record.id != null
        ? 'id:' + String(record.id)
        : '';
    }

    // 获取图纸保存时间
    function projectRecordTime(record) {
      const value = record && (
        record.savedAt ||
        record.updatedAt ||
        record.modifiedAt ||
        record.exportedAt
      );

      const time = value ? new Date(value).getTime() : 0;

      return Number.isFinite(time) ? time : 0;
    }

    // 合并图纸：保留本地独有图纸，同名图纸优先保留保存时间较新的版本
    function mergeProjectRecords(localRecords, cloudRecords) {
      const result = [];
      const indexMap = new Map();

      [
        ...(Array.isArray(localRecords) ? localRecords : []),
        ...(Array.isArray(cloudRecords) ? cloudRecords : [])
      ].forEach(item => {

        if (!item || !Array.isArray(item.walls)) return;

        const copy = cloneCloudValue(item);
        const key = projectRecordKey(copy);

        if (!key) {
          result.push(copy);
          return;
        }

        if (!indexMap.has(key)) {
          indexMap.set(key, result.length);
          result.push(copy);
          return;
        }

        const index = indexMap.get(key);

        if (
          projectRecordTime(copy) >=
          projectRecordTime(result[index])
        ) {
          result[index] = copy;
        }
      });

      return result;
    }

    // 获取 file_link.php 地址
    // 优先使用 yun.js 中的统一云端配置
    function getMeasureFileLinkBase() {

      if (global.FILE_LINK_URL) {
        return String(global.FILE_LINK_URL).replace(/\/+$/, '');
      }

      const dataBase =
        global.DATA_API_BASE ||
        (
          global.CLOUD_CONFIG_MANAGER &&
          global.CLOUD_CONFIG_MANAGER.GONG_YONG_URL
        );

      if (dataBase) {
        return String(dataBase).replace(/\/+$/, '') +
          '/file_link.php';
      }

      // 与量房登录模块使用相同的接口
      return '/data-api/file_link.php';
    }

    // 构建云端读取地址
    function buildMeasureCloudReadUrl(filePath) {

      if (typeof global.buildFileLinkUrl === 'function') {
        return global.buildFileLinkUrl('read', filePath);
      }

      const base = getMeasureFileLinkBase();

      return base +
        (base.includes('?') ? '&' : '?') +
        'action=read&file=' + encodeURIComponent(filePath);
    }

    // 云端读取 JSON
    async function readMeasureCloudJson(filePath) {

      const response = await global.fetch(
        buildMeasureCloudReadUrl(filePath),
        {
          method: 'GET',
          cache: 'no-cache',
          mode: 'cors',
          credentials: 'omit',
          headers: {
            'Accept': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => '');

        throw new Error(
          response.status === 404
            ? '云端尚无量房备份文件'
            : `云端读取失败（HTTP ${response.status}）` +
              (detail ? '：' + detail : '')
        );
      }

      return await response.json();
    }

    // 云端写入 JSON
    // 参照 yun.js 的 file_link.php POST 写入方式
    async function writeMeasureCloudJson(filePath, data) {

      const base = getMeasureFileLinkBase();

      const url = base +
        (base.includes('?') ? '&' : '?') +
        'action=write&file=' + encodeURIComponent(filePath);

      const response = await global.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data),
        mode: 'cors',
        credentials: 'omit'
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');

        throw new Error(
          `云端写入失败（HTTP ${response.status}）` +
          (detail ? '：' + detail : '')
        );
      }

      const result = await response.json();

      if (result && result.success === false) {
        throw new Error(result.error || '云端返回写入失败');
      }

      return result;
    }

    // 从账号 JSON 中寻找对应账号
 // 从账号 JSON 的 builtInUsers 中精确查找账号
function findMeasureAccountRecord(data, account) {

  const target = String(account || '').trim().toLowerCase();

  if (!target || !data) return null;

  // 兼容不同层级的账号数据包装
  const containers = [
    data,
    data.data,
    data.result,
    data.payload
  ].filter(Boolean);

  for (const container of containers) {

    if (Array.isArray(container)) {

      const found = container.find(user =>
        user &&
        typeof user === 'object' &&
        String(user.username || '').trim().toLowerCase() === target
      );

      if (found) return found;
    }

    if (typeof container !== 'object') continue;

    // 优先检查真正的账号列表
    const users = container.builtInUsers;

    if (Array.isArray(users)) {

      const found = users.find(user =>
        user &&
        typeof user === 'object' &&
        String(user.username || '').trim().toLowerCase() === target
      );

      if (found) {
        console.log('[云备份] 已从 builtInUsers 找到账号', {
          username: found.username,
          companyId: found.companyId || ''
        });

        return found;
      }
    }

    // 兼容以账号名作为键的对象
    if (
      users &&
      typeof users === 'object' &&
      !Array.isArray(users)
    ) {
      const found = users[target] ||
        Object.entries(users).find(
          ([key]) => key.trim().toLowerCase() === target
        )?.[1];

      if (found && typeof found === 'object') {
        return found;
      }
    }
  }

  console.error('[云备份] builtInUsers 中没有找到账号：', target);

  return null;
}

    // 验证公司ID，防止路径异常
    function validateCompanyId(value) {

      const id = String(value == null ? '' : value).trim();

      if (!id || !/^[A-Za-z0-9_]+$/.test(id)) {
        throw new Error(
          '账号没有有效的公司ID，或公司ID格式不正确'
        );
      }

      return id;
    }

    // 自动识别当前登录账号对应的公司ID
 // 自动识别当前登录用户所属公司
async function resolveMeasureCompanyId() {

  // 1. 获取当前登录账号
  const account = String(
    global.currentMeasureAccount ||
    (() => {
      try {
        return global.sessionStorage.getItem('loginUsername') || '';
      } catch (e) {
        return '';
      }
    })()
  ).trim();

  if (!account) {
    throw new Error('没有获取到当前登录账号，请重新登录');
  }

  const accountKey = account.toLowerCase();

  // 2. 管理账号固定使用 linuo 公司目录
  if (['admin', 'qiyu'].includes(accountKey)) {

    global.currentMeasureCompanyId = 'linuo';
    global.currentMeasureCompanyAccount = accountKey;

    console.log('[云备份] 管理账号，使用公司ID：linuo');

    return 'linuo';
  }

  // 3. 首先检查当前登录会话中的用户对象
  let userRecord = null;

  if (
    global.currentMeasureUser &&
    String(global.currentMeasureUser.username || '').trim().toLowerCase() === accountKey
  ) {
    userRecord = global.currentMeasureUser;
  }

  // 4. 检查已有公司ID缓存，但必须确认账号一致
  if (!userRecord) {

    const currentUser = global.currentUser;

    if (
      currentUser &&
      String(currentUser.username || '').trim().toLowerCase() === accountKey &&
      currentUser.companyId
    ) {
      userRecord = currentUser;
    }
  }

  // 5. 本地缓存只允许匹配同一个账号
  let cachedCompanyId = '';

  if (
    String(global.currentMeasureCompanyAccount || '').toLowerCase() === accountKey
  ) {
    cachedCompanyId = global.currentMeasureCompanyId || '';
  }

  // 6. 缓存中已有有效公司ID，直接使用
  if (userRecord && userRecord.companyId) {
    cachedCompanyId = userRecord.companyId;
  }

  if (cachedCompanyId) {

    const validId = validateCompanyId(cachedCompanyId);

    global.currentMeasureCompanyId = validId;
    global.currentMeasureCompanyAccount = accountKey;

    console.log('[云备份] 从当前账号信息获取公司ID：', validId);

    return validId;
  }

  // 7. 直接读取云端真实账号文件
  console.log('[云备份] 正在读取 shuju/zhanghao.json');

  const accountData = await readMeasureCloudJson(
    'shuju/zhanghao.json'
  );

  if (!accountData) {
    throw new Error('云端账号文件读取失败');
  }

  // 8. 只从 builtInUsers 精确匹配
  userRecord = findMeasureAccountRecord(
    accountData,
    account
  );

  if (!userRecord) {
    throw new Error(
      `账号 ${account} 已登录，但云端 builtInUsers 中没有找到该账号记录`
    );
  }

  // 9. 直接获取账号对象里的 companyId
  const companyId =
    userRecord.companyId ||
    userRecord.companyID ||
    userRecord.company_id ||
    '';

  if (!companyId) {

    console.error('[云备份] 找到账号，但缺少公司ID字段：', {
      username: userRecord.username,
      availableFields: Object.keys(userRecord)
    });

    throw new Error(
      `已找到账号 ${account}，但其账号记录没有 companyId，请检查账号管理中的公司归属`
    );
  }

  // 10. 验证并保存公司ID
  const validId = validateCompanyId(companyId);

  global.currentMeasureCompanyId = validId;
  global.currentMeasureCompanyAccount = accountKey;

  // 同步保存到当前会话，供其他云端功能复用
  try {
    global.sessionStorage.setItem('companyId', validId);
    global.sessionStorage.setItem('loginUsername', account);
  } catch (e) {}

  console.log('[云备份] 公司账号识别成功：', {
    username: account,
    companyId: validId
  });

  return validId;
}

    // 固定备份文件路径
    function getMeasureCloudFilePath(companyId) {
      return `shuju/${validateCompanyId(companyId)}/celiang/celiang.json`;
    }

    // 兼容旧版 JSON 包装结构
    function unwrapMeasureProject(value) {

      let item = value;

      if (
        item &&
        item.state &&
        typeof item.state === 'object' &&
        Array.isArray(item.state.walls)
      ) {
        item = item.state;
      }

      if (
        item &&
        item.data &&
        typeof item.data === 'object' &&
        Array.isArray(item.data.walls)
      ) {
        item = item.data;
      }

      if (
        item &&
        item.project &&
        typeof item.project === 'object' &&
        Array.isArray(item.project.walls)
      ) {
        item = item.project;
      }

      return item &&
        typeof item === 'object' &&
        Array.isArray(item.walls)
        ? cloneCloudValue(item)
        : null;
    }

    // 整理云端备份数据
    function normalizeMeasureCloudBackup(raw) {

      let data = raw;

      if (
        data &&
        data.data &&
        typeof data.data === 'object' &&
        !Array.isArray(data.data)
      ) {
        data = data.data;
      }

      if (
        data &&
        data.payload &&
        typeof data.payload === 'object'
      ) {
        data = data.payload;
      }

      if (!data || typeof data !== 'object') {
        throw new Error('云端备份内容不是有效的 JSON 对象');
      }

      let projects = Array.isArray(data.projects)
        ? data.projects.map(unwrapMeasureProject).filter(Boolean)
        : [];

      let currentProject = unwrapMeasureProject(
        data.currentProject ||
        data.activeProject ||
        data.current ||
        data.state ||
        data.project
      );

      if (!currentProject && Array.isArray(data.walls)) {
        currentProject = unwrapMeasureProject(data);
      }

      if (!projects.length && currentProject) {
        projects = [cloneCloudValue(currentProject)];
      }

      if (!currentProject && projects.length) {
        currentProject = projects.slice().sort(
          (a, b) => projectRecordTime(b) - projectRecordTime(a)
        )[0];
      }

      if (!projects.length || !currentProject) {
        throw new Error(
          '云端文件中没有有效的量房图纸（缺少 walls 数组）'
        );
      }

      if (
        !projects.some(item =>
          projectRecordKey(item) &&
          projectRecordKey(item) ===
            projectRecordKey(currentProject)
        )
      ) {
        projects.push(cloneCloudValue(currentProject));
      }

      return {
        projects,
        currentProject,
        backupTime:
          data.backupTime ||
          data.exportedAt ||
          (data.__meta && data.__meta.exportedAt) ||
          ''
      };
    }

    // 统一提示
    async function showMeasureCloudMessage(title, message) {

      if (
        global.LinuoDialog &&
        typeof global.LinuoDialog.show === 'function'
      ) {
        return global.LinuoDialog.show(
          title,
          message,
          [{ label: '知道了', value: true, primary: true }]
        );
      }

      if (typeof global.alert === 'function') {
        global.alert(title + '\n' + message);
      }
    }

    // ==================== 云备份 ====================
    async function cloudBackup() {

      try {

        const companyId = await resolveMeasureCompanyId();
        const filePath = getMeasureCloudFilePath(companyId);

        const now = new Date().toISOString();

        // 当前正在编辑的图纸
        const currentProject = cloneCloudValue(getState());

        if (
          !currentProject ||
          !Array.isArray(currentProject.walls)
        ) {
          throw new Error('当前图纸数据无效，无法备份');
        }

        currentProject.savedAt = now;

        // 当前画布 + 所有本地已保存图纸
        const projects = mergeProjectRecords(
          readLocalProjectRecords(),
          [currentProject]
        );

        const payload = {
          __meta: {
            app: '立诺量房',
            version: 'V0.46',
            schema: 1,
            type: 'measure_cloud_backup',
            companyId,
            account: String(global.currentMeasureAccount || ''),
            exportedAt: now
          },

          backupTime: now,
          currentProject,
          projects
        };

        await writeMeasureCloudJson(filePath, payload);

        try {
          global.localStorage.setItem(
            'lastMeasureCloudBackupTime',
            now
          );
        } catch (error) {}

        if (env.showToast) {
          env.showToast(
            '云备份成功，共备份 ' + projects.length + ' 份图纸'
          );
        }

        await showMeasureCloudMessage(
          '云备份完成',
          `备份位置：${filePath}\n共备份 ${projects.length} 份图纸（包含当前图纸）。`
        );

        return true;

      } catch (error) {

        console.error('[量房云备份] 失败：', error);

        await showMeasureCloudMessage(
          '云备份失败',
          error && error.message ? error.message : String(error)
        );

        return false;
      }
    }

    // ==================== 云恢复 ====================
    async function cloudRestore() {

      try {

        const companyId = await resolveMeasureCompanyId();
        const filePath = getMeasureCloudFilePath(companyId);

        // 下载云端备份
        const raw = await readMeasureCloudJson(filePath);
        const cloud = normalizeMeasureCloudBackup(raw);

        // 显示两种恢复模式
        const mode = global.LinuoDialog
          ? await global.LinuoDialog.show(
              '选择云恢复方式',

              `云端备份：${cloud.projects.length} 份图纸\n` +
              `备份时间：${cloud.backupTime ? new Date(cloud.backupTime).toLocaleString() : '未记录'}\n\n` +
              '合并恢复：保留本地独有图纸，按图纸名称合并；保留当前正在编辑的画布。\n' +
              '覆盖恢复：用云端图纸列表和当前图纸替换本地数据。',

              [
                {
                  label: '合并恢复',
                  value: 'merge',
                  primary: true
                },
                {
                  label: '覆盖恢复',
                  value: 'overwrite'
                },
                {
                  label: '取消',
                  value: 'cancel'
                }
              ]
            )
          : 'merge';

        if (!mode || mode === 'cancel') {
          return false;
        }

        // ---------- 合并恢复 ----------
        if (mode === 'merge') {

          const localRecords = readLocalProjectRecords();
          const localCurrent = cloneCloudValue(getState());

          if (
            localCurrent &&
            Array.isArray(localCurrent.walls)
          ) {
            const existing = localRecords.find(
              item =>
                projectRecordKey(item) ===
                projectRecordKey(localCurrent)
            );

            // 沿用真实保存时间，不虚构最新时间
            if (existing && existing.savedAt) {
              localCurrent.savedAt = existing.savedAt;
            }

            localRecords.push(localCurrent);
          }

          const merged = mergeProjectRecords(
            localRecords,
            cloud.projects
          );

          writeLocalProjectRecords(merged);

          if (env.persist) env.persist();

          if (env.showToast) {
            env.showToast(
              '云恢复合并完成，共 ' + merged.length + ' 份图纸'
            );
          }

          await showMeasureCloudMessage(
            '云恢复完成',
            `合并成功。\n` +
            `本地独有图纸已保留，云端图纸已合并到“打开”列表。\n` +
            `当前正在编辑的画布没有被覆盖。\n` +
            `共 ${merged.length} 份图纸。`
          );

          return true;
        }

        // ---------- 覆盖恢复 ----------
        const replacement = unwrapMeasureProject(
          cloud.currentProject
        );

        if (!replacement) {
          throw new Error('云端备份缺少可恢复的当前图纸');
        }

        // 先保存撤销快照
        if (env.saveUndo) env.saveUndo();

        // 替换全部本地图纸记录
        writeLocalProjectRecords(
          cloud.projects.map(cloneCloudValue)
        );

        // 替换当前画布
        env.setState(replacement);

        if (env.normalizeLegacyItems) {
          env.normalizeLegacyItems();
        }

        if (env.clearWallChain) {
          env.clearWallChain();
        }

        if (env.resetImportInteraction) {
          env.resetImportInteraction();
        }

        if ($('heightInp')) {
          $('heightInp').value = getState().height || 2700;
        }

        if ($('projectNameInp')) {
          $('projectNameInp').value =
            getState().projectName || '未命名图纸';
        }

        if (env.persist) env.persist();
        if (env.closePanel) env.closePanel();
        if (env.fitCanvas) env.fitCanvas();
        if (env.draw) env.draw();

        if (env.showToast) {
          env.showToast('云端数据已覆盖恢复');
        }

        await showMeasureCloudMessage(
          '云恢复完成',
          `覆盖恢复成功。\n已恢复 ${cloud.projects.length} 份图纸，并替换当前画布。`
        );

        return true;

      } catch (error) {

        console.error('[量房云恢复] 失败：', error);

        await showMeasureCloudMessage(
          '云恢复失败',
          error && error.message ? error.message : String(error)
        );

        return false;
      }
    }

    return {
      downloadFileBlob,
      exportDXF,
      exportJSON,
      importJSONData,
      cloudBackup,
      cloudRestore
    };
  }
  global.LinuoOutModule={create};
})(window);


/* ===== 登录模块 ===== */
/* 立诺量房启动登录模块
 * 账号来源：shuju/zhanghao.json
 * 校验方式：账号存在于 builtInUsers 或 PERMISSION_CONFIG.userPermissions 即可
* 本模块保存本地登录信息，当天跳过重复校验，跨天首次打开重新校验。
 */
(() => {
  'use strict';

const ACCOUNT_URL = '/data-api/file_link.php?action=read&file=shuju/zhanghao.json';
const REQUEST_TIMEOUT = 10000;
// ==================================================
// 自动登录管理：每天只进行一次账号校验
// ==================================================

const LOGIN_CACHE_KEY = 'linuo_measure_login_cache_v1';

// 获取本地日期，避免使用UTC日期造成跨日判断偏差
function getLoginDateKey() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 读取自动登录信息
function readLoginCache() {
  try {
    const data = JSON.parse(
      localStorage.getItem(LOGIN_CACHE_KEY) || 'null'
    );

    if (
      !data ||
      typeof data.account !== 'string' ||
      !data.account.trim() ||
      typeof data.password !== 'string' ||
      !data.password
    ) {
      return null;
    }

    return {
      account: data.account.trim(),
      password: data.password,
      verifiedDate: String(data.verifiedDate || '')
    };

  } catch (error) {
    return null;
  }
}

// 保存自动登录信息
function saveLoginCache(
  account,
  password,
  verifiedDate = getLoginDateKey()
) {
  try {
    localStorage.setItem(
      LOGIN_CACHE_KEY,
      JSON.stringify({
        account: String(account).trim(),
        password: String(password),
        verifiedDate
      })
    );

    return true;

  } catch (error) {
    console.warn('[立诺登录] 无法保存自动登录信息：', error);
    return false;
  }
}

// 清除自动登录信息
function clearLoginCache() {
  try {
    localStorage.removeItem(LOGIN_CACHE_KEY);
  } catch (error) {}
}

// 启动时读取上一次登录信息
const savedLogin = readLoginCache();
  // 内置测试账号设置
  const CESHI_ACCOUNT = 'ceshi';
  const CESHI_PASSWORD = '123';
  const CESHI_LIMIT = 30;
  const CESHI_COUNT_KEY = 'linuo_ceshi_success_login_count_v1';

  // 读取测试账号已成功登录次数
  function getCeshiUsedCount() {
    try {
      const raw = localStorage.getItem(CESHI_COUNT_KEY);
      if (raw === null || raw === '') return 0;
      const count = Number(raw);
      return Number.isSafeInteger(count) && count >= 0 ? count : null;
    } catch (error) {
      return null;
    }
  }

  // 保存测试账号使用次数
  function saveCeshiUsedCount(count) {
    try {
      localStorage.setItem(CESHI_COUNT_KEY, String(count));
      return true;
    } catch (error) {
      return false;
    }
  }
  let authenticated = false;
  let busy = false;
  const lockedElements = new Map();

  const style = document.createElement('style');
  style.textContent = `
    body.linuo-login-open{overflow:hidden!important}
    #linuoLoginGate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:28px;background:radial-gradient(circle at 15% 20%,rgba(58,142,224,.28),transparent 34%),radial-gradient(circle at 85% 80%,rgba(41,104,175,.34),transparent 35%),linear-gradient(135deg,#0b1830 0%,#102b50 52%,#173e68 100%);color:#172b46;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;overflow:auto}
    #linuoLoginGate *{box-sizing:border-box}
    #linuoLoginGate:before{content:"";position:absolute;inset:0;opacity:.12;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.24) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.24) 1px,transparent 1px);background-size:36px 36px;mask-image:linear-gradient(90deg,transparent,#000 22%,#000 85%,transparent)}
    #linuoLoginGate .lg-shell{position:relative;width:min(390px,100%);min-height:0;display:block;border:1px solid rgba(255,255,255,.24);border-radius:22px;overflow:hidden;background:#fff;box-shadow:0 22px 70px rgba(0,0,0,.28)}
    #linuoLoginGate .lg-intro{display:none}
    #linuoLoginGate .lg-brand{display:flex;align-items:center;gap:12px;font-weight:700;letter-spacing:.5px}
    #linuoLoginGate .lg-mark{width:42px;height:42px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.42);border-radius:13px;background:rgba(255,255,255,.12);box-shadow:inset 0 1px rgba(255,255,255,.25)}
    #linuoLoginGate .lg-mark svg{width:25px;height:25px}
    #linuoLoginGate .lg-brand small{display:block;margin-top:3px;color:rgba(255,255,255,.68);font-size:10px;font-weight:500;letter-spacing:1.6px}
    #linuoLoginGate .lg-copy{position:relative;z-index:1;margin:50px 0 34px}
    #linuoLoginGate .lg-kicker{margin:0 0 16px;color:#8fc7ff;font-size:11px;font-weight:700;letter-spacing:2.6px}
    #linuoLoginGate .lg-copy h1{margin:0;color:#fff;font-size:clamp(30px,4vw,46px);font-weight:750;line-height:1.28;letter-spacing:1px}
    #linuoLoginGate .lg-copy h1 span{color:#8fc7ff}
    #linuoLoginGate .lg-copy p{max-width:390px;margin:18px 0 0;color:rgba(255,255,255,.72);font-size:14px;line-height:1.9}
    #linuoLoginGate .lg-tags{display:flex;flex-wrap:wrap;gap:9px;margin-top:26px}
    #linuoLoginGate .lg-tags span{padding:8px 12px;border:1px solid rgba(255,255,255,.2);border-radius:20px;background:rgba(255,255,255,.08);color:#e3f1ff;font-size:12px}
    #linuoLoginGate .lg-blueprint{position:absolute;right:-2px;bottom:24px;width:270px;height:190px;opacity:.2;pointer-events:none}
    #linuoLoginGate .lg-foot{color:rgba(255,255,255,.52);font-size:11px;letter-spacing:.5px}
    #linuoLoginGate .lg-panel{display:flex;align-items:center;justify-content:center;padding:30px 25px;background:#fff}
    #linuoLoginGate .lg-card{width:100%;max-width:360px}
    #linuoLoginGate .lg-welcome{margin:0 0 9px;color:#397fc5;font-size:10px;font-weight:800;letter-spacing:2.2px}
    #linuoLoginGate .lg-card h2{margin:0;color:#172c49;font-size:27px;font-weight:750;letter-spacing:.5px}
    #linuoLoginGate .lg-desc{margin:10px 0 29px;color:#8290a3;font-size:13px;line-height:1.7}
    #linuoLoginGate .lg-label{display:block;margin-bottom:9px;color:#354b66;font-size:13px;font-weight:650}
    #linuoLoginGate .lg-input-wrap{position:relative}
    #linuoLoginGate .lg-input-wrap svg{position:absolute;left:15px;top:50%;width:18px;height:18px;transform:translateY(-50%);color:#8b9bb0;pointer-events:none}
    #linuoLoginGate input{width:100%;height:52px;padding:0 15px 0 44px;border:1px solid #dce5ef;border-radius:12px;outline:none;background:#fff;color:#1d3553;font-size:15px;transition:border-color .18s,box-shadow .18s}
    #linuoLoginGate input:focus{border-color:#438bd1;box-shadow:0 0 0 4px rgba(55,132,207,.12)}
    #linuoLoginGate input::placeholder{color:#aab6c5}
    #linuoLoginGate .lg-submit{width:100%;height:52px;margin-top:20px;border:0;border-radius:12px;background:linear-gradient(110deg,#2877c8,#3d96e5);box-shadow:0 8px 18px rgba(43,120,197,.22);color:#fff;font-size:15px;font-weight:700;letter-spacing:1px;cursor:pointer;transition:transform .15s,filter .15s}
    #linuoLoginGate .lg-submit:hover{filter:brightness(1.05);transform:translateY(-1px)}
    #linuoLoginGate .lg-submit:disabled{opacity:.65;cursor:wait;transform:none}
    #linuoLoginGate .lg-status{min-height:24px;margin-top:13px;color:#718197;font-size:12px;line-height:1.6;text-align:center}
    #linuoLoginGate .lg-status.error{color:#d44b54}
    #linuoLoginGate .lg-status.success{color:#19845a}
    #linuoLoginGate .lg-note{margin-top:25px;padding:12px 13px;border:1px solid #e4ebf3;border-radius:10px;background:#f4f7fb;color:#8997a8;font-size:11px;line-height:1.7;text-align:center}
    #linuoLoginGate .lg-copyline{margin-top:24px;color:#a0adbd;font-size:11px;text-align:center}
    #linuoLoginGate.lg-leaving{opacity:0;transform:scale(1.015);transition:opacity .24s,transform .24s;pointer-events:none}
    @media(max-width:760px){#linuoLoginGate{padding:18px}#linuoLoginGate .lg-shell{width:min(390px,100%);min-height:0;display:block;border-radius:18px}#linuoLoginGate .lg-panel{padding:28px 22px}#linuoLoginGate .lg-desc{margin-bottom:20px}#linuoLoginGate .lg-card h2{font-size:23px}}
    @media(max-height:650px) and (min-width:761px){#linuoLoginGate{padding:12px}#linuoLoginGate .lg-shell{min-height:500px}#linuoLoginGate .lg-intro{padding:28px 36px}#linuoLoginGate .lg-panel{padding:25px}}
	    /* =========================================
       立诺登录界面新版排版
       电脑端左右分栏，手机端上下布局
    ========================================= */

    #linuoLoginGate .lg-shell{
      width:min(820px,100%);
      min-height:500px;
      display:grid;
      grid-template-columns:minmax(0,.95fr) minmax(0,1.05fr);
    }

    /* 左侧软件介绍区域 */
    #linuoLoginGate .lg-intro{
      display:flex;
      position:relative;
      flex-direction:column;
      justify-content:space-between;
      min-width:0;
      padding:38px 34px;
      overflow:hidden;
      background:linear-gradient(145deg,#102b4b 0%,#1c5684 100%);
    }

    #linuoLoginGate .lg-brand{
      position:relative;
      z-index:1;
    }

    #linuoLoginGate .lg-copy{
      margin:34px 0 24px;
    }

    #linuoLoginGate .lg-copy h1{
      font-size:clamp(28px,3.2vw,40px);
    }

    #linuoLoginGate .lg-foot{
      position:relative;
      z-index:1;
    }

    #linuoLoginGate .lg-blueprint{
      right:-8px;
      bottom:16px;
      width:220px;
      height:auto;
      opacity:.16;
    }

    /* 右侧登录区域 */
    #linuoLoginGate .lg-panel{
      padding:42px 44px;
    }

    #linuoLoginGate .lg-card{
      max-width:340px;
    }

    #linuoLoginGate .lg-card h2{
      margin:0 0 25px;
      font-size:26px;
    }

    #linuoLoginGate .lg-label{
      margin-bottom:8px;
    }

    #linuoLoginGate .lg-note{
      margin-top:24px;
    }

    /* 手机端布局 */
    @media(max-width:760px){

      #linuoLoginGate{
        padding:14px;
      }

      #linuoLoginGate .lg-shell{
        width:min(460px,100%);
        min-height:0;
        display:grid;
        grid-template-columns:1fr;
        border-radius:18px;
      }

      #linuoLoginGate .lg-intro{
        padding:20px 22px 18px;
        min-height:0;
      }

      #linuoLoginGate .lg-mark{
        width:38px;
        height:38px;
      }

      #linuoLoginGate .lg-copy{
        margin:16px 0 0;
      }

      #linuoLoginGate .lg-kicker{
        margin:0 0 8px;
        font-size:9px;
        letter-spacing:1.6px;
      }

      #linuoLoginGate .lg-copy h1{
        font-size:24px;
        line-height:1.2;
      }

      #linuoLoginGate .lg-copy p{
        display:none;
      }

      #linuoLoginGate .lg-tags{
        margin-top:12px;
        gap:6px;
      }

      #linuoLoginGate .lg-tags span{
        padding:6px 9px;
        font-size:10px;
      }

      #linuoLoginGate .lg-blueprint{
        right:-6px;
        bottom:-4px;
        width:150px;
        opacity:.1;
      }

      #linuoLoginGate .lg-foot{
        display:none;
      }

      #linuoLoginGate .lg-panel{
        padding:25px 22px 27px;
      }

      #linuoLoginGate .lg-card h2{
        font-size:23px;
        margin-bottom:18px;
      }

      #linuoLoginGate .lg-input-wrap input{
        height:48px;
      }

      #linuoLoginGate .lg-submit{
        height:48px;
        margin-top:17px;
      }

      #linuoLoginGate .lg-note{
        margin-top:18px;
        padding:10px;
      }
    }

    /* 电脑小屏幕高度适配 */
    @media(max-height:700px) and (min-width:761px){

      #linuoLoginGate{
        padding:10px;
      }

      #linuoLoginGate .lg-shell{
        min-height:460px;
      }

      #linuoLoginGate .lg-intro{
        padding-top:28px;
        padding-bottom:28px;
      }

      #linuoLoginGate .lg-panel{
        padding-top:24px;
        padding-bottom:24px;
      }
    }
    /* 简洁登录版：单卡片布局，减少装饰与信息干扰 */
    #linuoLoginGate{padding:18px;background:linear-gradient(145deg,#edf3fa,#dfe8f3);color:#20334c}
    #linuoLoginGate:before{display:none}
    #linuoLoginGate .lg-shell{width:min(390px,100%);min-height:0;display:block;border:1px solid #e2e9f1;border-radius:18px;box-shadow:0 18px 50px rgba(31,55,85,.16)}
    #linuoLoginGate .lg-intro{display:none}
    #linuoLoginGate .lg-panel{padding:30px 26px;background:#fff}
    #linuoLoginGate .lg-card{max-width:none}
    #linuoLoginGate .lg-welcome{font-size:11px;letter-spacing:1.4px}
    #linuoLoginGate .lg-card h2{font-size:25px;margin:0 0 10px}
    #linuoLoginGate .lg-desc{margin:0 0 23px;color:#8290a3}
    #linuoLoginGate .lg-note{margin-top:18px}
    #linuoLoginGate .lg-copyline{margin-top:16px}
    @media(max-width:760px){#linuoLoginGate .lg-shell{width:min(390px,100%);display:block}#linuoLoginGate .lg-panel{padding:27px 22px}}
    /* 本轮微调：标题与输入区拉开距离，联系方式保持紧凑 */
    #linuoLoginGate .lg-card h2{margin:0 0 22px!important}
    #linuoLoginGate .lg-desc{margin:0 0 24px!important}
    #linuoLoginGate .lg-note{margin-top:10px!important;padding:7px 10px!important;font-size:10px!important;line-height:1.45!important}
    #linuoLoginGate .lg-copyline{margin-top:8px!important}
    #linuoLoginGate .lg-status{margin-top:9px!important;min-height:20px!important}
  `;
  document.head.appendChild(style);

  const gate = document.createElement('section');
  gate.id = 'linuoLoginGate';
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'linuoLoginTitle');
  gate.innerHTML = `
    <div class="lg-shell">
      <section class="lg-intro">
        <div class="lg-brand">
          <div class="lg-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20V4h18v16H3Z"/><path d="M3 12h7v8M10 4v5h6V4M16 9v5h5M10 14h6v6"/><path d="M6 7h1M6 16h1"/></svg></div>
          <div>立诺装饰设计<small>LINUO · SMART MEASURE</small></div>
        </div>
        <div class="lg-copy">
          <p class="lg-kicker">PROFESSIONAL FIELD TOOL</p>
          <h1>让每一次量房<br><span>更精准、更高效</span></h1>
          <p>从现场测量到户型绘制，再到照片尺寸标记，让测量记录与设计工作自然衔接。</p>
          <div class="lg-tags"><span>户型绘制</span><span>尺寸标注</span><span>图片标记</span><span>数据管理</span></div>
        </div>
        <svg class="lg-blueprint" viewBox="0 0 270 190" fill="none" stroke="white" stroke-width="1.5"><path d="M8 8h110v72H8zM118 8h92v48h-92zM210 8h52v122h-52zM8 80h65v95H8zM73 80h85v48H73zM158 56h52v119h-52zM73 128h85v47H73zM118 8v28h-30M210 56h-28v24M158 128h32M40 80V55h30M8 36h18M230 130v24h-20"/><path d="M29 8v72M73 104h85M118 36h40M210 80h52" stroke-dasharray="4 5"/></svg>
        <div class="lg-foot">让量房更简单 · 让设计更高效</div>
      </section>
      <section class="lg-panel">
        <div class="lg-card">
          
          <h2 id="linuoLoginTitle">立诺量房工具</h2>
          
          <form id="linuoLoginForm" autocomplete="on">
            <label class="lg-label" for="linuoLoginAccount">授权账号</label>
            <div class="lg-input-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
              <input id="linuoLoginAccount" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="请输入账号" maxlength="80" required>
            </div>
            <label class="lg-label" for="linuoLoginPassword" style="margin-top:15px;">登录密码</label>
            <div class="lg-input-wrap">
              <input id="linuoLoginPassword" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" maxlength="120" required>
            </div>
            <button class="lg-submit" id="linuoLoginSubmit" type="submit">登录</button>
            <div class="lg-status" id="linuoLoginStatus" role="status" aria-live="polite">等待输入账号和密码</div>
          </form>
          <div class="lg-note">联系方式：15662061321</div>
        </div>
      </section>
    </div>`;

document.body.prepend(gate);

// 有历史登录信息时，先隐藏登录框
// 后台完成每日校验，失败时再显示
if (savedLogin) {
  gate.style.visibility = 'hidden';
}

document.body.classList.add('linuo-login-open');

  function lockElement(element) {
    if (!(element instanceof HTMLElement) || element === gate || element.tagName === 'SCRIPT' || lockedElements.has(element)) return;
    lockedElements.set(element, {
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden')
    });
    element.inert = true;
    element.setAttribute('aria-hidden', 'true');
  }

  Array.from(document.body.children).forEach(lockElement);
  const bodyObserver = new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => lockElement(node));
    }
  });
  bodyObserver.observe(document.body, { childList: true });

  const form = gate.querySelector('#linuoLoginForm');
  const accountInput = gate.querySelector('#linuoLoginAccount');
  const passwordInput = gate.querySelector('#linuoLoginPassword');
  const submitButton = gate.querySelector('#linuoLoginSubmit');
  const status = gate.querySelector('#linuoLoginStatus');

  // 不拦截 document 捕获阶段的键盘/触摸事件，避免夸克等内置浏览器阻断输入框。
  // 先获取元素再绑定事件，兼容不支持部分新式输入事件的内置浏览器。
  [accountInput, passwordInput].forEach(input => {
    if (!input) return;
    input.disabled = false;
    input.readOnly = false;
    input.removeAttribute('readonly');
    input.removeAttribute('disabled');
    input.addEventListener('pointerdown', () => { input.focus(); });
    input.addEventListener('click', () => { input.focus(); });
  });

  function credentialMatches(data, account, password) {
    if (!data || typeof data !== 'object') return false;
    const passFields = ['password', 'pass', 'pwd', 'loginPassword'];
    const nameFields = ['username', 'account', 'user', 'userName', 'loginName', 'login', 'uid', 'userId', 'id'];
    const visited = new Set();

    function inspect(value, depth = 0) {
      if (!value || typeof value !== 'object' || depth > 8 || visited.has(value)) return false;
      visited.add(value);

      if (Array.isArray(value)) return value.some(item => inspect(item, depth + 1));

      const nameOk = nameFields.some(key => value[key] !== undefined && String(value[key]).trim() === account);
      const passKey = passFields.find(key => value[key] !== undefined);
      if (nameOk && passKey && String(value[passKey]) === password) return true;

      // 兼容以账号为键的对象，例如：{"账号": "密码"} 或 {"账号": {"password":"密码"}}
      if (Object.prototype.hasOwnProperty.call(value, account)) {
        const entry = value[account];
        if ((typeof entry === 'string' || typeof entry === 'number') && String(entry) === password) return true;
        if (entry && typeof entry === 'object') {
          const key = passFields.find(k => entry[k] !== undefined);
          if (key && String(entry[key]) === password) return true;
          if (inspect(entry, depth + 1)) return true;
        }
      }

      // 兼容云端接口将账号列表包在 data、result、users 等字段中的情况。
      return Object.values(value).some(item => inspect(item, depth + 1));
    }

    return inspect(data);
  }

  function setStatus(message, type = '') {
    status.textContent = message;
    status.className = 'lg-status' + (type ? ' ' + type : '');
  }

  function unlock(account) {
    authenticated = true;
    busy = false;
    bodyObserver.disconnect();
    lockedElements.forEach((previous, element) => {
      element.inert = previous.inert;
      if (previous.ariaHidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', previous.ariaHidden);
    });
    lockedElements.clear();
    document.body.classList.remove('linuo-login-open');
    window.currentMeasureAccount = account;
    window.dispatchEvent(new CustomEvent('linuo:login', { detail: { account } }));
    gate.classList.add('lg-leaving');
    window.setTimeout(() => gate.remove(), 260);
  }

  async function verifyAccount(account, password) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(ACCOUNT_URL, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`账号服务器响应异常（${response.status}）`);
      const data = await response.json();
      return credentialMatches(data, account, password);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
  // ==================================================
// 自动登录校验
// ==================================================

// 跨天后重新验证保存的账号
async function verifySavedLogin(account, password) {

  // admin 保留原有本地备用账号规则
  if (account === 'admin') {
    return password === '888418';
  }

  // 测试账号保留原有授权及30次限制
  if (account === CESHI_ACCOUNT) {

    if (password !== CESHI_PASSWORD) return false;

    const licenseApi = window.LinuoLicense;

    if (
      !licenseApi ||
      typeof licenseApi.init !== 'function' ||
      typeof licenseApi.getStatus !== 'function'
    ) {
      throw new Error('无法读取软件授权状态，测试账号暂不可用');
    }

    await licenseApi.init();

    const licenseStatus = licenseApi.getStatus();

    if (!licenseStatus || licenseStatus.activated !== true) {
      throw new Error('测试账号仅在软件已激活正式授权时可用，请先完成软件授权');
    }

    const usedCount = getCeshiUsedCount();

    if (usedCount === null) {
      throw new Error('无法读取测试账号使用次数，请检查浏览器存储权限');
    }

    if (usedCount >= CESHI_LIMIT) {
      return false;
    }

    if (!saveCeshiUsedCount(usedCount + 1)) {
      throw new Error('无法保存测试账号使用次数，请检查浏览器存储权限');
    }

    return true;
  }

  // 普通账号仍然使用原来的云端账号验证
  return await verifyAccount(account, password);
}


// ==================================================
// 自动登录入口
// ==================================================

async function tryAutoLogin() {

  if (!savedLogin) return;

  busy = true;

  try {

    const today = getLoginDateKey();

    // 只有日期发生变化时才重新进行账号验证
    if (savedLogin.verifiedDate !== today) {

      const valid = await verifySavedLogin(
        savedLogin.account,
        savedLogin.password
      );

      if (!valid) {

        clearLoginCache();

        throw new Error('保存的账号已失效或密码已修改，请重新登录');
      }

      // 更新本次校验日期
      saveLoginCache(
        savedLogin.account,
        savedLogin.password,
        today
      );
    }

    // 当前自动登录在 DOMContentLoaded 后启动
    // 确保 app.js 已经完成登录事件监听绑定
    unlock(savedLogin.account);

  } catch (error) {

    console.error('[立诺登录] 自动登录检查失败：', error);

    busy = false;

    // 自动登录失败，重新显示登录界面
    gate.style.visibility = 'visible';

    submitButton.disabled = false;
    submitButton.textContent = '登录并开始使用';

    accountInput.value = savedLogin.account;

    const message = error && error.name === 'AbortError'
      ? '自动登录检查超时，请检查网络后手动登录'
      : (error.message || '自动登录检查失败，请输入账号和密码重新登录');

    setStatus(message, 'error');

    accountInput.focus({ preventScroll: true });
  }
}

  const handleLoginSubmit = async event => {
    event.preventDefault();
    if (busy || authenticated) return;
    const account = accountInput.value.trim();
    const password = passwordInput.value;
    if (!account || !password) {
      setStatus('请输入账号和密码', 'error');
      (!account ? accountInput : passwordInput).focus();
      return;
    }

    busy = true;
    submitButton.disabled = true;
    submitButton.textContent = '正在验证账号…';
        setStatus(
      account === 'admin'
        ? '正在验证本地备用账号'
        : account === CESHI_ACCOUNT
          ? '正在验证本地测试账号'
          : '正在读取云端授权名单，请稍候'
    );

    try {
      // admin 保持原有本地应急规则，不依赖网络，也不检查软件授权。
      const isLocalAdmin = account === 'admin' && password === '888418';

      const isCeshiAccount = account === CESHI_ACCOUNT;
      const isLocalCeshi = isCeshiAccount && password === CESHI_PASSWORD;

      let exists = false;
      let ceshiUsedCount = 0;

      // 一、admin：始终按照原来的本地账号方式验证
      if (isLocalAdmin) {
        exists = true;
      }

      // 二、ceshi：本地验证，限制30次
      else if (isCeshiAccount) {

        // 密码错误时不再尝试云端验证
        if (!isLocalCeshi) {
          setStatus('测试账号密码不正确', 'error');
          busy = false;
          submitButton.disabled = false;
          submitButton.textContent = '登录并开始使用';
          accountInput.focus();
          accountInput.select();
          return;
        }

        // 必须先检查本机软件授权状态
        const licenseApi = window.LinuoLicense;

        if (
          !licenseApi ||
          typeof licenseApi.init !== 'function' ||
          typeof licenseApi.getStatus !== 'function'
        ) {
          setStatus('无法读取软件授权状态，测试账号暂不可用', 'error');
          busy = false;
          submitButton.disabled = false;
          submitButton.textContent = '重新验证';
          return;
        }

        await licenseApi.init();

        const licenseStatus = licenseApi.getStatus();

        // 没有正式激活软件授权，不允许使用 ceshi
        if (!licenseStatus || licenseStatus.activated !== true) {
          setStatus('测试账号仅在软件已激活正式授权时可用，请先完成软件授权', 'error');
          busy = false;
          submitButton.disabled = false;
          submitButton.textContent = '重新验证';
          return;
        }

        // 读取已经使用的次数
        ceshiUsedCount = getCeshiUsedCount();

        if (ceshiUsedCount === null) {
          setStatus('无法读取测试账号使用次数，请检查浏览器存储权限', 'error');
          busy = false;
          submitButton.disabled = false;
          submitButton.textContent = '重新验证';
          return;
        }

        // 达到30次后禁止继续登录
        if (ceshiUsedCount >= CESHI_LIMIT) {
          setStatus('测试账号的 30 次使用次数已全部用完', 'error');
          busy = false;
          submitButton.disabled = false;
          submitButton.textContent = '登录并开始使用';
          return;
        }

        exists = true;
      }

      // 三、其它普通账号：继续使用原来的云端验证
      else {
        exists = await verifyAccount(account, password);
      }

      // 四、验证成功
      if (exists) {

        // ceshi 每次成功登录，使用次数增加1
        if (isLocalCeshi) {
          const nextCount = ceshiUsedCount + 1;

          if (!saveCeshiUsedCount(nextCount)) {
            setStatus('无法保存测试账号使用次数，本次登录已取消', 'error');
            busy = false;
            submitButton.disabled = false;
            submitButton.textContent = '重新验证';
            return;
          }

          setStatus(
            `验证通过，测试账号已使用 ${nextCount}/${CESHI_LIMIT} 次，正在进入量房工具`,
            'success'
          );
        } else {
          setStatus('验证通过，正在进入量房工具', 'success');
        }

// 保存本次成功登录信息
// 当天再次打开不重复校验，次日重新校验一次
saveLoginCache(
  account,
  password,
  getLoginDateKey()
);

submitButton.textContent = '登录成功';

window.setTimeout(() => unlock(account), 350);
      } else {
        setStatus('账号不存在或尚未授权，请核对后重试', 'error');
        busy = false;
        submitButton.disabled = false;
        submitButton.textContent = '登录并开始使用';
        accountInput.focus();
        accountInput.select();
      }

    } catch (error) {
      console.error('[立诺登录] 账号校验失败：', error);

      const message = error && error.name === 'AbortError'
        ? '连接账号服务器超时，请检查网络后重试'
        : account === CESHI_ACCOUNT
          ? '测试账号授权状态检查失败，请稍后重试'
          : '暂时无法读取云端账号，请检查网络后重试';

      setStatus(message, 'error');
      busy = false;
      submitButton.disabled = false;
      submitButton.textContent = '重新验证';
    }
  };
  submitButton.addEventListener('click', event => {
    event.preventDefault();
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else handleLoginSubmit({ preventDefault(){}, submitter:submitButton });
  });
  form.addEventListener('submit', handleLoginSubmit);
// 页面首次显示时的输入框处理
window.addEventListener('pageshow', () => {
  if (!authenticated && !savedLogin) {
    accountInput.focus({ preventScroll: true });
  }
}, { once: true });

// 判断是否存在历史登录记录
if (savedLogin) {

  // 恢复账号
  accountInput.value = savedLogin.account;

  // 等待所有 defer 脚本加载完毕后再自动登录
  // 确保 app.js 能正常接收到 linuo:login 事件
  document.addEventListener(
    'DOMContentLoaded',
    () => tryAutoLogin(),
    { once: true }
  );

} else {

  // 第一次使用，正常显示登录界面
  window.setTimeout(
    () => accountInput.focus({ preventScroll: true }),
    80
  );

}
})();


/* ===== 授权模块 ===== */
(()=>{
'use strict';
const FREE_LIMIT=200;
const SECRET='Linuo-Measure-License-Key-V046-Internal-2026-Replace-Before-Commercial-Release';
const COUNT_KEY='linuo_license_launch_count_v1';
const INSTALL_KEY='linuo_license_install_id_v1';
const CODE_KEY='linuo_license_code_v1';
let state={machineCode:'',activated:false,remaining:FREE_LIMIT,launches:0,version:'V0.46'};
const $=id=>document.getElementById(id);
function hex(buf){return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase()}
async function digest(text){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))}
function installId(){let v=localStorage.getItem(INSTALL_KEY);if(!v){const a=new Uint8Array(16);crypto.getRandomValues(a);v=[...a].map(x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem(INSTALL_KEY,v)}return v}
async function machineCode(){const ua=navigator.userAgent||'',platform=navigator.userAgentData?.platform||navigator.platform||'',screenInfo=[screen.width,screen.height,screen.colorDepth,devicePixelRatio||1].join('x'),hardware=[navigator.hardwareConcurrency||0,navigator.deviceMemory||0,navigator.maxTouchPoints||0].join('-');return (await digest([installId(),ua,platform,screenInfo,hardware].join('|'))).slice(0,24)}
async function sign(code){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(code))).slice(0,32)}
async function verify(code,machine){const expected='LN1-'+await sign(machine);return String(code||'').trim().toUpperCase()===expected}
function showGate(message){
 const gate=$('licenseGate');if(!gate)return false;
 // 授权层固定挂到 body 顶层，避免被设置面板/图片标记页的层叠上下文遮挡。
 if(gate.parentElement!==document.body)document.body.appendChild(gate);
 const canClose=!message; // 仅从管理设置主动打开的授权信息窗口可关闭；试用到期锁定窗口不可关闭。
 gate.hidden=false;gate.style.display='flex';gate.style.visibility='visible';gate.style.pointerEvents='auto';gate.style.zIndex='2147483000';
 gate.innerHTML=`<div class="license-card" style="position:relative">${canClose?'<button type="button" id="closeLicenseGate" aria-label="关闭" style="position:absolute;right:10px;top:8px;width:30px;height:30px;border:0;border-radius:8px;background:#edf2f8;color:#34445d;font-size:22px;line-height:1;cursor:pointer">×</button>':''}<h2>立诺量房 · 软件授权</h2><p>${message||'免费试用次数已用完，请联系软件作者获取授权码。'}</p><b style="font-size:12px">本设备机器码</b><div class="license-machine" id="licenseMachineText"></div><button type="button" id="copyMachine">复制机器码</button><input id="licenseCodeInput" autocomplete="off" autocapitalize="characters" placeholder="请输入授权码"><button class="primary" type="button" id="activateLicense">验证并激活</button><p id="licenseError" style="color:#dc2626"></p></div>`;
 $('licenseMachineText').textContent=state.machineCode||'正在生成本设备机器码…';
 if(canClose)$('closeLicenseGate').onclick=()=>{gate.hidden=true;gate.style.display='none';};
 $('copyMachine').onclick=()=>{const value=state.machineCode||'';if(!value){$('licenseError').textContent='机器码尚未生成，请使用 HTTPS 安全网页环境后重试';return;}if(navigator.clipboard?.writeText){navigator.clipboard.writeText(value).then(()=>{$('licenseError').style.color='#15803d';$('licenseError').textContent='机器码已复制'}).catch(()=>{$('licenseError').textContent='请长按机器码复制'});}else{$('licenseError').textContent='请长按机器码复制';}};
 $('activateLicense').onclick=async()=>{const v=$('licenseCodeInput').value.trim();try{if(!state.machineCode)throw new Error('当前浏览器无法生成安全机器码，请通过 HTTPS 打开程序后重试');if(await verify(v,state.machineCode)){localStorage.setItem(CODE_KEY,v.toUpperCase());state.activated=true;gate.hidden=true;gate.style.display='none';renderStatus();}else{$('licenseError').textContent='授权码不正确，或不是本设备的授权码';}}catch(err){$('licenseError').textContent=err.message||'授权验证失败，请稍后重试';}};
 return true;
}
function renderStatus(){const el=document.querySelector('[data-license-status]');if(el)el.textContent=state.activated?'永久授权已激活':`试用剩余 ${state.remaining} 次`;}
async function init(){
 try{
  state.machineCode=await machineCode();
}catch(e){

  // 无法生成机器码时，静默跳过授权检测
  // 不弹窗、不提醒、不累计启动次数
  state.machineCode='';
  state.skipLicense=true;
  state.remaining=FREE_LIMIT;

  // 清空授权状态提示
  const statusEl=document.querySelector('[data-license-status]');
  if(statusEl)statusEl.textContent='';

  return;
}
 const stored=localStorage.getItem(CODE_KEY);if(stored&&await verify(stored,state.machineCode)){state.activated=true;state.remaining=0;}
 let launches=Number(localStorage.getItem(COUNT_KEY)||'0');if(!Number.isFinite(launches)||launches<0)launches=0;
 state.launches=launches;
 if(!state.activated){if(launches<FREE_LIMIT){launches++;localStorage.setItem(COUNT_KEY,String(launches));state.launches=launches;state.remaining=FREE_LIMIT-launches;}else{state.remaining=0;showGate('免费启动次数已达到200次。请输入与本设备机器码绑定的授权码后继续使用。');}}
 renderStatus();
}
let licenseInitPromise=null;
window.LinuoLicense={
 getStatus:()=>({...state}),
 showActivation:()=>{try{showGate();if(!state.machineCode){const el=$('licenseMachineText');if(el)el.textContent='正在生成本设备机器码…';if(!licenseInitPromise)licenseInitPromise=init();licenseInitPromise.then(()=>{const target=$('licenseMachineText');if(target)target.textContent=state.machineCode||(state.skipLicense?'当前浏览器不支持安全机器码生成，请通过 HTTPS 打开程序':'机器码生成失败');}).catch(err=>{const target=$('licenseMachineText');if(target)target.textContent='机器码生成失败：'+(err.message||'未知错误');});}}catch(err){console.error('[授权信息] 打开失败',err);const gate=$('licenseGate');if(gate){gate.hidden=false;gate.style.display='flex';gate.textContent='授权信息打开失败：'+(err.message||'未知错误');}}},
 init:()=>licenseInitPromise||(licenseInitPromise=init())
};
licenseInitPromise=init();
})();
