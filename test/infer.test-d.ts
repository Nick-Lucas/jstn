import { expectTypeOf } from "vitest"
import { JSTN, array, bigint, boolean, createCollection, createType, date, map, number, optional, set, string, tuple, union } from "../src/index.ts"
import type { Infer, Optional, Schema, Type } from "../src/index.ts"
import { Money, S, SortedSet, money, sortedSet } from "./support/fixtures.ts"

expectTypeOf<Infer<typeof number>>().toEqualTypeOf<number>()
expectTypeOf<Infer<typeof string>>().toEqualTypeOf<string>()
expectTypeOf<Infer<typeof boolean>>().toEqualTypeOf<boolean>()
expectTypeOf<Infer<typeof bigint>>().toEqualTypeOf<bigint>()
expectTypeOf<Infer<typeof date>>().toEqualTypeOf<Date>()
expectTypeOf<Infer<NumberConstructor>>().toEqualTypeOf<number>()
expectTypeOf<Infer<StringConstructor>>().toEqualTypeOf<string>()
expectTypeOf<Infer<BooleanConstructor>>().toEqualTypeOf<boolean>()
expectTypeOf<Infer<BigIntConstructor>>().toEqualTypeOf<bigint>()
expectTypeOf<Infer<DateConstructor>>().toEqualTypeOf<Date>()
expectTypeOf<Infer<null>>().toEqualTypeOf<null>()
expectTypeOf(JSTN.schema(null)).toEqualTypeOf<Type<null>>()
expectTypeOf(JSTN.schema(Number)).toEqualTypeOf<Type<number>>()

const nested = JSTN.schema({ a: { b: { c: Number } }, d: String })
expectTypeOf(nested).toEqualTypeOf<Type<{ a: { b: { c: number } }; d: string }>>()

const withOptional = JSTN.schema({ req: Number, opt: optional(String), deep: optional({ x: Boolean }) })
expectTypeOf<Infer<typeof withOptional>>().toEqualTypeOf<{ req: number; opt?: string | undefined; deep?: { x: boolean } | undefined }>()

const quoted = JSTN.schema({ "key with space": Number, "": optional(null) })
expectTypeOf<Infer<typeof quoted>>().toEqualTypeOf<{ "key with space": number; ""?: null | undefined }>()

const frozenShape = { a: Number, b: { c: String } } as const
expectTypeOf<Infer<typeof frozenShape>>().toEqualTypeOf<{ a: number; b: { c: string } }>()
expectTypeOf<Infer<typeof frozenShape>>().not.toEqualTypeOf<{ readonly a: number; readonly b: { readonly c: string } }>()

expectTypeOf(tuple(Number, String)).toEqualTypeOf<Type<[number, string]>>()
expectTypeOf(tuple()).toEqualTypeOf<Type<[]>>()
expectTypeOf(tuple(tuple(Date), { a: null })).toEqualTypeOf<Type<[[Date], { a: null }]>>()

expectTypeOf(union(Number, String)).toEqualTypeOf<Type<number | string>>()
expectTypeOf(union({ a: Number }, null)).toEqualTypeOf<Type<{ a: number } | null>>()
expectTypeOf(union(union(Number, BigInt), Date)).toEqualTypeOf<Type<number | bigint | Date>>()

expectTypeOf(array(Number)).toEqualTypeOf<Type<number[]>>()
expectTypeOf(set(String)).toEqualTypeOf<Type<Set<string>>>()
expectTypeOf(map(String, BigInt)).toEqualTypeOf<Type<Map<string, bigint>>>()
expectTypeOf(map(String, set(array(Date)))).toEqualTypeOf<Type<Map<string, Set<Date[]>>>>()
expectTypeOf(array({ a: optional(Number) })).toEqualTypeOf<Type<{ a?: number | undefined }[]>>()
expectTypeOf<Infer<{}>>().toEqualTypeOf<Record<string, never>>()
expectTypeOf(JSTN.schema({})).toEqualTypeOf<Type<Record<string, never>>>()

expectTypeOf(money).toEqualTypeOf<Type<Money>>()
const explicitMoney = createType<Money>({
  name: "Money",
  match: (v) => v instanceof Money,
  stringify: (m) => m.amount,
  parse: (text) => new Money(text, "GBP"),
})
expectTypeOf(explicitMoney).toEqualTypeOf<Type<Money>>()
const inferredNumber = createType({ name: "Num", match: (v) => typeof v === "number", parse: (t) => Number(t), stringify: (n) => String(n) })
expectTypeOf(inferredNumber).toEqualTypeOf<Type<number>>()
expectTypeOf(createType({ name: "Num", match: (v) => typeof v === "number", parse: Number, stringify: String })).toEqualTypeOf<Type<number>>()
expectTypeOf(createType({ name: "Money", match: (v) => v instanceof Money, parse: (t) => new Money(t, "GBP"), stringify: String })).toEqualTypeOf<Type<Money>>()

expectTypeOf(sortedSet(Number)).toEqualTypeOf<Type<SortedSet<number>>>()
expectTypeOf(sortedSet({ a: String })).toEqualTypeOf<Type<SortedSet<{ a: string }>>>()
const pairs = createCollection("Pairs", <K extends Schema, V extends Schema>(key: K, value: V) => ({
  items: tuple(key, value),
  match: (v: unknown) => Array.isArray(v),
  toItems: (v: [Infer<K>, Infer<V>][]) => v,
  fromItems: (items: [Infer<K>, Infer<V>][]) => items,
}))
expectTypeOf(pairs(String, Number)).toEqualTypeOf<Type<[string, number][]>>()
class Box<T> {
  items: T[]
  constructor(items: T[]) {
    this.items = items
  }
}
const entries = createCollection("Entries", <K extends Schema, V extends Schema>(key: K, value: V) => ({
  items: { key, value },
  match: (v: unknown) => v instanceof Box,
  toItems: (v: Box<Infer<{ key: K; value: V }>>) => v.items,
  fromItems: (items: Infer<{ key: K; value: V }>[]) => new Box(items),
}))
expectTypeOf(entries(String, Number)).toEqualTypeOf<Type<Box<{ key: string; value: number }>>>()
const wrapped = createCollection("Wrapped", <V extends Schema>(value: V) => ({
  items: { value },
  match: (v: unknown) => v instanceof Box,
  toItems: (v: Box<Infer<{ value: V }>>) => v.items,
  fromItems: (items: Infer<{ value: V }>[]) => new Box(items),
}))
expectTypeOf(wrapped(Date)).toEqualTypeOf<Type<Box<{ value: Date }>>>()

type Expected = {
  someNum: number
  someStr: string
  someDate: Date
  someObj: { inner: boolean }
  someArr: number[]
  someTuple: [number, string]
  someUnion: number | string
  customVal: Money
  big: bigint
  tags: Set<string>
  lookup: Map<string, { a: number }>
  scores: SortedSet<number>
  nothing: null
  "key with space"?: string | undefined
}
expectTypeOf<Infer<typeof S>>().toEqualTypeOf<Expected>()
expectTypeOf(S).toEqualTypeOf<Type<Expected>>()

expectTypeOf(JSTN.parse("", S)).toEqualTypeOf<Expected>()
expectTypeOf(JSTN.parse("", { a: Number })).toEqualTypeOf<{ a: number }>()
expectTypeOf(JSTN.validate(null as unknown, S)).toEqualTypeOf<Expected>()
expectTypeOf(JSTN.parseSchema("")).toEqualTypeOf<Type<unknown>>()
expectTypeOf(JSTN.parse("", JSTN.parseSchema(""))).toEqualTypeOf<unknown>()
expectTypeOf(JSTN.stringify).returns.toEqualTypeOf<string>()

const input: unknown = null
if (JSTN.is(input, S)) expectTypeOf(input).toEqualTypeOf<Expected>()
if (JSTN.is(input, union(Number, null))) expectTypeOf(input).toEqualTypeOf<number | null>()
if (JSTN.is(input, { a: optional(Number) })) expectTypeOf(input).toEqualTypeOf<{ a?: number | undefined }>()
expectTypeOf(JSTN.validate(input, { a: optional(Number) })).toEqualTypeOf<{ a?: number | undefined }>()

const bio = "" as string | undefined
JSTN.stringify({ name: "Ada", bio }, { name: String, bio: optional(String) })
JSTN.stringify([1] as readonly number[], array(Number))
JSTN.stringify([1, "a"] as readonly [number, string], tuple(Number, String))
JSTN.stringify({ xs: [{ ys: [1] }] } as const, { xs: array({ ys: array(Number) }) })
JSTN.stringify({}, {})
export function save<T extends Schema>(value: Infer<T>, schema: T): string {
  return JSTN.stringify(value, schema)
}

expectTypeOf<Optional<number> extends Schema ? true : false>().toEqualTypeOf<false>()
expectTypeOf<MapConstructor extends Schema ? true : false>().toEqualTypeOf<false>()
expectTypeOf<SetConstructor extends Schema ? true : false>().toEqualTypeOf<false>()
expectTypeOf<ArrayConstructor extends Schema ? true : false>().toEqualTypeOf<false>()
expectTypeOf<ObjectConstructor extends Schema ? true : false>().toEqualTypeOf<false>()
expectTypeOf<[Schema] extends Parameters<typeof union> ? true : false>().toEqualTypeOf<false>()
expectTypeOf<[Schema, Schema] extends Parameters<typeof union> ? true : false>().toEqualTypeOf<true>()
expectTypeOf<[Optional<number>] extends Parameters<typeof array> ? true : false>().toEqualTypeOf<false>()
expectTypeOf<Expected>().toExtend<Parameters<typeof JSTN.stringify<typeof S>>[0]>()
expectTypeOf<{ a: number }>().toExtend<Parameters<typeof JSTN.stringify<{ a: NumberConstructor }>>[0]>()
expectTypeOf<{ a: string } extends Parameters<typeof JSTN.stringify<{ a: NumberConstructor }>>[0] ? true : false>().toEqualTypeOf<false>()
expectTypeOf<Type<number> extends Type<number | string> ? true : false>().toEqualTypeOf<true>()
expectTypeOf<Type<number | string> extends Type<number> ? true : false>().toEqualTypeOf<false>()
expectTypeOf<Type<number>>().toExtend<Type<number | string>>()
