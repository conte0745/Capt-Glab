// @vitest-environment jsdom
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

const BODY = /<body>([\s\S]*)<\/body>/.exec(
	fs.readFileSync("src/options/index.html", "utf-8")
)![1];

async function load(
	store: Record<string, unknown> = {},
	shortcut = "Alt+Shift+S",
	syncStore: Record<string, unknown> = {}
) {
	document.body.innerHTML = BODY;
	const create = vi.fn();
	const fetch = vi.fn(async (url: string) =>
		Response.json(url.endsWith("/api/new-key") ? "KEY" : { paid: false })
	);
	vi.stubGlobal("fetch", fetch);
	vi.stubGlobal("chrome", {
		runtime: { getManifest: () => ({}) },
		storage: {
			sync: {
				get: vi.fn(async (key: string) => ({ [key]: syncStore[key] })),
				set: vi.fn(async (items: object) => {
					Object.assign(syncStore, items);
				}),
			},
			local: {
				get: vi.fn(async (key: string) => ({ [key]: store[key] })),
				set: vi.fn(async (items: object) => {
					Object.assign(store, items);
				}),
				remove: vi.fn(async (key: string) => {
					delete store[key];
				}),
			},
		},
		tabs: { create },
		commands: {
			getAll: vi.fn(async () => [{ name: "_execute_action", shortcut }]),
		},
	});
	vi.resetModules();
	await import("../../src/options/index");
	await settle();
	return { store, syncStore, create, fetch };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const hidden = (id: string) => document.getElementById(id)!.hidden;

async function change(id: string, value?: string | boolean) {
	const element = input(id);
	if (typeof value === "boolean") element.checked = value;
	else if (value !== undefined) element.value = value;
	element.dispatchEvent(new Event("change"));
	await settle();
}

describe("options", () => {
	it("未設定なら初期値を表示する", async () => {
		await load();

		expect(input("download").checked).toBe(true);
		expect(input("clipboard").checked).toBe(true);
		expect(input("openTab").checked).toBe(false);
		expect(input("viewport-current").checked).toBe(true);
		expect(hidden("viewport-fields")).toBe(true);
		expect(hidden("save-section")).toBe(false);
	});

	it("保存された設定を表示する", async () => {
		await load({
			settings: {
				download: false,
				folder: "a/b",
				viewport: { mode: "custom", width: 375, height: 667 },
			},
		});

		expect(input("download").checked).toBe(false);
		expect(input("folder").value).toBe("a/b");
		expect(hidden("save-section")).toBe(true);
		expect(hidden("name-section")).toBe(true);
		expect(input("viewport-custom").checked).toBe(true);
		expect(input("width").value).toBe("375");
		expect(hidden("viewport-fields")).toBe(false);
	});

	it("変更すると保存する", async () => {
		const { store } = await load();

		await change("openTab", true);

		expect(store.settings).toMatchObject({ openTab: true, download: true });
		expect(document.getElementById("saved")!.textContent).toBe("保存しました");
	});

	it("動作を1つも選ばないと保存せずエラーを出す", async () => {
		const { store } = await load();

		await change("clipboard", false);
		const before = structuredClone(store.settings);
		await change("download", false);

		expect(hidden("actions-error")).toBe(false);
		expect(store.settings).toEqual(before);

		await change("openTab", true);
		expect(hidden("actions-error")).toBe(true);
		expect(store.settings).toMatchObject({ download: false, openTab: true });
	});

	it("フォルダ名は整えて保存する", async () => {
		const { store } = await load();

		await change("folder", " /a//b/ ");

		expect(store.settings).toMatchObject({ folder: "a/b" });
		expect(input("folder").value).toBe("a/b");
	});

	it("使えないフォルダ名は保存せずエラーを出す", async () => {
		const { store } = await load();

		await change("folder", "../x");

		expect(hidden("folder-error")).toBe(false);
		expect(store.settings).toBeUndefined();
	});

	it("正しくないサイズは保存せずエラーを出す", async () => {
		const { store } = await load();

		input("viewport-custom").checked = true;
		await change("width", "10");

		expect(hidden("viewport-error")).toBe(false);
		expect(store.settings).toBeUndefined();
	});

	it("プリセットを選ぶとサイズを入れて保存する", async () => {
		const { store } = await load();

		const preset = document.getElementById("preset") as HTMLSelectElement;
		preset.value = "375x667";
		preset.dispatchEvent(new Event("change"));
		await settle();

		expect(input("viewport-custom").checked).toBe(true);
		expect(store.settings).toMatchObject({
			viewport: { mode: "custom", width: 375, height: 667 },
		});
	});

	it("現在の表示サイズに戻しても指定サイズを覚えておく", async () => {
		const { store } = await load({
			settings: { viewport: { mode: "custom", width: 375, height: 667 } },
		});

		input("viewport-current").checked = true;
		await change("viewport-current");

		expect(store.settings).toMatchObject({
			viewport: { mode: "current", width: 375, height: 667 },
		});
	});

	it("保存先のプレビューが入力に追従する", async () => {
		await load({ "image-name-count": 1 });
		const preview = () => document.getElementById("save-preview")!;
		expect(preview().textContent).toBe("保存先: ダウンロード / screen-0002.png");

		input("folder").value = " a//b ";
		input("folder").dispatchEvent(new Event("input"));
		expect(preview().textContent).toBe("保存先: ダウンロード / a/b / screen-0002.png");

		input("folder").value = "../x";
		input("folder").dispatchEvent(new Event("input"));
		expect(preview().hidden).toBe(true);
	});

	it("毎回選ぶ設定ではプレビューを隠す", async () => {
		await load();

		await change("askEveryTime", true);

		expect(document.getElementById("save-preview")!.hidden).toBe(true);
	});

	it("スクロール領域の設定を表示して保存する", async () => {
		const { store } = await load();
		expect(input("expandContent").checked).toBe(true);
		expect(input("expandMenu").checked).toBe(false);

		await change("expandContent", false);
		await change("expandMenu", true);

		expect(store.settings).toMatchObject({
			expandContent: false,
			expandMenu: true,
		});
	});

	it("次のファイル名を表示する", async () => {
		await load({ "image-name-count": 1 });
		expect(document.getElementById("next-name")!.textContent).toBe(
			"screen-0002.png"
		);

		await load();
		expect(document.getElementById("next-name")!.textContent).toBe(
			"screen-0001.png"
		);
	});

	it("リセットすると次のファイル名が戻る", async () => {
		const { store } = await load({ "image-name-count": 12 });

		document.getElementById("reset-count")!.click();
		await settle();

		expect(store["image-name-count"]).toBeUndefined();
		expect(document.getElementById("next-name")!.textContent).toBe(
			"screen-0001.png"
		);
	});

	it("実際に割り当てられているショートカットを表示する", async () => {
		await load({}, "⌥⇧S");

		expect(document.getElementById("shortcut-text")!.textContent).toContain("⌥⇧S");
	});

	it("ショートカットが未割り当てならその旨を表示する", async () => {
		await load({}, "");

		expect(document.getElementById("shortcut-text")!.textContent).toContain(
			"割り当てられていません"
		);
	});

	it("ショートカットの設定画面を開く", async () => {
		const { create } = await load();

		document.getElementById("shortcuts")!.click();

		expect(create).toHaveBeenCalledWith({ url: "chrome://extensions/shortcuts" });
	});

	describe("有料機能", () => {
		it("未購入なら選べず、購入の案内を出す。通信もしない", async () => {
			const { fetch } = await load();

			expect(input("loadLazyImages").disabled).toBe(true);
			expect(hidden("purchase")).toBe(false);
			expect(hidden("paid-text")).toBe(true);
			expect(fetch).not.toHaveBeenCalled();
		});

		it("購入済みなら選べるようにし、設定を保存する", async () => {
			const { store } = await load({ "payment-paid": true });

			expect(input("loadLazyImages").disabled).toBe(false);
			expect(hidden("purchase")).toBe(true);
			expect(hidden("login-hint")).toBe(true);
			expect(hidden("paid-text")).toBe(false);

			await change("loadLazyImages", true);
			expect(store.settings).toMatchObject({ loadLazyImages: true });
		});

		it("購入するを押すと、鍵を発行して購入ページを開く", async () => {
			const { create, syncStore } = await load();

			document.getElementById("buy")!.click();
			await settle();

			expect(syncStore["payment-api-key"]).toBe("KEY");
			expect(create).toHaveBeenCalledWith({
				url: "https://extensionpay.com/extension/captgrab/choose-plan?api_key=KEY",
			});
		});

		it("購入済みの方を押すと、引き継ぎのページを開く", async () => {
			const { create } = await load({}, undefined, { "payment-api-key": "KEY" });

			document.getElementById("login")!.click();
			await settle();

			expect(create.mock.calls[0][0].url).toContain("/reactivate?api_key=KEY");
		});

		it("購入ページを開けなければ案内を出す", async () => {
			const { fetch } = await load();
			fetch.mockRejectedValue(new Error("offline"));

			document.getElementById("buy")!.click();
			await settle();

			expect(hidden("payment-error")).toBe(false);
		});

		it("購入ページから戻ると、購入が反映される", async () => {
			const { fetch } = await load({}, undefined, { "payment-api-key": "KEY" });
			expect(input("loadLazyImages").disabled).toBe(true);

			fetch.mockResolvedValue(Response.json({ paid: true }));
			document.dispatchEvent(new Event("visibilitychange"));
			await settle();

			expect(input("loadLazyImages").disabled).toBe(false);
		});
	});
});
