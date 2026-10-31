import { expect } from "@playwright/test";
import { activeTabId, BLUE, clickAction, test, waitForShot } from "./fixtures";

test.describe("等倍", () => {
	test("100vh の要素を伸ばさずにページ全体を撮る", async ({ extension, page, url }) => {
		await page.goto(url);
		const viewport = await page.evaluate(() => ({
			width: innerWidth,
			height: innerHeight,
			pageHeight: document.documentElement.scrollHeight,
		}));

		const popup = await clickAction(extension, page);
		const shot = await waitForShot(popup, page);

		expect(shot).toMatchObject({
			filename: "screen-0001.png",
			width: viewport.width,
			height: viewport.pageHeight,
			firstScreenEnd: viewport.height,
			bottomColor: BLUE,
		});
	});

	test("保存後に完了を表示してウィンドウを閉じる", async ({ extension, page, url }) => {
		await page.goto(url);

		const popup = await clickAction(extension, page);

		await expect(popup.locator("#status")).toHaveText("画像を保存しました");
		await expect(popup.locator("#loading")).toHaveCount(0);
		await popup.waitForEvent("close");
	});

	test("続けて撮っても同じ高さで固定し、番号が増える", async ({ extension, page, url }) => {
		await page.goto(url);

		const firstPopup = await clickAction(extension, page);
		const first = await waitForShot(firstPopup, page);
		await firstPopup.waitForEvent("close");
		const secondPopup = await clickAction(extension, page);
		const second = await waitForShot(secondPopup, page);

		expect(second.filename).toBe("screen-0002.png");
		expect(second.height).toBe(first.height);
		expect(second.firstScreenEnd).toBe(first.firstScreenEnd);
	});

	test("撮影後にデバッガを切断する", async ({ extension, page, url }) => {
		await page.goto(url);
		const tabId = await activeTabId(extension, page);

		const popup = await clickAction(extension, page);
		await waitForShot(popup, page);

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

		const popup = await clickAction(extension, page);
		await expect(popup.locator("#status")).toHaveText("画像を保存しました");

		await page.bringToFront();
		const types = await page.evaluate(async () => {
			const [item] = await navigator.clipboard.read();
			return item.types;
		});
		expect(types).toContain("image/png");
	});

	test("デバッガを接続できないページでは失敗を表示して閉じない", async ({
		extension,
		page,
	}) => {
		await page.goto("chrome://version");

		const popup = await clickAction(extension, page);

		await expect(popup.locator("#status")).toHaveText("キャプチャに失敗しました");
		await popup.waitForTimeout(2500);
		expect(popup.isClosed()).toBe(false);
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

		const popup = await clickAction(extension, page);
		const shot = await waitForShot(popup, page);

		expect(shot).toMatchObject({
			width: viewport.width * 2,
			height: viewport.pageHeight * 2,
			firstScreenEnd: viewport.height * 2,
			bottomColor: BLUE,
		});
	});
});

test.describe("ブラウザのズーム", () => {
	// 既知の不具合。直ったらこのテストが失敗するので test.fail を外す
	test.fail("150% でもページ全体が正しい比率で写る", async ({ extension, page, url }) => {
		await page.goto(url);
		const tabId = await activeTabId(extension, page);
		await extension.worker.evaluate(
			(tabId) => chrome.tabs.setZoom(tabId, 1.5),
			tabId
		);
		await page.waitForTimeout(500);
		const viewport = await page.evaluate(() => ({
			width: innerWidth,
			height: innerHeight,
		}));

		const popup = await clickAction(extension, page);
		const shot = await waitForShot(popup, page);

		expect(shot.firstScreenEnd / shot.width).toBeCloseTo(
			viewport.height / viewport.width,
			2
		);
	});
});

test.describe("設定画面", () => {
	test("カウントをリセットすると番号が1に戻る", async ({ extension, page, url }) => {
		await page.goto(url);
		const popup = await clickAction(extension, page);
		await waitForShot(popup, page);

		const extensionId = new URL(extension.worker.url()).host;
		const options = await extension.context.newPage();
		await options.goto(`chrome-extension://${extensionId}/src/options/index.html`);
		await expect(options.locator("#storageValues")).toHaveText("1");
		await options.locator("#reset-count").click();
		await options.close();
		await popup.waitForEvent("close");
		await page.waitForTimeout(6000);

		const nextPopup = await clickAction(extension, page);
		const shot = await waitForShot(nextPopup, page);

		expect(shot.filename).toBe("screen-0001.png");
	});
});
