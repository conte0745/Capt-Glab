chrome.action.onClicked.addListener(function (tab: chrome.tabs.Tab) {
	if (!tab || !tab.id) {
		return;
	}
	const id: number = tab.id!;
	chrome.windows.create({
		url: chrome.runtime.getURL("../src/popup/index.html"),
		type: "popup",
		width: 300,
		height: 200,
	});
	chrome.tabs.sendMessage(
		id,
		{ request: "click-extension", id: id },
		function (response) {
			console.log(response);
		}
	);
});
