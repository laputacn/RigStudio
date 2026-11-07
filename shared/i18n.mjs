import english from './locales/en.json' with {type:'json'};
export const supportedLanguages=Object.freeze(['en','zh-CN']);
export function normalizeLanguage(value){return value==='zh-CN'?'zh-CN':'en';}
export function translate(language,key,values={}){
 const source=String(key??'');
 const message=normalizeLanguage(language)==='en'?(english[source]??source):source;
 return message.replace(/\{(\w+)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match);
}
