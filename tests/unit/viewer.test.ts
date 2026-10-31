// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

async function load(result: object | null) {
	document.body.innerHTML = `
		<span id="name"></span>
		<a id="save" hidden></a>
		<p id="message" hidden></p>
		<img id="image" hidden />`;
	history.replaceState(null, "", "/?id=abc");

	const sendMessage = vi.fn(async () => result);
	vi.stubGlobal("chrome", { runtime: { sendMessage } });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ blob: async () => new Blob(["png"]) }))
	);
	URL.createObjectURL = vi.fn(() => "blob:image");

	vi.resetModules();
	await import("../../src/viewer/index");
	await vi.waitFor(() => {
		const shown =
			!document.getElementById("image")!.hidden ||
			!document.getElementById("message")!.hidden;
		expect(shown).toBe(true);
	});
	return { sendMessage };
}

describe("viewer", () => {
	it("URLのIDで画像を受け取って表示する", async () => {
		const { sendMessage } = await load({
			data: "BASE64",
			filename: "screen-0001.png",
		});

		expect(sendMessage).toHaveBeenCalledWith({
			request: "viewer-image",
			id: "abc",
		});
		expect((document.getElementById("image") as HTMLImageElement).src).toBe(
			"blob:image"
		);
		const save = document.getElementById("save") as HTMLAnchorElement;
		expect(save.hidden).toBe(false);
		expect(save.download).toBe("screen-0001.png");
		expect(document.getElementById("name")!.textContent).toBe("screen-0001.png");
	});

	it("画像がなければ案内を出す", async () => {
		await load(null);

		expect(document.getElementById("message")!.hidden).toBe(false);
		expect(document.getElementById("image")!.hidden).toBe(true);
		expect(document.getElementById("save")!.hidden).toBe(true);
	});
});
