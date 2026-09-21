type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void;
  webkitEnterFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

export function getFullscreenElement(): Element | null {
  if (typeof document === "undefined") {
    return null;
  }
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function isFullscreen(el?: Element | null): boolean {
  if (el && (el as FullscreenElement).webkitDisplayingFullscreen) {
    return true;
  }
  const current = getFullscreenElement();
  if (!el) {
    return current != null;
  }
  return current === el;
}

export async function requestFullscreen(el: HTMLElement): Promise<void> {
  const target = el as FullscreenElement;
  if (el.requestFullscreen) {
    await el.requestFullscreen();
    return;
  }
  if (target.webkitEnterFullscreen) {
    target.webkitEnterFullscreen();
    return;
  }
  target.webkitRequestFullscreen?.();
}

export async function exitFullscreen(): Promise<void> {
  const doc = document as FullscreenDocument;
  if (document.exitFullscreen && getFullscreenElement()) {
    await document.exitFullscreen();
    return;
  }
  doc.webkitExitFullscreen?.();
}

export function subscribeFullscreen(listener: () => void): () => void {
  document.addEventListener("fullscreenchange", listener);
  document.addEventListener("webkitfullscreenchange", listener);
  return () => {
    document.removeEventListener("fullscreenchange", listener);
    document.removeEventListener("webkitfullscreenchange", listener);
  };
}
