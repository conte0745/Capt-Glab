// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BLOB = new Blob(["png"], { type: "image/png" });

function setup(options: { count?: number; response?: object } = {}) {
	document.body.innerHTML = `<h1 id="status">作成中・・・</h1><img id="loading" />`;
	history.replaceState(null, "", "/?tabId=42");

	const set = vi.fn();
	const sendMessage = vi.fn(async () => options.response ?? { data: "BASE64" });
	vi.stubGlobal("chrome", {
		runtime: { sendMessage },
		storage: {
			local: {
				get: (_keys: string[], callback: (data: object) => void) =>
					callback({ "image-name-count": options.count }),
				set,
			},
		},
	});

	const fetchStub = vi.fn(async () => ({ blob: async () => BLOB }));
	vi.stubGlobal("fetch", fetchStub);
	vi.stubGlobal(
		"ClipboardItem",
		class {
			constructor(public items: Record<string, Blob>) {}
		}
	);
	const write = vi.fn(async () => {});
	vi.stubGlobal("navigator", { clipboard: { write } });
	URL.createObjectURL = vi.fn(() => "blob:image");

	const downloads: string[] = [];
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
		this: HTMLAnchorElement
	) {
		downloads.push(this.download);
	});
	const close = vi.spyOn(window, "close").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});

	return { set, sendMessage, fetchStub, write, downloads, close };
}

async function run() {
	vi.resetModules();
	await import("../../src/popup/index");
	await vi.advanceTimersByTimeAsync(0);
}

const statusText = () => document.getElementById("status")!.textContent;

describe("popup", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("URLのタブIDで撮影を要求する", async () => {
		const { sendMessage, fetchStub } = setup();

		await run();

		expect(sendMessage).toHaveBeenCalledWith({ request: "capture", tabId: 42 });
		expect(fetchStub).toHaveBeenCalledWith("data:image/png;base64,BASE64");
	});

	it("画像をダウンロードしてクリップボードにコピーする", async () => {
		const { downloads, write } = setup();

		await run();

		expect(downloads).toEqual(["screen-0001.png"]);
		const [[[item]]] = write.mock.calls as unknown as [[[{ items: object }]]];
		expect(item.items).toEqual({ "image/png": BLOB });
		expect(statusText()).toBe("画像を保存しました");
		expect(document.getElementById("loading")).toBeNull();
	});

	it("保存したカウントの次の番号を4桁で付け、カウントを更新する", async () => {
		const { downloads, set } = setup({ count: 41 });

		await run();

		expect(downloads).toEqual(["screen-0042.png"]);
		expect(set).toHaveBeenCalledWith({ "image-name-count": 42 });
	});

	it("完了の2秒後にウィンドウを閉じる", async () => {
		const { close } = setup();

		await run();
		await vi.advanceTimersByTimeAsync(1999);
		expect(close).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("コピーに失敗しても保存し、その旨を表示する", async () => {
		const { downloads, write, close } = setup();
		write.mockRejectedValue(new Error("not focused"));

		await run();
		await vi.advanceTimersByTimeAsync(2000);

		expect(downloads).toHaveLength(1);
		expect(statusText()).toContain("クリップボードへのコピーは失敗しました");
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("撮影に失敗したら保存せず、ウィンドウを閉じない", async () => {
		const { downloads, write, set, close } = setup({
			response: { error: "Error: restricted" },
		});

		await run();
		await vi.advanceTimersByTimeAsync(10000);

		expect(statusText()).toBe("キャプチャに失敗しました");
		expect(document.getElementById("loading")).toBeNull();
		expect(downloads).toHaveLength(0);
		expect(write).not.toHaveBeenCalled();
		expect(set).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
	});
});
