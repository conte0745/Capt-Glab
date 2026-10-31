import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../../src/settings";

const TAB = { width: 1000, height: 613 };
const METRICS = {
	cssLayoutViewport: { clientWidth: 985 },
	cssContentSize: { height: 3013 },
};

function setup(settings: Partial<Settings> = {}) {
	type Listener = (message: any) => void;
	let onConnect: (port: unknown) => void = () => {};
	let onMessage: (
		message: unknown,
		sender: unknown,
		sendResponse: (response: unknown) => void
	) => unknown = () => {};

	const store: Record<string, unknown> = {
		settings: { ...DEFAULT_SETTINGS, ...settings },
	};
	const metrics = { current: METRICS, dpr: 1 };
	const sendCommand = vi.fn(async (_target: unknown, method: string) => {
		if (method === "Page.getLayoutMetrics") return metrics.current;
		if (method === "Runtime.evaluate") return { result: { value: metrics.dpr } };
		if (method === "Page.captureScreenshot") return { data: "BASE64" };
		return {};
	});
	const chromeStub = {
		runtime: {
			onConnect: { addListener: (fn: typeof onConnect) => (onConnect = fn) },
			onMessage: { addListener: (fn: typeof onMessage) => (onMessage = fn) },
			getURL: (path: string) => `chrome-extension://id/${path}`,
		},
		storage: {
			local: {
				get: vi.fn(async (key: string) => ({ [key]: store[key] })),
				set: vi.fn(async (items: object) => Object.assign(store, items)),
			},
		},
		tabs: {
			get: vi.fn(async () => TAB),
			getZoom: vi.fn(async () => 1),
			create: vi.fn(async () => ({})),
		},
		debugger: {
			attach: vi.fn(async () => {}),
			detach: vi.fn(async () => {}),
			sendCommand,
		},
		downloads: { download: vi.fn(async () => 1) },
	};
	vi.stubGlobal("chrome", chromeStub);

	function connect(name = "capture") {
		const posted: any[] = [];
		const messageListeners: Listener[] = [];
		const disconnectListeners: (() => void)[] = [];
		const port = {
			name,
			postMessage: (message: unknown) => posted.push(message),
			onMessage: { addListener: (fn: Listener) => messageListeners.push(fn) },
			onDisconnect: {
				addListener: (fn: () => void) => disconnectListeners.push(fn),
			},
		};
		onConnect(port);
		return {
			posted,
			send: (message: unknown) => messageListeners.forEach((fn) => fn(message)),
			disconnect: () => disconnectListeners.forEach((fn) => fn()),
		};
	}

	return {
		chromeStub,
		sendCommand,
		store,
		metrics,
		connect,
		capture(tabId = 7) {
			const port = connect();
			port.send({ request: "capture", tabId });
			return port;
		},
		viewerImage: (id: string) =>
			new Promise((resolve) =>
				onMessage({ request: "viewer-image", id }, {}, resolve)
			),
	};
}

async function load(settings?: Partial<Settings>) {
	vi.resetModules();
	const ctx = setup(settings);
	await import("../../src/background/index");
	return ctx;
}

const flush = (ms = 1000) => vi.advanceTimersByTimeAsync(ms);

const commands = (ctx: Awaited<ReturnType<typeof load>>) =>
	ctx.sendCommand.mock.calls.map(([, method]) => method);

describe("background", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("crypto", { randomUUID: () => "uuid" });
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("capture 以外のポートは無視する", async () => {
		const ctx = await load();
		const port = ctx.connect("other");

		port.send({ request: "capture", tabId: 1 });
		await flush();

		expect(ctx.chromeStub.debugger.attach).not.toHaveBeenCalled();
	});

	describe("撮影", () => {
		it("接続前に取得したサイズで固定し、ページ全体を撮って切断する", async () => {
			const ctx = await load();

			ctx.capture();
			await flush();

			const target = { tabId: 7 };
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
			const ctx = await load();

			ctx.capture();
			await flush(499);
			expect(commands(ctx)).toEqual(["Emulation.setDeviceMetricsOverride"]);

			await flush(1);
			expect(commands(ctx)).toContain("Page.captureScreenshot");
		});

		it("指定サイズではそのサイズで固定し、長めに待つ", async () => {
			const ctx = await load({
				viewport: { mode: "custom", width: 375, height: 667 },
			});

			ctx.capture();
			await flush(999);
			expect(ctx.chromeStub.tabs.get).not.toHaveBeenCalled();
			expect(ctx.sendCommand).toHaveBeenCalledWith(
				{ tabId: 7 },
				"Emulation.setDeviceMetricsOverride",
				{ width: 375, height: 667, deviceScaleFactor: 0, mobile: false }
			);
			expect(commands(ctx)).not.toContain("Page.captureScreenshot");

			await flush(1);
			expect(commands(ctx)).toContain("Page.captureScreenshot");
		});

		it("ズーム中は撮影範囲を画面上の大きさに換算する", async () => {
			const ctx = await load();
			ctx.chromeStub.tabs.getZoom.mockResolvedValue(1.5);

			ctx.capture();
			await flush();

			expect(ctx.sendCommand).toHaveBeenCalledWith(
				{ tabId: 7 },
				"Page.captureScreenshot",
				expect.objectContaining({
					clip: { x: 0, y: 0, width: 1478, height: 4520, scale: 1 },
				})
			);
		});

		it("ズーム中も指定サイズのレイアウトになるよう換算する", async () => {
			const ctx = await load({
				viewport: { mode: "custom", width: 375, height: 667 },
			});
			ctx.chromeStub.tabs.getZoom.mockResolvedValue(2);

			ctx.capture();
			await flush();

			expect(ctx.sendCommand).toHaveBeenCalledWith(
				{ tabId: 7 },
				"Emulation.setDeviceMetricsOverride",
				{ width: 750, height: 1334, deviceScaleFactor: 0, mobile: false }
			);
		});

		it("ズームと表示倍率を合わせて画像の上限を判定する", async () => {
			const ctx = await load();
			ctx.chromeStub.tabs.getZoom.mockResolvedValue(2);
			ctx.metrics.current = {
				...METRICS,
				cssContentSize: { height: 8000 },
			};
			ctx.metrics.dpr = 4; // 表示倍率 2 × ズーム 2

			const port = ctx.capture();
			await flush();

			const screenshot = ctx.sendCommand.mock.calls.find(
				([, method]) => method === "Page.captureScreenshot"
			) as unknown as [unknown, string, { clip: { scale: number } }];
			expect(screenshot[2].clip.scale).toBe(0.5);
			expect(port.posted.at(-1).scaled).toBe(true);
		});

		it("画像の上限以内なら縮小しない", async () => {
			const ctx = await load();
			ctx.metrics.current = {
				...METRICS,
				cssContentSize: { height: 8000 },
			};
			ctx.metrics.dpr = 2;

			const port = ctx.capture();
			await flush();

			expect(port.posted.at(-1).scaled).toBe(false);
		});

		it("画像の上限を超えるなら縮小して、その旨を伝える", async () => {
			const ctx = await load();
			ctx.metrics.current = {
				...METRICS,
				cssContentSize: { height: 16000 },
			};
			ctx.metrics.dpr = 2;

			const port = ctx.capture();
			await flush();

			const screenshot = ctx.sendCommand.mock.calls.find(
				([, method]) => method === "Page.captureScreenshot"
			) as unknown as [unknown, string, { clip: { scale: number } }];
			expect(screenshot[2].clip.scale).toBe(0.5);
			expect(port.posted.at(-1).scaled).toBe(true);
		});

		it("タブのサイズを取得できないときは接続しない", async () => {
			const ctx = await load();
			ctx.chromeStub.tabs.get.mockResolvedValue({} as typeof TAB);

			const port = ctx.capture();
			await flush();

			expect(port.posted.at(-1)).toEqual({ type: "error", reason: "unknown" });
			expect(ctx.chromeStub.debugger.attach).not.toHaveBeenCalled();
		});
	});

	describe("エラー", () => {
		it.each([
			["Cannot access a chrome:// URL", "restricted"],
			["Cannot attach to this target.", "restricted"],
			["Another debugger is already attached", "other-debugger"],
			["boom", "unknown"],
		])("接続エラー %s は %s と伝える", async (message, reason) => {
			const ctx = await load();
			ctx.chromeStub.debugger.attach.mockRejectedValue(new Error(message));

			const port = ctx.capture();
			await flush();

			expect(port.posted).toEqual([{ type: "error", reason }]);
			expect(ctx.chromeStub.debugger.detach).not.toHaveBeenCalled();
		});

		it("撮影に失敗しても切断する", async () => {
			const ctx = await load();
			ctx.sendCommand.mockImplementation(async (_target, method) => {
				if (method === "Page.captureScreenshot") throw new Error("boom");
				return method === "Runtime.evaluate"
					? { result: { value: 1 } }
					: METRICS;
			});

			const port = ctx.capture();
			await flush();

			expect(port.posted.at(-1)).toEqual({ type: "error", reason: "unknown" });
			expect(ctx.chromeStub.debugger.detach).toHaveBeenCalledTimes(1);
		});

		it("切断に失敗しても結果を返す", async () => {
			const ctx = await load();
			ctx.chromeStub.debugger.detach.mockRejectedValue(new Error("detached"));

			const port = ctx.capture();
			await flush();

			expect(port.posted.at(-1).type).toBe("done");
		});
	});

	describe("連続撮影", () => {
		it("同じタブでは切断から6秒待ち、その旨を伝える", async () => {
			const ctx = await load();
			ctx.capture();
			await flush(500);
			ctx.chromeStub.tabs.get.mockClear();

			const port = ctx.capture();
			await flush(0);
			expect(port.posted).toEqual([{ type: "waiting" }]);

			await flush(5999);
			expect(ctx.chromeStub.tabs.get).not.toHaveBeenCalled();
			await flush(1);
			expect(ctx.chromeStub.tabs.get).toHaveBeenCalledWith(7);
		});

		it("6秒経過後は待たない", async () => {
			const ctx = await load();
			ctx.capture();
			await flush(6500);
			ctx.chromeStub.tabs.get.mockClear();

			const port = ctx.capture();
			await flush(0);

			expect(port.posted).not.toContainEqual({ type: "waiting" });
			expect(ctx.chromeStub.tabs.get).toHaveBeenCalled();
		});

		it("別のタブでは待たない", async () => {
			const ctx = await load();
			ctx.capture();
			await flush(500);
			ctx.chromeStub.tabs.get.mockClear();

			ctx.capture(8);
			await flush(0);

			expect(ctx.chromeStub.tabs.get).toHaveBeenCalledWith(8);
		});

		it("指定サイズでは待たない", async () => {
			const ctx = await load({
				viewport: { mode: "custom", width: 375, height: 667 },
			});
			ctx.capture();
			await flush();
			ctx.chromeStub.debugger.attach.mockClear();

			const port = ctx.capture();
			await flush(0);

			expect(port.posted).not.toContainEqual({ type: "waiting" });
			expect(ctx.chromeStub.debugger.attach).toHaveBeenCalled();
		});
	});

	describe("保存", () => {
		it("連番のファイル名でダウンロードする", async () => {
			const ctx = await load();
			ctx.store["image-name-count"] = 41;

			ctx.capture();
			await flush();

			expect(ctx.chromeStub.downloads.download).toHaveBeenCalledWith({
				url: "data:image/png;base64,BASE64",
				filename: "screen-0042.png",
				conflictAction: "uniquify",
				saveAs: false,
			});
			expect(ctx.store["image-name-count"]).toBe(42);
		});

		it("フォルダと毎回の確認の設定を渡す", async () => {
			const ctx = await load({ folder: "a/b", askEveryTime: true });

			ctx.capture();
			await flush();

			expect(ctx.chromeStub.downloads.download).toHaveBeenCalledWith(
				expect.objectContaining({
					filename: "a/b/screen-0001.png",
					saveAs: true,
				})
			);
		});

		it("パネルが閉じていても保存する", async () => {
			const ctx = await load();

			const port = ctx.capture();
			port.disconnect();
			await flush();

			expect(ctx.chromeStub.downloads.download).toHaveBeenCalledTimes(1);
			expect(port.posted).toEqual([]);
		});

		it("保存しない設定ではダウンロードせず、番号も増やさない", async () => {
			const ctx = await load({ download: false });

			const port = ctx.capture();
			await flush();

			expect(ctx.chromeStub.downloads.download).not.toHaveBeenCalled();
			expect(ctx.store["image-name-count"]).toBeUndefined();
			expect(port.posted.at(-1).saved).toBe("off");
		});

		it("保存に失敗したら failed を伝える", async () => {
			const ctx = await load();
			ctx.chromeStub.downloads.download.mockRejectedValue(
				new Error("Invalid filename")
			);

			const port = ctx.capture();
			await flush();

			expect(port.posted.at(-1).saved).toBe("failed");
		});

		it("キャンセルされたら canceled を伝える", async () => {
			const ctx = await load({ askEveryTime: true });
			ctx.chromeStub.downloads.download.mockRejectedValue(
				new Error("Download canceled by the user")
			);

			const port = ctx.capture();
			await flush();

			expect(port.posted.at(-1).saved).toBe("canceled");
		});

		it("コピーする設定のときだけ画像をパネルに渡す", async () => {
			const on = await load({ clipboard: true });
			const withCopy = on.capture();
			await flush();
			expect(withCopy.posted.at(-1).data).toBe("BASE64");

			const off = await load({ clipboard: false });
			const withoutCopy = off.capture();
			await flush();
			expect(withoutCopy.posted.at(-1).data).toBeUndefined();
		});
	});

	describe("別タブ", () => {
		it("開く設定でなければ開かない", async () => {
			const ctx = await load();

			ctx.capture();
			await flush();

			expect(ctx.chromeStub.tabs.create).not.toHaveBeenCalled();
		});

		it("コピーしないならすぐ開く", async () => {
			const ctx = await load({ clipboard: false, openTab: true });

			ctx.capture();
			await flush();

			expect(ctx.chromeStub.tabs.create).toHaveBeenCalledWith({
				url: "chrome-extension://id/src/viewer/index.html?id=uuid",
			});
		});

		it("コピーの完了を待ってから開く", async () => {
			const ctx = await load({ clipboard: true, openTab: true });

			const port = ctx.capture();
			await flush();
			expect(ctx.chromeStub.tabs.create).not.toHaveBeenCalled();

			port.send({ request: "copied" });
			await flush(0);
			expect(ctx.chromeStub.tabs.create).toHaveBeenCalledTimes(1);
		});

		it("コピー前にパネルが閉じても開く", async () => {
			const ctx = await load({ clipboard: true, openTab: true });

			const port = ctx.capture();
			await flush();
			port.disconnect();
			await flush(0);

			expect(ctx.chromeStub.tabs.create).toHaveBeenCalledTimes(1);
		});

		it("画像は1回だけ渡して手放す", async () => {
			const ctx = await load({ clipboard: false, openTab: true });
			ctx.capture();
			await flush();

			await expect(ctx.viewerImage("uuid")).resolves.toEqual({
				data: "BASE64",
				filename: "screen-0001.png",
			});
			await expect(ctx.viewerImage("uuid")).resolves.toBeNull();
		});
	});
});
