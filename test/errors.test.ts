import { expect, it } from "vitest"
import { toType } from "../src/core/schema.ts"
import { JSTN, JSTNError, array, createCollection, createType, map, optional, set, tuple, union } from "../src/index.ts"
import type { CollectionSpec, Infer, Schema } from "../src/index.ts"
import { Money, S, money, note, registry, sampleValue, sortedSet } from "./support/fixtures.ts"

class Point {
  x = 1
}

const moneyParts = { match: (v: unknown) => v instanceof Money, parse: (t: string) => money.decode({ kind: "tagged", tag: "Money", payload: t }, []) }
const strictMoney = createType<Money>({ name: "Money", ...moneyParts, match: (v) => v instanceof Money && v.amount.includes("."), stringify: (m) => m.amount })
const boomMoney = createType<Money>({ name: "Money", ...moneyParts, stringify: () => { throw new Error("boom") } })
const numberMoney = createType<Money>({ name: "Money", ...moneyParts, stringify: () => 5 as unknown as string })
const odd = createType<string>({ name: "Odd", match: () => true, parse: () => { throw "oops" }, stringify: (s) => s })

const bag = createCollection({
  name: "Bag",
  items: Number,
  match: Array.isArray,
  fromItems: (): number[] => { throw new Error("bad bag") },
  toItems: (): number[] => { throw new Error("no items") },
})

const tail = `  someTuple: [1, "value"],
  someUnion: 3,
  customVal: Money(12.50 GBP),
  big: 123n,
  tags: Set["a", "b"],
  lookup: Map[["x", { a: 1 }]],
  scores: SortedSet[1, 2, 3],
  nothing: null,
}`
const badArr = `{\n  someNum: 1,\n  someStr: "value",\n  someDate: Date(2026-01-01T14:00:00Z),\n  someObj: { inner: true },\n  someArr:[1,2,"x"],\n${tail}`
const emptyObj = `{\n  someNum: 1, someStr: "value",\n  someDate: Date(2026-01-01T14:00:00Z),\n  someObj: {},\n  someArr: [1, 2, 3],\n${tail}`
const extraKey = `{\n  someNum: 1, someStr: "value",\n  someDate: Date(2026-01-01T14:00:00Z),\n  someObj: { inner: true,\n    "b c": 1 },\n  someArr: [1, 2, 3],\n${tail}`

const parse = (text: string, schema: Schema) => () => JSTN.parse(text, schema)
const schemaText = (text: string, types = {}) => () => JSTN.parseSchema(text, { types })
const loose = (value: unknown) => value as Schema
const deepPath = `$${"[0]".repeat(512)}`

type Row = [string, () => unknown, string, string, number | undefined, number | undefined]

const rows: Row[] = [
  ["5.4 wrong item kind", parse(badArr, S), "$.someArr[2]: expected number, got string \"x\" (line 6, column 16)", "$.someArr[2]", 6, 16],
  ["5.4 missing key", parse(emptyObj, S), "$.someObj: missing required key \"inner\" (line 4, column 12)", "$.someObj", 4, 12],
  ["5.4 unknown key", parse(extraKey, S), "$.someObj[\"b c\"]: unknown key (line 5, column 5)", "$.someObj[\"b c\"]", 5, 5],
  ["5.4 duplicate key", parse("{a: 1, a: 2}", { a: Number }), "$.a: duplicate key (line 1, column 8)", "$.a", 1, 8],
  ["5.4 unterminated string", parse("{a:\"abc", { a: String }), "$.a: unterminated string (line 1, column 4)", "$.a", 1, 4],
  ["5.4 trailing content", parse("{\n}\nx", {}), "$: unexpected identifier \"x\", expected end of input (line 3, column 1)", "$", 3, 1],
  ["5.4 double comma", parse("{a: [1, 2, , 3]}", { a: array(Number) }), "$.a[2]: unexpected \",\", expected value (line 1, column 12)", "$.a[2]", 1, 12],
  ["5.4 tag adjacency", parse("{d: Date (x)}", { d: Date }), "$.d: expected \"(\" or \"[\" immediately after tag \"Date\" (line 1, column 5)", "$.d", 1, 5],
  ["5.4 union mismatch", parse("{\n  u: true\n}", { u: union(Number, String) }), "$.u: expected union(number, string), got boolean true (line 2, column 6)", "$.u", 2, 6],
  ["5.4 tuple length", parse("{t: [1, \"a\", 2]}", { t: tuple(Number, String) }), "$.t: expected 2 items, got 3 (line 1, column 5)", "$.t", 1, 5],
  ["5.4 custom parse failure", parse("{\n  price: Money(abc)\n}", { price: money }), "$.price: invalid money \"abc\": expected \"<amount> <CCY>\" (line 2, column 10)", "$.price", 2, 10],
  ["5.4 rejected by match", parse("{\n  price: Money(1 GBP)\n}", { price: strictMoney }), "$.price: invalid money \"1 GBP\": parse result rejected by match (line 2, column 10)", "$.price", 2, 10],
  ["5.4 duplicate set item", parse("{s: Set[1, 1]}", { s: set(Number) }), "$.s: invalid set(number): duplicate item (line 1, column 5)", "$.s", 1, 5],
  ["5.4 encode mismatch", () => JSTN.validate({ ...sampleValue, someDate: "2026-01-01" }, S), "$.someDate: expected date, got string \"2026-01-01\"", "$.someDate", undefined, undefined],
  ["5.4 class instance", () => JSTN.validate({ p: new Point() }, { p: { x: Number } }), "$.p: expected { x: number }, got Point", "$.p", undefined, undefined],
  ["5.4 stringify throws", () => JSTN.stringify({ c: new Money("1", "GBP") }, { c: boomMoney }), "$.c: cannot stringify money: boom", "$.c", undefined, undefined],
  ["5.4 unknown type", schemaText("{\n  a: number,\n  b: set(User),\n}"), "$: unknown type \"User\" (line 3, column 10)", "$", 3, 10],
  ["5.4 argument count", schemaText("map(string)"), "$: \"map\" expects 2 arguments, got 1 (line 1, column 1)", "$", 1, 1],
  ["5.4 redefined built-in", schemaText("date", { date: money }), "$: cannot redefine built-in type \"date\"", "$", undefined, undefined],
  ["5.4 Array constructor", () => JSTN.schema(loose(Array)), "$: not a schema: Array (use array(...))", "$", undefined, undefined],
  ["5.4 misplaced optional", () => toType(loose(optional(Number)), ["a"]), "$.a: optional() is only valid as an object field", "$.a", undefined, undefined],

  ["unterminated comment", parse("1 /* x", Number), "$: unterminated comment (line 1, column 3)", "$", 1, 3],
  ["control character", parse("\"a\tb\"", String), "$: control character in string (line 1, column 3)", "$", 1, 3],
  ["invalid escape", parse("['\\q']", array(String)), "$[0]: invalid escape \"\\q\" (line 1, column 3)", "$[0]", 1, 3],
  ["invalid number", parse("01", Number), "$: invalid number \"01\" (line 1, column 1)", "$", 1, 1],
  ["stray minus", parse("- 1", Number), "$: unexpected \"-\" (line 1, column 1)", "$", 1, 1],
  ["stray plus", parse("+1", Number), "$: unexpected \"+\" (line 1, column 1)", "$", 1, 1],
  ["stray dot", parse(".5", Number), "$: unexpected \".\" (line 1, column 1)", "$", 1, 1],
  ["unexpected character", parse("@", Number), "$: unexpected character \"@\" (line 1, column 1)", "$", 1, 1],
  ["unterminated payload", parse("Date(2026", Date), "$: unterminated payload (line 1, column 5)", "$", 1, 5],
  ["raw payload character", parse("Note(a\"b)", note), "$: invalid character \"\\\"\" in payload; quote the payload (line 1, column 7)", "$", 1, 7],
  ["text after quoted payload", parse("Note(\"a\" b)", note), "$: expected \")\" after quoted payload (line 1, column 10)", "$", 1, 10],
  ["number key", parse("{1: 2}", {}), "$: unexpected number 1, expected key (line 1, column 2)", "$", 1, 2],
  ["missing colon", parse("{a 1}", { a: Number }), "$.a: unexpected number 1, expected \":\" (line 1, column 4)", "$.a", 1, 4],
  ["missing entry comma", parse("{a: 1 b: 2}", { a: Number }), "$: unexpected identifier \"b\", expected \",\" or \"}\" (line 1, column 7)", "$", 1, 7],
  ["missing item comma", parse("[1 2]", array(Number)), "$: unexpected number 2, expected \",\" or \"]\" (line 1, column 4)", "$", 1, 4],
  ["empty document", parse("", Number), "$: unexpected end of input, expected value (line 1, column 1)", "$", 1, 1],
  ["pipe in value position", parse("[|]", array(Number)), "$[0]: unexpected character \"|\" (line 1, column 2)", "$[0]", 1, 2],
  ["data nesting", parse("[".repeat(513), Number), `${deepPath}: nesting deeper than 512 levels (line 1, column 513)`, deepPath, 1, 513],

  ["scalar decode", parse("\"1\"", Number), "$: expected number, got string \"1\" (line 1, column 1)", "$", 1, 1],
  ["tagged for scalar", parse("Money(1 GBP)", String), "$: expected string, got Money (line 1, column 1)", "$", 1, 1],
  ["object decode kind", parse("[1]", { a: Number }), "$: expected { a: number }, got array (line 1, column 1)", "$", 1, 1],
  ["wrong custom tag", parse("Note(x)", money), "$: expected money, got Note (line 1, column 1)", "$", 1, 1],
  ["wrong collection tag", parse("Set[1]", sortedSet(Number)), "$: expected sortedSet(number), got Set (line 1, column 1)", "$", 1, 1],
  ["duplicate map key", parse("{m: Map[[\"a\", 1], [\"a\", 2]]}", { m: map(String, Number) }), "$.m: invalid map(string, number): duplicate key (line 1, column 5)", "$.m", 1, 5],
  ["map pair length", parse("Map[[\"a\"]]", map(String, Number)), "$[0]: expected 2 items, got 1 (line 1, column 5)", "$[0]", 1, 5],
  ["invalid date", parse("Date(2026-02-30)", Date), "$: invalid date \"2026-02-30\": day out of range (line 1, column 1)", "$", 1, 1],
  ["invalid date: expected an ISO 8601 date", parse("Date(2026-01-01T12:00)", Date), "$: invalid date \"2026-01-01T12:00\": expected an ISO 8601 date (line 1, column 1)", "$", 1, 1],
  ["invalid date: month out of range", parse("Date(2026-13-01)", Date), "$: invalid date \"2026-13-01\": month out of range (line 1, column 1)", "$", 1, 1],
  ["invalid date: hour out of range", parse("Date(2026-01-01T24:00Z)", Date), "$: invalid date \"2026-01-01T24:00Z\": hour out of range (line 1, column 1)", "$", 1, 1],
  ["invalid date: minute out of range", parse("Date(2026-01-01T12:60Z)", Date), "$: invalid date \"2026-01-01T12:60Z\": minute out of range (line 1, column 1)", "$", 1, 1],
  ["invalid date: second out of range", parse("Date(2026-01-01T12:00:60Z)", Date), "$: invalid date \"2026-01-01T12:00:60Z\": second out of range (line 1, column 1)", "$", 1, 1],
  ["invalid date: offset out of range", parse("Date(2026-01-01T12:00+24:00)", Date), "$: invalid date \"2026-01-01T12:00+24:00\": offset out of range (line 1, column 1)", "$", 1, 1],
  ["invalid date: year -000000 is not allowed", parse("Date(-000000-01-01)", Date), "$: invalid date \"-000000-01-01\": year -000000 is not allowed (line 1, column 1)", "$", 1, 1],
  ["invalid date: outside the Date range", parse("Date(+275760-09-13T00:00:00.001Z)", Date), "$: invalid date \"+275760-09-13T00:00:00.001Z\": outside the Date range (line 1, column 1)", "$", 1, 1],
  ["non-Error from parse", parse("Odd(x)", odd), "$: invalid odd \"x\": oops (line 1, column 1)", "$", 1, 1],
  ["fromItems throws", parse("Bag[1]", bag), "$: invalid bag(number): bad bag (line 1, column 1)", "$", 1, 1],

  ["unknown key on encode", () => JSTN.validate({ a: 1, b: 2 }, { a: Number }), "$.b: unknown key", "$.b", undefined, undefined],
  ["missing key on encode", () => JSTN.validate({}, { a: Number }), "$: missing required key \"a\"", "$", undefined, undefined],
  ["undefined required key", () => JSTN.validate({ a: undefined }, { a: Number }), "$.a: expected number, got undefined", "$.a", undefined, undefined],
  ["array hole", () => JSTN.validate(new Array(1), array(Number)), "$[0]: expected number, got undefined", "$[0]", undefined, undefined],
  ["tuple length on encode", () => JSTN.validate([1], tuple(Number, String)), "$: expected 2 items, got 1", "$", undefined, undefined],
  ["union on encode", () => JSTN.validate(true, union(Number, String)), "$: expected union(number, string), got boolean true", "$", undefined, undefined],
  ["invalid Date on encode", () => JSTN.stringify(new Date(Number.NaN), Date), "$: expected date, got invalid Date", "$", undefined, undefined],
  ["stringify returns a non-string", () => JSTN.stringify(new Money("1", "GBP"), numberMoney), "$: cannot stringify money: stringify must return a string", "$", undefined, undefined],
  ["toItems throws", () => JSTN.stringify([1], bag), "$: cannot stringify bag(number): no items", "$", undefined, undefined],
  ["collection mismatch on encode", () => JSTN.validate([1], set(Number)), "$: expected set(number), got array", "$", undefined, undefined],

  ["bad custom name", () => createType({ name: "x y", match: () => true, parse: (t) => t, stringify: (t) => t }), "$: invalid type name \"x y\"", "$", undefined, undefined],
  ["reserved collection name", () => createCollection({ name: "number", items: Number, match: Array.isArray, fromItems: (v) => v, toItems: (v) => v }), "$: invalid type name \"number\"", "$", undefined, undefined],
  ["one-member union", () => union(...([Number] as unknown as [Schema, Schema])), "$: union() needs at least 2 members", "$", undefined, undefined],
  ["Set constructor", () => JSTN.schema(loose(Set)), "$: not a schema: Set (use set(...))", "$", undefined, undefined],
  ["Map constructor", () => JSTN.schema(loose(Map)), "$: not a schema: Map (use map(...))", "$", undefined, undefined],
  ["Object constructor", () => JSTN.schema(loose(Object)), "$: not a schema: Object (use a plain object literal)", "$", undefined, undefined],
  ["nested invalid field", () => JSTN.schema(loose({ a: { b: 3 } })), "$.a.b: not a schema: number 3", "$.a.b", undefined, undefined],
  ["top-level optional", () => JSTN.schema(loose(optional(Number))), "$: optional() is only valid as an object field", "$", undefined, undefined],

  ["calling a type", schemaText("number(string)"), "$: \"number\" is not a function (line 1, column 1)", "$", 1, 1],
  ["bare builder", schemaText("map"), "$: \"map\" must be called (line 1, column 1)", "$", 1, 1],
  ["bare custom collection", schemaText(" sortedSet", registry), "$: \"sortedSet\" must be called (line 1, column 2)", "$", 1, 2],
  ["duplicate field", schemaText("{ a: number, a: string }"), "$: duplicate key \"a\" (line 1, column 14)", "$", 1, 14],
  ["invalid registry name", schemaText("number", { "x y": money }), "$: invalid type name \"x y\"", "$", undefined, undefined],
  ["non-collection function", schemaText("number", { Fn: () => money }), "$: \"Fn\" is not a schema or collection", "$", undefined, undefined],
  ["schema value token", schemaText("{ a: \"x\" }", registry), "$: unexpected string \"x\", expected schema (line 1, column 6)", "$", 1, 6],
  ["unclosed call", schemaText("array(number"), "$: unexpected end of input, expected \",\" or \")\" (line 1, column 13)", "$", 1, 13],
  ["grouping parenthesis", schemaText("(number)"), "$: unexpected \"(\", expected schema (line 1, column 1)", "$", 1, 1],
  ["missing argument comma", schemaText("map(string number)"), "$: unexpected identifier \"number\", expected \",\" or \")\" (line 1, column 12)", "$", 1, 12],
  ["missing field comma", schemaText("{ a: number b: string }"), "$: unexpected identifier \"b\", expected \",\" or \"}\" (line 1, column 13)", "$", 1, 13],
  ["missing tuple comma", schemaText("tuple(number string)"), "$: unexpected identifier \"string\", expected \",\" or \")\" (line 1, column 14)", "$", 1, 14],
  ["schema number key", schemaText("{ 1: number }"), "$: unexpected number 1, expected key (line 1, column 3)", "$", 1, 3],
  ["data string as colon", parse("{a \":\" 1}", { a: Number }), "$.a: unexpected string \":\", expected \":\" (line 1, column 4)", "$.a", 1, 4],
  ["data string as bracket", parse("[1 \"]\"", array(Number)), "$: unexpected string \"]\", expected \",\" or \"]\" (line 1, column 4)", "$", 1, 4],
  ["schema string as colon", schemaText("{a \":\" number}"), "$: unexpected string \":\", expected \":\" (line 1, column 4)", "$", 1, 4],
  ["schema string as paren", schemaText("set(number \")\""), "$: unexpected string \")\", expected \",\" or \")\" (line 1, column 12)", "$", 1, 12],
  ["schema missing colon", schemaText("{ a number }"), "$: unexpected identifier \"number\", expected \":\" (line 1, column 5)", "$", 1, 5],
  ["schema trailing content", schemaText("number string"), "$: unexpected identifier \"string\", expected end of input (line 1, column 8)", "$", 1, 8],
  ["schema nesting", schemaText(`${"array(".repeat(513)}number${")".repeat(513)}`), "$: nesting deeper than 512 levels (line 1, column 3078)", "$", 1, 3078],
  ["schema pipe", schemaText("number | string"), "$: unexpected character \"|\" (line 1, column 8)", "$", 1, 8],
  ["schema question mark", schemaText("{ a?: number }"), "$: unexpected character \"?\" (line 1, column 4)", "$", 1, 4],
  ["schema angle bracket", schemaText("Set<number>"), "$: unknown type \"Set\" (line 1, column 1)", "$", 1, 1],
  ["union arity", schemaText("union(number)"), "$: \"union\" expects at least 2 arguments, got 1 (line 1, column 1)", "$", 1, 1],
  ["misplaced optional in text", schemaText("array(optional(number))"), "$: optional() is only valid as an object field (line 1, column 7)", "$", 1, 7],
  ["factory without a type", schemaText("{ a: arr(number) }", { arr: loose(Array) }), "$: \"arr\" did not return a type (line 1, column 6)", "$", 1, 6],
]

it.each(rows)("%s", (_, run, message, path, line, column) => {
  let thrown: unknown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(JSTNError)
  const error = thrown as JSTNError
  const suffix = line === undefined ? "" : ` (line ${line}, column ${column})`
  expect({ message: error.message, reason: error.reason, path: error.path, line: error.line, column: error.column }).toStrictEqual({
    message,
    reason: message.slice(path.length + 2, message.length - suffix.length),
    path,
    line,
    column,
  })
})
