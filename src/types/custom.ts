import { assertTypeName, describeNode, describeValue, guard, JSTNError, mismatch } from "../core/error.ts"
import { quote } from "../core/strings.ts"
import { defineType, type Type } from "../core/type.ts"

export interface TypeSpec<T> {
  readonly name: string
  match(value: unknown): boolean
  parse(text: string): T
  stringify(value: NoInfer<T>): string
}

export function createType<T>(spec: TypeSpec<T>): Type<T> {
  const name = spec.name
  assertTypeName(name)
  return defineType(
    name,
    (value, path) => {
      if (!spec.match(value)) throw mismatch(name, describeValue(value), path)
      const payload: unknown = guard(() => spec.stringify(value as T), `cannot stringify ${name}`, path)
      if (typeof payload !== "string") throw new JSTNError(`cannot stringify ${name}: stringify must return a string`, path)
      return { kind: "tagged", tag: name, payload }
    },
    (node, path) => {
      if (node.kind !== "tagged" || node.tag !== name) throw mismatch(name, describeNode(node), path, node.pos)
      const label = `invalid ${name} ${quote(node.payload)}`
      const result = guard(() => spec.parse(node.payload), label, path, node.pos)
      if (!spec.match(result)) throw new JSTNError(`${label}: parse result rejected by match`, path, node.pos)
      return result
    },
  )
}
