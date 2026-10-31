export const RESERVED: readonly string[] = ["true", "false", "null", "NaN", "Infinity", "number", "string", "boolean", "bigint"]

export const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/y
const NEEDS_ESCAPE = /["\\\u0000-\u001f\u007f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
const SHORT_ESCAPES = new Map([
  ["\"", "\\\""],
  ["\\", "\\\\"],
  ["\b", "\\b"],
  ["\f", "\\f"],
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\t", "\\t"],
])
export const RAW_FORBIDDEN = /[()"'\\\u0000-\u001f\u007f]/

export function isIdent(text: string): boolean {
  IDENT.lastIndex = 0
  return IDENT.exec(text)?.[0] === text
}

function escapeChar(char: string): string {
  return SHORT_ESCAPES.get(char) ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
}

export function quote(text: string): string {
  return `"${text.replace(NEEDS_ESCAPE, escapeChar)}"`
}

export function formatKey(key: string): string {
  return isIdent(key) ? key : quote(key)
}

export function isRawPayload(payload: string): boolean {
  return payload !== "" && payload.isWellFormed() && !RAW_FORBIDDEN.test(payload) && !payload.startsWith(" ") && !payload.endsWith(" ")
}
