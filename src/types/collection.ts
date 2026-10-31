import { identifierFor } from "../core/strings.ts"
import { checkDepth, describeNode, describeValue, guard, mismatch } from "../core/error.ts"
import { toType } from "../core/schema.ts"
import { defineType, type Infer, type Schema, type Type } from "../core/type.ts"
import { resolveNamed, TAGGED, type Named } from "./custom.ts"
import { tuple } from "./tuple.ts"

export type CollectionSpec<A, I, C> = Named<unknown> & {
  readonly items: A
  fromItems(items: I[]): C
  toItems(value: NoInfer<C>): Iterable<I>
}

type InferAll<A extends readonly Schema[]> = { -readonly [K in keyof A]: Infer<A[K]> }
type ListSpec<C, I> = { match(value: unknown): boolean; toItems(value: C): Iterable<I>; fromItems(items: I[]): C }

function listType<C, I>(tag: string | null, name: string, item: Type<I>, spec: ListSpec<C, I>): Type<C> {
  return defineType(
    name,
    (value, path) => {
      checkDepth(path.length, path)
      if (!spec.match(value)) throw mismatch(name, describeValue(value), path)
      const items = guard(() => [...spec.toItems(value as C)], `cannot stringify ${name}`, path)
      return { kind: "list", tag, items: items.map((child, i) => item.encode(child, [...path, i])) }
    },
    (node, path) => {
      if (node.kind !== "list" || node.tag !== tag) throw mismatch(name, describeNode(node), path, node.pos)
      const values = node.items.map((child, i) => item.decode(child, [...path, i]))
      return guard(() => spec.fromItems(values), `invalid ${name}`, path, node.pos)
    },
  )
}

function isSchemaList(items: Schema | readonly Schema[]): items is readonly Schema[] {
  return Array.isArray(items)
}

function identity<T>(value: T): T {
  return value
}

export function array<S extends Schema>(item: S): Type<Infer<S>[]> {
  const type = toType(item)
  return listType<Infer<S>[], Infer<S>>(null, `array(${type.name})`, type, { match: Array.isArray, toItems: identity, fromItems: identity })
}

export function createCollection<const A extends readonly [Schema, ...Schema[]], C>(spec: CollectionSpec<A, InferAll<A>, C>): Type<C>
export function createCollection<S extends Schema, C>(spec: CollectionSpec<S, Infer<S>, C>): Type<C>
export function createCollection(spec: CollectionSpec<Schema | readonly Schema[], unknown, unknown>): Type<unknown> {
  const { tag, match } = resolveNamed(spec)
  const many = isSchemaList(spec.items)
  const args = (many ? spec.items : [spec.items]).map((item) => toType(item))
  const item = many ? tuple(...args) : args[0]!
  const name = `${identifierFor(tag)}(${args.map((arg) => arg.name).join(", ")})`
  const type = listType(tag, name, item, { match, toItems: (value) => spec.toItems(value), fromItems: (items) => spec.fromItems(items) })
  TAGGED.set(type, { tag, match })
  return type
}

export function set<S extends Schema>(item: S): Type<Set<Infer<S>>> {
  return createCollection({
    name: Set,
    items: item,
    fromItems: (items) => {
      const out = new Set(items)
      if (out.size !== items.length) throw new Error("duplicate item")
      return out
    },
    toItems: (value) => value,
  })
}

export function map<K extends Schema, V extends Schema>(key: K, value: V): Type<Map<Infer<K>, Infer<V>>> {
  return createCollection({
    name: Map,
    items: [key, value],
    fromItems: (entries) => {
      const out = new Map(entries)
      if (out.size !== entries.length) throw new Error("duplicate key")
      return out
    },
    toItems: (m) => m.entries(),
  })
}
