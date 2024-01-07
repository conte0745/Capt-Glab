chrome.action.onClicked.addListener(async function (tab) {
	if (!tab || !tab.id || tab.url?.startsWith("chrome://extensions/")) {
		return;
	}
	const tabId = tab.id;

	let windowId;

	// ウィンドウを作成し、そのIDを取得
	await new Promise<void>((resolve) => {
		chrome.windows.create(
			{
				url: chrome.runtime.getURL("../src/popup/index.html"),
				type: "popup",
				width: 300,
				height: 200,
			},
			(result) => {
				windowId = result?.id;
				resolve(); // Promise を解決して次の処理に進む
			}
		);
	});

	await chrome.tabs.sendMessage(tabId, { request: "click-extension" });

	// sendMessage 完了後にウィンドウを削除
	if (windowId) {
		await sleep(2000);
		chrome.windows.remove(windowId);
	}
});

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
