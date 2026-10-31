import { checkDepth, JSTNError } from "../core/error.ts"
import { isShorthand, optional, toType } from "../core/schema.ts"
import { isIdent, quote, RESERVED } from "../core/strings.ts"
import { isOptional, isType, type Optional, type Pos, type Schema, type Type } from "../core/type.ts"
import { array, map, set } from "../types/collection.ts"
import { date } from "../types/date.ts"
import { bigint, boolean, nullType, number, string } from "../types/scalars.ts"
import { tuple } from "../types/tuple.ts"
import { union } from "../types/union.ts"
import { registeredNames, unknown } from "../types/unknown.ts"
import { Lexer, type Token } from "./lexer.ts"

export type Registry = Readonly<Record<string, Schema | ((...args: any[]) => Type<any>)>>

export interface ParseSchemaOptions {
  readonly types?: Registry
}

type Value = Type<unknown> | Optional<unknown>

type Named =
  | { readonly kind: "type"; readonly type: Type<unknown> }
  | { readonly kind: "builder"; readonly min: number; readonly max: number; readonly build: (args: Value[]) => unknown }

const BUILTIN_TYPES: Registry = { number, string, boolean, bigint, unknown, null: nullType, date, Number, String, Boolean, BigInt, Date }

const BUILTIN_BUILDERS: ReadonlyMap<string, Named> = new Map<string, Named>([
  ["array", { kind: "builder", min: 1, max: 1, build: ([item]) => array(item as Type<unknown>) }],
  ["set", { kind: "builder", min: 1, max: 1, build: ([item]) => set(item as Type<unknown>) }],
  ["map", { kind: "builder", min: 2, max: 2, build: ([key, value]) => map(key as Type<unknown>, value as Type<unknown>) }],
  ["tuple", { kind: "builder", min: 0, max: Infinity, build: (items) => tuple(...(items as Type<unknown>[])) }],
  ["union", { kind: "builder", min: 2, max: Infinity, build: (members) => union(...(members as [Type<unknown>, Type<unknown>])) }],
  ["optional", { kind: "builder", min: 1, max: 1, build: ([inner]) => optional(inner as Type<unknown>) }],
])

function resolve(name: string, value: Registry[string]): Named {
  if (typeof value !== "function" || isShorthand(value)) return { kind: "type", type: toType(value) }
  if (value.length === 0) throw new JSTNError(`${quote(name)} is not a schema or collection`, [])
  return { kind: "builder", min: value.length, max: value.length, build: (args) => value(...args) }
}

function resolveNames(registry: Registry): Map<string, Named> {
  const names = new Map<string, Named>(BUILTIN_BUILDERS)
  for (const [name, value] of Object.entries(BUILTIN_TYPES)) names.set(name, resolve(name, value))
  const builtins = new Set(names.keys())
  const registered = registeredNames()
  for (const [name, value] of registered) if (!builtins.has(name)) names.set(name, resolve(name, value))
  for (const [name, value] of Object.entries(registry)) {
    if (builtins.has(name)) throw new JSTNError(`cannot redefine built-in type ${quote(name)}`, [])
    if (registered.has(name) && registered.get(name) !== value) throw new JSTNError(`cannot redefine registered type ${quote(name)}`, [])
    if (!isIdent(name) || RESERVED.includes(name)) throw new JSTNError(`invalid type name ${quote(name)}`, [])
    names.set(name, resolve(name, value))
  }
  return names
}

function argumentCount(named: Extract<Named, { kind: "builder" }>): string {
  const count = named.min === named.max ? `${named.min}` : named.max === Infinity ? `at least ${named.min}` : `${named.min} to ${named.max}`
  return `${count} argument${named.min === 1 && named.max === 1 ? "" : "s"}`
}

function fail(reason: string, pos: Pos): never {
  throw new JSTNError(reason, [], pos)
}

function enter(open: Token, depth: number): number {
  checkDepth(depth, [], open.pos)
  return depth + 1
}

export function readSchema(text: string, registry: Registry): Type<unknown> {
  const names = resolveNames(registry)
  const lexer = new Lexer(text, fail)

  function readItems<R>(close: string, readItem: () => R): R[] {
    const items: R[] = []
    while (!lexer.eat(close)) {
      items.push(readItem())
      if (!lexer.more(close)) break
    }
    return items
  }

  function readType(depth: number): Type<unknown> {
    const start = lexer.peek()
    const value = readValue(depth)
    if (isOptional(value)) fail("optional() is only valid as an object field", start.pos)
    return value
  }

  function readValue(depth: number): Value {
    const token = lexer.next()
    if (token.kind === "ident") return readNamed(token, depth)
    if (token.kind === "punct" && token.value === "{") return readObject(enter(token, depth))
    return lexer.unexpected(token, "schema")
  }

  function readNamed(token: Extract<Token, { kind: "ident" }>, depth: number): Value {
    const name = quote(token.value)
    const named = names.get(token.value)
    if (named === undefined) return fail(`unknown type ${name}`, token.pos)
    const open = lexer.peek()
    const isCall = open.kind === "punct" && open.value === "("
    if (named.kind === "type") {
      if (isCall) fail(`${name} is not a function`, token.pos)
      return named.type
    }
    if (!isCall) return fail(`${name} must be called`, token.pos)
    lexer.next()
    const inner = enter(open, depth)
    const args = readItems(")", () => readType(inner))
    if (args.length < named.min || args.length > named.max) {
      fail(`${name} expects ${argumentCount(named)}, got ${args.length}`, token.pos)
    }
    const value = named.build(args)
    if (!isType(value) && !isOptional(value)) return fail(`${name} did not return a type`, token.pos)
    return value
  }

  function readObject(depth: number): Type<unknown> {
    const shape: Record<string, Schema | Optional<unknown>> = Object.create(null)
    readItems("}", () => {
      const key = lexer.readKey()
      if (Object.hasOwn(shape, key.value)) fail(`duplicate key ${quote(key.value)}`, key.pos)
      lexer.expect(":")
      const value = readValue(depth)
      Object.defineProperty(shape, key.value, { value, enumerable: true, writable: true, configurable: true })
    })
    return toType(shape)
  }

  const type = readType(0)
  lexer.expectEnd()
  return type
}
