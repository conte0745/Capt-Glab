import {
	isValidViewportSize,
	loadSettings,
	normalizeFolder,
	saveSettings,
} from "../settings";

const COUNT_KEY = "image-name-count";
const SAVED_TOAST_MS = 2000;

/** id で要素を取得する。画面に必ずある要素だけに使う */
const element = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;
/** id で入力欄を取得する */
const input = (id: string) => element<HTMLInputElement>(id);

const allFields = [
	"download",
	"clipboard",
	"openTab",
	"folder",
	"askEveryTime",
	"expandContent",
	"expandMenu",
	"viewport-current",
	"viewport-custom",
	"width",
	"height",
];

/** 保存された設定を画面に反映し、変更したらすぐ保存されるようにする */
async function init() {
	const settings = await loadSettings();

	input("download").checked = settings.download;
	input("clipboard").checked = settings.clipboard;
	input("openTab").checked = settings.openTab;
	input("folder").value = settings.folder;
	input("askEveryTime").checked = settings.askEveryTime;
	input("expandContent").checked = settings.expandContent;
	input("expandMenu").checked = settings.expandMenu;
	input("viewport-current").checked = settings.viewport.mode === "current";
	input("viewport-custom").checked = settings.viewport.mode === "custom";
	input("width").value = String(settings.viewport.width);
	input("height").value = String(settings.viewport.height);
	updateVisibility();

	input("folder").addEventListener("input", updateSavePreview);
	for (const id of allFields) {
		input(id).addEventListener("change", save);
	}
	element<HTMLSelectElement>("preset").addEventListener("change", applyPreset);
	element("reset-count").addEventListener("click", resetCount);
	element("shortcuts").addEventListener("click", () => {
		void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
	});

	await Promise.all([showNextName(), showShortcut()]);
}

/** OS やユーザーの変更で変わるので、実際に割り当てられているキーを表示する */
async function showShortcut() {
	const commands = await chrome.commands.getAll();
	const { shortcut } =
		commands.find((command) => command.name === "_execute_action") ?? {};
	element("shortcut-text").textContent = shortcut
		? `現在のキー: ${shortcut}`
		: "割り当てられていません。「変更する」から設定できます。";
}

/** 選んだ画面サイズを入力欄に入れ、指定したサイズで撮る設定にする */
function applyPreset() {
	const preset = element<HTMLSelectElement>("preset");
	if (!preset.value) {
		return;
	}
	const [width, height] = preset.value.split("x");
	input("width").value = width;
	input("height").value = height;
	input("viewport-custom").checked = true;
	void save();
}

/** 今の選択に関係しない項目は隠す */
function updateVisibility() {
	const download = input("download").checked;
	element("save-section").hidden = !download;
	element("name-section").hidden = !download;

	element("viewport-fields").hidden = !input("viewport-custom").checked;
	updateSavePreview();
}

/** 入力中のフォルダと次のファイル名から、保存先の例を表示する */
function updateSavePreview() {
	const folder = normalizeFolder(input("folder").value);
	const preview = element("save-preview");
	preview.hidden = folder === null || input("askEveryTime").checked;
	preview.textContent = `保存先: ${["ダウンロード", folder, nextName]
		.filter(Boolean)
		.join(" / ")}`;
}

/** 入力が正しいときだけ保存する。正しくないあいだは前の設定で撮影される */
async function save() {
	updateVisibility();
	element("saved").textContent = "";

	const width = Number(input("width").value);
	const height = Number(input("height").value);
	const custom = input("viewport-custom").checked;
	const folder = normalizeFolder(input("folder").value);

	const actionsValid =
		input("download").checked ||
		input("clipboard").checked ||
		input("openTab").checked;
	const viewportValid =
		!custom || (isValidViewportSize(width) && isValidViewportSize(height));

	element("actions-error").hidden = actionsValid;
	element("folder-error").hidden = folder !== null;
	element("viewport-error").hidden = viewportValid;

	if (!actionsValid || folder === null || !viewportValid) {
		return;
	}

	const current = await loadSettings();
	await saveSettings({
		download: input("download").checked,
		clipboard: input("clipboard").checked,
		openTab: input("openTab").checked,
		folder,
		askEveryTime: input("askEveryTime").checked,
		expandContent: input("expandContent").checked,
		expandMenu: input("expandMenu").checked,
		viewport: custom
			? { mode: "custom", width, height }
			: { ...current.viewport, mode: "current" },
	});
	input("folder").value = folder;
	showSaved();
}

let savedTimer: ReturnType<typeof setTimeout>;

/** 「保存しました」を少しのあいだ表示する */
function showSaved() {
	const saved = element("saved");
	saved.textContent = "保存しました";
	clearTimeout(savedTimer);
	savedTimer = setTimeout(() => (saved.textContent = ""), SAVED_TOAST_MS);
}

let nextName = "";

/** 次に保存するときのファイル名を表示する */
async function showNextName() {
	const stored = await chrome.storage.local.get(COUNT_KEY);
	const next = (Number(stored[COUNT_KEY]) || 0) + 1;
	nextName = `screen-${next.toString().padStart(4, "0")}.png`;
	element("next-name").textContent = nextName;
	updateSavePreview();
}

/** 連番を最初に戻す */
async function resetCount() {
	await chrome.storage.local.remove(COUNT_KEY);
	await showNextName();
}

await init();
