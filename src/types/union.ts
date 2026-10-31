import { describeNode, describeValue, formatPath, JSTNError, mismatch } from "../core/error.ts"
import { toType } from "../core/schema.ts"
import { defineType, type Infer, type Path, type Schema, type Type } from "../core/type.ts"

const UNIONS = new WeakMap<Type<unknown>, readonly Type<unknown>[]>()

function deepest(errors: readonly JSTNError[], path: Path): JSTNError | undefined {
  const root = formatPath(path)
  let best: JSTNError | undefined
  for (const error of errors) {
    if (error.path.length > root.length && error.path.startsWith(root) && (best === undefined || error.path.length > best.path.length)) best = error
  }
  return best
}

function firstSuccess<R>(members: readonly Type<unknown>[], path: Path, attempt: (member: Type<unknown>) => R, fallback: () => JSTNError): R {
  const errors: JSTNError[] = []
  for (const member of members) {
    try {
      return attempt(member)
    } catch (error) {
      if (!(error instanceof JSTNError)) throw error
      errors.push(error)
    }
  }
  throw deepest(errors, path) ?? fallback()
}

export function union<const T extends readonly [Schema, Schema, ...Schema[]]>(...members: T): Type<Infer<T[number]>> {
  const types = members.flatMap((member) => {
    const type = toType(member)
    return UNIONS.get(type) ?? [type]
  })
  if (types.length < 2) throw new JSTNError("union() needs at least 2 members", [])
  const name = `union(${types.map((t) => t.name).join(", ")})`
  const type = defineType(
    name,
    (value, path) => firstSuccess(types, path, (t) => t.encode(value, path), () => mismatch(name, describeValue(value), path)),
    (node, path) => firstSuccess(types, path, (t) => t.decode(node, path), () => mismatch(name, describeNode(node), path, node.pos)) as Infer<T[number]>,
  )
  UNIONS.set(type, types)
  return type
}
