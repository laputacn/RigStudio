import {normalizeLanguage,translate} from '../shared/i18n.mjs';
let language='en';
export function setNativeLanguage(value){language=normalizeLanguage(value);return language;}
export const t=(key,values={})=>translate(language,key,values);
