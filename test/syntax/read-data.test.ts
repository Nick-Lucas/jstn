import { describe, expect, it } from "vitest"
import { JSTNError } from "../../src/core/error.ts"
import type { Node } from "../../src/core/type.ts"
import { readData } from "../../src/syntax/read-data.ts"

function strip(node: Node): Node {
  const { pos, ...rest } = node
  if (rest.kind === "list") return { ...rest, items: rest.items.map(strip) }
  if (rest.kind === "object") return { ...rest, entries: rest.entries.map(({ key, value }) => ({ key, value: strip(value) })) }
  return rest
}

function toPlain(node: Node): unknown {
  switch (node.kind) {
    case "null": return null
    case "list": return node.items.map(toPlain)
    case "object": {
      const out: Record<string, unknown> = {}
      for (const { key, value } of node.entries) {
        Object.defineProperty(out, key, { value: toPlain(value), enumerable: true, writable: true, configurable: true })
      }
      return out
    }
    case "tagged": throw new Error("JSON has no tagged values")
    default: return node.value
  }
}

const read = (text: string): Node => strip(readData(text))

function messageOf(text: string): string {
  try {
    readData(text)
  } catch (error) {
    expect(error).toBeInstanceOf(JSTNError)
    return error instanceof Error ? error.message : ""
  }
  throw new Error(`expected ${JSON.stringify(text)} to be rejected`)
}

const num = (value: number): Node => ({ kind: "number", value })
const str = (value: string): Node => ({ kind: "string", value })
const list = (items: Node[], tag: string | null = null): Node => ({ kind: "list", tag, items })
const obj = (...entries: [string, Node][]): Node => ({ kind: "object", entries: entries.map(([key, value]) => ({ key, value })) })
const tagged = (tag: string, payload: string): Node => ({ kind: "tagged", tag, payload })

describe("literals", () => {
  it.each<[string, Node]>([
    ["null", { kind: "null" }],
    ["true", { kind: "boolean", value: true }],
    ["false", { kind: "boolean", value: false }],
    ["NaN", num(Number.NaN)],
    ["Infinity", num(Number.POSITIVE_INFINITY)],
    ["-Infinity", num(Number.NEGATIVE_INFINITY)],
    ["-0", num(-0)],
    ["0", num(0)],
    ["42", num(42)],
    ["-1.5e3", num(-1500)],
    ["5e-324", num(5e-324)],
    ["9007199254740993", num(9007199254740992)],
    ["123n", { kind: "bigint", value: 123n }],
    ["-5n", { kind: "bigint", value: -5n }],
    ["\"double\"", str("double")],
    ["'single'", str("single")],
    ["'it\\'s \"x\"'", str("it's \"x\"")],
    ["\"\\u{1F600} \\uD800 é\"", str("\u{1F600} \uD800 é")],
    ["\"\\b\\f\\n\\r\\t\\/\\\\\"", str("\b\f\n\r\t/\\")],
  ])("%s", (text, expected) => {
    expect(read(text)).toStrictEqual(expected)
  })

  it("keeps the sign of negative zero", () => {
    const node = readData("-0")
    expect(node.kind === "number" && Object.is(node.value, -0)).toBe(true)
  })
})

describe("objects", () => {
  it.each<[string, Node]>([
    ["{}", obj()],
    ["{ }", obj()],
    ["{a: 1}", obj(["a", num(1)])],
    ["{a: 1,}", obj(["a", num(1)])],
    ["{_x: 1, $y: 2, a1: 3}", obj(["_x", num(1)], ["$y", num(2)], ["a1", num(3)])],
    ["{null: 1, true: 2, NaN: 3, Infinity: 4}", obj(["null", num(1)], ["true", num(2)], ["NaN", num(3)], ["Infinity", num(4)])],
    ["{\"a b\": 1, 'é': 2, \"\": 3, \"\\t\": 4}", obj(["a b", num(1)], ["é", num(2)], ["", num(3)], ["\t", num(4)])],
    ["{a: {b: {c: null}}}", obj(["a", obj(["b", obj(["c", { kind: "null" }])])])],
    ["{__proto__: 1}", obj(["__proto__", num(1)])],
  ])("%s", (text, expected) => {
    expect(read(text)).toStrictEqual(expected)
  })

  const expected = obj(["a", num(1)], ["b", list([num(2)])])

  it("allows block comments in every gap", () => {
    expect(read("/*0*/{/*1*/a/*2*/:/*3*/1/*4*/,/*5*/\"b\"/*6*/:/*7*/[/*8*/2/*9*/,/*10*/]/*11*/,/*12*/}/*13*/")).toStrictEqual(expected)
  })

  it("allows line comments and newlines in every gap", () => {
    const text = "// head\n{ // 1\na // 2\n: // 3\n1 // 4\n, // 5\n\"b\" // 6\n: // 7\n[ // 8\n2 // 9\n, // 10\n] // 11\n, // 12\n} // tail"
    expect(read(text)).toStrictEqual(expected)
  })
})

describe("lists", () => {
  it.each<[string, Node]>([
    ["[]", list([])],
    ["[1]", list([num(1)])],
    ["[1, 2,]", list([num(1), num(2)])],
    ["[[], [[1]], {}]", list([list([]), list([list([num(1)])]), obj()])],
    ["[null, 'a', 1n]", list([{ kind: "null" }, str("a"), { kind: "bigint", value: 1n }])],
  ])("%s", (text, expected) => {
    expect(read(text)).toStrictEqual(expected)
  })
})

describe("tagged values", () => {
  it.each<[string, Node]>([
    ["Date(2026-01-01T14:00:00Z)", tagged("Date", "2026-01-01T14:00:00Z")],
    ["Money(12.50 GBP)", tagged("Money", "12.50 GBP")],
    ["Money(  12.50 GBP \n)", tagged("Money", "12.50 GBP")],
    ["Note(\"a (b) c\")", tagged("Note", "a (b) c")],
    ["Note('it\\'s')", tagged("Note", "it's")],
    ["Note(\" padded \")", tagged("Note", " padded ")],
    ["Note()", tagged("Note", "")],
    ["Note(\"\")", tagged("Note", "")],
    ["Url(https://x.io//a)", tagged("Url", "https://x.io//a")],
    ["Url(/* not a comment */)", tagged("Url", "/* not a comment */")],
    ["Set[1, 2]", list([num(1), num(2)], "Set")],
    ["Set[]", list([], "Set")],
    ["Map[[\"a\", 1]]", list([list([str("a"), num(1)])], "Map")],
    ["Foo[{a: Bar(x)}, Baz[]]", list([obj(["a", tagged("Bar", "x")]), list([], "Baz")], "Foo")],
    ["[Set[1], Date(x)]", list([list([num(1)], "Set"), tagged("Date", "x")])],
  ])("%s", (text, expected) => {
    expect(read(text)).toStrictEqual(expected)
  })
})

describe("positions", () => {
  it("records pos and keyPos on multi-line input with CRLF and tabs", () => {
    const text = "{\r\n\ta: [1,\r\n\t\tSet[2]],\r\n\t\"b\": Money(1 GBP)\r\n}"
    const at = (line: number, column: number) => ({ line, column })
    const set: Node = { kind: "list", tag: "Set", pos: at(3, 3), items: [{ kind: "number", value: 2, pos: at(3, 7) }] }
    const a: Node = { kind: "list", tag: null, pos: at(2, 5), items: [{ kind: "number", value: 1, pos: at(2, 6) }, set] }
    const b: Node = { kind: "tagged", tag: "Money", payload: "1 GBP", pos: at(4, 7) }
    expect(readData(text)).toStrictEqual({
      kind: "object",
      pos: at(1, 1),
      entries: [{ key: "a", keyPos: at(2, 2), value: a }, { key: "b", keyPos: at(4, 2), value: b }],
    })
  })

  it("counts lines after CR and LF and skips a leading BOM", () => {
    expect(readData("\uFEFF\r\r\n\n  true").pos).toStrictEqual({ line: 4, column: 3 })
  })
})

describe("tag errors", () => {
  it.each([
    ["Date (x)", "$: expected \"(\" or \"[\" immediately after tag \"Date\" (line 1, column 1)"],
    ["Set [1]", "$: expected \"(\" or \"[\" immediately after tag \"Set\" (line 1, column 1)"],
    ["Set/**/[1]", "$: expected \"(\" or \"[\" immediately after tag \"Set\" (line 1, column 1)"],
    ["Point{}", "$: expected \"(\" or \"[\" immediately after tag \"Point\" (line 1, column 1)"],
    ["Foo", "$: expected \"(\" or \"[\" immediately after tag \"Foo\" (line 1, column 1)"],
    ["[Foo]", "$[0]: expected \"(\" or \"[\" immediately after tag \"Foo\" (line 1, column 2)"],
    ["{d: Date (x)}", "$.d: expected \"(\" or \"[\" immediately after tag \"Date\" (line 1, column 5)"],
    ["true(1)", "$: unexpected \"(\", expected end of input (line 1, column 5)"],
    ["[null[1]]", "$: unexpected \"[\", expected \",\" or \"]\" (line 1, column 6)"],
    ["{d: Date(a\"b)}", "$.d: invalid character \"\\\"\" in payload; quote the payload (line 1, column 11)"],
    ["{d: Date(a(b)}", "$.d: invalid character \"(\" in payload; quote the payload (line 1, column 11)"],
    ["{d: Date(abc", "$.d: unterminated payload (line 1, column 9)"],
    ["{d: Note(\"a\" b)}", "$.d: expected \")\" after quoted payload (line 1, column 14)"],
  ])("%s", (text, message) => {
    expect(messageOf(text)).toBe(message)
  })
})

describe("syntax errors", () => {
  it.each([
    ["missing comma between entries", "{a: 1 b: 2}", "$: unexpected identifier \"b\", expected \",\" or \"}\" (line 1, column 7)"],
    ["missing comma between items", "[1 2]", "$: unexpected number 2, expected \",\" or \"]\" (line 1, column 4)"],
    ["missing colon", "{a 1}", "$.a: unexpected number 1, expected \":\" (line 1, column 4)"],
    ["number key", "{1: 2}", "$: unexpected number 1, expected key (line 1, column 2)"],
    ["double comma in an object", "{a: 1,, b: 2}", "$: unexpected \",\", expected key (line 1, column 7)"],
    ["double comma in a list", "{a: [1, 2, , 3]}", "$.a[2]: unexpected \",\", expected value (line 1, column 12)"],
    ["lone comma in a list", "[,]", "$[0]: unexpected \",\", expected value (line 1, column 2)"],
    ["lone comma in an object", "{,}", "$: unexpected \",\", expected key (line 1, column 2)"],
    ["unclosed object", "{a: 1", "$: unexpected end of input, expected \",\" or \"}\" (line 1, column 6)"],
    ["unclosed object after comma", "{a: 1,", "$: unexpected end of input, expected key (line 1, column 7)"],
    ["unclosed list", "[1, [2]", "$: unexpected end of input, expected \",\" or \"]\" (line 1, column 8)"],
    ["unclosed list after open", "[", "$[0]: unexpected end of input, expected value (line 1, column 2)"],
    ["mismatched closer", "{a: 1]", "$: unexpected \"]\", expected \",\" or \"}\" (line 1, column 6)"],
    ["stray closer", "}", "$: unexpected \"}\", expected value (line 1, column 1)"],
    ["extra closer", "{a: 1}}", "$: unexpected \"}\", expected end of input (line 1, column 7)"],
    ["empty document", "", "$: unexpected end of input, expected value (line 1, column 1)"],
    ["only trivia", "  // nothing\n", "$: unexpected end of input, expected value (line 2, column 1)"],
    ["trailing garbage", "1\n\nx", "$: unexpected identifier \"x\", expected end of input (line 3, column 1)"],
    ["two documents", "{} []", "$: unexpected \"[\", expected end of input (line 1, column 4)"],
    ["pipe in value position", "{a: |}", "$.a: unexpected \"|\", expected value (line 1, column 5)"],
    ["question mark in value position", "[?]", "$[0]: unexpected \"?\", expected value (line 1, column 2)"],
    ["angle bracket in value position", "<", "$: unexpected \"<\", expected value (line 1, column 1)"],
    ["closing paren in value position", "[)]", "$[0]: unexpected \")\", expected value (line 1, column 2)"],
    ["unterminated string in a nested path", "{a: {b: [1, \"x}]}}", "$.a.b[1]: unterminated string (line 1, column 13)"],
    ["unterminated key", "{\"a: 1}", "$: unterminated string (line 1, column 2)"],
    ["invalid number in a nested path", "{a: [01]}", "$.a[0]: invalid number \"01\" (line 1, column 6)"],
    ["unexpected character", "{a: @}", "$.a: unexpected character \"@\" (line 1, column 5)"],
    ["unterminated comment", "[1, /* x", "$[1]: unterminated comment (line 1, column 5)"],
  ])("%s", (_, text, message) => {
    expect(messageOf(text)).toBe(message)
  })

  it("carries reason, path, line and column on the error", () => {
    const error = (() => { try { readData("{a: {b: ]}}") } catch (thrown) { return thrown } })()
    expect(error).toBeInstanceOf(JSTNError)
    expect(error).toMatchObject({ reason: "unexpected \"]\", expected value", path: "$.a.b", line: 1, column: 9 })
  })
})

describe("duplicate keys", () => {
  it.each([
    ["{a: 1, a: 2}", "$.a: duplicate key (line 1, column 8)"],
    ["{\"a\": 1, 'a': 2}", "$.a: duplicate key (line 1, column 10)"],
    ["{x: {\"b c\": 1,\n \"b c\": 2}}", "$.x[\"b c\"]: duplicate key (line 2, column 2)"],
    ["{__proto__: 1, \"__proto__\": 2}", "$.__proto__: duplicate key (line 1, column 16)"],
  ])("%s", (text, message) => {
    expect(messageOf(text)).toBe(message)
  })
})

describe("depth limit", () => {
  it("accepts 512 levels of lists, objects and tagged lists", () => {
    expect(() => readData("[".repeat(512) + "]".repeat(512))).not.toThrow()
    expect(() => readData("{a:".repeat(511) + "{}" + "}".repeat(511))).not.toThrow()
    expect(() => readData("Set[".repeat(512) + "]".repeat(512))).not.toThrow()
  })

  it.each([
    ["lists", "[".repeat(513) + "]".repeat(513), "$" + "[0]".repeat(512), 513],
    ["objects", "{a:".repeat(513) + "1" + "}".repeat(513), "$" + ".a".repeat(512), 1537],
    ["tagged lists at the bracket", "Set[".repeat(513) + "]".repeat(513), "$" + "[0]".repeat(512), 2052],
  ])("rejects 513 levels of %s", (_, text, path, column) => {
    expect(messageOf(text)).toBe(`${path}: nesting deeper than 512 levels (line 1, column ${column})`)
  })
})

describe("JSON compatibility", () => {
  const samples: unknown[] = [
    null,
    true,
    0,
    -0,
    1e21,
    -1.5e-7,
    "esc \" \\ / \b\f\n\r\t \u0000 \u001f \u007f \uD800 é \u{1F600}",
    [],
    {},
    [1, [2, [3, {}]], "x"],
    { a: 1, "b c": [true, null], "": { nested: { deep: "y" } }, __proto__x: 0 },
    JSON.parse("{\"__proto__\": {\"a\": 1}}"),
  ]

  it.each(samples.flatMap((value) => [[JSON.stringify(value)], [JSON.stringify(value, null, 2)], [JSON.stringify(value, null, "\t")]]))(
    "%s",
    (text) => {
      expect(toPlain(readData(text))).toStrictEqual(JSON.parse(text))
    },
  )
})

it("parses the request's data sample with the missing comma restored", () => {
  const text = `{
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
  expect(read(text)).toStrictEqual(
    obj(
      ["someNum", num(1)], ["someStr", str("value")], ["someDate", tagged("Date", "2026-01-01T14:00:00Z")],
      ["someObj", obj(["inner", { kind: "boolean", value: true }])], ["someArr", list([num(1), num(2), num(3)])],
      ["someTuple", list([num(1), str("value")])], ["someUnion", num(3)], ["customVal", tagged("Money", "12.50 GBP")],
      ["big", { kind: "bigint", value: 123n }], ["tags", list([str("a"), str("b")], "Set")],
      ["lookup", list([list([str("x"), obj(["a", num(1)])])], "Map")], ["scores", list([num(1), num(2), num(3)], "SortedSet")],
      ["nothing", { kind: "null" }], ["key with space", str("here")],
    ),
  )
})
