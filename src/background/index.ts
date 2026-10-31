import {
	advanceImageCount,
	loadSettings,
	peekImageName,
	type Settings,
} from "../settings";
import {
	expandScrollAreas,
	RESTORE_SCROLL_AREAS,
	type ScrollAreaResult,
} from "./scroll-areas";

// デタッチ後もインフォバーが消えるまで、タブの高さは縮んだままになる
const INFOBAR_CLOSE_MS = 6000;
const VIEWPORT_APPLY_MS = 500;
// サイズを変えるとページが組み変わるので、長めに待つ
const CUSTOM_VIEWPORT_APPLY_MS = 1000;
// 広げた領域の再レイアウトと画像の読み込みを待つ
const SCROLL_AREA_APPLY_MS = 300;
// 撮影が終わる前に戻らないよう、十分に長くする
const SCROLL_AREA_RESTORE_MS = 30000;
// 実測では高さ 16100px は正常で、16500px を超えると画像が壊れる
const MAX_IMAGE_SIDE = 16000;

const detachedAt = new Map<number, number>();
const capturingTabs = new Set<number>();
const viewerImages = new Map<string, { data: string; filename: string | null }>();

chrome.runtime.onInstalled.addListener(function ({ reason }) {
	// 設定の入口を知ってもらうため、最初の1回だけ開く
	if (reason === "install") {
		chrome.runtime.openOptionsPage();
	}
});

chrome.runtime.onConnect.addListener(function (port) {
	if (port.name !== "capture") {
		return;
	}
	port.onMessage.addListener(function (message) {
		if (message.request === "capture") {
			if (capturingTabs.has(message.tabId)) {
				port.postMessage({ type: "error", reason: "busy" });
				return;
			}
			capturingTabs.add(message.tabId);
			handleCapture(port, message.tabId).finally(() =>
				capturingTabs.delete(message.tabId)
			);
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
		const { data, scaled, cut } = await captureTab(tabId, settings, () =>
			post({ type: "waiting" })
		);

		const saved = settings.download
			? await downloadImage(data, settings)
			: { state: "off" as const };
		const filename = saved.state === "saved" ? saved.filename : null;

		post({
			type: "done",
			data: settings.clipboard ? data : undefined,
			saved: saved.state,
			scaled,
			cut,
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
): Promise<{ data: string; scaled: boolean; cut: boolean }> {
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
	let restoreContextId: number | undefined;

	try {
		await chrome.debugger.sendCommand(
			target,
			"Emulation.setDeviceMetricsOverride",
			{ width, height, deviceScaleFactor: 0, mobile: false }
		);
		// 固定が反映される前に撮影すると 100vh の要素がページ全体まで伸びる
		await sleep(custom ? CUSTOM_VIEWPORT_APPLY_MS : VIEWPORT_APPLY_MS);

		const contextId = await createIsolatedContext(target);
		const areas = await evaluate<ScrollAreaResult>(
			target,
			contextId,
			`(${expandScrollAreas})(${JSON.stringify({
				expandContent: settings.expandContent,
				expandMenu: settings.expandMenu,
				restoreAfterMs: SCROLL_AREA_RESTORE_MS,
			})})`
		).catch((error): ScrollAreaResult => {
			// 広げられなくても、見えている範囲は撮影する
			console.error(error);
			return { bottom: 0, contentCut: false };
		});
		restoreContextId = contextId;
		if (areas.bottom > 0) {
			await sleep(SCROLL_AREA_APPLY_MS);
		}

		const metrics = (await chrome.debugger.sendCommand(
			target,
			"Page.getLayoutMetrics"
		)) as LayoutMetrics;
		const clipWidth = Math.round(metrics.cssLayoutViewport.clientWidth * zoom);
		const clipHeight = Math.round(
			Math.max(metrics.cssContentSize.height, areas.bottom) * zoom
		);

		const devicePixelRatio = await evaluate<number>(
			target,
			contextId,
			"window.devicePixelRatio"
		);
		// devicePixelRatio にはズームも含まれるので、ズーム分を除いて画像の大きさを求める
		const longestSide = (Math.max(clipWidth, clipHeight) * devicePixelRatio) / zoom;
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

		return {
			data: screenshot.data,
			scaled: scale < 1,
			cut: areas.contentCut,
		};
	} finally {
		if (restoreContextId !== undefined) {
			await evaluate(target, restoreContextId, RESTORE_SCROLL_AREAS).catch(
				console.error
			);
		}
		// デタッチするとビューポートの固定も解除される
		await chrome.debugger.detach(target).catch(console.error);
		detachedAt.set(tabId, Date.now());
	}
}

/** ページのスクリプトに結果を偽装されないよう、隔離された実行環境を作る */
async function createIsolatedContext(
	target: chrome.debugger.Debuggee
): Promise<number> {
	const { frameTree } = (await chrome.debugger.sendCommand(
		target,
		"Page.getFrameTree"
	)) as { frameTree: { frame: { id: string } } };
	const { executionContextId } = (await chrome.debugger.sendCommand(
		target,
		"Page.createIsolatedWorld",
		{ frameId: frameTree.frame.id, worldName: "CaptGrab" }
	)) as { executionContextId: number };
	return executionContextId;
}

async function evaluate<T>(
	target: chrome.debugger.Debuggee,
	contextId: number,
	expression: string
): Promise<T> {
	const { result, exceptionDetails } = (await chrome.debugger.sendCommand(
		target,
		"Runtime.evaluate",
		{ expression, contextId, returnByValue: true }
	)) as { result: { value: T }; exceptionDetails?: { text: string } };
	if (exceptionDetails) {
		throw new Error(exceptionDetails.text);
	}
	return result.value;
}

type SaveResult =
	| { state: "saved"; filename: string }
	| { state: "canceled" | "failed" };

async function downloadImage(
	data: string,
	settings: Settings
): Promise<SaveResult> {
	const name = await peekImageName();
	const filename = settings.folder ? `${settings.folder}/${name}` : name;

	try {
		await chrome.downloads.download({
			url: `data:image/png;base64,${data}`,
			filename,
			conflictAction: "uniquify",
			saveAs: settings.askEveryTime,
		});
		await advanceImageCount();
		return { state: "saved", filename: name };
	} catch (error) {
		console.error(error);
		return { state: /cancel/i.test(String(error)) ? "canceled" : "failed" };
	}
}

async function openViewer(data: string, filename: string | null) {
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
