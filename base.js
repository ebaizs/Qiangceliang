/* 立诺量房公共基础函数：无业务状态、无页面依赖，供各模块复用。 */
(function(global){
  'use strict';
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,Number(value)||0));
  const distance=(a,b)=>Math.hypot((Number(a?.x)||0)-(Number(b?.x)||0),(Number(a?.y)||0)-(Number(b?.y)||0));
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const deepClone=value=>{
    if(typeof structuredClone==='function'){try{return structuredClone(value)}catch(_){}}
    return value==null?value:JSON.parse(JSON.stringify(value));
  };
  const getStorage=(key,fallback='')=>{
    try{const value=global.localStorage.getItem(key);return value===null?fallback:value}catch(_){return fallback}
  };
  const setStorage=(key,value)=>{
    try{global.localStorage.setItem(key,String(value));return true}catch(_){return false}
  };
  const removeStorage=key=>{try{global.localStorage.removeItem(key);return true}catch(_){return false}};
  global.LinuoBase=Object.freeze({clamp,distance,escapeHTML,deepClone,getStorage,setStorage,removeStorage});
})(window);
