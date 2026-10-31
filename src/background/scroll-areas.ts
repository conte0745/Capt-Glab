export type ScrollAreaOptions = {
	expandContent: boolean;
	expandMenu: boolean;
	/** 接続が切れて元に戻せないときに備え、この時間が経ったら自分で元に戻す */
	restoreAfterMs: number;
};

export type ScrollAreaResult = {
	/** 広げた領域の下端。fixed の要素はページの高さに含まれないので別に返す */
	bottom: number;
	/** 広げたあとも、本文に写らない部分が残っているか */
	contentCut: boolean;
};

// ページの DOM を見るが、ページのスクリプトとは隔離された環境で実行する。外の変数は参照できない
export function expandScrollAreas({
	expandContent,
	expandMenu,
	restoreAfterMs,
}: ScrollAreaOptions): ScrollAreaResult {
	const TALL_RATIO = 0.6;
	const MENU_WIDTH_RATIO = 0.35;

	const areas = [...document.querySelectorAll<HTMLElement>("body *")].filter(
		(element) => {
			const { overflowY, visibility } = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return (
				/auto|scroll/.test(overflowY) &&
				visibility !== "hidden" &&
				element.scrollHeight > element.clientHeight + 1 &&
				rect.height >= innerHeight * TALL_RATIO &&
				rect.width > 0 &&
				rect.top < innerHeight &&
				rect.bottom > 0
			);
		}
	);
	const isMenu = (element: HTMLElement) =>
		element.getBoundingClientRect().width <= innerWidth * MENU_WIDTH_RATIO;
	const menus = areas.filter(isMenu);
	const contents = areas
		.filter((element) => !isMenu(element))
		.sort((a, b) => b.scrollHeight - a.scrollHeight)
		.slice(0, 1);

	const targets = [
		...(expandContent ? contents : []),
		...(expandMenu ? menus : []),
	];

	const restores: (() => void)[] = [];
	const expanded = new Set<HTMLElement>();
	const expand = (element: HTMLElement) => {
		if (expanded.has(element)) {
			return;
		}
		expanded.add(element);
		const { style, scrollTop } = element;
		const inlineStyle = element.getAttribute("style");
		const fixedHeight = /fixed|absolute/.test(
			getComputedStyle(element).position
		);
		restores.push(() => {
			if (inlineStyle === null) {
				element.removeAttribute("style");
			} else {
				element.setAttribute("style", inlineStyle);
			}
			element.scrollTop = scrollTop;
		});
		style.setProperty("overflow", "visible", "important");
		style.setProperty("height", "auto", "important");
		style.setProperty("max-height", "none", "important");
		if (fixedHeight) {
			style.setProperty("bottom", "auto", "important");
		}
	};
	// 親の高さが固定されたままだと、子を広げてもページが伸びない
	for (const target of targets) {
		for (
			let element: HTMLElement | null = target;
			element;
			element = element.parentElement
		) {
			expand(element);
		}
	}

	const scrollY = window.scrollY;
	const restore = () => {
		clearTimeout(timer);
		restores.reverse().forEach((restoreElement) => restoreElement());
		window.scrollTo({ top: scrollY, behavior: "instant" });
		delete (window as unknown as Record<string, unknown>).__captgrabRestore;
	};
	const timer = setTimeout(restore, restoreAfterMs);
	(window as unknown as Record<string, unknown>).__captgrabRestore = restore;

	const isCut = (element: HTMLElement) =>
		element.scrollHeight > element.clientHeight + 1;

	return {
		bottom: Math.max(
			0,
			...targets.map(
				(element) => element.getBoundingClientRect().bottom + window.scrollY
			)
		),
		contentCut: contents.some(isCut),
	};
}

export const RESTORE_SCROLL_AREAS = "window.__captgrabRestore?.()";
