import { date } from "../types/date.ts"
import { objectType, isPlainObject, type Field } from "../types/object.ts"
import { bigint, boolean, nullType, number, string } from "../types/scalars.ts"
import { describeValue, JSTNError } from "./error.ts"
import { isOptional, isType, OPTIONAL, type Infer, type Optional, type Path, type Schema, type Type } from "./type.ts"

const SHORTHANDS = new Map<unknown, Type<unknown>>([
  [Number, number],
  [String, string],
  [Boolean, boolean],
  [BigInt, bigint],
  [Date, date],
])

const HINTS = new Map<unknown, string>([
  [Array, "Array (use array(...))"],
  [Set, "Set (use set(...))"],
  [Map, "Map (use map(...))"],
  [Object, "Object (use a plain object literal)"],
])

function toField(key: string, value: unknown, path: Path): Field {
  if (isOptional(value)) return { key, type: value[OPTIONAL], optional: true }
  return { key, type: normalise(value, path), optional: false }
}

function normalise(schema: unknown, path: Path): Type<unknown> {
  if (schema === null) return nullType
  if (isType(schema)) return schema
  const shorthand = SHORTHANDS.get(schema)
  if (shorthand !== undefined) return shorthand
  if (isOptional(schema)) throw new JSTNError("optional() is only valid as an object field", path)
  if (isPlainObject(schema)) return objectType(Object.keys(schema).map((key) => toField(key, schema[key], [...path, key])))
  throw new JSTNError(`not a schema: ${HINTS.get(schema) ?? describeValue(schema)}`, path)
}

export function isShorthand(value: unknown): value is Schema {
  return SHORTHANDS.has(value)
}

export function toType<S extends Schema>(schema: S, path: Path = []): Type<Infer<S>> {
  return normalise(schema, path) as Type<Infer<S>>
}

export function optional<S extends Schema>(schema: S): Optional<Infer<S>> {
  return Object.freeze({ [OPTIONAL]: toType(schema) })
}
