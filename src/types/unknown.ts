import { checkDepth, describeValue, JSTNError } from "../core/error.ts"
import { identifierFor, quote } from "../core/strings.ts"
import { defineType, isType, type Node, type Path, type Type } from "../core/type.ts"
import { map, set } from "./collection.ts"
import { TAGGED, type Tagged } from "./custom.ts"
import { date } from "./date.ts"
import { isPlainObject } from "./object.ts"

export type Registrable = Type<any> | ((...args: any[]) => Type<any>)

type Registered = Tagged & { readonly type: Type<unknown> }

const REGISTER_HINT = " (register a type for it with JSTN.register)"

const registered: Registered[] = []
const byTag = new Map<string, Type<unknown>>()
const byName = new Map<string, Registrable>()
const sources = new Set<Registrable>()

function encode(value: unknown, path: Path): Node {
  checkDepth(path.length, path)
  switch (typeof value) {
    case "boolean": return { kind: "boolean", value }
    case "number": return { kind: "number", value }
    case "bigint": return { kind: "bigint", value }
    case "string": return { kind: "string", value }
  }
  if (value === null) return { kind: "null" }
  const entry = registered.find((candidate) => candidate.match(value))
  if (entry !== undefined) return entry.type.encode(value, path)
  if (Array.isArray(value)) return { kind: "list", tag: null, items: value.map((item, i) => encode(item, [...path, i])) }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined)
    return { kind: "object", entries: keys.map((key) => ({ key, value: encode(value[key], [...path, key]) })) }
  }
  throw new JSTNError(`cannot stringify ${describeValue(value)}${typeof value === "object" ? REGISTER_HINT : ""}`, path)
}

function decode(node: Node, path: Path): unknown {
  switch (node.kind) {
    case "null": return null
    case "boolean":
    case "number":
    case "bigint":
    case "string": return node.value
    case "object": {
      const out: Record<string, unknown> = {}
      for (const entry of node.entries) {
        Object.defineProperty(out, entry.key, { value: decode(entry.value, [...path, entry.key]), enumerable: true, writable: true, configurable: true })
      }
      return out
    }
    case "list":
      if (node.tag === null) return node.items.map((item, i) => decode(item, [...path, i]))
      return decodeTagged(node.tag, node, path)
    case "tagged": return decodeTagged(node.tag, node, path)
  }
}

function decodeTagged(tag: string, node: Node, path: Path): unknown {
  const type = byTag.get(tag)
  if (type === undefined) throw new JSTNError(`unknown tag ${quote(tag)}${REGISTER_HINT}`, path, node.pos)
  return type.decode(node, path)
}

export const unknown: Type<unknown> = defineType("unknown", encode, decode)

function typeOf(source: unknown): Type<unknown> {
  if (isType(source)) return source
  if (typeof source !== "function" || source.length === 0) throw new JSTNError(`cannot register ${describeValue(source)}: expected a custom type or collection factory`, [])
  const type: unknown = source(...Array.from({ length: source.length }, () => unknown))
  if (!isType(type)) throw new JSTNError(`cannot register ${describeValue(source)}: it did not return a type`, [])
  return type
}

function add(source: Registrable): void {
  if (sources.has(source)) return
  const type = typeOf(source)
  const tagged = TAGGED.get(type)
  if (tagged === undefined) throw new JSTNError(`cannot register ${type.name}: only createType and createCollection types have a tag`, [])
  if (byTag.has(tagged.tag)) throw new JSTNError(`tag ${quote(tagged.tag)} is already registered`, [])
  registered.unshift({ ...tagged, type })
  byTag.set(tagged.tag, type)
  byName.set(identifierFor(tagged.tag), source)
  sources.add(source)
}

export function register(...types: Registrable[]): void {
  for (const source of types) add(source)
}

export function registeredNames(): ReadonlyMap<string, Registrable> {
  return byName
}

register(date, set, map)
