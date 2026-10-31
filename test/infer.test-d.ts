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
const pairs = <K extends Schema, V extends Schema>(key: K, value: V) => createCollection({
  name: "Pairs",
  items: [key, value],
  match: Array.isArray,
  fromItems: (items) => items,
  toItems: (v) => v,
})
expectTypeOf(pairs(String, Number)).toEqualTypeOf<Type<[string, number][]>>()
class Box<T> {
  items: T[]
  constructor(items: T[]) {
    this.items = items
  }
}
const entries = <K extends Schema, V extends Schema>(key: K, value: V) => createCollection({
  name: Box,
  items: { key, value },
  fromItems: (items) => new Box(items),
  toItems: (v) => v.items,
})
expectTypeOf(entries(String, Number)).toEqualTypeOf<Type<Box<{ key: string; value: number }>>>()
const wrapped = <V extends Schema>(value: V) => createCollection({
  name: Box,
  items: { value },
  fromItems: (items) => new Box(items),
  toItems: (v) => v.items,
})
expectTypeOf(wrapped(Date)).toEqualTypeOf<Type<Box<{ value: Date }>>>()
expectTypeOf(createCollection({ name: Box, items: Number, fromItems: (items) => new Box(items), toItems: (v) => v.items })).toEqualTypeOf<Type<Box<number>>>()
expectTypeOf(createCollection({ name: "Bag", items: [String, Boolean], match: Array.isArray, fromItems: (items) => items, toItems: (v) => v })).toEqualTypeOf<Type<[string, boolean][]>>()

class Point {
  x = 0
}
expectTypeOf(createType({ name: Point, parse: () => new Point(), stringify: (p) => String(p.x) })).toEqualTypeOf<Type<Point>>()
expectTypeOf(createType({ name: Point, match: (v) => v instanceof Point && v.x > 0, parse: () => new Point(), stringify: (p) => String(p.x) })).toEqualTypeOf<Type<Point>>()
expectTypeOf(createType({ name: "Point", match: (v) => v instanceof Point, stringify: (p) => String(p.x), parse: () => new Point() })).toEqualTypeOf<Type<Point>>()
expectTypeOf(createType({ name: "Num", match: (v) => typeof v === "number" && v > 0, parse: Number, stringify: String })).toEqualTypeOf<Type<number>>()

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

type OfficialIssue = { readonly message: string; readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined }
type OfficialResult<Output> = { readonly value: Output; readonly issues?: undefined } | { readonly issues: ReadonlyArray<OfficialIssue> }
interface OfficialStandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => OfficialResult<Output> | Promise<OfficialResult<Output>>
    readonly types?: { readonly input: Input; readonly output: Output } | undefined
  }
}
type InferOutput<T extends OfficialStandardSchemaV1> = NonNullable<T["~standard"]["types"]>["output"]
const acceptStandard = <T extends OfficialStandardSchemaV1>(schema: T): InferOutput<T> => schema as never
expectTypeOf(acceptStandard(S)).toEqualTypeOf<Expected>()
expectTypeOf(acceptStandard(JSTN.schema({ a: Number, b: optional(set(String)) }))).toEqualTypeOf<{ a: number; b?: Set<string> | undefined }>()
expectTypeOf(acceptStandard(sortedSet(Date))).toEqualTypeOf<SortedSet<Date>>()
expectTypeOf(acceptStandard(number)).toEqualTypeOf<number>()
