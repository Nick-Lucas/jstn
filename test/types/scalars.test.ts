import { describe, expect, it } from "vitest"
import { JSTN, JSTNError, bigint, boolean, number, string } from "../../src/index.ts"
import type { Node, Type } from "../../src/index.ts"

function fails(run: () => unknown): JSTNError {
  try {
    run()
  } catch (error) {
    if (error instanceof JSTNError) return error
    throw error
  }
  throw new Error("expected a JSTNError")
}

const nullType = JSTN.schema(null)
const pos = { line: 2, column: 7 }

describe("number", () => {
  it.each([0, -0, 1.5, Number.NaN, Infinity, -Infinity, Number.MAX_VALUE, 5e-324, 2 ** 53 + 2])("round-trips %d", (value) => {
    const node = number.encode(value, [])
    expect(node).toStrictEqual({ kind: "number", value })
    expect(number.decode(node, [])).toStrictEqual(value)
  })

  it("preserves the sign of -0", () => {
    expect(Object.is(number.decode({ kind: "number", value: -0 }, []), -0)).toBe(true)
  })
})

describe("string", () => {
  it.each([
    ["the empty string", ""],
    ["escapes", "a\"b\\c\n\t"],
    ["emoji", "😀"],
    ["a lone surrogate", "\ud800"],
    ["NUL", "\u0000"],
    ["10 kB", "x".repeat(10_000)],
  ])("round-trips %s", (_, value) => {
    const node = string.encode(value, [])
    expect(node).toStrictEqual({ kind: "string", value })
    expect(string.decode(node, [])).toBe(value)
  })
})

describe("bigint", () => {
  it.each([-5n, 0n, 10n ** 199n, -(10n ** 199n)])("round-trips %s", (value) => {
    const node = bigint.encode(value, [])
    expect(node).toStrictEqual({ kind: "bigint", value })
    expect(bigint.decode(node, [])).toBe(value)
  })
})

describe("boolean and null", () => {
  it.each([true, false])("round-trips %s", (value) => {
    expect(boolean.decode(boolean.encode(value, []), [])).toBe(value)
  })

  it("round-trips null", () => {
    expect(nullType.encode(null, [])).toStrictEqual({ kind: "null" })
    expect(nullType.decode({ kind: "null" }, [])).toBeNull()
  })
})

describe("encode rejections", () => {
  it.each<[string, Type<unknown>, unknown, string]>([
    ["number", number, "1", "$: expected number, got string \"1\""],
    ["number", number, 1n, "$: expected number, got bigint 1n"],
    ["number", number, new Number(1), "$: expected number, got Number"],
    ["number", number, null, "$: expected number, got null"],
    ["number", number, undefined, "$: expected number, got undefined"],
    ["string", string, 1, "$: expected string, got number 1"],
    ["string", string, new String("x"), "$: expected string, got String"],
    ["string", string, null, "$: expected string, got null"],
    ["boolean", boolean, "true", "$: expected boolean, got string \"true\""],
    ["boolean", boolean, 0, "$: expected boolean, got number 0"],
    ["boolean", boolean, new Boolean(true), "$: expected boolean, got Boolean"],
    ["bigint", bigint, 1, "$: expected bigint, got number 1"],
    ["bigint", bigint, "1", "$: expected bigint, got string \"1\""],
    ["null", nullType, undefined, "$: expected null, got undefined"],
    ["null", nullType, 0, "$: expected null, got number 0"],
    ["null", nullType, {}, "$: expected null, got object"],
  ])("%s rejects %o", (_, type, value, message) => {
    const error = fails(() => type.encode(value, []))
    expect(error.message).toBe(message)
    expect(error.line).toBeUndefined()
  })

  it("reports the given path", () => {
    expect(fails(() => number.encode("x", ["a", 2])).message).toBe("$.a[2]: expected number, got string \"x\"")
  })
})

describe("decode rejections", () => {
  it.each<[string, Type<unknown>, Node, string]>([
    ["number", number, { kind: "string", value: "1", pos }, "expected number, got string \"1\""],
    ["number", number, { kind: "bigint", value: 1n, pos }, "expected number, got bigint 1n"],
    ["number", number, { kind: "tagged", tag: "Money", payload: "1", pos }, "expected number, got Money"],
    ["string", string, { kind: "null", pos }, "expected string, got null"],
    ["string", string, { kind: "list", tag: null, items: [], pos }, "expected string, got array"],
    ["boolean", boolean, { kind: "number", value: 1, pos }, "expected boolean, got number 1"],
    ["bigint", bigint, { kind: "number", value: 1, pos }, "expected bigint, got number 1"],
    ["bigint", bigint, { kind: "list", tag: "Set", items: [], pos }, "expected bigint, got Set"],
    ["null", nullType, { kind: "boolean", value: false, pos }, "expected null, got boolean false"],
    ["null", nullType, { kind: "object", entries: [], pos }, "expected null, got object"],
  ])("%s rejects a %o node with its position", (_, type, node, reason) => {
    const error = fails(() => type.decode(node, ["x"]))
    expect(error.message).toBe(`$.x: ${reason} (line 2, column 7)`)
    expect(error.reason).toBe(reason)
    expect(error.line).toBe(2)
    expect(error.column).toBe(7)
  })
})

describe("validate and is", () => {
  it.each<[Type<unknown>, unknown, unknown]>([
    [number, 1, "1"],
    [string, "a", 1],
    [boolean, true, null],
    [bigint, 1n, 1],
    [nullType, null, undefined],
  ])("%o accepts its own kind only", (type, good, bad) => {
    expect(JSTN.validate(good, type)).toBe(good)
    expect(JSTN.is(good, type)).toBe(true)
    expect(JSTN.is(bad, type)).toBe(false)
    expect(() => JSTN.validate(bad, type)).toThrow(JSTNError)
  })

  it("validates through shorthands", () => {
    expect(JSTN.is(1, Number)).toBe(true)
    expect(JSTN.is("x", String)).toBe(true)
    expect(JSTN.is(false, Boolean)).toBe(true)
    expect(JSTN.is(1n, BigInt)).toBe(true)
    expect(JSTN.is(null, null)).toBe(true)
    expect(JSTN.is(1, null)).toBe(false)
  })
})
