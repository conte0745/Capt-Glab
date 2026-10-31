export type Settings = {
	download: boolean;
	clipboard: boolean;
	openTab: boolean;
	folder: string;
	askEveryTime: boolean;
	viewport: {
		mode: "current" | "custom";
		width: number;
		height: number;
	};
};

export const DEFAULT_SETTINGS: Settings = {
	download: true,
	clipboard: true,
	openTab: false,
	folder: "",
	askEveryTime: false,
	viewport: { mode: "current", width: 1280, height: 800 },
};

export const MIN_VIEWPORT = 200;
export const MAX_VIEWPORT = 7680;

export async function loadSettings(): Promise<Settings> {
	const stored = await chrome.storage.local.get("settings");
	const settings = stored.settings as Partial<Settings> | undefined;
	return {
		...DEFAULT_SETTINGS,
		...settings,
		viewport: { ...DEFAULT_SETTINGS.viewport, ...settings?.viewport },
	};
}

export async function saveSettings(settings: Settings): Promise<void> {
	await chrome.storage.local.set({ settings });
}

/** ダウンロードフォルダからの相対パスに整える。使えない場合は null を返す */
export function normalizeFolder(input: string): string | null {
	const segments = input
		.split(/[\\/]/)
		.map((segment) => segment.trim())
		.filter(Boolean);
	const isValid = segments.every(
		(segment) =>
			!/^\.+$/.test(segment) &&
			!/\.$/.test(segment) &&
			!/[<>:"|?*\u0000-\u001f]/.test(segment)
	);
	return isValid ? segments.join("/") : null;
}

export function isValidViewportSize(size: number): boolean {
	return Number.isInteger(size) && size >= MIN_VIEWPORT && size <= MAX_VIEWPORT;
}
