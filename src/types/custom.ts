import { assertTypeName, describeNode, describeValue, guard, JSTNError, mismatch } from "../core/error.ts"
import { identifierFor, quote } from "../core/strings.ts"
import { defineType, type Type } from "../core/type.ts"

export type Class<T> = abstract new (...args: any) => T
export type Match<T> = ((value: unknown) => value is T) | ((value: unknown) => boolean)
export type Named<T> =
  | { readonly name: string; match: Match<T> }
  | { readonly name: Class<T>; match?: Match<T> }

export type TypeSpec<T> = Named<T> & {
  parse(text: string): T
  stringify(value: NoInfer<T>): string
}

export type Tagged = { readonly tag: string; readonly match: (value: unknown) => boolean }

export const TAGGED = new WeakMap<Type<unknown>, Tagged>()

export function resolveNamed(spec: Named<unknown>): { readonly tag: string; readonly match: (value: unknown) => boolean } {
  const { name, match } = spec
  const tag = typeof name === "function" ? name.name : name
  assertTypeName(tag)
  if (match !== undefined) return { tag, match }
  if (typeof name !== "function") throw new JSTNError(`${quote(tag)} needs a match function`, [])
  return { tag, match: (value) => value instanceof name }
}

export function createType<T>(spec: TypeSpec<T>): Type<T> {
  const { tag, match } = resolveNamed(spec)
  const name = identifierFor(tag)
  const type = defineType(
    name,
    (value, path) => {
      if (!match(value)) throw mismatch(name, describeValue(value), path)
      const payload: unknown = guard(() => spec.stringify(value as T), `cannot stringify ${name}`, path)
      if (typeof payload !== "string") throw new JSTNError(`cannot stringify ${name}: stringify must return a string`, path)
      return { kind: "tagged", tag, payload }
    },
    (node, path) => {
      if (node.kind !== "tagged" || node.tag !== tag) throw mismatch(name, describeNode(node), path, node.pos)
      const label = `invalid ${name} ${quote(node.payload)}`
      const result = guard(() => spec.parse(node.payload), label, path, node.pos)
      if (!match(result)) throw new JSTNError(`${label}: parse result rejected by match`, path, node.pos)
      return result
    },
  )
  TAGGED.set(type, { tag, match })
  return type
}
