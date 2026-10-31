import { describe, expect, it } from "vitest"
import { JSTN, bigint, boolean, date, number, string, tuple } from "../../src/index.ts"
import type { Registry, Type } from "../../src/index.ts"
import { Money, S, SortedSet, money, note, registry, sampleSchemaText, sampleValue } from "../support/fixtures.ts"

function read(text: string, types: Registry = registry) {
  return JSTN.parseSchema(text, { types })
}

describe("productions", () => {
  it.each([
    ["number", number],
    ["string", string],
    ["boolean", boolean],
    ["bigint", bigint],
    ["date", date],
    ["Number", number],
    ["String", string],
    ["Boolean", boolean],
    ["BigInt", bigint],
    ["Date", date],
  ])("resolves %s to the builder type", (text, type) => {
    expect(read(text)).toBe(type)
  })

  it("resolves null to the null type", () => {
    const type = read("null")
    expect(type.name).toBe("null")
    expect(JSTN.parse("null", type)).toBe(null)
    expect(JSTN.is(0, type)).toBe(false)
  })

  it.each([
    ["array(number)", "array(number)", "[1, 2]", [1, 2]],
    ["array(array(Number))", "array(array(number))", "[[1], []]", [[1], []]],
    ["tuple(number, string)", "tuple(number, string)", "[1, \"a\"]", [1, "a"]],
    ["tuple(number, String,)", "tuple(number, string)", "[1, \"a\"]", [1, "a"]],
    ["tuple()", "tuple()", "[]", []],
    ["tuple(tuple(number))", "tuple(tuple(number))", "[[1]]", [[1]]],
    ["{}", "{}", "{}", {}],
    ["{ a: number, b: optional(string), }", "{ a: number, b: optional(string) }", "{a: 1}", { a: 1 }],
    ["{ \"a b\": number, 'c': boolean }", "{ \"a b\": number, c: boolean }", "{\"a b\": 1, c: true}", { "a b": 1, c: true }],
    ["{ null: number, true: optional(number) }", "{ null: number, true: optional(number) }", "{null: 1}", { null: 1 }],
    ["union(number, string)", "union(number, string)", "\"a\"", "a"],
    ["union(number, string,)", "union(number, string)", "1", 1],
    ["{ a: union(number, null) }", "{ a: union(number, null) }", "{a: null}", { a: null }],
    ["set(Date)", "set(date)", "Set[]", new Set()],
    ["map(String, array(Number),)", "map(string, array(number))", "Map[[\"a\", [1]]]", new Map([["a", [1]]])],
  ])("reads %s", (text, name, data, value) => {
    const type = read(text)
    expect(type.name).toBe(name)
    expect(JSTN.parse(data, type)).toStrictEqual(value)
  })

  it("flattens nested unions", () => {
    expect(read("union(union(number, string), union(boolean, null))").name).toBe("union(number, string, boolean, null)")
    expect(read("union(number, union(string, union(boolean, null)))").name).toBe("union(number, string, boolean, null)")
  })

  it("keeps the meaning of each union member", () => {
    const type = read("union(number, array(string))")
    expect(JSTN.is(1, type)).toBe(true)
    expect(JSTN.is(["a"], type)).toBe(true)
    expect(JSTN.is([1], type)).toBe(false)
    expect(JSTN.is("a", type)).toBe(false)
  })

  it("keeps a __proto__ field as an own key", () => {
    const type = read("{ \"__proto__\": number }")
    const value = JSTN.parse("{\"__proto__\": 1}", type)
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(Object.keys(value as object)).toStrictEqual(["__proto__"])
  })

  it.each(["array (number)", "array\n(\n  number\n)", "array /* name */ ( // open\n number /* arg */ )", "array\r\n(number,\t)"])(
    "allows whitespace and comments between a builder and its arguments in %j",
    (text) => {
      expect(read(text).name).toBe("array(number)")
    },
  )

  it("allows comments and newlines between every token", () => {
    const text = [
      "/* lead */ union /* name */ ( // open",
      "{ // brace",
      "  a /* key */ : /* colon */ optional /* opt */ ( /* paren */ array /* arr */ ( set ( number /* arg */ , /* comma */ ) ) ) , // after",
      "  'b' : tuple /* tuple */ ( /* items */ string /* item */ , /* c */ ) /* close */ ,",
      "} /* close */ , /* comma */ null // end",
      ")",
    ].join("\r\n")
    expect(read(text).name).toBe("union({ a: optional(array(set(number))), b: tuple(string) }, null)")
  })
})

describe("collections", () => {
  it("builds working collections", () => {
    const type = read("map(string, set(date))")
    const value = new Map([["k", new Set([new Date(0)])]])
    const text = JSTN.stringify(value, type)
    expect(text).toBe("Map[[\"k\",Set[Date(1970-01-01T00:00:00Z)]]]")
    expect(JSTN.parse(text, type)).toStrictEqual(value)
  })

  it.each([
    ["set(number,)", "set(number)"],
    ["map(string, set(date))", "map(string, set(date))"],
    ["map(string,number,)", "map(string, number)"],
    ["set(union(number, string))", "set(union(number, string))"],
    ["array(set({ a: number }))", "array(set({ a: number }))"],
  ])("reads %s", (text, name) => {
    expect(read(text).name).toBe(name)
  })
})

describe("registry", () => {
  it("uses a bare Type", () => {
    expect(read("money")).toBe(money)
    expect(JSTN.parse("[Money(1 GBP)]", read("array(money)"))).toStrictEqual([new Money("1", "GBP")])
  })

  it.each([
    ["a shorthand constructor", { num: Number }, "num", "number"],
    ["an object shape", { point: { x: Number, y: Number } }, "point", "{ x: number, y: number }"],
    ["null", { nothing: null }, "nothing", "null"],
    ["a collection factory with arguments", registry, "sortedSet(number)", "sortedSet(number)"],
    ["a registered name inside other syntax", registry, "array({ m: optional(union(money, note)) })", "array({ m: optional(union(money, note)) })"],
    ["a two-argument factory", { pair: (a: Type<unknown>, b: Type<unknown>) => tuple(a, b) }, "pair(number, string,)", "tuple(number, string)"],
    ["a name that is no longer built in", { Set: money, Map: note }, "map(Set, Map)", "map(money, note)"],
  ])("uses %s", (_, types, text, name) => {
    expect(read(text, types).name).toBe(name)
  })

  it("builds a working custom collection", () => {
    const type = read("sortedSet(number)")
    expect(JSTN.parse("SortedSet[3, 1, 2]", type)).toStrictEqual(new SortedSet([1, 2, 3]))
  })

  it.each(["constructor", "toString", "valueOf", "hasOwnProperty"])("registers %s, a name on Object.prototype", (name) => {
    expect(read(name, { [name]: Number }).name).toBe("number")
  })

  it("parses with no options at all", () => {
    expect(JSTN.parseSchema("set(number)").name).toBe("set(number)")
  })
})

describe("text and builder schemas", () => {
  const text = read(sampleSchemaText)

  it("have the same name", () => {
    expect(text.name).toBe(S.name)
    expect(read(S.name).name).toBe(S.name)
  })

  it.each([[undefined], [2], ["\t"]])("stringify the sample value identically with space %o", (space) => {
    expect(JSTN.stringify(sampleValue, text, space)).toBe(JSTN.stringify(sampleValue, S, space))
  })

  it("parse the sample back identically", () => {
    const data = JSTN.stringify(sampleValue, S, 2)
    expect(JSTN.parse(data, text)).toStrictEqual(JSTN.parse(data, S))
  })
})
