import { checkDepth, describeNode, describeValue, JSTNError, mismatch } from "../core/error.ts"
import { formatKey, quote } from "../core/strings.ts"
import { defineType, type Entry, type Type } from "../core/type.ts"

export type Field = { key: string; type: Type<unknown>; optional: boolean }

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function objectName(fields: readonly Field[]): string {
  if (fields.length === 0) return "{}"
  return `{ ${fields.map((f) => `${formatKey(f.key)}: ${f.optional ? `optional(${f.type.name})` : f.type.name}`).join(", ")} }`
}

function missing(key: string): string {
  return `missing required key ${quote(key)}`
}

export function objectType(fields: readonly Field[]): Type<Record<string, unknown>> {
  const name = objectName(fields)
  const known = new Set(fields.map((f) => f.key))
  return defineType(
    name,
    (value, path) => {
      checkDepth(path.length, path)
      if (!isPlainObject(value)) throw mismatch(name, describeValue(value), path)
      for (const key of Object.keys(value)) {
        if (!known.has(key)) throw new JSTNError("unknown key", [...path, key])
      }
      const entries: Entry[] = []
      for (const { key, type, optional } of fields) {
        const present = Object.hasOwn(value, key)
        if (optional && (!present || value[key] === undefined)) continue
        if (!present) throw new JSTNError(missing(key), path)
        entries.push({ key, value: type.encode(value[key], [...path, key]) })
      }
      return { kind: "object", entries }
    },
    (node, path) => {
      if (node.kind !== "object") throw mismatch(name, describeNode(node), path, node.pos)
      const byKey = new Map<string, Entry>()
      for (const entry of node.entries) {
        if (!known.has(entry.key)) throw new JSTNError("unknown key", [...path, entry.key], entry.keyPos)
        byKey.set(entry.key, entry)
      }
      const out: Record<string, unknown> = {}
      for (const { key, type, optional } of fields) {
        const entry = byKey.get(key)
        if (entry === undefined) {
          if (optional) continue
          throw new JSTNError(missing(key), path, node.pos)
        }
        const decoded = type.decode(entry.value, [...path, key])
        Object.defineProperty(out, key, { value: decoded, enumerable: true, writable: true, configurable: true })
      }
      return out
    },
  )
}
