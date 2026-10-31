export {};

chrome.action.onClicked.addListener(function (tab) {
	if (!tab || !tab.id) {
		return;
	}

	// キャプチャの実行と画像の保存はポップアップから開始する
	chrome.windows.create({
		url: chrome.runtime.getURL(`../src/popup/index.html?tabId=${tab.id}`),
		type: "popup",
		width: 300,
		height: 200,
	});
});

chrome.runtime.onMessage.addListener(function (
	message,
	sender,
	sendResponse
) {
	if (message.request === "capture") {
		captureTab(message.tabId)
			.then((data) => sendResponse({ data }))
			.catch((error) => sendResponse({ error: String(error) }));
		return true; // sendResponse を非同期で呼ぶ
	}
});

// デタッチ後もインフォバーが消えるまで、タブの高さは縮んだままになる
const INFOBAR_CLOSE_MS = 6000;
const VIEWPORT_APPLY_MS = 500;
const detachedAt = new Map<number, number>();

async function captureTab(tabId: number): Promise<string> {
	const elapsed = Date.now() - (detachedAt.get(tabId) ?? 0);
	if (elapsed < INFOBAR_CLOSE_MS) {
		await sleep(INFOBAR_CLOSE_MS - elapsed);
	}

	// デバッガ接続時のインフォバーで高さが縮む前にビューポートサイズを取得する
	const { width, height } = await chrome.tabs.get(tabId);
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
		await sleep(VIEWPORT_APPLY_MS);

		const metrics = (await chrome.debugger.sendCommand(
			target,
			"Page.getLayoutMetrics"
		)) as LayoutMetrics;

		const screenshot = (await chrome.debugger.sendCommand(
			target,
			"Page.captureScreenshot",
			{
				format: "png",
				captureBeyondViewport: true,
				clip: {
					x: 0,
					y: 0,
					width: metrics.cssLayoutViewport.clientWidth,
					height: metrics.cssContentSize.height,
					scale: 1,
				},
			}
		)) as { data: string };

		return screenshot.data;
	} finally {
		// デタッチするとビューポートの固定も解除される
		await chrome.debugger.detach(target).catch(console.error);
		detachedAt.set(tabId, Date.now());
	}
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

type LayoutMetrics = {
	cssLayoutViewport: { clientWidth: number };
	cssContentSize: { height: number };
};
