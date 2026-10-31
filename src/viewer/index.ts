import { advanceImageCount, loadSettings, peekImageName } from "../settings";

const TOAST_MS = 2000;

const element = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;

element("settings").addEventListener("click", () => {
	chrome.runtime.openOptionsPage();
});

show();

async function show() {
	const id = new URLSearchParams(location.search).get("id");
	const result = await chrome.runtime.sendMessage({
		request: "viewer-image",
		id,
	});
	if (!result) {
		element("message").hidden = false;
		return;
	}

	const response = await fetch(`data:image/png;base64,${result.data}`);
	const blob = await response.blob();
	const url = URL.createObjectURL(blob);

	const image = element<HTMLImageElement>("image");
	image.src = url;
	image.hidden = false;

	// 撮影時に保存していなければ、最初に保存できたときに連番を決める
	let filename: string | null = result.filename;
	element("name").textContent = filename ?? "撮影した画像";

	async function save(saveAs: boolean) {
		const name = filename ?? (await peekImageName());
		const { folder } = await loadSettings();
		try {
			await chrome.downloads.download({
				url,
				filename: folder ? `${folder}/${name}` : name,
				conflictAction: "uniquify",
				saveAs,
			});
			if (filename === null) {
				await advanceImageCount();
				filename = name;
				element("name").textContent = name;
			}
			showToast("保存しました");
		} catch (error) {
			console.error(error);
			if (!/cancel/i.test(String(error))) {
				showToast("保存できませんでした");
			}
		}
	}

	async function copy() {
		try {
			await navigator.clipboard.write([
				new ClipboardItem({ "image/png": blob }),
			]);
			showToast("コピーしました");
		} catch (error) {
			console.error(error);
			showToast("コピーできませんでした");
		}
	}

	element("save").addEventListener("click", () => save(false));
	element("save-as").addEventListener("click", () => save(true));
	element("copy").addEventListener("click", copy);
	element("actions").hidden = false;

	document.addEventListener("keydown", (event) => {
		if (!(event.ctrlKey || event.metaKey) || event.altKey) {
			return;
		}
		const key = event.key.toLowerCase();
		if (key === "s") {
			event.preventDefault();
			save(event.shiftKey);
		} else if (key === "c" && !event.shiftKey) {
			// 文字を選択しているときは、通常のコピーを優先する
			if (!getSelection()?.toString()) {
				event.preventDefault();
				copy();
			}
		}
	});
}

let toastTimer: ReturnType<typeof setTimeout>;

function showToast(text: string) {
	const toast = element("toast");
	toast.textContent = text;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (toast.textContent = ""), TOAST_MS);
}

// Mac では Ctrl の代わりに Command を案内する
if (/mac/i.test(navigator.platform)) {
	document.querySelectorAll("kbd").forEach((kbd) => {
		kbd.textContent = kbd.textContent!.replace("Ctrl+Shift+", "⇧⌘").replace("Ctrl+", "⌘");
	});
}
