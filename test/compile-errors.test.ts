import { afterAll, describe, expect, it } from "vitest"

type ChildProcess = { spawnSync(command: string, args: string[], options: { cwd: string; encoding: "utf8" }): { stdout: string } }
type FileSystem = {
  mkdtempSync(prefix: string): string
  writeFileSync(path: string, data: string): void
  rmSync(path: string, options: { recursive: true; force: true }): void
}

const childProcess: ChildProcess = await import("node:child_process" as string)
const fs: FileSystem = await import("node:fs" as string)
const os: { tmpdir(): string } = await import("node:os" as string)

const root = `${(import.meta as { dirname: string }).dirname}/..`
const imports = `import { JSTN, array, createCollection, createType, set } from "${root}/src/index.ts"\n`
const spec = "match: () => true, toItems: (v: number[]) => v, fromItems: (v: number[]) => v"

const rejected: [string, string][] = [
  ["stringify of a wrong field type", "JSTN.stringify({ a: \"x\" }, { a: Number })"],
  ["stringify of a wrong array item", "JSTN.stringify([\"x\"], array(Number))"],
  ["stringify of a wrong Set item", "JSTN.stringify(new Set([1]), set(String))"],
  ["stringify of a string against the empty shape", "JSTN.stringify(\"x\", {})"],
  ["stringify of a key against the empty shape", "JSTN.stringify({ a: 1 }, {})"],
  ["createType whose stringify does not take the parse result", "createType({ name: \"N\", match: () => true, parse: Number, stringify: (s: string) => s })"],
  ["createCollection with no parameters", `createCollection("Zero", () => ({ items: Number, ${spec} }))`],
  ["createCollection with a rest parameter", `createCollection("Rest", (...items: NumberConstructor[]) => ({ items: Number, ${spec} }))`],
  ["createCollection with a default parameter", `createCollection("Default", (item = Number) => ({ items: item, ${spec} }))`],
]
const accepted = "JSTN.stringify({ a: 1 }, { a: Number })"

const dir = fs.mkdtempSync(`${os.tmpdir()}/jstn-compile-`)
fs.writeFileSync(`${dir}/package.json`, "{ \"type\": \"module\" }")
fs.writeFileSync(`${dir}/tsconfig.json`, JSON.stringify({ extends: `${root}/tsconfig.json`, compilerOptions: { rewriteRelativeImportExtensions: false }, include: ["*.ts"] }))
const sources = [accepted, ...rejected.map(([, source]) => source)]
sources.forEach((source, i) => fs.writeFileSync(`${dir}/case${i}.ts`, `${imports}${source}\n`))
const output = childProcess.spawnSync(`${root}/node_modules/.bin/tsc`, ["--noEmit", "-p", "."], { cwd: dir, encoding: "utf8" }).stdout
const errors = [...output.matchAll(/^(\S+)\((\d+),\d+\): error TS\d+/gm)].map((match) => ({ file: match[1], line: Number(match[2]) }))

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function errorLines(i: number): number[] {
  return errors.filter((error) => error.file === `case${i}.ts`).map((error) => error.line)
}

describe("compile errors at inferred call sites", () => {
  it("reports errors only in the cases", () => {
    expect(errors.filter((error) => !/^case\d+\.ts$/.test(error.file ?? ""))).toStrictEqual([])
  })

  it("accepts a matching value", () => {
    expect(errorLines(0)).toStrictEqual([])
  })

  it.each(rejected.map(([name], i) => [name, i + 1] as const))("rejects %s", (_, i) => {
    const lines = errorLines(i)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every((line) => line === 2)).toBe(true)
  })
})
