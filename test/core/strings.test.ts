import { describe, expect, it } from "vitest"
import { assertTypeName, JSTNError } from "../../src/core/error.ts"
import { RESERVED, formatKey, isRawPayload, quote } from "../../src/core/strings.ts"

describe("quote", () => {
  it.each([
    ["plain text", "hello world", "\"hello world\""],
    ["empty", "", "\"\""],
    ["double quote", "a\"b", "\"a\\\"b\""],
    ["backslash", "a\\b", "\"a\\\\b\""],
    ["single quote is literal", "it's", "\"it's\""],
    ["backspace", "\b", "\"\\b\""],
    ["form feed", "\f", "\"\\f\""],
    ["newline", "\n", "\"\\n\""],
    ["carriage return", "\r", "\"\\r\""],
    ["tab", "\t", "\"\\t\""],
    ["U+0000", "\u0000", "\"\\u0000\""],
    ["U+001F", "\u001f", "\"\\u001f\""],
    ["U+007F", "\u007f", "\"\\u007f\""],
    ["lone high surrogate", "a\ud83db", "\"a\\ud83db\""],
    ["lone low surrogate", "a\ude00b", "\"a\\ude00b\""],
    ["high surrogate at end", "\udbff", "\"\\udbff\""],
    ["two high surrogates then low", "\ud83d\ud83d\ude00", "\"\\ud83d\ud83d\ude00\""],
    ["surrogate pair", "😀", "\"😀\""],
    ["non-ASCII text", "héllo wörld 日本", "\"héllo wörld 日本\""],
    ["U+FEFF", "\ufeff", "\"\ufeff\""],
  ])("%s", (_name, input, expected) => {
    expect(quote(input)).toBe(expected)
  })
})

describe("formatKey", () => {
  it.each(["a", "_x", "$y", "null", "true", "abc123", "A_$9"])("writes %s bare", (key) => {
    expect(formatKey(key)).toBe(key)
  })

  it.each([
    ["", "\"\""],
    ["a b", "\"a b\""],
    ["1a", "\"1a\""],
    ["é", "\"é\""],
    ["a-b", "\"a-b\""],
    ["a\"b", "\"a\\\"b\""],
  ])("quotes %j", (key, expected) => {
    expect(formatKey(key)).toBe(expected)
  })
})

describe("isRawPayload", () => {
  it.each(["2026-01-01T14:00:00Z", "12.50 GBP", "https://x.io//a", "a", "inner  spaces", "日本", "😀", "/* not a comment */"])(
    "accepts %j",
    (payload) => {
      expect(isRawPayload(payload)).toBe(true)
    },
  )

  it.each([
    ["empty", ""],
    ["leading space", " a"],
    ["trailing space", "a "],
    ["open paren", "a(b"],
    ["close paren", "a)b"],
    ["double quote", "a\"b"],
    ["single quote", "a'b"],
    ["backslash", "a\\b"],
    ["U+0000", "a\u0000b"],
    ["U+001F", "a\u001fb"],
    ["U+007F", "a\u007fb"],
    ["newline", "a\nb"],
    ["tab", "a\tb"],
    ["lone high surrogate", "a\ud800b"],
    ["lone low surrogate", "\udc00"],
  ])("rejects %s", (_name, payload) => {
    expect(isRawPayload(payload)).toBe(false)
  })
})

describe("assertTypeName", () => {
  it.each(["Money", "Date", "Set", "Map", "_x", "$y", "a1"])("accepts %s", (name) => {
    expect(() => assertTypeName(name)).not.toThrow()
  })

  it.each<[string, string]>([
    ["", "$: invalid type name \"\""],
    ["a b", "$: invalid type name \"a b\""],
    ["1x", "$: invalid type name \"1x\""],
    ["é", "$: invalid type name \"é\""],
    ...RESERVED.map((name): [string, string] => [name, `$: invalid type name "${name}"`]),
  ])("rejects %j", (name, message) => {
    let thrown: unknown
    try {
      assertTypeName(name)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(JSTNError)
    expect(thrown).toHaveProperty("message", message)
  })

  it("reserves exactly the documented names", () => {
    expect(RESERVED).toStrictEqual(["true", "false", "null", "NaN", "Infinity", "number", "string", "boolean", "bigint", "unknown"])
  })
})
