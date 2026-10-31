// @vitest-environment jsdom
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

const BODY = /<body>([\s\S]*)<\/body>/.exec(
	fs.readFileSync("src/options/index.html", "utf-8")
)![1];

async function load(store: Record<string, unknown> = {}) {
	document.body.innerHTML = BODY;
	const create = vi.fn();
	vi.stubGlobal("chrome", {
		storage: {
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
	});
	vi.resetModules();
	await import("../../src/options/index");
	await settle();
	return { store, create };
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
		expect(input("width").disabled).toBe(true);
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
		expect(input("folder").disabled).toBe(true);
		expect(input("viewport-custom").checked).toBe(true);
		expect(input("width").value).toBe("375");
		expect(input("width").disabled).toBe(false);
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

	it("ショートカットの設定画面を開く", async () => {
		const { create } = await load();

		document.getElementById("shortcuts")!.click();

		expect(create).toHaveBeenCalledWith({ url: "chrome://extensions/shortcuts" });
	});
});
