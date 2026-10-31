import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const DOCS = path.resolve("docs");
const PAGES = ["index.html", "privacy-policy.html", "guide.html"];
const fileUrl = (name: string) => `file://${path.join(DOCS, name)}`;

for (const name of PAGES) {
	test.describe(name, () => {
		test("リソースの読み込みに失敗しない", async ({ page }) => {
			const failed: string[] = [];
			page.on("requestfailed", (request) => failed.push(request.url()));
			await page.goto(fileUrl(name));
			expect(failed).toEqual([]);
		});

		test("スマートフォン幅で横スクロールが出ない", async ({ page }) => {
			await page.setViewportSize({ width: 375, height: 800 });
			await page.goto(fileUrl(name));
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - innerWidth
			);
			expect(overflow).toBeLessThanOrEqual(0);
		});

		test("サイト内リンクの移動先とアンカーが存在する", async ({ page }) => {
			await page.goto(fileUrl(name));
			const hrefs = await page
				.locator("a[href]")
				.evaluateAll((links) => links.map((a) => a.getAttribute("href")!));

			for (const href of hrefs.filter((h) => !/^https?:/.test(h))) {
				const [file, hash] = href.split("#");
				const target = file === "" ? name : file === "./" ? "index.html" : file;
				expect(fs.existsSync(path.join(DOCS, target)), href).toBe(true);
				if (hash) {
					const html = fs.readFileSync(path.join(DOCS, target), "utf-8");
					expect(html, href).toContain(`id="${hash}"`);
				}
			}
		});

		test("製品名を CaptGrab で統一している", () => {
			const html = fs.readFileSync(path.join(DOCS, name), "utf-8");
			expect(html).toContain("CaptGrab");
			expect(html).not.toMatch(/Capt\s+(Glab|Grab)/);
		});
	});
}

test("カスタムドメインの設定を保っている", () => {
	expect(fs.readFileSync(path.join(DOCS, "CNAME"), "utf-8").trim()).toBe(
		"captgrab.shiftonton.net"
	);
});

test("サイトマップが全ページを公開URLで載せている", () => {
	const sitemap = fs.readFileSync(path.join(DOCS, "sitemap.xml"), "utf-8");
	const locs = [...sitemap.matchAll(/<loc>(.+?)<\/loc>/g)].map((m) => m[1]);

	expect(locs.sort()).toEqual(
		[
			"https://captgrab.shiftonton.net/",
			"https://captgrab.shiftonton.net/guide.html",
			"https://captgrab.shiftonton.net/privacy-policy.html",
		].sort()
	);
});

test("robots.txt がサイトマップを示している", () => {
	expect(fs.readFileSync(path.join(DOCS, "robots.txt"), "utf-8")).toContain(
		"Sitemap: https://captgrab.shiftonton.net/sitemap.xml"
	);
});

test("全ページのフッターに OFUSE のリンクがある", async ({ page }) => {
	for (const name of PAGES) {
		await page.goto(fileUrl(name));
		await expect(
			page.locator('.site-footer a[href="https://ofuse.me/o?uid=213935"]')
		).toHaveText("OFUSEで応援を送る");
	}
});
