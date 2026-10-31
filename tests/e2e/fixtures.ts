import {
	chromium,
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

// 100vh の要素の後ろに高さ 2400px の青い要素を置いたページ
const TEST_PAGE = `<!doctype html>
<body style="margin:0">
<div style="height:100vh;background:#cc3333"></div>
<div style="height:2400px;background:#0000ff"></div>
</body>`;

type Fixtures = {
	scale: number;
	url: string;
	extension: { context: BrowserContext; worker: Worker };
	page: Page;
};

export const test = base.extend<Fixtures>({
	scale: [1, { option: true }],

	url: async ({}, use) => {
		const server = http.createServer((_req, res) => {
			res.setHeader("content-type", "text/html");
			res.end(TEST_PAGE);
		});
		await new Promise<void>((resolve) => server.listen(0, resolve));
		await use(`http://localhost:${(server.address() as AddressInfo).port}/`);
		server.close();
	},

	extension: async ({ scale }, use) => {
		const profile = fs.mkdtempSync(path.join(os.tmpdir(), "captgrab-"));
		const context = await chromium.launchPersistentContext(profile, {
			channel: "chromium",
			headless: true,
			viewport: null,
			acceptDownloads: true,
			args: [
				"--window-size=1000,700",
				`--force-device-scale-factor=${scale}`,
				`--disable-extensions-except=${EXTENSION}`,
				`--load-extension=${EXTENSION}`,
			],
		});
		const worker =
			context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
		await use({ context, worker });
		await context.close();
		fs.rmSync(profile, { recursive: true, force: true });
	},

	page: async ({ extension }, use) => {
		const page = await extension.context.newPage();
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

/** 拡張機能のアイコンを押して、撮影用のウィンドウを返す */
export async function clickAction(
	{ context, worker }: Fixtures["extension"],
	page: Page
): Promise<Page> {
	await page.bringToFront();
	const opened = context.waitForEvent("page");
	await worker.evaluate(async () => {
		const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
		// @ts-expect-error dispatch は型定義にないが実行時には存在する
		chrome.action.onClicked.dispatch(tab);
	});
	return opened;
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
export async function waitForShot(popup: Page, page: Page): Promise<Shot> {
	const download = await popup.waitForEvent("download");
	const file = fs.readFileSync(await download.path());
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
	return { filename: download.suggestedFilename(), ...result };
}

export const BLUE = "0,0,255";
