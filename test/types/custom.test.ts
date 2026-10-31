import { describe, expect, it } from "vitest"
import { JSTN, JSTNError, createType } from "../../src/index.ts"
import { Money, Note, money, note } from "../support/fixtures.ts"

function fails(run: () => unknown): JSTNError {
  try {
    run()
  } catch (error) {
    if (error instanceof JSTNError) return error
    throw error
  }
  throw new Error("expected a JSTNError")
}

const pos = { line: 2, column: 10 }

function moneyWith(overrides: Partial<{ name: string; match(v: unknown): boolean; parse(text: string): Money; stringify(m: Money): string }>) {
  return createType<Money>({
    name: "Money",
    match: (v) => v instanceof Money,
    parse: (text) => new Money(text, "GBP"),
    stringify: (m) => m.amount,
    ...overrides,
  })
}

describe("Money", () => {
  it("encodes to a tagged node", () => {
    expect(money.encode(new Money("12.50", "GBP"), [])).toStrictEqual({ kind: "tagged", tag: "Money", payload: "12.50 GBP" })
  })

  it("decodes to a Money instance", () => {
    const value = money.decode({ kind: "tagged", tag: "Money", payload: "12.50 GBP", pos }, [])
    expect(value).toBeInstanceOf(Money)
    expect(value).toStrictEqual(new Money("12.50", "GBP"))
  })

  it("is named by its spec", () => {
    expect(money.name).toBe("Money")
    expect(note.name).toBe("Note")
  })
})

describe("Note payloads through text", () => {
  it.each([
    ["empty", "", "Note(\"\")"],
    ["leading space", " lead", "Note(\" lead\")"],
    ["trailing space", "trail ", "Note(\"trail \")"],
    ["open paren", "a(b", "Note(\"a(b\")"],
    ["close paren", "a)b", "Note(\"a)b\")"],
    ["double quotes", "say \"hi\"", "Note(\"say \\\"hi\\\"\")"],
    ["single quote", "it's", "Note(\"it's\")"],
    ["newline", "a\nb", "Note(\"a\\nb\")"],
    ["tab", "a\tb", "Note(\"a\\tb\")"],
    ["backslash", "a\\b", "Note(\"a\\\\b\")"],
    ["unicode", "héllo 😀", "Note(héllo 😀)"],
    ["inner spaces", "plain words", "Note(plain words)"],
    ["slashes", "https://x.io//a", "Note(https://x.io//a)"],
    ["lone high surrogate", "a\ud800b", "Note(\"a\\ud800b\")"],
    ["lone low surrogate", "\udc00", "Note(\"\\udc00\")"],
  ])("round-trips %s", (_, payload, text) => {
    const output = JSTN.stringify(new Note(payload), note)
    expect(output).toBe(text)
    expect(JSTN.parse(output, note)).toStrictEqual(new Note(payload))
  })
})

describe("decode failures", () => {
  it("rejects the wrong tag", () => {
    const error = fails(() => money.decode({ kind: "tagged", tag: "Note", payload: "x", pos }, ["price"]))
    expect(error.message).toBe("$.price: expected Money, got Note (line 2, column 10)")
  })

  it("rejects a non-tagged node", () => {
    const error = fails(() => money.decode({ kind: "string", value: "12.50 GBP", pos }, ["price"]))
    expect(error.message).toBe("$.price: expected Money, got string \"12.50 GBP\" (line 2, column 10)")
  })

  it("wraps an Error thrown by parse and keeps the cause", () => {
    const error = fails(() => money.decode({ kind: "tagged", tag: "Money", payload: "abc", pos }, ["price"]))
    expect(error.message).toBe("$.price: invalid Money \"abc\": expected \"<amount> <CCY>\" (line 2, column 10)")
    expect(error.cause).toBeInstanceOf(Error)
    expect((error.cause as Error).message).toBe("expected \"<amount> <CCY>\"")
  })

  it("escapes U+007F in the payload label", () => {
    const error = fails(() => money.decode({ kind: "tagged", tag: "Money", payload: "x\u007fy", pos }, []))
    expect(error.message).toBe("$: invalid Money \"x\\u007fy\": expected \"<amount> <CCY>\" (line 2, column 10)")
  })

  it("wraps a non-Error thrown by parse", () => {
    const type = moneyWith({
      parse: () => {
        throw "nope"
      },
    })
    const error = fails(() => type.decode({ kind: "tagged", tag: "Money", payload: "x y", pos }, []))
    expect(error.message).toBe("$: invalid Money \"x y\": nope (line 2, column 10)")
    expect(error.cause).toBe("nope")
  })

  it("rejects a parse result that match refuses", () => {
    const type = moneyWith({ parse: () => ({ amount: "1", currency: "GBP" }) })
    const error = fails(() => type.decode({ kind: "tagged", tag: "Money", payload: "1 GBP", pos }, ["price"]))
    expect(error.message).toBe("$.price: invalid Money \"1 GBP\": parse result rejected by match (line 2, column 10)")
  })

  it("lets a non-JSTNError from match propagate", () => {
    const type = moneyWith({
      match: () => {
        throw new TypeError("bad match")
      },
    })
    expect(() => type.encode(new Money("1", "GBP"), [])).toThrow(TypeError)
  })
})

describe("encode failures", () => {
  it("rejects a value that match refuses", () => {
    const error = fails(() => money.encode("12.50 GBP", ["price"]))
    expect(error.message).toBe("$.price: expected Money, got string \"12.50 GBP\"")
    expect(fails(() => money.encode(new Note("x"), [])).message).toBe("$: expected Money, got Note")
  })

  it("wraps a throwing stringify", () => {
    const cause = new Error("boom")
    const type = moneyWith({
      stringify: () => {
        throw cause
      },
    })
    const error = fails(() => JSTN.validate({ c: new Money("1", "GBP") }, { c: type }))
    expect(error.message).toBe("$.c: cannot stringify Money: boom")
    expect(error.cause).toBe(cause)
    expect(error.line).toBeUndefined()
  })

  it("rejects a stringify result that is not a string", () => {
    const type = moneyWith({ stringify: () => 12 as unknown as string })
    expect(fails(() => type.encode(new Money("1", "GBP"), ["c"])).message).toBe("$.c: cannot stringify Money: stringify must return a string")
  })
})

describe("name validation", () => {
  it.each(["true", "false", "null", "NaN", "Infinity", "number", "string", "boolean", "bigint", "", "a b", "1x", "é", "a-b", "Money()"])(
    "rejects %o",
    (name) => {
      const error = fails(() => moneyWith({ name }))
      expect(error.message).toBe(`$: invalid type name ${JSON.stringify(name)}`)
    },
  )

  it.each(["Date", "Set", "Map", "_x", "$y", "Money2"])("accepts %o", (name) => {
    expect(moneyWith({ name }).name).toBe(name)
  })
})

describe("createType with a class name", () => {
  class Point {
    x: number
    constructor(x: number) {
      this.x = x
    }
  }
  const point = createType({ name: Point, parse: (text) => new Point(Number(text)), stringify: (p) => String(p.x) })

  it("takes its tag from the class and matches instances by default", () => {
    expect(point.name).toBe("Point")
    expect(JSTN.stringify(new Point(3), point)).toBe("Point(3)")
    expect(JSTN.parse("Point(4)", point)).toStrictEqual(new Point(4))
    expect(fails(() => JSTN.stringify({ x: 1 }, point)).message).toBe("$: expected Point, got object")
  })

  it("lets an explicit match override the default", () => {
    const positive = createType({ name: Point, match: (v) => v instanceof Point && v.x > 0, parse: (text) => new Point(Number(text)), stringify: (p) => String(p.x) })
    expect(JSTN.is(new Point(1), positive)).toBe(true)
    expect(JSTN.is(new Point(-1), positive)).toBe(false)
    expect(fails(() => JSTN.parse("Point(-1)", positive)).message).toBe("$: invalid Point \"-1\": parse result rejected by match (line 1, column 1)")
  })

  it("rejects an anonymous class", () => {
    const anonymous = (() => class {})()
    expect(fails(() => createType({ name: anonymous, parse: () => new anonymous(), stringify: () => "" })).message).toBe("$: invalid type name \"\"")
  })

  it("requires match for a string name at runtime", () => {
    const loose = { name: "Point", parse: (text: string) => new Point(Number(text)), stringify: (p: Point) => String(p.x) } as unknown as Parameters<typeof createType<Point>>[0]
    expect(fails(() => createType(loose)).message).toBe("$: \"Point\" needs a match function")
  })
})
