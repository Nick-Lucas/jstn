import { describe, expect, it } from "vitest"
import { JSTN, JSTNError, tuple, union } from "../../src/index.ts"
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

function list(...items: Node[]): Node {
  return { kind: "list", tag: null, items }
}

const pos = { line: 1, column: 5 }

describe("encode and decode", () => {
  it("round-trips [number, string]", () => {
    const type = tuple(Number, String)
    const node = list({ kind: "number", value: 1 }, { kind: "string", value: "x" })
    expect(type.encode([1, "x"], [])).toStrictEqual(node)
    expect(type.decode(node, [])).toStrictEqual([1, "x"])
  })

  it("round-trips the empty tuple", () => {
    const type = tuple()
    expect(type.encode([], [])).toStrictEqual(list())
    expect(type.decode(list(), [])).toStrictEqual([])
  })

  it("round-trips nested tuples", () => {
    const type = tuple(tuple(Number), tuple(Boolean, null))
    const value = [[1], [true, null]]
    expect(type.decode(type.encode(value, []), [])).toStrictEqual(value)
  })

  it("round-trips a tuple of objects", () => {
    const type = tuple({ a: Number }, { b: String })
    const value = [{ a: 1 }, { b: "x" }]
    expect(type.encode(value, [])).toStrictEqual(
      list(
        { kind: "object", entries: [{ key: "a", value: { kind: "number", value: 1 } }] },
        { kind: "object", entries: [{ key: "b", value: { kind: "string", value: "x" } }] },
      ),
    )
    expect(type.decode(type.encode(value, []), [])).toStrictEqual(value)
  })
})

describe("length mismatch", () => {
  const type = tuple(Number, String)

  it.each([
    [[1, "x", 2], "$.t: expected 2 items, got 3"],
    [[1], "$.t: expected 2 items, got 1"],
  ])("rejects %o on encode", (value, message) => {
    expect(fails(() => type.encode(value, ["t"])).message).toBe(message)
  })

  it.each([
    [[{ kind: "number", value: 1 }, { kind: "string", value: "x" }, { kind: "number", value: 2 }] as Node[], "$.t: expected 2 items, got 3 (line 1, column 5)"],
    [[{ kind: "number", value: 1 }] as Node[], "$.t: expected 2 items, got 1 (line 1, column 5)"],
  ])("rejects %o on decode with the list position", (items, message) => {
    expect(fails(() => type.decode({ kind: "list", tag: null, items, pos }, ["t"])).message).toBe(message)
  })
})

describe("element errors", () => {
  const type = tuple(Number, String)

  it("carries the index path on encode", () => {
    expect(fails(() => type.encode([1, 2], [])).message).toBe("$[1]: expected string, got number 2")
  })

  it("carries the index path on decode", () => {
    const node: Node = { kind: "list", tag: null, items: [{ kind: "number", value: 1 }, { kind: "null", pos: { line: 1, column: 9 } }], pos }
    expect(fails(() => type.decode(node, [])).message).toBe("$[1]: expected string, got null (line 1, column 9)")
  })

  it("encodes an array hole as undefined", () => {
    expect(fails(() => type.encode([1, , ], [])).message).toBe("$[1]: expected string, got undefined")
  })

  it("rejects a tagged list", () => {
    const error = fails(() => type.decode({ kind: "list", tag: "Set", items: [], pos }, ["t"]))
    expect(error.message).toBe("$.t: expected tuple(number, string), got Set (line 1, column 5)")
  })

  it.each([
    ["a string", "1,x", "string \"1,x\""],
    ["a Set", new Set([1, "x"]), "Set"],
    ["an object", { 0: 1, 1: "x" }, "object"],
  ])("rejects %s on encode", (_, value, got) => {
    expect(fails(() => type.encode(value, [])).message).toBe(`$: expected tuple(number, string), got ${got}`)
  })

  it("is usable through validate and is", () => {
    expect(JSTN.is([1, "x"], type)).toBe(true)
    expect(JSTN.is([1, "x", 2], type)).toBe(false)
  })
})

describe("names", () => {
  it.each([
    [tuple(Number, String), "tuple(number, string)"],
    [tuple(), "tuple()"],
    [tuple(union(Number, String), Date), "tuple(union(number, string), date)"],
    [tuple(tuple(), { a: null }), "tuple(tuple(), { a: null })"],
  ])("names %#", (type, name) => {
    expect(type.name).toBe(name)
  })
})
