import { JSTN, array, bigint, createCollection, createType, map, number, optional, set, string, tuple, union } from "../../src/index.ts"
import type { Infer, Schema } from "../../src/index.ts"

export class Money {
  amount: string
  currency: string
  constructor(amount: string, currency: string) {
    this.amount = amount
    this.currency = currency
  }
}

export const money = createType({
  name: Money,
  parse: (text) => {
    const m = /^(-?\d+(?:\.\d+)?) ([A-Z]{3})$/.exec(text)
    if (!m) throw new Error("expected \"<amount> <CCY>\"")
    return new Money(m[1]!, m[2]!)
  },
  stringify: (m) => `${m.amount} ${m.currency}`,
})

export class Note {
  text: string
  constructor(text: string) {
    this.text = text
  }
}

export const note = createType({
  name: "Note",
  match: (v) => v instanceof Note,
  parse: (text) => new Note(text),
  stringify: (n) => n.text,
})

export class SortedSet<T> {
  items: T[]
  constructor(items: Iterable<T>) {
    this.items = [...items].sort()
  }
}

export const sortedSet = <S extends Schema>(item: S) => createCollection({
  name: SortedSet,
  items: item,
  fromItems: (items) => new SortedSet(items),
  toItems: (v) => v.items,
})

export const registry = { Money: money, Note: note, SortedSet: sortedSet }

export const someSchema = JSTN.schema({ inner: Boolean })

export const S = JSTN.schema({
  someNum: number,
  someStr: string,
  someDate: Date,
  someObj: someSchema,
  someArr: array(Number),
  someTuple: tuple(Number, String),
  someUnion: union(Number, String),
  customVal: money,
  big: bigint,
  tags: set(String),
  lookup: map(String, { a: number }),
  scores: sortedSet(Number),
  nothing: null,
  "key with space": optional(string),
})

export const sampleValue: Infer<typeof S> = {
  someNum: 1,
  someStr: "value",
  someDate: new Date(Date.UTC(2026, 0, 1, 14, 0, 0)),
  someObj: { inner: true },
  someArr: [1, 2, 3],
  someTuple: [1, "value"],
  someUnion: 3,
  customVal: new Money("12.50", "GBP"),
  big: 123n,
  tags: new Set(["a", "b"]),
  lookup: new Map([["x", { a: 1 }]]),
  scores: new SortedSet([1, 2, 3]),
  nothing: null,
  "key with space": "here",
}

export const sampleSchemaText = `{
  someNum: number,
  someStr: string,
  someDate: Date,
  someObj: { inner: boolean },
  someArr: number[],
  someTuple: [number, string],
  someUnion: number | string,
  customVal: Money,
  big: bigint,
  tags: Set<string>,
  lookup: Map<string, { a: number }>,
  scores: SortedSet<number>,
  nothing: null,
  "key with space"?: string,
}`
