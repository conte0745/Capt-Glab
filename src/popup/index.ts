import { initI18n, localizePage, t, tPlural, type MessageKey } from "../i18n";

const AUTO_CLOSE_MS = 2000;
// 読み切れるよう、補足があるときは長めに表示する
const AUTO_CLOSE_WITH_NOTE_MS = 5000;

const ERROR_MESSAGES: Record<string, [MessageKey, MessageKey]> = {
	restricted: ["errorRestrictedTitle", "errorRestrictedNote"],
	busy: ["errorBusyTitle", "errorBusyNote"],
	"other-debugger": ["errorFailedTitle", "errorOtherDebuggerNote"],
	detached: ["errorDetachedTitle", "errorDetachedNote"],
	unknown: ["errorFailedTitle", "errorUnknownNote"],
};

await initI18n();
localizePage();

const statusText = document.getElementById("status")!;
const noteText = document.getElementById("note")!;
const loading = document.getElementById("loading")!;

document.getElementById("settings")!.addEventListener("click", () => {
	void chrome.runtime.openOptionsPage();
});

// 設定ボタンを押そうとしている間は閉じない
let hovering = false;
document.body.addEventListener("mouseenter", () => (hovering = true));
document.body.addEventListener("mouseleave", () => {
	hovering = false;
	if (closeRequested) {
		window.close();
	}
});
let closeRequested = false;

await start();

/** 開いているタブの撮影を頼み、届いた進み具合を表示する */
async function start() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	const port = chrome.runtime.connect({ name: "capture" });

	port.onMessage.addListener(async (message) => {
		if (message.type === "waiting") {
			statusText.textContent = t("popupWaiting");
		} else if (message.type === "error") {
			const [status, note] =
				ERROR_MESSAGES[message.reason] ?? ERROR_MESSAGES.unknown;
			show(t(status), t(note));
		} else if (message.type === "done") {
			await finish(port, message);
		}
	});
	port.postMessage({ request: "capture", tabId: tab.id });
}

type DoneMessage = {
	data?: string;
	/** 撮影した画像の枚数。複数のサイズや、長いページを分けたときは 2 以上 */
	count?: number;
	saved: "saved" | "canceled" | "failed" | "off";
	scaled: boolean;
	cut: boolean;
	openTab: boolean;
};

/** 撮影の結果を表示し、しばらくしたらパネルを閉じる */
async function finish(port: chrome.runtime.Port, message: DoneMessage) {
	const copied = message.data ? await copyImage(message.data) : null;

	if (message.openTab) {
		port.postMessage({ request: "copied" });
	}

	const notes = [];
	const count = message.count ?? 1;
	if (count > 1 && message.saved === "saved") {
		notes.push(tPlural("noteSavedCount", count));
	}
	if (count > 1 && copied) {
		notes.push(t("noteCopiedFirst"));
	}
	if (message.scaled) {
		notes.push(t("noteScaled"));
	}
	if (message.cut) {
		notes.push(t("noteCut"));
	}
	if (message.saved === "failed") {
		notes.push(t("noteSaveFailed"));
	}
	if (copied === false) {
		notes.push(t("noteCopyFailed"));
	}
	show(completedText(message.saved, copied), notes.join(t("noteSeparator")));

	await sleep(notes.length ? AUTO_CLOSE_WITH_NOTE_MS : AUTO_CLOSE_MS);
	closeRequested = true;
	if (!hovering) {
		window.close();
	}
}

/** 保存とコピーの結果から、表示する見出しを選ぶ */
function completedText(saved: DoneMessage["saved"], copied: boolean | null) {
	if (saved === "saved" && copied) return t("doneSavedCopied");
	if (saved === "saved") return t("saved");
	if (copied) return t("copied");
	if (saved === "canceled") return t("doneCanceled");
	return t("doneCaptured");
}

/** 画像をクリップボードにコピーし、成功したかを返す */
async function copyImage(data: string): Promise<boolean> {
	try {
		const image = await fetch(`data:image/png;base64,${data}`);
		const blob = await image.blob();
		await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
		return true;
	} catch (error) {
		console.error("Failed to copy image to clipboard:", error);
		return false;
	}
}

/** 読み込み中の表示を消して、見出しと補足を表示する */
function show(status: string, note: string) {
	loading.remove();
	statusText.textContent = status;
	noteText.textContent = note;
}

/** 指定したミリ秒だけ待つ */
function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
