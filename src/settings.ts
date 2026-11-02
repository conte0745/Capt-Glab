export type Settings = {
	download: boolean;
	clipboard: boolean;
	openTab: boolean;
	folder: string;
	askEveryTime: boolean;
	expandContent: boolean;
	expandMenu: boolean;
	// 有料機能。購入していなければ、オンでも使わない
	loadLazyImages: boolean;
	/** 長いページを縮小せず、複数の画像に分けて保存する */
	splitLongPages: boolean;
	/** 1枚の高さの上限で分けるか、決めた枚数に分けるか */
	splitMode: "height" | "count";
	/** 1枚の高さの上限。画像のピクセル数で数える */
	splitHeight: number;
	splitCount: number;
	/** オンなら viewport の代わりに、multiSizes のサイズで続けて撮る */
	multiSize: boolean;
	/** "1920x1080" の形式 */
	multiSizes: string[];
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
	loadLazyImages: false,
	splitLongPages: false,
	splitMode: "height",
	splitHeight: 16000,
	splitCount: 2,
	multiSize: false,
	multiSizes: ["1920x1080", "768x1024", "375x667"],
	viewport: { mode: "current", width: 1280, height: 800 },
};

// 実測では高さ 16100px は正常で、16500px を超えると画像が壊れる
export const MAX_IMAGE_SIDE = 16000;
export const MIN_SPLIT_HEIGHT = 1000;
export const MIN_SPLIT_COUNT = 2;
export const MAX_SPLIT_COUNT = 20;

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
/** 分けるときの1枚の高さの上限として使える整数かを返す */
export function isValidSplitHeight(height: number): boolean {
	return Number.isInteger(height) && height >= MIN_SPLIT_HEIGHT && height <= MAX_IMAGE_SIDE;
}

/** 分ける枚数として使える整数かを返す */
export function isValidSplitCount(count: number): boolean {
	return Number.isInteger(count) && count >= MIN_SPLIT_COUNT && count <= MAX_SPLIT_COUNT;
}

/** "1920x1080" の形式のサイズを数値にする。形式や範囲が正しくなければ null を返す */
export function parseSize(size: string): { width: number; height: number } | null {
	const match = /^(\d+)x(\d+)$/.exec(size);
	if (!match) {
		return null;
	}
	const width = Number(match[1]);
	const height = Number(match[2]);
	return isValidViewportSize(width) && isValidViewportSize(height)
		? { width, height }
		: null;
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
