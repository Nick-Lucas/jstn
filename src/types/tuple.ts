import { checkDepth, describeNode, describeValue, mismatch } from "../core/error.ts"
import { toType } from "../core/schema.ts"
import { defineType, type Infer, type Schema, type Type } from "../core/type.ts"

export function tuple<const T extends readonly Schema[]>(...items: T): Type<{ -readonly [K in keyof T]: Infer<T[K]> }> {
  const types = items.map((item, i) => toType(item, [i]))
  const name = `tuple(${types.map((t) => t.name).join(", ")})`
  const count = `${types.length} items`
  return defineType(
    name,
    (value, path) => {
      checkDepth(path.length, path)
      if (!Array.isArray(value)) throw mismatch(name, describeValue(value), path)
      if (value.length !== types.length) throw mismatch(count, String(value.length), path)
      return { kind: "list", tag: null, items: types.map((t, i) => t.encode(value[i], [...path, i])) }
    },
    (node, path) => {
      if (node.kind !== "list" || node.tag !== null) throw mismatch(name, describeNode(node), path, node.pos)
      if (node.items.length !== types.length) throw mismatch(count, String(node.items.length), path, node.pos)
      return types.map((t, i) => t.decode(node.items[i]!, [...path, i])) as { -readonly [K in keyof T]: Infer<T[K]> }
    },
  )
}
