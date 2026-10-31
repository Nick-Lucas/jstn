import { formatKey, isRawPayload, quote } from "../core/strings.ts"
import type { Node } from "../core/type.ts"

const MAX_INDENT = 10

function indentOf(space: unknown): string {
  if (typeof space === "number") return " ".repeat(Math.min(MAX_INDENT, Math.max(0, Math.floor(space))))
  if (typeof space === "string") return space.slice(0, MAX_INDENT)
  return ""
}

function isScalar(node: Node): boolean {
  return node.kind !== "list" && node.kind !== "object"
}

function block(open: string, lines: readonly string[], close: string, indent: string, level: number): string {
  if (lines.length === 0) return open + close
  if (indent === "") return open + lines.join(",") + close
  const inner = indent.repeat(level + 1)
  return `${open}\n${lines.map((line) => `${inner}${line},\n`).join("")}${indent.repeat(level)}${close}`
}

function write(node: Node, indent: string, level: number): string {
  switch (node.kind) {
    case "null": return "null"
    case "boolean": return String(node.value)
    case "number": return Object.is(node.value, -0) ? "-0" : String(node.value)
    case "bigint": return `${node.value}n`
    case "string": return quote(node.value)
    case "tagged": return `${node.tag}(${isRawPayload(node.payload) ? node.payload : quote(node.payload)})`
    case "list": {
      const open = `${node.tag ?? ""}[`
      const items = node.items.map((item) => write(item, indent, level + 1))
      if (indent !== "" && node.items.every(isScalar)) return `${open}${items.join(", ")}]`
      return block(open, items, "]", indent, level)
    }
    case "object": {
      const colon = indent === "" ? ":" : ": "
      const lines = node.entries.map((entry) => formatKey(entry.key) + colon + write(entry.value, indent, level + 1))
      return block("{", lines, "}", indent, level)
    }
  }
}

export function writeData(node: Node, space?: number | string): string {
  return write(node, indentOf(space), 0)
}
