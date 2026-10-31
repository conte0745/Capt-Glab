import {
	isValidViewportSize,
	loadSettings,
	normalizeFolder,
	saveSettings,
} from "../settings";

const COUNT_KEY = "image-name-count";

const element = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);

const allFields = [
	"download",
	"clipboard",
	"openTab",
	"folder",
	"askEveryTime",
	"viewport-current",
	"viewport-custom",
	"width",
	"height",
];

async function init() {
	const settings = await loadSettings();

	input("download").checked = settings.download;
	input("clipboard").checked = settings.clipboard;
	input("openTab").checked = settings.openTab;
	input("folder").value = settings.folder;
	input("askEveryTime").checked = settings.askEveryTime;
	input("viewport-current").checked = settings.viewport.mode === "current";
	input("viewport-custom").checked = settings.viewport.mode === "custom";
	input("width").value = String(settings.viewport.width);
	input("height").value = String(settings.viewport.height);
	updateEnabled();

	for (const id of allFields) {
		input(id).addEventListener("change", save);
	}
	element<HTMLSelectElement>("preset").addEventListener("change", applyPreset);
	element("reset-count").addEventListener("click", resetCount);
	element("shortcuts").addEventListener("click", () => {
		chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
	});

	await showNextName();
}

function applyPreset() {
	const preset = element<HTMLSelectElement>("preset");
	if (!preset.value) {
		return;
	}
	const [width, height] = preset.value.split("x");
	input("width").value = width;
	input("height").value = height;
	input("viewport-custom").checked = true;
	save();
}

function updateEnabled() {
	const download = input("download").checked;
	input("folder").disabled = !download;
	input("askEveryTime").disabled = !download;

	const custom = input("viewport-custom").checked;
	input("width").disabled = !custom;
	input("height").disabled = !custom;
}

/** 入力が正しいときだけ保存する。正しくないあいだは前の設定で撮影される */
async function save() {
	updateEnabled();
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
		viewport: custom
			? { mode: "custom", width, height }
			: { ...current.viewport, mode: "current" },
	});
	input("folder").value = folder;
	element("saved").textContent = "保存しました";
}

async function showNextName() {
	const stored = await chrome.storage.local.get(COUNT_KEY);
	const next = (Number(stored[COUNT_KEY]) || 0) + 1;
	element("next-name").textContent = `screen-${next
		.toString()
		.padStart(4, "0")}.png`;
}

async function resetCount() {
	await chrome.storage.local.remove(COUNT_KEY);
	await showNextName();
}

init();
