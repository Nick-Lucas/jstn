import { describe, expect, it } from "vitest"
import { JSTN, JSTNError, array, createType, map, set, tuple, union } from "../../src/index.ts"
import type { Schema, Type } from "../../src/index.ts"

function fails(run: () => unknown): JSTNError {
  try {
    run()
  } catch (error) {
    if (error instanceof JSTNError) return error
    throw error
  }
  throw new Error("expected a JSTNError")
}

function stringTag(name: string) {
  return createType({ name, match: (v) => typeof v === "string", parse: (t) => t, stringify: (s: string) => s })
}

describe("declaration order", () => {
  it("encodes through the first member that accepts", () => {
    const [first, second] = [stringTag("First"), stringTag("Second")]
    expect(union(first, second).encode("x", [])).toStrictEqual({ kind: "tagged", tag: "First", payload: "x" })
    expect(union(second, first).encode("x", [])).toStrictEqual({ kind: "tagged", tag: "Second", payload: "x" })
  })

  it("prefers array over an equally shaped tuple", () => {
    const type = union(array(Number), tuple(Number, Number))
    expect(type.encode([1, 2], [])).toStrictEqual(array(Number).encode([1, 2], []))
    expect(type.decode({ kind: "list", tag: null, items: [] }, [])).toStrictEqual([])
  })

  it("tells 1 from 1n", () => {
    const type = union(Number, BigInt)
    expect(type.encode(1, [])).toStrictEqual({ kind: "number", value: 1 })
    expect(type.encode(1n, [])).toStrictEqual({ kind: "bigint", value: 1n })
    expect(type.decode({ kind: "number", value: 1 }, [])).toBe(1)
    expect(type.decode({ kind: "bigint", value: 1n }, [])).toBe(1n)
  })

  it("tells a string from a Date", () => {
    const type = union(String, Date)
    const instant = new Date(Date.UTC(2026, 0, 1))
    expect(type.encode("2026-01-01T00:00:00Z", [])).toStrictEqual({ kind: "string", value: "2026-01-01T00:00:00Z" })
    expect(type.encode(instant, [])).toStrictEqual({ kind: "tagged", tag: "Date", payload: "2026-01-01T00:00:00Z" })
    expect(type.decode({ kind: "tagged", tag: "Date", payload: "2026-01-01" }, [])).toStrictEqual(instant)
    expect(type.decode({ kind: "string", value: "2026-01-01" }, [])).toBe("2026-01-01")
  })

  it("tells an array from a Set", () => {
    const type = union(array(String), set(String))
    expect(type.encode(["a"], [])).toStrictEqual({ kind: "list", tag: null, items: [{ kind: "string", value: "a" }] })
    expect(type.encode(new Set(["a"]), [])).toStrictEqual({ kind: "list", tag: "Set", items: [{ kind: "string", value: "a" }] })
    expect(type.decode({ kind: "list", tag: "Set", items: [{ kind: "string", value: "a" }] }, [])).toStrictEqual(new Set(["a"]))
    expect(type.decode({ kind: "list", tag: null, items: [{ kind: "string", value: "a" }] }, [])).toStrictEqual(["a"])
  })

  it("accepts null as a member", () => {
    const type = union(String, null)
    expect(type.name).toBe("union(string, null)")
    expect(type.encode(null, [])).toStrictEqual({ kind: "null" })
    expect(type.decode({ kind: "null" }, [])).toBeNull()
    expect(type.decode({ kind: "string", value: "x" }, [])).toBe("x")
    expect(JSTN.is(undefined, type)).toBe(false)
  })
})

describe("flattening", () => {
  it.each([
    [union(union(Number, String), Boolean), "union(number, string, boolean)"],
    [union(Number, union(String, Boolean)), "union(number, string, boolean)"],
    [union(union(Number, String), union(Boolean, null)), "union(number, string, boolean, null)"],
  ])("names %#", (type, name) => {
    expect(type.name).toBe(name)
  })

  it("keeps a flattened nested union flat inside an array", () => {
    expect(array(union(union(Number, String), Boolean)).name).toBe("array(union(number, string, boolean))")
  })

  it("counts the members of a nested union when checking for at least 2", () => {
    const members: Schema[] = [union(Number, String)]
    expect((union as (...members: Schema[]) => Type<unknown>)(...members).name).toBe("union(number, string)")
  })

  it("resolves members of a flattened union", () => {
    const type = union(union(Number, String), Boolean)
    expect(type.encode(true, [])).toStrictEqual({ kind: "boolean", value: true })
    expect(fails(() => type.encode(null, [])).message).toBe("$: expected union(number, string, boolean), got null")
  })
})

describe("error selection", () => {
  it("reports a deep failure from an object member", () => {
    const error = fails(() => union({ a: Number }, String).encode({ a: "x" }, []))
    expect(error.message).toBe("$.a: expected number, got string \"x\"")
  })

  it("prefers the longest path", () => {
    const type = union({ a: Number }, { a: { b: Number } })
    expect(fails(() => type.encode({ a: { b: "x" } }, [])).message).toBe("$.a.b: expected number, got string \"x\"")
  })

  it("prefers the earlier member on a tie", () => {
    const type = union({ a: Number }, { a: String })
    expect(fails(() => type.encode({ a: true }, [])).message).toBe("$.a: expected number, got boolean true")
  })

  it("reports a deep decode failure with its position", () => {
    const type = union({ a: Number }, String)
    const node = { kind: "object", entries: [{ key: "a", value: { kind: "null", pos: { line: 1, column: 5 } } }] } as const
    expect(fails(() => type.decode(node, ["u"])).message).toBe("$.u.a: expected number, got null (line 1, column 5)")
  })

  it("reports a root mismatch when no member fails below the union", () => {
    const type = union(Number, String)
    const error = fails(() => type.decode({ kind: "boolean", value: true, pos: { line: 2, column: 6 } }, ["u"]))
    expect(error.message).toBe("$.u: expected union(number, string), got boolean true (line 2, column 6)")
    expect(fails(() => type.encode(true, ["u"])).message).toBe("$.u: expected union(number, string), got boolean true")
  })

  it("treats a failure at the union's own path as a root failure", () => {
    const type = union({ a: Number }, String)
    expect(fails(() => type.encode({}, [])).message).toBe("$: expected union({ a: number }, string), got object")
  })

  it("reports a deep failure below a nested union path", () => {
    const type = union({ a: Number }, String)
    expect(fails(() => JSTN.validate({ u: { a: { b: 1 } } }, { u: type })).message).toBe("$.u.a: expected number, got object")
  })
})

describe("non-JSTNError exceptions", () => {
  const thrower = createType({
    name: "Thrower",
    match: (): boolean => {
      throw new TypeError("bad match")
    },
    parse: (t) => t,
    stringify: (s: string) => s,
  })

  it("propagates from encode", () => {
    expect(() => union(thrower, String).encode("x", [])).toThrow(TypeError)
  })

  it("propagates from decode", () => {
    expect(() => union(thrower, String).decode({ kind: "tagged", tag: "Thrower", payload: "x" }, [])).toThrow(TypeError)
  })

  it("propagates through JSTN.is", () => {
    expect(() => JSTN.is("x", union(thrower, String))).toThrow(TypeError)
  })
})

describe("member count", () => {
  it.each([
    ["one member", [Number]],
    ["no members", []],
  ])("rejects %s from a spread", (_, members) => {
    const error = fails(() => union(...(members as unknown as [Schema, Schema])))
    expect(error.message).toBe("$: union() needs at least 2 members")
  })
})

describe("names in containers", () => {
  const u = union(Number, String)

  it.each([
    [array(u), "array(union(number, string))"],
    [array(array(u)), "array(array(union(number, string)))"],
    [set(u), "set(union(number, string))"],
    [map(u, union(Boolean, null)), "map(union(number, string), union(boolean, null))"],
    [tuple(u, u), "tuple(union(number, string), union(number, string))"],
    [JSTN.schema({ a: u }), "{ a: union(number, string) }"],
  ])("names %#", (type, name) => {
    expect(type.name).toBe(name)
  })
})
