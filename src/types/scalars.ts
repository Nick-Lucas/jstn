import { describeNode, describeValue, mismatch } from "../core/error.ts"
import { defineType, type Node, type Type } from "../core/type.ts"

type ValueNode = Extract<Node, { value: unknown }>
type ValueOf<K extends ValueNode["kind"]> = Extract<ValueNode, { kind: K }>["value"]

function literalType<K extends ValueNode["kind"]>(kind: K): Type<ValueOf<K>> {
  return defineType<ValueOf<K>>(
    kind,
    (value, path) => {
      if (typeof value !== kind) throw mismatch(kind, describeValue(value), path)
      return { kind, value } as ValueNode
    },
    (node, path) => {
      if (node.kind !== kind) throw mismatch(kind, describeNode(node), path, node.pos)
      return (node as ValueNode).value as ValueOf<K>
    },
  )
}

export const number: Type<number> = literalType("number")
export const string: Type<string> = literalType("string")
export const boolean: Type<boolean> = literalType("boolean")
export const bigint: Type<bigint> = literalType("bigint")

export const nullType: Type<null> = defineType(
  "null",
  (value, path) => {
    if (value !== null) throw mismatch("null", describeValue(value), path)
    return { kind: "null" }
  },
  (node, path) => {
    if (node.kind !== "null") throw mismatch("null", describeNode(node), path, node.pos)
    return null
  },
)
