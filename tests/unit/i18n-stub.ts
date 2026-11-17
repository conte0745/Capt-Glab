import fs from "node:fs";
import path from "node:path";

const LOCALES_DIR = "public/_locales";

type Messages = Record<
	string,
	{ message: string; placeholders?: Record<string, { content: string }> }
>;

/** _locales にある言語の一覧 */
export function locales(): string[] {
	return fs.readdirSync(LOCALES_DIR).filter((name) =>
		fs.existsSync(path.join(LOCALES_DIR, name, "messages.json"))
	);
}

/** その言語の messages.json を読む */
export function readMessages(locale: string): Messages {
	return JSON.parse(
		fs.readFileSync(path.join(LOCALES_DIR, locale, "messages.json"), "utf-8")
	) as Messages;
}

/**
 * chrome.i18n の代わり。Chrome と同じく、$NAME$ を placeholders の内容に、
 * その中の $1, $2 … を渡した値に置き換える。初期値は日本語で表示する
 */
export function i18nStub(locale = "ja") {
	const messages = readMessages(locale);
	return {
		getMessage(key: string, substitutions: string | string[] = []) {
			if (key === "@@bidi_dir") {
				return "ltr";
			}
			const entry = messages[key];
			if (!entry) {
				return "";
			}
			const values = [substitutions].flat();
			return entry.message
				.replace(/\$([a-z0-9_]+)\$/gi, (_, name: string) => {
					const placeholder = entry.placeholders?.[name.toLowerCase()];
					return placeholder?.content ?? "";
				})
				.replace(/\$(\d)/g, (_, index: string) => values[Number(index) - 1] ?? "");
		},
		getUILanguage: () => locale,
	};
}
