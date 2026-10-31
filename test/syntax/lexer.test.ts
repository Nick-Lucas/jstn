import { describe, expect, it } from "vitest"
import { JSTNError } from "../../src/core/error.ts"
import type { Pos } from "../../src/core/type.ts"
import { Lexer, describeToken, type Token } from "../../src/syntax/lexer.ts"

function fail(reason: string, pos: Pos): never {
  throw new JSTNError(reason, [], pos)
}

function drain(lexer: Lexer): Token[] {
  const tokens = [lexer.next()]
  while (tokens.at(-1)?.kind !== "eof") tokens.push(lexer.next())
  return tokens
}

function lex(source: string): Token[] {
  return drain(new Lexer(source, fail))
}

function values(source: string): [string, unknown][] {
  return lex(source)
    .filter((token) => token.kind !== "eof")
    .map((token) => [token.kind, token.value])
}

function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error("expected a throw")
}

function messageOf(run: () => unknown): string {
  const error = thrownBy(run)
  expect(error).toBeInstanceOf(JSTNError)
  return error instanceof Error ? error.message : ""
}

function payloadOf(source: string): { payload: string; rest: Token[] } {
  const lexer = new Lexer(source, fail)
  lexer.next()
  const payload = lexer.readPayload(lexer.next().pos)
  return { payload, rest: drain(lexer) }
}

const lexError = (source: string): string => messageOf(() => lex(source))
const payloadError = (source: string): string => messageOf(() => payloadOf(source))

describe("trivia", () => {
  it("skips spaces, tabs, LF, CR and CRLF", () => {
    expect(values(" \t1\n2\r3\r\n4 ")).toStrictEqual([["number", 1], ["number", 2], ["number", 3], ["number", 4]])
  })

  it("accepts a line comment at the end of input", () => {
    expect(values("1 // trailing")).toStrictEqual([["number", 1]])
    expect(values("1//")).toStrictEqual([["number", 1]])
  })

  it("accepts a block comment spanning lines", () => {
    const tokens = lex("1 /* a\nb\r\nc */ 2")
    expect(tokens[1]).toStrictEqual({ kind: "number", value: 2, pos: { line: 3, column: 6 }, adjacent: false })
  })

  it("accepts comments between every pair of tokens", () => {
    expect(values("/*a*/{/*b*/k/*c*/:/*d*/1//e\n,/*f*/}/*g*///h")).toStrictEqual([
      ["punct", "{"], ["ident", "k"], ["punct", ":"], ["number", 1], ["punct", ","], ["punct", "}"],
    ])
  })

  it("does not nest block comments", () => {
    expect(values("/* /* */ 1")).toStrictEqual([["number", 1]])
    expect(lexError("/* /* */ */")).toBe("$: unexpected character \"*\" (line 1, column 10)")
  })

  it("reports an unterminated comment at its start", () => {
    expect(lexError("1\n  /* never closed")).toBe("$: unterminated comment (line 2, column 3)")
  })

  it("skips a BOM at offset 0 and rejects it elsewhere", () => {
    expect(lex("\ufeff1")[0]).toStrictEqual({ kind: "number", value: 1, pos: { line: 1, column: 1 }, adjacent: true })
    expect(lexError("1 \ufeff")).toBe("$: unexpected character \"\ufeff\" (line 1, column 3)")
  })
})

describe("identifiers", () => {
  it.each(["a", "_", "$", "a1", "NaN", "Infinity", "null", "true", "A_$9z"])("lexes %s", (name) => {
    expect(values(name)).toStrictEqual([["ident", name]])
  })

  it("rejects non-ASCII letters", () => {
    expect(lexError("é")).toBe("$: unexpected character \"é\" (line 1, column 1)")
    expect(lexError("a😀")).toBe("$: unexpected character \"😀\" (line 1, column 2)")
  })
})

describe("numbers", () => {
  it.each([
    ["0", 0], ["-0", -0], ["1", 1], ["-1", -1],
    ["1.5", 1.5], ["-0.25", -0.25], ["1e5", 1e5], ["1E+5", 1e5], ["1e-7", 1e-7],
    ["-Infinity", Number.NEGATIVE_INFINITY], ["9007199254740993", 9007199254740992],
  ])("lexes %s", (source, value) => {
    expect(values(source)).toStrictEqual([["number", value]])
  })

  it.each(["01", "5.", "1.", "1abc", "1e", "1e+", "0x1F", "1_000", "1.5.3"])("rejects %s as an invalid number", (source) => {
    expect(lexError(source)).toBe(`$: invalid number "${source}" (line 1, column 1)`)
  })

  it.each([
    [".5", "."], ["+1", "+"], ["- 1", "-"], ["-a", "-"], ["-Infinityx", "-"],
  ])("rejects %s at its sign or dot", (source, char) => {
    expect(lexError(source)).toBe(`$: unexpected "${char}" (line 1, column 1)`)
  })

  it("ends a number at punctuation", () => {
    expect(values("[1,-2]")).toStrictEqual([["punct", "["], ["number", 1], ["punct", ","], ["number", -2], ["punct", "]"]])
  })
})

describe("bigints", () => {
  const big = `1${"0".repeat(199)}`

  it.each([["0n", 0n], ["-5n", -5n], [`${big}n`, BigInt(big)], ["-0n", 0n]])("lexes %s", (source, value) => {
    expect(values(source)).toStrictEqual([["bigint", value]])
  })

  it.each(["1.5n", "12nn", "01n", "1e3n"])("rejects %s", (source) => {
    expect(lexError(source)).toBe(`$: invalid number "${source}" (line 1, column 1)`)
  })
})

describe("strings", () => {
  it.each([
    ["double quotes", "\"abc\"", "abc"],
    ["single quotes", "'abc'", "abc"],
    ["empty", "\"\"", ""],
    ["single quote inside double", "\"it's\"", "it's"],
    ["double quote inside single", "'say \"hi\"'", "say \"hi\""],
    ["every short escape", "\"\\\"\\'\\\\\\/\\b\\f\\n\\r\\t\"", "\"'\\/\b\f\n\r\t"],
    ["four-digit escape", "\"\\u0041\"", "A"],
    ["braced escape", "\"\\u{1F600}\"", "😀"],
    ["maximum braced escape", "\"\\u{10FFFF}\"", "\u{10FFFF}"],
    ["lone surrogate escape", "\"\\uD800\"", "\ud800"],
    ["literal unicode", "\"héllo 😀\"", "héllo 😀"],
    ["U+007F is allowed raw", "\"\u007f\"", "\u007f"],
  ])("%s", (_name, source, value) => {
    expect(values(source)).toStrictEqual([["string", value]])
  })

  it.each([
    ["\"\\q\"", "invalid escape \"\\q\"", 2],
    ["\"\\x41\"", "invalid escape \"\\x\"", 2],
    ["\"\\u12\"", "invalid escape \"\\u12\"", 2],
    ["\"ab\\u{110000}\"", "invalid escape \"\\u{110000}\"", 4],
    ["\"\\u{}\"", "invalid escape \"\\u{}\"", 2],
    ["\"\\u{12\"", "invalid escape \"\\u{12\"", 2],
  ])("rejects the escape in %s", (source, reason, column) => {
    expect(lexError(source)).toBe(`$: ${reason} (line 1, column ${column})`)
  })

  it.each(["\"a\nb\"", "\"a\rb\"", "\"a\tb\"", "\"a\u0000b\"", "'a\u001fb'"])("rejects the raw control character in %j", (source) => {
    expect(lexError(source)).toBe("$: control character in string (line 1, column 3)")
  })

  it("reports an unterminated string at the opening quote", () => {
    expect(lexError("{a: \"xyz")).toBe("$: unterminated string (line 1, column 5)")
    expect(lexError("\n  'abc\\")).toBe("$: unterminated string (line 2, column 3)")
  })
})

describe("punctuation", () => {
  it("lexes every punct character as its own token", () => {
    expect(values("{}[](),:|?<>>").map(([, value]) => value)).toStrictEqual([..."{}[](),:|?<>>"])
  })

  it.each(["@", "#", ";", "/", "*", "="])("rejects %s", (char) => {
    expect(lexError(`1 ${char}`)).toBe(`$: unexpected character "${char}" (line 1, column 3)`)
  })
})

describe("positions and adjacency", () => {
  it("tracks lines after LF, CR and CRLF and counts a tab as one column", () => {
    expect(lex("a\nb\rc\r\nd\te").map(({ pos }) => [pos.line, pos.column])).toStrictEqual([
      [1, 1], [2, 1], [3, 1], [4, 1], [4, 3], [4, 4],
    ])
  })

  it("counts an astral character as 2 columns", () => {
    expect(lex("\"😀\" x")[1]?.pos).toStrictEqual({ line: 1, column: 6 })
  })

  it.each([["Set[", true], ["Set [", false], ["Set/**/[", false], ["Set\n[", false]])("%j marks the bracket adjacent: %s", (source, adjacent) => {
    expect(lex(source)[1]?.adjacent).toBe(adjacent)
  })
})

describe("readPayload", () => {
  it.each([
    ["raw with internal spaces", "Money(12.50 GBP)", "12.50 GBP"],
    ["trimmed spaces", "X(   a b   )", "a b"],
    ["trimmed newlines and tabs", "X(\n\t a \r\n)", "a"],
    ["double-quoted", "X(\"a)b(\\\"\")", "a)b(\""],
    ["single-quoted", "X('x y')", "x y"],
    ["quoted with surrounding space", "X( \"q\" \n)", "q"],
    ["empty", "X()", ""],
    ["only whitespace", "X(  \n )", ""],
    ["line comment marker kept", "Url(https://x.io//a)", "https://x.io//a"],
    ["block comment marker kept", "X(a /* b */ c)", "a /* b */ c"],
    ["U+FEFF and unicode kept", "X(日本\ufeff)", "日本\ufeff"],
  ])("%s", (_name, source, payload) => {
    expect(payloadOf(source).payload).toBe(payload)
  })

  it("continues lexing after the payload with correct positions", () => {
    const { rest } = payloadOf("X(\n a\n) b")
    expect(rest[0]).toStrictEqual({ kind: "ident", value: "b", pos: { line: 3, column: 3 }, adjacent: false })
    expect(payloadOf("X(a)]").rest[0]).toStrictEqual({ kind: "punct", value: "]", pos: { line: 1, column: 5 }, adjacent: true })
  })

  it.each([
    ["(", "\"(\""], ["\"", "\"\\\"\""], ["'", "\"'\""], ["\\", "\"\\\\\""], ["\u0000", "\"\\u0000\""],
    ["\u001f", "\"\\u001f\""], ["\u007f", "\"\\u007f\""], ["\t", "\"\\t\""], ["\n", "\"\\n\""],
  ])("rejects the raw character %j", (char, quoted) => {
    expect(payloadError(` X( a${char}b)`)).toBe(`$: invalid character ${quoted} in payload; quote the payload (line 1, column 6)`)
  })

  it.each(["X(abc", "X(", "X(  \n", "X(\"abc\"", "X(\"abc\" "])("reports %j as unterminated at the open position", (source) => {
    expect(payloadError(source)).toBe("$: unterminated payload (line 1, column 2)")
  })

  it("rejects text after a quoted payload", () => {
    expect(payloadError("X(\"a\" b)")).toBe("$: expected \")\" after quoted payload (line 1, column 7)")
  })

  it("reports an unterminated string inside a quoted payload at its quote", () => {
    expect(payloadError("X( \"abc")).toBe("$: unterminated string (line 1, column 4)")
  })

  it("throws an internal error when a token is buffered", () => {
    const lexer = new Lexer("X(a)", fail)
    lexer.next()
    const open = lexer.next()
    lexer.peek()
    const error = thrownBy(() => lexer.readPayload(open.pos))
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(JSTNError)
  })
})

describe("helpers", () => {
  it("peek does not consume and next does", () => {
    const lexer = new Lexer("a b", fail)
    expect(lexer.peek()).toBe(lexer.peek())
    expect(lexer.next().value).toBe("a")
    expect(lexer.next().value).toBe("b")
    expect(lexer.next().kind).toBe("eof")
    expect(lexer.next().kind).toBe("eof")
  })

  it("eat consumes only the matching punct", () => {
    const lexer = new Lexer(", :", fail)
    expect(lexer.eat(":")).toBe(false)
    expect(lexer.eat(",")).toBe(true)
    expect(lexer.eat(",")).toBe(false)
    expect(lexer.eat(":")).toBe(true)
    expect(lexer.peek().kind).toBe("eof")
  })

  it("expect returns the matching punct", () => {
    const lexer = new Lexer(" :", fail)
    expect(lexer.expect(":", "\":\"")).toStrictEqual({ kind: "punct", value: ":", pos: { line: 1, column: 2 }, adjacent: false })
  })

  it("expect fails through unexpected on anything else", () => {
    const lexer = new Lexer("a b", fail)
    lexer.next()
    expect(messageOf(() => lexer.expect(":", "\":\""))).toBe("$: unexpected identifier \"b\", expected \":\" (line 1, column 3)")
  })

  it("unexpected names the token and the expectation", () => {
    const lexer = new Lexer("\n x", fail)
    expect(messageOf(() => lexer.unexpected(lexer.next(), "end of input"))).toBe(
      "$: unexpected identifier \"x\", expected end of input (line 2, column 2)",
    )
  })

  it.each([
    [",", "\",\""], ["foo", "identifier \"foo\""], ["'x'", "string \"x\""], [`"${"y".repeat(50)}"`, `string "${"y".repeat(39)}…`],
    ["1", "number 1"], ["-0", "number -0"], ["-Infinity", "number -Infinity"], ["1n", "bigint 1n"], ["", "end of input"],
  ])("describeToken(%j) is %s", (source, description) => {
    expect(describeToken(new Lexer(source, fail).next())).toBe(description)
  })
})
