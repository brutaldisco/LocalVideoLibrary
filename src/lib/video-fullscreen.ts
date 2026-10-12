type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

type FullscreenVideo = HTMLVideoElement & FullscreenElement;

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

function videoElement(
  el: HTMLElement,
  video?: HTMLVideoElement | null,
): FullscreenVideo | null {
  return (video ?? el.querySelector("video")) as FullscreenVideo | null;
}

export async function requestFullscreen(
  el: HTMLElement,
  video?: HTMLVideoElement | null,
): Promise<void> {
  const target = el as FullscreenElement;
  if (el.requestFullscreen && document.fullscreenEnabled) {
    await el.requestFullscreen();
    return;
  }
  const media = videoElement(el, video);
  if (media?.webkitEnterFullscreen) {
    media.webkitEnterFullscreen();
    return;
  }
  if (target.webkitEnterFullscreen) {
    target.webkitEnterFullscreen();
    return;
  }
  target.webkitRequestFullscreen?.();
}

export async function exitFullscreen(video?: HTMLVideoElement | null): Promise<void> {
  const media = video as FullscreenVideo | null;
  if (media?.webkitDisplayingFullscreen && media.webkitExitFullscreen) {
    media.webkitExitFullscreen();
    return;
  }
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
