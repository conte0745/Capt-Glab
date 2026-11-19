import {
	DEFAULT_SETTINGS,
	type Settings,
	isValidSplitCount,
	isValidSplitHeight,
	isValidViewportSize,
	loadSettings,
	normalizeFolder,
	saveSettings,
} from "../settings";
import { LOCALES, initI18n, localeName, localizePage, t } from "../i18n";
import { isPaid, openLoginPage, openPaymentPage } from "../payment";

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
	"loadLazyImages",
	"splitLongPages",
	"split-height",
	"split-count",
	"splitHeight",
	"splitCount",
	"multiSize",
	"viewport-current",
	"viewport-custom",
	"width",
	"height",
];

/** 保存された設定を画面に反映し、変更したらすぐ保存されるようにする */
async function init() {
	await initI18n();
	localizePage();
	addLanguageOptions();
	showSettings(await loadSettings());

	input("folder").addEventListener("input", updateSavePreview);
	input("width").addEventListener("input", showPreset);
	input("height").addEventListener("input", showPreset);
	for (const id of allFields) {
		input(id).addEventListener("change", save);
	}
	for (const size of sizeInputs()) {
		size.addEventListener("change", save);
	}
	element<HTMLSelectElement>("preset").addEventListener("change", applyPreset);
	element<HTMLSelectElement>("language").addEventListener("change", () => void changeLanguage());
	element("reset-count").addEventListener("click", resetCount);
	element("reset-settings").addEventListener("click", () => void resetSettings());
	element("shortcuts").addEventListener("click", () => {
		void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
	});
	element("buy").addEventListener("click", () => void openPurchasePage(openPaymentPage));
	element("login").addEventListener("click", () => void openPurchasePage(openLoginPage));
	// 購入ページのタブから戻ってきたときに、購入が反映されるようにする
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") {
			void showPaymentStatus();
		}
	});

	await Promise.all([showNextName(), showShortcut(), showPaymentStatus()]);
}

/** 設定を入力欄に入れる */
function showSettings(settings: Settings) {
	input("download").checked = settings.download;
	input("clipboard").checked = settings.clipboard;
	input("openTab").checked = settings.openTab;
	input("folder").value = settings.folder;
	input("askEveryTime").checked = settings.askEveryTime;
	input("expandContent").checked = settings.expandContent;
	input("expandMenu").checked = settings.expandMenu;
	input("loadLazyImages").checked = settings.loadLazyImages;
	input("splitLongPages").checked = settings.splitLongPages;
	input("split-height").checked = settings.splitMode === "height";
	input("split-count").checked = settings.splitMode === "count";
	input("splitHeight").value = String(settings.splitHeight);
	input("splitCount").value = String(settings.splitCount);
	input("multiSize").checked = settings.multiSize;
	for (const size of sizeInputs()) {
		size.checked = settings.multiSizes.includes(size.value);
	}
	input("viewport-current").checked = settings.viewport.mode === "current";
	input("viewport-custom").checked = settings.viewport.mode === "custom";
	input("width").value = String(settings.viewport.width);
	input("height").value = String(settings.viewport.height);
	element<HTMLSelectElement>("language").value = settings.language;
	showPreset();
	updateVisibility();
}

let paymentCheck = 0;

/** 購入済みなら有料機能を使えるようにし、未購入なら購入の案内を出す */
async function showPaymentStatus() {
	// 確認が重なったときに、遅れて届いた古い結果で上書きしない
	const check = ++paymentCheck;
	const paid = await isPaid();
	if (check !== paymentCheck) {
		return;
	}
	for (const field of element("paid-section").querySelectorAll("input")) {
		field.disabled = !paid;
	}
	element("payment-checking").hidden = true;
	// 購入済みの人には値段を見せる必要がない
	element("price").hidden = paid;
	element("purchase").hidden = paid;
	element("purchase-hint").hidden = paid;
	element("login-hint").hidden = paid;
	element("paid-text").hidden = !paid;
	updateVisibility();
}

/** 購入や引き継ぎのページを開く。開けなければ案内を出す */
async function openPurchasePage(open: () => Promise<void>) {
	element("payment-error").hidden = true;
	try {
		await open();
	} catch (error) {
		console.error(error);
		element("payment-error").hidden = false;
	}
}

/** OS やユーザーの変更で変わるので、実際に割り当てられているキーを表示する */
async function showShortcut() {
	const commands = await chrome.commands.getAll();
	const { shortcut } =
		commands.find((command) => command.name === "_execute_action") ?? {};
	element("shortcut-text").textContent = shortcut
		? t("shortcutCurrent", shortcut)
		: t("shortcutNone");
}

/** 言語のプルダウンに、用意している言語を、その言語自身の名前で並べる */
function addLanguageOptions() {
	const select = element<HTMLSelectElement>("language");
	for (const locale of LOCALES) {
		select.append(new Option(localeName(locale), locale));
	}
}

/** 言語を保存し、画面の文言を選んだ言語で表示し直す */
async function changeLanguage() {
	const language = element<HTMLSelectElement>("language").value;
	await saveSettings({ ...(await loadSettings()), language });
	location.reload();
}

/** 幅と高さがよく使うサイズのどれかと同じなら、プルダウンでそれを選んだ状態にする */
function showPreset() {
	const preset = element<HTMLSelectElement>("preset");
	const size = `${input("width").value}x${input("height").value}`;
	const matched = [...preset.options].some((option) => option.value === size);
	preset.value = matched ? size : "";
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

/** 複数サイズで撮るときの、サイズの選択肢 */
function sizeInputs() {
	return [
		...document.querySelectorAll<HTMLInputElement>('input[name="multiSizes"]'),
	];
}

/** 今の選択に関係しない項目は隠す */
function updateVisibility() {
	const download = input("download").checked;
	element("save-section").hidden = !download;
	element("name-section").hidden = !download;

	element("viewport-fields").hidden = !input("viewport-custom").checked;
	element("multi-size-fields").hidden = !input("multiSize").checked;
	element("split-fields").hidden = !input("splitLongPages").checked;
	element("viewport-overridden").hidden = !(
		input("multiSize").checked && !input("multiSize").disabled
	);
	updateSavePreview();
}

/** 入力中のフォルダと次のファイル名から、保存先の例を表示する */
function updateSavePreview() {
	const folder = normalizeFolder(input("folder").value);
	const preview = element("save-preview");
	preview.hidden = folder === null || input("askEveryTime").checked;
	preview.textContent = t(
		"savePreview",
		[t("downloadsFolder"), folder, nextName].filter(Boolean).join(" / ")
	);
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
	const multiSizes = sizeInputs()
		.filter((size) => size.checked)
		.map((size) => size.value);
	const multiSizeValid = !input("multiSize").checked || multiSizes.length > 0;
	const splitMode = input("split-count").checked ? "count" : "height";
	const splitHeight = Number(input("splitHeight").value);
	const splitCount = Number(input("splitCount").value);
	// 選んでいない方の値は使わないので、正しくなくても保存を止めない
	const splitValid =
		!input("splitLongPages").checked ||
		(splitMode === "height" ? isValidSplitHeight(splitHeight) : isValidSplitCount(splitCount));

	element("actions-error").hidden = actionsValid;
	element("folder-error").hidden = folder !== null;
	element("viewport-error").hidden = viewportValid;
	element("multi-size-error").hidden = multiSizeValid;
	element("split-error").hidden = splitValid;

	if (
		!actionsValid ||
		folder === null ||
		!viewportValid ||
		!multiSizeValid ||
		!splitValid
	) {
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
		loadLazyImages: input("loadLazyImages").checked,
		splitLongPages: input("splitLongPages").checked,
		splitMode,
		// 正しくない値は保存せず、前の値を残す
		splitHeight: isValidSplitHeight(splitHeight) ? splitHeight : current.splitHeight,
		splitCount: isValidSplitCount(splitCount) ? splitCount : current.splitCount,
		multiSize: input("multiSize").checked,
		multiSizes,
		viewport: custom
			? { mode: "custom", width, height }
			: { ...current.viewport, mode: "current" },
		language: current.language,
	});
	input("folder").value = folder;
	showSaved();
}

let savedTimer: ReturnType<typeof setTimeout>;

/** 「保存しました」などを少しのあいだ表示する */
function showSaved(text = t("saved")) {
	const saved = element("saved");
	saved.textContent = text;
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

/** 設定とファイル名の連番を初期値に戻す。購入の記録は別に保存しているので残る */
async function resetSettings() {
	if (!(await askReset())) {
		return;
	}
	const { language } = await loadSettings();
	await chrome.storage.local.remove(["settings", COUNT_KEY]);
	// 言語も初期値に戻るので、文言を Chrome の言語で表示し直す
	if (language !== DEFAULT_SETTINGS.language) {
		location.reload();
		return;
	}
	showSettings(await loadSettings());
	await showNextName();
	// 前の入力で出ていたエラーを消す
	for (const error of document.querySelectorAll<HTMLElement>(".error")) {
		error.hidden = true;
	}
	showSaved(t("resetDone"));
}

/** 初期値に戻してよいかを、画面の中のダイアログで確かめる */
function askReset(): Promise<boolean> {
	const dialog = element<HTMLDialogElement>("reset-dialog");
	dialog.returnValue = "";
	dialog.showModal();
	return new Promise((resolve) =>
		dialog.addEventListener("close", () => resolve(dialog.returnValue === "reset"), {
			once: true,
		})
	);
}

/** 連番を最初に戻す */
async function resetCount() {
	await chrome.storage.local.remove(COUNT_KEY);
	await showNextName();
}

await init();
