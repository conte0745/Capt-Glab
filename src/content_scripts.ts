import html2canvas from "html2canvas";

chrome.runtime.onMessage.addListener(async function (
	message,
	sender,
	sendResponse
) {
	if (message.request === "click-extension") {
		await createCapture(message.id);
		sendResponse(true);
	}
});

async function createCapture(id: number) {
	const width: number = window.innerWidth;
	const height: number = window.innerHeight;

	// console.log(window.innerWidth);
	// console.log(window.innerHeight);
	// console.log(document.body.clientWidth);
	// console.log(document.body.scrollHeight);

	html2canvas(document.body, {
		width: width,
		height: document.body.scrollHeight,
		windowWidth: width,
	}).then(function (canvas) {
		saveImageOnClipBoard(canvas, id);
		createDownloadLink(canvas);
	});
}

function createDownloadLink(canvas: HTMLCanvasElement) {
	const link = document.createElement("a");
	link.href = canvas.toDataURL();
	link.download = getImageNameFromStorage();
	link.click();
}

function getImageNameFromStorage(): string {
	const ex = ".png";
	let name: string = "screen-";
	let count: number | undefined = undefined;
	chrome.storage.local.get(["image-name-count"]).then((result) => {
		count = Number(result.key) ?? 0;
		count = isNaN(count) ? 0 : count;
		count += 1;
		console.log(count);
	});
	chrome.storage.local.set({ ["image-name-count"]: count });
	count = count ?? 0;
	const imageName = name + count.toString().padStart(4, "0") + ex;
	console.log(imageName);
	return imageName;
}

function saveImageOnClipBoard(canvas: HTMLCanvasElement, id: number) {
	const imageData: string = canvas.toDataURL("image/png");

	if (canvas === undefined || canvas === null) {
		return;
	}

	// 新たに画像を生成する
	const img = new Image();
	img.src = imageData;

	// 画像が読み込まれた後、それをクリップボードにコピーする
	img.onload = async function () {
		const canvasForCopying: HTMLCanvasElement =
			document.createElement("canvas");
		canvasForCopying.width = img.width;
		canvasForCopying.height = img.height;
		const context = canvasForCopying.getContext("2d");
		context!.drawImage(img, 0, 0, img.width, img.height);

		alert("Copy image on clip board");

		canvasForCopying.toBlob((blob) => {
			navigator.clipboard
				.write([new ClipboardItem({ "image/png": blob! })])
				.then(() => {
					console.log("Image copied to clipboard!");
				})
				.catch((error) => {
					console.error("Failed to copy image to clipboard:", error);
				});
		});
	};
}
