export type Settings = {
	download: boolean;
	clipboard: boolean;
	openTab: boolean;
	folder: string;
	askEveryTime: boolean;
	expandContent: boolean;
	expandMenu: boolean;
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
	expandContent: true,
	expandMenu: false,
	viewport: { mode: "current", width: 1280, height: 800 },
};

export const MIN_VIEWPORT = 200;
export const MAX_VIEWPORT = 7680;

/** 保存された設定を読み込む。保存されていない項目は既定値で補う */
export async function loadSettings(): Promise<Settings> {
	const stored = await chrome.storage.local.get("settings");
	const settings = stored.settings as Partial<Settings> | undefined;
	return {
		...DEFAULT_SETTINGS,
		...settings,
		viewport: { ...DEFAULT_SETTINGS.viewport, ...settings?.viewport },
	};
}

/** 設定を保存する */
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

/** 撮影時に固定する幅や高さとして使える整数かを返す */
export function isValidViewportSize(size: number): boolean {
	return Number.isInteger(size) && size >= MIN_VIEWPORT && size <= MAX_VIEWPORT;
}

/** 次のファイル名を返す。保存に成功するまで連番は進めない */
export async function peekImageName(): Promise<string> {
	const count = await currentImageCount();
	return `screen-${(count + 1).toString().padStart(4, "0")}.png`;
}

/** 保存に成功したあとに呼び、連番を1つ進める */
export async function advanceImageCount(): Promise<void> {
	const count = await currentImageCount();
	await chrome.storage.local.set({ "image-name-count": count + 1 });
}

/** これまでに保存した枚数を返す。未保存なら 0 */
async function currentImageCount(): Promise<number> {
	const stored = await chrome.storage.local.get("image-name-count");
	return Number(stored["image-name-count"]) || 0;
}
