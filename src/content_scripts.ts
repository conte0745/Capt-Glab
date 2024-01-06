import html2canvas from "html2canvas";

chrome.runtime.onMessage.addListener(async function (
	message,
	sender,
	sendResponse
) {
	if (message.request === "click-extension") {
		await createCapture();
		sendResponse({ status: "SEND" });
	}
});

async function createCapture() {
	const width: number = window.innerWidth;
	const height: number = window.innerHeight;

	// console.log(window.innerWidth);
	// console.log(window.innerHeight);
	// console.log(document.body.clientWidth);
	// console.log(document.body.scrollHeight);

	try {
		const canvas = await html2canvas(document.body, {
			width: width,
			height: document.body.scrollHeight,
			windowWidth: width,
		});
		await saveImageOnClipBoard(canvas);
		await createDownloadLink(canvas);
	} catch (error) {
		console.error(error);
	}
}

async function createDownloadLink(canvas: HTMLCanvasElement) {
	const link = document.createElement("a");
	link.href = canvas.toDataURL();
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

	const imageName = name + count.toString().padStart(4, "0") + ex;
	console.log(imageName);
	return imageName;
}

function saveImageOnClipBoard(canvas: HTMLCanvasElement) {
	const imageData: string = canvas.toDataURL("image/png");

	if (!canvas) {
		return;
	}

	const img = new Image();
	img.src = imageData;

	img.onload = () => {
		const canvasForCopying = document.createElement("canvas");
		canvasForCopying.width = img.width;
		canvasForCopying.height = img.height;
		const context = canvasForCopying.getContext("2d");
		context!.drawImage(img, 0, 0, img.width, img.height);

		canvasForCopying.toBlob(async (blob) => {
			try {
				await navigator.clipboard.write([
					new ClipboardItem({ "image/png": blob! }),
				]);
				console.log("Image copied to clipboard!");
			} catch (error) {
				console.error("Failed to copy image to clipboard:", error);
			}
		});
	};
}
