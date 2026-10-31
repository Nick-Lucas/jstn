import { assertTypeName, describeNode, describeValue, guard, JSTNError, mismatch } from "../core/error.ts"
import { toType } from "../core/schema.ts"
import { quote } from "../core/strings.ts"
import { defineType, type Infer, type Schema, type Type } from "../core/type.ts"
import { tuple } from "./tuple.ts"
import { isUnion } from "./union.ts"

export interface CollectionSpec<C, S extends Schema> {
  readonly items: S
  match(value: unknown): boolean
  toItems(value: C): Iterable<Infer<S>>
  fromItems(items: Infer<S>[]): C
}

type ListOptions<C, I> = {
  tag: string | null
  name: string
  item: Type<I>
  match: (value: unknown) => boolean
  toItems: (value: C) => Iterable<unknown>
  fromItems: (items: I[]) => C
}

type CollectionInfo = { readonly name: string; readonly arity: number }

const COLLECTIONS = new WeakMap<Function, CollectionInfo>()

function listType<C, I>(o: ListOptions<C, I>): Type<C> {
  return defineType(
    o.name,
    (value, path) => {
      if (!o.match(value)) throw mismatch(o.name, describeValue(value), path)
      const items = guard(() => [...o.toItems(value as C)], `cannot stringify ${o.name}`, path)
      return { kind: "list", tag: o.tag, items: items.map((item, i) => o.item.encode(item, [...path, i])) }
    },
    (node, path) => {
      if (node.kind !== "list" || node.tag !== o.tag) throw mismatch(o.name, describeNode(node), path, node.pos)
      const values = node.items.map((item, i) => o.item.decode(item, [...path, i]))
      return guard(() => o.fromItems(values), `invalid ${o.name}`, path, node.pos)
    },
  )
}

function identity<T>(value: T): T {
  return value
}

export function array<S extends Schema>(item: S): Type<Infer<S>[]> {
  const type = toType(item)
  const name = isUnion(type) ? `(${type.name})[]` : `${type.name}[]`
  return listType<Infer<S>[], Infer<S>>({ tag: null, name, item: type, match: Array.isArray, toItems: identity, fromItems: identity })
}

export function createCollection<A extends Schema[], C, S extends Schema>(
  name: string,
  define: (...args: A) => CollectionSpec<C, S>,
): (...args: A) => Type<C> {
  assertTypeName(name)
  if (define.length < 1) throw new JSTNError(`createCollection(${quote(name)}) define must declare at least one parameter`, [])
  const factory = (...args: A): Type<C> => {
    const spec = define(...args)
    return listType<C, Infer<S>>({
      tag: name,
      name: `${name}<${args.map((arg) => toType(arg).name).join(", ")}>`,
      item: toType(spec.items),
      match: (value) => spec.match(value),
      toItems: (value) => spec.toItems(value),
      fromItems: (items) => spec.fromItems(items),
    })
  }
  COLLECTIONS.set(factory, { name, arity: define.length })
  return factory
}

export function collectionInfo(fn: unknown): CollectionInfo | undefined {
  return typeof fn === "function" ? COLLECTIONS.get(fn) : undefined
}

export const set: <S extends Schema>(item: S) => Type<Set<Infer<S>>> = createCollection("Set", <S extends Schema>(item: S) => ({
  items: item,
  match: (value: unknown) => value instanceof Set,
  toItems: (value: Set<Infer<S>>) => value,
  fromItems: (items: Infer<S>[]) => {
    const out = new Set(items)
    if (out.size !== items.length) throw new Error("duplicate item")
    return out
  },
}))

export const map: <K extends Schema, V extends Schema>(key: K, value: V) => Type<Map<Infer<K>, Infer<V>>> = createCollection(
  "Map",
  <K extends Schema, V extends Schema>(key: K, value: V) => ({
    items: tuple(key, value),
    match: (v: unknown) => v instanceof Map,
    toItems: (v: Map<Infer<K>, Infer<V>>) => v.entries(),
    fromItems: (items: [Infer<K>, Infer<V>][]) => {
      const out = new Map(items)
      if (out.size !== items.length) throw new Error("duplicate key")
      return out
    },
  }),
)
