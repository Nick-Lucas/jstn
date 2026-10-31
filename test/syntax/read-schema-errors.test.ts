import { describe, expect, it } from "vitest"
import { JSTN, JSTNError, tuple } from "../../src/index.ts"
import type { Registry, Type } from "../../src/index.ts"
import { money, registry } from "../support/fixtures.ts"

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

function rejects(cases: [string, string, string][]) {
  it.each(cases)("rejects %s", (_, text, message) => {
    expect(failure(() => read(text)).message).toBe(message)
  })
}

describe("names", () => {
  rejects([
    ["an unknown name", "{\n  a: number,\n  b: User,\n}", "$: unknown type \"User\" (line 3, column 6)"],
    ["an unknown name with arguments", "User(number)", "$: unknown type \"User\" (line 1, column 1)"],
    ["an unknown name inside arguments", "map(string, array(User))", "$: unknown type \"User\" (line 1, column 19)"],
    ["a keyword name", "NaN", "$: unknown type \"NaN\" (line 1, column 1)"],
    ["undefined", "undefined", "$: unknown type \"undefined\" (line 1, column 1)"],
    ["the old Set syntax", "Set<number>", "$: unknown type \"Set\" (line 1, column 1)"],
    ["the old Map syntax", "{ m: Map<string, number> }", "$: unknown type \"Map\" (line 1, column 6)"],
    ["a registered tag instead of its identifier", "Money", "$: unknown type \"Money\" (line 1, column 1)"],
    ["calling a scalar", "number(string)", "$: \"number\" is not a function (line 1, column 1)"],
    ["calling null", "null()", "$: \"null\" is not a function (line 1, column 1)"],
    ["calling a constructor shorthand", "{ d: Date() }", "$: \"Date\" is not a function (line 1, column 6)"],
    ["calling a registered type", "array(money(number))", "$: \"money\" is not a function (line 1, column 7)"],
    ["calling a type after a comment", "number /* c */ ()", "$: \"number\" is not a function (line 1, column 1)"],
    ["a bare array", "array", "$: \"array\" must be called (line 1, column 1)"],
    ["a bare map", "{ m: map }", "$: \"map\" must be called (line 1, column 6)"],
    ["a bare tuple", "tuple", "$: \"tuple\" must be called (line 1, column 1)"],
    ["a bare optional field", "{ a: optional }", "$: \"optional\" must be called (line 1, column 6)"],
    ["a bare custom collection", "array(sortedSet)", "$: \"sortedSet\" must be called (line 1, column 7)"],
    ["brackets after a builder", "array[number]", "$: \"array\" must be called (line 1, column 1)"],
  ])
})

describe("arity", () => {
  rejects([
    ["too few map arguments", "map(string)", "$: \"map\" expects 2 arguments, got 1 (line 1, column 1)"],
    ["too many set arguments", "  set(number, string)", "$: \"set\" expects 1 argument, got 2 (line 1, column 3)"],
    ["no array argument", "array()", "$: \"array\" expects 1 argument, got 0 (line 1, column 1)"],
    ["a one-member union", "{ u: union(number) }", "$: \"union\" expects at least 2 arguments, got 1 (line 1, column 6)"],
    ["an empty union", "union()", "$: \"union\" expects at least 2 arguments, got 0 (line 1, column 1)"],
    ["an empty optional", "{ a: optional() }", "$: \"optional\" expects 1 argument, got 0 (line 1, column 6)"],
    ["too many optional arguments", "{ a: optional(number, string) }", "$: \"optional\" expects 1 argument, got 2 (line 1, column 6)"],
    ["no custom collection argument", "sortedSet()", "$: \"sortedSet\" expects 1 argument, got 0 (line 1, column 1)"],
    ["too many custom collection arguments", "sortedSet(number, number)", "$: \"sortedSet\" expects 1 argument, got 2 (line 1, column 1)"],
  ])
})

describe("optional placement", () => {
  rejects([
    ["optional at the top level", "optional(number)", "$: optional() is only valid as an object field (line 1, column 1)"],
    ["optional as an array item", "array(optional(number))", "$: optional() is only valid as an object field (line 1, column 7)"],
    ["optional nested under a field", "{ a: array(optional(number)) }", "$: optional() is only valid as an object field (line 1, column 12)"],
    ["optional as a tuple item", "tuple(number, optional(string))", "$: optional() is only valid as an object field (line 1, column 15)"],
    ["optional as a union member", "union(optional(number), string)", "$: optional() is only valid as an object field (line 1, column 7)"],
    ["optional inside optional", "{ a: optional(optional(number)) }", "$: optional() is only valid as an object field (line 1, column 15)"],
    ["optional as a map key", "map(optional(string), number)", "$: optional() is only valid as an object field (line 1, column 5)"],
    ["optional as a custom collection item", "sortedSet(optional(number))", "$: optional() is only valid as an object field (line 1, column 11)"],
  ])
})

describe("syntax", () => {
  rejects([
    ["a duplicate field", "{ a: number,\n  a: string }", "$: duplicate key \"a\" (line 2, column 3)"],
    ["a duplicate quoted field", "{ a: number, \"a\": optional(string) }", "$: duplicate key \"a\" (line 1, column 14)"],
    ["a number token", "1", "$: unexpected number 1, expected schema (line 1, column 1)"],
    ["a string token", "\"number\"", "$: unexpected string \"number\", expected schema (line 1, column 1)"],
    ["a bigint token", "{ a: 1n }", "$: unexpected bigint 1n, expected schema (line 1, column 6)"],
    ["an empty document", "", "$: unexpected end of input, expected schema (line 1, column 1)"],
    ["a grouping parenthesis", "(number)", "$: unexpected \"(\", expected schema (line 1, column 1)"],
    ["the old tuple syntax", "[number, string]", "$: unexpected \"[\", expected schema (line 1, column 1)"],
    ["the old array suffix", "number[]", "$: unexpected \"[\", expected end of input (line 1, column 7)"],
    ["the old union syntax", "number | string", "$: unexpected character \"|\" (line 1, column 8)"],
    ["a leading |", "| number", "$: unexpected character \"|\" (line 1, column 1)"],
    ["the old optional field syntax", "{ a?: number }", "$: unexpected character \"?\" (line 1, column 4)"],
    ["a nested generic close", "map(string, set(number>>", "$: unexpected character \">\" (line 1, column 23)"],
    ["a number key", "{ 1: number }", "$: unexpected number 1, expected key (line 1, column 3)"],
    ["a missing colon", "{ a number }", "$: unexpected identifier \"number\", expected \":\" (line 1, column 5)"],
    ["a missing comma", "{ a: number b: string }", "$: unexpected identifier \"b\", expected \",\" or \"}\" (line 1, column 13)"],
    ["a missing argument comma", "map(string number)", "$: unexpected identifier \"number\", expected \",\" or \")\" (line 1, column 12)"],
    ["an unclosed object", "{ a: number", "$: unexpected end of input, expected \",\" or \"}\" (line 1, column 12)"],
    ["an unclosed call", "tuple(number", "$: unexpected end of input, expected \",\" or \")\" (line 1, column 13)"],
    ["a mismatched closer", "array(number}", "$: unexpected \"}\", expected \",\" or \")\" (line 1, column 13)"],
    ["an extra closer", "array(number))", "$: unexpected \")\", expected end of input (line 1, column 14)"],
    ["trailing content", "number\nstring", "$: unexpected identifier \"string\", expected end of input (line 2, column 1)"],
    ["a lexical error", "{ a: @ }", "$: unexpected character \"@\" (line 1, column 6)"],
    ["an empty comma list", "tuple(,)", "$: unexpected \",\", expected schema (line 1, column 7)"],
    ["a double trailing comma", "set(number,,)", "$: unexpected \",\", expected schema (line 1, column 12)"],
  ])
})

describe("registry checks", () => {
  it.each(["number", "string", "boolean", "bigint", "null", "date", "array", "set", "map", "tuple", "union", "optional", "Number", "String", "Boolean", "BigInt", "Date"])(
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
    [{ NaN: money }, "$: invalid type name \"NaN\""],
    [{ true: money }, "$: invalid type name \"true\""],
    [{ Fn: () => money }, "$: \"Fn\" is not a schema or collection"],
    [{ Three: 3 as unknown as Registry[string] }, "$: not a schema: number 3"],
  ])("rejects the registry %o before reading", (types, message) => {
    expect(failure(() => read("[", types))).toStrictEqual({ message, path: "$", line: undefined, column: undefined })
  })

  it("accepts any identifier key that is not a keyword or built-in", () => {
    expect(JSTN.parseSchema("{ a: True, b: BIGINT }", { types: { True: money, BIGINT: money } }).name).toBe("{ a: money, b: money }")
  })

  it("rejects a factory that does not return a type where it is used", () => {
    const types = { arr: Array as unknown as Registry[string] }
    expect(failure(() => read("{ a: arr(number) }", types))).toStrictEqual({ message: "$: \"arr\" did not return a type (line 1, column 6)", path: "$", line: 1, column: 6 })
  })

  it("rejects a two-argument factory called with one argument", () => {
    const types = { pair: (a: Type<unknown>, b: Type<unknown>) => tuple(a, b) }
    expect(failure(() => read("pair(number)", types)).message).toBe("$: \"pair\" expects 2 arguments, got 1 (line 1, column 1)")
  })
})

describe("depth", () => {
  it.each([
    ["tuples", "tuple(", ")", 3078],
    ["arrays", "array(", ")", 3078],
    ["objects", "{a:", "}", 1537],
    ["custom collections", "sortedSet(", ")", 5130],
  ])("accepts 512 levels of %s and rejects 513", (_, open, close, column) => {
    const nest = (levels: number) => `${open.repeat(levels)}number${close.repeat(levels)}`
    expect(() => read(nest(512))).not.toThrow()
    expect(failure(() => read(nest(513))).message).toBe(`$: nesting deeper than 512 levels (line 1, column ${column})`)
  })

  it("counts both braces and parentheses", () => {
    const nest = (levels: number) => `${"{a:array(".repeat(levels)}number${")}".repeat(levels)}`
    expect(() => read(nest(256))).not.toThrow()
    expect(failure(() => read(nest(257))).message).toBe("$: nesting deeper than 512 levels (line 1, column 2305)")
  })
})
