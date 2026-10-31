import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { JSTNError } from "../../src/core/error.ts"
import type { Entry, Node } from "../../src/core/type.ts"
import { readData } from "../../src/syntax/read-data.ts"
import { writeData } from "../../src/syntax/write-data.ts"

const RUNS = { numRuns: 300 }
const SPACES = [undefined, 2, "\t"] as const
const KEYWORDS = new Set(["null", "true", "false", "NaN", "Infinity"])

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

function expectTotal(text: string): void {
  try {
    readData(text)
  } catch (error) {
    if (!(error instanceof JSTNError)) throw error
    const lines = text.split(/\r\n|\r|\n/)
    const line = error.line ?? 0
    const column = error.column ?? 0
    expect(line).toBeGreaterThanOrEqual(1)
    expect(line).toBeLessThanOrEqual(lines.length)
    expect(column).toBeGreaterThanOrEqual(1)
    expect(column).toBeLessThanOrEqual((lines[line - 1]?.length ?? 0) + 1)
  }
}

const tricky = fc.constantFrom("\"", "'", "\\", "(", ")", "[", "]", "{", "}", ",", ":", " ", "\n", "\r", "\t", "\u0000", "\u007f", "/", "*", "﻿", " ")
const lone = fc.constantFrom("\uD800", "\uDBFF", "\uDC00", "\uDFFF")
const anyChar = fc.oneof(fc.string({ unit: "binary", minLength: 1, maxLength: 1 }), tricky, lone)
const text = fc.string({ unit: anyChar, maxLength: 12 })
const tag = fc.stringMatching(/^[A-Za-z_$][A-Za-z0-9_$]{0,6}$/).filter((name) => !KEYWORDS.has(name))

const scalar: fc.Arbitrary<Node> = fc.oneof(
  fc.constant<Node>({ kind: "null" }),
  fc.boolean().map((value): Node => ({ kind: "boolean", value })),
  fc.oneof(fc.double(), fc.constantFrom(-0, 0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)).map((value): Node => ({ kind: "number", value })),
  fc.bigInt().map((value): Node => ({ kind: "bigint", value })),
  text.map((value): Node => ({ kind: "string", value })),
  fc.tuple(tag, text).map(([name, payload]): Node => ({ kind: "tagged", tag: name, payload })),
)

const { node } = fc.letrec<{ node: Node }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    scalar,
    fc.tuple(fc.option(tag, { nil: null }), fc.array(tie("node"), { maxLength: 4 })).map(([name, items]): Node => ({ kind: "list", tag: name, items })),
    fc
      .uniqueArray(fc.tuple(text, tie("node")), { selector: ([key]) => key, maxLength: 4 })
      .map((pairs): Node => ({ kind: "object", entries: pairs.map(([key, value]): Entry => ({ key, value })) })),
  ),
}))

describe("round trip", () => {
  it.each(SPACES)("readData(writeData(n, %j)) equals n", (space) => {
    fc.assert(
      fc.property(node, (n) => {
        expect(strip(readData(writeData(n, space)))).toStrictEqual(n)
      }),
      RUNS,
    )
  })

  it("compact and pretty output read back to equal Nodes", () => {
    fc.assert(
      fc.property(node, (n) => {
        expect(strip(readData(writeData(n)))).toStrictEqual(strip(readData(writeData(n, 2))))
      }),
      RUNS,
    )
  })
})

describe("JSON superset", () => {
  it("reads any JSON text as JSON.parse does", () => {
    fc.assert(
      fc.property(fc.json(), (json) => {
        expect(toPlain(readData(json))).toStrictEqual(JSON.parse(json))
      }),
      RUNS,
    )
  })

  it("reads indented JSON as JSON.parse does", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.constantFrom(2, "\t"), (value, space) => {
        const json = JSON.stringify(value, null, space)
        expect(toPlain(readData(json))).toStrictEqual(JSON.parse(json))
      }),
      RUNS,
    )
  })
})

describe("total reader", () => {
  it("returns or throws a positioned JSTNError for arbitrary strings", () => {
    fc.assert(fc.property(fc.string(), expectTotal), RUNS)
    fc.assert(fc.property(fc.string({ unit: anyChar, maxLength: 40 }), expectTotal), RUNS)
  })

  it("returns or throws a positioned JSTNError for valid documents with one character inserted or deleted", () => {
    fc.assert(
      fc.property(node, fc.constantFrom(...SPACES), fc.nat(), anyChar, fc.boolean(), (n, space, at, char, insert) => {
        const doc = writeData(n, space)
        const index = at % (doc.length + 1)
        expectTotal(insert ? doc.slice(0, index) + char + doc.slice(index) : doc.slice(0, index) + doc.slice(index + 1))
      }),
      RUNS,
    )
  })
})
