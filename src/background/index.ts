chrome.action.onClicked.addListener(function (tab: chrome.tabs.Tab) {
	if (tab === undefined) {
		return;
	}
	const id: number = tab.id!;
	chrome.tabs.sendMessage(
		id,
		{ request: "click-extension", id: id },
		function (response) {
			console.log(response);
		}
	);
});
