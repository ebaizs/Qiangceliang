
(()=>{
const ScribeEngine=window.LinuoScribe;
if(!ScribeEngine) throw new Error('后台计算模块 Scribe.js 未加载');
const $=id=>document.getElementById(id),cv=$('board'),ctx=cv.getContext('2d'),work=$('work'),KEY='linuo_measure_v3';
/* 数值按 5mm 取整：966→965，1018→1020 */
function snap5(v){ return ScribeEngine.snap5(v); }
let S={walls:[],items:[],texts:[],measures:[],height:2700,defaultWallThick:220,wallThicknessDefaultUpgraded:true,lastInputs:{},btService:'3ab10100-f831-4395-b29d-570977d5bf94',btChar:'3ab10101-f831-4395-b29d-570977d5bf94',btDeviceId:null,projectName:'立诺量房项目', roomNames:{}},tool='wall',scale=.12,fitBaseScale=.12,origin={x:0,y:0},W=0,H=0,dpr=1;let mandatorySetupLock=false;
let draft=null,chain=null,chainTimer=null,dragItem=null,dragWallEndpoint=null,undoStack=[],redoStack=[],selectedWall=-1,pending=null,pointers=new Map(),pan=null,pinch=null;
let editWallIndex=-1,editEnd=null;
let preview=null;
let routePreview=null;
let routePlanStart=null;
let initialCanvasSized=false;
let tapEntryDoor=false;
let drawingRoomLoopsCache;
let measureA=null, measurePreview=null, measureDown=null;
let selectedText=-1;
let pointEditIndex=-1; // 当前编辑的点状构件索引
let tapEditItem=null; // 已锁定构件的单击待编辑状态

// 删除构件时按对象本身重新定位活动索引，避免数组前移后误操作其它构件。
function removeItemAt(index){
  if(!Array.isArray(S.items)||!Number.isInteger(index)||index<0||index>=S.items.length)return null;
  const activePointItem=pointEditIndex>=0?S.items[pointEditIndex]:null;
  const activeTapItem=tapEditItem&&Number.isInteger(tapEditItem.index)?S.items[tapEditItem.index]:null;
  const removed=S.items.splice(index,1)[0];
  // 删除构件只移除构件对象；若旧版本曾把宿主墙拆段，则在构件解除附着后合并可安全复原的共线墙段。
  if(typeof mergeCollinearWalls==='function')mergeCollinearWalls();
  pointEditIndex=activePointItem?S.items.indexOf(activePointItem):-1;
  if(tapEditItem){
    const nextIndex=activeTapItem?S.items.indexOf(activeTapItem):-1;
    tapEditItem=nextIndex>=0?{...tapEditItem,index:nextIndex}:null;
  }
  return removed;
}
let snapHint=null;
let longPressTimer=null;
let autoSelectTimer=null;
function scheduleAutoSelect(){
  clearTimeout(autoSelectTimer);
// 已取消绘制完成后自动切换选择模式
if(autoSelectTimer){
  clearTimeout(autoSelectTimer);
  autoSelectTimer=null;
}
}
let longPressStartP=null;
let longPressTriggered=false;
let lastDownTime=0;
let lastDownP={x:0,y:0};
// 手机端下拉刷新/边缘返回手势保护状态
let gestureGuardStart=null;
let gestureGuardCount=0;
let gestureGuardResetTimer=null;
let gestureGuardAllowUntil=0;

const types={opening:'门洞',window:'窗',bay:'飘窗',powerBox:'强电箱',weakBox:'弱电箱',special:'特殊标识'};
function normalizeLegacyItems(){
  if(!Array.isArray(S.items)) S.items=[];
  S.items.forEach(it=>{
    if(['door','sliding'].includes(it.type)) it.type='opening';
    if(it.type==='opening'){
      it.label='门洞';
      if(!Number(it.height)) it.height=2100;
      if(!it.frameThick) it.frameThick=it.wall!=null&&S.walls[it.wall]?(S.walls[it.wall].thick||S.defaultWallThick||220):(S.defaultWallThick||220);
    }
    if(it.type==='window'||it.type==='special'){
      it.label='窗';
      if(!it.frameThick) it.frameThick=it.wall!=null&&S.walls[it.wall]?(S.walls[it.wall].thick||S.defaultWallThick||220):(S.defaultWallThick||220);
    }
  });
}

const OPEN_TYPES=['opening','window','bay','special'];
const SNAP_OPEN_TYPES=['opening','special'];
// 所有墙体构件统一按附着对象处理：门洞、窗、飘窗、强弱电箱及特殊标识
// 均只保存宿主墙索引和位置参数，任何构件都不得改变宿主墙的实体线段。
function wallHasAttachment(wallIndex){
  const attached=(S.items||[]).some(it=>it&&(
    (Number.isInteger(it.wall)&&it.wall===wallIndex) ||
    (Number.isInteger(it.attachedWall)&&it.attachedWall===wallIndex)
  ));
  if(attached)return true;
  // 入户门独立存储于 entryDoor；若门洞基线落在该墙段上，也保护整条宿主墙。
  const d=S.entryDoor,w=S.walls&&S.walls[wallIndex];
  if(d&&d.a&&d.b&&w&&w.a&&w.b){
    const mid={x:(d.a.x+d.b.x)/2,y:(d.a.y+d.b.y)/2};
    const onLine=distToSegment(mid,w.a,w.b)<2;
    const endsOnSegment=distToSegment(d.a,w.a,w.b)<2&&distToSegment(d.b,w.a,w.b)<2;
    if(onLine&&endsOnSegment)return true;
  }
  return false;
}

const dist=ScribeEngine.distance;
const screen=p=>({x:origin.x+p.x*scale,y:origin.y-p.y*scale});
const world=p=>({x:(p.x-origin.x)/scale,y:(origin.y-p.y)/scale});

// 各功能模块通过状态读取/写入接口共享主程序数据，不复制项目状态。
const otherModule=window.LinuoOtherModule.create({
  getState:()=>S,getCanvasContext:()=>ctx,getScale:()=>scale,getOrigin:()=>origin,screen,
  $ ,panel:(title,html)=>panel(title,html),setPointEditIndex:i=>{pointEditIndex=i;},
  setPreview:value=>{preview=value;},pushUndoSnapshot:snapshot=>{undoStack.push(snapshot);if(undoStack.length>60)undoStack.shift();redoStack=[];},
  draw:()=>draw(),persist:()=>persist(),closePanel:()=>closePanel(),setTool:t=>setTool(t),fitCanvas:()=>fitCanvas()
});
const pointTypes=otherModule.pointTypes;
const doorModule=window.LinuoDoorModule.create({
  getState:()=>S,getCanvasContext:()=>ctx,getScale:()=>scale,screen,
  distance:dist,ScribeEngine,types,$,removeItemAt:i=>removeItemAt(i),
  panel:(title,html)=>panel(title,html),posOnWall:(w,t)=>posOnWall(w,t),zoomToWorldPoint:p=>zoomToWorldPoint(p),
  pointOnPath:(P,t)=>ptOnPath(P,t),getBlankSide:(w,t)=>getBlankSide(w,t),
  openingEndpointConnected:(it,q)=>openingEndpointConnected(it,q),openingEndpointIsClosedRegion:(it,q)=>openingEndpointIsClosedRegion(it,q),openingEndpointStartUsed:q=>openingEndpointStartUsed(q),entryDoorEndpointConnected:q=>entryDoorEndpointConnected(q),entryDoorEndpointIsClosedRegion:q=>entryDoorEndpointIsClosedRegion(q),
  setPreview:value=>{preview=value;},draw:()=>draw(),saveUndo:()=>saveUndo(),splitAllWallIntersections:()=>splitAllWallIntersections(),
  persist:()=>persist(),scheduleAutoSelect:()=>scheduleAutoSelect(),closePanel:()=>closePanel(),clearWallChain:()=>clearWallChain(),
  setTool:t=>setTool(t),fitCanvas:()=>fitCanvas(),openPointEditor:it=>otherModule.openPointEditor(it),showToast:msg=>showToast(msg),setMandatorySetupLock:v=>{mandatorySetupLock=!!v;}
});
const outModule=window.LinuoOutModule.create({
  $ ,getState:()=>S,setState:value=>{S=value;},ScribeEngine,
  types,pointTypes,distance:dist,posOnWall:(w,t)=>posOnWall(w,t),
  getPointPos:it=>getPointPos(it),getOpeningJambs:it=>getOpeningJambs(it),
  dxfLabel:it=>dxfLabel(it),getBlankSide:(w,t)=>getBlankSide(w,t),
  entryDoorGeometry:()=>entryDoorGeometry(),entryDoorEndpointConnected:q=>entryDoorEndpointConnected(q),entryDoorEndpointIsClosedRegion:q=>entryDoorEndpointIsClosedRegion(q),
  showToast:(msg)=>showToast(msg),saveUndo:()=>saveUndo(),normalizeLegacyItems:()=>normalizeLegacyItems(),
  syncOpeningBridgeLine:it=>syncOpeningBridgeLine(it),splitAllWallIntersections:()=>splitAllWallIntersections(),
  clearWallChain:()=>clearWallChain(),resetImportInteraction:()=>{chain=null;if(chainTimer)clearTimeout(chainTimer);chainTimer=null;editWallIndex=-1;editEnd=null;preview=null;selectedWall=-1;},
  persist:()=>persist(),closePanel:()=>closePanel(),fitCanvas:()=>fitCanvas(),draw:()=>draw()
});

/* ---------- 画布旋转与坐标逆变换 ---------- */
let viewAngle = 0; // 画布旋转角度
let uiSide = 'left'; // 侧边栏默认在左侧

function applyUISide(side) {
  uiSide = side;
  const tools = document.getElementById('rightTools');
  const phead = document.getElementById('phead');
  const title = document.getElementById('ptitle');
  const toggleBtn = document.getElementById('uiSideToggle');
  if (!tools || !phead || !title || !toggleBtn) return;
  
  if (side === 'left') {
    tools.classList.remove('pos-right');
    tools.classList.add('pos-left');
    phead.style.flexDirection = 'row-reverse';
    title.style.textAlign = 'right';
    title.style.paddingRight = '8px';
    title.style.paddingLeft = '0';
    toggleBtn.style.marginLeft = '0';
    toggleBtn.style.marginRight = '8px';
  } else {
    tools.classList.remove('pos-left');
    tools.classList.add('pos-right');
    phead.style.flexDirection = 'row';
    title.style.textAlign = 'left';
    title.style.paddingRight = '0';
    title.style.paddingLeft = '0';
    toggleBtn.style.marginLeft = '0';
    toggleBtn.style.marginRight = '8px';
  }
    // 左右手切换按钮只显示手势图标；完整说明放在 title / aria-label 中。
  const handPath = '<path d="M8 13V5.2a1.55 1.55 0 0 1 3.1 0V12"/><path d="M11.1 11V3.8a1.55 1.55 0 0 1 3.1 0V12"/><path d="M14.2 11V5.3a1.55 1.55 0 0 1 3.1 0v9.1c0 4.1-2.5 6.6-6.2 6.6h-.8c-2.2 0-3.5-1.1-4.6-3L3.8 13.9a1.65 1.65 0 0 1 2.7-1.9L8 13"/>';
  const handTransform = side === 'right' ? 'transform="translate(24 0) scale(-1 1)"' : '';
  toggleBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g ${handTransform}>${handPath}</g></svg>`;
  toggleBtn.title = side === 'left' ? '当前左手操作，点击切换到右手' : '当前右手操作，点击切换到左手';
  toggleBtn.setAttribute('aria-label', toggleBtn.title);

  // 记住用户的左右手选择
  try {
    localStorage.setItem('linuo_ui_hand', side);
  } catch(e) {}
  // 联动更新数字键盘
  if (typeof updateKeyboardLayout === 'function') {
    updateKeyboardLayout(side);
// 直接从页面获取元素，避免提前访问尚未初始化的变量
const photoOverlayEl=document.getElementById('photoAnnotationOverlay');

const photoOpen=!!(
  photoOverlayEl &&
  photoOverlayEl.classList.contains('open')
);
    if(photoOpen && numKbEl && numKbEl.style.display!=='none'){
      numKbEl.style.left=side==='left'?'8px':'auto';
      numKbEl.style.right=side==='right'?'8px':'auto';
    }
  }
}

const uiToggleBtn = document.getElementById('uiSideToggle');
if (uiToggleBtn) {
  uiToggleBtn.onclick = () => {
    applyUISide(uiSide === 'left' ? 'right' : 'left');
  };
}

// 初始化默认左侧布局
// 读取上次保存的左右手设置
let savedUISide = 'left';
try {
  const saved = localStorage.getItem('linuo_ui_hand');
  if (saved === 'left' || saved === 'right') {
    savedUISide = saved;
  }
} catch(e) {}

// 按上次选择初始化
applyUISide(savedUISide);

function getPointer(e) {
  let x = e.offsetX;
  let y = e.offsetY;
  if (viewAngle !== 0) {
    const cx = W / 2;
    const cy = H / 2;
    const dx = x - cx;
    const dy = y - cy;
    const cos = Math.cos(-viewAngle);
    const sin = Math.sin(-viewAngle);
    x = cx + dx * cos - dy * sin;
    y = cy + dx * sin + dy * cos;
  }
  return {x, y};
}

/* ---------- 自定义数字键盘 ---------- */
let activeInput = null;
// 特殊参数面板可将最后一次数字键盘确认直接绑定为创建/保存动作（例如八角斜墙）。
let panelNumericConfirmAction = null;
// 图片标注页嵌入时，复用本页数字键盘、长按语音和蓝牙数据输入。
let sharedNumericSession = null;
let sharedNumericProxy = null;
const photoAnnotationOverlay = document.getElementById('photoAnnotationOverlay');
const bluetoothStateListeners = new Set();
let bluetoothConnectedState = false;
// 统一管理当前正在输入的输入框，确保只有当前项显示红色文字。
function setActiveInput(inp) {
  if (activeInput && activeInput.classList) activeInput.classList.remove('linuo-input-editing');
  activeInput = inp || null;
  if (activeInput && activeInput.classList) activeInput.classList.add('linuo-input-editing');
}
let isFirstInput = true; // 用于判断是否为首次输入（决定是否覆盖原值）
let numKbEl = document.createElement('div');
numKbEl.id = 'numKeyboard';
// ==================================================
// 数字键盘使用期间，禁用画布旋转按钮
// ==================================================
function updateRotateCanvasLock() {
  const rotateBtn = document.getElementById('rotateCanvas');
  if (!rotateBtn || !numKbEl) return;

  // 通过实际显示状态判断数字键盘是否正在使用
  const keyboardVisible =
    window.getComputedStyle(numKbEl).display !== 'none';

  rotateBtn.disabled = keyboardVisible;
  rotateBtn.setAttribute(
    'aria-disabled',
    keyboardVisible ? 'true' : 'false'
  );

  // 禁用时变灰，恢复时还原原有样式
  rotateBtn.style.opacity = keyboardVisible ? '0.35' : '';
  rotateBtn.style.filter = keyboardVisible ? 'grayscale(1)' : '';
  rotateBtn.style.cursor = keyboardVisible ? 'not-allowed' : '';

  rotateBtn.title = keyboardVisible
    ? '数字键盘使用中，暂不能旋转画布'
    : '手动顺时针旋转画布90度';
}

// 监听数字键盘显示和隐藏
// 不需要逐个修改数字键盘的打开、关闭代码
const rotateKeyboardObserver = new MutationObserver(() => {
  updateRotateCanvasLock();
});

rotateKeyboardObserver.observe(numKbEl, {
  attributes: true,
  attributeFilter: ['style', 'class']
});

// 初始化按钮状态
updateRotateCanvasLock();
// 记忆折叠状态：默认收起，用户展开过就记住
let numPadExpanded = (()=>{ try{ return localStorage.getItem('linuo_numpad')==='1'; }catch(e){ return false; } })();
const numKeys = ['1','2','3','voice','4','5','6','7','8','9','0','⌫','✓'];
numKeys.forEach(k => {
  let btn = document.createElement('div');
  btn.className = 'num-kb-btn';

  // 语音输入：按下开始识别，松开结束；绿色可用，灰色不可用，红色正在聆听。
  if (k === 'voice') {
btn.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"></path></svg>';
    btn.setAttribute('data-key', 'voice');
    btn.style.touchAction='none';
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || window.mozSpeechRecognition || window.msSpeechRecognition;
    const secureVoiceContext = !!window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    let voiceRecognition=null, voiceFinalText='', voiceMode='idle', voiceApplied=false, pressActive=false, intentionalStop=false, permissionDenied=false;
    const supported = !!SpeechRecognition && secureVoiceContext;
    const paintVoice = () => {
      const usable=supported&&!permissionDenied;
      btn.style.setProperty('color', !usable?'#9aa6b6':(voiceMode==='hold'?'#e53935':'#0a9f60'),'important');
      btn.title = !usable ? '当前浏览器语音识别不可用或麦克风权限被拒绝' : (voiceMode==='hold'?'正在聆听，松开结束':'长按说话，松开结束');
      btn.setAttribute('aria-pressed',voiceMode==='hold'?'true':'false');
    };
    const extractVoiceDigits = value => {
      const map={'零':'0','〇':'0','洞':'0','幺':'1','一':'1','二':'2','两':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9'};
      return Array.from(String(value||'')).map(ch=>/[0-9]/.test(ch)?ch:(map[ch]||'')).join('');
    };
    const applyVoiceDigits = () => {
      if(voiceApplied || !activeInput)return;
      const digits=extractVoiceDigits(voiceFinalText);
      if(!digits)return;
      activeInput.value=(isFirstInput?'':String(activeInput.value||''))+digits;
      isFirstInput=false;
      activeInput.dispatchEvent(new Event('input',{bubbles:true}));
      voiceApplied=true;
      showToast('语音已输入：'+digits);
    };
    const startHoldRecognition = () => {
      if(!supported||permissionDenied){paintVoice();showToast(permissionDenied?'麦克风权限未允许，请检查浏览器网站权限':'当前浏览器或访问环境不支持语音识别');return;}
      if(!activeInput){showToast('请先点击需要输入的数字框');return;}
      if(voiceRecognition)return;
      voiceFinalText='';voiceApplied=false;intentionalStop=false;voiceMode='hold';
      try{
        const rec=new SpeechRecognition();voiceRecognition=rec;
        rec.lang='zh-CN';rec.continuous=false;rec.interimResults=true;rec.maxAlternatives=3;
        rec.onresult=event=>{
          let finalText='';
          for(let i=Math.max(0,Number(event.resultIndex)||0);i<event.results.length;i++){
            const result=event.results[i];
            if(result.isFinal)finalText+=result[0].transcript;
          }
          if(finalText)voiceFinalText+=finalText;
        };
        rec.onerror=event=>{
          if(event.error==='not-allowed'||event.error==='service-not-allowed'){
            permissionDenied=true;voiceMode='idle';
            showToast('麦克风权限或系统语音服务未允许，请检查Chrome网站权限及手机语音服务');
          }else if(event.error==='audio-capture'){
            showToast('无法获取麦克风，请检查系统麦克风权限或是否被其他应用占用');
          }else if(event.error==='network'){
            showToast('语音识别网络连接失败，请检查网络');
          }else if(event.error==='no-speech'){
            // 松开后没有识别到语音属于正常结束，不提示错误。
          }else if(event.error!=='aborted'){
            showToast('语音识别失败：'+event.error);
          }
          paintVoice();
        };
        rec.onend=()=>{
          if(voiceRecognition!==rec)return;
          voiceRecognition=null;
          if(intentionalStop)applyVoiceDigits();
          voiceMode='idle';intentionalStop=false;paintVoice();
        };
        // 必须在真实按压事件中立即 start，不能延迟数百毫秒，否则安卓Chrome可能返回 aborted。
        rec.start();paintVoice();
      }catch(err){
        voiceRecognition=null;voiceMode='idle';paintVoice();
        showToast('无法启动语音识别：'+(err.message||err));
      }
    };
    const stopHoldRecognition=()=>{
      if(!voiceRecognition)return;
      intentionalStop=true;
      try{voiceRecognition.stop();}catch(err){
        // 若服务已自行结束，交由 onend 清理，不再主动 abort。
      }
    };
    btn.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();
      if(pressActive)return;
      pressActive=true;
      try{btn.setPointerCapture(e.pointerId);}catch(_){}
      startHoldRecognition();
    });
    const releaseVoice=e=>{
      if(!pressActive)return;
      pressActive=false;
      if(e&&e.preventDefault)e.preventDefault();
      stopHoldRecognition();
    };
    btn.addEventListener('pointerup',releaseVoice);
    btn.addEventListener('pointercancel',releaseVoice);
    btn.addEventListener('lostpointercapture',releaseVoice);
    btn.addEventListener('contextmenu',e=>e.preventDefault());
    paintVoice();
    if(supported&&navigator.permissions&&navigator.permissions.query){
      navigator.permissions.query({name:'microphone'}).then(status=>{
        permissionDenied=status.state==='denied';paintVoice();
        status.onchange=()=>{permissionDenied=status.state==='denied';paintVoice();};
      }).catch(()=>{});
    }
    numKbEl.appendChild(btn);return;
  }

  btn.textContent = k;
  btn.setAttribute('data-key', k);
  
  if (k === '⌫') {
    btn.style.width = '100%';              // 覆盖原CSS宽度，让网格撑开
  }
  if (k === '✓') {
    btn.style.color = '#2878df';
    btn.style.fontWeight = 'bold';
    btn.style.height = '100%';             // 覆盖原CSS高度，让网格撑满
  }
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // 防止输入框失去焦点
    if (!activeInput) return;
    let v = activeInput.value;
    
    if (k === '⌫') {
      activeInput.value = v.slice(0, -1);
      isFirstInput = false; // 删除后不再覆盖
    } else if (k === '✓') {
      // 图片标注输入直接交给图片标注页确认，避免误触量房面板的保存按钮。
      if (sharedNumericSession) {
        const session = sharedNumericSession;
        const value = activeInput ? String(activeInput.value || '0') : '0';
        try { if (typeof session.onConfirm === 'function') session.onConfirm(value); }
        catch (err) { console.error('图片标注数字确认失败：', err); showToast('图片标注确认失败：' + (err.message || err)); }
        closeSharedNumericInput();
        return;
      }
      // 数值按 5mm 取整（层高不取整）
      if (activeInput !== $('heightInp') && activeInput.type === 'number' && activeInput.value !== '') {
        const snapped = snap5(activeInput.value);
        if (String(snapped) !== activeInput.value) {
          activeInput.value = snapped;
          activeInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      // 如果输入的是层高，直接收起键盘
      if (activeInput === $('heightInp')) {
        numKbEl.style.display = 'none';
        activeInput.blur();
        activeInput.style.boxShadow = '';
        setActiveInput(null);
        return;
      }
      
      // 查找当前面板中所有的数字输入框，忽略文本和备注框
      const inputs = [...$('body').querySelectorAll('input')].filter(inp => inp.type === 'number');
      const idx = inputs.indexOf(activeInput);
      
      if (idx > -1 && idx < inputs.length - 1) {
        // 还有下一个数字输入框，自动跳转
        const nextInp = inputs[idx + 1];
        nextInp.focus();
        setActiveInput(nextInp);
        isFirstInput = true;
        inputs.forEach(el => el.style.boxShadow = '');
        nextInp.style.boxShadow = '0 0 0 2px #2878df';
        setTimeout(() => { nextInp.scrollIntoView({behavior: 'smooth', block: 'center'}); }, 100);
      } else {
        // 后面没有数字框了，收起键盘。
        numKbEl.style.display = 'none';
        activeInput.blur();
        activeInput.style.boxShadow = '';
        setActiveInput(null);

        // 特殊面板直接由数字键盘 ✓ 执行，不再额外显示确认按钮。
        if (typeof panelNumericConfirmAction === 'function') {
          const action = panelNumericConfirmAction;
          action();
          return;
        }

        // 自动触发面板中隐藏的“确定/保存”按钮。
        const submitIds = ['saveEntryDoor', 'btnNewOk', 'nextWall', 'rok', 'updateWall', 'place', 'saveItem', 'dsave', 'tsave', 'aok'];
        for (const id of submitIds) {
          const btn = $(id);
          if (btn) {
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            break;
          }
        }
      }
      return;
    } else {
      // 数字按键
      if (isFirstInput) {
        activeInput.value = k; // 首次按键直接覆盖
        isFirstInput = false;
      } else {
        if (v === '0') v = ''; // 避免生成 05 这种格式
        activeInput.value = v + k;
      }
    }
    
    // 触发 input 事件以同步画布预览
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  numKbEl.appendChild(btn);
});

// 切换按钮：点它展开/收起数字区
const kbToggleBtn = document.createElement('div');
kbToggleBtn.className = 'num-kb-btn';
kbToggleBtn.textContent = numPadExpanded ? '▼' : '▲';
kbToggleBtn.style.color = '#2878df';
kbToggleBtn.style.fontWeight = 'bold';
kbToggleBtn.setAttribute('data-key', 'toggle');
kbToggleBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  numPadExpanded = !numPadExpanded;
  try{ localStorage.setItem('linuo_numpad', numPadExpanded ? '1' : '0'); }catch(e){}
kbToggleBtn.textContent = numPadExpanded ? '▼' : '▲';
  updateKeyboardLayout(uiSide);
});
numKbEl.appendChild(kbToggleBtn);

// 蓝牙测距仪入口保留在顶部工具栏；数字键盘此处专用于按住语音输入。
document.getElementById('rightTools').appendChild(numKbEl);
// 让数字键盘在 column-reverse 的侧边栏中位于视觉最下方，紧贴参数面板上方
numKbEl.style.order = '-1';

/* ---------- 右上角放大镜：捕捉闭合提示 & 拖拽预览 ---------- */
let magEl = null, magCanvas = null, magLabel = null;
function ensureMagnifier(){
  if(magEl) return;
  magEl = document.createElement('div');
  magEl.id = 'snapLens';
  magEl.style.cssText = 'position:absolute;top:56px;right:10px;z-index:20;display:none;pointer-events:none;';
  magCanvas = document.createElement('canvas');
  magCanvas.style.cssText = 'display:block;border-radius:12px;box-shadow:0 4px 16px rgba(31,55,85,.25);border:2px solid rgba(255,255,255,.9);background:#f3f6fb;';
  magEl.appendChild(magCanvas);
  magLabel = document.createElement('div');
  magLabel.style.cssText = 'margin-top:6px;text-align:center;font-size:11px;color:#fff;background:rgba(32,45,69,.9);padding:4px 8px;border-radius:6px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.2);';
  magEl.appendChild(magLabel);
  work.appendChild(magEl);
}
function getDragItemObj(){
  if(!dragItem) return null;
  if(typeof dragItem==='number') return S.items[dragItem]||null;
  if(dragItem.it) return dragItem.it;
  if(dragItem.item) return dragItem.item;
  if(typeof dragItem.index==='number') return S.items[dragItem.index]||null;
  if(dragItem.type) return dragItem;
  return null;
}
/* 测量工具：点击取点 → 生成测量；点已有测量线中点可删除 */
cv.addEventListener('pointerdown', e=>{
  if(tool!=='measure') return;
  if(!e.isPrimary) return; // 仅忽略第二指，避免上一次 pointerup 异常导致首点被吞
  measureDown={x:e.clientX,y:e.clientY};
});
cv.addEventListener('pointermove', e=>{
  if(tool!=='measure') return;
  const cp=canvasPointFromClient(e.clientX,e.clientY);
  measurePreview=measureSnap(cp);
  if(measureA) draw();
  updateMagnifier(cp,measureA?'测量终点':'测量起点','rgba(31,111,210,.92)');
});
cv.addEventListener('pointerup', e=>{
  if(tool!=='measure'||!measureDown) return;
  const dx=e.clientX-measureDown.x, dy=e.clientY-measureDown.y;
  measureDown=null;
  if(Math.hypot(dx,dy)>8) return; // 拖动不视为点击
  const cp=canvasPointFromClient(e.clientX,e.clientY);
  // 命中已有测量线 → 删除
  for(let i=(S.measures||[]).length-1;i>=0;i--){
    const m=S.measures[i];
    const A=screen(m.a),B=screen(m.b);
    if(distToSegment(cp,A,B)<12){ S.measures.splice(i,1); draw(); return; }
  }
  const pw=measureSnap(cp);
  updateMagnifier(cp,measureA?'测量终点':'测量起点','rgba(31,111,210,.92)');
  if(!measureA){
    measureA={...pw};
  }else{
    if(dist(measureA,pw)>1){
      // 只保留最新一条测量，旧的自动删除
      const measured=Math.round(dist(measureA,pw));
      S.measures=[{a:{...measureA},b:{...pw}}];
      persist();
      let badge=document.getElementById('measureFloat');
      if(!badge){badge=document.createElement('div');badge.id='measureFloat';badge.style.cssText='position:absolute;right:12px;top:12px;z-index:5;padding:7px 12px;border-radius:9px;background:rgba(255,255,255,.96);box-shadow:0 2px 12px rgba(0,0,0,.18);color:#e53935;font-size:18px;font-weight:800;pointer-events:none;';$('work').appendChild(badge);}
      badge.textContent=measured+' mm';badge.style.display='block';
      clearTimeout(window.__linuoMeasureFloatTimer);
      window.__linuoMeasureFloatTimer=setTimeout(()=>{badge.style.display='none';},1000);
      setTool('select');
    }
    measureA=null; measurePreview=null;
  }
  draw();
  updateMagnifier(cp,'测量定位','rgba(31,111,210,.92)');
});
document.addEventListener('pointerup', ()=>{
  if(tool!=='measure') measureDown=null;
});
// 拖动已放置构件时用构件当前位置驱动放大镜（pointermove 兜底，不拦截手势）
cv.addEventListener('pointermove', e=>{
  if(!dragItem || draft) return;
  const it=getDragItemObj();
  if(!it) return;
  const pos=getPointPos(it);
  if(!pos) return;
  const sp=screen({x:pos.cx,y:pos.cy});
  const lbl=pointTypes[it.type]||types[it.type]||it.type||'构件';
  updateMagnifier(sp, lbl, 'rgba(31,111,210,.92)');
});
document.addEventListener('pointerup', ()=>{
  setTimeout(()=>{
    if(!dragItem && !draft && !(legendDrag && legendDrag.moved)) updateMagnifier(null);
  },0);
}, true);
function updateMagnifier(point, text, bg){
  ensureMagnifier();
  if(!point){ magEl.style.display='none'; return; }
  magEl.style.display='block';
  const size = 150, zoom = 2.5, srcSize = size/zoom;
  const pxW = Math.round(size*dpr), pxH = Math.round(size*dpr);
  if(magCanvas.width !== pxW || magCanvas.height !== pxH){
    magCanvas.width = pxW;
    magCanvas.height = pxH;
    magCanvas.style.width = size+'px';
    magCanvas.style.height = size+'px';
  }
  const lctx = magCanvas.getContext('2d');
  lctx.setTransform(dpr,0,0,dpr,0,0);
  lctx.clearRect(0,0,size,size);
  lctx.fillStyle = '#f3f6fb';
  lctx.fillRect(0,0,size,size);
  let pp = point;
  if(viewAngle !== 0){
    const cx=W/2, cy=H/2;
    const dx=point.x-cx, dy=point.y-cy;
    const cos=Math.cos(viewAngle), sin=Math.sin(viewAngle);
    pp = {x:cx+dx*cos-dy*sin, y:cy+dx*sin+dy*cos};
  }
  try{
    const sx = (pp.x - srcSize/2) * dpr;
    const sy = (pp.y - srcSize/2) * dpr;
    const sw = srcSize * dpr;
    const sh = srcSize * dpr;
    lctx.drawImage(cv, sx, sy, sw, sh, 0, 0, size, size);
  }catch(e){}
  // 中心标记
  lctx.strokeStyle = '#e53935';
  lctx.lineWidth = 1.5;
  lctx.beginPath();
  lctx.moveTo(size/2 - 12, size/2); lctx.lineTo(size/2 + 12, size/2);
  lctx.moveTo(size/2, size/2 - 12); lctx.lineTo(size/2, size/2 + 12);
  lctx.stroke();
  lctx.beginPath();
  lctx.arc(size/2, size/2, 5, 0, Math.PI*2);
  lctx.strokeStyle = '#2878df';
  lctx.lineWidth = 2;
  lctx.stroke();
  if(text){
    magLabel.style.display='block';
    magLabel.textContent = text;
    magLabel.style.background = bg || 'rgba(32,45,69,.9)';
  } else {
    magLabel.style.display='none';
  }
}
/* ---------- 蓝牙连接状态：灰色未连接 / 绿色已连接 ---------- */
/* 蓝牙状态统一管理：顶部按钮和数字键盘同步变色 */
function setBtConnected(on){
  on=!!on;
  bluetoothConnectedState=on;

  const color=on?'#0a9f60':'#9aa6b6';

  // 顶部蓝牙图标
  const head=document.getElementById('btnBluetooth');

  if(head){
    head.classList.toggle('bt-connected',on);
    head.title=on?'蓝牙已连接':'连接蓝牙测距仪';
    head.setAttribute('aria-pressed',on?'true':'false');
  }

  const photoBt=document.getElementById('btConnect');
  if(photoBt){photoBt.classList.toggle('bt-connected',on);photoBt.title=on?'蓝牙已连接':'连接蓝牙测距仪';photoBt.setAttribute('aria-pressed',on?'true':'false');}
  bluetoothStateListeners.forEach(fn=>{try{fn(on);}catch(err){console.error('蓝牙状态订阅回调失败',err);}});

  // 数字键盘蓝牙图标
  const kbBtns=document.querySelectorAll(
    '#numKeyboard [data-key="bt"]'
  );

  kbBtns.forEach(kbBtn=>{
    kbBtn.classList.toggle('bt-connected',on);

    // 强制同步按钮颜色
    kbBtn.style.setProperty('color',color,'important');

    // 同步SVG自身的描边颜色
    const svg=kbBtn.querySelector('svg');

    if(svg){
      svg.style.setProperty('stroke',color,'important');
    }

    kbBtn.setAttribute(
      'aria-label',
      on?'蓝牙已连接':'蓝牙未连接'
    );
  });
}

window.setBtConnected=setBtConnected;
setBtConnected(false);
setBtConnected(false);

/* 自动挂钩：任何 gatt.connect() 成功 → 变绿；断开事件 → 变灰。
   无需改动原有蓝牙连接代码，不改变原有流程。 */
(function autoBtHook(){
  if(!window.BluetoothRemoteGATTServer) return;
  if(BluetoothRemoteGATTServer.prototype.__linuoHooked) return;
  BluetoothRemoteGATTServer.prototype.__linuoHooked=true;
  const orig=BluetoothRemoteGATTServer.prototype.connect;
  BluetoothRemoteGATTServer.prototype.connect=function(){
    const server=this;
    return orig.call(this).then(res=>{
      setBtConnected(true);
      try{
        if(server.device&&!server.device.__linuoDiscHooked){
          server.device.__linuoDiscHooked=true;
          server.device.addEventListener('gattserverdisconnected',()=>setBtConnected(false));
        }
      }catch(e){}
      return res;
    }).catch(err=>{setBtConnected(false);throw err;});
  };
})();


// 根据侧边栏位置动态更新键盘网格坐标
function updateKeyboardLayout(side) {
  const kb = document.getElementById('numKeyboard');
  if (!kb) return;

  const btns = kb.querySelectorAll('.num-kb-btn');
  const DIGIT_KEYS = ['0','1','2','3','4','5','6','7','8','9','⌫'];

  // 展开：四列四行
  // 折叠：顶部14px箭头 + 四格主体
  kb.style.gridTemplateColumns = numPadExpanded
    ? 'repeat(4, 1fr)'
    : '1fr';

  kb.style.gridTemplateRows = numPadExpanded
    ? 'repeat(4, 30px)'
    : '14px repeat(4, 30px)';

  kb.style.gridAutoRows = '30px';

  btns.forEach(btn => {
    const key = btn.getAttribute('data-key');

    btn.style.gridColumn = '';
    btn.style.gridRow = '';
// 切换布局时恢复确认键宽度
if (key === '✓') {
  btn.style.width = '';
  btn.style.minWidth = '';
}
    // 数字键只在展开状态显示
    const isDigit = DIGIT_KEYS.includes(key);
    btn.style.display = (isDigit && !numPadExpanded)
      ? 'none'
      : 'flex';

    // 每次切换前恢复语音按钮原始大小
    if (key === 'voice') {
      btn.style.width = '';
      btn.style.height = '';
      btn.style.minHeight = '';
      btn.style.fontSize = '';

      const icon = btn.querySelector('svg');
      if (icon) {
        icon.setAttribute(
          'width',
          numPadExpanded ? '20' : '34'
        );
        icon.setAttribute(
          'height',
          numPadExpanded ? '20' : '34'
        );
      }
    }

    // 每次切换前恢复顶部箭头原始尺寸
    if (key === 'toggle') {
      btn.style.width = '';
      btn.style.height = '';
      btn.style.minHeight = '';
      btn.style.fontSize = '';
      btn.style.lineHeight = '';
      btn.style.padding = '';
      btn.style.borderRadius = '';
    }

    // 确认键保持蓝色
    if (key === '✓') {
      btn.style.setProperty(
        'background',
        'rgba(22,119,232,0.22)',
        'important'
      );
      btn.style.setProperty(
        'border',
        '1px solid rgba(22,119,232,0.55)',
        'important'
      );
      btn.style.setProperty(
        'color',
        '#1677e8',
        'important'
      );
    }

    // ============================
    // 折叠状态
    // ============================
    if (!numPadExpanded) {

      // 顶部：极小折叠箭头
      if (key === 'toggle') {
        btn.style.gridColumn = '1';
        btn.style.gridRow = '1';

        btn.style.width = '100%';
        btn.style.height = '100%';
        btn.style.minHeight = '0';
        btn.style.fontSize = '10px';
        btn.style.lineHeight = '10px';
        btn.style.padding = '0';
        btn.style.borderRadius = '5px';
      }

      // 语音：占据上下两格
      else if (key === 'voice') {
        btn.style.gridColumn = '1';
        btn.style.gridRow = '2 / span 2';

        btn.style.width = '100%';
        btn.style.height = '100%';
        btn.style.minHeight = '64px';
        btn.style.fontSize = '22px';
      }

      // 确认：占据底部两格
else if (key === '✓') {
  btn.style.gridColumn = '1';
  btn.style.gridRow = '4 / span 2';

  // 确认按钮加宽，麦克风按钮同步占满同一列
  btn.style.width = '36px';
  btn.style.minWidth = '36px';
}

      return;
    }

    // ============================
    // 展开状态：恢复原四列布局
    // ============================

    if (side === 'right') {

      if (key === '1') {
        btn.style.gridColumn = '1';
        btn.style.gridRow = '1';
      }
      if (key === '2') {
        btn.style.gridColumn = '2';
        btn.style.gridRow = '1';
      }
      if (key === '3') {
        btn.style.gridColumn = '3';
        btn.style.gridRow = '1';
      }
      if (key === 'toggle') {
        btn.style.gridColumn = '4';
        btn.style.gridRow = '1';
      }

      if (key === '4') {
        btn.style.gridColumn = '1';
        btn.style.gridRow = '2';
      }
      if (key === '5') {
        btn.style.gridColumn = '2';
        btn.style.gridRow = '2';
      }
      if (key === '6') {
        btn.style.gridColumn = '3';
        btn.style.gridRow = '2';
      }
      if (key === 'voice') {
        btn.style.gridColumn = '4';
        btn.style.gridRow = '2';
      }

      if (key === '7') {
        btn.style.gridColumn = '1';
        btn.style.gridRow = '3';
      }
      if (key === '8') {
        btn.style.gridColumn = '2';
        btn.style.gridRow = '3';
      }
      if (key === '9') {
        btn.style.gridColumn = '3';
        btn.style.gridRow = '3';
      }
      if (key === '✓') {
        btn.style.gridColumn = '4';
        btn.style.gridRow = '3 / span 2';
      }

      if (key === '0') {
        btn.style.gridColumn = '1';
        btn.style.gridRow = '4';
      }
      if (key === '⌫') {
        btn.style.gridColumn = '2 / span 2';
        btn.style.gridRow = '4';
      }

    } else {

      if (key === 'toggle') {
        btn.style.gridColumn = '1';
        btn.style.gridRow = '1';
      }
      if (key === '1') {
        btn.style.gridColumn = '2';
        btn.style.gridRow = '1';
      }
      if (key === '2') {
        btn.style.gridColumn = '3';
        btn.style.gridRow = '1';
      }
      if (key === '3') {
        btn.style.gridColumn = '4';
        btn.style.gridRow = '1';
      }

      if (key === 'voice') {
        btn.style.gridColumn = '1';
        btn.style.gridRow = '2';
      }
      if (key === '4') {
        btn.style.gridColumn = '2';
        btn.style.gridRow = '2';
      }
      if (key === '5') {
        btn.style.gridColumn = '3';
        btn.style.gridRow = '2';
      }
      if (key === '6') {
        btn.style.gridColumn = '4';
        btn.style.gridRow = '2';
      }

      if (key === '✓') {
        btn.style.gridColumn = '1';
        btn.style.gridRow = '3 / span 2';
      }
      if (key === '7') {
        btn.style.gridColumn = '2';
        btn.style.gridRow = '3';
      }
      if (key === '8') {
        btn.style.gridColumn = '3';
        btn.style.gridRow = '3';
      }
      if (key === '9') {
        btn.style.gridColumn = '4';
        btn.style.gridRow = '3';
      }

      if (key === '⌫') {
        btn.style.gridColumn = '2 / span 2';
        btn.style.gridRow = '4';
      }
      if (key === '0') {
        btn.style.gridColumn = '4';
        btn.style.gridRow = '4';
      }
    }
  });
}


// 初始生成时，根据当前侧边栏状态应用一次布局
updateKeyboardLayout(uiSide);

/* ---------- 几何 ---------- */
function arcCtrl(w){ return ScribeEngine.arcControlPoint(w); }
function posOnWall(w,t){ return ScribeEngine.pointOnWall(w,t); }
function wallCurveLen(w){ return ScribeEngine.wallCurveLength(w); }
function screenPath(w){
  const A=screen(w.a),B=screen(w.b);
  const C=(w.arc&&w.bulge)?screen(arcCtrl(w)):null;
  return {A,B,C};
}
function ptOnPath(P,t){
  if(!P.C) return {x:P.A.x+(P.B.x-P.A.x)*t,y:P.A.y+(P.B.y-P.A.y)*t};
  const u=1-t;
  return {x:u*u*P.A.x+2*u*t*P.C.x+t*t*P.B.x,y:u*u*P.A.y+2*u*t*P.C.y+t*t*P.B.y};
}
function pathScreenLen(P){
  if(!P.C) return dist(P.A,P.B);
  let L=0,prev=P.A;
  for(let k=1;k<=24;k++){const q=ptOnPath(P,k/24);L+=dist(prev,q);prev=q}
  return L;
}
function angleSnap(a,b){
  const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);
  if(!l)return b;
  let ang=Math.atan2(dy,dx);
  const step=Math.PI/2; // 0°, 90°, 180°, 270°
  const snapped=Math.round(ang/step)*step;
  // 计算当前角度与最近的水平/垂直方向的夹角差
  let diff=Math.abs(ang-snapped);
// 如果角度差小于 30°，则吸附为水平/垂直
if(diff < Math.PI /6){
    return {x:a.x+Math.cos(snapped)*l,y:a.y+Math.sin(snapped)*l};
  }
  // 否则不吸附，直接返回原本的坐标（自由画斜线）
  return b;
}

/* ---------- 点状构件位置计算 ---------- */
function getPointPos(it){ return otherModule.getPointPos(it); }

function getOutlinePoints(it){ return otherModule.getOutlinePoints(it); }

/* 点是否在多边形内（射线法） */
// 点击或长按入户门时，只提供删除和编辑两个操作，不再出现取消按钮。
async function entryDoorAction(){
  const action=await LinuoDialog.show('入户门操作','请选择操作：',[{label:'删除',value:'delete',primary:true},{label:'编辑',value:'edit'}]);
  if(action==='delete'){
    // 删除选项本身即为用户确认，避免再弹出第二次确认。
    saveUndo();S.entryDoor=null;mergeCollinearWalls();persist();draw();showToast('入户门已删除');
  }else if(action==='edit')entryDoorEditor();
}

async function handleLongPress(p) {
// 入户门支持长按删除，使用统一的自定义确认弹窗。
if(hitEntryDoor(p)){
  await entryDoorAction();
  return;
}
  let type = null, index = -1;
  
  for (let i = S.texts.length - 1; i >= 0; i--) {
    if (hitText(p, S.texts[i])) { type = 'text'; index = i; break; }
  }
  if (!type) {
    const pi = nearestPlacedItem(p);
    if (pi >= 0) { type = 'item'; index = pi; }
  }
  if (!type) {
    const hit = pointOnWall(p);
    if (hit) { type = 'wall'; index = hit.i; }
  }
  
  if (type) {
    const action = await LinuoDialog.show('构件操作','请选择要执行的操作：',[{label:'删除',value:'delete',primary:true},{label:'编辑',value:'edit'}]);
    if (action === 'delete') {
      saveUndo();
      if (type === 'text') {
        S.texts.splice(index, 1);
        if (selectedText === index) selectedText = -1;
        else if (selectedText > index) selectedText--;
      } else if (type === 'item') {
        // 通过对象身份维护活动索引，删除当前构件不会串到后一个构件。
        removeItemAt(index);
      } else if (type === 'wall') {
        // 先记住当前编辑对象；墙体数组变化后按原墙体索引重新定位。
        const activePointItem=pointEditIndex>=0?S.items[pointEditIndex]:null;
        const activeTapItem=tapEditItem&&Number.isInteger(tapEditItem.index)?S.items[tapEditItem.index]:null;
        S.walls.splice(index, 1);
        // 删除墙体本身附属的门窗；其它墙上的构件保留原来的 t 和世界坐标。
        S.items = S.items.filter(it => it.wall !== index);
        S.items.forEach(it => {
          if (Number.isInteger(it.wall) && it.wall > index) it.wall--;
          // 同步修正点状构件的宿主墙索引；宿主墙被删时解除关联，但不改 it.p。
          if (Number.isInteger(it.attachedWall)) {
            if (it.attachedWall === index) it.attachedWall = null;
            else if (it.attachedWall > index) it.attachedWall--;
          }
        });
        pointEditIndex=activePointItem?S.items.indexOf(activePointItem):-1;
        if(tapEditItem){
          const nextIndex=activeTapItem?S.items.indexOf(activeTapItem):-1;
          tapEditItem=nextIndex>=0?{...tapEditItem,index:nextIndex}:null;
        }
        if (selectedWall === index) selectedWall = -1;
        else if (selectedWall > index) selectedWall--;
        if (editWallIndex === index) { editWallIndex = -1; editEnd = null; }
        else if (editWallIndex > index) editWallIndex--;
        // 删除连接门洞端点的墙线后，若该端点已无其它连接，恢复红圈和起点资格。
        restoreDisconnectedOpeningEndpoints();
        clearWallChain();
        cornerCache=null;cornerCacheTime=0;drawingRoomLoopsCache=undefined;
      }
      persist();
      draw();
    } else if (action === 'edit') {
      // 编辑构件参数
      closePanel();
      setTool('select'); // 自动切回选择工具，方便拖动视图和后续操作
      if (type === 'text') textEditor(index);
      else if (type === 'item') editPlacedItem(index);
      else if (type === 'wall') wallEditor(index);
    }
  }
}

function pointInPolygon(pt, poly){ return ScribeEngine.pointInPolygon(pt,poly); }


function pointOnPolygonBoundary(pt,poly,tol=3){ return ScribeEngine.pointOnPolygonBoundary(pt,poly,tol); }

/* ---------- 两条不同墙线相交的顶点（墙角 / 交点） ---------- */
function segIntersect(a1,a2,b1,b2){ return ScribeEngine.segmentIntersection(a1,a2,b1,b2); }

/* 将相交的直线墙体在交点处分割为独立墙段，并同步修正构件索引 */
function splitAllWallIntersections(){
  const oldWalls=S.walls.slice(), cuts=oldWalls.map(()=>[0,1]);
  const param=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,ll=dx*dx+dy*dy||1;return ((p.x-a.x)*dx+(p.y-a.y)*dy)/ll;};
  for(let i=0;i<oldWalls.length;i++){
    const a=oldWalls[i];
    if(a.arc&&a.bulge)continue;
    // 构件宿主墙自身保持完整；与之相交的普通墙仍在交点处分段，确保 T 形墙角可闭合。
    const protectA=wallHasAttachment(i);
    for(let j=i+1;j<oldWalls.length;j++){
      const b=oldWalls[j];
      if(b.arc&&b.bulge)continue;
      const protectB=wallHasAttachment(j);
      const q=segIntersect(a.a,a.b,b.a,b.b); if(!q)continue;
      const ti=param(q,a.a,a.b),tj=param(q,b.a,b.b);
      if(!protectA&&ti>1e-6&&ti<1-1e-6)cuts[i].push(ti);
      if(!protectB&&tj>1e-6&&tj<1-1e-6)cuts[j].push(tj);
    }
  }
  const next=[],map=[];
  oldWalls.forEach((w,i)=>{
    const ts=[...new Set(cuts[i].sort((a,b)=>a-b).map(t=>Math.round(t*1e9)/1e9))];
    const parts=[];
    for(let k=0;k<ts.length-1;k++){
      const t0=ts[k],t1=ts[k+1]; if(t1-t0<1e-8)continue;
      const a={x:w.a.x+(w.b.x-w.a.x)*t0,y:w.a.y+(w.b.y-w.a.y)*t0};
      const b={x:w.a.x+(w.b.x-w.a.x)*t1,y:w.a.y+(w.b.y-w.a.y)*t1};
      const nw={...w,a,b,len:(w.arc&&w.bulge)?(w.len||dist(w.a,w.b))*(t1-t0):dist(a,b)};
      parts.push({index:next.length,t0,t1}); next.push(nw);
    }
    map[i]=parts;
  });
  const remapT=(oldIndex,t)=>{
    const parts=map[oldIndex]||[]; if(!parts.length)return {index:oldIndex,t};
    let part=parts.find(x=>t>=x.t0-1e-7&&t<=x.t1+1e-7)||parts[parts.length-1];
    return {index:part.index,t:Math.max(0,Math.min(1,(t-part.t0)/(part.t1-part.t0||1)))};
  };
  S.items.forEach(it=>{
    if(Number.isInteger(it.wall)&&map[it.wall]){
      const r=remapT(it.wall,Number(it.t)||0);it.wall=r.index;it.t=r.t;
    }
    if(Number.isInteger(it.attachedWall)&&map[it.attachedWall]){
      const old=oldWalls[it.attachedWall], pos=it.p||old.a, t=param(pos,old.a,old.b);
      const r=remapT(it.attachedWall,Math.max(0,Math.min(1,t)));it.attachedWall=r.index;
    }
  });
  S.walls=next;
}
function mergeCollinearWalls(){
  const eps=1.5;
  let changed=true,guard=0;
  while(changed&&guard++<500){
    changed=false;
    outer:for(let i=0;i<S.walls.length;i++){
      const a=S.walls[i];
      if(!a||a.arc||a.openingJamb||a.octWallGroup)continue;
      if(wallHasAttachment(i))continue;
      for(let j=i+1;j<S.walls.length;j++){
        const b=S.walls[j];
        if(!b||b.arc||b.openingJamb||b.octWallGroup)continue;
        if(wallHasAttachment(j))continue;
        if(Math.abs((Number(a.thick)||S.defaultWallThick||220)-(Number(b.thick)||S.defaultWallThick||220))>0.1)continue;
        const dx=a.b.x-a.a.x,dy=a.b.y-a.a.y,L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L;
        // 两条线必须处于同一直线上，允许端点落在另一条线段内部。
        const offA=Math.abs((b.a.x-a.a.x)*uy-(b.a.y-a.a.y)*ux);
        const offB=Math.abs((b.b.x-a.a.x)*uy-(b.b.y-a.a.y)*ux);
        if(offA>eps||offB>eps)continue;
        const a0=0,a1=L;
        const bp0=(b.a.x-a.a.x)*ux+(b.a.y-a.a.y)*uy;
        const bp1=(b.b.x-a.a.x)*ux+(b.b.y-a.a.y)*uy;
        const b0=Math.min(bp0,bp1),b1=Math.max(bp0,bp1);
        if(b0>a1+eps||a0>b1+eps)continue;
        const lo=Math.min(a0,b0),hi=Math.max(a1,b1);
        // 交汇位置存在第三条墙线时保留节点，避免破坏T形或十字拓扑。
        const joinLo=Math.max(a0,b0),joinHi=Math.min(a1,b1);
        const probe=joinHi>=joinLo?((joinLo+joinHi)/2):((a1+b0)/2);
        const joint={x:a.a.x+ux*probe,y:a.a.y+uy*probe};
        const third=S.walls.some((w,k)=>{
          if(k===i||k===j||!w||!w.a||!w.b)return false;
          return distToSegment(joint,w.a,w.b)<eps;
        });
        if(third)continue;
        a.a={x:a.a.x+ux*lo,y:a.a.y+uy*lo};
        a.b={x:a.a.x+ux*hi,y:a.a.y+uy*hi};
        a.len=dist(a.a,a.b);
        S.walls.splice(j,1);
        // 删除被合并的墙段后，同步修正后续构件引用的墙线索引。
        (S.items||[]).forEach(it=>{
          if(Number.isInteger(it.wall)&&it.wall>j)it.wall--;
          if(Number.isInteger(it.attachedWall)&&it.attachedWall>j)it.attachedWall--;
        });
        if(typeof editWallIndex==='number'&&editWallIndex>j)editWallIndex--;
        changed=true;break outer;
      }
    }
  }
}

function addWallSegment(a,b,extra={}){
  if(dist(a,b)<0.5)return;
  S.walls.push({a:{...a},b:{...b},len:dist(a,b),thick:S.defaultWallThick||220,...extra});
}

/* 只修剪新画墙段末端很短的越界线头；长尾、已连接端点和带特殊属性的墙体均保留。 */
function trimShortWallTail(a,b){
  const length=dist(a,b);
  if(length<20) return {x:b.x,y:b.y};
  const endpointAlreadyUsed=S.walls.some(w=>dist(w.a,b)<2||dist(w.b,b)<2);
  if(endpointAlreadyUsed) return {x:b.x,y:b.y};
  const thick=Math.max(1,Number(S.defaultWallThick)||220);
  const maxTail=Math.max(100,Math.min(180,thick*0.75));
  let best=null,bestT=0;
  S.walls.forEach((w,wi)=>{
    if(!w||!w.a||!w.b||w.arc||w.openingJamb||wallHasAttachment(wi))return;
    const q=segIntersect(a,b,w.a,w.b);
    if(!q)return;
    const dx=b.x-a.x,dy=b.y-a.y,ll=dx*dx+dy*dy||1;
    const t=((q.x-a.x)*dx+(q.y-a.y)*dy)/ll;
    const tail=length*(1-t);
    // 只处理靠近新墙末端、且越界长度很短的交叉；中段交叉不会破坏两侧有效墙线。
    if(t<0.72||t>0.995||tail<5||tail>maxTail||t<=bestT)return;
    // 若尾段上还有其他墙线或终点处有连接，说明可能是有意保留的结构，不修剪。
    const hasOtherUse=S.walls.some(other=>other!==w&&distToSegment(b,other.a,other.b)<2);
    if(hasOtherUse)return;
    best={x:q.x,y:q.y};bestT=t;
  });
  return best||{x:b.x,y:b.y};
}
function addDrawnWallSegment(a,b,extra={}){
  const end=trimShortWallTail(a,b);
  // 墙线按完整几何记录；入户门洞仅由门图例覆盖显示，不切断墙线数据。
  addRouteSegmentWithEntryGap(a,end,extra);
  return end;
}
const CLOSED_CONNECTION_THRESHOLD = 20; // 自动判断门洞端点接入墙线的允许距离（mm）
function openingEndpointConnected(it, point){
  if(!point)return false;
  return S.walls.some(w=>{
    if(!w||!w.a||!w.b)return false;
    if(w.openingJamb && w.openingOwner===it._openingKey)return false;
    return distToSegment(point,w.a,w.b)<CLOSED_CONNECTION_THRESHOLD;
  });
}
// 门洞两端都接入闭合区域后，才整体隐藏两侧红圈并禁止两端作为墙线起点。
// 门洞两个外端点都连接到其它墙线后，视为完成连接。
function openingEndpointIsClosedRegion(it,point){
  const jambs=getOpeningJambs(it);

  if(!Array.isArray(jambs)||jambs.length!==2){
    return false;
  }

  return jambs.every(seg=>{
    return seg.b && openingEndpointConnected(it,seg.b);
  });
}

// 判断某个坐标是否属于已经完成连接的门洞端点。
function isClosedOpeningEndpoint(point){
  // 保留旧函数名以兼容现有捕捉调用；实际规则改为单个端点作为起点成功画线后立即失效。
  return openingEndpointStartUsed(point);
}

function getCornerPoints(){
  const pts=[];
  // 1) 墙端点聚合：只有被 >=2 条不同墙共用（或不重叠墙端点重合）的位置才算墙角
  const clusters=[];
  S.walls.forEach(w=>{
    [w.a,w.b].forEach(v=>{
      const hit=clusters.find(c=>Math.hypot(c.x-v.x,c.y-v.y)<2);
      if(hit) hit.count++;
      else clusters.push({x:v.x,y:v.y,count:1});
    });
  });
  clusters.forEach(c=>{ if(c.count>=2) pts.push({x:c.x,y:c.y}); });
  // 2) 直线墙线段交叉：排除同一条墙和共享端点的情况
  const segs=[];
  S.walls.forEach((w,wi)=>{
    if(w.arc&&w.bulge) return; // 弧墙不参与线段求交
    segs.push({wi,a:w.a,b:w.b});
  });
  for(let i=0;i<segs.length;i++){
    for(let j=i+1;j<segs.length;j++){
      const s1=segs[i], s2=segs[j];
      if(s1.wi===s2.wi) continue;
      const shared=[s1.a,s1.b].some(p=>[s2.a,s2.b].some(q=>dist(p,q)<2));
      if(shared) continue;
      const p=segIntersect(s1.a,s1.b,s2.a,s2.b);
      if(p && !pts.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<2)) pts.push(p);
    }
  }
  return pts;
}
/* ---------- 测量工具 ---------- */
function measureSnapPoints(){
  const pts=[];
  S.walls.forEach(w=>{
    pts.push(w.a,w.b);
    pts.push(posOnWall(w,0.5)); // 墙中点
  });
  S.items.forEach(it=>{
    if(it.wall!=null&&S.walls[it.wall]){
      const w=S.walls[it.wall];
      const L=w.len||1;
      const h=(it.width/2)/L;
      [it.t-h,it.t,it.t+h].forEach(t=>{
        if(t>=-0.001&&t<=1.001) pts.push(posOnWall(w,Math.max(0,Math.min(1,t))));
      });
    }
    const pos=getPointPos(it);
    if(pos){
      if(pos.kind==='rect'){
        pts.push(
          {x:pos.x0,y:pos.y0},{x:pos.x0+pos.L,y:pos.y0},
          {x:pos.x0+pos.L,y:pos.y0+pos.W},{x:pos.x0,y:pos.y0+pos.W},
          {x:pos.cx,y:pos.cy}
        );
      }else{
        pts.push({x:pos.cx,y:pos.cy});
      }
    }
  });
  getCornerPointsCached().forEach(p=>pts.push(p));
  return pts;
}
let cornerCache = null, cornerCacheTime = 0;
function getCornerPointsCached(){
  const now = Date.now();
  if(!cornerCache || now - cornerCacheTime > 500){
    cornerCache = getCornerPoints();
    cornerCacheTime = now;
  }
  return cornerCache;
}
function measureSnap(cp){
  const pw=world(cp);
  let best=null,bd=200;
  measureSnapPoints().forEach(q=>{
    const d=dist(q,pw);
    if(d<bd){bd=d;best=q;}
  });
  return best?{x:best.x,y:best.y}:pw;
}
function distToSegment(p,a,b){ return ScribeEngine.distanceToSegment(p,a,b); }

/* ---------- 吸附点 ---------- */
function snapPoints(){
  const pts=[];
const wallEnds=[];

S.walls.forEach(w=>{
  [w.a,w.b].forEach(q=>{
    // 门或入户门端点一旦接入墙线，不再作为后续画线的捕捉终点。
    const isEntryEnd=getEntryDoorPoints().some(p=>dist(p,q)<2.5);
    const isOpeningEnd=openingEndpointPointsRaw().some(p=>dist(p,q)<2.5);
    if(isEntryEnd&&entryDoorEndpointConnected(q))return;
    if(isOpeningEnd&&(openingEndpointStartUsed(q)||(S.items||[]).some(it=>it.type==='opening'&&getOpeningJambs(it).some(seg=>seg.b&&dist(seg.b,q)<2.5)&&openingEndpointConnected(it,q))))return;
    if(isClosedOpeningEndpoint(q))return;
    pts.push(q);
    wallEnds.push(q);
  });
});
  S.items.forEach(it=>{
    if(!SNAP_OPEN_TYPES.includes(it.type))return;
    const w=S.walls[it.wall];if(!w)return;
    const L=w.len||1,h=(it.width/2)/L;
    const edgePoints=[];
    [it.t-h,it.t+h].forEach(t=>{
      if(t>=-0.001&&t<=1.001){
        const q=posOnWall(w,Math.max(0,Math.min(1,t)));
        edgePoints.push(q);
        const isOverlap=wallEnds.some(e=>dist(e,q)<1.5);
        if(!isOverlap) pts.push(q);
      }
    });
    // 门洞两条垂直短线的外侧端点也纳入捕捉点
    if(it.type==='opening' && edgePoints.length===2){
      const tA=Math.max(0,Math.min(1,it.t-h)), tB=Math.max(0,Math.min(1,it.t+h));
      const tangentAt=t=>{
        const e=.002, a=posOnWall(w,Math.max(0,t-e)), b=posOnWall(w,Math.min(1,t+e));
        const dx=b.x-a.x,dy=b.y-a.y,ll=Math.hypot(dx,dy)||1;
        return {x:dx/ll,y:dy/ll};
      };
      const thick=Math.max(1,Number(it.frameThick)||Number(w.thick)||Number(S.defaultWallThick)||220);
      [tA,tB].forEach((t,j)=>{
        const q=edgePoints[j], v=tangentAt(t), nx=-v.y, ny=v.x;
        const side=Number(it.side)||getBlankSide(w,t);
        const outer={x:q.x+nx*thick*side,y:q.y+ny*thick*side};
// 门洞两端都连接完成后，不再提供外侧端点吸附。
if(!openingEndpointIsClosedRegion(it,outer)){
  pts.push(outer);
}
      });
    }
  });
  return pts;
}
function getOpeningJambs(it){ return doorModule.getOpeningJambs(it); }
function getOpeningBridgeLine(it){ return doorModule.getOpeningBridgeLine(it); }
function getOpeningEndpointLine(it){ return doorModule.getOpeningEndpointLine(it); }
function syncOpeningBridgeLine(it){ return doorModule.syncOpeningBridgeLine(it); }

function openingEndpointPointsRaw(){
  const pts=[];
  S.items.forEach(it=>{
    if(it.type!=='opening')return;
    const w=S.walls[it.wall];if(!w)return;
    const jambs=getOpeningJambs(it);
    jambs.forEach(seg=>{const q=seg.b;if(q)pts.push({x:q.x,y:q.y});});
  });
  return pts;
}
// 门洞两个外端点分别记录“是否已经作为起点成功画出墙线”，不再依赖门洞整体闭合状态。
function openingEndpointStartUsed(point){
  if(!point)return false;
  return (S.items||[]).some(it=>{
    if(it.type!=='opening')return false;
    const jambs=getOpeningJambs(it);
    return jambs.some((seg,index)=>!!(seg.b && Array.isArray(it.startUsedEndpoints) && it.startUsedEndpoints[index]===true && dist(seg.b,point)<2.5));
  });
}
function consumeOpeningEndpointStart(point){
  if(!point)return false;
  let changed=false;
  (S.items||[]).forEach(it=>{
    if(it.type!=='opening')return;
    const jambs=getOpeningJambs(it);
    jambs.forEach((seg,index)=>{
      if(seg.b&&dist(seg.b,point)<2.5){
        if(!Array.isArray(it.startUsedEndpoints))it.startUsedEndpoints=[false,false];
        it.startUsedEndpoints[index]=true;
        changed=true;
      }
    });
  });
  return changed;
}
// 删除墙体后重新核对门洞端点：若原来连接该端点的墙线已不存在，恢复端点起点资格及红圈标识。
function restoreDisconnectedOpeningEndpoints(){
  let changed=false;
  (S.items||[]).forEach(it=>{
    if(!it||it.type!=='opening'||!Array.isArray(it.startUsedEndpoints))return;
    const jambs=getOpeningJambs(it)||[];
    jambs.forEach((seg,index)=>{
      if(!it.startUsedEndpoints[index])return;
      const stillConnected=!!(seg&&seg.b&&openingEndpointConnected(it,seg.b));
      if(!stillConnected){it.startUsedEndpoints[index]=false;changed=true;}
    });
  });
  return changed;
}
function openingEndpointPoints(){
  return openingEndpointPointsRaw().filter(q=>!openingEndpointStartUsed(q)&&!(S.items||[]).some(it=>it.type==='opening'&&getOpeningJambs(it).some(seg=>seg.b&&dist(seg.b,q)<2.5)&&openingEndpointConnected(it,q)));
}
function nearestOpeningEndpoint(p){
  let best=null,bd=200;const pw=world(p);
  openingEndpointPoints().forEach(q=>{const d=dist(q,pw);if(d<bd){bd=d;best=q;}});
  return best;
}
function entryDoorEndpointConnected(q){
  return (S.walls||[]).some(w=>w&&w.a&&w.b&&distToSegment(q,w.a,w.b)<CLOSED_CONNECTION_THRESHOLD);
}
function isDoorEndpointConsumed(q){
  if(!q)return false;
  if(getEntryDoorPoints().some(p=>dist(p,q)<2.5))return entryDoorEndpointConnected(q);
  return openingEndpointPointsRaw().some(p=>dist(p,q)<2.5)&&entryDoorEndpointConnected(q);
}
// 入户门两个端点都接入闭合区域后，才整体隐藏红圈并禁止两端作为起点。
function entryDoorEndpointIsClosedRegion(q){
  const ends=getEntryDoorPoints();if(ends.length!==2)return false;
  const loops=drawingRoomLoopsCache!==undefined?drawingRoomLoopsCache:roomLoops();
  return ends.every(p=>entryDoorEndpointConnected(p)&&(loops||[]).some(loop=>pointOnPolygonBoundary(p,loop.points,CLOSED_CONNECTION_THRESHOLD)));
}
function wallStartPoints(){
  const entryPts=getEntryDoorPoints().filter(q=>!entryDoorEndpointConnected(q));
  const pts=[...entryPts,...openingEndpointPoints()];
  S.walls.forEach((w,i)=>{
    [w.a,w.b].forEach(q=>{
      // 入户门端点已由专用逻辑管理；不能再次作为普通墙线起点。
      if(getEntryDoorPoints().some(p=>dist(p,q)<2))return;
	  // 已完成连接的门洞端点禁止再次作为墙线起点
if(isClosedOpeningEndpoint(q))return;
      // 端点若与其他墙段相交、相接或落在其他墙段内部，不作为墙线起点。
      const connected=S.walls.some((other,j)=>{
        if(i===j)return false;
        return distToSegment(q,other.a,other.b)<2;
      });
      if(!connected)pts.push({x:q.x,y:q.y});
    });
  });
  const unique=[];
  pts.forEach(q=>{if(q&& !unique.some(v=>dist(v,q)<1))unique.push(q)});
  return unique;
}
function nearestWallAnchor(p,excludePoint=null,maxDistance=600){
  let best=null,bd=maxDistance;const pw=world(p);
  wallStartPoints().forEach(q=>{
    // 当前墙段的起点不能再次成为自己的终点。
    if(excludePoint&&dist(q,excludePoint)<2.5)return;
    const d=dist(q,pw);if(d<bd){bd=d;best=q;}
  });
  return best?{x:best.x,y:best.y}:null;
}
function nearestEndpoint(p,maxDistance=20,excludePoint=null){
  let best=null,bdW=maxDistance;const pw=world(p);
  snapPoints().forEach(q=>{
    // 墙线刚起笔时，暂时排除自身起点，避免一开始就被识别为闭合点。
    if(excludePoint && dist(q,excludePoint)<2.5)return;
    const d=dist(q,pw);if(d<bdW){bdW=d;best=q;}
  });
  return best?{x:best.x,y:best.y}:null;
}
// 房间矩形专用捕捉：墙体端点和每段墙线中点均可捕捉，阈值按屏幕像素计算。
function nearestRoomSnap(p,maxPixels=22){
  const pw=world(p);let best=null,bd=maxPixels;
  (S.walls||[]).forEach(w=>{
    const candidates=[w.a,w.b,posOnWall(w,.5)];
    candidates.forEach(q=>{const d=dist(screen(q),p);if(d<bd){bd=d;best=q;}});
  });
  return best?{x:best.x,y:best.y}:null;
}

function nearestParallelEndpoint(p, start){
  const pw=world(p), baseDx=pw.x-start.x, baseDy=pw.y-start.y, baseLen=Math.hypot(baseDx,baseDy);
  if(baseLen<1) return null;
  const ux=baseDx/baseLen,uy=baseDy/baseLen;
  let best=null,bd=200;
  S.walls.forEach(w=>{
    const dx=w.b.x-w.a.x,dy=w.b.y-w.a.y,ll=Math.hypot(dx,dy)||1;
    const parallel=Math.abs((dx/ll)*ux+(dy/ll)*uy);
    if(parallel<Math.cos(8*Math.PI/180)) return;
    [w.a,w.b].forEach(q=>{
      const d=dist(q,pw);
      if(d<bd){bd=d;best=q;}
    });
  });
  return best;
}

function nearestPerpendicularIntersection(start, cursor){
  const vx=cursor.x-start.x, vy=cursor.y-start.y, vl=Math.hypot(vx,vy);
  if(vl<1) return null;
  const ux=vx/vl, uy=vy/vl;
  let best=null, bestPx=10;
  for(let i=0;i<S.walls.length;i++){
    const w=S.walls[i];
    const sx=w.b.x-w.a.x, sy=w.b.y-w.a.y, sl=Math.hypot(sx,sy)||1;
    // 目标边线需与当前画线方向近似垂直（允许约12度误差）
    if(Math.abs((ux*sx+uy*sy)/sl)>Math.sin(12*Math.PI/180)) continue;
    const den=vx*sy-vy*sx;
    if(Math.abs(den)<1e-8) continue;
    const ax=w.a.x-start.x, ay=w.a.y-start.y;
    const rayT=(ax*sy-ay*sx)/den;
    const segT=(ax*vy-ay*vx)/den;
    if(rayT<0 || segT<0 || segT>1) continue;
    const q={x:start.x+vx*rayT,y:start.y+vy*rayT};
    // 避免垂直求交把当前墙段的起点再次作为终点。
    if(dist(q,start)<25)continue;
    const px=dist(screen(q),screen(cursor));
    if(px<bestPx){bestPx=px;best=q;}
  }
  return best;
}

// 画墙时检测已有端点的横/纵坐标对齐位置：鼠标进入投影点26px范围内才触发。
function nearestAxisAlignedEndpointHint(start, cursor, maxDistance=26/Math.max(scale,.001)){
  const dx=cursor.x-start.x, dy=cursor.y-start.y;
  let axis=null, dir=0;
  // 仅对当前已经正交锁定的墙线生效；斜线绘制不触发。
  if(Math.abs(dy)<0.5 && Math.abs(dx)>25){ axis='x'; dir=Math.sign(dx); }
  else if(Math.abs(dx)<0.5 && Math.abs(dy)>25){ axis='y'; dir=Math.sign(dy); }
  if(!axis || !dir) return null;

  const base=axis==='x'?start.x:start.y;
  const current=axis==='x'?cursor.x:cursor.y;
  const fixed=axis==='x'?start.y:start.x;
  let best=null, bestGap=Infinity;

  // snapPoints 包含墙端点及门窗等构件端点，统一参与坐标对齐判断。
  (snapPoints()||[]).forEach(ep=>{
    if(!ep) return;
    const coord=axis==='x'?ep.x:ep.y;
    const cross=axis==='x'?ep.y:ep.x;
    // 端点本身已在当前墙线轴线上时，交给原有端点吸附/连接逻辑处理。
    if(Math.abs(cross-fixed)<3) return;
    // 只检测从起点朝当前绘制方向前方的对齐坐标。
    const along=(coord-base)*dir;
    if(along<25) return;
    const gap=Math.abs(current-coord);
    if(gap>maxDistance || gap>=bestGap) return;

    const point=axis==='x'?{x:coord,y:start.y}:{x:start.x,y:coord};
    bestGap=gap;
    best={axis,point,endpoint:{x:ep.x,y:ep.y},gap,key:axis+':'+Math.round(coord)};
  });
  return best;
}

function pointOnWall(p){
  let best=null,bd=1e9;
  S.walls.forEach((w,i)=>{
    const N=(w.arc&&w.bulge)?24:1;
    for(let k=0;k<N;k++){
      const t0=k/N,t1=(k+1)/N;
      const q0=screen(posOnWall(w,t0)),q1=screen(posOnWall(w,t1));
      const dx=q1.x-q0.x,dy=q1.y-q0.y,l=dx*dx+dy*dy;
      let u=l?((p.x-q0.x)*dx+(p.y-q0.y)*dy)/l:0;
      u=Math.max(0,Math.min(1,u));
      const q={x:q0.x+u*dx,y:q0.y+u*dy},d=dist(p,q);
      if(d<bd){bd=d;best={i,t:t0+(t1-t0)*u,q}}
    }
  });
  return bd<25?best:null;
}

/* ---------- DXF 标签 ---------- */
function dxfLabel(it){
  const Wd=String(it.width).padStart(4,'0');
  const defH=it.type==='opening'?2100:2400;
  const H=it.height||defH;
  if(it.type==='opening') return 'MD'+Wd+'H'+H;
  if(it.type==='window') return 'CH'+Wd+'H'+H+'（距地'+(it.sill||0)+'）';
  if(it.type==='special') return 'DY'+String(it.name||it.specialName||'特殊标识').trim()+Wd+'H'+H;
  if(it.type==='bay') return 'CP'+Wd+'H'+H+'（距地'+(it.sill||0)+'深度'+(it.depth||0)+'）';
  if(it.type==='powerBox') return 'QD'+Wd+'H'+(it.height||300)+'(距地'+(it.sill||0)+')';
  if(it.type==='weakBox') return 'RD'+Wd+'H'+(it.height||300)+'(距地'+(it.sill||0)+')';
  return it.label||types[it.type]||'';
}

/* ---------- DXF 中文转义 ---------- */

/* ---------- 撤销 / 重做 + 自动持久化 ---------- */
let persistTimer=null;
function persist(){
  if(persistTimer)clearTimeout(persistTimer);
  persistTimer=setTimeout(()=>{
    try{
      const copy=Object.assign({},S);
      copy.measures=Array.isArray(S.measures)?S.measures:[]; // 测量记录随图纸一起缓存
      localStorage.setItem(KEY, JSON.stringify(copy));
    }catch(e){}
  },300);
}
function saveUndo(){
  try{
    const snapshot=JSON.stringify(S);
    if(undoStack[undoStack.length-1]!==snapshot)undoStack.push(snapshot);
    if(undoStack.length>100)undoStack.shift();
    redoStack.length=0;
    return snapshot;
  }catch(error){console.error('[立诺量房] 保存撤销快照失败',error);return null;}
}
function discardUndoSnapshot(snapshot){
  if(snapshot&&undoStack.length&&undoStack[undoStack.length-1]===snapshot)undoStack.pop();
}
function restoreHistoryState(snapshot){
  if(!snapshot)return false;
  try{
    S=JSON.parse(snapshot);
    if(!S||!Array.isArray(S.walls)||!Array.isArray(S.items))throw new Error('图纸快照格式无效');
    if(!Array.isArray(S.texts))S.texts=[];
    if(!Array.isArray(S.measures))S.measures=[];
    chain=null;if(chainTimer)clearTimeout(chainTimer);chainTimer=null;
    draft=null;pending=null;preview=null;dragItem=null;dragWallEndpoint=null;
    editWallIndex=-1;editEnd=null;selectedWall=-1;pointEditIndex=-1;tapEditItem=null;
    if($('heightInp'))$('heightInp').value=S.height||2700;
    if($('wallThickInp'))$('wallThickInp').value=S.defaultWallThick||220;
    cornerCache=null;drawingRoomLoopsCache=undefined;
    persist();draw();return true;
  }catch(error){console.error('[立诺量房] 撤销/恢复失败',error);showToast('撤销/恢复失败：图纸数据无法读取');return false;}
}
function undoAction(){
  if(!undoStack.length){showToast('没有可撤销的操作');return;}
  const current=JSON.stringify(S),previous=undoStack.pop();
  redoStack.push(current);
  if(!restoreHistoryState(previous)){redoStack.pop();undoStack.push(previous);}
}
function redoAction(){
  if(!redoStack.length){showToast('没有可恢复的操作');return;}
  const current=JSON.stringify(S),next=redoStack.pop();
  undoStack.push(current);
  if(!restoreHistoryState(next)){undoStack.pop();redoStack.push(next);}
}

/* ---------- 画布尺寸 ---------- */
function resize(){
  const r=work.getBoundingClientRect();
  W=Math.max(1,r.width);H=Math.max(1,r.height);
  dpr=devicePixelRatio||1;
  cv.width=W*dpr;cv.height=H*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  if(!initialCanvasSized){
    scale=Math.min((W-32)/30000,(H-32)/30000);
    scale=Math.max(0.006,Math.min(0.08,scale));
    fitBaseScale=scale;origin={x:W/2,y:H/2};initialCanvasSized=true;
  }else if(!origin.x&&!origin.y)origin={x:W/2,y:H/2};
  draw();
}

/* ---------- 绘制：墙体 ---------- */
function wallEndBlockLengthOnWall(w,it){ return otherModule.wallEndBlockLengthOnWall(w,it); }

function wallDimensionSide(w,index){
  // getBlankSide 返回空白侧；屏幕坐标Y轴向下，因此直接作为屏幕法线侧使用，
  // 可让墙长尺寸落在闭合空间内部，而不是依赖“最近平行墙”的猜测。
  const side=Number(getBlankSide(w,0.5));
  if(side===1||side===-1)return side;
  return 1;
}
function drawWallDimensionText(P,t,text,color,w,index){
  const mid=ptOnPath(P,t),q1=ptOnPath(P,Math.max(0,t-0.025)),q2=ptOnPath(P,Math.min(1,t+0.025));
  let ang=Math.atan2(q2.y-q1.y,q2.x-q1.x);if(ang>Math.PI/2||ang<-Math.PI/2)ang+=Math.PI;
  const dx=q2.x-q1.x,dy=q2.y-q1.y,ll=Math.hypot(dx,dy)||1,nx=-dy/ll,ny=dx/ll;
  const side=wallDimensionSide(w,index),gap=2;
  const inward={x:nx*side,y:ny*side};
  // 文字旋转后，按所选内侧法线决定以文字上沿还是下沿贴近墙线。
  const textDown={x:-Math.sin(ang),y:Math.cos(ang)};
  const baseline=(textDown.x*inward.x+textDown.y*inward.y)>=0?'top':'bottom';
  ctx.save();ctx.translate(mid.x+inward.x*gap,mid.y+inward.y*gap);ctx.rotate(ang);
  ctx.fillStyle=color;ctx.font='7.7px sans-serif';ctx.textAlign='center';ctx.textBaseline=baseline;
  ctx.fillText(String(text),0,0);ctx.restore();
}

function wallDraw(w,i){
  const P=screenPath(w);
  const scrLen=pathScreenLen(P);
  if(scrLen<2)return;
  const L=w.len||dist(w.a,w.b)||1;
  const att=S.items.filter(it=>it.wall===i&&types[it.type]);
  // 只有门窗类构件才留洞，电箱是不留洞的
  // 所有构件（包括门洞、入户门、窗、飘窗、电箱）均为墙线上的叠加图形。
  // 不再按构件宽度留白；墙体基础线始终完整绘制，避免移动/删除后出现断线。
  const gaps=[];

  const drawRange=(t0,t1)=>{
    if(t1-t0<1e-6)return;
    ctx.beginPath();
    if(!P.C){
      const p0=ptOnPath(P,t0),p1=ptOnPath(P,t1);
      ctx.moveTo(p0.x,p0.y);ctx.lineTo(p1.x,p1.y);
    }else{
      const N=Math.max(2,Math.ceil((t1-t0)*48));
      for(let k=0;k<=N;k++){
        const q=ptOnPath(P,t0+(t1-t0)*k/N);
        k?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);
      }
    }
    ctx.stroke();
  };

  ctx.lineCap='square';ctx.lineWidth=2;
  // 八角斜墙创建后与普通墙线统一使用黑色；选中状态仍显示蓝色。
  ctx.strokeStyle=(i===selectedWall?'#2878df':'#27364a');
  let cursor=0;
  gaps.forEach(g=>{drawRange(cursor/scrLen,g.l/scrLen);cursor=Math.max(cursor,g.r)});
  drawRange(cursor/scrLen,1);

    // 先计算所有分割点（门窗、强弱电箱、吸附到墙端点的柱/烟道）
  const splitGaps = att.filter(it=>types[it.type]).map(it=>({
    l:Math.max(0,it.t-(it.width/2)/L)*scrLen,
    r:Math.min(scrLen,it.t+(it.width/2)/L)*scrLen
  })).filter(g=>g.r>g.l);

  // 柱、烟道不参与墙体分段，避免移动构件后暴露被切断的墙线。

  splitGaps.sort((a,b)=>a.l-b.l);

  // 构建实际要显示的墙段（容差改为 0，5mm 段也会被切出来）
  const segs = [];
  if(splitGaps.length){
    let cur=0;
    splitGaps.forEach(g=>{
      if(g.l>cur) segs.push([cur,g.l]);
      cur=Math.max(cur,g.r);
    });
    if(scrLen>cur) segs.push([cur,scrLen]);
  }

  // 有绿色分段尺寸时不再显示总长度；没有分段时才显示总长
  if(segs.length===0){
    drawWallDimensionText(P,0.5,Math.round(w.len),'#1677e8',w,i);
  }

  // 每段都显示绿色尺寸（哪怕 5mm 也显示，不再过滤短段）
  segs.forEach(([p0,p1])=>{
    const t0=p0/scrLen, t1=p1/scrLen;
    const segLen=(t1-t0)*w.len;
    if(segLen<=0) return;
    const tm=(t0+t1)/2;
    drawWallDimensionText(P,tm,Math.round(segLen),'#0a9f60',w,i);
  });

  att.forEach(it=>drawOpening(it,w,P,scrLen));
}

/* ---------- 绘制：门窗 ---------- */
function drawOpening(it,w,P,scrLen){ return doorModule.drawOpening(it,w,P,scrLen); }

/* ---------- 绘制：点状构件 ---------- */
function drawPointItem(it){ return otherModule.drawPointItem(it); }

/* ---------- 入户门起笔标识 ---------- */
function getEntryDoorPoints(){ return doorModule.getEntryDoorPoints(); }
function getEntryInsideSide(){ return doorModule.getEntryInsideSide(); }
function entryDoorGeometry(){ return doorModule.entryDoorGeometry(); }
function hitEntryDoor(p){ return doorModule.hitEntryDoor(p); }
function drawEntryDoor(){ return doorModule.drawEntryDoor(); }

/* 入户门参数：点击门体后可直接修改层高、墙厚、门宽、门高及距地高度。 */
/* 入户门参数：点击门体后可直接修改层高、墙厚、门宽、门高及距地高度。
   保存按钮已隐藏，改由数字键盘 ✓ 触发（id 保留为 saveEntryDoor，供键盘派发点击）。
   两侧边距沿门线向内收进；点“切换”可互换起点/终点，决定边距从哪一端起算。 */
function entryDoorEditor(){ return doorModule.entryDoorEditor(); }

/* ---------- 主绘制 ---------- */
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#f3f6fb';ctx.fillRect(0,0,W,H);
  drawingRoomLoopsCache=undefined;
  if(S.entryDoor||(S.items||[]).some(it=>it.type==='opening'))drawingRoomLoopsCache=roomLoops();
  
  ctx.save();
  ctx.translate(W/2, H/2);
  ctx.rotate(viewAngle);
  ctx.translate(-W/2, -H/2);

  ctx.strokeStyle='#dce5f0';ctx.lineWidth=1;
  const gap=Math.max(14,100*scale);
  for(let x=((origin.x%gap)+gap)%gap;x<W;x+=gap){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}
  for(let y=((origin.y%gap)+gap)%gap;y<H;y+=gap){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}

  S.walls.forEach(wallDraw);
  drawEntryDoor();
  // 未连接墙端点也允许作为起点，并以红圈提示。
  ctx.save();ctx.strokeStyle='#e53935';ctx.fillStyle='rgba(255,255,255,.96)';ctx.lineWidth=1.5;
S.walls.forEach((w,i)=>[w.a,w.b].forEach(q=>{
    if(getEntryDoorPoints().some(p=>dist(p,q)<2))return;

    // 门洞两个端点都连接后，不再显示连接墙端点的红圈
    if(isClosedOpeningEndpoint(q))return;

    const connected=S.walls.some(
      (other,j)=>i!==j&&distToSegment(q,other.a,other.b)<2
    );
    if(connected)return;const z=screen(q);const rr=Math.max(2.5,25*scale);
    ctx.beginPath();ctx.arc(z.x,z.y,rr,0,Math.PI*2);ctx.fill();ctx.stroke();
  }));ctx.restore();

  // 门洞两侧的蓝色虚线分割线采用独立叠加绘制，确保始终显示在墙体上层。
  ctx.save();
  ctx.strokeStyle='#2878df';ctx.lineWidth=1.8;ctx.lineCap='round';ctx.setLineDash([6,4]);
  S.items.filter(it=>it.type==='opening').forEach(it=>{
    const jambs=getOpeningJambs(it);
    if(!jambs||jambs.length!==2)return;
    // 矩形图例的外侧边作为门洞蓝色虚线分界线。
    const p0=screen(jambs[0].b),p1=screen(jambs[1].b);
    ctx.beginPath();ctx.moveTo(p0.x,p0.y);ctx.lineTo(p1.x,p1.y);ctx.stroke();
  });
  ctx.setLineDash([]);ctx.restore();

 
  S.items.filter(it=>pointTypes[it.type]).forEach(drawPointItem);
  // 测量结果与草稿
  (S.measures||[]).forEach(m=>{
    const A=screen(m.a),B=screen(m.b);
    ctx.save();
    ctx.strokeStyle='#e53935';ctx.lineWidth=1.5;ctx.setLineDash([6,4]);
    ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='#e53935';
    [A,B].forEach(q=>{ctx.beginPath();ctx.arc(q.x,q.y,4,0,Math.PI*2);ctx.fill();});
    const dm=Math.round(dist(m.a,m.b));
    ctx.fillStyle='#e53935';ctx.font='bold 15.4px sans-serif';ctx.textAlign='center';
    ctx.fillText(String(dm),(A.x+B.x)/2,(A.y+B.y)/2-6);
    ctx.restore();
  });
  if(measureA){
    const A=screen(measureA);
    const Bp=measurePreview?screen(measurePreview):A;
    ctx.save();
    // 起点：大圈 + 白边 + 十字 + 文字提示，保证第一次点击立刻可见
    ctx.fillStyle='#e53935';
    ctx.beginPath();ctx.arc(A.x,A.y,8,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(A.x,A.y,8,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='#e53935';ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.moveTo(A.x-11,A.y);ctx.lineTo(A.x+11,A.y);
    ctx.moveTo(A.x,A.y-11);ctx.lineTo(A.x,A.y+11);
    ctx.stroke();
    ctx.fillStyle='#e53935';ctx.font='7.7px sans-serif';ctx.textAlign='left';
    ctx.fillText('起点',A.x+14,A.y-10);
    // 预览线
    if(measurePreview && dist(measureA,measurePreview)>1){
      ctx.strokeStyle='#e53935';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);
      ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(Bp.x,Bp.y);ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='#e53935';
      ctx.beginPath();ctx.arc(Bp.x,Bp.y,4,0,Math.PI*2);ctx.fill();
      const dm=Math.round(dist(measureA,measurePreview));
      ctx.fillStyle='#e53935';ctx.font='bold 15.4px sans-serif';ctx.textAlign='center';
      ctx.fillText(String(dm),(A.x+Bp.x)/2,(A.y+Bp.y)/2-6);
    }
    ctx.restore();
  }
  S.texts.forEach((t,i)=>{
    const p=screen(t.p);
    
    // 强制带箭头文本的旧默认字号从 15 变为 7
    let fs = t.fontSize || 7;
    if (t.arrow && fs === 15) fs = 7; 
    
    const txt=t.text||'输入文字';
    
    // 量房文字引线与图片标记共用线型、箭头样式设置
    if (t.arrow) {
      const ap = screen(t.arrow);
      const arrowStyle = (window.LinuoBase?.getStorage('linuo_arrow_style','dot') || 'dot');
      const lineStyle = (window.LinuoBase?.getStorage('linuo_line_style','dashed') || 'dashed');
      ctx.save();
      ctx.strokeStyle = '#1d426b';
      ctx.fillStyle = '#1d426b';
      ctx.lineWidth = Math.max(0.7, fs * 0.08);
      ctx.setLineDash(lineStyle === 'dashed' ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ap.x, ap.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const ang = Math.atan2(ap.y - p.y, ap.x - p.x);
      const arrowSize = Math.max(2.5, fs * 0.4);
      if (arrowStyle === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(ap.x, ap.y);
        ctx.lineTo(ap.x - arrowSize * Math.cos(ang - 0.45), ap.y - arrowSize * Math.sin(ang - 0.45));
        ctx.lineTo(ap.x - arrowSize * Math.cos(ang + 0.45), ap.y - arrowSize * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      } else if (arrowStyle === 'tick') {
        const tx = -Math.sin(ang), ty = Math.cos(ang);
        ctx.beginPath();
        ctx.moveTo(ap.x - tx * arrowSize * 0.7, ap.y - ty * arrowSize * 0.7);
        ctx.lineTo(ap.x + tx * arrowSize * 0.7, ap.y + ty * arrowSize * 0.7);
        ctx.stroke();
      } else if (arrowStyle === 'dot') {
        ctx.beginPath();
        ctx.arc(ap.x, ap.y, Math.max(1.8, arrowSize * 0.35), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(p.x,p.y);
    ctx.rotate(-(t.angle||0));
ctx.fillStyle=t.color||'#1677e8';
ctx.font=fs+'px sans-serif';
ctx.textAlign='left';
ctx.textBaseline='bottom';
    ctx.fillText(txt,0,0);
    
    if(i===selectedText){
      const w=ctx.measureText(txt).width;
      ctx.strokeStyle='#2878df';ctx.lineWidth=1;ctx.setLineDash([4,3]);
      ctx.strokeRect(0,-fs*0.9,w,fs*1.25);
      ctx.setLineDash([]);
      /* 单个缩放手柄，位于文本右下角，固定不随文本旋转 */
      ctx.fillStyle='#2878df';
      ctx.beginPath();ctx.arc(w,fs*0.6,7,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#fff';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(w,fs*0.6,7,0,Math.PI*2);ctx.stroke();
      
      // 如果有箭头，在箭头端点画一个选中圆圈
      if(t.arrow) {
        const ap = screen(t.arrow);
        ctx.fillStyle='#2878df';
        ctx.beginPath();ctx.arc(ap.x,ap.y,6,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle='#fff';ctx.lineWidth=1.5;
        ctx.beginPath();ctx.arc(ap.x,ap.y,6,0,Math.PI*2);ctx.stroke();
      }
    }
    ctx.restore();
  });

  if(draft&&draft.b){
    ctx.save();
    ctx.strokeStyle='#247de0';ctx.lineWidth=3;ctx.setLineDash([6,4]);
    if(draft.kind==='rect'){
      /* 拖动中的矩形由 pending 绘制，此处不再重复 */
    }else if(draft.kind==='arc'){
      const tmp={a:draft.a,b:draft.b,arc:true,bulge:draft.bulge||0};
      const P=screenPath(tmp);
      ctx.beginPath();
      if(!P.C){ctx.moveTo(P.A.x,P.A.y);ctx.lineTo(P.B.x,P.B.y)}
      else{for(let k=0;k<=24;k++){const q=ptOnPath(P,k/24);k?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)}}
      ctx.stroke();
    }else if(draft.kind==='text'){
      const ptA=screen(draft.a); // 箭头指向点
      const ptB=screen(draft.b); // 文本位置点
      ctx.lineWidth = 0.5; // 预览线条变细
      ctx.beginPath();ctx.moveTo(ptB.x,ptB.y);ctx.lineTo(ptA.x,ptA.y);ctx.stroke();
      const ang=Math.atan2(ptA.y-ptB.y,ptA.x-ptB.x);
      const as=3; // 预览箭头变小
      ctx.beginPath();
      ctx.moveTo(ptA.x,ptA.y);
      ctx.lineTo(ptA.x-as*Math.cos(ang-Math.PI/6), ptA.y-as*Math.sin(ang-Math.PI/6));
      ctx.lineTo(ptA.x-as*Math.cos(ang+Math.PI/6), ptA.y-as*Math.sin(ang+Math.PI/6));
      ctx.closePath();
      ctx.fillStyle='#247de0';ctx.fill();
      ctx.fillStyle='#1d426b';ctx.font='7px sans-serif';ctx.textAlign='left';
      ctx.fillText('输入文字', ptB.x, ptB.y);
    }else{
      const a=screen(draft.a),b=screen(draft.b);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    if(draft.near){
      const np=screen(draft.near);
      const isClose=dist(draft.near,draft.a)<50;
      ctx.setLineDash([]);
      ctx.strokeStyle=isClose?'#e53935':'#0a9f60';
      ctx.lineWidth=2.5;
      ctx.beginPath();ctx.arc(np.x,np.y,10,0,Math.PI*2);ctx.stroke();
      // 提示文字改由右上角放大镜显示，避免手指遮挡
    }
    if(draft.axisNear){
      const hint=draft.axisNear,np=screen(hint.point),ep=hint.endpoint?screen(hint.endpoint):null;
      ctx.save();
      // 对齐点及其对应的原始端点同时以绿色圆圈亮显，明确提示是哪两个坐标发生对应。
      ctx.strokeStyle='#16a34a';ctx.fillStyle='rgba(34,197,94,.13)';ctx.lineWidth=2.5;
      [np,ep].filter(Boolean).forEach(z=>{ctx.beginPath();ctx.arc(z.x,z.y,11,0,Math.PI*2);ctx.fill();ctx.stroke();});
// 对齐辅助线：沿相同坐标方向向两侧延伸，覆盖整个操作视口。
ctx.save();
ctx.lineWidth=1;
ctx.lineCap='butt';
ctx.setLineDash([4,4]);

const reach=Math.hypot(W,H)*2;

ctx.beginPath();

if(hint.axis==='x'){
  // X坐标相同：绘制垂直辅助线，向上下两侧延伸
  ctx.moveTo(np.x,np.y-reach);
  ctx.lineTo(np.x,np.y+reach);
}else{
  // Y坐标相同：绘制水平辅助线，向左右两侧延伸
  ctx.moveTo(np.x-reach,np.y);
  ctx.lineTo(np.x+reach,np.y);
}

ctx.stroke();
ctx.restore();
      ctx.fillStyle='#15803d';ctx.font='bold 12px sans-serif';ctx.textAlign='left';
      ctx.fillText(hint.axis.toUpperCase()+'坐标对齐',np.x+13,np.y-12);
      ctx.restore();
    }
    ctx.restore();
  }

  if(pending&&pending.kind==='room'){
    const a=pending.a, b=pending.b;
    const p0=screen({x:Math.min(a.x,b.x), y:Math.min(a.y,b.y)});
    const p1=screen({x:Math.max(a.x,b.x), y:Math.max(a.y,b.y)});
    ctx.save();
    ctx.strokeStyle='#247de0';ctx.lineWidth=3;ctx.setLineDash([6,4]);
    ctx.strokeRect(Math.min(p0.x,p1.x),Math.min(p0.y,p1.y),Math.abs(p1.x-p0.x),Math.abs(p1.y-p0.y));
    ctx.restore();
    const cp=screen({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
    ctx.save();
    ctx.fillStyle='#247de0';ctx.font='8.4px sans-serif';ctx.textAlign='center';
    ctx.fillText(Math.round(Math.abs(b.x-a.x))+' × '+Math.round(Math.abs(b.y-a.y)),cp.x,cp.y);
    ctx.restore();
  }

  if(pending&&pending.a&&pending.b&&pending.bulge!==undefined){
    const tmp={a:pending.a,b:pending.b,arc:true,bulge:pending.bulge};
    const P=screenPath(tmp);
    ctx.save();
    ctx.strokeStyle='#247de0';ctx.lineWidth=3;ctx.setLineDash([6,4]);
    ctx.beginPath();
    if(!P.C){ctx.moveTo(P.A.x,P.A.y);ctx.lineTo(P.B.x,P.B.y)}
    else{for(let k=0;k<=48;k++){const q=ptOnPath(P,k/48);k?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)}}
    ctx.stroke();
    ctx.setLineDash([]);
    const mid=ptOnPath(P,0.5);
    ctx.fillStyle='#247de0';ctx.font='7.7px sans-serif';ctx.textAlign='center';
    ctx.fillText('矢高 '+Math.round(pending.bulge)+' mm',mid.x,mid.y-10);
    ctx.restore();
  }

  if(editWallIndex>=0&&editEnd&&S.walls[editWallIndex]){
    const w=S.walls[editWallIndex];
    const p=screen(w[editEnd]);
    ctx.save();
    ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);
    ctx.strokeStyle='#e53935';ctx.lineWidth=2.5;ctx.stroke();
    ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);
    ctx.fillStyle='#e53935';ctx.fill();
    ctx.restore();
  }

  drawPreview();

  // 路径规划预览
  if(routePreview&&Array.isArray(routePreview.points)&&routePreview.points.length>1){
    ctx.save();
    ctx.strokeStyle='#ef7d32';
    ctx.lineWidth=2.4;
    ctx.setLineDash([7,4]);
    ctx.beginPath();

    routePreview.points.forEach((q,i)=>{
      const z=screen(q);
      i?ctx.lineTo(z.x,z.y):ctx.moveTo(z.x,z.y);
    });

    ctx.stroke();
    ctx.setLineDash([]);

    routePreview.points.slice(1,-1).forEach(q=>{
      const z=screen(q);
      ctx.beginPath();
      ctx.arc(z.x,z.y,4,0,Math.PI*2);
      ctx.fillStyle='#ef7d32';
      ctx.fill();
    });

    ctx.restore();
  }

  // 手动选择的规划起点：蓝色圆圈标识
  if(routePlanStart&&tool==='routePlan'){
    const z=screen(routePlanStart);

    ctx.save();

    ctx.beginPath();
    ctx.arc(z.x,z.y,13,0,Math.PI*2);
    ctx.strokeStyle='#1677e8';
    ctx.lineWidth=3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(z.x,z.y,4,0,Math.PI*2);
    ctx.fillStyle='#1677e8';
    ctx.fill();

    ctx.font='bold 12px sans-serif';
    ctx.textAlign='center';
    ctx.textBaseline='bottom';
    ctx.fillStyle='#1677e8';
    ctx.fillText('规划起点',z.x,z.y-17);

    ctx.restore();
  }

  if(snapHint){
    ctx.save();
    ctx.strokeStyle='#0a9f60';ctx.lineWidth=2.5;
    ctx.beginPath();ctx.arc(snapHint.x,snapHint.y,10,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#0a9f60';
    ctx.beginPath();ctx.arc(snapHint.x,snapHint.y,3,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }

  // ----- 自动绘制封闭空间区域名称 -----
  if (typeof roomLoops === 'function') {
    try {
      const rooms = drawingRoomLoopsCache!==undefined?drawingRoomLoopsCache:roomLoops();
      if (rooms && rooms.length > 0) {
        // 利用质心排序，确保序号按从上到下、从左到右的顺序稳定排布
        const sortedRooms = [...rooms].map(room => {
          let area = 0, cx = 0, cy = 0;
          const pts = room.points;
          if (!pts || pts.length === 0) return null;
          for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
            const p1 = pts[j], p2 = pts[k];
            const f = p1.x * p2.y - p2.x * p1.y;
            cx += (p1.x + p2.x) * f;
            cy += (p1.y + p2.y) * f;
            area += f * 3;
          }
          if (area === 0) { cx = pts[0].x; cy = pts[0].y; }
          else { cx = cx / area; cy = cy / area; }
          return { cx, cy };
        }).filter(r => r !== null).sort((a, b) => a.cy - b.cy || a.cx - b.cx);

        ctx.save();
        ctx.fillStyle = '#94a3b8'; // 采用浅灰蓝色，不抢主体颜色
        ctx.font = '7px sans-serif'; // 严格按照要求设为 7px
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        sortedRooms.forEach((r, i) => {
          const p = screen({x: r.cx, y: r.cy});
          const roomId = Math.round(r.cx) + '_' + Math.round(r.cy);
          const customName = (S.roomNames && S.roomNames[roomId]) ? S.roomNames[roomId] : ('区域 ' + (i + 1));
          ctx.fillText(customName, p.x, p.y);
        });
        ctx.restore();
      }
    } catch (e) {
      // 防止绘制时发生异常导致画布卡死
    }
  }
  
  ctx.restore(); // 恢复画布旋转

  // 绘图期间始终放大当前移动点：无论是否捕捉、是否处于密集区域，
  // 都以实际预览终点为中心，方便观察细小墙角、端点和缝隙。
  if(draft){
    const movingPoint=draft.b||draft.a;
    const isClose=!!(draft.near&&draft.a&&dist(draft.near,draft.a)<50);
    const isArc=draft.kind==='arc';
    const lbl=draft.near
      ? (isClose?'松开闭合':(draft.perpendicular?'横竖交点已捕捉':'已捕捉端点'))
      : (isArc?'弧线终点预览':(draft.kind==='text'?'文本定位':(draft.kind==='rect'?'房间终点':'移动点 · 未捕捉')));
    const bgc=draft.near?(isClose?'rgba(229,57,53,.94)':'rgba(10,159,96,.94)'):'rgba(31,111,210,.94)';
    updateMagnifier(screen(movingPoint),lbl,bgc);
  } else if(dragItem){
    // 拖动已放置的点状构件：以构件当前位置为中心显示放大图
    const it=getDragItemObj();
    if(it){
      const pos=getPointPos(it);
      if(pos){
        const sp=screen({x:pos.cx,y:pos.cy});
        const lbl=pointTypes[it.type]||types[it.type]||it.type||'构件';
        updateMagnifier(sp, lbl, 'rgba(31,111,210,.92)');
      }
    }
  } else if(!(legendDrag && legendDrag.moved)){
    updateMagnifier(null);
  }

  /* 自动记忆（debounce 300ms，拖动中不触发频繁写入） */
  persist();
}

/* ---------- 实时预览 ---------- */
function drawPreview(){
  if(draft&&draft.kind==='pointPlace'){
    const wp=draft.b||draft.a,p=screen(wp);
    const cfg={drain:110,floorDrain:75,groundDrain:110,sewer:110,column:300,chimney:500};
    const size=cfg[draft.type]||110,half=Math.max(8,size*.5*scale);
    ctx.save();ctx.strokeStyle='#e53935';ctx.fillStyle='rgba(229,57,53,.08)';ctx.lineWidth=2;ctx.setLineDash([5,3]);
    if(draft.type==='column'||draft.type==='chimney'){
      const w=(draft.type==='chimney'?500:300)*scale,h=(draft.type==='chimney'?500:300)*scale;
      ctx.fillRect(p.x-w/2,p.y-h/2,w,h);ctx.strokeRect(p.x-w/2,p.y-h/2,w,h);
      if(draft.type==='chimney'){ctx.beginPath();ctx.moveTo(p.x-w/2,p.y-h/2);ctx.lineTo(p.x+w/2,p.y+h/2);ctx.moveTo(p.x+w/2,p.y-h/2);ctx.lineTo(p.x-w/2,p.y+h/2);ctx.stroke();}
    }else{ctx.beginPath();ctx.arc(p.x,p.y,half,0,Math.PI*2);ctx.fill();ctx.stroke();}
    ctx.setLineDash([]);ctx.fillStyle='#e53935';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText((pointTypes[draft.type]||types[draft.type]||draft.type||'构件'),p.x,p.y-half-6);
    // 标出最近墙线到构件外框的实际距离，红线随预览位置实时更新。
    let nearest=null,nearestD=Infinity,nearestIndex=-1;
    (S.walls||[]).forEach((w,wi)=>{
      if(!w||!w.a||!w.b)return;
      const dx=w.b.x-w.a.x,dy=w.b.y-w.a.y,ll=dx*dx+dy*dy||1;
      const t=Math.max(0,Math.min(1,((wp.x-w.a.x)*dx+(wp.y-w.a.y)*dy)/ll));
      const q={x:w.a.x+dx*t,y:w.a.y+dy*t},d=dist(q,wp);
      if(d<nearestD){nearestD=d;nearest={q};nearestIndex=wi;}
    });
    if(nearest){
      const q=screen(nearest.q),vx=p.x-q.x,vy=p.y-q.y,vl=Math.hypot(vx,vy)||1;
      const edge={x:p.x-vx/vl*half,y:p.y-vy/vl*half};
      ctx.strokeStyle='#e53935';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(edge.x,edge.y);ctx.stroke();
      ctx.fillStyle='#e53935';ctx.font='10px sans-serif';ctx.textAlign='center';
      ctx.fillText('墙线'+(nearestIndex+1)+' 距离 '+Math.max(0,Math.round(nearestD-size/2))+' mm',(q.x+edge.x)/2-4,(q.y+edge.y)/2-7);
    }
    if(draft.snapKind){
      ctx.strokeStyle='#e53935';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#e53935';ctx.font='10px sans-serif';ctx.fillText(draft.snapKind==='corner'?'角点吸附':'墙边吸附',p.x,p.y+half+14);
    }
    ctx.restore();
  }
  if(!preview)return;
  if(preview.kind==='octWall'){
    ctx.save();ctx.strokeStyle='#27364a';ctx.lineWidth=2.4;ctx.setLineDash([6,4]);ctx.beginPath();
    (preview.segments||[]).forEach(([a,b])=>{const p=screen(a),q=screen(b);ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);});
    ctx.stroke();ctx.setLineDash([]);
    // 与窗户预览一致：红圈标明当前起算端，切换起点/终点时立即移动。
    if(preview.startPoint){const ep=screen(preview.startPoint);ctx.beginPath();ctx.arc(ep.x,ep.y,10,0,Math.PI*2);ctx.strokeStyle='#e53935';ctx.lineWidth=2.5;ctx.stroke();ctx.beginPath();ctx.arc(ep.x,ep.y,3.5,0,Math.PI*2);ctx.fillStyle='#e53935';ctx.fill();}
    ctx.restore();return;
  }
  if(preview.kind==='opening'){
    const w=S.walls[preview.wallIdx];
    if(!w)return;
    const P=screenPath(w),L=w.len||1,t=Math.max(.001,Math.min(.999,preview.t)),e=.004;
    const q1=ptOnPath(P,Math.max(0,t-e)),q2=ptOnPath(P,Math.min(1,t+e));
    let ux=q2.x-q1.x,uy=q2.y-q1.y;const ul=Math.hypot(ux,uy)||1;ux/=ul;uy/=ul;
    const nx=-uy,ny=ux,c=ptOnPath(P,t),halfPx=(preview.width/2/L)*pathScreenLen(P);
    const A={x:c.x-ux*halfPx,y:c.y-uy*halfPx},B={x:c.x+ux*halfPx,y:c.y+uy*halfPx};
    const sign=-(Number(preview.side)||getBlankSide(w,t)||1);
    let depth=Math.max(1,Number(preview.frameThick)||Number(w.thick)||S.defaultWallThick||220)*scale;
    if(preview.type==='bay')depth=Math.max(1,Number($('idepth')?.value??$('eidepth')?.value??600)*scale);
    const off=(p,d)=>({x:p.x+nx*d,y:p.y+ny*d});
    const line=(a,b)=>{ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);};
    const poly=pts=>{ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.closePath();};
    ctx.save();ctx.strokeStyle='#e53935';ctx.lineWidth=2.2;ctx.setLineDash([5,3]);ctx.beginPath();
    if(preview.type==='powerBox'||preview.type==='weakBox'){
      const d=Math.max(2,Math.min(4,(Number(preview.frameThick)||30)*scale))*Number(preview.side||1);
      const C={x:A.x+nx*d,y:A.y+ny*d},D={x:B.x+nx*d,y:B.y+ny*d};
      poly([A,B,D,C]);
      // 弱电箱直接调用强电箱相同的预览图形，保持尺寸和比例一致。
      line(A,D);line(B,C);
    }else if(preview.type==='opening'){
      const C=off(A,depth*sign),D=off(B,depth*sign);poly([A,B,D,C]);
      const inset=Math.min(24*scale,halfPx*.28);
      if(inset>1){line({x:A.x+ux*inset,y:A.y+uy*inset},{x:C.x+ux*inset,y:C.y+uy*inset});line({x:B.x-ux*inset,y:B.y-uy*inset},{x:D.x-ux*inset,y:D.y-uy*inset});}
    }else if(preview.type==='window'||preview.type==='special'){
      const C=off(A,depth*sign),D=off(B,depth*sign);poly([A,B,D,C]);
      if(preview.type==='special')line(A,D);
      else line(off(A,depth*sign*.5),off(B,depth*sign*.5));
    }else if(preview.type==='bay'){
      // 飘窗改为简洁矩形外框，不再绘制内部U形线。
      const C=off(A,depth*sign),D=off(B,depth*sign);
      poly([A,B,D,C]);
    }
    ctx.stroke();ctx.setLineDash([]);
    const ep=preview.endKey==='a'?screen(w.a):screen(w.b);
    ctx.beginPath();ctx.arc(ep.x,ep.y,10,0,Math.PI*2);ctx.strokeStyle='#e53935';ctx.lineWidth=2.5;ctx.stroke();
    ctx.beginPath();ctx.arc(ep.x,ep.y,3.5,0,Math.PI*2);ctx.fillStyle='#e53935';ctx.fill();
    ctx.fillStyle='#e53935';ctx.font='7px sans-serif';ctx.textAlign='center';ctx.fillText(preview.endKey==='a'?'起点':'终点',ep.x,ep.y+22);
    ctx.restore();
  } else if(preview.kind==='point'){
    const it=preview.it;
    const pos=getPointPos(it);
    if(!pos)return;
    ctx.save();
    const baseP=screen(it.p);
    const mx=Number(it.marginX)||0;
    const my=Number(it.marginY)||0;
    if(pos.kind==='rect'){
      const x0=origin.x+pos.x0*scale;
      const y0=origin.y-(pos.y0+pos.W)*scale;
      const w=pos.L*scale,h=pos.W*scale;
      ctx.strokeStyle='#e53935';ctx.lineWidth=2.5;ctx.setLineDash([4,3]);
      ctx.beginPath();
      ctx.moveTo(x0,y0);ctx.lineTo(x0+w,y0);
      ctx.moveTo(x0,y0+h);ctx.lineTo(x0+w,y0+h);
      ctx.stroke();
      ctx.strokeStyle='#2878df';
      ctx.beginPath();
      ctx.moveTo(x0,y0);ctx.lineTo(x0,y0+h);
      ctx.moveTo(x0+w,y0);ctx.lineTo(x0+w,y0+h);
      ctx.stroke();
      ctx.setLineDash([]);
       /* 橙色边距方向预览线：从基准线指向对应边 */
      ctx.strokeStyle='#ff9800';ctx.lineWidth=2.5;ctx.setLineDash([3,3]);
      const exX=baseP.x+(it.marginXSide==='left'?mx:-mx)*scale;
      ctx.beginPath();
      ctx.moveTo(baseP.x,baseP.y);
      ctx.lineTo(exX,baseP.y);
      ctx.stroke();
      const exY=baseP.y+(it.marginYSide==='top'?-my:my)*scale;
      ctx.beginPath();
      ctx.moveTo(baseP.x,baseP.y);
      ctx.lineTo(baseP.x,exY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='#e53935';ctx.font='7.7px sans-serif';ctx.textAlign='center';
      ctx.fillText('L '+Math.round(pos.L),x0+w/2,y0-8);
      ctx.fillStyle='#2878df';
      ctx.save();
      ctx.translate(x0+w+16,y0+h/2);ctx.rotate(-Math.PI/2);
      ctx.fillText('W '+Math.round(pos.W),0,0);
      ctx.restore();
    }else{
      const cx=origin.x+pos.cx*scale;
      const cy=origin.y-pos.cy*scale;
      const r=pos.r*scale;
      ctx.strokeStyle='#e53935';ctx.lineWidth=2.5;ctx.setLineDash([4,3]);
      ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
      ctx.setLineDash([]);
      /* 橙色方向边框预览线（圆边缘弧线，指向贴基准边一侧） */
      ctx.strokeStyle='#ff9800';ctx.lineWidth=3;
      if(it.marginXSide==='left'){
        ctx.beginPath();ctx.arc(cx,cy,r+3,Math.PI*3/4,Math.PI*5/4);ctx.stroke();
      }else{
        ctx.beginPath();ctx.arc(cx,cy,r+3,-Math.PI/4,Math.PI/4);ctx.stroke();
      }
      if(it.marginYSide==='top'){
        ctx.beginPath();ctx.arc(cx,cy,r+3,-Math.PI*3/4,-Math.PI/4);ctx.stroke();
      }else{
        ctx.beginPath();ctx.arc(cx,cy,r+3,Math.PI/4,Math.PI*3/4);ctx.stroke();
      }
      /* 橙色边距方向预览线：从基准线指向对应边 */
      ctx.strokeStyle='#ff9800';ctx.lineWidth=2;ctx.setLineDash([3,3]);
      const exX=baseP.x+(it.marginXSide==='left'?mx:-mx)*scale;
      ctx.beginPath();
      ctx.moveTo(baseP.x,baseP.y);
      ctx.lineTo(exX,baseP.y);
      ctx.stroke();
      const exY=baseP.y+(it.marginYSide==='top'?-my:my)*scale;
      ctx.beginPath();
      ctx.moveTo(baseP.x,baseP.y);
      ctx.lineTo(baseP.x,exY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='#e53935';ctx.font='7.7px sans-serif';ctx.textAlign='left';
      ctx.fillText('Ø'+Math.round(pos.r*2),cx+r+8,cy-8);
    }
    ctx.restore();
  }
}
/* ---------- 蓝牙服务设置折叠 ---------- */
function collapseBtServiceFields(){
  const body = $('body');
  if(!body) return;
  if(body.querySelector('#btFieldsDetails')) return;
  // 1) 找蓝牙服务相关输入框
  const allInputs = [...body.querySelectorAll('input')];
  const btInputs = allInputs.filter(inp => {
    const id = (inp.id || '').toLowerCase();
    const wrap = inp.closest('.f') || inp.parentElement;
    const txt = ((wrap && wrap.textContent) || '').toLowerCase();
    return /btservice|btchar|蓝牙服务|服务uuid|特征uuid|service.*uuid|characteristic.*uuid/i.test(id + ' ' + txt);
  });
  if(!btInputs.length) return;

  // 2) 建折叠容器
  const details = document.createElement('details');
  details.id = 'btFieldsDetails';
  details.style.cssText = 'margin-top:10px;border:1px solid #dce5f0;border-radius:11px;background:#f6f8fc;padding:0 10px;';
  const summary = document.createElement('summary');
  summary.textContent = '蓝牙服务';
  summary.style.cssText = 'cursor:pointer;padding:10px 0;font-size:13px;font-weight:600;color:#34445d;list-style:none;';
  details.appendChild(summary);

  // 3) 如果两个输入框同属一个 grid4/grid5/row 容器，整体搬入；否则逐个搬
  const parents = btInputs.map(i => i.closest('.grid4,.grid5,.row') || i.parentElement);
  const common = parents.every(p => p === parents[0]) ? parents[0] : null;
  if(common && common.querySelectorAll('input').length === btInputs.length){
    common.parentElement.insertBefore(details, common);
    details.appendChild(common);
    common.style.marginTop = '8px';
    common.style.marginBottom = '8px';
  } else {
    const moved = new Set();
    btInputs.forEach(inp => {
      const wrap = inp.closest('.f') || inp.parentElement;
      if(!wrap || moved.has(wrap)) return;
      moved.add(wrap);
      wrap.style.margin = '8px 0';
      details.appendChild(wrap);
    });
    body.appendChild(details);
  }
}

/* ---------- 统一精致弹窗 ---------- */
window.LinuoDialog = window.LinuoDialog || {
  show(title, message, buttons){
    return new Promise(resolve=>{
      const old=document.getElementById('linuoDialogMask');if(old)old.remove();
      const mask=document.createElement('div');mask.id='linuoDialogMask';mask.className='linuo-dialog-mask';
      const card=document.createElement('div');card.className='linuo-dialog-card';
      const h=document.createElement('div');h.className='linuo-dialog-title';h.textContent=title||'提示';
      const body=document.createElement('div');body.className='linuo-dialog-message';body.textContent=message||'';
      const actions=document.createElement('div');actions.className='linuo-dialog-actions';
      (buttons||[{label:'确定',value:true,primary:true},{label:'取消',value:false}]).forEach(b=>{
        const btn=document.createElement('button');btn.type='button';btn.textContent=b.label;btn.className=b.primary?'primary':'secondary';
        btn.onclick=()=>{mask.remove();resolve(b.value);};actions.appendChild(btn);
      });
      card.append(h,body,actions);mask.appendChild(card);document.body.appendChild(mask);
    });
  },
  input(title,label,value=''){
    return new Promise(resolve=>{
      const mask=document.createElement('div');mask.className='linuo-dialog-mask';mask.id='linuoDialogMask';
      const card=document.createElement('div');card.className='linuo-dialog-card';
      const h=document.createElement('div');h.className='linuo-dialog-title';h.textContent=title;
      const field=document.createElement('input');field.className='linuo-dialog-input';field.value=value;field.placeholder=label||'请输入内容';
      const actions=document.createElement('div');actions.className='linuo-dialog-actions';
      const cancel=document.createElement('button');cancel.className='secondary';cancel.textContent='取消';cancel.onclick=()=>{mask.remove();resolve(null);};
      const ok=document.createElement('button');ok.className='primary';ok.textContent='确定';ok.onclick=()=>{const v=field.value;mask.remove();resolve(v);};
      actions.append(cancel,ok);card.append(h,field,actions);mask.appendChild(card);document.body.appendChild(mask);setTimeout(()=>{field.focus();field.select();},30);
      field.addEventListener('keydown',e=>{if(e.key==='Enter')ok.click();if(e.key==='Escape')cancel.click();});
    });
  }
};
  // 统一接管提示框，避免系统浏览器原生 alert 弹窗打断操作。
  window.alert = function(message){
    return window.LinuoDialog.show('提示',String(message||''),[{label:'知道了',value:true,primary:true}]);
  };

 /* ---------- 面板 ---------- */
function panel(title,html){
  // 新面板替换旧面板时清除旧的数字键盘专用确认回调。
  panelNumericConfirmAction=null;
  // 1) 先清空所有复用容器
  $('globalActions').innerHTML = '';
  $('sideToggles').innerHTML = '';
  $('body').innerHTML = '';

  // 面板按需重建；关闭后不会保留旧的导入/导出按钮。
  if (!(title.includes('设置') || title.includes('数据管理'))) {
    const host = $('panel');
    if (host) {
      [...host.querySelectorAll('button, a, label, span, div')].forEach(el => {
        // 保留标题栏自身的关键控件
        if (el.id === 'x' || el.id === 'uiSideToggle' || el.id === 'ptitle') return;
        if (el.closest('#x') || el.closest('#uiSideToggle') || el.closest('#ptitle')) return;
        // 只处理叶子元素
        if (el.querySelector('button, input, a, label')) return;
        const t = (el.textContent || '').trim();
        if (t && /JSON/i.test(t) && /(导入|导出)/.test(t)) {
          el.remove();
        }
      });
    }
  }

  // 3) 清理 #phead 内除固定三件套外的任何残留子元素
  const phead = $('phead');
  if (phead) {
    [...phead.children].forEach(el => {
      if (el.id !== 'uiSideToggle' && el.id !== 'ptitle' && el.id !== 'x') {
        el.remove();
      }
    });
  }

  // 4) 再渲染新面板
  $('ptitle').textContent=title;
  $('body').innerHTML=html;
  $('panel').classList.toggle('stats-solid',title==='房间统计');
  $('panel').classList.add('show');
  if(title==='管理设置'){
    const author=document.createElement('div');
    author.style.cssText='display:flex;align-items:center;justify-content:flex-start;gap:12px;flex-wrap:wrap;margin:0 0 10px;padding:0 0 8px;border-bottom:1px solid #e4eaf2;text-align:left;color:#64748b;font-size:12px;line-height:1.6;';
    const lic=window.LinuoLicense&&window.LinuoLicense.getStatus?window.LinuoLicense.getStatus():null;
    const authorName=document.createElement('span');authorName.textContent='联系方式：15662061321';
    const versionInfo=document.createElement('span');versionInfo.style.cssText='color:#1677e8;font-weight:600;';
    versionInfo.textContent=lic?(lic.activated?'授权已激活':`剩余 ${Math.max(0,lic.remaining)} 次`):'授权状态读取中';
    versionInfo.setAttribute('data-license-status','');
    author.append(authorName,versionInfo);
    if(window.LinuoLicense){const activate=document.createElement('button');activate.type='button';activate.textContent='授权信息';activate.style.cssText='margin-left:auto;padding:4px 9px;border:1px solid #d3dae4;border-radius:7px;background:#eef2f7;color:#34445d;font-size:11px;';activate.onclick=()=>window.LinuoLicense.showActivation();author.appendChild(activate);}
    const body=$('body');
    const leaves=[...body.querySelectorAll('*')].filter(el=>!el.children.length);
    const anchor=leaves.find(el=>(el.textContent||'').trim()==='配置')
              || leaves.find(el=>/配置/.test(el.textContent||''));
    if(anchor){
      let node=anchor;
      while(node && node.parentNode!==body) node=node.parentNode;
      body.insertBefore(author, node);
    }else{
      body.insertBefore(author, body.firstChild);
    }
    // 把蓝牙服务输入框折叠到“蓝牙服务”区域
    collapseBtServiceFields();
  }

  

  
  // 将确定/取消等按钮移至侧边悬浮栏（排除菜单面板，避免按钮被竖向压缩）
  // 用“包含关键词”判断，避免标题里多一个空格/斜杠导致误提取
  const isSettings = title.includes('设置') || title.includes('数据管理');
  if (!isSettings) {
    // 把所有 .actions 一并移走，避免面板里只提取第一组而留下其它按钮
    [...$('body').querySelectorAll('.actions')].forEach(actions => {
      $('globalActions').appendChild(actions);
    });
  }


  // 将乒乓开关提取到侧边悬浮栏
  $('sideToggles').innerHTML = '';
  const tgParents = [...$('body').querySelectorAll('.f')].filter(el => el.querySelector('.tg'));
  tgParents.forEach(el => {
    el.style.margin = '0'; // 清除网格内边距
    $('sideToggles').appendChild(el);
  });

  // 动态上移悬浮栏，防止遮挡面板
  // 动态上移悬浮栏：以面板顶部为基准，确保键盘/按钮始终在面板上方，不遮挡标题
  const updateToolsPos = () => {
    const p = $('panel');
    const tools = $('rightTools');
    if (!p || !tools) return;
    if (!p.classList.contains('show')) {
      tools.style.bottom = '90px';
      return;
    }
    const rect = p.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    const bottomPx = Math.max(8, window.innerHeight - rect.top + 8);
    tools.style.bottom = bottomPx + 'px';
  };
  requestAnimationFrame(() => {
    updateToolsPos();
    setTimeout(updateToolsPos, 60);   // 等字体/布局稳定后再校正一次
    setTimeout(updateToolsPos, 200);  // 自动聚焦第一个输入框后再校正
  });
  if (window.__panelRO) window.__panelRO.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    window.__panelRO = new ResizeObserver(() => updateToolsPos());
    window.__panelRO.observe($('panel'));
  }
  
  // 1. 提取原本底部的提示信息，并从面板中隐藏
  const hintEl = $('body').querySelector('.hint');
  let hintText = '';
  if (hintEl) {
    hintText = hintEl.innerHTML;
    hintEl.style.display = 'none'; 
  }

  // 2. 如果存在提示，只在面板顶部大标题右侧注入唯一的 ? 按钮
  if (hintText) {
    const btn = document.createElement('span');
    btn.className = 'help-q';
    btn.textContent = '?';
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showToast(hintText);
    };
    $('ptitle').appendChild(btn);
  }

  // 1. 隐藏面板里的“确定/保存”类按钮，统一交由数字键盘 ✓ 执行
  const submitIds = ['btnNewOk', 'nextWall', 'rok', 'updateWall', 'place', 'saveItem', 'dsave', 'tsave', 'aok'];
  submitIds.forEach(id => {
    const btn = $(id);
    if (btn) btn.style.display = 'none';
  });

  // 2. 如果所有按钮都被隐藏了（比如只剩空行），直接隐藏整个操作区域
  const actionsContainer = $('body').querySelector('.actions');
  if (actionsContainer) {
    const visibleBtn = [...actionsContainer.querySelectorAll('button')].some(b => b.style.display !== 'none');
    if (!visibleBtn) actionsContainer.style.display = 'none';
  }

  const inputs=[...$('body').querySelectorAll('input,textarea')];
  inputs.forEach((inp,idx)=>{
    // 移除了 inp.addEventListener('focus',()=>{try{inp.select()}catch(e){}}); 解决键盘闪退
    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key==='Tab'){
        e.preventDefault();
        if(idx<inputs.length-1) inputs[idx+1].focus();
        else inp.blur();
      }
    });


    // 拦截数字输入框，使用自定义键盘
    if (inp.type === 'number') {
      inp.setAttribute('readonly', 'readonly');
      inp.addEventListener('focus', e => e.target.blur()); // 彻底阻止系统键盘
            inp.addEventListener('click', () => {
        setActiveInput(inp);
        isFirstInput = true;
        numKbEl.style.display = 'grid';
        updateKeyboardLayout(uiSide); // 按记忆状态应用折叠/展开布局
        // 高亮当前输入框
        $('body').querySelectorAll('input').forEach(el => el.style.boxShadow = '');
        inp.style.boxShadow = '0 0 0 2px #2878df';
        // 将面板向上滚动，防止被右侧键盘或手机边缘遮挡
        setTimeout(() => { inp.scrollIntoView({behavior: 'smooth', block: 'center'}); }, 100);
      });
    } else {
      // 文本输入框和备注框：确保调用系统键盘，并自动隐藏自定义数字键盘
      inp.setAttribute('type', 'text');
      inp.removeAttribute('readonly');
      const clearNumKb = () => {
        if (numKbEl) numKbEl.style.display = 'none'; 
        if (activeInput) {
          activeInput.style.boxShadow = '';
          setActiveInput(null);
        }
      };
      inp.addEventListener('focus', clearNumKb);
      inp.addEventListener('click', clearNumKb);
    }
  });

  // 自动激活第 1 个输入框
  if (title !== '管理设置') {
    setTimeout(() => {
      const firstNum = inputs.find(inp => inp.type === 'number');
      if (firstNum) {
        firstNum.click(); // 触发 click 事件以自动呼出数字键盘并高亮
      } else if (inputs.length > 0) {
        inputs[0].focus(); // 如果没有数字框（如纯文本面板），直接聚焦文本输入框
      }
    }, 50);
  }
}

/* 轻提示（Toast）工具函数 */
function showToast(msg) {
  let toast = document.getElementById('customToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'customToast';
    toast.style.cssText = 'position:fixed;top:15%;left:50%;transform:translateX(-50%);background:rgba(32,45,69,0.92);color:#fff;padding:12px 16px;border-radius:10px;font-size:13px;z-index:9999;max-width:80%;text-align:left;line-height:1.6;box-shadow:0 4px 12px rgba(0,0,0,0.2);transition:opacity 0.2s;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.innerHTML = msg;
  toast.style.opacity = '1';
  toast.style.display = 'block';
  clearTimeout(toast.hideTimer);
  toast.hideTimer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 200);
  }, 3500);
}
function closePanel(){
  if(mandatorySetupLock){showToast('请先完成当前名称及参数输入，再继续操作');return;}
  panelNumericConfirmAction=null;
  routePreview=null;
  $('panel').classList.remove('show');
  pointEditIndex=-1;
  pending=null;
  preview=null;
  selectedText=-1; // 关闭面板立刻取消文字选中，画布中就不再允许拖拽
  snapHint=null;
  if(editWallIndex>=0){editWallIndex=-1;editEnd=null}
  
  // 关闭面板时隐藏自定义键盘，并清空侧边悬浮按钮
    if (numKbEl) numKbEl.style.display = 'none';
  // 保留 numPadExpanded 记忆状态，下次打开面板时沿用
  if (activeInput) { activeInput.style.boxShadow = ''; setActiveInput(null); }
  $('globalActions').innerHTML = '';
  $('sideToggles').innerHTML = '';
  $('body').innerHTML = '';
  const ph = $('phead');
  if (ph) {
    [...ph.children].forEach(el => {
      if (el.id !== 'uiSideToggle' && el.id !== 'ptitle' && el.id !== 'x') el.remove();
    });
  }
  $('rightTools').style.bottom = '90px';
  
  draw();
}
$('x').onclick=closePanel;

/* ---------- 连续画墙：2秒内未继续则自动结束 ---------- */
function clearWallChain(){
  if(chainTimer) clearTimeout(chainTimer);
  chainTimer=null;
  chain=null;
}
function setWallChain(point){
  if(chainTimer) clearTimeout(chainTimer);
  chain={x:point.x,y:point.y};
  chainTimer=setTimeout(()=>{
    chain=null;
    chainTimer=null;
    if(tool==='wall') showToast('已停止连续画墙，请重新选择起始点');
    draw();
  },2000);
}

/* ---------- 工具切换 ---------- */
function setTool(name){
  clearTimeout(autoSelectTimer);
  const prevTool = tool;
  if(name!=='routePlan'){routePlanStart=null;routePreview=null;}
  tool=name;
  if(name!=='wall'&&name!=='slant')clearWallChain();
  draft=null;
  if(name==='measure'){
    // 进入测量工具时清空草稿，并提示用户点击画布
    measureA=null; measurePreview=null; measureDown=null;
    showToast('测量：点击画布选择起点');
  } else {
    measureA=null; measurePreview=null; measureDown=null;
    // 离开测量工具时，自动删除已测量的记录
    if(prevTool==='measure' && S.measures && S.measures.length){
      S.measures=[];
      draw();
    }
  }
  document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===name));
  if(name==='routePlan')startAutoRoutePlanning();
}
// 图例既可点击切换工具，也可直接拖到画布中放置构件
let legendDrag = null;
let legendGhost = null;
function canvasPointFromClient(clientX, clientY){
  const r=cv.getBoundingClientRect();
  let x=clientX-r.left, y=clientY-r.top;
  if(viewAngle!==0){
    const cx=W/2, cy=H/2, dx=x-cx, dy=y-cy;
    const cos=Math.cos(-viewAngle), sin=Math.sin(-viewAngle);
    x=cx+dx*cos-dy*sin; y=cy+dx*sin+dy*cos;
  }
  return {x,y};
}
function showLegendGhost(type,x,y){
  if(!legendGhost){
    legendGhost=document.createElement('div');
    legendGhost.style.cssText='position:fixed;z-index:100000;pointer-events:none;padding:8px 12px;border-radius:12px;background:rgba(31,111,210,.9);color:#fff;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.2);transform:translate(-50%,-130%);white-space:nowrap;';
    document.body.appendChild(legendGhost);
  }
  legendGhost.textContent=type==='octWall'?'八角斜墙':(types[type]||pointTypes[type]||type);
  legendGhost.style.left=x+'px'; legendGhost.style.top=y+'px';
}
function finishLegendDrag(e){
  if(!legendDrag)return;
  const d=legendDrag; legendDrag=null;
const fromSymbolPanel=!!(d.button&&d.button.closest('.symbol-panel'));
const collapsePanel=()=>{
  if(!fromSymbolPanel)return;
  closeSymbolPanels();
};
  if(d.button){d.button.classList.remove('dragging');d.button.classList.remove('legend-dragging');}
  if(legendGhost){legendGhost.remove();legendGhost=null;}
  updateMagnifier(null);
  if(!d.moved)return;
  const r=cv.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return;
  const cp=canvasPointFromClient(e.clientX,e.clientY);
  const pnt={x:cp.x,y:cp.y};
  const type=d.type;
  // 文字图例：拖到画布后直接在落点创建文字并打开文字编辑面板
  if(type==='text'){
    saveUndo();
    const textPoint=world(pnt);
    S.texts.push({p:{x:textPoint.x,y:textPoint.y},text:'输入文字',angle:0,fontSize:7,arrow:null});
    scheduleAutoSelect();
    setTool('select');
    draw();
    textEditor(S.texts.length-1);
    collapsePanel();
    return;
  }
  // 八角斜墙按墙体构件方式拖放：必须吸附到已有直墙，再填写尺寸参数。
  if(type==='octWall'){
    const hit=pointOnWall(pnt);
    if(hit){setTool('select');openOctWallEditor(hit);collapsePanel();}
    else showToast('请将八角斜墙图例拖到现有直墙上');
    return;
  }
  // 门窗、垭口及强弱电箱等墙体构件，沿用原有墙线吸附与参数面板
  if(types[type]){
    const hit=pointOnWall(pnt);
    if(hit){setTool(type);itemEditor(hit,type);collapsePanel();}
    else showToast('请将门窗类图例拖到墙线附近');
    return;
  }
  if(pointTypes[type]){
    let wp=world(pnt);
    // 点状构件统一按屏幕距离30px吸附：优先房间角点，其次墙边，不再使用过大的200mm阈值。
    const placementSnap=snapPointPlacement(pnt);
    if(placementSnap)wp={x:placementSnap.point.x,y:placementSnap.point.y};
    let snapWall=-1;
    if(placementSnap){
      for(let wi=0;wi<S.walls.length;wi++){
        const w=S.walls[wi];
        if(distToSegment(wp,w.a,w.b)<2){snapWall=wi;break;}
      }
    }
    const rs=roomLoops();
    if(rs.length===0){showToast('画布中暂无闭合空间，无法放置该符号');return;}
    const insideRoom=rs.find(r=>pointInPolygon(wp,r.points)||pointOnPolygonBoundary(wp,r.points,3));
    if(!insideRoom){showToast('只能放置在闭合空间内部');return;}
    saveUndo();
    const conf={
      drain:{size:110,label:'马桶'}, floorDrain:{size:75,label:'地漏'}, groundDrain:{size:110,label:'地面下水'},
      sewer:{size:110,label:'立管'}, column:{length:300,width:300,label:'柱'},
      chimney:{length:500,width:500,label:'烟道'},special:{width:1500,height:2000,sill:0,thick:S.defaultWallThick||220,label:'特殊标识'}
    }[type];
    const it={type,p:wp,label:conf.label,note:'',attachedWall:type==='chimney'&&snapWall>=0?snapWall:null};
    let sumX=0,sumY=0;
    insideRoom.points.forEach(pt=>{sumX+=pt.x;sumY+=pt.y;});
    const cx=sumX/insideRoom.points.length, cy=sumY/insideRoom.points.length;
    it.marginXSide=wp.x<cx?'left':'right'; it.marginYSide=wp.y<cy?'bottom':'top';
    if(type==='column'||type==='chimney'){
      it.length=conf.length;it.width=conf.width;it.size=Math.max(conf.length,conf.width);it.marginX=0;it.marginY=0;
    }else{it.size=conf.size;it.marginX=0;it.marginY=0;}
    S.items.push(it); persist(); scheduleAutoSelect(); setTool('select'); zoomToWorldPoint(wp); openPointEditor(it); draw();
    collapsePanel();
  }
}
document.querySelectorAll('[data-tool]').forEach(b=>{
  b.addEventListener('pointerdown', (e) => {
    const type=b.dataset.tool;
    // 只有可放置的构件图例支持拖拽；普通绘图工具仍保持原来的点击切换方式
    if(!['select','arc','wall','rect','measure','trim','routePlan'].includes(type)){
      legendDrag={type,button:b,startX:e.clientX,startY:e.clientY,moved:false,pointerId:e.pointerId};
      b.classList.add('legend-dragging');
      // 折叠面板不承担滚动任务：阻止浏览器接管触摸，并捕获指针，确保拖到画布后仍收到移动/抬起事件。
if(b.closest('.symbol-panel')){
        e.preventDefault();
        try{b.setPointerCapture(e.pointerId);}catch(err){}
      }
      e.stopPropagation();
      return;
    }
    // 普通工具改由 click 处理，横向滑动浏览时不会误切换工具
  });
  b.addEventListener('click', () => {
    const type=b.dataset.tool;
    if(!['select','arc','wall','octWall','rect','measure','trim','routePlan'].includes(type))return;
closeSymbolPanels();
    if(type==='trim'){
// 清理为一次性操作，不进入持续绘图模式。
      setTool('select');
      trimOpenWalls();
      return;
    }
    setTool(type);
  });
});
document.addEventListener('pointermove',e=>{
  if(!legendDrag||e.pointerId!==legendDrag.pointerId)return;
  const dx=e.clientX-legendDrag.startX, dy=e.clientY-legendDrag.startY;
  // 只有主工具栏允许横向滑动浏览；折叠面板中的图例无论横向还是纵向拖动，都保持拖放状态。
  const inQuickBar=!!(legendDrag.button&&legendDrag.button.closest('.quick'));
  if(inQuickBar&&Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*1.15){
    if(legendDrag.button)legendDrag.button.classList.remove('legend-dragging');
    legendDrag=null;
    if(legendGhost){legendGhost.remove();legendGhost=null;}
    return;
  }
  // 纵向滑动始终作为构件拖放：向上拖入画布时，在松手位置放置构件；不展开图例面板
  if(Math.hypot(dx,dy)>8)legendDrag.moved=true;
  if(legendDrag.moved){
    showLegendGhost(legendDrag.type,e.clientX,e.clientY);
    const r2=cv.getBoundingClientRect();
    const inCanvas = e.clientX>=r2.left && e.clientX<=r2.right && e.clientY>=r2.top && e.clientY<=r2.bottom;
    if(inCanvas){
      const cp2=canvasPointFromClient(e.clientX,e.clientY);
      const lbl=legendDrag.type==='octWall'?'八角斜墙':(types[legendDrag.type]||pointTypes[legendDrag.type]||legendDrag.type);
      updateMagnifier(cp2, lbl, 'rgba(31,111,210,.92)');
    } else {
      updateMagnifier(null);
    }
    e.preventDefault();
  }
},{passive:false,capture:true});
document.addEventListener('pointerup',e=>{
  if(!legendDrag||e.pointerId!==legendDrag.pointerId)return;
  const wasDrag=legendDrag.moved;
  const clickedType=legendDrag.type;
  finishLegendDrag(e);
  if(!wasDrag){
    setTool(clickedType);
closeSymbolPanels();
  }
},{capture:true});
document.addEventListener('pointercancel',e=>{
  if(legendDrag&&e.pointerId===legendDrag.pointerId){
    if(legendDrag.button){legendDrag.button.classList.remove('dragging');legendDrag.button.classList.remove('legend-dragging');}
    legendDrag=null;if(legendGhost){legendGhost.remove();legendGhost=null;}
  }
});

// 统一关闭两个功能面板
function closeSymbolPanels(){

  document.querySelectorAll('.symbol-panel').forEach(panel=>{
    panel.classList.remove('show');
  });

  document.querySelectorAll('#btnComponentMenu,#btnOtherMenu').forEach(btn=>{
    btn.classList.remove('active');
  });
}

// 统一绑定分类菜单
function bindSymbolMenu(buttonId,panelId){

  const btn=document.getElementById(buttonId);
  const panel=document.getElementById(panelId);

  if(!btn||!panel)return;

  btn.addEventListener('click',e=>{

    e.preventDefault();
    e.stopPropagation();

    const wasOpen=panel.classList.contains('show');

    // 先关闭两个面板
    closeSymbolPanels();

    // 如果原来是关闭状态，则打开当前面板
    if(!wasOpen){
      panel.classList.add('show');
      btn.classList.add('active');
    }

  });
}

// 构件菜单
bindSymbolMenu('btnComponentMenu','componentPanel');

// 其它菜单
bindSymbolMenu('btnOtherMenu','otherPanel');

const photoAnnotationButton=document.getElementById('photoAnnotationTool');
if(photoAnnotationButton){
  photoAnnotationButton.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    openPhotoAnnotation();
  });
}

// 点击画布自动关闭两个分类面板
cv.addEventListener('pointerdown',()=>{
  closeSymbolPanels();
});

/* ---------- 创建墙体 ---------- */
function centerOnWorldPoint(p){
  origin.x = W/2 - p.x*scale;
  origin.y = H/2 + p.y*scale;
}
function centerAndFitHalf(p){
  // 1) 计算全部墙体包围盒，得到"完整适配"的缩放（四周共留白 60px）
  const xs=[],ys=[];
  S.walls.forEach(w=>{xs.push(w.a.x,w.b.x);ys.push(w.a.y,w.b.y)});
  if(!xs.length){centerOnWorldPoint(p);return;}
  const minx=Math.min(...xs),maxx=Math.max(...xs);
  const miny=Math.min(...ys),maxy=Math.max(...ys);
  const bw=Math.max(1,maxx-minx), bh=Math.max(1,maxy-miny);
  const pad=60;
  const fitScale=Math.min(
    (W-pad>0)?(W-pad)/bw:Infinity,
    (H-pad>0)?(H-pad)/bh:Infinity
  );
  if(isFinite(fitScale)&&fitScale>0){
    // 2) 视图覆盖范围取"完整图纸"的一半 → 缩放放大到 fitScale 的 2 倍
    let target=fitScale*0.8;
    target=Math.max(0.001,Math.min(2,target));
    scale=target;
  }
  // 3) 以第二点（终点）为中心
  centerOnWorldPoint(p);
}
function createWall(length,angle,continueDraw){
  const a={...pending.a};
  const b={x:a.x+Math.cos(angle)*length,y:a.y+Math.sin(angle)*length};
  saveUndo();
  const end=addDrawnWallSegment(a,b);
  mergeCollinearWalls();
  splitAllWallIntersections();
  scheduleAutoSelect();
  if(continueDraw) setWallChain(end); else clearWallChain();
  closePanel();
  fitCanvas();
  draw();
}

function wallLengthPanel(d){
  pending={a:{...d.a},angle:Math.atan2(d.b.y-d.a.y,d.b.x-d.a.x)};
  const approx=Math.round(dist(d.a,d.b));
  
  // 先将输入框隐藏在 body 中生成，以便 panel 内部自动绑定数字键盘事件
  panel('墙体长度',`
    <div style="display:none;">
      <input id="len" type="number" inputmode="decimal" value="${approx}">
    </div>
    <div class="actions"><button class="primary" id="nextWall">确定并继续画墙</button></div>
    <div class="hint">此处输入的终点不会自动吸附端点；拖拽时靠近端点松开会询问是否连接。闭合轮廓后可继续添加门窗。</div>
  `);

  // 将输入框提取并放入标题正中间
  const lenInput = $('len');
  if (lenInput) {
    const ptitle = $('ptitle');
    ptitle.innerHTML = ''; // 清空原有文本
    
    // 构建标题内部容器
    const titleWrap = document.createElement('div');
    titleWrap.style.display = 'flex';
    titleWrap.style.alignItems = 'center';
    titleWrap.style.justifyContent = 'center';
    titleWrap.style.width = '100%';
    
    const label1 = document.createElement('span');
    label1.textContent = '长度';
    label1.style.marginRight = '6px';
    label1.style.fontSize = '14px';
    label1.style.color = '#20344f';
    
    // 强制覆盖输入框样式以适应标题行
    lenInput.style.cssText = 'width:80px; height:30px; min-height:30px; padding:0 6px; font-size:14px; font-weight:bold; text-align:center; border-radius:6px; border:2px solid #1677e8 !important; background:#fff; margin:0 6px; color:#e53935; -webkit-text-fill-color:#e53935; outline:none; box-shadow:none; box-sizing:border-box;';
    
    const label2 = document.createElement('span');
    label2.textContent = 'mm';
    label2.style.fontSize = '14px';
    label2.style.color = '#20344f';
    
    titleWrap.appendChild(label1);
    titleWrap.appendChild(lenInput);
    titleWrap.appendChild(label2);
    ptitle.appendChild(titleWrap);
  }

  $('nextWall').onclick=()=>{
    const l=Number($('len').value);
    if(l>0)createWall(l,pending.angle,true);
    else alert('请输入有效长度');
  };
}

/* ---------- 房间创建面板 ---------- */
function roomPanel(){
  const p=pending;
  const curL=Math.round(Math.abs(p.b.x-p.a.x));
  const curW=Math.round(Math.abs(p.b.y-p.a.y));
  panel('创建房间',`
    <div class="grid4">
      <div class="f"><label>长度</label><input id="rlen" type="number" value="${curL}"></div>
      <div class="f"><label>宽度</label><input id="rwid" type="number" value="${curW}"></div>
	      <div class="actions">
      <button class="primary" id="rok">创建房间</button>
    </div>
    </div>

    <div class="hint">在画布上拖动即可实时调整矩形；也可在输入框中输入精确尺寸，以起点为基准向拖动方向展开。</div>
  `);
  const update=()=>{
    if(!pending||pending.kind!=='room')return;
    const L=Number($('rlen').value)||0;
    const W=Number($('rwid').value)||0;
    const sx = (pending.b.x<pending.a.x)?-1:1;
    const sy = (pending.b.y<pending.a.y)?-1:1;
    pending.b={x:pending.a.x+L*sx, y:pending.a.y+W*sy};
    draw();
  };
  $('rlen').addEventListener('input',update);
  $('rwid').addEventListener('input',update);
  $('rok').onclick=()=>{
    if(!pending||pending.kind!=='room')return;
    const L=Math.abs(pending.b.x-pending.a.x);
    const W=Math.abs(pending.b.y-pending.a.y);
    if(!(L>0)||!(W>0))return alert('请输入有效的长度和宽度');
    createRect(pending.a, pending.b);
    pending=null;draft=null;
    closePanel();
  };

}

/* 将墙端点移动到目标位置，并同步平移与其垂直相连的整段墙线及墙上构件。 */
function moveWallEndpointGeometry(index,endKey,newEnd){
  const w=S.walls[index];
  if(!w||!newEnd||!Number.isFinite(newEnd.x)||!Number.isFinite(newEnd.y))return false;
  const oldEnd={...w[endKey]},other={...w[endKey==='a'?'b':'a']};
  const baseDx=w.b.x-w.a.x,baseDy=w.b.y-w.a.y,baseLen=Math.hypot(baseDx,baseDy)||1;
  const baseUx=baseDx/baseLen,baseUy=baseDy/baseLen;
  const dx=newEnd.x-oldEnd.x,dy=newEnd.y-oldEnd.y;
  if(Math.hypot(dx,dy)<0.01)return false;

  // 主墙上的门窗按原有实际位置保留，不因长度变化而按比例漂移。
  const fixedItems=[];
  if(!w.arc){
    (S.items||[]).forEach(it=>{
      if(it.wall===index&&Number.isFinite(Number(it.t))){
        const q=posOnWall(w,Math.max(0,Math.min(1,Number(it.t))));
        fixedItems.push({it,q});
      }
    });
  }

  w[endKey]={x:newEnd.x,y:newEnd.y};
  w.len=wallCurveLen(w);
  const translatedWallIndices=new Set();
  const movedWallOldGeometry=[];
  S.walls.forEach((ww,j)=>{
    if(j===index||ww.arc||!ww.a||!ww.b)return;
    const joinsA=dist(ww.a,oldEnd)<2,joinsB=dist(ww.b,oldEnd)<2;
    if(!joinsA&&!joinsB)return;
    const wx=ww.b.x-ww.a.x,wy=ww.b.y-ww.a.y,wl=Math.hypot(wx,wy)||1;
    const dot=Math.abs((baseUx*wx+baseUy*wy)/wl);
    // 只整体平移垂直相连的墙线；保留同方向墙体原有位置。
    if(dot>Math.sin(10*Math.PI/180))return;
    movedWallOldGeometry.push({index:j,a:{...ww.a},b:{...ww.b}});
    ww.a={x:ww.a.x+dx,y:ww.a.y+dy};
    ww.b={x:ww.b.x+dx,y:ww.b.y+dy};
    ww.len=wallCurveLen(ww);
    translatedWallIndices.add(j);
  });

  // 主墙上构件保留原先相对固定端的实际位置。
  if(fixedItems.length&&!w.arc){
    const vx=w.b.x-w.a.x,vy=w.b.y-w.a.y,ll=vx*vx+vy*vy||1;
    fixedItems.forEach(({it,q})=>{
      it.t=Math.max(0,Math.min(1,((q.x-w.a.x)*vx+(q.y-w.a.y)*vy)/ll));
    });
  }
  // 点状构件以世界坐标记录；沿被平移墙线放置的构件同步移动。
  (S.items||[]).forEach(it=>{
    if(translatedWallIndices.has(it.attachedWall)&&it.p){
      it.p={x:it.p.x+dx,y:it.p.y+dy};
    }
  });
  // 沿垂直相连墙线放置的文字与引线也一起平移。
  const nearMovedLine=q=>movedWallOldGeometry.some(g=>distToSegment(q,g.a,g.b)<3);
  (S.texts||[]).forEach(t=>{
    if(t.p&&nearMovedLine(t.p))t.p={x:t.p.x+dx,y:t.p.y+dy};
    if(t.arrow&&nearMovedLine(t.arrow))t.arrow={x:t.arrow.x+dx,y:t.arrow.y+dy};
  });
  return true;
}

/* ---------- 墙体编辑 ---------- */
function wallEditor(i){
  const w=S.walls[i];
  editWallIndex=i;
  editEnd='b';
  const isArc=!!w.arc;
  panel('墙体参数',`
    <div class="grid4">
      <div class="f"><label>长度</label><input id="editLen" type="number" value="${Math.round(w.len)}"></div>
      ${isArc?`<div class="f"><label>矢高</label><input id="editBulge" type="number" value="${Math.round(w.bulge||0)}"></div>`:''}
      <div class="f" style="grid-column:${isArc?'auto':'span 3'};">
        <label>端点</label>
        <button type="button" class="secondary" id="endTog" style="width:100%;height:34px;min-height:0;padding:0 6px;font-size:13px;font-weight:700;letter-spacing:.5px;border-radius:7px;">改B点</button>
      </div>
    </div>
    <div class="actions">
      <button class="primary" id="updateWall">修改</button>
      <button class="danger" id="delWall">删除墙体</button>
    </div>
    <div class="hint">切换端点后，画布红圈可直接拖动；垂直相连墙线及其门窗构件会同步平移。</div>
  `);
  const endToggleButton = $('endTog');
  // 端点按钮位于参数面板内，独立处理按压/点击，避免被画布长按与关闭面板逻辑误判。
  endToggleButton.addEventListener('pointerdown', e=>{ e.stopPropagation(); });
  endToggleButton.addEventListener('click', e=>{
    e.preventDefault(); e.stopPropagation();
    editEnd=editEnd==='a'?'b':'a';
    endToggleButton.textContent = editEnd === 'a' ? '改A点' : '改B点';
    $('panel').classList.add('show');
    draw();
  });
  $('updateWall').onclick=()=>{
    const l=Number($('editLen').value);
    if(!(l>0))return;
    const endKey=editEnd||'b';
    saveUndo();
    if(w.arc&&$('editBulge'))w.bulge=Number($('editBulge').value)||0;
    const other=w[endKey==='a'?'b':'a'];
    const curLen=w.len||dist(w.a,w.b)||1;
    const ratio=l/curLen;
    const newEnd={x:other.x+(w[endKey].x-other.x)*ratio,y:other.y+(w[endKey].y-other.y)*ratio};
    moveWallEndpointGeometry(i,endKey,newEnd);
    // 修改墙体端点后重新检查所有交点，保证新形成的相交位置也拆成独立墙段。
    splitAllWallIntersections();
    editWallIndex=-1;editEnd=null;
    persist();draw();closePanel();
  };
  draw();
}

/* ---------- 门窗构件放置 ---------- */
function itemEditor(hit,type){ return doorModule.itemEditor(hit,type); }
function editPlacedItem(idx){ return doorModule.editPlacedItem(idx); }

/* ---------- 点状构件编辑/添加 ---------- */
function openPointEditor(it){ return otherModule.openPointEditor(it); }

/* ---------- 文字命中检测 + 编辑 ---------- */
function hitText(p, t){
  const sp=screen(t.p);
  const a=t.angle||0;
  const cos=Math.cos(-a), sin=Math.sin(-a); // 逆旋转
  const dx=p.x-sp.x, dy=p.y-sp.y;
  const lx=dx*cos - dy*sin;
  const ly=dx*sin + dy*cos;
  const fs=t.fontSize||15;
  ctx.save();
  ctx.font=fs+'px sans-serif';
  const w=ctx.measureText(t.text||'输入文字').width;
  ctx.restore();
  return lx>=-6 && lx<=w+6 && ly>=-fs*1.1 && ly<=fs*0.4;
}

function textEditor(idx){
  const t=S.texts[idx];
  if(!t)return;
  t.angle=0;
  if(t.fontSize===undefined)t.fontSize=7;
  if(!t.color)t.color='#1677e8';
  selectedText=idx; // 只有在此处才会激活选中状态，画布才允许拖动它
  panel('文字编辑',`
    <div class="grid4">
      <div class="f" style="grid-column:span 2"><label>文本内容</label><input id="ttxt" type="text"></div>
      <div class="f"><label>字号</label>
        <select id="tfs" style="height:34px;padding:0 5px;font-size:12px;appearance:auto;-webkit-appearance:auto;">
          ${[5, 7, 10, 12].map(size => `<option value="${size}" ${t.fontSize == size ? 'selected' : ''}>${size}</option>`).join('')}
        </select>
      </div>
      <div class="f"><label>颜色</label><select id="tcolor" style="height:34px;padding:0 5px;"><option value="#e53935" ${['#e53935','#ff0000'].includes((t.color||'').toLowerCase())?'selected':''}>红色</option><option value="#16a34a" ${['#16a34a','#008000'].includes((t.color||'').toLowerCase())?'selected':''}>绿色</option><option value="#1677e8" ${!['#e53935','#ff0000','#16a34a','#008000'].includes((t.color||'').toLowerCase())?'selected':''}>蓝色</option></select></div>
    </div>
    <div class="actions">
      <button class="primary" id="tsave">完成</button>
      <button class="danger" id="tdel">删除</button>
    </div>
    <div class="hint">拖动文字可移动；拖动右下圆点或双指捏合可缩放字号。</div>
  `);

  // 旋转按钮追加到标题栏末尾：row 模式靠右，row-reverse 模式靠左，天然跟随键盘方向
  const pheadEl = $('phead');
  const rotHeadBtn = document.createElement('button');
  rotHeadBtn.id = 'trot';
  rotHeadBtn.textContent = '旋转 90°';
  rotHeadBtn.style.cssText = 'flex:0 0 auto;margin:0 4px;height:28px;padding:0 10px;border-radius:8px;background:#edf5ff;color:#1677e8;border:1px solid #dcecff;font-size:12px;font-weight:700;letter-spacing:.5px;white-space:nowrap;';
  if (pheadEl) pheadEl.appendChild(rotHeadBtn);

  const txt=$('ttxt'), fs=$('tfs'), colorInput=$('tcolor');
  txt.value=t.text||'输入文字';
  txt.addEventListener('focus',()=>{
    try{txt.select()}catch(e){}
    // 系统键盘弹出前先把正在编辑的文字对象移到画布可视区域中央，键盘改变视口后再校正一次。
    const centerEditingText=()=>{
      const current=S.texts[idx];if(!current||!cv||!work)return;
      const usableH=Math.max(160,Math.min(H,window.visualViewport?.height||H));
      origin.x=W/2-current.p.x*scale;
      origin.y=usableH*.40+current.p.y*scale;
      draw();
    };
    centerEditingText();
    setTimeout(centerEditingText,180);
    setTimeout(centerEditingText,420);
  });
  txt.addEventListener('click',()=>{try{txt.select()}catch(e){}});
  txt.addEventListener('input',()=>{t.text=txt.value||'输入文字';draw();persist()});
  fs.addEventListener('change',()=>{t.fontSize=Number(fs.value)||15;draw();persist()});
  if(colorInput)colorInput.addEventListener('change',()=>{t.color=colorInput.value;draw();persist()});
  $('trot').onclick=()=>{
    t.angle = (t.angle || 0) + Math.PI/2;
    draw();
  };
  $('tsave').onclick=()=>{draw();closePanel()};
  draw();
}

/* 根据闭合空间判断墙体哪一侧为空白侧；未闭合时以入户门洞口所在侧作可靠方向兜底。 */
function getBlankSide(w,t){
  if(!w) return 1;
  const e=0.002;
  const a=posOnWall(w,Math.max(0,t-e)), b=posOnWall(w,Math.min(1,t+e));
  let ux=b.x-a.x, uy=b.y-a.y, len=Math.hypot(ux,uy)||1;
  ux/=len; uy/=len;
  const nx=-uy, ny=ux, c=posOnWall(w,t);
  const probe=Math.max(30,Math.min(100,(Number(w.thick)||Number(S.defaultWallThick)||220)*0.75));
  if(!roomLoopComputing){
    const loops=roomLoops();
    if(loops.length){
      const plus={x:c.x+nx*probe,y:c.y+ny*probe};
      const minus={x:c.x-nx*probe,y:c.y-ny*probe};
      const inPlus=loops.some(r=>pointInPolygon(plus,r.points));
      const inMinus=loops.some(r=>pointInPolygon(minus,r.points));
      if(inPlus&&!inMinus)return -1;
      if(inMinus&&!inPlus)return 1;
    }
  }
  // 未闭合时，以入户门朝向推算一个室内参考点；参考点所在侧为室内，反侧为空白侧。
  const d=S.entryDoor;
  if(d&&d.a&&d.b){
    const dc={x:(d.a.x+d.b.x)/2,y:(d.a.y+d.b.y)/2};
    const dx=d.b.x-d.a.x,dy=d.b.y-d.a.y,dl=Math.hypot(dx,dy)||1;
    const inside=getEntryInsideSide();
    const inNx=-dy/dl*inside,inNy=dx/dl*inside;
    const depth=Math.max(600,probe*4);
    const interiorRef={x:dc.x+inNx*depth,y:dc.y+inNy*depth};
    const towardInterior=(interiorRef.x-c.x)*nx+(interiorRef.y-c.y)*ny;
    if(Math.abs(towardInterior)>Math.max(10,probe*0.15))return towardInterior>0?-1:1;
    // 参考点与墙线近似重合时，以门中心方向作为次级判断；门中心同侧按室内侧处理。
    const towardDoor=(dc.x-c.x)*nx+(dc.y-c.y)*ny;
    if(Math.abs(towardDoor)>Math.max(10,probe*0.15))return towardDoor>0?-1:1;
    // 墙线与门线平行时，利用入户门推断出的室内法线确定空白侧。
    const dot=nx*inNx+ny*inNy;
    if(Math.abs(dot)>0.15)return dot>0?-1:1;
  }
  return 1;
}

/* ---------- 碰撞检测 ---------- */
function nearestPlacedItem(p){
  let best=-1,bd=22;
  S.items.forEach((it,i)=>{
    if(pointTypes[it.type]){
      const pos=getPointPos(it);
      if(pos){
        if(pos.kind==='rect'){
          const x0=origin.x+pos.x0*scale;
          const y0=origin.y-(pos.y0+pos.W)*scale;
          const w=pos.L*scale, h=pos.W*scale;
          if(p.x>=x0-6 && p.x<=x0+w+6 && p.y>=y0-6 && p.y<=y0+h+6){
            best=i; bd=0;
            return;
          }
        }else{
          const cx=origin.x+pos.cx*scale;
          const cy=origin.y-pos.cy*scale;
          const r=pos.r*scale;
          const d=dist(p,{x:cx,y:cy});
          if(d <= Math.max(r+6, 22)){
            best=i; bd=0;
            return;
          }
        }
      }
    } else if(it.p){
      const q0=screen(it.p);
      const d=dist(p,q0);
      if(d<bd){bd=d;best=i}
    } else if(it.wall!=null&&S.walls[it.wall]){
      const q0=screen(posOnWall(S.walls[it.wall],it.t));
      const d=dist(p,q0);
      if(d<bd){bd=d;best=i}
    }
  });
  return best;
}

/* ---------- 房间识别 ---------- */
let roomLoopComputing=false;
function roomLoops(){
  if(roomLoopComputing)return [];
  roomLoopComputing=true;
  try{
  // 以真实墙线、门洞门槛线和入户门分界线构建平面无向图，再提取平面图的有界面。
  // 旧版枚举所有简单回路，会把相邻房间的合并大回路也识别出来；
  // 半边遍历只返回相邻墙线之间的实际单元空间，不再返回多个房间的并集。
  const key=p=>Math.round(p.x*10)+','+Math.round(p.y*10);
  const nodes=new Map();
  const edges=new Set();
  const ensure=p=>{
    const k=key(p);
    if(!nodes.has(k))nodes.set(k,{p:{x:p.x,y:p.y},links:[]});
    return k;
  };
  const addEdge=(pa,pb)=>{
    const a=ensure(pa),b=ensure(pb);
    if(a===b)return;
    const id=a<b?a+'|'+b:b+'|'+a;
    if(edges.has(id))return;
    edges.add(id);
    nodes.get(a).links.push(b);
    nodes.get(b).links.push(a);
  };

  // 门洞只影响墙线的绘制显示，不删除墙体拓扑边。
  // 保留完整原墙作为虚拟边界，避免添加门洞后原本闭合的房间变成开放区域。
  S.walls.forEach(w=>{
    if(!w.a||!w.b||dist(w.a,w.b)<0.1)return;
    addEdge(w.a,w.b);
  });

  // 门洞短边通常已作为真实墙线加入图中；仅对旧项目缺失的短边补边。
  // 门洞外侧两端之间的虚拟门槛线用于封闭房间拓扑，但不绘制成实体墙。
  S.items.forEach(it=>{
    if(it.type!=='opening')return;
    const bridge=getOpeningBridgeLine(it);
    if(!bridge)return;
    // 门洞两端自动连接为一条虚拟边，参与房间闭合与导出，但不打断或改写原墙线。
    addEdge(bridge.a,bridge.b);
  });

  // 入户门洞口也作为虚拟边界参与房间闭合；画布上以蓝色虚线显示，不生成实体墙。
  if(S.entryDoor&&S.entryDoor.a&&S.entryDoor.b)addEdge(S.entryDoor.a,S.entryDoor.b);

  // 按各顶点的极角排序，沿每条有向边始终选择反向边的顺时针相邻边，
  // 从而沿同一侧面边界行走。每条有向边只访问一次。
  nodes.forEach((node,k)=>{
    node.links.sort((a,b)=>{
      const pa=node.p,pb=nodes.get(a).p,pc=nodes.get(b).p;
      return Math.atan2(pb.y-pa.y,pb.x-pa.x)-Math.atan2(pc.y-pa.y,pc.x-pa.x);
    });
  });
  const visited=new Set(),loops=[];
  for(const [a,node] of nodes){
    for(const b of node.links){
      const first=a+'>'+b;
      if(visited.has(first))continue;
      let u=a,v=b,guard=0;
      const cycle=[];
      while(guard++<edges.size*2+8){
        const directed=u+'>'+v;
        if(visited.has(directed))break;
        visited.add(directed);
        cycle.push(u);
        const links=nodes.get(v)?.links||[];
        const reverseIndex=links.indexOf(u);
        if(reverseIndex<0||!links.length)break;
        // 邻接表按逆时针极角排列，取反向边前一个邻边（顺时针）。
        const next=links[(reverseIndex-1+links.length)%links.length];
        u=v;v=next;
        if(u===a&&v===b)break;
      }
      if(!(u===a&&v===b)||cycle.length<3)continue;
      // 非简单回路（有重复顶点）不是独立房间面，过滤掉。
      if(new Set(cycle).size!==cycle.length)continue;
      const pts=cycle.map(k=>nodes.get(k).p);
      let twiceArea=0;
      for(let i=0;i<pts.length;i++){
        const q=pts[(i+1)%pts.length],r=pts[i];
        twiceArea+=r.x*q.y-q.x*r.y;
      }
      const signedArea=twiceArea/2;
      // 正向有界面保留；负向通常是整个图的外部无限面。
      if(signedArea<=50000)continue;
      loops.push({points:pts,area:signedArea/1e6});
    }
  }
  // 对完全重合的环做一次稳定去重，并按面积从大到小排列。
  const unique=new Map();
  loops.forEach(r=>{
    const ids=r.points.map(key);
    const rotations=[];
    for(let i=0;i<ids.length;i++)rotations.push(ids.slice(i).concat(ids.slice(0,i)).join('|'));
    const id=rotations.sort()[0];
    if(!unique.has(id))unique.set(id,r);
  });
  return [...unique.values()].map((r,i)=>({index:i+1,points:r.points,area:r.area}))
    .filter(r=>r.area>0.05).sort((a,b)=>b.area-a.area);
  }finally{
    roomLoopComputing=false;
  }
}
/* ---------- 修剪开放区域墙线：仅保留属于闭合回路的线段（含弧墙） ---------- */
function trimOpenWalls(){
  const oldWalls=(S.walls||[]).slice();
  if(!oldWalls.length){showToast('当前没有可修剪的墙线');return;}
  const segments=[];
  oldWalls.forEach((w,i)=>{
    if(!w||!w.a||!w.b)return;
    if(w.arc&&w.bulge){
      // 弧墙按曲线上连续短段参与拓扑判定；真正保留时再按原曲线参数重建弧段。
      const steps=32;
      for(let k=0;k<steps;k++){
        const t0=k/steps,t1=(k+1)/steps;
        segments.push({a:ScribeEngine.pointOnWall(w,t0),b:ScribeEngine.pointOnWall(w,t1),source:i,cuts:[0,1],wallT0:t0,wallT1:t1,virtual:false});
      }
    }else segments.push({a:{...w.a},b:{...w.b},source:i,cuts:[0,1],wallT0:0,wallT1:1,virtual:false});
  });
  // 门洞外沿与入户门洞口作为虚拟边参与闭合判定，但不会被写回成实体墙。
  (S.items||[]).forEach(it=>{
    if(it.type!=='opening')return;
    const br=getOpeningBridgeLine(it);if(br)segments.push({a:{...br.a},b:{...br.b},source:-1,cuts:[0,1],wallT0:0,wallT1:1,virtual:true});
  });
  if(S.entryDoor&&S.entryDoor.a&&S.entryDoor.b)segments.push({a:{...S.entryDoor.a},b:{...S.entryDoor.b},source:-1,cuts:[0,1],wallT0:0,wallT1:1,virtual:true});
  const param=(p,s)=>{const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,ll=dx*dx+dy*dy||1;return ((p.x-s.a.x)*dx+(p.y-s.a.y)*dy)/ll;};
  const addCut=(seg,p)=>{const t=param(p,seg);if(t>=-1e-6&&t<=1+1e-6)seg.cuts.push(Math.max(0,Math.min(1,t)));};
  for(let i=0;i<segments.length;i++){
    const a=segments[i];if(dist(a.a,a.b)<.5)continue;
    for(let j=i+1;j<segments.length;j++){
      const b=segments[j];if(dist(b.a,b.b)<.5)continue;
      const q=segIntersect(a.a,a.b,b.a,b.b);
      if(q){addCut(a,q);addCut(b,q);continue;}
      // 对T形连接和端点压在线段内部的情况补充分割点。
      [a.a,a.b].forEach(p=>{if(distToSegment(p,b.a,b.b)<2)addCut(b,p);});
      [b.a,b.b].forEach(p=>{if(distToSegment(p,a.a,a.b)<2)addCut(a,p);});
    }
  }
  // 端点容差聚类：防止手绘T形连接因不到2mm的细小偏差被误判成断线。
  const nodeCoords=new Map();
  const nodeKey=p=>{
    let best=null,bestD=2.1;
    for(const [key,q] of nodeCoords){const d=dist(p,q);if(d<bestD){bestD=d;best=key;}}
    if(best!==null)return best;
    let key=Math.round(p.x*10)+','+Math.round(p.y*10);
    while(nodeCoords.has(key))key+='*';
    nodeCoords.set(key,{x:p.x,y:p.y});return key;
  };
  const edges=[],edgeByKey=new Map(),wallIntervals=oldWalls.map(()=>[]);
  segments.forEach(seg=>{
    const ts=[...new Set(seg.cuts.sort((a,b)=>a-b).map(t=>Math.round(t*1e9)/1e9))];
    for(let k=0;k<ts.length-1;k++){
      const t0=ts[k],t1=ts[k+1];if(t1-t0<1e-8)continue;
      const a={x:seg.a.x+(seg.b.x-seg.a.x)*t0,y:seg.a.y+(seg.b.y-seg.a.y)*t0};
      const b={x:seg.a.x+(seg.b.x-seg.a.x)*t1,y:seg.a.y+(seg.b.y-seg.a.y)*t1};
      const ka=nodeKey(a),kb=nodeKey(b);if(ka===kb)continue;
      const key=ka<kb?ka+'|'+kb:kb+'|'+ka;
      let edge=edgeByKey.get(key);
      if(!edge){edge={id:edges.length,u:ka,v:kb,parts:[],bridge:false};edgeByKey.set(key,edge);edges.push(edge);}
      if(!seg.virtual){
        const baseT0=Number(seg.wallT0)||0,baseT1=Number(seg.wallT1)||1;
        edge.parts.push({source:seg.source,t0:baseT0+(baseT1-baseT0)*t0,t1:baseT0+(baseT1-baseT0)*t1});
      }
    }
  });
  const adj=new Map();
  const addAdj=(k,eid)=>{if(!adj.has(k))adj.set(k,[]);adj.get(k).push(eid);};
  edges.forEach(e=>{addAdj(e.u,e.id);addAdj(e.v,e.id);});
  const disc=new Map(),low=new Map();let timer=0;
  function dfs(u,parentEdge){
    disc.set(u,++timer);low.set(u,timer);
    for(const eid of adj.get(u)||[]){
      if(eid===parentEdge)continue;
      const e=edges[eid],v=e.u===u?e.v:e.u;
      if(!disc.has(v)){
        dfs(v,eid);low.set(u,Math.min(low.get(u),low.get(v)));
        if(low.get(v)>disc.get(u))e.bridge=true;
      }else low.set(u,Math.min(low.get(u),disc.get(v)));
    }
  }
  adj.forEach((_,k)=>{if(!disc.has(k))dfs(k,-1);});
  edges.forEach(e=>{
    if(e.bridge)return;
    e.parts.forEach(part=>wallIntervals[part.source].push([Math.min(part.t0,part.t1),Math.max(part.t0,part.t1)]));
  });
  const rangesByWall=oldWalls.map((w,i)=>{
    const list=wallIntervals[i].sort((a,b)=>a[0]-b[0]),merged=[];
    list.forEach(r=>{const last=merged[merged.length-1];if(last&&r[0]<=last[1]+1e-6)last[1]=Math.max(last[1],r[1]);else merged.push([...r]);});
    // 构件依附的墙段至少保留构件宽度范围，避免修剪后门窗/电箱悬空或被截断。
    const L=Math.max(1,Number(w&&w.len)||((w&&w.arc&&w.bulge)?ScribeEngine.wallCurveLength(w):dist(w.a,w.b)));
    const support=[];
    (S.items||[]).forEach(it=>{
      if(it.wall===i){
        const half=Math.max(0,Number(it.width)||0)/2+Math.max(0,Number(it.frameThick)||Number(w&&w.thick)||0);
        const h=half/L,t=Math.max(0,Math.min(1,Number(it.t)||0));
        support.push([Math.max(0,t-h),Math.min(1,t+h)]);
      }else if(it.attachedWall===i&&it.p){
        const t=Math.max(0,Math.min(1,param(it.p,{a:w.a,b:w.b})));
        const h=Math.max(0,Number(it.width)||Number(it.size)||0)/(2*L);
        support.push([Math.max(0,t-h),Math.min(1,t+h)]);
      }
    });
    support.forEach(r=>merged.push(r));
    merged.sort((a,b)=>a[0]-b[0]);
    const joined=[];
    merged.forEach(r=>{if(r[1]-r[0]<1e-6)return;const last=joined[joined.length-1];if(last&&r[0]<=last[1]+1e-6)last[1]=Math.max(last[1],r[1]);else joined.push([...r]);});
    return joined;
  });
  const nextWalls=[],map=oldWalls.map(()=>[]);
  oldWalls.forEach((w,i)=>{
    (rangesByWall[i]||[]).forEach(([t0,t1])=>{
      const pointAt=t=>w.arc&&w.bulge?ScribeEngine.pointOnWall(w,t):({x:w.a.x+(w.b.x-w.a.x)*t,y:w.a.y+(w.b.y-w.a.y)*t});
      const a=pointAt(t0),b=pointAt(t1);
      if(dist(a,b)<.5)return;
      const newIndex=nextWalls.length;
      let nw;
      if(w.arc&&w.bulge){
        const qm=pointAt((t0+t1)/2),mx=(a.x+b.x)/2,my=(a.y+b.y)/2,dx=b.x-a.x,dy=b.y-a.y,ll=Math.hypot(dx,dy)||1;
        const nx=-dy/ll,ny=dx/ll,newBulge=(qm.x-mx)*nx+(qm.y-my)*ny;
        nw={...w,a,b,bulge:newBulge,len:0};
        nw.len=ScribeEngine.wallCurveLength(nw);
      }else nw={...w,a,b,len:dist(a,b)};
      nextWalls.push(nw);map[i].push({index:newIndex,t0,t1});
    });
  });
  const remap=(oldIndex,t)=>{
    const parts=map[oldIndex]||[];
    const part=parts.find(x=>t>=x.t0-1e-6&&t<=x.t1+1e-6);
    return part?{index:part.index,t:Math.max(0,Math.min(1,(t-part.t0)/(part.t1-part.t0||1)))}:null;
  };
  const wallMeasure=w=>w&&w.a&&w.b?((w.arc&&w.bulge)?(Number(w.len)||dist(w.a,w.b)):dist(w.a,w.b)):0;
  const oldTotal=oldWalls.reduce((sum,w)=>sum+wallMeasure(w),0);
  const newTotal=nextWalls.reduce((sum,w)=>sum+wallMeasure(w),0);
  const removedLength=Math.max(0,oldTotal-newTotal);
  if(removedLength<1){showToast('未发现可清理的开放墙线；闭合区域已全部保留');return;}
  // 必须在重映射构件索引之前保存快照，保证撤销可完整恢复原墙体与构件。
  saveUndo();
  const keptItems=[];
  (S.items||[]).forEach(it=>{
    if(Number.isInteger(it.wall)){
      const r=remap(it.wall,Number(it.t)||0);if(!r)return;
      it.wall=r.index;it.t=r.t;
    }
    if(Number.isInteger(it.attachedWall)){
      const old=oldWalls[it.attachedWall],p=it.p||old?.a;
      if(old&&p){const t=Math.max(0,Math.min(1,param(p,{a:old.a,b:old.b}))),r=remap(it.attachedWall,t);it.attachedWall=r?r.index:null;}
    }
    keptItems.push(it);
  });
  S.walls=nextWalls;S.items=keptItems;
  (S.items||[]).forEach(it=>{if(it.type==='opening')syncOpeningBridgeLine(it);});
  clearWallChain();selectedWall=-1;editWallIndex=-1;editEnd=null;cornerCache=null;drawingRoomLoopsCache=undefined;persist();draw();
  showToast('修剪完成：清理约 '+Math.round(removedLength)+' mm 非闭合墙线，闭合区域墙线已保留');
}

function showRooms(){
  if (!S.roomNames) S.roomNames = {};
  const rs = roomLoops();
  
  if (!rs || !rs.length) {
    return panel('房间统计', `<div style="padding:10px 0;color:#637083;">暂未识别到封闭房间。<br><br>请检查墙体端点是否吸附连接并形成闭合轮廓。</div>`);
  }

  // 1. 排序：与画布上的区域编号完全保持一致（先按 Y 轴，再按 X 轴）
  const sortedRooms = rs.map(room => {
    let area = 0, cx = 0, cy = 0;
    const pts = room.points;
    if (!pts || pts.length === 0) return null;
    for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
      const p1 = pts[j], p2 = pts[k];
      const f = p1.x * p2.y - p2.x * p1.y;
      cx += (p1.x + p2.x) * f;
      cy += (p1.y + p2.y) * f;
      area += f * 3;
    }
    if (area === 0) { cx = pts[0].x; cy = pts[0].y; }
    else { cx = cx / area; cy = cy / area; }
    return { ...room, cx, cy };
  }).filter(r => r !== null).sort((a, b) => a.cy - b.cy || a.cx - b.cx);

  let totalArea = 0;
  let totalPerimeter = 0;
  
  let html = `<div style="font-size:13px;color:#637083;margin-bottom:8px">识别到 ${sortedRooms.length} 个闭合区域</div>
              <div style="max-height: 50vh; overflow-y: auto; margin-bottom: 12px;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: center;">
                  <thead>
                    <tr style="border-bottom: 1px solid #dce5f0; color: #78879b; font-weight: 600;">
                      <th style="padding: 8px 0; text-align: left;">区域 (长按改名)</th>
                      <th>面积 (m²)</th>
                      <th>周长 (m)</th>
                    </tr>
                  </thead>
                  <tbody>`;

  sortedRooms.forEach((r, i) => {
    const pts = r.points;
    let rawArea = 0;
    let perimeter = 0;

    // 一次遍历同时计算面积和周长
    for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
      const p1 = pts[j], p2 = pts[k];
      // 累加鞋带公式面积
      rawArea += (p1.x * p2.y - p2.x * p1.y);
      // 累加相邻两点距离（周长）
      perimeter += Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }

    const area = Math.abs(rawArea) / 2 / 1e6; // 平方毫米转平方米
    totalArea += area;

    perimeter /= 1000; // 毫米转米
    totalPerimeter += perimeter;

    // 生成房间唯一 ID (以中心点坐标作为标记)
    const roomId = Math.round(r.cx) + '_' + Math.round(r.cy);
    const defaultName = '区域 ' + (i + 1);
    const displayName = (S.roomNames && S.roomNames[roomId]) ? S.roomNames[roomId] : defaultName;

    html += `<tr style="border-bottom: 1px solid #f1f5f9;">
               <td style="padding: 10px 0; text-align: left;">
                 <span class="room-name-edit" data-room-id="${roomId}" data-default="${defaultName}" style="display:inline-block; min-width:50px; padding:4px 8px; border-radius:6px; background:#eef5fc; color:#1e293b; font-weight:700; cursor:pointer; user-select:none;">${displayName}</span>
               </td>
               <td style="color: #1677e8; font-weight: 600;">${area.toFixed(2)}</td>
               <td style="color: #0ea5e9; font-weight: 600;">${perimeter.toFixed(2)}</td>
             </tr>`;
  });

  html += `   </tbody>
              </table>
            </div>
            
            <div style="display: flex; justify-content: space-between; padding: 12px; background: #f4f8fc; border-radius: 8px; border: 1px solid #e2eaf4; font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom:8px;">
              <span>面积合计：<span style="color: #1677e8;">${totalArea.toFixed(2)} m²</span></span>
              <span>周长合计：<span style="color: #0ea5e9;">${totalPerimeter.toFixed(2)} m</span></span>
            </div>
            <div class="hint">面积按墙体中心线围合范围计算；弧墙按端点近似，复杂交叉或未闭合边界可能无法正确识别。长按区域名称可修改。</div>`;

  panel('房间统计', html);

  // ----- 绑定长按改名事件 -----
  const nameSpans = $('body').querySelectorAll('.room-name-edit');
  nameSpans.forEach(span => {
    let pressTimer = null;
    let isMoved = false;
    let startX = 0, startY = 0;

    span.addEventListener('pointerdown', (e) => {
      isMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      clearTimeout(pressTimer);
      // 长按 0.6 秒触发编辑
      pressTimer = setTimeout(async () => {
        if (!isMoved) {
          const roomId = span.dataset.roomId;
          const currentName = span.textContent;
          const newName = await LinuoDialog.input('修改区域名称', '请输入区域名称', currentName);
          if (newName !== null && newName.trim() !== '') {
            S.roomNames[roomId] = newName.trim();
            persist();
            if (typeof draw === 'function') draw(); // 画布实时同步
            span.textContent = newName.trim(); // 局部更新表格UI
            if (typeof showToast === 'function') showToast('区域名称已修改');
          }
        }
      }, 600); 
    });

    // 手指滑动距离超过 10px 就视为滚动，取消长按
    span.addEventListener('pointermove', (e) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) {
        isMoved = true;
        clearTimeout(pressTimer);
      }
    });

    span.addEventListener('pointerup', () => clearTimeout(pressTimer));
    span.addEventListener('pointercancel', () => clearTimeout(pressTimer));
    // 阻止移动端原生长按菜单
    span.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

/* ---------- 通用文件下载：兼容移动端浏览器 ---------- */
function downloadFileBlob(blob,filename){ return outModule.downloadFileBlob(blob,filename); }
function exportDXF(){ return outModule.exportDXF(); }
function exportJSON(){ return outModule.exportJSON(); }
function importJSONData(input){ return outModule.importJSONData(input); }

/* ---------- 规划端点自动识别及闭合判断 ---------- */
function routePointKey(p){return Math.round(p.x/2)+','+Math.round(p.y/2);}
function hasExistingWallPath(a,b){
  const walls=(S.walls||[]).filter(w=>w&&w.a&&w.b&&!w.arc);
  const near=(p,q)=>dist(p,q)<=3;
  const queue=[a],seen=[];
  while(queue.length){
    const p=queue.shift();
    if(seen.some(q=>near(q,p)))continue;
    seen.push(p);
    if(near(p,b))return true;
    walls.forEach(w=>{
      if(near(w.a,p))queue.push(w.b);
      if(near(w.b,p))queue.push(w.a);
    });
  }
  return false;
}
function isClosedConnectionPoint(a,b){return hasExistingWallPath(a,b);}
function getPlanningDoorEndpointPairs(){
  const pairs=[];
  // 入户门的两个端点属于同一门洞，不能同时作为规划起点和终点。
  const entry=getEntryDoorPoints()||[];
  if(entry.length===2)pairs.push([{x:entry[0].x,y:entry[0].y},{x:entry[1].x,y:entry[1].y}]);
  // 普通门洞以两条门垛线的外端点组成一组；同一门洞的两端不能互相规划连接。
  (S.items||[]).forEach(it=>{
    if(!it||it.type!=='opening')return;
    const jambs=getOpeningJambs(it)||[];
    const ends=jambs.map(seg=>seg&&seg.b).filter(Boolean);
    if(ends.length===2)pairs.push([{x:ends[0].x,y:ends[0].y},{x:ends[1].x,y:ends[1].y}]);
  });
  return pairs;
}
function getAutoPlanningPair(){
  const pts=(wallStartPoints()||[]).filter((p,i,arr)=>arr.findIndex(q=>dist(q,p)<2.5)===i);
  if(pts.length<2)return null;
  const doorPairs=getPlanningDoorEndpointPairs();
  let best=null,bd=Infinity;
  for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++){
    const a=pts[i],b=pts[j];
    // 排除同一个门洞的左右两个端点互相配对；单独一个未连接门洞端点仍可与其它位置配对。
    const sameDoorPair=doorPairs.some(pair=>
      (dist(a,pair[0])<2.5&&dist(b,pair[1])<2.5)||
      (dist(a,pair[1])<2.5&&dist(b,pair[0])<2.5)
    );
    if(sameDoorPair)continue;
    const d=dist(a,b);
    if(d>1&&d<bd){bd=d;best=[a,b];}
  }
  return best;
}
function startAutoRoutePlanning(){
  const pts=(wallStartPoints()||[]).filter((p,i,arr)=>
    arr.findIndex(q=>dist(q,p)<2.5)===i
  );

  if(pts.length<2){
    setTool('select');
    showToast('没有找到两个可规划的未闭合端点');
    return;
  }

  // 超过两个端点时，改为用户手动指定起点和终点。
  if(pts.length>2){
    routePlanStart=null;
    routePreview=null;
    showToast('检测到多个未闭合端点，请先点击指定规划起点');
    draw();
    return;
  }

  // 只有两个端点时，保持原来的自动规划方式。
  const pair=getAutoPlanningPair();

  if(!pair){
    setTool('select');
    showToast('这两个端点不能直接配对，请检查门洞连接情况');
    return;
  }

  routePlanStart=null;
  openDoorAutoRouteChooser({...pair[0]},{...pair[1]});
}

// 手动选择路线规划端点
function manualRouteEndpointClick(p){
  const wp=world(p);
  const limit=35/Math.max(scale,0.001);

  const pts=(wallStartPoints()||[]).filter((q,i,arr)=>
    arr.findIndex(v=>dist(v,q)<2.5)===i
  );

  let best=null;
  let bestDistance=limit;

  pts.forEach(q=>{
    const d=dist(wp,q);
    if(d<bestDistance){
      bestDistance=d;
      best={x:q.x,y:q.y};
    }
  });

  if(!best){
    showToast('请点击端点红圈附近，指定有效的墙体端点');
    return;
  }

  // 第一次点击：确定起点。
  if(!routePlanStart){
    routePlanStart={...best};
    showToast('规划起点已确定，请点击另一个端点作为终点');
    draw();
    return;
  }

  // 再次点击同一个起点：取消本次选择，重新选起点。
  if(dist(routePlanStart,best)<2.5){
    routePlanStart=null;
    showToast('已取消起点，请重新点击规划起点');
    draw();
    return;
  }

  // 排除同一个门洞的两个端点直接互相连接。
  const doorPairs=getPlanningDoorEndpointPairs();
  const sameDoorPair=doorPairs.some(pair=>
    (dist(routePlanStart,pair[0])<2.5&&dist(best,pair[1])<2.5)||
    (dist(routePlanStart,pair[1])<2.5&&dist(best,pair[0])<2.5)
  );

  if(sameDoorPair){
    showToast('不能直接连接同一个门洞的两个端点，请重新选择终点');
    return;
  }

  // 起点和终点确定后，继续使用原有路线选择界面。
  const a={...routePlanStart};
  const b={...best};
  routePlanStart=null;

  openDoorAutoRouteChooser(a,b);
}
/* ---------- 门洞端点智能闭合路线 ---------- */
function isDoorWallStartPoint(p){
  if(!p)return false;
  return getEntryDoorPoints().some(q=>dist(q,p)<2.5)||openingEndpointPoints().some(q=>dist(q,p)<2.5);
}
function addRouteSegmentWithEntryGap(a,b,extra={}){
  // 入户门是墙体上的开口标识，不再从墙线数组中切除门宽范围。
  // 即使新墙线正好跨过门洞基线，也只创建一条完整墙线；门体图例负责显示洞口。
  const openingEnds=openingEndpointPointsRaw().filter(q=>dist(q,a)<2.5||dist(q,b)<2.5);
  const before=S.walls.length;
  addWallSegment(a,b,extra);
  if(S.walls.length>before&&openingEnds.length){
    openingEnds.forEach(q=>consumeOpeningEndpointStart(q));
    persist();
  }
}

function commitDoorAutoRoute(points){
  const clean=(points||[]).filter((q,i,a)=>!i||dist(q,a[i-1])>1);

  if(clean.length<2){
    routePreview=null;
    closePanel();
    draw();
    return;
  }

  // 记录当前是否处于连续路径规划模式
  const keepRoutePlan = tool === 'routePlan';

  saveUndo();

  for(let i=0;i<clean.length-1;i++){
    addRouteSegmentWithEntryGap(clean[i],clean[i+1]);
  }

  mergeCollinearWalls();
  splitAllWallIntersections();

  // 清除本次路径状态
  routePreview=null;
  routePlanStart=null;
  clearWallChain();

  closePanel();

  // 非规划模式下才切回选择工具
  if(!keepRoutePlan){
    setTool('select');
  }

  persist();
  fitCanvas();
  draw();

  if(!keepRoutePlan){
    showToast('闭合连接线已创建');
    return;
  }

  showToast('闭合连接线已创建，正在检查剩余端点');

  // 连续规划：重新统计剩余未闭合端点
  window.setTimeout(()=>{
    if(tool!=='routePlan')return;

    const remain=(wallStartPoints()||[]).filter((p,i,arr)=>
      arr.findIndex(q=>dist(q,p)<2.5)===i
    );

    if(remain.length>=2){

      // 还有端点，继续规划
      startAutoRoutePlanning();

    }else{

      // 已没有足够端点，自动退出规划
      setTool('select');
      showToast('闭合连接线已创建，当前没有更多可规划的端点');

    }

  },100);
}
function openDoorAutoRouteChooser(a,b){
  const midX=(a.x+b.x)/2,midY=(a.y+b.y)/2;
  const routes=[
    {id:'hv',name:'先横向，再纵向',points:[{...a},{x:b.x,y:a.y},{...b}]},
    {id:'vh',name:'先纵向，再横向',points:[{...a},{x:a.x,y:b.y},{...b}]},
     {id:'direct',name:'直线连接',points:[{...a},{...b}]}
  ];
  let active=0;
  routePreview={points:routes[0].points};draw();
  panel('规划路线',`
    <div class="hint" style="margin:0 0 10px">选择路线时，画布会同步预览。点击路线名称后，再点击“确认连接”完成绘制。</div>
    <div id="routeChoices" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;width:100%">
      ${routes.map((r,i)=>`<button type="button" style="min-width:0;padding:8px 3px;font-size:12px;white-space:normal" class="${i===0?'primary':'secondary'}" data-route="${i}">${r.name}</button>`).join('')}
    </div>
    <div class="actions"><button class="primary" id="routeConfirm">确认连接</button><button class="secondary" id="routeCancel">取消</button></div>
  `);
  const selectRoute=i=>{
    active=i;routePreview={points:routes[i].points};draw();
    document.querySelectorAll('[data-route]').forEach((el,j)=>{el.className=j===i?'primary':'secondary';});
  };
  document.querySelectorAll('[data-route]').forEach(el=>{
    el.onclick=()=>selectRoute(Number(el.dataset.route));
    el.onpointerenter=()=>selectRoute(Number(el.dataset.route));
  });
  $('routeConfirm').onclick=()=>commitDoorAutoRoute(routes[active].points);
  $('routeCancel').onclick=()=>{routePreview=null;closePanel();setTool('select');draw();};
}

/* ---------- 指针交互 ---------- */

function snapPointPlacement(p){
  const wp=world(p),limit=30/Math.max(scale,.001);
  let best=null,bd=limit,kind='';
  // 夹角处优先吸附到房间顶点。
  (roomLoops()||[]).forEach(r=>(r.points||[]).forEach(q=>{
    const d=dist(q,wp);if(d<bd){bd=d;best={x:q.x,y:q.y};kind='corner';}
  }));
  // 未命中角点时，吸附到最近墙边。
  if(!best){
    (S.walls||[]).forEach(w=>{
      if(!w||!w.a||!w.b)return;
      const dx=w.b.x-w.a.x,dy=w.b.y-w.a.y,ll=dx*dx+dy*dy||1;
      const t=Math.max(0,Math.min(1,((wp.x-w.a.x)*dx+(wp.y-w.a.y)*dy)/ll));
      const q={x:w.a.x+dx*t,y:w.a.y+dy*t},d=dist(q,wp);
      if(d<bd){bd=d;best=q;kind='wall';}
    });
  }
  return best?{point:best,kind,distance:bd}:null;
}
function pointFrameMargin(it){
  if(!it||!it.p)return {x:0,y:0};
  const pos=getPointPos(it);if(!pos)return {x:0,y:0};
  let bestX=null,bestY=null;
  (S.walls||[]).forEach(w=>{
    if(!w||!w.a||!w.b)return;
    const dx=w.b.x-w.a.x,dy=w.b.y-w.a.y,L=Math.hypot(dx,dy)||1;
    const d=Math.abs((it.p.x-w.a.x)*dy-(it.p.y-w.a.y)*dx)/L;
    const ux=dx/L,uy=dy/L;
    if(Math.abs(ux)>.95){
      const gap=Math.max(0,d);
      if(!bestY||gap<bestY.value)bestY={value:gap,side:it.p.y>=w.a.y?'top':'bottom'};
    }else if(Math.abs(uy)>.95){
      const gap=Math.max(0,d);
      if(!bestX||gap<bestX.value)bestX={value:gap,side:it.p.x>=w.a.x?'right':'left'};
    }
  });
  return {x:bestX?Math.round(bestX.value):0,y:bestY?Math.round(bestY.value):0,xSide:bestX&&bestX.side,ySide:bestY&&bestY.side};
}
function createPointAt(wp,toolType){
  const snap=pointOnWall(screen(wp));
  if(snap)wp=posOnWall(S.walls[snap.i],snap.t);
  const rs=roomLoops();
  if(!rs.length){showToast('画布中暂无闭合空间，无法放置该符号');return;}
  const insideRoom=rs.find(r=>pointInPolygon(wp,r.points));
  if(!insideRoom){showToast('只能放置在闭合空间内部');return;}
  const conf={drain:{size:110,label:'马桶下水'},floorDrain:{size:75,label:'地漏'},sewer:{size:110,label:'立管'},column:{length:300,width:300,label:'柱'},chimney:{length:500,width:500,label:'烟道'}}[toolType];
  if(!conf)return;
  saveUndo();
  const it={type:toolType,p:{...wp},label:conf.label,note:'',attachedWall:toolType==='chimney'&&snap?snap.i:null};
  let sx=0,sy=0;insideRoom.points.forEach(q=>{sx+=q.x;sy+=q.y;});
  const cx=sx/insideRoom.points.length,cy=sy/insideRoom.points.length;
  it.marginXSide=wp.x<cx?'left':'right';it.marginYSide=wp.y<cy?'bottom':'top';
  if(toolType==='column'||toolType==='chimney'){it.length=conf.length;it.width=conf.width;it.size=Math.max(conf.length,conf.width);}
  else it.size=conf.size;
  const margins=pointFrameMargin(it);
  it.marginX=margins.x;it.marginY=margins.y;
  if(margins.xSide)it.marginXSide=margins.xSide;
  if(margins.ySide)it.marginYSide=margins.ySide;
  S.items.push(it);persist();scheduleAutoSelect();setTool('select');zoomToWorldPoint(wp);openPointEditor(it);draw();
}

function onDown(e){
  e.preventDefault();
  if(mandatorySetupLock)return;
  const p=getPointer(e);
  // 墙体参数面板打开时，红圈端点支持直接拖动；先判断端点，避免 closePanel 清空编辑状态。
  if(editWallIndex>=0&&editEnd&&S.walls[editWallIndex]){
    const handle=screen(S.walls[editWallIndex][editEnd]);
    if(dist(p,handle)<22){
      preview=null;snapHint=null;
      try{cv.setPointerCapture(e.pointerId);}catch(err){}
      pointers.set(e.pointerId,p);
      clearTimeout(longPressTimer);longPressStartP=null;longPressTriggered=false;
      dragWallEndpoint={index:editWallIndex,endKey:editEnd,start:{...p},moved:false,saved:false,historySnapshot:null};
      return;
    }
  }
  if($('panel').classList.contains('show'))closePanel();
  preview=null;
  snapHint=null;
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId,p);
  
  // 双击检测逻辑已移除，保留 canvas 的 dblclick 放大功能

  longPressTriggered = false;
  clearTimeout(longPressTimer);
  longPressStartP = p;
  longPressTimer = setTimeout(() => {
    if (pointers.size === 1) {
      longPressTriggered = true;
      handleLongPress(p);
    }
  }, 600);

  if(pointers.size===2){
    const a=[...pointers.values()];
    let textMode=false, textIdx=-1, fontStart=15;
    if(selectedText>=0 && S.texts[selectedText]){
      textMode=true; textIdx=selectedText; fontStart=S.texts[selectedText].fontSize||15;
    }
    const pinchMid={x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2};
    pinch={d:dist(a[0],a[1]),scale,mid:pinchMid,anchorWorld:world(pinchMid),
      textMode, textIdx, fontStart};
    draft=null;
    return;
  }

// 路线规划时优先处理端点选择，避免入户门点击事件提前拦截。
if(tool==='routePlan'){
  manualRouteEndpointClick(p);
  return;
}

// 点击入户门图形主体可直接编辑层高、墙厚及门洞尺寸。
if(hitEntryDoor(p)){
  tapEntryDoor=true;
  return;
}

  if(tool==='wall'||tool==='slant'){
    // 连续绘墙的临时终点仅保留2秒；开始下一段时立即清除旧计时器。
    const chained=(tool==='wall'&&chain)?{...chain}:null;
    if(chained){if(chainTimer)clearTimeout(chainTimer);chainTimer=null;chain=null;}
    const snap=chained?null:nearestWallAnchor(p);
    if (!snap && !chained) {
      pan={p,last:p,origin:{...origin}};
      return;
    }
    const start=snap?{...snap}:(chained?chained:world(p));
    draft={a:start,b:{...start},kind:'wall',fromDoorStart:!!(snap&&isDoorWallStartPoint(start)),denseArea:false};
    draft.denseArea=zoomDenseWallArea(start);
    return;
  }
  if(tool==='octWall'){
    const hit=pointOnWall(p);
    if(hit){openOctWallEditor(hit);return;}
    showToast('请将八角斜墙图例拖到现有墙线上');
    return;
  }
  if(tool==='rect'){
    const snap=nearestRoomSnap(p);
    const a=snap?{...snap}:world(p);
    pending={kind:'room', a:{...a}, b:{...a}};
    draft={kind:'rect', a:{...a}, b:{...a}};
    roomPanel();
    return;
  }

if(tool==='arc'){
    // 弧形墙采用两次点击模式，不使用拖动和连续绘制。
    // 第一次点击：选择红圈标记的起点。
    if(!draft || draft.kind!=='arc'){
      const snap=nearestWallAnchor(
        p,
        null,
        24/Math.max(scale,0.001)
      );

      if(!snap){
        showToast('请先点击红圈标记的门侧端点或未闭合墙线端点');
        return;
      }

      draft={
        kind:'arc',
        a:{...snap},
        b:null,
        bulge:0,
        arcSecondPoint:false
      };

      draw();
      showToast('弧形墙起点已确定，请点击另一个红圈端点');
      return;
    }

    // 第二次点击：选择另一个红圈端点。
    const end=nearestWallAnchor(
      p,
      draft.a,
      24/Math.max(scale,0.001)
    );

    if(!end){
      showToast('请点击另一个红圈标记的端点');
      return;
    }

    if(dist(draft.a,end)<=50){
      showToast('弧形墙的两个端点距离太近，请重新选择');
      return;
    }

    draft.b={...end};
    draft.near={...end};
    draft.arcSecondPoint=true;
    draft.bulge=dist(draft.a,end)*0.2;

    draw();
    showToast('两个端点已确定，请设置弧形墙矢高和墙厚');
    return;
}


  if(tool==='select'){
    if(selectedText>=0&&S.texts[selectedText]){
      const t=S.texts[selectedText];
      const sp=screen(t.p);
      const fs=t.fontSize||15;
      const txt=t.text||'输入文字';
      
      ctx.save();ctx.font=fs+'px sans-serif';
      const w=ctx.measureText(txt).width;
      ctx.restore();
      const scaleH={x:sp.x+w, y:sp.y+fs*0.6};
      if(dist(p,scaleH)<16){
        const historySnapshot=saveUndo();
        dragItem={kind:'textScale',index:selectedText,start:p,last:p,moved:false,startFont:fs,historySnapshot};
        return;
      }
    }
    
    // 优先检测所有文本的箭头端点
    for(let i=S.texts.length-1;i>=0;i--){
      const t=S.texts[i];
      if(t.arrow){
        const ap=screen(t.arrow);
        if(dist(p,ap)<16){
          const historySnapshot=saveUndo();
          selectedText=i; // 自动选中该文本
          dragItem={kind:'textArrow',index:i,start:p,last:p,moved:false,historySnapshot};
          draw();
          return;
        }
      }
    }
    
    // 再检测点击文本本体
    for(let i=S.texts.length-1;i>=0;i--){
      if(hitText(p,S.texts[i])){
        const historySnapshot=saveUndo();
        const t=S.texts[i];
        selectedText=i; // 选中该文本
        dragItem={kind:'text',index:i,start:p,last:p,moved:false,wp:{...t.p},wa:t.arrow?{...t.arrow}:null,historySnapshot};
        draw();
        return;
      }
    }
    const pi=nearestPlacedItem(p);
    if(pi>=0){
      const it=S.items[pi];
      // 所有已创建构件均锁定画布位置；轻点后进入参数编辑，长按仍保留原删除/编辑菜单。
      selectedWall=it.wall??it.attachedWall??-1;
      tapEditItem={index:pi,start:{...p}};
      draw();
      return;
    }
    const hit=pointOnWall(p);
    if(hit){
      selectedWall=hit.i;
      draw();
      const it=S.items.find(x=>x.wall===hit.i&&types[x.type]&&Math.abs(x.t-hit.t)*S.walls[hit.i].len<x.width/2);
      if(it)editPlacedItem(S.items.indexOf(it));
      else wallEditor(hit.i);
    }else{
      pan={p,last:p,origin:{...origin}};
    }
    return;
  }

  if(types[tool]){
    const hit=pointOnWall(p);
    if(hit)itemEditor(hit,tool);
    else showToast('请点击墙线附近');
    return;
  }

  if(pointTypes[tool]){
    // 点状构件先在画布按下并拖动定位，松开后再创建。
    draft={kind:'pointPlace',type:tool,a:world(p),b:world(p)};
    return;
  }
  if(tool==='text'){
    draft={kind:'text', a:world(p), b:world(p)};
    return;
  }
}

function onMove(e){
  const p=getPointer(e);
  if(tapEditItem && dist(tapEditItem.start,p)>8) tapEditItem=null;
  if(pointers.has(e.pointerId))pointers.set(e.pointerId,p);
  if(dragWallEndpoint){
    const d=dragWallEndpoint;
    if(dist(d.start,p)>2){
      if(!d.saved){d.historySnapshot=saveUndo();d.saved=true;}
      let target=world(p);
      // 靠近其它既有端点时自动吸附，避免拖动后留下微小断缝。
      let best=null,bestD=18/Math.max(scale,.001);
      (snapPoints()||[]).forEach(q=>{
        if(dist(q,S.walls[d.index]?.[d.endKey]||q)<1)return;
        const dd=dist(q,target);if(dd<bestD){bestD=dd;best={...q};}
      });
      if(best){target=best;snapHint=screen(best);}else snapHint=null;
      if(moveWallEndpointGeometry(d.index,d.endKey,target))d.moved=true;
      const ew=S.walls[d.index];if(ew)ew.len=wallCurveLen(ew);
      draw();
    }
    return;
  }
  
  if (longPressStartP && dist(p, longPressStartP) > 10) {
    tapEntryDoor=false;
    clearTimeout(longPressTimer);
    longPressStartP = null;
  }

  if(pointers.size===2&&pinch){
    const a=[...pointers.values()];
    const mid={x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2};
    const d=dist(a[0],a[1]);
    // 使用真实双指距离比例，不再衰减缩放幅度；锚点取手势开始时的两指中心。
    const factor=Math.max(0.01,d/(pinch.d||1));
    // 两指中心随手势移动，画布始终围绕最初中心对应的世界坐标缩放。
    if(pinch.textMode && pinch.textIdx>=0 && S.texts[pinch.textIdx]){
      const t=S.texts[pinch.textIdx];
      t.fontSize=Math.max(6,Math.min(200, pinch.fontStart*factor));
      const fsi=$('tfs');
      if(fsi) fsi.value=Math.round(t.fontSize);
      draw();
      return;
    }
    const newScale=Math.max(.025,Math.min(.8,pinch.scale*factor));
    const anchor=pinch.anchorWorld||world(pinch.mid);
    scale=newScale;
    origin={x:mid.x-anchor.x*scale,y:mid.y+anchor.y*scale};
    draw();
    return;
  }

  if(dragItem){
    const di=dragItem;
    if(dist(di.start,p)>4&&!di.moved){di.moved=true;if(!di.saved){saveUndo();di.saved=true;}}
    if(di.kind==='textScale'){
      const t=S.texts[di.index];
      const sp=screen(t.p);
      const d0=dist(di.start,sp);
      const d1=dist(p,sp);
      if(d0>4){
        t.fontSize=Math.max(6,Math.min(200,di.startFont*d1/d0));
        draw();
      }
      return;
    }
    if(di.kind==='textArrow'){
      const t=S.texts[di.index];
      t.arrow=world(p);
      draw();
      return;
    }
    if(di.kind==='text'){
      if(di.moved){
        const t=S.texts[di.index];
        const startW = world(di.start);
        const currW = world(p);
        const dx = currW.x - startW.x;
        const dy = currW.y - startW.y;
        // 文本位置移动
        t.p={x:di.wp.x + dx, y:di.wp.y + dy};
        // 箭头端点也同步移动相同的位移
        if(di.wa){
          t.arrow={x:di.wa.x + dx, y:di.wa.y + dy};
        }
        draw();
      }
      return;
    }
    const it=S.items[di.index];
    if(di.moved){
      if(it.wall!=null&&S.walls[it.wall]){
        const hit=pointOnWall(p);
        if(hit&&hit.i===it.wall){
          it.t=hit.t;
          selectedWall=hit.i;
        }
      }else if(it.p){
        if(pointTypes[it.type]&&di.startWp){
          if(di.origMarginXSide)it.marginXSide=di.origMarginXSide;
          if(di.origMarginYSide)it.marginYSide=di.origMarginYSide;
                    const base=di.startWp;
          const startW = world(di.start);
          const currW = world(p);
          const wp={x:base.x + (currW.x - startW.x), y:base.y + (currW.y - startW.y)};
          it.p=wp;
          
          // 1. 获取构件外轮廓角点
          const outline = getOutlinePoints(it);
          let bestSnap = null;
          const snapLimit = 30; // 像素吸附阈值
          // 2. 第一优先级：外轮廓角点吸附墙体/门窗端点等明确顶点
          const allEndpoints = snapPoints();
          let vertexMinD = snapLimit;
          outline.forEach((corner, idx) => {
            const scrCorner = screen(corner);
            allEndpoints.forEach(ep => {
              const d = dist(scrCorner, screen(ep));
              if (d < vertexMinD) {
                vertexMinD = d;
                bestSnap = { cornerIdx: idx, ep: ep, kind: 'vertex' };
              }
            });
          });
          // 3. 第二优先级：附近没有可吸附顶点时，再让外轮廓角点贴合最近墙线
          if (!bestSnap) {
            let lineMinD = snapLimit;
            outline.forEach((corner, idx) => {
              const hit = pointOnWall(screen(corner));
              if (hit) {
                const d = dist(screen(corner), hit.q);
                if (d < lineMinD) {
                  lineMinD = d;
                  bestSnap = { cornerIdx: idx, ep: world(hit.q), kind: 'line', wallIdx: hit.i };
                }
              }
            });
          }
          
           // 先记录上一帧的位置，用于拖出界时还原
          const oldP = { x: it.p.x, y: it.p.y };
          
          if (bestSnap) {
            // 4. 吸附：把构件的基准点设为该端点，边距归零
            it.p = { x: bestSnap.ep.x, y: bestSnap.ep.y };
            it.marginX = 0;
            it.marginY = 0;
            
            // 5. 根据吸附的角点方位，自动翻转基准方向
            if (bestSnap.cornerIdx === 0) { // 左下
              it.marginXSide = 'left';
              it.marginYSide = 'bottom';
            } else if (bestSnap.cornerIdx === 1) { // 右下
              it.marginXSide = 'right';
              it.marginYSide = 'bottom';
            } else if (bestSnap.cornerIdx === 2) { // 右上
              it.marginXSide = 'right';
              it.marginYSide = 'top';
            } else if (bestSnap.cornerIdx === 3) { // 左上
              it.marginXSide = 'left';
              it.marginYSide = 'top';
            }
            
            snapHint = screen(bestSnap.ep);
            
            // 6. 重置拖动锚点，保证接下来脱离吸附时平滑不跳跃
            di.startWp = { x: it.p.x, y: it.p.y };
            di.start = p;
          } else {
            snapHint = null;
          }
          
          // 7. 闭合空间校验与智能翻转
          if (di.rooms && di.rooms.length) {
            const pos = getPointPos(it);
            if (pos) {
              let inside = di.rooms.some(loop => pointInPolygon({x:pos.cx, y:pos.cy}, loop.points));
              if (!inside) {
                // 尝试翻转方向
                it.marginXSide = it.marginXSide === 'left' ? 'right' : 'left';
                it.marginYSide = it.marginYSide === 'top' ? 'bottom' : 'top';
                const pos2 = getPointPos(it);
                inside = pos2 ? di.rooms.some(loop => pointInPolygon({x:pos2.cx, y:pos2.cy}, loop.points)) : false;
                
                // 如果翻转后依然在外部，说明拖出界了，强制还原位置并打断拖拽
                if (!inside) {
                  it.p = oldP;
                  it.marginXSide = di.origMarginXSide;
                  it.marginYSide = di.origMarginYSide;
                  return; // 不执行重绘，保持在上一帧的合法位置
                }
              }
            }
          } else if (di.rooms && di.rooms.length === 0) {
             // 没有闭合空间，禁止移动
             it.p = oldP;
             return;
          }
        }else{
          it.p=world(p);
          snapHint=null;
        }
      }
      draw();
    }
    return;
  }

 if(draft){
    // 绘图过程中锁定画布位置，禁止自动跟随移动。

    if(draft.kind==='arc'){
        // 弧形墙使用两次点击确定端点。
        return;
    }

    const q=world(p);
    let target=q;
    if(draft.kind==='pointPlace'){
      const snapped=snapPointPlacement(p);
      target=snapped?{...snapped.point}:q;
      draft.snapKind=snapped?snapped.kind:null;
    }else if(tool==='wall'){
      target=angleSnap(draft.a,q);
      // 当前墙段的起点全程排除，终点永远不能吸附回起点。
      // 横竖辅助捕捉：当前线为水平/竖直时，直接求与附近垂直墙段的真实交点。
      // 交点不必刚好是旧墙端点，因此也能吸附到一条较长墙段的中部。
            // 已取消垂点捕捉及与垂直墙线的自动求交。
      // 保留水平、垂直方向锁定及普通端点捕捉。
      let alignBest=null;
      const alignIsPerp=false;
      // 提前计算坐标对齐候选，避免闭合端点捕捉把横/竖方向吸附覆盖掉。
      const axisHintCandidate=nearestAxisAlignedEndpointHint(draft.a,target,26/Math.max(scale,.001));
      // 起点始终排除：无论鼠标是否已经离开起点，都不允许终点回吸到A点。
      const allEnd=nearestEndpoint(
        p,
        6/Math.max(scale,.001),
        draft.a
      );
      // 若闭合候选端点与横/竖对齐点的直线距离不超过500mm，暂停该端点捕捉。
      const axisPriorityPoint=alignBest||(axisHintCandidate&&axisHintCandidate.point);
      const pauseEndpointSnap=!!(allEnd&&axisPriorityPoint&&dist(allEnd,axisPriorityPoint)<=500);

      const endIsOrthogonal=!!(allEnd&&(Math.abs(allEnd.x-draft.a.x)<2||Math.abs(allEnd.y-draft.a.y)<2));
      const endClosesLoop=!!(allEnd&&isClosedConnectionPoint(draft.a,allEnd));
      if(allEnd&&!pauseEndpointSnap&&(endIsOrthogonal||endClosesLoop)){
        target={x:allEnd.x,y:allEnd.y};
        draft.near={x:allEnd.x,y:allEnd.y};
        draft.perpendicular=false;
        draft.axisNear=null;
      }else if(alignBest){
        // 500mm范围内优先采用真实的水平/垂直墙线交点。
        target={x:alignBest.x,y:alignBest.y};
        draft.near={x:alignBest.x,y:alignBest.y};
        draft.perpendicular=alignIsPerp;
        draft.axisNear=null;
      }else if(pauseEndpointSnap&&axisHintCandidate){
        // 暂停闭合端点捕捉，沿当前水平/垂直方向提示对齐点。
        draft.near=null;
        draft.perpendicular=false;
        draft.axisNear=axisHintCandidate;
        if(!draft.axisNoticeShown){
          const axisName=draft.axisNear.axis.toUpperCase();
          showToast('闭合端点与'+axisName+'对齐点相距不超过500mm，已优先正交对齐；松开即可完成');
          draft.axisNoticeShown=true;
        }
      }else{
        const allowedEnd=nearestWallAnchor(p,draft.a,6/Math.max(scale,.001));
        if(allowedEnd){
          target={x:allowedEnd.x,y:allowedEnd.y};
          draft.near={x:allowedEnd.x,y:allowedEnd.y};
          draft.perpendicular=false;
          draft.axisNear=null;
        }else{
          draft.near=null;
          draft.axisNear=axisHintCandidate;
          if(draft.axisNear&&!draft.axisNoticeShown){
            const axisName=draft.axisNear.axis.toUpperCase();
            showToast('发现已有端点的'+axisName+'坐标对齐，距离约'+Math.round(draft.axisNear.gap)+'mm；松开一次即可自动对齐');
            draft.axisNoticeShown=true;
          }
        }
      }
    }else{
      draft.near=draft.kind==='rect'?nearestRoomSnap(p):nearestEndpoint(p);
      if(draft.kind==='rect'&&draft.near)target={...draft.near};
    }
    draft.b=target;
    // 绘图时持续显示实际捕捉后的移动点，避免手指遮挡画布上的精确位置。
    const liveLabel=draft.kind==='pointPlace'?(pointTypes[draft.type]||types[draft.type]||'构件')
      :(draft.near?'已捕捉端点':(draft.kind==='rect'?'房间终点':draft.kind==='text'?'文本定位':'绘图终点'));
    updateMagnifier(screen(target),liveLabel,draft.near?'rgba(10,159,96,.94)':'rgba(31,111,210,.94)');
    if(draft.kind==='arc')draft.bulge=dist(draft.a,target)*0.2;
    if(draft.kind==='rect' && pending && pending.kind==='room'){
      pending.b={...target};
      const rl=$('rlen'), rw=$('rwid');
      if(rl) rl.value=Math.round(Math.abs(pending.b.x-pending.a.x));
      if(rw) rw.value=Math.round(Math.abs(pending.b.y-pending.a.y));
    }
    if(draft.kind==='text'){
      draft.b=world(p);
    }
    draw();
    return;
  }

  if(pan){
    origin={x:pan.origin.x+p.x-pan.p.x,y:pan.origin.y+p.y-pan.p.y};
    draw();
  }
}

async function onUp(e){
  clearTimeout(longPressTimer);
  longPressStartP = null;
  
  if (longPressTriggered) {
    tapEditItem=null;tapEntryDoor=false;
    pointers.delete(e.pointerId);
    if(pointers.size<2)pinch=null;
    return;
  }
  if(tapEntryDoor){tapEntryDoor=false;entryDoorAction();pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;return;}
  
  pointers.delete(e.pointerId);
  if(pointers.size<2)pinch=null;

  if(dragWallEndpoint){
    const d=dragWallEndpoint;dragWallEndpoint=null;snapHint=null;
    if(d.moved){
      const movedPoint=S.walls[d.index]?{...S.walls[d.index][d.endKey]}:null;
      splitAllWallIntersections();
      // 若原墙在移动过程中被交点分段，重新定位包含拖动端点的那一段，红圈仍跟随真实端点。
      if(movedPoint){
        const ni=S.walls.findIndex(ww=>dist(ww.a,movedPoint)<2||dist(ww.b,movedPoint)<2);
        if(ni>=0){editWallIndex=ni;editEnd=dist(S.walls[ni].a,movedPoint)<2?'a':'b';}
      }
      const ew=S.walls[editWallIndex>=0?editWallIndex:d.index];
      if(ew&&$('editLen'))$('editLen').value=Math.round(ew.len||dist(ew.a,ew.b));
      persist();draw();showToast('墙端点及垂直相连墙线已同步移动');
    }else if(d.saved){discardUndoSnapshot(d.historySnapshot);}
    return;
  }

  if(tapEditItem){
    const idx=tapEditItem.index;
    tapEditItem=null;
    if(S.items[idx]) editPlacedItem(idx);
    return;
  }

  if(dragItem){
    const di=dragItem;
    dragItem=null;
    snapHint=null;
    if(di.kind==='textScale'){if(!di.moved)discardUndoSnapshot(di.historySnapshot);draw();return}
    if(di.kind==='text'){
      if(di.moved)draw();
      else discardUndoSnapshot(di.historySnapshot);
      return;
    }
    if(di.moved){
      if(pointTypes[S.items[di.index]?.type] && pointEditIndex===di.index){
        const it=S.items[di.index];
        if($('dleft'))$('dleft').value=Math.round(it.marginX||0);
        if($('dtop'))$('dtop').value=Math.round(it.marginY||0);
                preview={kind:'point',it:{...it}};
        persist();
      }
      draw();
    }else discardUndoSnapshot(di.historySnapshot);
    return;
  }

  if(draft){
    const d=draft;
    draft=null;
    if(d.kind==='pointPlace'){
      createPointAt(d.b||d.a,d.type);
      return;
    }else if(d.kind==='rect'){
      /* 保留 pending，用户可继续输入或点创建 */
      if(pending && pending.kind==='room'){
        const L=Math.abs(pending.b.x-pending.a.x);
        const W=Math.abs(pending.b.y-pending.a.y);
        if(L<50 || W<50){
          pending=null;
          closePanel();
        }
      }
      draw();
    
}else if(d.kind==='arc'){

      // 第一次点击结束时，只保留起点，等待第二次点击。
      if(!d.arcSecondPoint || !d.b){
        draft=d;
        draw();
        showToast('起点已确定，请继续点击另一个红圈端点');
        return;
      }

      // 第二次点击完成，进入弧形墙参数设置。
      const end={...d.b};

      if(dist(d.a,end)>50){

        pending={
          a:{...d.a},
          b:{...end},
          bulge:dist(d.a,end)*0.2,
          thick:S.defaultWallThick||220
        };

        arcPanel();

      }else{

        draft=null;
        pending=null;
        draw();
        showToast('弧形墙两个端点距离太近，请重新操作');

      }

}else if(d.axisNear){
  // 对齐点松开后先进入尺寸确认，必须按数字键盘确认才真正创建墙线。
  const hint={axis:d.axisNear.axis,point:{x:d.axisNear.point.x,y:d.axisNear.point.y}};
  const measured=Math.max(0,Math.round(dist(d.a,hint.point)));
  const start={x:d.a.x,y:d.a.y};
// 保留当前绘图轨迹及绿色对齐捕捉提示
draft={...d};
draw();

  // 删除坐标对齐参数弹窗，只保留数字键盘。
  showToast(`对齐尺寸：${measured} mm，可用数字键盘修改，按 ✓ 确认创建`);

openSharedNumericInput({
  fixedBottom:true,
  value:String(measured),
    onInput:value=>{
      showToast(`当前对齐尺寸：${String(value||'0')} mm，按 ✓ 确认创建`);
    },
    onConfirm:()=>{
    const typed=Math.max(0,Number(sharedNumericProxy&&sharedNumericProxy.value)||0);
    if(typed<=0){showToast('请输入大于0的有效尺寸');return;}
    const sign=hint.axis==='x'?Math.sign(hint.point.x-start.x):Math.sign(hint.point.y-start.y);
    const b=hint.axis==='x'?{x:start.x+sign*typed,y:start.y}:{x:start.x,y:start.y+sign*typed};
 if(dist(start,b)>25){draft=null;saveUndo();const end=addDrawnWallSegment(start,b);mergeCollinearWalls();splitAllWallIntersections();scheduleAutoSelect();setWallChain(end);closePanel();fitCanvas();draw();showToast('已确认坐标对齐并创建墙线');}else{showToast('尺寸过小，未创建墙线');}
  }});
    }else if(d.near){
      const dx=Math.abs(d.near.x-d.a.x),dy=Math.abs(d.near.y-d.a.y);
      // 从门洞/入户门红圈起笔且终点需同时改变X、Y方向时，先让用户选择正交闭合路线。
      if(d.fromDoorStart&&dx>25&&dy>25){
        openDoorAutoRouteChooser(d.a,d.near);
        if(pan)pan=null;
        return;
      }
      const isClose=dist(d.near,d.a)<50;
      const msg=isClose?'终点与起点重合，是否闭合墙体？':(d.perpendicular?'终点已与垂直墙线相交，是否连接？':'终点靠近已有端点，是否连接到此点？');
      if(await LinuoDialog.show(isClose?'闭合确认':'连接确认',msg,[{label:'确认',value:true,primary:true},{label:'取消',value:false}])){
        saveUndo();
        const b={...d.near};
        const end=addDrawnWallSegment(d.a,b);
        mergeCollinearWalls();
        splitAllWallIntersections();
        scheduleAutoSelect();
        setWallChain(end);
        closePanel();fitCanvas();draw();
}else{
  if(d.b&&dist(d.a,d.b)>25){

    // 松手后保留轨迹，等待数字键盘确认
    draft={...d};
    draw();

    wallLengthPanel(d);

  }else{
    draw();
  }
}
    }else if(d.kind==='text'){
      if(dist(d.a,d.b)>10){ // 稍微拖动一点距离即视作创建
        saveUndo();
        const tp={x:d.b.x, y:d.b.y};
        const ar={x:d.a.x, y:d.a.y};
        S.texts.push({p:tp, text:'输入文字', angle:0, fontSize:15, arrow:ar});
        scheduleAutoSelect();
        setTool('select');
        draw();
        textEditor(S.texts.length-1);
      }else{
        draw();
      }
}else{
  if(d.b&&dist(d.a,d.b)>25)wallLengthPanel(d);
  else draw();
}
  }
  if(pan)pan=null;
}


function octWallGeometry(w,values){
  const L=Math.max(0,Number(w.len)||dist(w.a,w.b));
  const long=Number(values.long),short=Number(values.short),depth=Number(values.depth),edge=Number(values.edge);
  const edgeSide=values.edgeSide==='right'?'right':'left';
  if(!Number.isFinite(long)||!Number.isFinite(short)||!Number.isFinite(depth)||!Number.isFinite(edge)||long<=0||short<=0||depth<=0||edge<0||short>long||edge+long>L+0.5)return null;
  const dx=w.b.x-w.a.x,dy=w.b.y-w.a.y,wl=Math.hypot(dx,dy)||1,ux=dx/wl,uy=dy/wl;
  const dir=edgeSide==='right'?-1:1;
  const t=edgeSide==='right'?1-(edge+long/2)/L:(edge+long/2)/L;
  // 方向固定为闭合空间外侧，不再提供内外方向选项。
  const blank=Number(getBlankSide(w,Math.max(.001,Math.min(.999,t))))||1;
  const base=edgeSide==='right'?w.b:w.a;
  const a={x:base.x+ux*dir*edge,y:base.y+uy*dir*edge};
  const b={x:a.x+ux*dir*long,y:a.y+uy*dir*long};
  const nx=-uy,ny=ux,inset=(long-short)/2;
  const c={x:a.x+ux*dir*inset+nx*depth*blank,y:a.y+uy*dir*inset+ny*depth*blank};
  const d={x:a.x+ux*dir*(inset+short)+nx*depth*blank,y:a.y+uy*dir*(inset+short)+ny*depth*blank};
  return {points:[a,c,d,b],segments:[[a,c],[c,d],[d,b]],long,short,depth,edge,edgeSide,side:blank,startPoint:edgeSide==='right'?{...w.b}:{...w.a}};
}
function cutOctWallHostSpan(index,pA,pB){
  const host=S.walls[index];if(!host||host.arc)return false;
  const vx=host.b.x-host.a.x,vy=host.b.y-host.a.y,ll=vx*vx+vy*vy;if(ll<1e-8)return false;
  const param=p=>((p.x-host.a.x)*vx+(p.y-host.a.y)*vy)/ll;
  let t0=param(pA),t1=param(pB);if(t0>t1)[t0,t1]=[t1,t0];
  t0=Math.max(0,Math.min(1,t0));t1=Math.max(0,Math.min(1,t1));
  if(t1-t0<1e-5)return false;
  // 被八角墙覆盖的墙段上若已有门窗等构件，不允许直接切断，避免构件悬空。
  const occupied=(S.items||[]).some(it=>it.wall===index&&Number(it.t)>t0+1e-4&&Number(it.t)<t1-1e-4);
  if(occupied){showToast('八角墙覆盖范围内已有门窗或构件，请先移除或调整构件');return false;}
  const point=t=>({x:host.a.x+vx*t,y:host.a.y+vy*t});
  const left=t0>1e-5?{...host,a:{...host.a},b:point(t0),len:Math.sqrt(ll)*t0}:null;
  const right=t1<1-1e-5?{...host,a:point(t1),b:{...host.b},len:Math.sqrt(ll)*(1-t1)}:null;
  const replacements=[left,right].filter(Boolean);
  // 更新其它墙上构件索引；原墙上的构件按切口两侧重新计算 t。
  (S.items||[]).forEach(it=>{
    if(it.wall>index)it.wall+=replacements.length-1;
    else if(it.wall===index){
      const t=Number(it.t)||0;
      if(t<=t0&&left){it.wall=index;it.t=t0>0?t/t0:0;}
      else if(t>=t1&&right){it.wall=index+(left?1:0);it.t=(t-t1)/(1-t1);}
    }
  });
  S.walls.splice(index,1,...replacements);
  return true;
}

function openOctWallEditor(hit){
  const w=S.walls[hit.i];if(!w||w.arc){showToast('八角斜墙目前请吸附到直墙上');return;}
  const L=w.len||dist(w.a,w.b)||0,last=(S.lastInputs&&S.lastInputs.octWall)||{};
  const suggestLong=Number(last.long)||Math.min(1800,Math.round(L*.65));
  const long=Math.max(1,Math.min(L,suggestLong||L));
  const suggestShort=Number(last.short)||Math.round(long*.62);
  const short=Math.max(1,Math.min(long,suggestShort||long));
  const depth=Number(last.depth)||900;
  const edgeSide=last.edgeSide==='right'?'right':'left';
  const edge=Math.max(0,Math.min(Math.max(0,L-long),Math.round((edgeSide==='right'?(1-hit.t):hit.t)*L-long/2)));
  const initial={long,short,depth,edge,edgeSide};
  let dirHeadBtn=null;
  const getValues=()=>({long:Number($('octLong')?.value)||0,short:Number($('octShort')?.value)||0,depth:Number($('octDepth')?.value)||0,edge:Number($('octEdge')?.value)||0,edgeSide:dirHeadBtn?.dataset.v||initial.edgeSide});
  const refresh=()=>{
    const g=octWallGeometry(w,getValues());
    if(!g){preview=null;draw();return;}
    preview={kind:'octWall',segments:g.segments,startPoint:g.startPoint};draw();
  };
  panel('八角斜墙参数',`<div class="grid4">
    <div class="f"><label>长边</label><input id="octLong" type="number" min="1" value="${initial.long}"></div>
    <div class="f"><label>短边</label><input id="octShort" type="number" min="1" value="${initial.short}"></div>
    <div class="f"><label>深度</label><input id="octDepth" type="number" min="1" value="${initial.depth}"></div>
    <div class="f"><label>距边</label><input id="octEdge" type="number" min="0" value="${initial.edge}"></div>
  </div>
  <div class="hint">图例已吸附到当前墙线。八角墙固定向闭合空间外侧生成；长边沿墙定位，短边居中，深度控制外伸距离。输入完最后一项参数后，直接按数字键盘上的“✓”创建墙线。</div>`);
  // 与门窗完全相同的起点/终点切换按钮，控制距边的起算端。
  const pheadEl=$('phead');
  dirHeadBtn=document.createElement('button');
  dirHeadBtn.id='octEdgeSide';dirHeadBtn.dataset.v=initial.edgeSide;
  dirHeadBtn.textContent=initial.edgeSide==='left'?'从起点':'从终点';
  dirHeadBtn.style.cssText='flex:0 0 auto;margin:0 4px;height:28px;padding:0 10px;border-radius:8px;background:#edf5ff;color:#1677e8;border:1px solid #dcecff;font-size:12px;font-weight:700;white-space:nowrap;';
  if(pheadEl)pheadEl.appendChild(dirHeadBtn);
  dirHeadBtn.onclick=()=>{
    const v=dirHeadBtn.dataset.v==='left'?'right':'left';
    dirHeadBtn.dataset.v=v;dirHeadBtn.textContent=v==='left'?'从起点':'从终点';refresh();
  };
  ['octLong','octShort','octDepth','octEdge'].forEach(id=>$(id)?.addEventListener('input',refresh));
  const createOctWall=()=>{
    const values=getValues(),g=octWallGeometry(w,values);
    if(!g)return alert('参数无效：长边、短边和深度必须大于0；距边不能小于0；短边不能大于长边，且长边必须完整落在当前墙线上。');
    saveUndo();
    // 保存原始数据快照：若切割或创建失败，完整恢复墙线及构件索引，避免出现“预览有、确认后消失”。
    const wallsBefore=S.walls.map(x=>({...x,a:{...x.a},b:{...x.b}}));
    const itemsBefore=S.items.map(x=>({...x}));
    // 删除原墙上被八角墙占用的长边线段，只保留两侧未覆盖墙段；不创建八角墙的长边。
    if(!cutOctWallHostSpan(hit.i,g.points[0],g.points[3])){undoStack.pop();return;}
    const group='oct_'+Date.now();
    // 三条斜边作为独立实体墙线写入模型，并使用组标记防止共线整理误删。
    g.segments.forEach(([a,b],index)=>addWallSegment(a,b,{
      thick:w.thick||S.defaultWallThick||220,
      octWallGroup:group,
      octWallSegment:index
    }));
    const created=g.segments.every(([a,b])=>S.walls.some(ww=>
      ww.octWallGroup===group &&
      ((dist(ww.a,a)<0.5&&dist(ww.b,b)<0.5)||(dist(ww.a,b)<0.5&&dist(ww.b,a)<0.5))
    ));
    if(!created){
      S.walls=wallsBefore;S.items=itemsBefore;undoStack.pop();
      preview=null;draw();showToast('八角斜墙创建失败，已恢复原墙线，请调整参数后重试');return;
    }
    // 不在此处重新拆分全图墙线，避免改变刚创建的三条斜边及其组关系。
    S.lastInputs=S.lastInputs||{};S.lastInputs.octWall={...values};
    preview=null;persist();closePanel();setTool('select');draw();showToast('八角斜墙已创建');
  };
  // 不再创建独立的“确认创建墙线”按钮，最后一个数字输入框的 ✓ 直接调用创建逻辑。
  panelNumericConfirmAction=createOctWall;
  refresh();
}

/* ---------- 矩形 / 弧墙 ---------- */
function createRect(a,b){
  const p1={x:a.x,y:a.y},p2={x:b.x,y:a.y},p3={x:b.x,y:b.y},p4={x:a.x,y:b.y};
  saveUndo();
  [[p1,p2],[p2,p3],[p3,p4],[p4,p1]].forEach(([s,e])=>addWallSegment(s,e));
  mergeCollinearWalls();
  splitAllWallIntersections();
  scheduleAutoSelect();
  draw();
}

function arcPanel(){
  const chord=dist(pending.a,pending.b);
  const def=Math.round(chord*0.2);
  pending.bulge=def;
  pending.thick=S.defaultWallThick||220;
  panel('弧墙设置',`
    <div class="grid4">
      <div class="f"><label>矢高（可为负）</label><input id="abg" type="number" value="${def}"></div>
      <div class="f"><label>墙厚</label><input id="ath" type="number" value="${S.defaultWallThick||220}"></div>
	      <div class="actions">
      <button class="primary" id="aok">确定</button>
      <button class="secondary" id="aflip" style="color:var(--blue); font-size:12px;">反向弯曲</button>
    </div>
    </div>

    <div class="hint">矢高为弧线中点相对弦长的偏移量，负值表示向另一侧弯曲；调整数值时画布实时预览。</div>
  `);
  const sync=()=>{
    pending.bulge=Number($('abg').value)||0;
    pending.thick=Number($('ath').value)||220;
    draw();
  };
  $('abg').addEventListener('input',sync);
  $('ath').addEventListener('input',sync);
  $('aflip').onclick=()=>{
    $('abg').value=-Number($('abg').value||0);
    sync();
  };
  $('aok').onclick=()=>{
    const bg=Number($('abg').value)||0;
    const th=Number($('ath').value)||220;
    saveUndo();
    const w={a:{...pending.a},b:{...pending.b},arc:true,bulge:bg,thick:th};
    w.len=wallCurveLen(w);
    S.walls.push(w);
    splitAllWallIntersections();
    scheduleAutoSelect();
    pending=null;
    closePanel();draw();
  };
  draw();
}

function isBlankMeasureProject(){
  return !(S.walls||[]).length&&!(S.items||[]).length&&!(S.texts||[]).length&&!(S.measures||[]).length;
}

// 首次登录、后续登录以及新建图纸统一调用此函数，避免重复维护两套提醒。
function showMeasureStartNotice(){
  const blank=isBlankMeasureProject();
  if(blank){
    const door=S.entryDoor;
    if(!door||!door.a||!door.b){
      const width=900,thick=Math.max(1,Number(S.defaultWallThick)||220);
      S.entryDoor={a:{x:-width/2,y:0},b:{x:width/2,y:0},width,height:2100,sill:0,thick,insideSide:1};
    }
    // 以基础适配比例为基准放大 6 倍，不在多次登录/新建时累乘。
    const base=Number(fitBaseScale)||Number(scale)||0.08;
    scale=Math.min(0.48,Math.max(0.006,base*6));
    fitBaseScale=base;
    const d=S.entryDoor,cx=(d.a.x+d.b.x)/2,cy=(d.a.y+d.b.y)/2;
    origin={x:W/2-cx*scale,y:H/2+cy*scale};
    persist();draw();
  }
  const title=blank?'开始量房':'继续量房';
  const headline=blank?'已自动添加入户门，画布已放大 6 倍':'已载入当前图纸，可继续绘制';
  const detail=blank
    ?'建议从入户门两侧端点开始绘制墙体。也可以选择右下角“其它”工具夹中的“房间”工具开始。'
    :'可直接继续绘制墙体；需要新建户型时，点击顶部“新建图纸”，并在参数窗口确认左手或右手操作。';
  panel(title, `
    <div style="padding:8px 2px;text-align:center">
      <div style="font-size:16px;font-weight:700;color:#24364b">${headline}</div>
      <div style="font-size:13px;color:#718096;line-height:1.8;margin-top:8px">${detail}</div>
      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="primary" id="startMeasureNow" style="flex:1">${blank?'从入户门开始':'继续画墙线'}</button>
      </div>
    </div>
  `);
  const startBtn=$('startMeasureNow');
  if(startBtn)startBtn.onclick=()=>{closePanel();setTool('wall');draw();};
}

// 登录成功后执行同一套启动准备与提醒逻辑。已有墙体的图纸只提示继续，不重置比例或覆盖数据。
window.addEventListener('linuo:login',()=>{
  window.setTimeout(()=>{
    try{showMeasureStartNotice();}
    catch(error){console.error('[立诺量房] 登录启动提示失败：',error);}
  },360);
});

async function clearAll(){
  const enteredProjectName=await LinuoDialog.input('新建图纸','请输入图纸名称','未命名图纸');
  if(enteredProjectName===null)return;
  const confirmedProjectName=String(enteredProjectName).trim()||'未命名图纸';
  // 第一步立即清空画布，随后才显示新图纸参数输入。
  // 清空前保存一次完整快照，用户仍可通过撤销恢复旧图纸。
  saveUndo();
  closePanel(); // 清除上一轮编辑面板与键盘状态，避免旧输入框继续接收数据。
  mandatorySetupLock=true;
  const previous = S;
  S = Object.assign({}, previous, {
    walls: [], items: [], texts: [], measures: [], entryDoor: null,
    lastInputs: {}, roomNames: {}, projectName: confirmedProjectName
  });
  clearWallChain();
  selectedWall=-1; editWallIndex=-1; editEnd=null; preview=null;
  selectedText=-1; tapEditItem=null; pending=null; draft=null;
  if($('projectNameInp')) $('projectNameInp').value = confirmedProjectName;
  if($('heightInp')) $('heightInp').value = 2700;
  S.height = 2700;
  S.defaultWallThick = Math.max(1, Number(previous.defaultWallThick)||220);
  fitCanvas();
  persist();

  let newProjectHand=uiSide==='right'?'right':'left';
  const handSvg=(side)=>`<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g ${side==='right'?'transform="translate(24 0) scale(-1 1)"':''}><path d="M8 13V5.2a1.55 1.55 0 0 1 3.1 0V12"/><path d="M11.1 11V3.8a1.55 1.55 0 0 1 3.1 0V12"/><path d="M14.2 11V5.3a1.55 1.55 0 0 1 3.1 0v9.1c0 4.1-2.5 6.6-6.2 6.6h-.8c-2.2 0-3.5-1.1-4.6-3L3.8 13.9a1.65 1.65 0 0 1 2.7-1.9L8 13"/></g></svg>`;
  panel('新建图纸参数', `
    <div class="grid4">
      <div class="f"><label>层高（mm）</label><input id="newPHeight" type="number" value="2700"></div>
      <div class="f"><label>入户门宽（mm）</label><input id="newPDoorWidth" type="number" value="900"></div>
      <div class="f"><label>入户门高（mm）</label><input id="newPDoorHeight" type="number" value="2100"></div>
      <div class="f"><label>默认墙厚（mm）</label><input id="newPWallThick" type="number" value="${S.defaultWallThick||220}"></div>
      <div class="f" style="grid-column:1/-1"><label>本张图纸的操作方式</label>
        <div style="display:flex;gap:10px">
          <button type="button" id="newPHandLeft" aria-pressed="${newProjectHand==='left'}" style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;height:38px;border:1px solid ${newProjectHand==='left'?'#1677e8':'#d9e1eb'};border-radius:8px;background:${newProjectHand==='left'?'#edf5ff':'#fff'};color:${newProjectHand==='left'?'#1677e8':'#536177'};font-weight:700">${handSvg('left')} 左手操作</button>
          <button type="button" id="newPHandRight" aria-pressed="${newProjectHand==='right'}" style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;height:38px;border:1px solid ${newProjectHand==='right'?'#1677e8':'#d9e1eb'};border-radius:8px;background:${newProjectHand==='right'?'#edf5ff':'#fff'};color:${newProjectHand==='right'?'#1677e8':'#536177'};font-weight:700">${handSvg('right')} 右手操作</button>
        </div>
      </div>
    </div>
    <div class="hint">图纸名称已确认。设置层高、入户门、墙厚，并确认本张图纸的左手或右手操作方式，按数字键盘确认即可创建。</div>
  `);
  const updateNewProjectHand=()=>{
    ['left','right'].forEach(side=>{
      const btn=$('newPHand'+(side==='left'?'Left':'Right'));
      if(!btn)return;
      const active=newProjectHand===side;
      btn.setAttribute('aria-pressed',String(active));
      btn.style.borderColor=active?'#1677e8':'#d9e1eb';
      btn.style.background=active?'#edf5ff':'#fff';
      btn.style.color=active?'#1677e8':'#536177';
    });
  };
  $('newPHandLeft').onclick=()=>{newProjectHand='left';updateNewProjectHand();};
  $('newPHandRight').onclick=()=>{newProjectHand='right';updateNewProjectHand();};

  // 新建图纸由量房数字键盘 ✓ 统一提交。
  const oldHiddenSubmit=document.getElementById('btnNewOk');
  if(oldHiddenSubmit)oldHiddenSubmit.remove();
  const hiddenSubmit=document.createElement('button');
  hiddenSubmit.id='btnNewOk';hiddenSubmit.type='button';hiddenSubmit.style.display='none';
  hiddenSubmit.setAttribute('aria-hidden','true');
  $('body').appendChild(hiddenSubmit);
  $('btnNewOk').onclick = () => {
    const name = confirmedProjectName==='未命名图纸' ? autoProjectName() : confirmedProjectName;
    const hgt = Number($('newPHeight').value) || 2700;
    const doorWidth=Math.max(100,Number($('newPDoorWidth').value)||900);
    const doorHeight=Math.max(100,Number($('newPDoorHeight').value)||2100);
    const wallThick=Math.max(1,Number($('newPWallThick').value)||220);

    // 已在进入参数页前清空，不重复压入撤销快照。
    S = Object.assign({}, S, {
      walls: [], items: [], texts: [], measures: [],
      height: hgt, defaultWallThick: wallThick, wallThicknessDefaultUpgraded:true,
      entryDoor:{
        a:{x:-doorWidth/2,y:0}, b:{x:doorWidth/2,y:0},
        width:doorWidth, height:doorHeight, sill:0, thick:wallThick, insideSide:1
      },
      lastInputs: {}, roomNames: {}, projectName: name
    });

    // 应用本张图纸确认的左右手布局；比例由统一启动函数按基础适配比例放大 6 倍。
    applyUISide(newProjectHand);

    if($('heightInp')) $('heightInp').value = hgt;
    if($('projectNameInp')) $('projectNameInp').value = name;
    clearWallChain(); selectedWall=-1; editWallIndex=-1; editEnd=null; preview=null;
    mandatorySetupLock=false;
    closePanel();
    draw();
    persist();
    setTool('wall');
    showToast('新图纸已创建，已切换到画墙线模式');

    // 新建图纸与登录后的首次提示共用一个入口，避免重复维护两套弹窗逻辑。
    setTimeout(showMeasureStartNotice,350);

    connectBluetooth({autoOnly:true,silent:true});
  };
}


/* ---------- 公用数字输入与图片标注页面 ---------- */
function closeSharedNumericInput(){
  if(numKbEl)numKbEl.style.display='none';
  if(sharedNumericProxy && activeInput===sharedNumericProxy){
    sharedNumericProxy.style.boxShadow='';
    setActiveInput(null);
  }
  sharedNumericSession=null;
  const tools=document.getElementById('rightTools');
  if(tools){tools.style.zIndex='';if(numKbEl&&numKbEl.parentElement!==tools)tools.appendChild(numKbEl);}
  if(numKbEl){['position','left','right','top','bottom','zIndex','width','maxWidth','height','margin'].forEach(k=>numKbEl.style[k]='');}
}
function openSharedNumericInput(options={}){
  if(!sharedNumericProxy){
    sharedNumericProxy=document.createElement('input');
    sharedNumericProxy.type='text';
    sharedNumericProxy.id='linuoSharedNumericProxy';
    sharedNumericProxy.setAttribute('aria-hidden','true');
    sharedNumericProxy.tabIndex=-1;
    sharedNumericProxy.style.cssText='position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(sharedNumericProxy);
    sharedNumericProxy.addEventListener('input',()=>{
      if(sharedNumericSession&&typeof sharedNumericSession.onInput==='function'){
        sharedNumericSession.onInput(String(sharedNumericProxy.value||'0'));
      }
    });
  }
  sharedNumericSession=options||{};
  sharedNumericProxy.value=String(options.value===undefined?'0':options.value);
  setActiveInput(sharedNumericProxy);
  isFirstInput=true;
  const tools=document.getElementById('rightTools');
  const photoOpen=!!(photoAnnotationOverlay&&photoAnnotationOverlay.classList.contains('open'));
  if(photoOpen){
(photoAnnotationOverlay.querySelector('.app') || photoAnnotationOverlay).appendChild(numKbEl);
    if(tools)tools.style.zIndex='';
    numKbEl.style.position='absolute';
    numKbEl.style.top='auto';
    numKbEl.style.bottom='calc(58px + env(safe-area-inset-bottom) + 8px)';
    numKbEl.style.left=uiSide==='left'?'8px':'auto';
    numKbEl.style.right=uiSide==='right'?'8px':'auto';
    numKbEl.style.zIndex='10020';
    numKbEl.style.width='max-content';
    numKbEl.style.maxWidth='190px';
  }else{
    if(tools){tools.appendChild(numKbEl);tools.style.zIndex='11000';}
    numKbEl.style.position='fixed';
    numKbEl.style.left=uiSide==='left'?'10px':'auto';
    numKbEl.style.right=uiSide==='right'?'10px':'auto';
    numKbEl.style.bottom='auto';
    numKbEl.style.top='auto';
    numKbEl.style.zIndex='11001';
    numKbEl.style.width='max-content';
    numKbEl.style.maxWidth='190px';
  }
  numKbEl.style.display='grid';
  updateKeyboardLayout(uiSide);
if(!photoOpen){
  if(sharedNumericSession && sharedNumericSession.fixedBottom){
    // 对齐数字键盘：固定在原有底部高度
    const bottomOffset = tools
      ? Math.max(0,window.innerHeight-tools.getBoundingClientRect().bottom)
      : 94;

    numKbEl.style.bottom=bottomOffset+'px';
    numKbEl.style.top='auto';
  }else{
    // 其他数字键盘仍保持原来的定位方式
    const panelEl=document.getElementById('panel');
    const panelRect=panelEl&&panelEl.classList.contains('show')
      ?panelEl.getBoundingClientRect():null;
    const kbHeight=numKbEl.getBoundingClientRect().height||260;
    const top=panelRect
      ?Math.max(8,panelRect.top-kbHeight-10)
      :Math.max(8,window.innerHeight-kbHeight-300);
    numKbEl.style.top=top+'px';
  }
}
  // 确认键必须跨越右/左侧布局的最后两行，不能被照片页样式压成单格。
  const confirmKey=numKbEl.querySelector('[data-key="✓"]');
if(confirmKey) {
  confirmKey.style.gridRow = numPadExpanded
    ? '3 / span 2'
    : '4 / span 2';
}
  return true;
}
function openPhotoAnnotation(){
closeSymbolPanels();
  closePanel();
  if(!photoAnnotationOverlay){showToast('图片标注页面未正确载入');return false;}
  if(!window.LinuoPhotoAnnotation||typeof window.LinuoPhotoAnnotation.open!=='function'){showToast('图片标注模块尚未加载');return false;}
  window.LinuoPhotoAnnotation.open();
  document.body.classList.add('photo-annotation-open');
  return true;
}
function closePhotoAnnotation(){
  closeSharedNumericInput();
  if(window.LinuoPhotoAnnotation&&typeof window.LinuoPhotoAnnotation.close==='function')window.LinuoPhotoAnnotation.close();
  if(photoAnnotationOverlay){photoAnnotationOverlay.classList.remove('open');photoAnnotationOverlay.setAttribute('aria-hidden','true');}
  document.body.classList.remove('photo-annotation-open');
}
/* ---------- 蓝牙测距仪接入 ---------- */
let bluetoothDevice = null;
let bluetoothCharacteristic = null;

async function connectBluetooth(options={}) {
  const autoOnly=!!options.autoOnly,silent=!!options.silent;
  if (!navigator.bluetooth) {
    setBtConnected(false);
    if(!silent)alert('当前浏览器不支持 Web Bluetooth API，请使用支持蓝牙的 Chrome 或 Edge。');
    return false;
  }
  const srvUuid=S.btService,charUuid=S.btChar;
  if(!srvUuid||!charUuid){
    if(!silent)alert('请先在菜单“项目设置”中填写蓝牙设备的 服务UUID 和 特征UUID。');
    return false;
  }
  try{
    let device=null;
    if(autoOnly){
      if(typeof navigator.bluetooth.getDevices!=='function')return false;
      const permitted=await navigator.bluetooth.getDevices();
      device=(S.btDeviceId&&permitted.find(d=>d.id===S.btDeviceId))||(!S.btDeviceId?permitted[0]:null);
      if(!device){setBtConnected(false);return false;}
    }else{
      device=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[srvUuid]});
      S.btDeviceId=device.id||null;persist();
    }
    bluetoothDevice=device;
    const server=device.gatt&&device.gatt.connected?device.gatt:await device.gatt.connect();
    const service=await server.getPrimaryService(srvUuid);
    bluetoothCharacteristic=await service.getCharacteristic(charUuid);
    await bluetoothCharacteristic.startNotifications();
    bluetoothCharacteristic.removeEventListener('characteristicvaluechanged',handleBluetoothData);
    bluetoothCharacteristic.addEventListener('characteristicvaluechanged',handleBluetoothData);
    if(!device.__linuoMeasureDisconnectBound){
      device.__linuoMeasureDisconnectBound=true;
      device.addEventListener('gattserverdisconnected',()=>{
        setBtConnected(false);
        if(!silent)showToast('蓝牙测距仪已断开');
      });
    }
    setBtConnected(true);persist();
    if(!silent)showToast('测距仪连接成功，测量数据将自动填入当前输入框');
    return true;
  }catch(error){
    setBtConnected(false);
    const cancelled=error && (error.name==='AbortError' || /cancelled the requestDevice|user cancelled|chooser/i.test(String(error.message||error)));
    if(cancelled){
      if(!silent)showToast('已取消选择蓝牙设备');
      return false;
    }
    console.error('蓝牙连接失败:',error);
    if(!silent)alert('连接失败：'+(error.message||error));
    return false;
  }
}



// 数据解析与填入逻辑
function handleBluetoothData(event) {
  const value = event.target.value; // DataView 对象
  let str = '';
  
  // 1. 将十六进制数据转为字符串
  for (let i = 0; i < value.byteLength; i++) {
    str += String.fromCharCode(value.getUint8(i));
  }
  
  // 2. 用正则表达式提取其中的数字（如 1.770）
  const match = str.match(/(\d+\.\d+|\d+)/);
  if (!match) return;
  
  const distanceMeter = parseFloat(match[0]);
  if (isNaN(distanceMeter) || distanceMeter <= 0) return;

  // 3. 将米(m)转换为毫米(mm)并取整
  const distanceMM = Math.round(distanceMeter * 1000);

  // 4. 自动填入当前选中的输入框 (优先使用系统记录的高亮输入框)
  let targetInput = activeInput; // 全局变量，点击面板或层高时被赋值
  
  // 如果没点击过，降级尝试用焦点元素
  if (!targetInput) {
    targetInput = document.activeElement;
  }

  if (targetInput && (targetInput.tagName === 'INPUT' || targetInput.tagName === 'TEXTAREA')) {
    targetInput.value = distanceMM;
    // 触发 input 事件，让画布上的预览和数值实时更新
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    // 同时触发 change 事件，兼容部分监听 change 的逻辑
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

if(document.getElementById('btnBluetooth')) document.getElementById('btnBluetooth').addEventListener('click', ()=>connectBluetooth({autoOnly:false,silent:false}));

/* 量房与图片标注共用同一套数字键盘、长按语音、蓝牙连接和测距数据通道。 */
window.LinuoSharedInput={
  openNumericInput:openSharedNumericInput,
  closeNumericInput:closeSharedNumericInput,
  connectBluetooth:()=>((bluetoothDevice&&bluetoothDevice.gatt&&bluetoothDevice.gatt.connected)?Promise.resolve(true):connectBluetooth({autoOnly:false,silent:false})),
  isBluetoothConnected:()=>!!(bluetoothDevice&&bluetoothDevice.gatt&&bluetoothDevice.gatt.connected),
  subscribeBluetoothState:(callback)=>{if(typeof callback!=='function')return ()=>{};bluetoothStateListeners.add(callback);callback(bluetoothConnectedState);return ()=>bluetoothStateListeners.delete(callback);},
  closePhotoAnnotation
};

/* ---------- 手机端手势保护：拦截页面手势，连续两次边缘滑动后询问是否退出 ---------- */
(function installMobileGestureGuard(){
  let touchStart=null;
  let edgeBackCount=0;
  let edgeBackResetTimer=null;
  let exitPromptOpen=false;
  let historyGuardReady=false;

  function askExit(){
    if(exitPromptOpen)return;
    exitPromptOpen=true;
    const shouldExit=window.confirm('检测到连续两次屏幕边缘返回手势，是否退出当前量房页面？');
    exitPromptOpen=false;
    edgeBackCount=0;
    clearTimeout(edgeBackResetTimer);
    if(shouldExit){
      if(window.history.length>1) window.history.back();
      else showToast('当前页面无法由网页自动关闭，请使用浏览器返回键退出。');
    }
  }
  function registerEdgeBack(){
    edgeBackCount++;
    clearTimeout(edgeBackResetTimer);
    edgeBackResetTimer=setTimeout(()=>{edgeBackCount=0;},8000);
    if(edgeBackCount===1){
      showToast('已阻止边缘返回；8秒内再次滑动，将询问是否退出。');
    }else askExit();
  }

  // 只把从屏幕最边缘开始、方向明确的横向滑动识别为返回手势。
  window.addEventListener('touchstart',e=>{
    if(!e.touches||e.touches.length!==1){touchStart=null;return;}
    const t=e.touches[0];
    const target=e.target;
    const interactive=!!(target&&target.closest&&target.closest('input,textarea,select,button,[contenteditable="true"]'));
    touchStart={x:t.clientX,y:t.clientY,handled:false,interactive,
      edgeLeft:t.clientX<=42,edgeRight:t.clientX>=window.innerWidth-42,
      topPull:t.clientY<=100};
  },{passive:false,capture:true});

  window.addEventListener('touchmove',e=>{
    if(!touchStart||!e.touches||e.touches.length!==1)return;
    const t=e.touches[0];
    const dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;
    const horizontal=Math.abs(dx)>22&&Math.abs(dx)>Math.abs(dy)*1.15;
    const vertical=Math.abs(dy)>18&&Math.abs(dy)>Math.abs(dx)*1.15;
    const back=!touchStart.interactive&&horizontal&&
      ((touchStart.edgeLeft&&dx>0)||(touchStart.edgeRight&&dx<0));
    const pull=!touchStart.interactive&&touchStart.topPull&&vertical&&dy>0;
    if(!back&&!pull)return;
    // 在浏览器仍派发触摸事件时尽早取消默认滚动/刷新行为。
    if(e.cancelable)e.preventDefault();
    if(touchStart.handled)return;
    touchStart.handled=true;
    if(back)registerEdgeBack();
    else showToast('已阻止页面下拉刷新。');
  },{passive:false,capture:true});

  const clearTouch=()=>{touchStart=null;};
  window.addEventListener('touchend',clearTouch,{passive:true,capture:true});
  window.addEventListener('touchcancel',clearTouch,{passive:true,capture:true});

  // 浏览器实际触发历史返回时再次压入当前页，并使用相同的二次确认逻辑。
  try{
    history.pushState({linuoGestureGuard:true},'',location.href);
    historyGuardReady=true;
    window.addEventListener('popstate',()=>{
      if(exitPromptOpen)return;
      if(historyGuardReady){
        history.pushState({linuoGestureGuard:true},'',location.href);
        registerEdgeBack();
      }
    });
  }catch(err){/* 某些内嵌浏览器限制历史记录操作，页面触摸拦截仍保留。 */}

  document.documentElement.style.overscrollBehavior='none';
  document.body.style.overscrollBehavior='none';
  document.addEventListener('focusin',e=>{
    const el=e.target;
    if(el&&el.matches&&el.matches('input,select,textarea')){
      el.classList.add('linuo-focus-highlight');
      requestAnimationFrame(()=>{try{el.scrollIntoView({block:'nearest',inline:'nearest'});}catch(_){}});
    }
  },true);
  document.addEventListener('focusout',e=>{
    if(e.target&&e.target.classList)e.target.classList.remove('linuo-focus-highlight');
  },true);
})();

/* ---------- 事件 ---------- */
cv.addEventListener('pointerdown',onDown);
cv.addEventListener('pointermove',onMove);
cv.addEventListener('pointerup',onUp);
cv.addEventListener('pointercancel',onUp);

// 双击画布空白区域：自动适配全部图形
cv.addEventListener('dblclick', e => {
  const p=getPointer(e);
  let hitSomething=false;
for(let i=S.texts.length-1;i>=0;i--){
  if(hitText(p,S.texts[i])){
    // 修复：如果没有处于面板编辑状态，忽略文字的点击，不选中也不允许拖动
    if (selectedText === -1 || !document.getElementById('panel').classList.contains('show')) {
      break; 
    }
    selectedText=i;
    // dragItem={...}; // 保留你原本的拖拽赋值
    break;
  }
}
  if(!hitSomething&&nearestPlacedItem(p)>=0)hitSomething=true;
  if(!hitSomething&&pointOnWall(p))hitSomething=true;
  if(!hitSomething)fitCanvas();
});
cv.addEventListener('wheel',e=>{
  e.preventDefault();
  const p=getPointer(e);
  const anchor=world(p);
  scale=Math.max(.025,Math.min(.8,scale*(e.deltaY<0?1.12:.89)));
  origin={x:p.x-anchor.x*scale,y:p.y+anchor.y*scale};
  draw();
},{passive:false});

document.addEventListener('keydown',e=>{
  const tag=(e.target.tagName||'').toUpperCase();
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  const ctrl=e.ctrlKey||e.metaKey;
  if(!ctrl)return;
  const k=e.key.toLowerCase();
  if(k==='z'&&!e.shiftKey){e.preventDefault();undoAction()}
  else if(k==='y'||(k==='z'&&e.shiftKey)){e.preventDefault();redoAction()}
});

const undoTopBtn=$('undo'),redoTopBtn=$('redo'),undoBottomBtn=$('undoBottom'),redoBottomBtn=$('redoBottom');
function bindHistoryButton(btn,action){
  if(!btn)return;
  btn.type='button';
  // Capture click at the button itself; stop bubbling so other page modules cannot replace/intercept it.
  btn.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();action();},{capture:true});
  btn.addEventListener('pointerup',e=>{if(e.pointerType==='touch'){e.preventDefault();e.stopPropagation();}},{passive:false});
}
bindHistoryButton(undoTopBtn,undoAction);bindHistoryButton(redoTopBtn,redoAction);
bindHistoryButton(undoBottomBtn,undoAction);bindHistoryButton(redoBottomBtn,redoAction);
$('clearAll').onclick=clearAll;

function fitCanvas(){
  const xs=[],ys=[];
  S.walls.forEach(w=>{xs.push(w.a.x,w.b.x);ys.push(w.a.y,w.b.y)});
  const doorGeo=entryDoorGeometry();
  if(doorGeo)[doorGeo.a,doorGeo.b,doorGeo.c,doorGeo.e].forEach(p=>{xs.push(p.x);ys.push(p.y)});
  if(!xs.length){origin={x:W/2,y:H/2};scale=Math.min((W-32)/30000,(H-32)/30000);scale=Math.max(0.006,Math.min(0.08,scale));fitBaseScale=scale;draw();return;}
  const minx=Math.min(...xs),maxx=Math.max(...xs),miny=Math.min(...ys),maxy=Math.max(...ys);
  const isRotated = Math.abs(viewAngle % Math.PI) === Math.PI / 2;
  const availW = isRotated ? H : W;
  const availH = isRotated ? W : H;
  // 完整适配：按 30 米画布范围计算，允许大图继续缩小，不设置会裁切图形的最小缩放值。
  scale=Math.max(.001,Math.min((availW-100)/Math.max(1,maxx-minx),(availH-100)/Math.max(1,maxy-miny),.3));
  fitBaseScale=scale;
  origin={x:W/2-(minx+maxx)/2*scale,y:H/2+(miny+maxy)/2*scale};
  draw();
}
let lastDenseZoomPoint=null;
function zoomDenseWallArea(pt){
  if(!pt||!Array.isArray(S.walls)||!S.walls.length)return false;
  if(lastDenseZoomPoint&&dist(lastDenseZoomPoint,pt)<1000)return false;
  const R=500,near=S.walls.filter(w=>{
    if(!w||!w.a||!w.b)return false;
    const minx=Math.min(w.a.x,w.b.x),maxx=Math.max(w.a.x,w.b.x),miny=Math.min(w.a.y,w.b.y),maxy=Math.max(w.a.y,w.b.y);
    return maxx>=pt.x-R&&minx<=pt.x+R&&maxy>=pt.y-R&&miny<=pt.y+R;
  });
  const keys=new Set(),add=q=>{
    if(q&&Math.abs(q.x-pt.x)<=R&&Math.abs(q.y-pt.y)<=R)keys.add(Math.round(q.x/10)+','+Math.round(q.y/10));
  };
  near.forEach(w=>{add(w.a);add(w.b)});
  for(let i=0;i<near.length;i++)for(let j=i+1;j<near.length;j++){
    const p=segIntersect(near[i].a,near[i].b,near[j].a,near[j].b);
    if(p)add(p);
    if(keys.size>10)break;
  }
  if(keys.size<=10)return false;
  const targetScale=Math.min(.6,Math.max(scale*5,fitBaseScale*5));
  if(scale>=targetScale*.92)return false;
  scale=targetScale;
  lastDenseZoomPoint={x:pt.x,y:pt.y};
  origin={x:W/2-pt.x*scale,y:H/2+pt.y*scale};
  draw();
  showToast('检测到密集交点区域，已自动放大 5 倍，便于精确绘墙');
  return true;
}

function zoomToWorldPoint(pt){
  if(!pt)return;
  // 只移动视口，让当前操作区域居中；保持当前比例，不再自动放大或缩小。
  origin={x:W/2-pt.x*scale,y:H/2+pt.y*scale};
  draw();
}

function offsetOuterWalls(){
  const loops=roomLoops();
  if(!loops.length){showToast('请先绘制至少一个闭合空间');return;}
  const amount=Math.max(1,Number(S.defaultWallThick)||220);
  // 将全部闭合空间的边线合并：相邻空间共用的内部墙边出现两次，抵消后只保留整张图的外边界。
  const key=p=>Math.round(p.x*10)+','+Math.round(p.y*10);
  const allPts=[];
  loops.forEach(loop=>{const pts=loop.points||loop;if(Array.isArray(pts))pts.forEach(p=>allPts.push(p));});
  const edgeMap=new Map();
  const addAtomic=(a,b)=>{
    if(dist(a,b)<0.5)return;
    const ka=key(a),kb=key(b);if(ka===kb)return;
    const id=ka<kb?ka+'|'+kb:kb+'|'+ka;
    const entry=edgeMap.get(id)||{a:{...a},b:{...b},count:0};entry.count++;edgeMap.set(id,entry);
  };
  // 关键修正：先把每条房间边按所有共线交点切成同长度小边，再做重边抵消。
  // 这样即使内部墙被门洞、交点或分段墙拆成不同长度，也不会误认为外边界。
  loops.forEach(loop=>{
    const pts=loop.points||loop;if(!Array.isArray(pts)||pts.length<3)return;
    for(let i=0;i<pts.length;i++){
      const a=pts[i],b=pts[(i+1)%pts.length],vx=b.x-a.x,vy=b.y-a.y,ll=vx*vx+vy*vy;
      if(ll<0.25)continue;
      const cuts=[{t:0,p:a},{t:1,p:b}];
      allPts.forEach(q=>{
        const t=((q.x-a.x)*vx+(q.y-a.y)*vy)/ll;
        if(t<=1e-6||t>=1-1e-6)return;
        const px=a.x+vx*t,py=a.y+vy*t;
        if(Math.hypot(q.x-px,q.y-py)<=0.8)cuts.push({t,p:q});
      });
      cuts.sort((x,y)=>x.t-y.t);
      for(let k=0;k<cuts.length-1;k++)addAtomic(cuts[k].p,cuts[k+1].p);
    }
  });
  // 只保留出现一次的原子边：内部黄色框内的墙线会被相邻闭合空间抵消。
  const boundary=[...edgeMap.values()].filter(e=>e.count===1);
  if(boundary.length<3){showToast('未能从全部闭合空间提取整体外边界');return;}
  const nodes=new Map(),used=new Set(),cycles=[];
  const ensure=(k,p)=>{if(!nodes.has(k))nodes.set(k,{p:{...p},edges:[]});return nodes.get(k);};
  boundary.forEach((e,i)=>{
    const ka=key(e.a),kb=key(e.b);
    ensure(ka,e.a).edges.push(i);ensure(kb,e.b).edges.push(i);
  });
  for(let i=0;i<boundary.length;i++){
    if(used.has(i))continue;
    const first=boundary[i],startKey=key(first.a);
    let currentKey=startKey,edgeIndex=i,prevKey=null;
    const points=[];let guard=0,closed=false;
    while(guard++<boundary.length+4){
      if(used.has(edgeIndex))break;
      used.add(edgeIndex);
      const e=boundary[edgeIndex],ka=key(e.a),kb=key(e.b);
      const nextKey=currentKey===ka?kb:ka;
      points.push(nodes.get(currentKey).p);
      if(nextKey===startKey){closed=true;break;}
      prevKey=currentKey;currentKey=nextKey;
      const options=(nodes.get(currentKey)?.edges||[]).filter(j=>!used.has(j));
      if(!options.length)break;
      // 正常外边界在每个节点只有一条未走边；若有分叉，优先选择转角最小的连续边。
      if(options.length===1){edgeIndex=options[0];continue;}
      const from=nodes.get(prevKey).p,at=nodes.get(currentKey).p;
      const base=Math.atan2(at.y-from.y,at.x-from.x);
      options.sort((a,b)=>{
        const ea=boundary[a],eb=boundary[b],qa=key(ea.a)===currentKey?ea.b:ea.a,qb=key(eb.a)===currentKey?eb.b:eb.a;
        const aa=Math.atan2(qa.y-at.y,qa.x-at.x),ab=Math.atan2(qb.y-at.y,qb.x-at.x);
        const da=(aa-base+Math.PI*2)%(Math.PI*2),db=(ab-base+Math.PI*2)%(Math.PI*2);
        return da-db;
      });
      edgeIndex=options[0];
    }
    if(closed&&points.length>=3){
      let area=0;for(let k=0;k<points.length;k++){const a=points[k],b=points[(k+1)%points.length];area+=a.x*b.y-b.x*a.y;}
      if(Math.abs(area)>1)cycles.push({points,area:Math.abs(area/2)});
    }
  }
  if(!cycles.length){showToast('整体外边界未能闭合，请检查墙线交点是否连接');return;}
  // 每个彼此分离的建筑轮廓均生成外框；不会再只取面积最大的一个房间。
  // 若偏移目标位置已有平行墙线，说明该段已有外墙双线/外侧墙线，不再重复创建。
  // 过滤规则：候选外框线附近 500mm 内若已有平行墙线且投影范围重叠，跳过该段。
  // 特别排除候选线对应的原始房间边界墙，避免默认墙厚本身造成误判。
  const hasExistingParallelWall=(a,b,sourceA,sourceB)=>{
    const L=dist(a,b);
    if(L<50)return false;
    const ux=(b.x-a.x)/L,uy=(b.y-a.y)/L;
    const sourceLen=dist(sourceA,sourceB)||1;
    const sx=(sourceB.x-sourceA.x)/sourceLen,sy=(sourceB.y-sourceA.y)/sourceLen;
    const parallelLimit=Math.cos(8*Math.PI/180);
    const project=(p)=>p.x*ux+p.y*uy;
    const c0=project(a),c1=project(b),cMin=Math.min(c0,c1),cMax=Math.max(c0,c1);
    const sourceProject=(p)=>p.x*sx+p.y*sy;
    const s0=sourceProject(sourceA),s1=sourceProject(sourceB);
    const sMin=Math.min(s0,s1),sMax=Math.max(s0,s1);
    for(const w of S.walls){
      if(!w||!w.a||!w.b)continue;
      const wl=dist(w.a,w.b);
      if(wl<30)continue;
      const vx=(w.b.x-w.a.x)/wl,vy=(w.b.y-w.a.y)/wl;
      if(Math.abs(ux*vx+uy*vy)<parallelLimit)continue;
      const wa=project(w.a),wb=project(w.b);
      const overlap=Math.max(0,Math.min(cMax,Math.max(wa,wb))-Math.max(cMin,Math.min(wa,wb)));
      if(overlap<Math.min(100,Math.min(L,wl)*0.25))continue;
      const mid={x:(w.a.x+w.b.x)/2,y:(w.a.y+w.b.y)/2};
      const spacing=Math.abs((mid.x-a.x)*uy-(mid.y-a.y)*ux);
      if(spacing>=500)continue;

      // 如果这条墙本身就是生成该候选线的原始边界墙，则不作为过滤依据。
      const sourceParallel=Math.abs(sx*vx+sy*vy)>=parallelLimit;
      const sourceDistance=Math.abs((mid.x-sourceA.x)*sy-(mid.y-sourceA.y)*sx);
      const wsa=sourceProject(w.a),wsb=sourceProject(w.b);
      const sourceOverlap=Math.max(0,Math.min(sMax,Math.max(wsa,wsb))-Math.max(sMin,Math.min(wsa,wsb)));
      if(sourceParallel&&sourceDistance<3&&sourceOverlap>=Math.min(100,Math.min(sourceLen,wl)*0.25))continue;
      return true;
    }
    return false;
  };
  const created=[];
  let skippedExistingParallel=0;
  cycles.forEach(loop=>{
    const pts=loop.points,n=pts.length;
    const edges=pts.map((p,i)=>{
      const q=pts[(i+1)%n],dx=q.x-p.x,dy=q.y-p.y,L=Math.hypot(dx,dy)||1;
      const host={a:p,b:q,len:L,thick:amount};
      const outside=Number(getBlankSide(host,.5))||1;
      const nx=-dy/L,ny=dx/L;
      return {p:{x:p.x+nx*amount*outside,y:p.y+ny*amount*outside},v:{x:dx,y:dy}};
    });
    const shifted=pts.map((_,i)=>{
      const A=edges[(i+n-1)%n],B=edges[i],den=A.v.x*B.v.y-A.v.y*B.v.x;
      if(Math.abs(den)<1e-8)return B.p;
      const t=((B.p.x-A.p.x)*B.v.y-(B.p.y-A.p.y)*B.v.x)/den;
      return {x:A.p.x+A.v.x*t,y:A.p.y+A.v.y*t};
    });
    for(let i=0;i<shifted.length;i++){
      const a={...shifted[i]},b={...shifted[(i+1)%shifted.length]};
      if(dist(a,b)<50)continue;
      const mergePoint=p=>{for(const wall of created)for(const q of [wall.a,wall.b])if(dist(q,p)<50)return {...q};return p;};
      const aa=mergePoint(a),bb=mergePoint(b);
      if(dist(aa,bb)<50)continue;
      if(hasExistingParallelWall(aa,bb,pts[i],pts[(i+1)%n])){skippedExistingParallel++;continue;}
      created.push({a:aa,b:bb,len:dist(aa,bb),thick:amount,outerFrame:true});
    }
  });
  if(!created.length){
    if(skippedExistingParallel>0){showToast('检测到现有平行外墙线，已跳过重复偏移；没有需要补建的外框线');return;}
    showToast('没有可创建的整体外框线段');return;
  }
  saveUndo();S.walls.push(...created);mergeCollinearWalls();splitAllWallIntersections();persist();fitCanvas();draw();
  showToast('已创建 '+created.length+' 段外框线，跳过已有平行外墙线 '+skippedExistingParallel+' 段');
}

$('offsetOuter')?.addEventListener('click',offsetOuterWalls);

$('fit').onclick=fitCanvas;

$('rotateCanvas')?.addEventListener('click',e=>{
  e.preventDefault();
  e.stopPropagation();

  // 双重保护：数字键盘打开期间禁止旋转
  if (
    numKbEl &&
    window.getComputedStyle(numKbEl).display !== 'none'
  ) {
    return;
  }

  // 每次顺时针旋转90度
  viewAngle=(viewAngle+Math.PI/2)%(Math.PI*2);
  draw();
});

$('rooms').onclick=()=>{
  closeSymbolPanels();
  showRooms();
};

function getSavedProjects(){
  const listKey='linuo_measure_projects_v1';
  try{const v=JSON.parse(localStorage.getItem(listKey)||'[]');return Array.isArray(v)?v:[];}catch(_){return [];}
}
function setSavedProjects(records){localStorage.setItem('linuo_measure_projects_v1',JSON.stringify(records));}
function openSavedProjects(){
  const records=getSavedProjects();
  const esc=v=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows=records.length?records.map((r,i)=>{
    const name=esc(r.projectName||'未命名图纸'),date=r.savedAt?new Date(r.savedAt).toLocaleString():'未记录时间';
    return `<div class="saved-project-row" data-record-row="${i}" style="display:flex;align-items:center;gap:8px;padding:10px 8px;border-bottom:1px solid #e7edf5;position:relative;"><div style="flex:1;min-width:0;"><div style="font-weight:700;color:#26364d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${i+1}. ${name}</div><div style="font-size:11px;color:#8290a3;margin-top:3px;">${date}</div></div><button type="button" class="primary" data-open-project="${i}" style="min-width:52px;padding:5px 10px;height:30px;font-size:12px;">打开</button><div class="record-actions" data-record-actions="${i}" hidden><button class="secondary" data-rename-record="${i}">改名</button><button class="danger" data-delete-record="${i}">删除</button></div></div>`;
  }).join(''):'<div class="hint" style="padding:18px;text-align:center;">暂无保存的图纸记录</div>';
  panel('已保存图纸记录',`<div style="max-height:60vh;overflow:auto;">${rows}</div><div class="actions"><button class="secondary" id="closeSavedList">关闭</button></div>`);
  document.querySelectorAll('[data-open-project]').forEach(btn=>btn.addEventListener('click',()=>{
    const idx=Number(btn.dataset.openProject),record=getSavedProjects()[idx];if(!record)return;
    saveUndo();S=JSON.parse(JSON.stringify(record));normalizeLegacyItems();
    if($('heightInp'))$('heightInp').value=S.height||2700;if($('projectNameInp'))$('projectNameInp').value=S.projectName||'未命名图纸';
    clearWallChain();selectedWall=-1;editWallIndex=-1;editEnd=null;draw();persist();closePanel();fitCanvas();showToast('已打开图纸：'+(S.projectName||'未命名图纸'));
  }));
  document.querySelectorAll('[data-record-row]').forEach(row=>{
    let timer=null,moved=false,x=0,y=0,opened=false;
    const showActions=()=>{
      const a=row.querySelector('.record-actions');if(!a)return;
      a.hidden=false;a.removeAttribute('hidden');a.style.display='flex';a.style.zIndex='30';a.style.pointerEvents='auto';
      row.classList.add('record-menu-open');opened=true;
    };
    const stop=()=>{if(timer){clearTimeout(timer);timer=null;}};
    row.addEventListener('pointerdown',e=>{
      if(e.target.closest('button'))return;stop();moved=false;opened=false;x=e.clientX;y=e.clientY;
      timer=setTimeout(()=>{if(!moved)showActions();},500);
    },{passive:true});
    row.addEventListener('pointermove',e=>{
      // 允许手指轻微抖动；明显滑动才取消长按，避免手机端滚动时误触。
      if(Math.hypot(e.clientX-x,e.clientY-y)>18){moved=true;stop();}
    },{passive:true});
    ['pointerup','pointercancel','pointerleave'].forEach(ev=>row.addEventListener(ev,stop,{passive:true}));
    row.addEventListener('contextmenu',e=>{e.preventDefault();showActions();});
    // 部分安卓 WebView 会在长按时只派发 touch 事件，补充兼容。
    row.addEventListener('touchstart',e=>{if(e.target.closest('button'))return;const t=e.touches[0];if(!t)return;stop();moved=false;x=t.clientX;y=t.clientY;timer=setTimeout(()=>{if(!moved)showActions();},500);},{passive:true});
    row.addEventListener('touchmove',e=>{const t=e.touches[0];if(t&&Math.hypot(t.clientX-x,t.clientY-y)>18){moved=true;stop();}},{passive:true});
    ['touchend','touchcancel'].forEach(ev=>row.addEventListener(ev,stop,{passive:true}));
  });
  document.querySelectorAll('[data-delete-record]').forEach(b=>b.onclick=async()=>{
    const idx=Number(b.dataset.deleteRecord);if(await LinuoDialog.show('删除量房记录','确定删除这份保存的量房记录吗？',[{label:'取消',value:false},{label:'删除',value:true,primary:true}])){const a=getSavedProjects();a.splice(idx,1);setSavedProjects(a);openSavedProjects();}
  });
  document.querySelectorAll('[data-rename-record]').forEach(b=>b.onclick=async()=>{
    const idx=Number(b.dataset.renameRecord),a=getSavedProjects();if(!a[idx])return;
    const name=await LinuoDialog.input('修改图纸名称','请输入新的图纸名称',a[idx].projectName||'未命名图纸');
    if(name&&name.trim()){a[idx].projectName=name.trim();setSavedProjects(a);openSavedProjects();}
  });
  const close=$('closeSavedList');if(close)close.onclick=closePanel;
}
function autoProjectName(date=new Date()){
  const pad=n=>String(n).padStart(2,'0');
  return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}
$('save').onclick=()=>{
  try{
    const records=getSavedProjects();
    const current=JSON.parse(JSON.stringify(S));
    const rawName=String(current.projectName||'').trim();
    const name=(!rawName||rawName==='未命名图纸'||rawName==='立诺量房项目')?autoProjectName():rawName;
    current.projectName=name;
    S.projectName=name;
    if($('projectNameInp'))$('projectNameInp').value=name;
    const found=records.findIndex(x=>x&&x.projectName===name);
    const saved={...current,savedAt:new Date().toISOString()};
    if(found>=0)records[found]=saved;else records.push(saved);
    setSavedProjects(records);
    localStorage.setItem(KEY,JSON.stringify(S));
    showToast('已保存：'+name+'（共 '+records.length+' 份）');
  }catch(err){console.error('多图纸保存失败',err);alert('保存失败：'+(err.message||err));}
};


// 聚焦时自动全选内容，实现改写模式
$('projectNameInp').addEventListener('focus', (e) => {
  e.target.select();
});

// 实时自动保存
$('projectNameInp').addEventListener('input', (e) => {
  S.projectName = e.target.value.trim() || '未命名图纸';
  persist();
});

$('menu').onclick=()=>{
  panel('管理设置',`
    <div class="grid4">
      <div class="f"><label>单位</label>
        <select id="unitSel" style="text-align:center;color:#7a8798;padding:0 5px;height:34px;">
          <option value="mm" ${S.unit==='m'?'':'selected'}>MM</option>
          <option value="m" ${S.unit==='m'?'selected':''}>M</option>
        </select>
      </div>
      <div class="f"><label>层高</label><input id="hgt" type="number" value="${S.height}"></div>
      <div class="f"><label>默认墙厚</label><input id="dwt" type="number" value="${S.defaultWallThick||220}"></div>
    </div>
    <div class="grid4" style="grid-template-columns:1fr;">
      <div class="f"><label>蓝牙服务 UUID (Service)</label><input id="btSrv" value="${S.btService||''}" placeholder="输入设备服务 UUID"></div>
      <div class="f"><label>蓝牙特征 UUID (Characteristic)</label><input id="btChar" value="${S.btChar||''}" placeholder="输入设备特征 UUID"></div>
    </div>
    <div class="actions" style="flex-wrap:wrap; flex-direction:row; gap:8px;">
      <button class="secondary" id="settings" style="flex:1; background:#edf2f8; color:#34445d;">保存设置</button>
      <button class="primary" id="dxf" style="flex:1; background:var(--blue); color:#fff;">导出CAD</button>
    </div>
    <div class="hint">操作自动记忆（300ms 空闲后写入本地缓存），刷新页面自动恢复。</div>
  `);

  // 在面板标题同行加入 JSON 导入按钮
  const phead = $('phead');
  const oldTitleActions = phead.querySelector('.title-actions');
  if (oldTitleActions) oldTitleActions.remove();

  const titleActions = document.createElement('div');
  titleActions.className = 'title-actions';
  titleActions.style.cssText = 'display:flex; gap:6px; margin-left:auto; margin-right:8px; flex-shrink:0;';
  
  const btnOpen = document.createElement('button');
  btnOpen.type='button';
  btnOpen.textContent = '打开';
  btnOpen.title = '打开已保存图纸';
  btnOpen.style.cssText = 'padding:4px 8px; font-size:11px; border-radius:6px; background:#edf2f8; color:#34445d; font-weight:normal;';
  btnOpen.onclick = openSavedProjects;
  const btnImp = document.createElement('button');
  btnImp.type='button';
  btnImp.textContent = '云恢复';
btnImp.style.cssText = 'padding:4px 8px; font-size:11px; border-radius:6px; font-weight:600;';

// 强制覆盖 style.css 中的 !important 样式
btnImp.style.setProperty('background', '#2878d0', 'important');
btnImp.style.setProperty('background-color', '#2878d0', 'important');
btnImp.style.setProperty('color', '#ffffff', 'important');
btnImp.style.setProperty('border', '0', 'important');
  const btnExp = document.createElement('button');
  btnExp.type='button';
  btnExp.textContent = '云备份';
btnExp.style.cssText = 'padding:4px 8px; font-size:11px; border-radius:6px; font-weight:600;';

// 强制覆盖 style.css 中的 !important 样式
btnExp.style.setProperty('background', '#159765', 'important');
btnExp.style.setProperty('background-color', '#159765', 'important');
btnExp.style.setProperty('color', '#ffffff', 'important');
btnExp.style.setProperty('border', '0', 'important');
  titleActions.appendChild(btnOpen);
  titleActions.appendChild(btnImp);
  titleActions.appendChild(btnExp);
  phead.insertBefore(titleActions, $('x')); // 插入在关闭按钮前

  // 云恢复：从当前账号所属公司的云端备份中恢复
  btnImp.onclick = async e => {
    e.preventDefault();
    e.stopPropagation();

    if (btnImp.disabled) return;

    btnImp.disabled = true;
    btnImp.textContent = '恢复中...';

    try {
      await outModule.cloudRestore();
    } finally {
      btnImp.disabled = false;
      btnImp.textContent = '云恢复';
    }
  };

  // 云备份：备份当前画布及本地全部已保存图纸
  btnExp.onclick = async e => {
    e.preventDefault();
    e.stopPropagation();

    if (btnExp.disabled) return;

    btnExp.disabled = true;
    btnExp.textContent = '备份中...';

    try {
      await outModule.cloudBackup();
    } finally {
      btnExp.disabled = false;
      btnExp.textContent = '云备份';
    }
  };


  ['btSrv','btChar'].forEach(id=>{
    const field=$(id);if(field){field.addEventListener('focus',()=>field.select());field.addEventListener('click',()=>{if(field.selectionStart===field.selectionEnd)field.select();});}
  });
  $('settings').onclick=()=>{
    S.height=Number($('hgt').value)||2700;
    S.defaultWallThick=Number($('dwt').value)||220;
    S.wallThicknessDefaultUpgraded=true;
    if($('unitSel')) S.unit = $('unitSel').value;
    if($('btSrv')) S.btService = $('btSrv').value.trim();
    if($('btChar')) S.btChar = $('btChar').value.trim();
    if($('heightInp')) $('heightInp').value = S.height;
    localStorage.setItem(KEY,JSON.stringify(S));
    closePanel();
  };
  $('dxf').textContent='导出CAD';
  $('dxf').onclick=exportDXF;
};

// 层高原位输入
$('heightInp').value = S.height;
$('heightInp').addEventListener('click', () => {
  setActiveInput($('heightInp'));
  isFirstInput = true;
  numKbEl.style.display = 'grid';
  document.querySelectorAll('input').forEach(el => el.style.boxShadow = '');
  $('heightInp').style.boxShadow = '0 0 0 2px #2878df';
});
$('heightInp').addEventListener('input', (e) => {
  S.height = Number(e.target.value) || 2700;
  persist();
});
// 图片标记设置在同一页面变更后，立即刷新量房引线
window.addEventListener('linuo-annotation-style-change', draw);
window.addEventListener('storage', e => {
  if (e.key === 'linuo_arrow_style' || e.key === 'linuo_line_style') draw();
});

/* ---------- 初始化 ---------- */
let hasSavedCanvas = false;
try{
  const saved=JSON.parse(localStorage.getItem(KEY));
  hasSavedCanvas = !!(saved && Array.isArray(saved.walls));
  if(saved&&Array.isArray(saved.walls)){
    S=saved;
    S.measures=Array.isArray(S.measures)?S.measures:[];
    normalizeLegacyItems();
    S.lastInputs=S.lastInputs||{};
    // 旧项目中的门洞短线改为虚拟图例数据；清除旧版本自动生成的实体短线。
    S.walls=(S.walls||[]).filter(w=>w&&!w.openingJamb);
    // 清理旧版本遗留的宿主锁标记；当前由构件与宿主墙的关联动态判断。
    S.walls.forEach(w=>{if(w&&Object.prototype.hasOwnProperty.call(w,'openingHostKey'))delete w.openingHostKey;});
    let migratedOpening=false;
    (S.items||[]).forEach(it=>{
      if(it.type!=='opening')return;
      it._openingKey=it._openingKey||('opening_migrated_'+Math.random().toString(36).slice(2,9));
      syncOpeningBridgeLine(it);
      migratedOpening=true;
    });
    if(migratedOpening)splitAllWallIntersections();
    if(S.texts) S.texts.forEach(t=>{
      t.angle=0;
      if(t.arrow === undefined) {
        t.arrow = { x: t.p.x + 2000, y: t.p.y + 2000 };
      }
    });
    if(S.items){
      S.items=S.items.filter(it=>it.type!=='water');
      S.items.forEach(it=>{
        if(!pointTypes[it.type])return;
        if(it.type==='column'||it.type==='chimney'){
          const L=Number(it.length)||it.size||300;
          const Wd=Number(it.width)||it.size||300;
          it.marginX=Math.max(0,(Number(it.marginX)||0)-L);
          it.marginY=Math.max(0,(Number(it.marginY)||0)-Wd);
        }else{
          const r=(Number(it.size)||110)/2;
          it.marginX=Math.max(0,(Number(it.marginX)||0)-r*2);
          it.marginY=Math.max(0,(Number(it.marginY)||0)-r*2);
        }
      });
    }
  }
}catch(e){}

// 首次使用且没有历史量房记录时，创建默认入户门；已有记录（包括空白图纸）不做覆盖。
if (!hasSavedCanvas) {
  S.entryDoor = {
    a: {x: -450, y: 0},
    b: {x: 450, y: 0},
    width: 900,
    height: 2100,
    sill: 0,
    thick: Number(S.defaultWallThick) || 220,
    insideSide: 1
  };
  S.projectName = S.projectName || '立诺量房项目';
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
}

if(!S.wallThicknessDefaultUpgraded){
  if(!(Number(S.defaultWallThick)>0)||Number(S.defaultWallThick)===120)S.defaultWallThick=220;
  S.wallThicknessDefaultUpgraded=true;
  try{localStorage.setItem(KEY,JSON.stringify(S));}catch(e){}
}
S.defaultWallThick=Number(S.defaultWallThick)>0?Number(S.defaultWallThick):220;
if(S.btDeviceId===undefined)S.btDeviceId=null;
if($('heightInp')) $('heightInp').value = S.height;
if($('projectNameInp')) $('projectNameInp').value = S.projectName || '未命名图纸';
setTool('wall');
window.addEventListener('resize',resize);
if(window.ResizeObserver){new ResizeObserver(()=>resize()).observe(work)}
resize();
// 启动提醒统一在登录成功事件中触发；首次空白图纸也由 showMeasureStartNotice 自动补齐入户门。
})();
