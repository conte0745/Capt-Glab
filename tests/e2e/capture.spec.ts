import { expect, type Worker } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
	activeTabId,
	GREEN,
	clickAction,
	isPanelOpen,
	setSettings,
	test,
	waitForPanelClose,
	waitForShot,
} from "./fixtures";

test.describe("等倍", () => {
	test("100vh の要素を伸ばさずにページ全体を撮る", async ({ extension, page, url }) => {
		await page.goto(url);
		const viewport = await page.evaluate(() => ({
			width: innerWidth,
			height: innerHeight,
			pageHeight: document.documentElement.scrollHeight,
		}));

		await clickAction(extension, page);
		const shot = await waitForShot(extension, page);

		expect(shot).toMatchObject({
			width: viewport.width,
			height: viewport.pageHeight,
			firstScreenEnd: viewport.height,
			bottomColor: GREEN,
		});
	});

	test("保存後にパネルを閉じる", async ({ extension, page, url }) => {
		await page.goto(url);

		await clickAction(extension, page);
		expect(await isPanelOpen(extension, page)).toBe(true);
		await waitForShot(extension, page);

		await waitForPanelClose(extension, page);
	});

	test("続けて撮っても同じ高さで固定し、番号が増える", async ({ extension, page, url }) => {
		await page.goto(url);

		await clickAction(extension, page);
		const first = await waitForShot(extension, page);
		await waitForPanelClose(extension, page);
		await clickAction(extension, page);
		const second = await waitForShot(extension, page, "screen-0002.png");

		expect(second.height).toBe(first.height);
		expect(second.firstScreenEnd).toBe(first.firstScreenEnd);
	});

	test("撮影後にデバッガを切断する", async ({ extension, page, url }) => {
		await page.goto(url);
		const tabId = await activeTabId(extension, page);

		await clickAction(extension, page);
		await waitForShot(extension, page);

		// 接続が残っていると、同じ拡張機能からの再接続はエラーになる
		await expect
			.poll(() =>
				extension.worker.evaluate(async (tabId) => {
					try {
						await chrome.debugger.attach({ tabId }, "1.3");
						await chrome.debugger.detach({ tabId });
						return "detached";
					} catch (error) {
						return String(error);
					}
				}, tabId)
			)
			.toBe("detached");
	});

	test("撮影した画像をクリップボードにコピーする", async ({ extension, page, url }) => {
		await page.goto(url);
		await extension.context.grantPermissions(["clipboard-read"], { origin: url });

		await clickAction(extension, page);
		await waitForShot(extension, page);
		await waitForPanelClose(extension, page);

		const types = await page.evaluate(async () => {
			const [item] = await navigator.clipboard.read();
			return item.types;
		});
		expect(types).toContain("image/png");
	});

	test("接続できないページのエラー文を撮影不可と判定できる", async ({ extension, page }) => {
		await page.goto("chrome://version");
		const tabId = await activeTabId(extension, page);

		const message = await extension.worker.evaluate(
			(tabId) =>
				chrome.debugger.attach({ tabId }, "1.3").then(
					() => "attached",
					(error) => String(error)
				),
			tabId
		);

		// background の classifyError と同じ判定
		expect(message).toMatch(/cannot (access|attach)/i);
	});

	test("デバッガを接続できないページでは保存せず、パネルを閉じない", async ({
		extension,
		page,
	}) => {
		await page.goto("chrome://version");

		await clickAction(extension, page);
		await page.waitForTimeout(3000);

		expect(await isPanelOpen(extension, page)).toBe(true);
		expect(fs.readdirSync(extension.downloads)).toEqual([]);
	});
});

test.describe("高DPI", () => {
	test.use({ scale: 2 });

	test("表示倍率の解像度で撮る", async ({ extension, page, url }) => {
		await page.goto(url);
		const viewport = await page.evaluate(() => ({
			width: innerWidth,
			height: innerHeight,
			pageHeight: document.documentElement.scrollHeight,
		}));

		await clickAction(extension, page);
		const shot = await waitForShot(extension, page);

		expect(shot).toMatchObject({
			width: viewport.width * 2,
			height: viewport.pageHeight * 2,
			firstScreenEnd: viewport.height * 2,
			bottomColor: GREEN,
		});
	});
});

async function setZoom(
	{ worker }: { worker: Worker },
	tabId: number,
	zoom: number
) {
	await worker.evaluate(
		({ tabId, zoom }) => chrome.tabs.setZoom(tabId, zoom),
		{ tabId, zoom }
	);
}

for (const scale of [1, 2]) {
	test.describe(`ブラウザのズーム（表示倍率 ${scale}）`, () => {
		test.use({ scale });

		for (const zoom of [1.5, 0.75]) {
			test(`${zoom * 100}% でもページ全体が正しい比率で写る`, async ({
				extension,
				page,
				url,
			}) => {
				await page.goto(url);
				await setZoom(extension, await activeTabId(extension, page), zoom);
				await page.waitForTimeout(500);
				const viewport = await page.evaluate(() => ({
					width: innerWidth,
					height: innerHeight,
					pageHeight: document.documentElement.scrollHeight,
				}));

				await clickAction(extension, page);
				const shot = await waitForShot(extension, page);

				expect(shot.firstScreenEnd / shot.width).toBeCloseTo(
					viewport.height / viewport.width,
					2
				);
				expect(shot.height / shot.width).toBeCloseTo(
					viewport.pageHeight / viewport.width,
					2
				);
				expect(shot.bottomColor).toBe(GREEN);
			});
		}
	});
}

test.describe("長いページ", () => {
	test.use({ scale: 2 });

	test("画像の上限を超えるときは縮小して壊れずに撮る", async ({ extension, page, url }) => {
		await page.goto(`${url}?blue=20000`);

		await clickAction(extension, page);
		const shot = await waitForShot(extension, page);

		expect(shot.height).toBeLessThanOrEqual(16000);
		expect(shot.bottomColor).toBe(GREEN);
	});
});

test.describe("設定", () => {
	const settings = {
		download: true,
		clipboard: false,
		openTab: false,
		folder: "",
		askEveryTime: false,
		viewport: { mode: "current", width: 1280, height: 800 },
	};

	test("指定したフォルダに保存する", async ({ extension, page, url }) => {
		await setSettings(extension, { ...settings, folder: "CaptGrab/shots" });
		await page.goto(url);

		await clickAction(extension, page);

		await waitForShot(extension, page, "CaptGrab/shots/screen-0001.png");
	});

	test("使えないフォルダで保存に失敗しても別タブは開く", async ({
		extension,
		page,
		url,
	}) => {
		await setSettings(extension, { ...settings, folder: "bad/../x", openTab: true });
		await page.goto(url);

		const opened = extension.context.waitForEvent("page");
		await clickAction(extension, page);

		const viewer = await opened;
		await expect(viewer.locator("#image")).toBeVisible();
		expect(fs.readdirSync(extension.downloads)).toEqual([]);
	});

	test("指定したビューポートのサイズで撮る", async ({ extension, page, url }) => {
		await setSettings(extension, {
			...settings,
			viewport: { mode: "custom", width: 500, height: 400 },
		});
		await page.goto(url);

		await clickAction(extension, page);
		const shot = await waitForShot(extension, page);

		expect(shot).toMatchObject({
			width: 500,
			height: 400 + 2400 + 50,
			firstScreenEnd: 400,
			bottomColor: GREEN,
		});
	});

	test("ズーム中も指定したサイズのレイアウトで撮る", async ({ extension, page, url }) => {
		await setSettings(extension, {
			...settings,
			viewport: { mode: "custom", width: 500, height: 400 },
		});
		await page.goto(url);
		await setZoom(extension, await activeTabId(extension, page), 1.5);
		await page.waitForTimeout(500);

		await clickAction(extension, page);
		const shot = await waitForShot(extension, page);

		expect(shot).toMatchObject({
			width: 750,
			firstScreenEnd: 600,
			bottomColor: GREEN,
		});
	});

	test("別タブで開くと画像を表示し、保存はしない", async ({ extension, page, url }) => {
		await setSettings(extension, { ...settings, download: false, openTab: true });
		await page.goto(url);

		const opened = extension.context.waitForEvent("page");
		await clickAction(extension, page);
		const viewer = await opened;

		await expect(viewer.locator("#image")).toBeVisible();
		await expect
			.poll(() =>
				viewer
					.locator("#image")
					.evaluate((image: HTMLImageElement) => image.naturalWidth)
			)
			.toBeGreaterThan(0);
		await expect(viewer.locator("#save")).toBeVisible();
		expect(fs.readdirSync(extension.downloads)).toEqual([]);
	});

	test("別タブとコピーを両方選ぶと、どちらも行う", async ({ extension, page, url }) => {
		await setSettings(extension, {
			...settings,
			download: false,
			clipboard: true,
			openTab: true,
		});
		await extension.context.grantPermissions(["clipboard-read"], { origin: url });
		await page.goto(url);

		const opened = extension.context.waitForEvent("page");
		await clickAction(extension, page);
		const viewer = await opened;
		await expect(viewer.locator("#image")).toBeVisible();

		await page.bringToFront();
		const types = await page.evaluate(async () => {
			const [item] = await navigator.clipboard.read();
			return item.types;
		});
		expect(types).toContain("image/png");
	});

	test("コピーしない設定ではクリップボードに画像が入らない", async ({
		extension,
		page,
		url,
	}) => {
		await setSettings(extension, settings);
		await extension.context.grantPermissions(["clipboard-read"], { origin: url });
		await page.goto(url);

		await clickAction(extension, page);
		await waitForShot(extension, page);
		await waitForPanelClose(extension, page);

		const types = await page.evaluate(async () => {
			const items = await navigator.clipboard.read();
			return items.flatMap((item) => item.types);
		});
		expect(types).not.toContain("image/png");
	});

	test("コピーだけを選ぶとファイルを保存しない", async ({ extension, page, url }) => {
		await setSettings(extension, { ...settings, download: false, clipboard: true });
		await extension.context.grantPermissions(["clipboard-read"], { origin: url });
		await page.goto(url);

		await clickAction(extension, page);
		await waitForPanelClose(extension, page);

		const types = await page.evaluate(async () => {
			const [item] = await navigator.clipboard.read();
			return item.types;
		});
		expect(types).toContain("image/png");
		expect(fs.readdirSync(extension.downloads)).toEqual([]);
	});

	test("設定画面の変更が撮影に反映される", async ({ extension, page, url }) => {
		await page.goto(url);
		const extensionId = new URL(extension.worker.url()).host;
		const options = await extension.context.newPage();
		await options.goto(`chrome-extension://${extensionId}/src/options/index.html`);
		await options.locator("#folder").fill("from-options");
		await options.locator("#folder").blur();
		await expect(options.locator("#saved")).toHaveText("保存しました");
		await options.selectOption("#preset", "375x667");
		await options.close();

		await clickAction(extension, page);
		const shot = await waitForShot(extension, page, "from-options/screen-0001.png");

		expect(shot.width).toBe(375);
		expect(shot.firstScreenEnd).toBe(667);
	});

	test("連番をリセットすると次のファイル名が戻る", async ({ extension, page, url }) => {
		await page.goto(url);
		await clickAction(extension, page);
		await waitForShot(extension, page);
		await waitForPanelClose(extension, page);
		fs.rmSync(path.join(extension.downloads, "screen-0001.png"));

		const extensionId = new URL(extension.worker.url()).host;
		const options = await extension.context.newPage();
		await options.goto(`chrome-extension://${extensionId}/src/options/index.html`);
		await expect(options.locator("#next-name")).toHaveText("screen-0002.png");
		await options.locator("#reset-count").click();
		await expect(options.locator("#next-name")).toHaveText("screen-0001.png");
		await options.close();

		await clickAction(extension, page);
		await waitForShot(extension, page);
	});
});
