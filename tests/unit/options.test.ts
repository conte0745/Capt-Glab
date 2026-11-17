// @vitest-environment jsdom
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

const BODY = /<body>([\s\S]*)<\/body>/.exec(
	fs.readFileSync("src/options/index.html", "utf-8")
)![1];

async function load(
	store: Record<string, unknown> = {},
	shortcut = "Alt+Shift+S",
	syncStore: Record<string, unknown> = {},
	respond: (url: string) => Promise<Response> = async (url) =>
		Response.json(url.endsWith("/api/new-key") ? "KEY" : { paid: false })
) {
	document.body.innerHTML = BODY;
	// jsdom はダイアログを開く機能を持たない
	(document.getElementById("reset-dialog") as HTMLDialogElement).showModal = () => {};
	const create = vi.fn();
	const fetch = vi.fn(respond);
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
				remove: vi.fn(async (keys: string | string[]) => {
					for (const key of [keys].flat()) {
						delete store[key];
					}
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

	it("保存したサイズがよく使うサイズなら、開き直してもプルダウンで選ばれている", async () => {
		await load({ settings: { viewport: { mode: "custom", width: 375, height: 667 } } });

		const preset = document.getElementById("preset") as HTMLSelectElement;
		expect(preset.value).toBe("375x667");

		input("width").value = "400";
		input("width").dispatchEvent(new Event("input"));
		expect(preset.value).toBe("");

		input("width").value = "1920";
		input("height").value = "1080";
		input("height").dispatchEvent(new Event("input"));
		expect(preset.value).toBe("1920x1080");
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

	describe("初期値に戻す", () => {
		/** 画面の中の確認ダイアログで、ボタンを押したことにする */
		async function answerReset(value: "reset" | "cancel") {
			const dialog = document.getElementById("reset-dialog") as HTMLDialogElement;
			dialog.returnValue = value;
			dialog.dispatchEvent(new Event("close"));
			await settle();
		}

		it("押すと確認のダイアログを開く", async () => {
			await load();
			const showModal = vi.fn();
			(document.getElementById("reset-dialog") as HTMLDialogElement).showModal = showModal;

			document.getElementById("reset-settings")!.click();

			expect(showModal).toHaveBeenCalledTimes(1);
		});

		it("確認してから設定と連番を消し、画面も初期値に戻す。購入は残す", async () => {
			const { store, syncStore } = await load(
				{
					settings: { download: false, clipboard: true, folder: "shots", viewport: { mode: "custom", width: 375, height: 667 } },
					"payment-paid": true,
					"image-name-count": 5,
				},
				undefined,
				{ "payment-api-key": "KEY" }
			);
			document.getElementById("reset-settings")!.click();
			await answerReset("reset");

			expect(store.settings).toBeUndefined();
			expect(store["payment-paid"]).toBe(true);
			expect(store["image-name-count"]).toBeUndefined();
			expect(document.getElementById("next-name")!.textContent).toBe("screen-0001.png");
			expect(syncStore["payment-api-key"]).toBe("KEY");
			expect(input("download").checked).toBe(true);
			expect(input("folder").value).toBe("");
			expect(input("viewport-current").checked).toBe(true);
			expect(document.getElementById("saved")!.textContent).toBe("初期値に戻しました");
		});

		it("確認でキャンセルしたら何も変えない", async () => {
			const { store } = await load({ settings: { download: false, clipboard: true } });
			document.getElementById("reset-settings")!.click();
			await answerReset("cancel");

			expect(store.settings).toEqual({ download: false, clipboard: true });
			expect(input("download").checked).toBe(false);
		});
	});

	describe("有料機能", () => {
		it("未購入なら選べず、購入の案内を出す。通信もしない", async () => {
			const { fetch } = await load();

			expect(input("loadLazyImages").disabled).toBe(true);
			expect(hidden("purchase")).toBe(false);
			expect(hidden("paid-text")).toBe(true);
			expect(hidden("price")).toBe(false);
			expect(fetch).not.toHaveBeenCalled();
		});

		it("購入済みなら選べるようにし、設定を保存する", async () => {
			const { store } = await load({ "payment-paid": true });

			expect(input("loadLazyImages").disabled).toBe(false);
			expect(hidden("purchase")).toBe(true);
			expect(hidden("login-hint")).toBe(true);
			expect(hidden("paid-text")).toBe(false);
			expect(hidden("price")).toBe(true);

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

		it("購入状況が分かるまでは押せず、確認中だと表示する", async () => {
			let reply: (response: Response) => void = () => {};
			const loading = load({}, undefined, { "payment-api-key": "KEY" }, () =>
				new Promise((resolve) => (reply = resolve))
			);
			await settle();

			expect(input("loadLazyImages").disabled).toBe(true);
			expect(input("splitCount").disabled).toBe(true);
			expect(hidden("payment-checking")).toBe(false);
			expect(hidden("purchase")).toBe(true);

			reply(Response.json({ paid: false }));
			await loading;

			expect(input("loadLazyImages").disabled).toBe(true);
			expect(hidden("payment-checking")).toBe(true);
			expect(hidden("purchase")).toBe(false);
			expect(hidden("purchase-hint")).toBe(false);
		});

		it("確認が重なったら、遅れて届いた古い結果を使わない", async () => {
			const replies: ((response: Response) => void)[] = [];
			const loading = load({}, undefined, { "payment-api-key": "KEY" }, () =>
				new Promise((resolve) => replies.push(resolve))
			);
			await settle();
			document.dispatchEvent(new Event("visibilitychange"));
			await settle();

			// 後から始めた確認が先に返り、購入済みと分かる
			replies[1](Response.json({ paid: true }));
			await settle();
			replies[0](Response.json({ paid: false }));
			await loading;

			expect(input("loadLazyImages").disabled).toBe(false);
			expect(hidden("paid-text")).toBe(false);
		});

		it("購入ページから戻ると、購入が反映される", async () => {
			const { fetch } = await load({}, undefined, { "payment-api-key": "KEY" });
			expect(input("loadLazyImages").disabled).toBe(true);

			fetch.mockResolvedValue(Response.json({ paid: true }));
			document.dispatchEvent(new Event("visibilitychange"));
			await settle();

			expect(input("loadLazyImages").disabled).toBe(false);
		});

		describe("分割と複数サイズ", () => {
			const sizes = () =>
				[...document.querySelectorAll<HTMLInputElement>('input[name="multiSizes"]')];
			const check = async (value: string, checked: boolean) => {
				const size = sizes().find((size) => size.value === value)!;
				size.checked = checked;
				size.dispatchEvent(new Event("change"));
				await settle();
			};

			it("未購入なら、有料機能の欄の入力をすべて押せない", async () => {
				await load();

				for (const id of ["splitLongPages", "multiSize"]) {
					expect(input(id).disabled).toBe(true);
				}
				expect(sizes().every((size) => size.disabled)).toBe(true);
			});

			it("保存されたサイズを表示し、オンのときだけサイズの欄を出す", async () => {
				await load({
					"payment-paid": true,
					settings: { multiSize: false, multiSizes: ["1440x900"] },
				});

				expect(sizes().filter((size) => size.checked).map((size) => size.value)).toEqual([
					"1440x900",
				]);
				expect(hidden("multi-size-fields")).toBe(true);

				await change("multiSize", true);
				expect(hidden("multi-size-fields")).toBe(false);
				expect(hidden("viewport-overridden")).toBe(false);
			});

			it("選んだサイズと分割の設定を保存する", async () => {
				const { store } = await load({ "payment-paid": true });

				await change("splitLongPages", true);
				await change("multiSize", true);
				await check("1280x800", true);
				await check("768x1024", false);

				expect(store.settings).toMatchObject({
					splitLongPages: true,
					multiSize: true,
					multiSizes: ["1920x1080", "1280x800", "375x667"],
				});
			});

			it("分け方の設定を表示し、オンのときだけ出す", async () => {
				await load({
					"payment-paid": true,
					settings: { splitLongPages: false, splitMode: "count", splitCount: 4 },
				});

				expect(input("split-count").checked).toBe(true);
				expect(input("splitCount").value).toBe("4");
				expect(input("splitHeight").value).toBe("16000");
				expect(hidden("split-fields")).toBe(true);

				await change("splitLongPages", true);
				expect(hidden("split-fields")).toBe(false);
			});

			it("分け方と値を保存する", async () => {
				const { store } = await load({ "payment-paid": true });
				await change("splitLongPages", true);

				await change("splitHeight", "8000");
				expect(store.settings).toMatchObject({ splitMode: "height", splitHeight: 8000 });

				await change("splitCount", "5");
				await change("split-count", true);
				expect(store.settings).toMatchObject({ splitMode: "count", splitCount: 5 });
			});

			it.each([
				["split-height", "splitHeight", "999"],
				["split-height", "splitHeight", "16001"],
				["split-count", "splitCount", "1"],
				["split-count", "splitCount", "2.5"],
			])("%s で %s が %s なら保存せずエラーを出す", async (mode, field, value) => {
				const { store } = await load({
					"payment-paid": true,
					settings: { splitLongPages: true },
				});
				await change(mode, true);

				await change(field, value);

				expect(hidden("split-error")).toBe(false);
				expect(store.settings).not.toHaveProperty(field, Number(value));
			});

			it("選んでいない方の値が正しくなくても、保存は止めない", async () => {
				const { store } = await load({
					"payment-paid": true,
					settings: { splitLongPages: true, splitMode: "height" },
				});
				input("splitCount").value = "0";

				await change("splitHeight", "4000");

				expect(hidden("split-error")).toBe(true);
				expect(store.settings).toMatchObject({ splitHeight: 4000, splitCount: 2 });
			});

			it("サイズを1つも選ばないと保存せずエラーを出す", async () => {
				const { store } = await load({ "payment-paid": true });
				await change("multiSize", true);

				for (const size of ["1920x1080", "768x1024", "375x667"]) {
					await check(size, false);
				}

				expect(hidden("multi-size-error")).toBe(false);
				expect((store.settings as { multiSizes: string[] }).multiSizes).toHaveLength(1);
			});
		});
	});
});
