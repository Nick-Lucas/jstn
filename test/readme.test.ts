import { describe, expect, it } from "vitest"
import { JSTN } from "../src/index.ts"
import type { Type } from "../src/index.ts"
import { registry } from "./support/fixtures.ts"

type Block = { readonly lang: string; readonly body: string; readonly line: number }

type FileSystem = { readFileSync(path: string, encoding: "utf8"): string }

const fs: FileSystem = await import("node:fs" as string)
const readme = fs.readFileSync("README.md", "utf8")

const blocks: Block[] = [...readme.matchAll(/^```(\S*)\n([\s\S]*?)^```$/gm)].map((match) => ({
  lang: match[1] ?? "",
  body: match[2] ?? "",
  line: readme.slice(0, match.index).split("\n").length,
}))

const schemas = blocks.filter((block) => block.lang === "jstn-schema")

function schemaBefore(block: Block): Type<unknown> {
  const source = schemas.findLast((schema) => schema.line < block.line)
  if (source === undefined) throw new Error(`no jstn-schema block before line ${block.line}`)
  return JSTN.parseSchema(source.body, { types: registry })
}

describe("README", () => {
  it("has at least one jstn-schema block and one jstn block", () => {
    expect(schemas.length).toBeGreaterThan(0)
    expect(blocks.some((block) => block.lang === "jstn")).toBe(true)
  })

  it("uses only known fence languages", () => {
    expect(blocks.filter((block) => !["ts", "jstn", "jstn-schema", "ebnf", "text"].includes(block.lang))).toStrictEqual([])
  })

  it.each(schemas.map((block) => [block.line, block]))("parses the jstn-schema block at line %i", (_, block) => {
    expect(() => JSTN.parseSchema(block.body, { types: registry })).not.toThrow()
  })

  it.each(blocks.filter((block) => block.lang === "jstn").map((block) => [block.line, block]))(
    "parses the jstn block at line %i against the schema above it and round-trips it",
    (_, block) => {
      const type = schemaBefore(block)
      const value = JSTN.parse(block.body, type)
      const text = JSTN.stringify(value, type, 2)
      expect(JSTN.parse(text, type)).toStrictEqual(value)
      expect(JSTN.stringify(JSTN.parse(text, type), type, 2)).toBe(text)
    },
  )
})
