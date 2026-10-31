// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BLOB = new Blob(["png"], { type: "image/png" });

function setup() {
	// 前のテストのイベント登録を残さない
	document.body.replaceWith(document.createElement("body"));
	document.body.innerHTML = `<img id="loading" /><p id="status">撮影中…</p><p id="note"></p><button id="settings"></button>`;

	const openOptionsPage = vi.fn();
	let listener: (message: unknown) => Promise<void> | void = () => {};
	const port = {
		postMessage: vi.fn(),
		onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
	};
	vi.stubGlobal("chrome", {
		runtime: { connect: vi.fn(() => port), openOptionsPage },
		tabs: { query: vi.fn(async () => [{ id: 42 }]) },
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
	vi.stubGlobal("navigator", { clipboard: { write } });
	const close = vi.spyOn(window, "close").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});

	return {
		port,
		write,
		close,
		openOptionsPage,
		receive: async (message: object) => {
			listener(message);
			await vi.advanceTimersByTimeAsync(0);
		},
	};
}

async function load() {
	const ctx = setup();
	vi.resetModules();
	await import("../../src/popup/index");
	await vi.advanceTimersByTimeAsync(0);
	return ctx;
}

const done = (overrides: object = {}) => ({
	type: "done",
	data: "BASE64",
	saved: "saved",
	scaled: false,
	cut: false,
	openTab: false,
	...overrides,
});

const statusText = () => document.getElementById("status")!.textContent;
const noteText = () => document.getElementById("note")!.textContent;

describe("popup", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("表示中のタブの撮影を要求する", async () => {
		const { port } = await load();

		expect(port.postMessage).toHaveBeenCalledWith({
			request: "capture",
			tabId: 42,
		});
	});

	it("待機中はその理由を表示する", async () => {
		const { receive } = await load();

		await receive({ type: "waiting" });

		expect(statusText()).toContain("後処理を待っています");
		expect(document.getElementById("loading")).not.toBeNull();
	});

	it("保存とコピーが終わると表示して2秒後に閉じる", async () => {
		const { receive, write, close } = await load();

		await receive(done());

		const [[[item]]] = write.mock.calls as unknown as [[[{ items: object }]]];
		expect(item.items).toEqual({ "image/png": BLOB });
		expect(statusText()).toBe("保存してコピーしました");
		expect(document.getElementById("loading")).toBeNull();

		await vi.advanceTimersByTimeAsync(1999);
		expect(close).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(close).toHaveBeenCalledTimes(1);
	});

	it.each([
		[{ data: undefined }, "保存しました"],
		[{ saved: "off" }, "コピーしました"],
		[{ saved: "canceled", data: undefined }, "保存をキャンセルしました"],
		[{ saved: "off", data: undefined }, "撮影しました"],
	])("%j のときは %s と表示する", async (overrides, expected) => {
		const { receive } = await load();

		await receive(done(overrides));

		expect(statusText()).toBe(expected);
	});

	it("設定ボタンで設定画面を開く", async () => {
		const { openOptionsPage } = await load();

		document.getElementById("settings")!.click();

		expect(openOptionsPage).toHaveBeenCalledTimes(1);
	});

	it("マウスを乗せている間は閉じず、離すと閉じる", async () => {
		const { receive, close } = await load();
		document.body.dispatchEvent(new Event("mouseenter"));

		await receive(done());
		await vi.advanceTimersByTimeAsync(10000);
		expect(close).not.toHaveBeenCalled();

		document.body.dispatchEvent(new Event("mouseleave"));
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("閉じる前にマウスを離しても、待ち時間までは閉じない", async () => {
		const { receive, close } = await load();
		document.body.dispatchEvent(new Event("mouseenter"));
		document.body.dispatchEvent(new Event("mouseleave"));

		await receive(done());
		expect(close).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(2000);
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("画像がなければコピーしない", async () => {
		const { receive, write } = await load();

		await receive(done({ data: undefined }));

		expect(write).not.toHaveBeenCalled();
	});

	it("縮小したときは補足を出し、長めに表示する", async () => {
		const { receive, close } = await load();

		await receive(done({ scaled: true }));

		expect(noteText()).toContain("縮小");
		await vi.advanceTimersByTimeAsync(4999);
		expect(close).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("写っていない領域があれば設定を案内する", async () => {
		const { receive } = await load();

		await receive(done({ cut: true }));

		expect(noteText()).toContain("本文の見えていない部分");
		expect(noteText()).toContain("設定");
	});

	it("コピーに失敗したら保存の結果と失敗を伝える", async () => {
		const { receive, write } = await load();
		write.mockRejectedValue(new Error("not focused"));

		await receive(done());

		expect(statusText()).toBe("保存しました");
		expect(noteText()).toContain("クリップボードにコピーできませんでした");
	});

	it("保存に失敗したら設定の確認を促す", async () => {
		const { receive } = await load();

		await receive(done({ saved: "failed", data: undefined }));

		expect(noteText()).toContain("設定の保存先");
	});

	it("別タブを開く設定ならコピーの完了を知らせる", async () => {
		const { receive, port, write } = await load();

		await receive(done({ openTab: true }));

		expect(write.mock.invocationCallOrder[0]).toBeLessThan(
			port.postMessage.mock.invocationCallOrder[1]
		);
		expect(port.postMessage).toHaveBeenLastCalledWith({ request: "copied" });
	});

	it("別タブを開かない設定では知らせない", async () => {
		const { receive, port } = await load();

		await receive(done());

		expect(port.postMessage).toHaveBeenCalledTimes(1);
	});

	it.each([
		["restricted", "このページは撮影できません", "保護"],
		["busy", "撮影中です", "少しお待ちください"],
		["other-debugger", "撮影できませんでした", "他の拡張機能"],
		["unknown", "撮影できませんでした", "読み込み直して"],
		["???", "撮影できませんでした", "読み込み直して"],
	])("エラー %s の内容を表示し、閉じない", async (reason, status, note) => {
		const { receive, close } = await load();

		await receive({ type: "error", reason });
		await vi.advanceTimersByTimeAsync(10000);

		expect(statusText()).toBe(status);
		expect(noteText()).toContain(note);
		expect(document.getElementById("loading")).toBeNull();
		expect(close).not.toHaveBeenCalled();
	});
});
