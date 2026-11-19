import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTORE_SCROLL_AREAS } from "../../src/background/scroll-areas";
import { DEFAULT_SETTINGS, type Settings } from "../../src/settings";
import { i18nStub } from "./i18n-stub";

const TAB = { width: 1000, height: 613 };
const METRICS = {
	cssLayoutViewport: { clientWidth: 985 },
	cssContentSize: { height: 3013 },
};

function setup(settings: Partial<Settings> = {}) {
	type Listener = (message: any) => void;
	let onConnect: (port: unknown) => void = () => {};
	let onInstalled: (details: { reason: string }) => void = () => {};
	let onMessage: (
		message: unknown,
		sender: unknown,
		sendResponse: (response: unknown) => void
	) => unknown = () => {};

	const store: Record<string, unknown> = {
		settings: { ...DEFAULT_SETTINGS, ...settings },
	};
	const metrics = {
		current: METRICS,
		dpr: 1,
		areas: { bottom: 0, contentCut: false, scrolled: false },
	};
	const sendCommand = vi.fn(async (
		_target: unknown,
		method: string,
		params?: { expression?: string }
	): Promise<any> => {
		if (method === "Page.getLayoutMetrics") return metrics.current;
		if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "F" } } };
		if (method === "Page.createIsolatedWorld") return { executionContextId: 5 };
		if (method === "Runtime.evaluate") {
			const expression = String(params?.expression);
			if (expression.includes("devicePixelRatio")) {
				return { result: { value: metrics.dpr } };
			}
			if (expression === RESTORE_SCROLL_AREAS) {
				return { result: {} };
			}
			return { result: { value: metrics.areas } };
		}
		if (method === "Page.captureScreenshot") return { data: "BASE64" };
		return {};
	});
	const chromeStub = {
		i18n: i18nStub(),
		runtime: {
			onInstalled: { addListener: (fn: typeof onInstalled) => (onInstalled = fn) },
			openOptionsPage: vi.fn(),
			onConnect: { addListener: (fn: typeof onConnect) => (onConnect = fn) },
			onMessage: { addListener: (fn: typeof onMessage) => (onMessage = fn) },
			getURL: (path: string) => `chrome-extension://id/${path}`,
		},
		storage: {
			local: {
				get: vi.fn(async (key: string) => ({ [key]: store[key] })),
				set: vi.fn(async (items: object) => Object.assign(store, items)),
			},
			sync: {
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
		installed: (reason: string) => onInstalled({ reason }),
		capture(tabId = 7) {
			const port = connect();
			port.send({ request: "capture", tabId });
			return port;
		},
		/** 別タブと同じように、画像を1枚ずつ受け取る */
		async viewerImage(id: string) {
			const images: unknown[] = [];
			for (let index = 0; ; index++) {
				const response = (await new Promise<unknown>((resolve) =>
					onMessage({ request: "viewer-image", id, index }, {}, resolve)
				)) as { image: unknown; count: number } | null;
				if (!response) {
					return images.length ? images : null;
				}
				images.push(response.image);
				if (images.length >= response.count) {
					return images;
				}
			}
		},
	};
}

async function load(settings?: Partial<Settings>) {
	vi.resetModules();
	const ctx = setup(settings);
	await import("../../src/background/index");
	return ctx;
}

const flush = (ms = 1000) => vi.advanceTimersByTimeAsync(ms);

const downloadedNames = (ctx: Awaited<ReturnType<typeof load>>) =>
	(ctx.chromeStub.downloads.download.mock.calls as unknown as [{ filename: string }][]).map(
		([options]) => options.filename
	);

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

	it("初回インストール時だけ設定画面を開く", async () => {
		const ctx = await load();

		ctx.installed("update");
		expect(ctx.chromeStub.runtime.openOptionsPage).not.toHaveBeenCalled();

		ctx.installed("install");
		expect(ctx.chromeStub.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
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

		it("縮小した倍率を別タブに渡す", async () => {
			const ctx = await load({ openTab: true, clipboard: false });
			ctx.metrics.current = { ...METRICS, cssContentSize: { height: 32000 } };

			ctx.capture();
			await flush();

			const [image] = (await ctx.viewerImage("uuid")) as { scale: number; conditions: string[] }[];
			expect(image.scale).toBe(0.5);
			expect(image.conditions).toContain("縮小あり");
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

	describe("スクロール領域", () => {
		const evaluated = (ctx: Awaited<ReturnType<typeof load>>) =>
			ctx.sendCommand.mock.calls
				.filter(([, method]) => method === "Runtime.evaluate")
				.map(([, , params]) => String(params?.expression));

		it("設定を渡して領域を広げる", async () => {
			const ctx = await load({ expandContent: true, expandMenu: true });

			ctx.capture();
			await flush();

			expect(evaluated(ctx)[0]).toContain(
				'{"expandContent":true,"expandMenu":true,"restoreAfterMs":30000}'
			);
		});

		it("先頭へスクロールしたら反映を待ってから撮影する", async () => {
			const ctx = await load();
			ctx.metrics.areas = { bottom: 0, contentCut: false, scrolled: true };

			ctx.capture();
			await flush(500);
			expect(commands(ctx)).not.toContain("Page.getLayoutMetrics");

			await flush(300);
			expect(commands(ctx)).toContain("Page.captureScreenshot");
		});

		it("広げたら再レイアウトを待ってから撮影する", async () => {
			const ctx = await load();
			ctx.metrics.areas = { bottom: 5000, contentCut: false, scrolled: false };

			ctx.capture();
			await flush(500);
			expect(commands(ctx)).not.toContain("Page.getLayoutMetrics");

			await flush(300);
			expect(commands(ctx)).toContain("Page.captureScreenshot");
		});

		it("広げた領域がページより長ければ、その下端まで撮る", async () => {
			const ctx = await load();
			ctx.metrics.areas = { bottom: 5000, contentCut: false, scrolled: false };

			ctx.capture();
			await flush();

			expect(ctx.sendCommand).toHaveBeenCalledWith(
				{ tabId: 7 },
				"Page.captureScreenshot",
				expect.objectContaining({
					clip: { x: 0, y: 0, width: 985, height: 5000, scale: 1 },
				})
			);
		});

		it("隔離された環境で実行する", async () => {
			const ctx = await load();

			ctx.capture();
			await flush();

			expect(ctx.sendCommand).toHaveBeenCalledWith(
				{ tabId: 7 },
				"Page.createIsolatedWorld",
				{ frameId: "F", worldName: "CaptGrab" }
			);
			const evaluations = ctx.sendCommand.mock.calls.filter(
				([, method]) => method === "Runtime.evaluate"
			);
			expect(evaluations.length).toBeGreaterThan(0);
			for (const [, , params] of evaluations) {
				expect(params).toMatchObject({ contextId: 5 });
			}
		});

		it("広げられなくても見えている範囲を撮影する", async () => {
			const ctx = await load();
			const original = ctx.sendCommand.getMockImplementation()!;
			ctx.sendCommand.mockImplementation(async (target, method, params) =>
				method === "Runtime.evaluate" &&
				String(params?.expression).includes("expandContent")
					? { result: {}, exceptionDetails: { text: "boom" } }
					: original(target, method, params)
			);

			const port = ctx.capture();
			await flush();

			expect(port.posted.at(-1)).toMatchObject({ type: "done", cut: false });
		});

		it("本文が切れたままなら伝える", async () => {
			const ctx = await load();
			ctx.metrics.areas = { bottom: 0, contentCut: true, scrolled: false };

			const port = ctx.capture();
			await flush();

			expect(port.posted.at(-1).cut).toBe(true);
		});

		it("撮影後に元へ戻してから切断する", async () => {
			const ctx = await load();

			ctx.capture();
			await flush();

			const restore = ctx.sendCommand.mock.calls.findIndex(
				([, , params]) => params?.expression === RESTORE_SCROLL_AREAS
			);
			expect(restore).toBeGreaterThan(-1);
			expect(ctx.sendCommand.mock.invocationCallOrder[restore]).toBeLessThan(
				ctx.chromeStub.debugger.detach.mock.invocationCallOrder[0]
			);
		});

		it("撮影に失敗しても元へ戻す", async () => {
			const ctx = await load();
			const original = ctx.sendCommand.getMockImplementation()!;
			ctx.sendCommand.mockImplementation(async (target, method, params) => {
				if (method === "Page.captureScreenshot") throw new Error("boom");
				return original(target, method, params);
			});

			ctx.capture();
			await flush();

			expect(evaluated(ctx).at(-1)).toBe(RESTORE_SCROLL_AREAS);
		});
	});

	describe("遅延読み込みの画像", () => {
		const lazyEvaluations = (ctx: Awaited<ReturnType<typeof load>>) =>
			ctx.sendCommand.mock.calls
				.filter(([, method]) => method === "Runtime.evaluate")
				.map(([, , params]) => String(params?.expression))
				.filter((expression) => expression.includes('"stepMs"'));

		it("購入済みでオンなら、領域を広げる前に画像を読み込ませる", async () => {
			const ctx = await load({ loadLazyImages: true });
			ctx.store["payment-paid"] = true;

			ctx.capture();
			await flush();

			const expressions = ctx.sendCommand.mock.calls
				.filter(([, method]) => method === "Runtime.evaluate")
				.map(([, , params]) => String(params?.expression));
			expect(expressions[0]).toContain('{"stepMs":200,"maxMs":10000}');
			expect(expressions[1]).toContain('"expandContent"');
			expect(commands(ctx)).toContain("Page.captureScreenshot");
		});

		it("オンでも未購入なら使わない", async () => {
			const ctx = await load({ loadLazyImages: true });

			ctx.capture();
			await flush();

			expect(lazyEvaluations(ctx)).toEqual([]);
			expect(commands(ctx)).toContain("Page.captureScreenshot");
		});

		it("購入済みでもオフなら使わない", async () => {
			const ctx = await load();
			ctx.store["payment-paid"] = true;

			ctx.capture();
			await flush();

			expect(lazyEvaluations(ctx)).toEqual([]);
		});

		it("読み込みに失敗しても撮影する", async () => {
			const ctx = await load({ loadLazyImages: true });
			ctx.store["payment-paid"] = true;
			const original = ctx.sendCommand.getMockImplementation()!;
			ctx.sendCommand.mockImplementation(async (target, method, params) => {
				if (String(params?.expression).includes('"stepMs"')) {
					return { result: {}, exceptionDetails: { text: "boom" } };
				}
				return original(target, method, params);
			});

			const port = ctx.capture();
			await flush();

			expect(port.posted.at(-1)).toMatchObject({ type: "done" });
		});
	});

	describe("長いページの分割", () => {
		type Clip = { x: number; y: number; width: number; height: number; scale: number };
		const clips = (ctx: Awaited<ReturnType<typeof load>>) =>
			ctx.sendCommand.mock.calls
				.filter(([, method]) => method === "Page.captureScreenshot")
				.map(([, , params]) => (params as unknown as { clip: Clip }).clip);

		it("購入済みでオンなら、縮小せずに上限ごとに分けて撮り、番号を付けて保存する", async () => {
			const ctx = await load({ splitLongPages: true });
			ctx.store["payment-paid"] = true;
			ctx.store["image-name-count"] = 6;
			ctx.metrics.current = { ...METRICS, cssContentSize: { height: 20000 } };
			ctx.metrics.dpr = 2;

			const port = ctx.capture();
			await flush();

			expect(clips(ctx)).toEqual([
				{ x: 0, y: 0, width: 985, height: 8000, scale: 1 },
				{ x: 0, y: 8000, width: 985, height: 8000, scale: 1 },
				{ x: 0, y: 16000, width: 985, height: 4000, scale: 1 },
			]);
			const filenames = downloadedNames(ctx);
			expect(filenames).toEqual([
				"screen-0007-1.png",
				"screen-0007-2.png",
				"screen-0007-3.png",
			]);
			expect(ctx.store["image-name-count"]).toBe(7);
			expect(port.posted.at(-1)).toMatchObject({ count: 3, scaled: false });
		});

		it("上限に収まるページは分けない", async () => {
			const ctx = await load({ splitLongPages: true });
			ctx.store["payment-paid"] = true;

			ctx.capture();
			await flush();

			expect(clips(ctx)).toHaveLength(1);
			expect(ctx.chromeStub.downloads.download).toHaveBeenCalledWith(
				expect.objectContaining({ filename: "screen-0001.png" })
			);
		});

		it.each([
			[
				"高さの上限を下げると、その高さごとに分ける",
				{ splitMode: "height" as const, splitHeight: 5000 },
				[0, 2500, 5000, 7500],
			],
			[
				"枚数で分けると、短いページでも同じ高さに分ける",
				{ splitMode: "count" as const, splitCount: 3 },
				[0, 1005, 2010],
			],
			[
				"高さの値が正しくなければ、上限ごとに分ける",
				{ splitMode: "height" as const, splitHeight: 50 },
				[0, 8000],
			],
		])("%s", async (_, split, ys) => {
			const ctx = await load({ splitLongPages: true, ...split });
			ctx.store["payment-paid"] = true;
			ctx.metrics.dpr = 2;
			ctx.metrics.current = { ...METRICS, cssContentSize: { height: split.splitMode === "count" ? 3013 : 9000 } };

			ctx.capture();
			await flush();

			expect(clips(ctx).map((clip) => clip.y)).toEqual(ys);
		});

		it("枚数が少なすぎて1枚が上限を超えるなら、枚数を増やす", async () => {
			const ctx = await load({ splitLongPages: true, splitMode: "count", splitCount: 2 });
			ctx.store["payment-paid"] = true;
			ctx.metrics.dpr = 2;
			ctx.metrics.current = { ...METRICS, cssContentSize: { height: 20000 } };

			ctx.capture();
			await flush();

			// 画像では 40000px なので、16000px に収めるには 3 枚要る
			expect(clips(ctx).map((clip) => clip.height)).toEqual([6667, 6667, 6666]);
		});

		it("オンでも未購入なら、これまでどおり縮小する", async () => {
			const ctx = await load({ splitLongPages: true });
			ctx.metrics.current = { ...METRICS, cssContentSize: { height: 20000 } };
			ctx.metrics.dpr = 2;

			ctx.capture();
			await flush();

			expect(clips(ctx)).toHaveLength(1);
			expect(clips(ctx)[0].scale).toBe(0.4);
		});
	});

	describe("複数サイズ", () => {
		const overrides = (ctx: Awaited<ReturnType<typeof load>>) =>
			ctx.sendCommand.mock.calls
				.filter(([, method]) => method === "Emulation.setDeviceMetricsOverride")
				.map(([, , params]) => {
					const { width, height } = params as unknown as { width: number; height: number };
					return `${width}x${height}`;
				});

		it("購入済みでオンなら、選んだサイズで続けて撮り、サイズ付きの名前で保存する", async () => {
			const ctx = await load({
				multiSize: true,
				multiSizes: ["1920x1080", "375x667"],
				clipboard: true,
				openTab: true,
			});
			ctx.store["payment-paid"] = true;

			const port = ctx.capture();
			await flush(5000);
			port.send({ request: "copied" });
			await flush();

			expect(overrides(ctx)).toEqual(["1920x1080", "375x667"]);
			const filenames = downloadedNames(ctx);
			expect(filenames).toEqual([
				"screen-0001-1920x1080.png",
				"screen-0001-375x667.png",
			]);
			expect(port.posted.at(-1)).toMatchObject({ type: "done", count: 2, data: "BASE64" });
			// 複数枚でも、タブは1つにまとめる
			expect(ctx.chromeStub.tabs.create).toHaveBeenCalledTimes(1);
			// 1枚ずつ受け取り、すべて渡したら手放す
			expect(await ctx.viewerImage("uuid")).toEqual([
				{
					data: "BASE64",
					filename: "screen-0001-1920x1080.png",
					suffix: "-1920x1080",
					conditions: ["画面 1920×1080", "本文を最後まで撮る"],
					scale: 1,
				},
				{
					data: "BASE64",
					filename: "screen-0001-375x667.png",
					suffix: "-375x667",
					conditions: ["画面 375×667", "本文を最後まで撮る"],
					scale: 1,
				},
			]);
			expect(await ctx.viewerImage("uuid")).toBeNull();
		});

		it("サイズを切り替える前に、広げた領域を元に戻す", async () => {
			const ctx = await load({ multiSize: true, multiSizes: ["1920x1080", "375x667"] });
			ctx.store["payment-paid"] = true;

			ctx.capture();
			await flush(5000);

			const steps = ctx.sendCommand.mock.calls
				.map(([, method, params]) =>
					method === "Runtime.evaluate"
						? String(params?.expression) === RESTORE_SCROLL_AREAS
							? "restore"
							: String(params?.expression).includes('"expandContent"')
								? "expand"
								: null
						: method === "Page.captureScreenshot"
							? "capture"
							: method === "Emulation.setDeviceMetricsOverride"
								? "size"
								: null
				)
				.filter(Boolean);
			expect(steps).toEqual([
				"size",
				"expand",
				"capture",
				"size",
				"restore",
				"expand",
				"capture",
				"restore",
			]);
		});

		it("ズーム中は、サイズをズーム後の大きさに換算する", async () => {
			const ctx = await load({ multiSize: true, multiSizes: ["375x667"] });
			ctx.store["payment-paid"] = true;
			ctx.chromeStub.tabs.getZoom.mockResolvedValue(2);

			ctx.capture();
			await flush(5000);

			expect(overrides(ctx)).toEqual(["750x1334"]);
		});

		it("オンでも未購入なら、画面サイズの設定で1枚だけ撮る", async () => {
			const ctx = await load({ multiSize: true, multiSizes: ["1920x1080", "375x667"] });

			const port = ctx.capture();
			await flush(10000);

			expect(overrides(ctx)).toEqual([`${TAB.width}x${TAB.height}`]);
			expect(port.posted.at(-1)).toMatchObject({ count: 1 });
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
			const original = ctx.sendCommand.getMockImplementation()!;
			ctx.sendCommand.mockImplementation(async (target, method, params) => {
				if (method === "Page.captureScreenshot") throw new Error("boom");
				return original(target, method, params);
			});

			const port = ctx.capture();
			await flush();

			expect(port.posted.at(-1)).toEqual({ type: "error", reason: "unknown" });
			expect(ctx.chromeStub.debugger.detach).toHaveBeenCalledTimes(1);
		});

		it("撮影中に接続が切れたら、中断されたと伝える", async () => {
			const ctx = await load();
			const original = ctx.sendCommand.getMockImplementation()!;
			ctx.sendCommand.mockImplementation(async (target, method, params) => {
				if (method === "Page.captureScreenshot") {
					throw new Error("Debugger is not attached to the tab with id: 1.");
				}
				return original(target, method, params);
			});

			const port = ctx.capture();
			await flush();

			expect(port.posted.at(-1)).toEqual({ type: "error", reason: "detached" });
		});

		it("切断に失敗しても結果を返す", async () => {
			const ctx = await load();
			ctx.chromeStub.debugger.detach.mockRejectedValue(new Error("detached"));

			const port = ctx.capture();
			await flush();

			expect(port.posted.at(-1).type).toBe("done");
		});
	});

	it("同じタブを撮影中なら重ねて撮らず、撮影中と伝える", async () => {
		const ctx = await load();

		ctx.capture();
		const second = ctx.capture();
		await flush(0);

		expect(second.posted).toEqual([{ type: "error", reason: "busy" }]);
		expect(ctx.chromeStub.debugger.attach).toHaveBeenCalledTimes(1);

		await flush();
		ctx.chromeStub.debugger.attach.mockClear();
		ctx.capture();
		await flush(6000);
		expect(ctx.chromeStub.debugger.attach).toHaveBeenCalledTimes(1);
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

		it("保存できなかったときは連番を進めない", async () => {
			const ctx = await load();
			ctx.store["image-name-count"] = 3;
			ctx.chromeStub.downloads.download.mockRejectedValue(
				new Error("Download canceled by the user")
			);

			ctx.capture();
			await flush();

			expect(ctx.store["image-name-count"]).toBe(3);
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
		it("撮影したときの画面サイズと設定を、画像ごとに渡す", async () => {
			const ctx = await load({
				openTab: true,
				clipboard: false,
				splitLongPages: true,
				loadLazyImages: true,
				expandMenu: true,
				viewport: { mode: "custom", width: 1280, height: 800 },
			});
			ctx.store["payment-paid"] = true;
			ctx.chromeStub.tabs.getZoom.mockResolvedValue(1.25);
			ctx.metrics.current = { ...METRICS, cssContentSize: { height: 20000 } };

			ctx.capture();
			await flush(15000);

			const images = (await ctx.viewerImage("uuid")) as { conditions: string[] }[];
			expect(images.map((image) => image.conditions)).toEqual([1, 2].map((part) => [
				"画面 1280×800",
				`分割 ${part} / 2`,
				"ズーム 125%",
				"遅延読み込みの画像も写す",
				"本文を最後まで撮る",
				"サイドメニューを最後まで撮る",
			]));
		});

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

		it("保存していなければファイル名を渡さず、連番も進めない", async () => {
			const ctx = await load({ download: false, clipboard: false, openTab: true });
			ctx.capture();
			await flush();

			await expect(ctx.viewerImage("uuid")).resolves.toEqual([
				{
					data: "BASE64",
					filename: null,
					suffix: "",
					conditions: ["画面 1000×613（今の画面のまま）", "本文を最後まで撮る"],
					scale: 1,
				},
			]);
			expect(ctx.store["image-name-count"]).toBeUndefined();
		});

		it("画像は1回だけ渡して手放す", async () => {
			const ctx = await load({ clipboard: false, openTab: true });
			ctx.capture();
			await flush();

			await expect(ctx.viewerImage("uuid")).resolves.toEqual([
				{
					data: "BASE64",
					filename: "screen-0001.png",
					suffix: "",
					conditions: ["画面 1000×613（今の画面のまま）", "本文を最後まで撮る"],
					scale: 1,
				},
			]);
			await expect(ctx.viewerImage("uuid")).resolves.toBeNull();
		});
	});
});
