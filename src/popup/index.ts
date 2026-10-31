export {};

const statusText = document.getElementById("status")!;
const loading = document.getElementById("loading")!;

createCapture();

async function createCapture() {
	const tabId = Number(new URLSearchParams(location.search).get("tabId"));

	try {
		const response = await chrome.runtime.sendMessage({
			request: "capture",
			tabId,
		});
		if (response.error) {
			throw new Error(response.error);
		}

		const image = await fetch(`data:image/png;base64,${response.data}`);
		const blob = await image.blob();

		await createDownloadLink(blob);
		const copied = await saveImageOnClipBoard(blob);

		loading.remove();
		statusText.textContent = copied
			? "画像を保存しました"
			: "画像を保存しました（クリップボードへのコピーは失敗しました）";

		await sleep(2000);
		window.close();
	} catch (error) {
		// 原因を確認できるようにウィンドウは閉じない
		console.error(error);
		loading.remove();
		statusText.textContent = "キャプチャに失敗しました";
	}
}

async function createDownloadLink(blob: Blob) {
	const link = document.createElement("a");
	link.href = URL.createObjectURL(blob);
	link.download = await getImageNameFromStorage();
	link.click();
}

async function getImageNameFromStorage(): Promise<string> {
	const ex = ".png";
	let name: string = "screen-";
	let count: number = 0;

	try {
		const result = await new Promise((resolve) => {
			chrome.storage.local.get(["image-name-count"], (data) => {
				resolve(data["image-name-count"]);
			});
		});

		count = Number(result) || 0;
		count += 1;

		chrome.storage.local.set({ "image-name-count": count });
	} catch (error) {
		console.error("Error getting image count from storage:", error);
	}

	return name + count.toString().padStart(4, "0") + ex;
}

async function saveImageOnClipBoard(blob: Blob): Promise<boolean> {
	try {
		await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
		return true;
	} catch (error) {
		console.error("Failed to copy image to clipboard:", error);
		return false;
	}
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
