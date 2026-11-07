export const supportedLanguages: readonly string[];
export function normalizeLanguage(value: unknown): 'en'|'zh-CN';
export function translate(language: string, key: string, values?: Record<string,unknown>): string;
