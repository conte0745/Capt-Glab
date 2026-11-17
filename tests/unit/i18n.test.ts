// @vitest-environment jsdom
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
	LOCALES,
	formatMessage,
	formatNumber,
	initI18n,
	localeName,
	localizePage,
	t,
	tPlural,
} from "../../src/i18n";
import { i18nStub, locales, readMessages } from "./i18n-stub";

// 日本語の messages.json を正とし、ほかの言語はこれに合わせる
const BASE_LOCALE = "ja";
const PAGES = ["src/popup/index.html", "src/options/index.html", "src/viewer/index.html"];
// Intl.PluralRules が返す複数形の分類。日本語にない分類の文言は、言語ごとに足してよい
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
// 日本語では空にしている区切り文字
const EMPTY_ALLOWED = new Set(["noteSeparator"]);
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
// 中国語は漢字を使うので、日本語にしかない仮名で見分ける
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

const base = readMessages(BASE_LOCALE);
const otherLocales = locales().filter((locale) => locale !== BASE_LOCALE);

/** 複数形の分類を除いたキー */
const baseKey = (key: string) => key.replace(PLURAL_SUFFIX, "");
const placeholders = (messages: ReturnType<typeof readMessages>, key: string) =>
	Object.entries(messages[key].placeholders ?? {})
		.map(([name, { content }]) => `${name}=${content}`)
		.sort();

/** HTML ファイルを読み、表示する言語で文言を置き換えた文書を返す */
function localizedDocument(file: string, locale: string) {
	vi.stubGlobal("chrome", { i18n: i18nStub(locale) });
	const doc = new DOMParser().parseFromString(fs.readFileSync(file, "utf-8"), "text/html");
	localizePage(doc);
	return doc;
}

/** 画面に出る文字 (テキストと、読み上げや入力欄に出る属性) を集める */
function visibleTexts(doc: Document) {
	doc.querySelectorAll("style, script").forEach((element) => element.remove());
	const texts = [doc.title];
	const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		texts.push(walker.currentNode.textContent!);
	}
	for (const element of doc.querySelectorAll("*")) {
		for (const name of ["title", "aria-label", "placeholder", "alt"]) {
			const value = element.getAttribute(name);
			if (value) texts.push(value);
		}
	}
	return texts.map((text) => text.trim()).filter(Boolean);
}

describe("messages.json", () => {
	it("拡張機能の初期の言語と、日本語の文言がある", () => {
		const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf-8"));
		expect(locales()).toContain(manifest.default_locale);
		expect(locales()).toContain(BASE_LOCALE);
	});

	it("設定で選べる言語と、_locales の言語が同じ", () => {
		expect([...LOCALES].sort()).toEqual(locales().sort());
	});

	it("manifest.json で使う文言がある", () => {
		const manifest = fs.readFileSync("manifest.json", "utf-8");
		for (const [, key] of manifest.matchAll(/__MSG_(\w+)__/g)) {
			expect(base, key).toHaveProperty(key);
		}
	});

	it("HTML の data-i18n で使う文言がある", () => {
		for (const file of PAGES) {
			const html = fs.readFileSync(file, "utf-8");
			for (const [, key] of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
				expect(base, `${file}: ${key}`).toHaveProperty(key);
			}
		}
	});

	it("日本語の文言は、区切り文字のほかは空でない", () => {
		for (const [key, { message }] of Object.entries(base)) {
			if (!EMPTY_ALLOWED.has(key)) {
				expect(message, key).not.toBe("");
			}
		}
	});

	describe.each(otherLocales)("%s", (locale) => {
		const messages = readMessages(locale);

		it("lang は、Intl で使える形のフォルダ名", () => {
			expect(messages.lang.message).toBe(locale.replace("_", "-"));
			expect(() => new Intl.PluralRules(messages.lang.message)).not.toThrow();
		});

		it("日本語と同じ文言がそろっている", () => {
			const required = Object.keys(base).sort();
			const missing = required.filter((key) => !(key in messages));
			expect(missing).toEqual([]);
		});

		it("日本語にない文言は、複数形の分類だけ", () => {
			const pluralBases = new Set(
				Object.keys(base)
					.filter((key) => key.endsWith("_other"))
					.map(baseKey)
			);
			const extra = Object.keys(messages).filter((key) => !(key in base));
			for (const key of extra) {
				expect(PLURAL_SUFFIX.test(key) && pluralBases.has(baseKey(key)), key).toBe(true);
			}
		});

		it("置き換える値の名前と順番が日本語と同じ", () => {
			for (const key of Object.keys(messages)) {
				const reference = key in base ? key : `${baseKey(key)}_other`;
				expect(placeholders(messages, key), key).toEqual(placeholders(base, reference));
			}
		});

		it("文言は、区切り文字のほかは空でない", () => {
			for (const [key, { message }] of Object.entries(messages)) {
				if (!EMPTY_ALLOWED.has(key)) {
					expect(message.trim(), key).not.toBe("");
				}
			}
		});

		it.each(PAGES)("%s に日本語が残らない", (file) => {
			const japanese = locale.startsWith("zh") ? KANA : JAPANESE;
			const left = visibleTexts(localizedDocument(file, locale)).filter((text) =>
				japanese.test(text)
			);
			expect(left).toEqual([]);
		});
	});
});

describe("i18n", () => {
	it("文言に値を入れる", () => {
		vi.stubGlobal("chrome", { i18n: i18nStub("en") });
		expect(t("conditionZoom", 125)).toBe("Zoom 125%");
		expect(t("conditionPart", 2, 3)).toBe("Part 2 / 3");
	});

	it("英語では数に合わせて単数と複数を使い分ける", () => {
		vi.stubGlobal("chrome", { i18n: i18nStub("en") });
		expect(tPlural("viewerSavedAll", 1)).toBe("Saved 1 image");
		expect(tPlural("viewerSavedAll", 3)).toBe("Saved 3 images");
		expect(tPlural("viewerSplitResult", 1, "4,000")).toBe(
			"At 4,000px, this image won't be split."
		);
		expect(tPlural("viewerSplitResult", 3, "4,000")).toBe(
			"At 4,000px, this image will be split into 3 images."
		);
	});

	it("ドイツ語やフランス語でも、数に合わせて単数と複数を使い分ける", () => {
		vi.stubGlobal("chrome", { i18n: i18nStub("de") });
		expect(tPlural("viewerSavedAll", 1)).toBe("1 Bild gespeichert");
		expect(tPlural("viewerSavedAll", 2)).toBe("2 Bilder gespeichert");
		expect(formatNumber(16000)).toBe("16.000");
		vi.stubGlobal("chrome", { i18n: i18nStub("fr") });
		expect(tPlural("viewerSavedAll", 1)).toBe("1 image enregistrée");
	});

	it("日本語は数によらず同じ文言を使う", () => {
		vi.stubGlobal("chrome", { i18n: i18nStub("ja") });
		expect(tPlural("viewerSavedAll", 1)).toBe("1 枚を保存しました");
		expect(tPlural("viewerSavedAll", 3)).toBe("3 枚を保存しました");
	});

	it("数は表示している言語の書き方で書く", () => {
		vi.stubGlobal("chrome", { i18n: i18nStub("en") });
		expect(formatNumber(16000)).toBe("16,000");
	});

	it("$$ は $ にする", () => {
		expect(formatMessage({ message: "$$5 / $1" }, ["x"])).toBe("$5 / x");
	});

	it("言語の名前は、その言語自身で書く", () => {
		expect(localeName("ja")).toBe("日本語");
		expect(localeName("en")).toBe("English");
		expect(localeName("pt_BR")).toBe("português (Brasil)");
		expect(localeName("zh_TW")).toBe("中文（台灣）");
	});

	describe("設定で言語を選んだとき", () => {
		/** Chrome は日本語のまま、設定で language を選んだ状態にする */
		async function select(language: string) {
			const fetch = vi.fn(async (url: string) =>
				Response.json(readMessages(/_locales\/(\w+)\//.exec(url)![1]))
			);
			vi.stubGlobal("fetch", fetch);
			vi.stubGlobal("chrome", {
				i18n: i18nStub("ja"),
				runtime: { getURL: (path: string) => `chrome-extension://id/${path}` },
				storage: {
					local: { get: vi.fn(async () => ({ settings: { language } })) },
				},
			});
			await initI18n();
			return fetch;
		}

		it("Chrome の言語によらず、選んだ言語で表示する", async () => {
			const fetch = await select("en");
			expect(fetch).toHaveBeenCalledWith("chrome-extension://id/_locales/en/messages.json");
			expect(t("saved")).toBe("Saved");
			expect(tPlural("viewerSavedAll", 1)).toBe("Saved 1 image");
			expect(formatNumber(16000)).toBe("16,000");
			localizePage(new DOMParser().parseFromString("", "text/html"));
			expect(document.documentElement.lang).toBe("en");
		});

		it("Chrome に合わせる設定なら、読み込まずに Chrome の言語で表示する", async () => {
			const fetch = await select("auto");
			expect(fetch).not.toHaveBeenCalled();
			expect(t("saved")).toBe("保存しました");
		});

		it("用意していない言語なら、Chrome の言語で表示する", async () => {
			const fetch = await select("xx");
			expect(fetch).not.toHaveBeenCalled();
			expect(t("saved")).toBe("保存しました");
		});

		it("読み込めなければ、Chrome の言語で表示する", async () => {
			await select("en");
			vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
			vi.spyOn(console, "error").mockImplementation(() => {});
			await initI18n();
			expect(t("saved")).toBe("保存しました");
		});
	});

	it("ページの言語と文字の向きを設定する", () => {
		localizedDocument("src/options/index.html", "en");
		expect(document.documentElement.lang).toBe("en");
		expect(document.documentElement.dir).toBe("ltr");
	});
});
