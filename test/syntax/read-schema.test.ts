import { describe, expect, it } from "vitest"
import { JSTN, JSTNError, bigint, boolean, date, number, string } from "../../src/index.ts"
import type { Registry } from "../../src/index.ts"
import { Money, S, SortedSet, money, registry, sampleSchemaText, sampleValue } from "../support/fixtures.ts"

function read(text: string, types: Registry = registry) {
  return JSTN.parseSchema(text, { types })
}

function failure(run: () => unknown) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(JSTNError)
    const { message, path, line, column } = error as JSTNError
    return { message, path, line, column }
  }
  throw new Error("expected a JSTNError")
}

describe("productions", () => {
  it.each([
    ["number", number],
    ["string", string],
    ["boolean", boolean],
    ["bigint", bigint],
    ["Date", date],
  ])("resolves the built-in %s to the builder type", (text, type) => {
    expect(read(text)).toBe(type)
  })

  it("resolves null to the null type", () => {
    const type = read("null")
    expect(type.name).toBe("null")
    expect(JSTN.parse("null", type)).toBe(null)
    expect(JSTN.is(0, type)).toBe(false)
  })

  it.each([
    ["number[]", "number[]", "[1, 2]", [1, 2]],
    ["number[][]", "number[][]", "[[1], []]", [[1], []]],
    ["[number, string]", "[number, string]", "[1, \"a\"]", [1, "a"]],
    ["[number, string,]", "[number, string]", "[1, \"a\"]", [1, "a"]],
    ["[]", "[]", "[]", []],
    ["[[number]]", "[[number]]", "[[1]]", [[1]]],
    ["{}", "{}", "{}", {}],
    ["{ a: number, b?: string, }", "{ a: number, b?: string }", "{a: 1}", { a: 1 }],
    ["{ \"a b\": number, 'c': boolean }", "{ \"a b\": number, c: boolean }", "{\"a b\": 1, c: true}", { "a b": 1, c: true }],
    ["{ null: number, true?: number }", "{ null: number, true?: number }", "{null: 1}", { null: 1 }],
    ["(number)", "number", "1", 1],
    ["((number | string))[]", "(number | string)[]", "[1, \"a\"]", [1, "a"]],
    ["| number | string", "number | string", "\"a\"", "a"],
    ["{ a: | number | null }", "{ a: number | null }", "{a: null}", { a: null }],
  ])("reads %s", (text, name, data, value) => {
    const type = read(text)
    expect(type.name).toBe(name)
    expect(JSTN.parse(data, type)).toStrictEqual(value)
  })

  it("makes a single-member union that member", () => {
    expect(read("| number")).toBe(number)
    expect(read("(| string)")).toBe(string)
  })

  it("keeps a __proto__ field as an own key", () => {
    const type = read("{ \"__proto__\": number }")
    const value = JSTN.parse("{\"__proto__\": 1}", type)
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(Object.keys(value as object)).toStrictEqual(["__proto__"])
  })

  it("allows comments and newlines between every token", () => {
    const text = [
      "/* lead */ | // pipe",
      "{ // open",
      "  a /* key */ ? /* mark */ : /* colon */ Set /* tag */ < /* lt */ number /* arg */ , /* comma */ > /* gt */ [ /* l */ ] , // after",
      "  'b' : ( /* paren */ [ /* tuple */ string /* item */ , /* c */ ] /* close */ ) ,",
      "} /* close */ | /* pipe */ null // end",
    ].join("\r\n")
    expect(read(text).name).toBe("{ a?: Set<number>[], b: [string] } | null")
  })
})

describe("precedence", () => {
  it("binds [] tighter than |", () => {
    const type = read("number | string[]")
    expect(type.name).toBe("number | string[]")
    expect(JSTN.is(1, type)).toBe(true)
    expect(JSTN.is(["a"], type)).toBe(true)
    expect(JSTN.is([1], type)).toBe(false)
    expect(JSTN.is("a", type)).toBe(false)
  })

  it("lets parentheses group a union under []", () => {
    const type = read("(number | string)[]")
    expect(type.name).toBe("(number | string)[]")
    expect(JSTN.is([1, "a"], type)).toBe(true)
    expect(JSTN.is(1, type)).toBe(false)
  })

  it("flattens nested unions", () => {
    expect(read("(number | string) | (boolean | null)").name).toBe("number | string | boolean | null")
  })
})

describe("generics", () => {
  it.each([
    ["Set<number>", "Set<number>"],
    ["Set<number,>", "Set<number>"],
    ["Map<string, Set<Date>>", "Map<string, Set<Date>>"],
    ["Map<string,number,>", "Map<string, number>"],
    ["Set<number | string>", "Set<number | string>"],
    ["Set<{ a: number }>[]", "Set<{ a: number }>[]"],
  ])("reads %s", (text, name) => {
    expect(read(text).name).toBe(name)
  })

  it("builds working collections", () => {
    const type = read("Map<string, Set<Date>>")
    const value = new Map([["k", new Set([new Date(0)])]])
    const text = JSTN.stringify(value, type)
    expect(text).toBe("Map[[\"k\",Set[Date(1970-01-01T00:00:00Z)]]]")
    expect(JSTN.parse(text, type)).toStrictEqual(value)
  })
})

describe("registry", () => {
  it("uses a bare Type", () => {
    expect(read("Money")).toBe(money)
    expect(JSTN.parse("[Money(1 GBP)]", read("Money[]"))).toStrictEqual([new Money("1", "GBP")])
  })

  it.each([
    ["a shorthand constructor", { Num: Number }, "Num", "number"],
    ["an object shape", { Point: { x: Number, y: Number } }, "Point", "{ x: number, y: number }"],
    ["null", { Nothing: null }, "Nothing", "null"],
    ["a collection factory with arguments", registry, "SortedSet<number>", "SortedSet<number>"],
    ["a registered name inside other syntax", registry, "{ m?: Money | Note }[]", "{ m?: Money | Note }[]"],
  ])("uses %s", (_, types, text, name) => {
    expect(read(text, types).name).toBe(name)
  })

  it("builds a working custom collection", () => {
    const type = read("SortedSet<number>")
    expect(JSTN.parse("SortedSet[3, 1, 2]", type)).toStrictEqual(new SortedSet([1, 2, 3]))
  })

  it.each(["constructor", "toString", "valueOf", "hasOwnProperty"])("registers %s, a name on Object.prototype", (name) => {
    expect(read(name, { [name]: Number }).name).toBe("number")
  })

  it("parses with no options at all", () => {
    expect(JSTN.parseSchema("Set<number>").name).toBe("Set<number>")
  })
})

describe("errors", () => {
  it.each([
    ["an unknown name", "{\n  a: number,\n  b: User,\n}", "$: unknown type \"User\" (line 3, column 6)"],
    ["an unknown name with arguments", "User<number>", "$: unknown type \"User\" (line 1, column 1)"],
    ["a keyword name", "NaN", "$: unknown type \"NaN\" (line 1, column 1)"],
    ["arguments on a scalar", "number<string>", "$: \"number\" does not take type arguments (line 1, column 1)"],
    ["arguments on a registered type", "[Money<number>]", "$: \"Money\" does not take type arguments (line 1, column 2)"],
    ["a bare Set", "Set", "$: \"Set\" requires 1 type argument (line 1, column 1)"],
    ["a bare Map", "{ m: Map }", "$: \"Map\" requires 2 type arguments (line 1, column 6)"],
    ["a bare custom collection", "SortedSet[]", "$: \"SortedSet\" requires 1 type argument (line 1, column 1)"],
    ["too few arguments", "Map<string>", "$: \"Map\" expects 2 type arguments, got 1 (line 1, column 1)"],
    ["too many arguments", "  Set<number, string>", "$: \"Set\" expects 1 type argument, got 2 (line 1, column 3)"],
    ["no arguments", "Set<>", "$: \"Set\" expects 1 type argument, got 0 (line 1, column 1)"],
    ["a duplicate field", "{ a: number,\n  a: string }", "$: duplicate key \"a\" (line 2, column 3)"],
    ["a duplicate quoted field", "{ a: number, \"a\"?: string }", "$: duplicate key \"a\" (line 1, column 14)"],
    ["a number token", "1", "$: unexpected number 1, expected type (line 1, column 1)"],
    ["a string token", "\"number\"", "$: unexpected string \"number\", expected type (line 1, column 1)"],
    ["a bigint token", "{ a: 1n }", "$: unexpected bigint 1n, expected type (line 1, column 6)"],
    ["an empty document", "", "$: unexpected end of input, expected type (line 1, column 1)"],
    ["a dangling |", "number |", "$: unexpected end of input, expected type (line 1, column 9)"],
    ["a double |", "| | number", "$: unexpected \"|\", expected type (line 1, column 3)"],
    ["a number key", "{ 1: number }", "$: unexpected number 1, expected key (line 1, column 3)"],
    ["a missing colon", "{ a number }", "$: unexpected identifier \"number\", expected \":\" (line 1, column 5)"],
    ["a missing comma", "{ a: number b: string }", "$: unexpected identifier \"b\", expected \",\" or \"}\" (line 1, column 13)"],
    ["an unclosed object", "{ a: number", "$: unexpected end of input, expected \",\" or \"}\" (line 1, column 12)"],
    ["an unclosed tuple", "[number", "$: unexpected end of input, expected \",\" or \"]\" (line 1, column 8)"],
    ["an unclosed argument list", "Set<number", "$: unexpected end of input, expected \",\" or \">\" (line 1, column 11)"],
    ["an unclosed parenthesis", "(number", "$: unexpected end of input, expected \")\" (line 1, column 8)"],
    ["an index inside []", "number[string]", "$: unexpected identifier \"string\", expected \"]\" (line 1, column 8)"],
    ["trailing content", "number\nstring", "$: unexpected identifier \"string\", expected end of input (line 2, column 1)"],
    ["a trailing ?", "number?", "$: unexpected \"?\", expected end of input (line 1, column 7)"],
    ["a lexical error", "{ a: @ }", "$: unexpected character \"@\" (line 1, column 6)"],
    ["an empty comma list", "[,]", "$: unexpected \",\", expected type (line 1, column 2)"],
  ])("rejects %s", (_, text, message) => {
    expect(failure(() => read(text)).message).toBe(message)
  })

  it.each(["number", "string", "boolean", "bigint", "null", "Date", "Set", "Map"])(
    "rejects redefining the built-in %s without a position",
    (name) => {
      expect(failure(() => read("number", { [name]: money }))).toStrictEqual({
        message: `$: cannot redefine built-in type "${name}"`,
        path: "$",
        line: undefined,
        column: undefined,
      })
    },
  )

  it.each([
    [{ "x y": money }, "$: invalid type name \"x y\""],
    [{ "": money }, "$: invalid type name \"\""],
    [{ "1x": money }, "$: invalid type name \"1x\""],
    [{ Fn: () => money }, "$: \"Fn\" is not a schema or collection"],
    [{ Three: 3 as unknown as Registry[string] }, "$: not a schema: number 3"],
  ])("rejects the registry %o before reading", (types, message) => {
    expect(failure(() => read("[", types))).toStrictEqual({ message, path: "$", line: undefined, column: undefined })
  })

  it("rejects a factory that does not return a type where it is used", () => {
    const types = { Arr: Array as unknown as Registry[string] }
    expect(failure(() => read("{ a: Arr<number> }", types))).toStrictEqual({ message: "$: \"Arr\" did not return a type (line 1, column 6)", path: "$", line: 1, column: 6 })
  })
})

describe("text and builder schemas", () => {
  const text = read(sampleSchemaText)

  it("have the same name", () => {
    expect(text.name).toBe(S.name)
  })

  it.each([[undefined], [2], ["\t"]])("stringify the sample value identically with space %o", (space) => {
    expect(JSTN.stringify(sampleValue, text, space)).toBe(JSTN.stringify(sampleValue, S, space))
  })

  it("parse the sample back identically", () => {
    const data = JSTN.stringify(sampleValue, S, 2)
    expect(JSTN.parse(data, text)).toStrictEqual(JSTN.parse(data, S))
  })
})

describe("depth", () => {
  it.each([
    ["tuples", "[", "]", 513],
    ["parentheses", "(", ")", 513],
    ["objects", "{a:", "}", 1537],
    ["type arguments", "Set<", ">", 2052],
  ])("accepts 512 levels of %s and rejects 513", (_, open, close, column) => {
    const nest = (levels: number) => `${open.repeat(levels)}number${close.repeat(levels)}`
    expect(() => read(nest(512))).not.toThrow()
    expect(failure(() => read(nest(513))).message).toBe(
      `$: nesting deeper than 512 levels (line 1, column ${column})`,
    )
  })

  it("counts array suffixes", () => {
    expect(read(`number${"[]".repeat(512)}`).name).toBe(`number${"[]".repeat(512)}`)
    expect(failure(() => read(`number${"[]".repeat(513)}`)).message).toBe("$: nesting deeper than 512 levels (line 1, column 1031)")
    expect(failure(() => read(`{a:number${"[]".repeat(512)}}`)).message).toBe("$: nesting deeper than 512 levels (line 1, column 1032)")
  })
})
