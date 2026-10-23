import { ZH_CN } from './zh-cn';

//////////
//////////

export type LocaleCode = 'en' | 'zh-cn';

/**
 * English source strings double as dictionary keys, so `en` needs no table —
 * `t('Enable writing')` returns the key verbatim when English is active.
 */
const DICTS: Record<LocaleCode, Record<string, string>> = {
	en: {},
	'zh-cn': ZH_CN,
};

let activeLocale: LocaleCode = 'en';

/**
 * Obsidian persists the UI language in `localStorage.language` (e.g. `zh`,
 * `zh-cn`, `en`). `navigator.language` is the fallback for tests and mobile
 * webviews that do not expose the setting.
 */
export function detectLocale(): LocaleCode {
	try {
		const raw = (
			window.localStorage.getItem('language')
			|| navigator.language
			|| 'en'
		).toLowerCase();
		return raw.startsWith('zh') ? 'zh-cn' : 'en';
	} catch {
		return 'en';
	}
}

/**
 * Resolves a stored preference into a concrete locale.
 * `auto` (and anything unrecognised) follows Obsidian / the system.
 */
export function resolveLocale(preference: string): LocaleCode {
	const value = (preference ?? '').toLowerCase();
	if (value === 'en') return 'en';
	if (value.startsWith('zh')) return 'zh-cn';
	return detectLocale();
}

/** Accepts `auto`, `zh`, `zh-CN`, `zh_TW`, `en`, … */
export function setLocale(locale: string): void {
	activeLocale = resolveLocale(locale);
}

export function getLocale(): LocaleCode {
	return activeLocale;
}

/**
 * Translates a UI string.
 *
 * - Missing entries fall back to the English key, so a partial dictionary can
 *   never render an empty label.
 * - `{name}` placeholders are filled from `vars`; unknown placeholders are left
 *   untouched rather than replaced with `undefined`.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
	const template = DICTS[activeLocale][key] ?? key;
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (match, name) => (
		Object.prototype.hasOwnProperty.call(vars, name)
			? String(vars[name])
			: match
	));
}

/** True when the active language is Chinese — used for layout tweaks if needed. */
export function isZh(): boolean {
	return activeLocale === 'zh-cn';
}
