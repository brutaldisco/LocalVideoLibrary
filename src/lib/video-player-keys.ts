export type VideoPlayerKeyAction = "close" | "next" | "prev" | "toggle";

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
  return null;
}
