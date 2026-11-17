// 画面の文言は public/_locales/<言語>/messages.json に置く。
// 日本語の messages.json を正とし、ほかの言語は同じキーを持つ(テストで確かめる)。
// 設定で言語を選んでいなければ chrome.i18n で Chrome の言語の文言を使い、
// 選んでいればその言語の messages.json を読み込んで使う
import { loadSettings } from "./settings";

/**
 * 用意している言語。_locales のフォルダを足したら、ここにも足す(テストで確かめる)。
 * 設定画面のプルダウンにこの順で並べる。日本語、英語のあとは、話者の多い言語から
 */
export const LOCALES = ["ja", "en", "zh_TW", "es", "fr", "pt_BR", "de", "ko"] as const;

// 右から左に書く言語。設定で選んだときは Chrome に向きを聞けないので、自分で決める
const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);

/** 日本語の messages.json にある文言のキー */
export type MessageKey = keyof typeof import("../public/_locales/ja/messages.json");

/** 複数形で文が変わる文言のキー。messages.json では「キー_other」などの名前で持つ */
type PluralKey = MessageKey extends infer K
	? K extends `${infer Base}_other`
		? Base
		: never
	: never;

type Messages = Record<
	string,
	{ message: string; placeholders?: Record<string, { content: string }> }
>;

/** 設定で選んだ言語の文言。Chrome の言語に合わせるときは null */
let selected: { locale: string; messages: Messages } | null = null;

/**
 * 設定で選んだ言語の文言を読み込む。文言を使う前に、画面ごと・撮影ごとに呼ぶ。
 * 読み込めなければ Chrome の言語で表示する
 */
export async function initI18n(): Promise<void> {
	const { language } = await loadSettings();
	selected = null;
	if (!(LOCALES as readonly string[]).includes(language)) {
		return;
	}
	try {
		const response = await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`));
		selected = { locale: language, messages: (await response.json()) as Messages };
	} catch (error) {
		console.error(error);
	}
}

/** 文言を返す。$1, $2 … に入る値を順に渡す */
export function t(key: MessageKey, ...substitutions: (string | number)[]): string {
	return getMessage(key, substitutions);
}

/**
 * 数に合わせて文言を返す。count は $1 として渡す。
 * 言語の複数形の分類 (one, few, many など) の文言があればそれを、なければ「_other」を使う
 */
export function tPlural(
	key: PluralKey,
	count: number,
	...substitutions: (string | number)[]
): string {
	const category = new Intl.PluralRules(uiLocale()).select(count);
	const args = [formatNumber(count), ...substitutions];
	return getMessage(`${key}_${category}`, args) || getMessage(`${key}_other`, args);
}

/** 表示している言語の書き方で数を書く (1,000 や 1.000 など) */
export function formatNumber(value: number): string {
	return value.toLocaleString(uiLocale());
}

/** 言語の名前を、その言語自身で書いて返す (日本語、English など) */
export function localeName(locale: string): string {
	// _locales のフォルダ名は pt_BR の形だが、Intl は pt-BR の形しか受け付けない
	const tag = locale.replace("_", "-");
	return new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? locale;
}

/**
 * data-i18n 属性を付けた要素の文字を、表示する言語の文言に置き換える。
 * 属性は data-i18n-title のように、属性名を後ろに付けて指定する
 */
export function localizePage(root: ParentNode = document) {
	document.documentElement.lang = uiLocale();
	document.documentElement.dir = textDirection();
	for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
		element.textContent = getMessage(element.dataset.i18n!, []);
	}
	for (const attribute of LOCALIZED_ATTRIBUTES) {
		for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
			element.setAttribute(
				attribute,
				getMessage(element.getAttribute(`data-i18n-${attribute}`)!, [])
			);
		}
	}
}

const LOCALIZED_ATTRIBUTES = ["title", "aria-label", "placeholder", "alt"];

/** 表示に使っている messages.json の言語 (ja, en など) */
function uiLocale() {
	return getMessage("lang", []) || "en";
}

/** 文字を書く向き */
function textDirection() {
	if (selected) {
		return RTL_LANGUAGES.has(selected.locale.split("_")[0]) ? "rtl" : "ltr";
	}
	return chrome.i18n.getMessage("@@bidi_dir") || "ltr";
}

/**
 * 文言を返す。見つからなければ空文字になる。
 * 日本語の区切り文字のように空文字の文言もあるので、ここでは補わず、キーの漏れはテストで防ぐ。
 * 選んだ言語にない文言を Chrome の言語で補うと、複数形の分類を取り違えるので補わない
 */
function getMessage(key: string, substitutions: (string | number)[]) {
	const values = substitutions.map(String);
	if (!selected) {
		return chrome.i18n.getMessage(key, values);
	}
	const entry = selected.messages[key];
	return entry ? formatMessage(entry, values) : "";
}

/**
 * chrome.i18n と同じ書き方で値を入れる。
 * $NAME$ を placeholders の内容に置き換え、その中の $1, $2 … を値に置き換える。$$ は $ にする
 */
export function formatMessage(entry: Messages[string], values: string[]): string {
	const placeholders = Object.fromEntries(
		Object.entries(entry.placeholders ?? {}).map(([name, { content }]) => [
			name.toLowerCase(),
			content,
		])
	);
	return entry.message
		.replace(/\$([a-z0-9_]+)\$/gi, (_, name: string) => placeholders[name.toLowerCase()] ?? "")
		.replace(/\$(\$|\d)/g, (_, token: string) =>
			token === "$" ? "$" : (values[Number(token) - 1] ?? "")
		);
}
