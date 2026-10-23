export type InkPlatformFlags = {
	isMobile?: boolean;
	isMobileApp?: boolean;
	isIosApp?: boolean;
};

/** Mobile WebViews need a longer quiet period before serializing large 笔墨 SVGs. */
export function resolveInkAutosaveDelayMs(
	platform: InkPlatformFlags,
	desktopDelayMs: number,
	mobileDelayMs: number,
): number {
	return platform.isMobile || platform.isMobileApp || platform.isIosApp
		? mobileDelayMs
		: desktopDelayMs;
}
