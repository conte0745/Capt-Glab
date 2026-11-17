import { formatNumber, initI18n, localizePage, t, tPlural } from "../i18n";
import { isPaid } from "../payment";
import {
	MAX_IMAGE_SIDE,
	MIN_SPLIT_HEIGHT,
	advanceImageCount,
	loadSettings,
	peekImageName,
	saveSettings,
} from "../settings";

const TOAST_MS = 2500;
// 目盛りの間隔の候補。画像の表示の大きさに合わせて、数値が重ならないものを選ぶ
const TICK_STEPS = [100, 200, 500, 1000, 2000, 5000];
// 目盛りの数値どうしを、画面上でこれだけ離す
const MIN_TICK_GAP = 48;
// 分ける高さは、この単位で選ぶ
const SPLIT_STEP = 100;

const element = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;

/** 撮影処理から受け取る画像。filename は撮影時に保存したときのファイル名 */
type ReceivedImage = {
	data: string;
	filename: string | null;
	suffix: string;
	/** 撮影したときの画面サイズや設定 */
	conditions: string[];
	/** 縮小した倍率。縮小していなければ 1 */
	scale: number;
};

await initI18n();
localizePage();

element("settings").addEventListener("click", () => {
	void chrome.runtime.openOptionsPage();
});

await show();

/** 撮影した画像を受け取って横に並べ、保存とコピーの操作を使えるようにする */
async function show() {
	const id = new URLSearchParams(location.search).get("id");
	const received = await receiveImages(id);
	if (!received.length) {
		element("message").hidden = false;
		return;
	}

	const images = await Promise.all(
		received.map(async (image) => {
			const response = await fetch(`data:image/png;base64,${image.data}`);
			const blob = await response.blob();
			return { ...image, blob, url: URL.createObjectURL(blob) };
		})
	);

	const slides = element("images");
	const frames: Frame[] = [];
	for (const [index, image] of images.entries()) {
		const slide = document.createElement("figure");
		const img = document.createElement("img");
		img.src = image.url;
		img.alt =
			images.length > 1
				? t("viewerImageAltPart", index + 1, images.length)
				: t("viewerImageAlt");
		const frame = createFrame(img, image.scale || 1);
		slide.append(frame.element);
		slides.append(slide);
		frames.push(frame);
	}
	slides.hidden = false;

	// 目盛りで選んだ分ける高さ。どの画像で選んでも、すべての画像に線を引く
	let splitHeight: number | null = null;
	// 購入の確認を待たずに、保存やコピーを使えるようにする
	let paid = false;
	void isPaid().then((result) => {
		paid = result;
		showSplitTool();
	});

	/** 分ける高さを変え、分かれる位置の線と案内を描き直す */
	const setSplitHeight = (height: number) => {
		splitHeight = Math.min(
			MAX_IMAGE_SIDE,
			Math.max(MIN_SPLIT_HEIGHT, Math.round(height / SPLIT_STEP) * SPLIT_STEP)
		);
		frames.forEach((frame) => frame.drawCuts(splitHeight));
		showSplitTool();
	};

	/** 表示中の画像が、選んだ高さで何枚に分かれるかを案内する */
	const showSplitTool = () => {
		const total = frames[current].fullHeight();
		element("split-text").textContent =
			splitHeight === null
				? t("viewerSplitHint")
				: total
					? tPlural("viewerSplitResult", Math.ceil(total / splitHeight), formatNumber(splitHeight))
					: t("viewerSplitResult_other", "?", formatNumber(splitHeight));
		element("apply-split").hidden = splitHeight === null || !paid;
		element("split-paid-only").hidden = splitHeight === null || paid;
	};

	for (const frame of frames) {
		frame.onPick = setSplitHeight;
		frame.getSplitHeight = () => splitHeight;
	}
	element("split-tool").hidden = false;

	// 撮影時に保存していなければ、最初に保存できたときに連番を決め、残りの画像にも使う
	let base: string | null = null;
	let current = 0;

	/**
	 * 縦にスクロールできる範囲を、表示中の画像の高さに合わせる。
	 * 画像は横に並んでいるので、合わせないと一番長い画像の高さまでスクロールできてしまう
	 */
	const fitHeight = () => {
		const height = frames[current].element.offsetHeight;
		if (height > 0) {
			slides.style.height = `${height}px`;
		}
	};
	for (const frame of frames) {
		frame.img.addEventListener("load", fitHeight);
	}
	window.addEventListener("resize", fitHeight);

	/** 表示中の画像の名前と位置、撮影したときの条件を表示する */
	const showCurrent = () => {
		const image = images[current];
		element("name").textContent = image.filename ?? t("capturedImage");
		const conditions = image.conditions ?? [];
		element("conditions").textContent = conditions.join(t("viewerConditionsSeparator"));
		element("conditions").hidden = conditions.length === 0;
		element("position").textContent = `${current + 1} / ${images.length}`;
		element<HTMLButtonElement>("prev").disabled = current === 0;
		element<HTMLButtonElement>("next").disabled = current === images.length - 1;
		fitHeight();
		showSplitTool();
	};

	// ボタンやキーで動かしている途中の行き先。着くまでは、途中で通る画像を表示中にしない
	let target: number | null = null;

	/** 指定した画像を表示する。縦は先頭から見られるようにする */
	const go = (index: number) => {
		current = Math.max(0, Math.min(images.length - 1, index));
		target = current;
		slides.scrollTo?.({ left: slides.clientWidth * current, behavior: "smooth" });
		window.scrollTo?.({ top: 0 });
		showCurrent();
	};

	/** 画像を保存する。saveAs が true なら保存先を選ばせる。成功したかを返す */
	async function save(index: number, saveAs: boolean): Promise<boolean> {
		const image = images[index];
		const name =
			image.filename ??
			`${base ?? (await peekImageName()).replace(/\.png$/, "")}${image.suffix}.png`;
		const { folder } = await loadSettings();
		try {
			await chrome.downloads.download({
				url: image.url,
				filename: folder ? `${folder}/${name}` : name,
				conflictAction: "uniquify",
				saveAs,
			});
			if (image.filename === null) {
				if (base === null) {
					base = name.slice(0, name.length - image.suffix.length - ".png".length);
					await advanceImageCount();
				}
				image.filename = name;
				showCurrent();
			}
			return true;
		} catch (error) {
			console.error(error);
			if (!/cancel/i.test(String(error))) {
				showToast(t("viewerSaveFailed"));
			}
			return false;
		}
	}

	/** 表示中の画像を保存する */
	async function saveCurrent(saveAs: boolean) {
		if (await save(current, saveAs)) {
			showToast(t("saved"));
		}
	}

	/** すべての画像を保存する。途中で失敗したら、そこでやめる */
	async function saveAll() {
		for (const index of images.keys()) {
			if (!(await save(index, false))) {
				return;
			}
		}
		showToast(tPlural("viewerSavedAll", images.length));
	}

	/** 表示中の画像をクリップボードにコピーする */
	async function copy() {
		try {
			await navigator.clipboard.write([
				new ClipboardItem({ "image/png": images[current].blob }),
			]);
			showToast(t("copied"));
		} catch (error) {
			console.error(error);
			showToast(t("viewerCopyFailed"));
		}
	}

	/** 選んだ高さを、次の撮影から使う設定にする */
	async function applySplit() {
		if (splitHeight === null) {
			return;
		}
		const settings = await loadSettings();
		await saveSettings({ ...settings, splitLongPages: true, splitMode: "height", splitHeight });
		showToast(t("viewerSplitApplied", formatNumber(splitHeight)));
	}

	element("apply-split").addEventListener("click", () => void applySplit());
	element("save").addEventListener("click", () => void saveCurrent(false));
	element("save-as").addEventListener("click", () => void saveCurrent(true));
	element("save-all").addEventListener("click", () => void saveAll());
	element("copy").addEventListener("click", () => void copy());
	element("prev").addEventListener("click", () => go(current - 1));
	element("next").addEventListener("click", () => go(current + 1));
	// トラックパッドやスクロールバーで横に動かしたときも、表示中の画像を追う
	// なめらかなスクロールの途中で表示中の画像を変えると、続けて押したときに行き先がずれるので、止まってから決める
	slides.addEventListener("scrollend", () => {
		if (slides.clientWidth === 0) {
			return;
		}
		const index = Math.round(slides.scrollLeft / slides.clientWidth);
		if (target !== null) {
			if (index === target) {
				target = null;
			}
			return;
		}
		if (index !== current) {
			current = index;
			showCurrent();
		}
	});
	// 自分で横にスクロールし始めたら、ボタンやキーでの行き先は忘れる
	for (const type of ["wheel", "pointerdown", "touchstart"]) {
		slides.addEventListener(type, () => (target = null), { passive: true });
	}

	const multiple = images.length > 1;
	element("pager").hidden = !multiple;
	element("save-all").hidden = !multiple;
	element("actions").hidden = false;
	showCurrent();

	document.addEventListener("keydown", (event) => {
		const modified = event.ctrlKey || event.metaKey;
		if (multiple && !modified && !event.altKey && !event.shiftKey) {
			if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
				event.preventDefault();
				go(current + (event.key === "ArrowRight" ? 1 : -1));
			}
			return;
		}
		if (!modified || event.altKey) {
			return;
		}
		const key = event.key.toLowerCase();
		if (key === "s") {
			event.preventDefault();
			void saveCurrent(event.shiftKey);
		} else if (key === "c" && !event.shiftKey) {
			// 文字を選択しているときは、通常のコピーを優先する
			if (!getSelection()?.toString()) {
				event.preventDefault();
				void copy();
			}
		}
	});
}

/** 撮影処理から画像を1枚ずつ受け取る。受け取れなければ空にする */
async function receiveImages(id: string | null) {
	const images: ReceivedImage[] = [];
	for (let index = 0; ; index++) {
		const response = (await chrome.runtime.sendMessage({
			request: "viewer-image",
			id,
			index,
		})) as { image: ReceivedImage; count: number } | null | undefined;
		if (!response) {
			return [];
		}
		images.push(response.image);
		if (images.length >= response.count) {
			return images;
		}
	}
}

/** 画像と、その横の目盛り、分かれる位置の線をまとめたもの */
type Frame = {
	element: HTMLElement;
	img: HTMLImageElement;
	/** 縮小せずに撮ったときの画像の高さ */
	fullHeight: () => number;
	drawCuts: (height: number | null) => void;
	onPick: (height: number) => void;
	getSplitHeight: () => number | null;
};

/**
 * 画像の横に、縮小せずに保存したときのピクセル数で目盛りを付ける。
 * 分けて保存するときは縮小しないので、縮小した画像でも分けたときの高さで選べるようにする。
 * 目盛りをドラッグすると分ける高さを選べる
 */
function createFrame(img: HTMLImageElement, scale: number): Frame {
	const fullHeight = () => Math.round(img.naturalHeight / scale);
	const element = document.createElement("div");
	element.className = "frame";
	const ruler = document.createElement("div");
	ruler.className = "ruler";
	ruler.tabIndex = 0;
	ruler.setAttribute("role", "slider");
	ruler.setAttribute("aria-label", t("viewerRulerLabel"));
	ruler.setAttribute("aria-valuemin", String(MIN_SPLIT_HEIGHT));
	ruler.setAttribute("aria-valuemax", String(MAX_IMAGE_SIDE));
	const cuts = document.createElement("div");
	cuts.className = "cuts";
	element.append(ruler, img, cuts);

	const frame: Frame = {
		element,
		img,
		fullHeight,
		onPick: () => {},
		getSplitHeight: () => null,
		drawCuts(height) {
			const lines: HTMLElement[] = [];
			const total = fullHeight();
			if (height !== null && total > 0) {
				for (let y = height; y < total; y += height) {
					const line = document.createElement("div");
					line.className = "cut";
					line.style.top = `${(y / total) * 100}%`;
					const label = document.createElement("span");
					label.textContent = `${y.toLocaleString()}px`;
					line.append(label);
					lines.push(line);
				}
				ruler.setAttribute("aria-valuenow", String(height));
			}
			cuts.replaceChildren(...lines);
		},
	};

	/** 表示の大きさに合わせて、数値が重ならない間隔で目盛りを描く */
	const drawTicks = () => {
		const total = fullHeight();
		if (!total || !img.clientHeight) {
			return;
		}
		const ratio = img.clientHeight / total;
		const step =
			TICK_STEPS.find((candidate) => candidate * ratio >= MIN_TICK_GAP) ??
			TICK_STEPS[TICK_STEPS.length - 1];
		const ticks: HTMLElement[] = [];
		const addTick = (y: number, labeled: boolean) => {
			const tick = document.createElement("div");
			tick.className = labeled ? "tick" : "tick minor";
			tick.style.top = `${(y / total) * 100}%`;
			if (labeled) {
				const label = document.createElement("span");
				label.textContent = y.toLocaleString();
				tick.append(label);
			}
			ticks.push(tick);
		};
		for (let y = 0; y < total; y += step / 2) {
			// 最後の高さの数値と重なるものは、数値を省く
			const nearEnd = (total - y) * ratio < MIN_TICK_GAP / 2;
			addTick(y, y % step === 0 && !nearEnd);
		}
		// 画像の高さが分かるよう、最後には必ず数値を付ける
		addTick(total, true);
		ruler.replaceChildren(...ticks);
	};
	img.addEventListener("load", () => {
		// 画像は画面の倍率の分だけ大きく保存されるので、そのまま並べると高 DPI の画面では拡大して見える。
		// 画像の1ピクセルを画面の1ピクセルで表示し、撮ったときと同じ大きさに見せる
		img.style.width = `${img.naturalWidth / (window.devicePixelRatio || 1)}px`;
		drawTicks();
		frame.drawCuts(frame.getSplitHeight());
	});
	if (typeof ResizeObserver !== "undefined") {
		new ResizeObserver(drawTicks).observe(img);
	}

	/** 目盛りの上で指した位置を、保存される画像のピクセル数に直して選ぶ */
	const pick = (clientY: number) => {
		const rect = img.getBoundingClientRect();
		if (rect.height > 0 && img.naturalHeight > 0) {
			frame.onPick(((clientY - rect.top) / rect.height) * fullHeight());
		}
	};
	ruler.addEventListener("pointerdown", (event) => {
		ruler.setPointerCapture?.(event.pointerId);
		pick(event.clientY);
	});
	ruler.addEventListener("pointermove", (event) => {
		if (ruler.hasPointerCapture?.(event.pointerId)) {
			pick(event.clientY);
		}
	});
	ruler.addEventListener("keydown", (event) => {
		if (event.key === "ArrowUp" || event.key === "ArrowDown") {
			event.preventDefault();
			const step = event.shiftKey ? 1000 : SPLIT_STEP;
			const height = frame.getSplitHeight() ?? MAX_IMAGE_SIDE;
			frame.onPick(height + (event.key === "ArrowDown" ? step : -step));
		}
	});
	return frame;
}

let toastTimer: ReturnType<typeof setTimeout>;

/** 操作の結果を少しのあいだ表示する */
function showToast(text: string) {
	const toast = element("toast");
	toast.textContent = text;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (toast.textContent = ""), TOAST_MS);
}

// Mac では Ctrl の代わりに Command を案内する
if (/mac/i.test(navigator.platform)) {
	document.querySelectorAll("kbd").forEach((kbd) => {
		kbd.textContent = kbd.textContent!.replace("Ctrl+Shift+", "⇧⌘").replace("Ctrl+", "⌘");
	});
}
