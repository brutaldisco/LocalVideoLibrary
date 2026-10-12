export function prefersCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const agent = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(agent)) {
    return true;
  }
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}
