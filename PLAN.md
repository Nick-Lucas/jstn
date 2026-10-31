# JSTN (JavaScript Type Notation): design and implementation plan

This document is the single source of truth for implementing JSTN. Where a detail is not specified here, choose the simplest behaviour that is consistent with this document, then add it to the README.

Base proposal: **simplicity** (one `Type` interface with `encode` and `decode`, a schema-free `Node` tree between text and values, every `Type.name` valid jstn-schema text).
Grafted from **types**: the `out T` brand, `createCollection(spec)` returning a `Type`, with generic collections written as plain generic wrapper functions, `NoInfer` on `stringify`, `createType` and `createCollection`, type tests without `@ts-expect-error`, folder layout by concern, `JSTN.is`.
Grafted from **format**: a typed `Node` union, the shared lexer with `readPayload`, the precise lexical grammar, the `${path}: ${reason} (line L, column C)` message format, syntax errors that carry paths, the inline scalar list printing rule, rejection of duplicates, and the nesting depth limit.

---

## 1. Goals and non-goals

### Goals

1. **Part 1, Schemas.** Structure-only validators that are type-safe at runtime and at build time. There are two ways to write them: the TypeScript builder API (`JSTN.schema({...})`) and the jstn-schema text language (`JSTN.parseSchema(text)`). Both produce the same `Type` objects.
2. **Part 2, Serialisation.** A data format that looks like JavaScript literals. `JSTN.parse(text, schema)` and `JSTN.stringify(value, schema, space?)` both validate against the schema.
3. An API that a `JSON.*` user already knows, with the schema in place of JSON's second argument.
4. Extensibility through `createType` (tagged scalars) and `createCollection` (tagged containers). Built-ins use the same machinery where it fits: `date` uses `createType`, and `set` and `map` use `createCollection`.
5. A small codebase that is easy to read. Every file has one job and stays under 300 lines. There are zero runtime dependencies.
6. Comprehensive tests: example tests per module, an exact-message error catalogue, fast-check properties and type-level tests.

### Non-goals (v1)

- Recursive schemas (`lazy`). This is the first planned extension.
- Literal and enum types (`"a" | "b"`), refinements (`min`, `max`, `finite`), and passthrough of unknown keys.
- Schema-less parsing (`JSTN.parse(text)` without a schema).
- Static types for text schemas. `parseSchema` returns `Type<unknown>`.
- Hex, octal and binary number literals, numeric separators, and Unicode identifiers as bare keys.
- Newline-separated object entries. Commas are required, and the missing commas in the request's samples are treated as typos.
- Class instances as object schemas. Use `createType` or `createCollection` for classes.
- Cross-realm `instanceof`. A `Date` from another realm is rejected.

---

## 2. Public API

### 2.1 Every export of `src/index.ts`

```ts
export { JSTN } from "./jstn.ts"
export { JSTNError } from "./core/error.ts"
export { optional } from "./core/schema.ts"
export { number, string, boolean, bigint } from "./types/scalars.ts"
export { date } from "./types/date.ts"
export { createType } from "./types/custom.ts"
export { tuple } from "./types/tuple.ts"
export { union } from "./types/union.ts"
export { array, set, map, createCollection } from "./types/collection.ts"
export type { Type, Schema, Shape, Optional, Infer, InferShape, Node, Entry, Pos, Path } from "./core/type.ts"
export type { Class, Match, Named, TypeSpec } from "./types/custom.ts"
export type { StandardSchemaV1, StandardSchemaV1Props, StandardSchemaV1Result, StandardSchemaV1Issue } from "./core/standard.ts"
export type { CollectionSpec } from "./types/collection.ts"
export type { Registry, ParseSchemaOptions } from "./syntax/read-schema.ts"
```

The internal symbols `TYPE`, `OPTIONAL`, `defineType`, `standardProps`, `toType`, `objectType`, `resolveNamed`, `listType`, and everything under `syntax/`, are **not** exported from the package. The `exports` map in `package.json` has only `"."`, so deep imports are impossible.

### 2.2 Exact signatures

```ts
export const JSTN: {
  parse<S extends Schema>(text: string, schema: S): Infer<S>
  stringify<S extends Schema>(value: NoInfer<Infer<S> | ReadonlyInput<Infer<S>>>, schema: S, space?: number | string): string
  validate<S extends Schema>(value: unknown, schema: S): Infer<S>
  is<S extends Schema>(value: unknown, schema: S): value is Infer<S>
  schema<S extends Schema>(schema: S): Type<Infer<S>>
  parseSchema(text: string, options?: ParseSchemaOptions): Type<unknown>
}

export const number: Type<number>
export const string: Type<string>
export const boolean: Type<boolean>
export const bigint: Type<bigint>
export const date: Type<Date>

export function array<S extends Schema>(item: S): Type<Infer<S>[]>
export function tuple<const T extends readonly Schema[]>(...items: T): Type<{ -readonly [K in keyof T]: Infer<T[K]> }>
export function union<const T extends readonly [Schema, Schema, ...Schema[]]>(...members: T): Type<Infer<T[number]>>
export function set<S extends Schema>(item: S): Type<Set<Infer<S>>>
export function map<K extends Schema, V extends Schema>(key: K, value: V): Type<Map<Infer<K>, Infer<V>>>
export function optional<S extends Schema>(schema: S): Optional<Infer<S>>

export function createType<T>(spec: TypeSpec<T>): Type<T>
type InferAll<A extends readonly Schema[]> = { -readonly [K in keyof A]: Infer<A[K]> }
export function createCollection<const A extends readonly [Schema, ...Schema[]], C>(spec: CollectionSpec<A, InferAll<A>, C>): Type<C>
export function createCollection<S extends Schema, C>(spec: CollectionSpec<S, Infer<S>, C>): Type<C>

export class JSTNError extends Error {
  readonly name: "JSTNError"
  readonly reason: string
  readonly path: string
  readonly segments: Path
  readonly line: number | undefined
  readonly column: number | undefined
  constructor(reason: string, path: Path, pos?: Pos, options?: ErrorOptions)
}

export type Registry = Readonly<Record<string, Schema | ((...args: any[]) => Type<any>)>>
export interface ParseSchemaOptions { readonly types?: Registry }
```

The API beyond the fixed list consists of `JSTN.validate` and `JSTN.is`. Both are justified by Part 1 ("Schemas ... validators"), because a schema must be usable without serialising. Each is one line on top of `encode`:

- `validate` throws a `JSTNError` that carries the path, or returns the value typed as `Infer<S>`.
- `is` returns `true` exactly when `validate` would not throw. It narrows the value's type.

**`space`** behaves exactly like the third argument of `JSON.stringify`:

- A number is floored and clamped to the range 0 to 10. It gives that many spaces, and a result below 1 means compact output.
- A string uses its first 10 characters. The empty string means compact output.
- Any other value, including `undefined`, means compact output.

**Shorthands.** Wherever a `Schema` is expected, these inputs are accepted:

| Input | Resolves to |
|---|---|
| a `Type` | itself |
| `Number`, `String`, `Boolean`, `BigInt`, `Date` | `number`, `string`, `boolean`, `bigint`, `date` |
| `null` | the internal null type (there is no export; `null` is its only builder spelling) |
| a plain object (prototype is `Object.prototype` or `null`) | an object type. Values are `Schema` or `optional(...)` |

`Array`, `Set`, `Map`, `Object` and `Symbol` are compile errors, because they are not in `Schema`. At runtime they throw with a hint, for example `$: not a schema: Array (use array(...))`.

### 2.3 Usage, matching the request

```ts
import { JSTN, number, string, bigint, array, tuple, union, set, map, optional, createType, createCollection } from "jstn"
import type { Infer, Schema } from "jstn"

class Money {
  amount: string
  currency: string
  constructor(amount: string, currency: string) { this.amount = amount; this.currency = currency }
}

const money = createType({
  name: Money,
  parse: (text) => {
    const m = /^(-?\d+(?:\.\d+)?) ([A-Z]{3})$/.exec(text)
    if (!m) throw new Error("expected \"<amount> <CCY>\"")
    return new Money(m[1]!, m[2]!)
  },
  stringify: (m) => `${m.amount} ${m.currency}`,
})

class SortedSet<T> {
  items: T[]
  constructor(items: Iterable<T>) { this.items = [...items].sort() }
}

const sortedSet = <S extends Schema>(item: S) => createCollection({
  name: SortedSet,
  items: item,
  fromItems: (items) => new SortedSet(items),
  toItems: (v) => v.items,
})

const someSchema = JSTN.schema({ inner: Boolean })

const S = JSTN.schema({
  someNum: number,
  someStr: string,
  someDate: Date,
  someObj: someSchema,
  someArr: array(Number),
  someTuple: tuple(Number, String),
  someUnion: union(Number, String),
  customVal: money,
  big: bigint,
  tags: set(String),
  lookup: map(String, { a: number }),
  scores: sortedSet(Number),
  nothing: null,
  "key with space": optional(string),
})

type T = Infer<typeof S>

const text = JSTN.stringify(value, S, 2)
const back = JSTN.parse(text, S)
JSTN.stringify(value, S)
JSTN.validate(unknownInput, S)
if (JSTN.is(unknownInput, S)) unknownInput.someNum

const S2 = JSTN.parseSchema(schemaText, { types: { Money: money, SortedSet: sortedSet } })
```

The output of `JSTN.stringify(value, S, 2)`:

```jstn
{
  someNum: 1,
  someStr: "value",
  someDate: Date(2026-01-01T14:00:00Z),
  someObj: {
    inner: true,
  },
  someArr: [1, 2, 3],
  someTuple: [1, "value"],
  someUnion: 3,
  customVal: Money(12.50 GBP),
  big: 123n,
  tags: Set["a", "b"],
  lookup: Map[
    [
      "x",
      {
        a: 1,
      },
    ],
  ],
  scores: SortedSet[1, 2, 3],
  nothing: null,
  "key with space": "here",
}
```

The Map entry `["x", { a: 1 }]` is a list that contains an object, so by the §4.4 rule it is not all-scalar and breaks one item per line. A map whose values are scalars stays compact per entry: `Map[\n    ["a", 1],\n    ["b", 2],\n  ]`. The golden tests in `write-data.test.ts` pin both forms.

The equivalent text schema:

```jstn-schema
{
  someNum: number,
  someStr: string,
  someDate: Date,
  someObj: { inner: boolean },
  someArr: number[],
  someTuple: [number, string],
  someUnion: number | string,
  customVal: Money,
  big: bigint,
  tags: Set<string>,
  lookup: Map<string, { a: number }>,
  scores: SortedSet<number>,
  nothing: null,
  "key with space"?: string,
}
```

---

## 3. Core types (`src/core/type.ts`)

```ts
import { standardProps, type StandardSchemaV1Props } from "./standard.ts"

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
  readonly "~standard": StandardSchemaV1Props<T>
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
export type InferShape<S extends Shape> = [keyof S] extends [never] ? Record<string, never> : Simplify<
  { -readonly [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } &
  { -readonly [K in OptionalKeys<S>]?: (S[K] extends Optional<infer T> ? T : never) | undefined }
>

export type ReadonlyInput<T> =
  T extends readonly unknown[] ? { readonly [K in keyof T]: ReadonlyInput<T[K]> } :
  T extends Function ? T :
  T extends object ? keyof T extends string ? { readonly [K in keyof T]: ReadonlyInput<T[K]> } : T :
  T

export function defineType<T>(
  name: string,
  encode: (value: unknown, path: Path) => Node,
  decode: (node: Node, path: Path) => T,
): Type<T>

export function isType(value: unknown): value is Type<unknown>
export function isOptional(value: unknown): value is Optional<unknown>
```

Rules:

- **`defineType` is the only way to build a `Type`.** Every built-in, `createType`, `createCollection`, `tuple`, `union` and object types call it. It returns a frozen `{ [TYPE]: true, name, encode, decode, "~standard": standardProps(encode) }`, so every `Type` is a Standard Schema (see below).
- **`T` appears only in output positions:** the return type of `decode` and the result types of `"~standard"`. That makes `Type` covariant (enforced by `out`), so `Type<number>` is assignable to `Type<number | string>`.
- **`Optional` is not a `Schema`.** This makes `array(optional(number))` a compile error.
- **The `Infer` order matters.** `Type` is checked first. Object literal types match `Shape` through implicit index signatures. Interfaces and constructors do not match `Shape`.
- **Optional keys infer as `k?: T | undefined`.** `encode` omits an optional field whose value is `undefined`, so the type must admit it. Otherwise, under `exactOptionalPropertyTypes`, `JSTN.is` and `JSTN.validate` would narrow `{ k: undefined }` to a type that rules `undefined` out. `parse` still never produces `undefined`.
- **The empty shape infers `Record<string, never>`.** `{}` alone would mean any non-nullish value, while the runtime accepts only a plain object with no keys.
- **`stringify` also accepts readonly input.** `ReadonlyInput<T>` makes arrays and tuples readonly at every depth, through arrays, tuples and objects whose keys are all strings. Objects with symbol keys, such as `Date`, `Set` and `Map`, and functions are left alone, so their names survive in error messages. The parameter is `Infer<S> | ReadonlyInput<Infer<S>>`, so a generic wrapper can still pass a value typed `Infer<S>`. `parse`, `validate` and `is` keep the mutable `Infer<S>`.
- **`JSTN.is` narrows the `false` branch too.** TypeScript has no one-sided type predicate. The runtime check is stricter than the static type: an invalid `Date`, an object with an extra key, or a class instance checked against a shape fails `is` while still having the static type. The README warns not to rely on the `false` branch. A brand on the predicate type would fix the `false` branch, but it would leak into every narrowed type.

The following claims were verified on TypeScript 7.0.2 with `strict` and `exactOptionalPropertyTypes`:

- The full example in §2.3 infers exactly.
- `sortedSet(Number)` is `Type<SortedSet<number>>`, and `map(String, BigInt)` is `Type<Map<string, bigint>>`.
- `JSTN.stringify({ a: "x" }, { a: Number })` is a compile error, and so is `JSTN.stringify("x", {})`.
- `union` with one member is a compile error.
- `JSTN.is` narrows.
- `createType` infers `T` from three sources: the class given as `name`, a `match` that is a type guard, and `parse`. `stringify` takes `NoInfer<T>`, so it never contributes. A simple check such as `(v) => v instanceof Money` or `(v) => typeof v === "number"` is inferred as a type guard. A compound check such as `(v) => typeof v === "number" && v > 0` is a plain boolean predicate, so it adds nothing. `{ name: "Num", match: (v) => typeof v === "number", parse: Number, stringify: String }` gives `Type<number>`, and `{ name: Point, parse: () => new Point(), stringify: (p) => String(p.x) }` gives `Type<Point>`. With a type-guard `match`, writing `stringify` before `parse` still gives `Type<Point>`. When the sources disagree, the call does not compile. `createType<Money>({...})` always works.
- `createCollection` takes `C` from the return type of `fromItems`. `toItems` takes `NoInfer<C>`, so it never contributes. Context-sensitive functions are inferred in order, so the README says to write `fromItems` before `toItems`. A generic wrapper `<S extends Schema>(item: S) => createCollection({...})` needs no annotations inside the spec, including object items such as `items: { key, value }`, which give `Type<Box<{ key: string; value: number }>>`.

**The core law.** `t.encode(v)` succeeds if and only if `t.decode(t.encode(v))` succeeds, and the decoded value is deep-equal to `v`. This includes the depth limit: `encode` refuses a value nested deeper than `MAX_DEPTH`, the same as the reader does. There is one validation path. `encode` validates while it builds a Node, and `decode` validates while it builds a value.

### Standard Schema (`src/core/standard.ts`)

Every `Type` implements [Standard Schema](https://standardschema.dev) v1. The interfaces are copied into the library, so there is no dependency.

```ts
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

export function standardProps<T>(check: (value: unknown, path: Path) => unknown): StandardSchemaV1Props<T>
```

- `standardProps` returns a frozen object with `version: 1`, `vendor: "jstn"` and a synchronous `validate`. It never sets `types`, which exists only so that tools can infer the output type.
- `defineType` passes the type's `encode` as `check`. `validate(value)` runs `check(value, [])`, the same check as `JSTN.validate` and `JSTN.is`. On success it returns `{ value }`, where `value` is the input itself. On a `JSTNError` it returns one issue, `{ issues: [{ message: error.reason, path: error.segments }] }`. Any other exception propagates.
- The output type is `Infer<S>`, so a library that reads `StandardSchemaV1Props["types"]["output"]` sees the same type as `JSTN.parse`.

### Dispatch (`src/jstn.ts`)

```ts
parse(text, s)          = toType(s).decode(readData(text), [])
stringify(v, s, space)  = writeData(toType(s).encode(v, []), space)
validate(v, s)          = (toType(s).encode(v, []), v)
is(v, s)                = try validate → true; catch JSTNError → false; rethrow others
schema(s)               = toType(s)
parseSchema(text, opts) = readSchema(text, opts?.types ?? {})
```

### Internal normaliser (`src/core/schema.ts`)

```ts
export function toType<S extends Schema>(schema: S, path?: Path): Type<Infer<S>>
export function optional<S extends Schema>(schema: S): Optional<Infer<S>>
export function isShorthand(value: unknown): value is Schema
```

`isShorthand` is the single list of shorthand constructors. The schema reader uses it to tell a shorthand from a collection factory.

`toType(schema, path = [])` checks these cases in order:

1. `null` gives `nullType`.
2. `isType` gives the value unchanged.
3. Shorthand lookup in `Map<unknown, Type>` (`Number`, `String`, `Boolean`, `BigInt`, `Date`).
4. `isOptional` throws `optional() is only valid as an object field`.
5. A plain object gives `objectType(fields)`. `fields` comes from `Object.keys(schema)`, and each value is normalised with `toType(v, [...path, key])`. An `Optional` value unwraps to `{ optional: true }`.
6. Anything else throws `not a schema: <describeValue>`. The constructors `Array`, `Set`, `Map` and `Object` are described by their name instead of `function` and get a hint. The hints are `(use array(...))`, `(use set(...))`, `(use map(...))` and `(use a plain object literal)`.

`optional(s)` returns a frozen `{ [OPTIONAL]: toType(s) }`. This means `optional(optional(x))` throws through rule 4.

---

## 4. Formats

### 4.1 Shared lexical grammar (`src/syntax/lexer.ts`)

The notation is ISO EBNF. Trivia is allowed between any two tokens, except at the ⟨adj⟩ marker in the data grammar.

```ebnf
Trivia        = { WS | LineComment | BlockComment } ;
WS            = U+0020 | U+0009 | U+000A | U+000D ;               (* U+FEFF is skipped at offset 0 only *)
LineComment   = "//" { Char - ( U+000A | U+000D ) } ;
BlockComment  = "/*" { Char } "*/" ;                             (* shortest match, no nesting *)

Ident         = IdStart { IdStart | Digit } ;
IdStart       = "A".."Z" | "a".."z" | "_" | "$" ;
Digit         = "0".."9" ;
Hex           = Digit | "a".."f" | "A".."F" ;

String        = '"' { Char - ( '"' | "\" | Control ) | Escape } '"'
              | "'" { Char - ( "'" | "\" | Control ) | Escape } "'" ;
Control       = U+0000..U+001F ;
Escape        = "\" ( '"' | "'" | "\" | "/" | "b" | "f" | "n" | "r" | "t"
                    | "u" Hex Hex Hex Hex
                    | "u{" Hex { Hex } "}" ) ;                   (* value <= 10FFFF; \uD800 alone yields a lone surrogate *)

Number        = [ "-" ] ( Int [ Frac ] [ Exp ] ) | "-Infinity" ;
BigInt        = [ "-" ] Int "n" ;
Int           = "0" | ( "1".."9" ) { Digit } ;
Frac          = "." Digit { Digit } ;
Exp           = ( "e" | "E" ) [ "+" | "-" ] Digit { Digit } ;

Punct         = "{" | "}" | "[" | "]" | "(" | ")" | "," | ":" | "|" | "?" | "<" | ">" ;
```

Lexical rules:

- `NaN` and `Infinity` are lexed as `Ident`, and the data reader maps them in value position. `-Infinity` is a single `Number` token. If `-` is followed by anything other than a digit or the identifier `Infinity` with no gap, the lexer raises `unexpected "-"`.
- A `Number` or `BigInt` must not be directly followed by an `IdStart` or a `Digit`. Examples:
  - `1abc` gives `invalid number "1abc"`.
  - `12nn` gives `invalid number "12nn"`.
  - `1.5n` gives `invalid number "1.5n"`.
- `01` gives `invalid number "01"`. `.5` gives `unexpected "."`, and `5.` gives `invalid number "5."`. `+1` gives `unexpected "+"`.
- Line terminators are LF, CRLF (one line) and CR. Lines and columns are 1-based. Columns count UTF-16 code units, and a tab counts as one column.
- Each token records `pos`, which is the position of its first character, and `adjacent`, which is `true` when no trivia came between the previous token and this one.
- An unterminated block comment gives `unterminated comment` at the `/*`. An unterminated string gives `unterminated string` at the opening quote. A raw control character inside a string gives `control character in string`. A bad escape gives `invalid escape "\q"`.
- Any other character gives `unexpected character "@"`.

Lexer API (implemented in the foundation unit; both readers use it):

```ts
export type Token =
  | { readonly kind: "ident"; readonly value: string; readonly pos: Pos; readonly adjacent: boolean }
  | { readonly kind: "string"; readonly value: string; readonly pos: Pos; readonly adjacent: boolean }
  | { readonly kind: "number"; readonly value: number; readonly pos: Pos; readonly adjacent: boolean }
  | { readonly kind: "bigint"; readonly value: bigint; readonly pos: Pos; readonly adjacent: boolean }
  | { readonly kind: "punct"; readonly value: string; readonly pos: Pos; readonly adjacent: boolean }
  | { readonly kind: "eof"; readonly value: ""; readonly pos: Pos; readonly adjacent: boolean }

export class Lexer {
  constructor(source: string, fail: (reason: string, pos: Pos) => never)
  peek(): Token
  next(): Token
  eat(punct: string): boolean
  expect(punct: string): void
  more(close: string): boolean
  readKey(): Extract<Token, { kind: "ident" | "string" }>
  expectEnd(): void
  unexpected(token: Token, expected: string): never
  readPayload(open: Pos): string
}

export function describeToken(token: Token): string
```

- **Lookahead.** The lexer buffers at most one token. `peek` fills the buffer and `next` empties it.
- **Grammar helpers shared by both readers.** `eat(p)` consumes the next token if it is the punct `p`. `expect(p)` consumes it or fails with `expected "p"`. `more(close)` consumes a `,` and returns `true`, or consumes `close` and returns `false`, or fails with `expected "," or "close"`. `readKey()` returns an ident or string token, or fails with `expected key`. `expectEnd()` fails with `expected end of input` unless the input is exhausted. Only a punct token matches, so a string such as `":"` never stands in for punctuation.
- **`unexpected(token, expected)`** fails with `unexpected ${describeToken(token)}, expected ${expected}`. `describeToken` returns:

  | Token | Description |
  |---|---|
  | punct | `","` |
  | ident | `identifier "foo"` |
  | string | `string "x"` (truncated) |
  | number | `number 1` |
  | bigint | `bigint 1n` |
  | eof | `end of input` |

- **`readPayload(open)`** may only be called while the buffer is empty, immediately after `next()` returned an adjacent `(` token. If anything is buffered it throws an internal `Error`. It scans the raw source up to the next `)` and consumes that `)`, with these rules:
  1. Leading and trailing WS is trimmed.
  2. If the trimmed body starts with `"` or `'`, it must be exactly one `String` token. That string's value is the payload.
  3. Otherwise the body is raw. It must contain no `(`, `"`, `'`, `\`, U+0000–U+001F or U+007F. A violation gives `invalid character "x" in payload; quote the payload`. The character set is `RAW_FORBIDDEN` in `core/strings.ts`, shared with the writer.
  4. An empty body is the payload `""`.
  5. Comments are not recognised inside a payload, so `Url(https://x.io//a)` is fine.
  6. If the input ends before `)`, the result is `unterminated payload` at `open`.

### 4.2 jstn data grammar (`src/syntax/read-data.ts`)

```ebnf
Document      = Trivia Value Trivia EOF ;
Value         = "null" | "true" | "false" | "NaN" | "Infinity" | Number | BigInt | String
              | Object | List | Tagged ;
Object        = "{" [ Entry { "," Entry } [ "," ] ] "}" ;
Entry         = Key ":" Value ;
Key           = Ident | String ;                         (* every Ident, including null/true/NaN *)
List          = "[" [ Value { "," Value } [ "," ] ] "]" ;
Tagged        = Tag ⟨adj⟩ ( "(" Payload ")" | List ) ;
Tag           = Ident - ( "null" | "true" | "false" | "NaN" | "Infinity" ) ;
Payload       = see Lexer.readPayload ;
```

Reader rules:

- **Position (`pos`) on Node.** Every Node gets the `pos` of its first token. For a tagged value, that is the tag. Each `Entry` gets a `keyPos`.
- **Tag adjacency.** A `Tag` that is not immediately followed by `(` or `[` fails with `expected "(" or "[" immediately after tag "Foo"`. This means `Date (x)`, `Set [1]` and `Point{}` are all errors.
- **Duplicate keys** fail with `duplicate key` at the second key's `keyPos`. The error path includes that key.
- **Depth limit.** Nesting deeper than 512 lists and objects fails with `nesting deeper than 512 levels` at the opening bracket. The limit is the constant `MAX_DEPTH = 512`, defined in `core/error.ts` with `checkDepth(depth, path, pos?)`. Both readers and the list, tuple and object encoders call `checkDepth`, so `stringify` never writes text that `parse` rejects, and `validate` and `is` fail with a `JSTNError` instead of overflowing the stack.
- **Trailing content** fails with `unexpected <token>, expected end of input`.
- **Path stack.** The reader keeps a mutable path stack. It pushes the key or index before reading each child and pops it afterwards. The lexer's `fail` callback throws `new JSTNError(reason, [...stack], pos)`, so syntax errors also carry paths.
- **Punct outside the data grammar.** `|`, `?`, `<` and `>` are not part of data. If they appear in value position, they fail through `unexpected`.
- **Large integers.** A number literal beyond 2^53 parses as the nearest double, the same as JSON. Use the `n` suffix when exactness matters.
- **JSON compatibility.** Any `JSON.stringify` output is valid jstn data. The only exception is that duplicate keys are rejected.

### 4.3 jstn-schema grammar (`src/syntax/read-schema.ts`)

```ebnf
SchemaDoc     = Trivia Type Trivia EOF ;
Type          = [ "|" ] Postfix { "|" Postfix } ;
Postfix       = Primary { "[" "]" } ;                     (* binds tighter than "|", as in TS *)
Primary       = Name [ "<" Type { "," Type } [ "," ] ">" ]
              | "{" [ Field { "," Field } [ "," ] ] "}"
              | "[" [ Type { "," Type } [ "," ] ] "]"     (* tuple; "[]" is the empty tuple *)
              | "(" Type ")" ;
Field         = Key [ "?" ] ":" Type ;
Key           = Ident | String ;
Name          = Ident ;
```

- There are no adjacency rules in schema text.
- `>>` is two `>` tokens, because punct tokens are single characters.
- Number and bigint tokens are rejected everywhere. String tokens are allowed only as `Key`.
- A union with a single member is that member.
- Nesting deeper than 512 levels is an error. `{`, `[`, `(` and `<` each count one level, and so does each `[]` suffix, so `number[][]` is two levels deep.

**Name resolution.** The built-in names are `number`, `string`, `boolean`, `bigint`, `null`, `Date`, `Set` and `Map`. After them come the entries in `options.types`:

- A function that is not a shorthand constructor is a collection factory, such as `set`, `map` or a user's generic wrapper around `createCollection`. Its arity is `fn.length`. It must be written with type arguments, and the number of arguments must equal its arity.
- A factory with `fn.length === 0` fails with `"Foo" is not a schema or collection` when the registry is read.
- The reader calls the factory with the argument `Type`s. If the result is not a `Type` (`isType`), it fails with `"Foo" did not return a type`, positioned at the name token.
- Any other registry value is treated as a `Schema`, normalised with `toType`, and used as a bare name. This includes `Type`, shorthand constructors, `null` and object shapes. A collection with a fixed item schema is a `Type`, so it is registered this way.

Errors. Every error has path `$`. All of them carry line and column except the registry errors, which are raised before reading starts and have no position.

| Situation | Reason |
|---|---|
| Unknown name | `unknown type "User"` |
| Type arguments on a non-generic name | `"number" does not take type arguments` |
| Generic name used without arguments | `"Set" requires 1 type argument` |
| Wrong number of arguments | `"Map" expects 2 type arguments, got 1` |
| Factory result that is not a `Type` | `"Arr" did not return a type` |
| Duplicate field | `duplicate key "a"` |
| `options.types` key that is a built-in name | `cannot redefine built-in type "Date"` |
| `options.types` key that is not an identifier | `invalid type name "x y"` |
| `options.types` function with no declared parameters | `"Fn" is not a schema or collection` |

**How the reader builds types.** It calls the public builders: `array`, `tuple`, `union`, `optional`, the collection factories, and `JSTN.schema` through `toType`. For object types, it builds a null-prototype object with `Object.defineProperty` for each field (so `"__proto__"` is safe), wraps optional fields in `optional(...)`, and calls `toType`. This guarantees that text schemas and builder schemas produce identical `Type`s.

**The name law.** `Type.name` is canonical single-line jstn-schema text:

| Type | Name |
|---|---|
| scalars | `number`, `string`, `boolean`, `bigint`, `null`, `Date` |
| custom type | its tag: the string `name`, or the class's `name` |
| array | `T[]`; the item name is wrapped in parentheses when the item is a union: `(number \| string)[]` |
| tuple | `[A, B]`, empty `[]` |
| object | `{ a: A, "b c"?: B }`, empty `{}`. Keys go through `formatKey`, and fields stay in schema order |
| union | `A \| B \| C`. Nested unions are flattened at construction, so the name never needs parentheses inside a union |
| collection | `Name<A, B>` |

For any type `t` built from built-ins plus registered customs, `parseSchema(t.name, { types }).name === t.name`. The exceptions are a `createType` or `createCollection` named `Date`, `Set` or `Map`, because the text name resolves to the built-in, and a collection with a fixed item schema registered as a bare name. The README documents these exceptions.

### 4.4 Canonical stringify output (`src/syntax/write-data.ts`)

```ts
export function writeData(node: Node, space?: number | string): string
```

**Scalars:**

| Node | Output |
|---|---|
| null, boolean | `null`, `true`, `false` |
| number | `-0` for negative zero, otherwise `String(n)`. This gives forms such as `1e+21`, `5e-324`, `NaN`, `Infinity` and `-Infinity` |
| bigint | `${n}n`, for example `123n` or `-5n` |
| string | `quote(s)` (see below) |
| tagged | `${tag}(${payload})` when `isRawPayload(payload)` is true, otherwise `${tag}(${quote(payload)})` |

**`quote(s)`** (in `src/core/strings.ts`) always uses double quotes. It escapes as follows:

- `"` becomes `\"`, and `\` becomes `\\`.
- U+0008, U+000C, U+000A, U+000D and U+0009 become `\b`, `\f`, `\n`, `\r` and `\t`.
- Every other U+0000–U+001F character, U+007F, and every lone surrogate becomes `\uXXXX` with lowercase hex.
- Everything else is written literally, including emoji and non-ASCII text.

**`isRawPayload(s)`** is true when all of these hold:

- `s` is non-empty.
- `s` is well-formed Unicode (`s.isWellFormed()`). A lone surrogate forces the quoted form, where `quote` escapes it, so the output survives UTF-8 encoding.
- `s` contains none of `( ) " ' \`, U+0000–U+001F or U+007F.
- `s` does not start or end with U+0020.

**`formatKey(k)`** writes `k` bare when it matches `^[A-Za-z_$][A-Za-z0-9_$]*$`, which includes keywords such as `null`. Otherwise it writes `quote(k)`.

**Containers.** In the rules below, `ind(n)` is the indent string repeated `n` times, and `prefix` is the list's tag or `""`. A node is *scalar* when its kind is null, boolean, number, bigint, string or tagged.

- **Empty containers:** `{}`, `[]`, `Set[]` (`prefix + "[]"`).
- **Compact mode** (no indent) uses no whitespace and no trailing commas:
  - `{a:1,"b c":[1,2],m:Map[["k",1]]}`
  - lists are `prefix + "[" + items.join(",") + "]"`
  - entries are `key:value`
- **Pretty mode:**
  - A list whose items are all scalars is printed inline: `prefix + "[" + items.join(", ") + "]"`.
  - Any other non-empty list is printed as `prefix + "[\n"`, then for each item `ind(level+1) + item + ",\n"`, then `ind(level) + "]"`.
  - A non-empty object is always expanded: `"{\n"`, then for each entry `ind(level+1) + key + ": " + value + ",\n"`, then `ind(level) + "}"`.
  - There is no final newline.

**Order.** Object entries come out in schema order. Set and Map entries come out in insertion order.

**Date.** The payload is `toISOString()` with a trailing `.000Z` replaced by `Z`. Extended years appear as `toISOString` produces them, for example `+275760-09-13T00:00:00Z`.

---

## 5. Semantics

### 5.1 Built-in validation rules

| Type | `encode` accepts | Node produced | `decode` accepts |
|---|---|---|---|
| `number` | `typeof v === "number"`, including NaN, ±Infinity and -0 | `number` | `number` |
| `string` | `typeof v === "string"` | `string` | `string` |
| `boolean` | `typeof v === "boolean"` | `boolean` | `boolean` |
| `bigint` | `typeof v === "bigint"` | `bigint` | `bigint` |
| null | `v === null` | `null` | `null` |
| `date` | `v instanceof Date && !Number.isNaN(v.getTime())` | `tagged "Date"` | `tagged "Date"` with a strict ISO payload (below) |
| object | plain object, keys checked (§5.3) | `object` | `object`, keys checked (§5.3) |
| `tuple` | `Array.isArray(v) && v.length === n` | `list null` | `list` with tag `null` and exactly `n` items |
| `array` | `Array.isArray(v)`; a hole encodes as `undefined` and fails at its index | `list null` | `list` with tag `null` |
| `set` | `v instanceof Set` | `list "Set"` | `list "Set"`. Duplicates (SameValueZero) fail with `invalid Set<T>: duplicate item` |
| `map` | `v instanceof Map` | `list "Map"` whose items are 2-item `list null` | `list "Map"` whose items are pairs. Duplicate keys fail with `invalid Map<K, V>: duplicate key` |
| union | first member whose `encode` succeeds | that member's node | first member whose `decode` succeeds |

Boxed primitives (`new Number(1)`) are rejected. Element paths are `[i]`. Set items are indexed in iteration order. Map entries use `[i][0]` for the key and `[i][1]` for the value, because a map item is a `tuple(k, v)`.

**Date payload grammar.** It is strict ISO 8601. The lenient parsing of `new Date(string)` is never used.

```
^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2}))?$
```

- The date-only form means UTC midnight.
- `-000000` is rejected.
- The fields are range-checked: month 1–12, day up to the length of that month (leap years included), hour 0–23, minute 0–59, second 0–59, offset hours 0–23 and offset minutes 0–59.
- Milliseconds are the first three fraction digits, padded with zeros on the right.
- Build the date with `new Date(0)`, then `setUTCFullYear(y, m - 1, d)` and `setUTCHours(h, mi, s, ms)`, then subtract the offset. Do not use `Date.UTC`, because it maps years 0–99 to 1900–1999. If the result is outside the range of `Date`, it is rejected.
- A failure gives `invalid Date "<payload>": <why>`.

### 5.2 Union resolution

- **Construction.** `union(...members)` normalises each member. A member that is itself a union contributes its members, which is how nested unions are flattened. The unions are tracked in a module-level `WeakMap<Type, Type[]>` in `union.ts`, and the `array` name wrapping uses the exported `isUnion(t)`. At runtime, fewer than 2 members (after flattening) throws `union() needs at least 2 members`.
- **Encode and decode.** The members are tried in declaration order, and the first success wins. Only `JSTNError` is caught. Any other error propagates.
- **When every member fails.** Among the member errors whose `path` is strictly below the union's own formatted path, choose the one with the longest `path` string, and on a tie the earliest member. Rethrow that error unchanged. If no member error is below the union's path, throw `expected A | B, got <describe>` at the union's path and node position.
- Ambiguity is resolved by declaration order, and the README documents this. Tags remove most ambiguity: `1` versus `1n`, `[..]` versus `Set[..]`, `Date(..)` versus `"..."`.

### 5.3 Objects, optional keys and unknown keys

Object types are strict in both directions.

**Encode** (stringify, validate, is):

1. The value must be a plain object (prototype `Object.prototype` or `null`). Otherwise the error is `expected { ... }, got <describe>`, where `<describe>` is the constructor name, for example `got Point`.
2. Every own enumerable string key that is not in the shape fails with `unknown key` at `[...path, key]`. Keys are checked in `Object.keys` order before any field is encoded. Symbol keys are ignored.
3. For each field in schema order:
   - An optional field that is absent (not `Object.hasOwn`), or whose value is `undefined`, is omitted.
   - A required field that is absent fails with `missing required key "k"` at the object's path.
   - A required field that is present with the value `undefined` is encoded normally, so it fails with `expected number, got undefined` at `[...path, key]`.

**Decode** (parse):

1. The node must have kind `object`.
2. Each entry whose key is not in the shape fails with `unknown key` at `[...path, key]` and `entry.keyPos`.
3. Each required field that is missing fails with `missing required key "k"` at the object's path and `node.pos`.
4. The fields are decoded in schema order.
5. The result is built with `Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true })` on `{}`, so a `"__proto__"` key becomes an own property and never changes the prototype. Keys appear in schema order. `parse` never produces `undefined`.

Duplicate keys are caught by the data reader (§4.2), not here.

### 5.4 Errors (`src/core/error.ts`)

```ts
export class JSTNError extends Error {
  override readonly name = "JSTNError"
  readonly reason: string
  readonly path: string
  readonly segments: Path
  readonly line: number | undefined
  readonly column: number | undefined
  constructor(reason: string, path: Path, pos?: Pos, options?: ErrorOptions)
}
export function formatPath(path: Path): string
export function describeValue(value: unknown): string
export function describeNode(node: Node): string
export function mismatch(expected: string, got: string, path: Path, pos?: Pos): JSTNError
export function guard<R>(run: () => R, prefix: string, path: Path, pos?: Pos): R
```

- **Message.** The message is `${path}: ${reason}`, followed by ` (line ${line}, column ${column})` when a position is known.
- **`path` and `segments`.** `path` is the formatted path, such as `$.someArr[2]`. `segments` is a frozen copy of the raw path, such as `["someArr", 2]`. Standard Schema issues use `segments` as their `path`.
- **Imports.** `error.ts` imports `type.ts` for types only (`Node`, `Path`, `Pos`), so the runtime edge `type.ts → standard.ts → error.ts` is not a cycle.
- **Positions.** Errors from stringify, validate and is never have a position. Errors from parse and parseSchema always have one, except the registry errors described in §4.3.
- **`formatPath`.** The root is `$`. A string key is written `.key` when it is an identifier and `[${quote(key)}]` otherwise. A number index is written `[i]`. Example: `$.a[2]["with space"]`.
- **`describeValue` and `describeNode`** share one vocabulary:

  | Value | Description |
  |---|---|
  | `null`, `undefined` | `null`, `undefined` |
  | boolean | `boolean true` |
  | number | `number 3`, `number -0`, `number NaN` |
  | bigint | `bigint 5n` |
  | string | `string "x"`. The quoted form is truncated to 40 characters plus `…` |
  | array, or a list Node with tag `null` | `array` |
  | Set, Map, or a list Node with a tag | the class name or tag, for example `Set` |
  | plain object, or an object Node | `object` |
  | other object | its constructor name, or `object` |
  | invalid Date | `invalid Date` |
  | tagged Node | its tag, for example `Money` |
  | function | `function` |
  | symbol | `symbol` |

- **`guard`** runs user code: `parse`, `stringify`, `toItems` and `fromItems`. If it throws, `guard` throws `new JSTNError(`${prefix}: ${message}`, path, pos, { cause })`. The message is `e.message` for an `Error` and `String(e)` otherwise.
- The library only ever throws `JSTNError`. That includes API misuse at definition time, such as a bad type name or `union()` with fewer than 2 members. Those errors use path `$` and no position.

Example messages. These are normative; `errors.test.ts` pins them.

```text
$.someArr[2]: expected number, got string "x" (line 6, column 16)
$.someObj: missing required key "inner" (line 4, column 12)
$.someObj["b c"]: unknown key (line 5, column 5)
$.a: duplicate key (line 1, column 8)
$.a: unterminated string (line 1, column 4)
$: unexpected identifier "x", expected end of input (line 3, column 1)
$.a[2]: unexpected ",", expected value (line 1, column 12)
$.d: expected "(" or "[" immediately after tag "Date" (line 1, column 5)
$.u: expected number | string, got boolean true (line 2, column 6)
$.t: expected 2 items, got 3 (line 1, column 5)
$.price: invalid Money "abc": expected "<amount> <CCY>" (line 2, column 10)
$.price: invalid Money "1 GBP": parse result rejected by match (line 2, column 10)
$.s: invalid Set<number>: duplicate item (line 1, column 5)
$.someDate: expected Date, got string "2026-01-01"
$.p: expected { x: number }, got Point
$.c: cannot stringify Money: boom
$: unknown type "User" (line 3, column 10)
$: "Map" expects 2 type arguments, got 1 (line 1, column 1)
$: cannot redefine built-in type "Date"
$: not a schema: Array (use array(...))
$: optional() is only valid as an object field
```

---

## 6. createType and createCollection

### 6.1 createType (`src/types/custom.ts`)

```ts
export type Class<T> = abstract new (...args: any) => T
export type Match<T> = ((value: unknown) => value is T) | ((value: unknown) => boolean)
export type Named<T> =
  | { readonly name: string; match: Match<T> }
  | { readonly name: Class<T>; match?: Match<T> }

export type TypeSpec<T> = Named<T> & {
  parse(text: string): T
  stringify(value: NoInfer<T>): string
}

export function resolveNamed(spec: Named<unknown>): { readonly tag: string; readonly match: (value: unknown) => boolean }
export function createType<T>(spec: TypeSpec<T>): Type<T>
```

- **`name`** is either a string or a class. A string is the tag, and `match` is required. A class gives the tag `Class.name`, and `match` is optional. It defaults to `value instanceof Class`.
- **`resolveNamed(spec)`** turns a `Named` into `{ tag, match }`. `createType` and `createCollection` both call it. It runs `assertTypeName(tag)`, returns an explicit `match` as given, throws `$: "X" needs a match function` for a string name with no `match`, and otherwise builds the `instanceof` check. The type rejects a string name without `match` at compile time. The runtime check covers casts.
- **The tag** is both the data tag and the `Type.name`. `assertTypeName(tag)` (in `core/error.ts`, next to the `JSTNError` it throws) requires an `Ident` that is not in `RESERVED = ["true", "false", "null", "NaN", "Infinity", "number", "string", "boolean", "bigint"]`. Shadowing `Date`, `Set` or `Map` is allowed, so a user can supply an alternative codec. A violation throws `$: invalid type name "x"`. An anonymous class has the name `""`, so it fails this check.
- **encode:**
  1. If `match(v)` is false, throw `expected ${tag}, got ${describeValue(v)}`.
  2. Run `guard(() => spec.stringify(v), "cannot stringify " + tag)`.
  3. If the result is not a string, throw `cannot stringify ${tag}: stringify must return a string`.
  4. Return `{ kind: "tagged", tag, payload }`. The writer decides between the raw and the quoted form, so user code never escapes anything.
- **decode:**
  1. The node must have kind `tagged` with the same tag. Otherwise throw `expected ${tag}, got ${describeNode}`.
  2. Run `guard(() => spec.parse(payload), `invalid ${tag} ${quote(payload)}`)`.
  3. If `match(result)` is false, throw `invalid ${tag} ${quote(payload)}: parse result rejected by match`.
- **Inference.** `T` comes from the class, from `match` when it is a type guard, and from `parse`. `stringify` takes `NoInfer<T>`, so it never contributes. If the sources disagree, the call does not compile (§3).

### 6.2 createCollection (`src/types/collection.ts`)

```ts
export type CollectionSpec<A, I, C> = Named<unknown> & {
  readonly items: A
  fromItems(items: I[]): C
  toItems(value: NoInfer<C>): Iterable<I>
}

type InferAll<A extends readonly Schema[]> = { -readonly [K in keyof A]: Infer<A[K]> }

export function createCollection<const A extends readonly [Schema, ...Schema[]], C>(spec: CollectionSpec<A, InferAll<A>, C>): Type<C>
export function createCollection<S extends Schema, C>(spec: CollectionSpec<S, Infer<S>, C>): Type<C>
```

- **`name` and `match`** work exactly as in `createType`, through `resolveNamed`. `Named<unknown>` is used because `C` comes from `fromItems`, not from the class.
- **`items`** is one `Schema` or a non-empty array of `Schema`s:
  - One schema gives one type argument. Each item has that schema, and the name is `Tag<A>`.
  - An array gives one type argument per entry. Each item is a tuple of those schemas, built with `tuple(...)`, and the name is `Tag<A, B>`.
- **`C`** is the return type of `fromItems`. `toItems` takes `NoInfer<C>`, so write `fromItems` before `toItems`.
- **Generic collections** are plain generic functions written by the user, `<S extends Schema>(item: S) => createCollection({...})`. The function's type parameter carries the item type, because TypeScript cannot apply a generic class such as `SortedSet` to a type argument by itself. Nothing inside the spec needs an annotation. A collection with a fixed item schema needs no wrapper and is a plain `Type<C>`.
- **Runtime.** `createCollection` resolves the tag and `match`, normalises each schema with `toType`, builds the item type (the single type, or `tuple(...args)`), computes `name = `${tag}<${args.map((a) => a.name).join(", ")}>``, and returns `listType(tag, name, item, { match, toItems, fromItems })`. The `toItems` and `fromItems` passed on are arrows that call `spec.toItems(value)` and `spec.fromItems(items)`, so `this` stays bound.

**`listType`** is internal and is the shared core for every list-shaped type:

```ts
type ListSpec<C, I> = { match(value: unknown): boolean; toItems(value: C): Iterable<I>; fromItems(items: I[]): C }
function listType<C, I>(tag: string | null, name: string, item: Type<I>, spec: ListSpec<C, I>): Type<C>
```

- **encode:**
  1. `checkDepth(path.length, path)`, then if `match` is false, throw a mismatch.
  2. `items = [...guard(() => spec.toItems(v), "cannot stringify " + name)]`.
  3. Encode each item at `[...path, i]`.
  4. Return `{ kind: "list", tag, items }`.
- **decode:**
  1. The node must have kind `list` with `tag === tag`. Otherwise throw a mismatch with `name`.
  2. Decode each item at `[...path, i]`.
  3. Return `guard(() => spec.fromItems(values), "invalid " + name, path, node.pos)`.

### 6.3 How the built-ins are built

| Built-in | File | Built with |
|---|---|---|
| `number`, `string`, `boolean`, `bigint`, null | `scalars.ts` | `literalType(name, kind, test)`: about 10 lines each through `defineType`. These map directly onto literal Node kinds. They are not tagged, so they are not built with `createType` |
| `date` | `date.ts` | `createType({ name: Date, match, parse: parseIsoDate, stringify: formatIsoDate })`, where `match` also rejects an invalid `Date`. This is the public extension API, which proves it is sufficient |
| `array` | `collection.ts` | `listType(null, arrayName(item), item, { match: Array.isArray, toItems: identity, fromItems: identity })`. It is untagged, so it uses `listType` directly |
| `set` | `collection.ts` | a plain function, `set(item)`, returning `createCollection({ name: Set, items: item, ... })`, where `fromItems` throws `duplicate item` when `new Set(items).size !== items.length` and `toItems` is the set itself |
| `map` | `collection.ts` | a plain function, `map(key, value)`, returning `createCollection({ name: Map, items: [key, value], ... })`, where `toItems` is `m.entries()` and `fromItems` throws `duplicate key` when sizes differ |
| `tuple` | `tuple.ts` | `defineType` directly, because the positions are heterogeneous and the length is fixed |
| `union` | `union.ts` | `defineType` directly |
| object | `object.ts` | `objectType(fields: readonly Field[])` with `type Field = { key: string; type: Type<unknown>; optional: boolean }` via `defineType`. Only `toType` calls it |

Untagged `[...]` is reserved for arrays and tuples, because `createCollection` always tags. That keeps union resolution predictable.

---

## 7. File layout

Every file has one job and is under 300 lines. Imports point one way:

```
core/strings  ←  core/error  ←  core/standard  ←  core/type
core/*  ←  types/scalars, types/custom, types/object
        ←  core/schema (toType, needs scalars, date, object)
        ←  types/date (custom), types/tuple, types/union, types/collection (all use toType; collection also uses custom, tuple and union)
core/*  ←  syntax/lexer  ←  syntax/read-data, syntax/write-data
syntax/lexer + types/* + core/schema  ←  syntax/read-schema
everything  ←  jstn  ←  index
```

Inside `core`, the runtime imports are `type.ts → standard.ts → error.ts → strings.ts`. `error.ts` and `standard.ts` import `type.ts` with `import type` only, which is erased, so there is no runtime cycle.

`core/schema.ts` imports `types/scalars.ts`, `types/date.ts` and `types/object.ts`. Those files must never import `core/schema.ts`. `date.ts` imports only `custom.ts`, and `custom.ts` imports only `core/*`. There are no cycles.

```
package.json                 name jstn, type module, exports ".", scripts, devDeps
tsconfig.json                strict type-check config for src + test (noEmit)
tsconfig.build.json          extends tsconfig.json; src only; emits dist/ with declarations
vitest.config.ts             test include globs
.gitignore                   node_modules/, dist/, coverage/, *.log (already present)
README.md                    language reference (both grammars, output rules) and API guide

src/
  index.ts                   public surface: re-exports exactly the names in §2.1
  jstn.ts                    the JSTN object: parse, stringify, validate, is, schema, parseSchema
  core/
    strings.ts               IDENT, RAW_FORBIDDEN, isIdent, quote, formatKey, isRawPayload, RESERVED
    type.ts                  brands, Type, Optional, Schema, Shape, Infer, InferShape, ReadonlyInput, Node, Entry, Pos, Path, defineType, isType, isOptional
    standard.ts              StandardSchemaV1, StandardSchemaV1Props, StandardSchemaV1Result, StandardSchemaV1Issue, standardProps
    error.ts                 JSTNError, formatPath, describeValue, describeNode, mismatch, guard, assertTypeName, MAX_DEPTH, checkDepth
    schema.ts                toType (Schema → Type), optional, isShorthand
  types/
    scalars.ts               number, string, boolean, bigint, nullType
    custom.ts                createType, resolveNamed, Class, Match, Named, TypeSpec
    date.ts                  date: strict ISO-8601 parseIsoDate and formatIsoDate, via createType
    object.ts                objectType: strict keys, optional fields, safe construction, object name
    tuple.ts                 tuple
    union.ts                 union, isUnion, flattening, best-error selection
    collection.ts            listType, createCollection, CollectionSpec, array, set, map
  syntax/
    lexer.ts                 shared tokenizer: trivia, tokens, positions, grammar helpers, readPayload, describeToken
    read-data.ts             readData(text): Node; path stack, duplicate keys, tag adjacency, depth limit
    write-data.ts            writeData(node, space): string; compact/pretty rules, scalar spelling
    read-schema.ts           readSchema(text, registry): Type; Registry and ParseSchemaOptions types

test/
  support/
    fixtures.ts              Money and Note (createType), SortedSet and sortedSet (a generic createCollection wrapper), registry, sample schema S
    arbitraries.ts           fast-check: fc.letrec {type, value} generators, tricky strings, arbitrary Nodes
  core/
    strings.test.ts          quote, formatKey, isRawPayload, assertTypeName
    error.test.ts            JSTNError fields and message, formatPath, describeValue, describeNode, guard
    standard.test.ts         ~standard props, validate results and issue paths
    schema.test.ts           toType shorthands, shapes, optional placement, rejections with hints
  types/
    scalars.test.ts          number, string, boolean, bigint, null encode and decode
    custom.test.ts           createType behaviour and errors
    date.test.ts             ISO parse and format strictness
    object.test.ts           strict keys, optional, __proto__, names
    tuple.test.ts            arity and positions
    union.test.ts            ordering, flattening, error selection, names
    collection.test.ts       array, set, map, createCollection
  syntax/
    lexer.test.ts            every token class and lexical error
    read-data.test.ts        data grammar → Node, positions, syntax errors with paths
    write-data.test.ts       golden output for every node kind and space value
    read-schema.test.ts      schema grammar, precedence, registry, errors
    syntax.property.test.ts  readData(writeData(n)) equals n; JSON superset; total reader
  api.test.ts                end-to-end through JSTN.* with the user's examples
  errors.test.ts             exact-message catalogue (message, reason, path, line, column)
  laws.property.test.ts      round trip, canonical output, name law, total parse, is/stringify agreement
  infer.test-d.ts            type-level tests for Infer and the API signatures
  compile-errors.test.ts     runs tsc on snippets that must not compile, such as JSTN.stringify("x", {})
  docs.test.ts               README and docs/ code blocks parse, round-trip and type-check
```

### Tooling

**`package.json`:**

- `"name": "jstn"`, `"version": "0.1.0"`, `"type": "module"`.
- `"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`, `"files": ["dist"]`, `"engines": { "node": ">=26" }`.
- devDependencies: `typescript@^7.0.2`, `vitest@^5.0.5`, `fast-check@^4.10.2`. There are no dependencies.
- Scripts:
  - `"build": "tsc -p tsconfig.build.json"`
  - `"check": "tsc --noEmit"`
  - `"test": "tsc --noEmit && vitest run"`

  The type tests (`*.test-d.ts`) are checked by `tsc --noEmit`. `expectTypeOf` mismatches are compile errors. The vitest typecheck mode is not used, which avoids depending on its integration with TypeScript 7.

**`tsconfig.json`:**

- `target` and `lib`: `es2024`.
- `module` and `moduleResolution`: `nodenext`.
- Flags: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `skipLibCheck`.
- `"types": []` and `noEmit`.
- `include`: `["src", "test", "vitest.config.ts"]`.

**`tsconfig.build.json`:** it extends `tsconfig.json` and sets `noEmit: false`, `declaration: true`, `outDir: "dist"`, `rootDir: "src"` and `include: ["src"]`.

**`vitest.config.ts`:** `defineConfig({ test: { include: ["test/**/*.test.ts"] } })`.

**Code rules:**

- Relative imports use `.ts` extensions.
- No comments anywhere, in `src`, `test` or config files. This includes `@ts-expect-error` and `@ts-ignore`.
- No `enum`, no parameter properties and no `namespace`, because `erasableSyntaxOnly` is on.

---

## 8. Test plan

General rules:

- Tests assert observable behaviour: return values, output text, `Node` shapes from the public `encode` and `decode`, and the fields of `JSTNError`.
- Equality uses `toStrictEqual`. It compares numbers with `Object.is`, so `-0` and `NaN` are handled, and it checks class identity and `undefined` properties.
- `it.each` tables are preferred.
- Error tests assert `instanceof JSTNError` and the exact `message`.

### test/support/fixtures.ts (foundation)

- `Money`: the class and the `money` type from §2.3. A raw payload looks like `Money(12.50 GBP)`.
- `Note`: a class `{ text: string }` with `note = createType({ name: "Note", match: v instanceof Note, parse: (t) => new Note(t), stringify: (n) => n.text })`. Its payload can be any string, so it exercises raw versus quoted payloads.
- `SortedSet` and `sortedSet`, as in §2.3.
- `registry = { Money: money, Note: note, SortedSet: sortedSet }`.
- `S`, the full schema from §2.3; `sampleValue`, a matching value; and `sampleSchemaText`, the jstn-schema text from §2.3.

### test/core/strings.test.ts (foundation)

1. `quote` covers:
   - plain text
   - `"` and `\`
   - every short escape
   - U+0000, U+001F and U+007F as `\u00xx`
   - lone high and lone low surrogates as `\udxxx`
   - a valid surrogate pair (emoji) written literally
   - non-ASCII text written literally
2. `formatKey`: identifiers are bare (`a`, `_x`, `$y`, `null`, `true`). These are quoted: `""`, `"a b"`, `"1a"`, `"é"`, `"a-b"`.
3. `isRawPayload`:
   - true for `2026-01-01T14:00:00Z`, `12.50 GBP` and `https://x.io//a`
   - false for `""`, a leading or trailing space, each forbidden character, a newline and a tab
4. `assertTypeName`: accepts `Money`, `Date` and `Set`. It rejects `""`, `"a b"`, `"1x"` and every `RESERVED` name, with an exact message.

### test/core/error.test.ts (foundation)

1. `JSTNError`:
   - it is `instanceof Error`
   - `name` is `"JSTNError"`
   - `reason`, `path`, `segments`, `line` and `column` are populated, and `segments` is frozen
   - the message has the position suffix only when `pos` is given
   - `cause` is preserved
2. `formatPath`:
   - `[]` gives `$`
   - identifier keys, quoted keys (space, empty, quote character) and indexes
   - mixed nesting gives `$.a[2]["with space"].b`
3. `describeValue`: covers every row of the §5.4 table. That includes truncation at 40 characters, `-0`, `NaN`, class instances, a null-prototype object (`object`) and an invalid `Date`.
4. `describeNode`: covers every Node kind, including tagged nodes and lists with and without a tag.
5. `guard`:
   - returns the value on success
   - wraps an `Error`, keeping the message and `cause`
   - wraps a thrown string or number using `String(e)`
   - carries the path and position

### test/syntax/lexer.test.ts (foundation)

1. **Trivia:**
   - spaces, tabs, LF, CR and CRLF
   - `//` at the end of input
   - `/* */` spanning lines
   - comments between every pair of tokens
   - `/* /* */` (no nesting)
   - an unterminated comment, reported at its start position
   - a BOM at offset 0 is skipped
   - a BOM elsewhere gives `unexpected character`
2. **Identifiers:** `a`, `_`, `$`, `a1`, `NaN` and `Infinity` are all identifiers. `é` gives an unexpected character error.
3. **Numbers** that are accepted, with their values:
   - `0`, `-0` (`Object.is(-0)`), `1`, `-1`
   - `1.5`, `1e5`, `1E+5`, `1e-7`
   - `-Infinity`
   - `9007199254740993`, which becomes the nearest double
4. **Numbers** that are rejected, each with its exact reason: `01`, `.5`, `5.`, `1.`, `+1`, `- 1`, `1abc`, `1e`, `0x1F`, `1_000`.
5. **BigInts:** `0n`, `-5n`, a 200-digit value, `-0n` (which becomes `0n`). These are rejected: `1.5n`, `12nn`, `01n`, `1e3n`.
6. **Strings:**
   - both quote styles
   - every escape, `A`, `\u{1F600}` and `\u{10FFFF}`
   - `\u{110000}` is rejected
   - `\uD800` gives a lone surrogate
   - `\q`, `\x41` and `\u12` are invalid escapes
   - raw control characters, including a raw newline and a raw tab, give `control character in string`
   - an unterminated string, reported at the opening quote
   - an unescaped `'` inside a double-quoted string, and `"` inside a single-quoted one
7. **Punct:** every punct character. `@`, `#` and `;` give `unexpected character`.
8. **Positions and adjacency:**
   - line and column after LF, CR, CRLF and a tab
   - a column after an astral character counts 2 code units
   - `adjacent` is true for `Set[` and false for `Set [` and `Set/**/[`
9. **`readPayload`:**
   - a raw payload with internal spaces
   - trimming of surrounding spaces and newlines
   - a quoted payload in either quote style
   - empty `()` gives `""`
   - `//` and `/*` inside a raw payload are kept literally
   - each forbidden character gives the exact reason
   - an unterminated payload, reported at the open position
   - text after a quoted string inside the payload, as in `("a" b)`, is an error
   - calling it with a buffered token throws an internal error
10. **Helpers:** `eat`, `expect`, `unexpected` and the `describeToken` output for each token kind.

### test/core/schema.test.ts (unit A)

1. Each shorthand (`Number`, `String`, `Boolean`, `BigInt`, `Date`, `null`) resolves to the same object as the matching built-in. The null type's name is `null`.
2. `JSTN.schema(t)` returns `t` itself. A plain object becomes an object type. A null-prototype object is accepted. Nested literals are normalised recursively.
3. `optional`:
   - inside a shape, the field is optional
   - at the top level, it throws `$: optional() is only valid as an object field`
   - inside `array`, `tuple`, `union`, `set` or `optional`, it throws with that builder's path
4. Rejections, with an exact message and hint:
   - the constructors `Array`, `Set`, `Map`, `Object` and `Symbol`
   - `undefined`, `3`, `"number"`, a function and a class instance
   - an invalid field schema, with a nested path (`$.a.b: not a schema: number 3`)
5. Duck typing is rejected. An object such as `{ name: "number", encode() {}, decode() {} }` is treated as a shape and fails with `$.name: not a schema: string "number"`.
6. Types are frozen.

### test/types/scalars.test.ts (unit A)

1. `number` encode and decode: `0`, `-0` (sign preserved), `1.5`, `NaN`, `Infinity`, `-Infinity`, `Number.MAX_VALUE`, `5e-324`, `2**53 + 2`.
2. Rejections:
   - `"1"`, `1n`, `new Number(1)`, `null` and `undefined` are rejected by `number`
   - each wrong kind is rejected by `string`, `boolean`, `bigint` and null
   - every error has the exact `expected X, got Y` message
3. Decode rejects the wrong Node kind, including a `tagged` node for a scalar, with the node's position.
4. `string` round-trips the empty string, escapes, emoji, a lone surrogate, `\u0000` and a 10 kB string.
5. `bigint` round-trips negative values, zero and 200-digit values.
6. `JSTN.is` and `JSTN.validate` work with every scalar.

### test/types/custom.test.ts (unit A)

1. `Money` encode produces a tagged Node, and decode gives a `Money` instance.
2. `Note` with these payloads: an empty string, leading and trailing spaces, `(`, `)`, quotes, a newline, a backslash and unicode. All round-trip through `JSTN.stringify` and `JSTN.parse`. The output uses the raw form exactly when `isRawPayload` is true.
3. Decode failures:
   - the wrong tag gives `expected Money, got Note`
   - a non-tagged node is rejected
   - `parse` throwing an `Error` gives `invalid Money "abc": <msg>` with `cause`
   - `parse` throwing a non-Error is also wrapped
   - `parse` returning a non-matching value gives `parse result rejected by match`
4. Encode failures:
   - `match` false gives a mismatch
   - `stringify` throwing gives `cannot stringify Money: boom`
   - `stringify` returning a non-string is rejected
5. Name validation: every reserved name and every non-identifier is rejected. `Date` is allowed as a shadowing name.
6. `Type.name` equals the spec name.
7. A class `name`:
   - the tag is the class name, and `match` defaults to `instanceof`, so a plain object gives `expected Point, got object`
   - an explicit `match` overrides the default, including on decode (`parse result rejected by match`)
   - an anonymous class gives `invalid type name ""`
   - a string name with no `match`, forced through a cast, gives `"Point" needs a match function`

### test/types/date.test.ts (unit A)

1. **Formatting:**
   - whole seconds give `2026-01-01T14:00:00Z`
   - milliseconds are kept (`.123Z`)
   - years 0–99 are correct, for example `0005-03-01T00:00:00Z`
   - extended years `+275760-09-13T00:00:00Z` and `-000001-01-01T00:00:00Z`
2. **Accepted:** date-only (UTC midnight), minutes only, seconds, 1 to 9 fraction digits (truncated to milliseconds), `Z`, `+05:30` and `-08:00` offsets (converted to an instant), a leap day `2024-02-29`, and `2026-12-31T23:59:59Z`.
3. **Rejected**, each giving `invalid Date "<p>": ...`:
   - `2026-02-30`, `2025-02-29`, `2026-13-01`, `2026-00-10`
   - `24:00`, `12:60`
   - a missing zone with a time
   - lowercase `t` and `z`
   - `2026-1-1`, `-000000-01-01`, `20260101`
   - an empty payload
   - out-of-range years beyond `Date` limits
   - `1`, which `new Date("1")` would accept
4. **Encode:** an invalid `Date` (`new Date(NaN)`) gives `expected Date, got invalid Date`. Encode also rejects a string and a number.
5. **Round trip:** `parse(stringify(d))` equals `d` for sampled instants, and for the minimum and maximum instants of `Date`.

### test/types/object.test.ts (unit A)

1. Happy path: nested shapes, an empty shape `{}`, quoted keys, keyword keys (`null`, `true`), and keys `"__proto__"` and `"constructor"`, both decoded as own properties without polluting the prototype.
2. Output key order equals schema order, even when the input value has a different insertion order. The parse result's key order also equals schema order.
3. Unknown keys:
   - on encode, in `Object.keys` order, at the path of the key
   - on decode, at `keyPos`
   - symbol keys are ignored on encode
4. Missing required key: on encode with no position; on decode with the object's position.
5. Optional keys:
   - an absent key is omitted
   - an `undefined` value is omitted
   - parse never sets `undefined`
   - a required key present as `undefined` gives `expected number, got undefined` at the field path
6. Class instances are rejected with the constructor name, and so are arrays, `Map`, `null` and `Object.create(proto)`.
7. Names: `{}`, `{ a: number, "b c"?: string }`, nested objects, an object whose field is a union.

### test/types/tuple.test.ts (unit A)

1. `tuple(Number, String)` encode and decode. Empty tuple `[]`. Nested tuples. A tuple of objects.
2. Length mismatch in both directions gives `expected 2 items, got 3`, with the list position on decode.
3. An error at a position carries the path `[1]`. A tagged list (`Set[...]`) is rejected for a tuple. A non-array is rejected.
4. Names: `[number, string]`, `[]`, `[number | string, Date]`.

### test/types/union.test.ts (unit A)

1. Declaration order wins:
   - `union(array(Number), tuple(Number, Number))` encodes through the first member
   - `union(Number, BigInt)` tells `1` from `1n`
   - `union(String, Date)` tells `"x"` from `Date(...)`
   - `union(array(String), set(String))` tells `[...]` from `Set[...]`
2. With `null`: `union(String, null)`.
3. Flattening: `union(union(A, B), C).name === "A | B | C"`.
4. Error selection:
   - an object member that fails deep gives that deep error, as in `union({a: Number}, String)` with `{a: "x"}` reporting `$.a`
   - when two members fail deep, the longer path wins, and on a tie the earlier member wins
   - when every member fails at the root, the result is `expected A | B, got ...` with the position
5. Non-`JSTNError` exceptions from a member, for example a user `match` that throws a `TypeError`, propagate unchanged.
6. Fewer than 2 members at runtime throws, including the case where the members are given from an array spread.
7. Names inside an array get parentheses: `(number | string)[]`. Unions inside `Set<...>`, tuples and object fields do not.

### test/types/collection.test.ts (unit A)

1. `array`:
   - empty, nested, and arrays of objects
   - a hole gives `$[0]: expected number, got undefined`
   - an error at index 2 has the path `[2]`
   - a tagged list is rejected
   - names: `number[]`, `number[][]`, `(number | string)[]`
2. `set`:
   - empty `Set[]`
   - insertion order is preserved
   - object items
   - a duplicate on decode gives `invalid Set<number>: duplicate item` with the position
   - two structurally equal objects are not duplicates
   - a non-Set is rejected
   - the name is `Set<number>`
3. `map`:
   - empty
   - string keys, object keys and `Date` keys
   - error paths `[i][0]` and `[i][1]`
   - a duplicate key on decode
   - a non-pair item gives `expected 2 items, got 1`
   - the name is `Map<string, number>`
4. Custom collection (`sortedSet`):
   - encode gives a `SortedSet` tag, and decode gives a `SortedSet` instance
   - the wrong tag is rejected
   - `fromItems` throwing gives `invalid SortedSet<number>: <msg>` with `cause`
   - `toItems` throwing gives `cannot stringify SortedSet<number>: <msg>`
   - the name is `SortedSet<number>`
5. `createCollection`:
   - a reserved name or a non-identifier name gives `invalid type name`
   - a class name gives the tag and an `instanceof` match: `Bag<number>` writes `Bag[1,2]`, and a plain array gives `expected Bag<number>, got array`
   - an explicit `match` overrides the class default
   - an anonymous class gives `invalid type name ""`
   - a string name with no `match`, forced through a cast, gives `"Bag" needs a match function`
   - an `items` array gives tuple items and the name `Pairs<string, number>`, and a short item gives `expected 2 items, got 1`
   - a fixed collection with object items has the name `Bag<{ a: number }>` and needs no wrapper

### test/core/standard.test.ts (unit A)

1. `JSTN.schema(...)["~standard"]` has `version: 1` and `vendor: "jstn"`, and it is frozen.
2. On success, `validate` returns `{ value }` with the input value itself, and `issues` is undefined.
3. One `it.each` table checks that a failure returns exactly one issue, `{ message, path }`, for a nested key, an array index, a quoted key, a tuple slot, a map entry (`[0, 1]`), a missing key, an unknown key, the root, a union, a custom type and a custom collection.
4. A throwing custom `stringify` is reported as an issue: `cannot stringify Money: boom`.
5. `validate` agrees with `JSTN.is` on matching and non-matching values.

### test/infer.test-d.ts (unit A)

This file is checked by `tsc --noEmit`. It contains no comments and no `@ts-expect-error`.

1. `Infer` of every built-in and shorthand: number, string, boolean, bigint, `Date`, `null`.
2. Shapes:
   - nested literals
   - optional keys become `k?: T | undefined`, verified with `toEqualTypeOf` against a written-out type
   - quoted keys
   - `readonly` is removed
   - the empty shape gives `Record<string, never>`
3. `tuple` gives a mutable tuple type, and `tuple()` gives `[]`.
4. `union` gives a union type, including object members and `null`.
5. `set`, `map` and nested generics: `map(String, set(array(Date)))`.
6. `createType` infers `T` from the class, a type-guard `match` and `parse`:
   - `{ name: "Num", match: (v) => typeof v === "number", parse: Number, stringify: String }` gives `Type<number>`
   - a class `name` with no `match`, or with a compound `match`, gives `Type<Point>`
   - a string name with a type-guard `match` and `stringify` written before `parse` gives `Type<Point>`
   - a compound boolean `match` with `parse: Number` gives `Type<number>`
   - the explicit form `createType<Money>` also works
7. `createCollection`:
   - `sortedSet(Number)` gives `Type<SortedSet<number>>`, and `sortedSet({ a: String })` gives `Type<SortedSet<{ a: string }>>`
   - a generic wrapper with `items: [key, value]` gives `Type<[string, number][]>`
   - generic wrappers with object items, with one and two type parameters, give `Type<Box<{ key: string; value: number }>>` and `Type<Box<{ value: Date }>>` with no annotations in the spec
   - fixed collections give `Type<Box<number>>` and `Type<[string, boolean][]>`
8. The full schema `S` from fixtures matches its full expected type exactly.
9. `JSTN.parse` returns `Infer<S>`. `JSTN.parseSchema` returns `Type<unknown>`, so parsing with it returns `unknown`. `JSTN.is` narrows, and narrows `{ a?: number | undefined }` for an optional field. `JSTN.validate` returns `Infer<S>`.
10. `stringify` accepts an optional field typed `T | undefined`, readonly arrays, readonly tuples, `as const` data, and a value typed `Infer<S>` inside a generic function.
11. Negative facts, written as assignability checks:
    - `expectTypeOf<Optional<number> extends Schema ? true : false>().toEqualTypeOf<false>()`
    - the same check for `MapConstructor`, `SetConstructor`, `ArrayConstructor` and `ObjectConstructor`
    - `expectTypeOf<[Schema] extends Parameters<typeof union> ? true : false>().toEqualTypeOf<false>()`
    - `expectTypeOf<Expected>().toExtend<Parameters<typeof JSTN.stringify<typeof S>>[0]>()`
    - `Type<number>` is assignable to `Type<number | string>`, which shows covariance
12. Standard Schema: the test writes its own copy of the official `StandardSchemaV1` interface and an `InferOutput` helper. `S`, a `JSTN.schema` with an optional `set`, `sortedSet(Date)` and `number` are all accepted, and their output types equal the expected types.

### test/compile-errors.test.ts

Type tests cannot assert a compile error without `@ts-expect-error`, which is a comment. This file writes each snippet to a temporary project that extends `tsconfig.json`, runs `tsc --noEmit` once, and checks that every error falls on the snippet's line. The snippets are an inferred `JSTN.stringify` with a wrong field, array item or `Set` item, `JSTN.stringify("x", {})` and `JSTN.stringify({ a: 1 }, {})`, and these definitions:

- a `createType` whose `stringify` does not take the `parse` result
- a `createType` with a string name and no `match`
- a `createType` whose `parse` disagrees with its `match` guard
- a `createType` whose `parse` disagrees with its class
- a `createCollection` with a string name and no `match`
- a `createCollection` whose `toItems` yields the wrong items
- a `createCollection` whose `fromItems` ignores the item type

A matching `stringify` call is the control and must compile.

### test/syntax/read-data.test.ts (unit B)

1. Every literal maps to the expected Node:
   - `null`, `true`, `false`, `NaN`, `Infinity`, `-Infinity`, `-0`
   - numbers, bigints and strings in both quote styles
2. **Objects:**
   - empty `{}`
   - bare, quoted and keyword keys (`{null: 1, true: 2, NaN: 3}`)
   - a quoted key containing whitespace, unicode and an empty string
   - trailing commas
   - comments in every gap
3. **Lists:** empty, nested, trailing commas, and `[,]` rejected.
4. **Tagged values:**
   - `Date(2026-01-01T14:00:00Z)` and `Money(12.50 GBP)`
   - quoted payloads, empty payloads, payloads containing `//`
   - `Set[1, 2]`, `Map[["a", 1]]`, `Set[]`
   - `Foo[...]` with a custom tag
5. Tag errors:
   - `Date (x)`, `Set [1]` and `Point{}` give the adjacency error
   - `true(1)` gives `unexpected "("`
   - a bare tag with no bracket is rejected
6. Positions: `pos` and `keyPos` are accurate on multi-line input with CRLF and tabs.
7. Syntax errors, each with the exact message, path and position:
   - a missing comma between entries
   - a missing colon
   - a double comma
   - an unclosed `{` or `[`
   - a stray `}`
   - an empty document
   - trailing garbage after the value
   - `|` in value position
   - an unterminated string inside a nested path, which reports that path
8. A duplicate key gives `$.a: duplicate key` at the second key.
9. Depth: 512 levels are accepted, and 513 give `nesting deeper than 512 levels`.
10. Every `JSON.stringify` output of fixed sample values is accepted.
11. The user's data sample from the request, with the missing comma restored, parses.

### test/syntax/write-data.test.ts (unit B)

Golden strings are written inline with `toBe`.

1. **Scalars:**
   - `-0`, `NaN`, `Infinity`, `-Infinity`, `1e+21`, `5e-324`
   - bigint, including negative values
   - string escapes, written through `quote`
   - tagged payloads: raw versus quoted for each `isRawPayload` boundary
2. **Keys:** identifiers bare; spaces, digits first, empty and unicode keys quoted.
3. **Compact output** for nested objects, lists, tagged lists, `Map` pairs and empty containers.
4. **`space`** equivalence classes:
   - `undefined`, `0`, `-1`, `""`, `0.5`, `{}`, `null`: all compact
   - `2`; `2.9`, which is treated as `2`
   - `11` and `100`, both clamped to 10
   - `"\t"`
   - `"--"`
   - a 12-character string, cut to 10
5. **Pretty output:**
   - all-scalar lists inline, including lists of tagged scalars
   - a list containing a list or an object expands
   - the `Map` pair form from §2.3
   - objects always expand
   - trailing commas present
   - no final newline
   - empty containers inline
   - three-level indentation
6. The user's request sample: writing its Node gives exactly the §2.3 shape.

### test/syntax/syntax.property.test.ts (unit B)

1. For arbitrary Nodes, `readData(writeData(n, space))` equals `n` with positions stripped. This holds for `space` in `[undefined, 2, "\t"]`. The Nodes include full-Unicode strings, arbitrary payloads and keys, and tags drawn from identifiers outside the reserved set.
2. Compact and pretty output of the same Node read back to equal Nodes.
3. For any `fc.json()` text, `readData` succeeds, and the result corresponds to `JSON.parse`. Arbitrary JSON values have no duplicate keys.
4. For `fc.string()`, and for valid documents with a random character inserted or deleted, `readData` either returns or throws `JSTNError`. Every thrown error has `line` and `column` within the input's bounds.

### test/syntax/read-schema.test.ts (unit C)

1. **Every production:**
   - each built-in name
   - `T[]` and `T[][]`
   - tuples, including the empty tuple
   - objects, including empty ones, with `?:`, quoted keys and trailing commas
   - parentheses
   - a leading `|`
   - comments and newlines everywhere
2. **Precedence:** `number | string[]` is not the same as `(number | string)[]`. Check with `.name` and with behaviour.
3. **Generics:** `Set<number>`, `Map<string, Set<Date>>` (with `>>`), trailing commas in the argument list.
4. **Registry:**
   - a bare `Type`
   - a shorthand constructor
   - an object shape
   - `null`
   - a collection factory with arguments
   - a function with no declared parameters is rejected before reading
   - a factory that does not return a `Type` fails at its name token
5. Every error in the §4.3 table, with exact messages and positions.
6. The text schema and the builder schema behave identically. They have equal `.name`, and `stringify` gives the same output on `sampleValue`.
7. Number, string and bigint tokens in type position are rejected. Depth 513 is rejected.

### test/api.test.ts (unit C)

1. The user's three call forms: `JSTN.stringify(v, s)`, `JSTN.stringify(v, s, 2)` and `JSTN.parse(text, s)`. These run against the full schema `S` and against the request's sample data, with commas fixed.
2. `parse` and `stringify` accept inline literal schemas, constructor shorthands, and `null`.
3. `validate` returns the same reference and throws on a mismatch. `is` returns true or false, and rethrows non-`JSTNError` exceptions.
4. `parseSchema` with the fixture registry, followed by parse and stringify.
5. `stringify` throws on a mismatch, and the error has no position.
6. Deep nesting: a 200-level nested array schema and value round-trip. For arrays, tuples and objects, 512 levels stringify and parse back, and 513 levels fail `stringify` and `validate` with `nesting deeper than 512 levels` while `is` returns `false`. At 20000 levels `is` returns `false` instead of overflowing the stack.

### test/errors.test.ts (unit C)

This file is one `it.each` table with columns `[name, run: () => unknown, message, path, line, column]`. It contains every example message in §5.4, plus at least one row per distinct reason string in the codebase:

- each syntax reason
- each schema-text reason
- each encode reason and each decode reason
- user-callback wraps

Every row asserts `instanceof JSTNError`, plus `message`, `reason`, `path`, `line` and `column`.

### test/laws.property.test.ts (unit C)

`arbitraries.ts` defines `typeAndValue = fc.letrec(...)`, which yields `{ type: Type<unknown>, value: Arbitrary<unknown> }` with a depth limit of 4.

- **Leaves:** each scalar (numbers with `-0`, `NaN` and `Infinity`; strings with lone surrogates), null, date (`fc.date({ noInvalidDate: true })`), `money` and `note`.
- **Containers:** array, tuple (0–4 items), set, map, object (0–5 keys, identifier and non-identifier, some optional), union (2–3 members), and sortedSet over numbers.
- Generated union values come from any member.

Properties, each with `numRuns` set to 300:

1. **Round trip:** `parse(stringify(v, t, space), t)` is `toStrictEqual(v)` for `space` in `[undefined, 2, "\t"]`.
2. **Canonical output:** with `s = stringify(v, t)`, `stringify(parse(s, t), t) === s`.
3. **Name law:** `parseSchema(t.name, { types: registry }).name === t.name`.
4. **Total parse:** for `fc.string()` and mutated canonical outputs, `parse(text, t)` returns or throws `JSTNError`, and nothing else.
5. **Agreement:** for an arbitrary value and an arbitrary second schema, `is(v, t2) === (stringify does not throw)`. `is(parse(...), t)` is always true.
6. **Validate:** a generated value is accepted. Replacing a leaf with a value of a different kind is rejected, and the error path points at that leaf. This is done with a path-aware mutation in `arbitraries.ts`.

### test/docs.test.ts (unit C)

1. The test extracts the fenced blocks from `README.md` and every `docs/*.md` file, which it locates relative to the test file, not the working directory.
2. Every ```` ```jstn-schema ```` block, and every hidden `<!-- jstn-schema ... -->` comment, parses with the fixture registry plus a `URL` type.
3. Every ```` ```jstn ```` block parses against the nearest preceding schema in the same file, and `parse(stringify(parse(x)))` is stable. A single-line block must equal the compact `stringify` output exactly.
4. Every ```` ```ts ```` block is written to a temporary project that maps `jstn` to `src/index.ts` and adds the `dom` lib, and `tsc` must report no errors in it. A ```` ```ts nocheck ```` block is skipped.
5. Grammar listings and invalid examples use ```` ```ebnf ```` or ```` ```text ````, so they are not executed. Only `ts`, `jstn`, `jstn-schema`, `ebnf`, `text` and `sh` fences are allowed.

---

## 9. Documentation outline (unit C)

`README.md` is a getting-started guide and API reference. It explains little and links to `docs/` for details:

1. A one-paragraph pitch and a data sample.
2. Getting started: install from GitHub, requirements, a quick start, and an example error.
3. A cheat sheet: TypeScript schema, schema text and data for every type.
4. Practical examples: a config file, HTTP with dates and bigints, localStorage, untrusted input, custom types, custom collections, text schemas, and Standard Schema.
5. API reference: one short entry per export.
6. Links to the docs and the licence.

`docs/` holds the technical detail:

- `data-format.md`: syntax, payload quoting, output rules and limits.
- `schema-language.md`: schema text rules, the registry, static types and the name law.
- `validation.md`: schemas, strict objects, unions, `is` narrowing, `createType` and `createCollection` inference, errors and paths, and Standard Schema.
- `grammar.md`: the reference grammars in EBNF (§4.1–4.3) and the details that apply on top.

---

## 10. Implementation units

Order: **Foundation**, then **A**, **B** and **C** in parallel. The files owned by different units are disjoint. A and B depend only on the foundation. C's source compiles against the foundation stubs, but its tests need A and B merged, so C runs its tests last.

### Foundation

It owns these files:

- `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- `src/core/strings.ts`, `src/core/type.ts`, `src/core/standard.ts`, `src/core/error.ts` and `src/syntax/lexer.ts`, all fully implemented
- `src/jstn.ts` and `src/index.ts`, fully implemented as glue
- stubs with final signatures for every other `src` file
- `test/support/fixtures.ts`

**Stub rule.** Every exported function has its exact §2 or §6 signature and a body of `throw new Error("not implemented")`. Every exported constant (`number`, `string`, `boolean`, `bigint`, `date`, `nullType`) must not throw at import time:

- Type constants are `defineType(name, fail, fail)`, where `fail` throws.
- The functions `set`, `map`, `createType` and `createCollection` return such stub types instead of throwing, because the fixtures call them at import time.

This lets the fixtures module load.

Tests that must pass: `test/core/strings.test.ts`, `test/core/error.test.ts` and `test/syntax/lexer.test.ts`. `npm run check` must also pass with the stubs.

### Unit A: Types

It owns `src/core/schema.ts`, `src/types/scalars.ts`, `src/types/custom.ts`, `src/types/date.ts`, `src/types/object.ts`, `src/types/tuple.ts`, `src/types/union.ts` and `src/types/collection.ts`.

Tests that must pass: `test/core/schema.test.ts`, `test/core/standard.test.ts`, every file in `test/types/*.test.ts`, and `test/infer.test-d.ts` (through `npm run check`). These tests use `Type.encode` and `Type.decode` on Node literals plus `JSTN.validate` and `JSTN.is`. Round trips through text belong to unit C. Tests in A that need text (custom payload quoting, date round trip) are written against `JSTN.parse` and `JSTN.stringify`. They fail until B is merged, and they must pass once all units are merged.

### Unit B: Data syntax

It owns `src/syntax/read-data.ts` and `src/syntax/write-data.ts`.

Tests that must pass: `test/syntax/read-data.test.ts`, `test/syntax/write-data.test.ts` and `test/syntax/syntax.property.test.ts`. They depend only on the foundation: Node, JSTNError and the lexer.

### Unit C: Schema text, integration and docs

It owns `src/syntax/read-schema.ts`, `README.md`, `test/support/arbitraries.ts`, `test/syntax/read-schema.test.ts`, `test/api.test.ts`, `test/errors.test.ts`, `test/laws.property.test.ts` and `test/docs.test.ts`, plus `docs/`.

Its tests must pass after A and B are merged. C is also responsible for the final `npm test` passing with everything merged.

### Definition of done

- `npm test` (`tsc --noEmit && vitest run`) passes.
- `npm run build` emits `dist/` with `.d.ts` files.
- No file contains a comment, and no file exceeds 300 lines.
- `grep -rn "not implemented" src` is empty.
