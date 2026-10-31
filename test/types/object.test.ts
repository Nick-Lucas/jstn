import { describe, expect, it } from "vitest"
import { JSTN, JSTNError, array, optional, union } from "../../src/index.ts"
import type { Node } from "../../src/index.ts"

function fails(run: () => unknown): JSTNError {
  try {
    run()
  } catch (error) {
    if (error instanceof JSTNError) return error
    throw error
  }
  throw new Error("expected a JSTNError")
}

function num(value: number): Node {
  return { kind: "number", value }
}

function obj(...entries: [string, Node][]): Node {
  return { kind: "object", entries: entries.map(([key, value]) => ({ key, value })) }
}

class Point {
  x = 1
}

describe("happy path", () => {
  it("round-trips nested shapes", () => {
    const type = JSTN.schema({ a: { b: Number }, c: String })
    const node = obj(["a", obj(["b", num(1)])], ["c", { kind: "string", value: "x" }])
    expect(type.encode({ a: { b: 1 }, c: "x" }, [])).toStrictEqual(node)
    expect(type.decode(node, [])).toStrictEqual({ a: { b: 1 }, c: "x" })
  })

  it("handles an empty shape", () => {
    const type = JSTN.schema({})
    expect(type.encode({}, [])).toStrictEqual(obj())
    expect(type.decode(obj(), [])).toStrictEqual({})
  })

  it("handles quoted and keyword keys", () => {
    const type = JSTN.schema({ "b c": Number, null: Number, true: Number, "": Number })
    const value = { "b c": 1, null: 2, true: 3, "": 4 }
    const node = obj(["b c", num(1)], ["null", num(2)], ["true", num(3)], ["", num(4)])
    expect(type.encode(value, [])).toStrictEqual(node)
    expect(type.decode(node, [])).toStrictEqual(value)
  })

  it("decodes __proto__ and constructor as own properties", () => {
    const shape = JSON.parse("{\"__proto__\": null, \"constructor\": null}") as Record<string, null>
    const type = JSTN.schema(shape)
    expect(type.name).toBe("{ __proto__: null, constructor: null }")
    const decoded = type.decode(obj(["__proto__", { kind: "null" }], ["constructor", { kind: "null" }]), [])
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
    expect(Object.hasOwn(decoded, "__proto__")).toBe(true)
    expect(Object.hasOwn(decoded, "constructor")).toBe(true)
    expect(Object.keys(decoded)).toStrictEqual(["__proto__", "constructor"])
    expect(decoded["__proto__"]).toBeNull()
    const value = JSON.parse("{\"__proto__\": null, \"constructor\": null}") as unknown
    expect(type.encode(value, [])).toStrictEqual(obj(["__proto__", { kind: "null" }], ["constructor", { kind: "null" }]))
  })

  it("accepts a null-prototype value", () => {
    const value: Record<string, number> = Object.create(null)
    value["a"] = 1
    expect(JSTN.validate(value, { a: Number })).toBe(value)
  })
})

describe("key order", () => {
  const type = JSTN.schema({ a: Number, b: Number, c: Number })

  it("encodes in schema order", () => {
    expect(type.encode({ c: 3, a: 1, b: 2 }, [])).toStrictEqual(obj(["a", num(1)], ["b", num(2)], ["c", num(3)]))
  })

  it("decodes in schema order", () => {
    const decoded = type.decode(obj(["c", num(3)], ["b", num(2)], ["a", num(1)]), [])
    expect(Object.keys(decoded)).toStrictEqual(["a", "b", "c"])
  })
})

describe("unknown keys", () => {
  const type = JSTN.schema({ a: Number })

  it("fails on encode at the first extra key in Object.keys order", () => {
    const error = fails(() => type.encode({ z: 1, a: "not checked yet", "b c": 2 }, ["o"]))
    expect(error.message).toBe("$.o.z: unknown key")
    expect(fails(() => type.encode({ a: 1, "b c": 2 }, [])).message).toBe("$[\"b c\"]: unknown key")
  })

  it("fails on decode at the key position", () => {
    const node: Node = {
      kind: "object",
      entries: [
        { key: "a", value: num(1), keyPos: { line: 1, column: 3 } },
        { key: "b c", value: num(2), keyPos: { line: 5, column: 5 } },
      ],
      pos: { line: 1, column: 1 },
    }
    expect(fails(() => type.decode(node, ["someObj"])).message).toBe("$.someObj[\"b c\"]: unknown key (line 5, column 5)")
  })

  it("ignores symbol keys on encode", () => {
    expect(JSTN.is({ a: 1, [Symbol("s")]: 2 }, type)).toBe(true)
  })
})

describe("missing required keys", () => {
  const type = JSTN.schema({ inner: Boolean })

  it("fails on encode without a position", () => {
    const error = fails(() => type.encode({}, ["someObj"]))
    expect(error.message).toBe("$.someObj: missing required key \"inner\"")
    expect(error.line).toBeUndefined()
  })

  it("fails on decode at the object position", () => {
    const error = fails(() => type.decode({ kind: "object", entries: [], pos: { line: 4, column: 12 } }, ["someObj"]))
    expect(error.message).toBe("$.someObj: missing required key \"inner\" (line 4, column 12)")
  })

  it("quotes non-identifier keys", () => {
    expect(fails(() => JSTN.validate({}, { "b c": Number })).message).toBe("$: missing required key \"b c\"")
  })
})

describe("optional keys", () => {
  const type = JSTN.schema({ a: Number, b: optional(String) })

  it("omits an absent key", () => {
    expect(type.encode({ a: 1 }, [])).toStrictEqual(obj(["a", num(1)]))
  })

  it("omits an undefined value", () => {
    expect(type.encode({ a: 1, b: undefined }, [])).toStrictEqual(obj(["a", num(1)]))
  })

  it("never sets undefined on decode", () => {
    const decoded = type.decode(obj(["a", num(1)]), [])
    expect(decoded).toStrictEqual({ a: 1 })
    expect(Object.hasOwn(decoded, "b")).toBe(false)
  })

  it("decodes a present optional key", () => {
    expect(type.decode(obj(["a", num(1)], ["b", { kind: "string", value: "x" }]), [])).toStrictEqual({ a: 1, b: "x" })
  })

  it("encodes a required key present as undefined and fails at its path", () => {
    expect(fails(() => type.encode({ a: undefined }, [])).message).toBe("$.a: expected number, got undefined")
  })

  it("rejects an optional key with the wrong type", () => {
    expect(fails(() => type.encode({ a: 1, b: 2 }, [])).message).toBe("$.b: expected string, got number 2")
  })
})

describe("non-plain values", () => {
  const type = JSTN.schema({ x: Number })

  it.each([
    ["a class instance", new Point(), "Point"],
    ["an array", [1], "array"],
    ["a Map", new Map(), "Map"],
    ["null", null, "null"],
    ["Object.create(proto)", Object.create({ x: 1 }), "Object"],
    ["a string", "x", "string \"x\""],
  ])("rejects %s", (_, value, got) => {
    expect(fails(() => type.encode(value, ["p"])).message).toBe(`$.p: expected { x: number }, got ${got}`)
  })

  it("rejects a non-object node with its position", () => {
    const error = fails(() => type.decode({ kind: "list", tag: null, items: [], pos: { line: 3, column: 2 } }, []))
    expect(error.message).toBe("$: expected { x: number }, got array (line 3, column 2)")
  })
})

describe("names", () => {
  it.each([
    ["an empty shape", JSTN.schema({}), "{}"],
    ["optional and quoted keys", JSTN.schema({ a: Number, "b c": optional(String) }), "{ a: number, \"b c\"?: string }"],
    ["nested objects", JSTN.schema({ a: { b: { c: null } } }), "{ a: { b: { c: null } } }"],
    ["a union field", JSTN.schema({ u: union(Number, String) }), "{ u: number | string }"],
    ["an array field", JSTN.schema({ xs: array({ a: Date }) }), "{ xs: { a: Date }[] }"],
  ])("names %s", (_, type, name) => {
    expect(type.name).toBe(name)
  })
})
