import { describe, expect, it } from "vitest"
import { JSTN, JSTNError, array, bigint, boolean, date, number, optional, set, string, tuple, union } from "../../src/index.ts"
import type { Schema } from "../../src/index.ts"

function fails(run: () => unknown): JSTNError {
  try {
    run()
  } catch (error) {
    if (error instanceof JSTNError) return error
    throw error
  }
  throw new Error("expected a JSTNError")
}

function loose(value: unknown): Schema {
  return value as Schema
}

class Point {
  x = 1
}

describe("shorthands", () => {
  it.each([
    ["Number", Number, number],
    ["String", String, string],
    ["Boolean", Boolean, boolean],
    ["BigInt", BigInt, bigint],
    ["Date", Date, date],
  ])("%s resolves to the built-in", (_, shorthand, builtIn) => {
    expect(JSTN.schema(shorthand)).toBe(builtIn)
  })

  it("resolves null to one null type named null", () => {
    const type = JSTN.schema(null)
    expect(type.name).toBe("null")
    expect(JSTN.schema(null)).toBe(type)
    expect(type.encode(null, [])).toStrictEqual({ kind: "null" })
  })
})

describe("JSTN.schema", () => {
  it("returns a Type unchanged", () => {
    const type = array(Number)
    expect(JSTN.schema(type)).toBe(type)
  })

  it("turns a plain object into an object type", () => {
    const type = JSTN.schema({ a: Number, b: String })
    expect(type.name).toBe("{ a: number, b: string }")
    expect(type.encode({ a: 1, b: "x" }, [])).toStrictEqual({
      kind: "object",
      entries: [
        { key: "a", value: { kind: "number", value: 1 } },
        { key: "b", value: { kind: "string", value: "x" } },
      ],
    })
  })

  it("accepts a null-prototype shape", () => {
    const shape: Record<string, Schema> = Object.create(null)
    shape["a"] = Number
    const type = JSTN.schema(shape)
    expect(type.name).toBe("{ a: number }")
    expect(JSTN.is({ a: 1 }, type)).toBe(true)
  })

  it("normalises nested literals recursively", () => {
    const type = JSTN.schema({ a: { b: { c: Date } }, n: null })
    expect(type.name).toBe("{ a: { b: { c: Date } }, n: null }")
    expect(JSTN.is({ a: { b: { c: new Date(0) } }, n: null }, type)).toBe(true)
    expect(fails(() => JSTN.validate({ a: { b: { c: 1 } }, n: null }, type)).message).toBe("$.a.b.c: expected Date, got number 1")
  })
})

describe("optional", () => {
  it("makes a shape field optional", () => {
    const type = JSTN.schema({ a: Number, b: optional(String) })
    expect(type.name).toBe("{ a: number, b?: string }")
    expect(JSTN.is({ a: 1 }, type)).toBe(true)
    expect(JSTN.is({ a: 1, b: "x" }, type)).toBe(true)
    expect(JSTN.is({ a: 1, b: 2 }, type)).toBe(false)
  })

  it.each([
    ["the top level", () => JSTN.schema(loose(optional(Number))), "$: optional() is only valid as an object field"],
    ["array", () => array(loose(optional(Number))), "$: optional() is only valid as an object field"],
    ["tuple", () => tuple(Number, loose(optional(String))), "$[1]: optional() is only valid as an object field"],
    ["union", () => union(Number, loose(optional(String))), "$: optional() is only valid as an object field"],
    ["set", () => set(loose(optional(Number))), "$: optional() is only valid as an object field"],
    ["optional", () => optional(loose(optional(Number))), "$: optional() is only valid as an object field"],
    ["a nested shape", () => JSTN.schema({ a: { b: array(loose(optional(Number))) } }), "$: optional() is only valid as an object field"],
  ])("throws at %s", (_, run, message) => {
    expect(fails(run).message).toBe(message)
  })
})

describe("rejections", () => {
  it.each([
    ["Array", Array, "$: not a schema: Array (use array(...))"],
    ["Set", Set, "$: not a schema: Set (use set(...))"],
    ["Map", Map, "$: not a schema: Map (use map(...))"],
    ["Object", Object, "$: not a schema: Object (use a plain object literal)"],
    ["Symbol", Symbol, "$: not a schema: function"],
    ["undefined", undefined, "$: not a schema: undefined"],
    ["3", 3, "$: not a schema: number 3"],
    ["a string", "number", "$: not a schema: string \"number\""],
    ["a function", () => number, "$: not a schema: function"],
    ["a class instance", new Point(), "$: not a schema: Point"],
    ["an array literal", [Number], "$: not a schema: array"],
    ["a nested invalid field", { a: { b: 3 } }, "$.a.b: not a schema: number 3"],
    ["an invalid quoted field", { "b c": Array }, "$[\"b c\"]: not a schema: Array (use array(...))"],
  ])("rejects %s", (_, schema, message) => {
    const error = fails(() => JSTN.schema(loose(schema)))
    expect(error).toBeInstanceOf(JSTNError)
    expect(error.message).toBe(message)
    expect(error.line).toBeUndefined()
  })

  it("rejects a duck-typed Type as a shape", () => {
    const duck = { name: "number", encode() {}, decode() {} }
    expect(fails(() => JSTN.schema(loose(duck))).message).toBe("$.name: not a schema: string \"number\"")
  })
})

describe("immutability", () => {
  it.each([
    ["a scalar", number],
    ["an object type", JSTN.schema({ a: Number })],
    ["an array", array(Number)],
    ["a tuple", tuple(Number)],
    ["a union", union(Number, String)],
    ["a set", set(Number)],
    ["Date", date],
  ])("freezes %s", (_, type) => {
    expect(Object.isFrozen(type)).toBe(true)
  })

  it("freezes optional markers", () => {
    expect(Object.isFrozen(optional(Number))).toBe(true)
  })
})
