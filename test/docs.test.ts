import { afterAll, describe, expect, it } from "vitest"
import { JSTN, createType } from "../src/index.ts"
import type { Type } from "../src/index.ts"
import { registry } from "./support/fixtures.ts"

type Block = { readonly file: string; readonly lang: string; readonly flags: string; readonly body: string; readonly line: number }

type FileSystem = {
  readFileSync(path: string, encoding: "utf8"): string
  readdirSync(path: string): string[]
  mkdtempSync(prefix: string): string
  writeFileSync(path: string, data: string): void
  rmSync(path: string, options: { recursive: true; force: true }): void
}
type ChildProcess = { spawnSync(command: string, args: string[], options: { cwd: string; encoding: "utf8" }): { stdout: string } }

const fs: FileSystem = await import("node:fs" as string)
const os: { tmpdir(): string } = await import("node:os" as string)
const childProcess: ChildProcess = await import("node:child_process" as string)

const root = `${(import.meta as { dirname: string }).dirname}/..`
const files = ["README.md", ...fs.readdirSync(`${root}/docs`).filter((name) => name.endsWith(".md")).map((name) => `docs/${name}`)]

class FakeURL {
  readonly href: string
  constructor(href: string) {
    this.href = href
  }
}
const types = { ...registry, URL: createType({ name: "URL", match: (v) => v instanceof FakeURL, parse: (text) => new FakeURL(text), stringify: (u) => u.href }) }

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length
}

function blocksIn(file: string): Block[] {
  const text = fs.readFileSync(`${root}/${file}`, "utf8")
  const fenced = [...text.matchAll(/^```(\S*)([^\n]*)\n([\s\S]*?)^```$/gm)].map((match) => ({
    file,
    lang: match[1] ?? "",
    flags: (match[2] ?? "").trim(),
    body: match[3] ?? "",
    line: lineOf(text, match.index),
  }))
  const hidden = [...text.matchAll(/^<!-- jstn-schema ([\s\S]*?) -->$/gm)].map((match) => ({
    file,
    lang: "jstn-schema",
    flags: "hidden",
    body: match[1] ?? "",
    line: lineOf(text, match.index),
  }))
  return [...fenced, ...hidden].sort((a, b) => a.line - b.line)
}

const blocks = files.flatMap(blocksIn)
const schemas = blocks.filter((block) => block.lang === "jstn-schema")
const data = blocks.filter((block) => block.lang === "jstn")
const code = blocks.filter((block) => block.lang === "ts" && block.flags !== "nocheck")

function schemaBefore(block: Block): Type<unknown> {
  const source = schemas.findLast((schema) => schema.file === block.file && schema.line < block.line)
  if (source === undefined) throw new Error(`no jstn-schema block before ${block.file}:${block.line}`)
  return JSTN.parseSchema(source.body, { types })
}

const dir = fs.mkdtempSync(`${os.tmpdir()}/jstn-docs-`)
fs.writeFileSync(`${dir}/package.json`, "{ \"type\": \"module\" }")
fs.writeFileSync(`${dir}/tsconfig.json`, JSON.stringify({
  extends: `${root}/tsconfig.json`,
  compilerOptions: { rewriteRelativeImportExtensions: false, lib: ["es2024", "dom"], paths: { jstn: [`${root}/src/index.ts`] } },
  include: ["*.ts"],
}))
code.forEach((block, i) => fs.writeFileSync(`${dir}/block${i}.ts`, block.body))
const output = code.length === 0 ? "" : childProcess.spawnSync(`${root}/node_modules/.bin/tsc`, ["--noEmit", "-p", "."], { cwd: dir, encoding: "utf8" }).stdout

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const label = (block: Block) => `${block.file}:${block.line}`

describe("documentation", () => {
  it("has schema, data and code blocks", () => {
    expect(schemas.length).toBeGreaterThan(0)
    expect(data.length).toBeGreaterThan(0)
    expect(code.length).toBeGreaterThan(0)
  })

  it("uses only known fence languages", () => {
    expect(blocks.filter((block) => !["ts", "jstn", "jstn-schema", "ebnf", "text", "sh"].includes(block.lang)).map(label)).toStrictEqual([])
  })

  it.each(schemas.map((block) => [label(block), block]))("parses the jstn-schema block at %s", (_, block) => {
    expect(() => JSTN.parseSchema(block.body, { types })).not.toThrow()
  })

  it.each(data.map((block) => [label(block), block]))("parses the jstn block at %s against the schema above it", (_, block) => {
    const type = schemaBefore(block)
    const value = JSTN.parse(block.body, type)
    const text = JSTN.stringify(value, type, 2)
    expect(JSTN.parse(text, type)).toStrictEqual(value)
    expect(JSTN.stringify(JSTN.parse(text, type), type, 2)).toBe(text)
    if (!block.body.trim().includes("\n")) expect(JSTN.stringify(value, type)).toBe(block.body.trim())
  })

  it.each(code.map((block, i) => [label(block), i]))("type-checks the ts block at %s", (_, i) => {
    expect(output.split("\n").filter((line) => line.startsWith(`block${i}.ts(`))).toStrictEqual([])
  })
})
