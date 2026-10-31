import { describeValue, JSTNError } from "./core/error.ts"
import { toType } from "./core/schema.ts"
import type { Infer, ReadonlyInput, Schema, Type } from "./core/type.ts"
import { readData } from "./syntax/read-data.ts"
import { readSchema, type ParseSchemaOptions } from "./syntax/read-schema.ts"
import { writeData } from "./syntax/write-data.ts"
import { register, unknown } from "./types/unknown.ts"

function parse<S extends Schema>(text: string, schema: S): Infer<S>
function parse(text: string, schema?: undefined): unknown
function parse(text: string, schema?: Schema): unknown {
  return toType(schema === undefined ? unknown : schema).decode(readData(text), [])
}

function stringify<S extends Schema>(value: NoInfer<Infer<S> | ReadonlyInput<Infer<S>>>, schema: S, space?: number | string): string
function stringify(value: unknown, schema?: undefined, space?: number | string): string
function stringify(value: unknown, schema?: Schema, space?: number | string): string {
  return writeData(toType(schema === undefined ? unknown : schema).encode(value, []), space)
}

export const JSTN = {
  parse,
  stringify,
  validate<S extends Schema>(value: unknown, schema: S): Infer<S> {
    toType(schema).encode(value, [])
    return value as Infer<S>
  },
  is<S extends Schema>(value: unknown, schema: S): value is Infer<S> {
    try {
      toType(schema).encode(value, [])
      return true
    } catch (error) {
      if (error instanceof JSTNError) return false
      throw error
    }
  },
  schema<S extends Schema>(schema: S): Type<Infer<S>> {
    return toType(schema)
  },
  parseSchema(text: string, options?: ParseSchemaOptions): Type<unknown> {
    return readSchema(text, options?.types ?? {})
  },
  register,
  transformer: {
    serialize(value: unknown): string | undefined {
      return value === undefined ? undefined : writeData(unknown.encode(value, []))
    },
    deserialize(data: unknown): unknown {
      if (data === undefined) return undefined
      if (typeof data !== "string") throw new JSTNError(`expected JSTN text, got ${describeValue(data)}`, [])
      return unknown.decode(readData(data), [])
    },
  },
}
