import { assertTypeName, checkDepth, JSTNError } from "../core/error.ts"
import { isShorthand, optional, toType } from "../core/schema.ts"
import { quote } from "../core/strings.ts"
import type { Optional, Pos, Schema, Type } from "../core/type.ts"
import { array, collectionInfo, map, set } from "../types/collection.ts"
import { date } from "../types/date.ts"
import { bigint, boolean, nullType, number, string } from "../types/scalars.ts"
import { tuple } from "../types/tuple.ts"
import { union } from "../types/union.ts"
import { Lexer, type Token } from "./lexer.ts"

export type Registry = Readonly<Record<string, Schema | ((...args: any[]) => Type<any>)>>

export interface ParseSchemaOptions {
  readonly types?: Registry
}

type Named =
  | { readonly kind: "type"; readonly type: Type<unknown> }
  | { readonly kind: "generic"; readonly arity: number; readonly build: (args: Type<unknown>[]) => Type<unknown> }

const BUILTINS: Registry = { number, string, boolean, bigint, null: nullType, Date: date, Set: set, Map: map }

function resolve(name: string, value: Registry[string]): Named {
  if (typeof value !== "function" || isShorthand(value)) return { kind: "type", type: toType(value) }
  const info = collectionInfo(value)
  if (info === undefined) throw new JSTNError(`${quote(name)} is not a schema or collection`, [])
  return { kind: "generic", arity: info.arity, build: (args) => value(...args) }
}

function resolveNames(registry: Registry): Map<string, Named> {
  const names = new Map<string, Named>()
  for (const [name, value] of Object.entries(BUILTINS)) names.set(name, resolve(name, value))
  for (const [name, value] of Object.entries(registry)) {
    if (Object.hasOwn(BUILTINS, name)) throw new JSTNError(`cannot redefine built-in type ${quote(name)}`, [])
    assertTypeName(name)
    names.set(name, resolve(name, value))
  }
  return names
}

function typeArguments(count: number): string {
  return `${count} type argument${count === 1 ? "" : "s"}`
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
    lexer.eat("|")
    const first = readPostfix(depth)
    const rest: Type<unknown>[] = []
    while (lexer.eat("|")) rest.push(readPostfix(depth))
    const [second, ...others] = rest
    return second === undefined ? first : union(first, second, ...others)
  }

  function readPostfix(depth: number): Type<unknown> {
    let type = readPrimary(depth)
    for (let level = depth, open = lexer.peek(); lexer.eat("["); open = lexer.peek()) {
      level = enter(open, level)
      lexer.expect("]")
      type = array(type)
    }
    return type
  }

  function readPrimary(depth: number): Type<unknown> {
    const token = lexer.next()
    if (token.kind === "ident") return readNamed(token, depth)
    if (token.kind === "punct" && token.value === "{") return readObject(enter(token, depth))
    if (token.kind === "punct" && token.value === "[") {
      const inner = enter(token, depth)
      return tuple(...readItems("]", () => readType(inner)))
    }
    if (token.kind === "punct" && token.value === "(") {
      const type = readType(enter(token, depth))
      lexer.expect(")")
      return type
    }
    return lexer.unexpected(token, "type")
  }

  function readNamed(token: Extract<Token, { kind: "ident" }>, depth: number): Type<unknown> {
    const name = quote(token.value)
    const named = names.get(token.value)
    if (named === undefined) return fail(`unknown type ${name}`, token.pos)
    const open = lexer.peek()
    const hasArguments = open.kind === "punct" && open.value === "<"
    if (named.kind === "type") {
      if (hasArguments) fail(`${name} does not take type arguments`, token.pos)
      return named.type
    }
    if (!hasArguments) fail(`${name} requires ${typeArguments(named.arity)}`, token.pos)
    lexer.next()
    const inner = enter(open, depth)
    const args = readItems(">", () => readType(inner))
    if (args.length !== named.arity) {
      fail(`${name} expects ${typeArguments(named.arity)}, got ${args.length}`, token.pos)
    }
    return named.build(args)
  }

  function readObject(depth: number): Type<unknown> {
    const shape: Record<string, Schema | Optional<unknown>> = Object.create(null)
    readItems("}", () => {
      const key = lexer.readKey()
      if (Object.hasOwn(shape, key.value)) fail(`duplicate key ${quote(key.value)}`, key.pos)
      const isOptional = lexer.eat("?")
      lexer.expect(":")
      const type = readType(depth)
      const value = isOptional ? optional(type) : type
      Object.defineProperty(shape, key.value, { value, enumerable: true, writable: true, configurable: true })
    })
    return toType(shape)
  }

  const type = readType(0)
  lexer.expectEnd()
  return type
}
