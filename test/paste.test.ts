import { afterAll, describe, expect, it } from "vitest"
import { JSTN, array, bigint, boolean, date, map, number, optional, set, string, tuple, union } from "../src/index.ts"
import type { Type } from "../src/index.ts"
import { S, money, note, sortedSet } from "./support/fixtures.ts"

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
const builders = { JSTN, number, string, boolean, bigint, date, array, tuple, union, set, map, optional }
const fixtures = { money, note, sortedSet, S }
const scope = { ...builders, ...fixtures }
const header = [
  "import { expectTypeOf } from \"vitest\"",
  `import { ${Object.keys(builders).join(", ")} } from "${root}/src/index.ts"`,
  `import type { Infer } from "${root}/src/index.ts"`,
  `import { ${Object.keys(fixtures).join(", ")} } from "${root}/test/support/fixtures.ts"`,
].join("\n")

const cases: [string, string][] = [
  ["the fixture schema", "S"],
  ["nested objects with quoted keys and optional fields", "JSTN.schema({ a: { \"b c\": optional({ d: null, \"e-f\": optional(Date) }) }, \"\": number, null: boolean })"],
  ["unions of collections", "union(array(number), set(string), map(string, union(bigint, null)), sortedSet(number))"],
  ["nested unions", "union(number, union(string, union(boolean, null)))"],
  ["tuples including the empty tuple", "tuple(tuple(), tuple(number), tuple(string, date, { a: tuple() }))"],
  ["custom types and collections", "map(money, array(union(note, sortedSet(union(number, string)))))"],
  ["constructor shorthands", "JSTN.schema({ n: Number, s: String, b: Boolean, i: BigInt, d: Date })"],
  ["scalars", "union(number, string, boolean, bigint, null, date)"],
]

function evaluate(source: string): Type<unknown> {
  return new Function(...Object.keys(scope), `return JSTN.schema(${source})`)(...Object.values(scope)) as Type<unknown>
}

function file(original: string, pasted: string): string {
  return `${header}\nconst original = ${original}\nconst pasted = JSTN.schema(${pasted})\nexpectTypeOf<Infer<typeof pasted>>().toEqualTypeOf<Infer<typeof original>>()\n`
}

const names = cases.map(([, source]) => evaluate(source).name)
const control = file("array(number)", "array(string)")

const dir = fs.mkdtempSync(`${os.tmpdir()}/jstn-paste-`)
fs.writeFileSync(`${dir}/package.json`, "{ \"type\": \"module\" }")
fs.writeFileSync(`${dir}/tsconfig.json`, JSON.stringify({
  extends: `${root}/tsconfig.json`,
  compilerOptions: { rewriteRelativeImportExtensions: false, paths: { vitest: [`${root}/node_modules/vitest/dist/index.d.ts`] } },
  include: ["*.ts"],
}))
cases.forEach(([, source], i) => fs.writeFileSync(`${dir}/case${i}.ts`, file(source, names[i]!)))
fs.writeFileSync(`${dir}/control.ts`, control)
const result = childProcess.spawnSync(`${root}/node_modules/.bin/tsc`, ["--noEmit", "-p", "."], { cwd: dir, encoding: "utf8" })
const errors = [...result.stdout.matchAll(/^(\S+)\((\d+),\d+\): error TS\d+/gm)].map((match) => ({ file: match[1], line: Number(match[2]) }))

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function errorLines(file: string): number[] {
  return errors.filter((error) => error.file === file).map((error) => error.line)
}

describe("pasting a schema name into TypeScript", () => {
  it("reports no type errors outside the generated files", () => {
    expect(errors.filter((error) => !/^(case\d+|control)\.ts$/.test(error.file ?? ""))).toStrictEqual([])
  })

  it("fails the type check when the pasted schema infers a different type", () => {
    expect(errorLines("control.ts")).toStrictEqual([7])
  })

  it.each(cases.map(([label], i) => [label, names[i]!, i] as const))("type checks %s pasted from its name", (_, name, i) => {
    expect(errorLines(`case${i}.ts`)).toStrictEqual([])
    expect(evaluate(name).name).toBe(name)
  })
})
