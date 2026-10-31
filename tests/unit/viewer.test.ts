// @vitest-environment jsdom
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

const BODY = /<body>([\s\S]*)<\/body>/.exec(
	fs.readFileSync("src/viewer/index.html", "utf-8")
)![1];
const BLOB = new Blob(["png"], { type: "image/png" });

// 前のテストのキー入力の登録を残さない
let removeKeydown = () => {};

async function load(
	result: object | null,
	options: { folder?: string; platform?: string } = {}
) {
	document.body.replaceWith(document.createElement("body"));
	document.body.innerHTML = BODY;
	history.replaceState(null, "", "/?id=abc");

	const store: Record<string, unknown> = {
		settings: { folder: options.folder ?? "" },
	};
	const sendMessage = vi.fn(async () => result);
	const openOptionsPage = vi.fn();
	const download = vi.fn(async () => 1);
	vi.stubGlobal("chrome", {
		runtime: { sendMessage, openOptionsPage },
		downloads: { download },
		storage: {
			local: {
				get: vi.fn(async (key: string) => ({ [key]: store[key] })),
				set: vi.fn(async (items: object) => {
					Object.assign(store, items);
				}),
			},
		},
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ blob: async () => BLOB }))
	);
	vi.stubGlobal(
		"ClipboardItem",
		class {
			constructor(public items: Record<string, Blob>) {}
		}
	);
	const write = vi.fn(async () => {});
	vi.stubGlobal("navigator", {
		clipboard: { write },
		platform: options.platform ?? "Win32",
	});
	URL.createObjectURL = vi.fn(() => "blob:image");
	vi.spyOn(console, "error").mockImplementation(() => {});

	removeKeydown();
	const add = vi.spyOn(document, "addEventListener");
	vi.resetModules();
	await import("../../src/viewer/index");
	await vi.waitFor(() => {
		const shown =
			!document.getElementById("image")!.hidden ||
			!document.getElementById("message")!.hidden;
		expect(shown).toBe(true);
	});
	const listeners = add.mock.calls.filter(([type]) => type === "keydown");
	removeKeydown = () =>
		listeners.forEach(([type, listener]) =>
			document.removeEventListener(type, listener as EventListener)
		);
	add.mockRestore();
	return { sendMessage, openOptionsPage, download, write, store };
}

const IMAGE = { data: "BASE64", filename: "screen-0001.png" };

function press(init: KeyboardEventInit) {
	const event = new KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		...init,
	});
	document.dispatchEvent(event);
	return event;
}

const settle = () => new Promise((resolve) => setTimeout(resolve));
const toast = () => document.getElementById("toast")!.textContent;

describe("viewer", () => {
	it("URLのIDで画像を受け取って表示する", async () => {
		const { sendMessage } = await load(IMAGE);

		expect(sendMessage).toHaveBeenCalledWith({
			request: "viewer-image",
			id: "abc",
		});
		expect((document.getElementById("image") as HTMLImageElement).src).toBe(
			"blob:image"
		);
		expect(document.getElementById("actions")!.hidden).toBe(false);
		expect(document.getElementById("name")!.textContent).toBe("screen-0001.png");
	});

	it("設定ボタンで設定画面を開く", async () => {
		const { openOptionsPage } = await load(null);

		document.getElementById("settings")!.click();

		expect(openOptionsPage).toHaveBeenCalledTimes(1);
	});

	it("画像がなければ案内を出し、操作を出さない", async () => {
		await load(null);

		expect(document.getElementById("message")!.hidden).toBe(false);
		expect(document.getElementById("image")!.hidden).toBe(true);
		expect(document.getElementById("actions")!.hidden).toBe(true);
	});

	it("画像がなければショートカットは何もしない", async () => {
		const { download, write } = await load(null);

		const event = press({ key: "s", ctrlKey: true });
		press({ key: "c", ctrlKey: true });
		await settle();

		expect(event.defaultPrevented).toBe(false);
		expect(download).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	});

	describe("保存", () => {
		it.each([{ ctrlKey: true }, { metaKey: true }])(
			"%j + S で確認なしで保存する",
			async (modifier) => {
				const { download } = await load(IMAGE);

				const event = press({ key: "s", ...modifier });
				await settle();

				expect(event.defaultPrevented).toBe(true);
				expect(download).toHaveBeenCalledWith({
					url: "blob:image",
					filename: "screen-0001.png",
					conflictAction: "uniquify",
					saveAs: false,
				});
				expect(toast()).toBe("保存しました");
			}
		);

		it("Ctrl+Shift+S で別名で保存する", async () => {
			const { download } = await load(IMAGE);

			press({ key: "S", ctrlKey: true, shiftKey: true });
			await settle();

			expect(download).toHaveBeenCalledWith(
				expect.objectContaining({ saveAs: true })
			);
		});

		it("設定のフォルダに保存する", async () => {
			const { download } = await load(IMAGE, { folder: "a/b" });

			press({ key: "s", ctrlKey: true });
			await settle();

			expect(download).toHaveBeenCalledWith(
				expect.objectContaining({ filename: "a/b/screen-0001.png" })
			);
		});

		it("未保存の画像は最初の保存で連番を決め、同じ名前を使い続ける", async () => {
			const { download, store } = await load({ data: "BASE64", filename: null });
			store["image-name-count"] = 4;

			press({ key: "s", ctrlKey: true });
			await settle();
			press({ key: "s", ctrlKey: true });
			await settle();

			const names = download.mock.calls.map(
				(call) => (call as unknown as [{ filename: string }])[0].filename
			);
			expect(names).toEqual(["screen-0005.png", "screen-0005.png"]);
			expect(store["image-name-count"]).toBe(5);
			expect(document.getElementById("name")!.textContent).toBe("screen-0005.png");
		});

		it("キャンセルしたら連番を進めず、名前も決めない", async () => {
			const { download, store } = await load({ data: "BASE64", filename: null });
			store["image-name-count"] = 4;
			download.mockRejectedValue(new Error("Download canceled by the user"));

			press({ key: "s", ctrlKey: true, shiftKey: true });
			await settle();

			expect(store["image-name-count"]).toBe(4);
			expect(document.getElementById("name")!.textContent).toBe("撮影した画像");
		});

		it("ボタンでも保存と別名で保存ができる", async () => {
			const { download } = await load(IMAGE);

			document.getElementById("save")!.click();
			await settle();
			document.getElementById("save-as")!.click();
			await settle();

			expect(download).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({ saveAs: false })
			);
			expect(download).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ saveAs: true })
			);
		});

		it("失敗したら知らせる", async () => {
			const { download } = await load(IMAGE);
			download.mockRejectedValue(new Error("Invalid filename"));

			press({ key: "s", ctrlKey: true });
			await settle();

			expect(toast()).toBe("保存できませんでした");
		});

		it("別名で保存のキャンセルでは何も表示しない", async () => {
			const { download } = await load(IMAGE);
			download.mockRejectedValue(new Error("Download canceled by the user"));

			press({ key: "s", ctrlKey: true, shiftKey: true });
			await settle();

			expect(toast()).toBe("");
		});
	});

	describe("コピー", () => {
		it.each([{ ctrlKey: true }, { metaKey: true }])(
			"%j + C で画像をコピーする",
			async (modifier) => {
				const { write } = await load(IMAGE);

				const event = press({ key: "c", ...modifier });
				await settle();

				expect(event.defaultPrevented).toBe(true);
				const [[[item]]] = write.mock.calls as unknown as [
					[[{ items: object }]],
				];
				expect(item.items).toEqual({ "image/png": BLOB });
				expect(toast()).toBe("コピーしました");
			}
		);

		it("文字を選択しているときは通常のコピーに任せる", async () => {
			const { write } = await load(IMAGE);
			getSelection()!.selectAllChildren(document.getElementById("name")!);

			const event = press({ key: "c", ctrlKey: true });
			await settle();
			getSelection()!.removeAllRanges();

			expect(event.defaultPrevented).toBe(false);
			expect(write).not.toHaveBeenCalled();
		});

		it("失敗したら知らせる", async () => {
			const { write } = await load(IMAGE);
			write.mockRejectedValue(new Error("not focused"));

			press({ key: "c", ctrlKey: true });
			await settle();

			expect(toast()).toBe("コピーできませんでした");
		});
	});

	it("他のキーには反応しない", async () => {
		const { download, write } = await load(IMAGE);

		const events = [
			press({ key: "s" }),
			press({ key: "c" }),
			press({ key: "s", ctrlKey: true, altKey: true }),
			press({ key: "c", ctrlKey: true, shiftKey: true }),
			press({ key: "p", ctrlKey: true }),
		];
		await settle();

		expect(events.every((event) => !event.defaultPrevented)).toBe(true);
		expect(download).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	});

	it("キーの表示を OS に合わせる", async () => {
		await load(IMAGE, { platform: "MacIntel" });
		expect(document.getElementById("save-as")!.textContent).toContain("⇧⌘S");

		await load(IMAGE, { platform: "Win32" });
		expect(document.getElementById("save-as")!.textContent).toContain("Ctrl+Shift+S");
	});
});
