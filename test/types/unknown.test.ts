import { describe, expect, it } from "vitest"
import { JSTN, JSTNError, createCollection, createType, number, set, unknown } from "../../src/index.ts"
import type { Registrable } from "../../src/index.ts"
import { Money, Note, SortedSet, money, note, sortedSet } from "../support/fixtures.ts"

function fails(run: () => unknown): JSTNError {
  try {
    run()
  } catch (error) {
    if (error instanceof JSTNError) return error
    throw error
  }
  throw new Error("expected a JSTNError")
}

class Tally extends Set<number> {}
const tally = createCollection({ name: Tally, items: Number, fromItems: (items) => new Tally(items), toItems: (v) => v })

JSTN.register(money, note, sortedSet, tally)

describe("unknown without registration", () => {
  it.each([
    ["null", null, "null"],
    ["a boolean", true, "true"],
    ["a number", -0, "-0"],
    ["NaN", Number.NaN, "NaN"],
    ["a bigint", -5n, "-5n"],
    ["a string", "a\"b", "\"a\\\"b\""],
    ["an array", [1, [2]], "[1,[2]]"],
    ["an object", { a: 1, "b c": [] }, "{a:1,\"b c\":[]}"],
    ["a date", new Date(0), "Date(1970-01-01T00:00:00Z)"],
    ["a set", new Set([1, "a"]), "Set[1,\"a\"]"],
    ["a map", new Map<unknown, unknown>([[1, { a: new Set() }]]), "Map[[1,{a:Set[]}]]"],
  ])("round-trips %s", (_, value, text) => {
    expect(JSTN.stringify(value)).toBe(text)
    expect(JSTN.parse(text)).toStrictEqual(value)
  })

  it("is named unknown and reads as unknown in schema text", () => {
    expect(unknown.name).toBe("unknown")
    expect(JSTN.parseSchema("{ meta: unknown, list: array(unknown) }").name).toBe("{ meta: unknown, list: array(unknown) }")
  })

  it("works inside an explicit schema", () => {
    const schema = JSTN.schema({ id: number, meta: unknown })
    expect(JSTN.parse("{ id: 1, meta: { tags: Set[\"a\"] } }", schema)).toStrictEqual({ id: 1, meta: { tags: new Set(["a"]) } })
  })

  it("omits undefined object values and rejects undefined elsewhere", () => {
    expect(JSTN.stringify({ a: undefined, b: 1 })).toBe("{b:1}")
    expect(fails(() => JSTN.stringify([1, undefined])).message).toBe("$[1]: cannot stringify undefined")
    expect(fails(() => JSTN.stringify(undefined)).message).toBe("$: cannot stringify undefined")
  })

  it.each([
    ["a class instance", { x: new (class Widget {})() }, "$.x: cannot stringify Widget (register a type for it with JSTN.register)"],
    ["an invalid date", [new Date(Number.NaN)], "$[0]: cannot stringify invalid Date (register a type for it with JSTN.register)"],
    ["a function", { f: () => 1 }, "$.f: cannot stringify function"],
    ["a symbol", Symbol("s"), "$: cannot stringify symbol"],
  ])("rejects %s", (_, value, message) => {
    expect(fails(() => JSTN.stringify(value)).message).toBe(message)
  })

  it("rejects an unregistered tag with its position", () => {
    expect(fails(() => JSTN.parse("{ a: Widget(x) }")).message).toBe("$.a: unknown tag \"Widget\" (register a type for it with JSTN.register) (line 1, column 6)")
    expect(fails(() => JSTN.parse("[Widget[1]]")).message).toBe("$[0]: unknown tag \"Widget\" (register a type for it with JSTN.register) (line 1, column 2)")
  })

  it("builds objects safely", () => {
    const value = JSTN.parse("{ __proto__: { polluted: true } }") as Record<string, unknown>
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(Object.keys(value)).toStrictEqual(["__proto__"])
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined()
  })

  it("applies the depth limit", () => {
    const deep = JSON.parse("[".repeat(600) + "]".repeat(600)) as unknown
    expect(fails(() => JSTN.stringify(deep)).reason).toBe("nesting deeper than 512 levels")
  })

  it("treats a null schema as the null type, not as no schema", () => {
    expect(fails(() => JSTN.stringify(1 as unknown as null, null)).message).toBe("$: expected null, got number 1")
    expect(fails(() => JSTN.parse("1", null)).message).toBe("$: expected null, got number 1 (line 1, column 1)")
    expect(JSTN.parse("null", null)).toBeNull()
  })

  it("accepts a space argument without a schema", () => {
    expect(JSTN.stringify({ a: [1] }, undefined, 2)).toBe("{\n  a: [1],\n}")
  })
})

describe("JSTN.register", () => {
  it("round-trips registered types and collections", () => {
    const value = { price: new Money("1.00", "GBP"), memo: new Note("hi (there)"), ranks: new SortedSet([2, 1]), tally: new Tally([3]) }
    const text = JSTN.stringify(value)
    expect(text).toBe("{price:Money(1.00 GBP),memo:Note(\"hi (there)\"),ranks:SortedSet[1,2],tally:Tally[3]}")
    expect(JSTN.parse(text)).toStrictEqual(value)
  })

  it("tries the most recently registered type first", () => {
    expect(JSTN.stringify(new Tally([1]))).toBe("Tally[1]")
    expect(JSTN.stringify(new Set([1]))).toBe("Set[1]")
  })

  it("makes registered names available to schema text", () => {
    const type = JSTN.parseSchema("{ price: money, ranks: sortedSet(number) }")
    expect(type.name).toBe("{ price: money, ranks: sortedSet(number) }")
    expect(JSTN.parseSchema("money", { types: { money } }).name).toBe("money")
    const other = createType({ name: "Money", match: () => false, parse: () => 1, stringify: String })
    expect(fails(() => JSTN.parseSchema("money", { types: { money: other } })).message).toBe("$: cannot redefine registered type \"money\"")
  })

  it("ignores a source registered twice", () => {
    expect(() => JSTN.register(money, sortedSet)).not.toThrow()
  })

  it.each([
    ["a second type with a registered tag", createType({ name: "Money", match: () => false, parse: () => 1, stringify: String }), "$: tag \"Money\" is already registered"],
    ["a built-in tag", createType({ name: "Date", match: () => false, parse: () => 1, stringify: String }), "$: tag \"Date\" is already registered"],
    ["an untagged type", number, "$: cannot register number: only createType and createCollection types have a tag"],
    ["a collection of a built-in", set(Number), "$: tag \"Set\" is already registered"],
    ["a function with no parameters", (() => number) as unknown as Registrable, "$: cannot register function: expected a custom type or collection factory"],
    ["a factory that returns no type", ((item: unknown) => [item]) as unknown as Registrable, "$: cannot register function: it did not return a type"],
    ["a non-type", { name: "x" } as unknown as Registrable, "$: cannot register object: expected a custom type or collection factory"],
  ])("rejects %s", (_, source, message) => {
    expect(fails(() => JSTN.register(source)).message).toBe(message)
  })
})

describe("JSTN.transformer", () => {
  it("serialises to JSTN text and back", () => {
    const value = { at: new Date(0), ids: new Set([1n]), price: new Money("2.00", "USD") }
    const wire = JSTN.transformer.serialize(value)
    expect(wire).toBe("{at:Date(1970-01-01T00:00:00Z),ids:Set[1n],price:Money(2.00 USD)}")
    expect(JSTN.transformer.deserialize(wire)).toStrictEqual(value)
  })

  it("passes undefined through", () => {
    expect(JSTN.transformer.serialize(undefined)).toBeUndefined()
    expect(JSTN.transformer.deserialize(undefined)).toBeUndefined()
  })

  it("rejects data that is not text", () => {
    expect(fails(() => JSTN.transformer.deserialize({ json: 1 })).message).toBe("$: expected JSTN text, got object")
  })
})
