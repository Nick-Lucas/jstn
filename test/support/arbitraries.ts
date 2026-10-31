import fc from "fast-check"
import { JSTN, array, bigint, boolean, date, map, number, optional, set, string, tuple, union } from "../../src/index.ts"
import type { Optional, Path, Schema, Type } from "../../src/index.ts"
import { Money, Note, SortedSet, money, note, sortedSet } from "./fixtures.ts"

export type Mutant = { readonly value: unknown; readonly path: Path }

export type Gen = {
  readonly type: Type<unknown>
  readonly value: fc.Arbitrary<unknown>
  readonly mutant: fc.Arbitrary<Mutant>
}

type Field = { readonly key: string; readonly optional: boolean; readonly gen: Gen }

const ABSENT = Symbol("absent")
const WRONG = Symbol("wrong")
const rootMutant: fc.Arbitrary<Mutant> = fc.constant({ value: WRONG, path: [] })

const codeUnit = fc.integer({ min: 0, max: 0xffff }).map((code) => String.fromCharCode(code))

export const trickyString: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: "binary" }),
  fc.string({ unit: codeUnit }),
  fc.constantFrom("", " ", " a ", "a b", "\u0000", "\u007f", "\ud800", "\udc00", "\"'\\", "(", ")", "//", "/*", "é", "😀", "\n\t"),
)

const identifier = fc.stringMatching(/^[A-Za-z_$][A-Za-z0-9_$]{0,5}$/)
const key = fc.oneof(identifier, trickyString, fc.constantFrom("__proto__", "null", "true", "NaN"))
const amount = fc.stringMatching(/^-?\d{1,4}(\.\d{1,3})?$/)
const currency = fc.stringMatching(/^[A-Z]{3}$/)

function leaf(type: Type<unknown>, value: fc.Arbitrary<unknown>, wrong: unknown): Gen {
  return { type, value, mutant: fc.constant({ value: wrong, path: [] }) }
}

const leaves: Gen[] = [
  leaf(number, fc.double(), "1"),
  leaf(string, trickyString, 1),
  leaf(boolean, fc.boolean(), 0),
  leaf(bigint, fc.bigInt(), 1),
  leaf(JSTN.schema(null), fc.constant(null), false),
  leaf(date, fc.date({ noInvalidDate: true }), "2026-01-01"),
  leaf(money, fc.tuple(amount, currency).map(([a, c]) => new Money(a, c)), "12.50 GBP"),
  leaf(note, trickyString.map((text) => new Note(text)), "text"),
]

function replaceAt(items: readonly unknown[], seed: number, mutant: Mutant): { items: unknown[]; path: Path } {
  const index = seed % items.length
  const copy = [...items]
  copy[index] = mutant.value
  return { items: copy, path: [index, ...mutant.path] }
}

function listMutant(items: fc.Arbitrary<unknown[]>, item: Gen): fc.Arbitrary<{ items: unknown[]; path: Path }> {
  return fc.tuple(items, item.mutant, fc.nat()).map(([values, mutant, seed]) => replaceAt(values, seed, mutant))
}

function arrayGen(item: Gen): Gen {
  return {
    type: array(item.type),
    value: fc.array(item.value, { maxLength: 4 }),
    mutant: listMutant(fc.array(item.value, { minLength: 1, maxLength: 4 }), item).map(({ items, path }) => ({ value: items, path })),
  }
}

function tupleGen(items: Gen[]): Gen {
  const values = () => fc.tuple(...items.map((item) => item.value))
  const mutant = fc.nat().chain((seed) => {
    const index = seed % items.length
    const target = items[index]!
    return fc.tuple(values(), target.mutant).map(([vals, m]): Mutant => ({ value: vals.with(index, m.value), path: [index, ...m.path] }))
  })
  return { type: tuple(...items.map((item) => item.type)), value: values(), mutant: items.length === 0 ? rootMutant : mutant }
}

function setGen(item: Gen): Gen {
  const items = (minLength: number) => fc.uniqueArray(item.value, { minLength, maxLength: 4, comparator: "SameValueZero" })
  return {
    type: set(item.type),
    value: items(0).map((values) => new Set(values)),
    mutant: listMutant(items(1), item).map(({ items, path }) => ({ value: new Set(items), path })),
  }
}

function mapGen(keyGen: Gen, valueGen: Gen): Gen {
  const entries = (minLength: number) =>
    fc.uniqueArray(fc.tuple(keyGen.value, valueGen.value), { minLength, maxLength: 4, selector: (entry) => entry[0], comparator: "SameValueZero" })
  const mutant = fc.tuple(entries(1), fc.nat(), fc.boolean(), keyGen.mutant, valueGen.mutant).map(([pairs, seed, onKey, km, vm]): Mutant => {
    const index = seed % pairs.length
    const [k, v] = pairs[index]!
    const copy = pairs.with(index, onKey ? [km.value, v] : [k, vm.value])
    return { value: new Map(copy), path: [index, onKey ? 0 : 1, ...(onKey ? km.path : vm.path)] }
  })
  return { type: map(keyGen.type, valueGen.type), value: entries(0).map((pairs) => new Map(pairs)), mutant }
}

function build(fields: readonly Field[], values: readonly unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  fields.forEach((field, i) => {
    const value = values[i]
    if (value !== ABSENT) Object.defineProperty(out, field.key, { value, enumerable: true, writable: true, configurable: true })
  })
  return out
}

function objectGen(fields: readonly Field[]): Gen {
  const shape: Record<string, Schema | Optional<unknown>> = Object.create(null)
  for (const field of fields) {
    const value = field.optional ? optional(field.gen.type) : field.gen.type
    Object.defineProperty(shape, field.key, { value, enumerable: true, writable: true, configurable: true })
  }
  const fieldValue = (field: Field) => (field.optional ? fc.option(field.gen.value, { nil: ABSENT }) : field.gen.value)
  const values = () => fc.tuple(...fields.map(fieldValue))
  const mutant = fc.nat().chain((seed) => {
    const index = seed % fields.length
    const target = fields[index]!
    return fc.tuple(values(), target.gen.mutant).map(([vals, m]): Mutant => ({
      value: build(fields, vals.with(index, m.value)),
      path: [target.key, ...m.path],
    }))
  })
  return {
    type: JSTN.schema(shape),
    value: values().map((vals) => build(fields, vals)),
    mutant: fields.length === 0 ? rootMutant : mutant,
  }
}

function unionGen(members: Gen[]): Gen {
  const [first, second, ...rest] = members as [Gen, Gen, ...Gen[]]
  return {
    type: union(first.type, second.type, ...rest.map((member) => member.type)),
    value: fc.oneof(...members.map((member) => member.value)),
    mutant: rootMutant,
  }
}

const sortedNumbers: Gen = {
  type: sortedSet(number),
  value: fc.array(fc.double(), { maxLength: 4 }).map((items) => new SortedSet(items)),
  mutant: fc.tuple(fc.array(fc.double(), { minLength: 1, maxLength: 4 }), fc.nat()).map(([items, seed]): Mutant => {
    const sorted = new SortedSet(items)
    const index = seed % sorted.items.length
    sorted.items[index] = "1" as unknown as number
    return { value: sorted, path: [index] }
  }),
}

export const typeAndValue: fc.Arbitrary<Gen> = fc.letrec<{ gen: Gen }>((tie) => {
  const gen = tie("gen")
  const field = fc.record({ key, optional: fc.boolean(), gen })
  return {
    gen: fc.oneof(
      { maxDepth: 4, depthIdentifier: "gen" },
      fc.constantFrom(...leaves),
      gen.map(arrayGen),
      fc.array(gen, { maxLength: 4 }).map(tupleGen),
      gen.map(setGen),
      fc.tuple(gen, gen).map(([k, v]) => mapGen(k, v)),
      fc.uniqueArray(field, { maxLength: 5, selector: (f) => f.key }).map(objectGen),
      fc.array(gen, { minLength: 2, maxLength: 3 }).map(unionGen),
      fc.constant(sortedNumbers),
    ),
  }
}).gen

export const typedValue: fc.Arbitrary<{ type: Type<unknown>; value: unknown }> = typeAndValue.chain((gen) =>
  gen.value.map((value) => ({ type: gen.type, value })),
)

export const typedMutant: fc.Arbitrary<{ type: Type<unknown>; mutant: Mutant }> = typeAndValue.chain((gen) =>
  gen.mutant.map((mutant) => ({ type: gen.type, mutant })),
)

export function mutateText(text: string): fc.Arbitrary<string> {
  return fc.tuple(fc.nat(), fc.boolean(), codeUnit).map(([seed, insert, char]) => {
    const at = seed % (text.length + 1)
    return insert ? text.slice(0, at) + char + text.slice(at) : text.slice(0, at) + text.slice(at + 1)
  })
}
