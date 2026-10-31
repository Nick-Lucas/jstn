import { describe, expect, it } from "vitest"
import { JSTNError, describeNode, describeValue, formatPath, guard, mismatch } from "../../src/core/error.ts"
import type { Node } from "../../src/core/type.ts"

function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error("expected a throw")
}

describe("JSTNError", () => {
  it("carries every field and a positioned message", () => {
    const error = new JSTNError("expected number, got string \"x\"", ["someArr", 2], { line: 6, column: 16 })
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(JSTNError)
    expect(error.name).toBe("JSTNError")
    expect(error.reason).toBe("expected number, got string \"x\"")
    expect(error.path).toBe("$.someArr[2]")
    expect(error.segments).toStrictEqual(["someArr", 2])
    expect(Object.isFrozen(error.segments)).toBe(true)
    expect(error.line).toBe(6)
    expect(error.column).toBe(16)
    expect(error.message).toBe("$.someArr[2]: expected number, got string \"x\" (line 6, column 16)")
  })

  it("omits the position suffix without a position", () => {
    const error = new JSTNError("cannot stringify Money: boom", ["c"])
    expect(error.message).toBe("$.c: cannot stringify Money: boom")
    expect(error.line).toBeUndefined()
    expect(error.column).toBeUndefined()
  })

  it("preserves the cause", () => {
    const cause = new Error("inner")
    expect(new JSTNError("r", [], undefined, { cause }).cause).toBe(cause)
  })
})

describe("formatPath", () => {
  it.each([
    [[], "$"],
    [["a"], "$.a"],
    [["_x", "$y"], "$._x.$y"],
    [["with space"], "$[\"with space\"]"],
    [[""], "$[\"\"]"],
    [["a\"b"], "$[\"a\\\"b\"]"],
    [["a\u007fb"], "$[\"a\\u007fb\"]"],
    [["1a"], "$[\"1a\"]"],
    [[0], "$[0]"],
    [[3, 1], "$[3][1]"],
    [["a", 2, "with space", "b"], "$.a[2][\"with space\"].b"],
  ] as const)("formats %j as %s", (path, expected) => {
    expect(formatPath(path)).toBe(expected)
  })
})

class Point {
  x = 0
}

describe("describeValue", () => {
  const fits = "a".repeat(38)
  const tooLong = "a".repeat(39)
  const nullProto: object = Object.create(null)
  const anonymous: object = new (class {})()

  it.each([
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    ["true", true, "boolean true"],
    ["false", false, "boolean false"],
    ["integer", 3, "number 3"],
    ["fraction", -1.5, "number -1.5"],
    ["negative zero", -0, "number -0"],
    ["zero", 0, "number 0"],
    ["NaN", Number.NaN, "number NaN"],
    ["Infinity", Number.POSITIVE_INFINITY, "number Infinity"],
    ["bigint", 5n, "bigint 5n"],
    ["negative bigint", -5n, "bigint -5n"],
    ["string", "x", "string \"x\""],
    ["string with escapes", "a\nb", "string \"a\\nb\""],
    ["quoted form of exactly 40 characters", fits, `string "${fits}"`],
    ["quoted form past 40 characters", tooLong, `string "${tooLong}…`],
    ["array", [1, 2], "array"],
    ["Set", new Set([1]), "Set"],
    ["Map", new Map(), "Map"],
    ["plain object", { a: 1 }, "object"],
    ["null-prototype object", nullProto, "object"],
    ["class instance", new Point(), "Point"],
    ["anonymous class instance", anonymous, "object"],
    ["valid Date", new Date(0), "Date"],
    ["invalid Date", new Date(Number.NaN), "invalid Date"],
    ["boxed number", new Number(1), "Number"],
    ["function", () => 1, "function"],
    ["symbol", Symbol("s"), "symbol"],
  ])("%s", (_name, value, expected) => {
    expect(describeValue(value)).toBe(expected)
  })
})

describe("describeNode", () => {
  const pos = { line: 1, column: 1 }
  it.each<[string, Node, string]>([
    ["null", { kind: "null" }, "null"],
    ["boolean", { kind: "boolean", value: true, pos }, "boolean true"],
    ["number", { kind: "number", value: 3 }, "number 3"],
    ["negative zero", { kind: "number", value: -0 }, "number -0"],
    ["NaN", { kind: "number", value: Number.NaN }, "number NaN"],
    ["bigint", { kind: "bigint", value: 5n }, "bigint 5n"],
    ["string", { kind: "string", value: "x" }, "string \"x\""],
    ["long string", { kind: "string", value: "b".repeat(50) }, `string "${"b".repeat(39)}…`],
    ["tagged", { kind: "tagged", tag: "Money", payload: "1 GBP" }, "Money"],
    ["untagged list", { kind: "list", tag: null, items: [] }, "array"],
    ["tagged list", { kind: "list", tag: "Set", items: [{ kind: "number", value: 1 }] }, "Set"],
    ["object", { kind: "object", entries: [] }, "object"],
  ])("%s", (_name, node, expected) => {
    expect(describeNode(node)).toBe(expected)
  })
})

describe("mismatch", () => {
  it("builds an expected/got error with an optional position", () => {
    const error = mismatch("number | string", "boolean true", ["u"], { line: 2, column: 6 })
    expect(error).toBeInstanceOf(JSTNError)
    expect(error.message).toBe("$.u: expected number | string, got boolean true (line 2, column 6)")
    expect(mismatch("Date", "string \"2026-01-01\"", ["someDate"]).message).toBe(
      "$.someDate: expected Date, got string \"2026-01-01\"",
    )
  })
})

describe("guard", () => {
  it("returns the value on success", () => {
    expect(guard(() => 42, "prefix", [])).toBe(42)
  })

  it("wraps an Error, keeping its message and cause", () => {
    const cause = new Error("boom")
    const error = thrownBy(() => guard(() => { throw cause }, "cannot stringify Money", ["c"]))
    expect(error).toBeInstanceOf(JSTNError)
    expect(error).toHaveProperty("message", "$.c: cannot stringify Money: boom")
    expect(error).toHaveProperty("reason", "cannot stringify Money: boom")
    expect(error).toHaveProperty("cause", cause)
  })

  it.each([
    ["string", "bad", "invalid Money \"abc\": bad"],
    ["number", 7, "invalid Money \"abc\": 7"],
  ])("wraps a thrown %s with String(e)", (_name, thrown, reason) => {
    const error = thrownBy(() => guard(() => { throw thrown }, "invalid Money \"abc\"", []))
    expect(error).toBeInstanceOf(JSTNError)
    expect(error).toHaveProperty("reason", reason)
    expect(error).toHaveProperty("cause", thrown)
  })

  it("carries the path and position", () => {
    const error = thrownBy(() => guard(() => { throw new Error("nope") }, "invalid Money \"1\"", ["price"], { line: 2, column: 10 }))
    expect(error).toHaveProperty("message", "$.price: invalid Money \"1\": nope (line 2, column 10)")
    expect(error).toHaveProperty("path", "$.price")
    expect(error).toHaveProperty("line", 2)
    expect(error).toHaveProperty("column", 10)
  })
})
