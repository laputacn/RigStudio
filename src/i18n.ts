import {useSyncExternalStore} from 'react';
import {normalizeLanguage,translate} from '../shared/i18n.mjs';
export type Language='en'|'zh-CN';
const storageKey='rig-studio:language';
function savedLanguage():Language{try{return normalizeLanguage(localStorage.getItem(storageKey));}catch{return 'en';}}
let language=savedLanguage();
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const getLanguage=()=>language;
export const useLanguage=()=>useSyncExternalStore(subscribe,getLanguage,()=>'en' as Language);
/** Only application copy belongs here. Keep user content and model identifiers unchanged. */
export const t=(key:string,values:Record<string,unknown>={})=>translate(language,key.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').replace(/^Error: /,''),values);
function applyLanguage(){
 document.documentElement.lang=language;
 void window.rigStudio?.setLanguage?.(language).catch(()=>{});
 for(const listener of listeners)listener();
}
export function setLanguage(value:string){language=normalizeLanguage(value);try{localStorage.setItem(storageKey,language);}catch{/* Language also works without browser storage. */}applyLanguage();}
export function initializeLanguage(){
 applyLanguage();
 window.addEventListener('storage',event=>{if(event.key===storageKey){language=normalizeLanguage(event.newValue);applyLanguage();}});
}
