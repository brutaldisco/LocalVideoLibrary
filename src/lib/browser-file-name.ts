/**
 * Chromium's File System Access API hides directory entries whose names fail
 * its safe-path check (base::i18n::IsFilenameLegal plus reserved Windows names).
 * Those files never reach the page, and the scan reports no error.
 */

export const BROWSER_SKIPPED_NAME_CHARACTERS = String.raw`: | \ / " * ? < > ~`;

const ILLEGAL_CHARS = new Set(['"', "~", "*", "/", ":", "<", ">", "?", "\\", "|"]);

const FULLWIDTH = new Map<string, string>([
  ['"', "\uff02"],
  ["~", "\uff5e"],
  ["*", "\uff0a"],
  ["/", "\uff0f"],
  [":", "\uff1a"],
  ["<", "\uff1c"],
  [">", "\uff1e"],
  ["?", "\uff1f"],
  ["\\", "\uff3c"],
  ["|", "\uff5c"],
]);

const RESERVED_WINDOWS_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

function isNonCharacter(code: number): boolean {
  if (code >= 0xfdd0 && code <= 0xfdef) {
    return true;
  }
  const low = code & 0xffff;
  return low === 0xfffe || low === 0xffff;
}

function isHiddenOrControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return isNonCharacter(code) || /\p{Cc}|\p{Cf}/u.test(char);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return name.slice(dot + 1);
}

function isReservedWindowsName(name: string): boolean {
  const trimmed = name.replace(/[\p{White_Space}.]+$/u, "");
  const dot = trimmed.indexOf(".");
  const stem = (dot === -1 ? trimmed : trimmed.slice(0, dot)).toLowerCase();
  return RESERVED_WINDOWS_NAMES.has(stem);
}

function isShellIntegratedExtension(name: string): boolean {
  const extension = extensionOf(name);
  if (!extension) {
    return false;
  }
  const lower = extension.toLowerCase();
  return lower === "lnk" || (lower.startsWith("{") && lower.endsWith("}"));
}

function edgeReason(name: string): string | null {
  const stripped = name.startsWith(".") ? name.slice(1) : name;
  if (!stripped) {
    return "is not allowed";
  }
  const start = stripped[0] ?? "";
  const end = stripped[stripped.length - 1] ?? "";
  if (start === ".") {
    return "starts with a period";
  }
  if (/\p{White_Space}/u.test(start)) {
    return "starts with whitespace";
  }
  if (end === ".") {
    return "ends with a period";
  }
  if (/\p{White_Space}/u.test(end)) {
    return "ends with whitespace";
  }
  return null;
}

/** Why Chromium would omit this single path segment, or null when it is visible. */
export function browserFileNameBlockReason(name: string): string | null {
  if (!name || name === "." || name === "..") {
    return "is not allowed";
  }
  if (name.includes("/") || name.includes("\\")) {
    return 'contains "/"';
  }
  for (const char of name) {
    if (ILLEGAL_CHARS.has(char)) {
      return `contains "${char}"`;
    }
    if (isHiddenOrControl(char)) {
      return "contains a hidden or control character";
    }
  }
  const edge = edgeReason(name);
  if (edge) {
    return edge;
  }
  if (isReservedWindowsName(name)) {
    return "uses a reserved Windows name";
  }
  if (isShellIntegratedExtension(name)) {
    return "uses a blocked extension";
  }
  return null;
}

export function isBrowserHiddenPath(relativePath: string): boolean {
  return relativePath.split("/").some((part) => part && browserFileNameBlockReason(part));
}

export function browserPathHint(relativePath: string): string | null {
  for (const part of relativePath.split("/")) {
    if (!part) {
      continue;
    }
    const reason = browserFileNameBlockReason(part);
    if (reason) {
      return `Chrome cannot modify "${part}" because it ${reason}. Rename it to "${toBrowserSafeFileName(part)}".`;
    }
  }
  return null;
}

export function browserEntryHint(entry: {
  name: string;
  folderPath: string;
}): string | null {
  const nameReason = browserFileNameBlockReason(entry.name);
  if (nameReason) {
    return `Chrome cannot modify "${entry.name}" because it ${nameReason}. Rename it to "${toBrowserSafeFileName(entry.name)}".`;
  }
  return browserPathHint(entry.folderPath);
}

/** A name Chromium will list. Visible names are returned unchanged. */
export function toBrowserSafeFileName(name: string): string {
  if (!browserFileNameBlockReason(name)) {
    return name;
  }

  let safe = "";
  for (const char of name) {
    const replacement = FULLWIDTH.get(char);
    if (replacement) {
      safe += replacement;
      continue;
    }
    if (isHiddenOrControl(char)) {
      safe += "_";
      continue;
    }
    safe += char;
  }

  safe = safe.replace(/[\p{White_Space}.]+$/gu, "").replace(/^[\p{White_Space}]+/gu, "");
  while (safe.startsWith("..")) {
    safe = safe.slice(1);
  }
  if (isReservedWindowsName(safe)) {
    safe = `_${safe}`;
  }
  if (isShellIntegratedExtension(safe)) {
    const extension = extensionOf(safe);
    safe = `${safe.slice(0, safe.length - extension.length)}download`;
  }
  if (!safe || browserFileNameBlockReason(safe)) {
    return "video_safe";
  }
  return safe;
}
