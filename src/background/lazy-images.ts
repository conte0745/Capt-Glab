export type LazyImageOptions = {
	/** 1画面ぶんスクロールするたびに、読み込みが始まるのを待つ時間 */
	stepMs: number;
	/** 長いページでも撮影が終わらなくならないよう、全体で待つ上限 */
	maxMs: number;
};

/**
 * 遅延読み込みの画像が写るよう、ページを下まで1画面ずつスクロールして読み込ませる。
 * 終わったら元のスクロール位置に戻す。
 * ページの DOM を見るが、ページのスクリプトとは隔離された環境で実行する。外の変数は参照できない
 */
export async function loadLazyImages({
	stepMs,
	maxMs,
}: LazyImageOptions): Promise<void> {
	const deadline = Date.now() + maxMs;
	/** 指定したミリ秒だけ待つ。上限の時刻を過ぎないように切り詰める */
	const wait = (ms: number) =>
		new Promise((resolve) =>
			setTimeout(resolve, Math.max(0, Math.min(ms, deadline - Date.now())))
		);

	// ブラウザの遅延読み込みは、スクロールしなくても属性を変えれば読み込み始める
	for (const element of document.querySelectorAll<HTMLImageElement | HTMLIFrameElement>(
		'img[loading="lazy"], iframe[loading="lazy"]'
	)) {
		element.loading = "eager";
	}

	// スクリプトで読み込むページは、画面に入ったことを検知して読み込むので、実際にスクロールする
	const scrollY = window.scrollY;
	for (
		let top = 0;
		top < document.documentElement.scrollHeight && Date.now() < deadline;
		top += innerHeight
	) {
		window.scrollTo({ top, behavior: "instant" });
		await wait(stepMs);
	}
	window.scrollTo({ top: scrollY, behavior: "instant" });

	const pending = [...document.images].filter((image) => !image.complete);
	await Promise.race([
		Promise.all(pending.map((image) => image.decode().catch(() => {}))),
		wait(maxMs),
	]);
}
