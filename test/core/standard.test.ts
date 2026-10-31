import { describe, expect, it } from "vitest"
import { JSTN, array, createType, map, number, optional, set, tuple, union } from "../../src/index.ts"
import type { StandardSchemaV1, StandardSchemaV1Result } from "../../src/index.ts"
import { Money, S, money, sampleValue, sortedSet } from "../support/fixtures.ts"

function validate<T>(schema: StandardSchemaV1<T>, value: unknown): StandardSchemaV1Result<T> {
  const result = schema["~standard"].validate(value)
  if (result instanceof Promise) throw new Error("expected a synchronous result")
  return result
}

describe("~standard", () => {
  it("declares version 1 and the jstn vendor on JSTN.schema results", () => {
    const props = JSTN.schema({ a: Number })["~standard"]
    expect(props.version).toBe(1)
    expect(props.vendor).toBe("jstn")
    expect(Object.isFrozen(props)).toBe(true)
  })

  it("returns the input value itself on success", () => {
    const result = validate(S, sampleValue)
    expect(result).toStrictEqual({ value: sampleValue })
    expect(result.issues).toBeUndefined()
    if (result.issues === undefined) expect(result.value).toBe(sampleValue)
  })

  it.each([
    ["a nested key", JSTN.schema({ a: { b: Number } }), { a: { b: "x" } }, "expected number, got string \"x\"", ["a", "b"]],
    ["an array index", JSTN.schema({ list: array(Number) }), { list: [1, true] }, "expected number, got boolean true", ["list", 1]],
    ["a quoted key", JSTN.schema({ "key with space": Number }), { "key with space": null }, "expected number, got null", ["key with space"]],
    ["a tuple slot", tuple(Number, String), [1, 2], "expected string, got number 2", [1]],
    ["a map entry", map(String, Number), new Map([["a", "b"]]), "expected number, got string \"b\"", [0, 1]],
    ["a missing key", JSTN.schema({ a: Number }), {}, "missing required key \"a\"", []],
    ["an unknown key", JSTN.schema({ a: optional(Number) }), { b: 1 }, "unknown key", ["b"]],
    ["the root", number, "1", "expected number, got string \"1\"", []],
    ["a union", union(Number, String), true, "expected union(number, string), got boolean true", []],
    ["a custom type", money, "12.50 GBP", "expected money, got string \"12.50 GBP\"", []],
    ["a custom collection item", sortedSet(Number), new Set([1]), "expected sortedSet(number), got Set", []],
  ] as [string, StandardSchemaV1, unknown, string, (string | number)[]][])("reports one issue with a path for %s", (_, schema, value, message, path) => {
    expect(validate(schema, value)).toStrictEqual({ issues: [{ message, path }] })
  })

  it("reports a failing custom stringify as an issue", () => {
    const broken = createType({ name: Money, parse: () => new Money("1", "GBP"), stringify: () => { throw new Error("boom") } })
    expect(validate(broken, new Money("1", "GBP"))).toStrictEqual({ issues: [{ message: "cannot stringify money: boom", path: [] }] })
  })

  it("agrees with JSTN.is", () => {
    const type = set(union(Number, { a: String }))
    for (const value of [new Set([1, { a: "x" }]), new Set([{ a: 1 }]), [1], null]) {
      expect(validate(type, value).issues === undefined).toBe(JSTN.is(value, type))
    }
  })
})
