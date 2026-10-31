import { loadSettings, type Settings } from "../settings";

// デタッチ後もインフォバーが消えるまで、タブの高さは縮んだままになる
const INFOBAR_CLOSE_MS = 6000;
const VIEWPORT_APPLY_MS = 500;
// サイズを変えるとページが組み変わるので、長めに待つ
const CUSTOM_VIEWPORT_APPLY_MS = 1000;
// 実測では高さ 16100px は正常で、16500px を超えると画像が壊れる
const MAX_IMAGE_SIDE = 16000;

const detachedAt = new Map<number, number>();
const viewerImages = new Map<string, { data: string; filename: string }>();

chrome.runtime.onConnect.addListener(function (port) {
	if (port.name !== "capture") {
		return;
	}
	port.onMessage.addListener(function (message) {
		if (message.request === "capture") {
			handleCapture(port, message.tabId);
		}
	});
});

chrome.runtime.onMessage.addListener(function (
	message,
	sender,
	sendResponse
) {
	if (message.request === "viewer-image") {
		// 画像をメモリに残さないよう、渡したら手放す
		sendResponse(viewerImages.get(message.id) ?? null);
		viewerImages.delete(message.id);
	}
});

async function handleCapture(port: chrome.runtime.Port, tabId: number) {
	let connected = true;
	let onGone = () => {};
	const gone = new Promise<void>((resolve) => (onGone = resolve));
	port.onDisconnect.addListener(() => {
		connected = false;
		onGone();
	});
	const post = (message: object) => {
		if (connected) {
			port.postMessage(message);
		}
	};

	try {
		const settings = await loadSettings();
		const { data, scaled } = await captureTab(tabId, settings, () =>
			post({ type: "waiting" })
		);

		const saved = settings.download
			? await downloadImage(data, settings)
			: { state: "off" as const };
		const filename = saved.state === "saved" ? saved.filename : "captgrab.png";

		post({
			type: "done",
			data: settings.clipboard ? data : undefined,
			saved: saved.state,
			scaled,
			openTab: settings.openTab,
		});

		if (settings.openTab) {
			// タブを開くとパネルが閉じるので、コピーが終わってから開く
			if (settings.clipboard && connected) {
				const copied = new Promise<void>((resolve) =>
					port.onMessage.addListener((message) => {
						if (message.request === "copied") {
							resolve();
						}
					})
				);
				await Promise.race([copied, gone]);
			}
			await openViewer(data, filename);
		}
	} catch (error) {
		console.error(error);
		post({ type: "error", reason: classifyError(error) });
	}
}

function classifyError(error: unknown): string {
	const message = String(error);
	if (/already attached/i.test(message)) {
		return "other-debugger";
	}
	if (/cannot (access|attach)/i.test(message)) {
		return "restricted";
	}
	return "unknown";
}

async function captureTab(
	tabId: number,
	settings: Settings,
	onWaiting: () => void
): Promise<{ data: string; scaled: boolean }> {
	const custom = settings.viewport.mode === "custom";

	if (!custom) {
		const elapsed = Date.now() - (detachedAt.get(tabId) ?? 0);
		if (elapsed < INFOBAR_CLOSE_MS) {
			onWaiting();
			await sleep(INFOBAR_CLOSE_MS - elapsed);
		}
	}

	// 固定するサイズと撮影範囲の単位はズーム前の画面上の大きさなので、CSS ピクセルから換算する
	const zoom = await chrome.tabs.getZoom(tabId);

	// デバッガ接続時のインフォバーで高さが縮む前にビューポートサイズを取得する
	const { width, height } = custom
		? {
				width: Math.round(settings.viewport.width * zoom),
				height: Math.round(settings.viewport.height * zoom),
		  }
		: await chrome.tabs.get(tabId);
	if (!width || !height) {
		throw new Error("ビューポートサイズを取得できませんでした");
	}

	const target: chrome.debugger.Debuggee = { tabId };
	await chrome.debugger.attach(target, "1.3");

	try {
		await chrome.debugger.sendCommand(
			target,
			"Emulation.setDeviceMetricsOverride",
			{ width, height, deviceScaleFactor: 0, mobile: false }
		);
		// 固定が反映される前に撮影すると 100vh の要素がページ全体まで伸びる
		await sleep(custom ? CUSTOM_VIEWPORT_APPLY_MS : VIEWPORT_APPLY_MS);

		const metrics = (await chrome.debugger.sendCommand(
			target,
			"Page.getLayoutMetrics"
		)) as LayoutMetrics;
		const clipWidth = Math.round(metrics.cssLayoutViewport.clientWidth * zoom);
		const clipHeight = Math.round(metrics.cssContentSize.height * zoom);

		const { result } = (await chrome.debugger.sendCommand(
			target,
			"Runtime.evaluate",
			{ expression: "window.devicePixelRatio", returnByValue: true }
		)) as { result: { value: number } };
		// devicePixelRatio にはズームも含まれるので、ズーム分を除いて画像の大きさを求める
		const longestSide = (Math.max(clipWidth, clipHeight) * result.value) / zoom;
		const scale = Math.min(1, MAX_IMAGE_SIDE / longestSide);

		const screenshot = (await chrome.debugger.sendCommand(
			target,
			"Page.captureScreenshot",
			{
				format: "png",
				captureBeyondViewport: true,
				clip: { x: 0, y: 0, width: clipWidth, height: clipHeight, scale },
			}
		)) as { data: string };

		return { data: screenshot.data, scaled: scale < 1 };
	} finally {
		// デタッチするとビューポートの固定も解除される
		await chrome.debugger.detach(target).catch(console.error);
		detachedAt.set(tabId, Date.now());
	}
}

type SaveResult =
	| { state: "saved"; filename: string }
	| { state: "canceled" | "failed" };

async function downloadImage(
	data: string,
	settings: Settings
): Promise<SaveResult> {
	const name = await nextImageName();
	const filename = settings.folder ? `${settings.folder}/${name}` : name;

	try {
		await chrome.downloads.download({
			url: `data:image/png;base64,${data}`,
			filename,
			conflictAction: "uniquify",
			saveAs: settings.askEveryTime,
		});
		return { state: "saved", filename: name };
	} catch (error) {
		console.error(error);
		return { state: /cancel/i.test(String(error)) ? "canceled" : "failed" };
	}
}

async function nextImageName(): Promise<string> {
	const stored = await chrome.storage.local.get("image-name-count");
	const count = (Number(stored["image-name-count"]) || 0) + 1;
	await chrome.storage.local.set({ "image-name-count": count });
	return `screen-${count.toString().padStart(4, "0")}.png`;
}

async function openViewer(data: string, filename: string) {
	const id = crypto.randomUUID();
	viewerImages.set(id, { data, filename });
	await chrome.tabs.create({
		url: chrome.runtime.getURL(`src/viewer/index.html?id=${id}`),
	});
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

type LayoutMetrics = {
	cssLayoutViewport: { clientWidth: number };
	cssContentSize: { height: number };
};
