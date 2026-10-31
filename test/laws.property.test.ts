import fc from "fast-check"
import { expect, it } from "vitest"
import { formatPath } from "../src/core/error.ts"
import { JSTN, JSTNError } from "../src/index.ts"
import type { Type } from "../src/index.ts"
import { mutateText, typeAndValue, typedMutant, typedValue } from "./support/arbitraries.ts"
import { registry } from "./support/fixtures.ts"

const numRuns = 300
const space = fc.constantFrom(undefined, 2, "\t")

function returnsOrThrowsJSTNError(run: () => unknown): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(JSTNError)
  }
}

function stringifies(value: unknown, type: Type<unknown>): boolean {
  try {
    JSTN.stringify(value, type)
    return true
  } catch (error) {
    if (error instanceof JSTNError) return false
    throw error
  }
}

it("round-trips every generated value through text", () => {
  fc.assert(
    fc.property(typedValue, space, ({ type, value }, indent) => {
      expect(JSTN.parse(JSTN.stringify(value, type, indent), type)).toStrictEqual(value)
    }),
    { numRuns },
  )
})

it("writes canonical output that is stable under a second round trip", () => {
  fc.assert(
    fc.property(typedValue, ({ type, value }) => {
      const text = JSTN.stringify(value, type)
      expect(JSTN.stringify(JSTN.parse(text, type), type)).toBe(text)
    }),
    { numRuns },
  )
})

it("reads every type name back to the same name", () => {
  fc.assert(
    fc.property(typeAndValue, ({ type }) => {
      expect(JSTN.parseSchema(type.name, { types: registry }).name).toBe(type.name)
    }),
    { numRuns },
  )
})

it("returns or throws JSTNError for arbitrary text", () => {
  fc.assert(
    fc.property(typeAndValue, fc.string(), ({ type }, text) => {
      returnsOrThrowsJSTNError(() => JSTN.parse(text, type))
    }),
    { numRuns },
  )
})

it("returns or throws JSTNError for mutated canonical output", () => {
  const mutated = typedValue.chain(({ type, value }) => mutateText(JSTN.stringify(value, type, 2)).map((text) => ({ type, text })))
  fc.assert(
    fc.property(mutated, ({ type, text }) => {
      returnsOrThrowsJSTNError(() => JSTN.parse(text, type))
    }),
    { numRuns },
  )
})

it("agrees between is and stringify for any schema", () => {
  fc.assert(
    fc.property(typedValue, typeAndValue, ({ value }, other) => {
      expect(JSTN.is(value, other.type)).toBe(stringifies(value, other.type))
    }),
    { numRuns },
  )
})

it("accepts every parsed value with is", () => {
  fc.assert(
    fc.property(typedValue, space, ({ type, value }, indent) => {
      expect(JSTN.is(JSTN.parse(JSTN.stringify(value, type, indent), type), type)).toBe(true)
    }),
    { numRuns },
  )
})

it("validates generated values and returns the same reference", () => {
  fc.assert(
    fc.property(typedValue, ({ type, value }) => {
      expect(JSTN.validate(value, type)).toBe(value)
    }),
    { numRuns },
  )
})

it("rejects a value with one leaf of the wrong kind at that leaf's path", () => {
  fc.assert(
    fc.property(typedMutant, ({ type, mutant }) => {
      let thrown: unknown
      try {
        JSTN.validate(mutant.value, type)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(JSTNError)
      expect((thrown as JSTNError).path).toBe(formatPath(mutant.path))
    }),
    { numRuns },
  )
})
