export const TYPE: unique symbol = Symbol("jstn.type")
export const OPTIONAL: unique symbol = Symbol("jstn.optional")

export type Pos = { readonly line: number; readonly column: number }
export type Path = readonly (string | number)[]

export type Node =
  | { readonly kind: "null"; readonly pos?: Pos }
  | { readonly kind: "boolean"; readonly value: boolean; readonly pos?: Pos }
  | { readonly kind: "number"; readonly value: number; readonly pos?: Pos }
  | { readonly kind: "bigint"; readonly value: bigint; readonly pos?: Pos }
  | { readonly kind: "string"; readonly value: string; readonly pos?: Pos }
  | { readonly kind: "tagged"; readonly tag: string; readonly payload: string; readonly pos?: Pos }
  | { readonly kind: "list"; readonly tag: string | null; readonly items: readonly Node[]; readonly pos?: Pos }
  | { readonly kind: "object"; readonly entries: readonly Entry[]; readonly pos?: Pos }

export type Entry = { readonly key: string; readonly value: Node; readonly keyPos?: Pos }

export interface Type<out T> {
  readonly [TYPE]: true
  readonly name: string
  encode(value: unknown, path: Path): Node
  decode(node: Node, path: Path): T
}

export interface Optional<out T> {
  readonly [OPTIONAL]: Type<T>
}

type Shorthand = NumberConstructor | StringConstructor | BooleanConstructor | BigIntConstructor | DateConstructor
export type Shape = { readonly [key: string]: Schema | Optional<unknown> }
export type Schema = Type<any> | Shorthand | null | Shape

export type Infer<S> =
  S extends Type<infer T> ? T :
  S extends NumberConstructor ? number :
  S extends StringConstructor ? string :
  S extends BooleanConstructor ? boolean :
  S extends BigIntConstructor ? bigint :
  S extends DateConstructor ? Date :
  S extends null ? null :
  S extends Shape ? InferShape<S> :
  never

type OptionalKeys<S> = { [K in keyof S]-?: S[K] extends Optional<unknown> ? K : never }[keyof S]
type Simplify<T> = { [K in keyof T]: T[K] } & {}
export type InferShape<S extends Shape> = Simplify<
  { -readonly [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } &
  { -readonly [K in OptionalKeys<S>]?: S[K] extends Optional<infer T> ? T : never }
>

export function defineType<T>(
  name: string,
  encode: (value: unknown, path: Path) => Node,
  decode: (node: Node, path: Path) => T,
): Type<T> {
  return Object.freeze({ [TYPE]: true as const, name, encode, decode })
}

export function isType(value: unknown): value is Type<unknown> {
  return typeof value === "object" && value !== null && TYPE in value && value[TYPE] === true
}

export function isOptional(value: unknown): value is Optional<unknown> {
  return typeof value === "object" && value !== null && OPTIONAL in value
}
