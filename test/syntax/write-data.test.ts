import { describe, expect, it } from "vitest"
import type { Node } from "../../src/core/type.ts"
import { writeData } from "../../src/syntax/write-data.ts"

const num = (value: number): Node => ({ kind: "number", value })
const str = (value: string): Node => ({ kind: "string", value })
const big = (value: bigint): Node => ({ kind: "bigint", value })
const bool = (value: boolean): Node => ({ kind: "boolean", value })
const nil: Node = { kind: "null" }
const list = (items: Node[], tag: string | null = null): Node => ({ kind: "list", tag, items })
const obj = (...entries: [string, Node][]): Node => ({ kind: "object", entries: entries.map(([key, value]) => ({ key, value })) })
const tagged = (tag: string, payload: string): Node => ({ kind: "tagged", tag, payload })

describe("scalars", () => {
  it.each<[string, Node, string]>([
    ["null", nil, "null"],
    ["true", bool(true), "true"],
    ["false", bool(false), "false"],
    ["zero", num(0), "0"],
    ["negative zero", num(-0), "-0"],
    ["NaN", num(Number.NaN), "NaN"],
    ["Infinity", num(Number.POSITIVE_INFINITY), "Infinity"],
    ["-Infinity", num(Number.NEGATIVE_INFINITY), "-Infinity"],
    ["fraction", num(-1.5), "-1.5"],
    ["large exponent", num(1e21), "1e+21"],
    ["smallest subnormal", num(5e-324), "5e-324"],
    ["bigint", big(123n), "123n"],
    ["negative bigint", big(-5n), "-5n"],
    ["zero bigint", big(0n), "0n"],
    ["200-digit bigint", big(10n ** 199n), `1${"0".repeat(199)}n`],
    ["plain string", str("value"), "\"value\""],
    ["empty string", str(""), "\"\""],
    ["string escapes", str("\"\\\b\f\n\r\t"), "\"\\\"\\\\\\b\\f\\n\\r\\t\""],
    ["control characters", str("\u0000\u001f\u007f"), "\"\\u0000\\u001f\\u007f\""],
    ["lone surrogates", str("\uD800 \uDC00"), "\"\\ud800 \\udc00\""],
    ["single quote and unicode", str("it's é \u{1F600}"), "\"it's é \u{1F600}\""],
  ])("%s", (_, node, expected) => {
    expect(writeData(node)).toBe(expected)
    expect(writeData(node, 2)).toBe(expected)
  })
})

describe("tagged payloads", () => {
  it.each<[string, string]>([
    ["2026-01-01T14:00:00Z", "Date(2026-01-01T14:00:00Z)"],
    ["12.50 GBP", "Date(12.50 GBP)"],
    ["https://x.io//a", "Date(https://x.io//a)"],
    ["a", "Date(a)"],
    ["a b", "Date(a b)"],
    ["é \u{1F600}", "Date(é \u{1F600})"],
    ["", "Date(\"\")"],
    [" a", "Date(\" a\")"],
    ["a ", "Date(\"a \")"],
    [" ", "Date(\" \")"],
    ["(", "Date(\"(\")"],
    [")", "Date(\")\")"],
    ["\"", "Date(\"\\\"\")"],
    ["'", "Date(\"'\")"],
    ["\\", "Date(\"\\\\\")"],
    ["a\nb", "Date(\"a\\nb\")"],
    ["\ta", "Date(\"\\ta\")"],
    ["\u0000", "Date(\"\\u0000\")"],
    ["\u001f", "Date(\"\\u001f\")"],
    ["\u007f", "Date(\"\\u007f\")"],
  ])("%j", (payload, expected) => {
    expect(writeData(tagged("Date", payload))).toBe(expected)
  })
})

describe("keys", () => {
  it.each<[string, string]>([
    ["a", "{a:1}"],
    ["_x", "{_x:1}"],
    ["$y", "{$y:1}"],
    ["a1", "{a1:1}"],
    ["null", "{null:1}"],
    ["true", "{true:1}"],
    ["a b", "{\"a b\":1}"],
    ["1a", "{\"1a\":1}"],
    ["", "{\"\":1}"],
    ["é", "{\"é\":1}"],
    ["a-b", "{\"a-b\":1}"],
    ["\"", "{\"\\\"\":1}"],
  ])("%j", (key, expected) => {
    expect(writeData(obj([key, num(1)]))).toBe(expected)
  })
})

describe("compact output", () => {
  it.each<[string, Node, string]>([
    ["empty object", obj(), "{}"],
    ["empty list", list([]), "[]"],
    ["empty tagged list", list([], "Set"), "Set[]"],
    ["plan example", obj(["a", num(1)], ["b c", list([num(1), num(2)])], ["m", list([list([str("k"), num(1)])], "Map")]), "{a:1,\"b c\":[1,2],m:Map[[\"k\",1]]}"],
    ["nested objects", obj(["a", obj(["b", obj(["c", nil])])]), "{a:{b:{c:null}}}"],
    ["nested lists", list([list([]), list([list([num(1)])]), obj()]), "[[],[[1]],{}]"],
    ["tagged list of tagged scalars", list([tagged("Date", "x"), tagged("Note", " y")], "Set"), "Set[Date(x),Note(\" y\")]"],
    ["map pairs", list([list([str("a"), num(1)]), list([str("b"), num(2)])], "Map"), "Map[[\"a\",1],[\"b\",2]]"],
  ])("%s", (_, node, expected) => {
    expect(writeData(node)).toBe(expected)
  })
})

describe("space", () => {
  const node = obj(["a", list([num(1), num(2)])], ["b", obj(["c", nil])])
  const indented = (unit: string): string => `{\n${unit}a: [1, 2],\n${unit}b: {\n${unit}${unit}c: null,\n${unit}},\n}`
  const compact = "{a:[1,2],b:{c:null}}"

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["0", 0],
    ["-1", -1],
    ["0.5", 0.5],
    ["NaN", Number.NaN],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["empty string", ""],
    ["object", {}],
    ["null", null],
  ])("%s gives compact output", (_, space) => {
    expect(writeData(node, space as number)).toBe(compact)
  })

  it.each<[string, number | string, string]>([
    ["2", 2, "  "],
    ["2.9 floored to 2", 2.9, "  "],
    ["10", 10, " ".repeat(10)],
    ["11 clamped to 10", 11, " ".repeat(10)],
    ["100 clamped to 10", 100, " ".repeat(10)],
    ["Infinity clamped to 10", Number.POSITIVE_INFINITY, " ".repeat(10)],
    ["tab", "\t", "\t"],
    ["two dashes", "--", "--"],
    ["12 characters cut to 10", "abcdefghijkl", "abcdefghij"],
  ])("%s", (_, space, unit) => {
    expect(writeData(node, space)).toBe(indented(unit))
  })
})

describe("pretty output", () => {
  it.each<[string, Node, string]>([
    ["scalars stay bare", num(1), "1"],
    ["empty object inline", obj(), "{}"],
    ["empty list inline", list([]), "[]"],
    ["empty tagged list inline", list([], "Set"), "Set[]"],
    ["all-scalar list inline", list([num(1), str("a"), nil, bool(true), big(2n)]), "[1, \"a\", null, true, 2n]"],
    ["list of tagged scalars inline", list([tagged("Date", "x"), tagged("Money", "1 GBP")], "Set"), "Set[Date(x), Money(1 GBP)]"],
    ["list containing an empty list expands", list([num(1), list([])]), "[\n  1,\n  [],\n]"],
    ["list containing an object expands", list([obj(["a", num(1)])]), "[\n  {\n    a: 1,\n  },\n]"],
    ["object with one entry expands", obj(["a", num(1)]), "{\n  a: 1,\n}"],
    ["object with empty containers", obj(["a", obj()], ["b", list([], "Set")]), "{\n  a: {},\n  b: Set[],\n}"],
    ["map of scalar pairs", obj(["m", list([list([str("a"), num(1)]), list([str("b"), num(2)])], "Map")]), "{\n  m: Map[\n    [\"a\", 1],\n    [\"b\", 2],\n  ],\n}"],
    ["map with object values", obj(["m", list([list([str("x"), obj(["a", num(1)])])], "Map")]), "{\n  m: Map[\n    [\n      \"x\",\n      {\n        a: 1,\n      },\n    ],\n  ],\n}"],
    ["three levels", obj(["a", obj(["b", obj(["c", list([num(1)])])])]), "{\n  a: {\n    b: {\n      c: [1],\n    },\n  },\n}"],
  ])("%s", (_, node, expected) => {
    expect(writeData(node, 2)).toBe(expected)
  })

  it("has no final newline", () => {
    expect(writeData(obj(["a", num(1)]), 2).endsWith("}")).toBe(true)
  })
})

it("writes the request sample exactly as the plan shows it", () => {
  const node = obj(
    ["someNum", num(1)],
    ["someStr", str("value")],
    ["someDate", tagged("Date", "2026-01-01T14:00:00Z")],
    ["someObj", obj(["inner", bool(true)])],
    ["someArr", list([num(1), num(2), num(3)])],
    ["someTuple", list([num(1), str("value")])],
    ["someUnion", num(3)],
    ["customVal", tagged("Money", "12.50 GBP")],
    ["big", big(123n)],
    ["tags", list([str("a"), str("b")], "Set")],
    ["lookup", list([list([str("x"), obj(["a", num(1)])])], "Map")],
    ["scores", list([num(1), num(2), num(3)], "SortedSet")],
    ["nothing", nil],
    ["key with space", str("here")],
  )
  expect(writeData(node, 2)).toBe(`{
  someNum: 1,
  someStr: "value",
  someDate: Date(2026-01-01T14:00:00Z),
  someObj: {
    inner: true,
  },
  someArr: [1, 2, 3],
  someTuple: [1, "value"],
  someUnion: 3,
  customVal: Money(12.50 GBP),
  big: 123n,
  tags: Set["a", "b"],
  lookup: Map[
    [
      "x",
      {
        a: 1,
      },
    ],
  ],
  scores: SortedSet[1, 2, 3],
  nothing: null,
  "key with space": "here",
}`)
  expect(writeData(node)).toBe(
    "{someNum:1,someStr:\"value\",someDate:Date(2026-01-01T14:00:00Z),someObj:{inner:true},someArr:[1,2,3],someTuple:[1,\"value\"],someUnion:3,customVal:Money(12.50 GBP),big:123n,tags:Set[\"a\",\"b\"],lookup:Map[[\"x\",{a:1}]],scores:SortedSet[1,2,3],nothing:null,\"key with space\":\"here\"}",
  )
})
