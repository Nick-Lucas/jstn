import { JSTNError } from "./core/error.ts"
import { toType } from "./core/schema.ts"
import type { Infer, Schema, Type } from "./core/type.ts"
import { readData } from "./syntax/read-data.ts"
import { readSchema, type ParseSchemaOptions } from "./syntax/read-schema.ts"
import { writeData } from "./syntax/write-data.ts"

export const JSTN = {
  parse<S extends Schema>(text: string, schema: S): Infer<S> {
    return toType(schema).decode(readData(text), [])
  },
  stringify<S extends Schema>(value: NoInfer<Infer<S>>, schema: S, space?: number | string): string {
    return writeData(toType(schema).encode(value, []), space)
  },
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
}
