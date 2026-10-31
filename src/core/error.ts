import { RESERVED, isIdent, quote } from "./strings.ts"
import type { Node, Path, Pos } from "./type.ts"

const MAX_QUOTED = 40

export const MAX_DEPTH = 512

export class JSTNError extends Error {
  override readonly name = "JSTNError"
  readonly reason: string
  readonly path: string
  readonly line: number | undefined
  readonly column: number | undefined

  constructor(reason: string, path: Path, pos?: Pos, options?: ErrorOptions) {
    const where = formatPath(path)
    const suffix = pos === undefined ? "" : ` (line ${pos.line}, column ${pos.column})`
    super(`${where}: ${reason}${suffix}`, options)
    this.reason = reason
    this.path = where
    this.line = pos?.line
    this.column = pos?.column
  }
}

export function formatPath(path: Path): string {
  let out = "$"
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`
    else out += isIdent(key) ? `.${key}` : `[${quote(key)}]`
  }
  return out
}

function describeString(text: string): string {
  const quoted = quote(text)
  return `string ${quoted.length > MAX_QUOTED ? `${quoted.slice(0, MAX_QUOTED)}…` : quoted}`
}

function describeNumber(value: number): string {
  return `number ${Object.is(value, -0) ? "-0" : String(value)}`
}

function describeObject(value: object): string {
  if (Array.isArray(value)) return "array"
  if (value instanceof Date && Number.isNaN(value.getTime())) return "invalid Date"
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto === null || proto === Object.prototype) return "object"
  const ctor: unknown = typeof proto === "object" && "constructor" in proto ? proto.constructor : undefined
  return typeof ctor === "function" && ctor.name !== "" ? ctor.name : "object"
}

export function describeValue(value: unknown): string {
  switch (typeof value) {
    case "undefined": return "undefined"
    case "boolean": return `boolean ${value}`
    case "number": return describeNumber(value)
    case "bigint": return `bigint ${value}n`
    case "string": return describeString(value)
    case "function": return "function"
    case "symbol": return "symbol"
    case "object": return value === null ? "null" : describeObject(value)
  }
}

export function describeNode(node: Node): string {
  switch (node.kind) {
    case "null": return "null"
    case "boolean":
    case "number":
    case "bigint":
    case "string": return describeValue(node.value)
    case "tagged": return node.tag
    case "list": return node.tag ?? "array"
    case "object": return "object"
  }
}

export function mismatch(expected: string, got: string, path: Path, pos?: Pos): JSTNError {
  return new JSTNError(`expected ${expected}, got ${got}`, path, pos)
}

export function guard<R>(run: () => R, prefix: string, path: Path, pos?: Pos): R {
  try {
    return run()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new JSTNError(`${prefix}: ${message}`, path, pos, { cause })
  }
}

export function assertTypeName(name: string): void {
  if (!isIdent(name) || RESERVED.includes(name)) throw new JSTNError(`invalid type name ${quote(name)}`, [])
}

export function checkDepth(depth: number, path: Path, pos?: Pos): void {
  if (depth >= MAX_DEPTH) throw new JSTNError(`nesting deeper than ${MAX_DEPTH} levels`, path, pos)
}
