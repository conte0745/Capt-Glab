// @vitest-environment jsdom
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

const BODY = /<body>([\s\S]*)<\/body>/.exec(
	fs.readFileSync("src/viewer/index.html", "utf-8")
)![1];
const BLOB = new Blob(["png"], { type: "image/png" });

// 前のテストのキー入力の登録を残さない
let removeKeydown = () => {};

async function load(
	result: object | null,
	options: { folder?: string; platform?: string; paid?: boolean } = {}
) {
	document.body.replaceWith(document.createElement("body"));
	document.body.innerHTML = BODY;
	history.replaceState(null, "", "/?id=abc");

	const store: Record<string, unknown> = {
		settings: { folder: options.folder ?? "" },
		"payment-paid": options.paid ?? false,
	};
	const images = result as unknown[] | null;
	const sendMessage = vi.fn(async ({ index }: { index: number }) =>
		images?.[index] ? { image: images[index], count: images.length } : null
	);
	const openOptionsPage = vi.fn();
	const download = vi.fn(async () => 1);
	vi.stubGlobal("chrome", {
		runtime: { sendMessage, openOptionsPage },
		downloads: { download },
		storage: {
			local: {
				get: vi.fn(async (key: string) => ({ [key]: store[key] })),
				set: vi.fn(async (items: object) => {
					Object.assign(store, items);
				}),
			},
			sync: { get: vi.fn(async () => ({})) },
		},
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ blob: async () => BLOB }))
	);
	vi.stubGlobal(
		"ClipboardItem",
		class {
			constructor(public items: Record<string, Blob>) {}
		}
	);
	const write = vi.fn(async () => {});
	vi.stubGlobal("navigator", {
		clipboard: { write },
		platform: options.platform ?? "Win32",
	});
	URL.createObjectURL = vi.fn(() => "blob:image");
	vi.spyOn(console, "error").mockImplementation(() => {});

	removeKeydown();
	const add = vi.spyOn(document, "addEventListener");
	vi.resetModules();
	await import("../../src/viewer/index");
	await vi.waitFor(() => {
		const shown =
			!document.getElementById("images")!.hidden ||
			!document.getElementById("message")!.hidden;
		expect(shown).toBe(true);
	});
	const listeners = add.mock.calls.filter(([type]) => type === "keydown");
	removeKeydown = () =>
		listeners.forEach(([type, listener]) =>
			document.removeEventListener(type, listener as EventListener)
		);
	add.mockRestore();
	return { sendMessage, openOptionsPage, download, write, store };
}

const IMAGE = [
	{
		data: "BASE64",
		filename: "screen-0001.png",
		suffix: "",
		conditions: ["画面 1280×800"],
		scale: 1,
	},
];
const UNSAVED = [{ data: "BASE64", filename: null, suffix: "" }];

function press(init: KeyboardEventInit) {
	const event = new KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		...init,
	});
	document.dispatchEvent(event);
	return event;
}

const settle = () => new Promise((resolve) => setTimeout(resolve));
const toast = () => document.getElementById("toast")!.textContent;

describe("viewer", () => {
	it("URLのIDで画像を受け取って表示する", async () => {
		const { sendMessage } = await load(IMAGE);

		expect(sendMessage).toHaveBeenCalledWith({
			request: "viewer-image",
			id: "abc",
			index: 0,
		});
		expect(document.querySelector<HTMLImageElement>("#images img")!.src).toBe(
			"blob:image"
		);
		expect(document.getElementById("actions")!.hidden).toBe(false);
		expect(document.getElementById("name")!.textContent).toBe("screen-0001.png");
	});

	it("設定ボタンで設定画面を開く", async () => {
		const { openOptionsPage } = await load(null);

		document.getElementById("settings")!.click();

		expect(openOptionsPage).toHaveBeenCalledTimes(1);
	});

	it("画像がなければ案内を出し、操作を出さない", async () => {
		await load(null);

		expect(document.getElementById("message")!.hidden).toBe(false);
		expect(document.getElementById("images")!.hidden).toBe(true);
		expect(document.getElementById("actions")!.hidden).toBe(true);
	});

	it("画像がなければショートカットは何もしない", async () => {
		const { download, write } = await load(null);

		const event = press({ key: "s", ctrlKey: true });
		press({ key: "c", ctrlKey: true });
		await settle();

		expect(event.defaultPrevented).toBe(false);
		expect(download).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	});

	describe("保存", () => {
		it.each([{ ctrlKey: true }, { metaKey: true }])(
			"%j + S で確認なしで保存する",
			async (modifier) => {
				const { download } = await load(IMAGE);

				const event = press({ key: "s", ...modifier });
				await settle();

				expect(event.defaultPrevented).toBe(true);
				expect(download).toHaveBeenCalledWith({
					url: "blob:image",
					filename: "screen-0001.png",
					conflictAction: "uniquify",
					saveAs: false,
				});
				expect(toast()).toBe("保存しました");
			}
		);

		it("Ctrl+Shift+S で別名で保存する", async () => {
			const { download } = await load(IMAGE);

			press({ key: "S", ctrlKey: true, shiftKey: true });
			await settle();

			expect(download).toHaveBeenCalledWith(
				expect.objectContaining({ saveAs: true })
			);
		});

		it("設定のフォルダに保存する", async () => {
			const { download } = await load(IMAGE, { folder: "a/b" });

			press({ key: "s", ctrlKey: true });
			await settle();

			expect(download).toHaveBeenCalledWith(
				expect.objectContaining({ filename: "a/b/screen-0001.png" })
			);
		});

		it("未保存の画像は最初の保存で連番を決め、同じ名前を使い続ける", async () => {
			const { download, store } = await load(UNSAVED);
			store["image-name-count"] = 4;

			press({ key: "s", ctrlKey: true });
			await settle();
			press({ key: "s", ctrlKey: true });
			await settle();

			const names = download.mock.calls.map(
				(call) => (call as unknown as [{ filename: string }])[0].filename
			);
			expect(names).toEqual(["screen-0005.png", "screen-0005.png"]);
			expect(store["image-name-count"]).toBe(5);
			expect(document.getElementById("name")!.textContent).toBe("screen-0005.png");
		});

		it("キャンセルしたら連番を進めず、名前も決めない", async () => {
			const { download, store } = await load(UNSAVED);
			store["image-name-count"] = 4;
			download.mockRejectedValue(new Error("Download canceled by the user"));

			press({ key: "s", ctrlKey: true, shiftKey: true });
			await settle();

			expect(store["image-name-count"]).toBe(4);
			expect(document.getElementById("name")!.textContent).toBe("撮影した画像");
		});

		it("ボタンでも保存と別名で保存ができる", async () => {
			const { download } = await load(IMAGE);

			document.getElementById("save")!.click();
			await settle();
			document.getElementById("save-as")!.click();
			await settle();

			expect(download).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({ saveAs: false })
			);
			expect(download).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ saveAs: true })
			);
		});

		it("失敗したら知らせる", async () => {
			const { download } = await load(IMAGE);
			download.mockRejectedValue(new Error("Invalid filename"));

			press({ key: "s", ctrlKey: true });
			await settle();

			expect(toast()).toBe("保存できませんでした");
		});

		it("別名で保存のキャンセルでは何も表示しない", async () => {
			const { download } = await load(IMAGE);
			download.mockRejectedValue(new Error("Download canceled by the user"));

			press({ key: "s", ctrlKey: true, shiftKey: true });
			await settle();

			expect(toast()).toBe("");
		});
	});

	describe("コピー", () => {
		it.each([{ ctrlKey: true }, { metaKey: true }])(
			"%j + C で画像をコピーする",
			async (modifier) => {
				const { write } = await load(IMAGE);

				const event = press({ key: "c", ...modifier });
				await settle();

				expect(event.defaultPrevented).toBe(true);
				const [[[item]]] = write.mock.calls as unknown as [
					[[{ items: object }]],
				];
				expect(item.items).toEqual({ "image/png": BLOB });
				expect(toast()).toBe("コピーしました");
			}
		);

		it("文字を選択しているときは通常のコピーに任せる", async () => {
			const { write } = await load(IMAGE);
			getSelection()!.selectAllChildren(document.getElementById("name")!);

			const event = press({ key: "c", ctrlKey: true });
			await settle();
			getSelection()!.removeAllRanges();

			expect(event.defaultPrevented).toBe(false);
			expect(write).not.toHaveBeenCalled();
		});

		it("失敗したら知らせる", async () => {
			const { write } = await load(IMAGE);
			write.mockRejectedValue(new Error("not focused"));

			press({ key: "c", ctrlKey: true });
			await settle();

			expect(toast()).toBe("コピーできませんでした");
		});
	});

	it("他のキーには反応しない", async () => {
		const { download, write } = await load(IMAGE);

		const events = [
			press({ key: "s" }),
			press({ key: "c" }),
			press({ key: "s", ctrlKey: true, altKey: true }),
			press({ key: "c", ctrlKey: true, shiftKey: true }),
			press({ key: "p", ctrlKey: true }),
		];
		await settle();

		expect(events.every((event) => !event.defaultPrevented)).toBe(true);
		expect(download).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	});

	it("キーの表示を OS に合わせる", async () => {
		await load(IMAGE, { platform: "MacIntel" });
		expect(document.getElementById("save-as")!.textContent).toContain("⇧⌘S");

		await load(IMAGE, { platform: "Win32" });
		expect(document.getElementById("save-as")!.textContent).toContain("Ctrl+Shift+S");
	});

	describe("複数の画像", () => {
		const TWO = [
			{ data: "A", filename: "screen-0001-1.png", suffix: "-1" },
			{ data: "B", filename: "screen-0001-2.png", suffix: "-2" },
		];
		const text = (id: string) => document.getElementById(id)!.textContent;
		const disabled = (id: string) =>
			(document.getElementById(id) as HTMLButtonElement).disabled;

		it("メッセージの大きさの上限を超えないよう、1枚ずつ受け取る", async () => {
			const { sendMessage } = await load(TWO);

			expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
				{ request: "viewer-image", id: "abc", index: 0 },
				{ request: "viewer-image", id: "abc", index: 1 },
			]);
		});

		it("表示中の画像を撮ったときの条件を出す", async () => {
			await load([
				{ ...TWO[0], conditions: ["画面 1920×1080", "遅延読み込みの画像も写す"] },
				{ ...TWO[1], conditions: ["画面 375×667"] },
			]);

			expect(text("conditions")).toBe("画面 1920×1080 ・ 遅延読み込みの画像も写す");
			document.getElementById("next")!.click();
			expect(text("conditions")).toBe("画面 375×667");
		});

		it("縦にスクロールできる範囲を、表示中の画像の高さに合わせる", async () => {
			await load(TWO);
			const frames = document.querySelectorAll<HTMLElement>(".frame");
			Object.defineProperty(frames[0], "offsetHeight", { value: 800 });
			Object.defineProperty(frames[1], "offsetHeight", { value: 5000 });
			const slides = document.getElementById("images")!;

			document.querySelectorAll("img")[0].dispatchEvent(new Event("load"));
			expect(slides.style.height).toBe("800px");

			document.getElementById("next")!.click();
			expect(slides.style.height).toBe("5000px");
		});

		it("自分で横にスクロールして止まったら、その画像を表示中にする", async () => {
			await load(TWO);
			const slides = document.getElementById("images")!;
			Object.defineProperty(slides, "clientWidth", { value: 1000 });

			slides.scrollLeft = 1000;
			slides.dispatchEvent(new Event("scrollend"));

			expect(text("position")).toBe("2 / 2");
		});

		it("ボタンで動かしている途中に止まった位置では、表示中の画像を変えない", async () => {
			await load([...TWO, { ...TWO[1], filename: "screen-0001-3.png", suffix: "-3" }]);
			const slides = document.getElementById("images")!;
			Object.defineProperty(slides, "clientWidth", { value: 1000 });

			document.getElementById("next")!.click();
			document.getElementById("next")!.click();
			// 1枚目から3枚目へ動く途中
			slides.scrollLeft = 1000;
			slides.dispatchEvent(new Event("scrollend"));
			expect(text("position")).toBe("3 / 3");

			slides.scrollLeft = 2000;
			slides.dispatchEvent(new Event("scrollend"));
			expect(text("position")).toBe("3 / 3");
			// 着いたあとは、自分でスクロールした位置に合わせる
			slides.scrollLeft = 0;
			slides.dispatchEvent(new Event("scrollend"));
			expect(text("position")).toBe("1 / 3");
		});

		it("横に並べ、位置と表示中の画像の名前を出す", async () => {
			await load(TWO);

			expect(document.querySelectorAll("#images img")).toHaveLength(2);
			expect(document.getElementById("pager")!.hidden).toBe(false);
			expect(document.getElementById("save-all")!.hidden).toBe(false);
			expect(text("position")).toBe("1 / 2");
			expect(text("name")).toBe("screen-0001-1.png");
			expect(disabled("prev")).toBe(true);
		});

		it("ボタンと矢印キーで切り替え、端では止まる", async () => {
			await load(TWO);

			document.getElementById("next")!.click();
			expect(text("position")).toBe("2 / 2");
			expect(text("name")).toBe("screen-0001-2.png");
			expect(disabled("next")).toBe(true);

			const event = press({ key: "ArrowRight" });
			expect(event.defaultPrevented).toBe(true);
			expect(text("position")).toBe("2 / 2");

			press({ key: "ArrowLeft" });
			expect(text("position")).toBe("1 / 2");
		});

		it("保存とコピーは、表示中の画像に対して行う", async () => {
			const { download } = await load(TWO);

			press({ key: "ArrowRight" });
			press({ key: "s", ctrlKey: true });
			await settle();

			expect(download).toHaveBeenCalledWith(
				expect.objectContaining({ filename: "screen-0001-2.png" })
			);
		});

		it("未保存なら、すべて保存で同じ連番に番号を付けて保存し、連番は1つだけ進める", async () => {
			const { download, store } = await load([
				{ data: "A", filename: null, suffix: "-1920x1080" },
				{ data: "B", filename: null, suffix: "-375x667" },
			]);
			store["image-name-count"] = 4;

			document.getElementById("save-all")!.click();
			await settle();
			await settle();

			const names = download.mock.calls.map(
				(call) => (call as unknown as [{ filename: string }])[0].filename
			);
			expect(names).toEqual(["screen-0005-1920x1080.png", "screen-0005-375x667.png"]);
			expect(store["image-name-count"]).toBe(5);
			expect(toast()).toBe("2 枚を保存しました");
		});

		it("1枚目を保存したあとに2枚目を保存しても、同じ連番を使う", async () => {
			const { download, store } = await load([
				{ data: "A", filename: null, suffix: "-1" },
				{ data: "B", filename: null, suffix: "-2" },
			]);
			store["image-name-count"] = 9;

			press({ key: "s", ctrlKey: true });
			await settle();
			press({ key: "ArrowRight" });
			press({ key: "s", ctrlKey: true });
			await settle();

			const names = download.mock.calls.map(
				(call) => (call as unknown as [{ filename: string }])[0].filename
			);
			expect(names).toEqual(["screen-0010-1.png", "screen-0010-2.png"]);
			expect(store["image-name-count"]).toBe(10);
		});

		it("1枚だけなら、切り替えの表示を出さず、矢印キーにも反応しない", async () => {
			await load(IMAGE);

			expect(document.getElementById("pager")!.hidden).toBe(true);
			expect(document.getElementById("save-all")!.hidden).toBe(true);
			expect(press({ key: "ArrowRight" }).defaultPrevented).toBe(false);
		});
	});

	describe("目盛り", () => {
		/** 画像の大きさと、画面上の位置を決める */
		function layout(naturalHeight: number) {
			const img = document.querySelector<HTMLImageElement>("#images img")!;
			Object.defineProperty(img, "naturalHeight", { value: naturalHeight });
			Object.defineProperty(img, "clientHeight", { value: naturalHeight / 10 });
			img.getBoundingClientRect = () =>
				({ top: 100, height: naturalHeight / 10 }) as DOMRect;
			img.dispatchEvent(new Event("load"));
			return document.querySelector<HTMLElement>(".ruler")!;
		}
		const pointer = (ruler: HTMLElement, clientY: number) =>
			ruler.dispatchEvent(Object.assign(new Event("pointerdown"), { clientY, pointerId: 1 }));
		const cuts = () =>
			[...document.querySelectorAll(".cut")].map((cut) => cut.textContent);

		it("高 DPI の画面でも拡大せず、撮ったときと同じ大きさで表示する", async () => {
			await load(IMAGE);
			vi.stubGlobal("devicePixelRatio", 2);
			const img = document.querySelector<HTMLImageElement>("#images img")!;
			Object.defineProperty(img, "naturalWidth", { value: 750 });

			img.dispatchEvent(new Event("load"));

			expect(img.style.width).toBe("375px");
		});

		it("画像の横に、保存される画像のピクセル数で目盛りを付ける", async () => {
			await load(IMAGE);
			layout(20000);

			const labels = [...document.querySelectorAll(".tick span")].map((tick) => tick.textContent);
			// 画面上で 48px 以上空く間隔のうち、いちばん細かいもの
			expect(labels.slice(0, 3)).toEqual(["0", "500", "1,000"]);
			expect(labels.at(-1)).toBe("20,000");
		});

		it("最後には画像の高さを必ず書き、近すぎる目盛りの数値は省く", async () => {
			await load(IMAGE);
			layout(20200);

			const labels = [...document.querySelectorAll(".tick span")].map((tick) => tick.textContent);
			// 20,000 は 20,200 と画面上で 20px しか離れず、数値が重なるので省く
			expect(labels.slice(-2)).toEqual(["19,500", "20,200"]);
		});

		it("目盛りを指すと、その高さで分かれる位置に線を引き、枚数を案内する", async () => {
			await load(IMAGE, { paid: true });
			const ruler = layout(20000);

			pointer(ruler, 100 + 812);

			expect(cuts()).toEqual(["8,100px", "16,200px"]);
			expect(document.getElementById("split-text")!.textContent).toContain(
				"8,100px で分けると、この画像は 3 枚"
			);
			expect(document.getElementById("apply-split")!.hidden).toBe(false);
		});

		it("縮小した画像では、縮小せずに分けたときのピクセル数で数える", async () => {
			await load([{ ...IMAGE[0], scale: 0.5 }], { paid: true });
			const ruler = layout(16000);

			expect(document.querySelector(".tick:last-child span")!.textContent).toBe("32,000");
			pointer(ruler, 100 + 800);
			expect(cuts()).toEqual(["16,000px"]);
			expect(document.getElementById("split-text")!.textContent).toContain("2 枚");
		});

		it("高さは上限と下限に収める", async () => {
			await load(IMAGE, { paid: true });
			const ruler = layout(20000);

			pointer(ruler, 100 + 10);
			expect(cuts()[0]).toBe("1,000px");

			pointer(ruler, 100 + 1900);
			expect(cuts()).toEqual(["16,000px"]);
		});

		it("上下の矢印キーで 100px ずつ、Shift で 1000px ずつ変える", async () => {
			await load(IMAGE, { paid: true });
			const ruler = layout(20000);
			pointer(ruler, 100 + 800);

			ruler.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
			expect(cuts()[0]).toBe("8,100px");
			ruler.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true })
			);
			expect(cuts()[0]).toBe("7,100px");
		});

		it("選んだ高さを、次の撮影から使う設定にする", async () => {
			const { store } = await load(IMAGE, { paid: true });
			pointer(layout(20000), 100 + 600);

			document.getElementById("apply-split")!.click();
			await settle();

			expect(store.settings).toMatchObject({
				splitLongPages: true,
				splitMode: "height",
				splitHeight: 6000,
			});
			expect(toast()).toBe("次の撮影から 6,000px で分けます");
		});

		it("未購入なら線は引けるが、設定にはできないと伝える", async () => {
			await load(IMAGE);
			pointer(layout(20000), 100 + 600);

			expect(cuts()).toEqual(["6,000px", "12,000px", "18,000px"]);
			expect(document.getElementById("apply-split")!.hidden).toBe(true);
			expect(document.getElementById("split-paid-only")!.hidden).toBe(false);
		});
	});
});
