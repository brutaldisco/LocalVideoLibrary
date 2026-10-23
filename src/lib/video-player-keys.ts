export type VideoPlayerKeyAction =
  | "close"
  | "next"
  | "prev"
  | "snapshot"
  | "toggle";

function isTypingInputType(type: string): boolean {
  return (
    type !== "range" &&
    type !== "button" &&
    type !== "submit" &&
    type !== "reset" &&
    type !== "checkbox" &&
    type !== "radio" &&
    type !== "file" &&
    type !== "hidden" &&
    type !== "image"
  );
}

/**
 * プレーヤーのショートカットを抑止する「文字入力中」か。
 * ネイティブ動画のシークバーは `input[type=range]` なので、ここには含めない。
 */
export function isVideoPlayerTypingTarget(target: unknown): boolean {
  if (target == null || typeof target !== "object") {
    return false;
  }
  const el = target as {
    isContentEditable?: boolean;
    nodeName?: string;
    tagName?: string;
    type?: string;
    closest?: (selector: string) => unknown;
  };
  if (el.isContentEditable) {
    return true;
  }
  const name = String(el.tagName ?? el.nodeName ?? "").toUpperCase();
  if (name === "TEXTAREA" || name === "SELECT") {
    return true;
  }
  if (name === "INPUT") {
    return isTypingInputType(String(el.type ?? "text"));
  }
  const nested = el.closest?.(
    "textarea, select, input, [contenteditable='true']",
  );
  if (nested && nested !== target) {
    return isVideoPlayerTypingTarget(nested as EventTarget);
  }
  return false;
}

/** Left/right on the speed slider change the rate, not the current video. */
export function isPlaybackRateSliderTarget(target: unknown): boolean {
  if (target == null || typeof target !== "object") {
    return false;
  }
  const el = target as { closest?: (selector: string) => unknown };
  if (typeof el.closest !== "function") {
    return false;
  }
  return el.closest("[data-playback-rate-slider]") != null;
}

export function videoPlayerKeyAction(
  event: Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey">,
): VideoPlayerKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }
  if (event.key === "Escape") {
    return "close";
  }
  if (event.key === "ArrowRight") {
    return "next";
  }
  if (event.key === "ArrowLeft") {
    return "prev";
  }
  if (event.key === " " || event.code === "Space") {
    return "toggle";
  }
  if (event.key === "s" || event.key === "S") {
    return "snapshot";
  }
  return null;
}
