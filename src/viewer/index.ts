export {};

show();

async function show() {
	const id = new URLSearchParams(location.search).get("id");
	const result = await chrome.runtime.sendMessage({
		request: "viewer-image",
		id,
	});
	if (!result) {
		document.getElementById("message")!.hidden = false;
		return;
	}

	const response = await fetch(`data:image/png;base64,${result.data}`);
	const url = URL.createObjectURL(await response.blob());

	const image = document.getElementById("image") as HTMLImageElement;
	image.src = url;
	image.hidden = false;

	const save = document.getElementById("save") as HTMLAnchorElement;
	save.href = url;
	save.download = result.filename;
	save.hidden = false;

	document.getElementById("name")!.textContent = result.filename;
}
