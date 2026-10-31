import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TAB = { width: 1000, height: 613 };
const METRICS = {
	cssLayoutViewport: { clientWidth: 985 },
	cssContentSize: { height: 3013 },
};

function setup() {
	let onClicked: (tab: Partial<chrome.tabs.Tab>) => void = () => {};
	let onMessage: (
		message: unknown,
		sender: unknown,
		sendResponse: (response: unknown) => void
	) => unknown = () => {};

	const sendCommand = vi.fn(async (_target: unknown, method: string) => {
		if (method === "Page.getLayoutMetrics") return METRICS;
		if (method === "Page.captureScreenshot") return { data: "BASE64" };
		return {};
	});
	const chromeStub = {
		action: {
			onClicked: { addListener: (fn: typeof onClicked) => (onClicked = fn) },
		},
		runtime: {
			onMessage: { addListener: (fn: typeof onMessage) => (onMessage = fn) },
			getURL: (path: string) => `chrome-extension://id/${path}`,
		},
		windows: { create: vi.fn() },
		tabs: { get: vi.fn(async () => TAB) },
		debugger: {
			attach: vi.fn(async () => {}),
			detach: vi.fn(async () => {}),
			sendCommand,
		},
	};
	vi.stubGlobal("chrome", chromeStub);

	return {
		chromeStub,
		sendCommand,
		click: (tab: Partial<chrome.tabs.Tab>) => onClicked(tab),
		// 待機時間を進めながらキャプチャ要求の応答を待つ
		capture: (tabId: number) =>
			new Promise<{ data?: string; error?: string }>((resolve) => {
				onMessage({ request: "capture", tabId }, {}, (response) =>
					resolve(response as { data?: string; error?: string })
				);
			}),
		send: (message: unknown) => onMessage(message, {}, () => {}),
	};
}

function commandCalls(sendCommand: ReturnType<typeof setup>["sendCommand"]) {
	return sendCommand.mock.calls.map(([, method]) => method);
}

describe("background", () => {
	let ctx: ReturnType<typeof setup>;

	beforeEach(async () => {
		vi.useFakeTimers();
		vi.resetModules();
		ctx = setup();
		await import("../../src/background/index");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("アイコンのクリック", () => {
		it("タブIDを付けて撮影用のウィンドウを開く", () => {
			ctx.click({ id: 42 });

			expect(ctx.chromeStub.windows.create).toHaveBeenCalledWith(
				expect.objectContaining({
					url: expect.stringContaining("index.html?tabId=42"),
					type: "popup",
				})
			);
		});

		it("タブIDがなければ何もしない", () => {
			ctx.click({});

			expect(ctx.chromeStub.windows.create).not.toHaveBeenCalled();
		});
	});

	describe("メッセージの受信", () => {
		it("capture には非同期で応答すると返す", () => {
			expect(ctx.send({ request: "capture", tabId: 1 })).toBe(true);
		});

		it("他のメッセージでは撮影しない", () => {
			expect(ctx.send({ request: "other" })).toBeUndefined();
			expect(ctx.chromeStub.debugger.attach).not.toHaveBeenCalled();
		});
	});

	describe("撮影", () => {
		it("接続前に取得したサイズで固定し、ページ全体を撮って切断する", async () => {
			const result = ctx.capture(7);
			await vi.advanceTimersByTimeAsync(500);

			await expect(result).resolves.toEqual({ data: "BASE64" });

			const target = { tabId: 7 };
			expect(ctx.chromeStub.debugger.attach).toHaveBeenCalledWith(target, "1.3");
			expect(ctx.chromeStub.tabs.get.mock.invocationCallOrder[0]).toBeLessThan(
				ctx.chromeStub.debugger.attach.mock.invocationCallOrder[0]
			);
			expect(ctx.sendCommand).toHaveBeenCalledWith(
				target,
				"Emulation.setDeviceMetricsOverride",
				{ width: 1000, height: 613, deviceScaleFactor: 0, mobile: false }
			);
			expect(ctx.sendCommand).toHaveBeenCalledWith(
				target,
				"Page.captureScreenshot",
				{
					format: "png",
					captureBeyondViewport: true,
					clip: { x: 0, y: 0, width: 985, height: 3013, scale: 1 },
				}
			);
			expect(ctx.chromeStub.debugger.detach).toHaveBeenCalledWith(target);
		});

		it("固定の反映を待ってから撮影する", async () => {
			ctx.capture(7);

			await vi.advanceTimersByTimeAsync(499);
			expect(commandCalls(ctx.sendCommand)).toEqual([
				"Emulation.setDeviceMetricsOverride",
			]);

			await vi.advanceTimersByTimeAsync(1);
			expect(commandCalls(ctx.sendCommand)).toContain("Page.captureScreenshot");
		});

		it("撮影に失敗してもエラーを返して切断する", async () => {
			ctx.sendCommand.mockImplementation(async (_target, method) => {
				if (method === "Page.captureScreenshot") throw new Error("boom");
				return METRICS;
			});

			const result = ctx.capture(7);
			await vi.advanceTimersByTimeAsync(500);

			await expect(result).resolves.toEqual({ error: "Error: boom" });
			expect(ctx.chromeStub.debugger.detach).toHaveBeenCalledTimes(1);
		});

		it("切断に失敗しても撮影結果を返す", async () => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			ctx.chromeStub.debugger.detach.mockRejectedValue(new Error("detached"));

			const result = ctx.capture(7);
			await vi.advanceTimersByTimeAsync(500);

			await expect(result).resolves.toEqual({ data: "BASE64" });
		});

		it("接続できないときはエラーを返し、切断しない", async () => {
			ctx.chromeStub.debugger.attach.mockRejectedValue(new Error("restricted"));

			await expect(ctx.capture(7)).resolves.toEqual({
				error: "Error: restricted",
			});
			expect(ctx.chromeStub.debugger.detach).not.toHaveBeenCalled();
		});

		it("タブのサイズを取得できないときは接続しない", async () => {
			ctx.chromeStub.tabs.get.mockResolvedValue({} as typeof TAB);

			const response = await ctx.capture(7);

			expect(response.error).toContain("ビューポートサイズ");
			expect(ctx.chromeStub.debugger.attach).not.toHaveBeenCalled();
		});
	});

	describe("連続撮影", () => {
		async function captureOnce(tabId: number) {
			const result = ctx.capture(tabId);
			await vi.advanceTimersByTimeAsync(500);
			await result;
		}

		it("同じタブでは切断から6秒経つまでタブのサイズを読まない", async () => {
			await captureOnce(7);
			ctx.chromeStub.tabs.get.mockClear();

			ctx.capture(7);
			await vi.advanceTimersByTimeAsync(5999);
			expect(ctx.chromeStub.tabs.get).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			expect(ctx.chromeStub.tabs.get).toHaveBeenCalledWith(7);
		});

		it("6秒経過後は待たない", async () => {
			await captureOnce(7);
			await vi.advanceTimersByTimeAsync(6000);
			ctx.chromeStub.tabs.get.mockClear();

			ctx.capture(7);
			await vi.advanceTimersByTimeAsync(0);

			expect(ctx.chromeStub.tabs.get).toHaveBeenCalledWith(7);
		});

		it("別のタブでは待たない", async () => {
			await captureOnce(7);
			ctx.chromeStub.tabs.get.mockClear();

			ctx.capture(8);
			await vi.advanceTimersByTimeAsync(0);

			expect(ctx.chromeStub.tabs.get).toHaveBeenCalledWith(8);
		});
	});
});
