import {
	chromium,
	expect,
	test as base,
	type BrowserContext,
	type Page,
	type Worker,
} from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

const EXTENSION = path.resolve("dist");

// 100vh の要素の後ろに青い要素を置き、最後を緑にしたページ。青の高さは ?blue= で変えられる
const testPage = (blue: string) => `<!doctype html>
<body style="margin:0">
<div style="height:100vh;background:#cc3333"></div>
<div style="height:${blue}px;background:#0000ff"></div>
<div style="height:50px;background:#00ff00"></div>
</body>`;

type Fixtures = {
	scale: number;
	url: string;
	extension: { context: BrowserContext; worker: Worker; downloads: string };
	page: Page;
};

export const test = base.extend<Fixtures>({
	scale: [1, { option: true }],

	url: async ({}, use) => {
		const server = http.createServer((req, res) => {
			const { searchParams } = new URL(req.url!, "http://localhost");
			res.setHeader("content-type", "text/html");
			res.end(testPage(searchParams.get("blue") ?? "2400"));
		});
		await new Promise<void>((resolve) => server.listen(0, resolve));
		await use(`http://localhost:${(server.address() as AddressInfo).port}/`);
		server.close();
	},

	extension: async ({ scale }, use) => {
		const profile = fs.mkdtempSync(path.join(os.tmpdir(), "captgrab-"));
		const downloads = fs.mkdtempSync(path.join(os.tmpdir(), "captgrab-dl-"));
		fs.mkdirSync(path.join(profile, "Default"));
		fs.writeFileSync(
			path.join(profile, "Default", "Preferences"),
			JSON.stringify({
				download: { default_directory: downloads, prompt_for_download: false },
			})
		);
		const context = await chromium.launchPersistentContext(profile, {
			channel: "chromium",
			headless: true,
			viewport: null,
			args: [
				"--window-size=1000,700",
				`--force-device-scale-factor=${scale}`,
				`--disable-extensions-except=${EXTENSION}`,
				`--load-extension=${EXTENSION}`,
			],
		});
		const worker =
			context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
		await use({ context, worker, downloads });
		await context.close();
		fs.rmSync(profile, { recursive: true, force: true });
		fs.rmSync(downloads, { recursive: true, force: true });
	},

	page: async ({ extension }, use) => {
		const page = await extension.context.newPage();
		// Playwright の設定のままだと、chrome.downloads に渡したファイル名が無視される
		const cdp = await extension.context.newCDPSession(page);
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await use(page);
	},
});

/** page のタブIDを返す。tabs 権限がないので URL では検索できない */
export async function activeTabId(
	{ worker }: Fixtures["extension"],
	page: Page
): Promise<number> {
	await page.bringToFront();
	return worker.evaluate(async () => {
		const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
		return tab.id!;
	});
}

/** 拡張機能のアイコンを押した場合と同じく、ツールバーのパネルを開く */
export async function clickAction(
	{ worker }: Fixtures["extension"],
	page: Page
): Promise<void> {
	await page.bringToFront();
	await worker.evaluate(() => chrome.action.openPopup());
}

/** ツールバーのパネルが開いているかを返す */
export async function isPanelOpen(
	{ context }: Fixtures["extension"],
	page: Page
): Promise<boolean> {
	const cdp = await context.newCDPSession(page);
	const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{}] });
	await cdp.detach();
	return targetInfos.some((target) => target.url.includes("src/popup/index.html"));
}

/** パネルが閉じるまで待つ */
export async function waitForPanelClose(
	extension: Fixtures["extension"],
	page: Page
): Promise<void> {
	await expect.poll(() => isPanelOpen(extension, page)).toBe(false);
}

export type Shot = {
	filename: string;
	width: number;
	height: number;
	/** 100vh の要素が終わる、画像上の y 座標。見つからなければ -1 */
	firstScreenEnd: number;
	bottomColor: string;
};

/** ダウンロードされた画像を読み取って返す */
export async function waitForShot(
	{ downloads }: Fixtures["extension"],
	page: Page,
	filename = "screen-0001.png"
): Promise<Shot> {
	const target = path.join(downloads, filename);
	await expect.poll(() => fs.existsSync(target), { timeout: 20_000 }).toBe(true);
	const file = fs.readFileSync(target);
	const result = await page.evaluate(async (base64) => {
		const image = new Image();
		image.src = `data:image/png;base64,${base64}`;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = image.width;
		canvas.height = image.height;
		const context = canvas.getContext("2d")!;
		context.drawImage(image, 0, 0);
		const pixels = context.getImageData(10, 0, 1, image.height).data;
		const color = (y: number) => pixels.slice(y * 4, y * 4 + 3).join(",");
		let firstScreenEnd = -1;
		for (let y = 0; y < image.height; y++) {
			if (color(y) !== color(0)) {
				firstScreenEnd = y;
				break;
			}
		}
		return {
			width: image.width,
			height: image.height,
			firstScreenEnd,
			bottomColor: color(image.height - 1),
		};
	}, file.toString("base64"));
	return { filename, ...result };
}

export const GREEN = "0,255,0";

export async function setSettings(
	{ worker }: Fixtures["extension"],
	settings: object
): Promise<void> {
	await worker.evaluate((settings) => chrome.storage.local.set({ settings }), settings);
}
