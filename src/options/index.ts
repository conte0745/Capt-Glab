document.addEventListener("DOMContentLoaded", function () {
	// ローカルストレージから'image-count'の値を取得して表示する関数
	function displayImageCount() {
		const storageValuesSpan = document.getElementById("storageValues");
		chrome.storage.local.get("image-name-count", function (items) {
			const imageCount = items["image-name-count"];
			const textContent = `${imageCount || "1"}`;
			storageValuesSpan!.textContent = textContent;
		});
	}

	// ページ読み込み時に'image-count'の値を表示
	displayImageCount();

	// リセットボタンをクリックした際に'image-count'をクリアして再表示
	document
		.getElementById("reset-count")
		?.addEventListener("click", function () {
			chrome.storage.local.remove("image-name-count", function () {
				document.getElementById("storageValues")!.innerHTML = "1"; // 値をクリア
				displayImageCount(); // 再表示
			});
		});
});
