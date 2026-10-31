import { describe, expect, it } from "vitest"
import { JSTN, JSTNError, array, createCollection, map, set, union } from "../../src/index.ts"
import type { Infer, Node, Schema } from "../../src/index.ts"
import { collectionInfo } from "../../src/types/collection.ts"
import { SortedSet, sortedSet } from "../support/fixtures.ts"

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

function str(value: string): Node {
  return { kind: "string", value }
}

function list(tag: string | null, ...items: Node[]): Node {
  return { kind: "list", tag, items }
}

const pos = { line: 1, column: 5 }

describe("array", () => {
  it("round-trips empty and nested arrays", () => {
    expect(array(Number).encode([], [])).toStrictEqual(list(null))
    const nested = array(array(Number))
    expect(nested.encode([[1], []], [])).toStrictEqual(list(null, list(null, num(1)), list(null)))
    expect(nested.decode(list(null, list(null, num(1)), list(null)), [])).toStrictEqual([[1], []])
  })

  it("round-trips arrays of objects", () => {
    const type = array({ a: Number })
    const value = [{ a: 1 }, { a: 2 }]
    expect(type.decode(type.encode(value, []), [])).toStrictEqual(value)
  })

  it("encodes a hole as undefined", () => {
    expect(fails(() => array(Number).encode([, 1], [])).message).toBe("$[0]: expected number, got undefined")
  })

  it("reports the index of a bad element", () => {
    expect(fails(() => array(Number).encode([1, 2, "x"], ["someArr"])).message).toBe("$.someArr[2]: expected number, got string \"x\"")
    const node: Node = { kind: "list", tag: null, items: [num(1), num(2), { kind: "string", value: "x", pos: { line: 6, column: 16 } }] }
    expect(fails(() => array(Number).decode(node, ["someArr"])).message).toBe("$.someArr[2]: expected number, got string \"x\" (line 6, column 16)")
  })

  it("rejects a tagged list and non-arrays", () => {
    expect(fails(() => array(Number).decode({ kind: "list", tag: "Set", items: [], pos }, [])).message).toBe(
      "$: expected number[], got Set (line 1, column 5)",
    )
    expect(fails(() => array(Number).encode(new Set([1]), [])).message).toBe("$: expected number[], got Set")
    expect(fails(() => array(Number).encode({ length: 0 }, [])).message).toBe("$: expected number[], got object")
  })

  it.each([
    [array(Number), "number[]"],
    [array(array(Number)), "number[][]"],
    [array(union(Number, String)), "(number | string)[]"],
    [array({ "a b": String }), "{ \"a b\": string }[]"],
  ])("names %#", (type, name) => {
    expect(type.name).toBe(name)
  })
})

describe("set", () => {
  it("round-trips the empty set", () => {
    expect(set(Number).encode(new Set(), [])).toStrictEqual(list("Set"))
    expect(set(Number).decode(list("Set"), [])).toStrictEqual(new Set())
  })

  it("keeps insertion order", () => {
    const node = set(Number).encode(new Set([3, 1, 2]), [])
    expect(node).toStrictEqual(list("Set", num(3), num(1), num(2)))
    expect([...set(Number).decode(node, [])]).toStrictEqual([3, 1, 2])
  })

  it("holds objects, and equal objects are not duplicates", () => {
    const type = set({ a: Number })
    const node = list("Set", { kind: "object", entries: [{ key: "a", value: num(1) }] }, { kind: "object", entries: [{ key: "a", value: num(1) }] })
    expect(type.decode(node, [])).toStrictEqual(new Set([{ a: 1 }, { a: 1 }]))
    expect(type.encode(new Set([{ a: 1 }, { a: 1 }]), [])).toStrictEqual(node)
  })

  it("rejects a duplicate on decode at the list position", () => {
    const error = fails(() => set(Number).decode({ kind: "list", tag: "Set", items: [num(1), num(1)], pos }, ["s"]))
    expect(error.message).toBe("$.s: invalid Set<number>: duplicate item (line 1, column 5)")
  })

  it("reports item paths in iteration order", () => {
    expect(fails(() => set(Number).encode(new Set([1, "x"]), [])).message).toBe("$[1]: expected number, got string \"x\"")
  })

  it("rejects a non-Set", () => {
    expect(fails(() => set(Number).encode([1], [])).message).toBe("$: expected Set<number>, got array")
    expect(fails(() => set(Number).decode({ kind: "list", tag: null, items: [], pos }, [])).message).toBe(
      "$: expected Set<number>, got array (line 1, column 5)",
    )
  })

  it("is named Set<number>", () => {
    expect(set(Number).name).toBe("Set<number>")
  })
})

describe("map", () => {
  it("round-trips the empty map", () => {
    expect(map(String, Number).encode(new Map(), [])).toStrictEqual(list("Map"))
    expect(map(String, Number).decode(list("Map"), [])).toStrictEqual(new Map())
  })

  it("encodes entries as pairs", () => {
    const node = list("Map", list(null, str("a"), num(1)), list(null, str("b"), num(2)))
    expect(map(String, Number).encode(new Map([["a", 1], ["b", 2]]), [])).toStrictEqual(node)
    expect(map(String, Number).decode(node, [])).toStrictEqual(new Map([["a", 1], ["b", 2]]))
  })

  it.each([
    ["object keys", map({ id: Number }, String), new Map([[{ id: 1 }, "x"]])],
    ["Date keys", map(Date, Boolean), new Map([[new Date(0), true], [new Date(1), false]])],
  ])("round-trips %s", (_, type, value) => {
    expect(type.decode(type.encode(value, []), [])).toStrictEqual(value)
  })

  it("reports key and value paths", () => {
    const type = map(String, Number)
    expect(fails(() => type.encode(new Map<unknown, unknown>([["a", 1], [2, 2]]), ["m"])).message).toBe("$.m[1][0]: expected string, got number 2")
    expect(fails(() => type.encode(new Map<unknown, unknown>([["a", "x"]]), ["m"])).message).toBe("$.m[0][1]: expected number, got string \"x\"")
  })

  it("rejects a duplicate key on decode", () => {
    const node: Node = { kind: "list", tag: "Map", items: [list(null, str("a"), num(1)), list(null, str("a"), num(2))], pos }
    expect(fails(() => map(String, Number).decode(node, ["m"])).message).toBe("$.m: invalid Map<string, number>: duplicate key (line 1, column 5)")
  })

  it("rejects an item that is not a pair", () => {
    const node: Node = { kind: "list", tag: "Map", items: [{ kind: "list", tag: null, items: [str("a")], pos: { line: 1, column: 6 } }], pos }
    expect(fails(() => map(String, Number).decode(node, [])).message).toBe("$[0]: expected 2 items, got 1 (line 1, column 6)")
  })

  it("rejects a non-Map", () => {
    expect(fails(() => map(String, Number).encode({ a: 1 }, [])).message).toBe("$: expected Map<string, number>, got object")
  })

  it("is named Map<string, number>", () => {
    expect(map(String, Number).name).toBe("Map<string, number>")
  })
})

describe("custom collection", () => {
  const type = sortedSet(Number)

  it("encodes with its tag and decodes to an instance", () => {
    const node = type.encode(new SortedSet([3, 1, 2]), [])
    expect(node).toStrictEqual(list("SortedSet", num(1), num(2), num(3)))
    const decoded = type.decode(node, [])
    expect(decoded).toBeInstanceOf(SortedSet)
    expect(decoded).toStrictEqual(new SortedSet([1, 2, 3]))
  })

  it("rejects the wrong tag", () => {
    expect(fails(() => type.decode({ kind: "list", tag: "Set", items: [], pos }, [])).message).toBe(
      "$: expected SortedSet<number>, got Set (line 1, column 5)",
    )
  })

  const failing = createCollection("SortedSet", <S extends Schema>(item: S) => ({
    items: item,
    match: (v: unknown) => v instanceof SortedSet,
    toItems: (): number[] => {
      throw new Error("no items")
    },
    fromItems: (): SortedSet<number> => {
      throw new Error("bad items")
    },
  }))

  it("wraps a throwing fromItems with its cause", () => {
    const error = fails(() => failing(Number).decode({ kind: "list", tag: "SortedSet", items: [num(1)], pos }, ["scores"]))
    expect(error.message).toBe("$.scores: invalid SortedSet<number>: bad items (line 1, column 5)")
    expect((error.cause as Error).message).toBe("bad items")
  })

  it("wraps a throwing toItems", () => {
    expect(fails(() => failing(Number).encode(new SortedSet([1]), ["scores"])).message).toBe("$.scores: cannot stringify SortedSet<number>: no items")
  })

  it("is named SortedSet<number>", () => {
    expect(type.name).toBe("SortedSet<number>")
    expect(sortedSet(union(Number, String)).name).toBe("SortedSet<number | string>")
  })

  it("validates through JSTN.is", () => {
    expect(JSTN.is(new SortedSet([1]), type)).toBe(true)
    expect(JSTN.is(new SortedSet(["x"]), type)).toBe(false)
    expect(JSTN.is(new Set([1]), type)).toBe(false)
  })
})

describe("createCollection validation", () => {
  const define = <S extends Schema>(item: S) => ({
    items: item,
    match: () => true,
    toItems: (v: Infer<S>[]) => v,
    fromItems: (items: Infer<S>[]) => items,
  })

  it.each(["null", "number", "NaN", "", "a b", "1x"])("rejects the name %o", (name) => {
    expect(fails(() => createCollection(name, define)).message).toBe(`$: invalid type name ${JSON.stringify(name)}`)
  })

  it("rejects a define with no parameters", () => {
    const error = fails(() => createCollection("X", () => define(Number)))
    expect(error.message).toBe("$: createCollection(\"X\") define must declare at least one parameter")
  })
})

describe("collectionInfo", () => {
  it.each([
    ["set", set, { name: "Set", arity: 1 }],
    ["map", map, { name: "Map", arity: 2 }],
    ["sortedSet", sortedSet, { name: "SortedSet", arity: 1 }],
  ])("describes %s", (_, fn, info) => {
    expect(collectionInfo(fn)).toStrictEqual(info)
  })

  it.each([
    ["array", array],
    ["Number", Number],
    ["an arrow function", () => set(Number)],
    ["a non-function", { name: "Set" }],
  ])("returns undefined for %s", (_, fn) => {
    expect(collectionInfo(fn)).toBeUndefined()
  })
})
