import { JSTNError } from "./error.ts"
import type { Path } from "./type.ts"

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1Props<Input, Output>
}

export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
  readonly version: 1
  readonly vendor: string
  readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>
  readonly types?: { readonly input: Input; readonly output: Output } | undefined
}

export type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaV1Issue[] }

export interface StandardSchemaV1Issue {
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined
}

export function standardProps<T>(check: (value: unknown, path: Path) => unknown): StandardSchemaV1Props<T> {
  return Object.freeze({
    version: 1,
    vendor: "jstn",
    validate(value: unknown): StandardSchemaV1Result<T> {
      try {
        check(value, [])
        return { value: value as T }
      } catch (error) {
        if (error instanceof JSTNError) return { issues: [{ message: error.reason, path: error.segments }] }
        throw error
      }
    },
  })
}
