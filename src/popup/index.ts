export {};

const AUTO_CLOSE_MS = 2000;
// 読み切れるよう、補足があるときは長めに表示する
const AUTO_CLOSE_WITH_NOTE_MS = 5000;

const ERROR_MESSAGES: Record<string, [string, string]> = {
	restricted: [
		"このページは撮影できません",
		"chrome:// やウェブストアなど、ブラウザが保護しているページです。",
	],
	busy: ["撮影中です", "前の撮影が終わるまで、少しお待ちください。"],
	"other-debugger": [
		"撮影できませんでした",
		"他の拡張機能がこのタブを操作しています。終わってからお試しください。",
	],
	unknown: [
		"撮影できませんでした",
		"ページを読み込み直してから、もう一度お試しください。",
	],
};

const statusText = document.getElementById("status")!;
const noteText = document.getElementById("note")!;
const loading = document.getElementById("loading")!;

document.getElementById("settings")!.addEventListener("click", () => {
	chrome.runtime.openOptionsPage();
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

start();

async function start() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	const port = chrome.runtime.connect({ name: "capture" });

	port.onMessage.addListener(async (message) => {
		if (message.type === "waiting") {
			statusText.textContent = "前回の撮影の後処理を待っています…";
		} else if (message.type === "error") {
			const [status, note] =
				ERROR_MESSAGES[message.reason] ?? ERROR_MESSAGES.unknown;
			show(status, note);
		} else if (message.type === "done") {
			await finish(port, message);
		}
	});
	port.postMessage({ request: "capture", tabId: tab.id });
}

type DoneMessage = {
	data?: string;
	saved: "saved" | "canceled" | "failed" | "off";
	scaled: boolean;
	cut: boolean;
	openTab: boolean;
};

async function finish(port: chrome.runtime.Port, message: DoneMessage) {
	const copied = message.data ? await copyImage(message.data) : null;

	if (message.openTab) {
		port.postMessage({ request: "copied" });
	}

	const notes = [];
	if (message.scaled) {
		notes.push("長いページのため、縮小して保存しました。");
	}
	if (message.cut) {
		notes.push("本文の見えていない部分は写っていません。設定で変更できます。");
	}
	if (message.saved === "failed") {
		notes.push("ファイルを保存できませんでした。設定の保存先をご確認ください。");
	}
	if (copied === false) {
		notes.push("クリップボードにコピーできませんでした。");
	}
	show(completedText(message.saved, copied), notes.join(""));

	await sleep(notes.length ? AUTO_CLOSE_WITH_NOTE_MS : AUTO_CLOSE_MS);
	closeRequested = true;
	if (!hovering) {
		window.close();
	}
}

function completedText(saved: DoneMessage["saved"], copied: boolean | null) {
	if (saved === "saved" && copied) return "保存してコピーしました";
	if (saved === "saved") return "保存しました";
	if (copied) return "コピーしました";
	if (saved === "canceled") return "保存をキャンセルしました";
	return "撮影しました";
}

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

function show(status: string, note: string) {
	loading.remove();
	statusText.textContent = status;
	noteText.textContent = note;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
