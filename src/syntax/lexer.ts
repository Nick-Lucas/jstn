import { describeValue } from "../core/error.ts"
import { IDENT, quote, RAW_FORBIDDEN } from "../core/strings.ts"
import type { Pos } from "../core/type.ts"

export type Token =
  | { readonly kind: "ident"; readonly value: string; readonly pos: Pos; readonly adjacent: boolean }
  | { readonly kind: "string"; readonly value: string; readonly pos: Pos; readonly adjacent: boolean }
  | { readonly kind: "number"; readonly value: number; readonly pos: Pos; readonly adjacent: boolean }
  | { readonly kind: "bigint"; readonly value: bigint; readonly pos: Pos; readonly adjacent: boolean }
  | { readonly kind: "punct"; readonly value: string; readonly pos: Pos; readonly adjacent: boolean }
  | { readonly kind: "eof"; readonly value: ""; readonly pos: Pos; readonly adjacent: boolean }

const PUNCT = new Set(["{", "}", "[", "]", "(", ")", ",", ":"])
const WS = new Set([" ", "\t", "\n", "\r"])
const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y
const NUMBER_RUN = /-?(?:[0-9A-Za-z_$.]|(?<=[eE])[+-])*/y
const NUMBER_TAIL = /[A-Za-z0-9_$.]/
const HEX4 = /[0-9A-Fa-f]{0,4}/y
const HEX_BRACED = /\{[0-9A-Fa-f]*\}?/y
const SIMPLE_ESCAPES = new Map([
  ["\"", "\""],
  ["'", "'"],
  ["\\", "\\"],
  ["/", "/"],
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
])

function matchAt(pattern: RegExp, source: string, offset: number): string {
  pattern.lastIndex = offset
  return pattern.exec(source)?.[0] ?? ""
}

export function describeToken(token: Token): string {
  switch (token.kind) {
    case "punct": return quote(token.value)
    case "ident": return `identifier ${quote(token.value)}`
    case "string":
    case "number":
    case "bigint": return describeValue(token.value)
    case "eof": return "end of input"
  }
}

export class Lexer {
  readonly #source: string
  readonly #fail: (reason: string, pos: Pos) => never
  #offset = 0
  #line = 1
  #lineStart = 0
  #buffered: Token | undefined = undefined

  constructor(source: string, fail: (reason: string, pos: Pos) => never) {
    this.#source = source
    this.#fail = fail
    if (source.startsWith("﻿")) {
      this.#offset = 1
      this.#lineStart = 1
    }
  }

  peek(): Token {
    this.#buffered ??= this.#read()
    return this.#buffered
  }

  next(): Token {
    const token = this.peek()
    this.#buffered = undefined
    return token
  }

  eat(punct: string): boolean {
    const token = this.peek()
    if (token.kind !== "punct" || token.value !== punct) return false
    this.next()
    return true
  }

  expect(punct: string): void {
    if (!this.eat(punct)) this.unexpected(this.peek(), quote(punct))
  }

  more(close: string): boolean {
    if (this.eat(",")) return true
    if (!this.eat(close)) this.unexpected(this.peek(), `"," or ${quote(close)}`)
    return false
  }

  readKey(): Extract<Token, { kind: "ident" | "string" }> {
    const token = this.next()
    if (token.kind !== "ident" && token.kind !== "string") return this.unexpected(token, "key")
    return token
  }

  expectEnd(): void {
    const token = this.next()
    if (token.kind !== "eof") this.unexpected(token, "end of input")
  }

  unexpected(token: Token, expected: string): never {
    return this.#fail(`unexpected ${describeToken(token)}, expected ${expected}`, token.pos)
  }

  readPayload(open: Pos): string {
    if (this.#buffered !== undefined) throw new Error("readPayload called with a buffered token")
    this.#skipWhitespace()
    const first = this.#source[this.#offset]
    if (first === undefined) return this.#fail("unterminated payload", open)
    if (first === "\"" || first === "'") return this.#readQuotedPayload(open)
    return this.#readRawPayload(open)
  }

  #readQuotedPayload(open: Pos): string {
    const value = this.#readString(this.#pos())
    this.#skipWhitespace()
    const next = this.#source[this.#offset]
    if (next === undefined) return this.#fail("unterminated payload", open)
    if (next !== ")") return this.#fail(`expected ")" after quoted payload`, this.#pos())
    this.#offset += 1
    return value
  }

  #readRawPayload(open: Pos): string {
    const source = this.#source
    const close = source.indexOf(")", this.#offset)
    if (close === -1) return this.#fail("unterminated payload", open)
    let end = close
    while (end > this.#offset && WS.has(source[end - 1] ?? "")) end -= 1
    const body = source.slice(this.#offset, end)
    const bad = body.search(RAW_FORBIDDEN)
    if (bad !== -1) {
      this.#offset += bad
      return this.#fail(`invalid character ${quote(body[bad] ?? "")} in payload; quote the payload`, this.#pos())
    }
    this.#advanceTo(close + 1)
    return body
  }

  #pos(): Pos {
    return { line: this.#line, column: this.#offset - this.#lineStart + 1 }
  }

  #advanceTo(end: number): void {
    const source = this.#source
    for (let i = this.#offset; i < end; i++) {
      const char = source[i]
      if (char === "\n" || (char === "\r" && source[i + 1] !== "\n")) {
        this.#line += 1
        this.#lineStart = i + 1
      }
    }
    this.#offset = end
  }

  #skipWhitespace(): void {
    let end = this.#offset
    while (WS.has(this.#source[end] ?? "")) end += 1
    this.#advanceTo(end)
  }

  #skipTrivia(): boolean {
    const source = this.#source
    const start = this.#offset
    for (;;) {
      this.#skipWhitespace()
      if (source.startsWith("//", this.#offset)) {
        let end = this.#offset + 2
        while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end += 1
        this.#offset = end
      } else if (source.startsWith("/*", this.#offset)) {
        const close = source.indexOf("*/", this.#offset + 2)
        if (close === -1) return this.#fail("unterminated comment", this.#pos())
        this.#advanceTo(close + 2)
      } else {
        return this.#offset !== start
      }
    }
  }

  #read(): Token {
    const adjacent = !this.#skipTrivia()
    const pos = this.#pos()
    const source = this.#source
    const char = source[this.#offset]
    if (char === undefined) return { kind: "eof", value: "", pos, adjacent }
    const ident = matchAt(IDENT, source, this.#offset)
    if (ident !== "") {
      this.#offset += ident.length
      return { kind: "ident", value: ident, pos, adjacent }
    }
    if (char === "\"" || char === "'") return { kind: "string", value: this.#readString(pos), pos, adjacent }
    if (PUNCT.has(char)) {
      this.#offset += 1
      return { kind: "punct", value: char, pos, adjacent }
    }
    if (char === "-" && matchAt(IDENT, source, this.#offset + 1) === "Infinity") {
      this.#offset += 9
      return { kind: "number", value: -Infinity, pos, adjacent }
    }
    const digit = char === "-" ? source[this.#offset + 1] : char
    if (digit !== undefined && digit >= "0" && digit <= "9") return this.#readNumber(pos, adjacent)
    if (char === "-" || char === "+" || char === ".") return this.#fail(`unexpected ${quote(char)}`, pos)
    const codePoint = source.codePointAt(this.#offset) ?? 0
    return this.#fail(`unexpected character ${quote(String.fromCodePoint(codePoint))}`, pos)
  }

  #readNumber(pos: Pos, adjacent: boolean): Token {
    const source = this.#source
    const start = this.#offset
    NUMBER.lastIndex = start
    const match = NUMBER.exec(source)
    const text = match?.[0] ?? ""
    const end = start + text.length
    const after = source[end] ?? ""
    const isInteger = match?.[1] === undefined && match?.[2] === undefined
    if (isInteger && after === "n" && !NUMBER_TAIL.test(source[end + 1] ?? "")) {
      this.#offset = end + 1
      return { kind: "bigint", value: BigInt(text), pos, adjacent }
    }
    if (NUMBER_TAIL.test(after)) {
      return this.#fail(`invalid number ${quote(matchAt(NUMBER_RUN, source, start))}`, pos)
    }
    this.#offset = end
    return { kind: "number", value: Number(text), pos, adjacent }
  }

  #readString(open: Pos): string {
    const source = this.#source
    const closer = source[this.#offset]
    let i = this.#offset + 1
    let chunkStart = i
    let value = ""
    for (;;) {
      const char = source[i]
      if (char === undefined) return this.#fail("unterminated string", open)
      if (char === closer) break
      const code = source.charCodeAt(i)
      if (code <= 0x1f) {
        return this.#fail("control character in string", { line: this.#line, column: i - this.#lineStart + 1 })
      }
      if (char !== "\\") {
        i += 1
        continue
      }
      value += source.slice(chunkStart, i)
      const [decoded, length] = this.#readEscape(i, open)
      value += decoded
      i += length
      chunkStart = i
    }
    value += source.slice(chunkStart, i)
    this.#offset = i + 1
    return value
  }

  #readEscape(at: number, open: Pos): [string, number] {
    const source = this.#source
    const char = source[at + 1]
    if (char === undefined) return this.#fail("unterminated string", open)
    const simple = SIMPLE_ESCAPES.get(char)
    if (simple !== undefined) return [simple, 2]
    if (char === "u") {
      const braced = matchAt(HEX_BRACED, source, at + 2)
      if (braced !== "") {
        const value = Number.parseInt(braced.slice(1, -1), 16)
        if (braced.length > 2 && braced.endsWith("}") && value <= 0x10ffff) {
          return [String.fromCodePoint(value), 2 + braced.length]
        }
        return this.#badEscape(at, `\\u${braced}`)
      }
      const hex = matchAt(HEX4, source, at + 2)
      if (hex.length === 4) return [String.fromCharCode(Number.parseInt(hex, 16)), 6]
      return this.#badEscape(at, `\\u${hex}`)
    }
    return this.#badEscape(at, `\\${String.fromCodePoint(source.codePointAt(at + 1) ?? 0)}`)
  }

  #badEscape(at: number, text: string): never {
    return this.#fail(`invalid escape "${text}"`, { line: this.#line, column: at - this.#lineStart + 1 })
  }
}
