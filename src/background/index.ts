import {
	advanceImageCount,
	isValidSplitCount,
	isValidSplitHeight,
	loadSettings,
	MAX_IMAGE_SIDE,
	parseSize,
	peekImageName,
	type Settings,
} from "../settings";
import { isPaid } from "../payment";
import { loadLazyImages } from "./lazy-images";
import {
	expandScrollAreas,
	RESTORE_SCROLL_AREAS,
	type ScrollAreaResult,
} from "./scroll-areas";

// デタッチ後もインフォバーが消えるまで、タブの高さは縮んだままになる
const INFOBAR_CLOSE_MS = 6000;
const VIEWPORT_APPLY_MS = 500;
// サイズを変えるとページが組み変わるので、長めに待つ
const CUSTOM_VIEWPORT_APPLY_MS = 1000;
// 広げた領域の再レイアウトと画像の読み込み、先頭へのスクロールの反映を待つ
const SCROLL_AREA_APPLY_MS = 300;
// 遅延読み込みの画像は、画面に入ってから読み込みが始まるまで少しかかる
const LAZY_IMAGE_STEP_MS = 200;
// 長いページでも撮影が終わらなくならないよう、待つのはここまでにする
const LAZY_IMAGE_MAX_MS = 10000;
// 撮影が終わる前に戻らないよう、十分に長くする
const SCROLL_AREA_RESTORE_MS = 30000;

const detachedAt = new Map<number, number>();
const capturingTabs = new Set<number>();
const viewerImages = new Map<string, { data: string; filename: string | null }>();

chrome.runtime.onInstalled.addListener(function ({ reason }) {
	// 設定の入口を知ってもらうため、最初の1回だけ開く
	if (reason === "install") {
		void chrome.runtime.openOptionsPage();
	}
});

chrome.runtime.onConnect.addListener(function (port) {
	if (port.name !== "capture") {
		return;
	}
	port.onMessage.addListener(function (message) {
		if (message.request === "capture") {
			if (capturingTabs.has(message.tabId)) {
				port.postMessage({ type: "error", reason: "busy" });
				return;
			}
			capturingTabs.add(message.tabId);
			void handleCapture(port, message.tabId).finally(() =>
				capturingTabs.delete(message.tabId)
			);
		}
	});
});

chrome.runtime.onMessage.addListener(function (
	message,
	_sender,
	sendResponse
) {
	if (message.request === "viewer-image") {
		// 画像をメモリに残さないよう、渡したら手放す
		sendResponse(viewerImages.get(message.id) ?? null);
		viewerImages.delete(message.id);
	}
});

/** パネルから頼まれた撮影を行い、保存やコピーの結果をパネルに知らせる */
async function handleCapture(port: chrome.runtime.Port, tabId: number) {
	let connected = true;
	let onGone = () => {};
	const gone = new Promise<void>((resolve) => (onGone = resolve));
	port.onDisconnect.addListener(() => {
		connected = false;
		onGone();
	});
	const post = (message: object) => {
		if (connected) {
			port.postMessage(message);
		}
	};

	try {
		const settings = await loadSettings();
		const { shots, scaled, cut } = await captureTab(tabId, settings, () =>
			post({ type: "waiting" })
		);

		const saved = settings.download
			? await downloadImages(shots, settings)
			: { state: "off" as const };
		const filenames = saved.state === "saved" ? saved.filenames : [];

		post({
			type: "done",
			// クリップボードには1枚しか入らないので、1枚目をコピーする
			data: settings.clipboard ? shots[0].data : undefined,
			count: shots.length,
			saved: saved.state,
			scaled,
			cut,
			openTab: settings.openTab,
		});

		if (settings.openTab) {
			// タブを開くとパネルが閉じるので、コピーが終わってから開く
			if (settings.clipboard && connected) {
				const copied = new Promise<void>((resolve) =>
					port.onMessage.addListener((message) => {
						if (message.request === "copied") {
							resolve();
						}
					})
				);
				await Promise.race([copied, gone]);
			}
			for (const [index, shot] of shots.entries()) {
				await openViewer(shot.data, filenames[index] ?? null);
			}
		}
	} catch (error) {
		console.error(error);
		post({ type: "error", reason: classifyError(error) });
	}
}

/** パネルに出す案内を選べるよう、エラーを種類に分ける */
function classifyError(error: unknown): string {
	const message = String(error);
	if (/already attached/i.test(message)) {
		return "other-debugger";
	}
	if (/cannot (access|attach)/i.test(message)) {
		return "restricted";
	}
	// デバッグのバーのキャンセルやタブの移動で、撮影中に接続が切れた
	if (/not attached/i.test(message)) {
		return "detached";
	}
	return "unknown";
}

/** 撮影した1枚の画像 */
type Shot = {
	/** PNG の base64 */
	data: string;
	/** ファイル名の連番のあとに付ける、サイズや分割の番号。1枚だけなら空 */
	suffix: string;
};

type Viewport = { width: number; height: number; label: string | null };

/** デバッガで画面サイズを固定し、ページ全体を PNG で撮る。設定によっては複数枚になる */
async function captureTab(
	tabId: number,
	settings: Settings,
	onWaiting: () => void
): Promise<{ shots: Shot[]; scaled: boolean; cut: boolean }> {
	// 撮影中に通信を待たないよう、デバッガを接続する前に購入を確認する
	const paid =
		(settings.loadLazyImages || settings.splitLongPages || settings.multiSize) &&
		(await isPaid());
	const sizes = paid && settings.multiSize ? parseSizes(settings.multiSizes) : [];
	const custom = sizes.length > 0 || settings.viewport.mode === "custom";

	if (!custom) {
		const elapsed = Date.now() - (detachedAt.get(tabId) ?? 0);
		if (elapsed < INFOBAR_CLOSE_MS) {
			onWaiting();
			await sleep(INFOBAR_CLOSE_MS - elapsed);
		}
	}

	// 固定するサイズと撮影範囲の単位はズーム前の画面上の大きさなので、CSS ピクセルから換算する
	const zoom = await chrome.tabs.getZoom(tabId);
	const toViewport = ({ width, height }: { width: number; height: number }) => ({
		width: Math.round(width * zoom),
		height: Math.round(height * zoom),
	});

	let viewports: Viewport[];
	if (sizes.length > 0) {
		viewports = sizes.map((size) => ({
			...toViewport(size),
			label: `${size.width}x${size.height}`,
		}));
	} else if (custom) {
		viewports = [{ ...toViewport(settings.viewport), label: null }];
	} else {
		// デバッガ接続時のインフォバーで高さが縮む前にビューポートサイズを取得する
		const { width, height } = await chrome.tabs.get(tabId);
		if (!width || !height) {
			throw new Error("ビューポートサイズを取得できませんでした");
		}
		viewports = [{ width, height, label: null }];
	}

	const target: chrome.debugger.Debuggee = { tabId };
	await chrome.debugger.attach(target, "1.3");
	let restoreContextId: number | undefined;

	try {
		const shots: Shot[] = [];
		let scaled = false;
		let cut = false;
		let contextId: number | undefined;

		for (const [index, viewport] of viewports.entries()) {
			await chrome.debugger.sendCommand(
				target,
				"Emulation.setDeviceMetricsOverride",
				{
					width: viewport.width,
					height: viewport.height,
					deviceScaleFactor: 0,
					mobile: false,
				}
			);
			// 固定が反映される前に撮影すると 100vh の要素がページ全体まで伸びる
			await sleep(custom ? CUSTOM_VIEWPORT_APPLY_MS : VIEWPORT_APPLY_MS);

			if (contextId === undefined) {
				contextId = await createIsolatedContext(target);
				if (paid && settings.loadLazyImages) {
					await evaluate(
						target,
						contextId,
						`(${loadLazyImages})(${JSON.stringify({
							stepMs: LAZY_IMAGE_STEP_MS,
							maxMs: LAZY_IMAGE_MAX_MS,
						})})`
					).catch((error) => {
						// 読み込めなくても、読み込み済みの画像で撮影する
						console.error(error);
					});
				}
			}

			if (index > 0) {
				// 前のサイズで広げた領域を戻してから、このサイズで測り直す
				await evaluate(target, contextId, RESTORE_SCROLL_AREAS).catch(
					console.error
				);
			}
			const areas = await evaluate<ScrollAreaResult>(
				target,
				contextId,
				`(${expandScrollAreas})(${JSON.stringify({
					expandContent: settings.expandContent,
					expandMenu: settings.expandMenu,
					restoreAfterMs: SCROLL_AREA_RESTORE_MS,
				})})`
			).catch((error): ScrollAreaResult => {
				// 広げられなくても、見えている範囲は撮影する
				console.error(error);
				return { bottom: 0, contentCut: false, scrolled: false };
			});
			restoreContextId = contextId;
			// スクロールに合わせて出し入れするヘッダーなどが、先頭の状態に戻るのも待つ
			if (areas.bottom > 0 || areas.scrolled) {
				await sleep(SCROLL_AREA_APPLY_MS);
			}

			const page = await screenshotPage(
				target,
				contextId,
				zoom,
				areas.bottom,
				paid && settings.splitLongPages ? splitOption(settings) : null
			);
			for (const [part, data] of page.images.entries()) {
				const labels = [
					viewport.label,
					page.images.length > 1 ? String(part + 1) : null,
				];
				shots.push({
					data,
					suffix: labels.filter((label) => label !== null).map((label) => `-${label}`).join(""),
				});
			}
			scaled ||= page.scaled;
			cut ||= areas.contentCut;
		}

		return { shots, scaled, cut };
	} finally {
		if (restoreContextId !== undefined) {
			await evaluate(target, restoreContextId, RESTORE_SCROLL_AREAS).catch(
				console.error
			);
		}
		// デタッチするとビューポートの固定も解除される
		await chrome.debugger.detach(target).catch(console.error);
		detachedAt.set(tabId, Date.now());
	}
}

/** 設定のサイズのうち、正しいものだけを数値にして返す */
function parseSizes(sizes: string[]): { width: number; height: number }[] {
	return sizes
		.map(parseSize)
		.filter((size): size is { width: number; height: number } => size !== null);
}

/** 縦の分け方。height は画像のピクセル数 */
type Split = { mode: "height"; height: number } | { mode: "count"; count: number };

/** 設定から分け方を決める。値が正しくなければ、上限ごとに分ける */
function splitOption(settings: Settings): Split {
	if (settings.splitMode === "count" && isValidSplitCount(settings.splitCount)) {
		return { mode: "count", count: settings.splitCount };
	}
	return {
		mode: "height",
		height: isValidSplitHeight(settings.splitHeight) ? settings.splitHeight : MAX_IMAGE_SIDE,
	};
}

/**
 * 今のレイアウトでページ全体を撮る。画像の長辺が上限を超えるときは縮小するが、
 * split があれば縦は縮小せずに、その分け方で撮る
 */
async function screenshotPage(
	target: chrome.debugger.Debuggee,
	contextId: number,
	zoom: number,
	expandedBottom: number,
	split: Split | null
): Promise<{ images: string[]; scaled: boolean }> {
	const metrics = (await chrome.debugger.sendCommand(
		target,
		"Page.getLayoutMetrics"
	)) as LayoutMetrics;
	const clipWidth = Math.round(metrics.cssLayoutViewport.clientWidth * zoom);
	const clipHeight = Math.round(
		Math.max(metrics.cssContentSize.height, expandedBottom) * zoom
	);

	const devicePixelRatio = await evaluate<number>(
		target,
		contextId,
		"window.devicePixelRatio"
	);
	// devicePixelRatio にはズームも含まれるので、ズーム分を除いて画像の大きさを求める
	const imagePerClip = devicePixelRatio / zoom;
	const scale = Math.min(
		1,
		MAX_IMAGE_SIDE / ((split ? clipWidth : Math.max(clipWidth, clipHeight)) * imagePerClip)
	);
	// 撮る範囲を区切る。どの分け方でも、1枚の高さは画像の上限に収める
	const maxPartHeight = Math.floor(MAX_IMAGE_SIDE / (imagePerClip * scale));
	let partHeight = clipHeight;
	if (split?.mode === "height") {
		partHeight = Math.min(maxPartHeight, Math.floor(split.height / (imagePerClip * scale)));
	} else if (split?.mode === "count") {
		const count = Math.max(split.count, Math.ceil(clipHeight / maxPartHeight));
		partHeight = Math.ceil(clipHeight / count);
	}

	const images: string[] = [];
	for (let y = 0; y < clipHeight; y += partHeight) {
		const screenshot = (await chrome.debugger.sendCommand(
			target,
			"Page.captureScreenshot",
			{
				format: "png",
				captureBeyondViewport: true,
				clip: {
					x: 0,
					y,
					width: clipWidth,
					height: Math.min(partHeight, clipHeight - y),
					scale,
				},
			}
		)) as { data: string };
		images.push(screenshot.data);
	}
	return { images, scaled: scale < 1 };
}

/** ページのスクリプトに結果を偽装されないよう、隔離された実行環境を作る */
async function createIsolatedContext(
	target: chrome.debugger.Debuggee
): Promise<number> {
	const { frameTree } = (await chrome.debugger.sendCommand(
		target,
		"Page.getFrameTree"
	)) as { frameTree: { frame: { id: string } } };
	const { executionContextId } = (await chrome.debugger.sendCommand(
		target,
		"Page.createIsolatedWorld",
		{ frameId: frameTree.frame.id, worldName: "CaptGrab" }
	)) as { executionContextId: number };
	return executionContextId;
}

/** 隔離された実行環境で式を評価し、結果を値で返す。Promise なら終わるまで待つ。例外が出たらエラーにする */
async function evaluate<T>(
	target: chrome.debugger.Debuggee,
	contextId: number,
	expression: string
): Promise<T> {
	const { result, exceptionDetails } = (await chrome.debugger.sendCommand(
		target,
		"Runtime.evaluate",
		{ expression, contextId, returnByValue: true, awaitPromise: true }
	)) as { result: { value: T }; exceptionDetails?: { text: string } };
	if (exceptionDetails) {
		throw new Error(exceptionDetails.text);
	}
	return result.value;
}

type SaveResult =
	| { state: "saved"; filenames: string[] }
	| { state: "canceled" | "failed" };

/** 画像を設定の保存先に保存する。複数枚でも同じ連番を使い、連番は1つだけ進める */
async function downloadImages(
	shots: Shot[],
	settings: Settings
): Promise<SaveResult> {
	const base = (await peekImageName()).replace(/\.png$/, "");
	const filenames: string[] = [];

	try {
		for (const shot of shots) {
			const name = `${base}${shot.suffix}.png`;
			await chrome.downloads.download({
				url: `data:image/png;base64,${shot.data}`,
				filename: settings.folder ? `${settings.folder}/${name}` : name,
				conflictAction: "uniquify",
				saveAs: settings.askEveryTime,
			});
			filenames.push(name);
		}
		await advanceImageCount();
		return { state: "saved", filenames };
	} catch (error) {
		console.error(error);
		return { state: /cancel/i.test(String(error)) ? "canceled" : "failed" };
	}
}

/** 画像を別タブで開く。URL に入れると長すぎるので、画像はタブから取りに来させる */
async function openViewer(data: string, filename: string | null) {
	const id = crypto.randomUUID();
	viewerImages.set(id, { data, filename });
	await chrome.tabs.create({
		url: chrome.runtime.getURL(`src/viewer/index.html?id=${id}`),
	});
}

/** 指定したミリ秒だけ待つ */
function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

type LayoutMetrics = {
	cssLayoutViewport: { clientWidth: number };
	cssContentSize: { height: number };
};
