import {getLanguage,setLanguage,t,useLanguage} from './i18n';
export function LanguageSelect(){
 useLanguage();
 return <label className="language-control"><span>{t('语言')}</span><select aria-label={t('语言')} value={getLanguage()} onChange={event=>setLanguage(event.target.value)}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>;
}
