import { describe, expect, it } from "vitest"
import { JSTN, JSTNError, array, createType, date, map, optional, set, tuple, union } from "../src/index.ts"
import type { Type } from "../src/index.ts"
import { Money, Note, S, SortedSet, registry, sampleSchemaText, sampleValue } from "./support/fixtures.ts"

const pretty = `{
  someNum: 1,
  someStr: "value",
  someDate: Date(2026-01-01T14:00:00Z),
  someObj: {
    inner: true,
  },
  someArr: [1, 2, 3],
  someTuple: [1, "value"],
  someUnion: 3,
  customVal: Money(12.50 GBP),
  big: 123n,
  tags: Set["a", "b"],
  lookup: Map[
    [
      "x",
      {
        a: 1,
      },
    ],
  ],
  scores: SortedSet[1, 2, 3],
  nothing: null,
  "key with space": "here",
}`

const compact =
  "{someNum:1,someStr:\"value\",someDate:Date(2026-01-01T14:00:00Z),someObj:{inner:true},someArr:[1,2,3]," +
  "someTuple:[1,\"value\"],someUnion:3,customVal:Money(12.50 GBP),big:123n,tags:Set[\"a\",\"b\"]," +
  "lookup:Map[[\"x\",{a:1}]],scores:SortedSet[1,2,3],nothing:null,\"key with space\":\"here\"}"

const requestSample = `{
  someNum: 1,
  someStr: "value",
  someDate: Date(2026-01-01T14:00:00Z),
  someObj: { inner: true },
  someArr: [1, 2, 3],
  someTuple: [1, "value"],
  someUnion: 3,
  customVal: Money(12.50 GBP),
  big: 123n,
  tags: Set["a", "b"],
  lookup: Map[["x", { a: 1 }]],
  scores: SortedSet[1, 2, 3],
  nothing: null,
  "key with space": "here"
}`

function failure(run: () => unknown): JSTNError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(JSTNError)
    return error as JSTNError
  }
  throw new Error("expected a JSTNError")
}

describe("the request's call forms", () => {
  it("stringifies with two-space indentation exactly as the plan shows", () => {
    expect(JSTN.stringify(sampleValue, S, 2)).toBe(pretty)
  })

  it("stringifies compactly without a space argument", () => {
    expect(JSTN.stringify(sampleValue, S)).toBe(compact)
  })

  it.each([["pretty", pretty], ["compact", compact], ["request sample", requestSample]])("parses the %s text", (_, text) => {
    const value = JSTN.parse(text, S)
    expect(value).toStrictEqual(sampleValue)
    expect(value.someDate).toBeInstanceOf(Date)
    expect(value.customVal).toBeInstanceOf(Money)
    expect(value.scores).toBeInstanceOf(SortedSet)
  })

  it.each([
    ["a tab", "\t", "{\n\ta: [1],\n}"],
    ["a fractional number", 2.7, "{\n  a: [1],\n}"],
    ["a number above 10", 20, `{\n${" ".repeat(10)}a: [1],\n}`],
  ])("indents with %s", (_, space, text) => {
    expect(JSTN.stringify({ a: [1] }, { a: array(Number) }, space)).toBe(text)
  })

  it("omits an absent optional key and parses it back as absent", () => {
    const { "key with space": _, ...rest } = sampleValue
    const text = JSTN.stringify(rest, S)
    expect(text).not.toContain("key with space")
    expect(JSTN.parse(text, S)).toStrictEqual(rest)
  })
})

describe("schema forms", () => {
  it("accepts inline literal schemas", () => {
    const schema = { a: Number, b: array(String), c: { d: optional(Boolean) } }
    expect(JSTN.parse("{a: 1, b: ['x'], c: {}}", schema)).toStrictEqual({ a: 1, b: ["x"], c: {} })
    expect(JSTN.stringify({ a: 1, b: ["x"], c: { d: true } }, schema)).toBe("{a:1,b:[\"x\"],c:{d:true}}")
  })

  it.each([
    ["Number", Number, "-0", -0],
    ["String", String, "'hi'", "hi"],
    ["Boolean", Boolean, "false", false],
    ["BigInt", BigInt, "-12n", -12n],
    ["Date", Date, "Date(2026-01-01)", new Date(Date.UTC(2026, 0, 1))],
    ["null", null, "null", null],
  ])("accepts the shorthand %s", (_, schema, text, value) => {
    const type: Type<unknown> = JSTN.schema(schema)
    expect(JSTN.parse(text, schema)).toStrictEqual(value)
    expect(JSTN.parse(JSTN.stringify(value, type), type)).toStrictEqual(value)
  })

  it("returns a reusable type from JSTN.schema", () => {
    const point = JSTN.schema({ x: Number, y: Number })
    expect(point.name).toBe("{ x: number, y: number }")
    expect(JSTN.schema(point)).toBe(point)
    expect(JSTN.parse("[{x: 1, y: 2}]", array(point))).toStrictEqual([{ x: 1, y: 2 }])
  })
})

describe("validate and is", () => {
  it("returns the same reference from validate", () => {
    const value = { a: [1, 2] }
    expect(JSTN.validate(value, { a: array(Number) })).toBe(value)
  })

  it("throws from validate on a mismatch", () => {
    const error = failure(() => JSTN.validate({ a: [1, "2"] }, { a: array(Number) }))
    expect(error.message).toBe("$.a[1]: expected number, got string \"2\"")
  })

  it.each([
    [1, Number, true],
    ["1", Number, false],
    [new Set([1]), set(Number), true],
    [new Set(["1"]), set(Number), false],
    [new Map([[new Date(0), 1]]), map(date, Number), true],
    [[1, "a"], tuple(Number, String), true],
    [[1, "a", 2], tuple(Number, String), false],
    [null, union(Number, null), true],
    [{ a: 1, b: 2 }, { a: Number }, false],
  ])("is(%o) gives %s", (value, schema, expected) => {
    expect(JSTN.is(value, schema as Type<unknown>)).toBe(!!expected)
  })

  it("narrows with is", () => {
    const input: unknown = { someNum: 1 }
    if (JSTN.is(input, { someNum: Number })) expect(input.someNum).toBe(1)
    else throw new Error("expected is to accept the value")
  })

  it("rethrows errors that are not JSTNError", () => {
    const boom = new TypeError("match exploded")
    const exploding = createType<Note>({
      name: "Exploding",
      match: () => {
        throw boom
      },
      parse: (text) => new Note(text),
      stringify: (n) => n.text,
    })
    expect(() => JSTN.is(new Note("x"), exploding)).toThrow(boom)
  })
})

describe("parseSchema", () => {
  it("parses and stringifies with a registry-backed text schema", () => {
    const type = JSTN.parseSchema(sampleSchemaText, { types: registry })
    expect(JSTN.stringify(sampleValue, type, 2)).toBe(pretty)
    expect(JSTN.parse(pretty, type)).toStrictEqual(sampleValue)
  })
})

describe("stringify errors", () => {
  it("carries a path and no position", () => {
    const error = failure(() => JSTN.stringify({ ...sampleValue, someArr: [1, "x"] } as never, S))
    expect(error.message).toBe("$.someArr[1]: expected number, got string \"x\"")
    expect(error.path).toBe("$.someArr[1]")
    expect(error.line).toBeUndefined()
    expect(error.column).toBeUndefined()
  })
})

describe("deep nesting", () => {
  const kinds: [string, (type: Type<unknown>) => Type<unknown>, (value: unknown) => unknown, string][] = [
    ["arrays", (type) => array(type), (value) => [value], "[0]"],
    ["tuples", (type) => tuple(type), (value) => [value], "[0]"],
    ["objects", (type) => JSTN.schema({ a: type }), (value) => ({ a: value }), ".a"],
  ]

  function nest(levels: number, wrapType: (type: Type<unknown>) => Type<unknown>, wrapValue: (value: unknown) => unknown): [Type<unknown>, unknown] {
    let type: Type<unknown> = JSTN.schema(Number)
    let value: unknown = 1
    for (let i = 0; i < levels; i++) {
      type = wrapType(type)
      value = wrapValue(value)
    }
    return [type, value]
  }

  it.each(kinds)("stringifies 512 levels of %s and refuses 513, as parse does", (_, wrapType, wrapValue, step) => {
    const [type, value] = nest(512, wrapType, wrapValue)
    expect(JSTN.parse(JSTN.stringify(value, type), type)).toStrictEqual(value)
    const [deeper, deeperValue] = nest(513, wrapType, wrapValue)
    const message = `$${step.repeat(512)}: nesting deeper than 512 levels`
    expect(failure(() => JSTN.stringify(deeperValue, deeper)).message).toBe(message)
    expect(failure(() => JSTN.validate(deeperValue, deeper)).message).toBe(message)
    expect(JSTN.is(deeperValue, deeper)).toBe(false)
  })

  it("fails with a JSTNError instead of overflowing the stack", () => {
    const [type, value] = nest(20000, (t) => array(t), (v) => [v])
    expect(JSTN.is(value, type)).toBe(false)
    expect(failure(() => JSTN.stringify(value, type)).reason).toBe("nesting deeper than 512 levels")
  })

  it("round-trips a 200-level nested array", () => {
    let type: Type<unknown> = JSTN.schema(Number)
    let value: unknown = 1
    for (let i = 0; i < 200; i++) {
      type = array(type)
      value = [value]
    }
    for (const space of [undefined, 2]) {
      const text = JSTN.stringify(value, type, space)
      expect(JSTN.parse(text, type)).toStrictEqual(value)
    }
  })
})
