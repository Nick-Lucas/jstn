# JSTN

JSTN (JavaScript Type Notation) has two parts. Schemas are structure-only validators that check values at runtime and type them at build time. The data format looks like JavaScript literals, and `JSTN.parse` and `JSTN.stringify` validate against a schema in both directions. The API mirrors `JSON`, with a schema in place of the second argument.

```ts
import { JSTN, array, optional } from "jstn"
import type { Infer } from "jstn"

const User = JSTN.schema({ id: BigInt, name: String, joined: Date, tags: array(String), bio: optional(String) })
type User = Infer<typeof User>

const text = JSTN.stringify({ id: 1n, name: "Ada", joined: new Date(), tags: [] }, User, 2)
const user: User = JSTN.parse(text, User)
JSTN.is(input, User)
```

## Write data like JavaScript literals

This schema and document show every data feature:

```jstn-schema
{
  name: string,
  "display name": string,
  count: number,
  ratio: number,
  offset: number,
  big: bigint,
  created: Date,
  tags: Set<string>,
  scores: Map<string, number>,
  price: Money,
  note: Note,
  ranks: SortedSet<number>,
}
```

```jstn
// Line comments and /* block comments */ may appear between any two tokens.
{
  name: "Ada",
  "display name": 'Ada L.',
  count: 3,
  ratio: NaN,
  offset: -0,
  big: 123n,
  created: Date(2026-01-01T14:00:00Z),
  tags: Set["a", "b"],
  scores: Map[["x", 1], ["y", 2]],
  price: Money(12.50 GBP),
  note: Note(" padded, with (parens) "),
  ranks: SortedSet[1, 2, 3],
}
```

- Keys are identifiers or quoted strings. Strings use either quote style. Commas between entries are required, and a trailing comma is allowed.
- Numbers include `NaN`, `Infinity`, `-Infinity` and `-0`. A trailing `n` makes a bigint. Hex, octal, binary and numeric separators are not supported.
- A tag followed directly by `(` holds a text payload, such as `Date(...)` or `Money(...)`. A payload that contains `(`, `)`, quotes, a backslash, a control character, or leading or trailing spaces must be quoted.
- A tag followed directly by `[` holds a tagged list, such as `Set[...]`, `Map[[k, v], ...]` or a custom collection. No space is allowed between the tag and the bracket.
- Every `JSON.stringify` output is valid data, except that duplicate keys are rejected.

## Build schemas in TypeScript

A `Schema` is one of these:

- a `Type`: `number`, `string`, `boolean`, `bigint`, `date`, or a type returned by a builder
- a shorthand: `Number`, `String`, `Boolean`, `BigInt`, `Date`, or `null`
- a plain object literal whose values are schemas or `optional(schema)`

The builders are `array(item)`, `tuple(...items)`, `union(a, b, ...rest)`, `set(item)`, `map(key, value)`, `optional(schema)`, `createType(spec)` and `createCollection(spec)`. `JSTN.schema(schema)` returns the normalised `Type`, and `Infer<typeof T>` gives its TypeScript type. `Array`, `Set`, `Map` and `Object` are compile errors and throw at runtime with a hint such as `$: not a schema: Array (use array(...))`.

Object types are strict. An unknown key fails with `unknown key` in both directions. An `optional(...)` field may be absent, and `stringify` omits a field whose value is `undefined`, so its inferred type is `k?: T | undefined`. `parse` never produces `undefined`. A required field that holds `undefined` fails. `optional()` is valid only as an object field. The empty shape `{}` infers `Record<string, never>`, because it accepts only an object with no keys.

`stringify` also accepts readonly arrays and tuples, at any depth, so `as const` data and frozen arrays type-check. `parse` and `validate` return mutable types.

A union tries its members in declaration order, and the first member that succeeds wins. Put the narrower member first. Tags remove most ambiguity, because `1` and `1n`, `[...]` and `Set[...]`, and `"..."` and `Date(...)` are different nodes. When every member fails, the error with the deepest path is reported. If no member got past the union itself, the error is `expected A | B, got ...`.

## Write schemas as text

`JSTN.parseSchema(text, { types })` reads the jstn-schema language and returns the same `Type` objects the builders return. Its result is `Type<unknown>`.

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

- `T[]` binds tighter than `|`, so `number | string[]` is not `(number | string)[]`. A leading `|` is allowed.
- `[]` is the empty tuple, `{}` is the empty object, and `"k"?: T` is an optional field.
- The built-in names are `number`, `string`, `boolean`, `bigint`, `null`, `Date`, `Set` and `Map`.
- `options.types` adds names. A schema is used as a bare name. A function that is not a shorthand is a collection factory, written with exactly as many type arguments as it declares parameters, as in `SortedSet<number>`. A function with no declared parameters fails with `"Foo" is not a schema or collection`, and a factory that does not return a `Type` fails where it is used.
- A registry key must be an identifier that is not `true`, `false`, `NaN` or `Infinity`, and it cannot be a built-in name.
- Every `Type.name` is canonical schema text, and `parseSchema(t.name, { types }).name === t.name`. The exceptions are a `createType` or `createCollection` named `Date`, `Set` or `Map`, because the text name resolves to the built-in, and a collection with a fixed item schema registered as a bare name.

## Define custom types and collections

`createType` makes a tagged scalar. `parse` receives the payload text and `stringify` returns it. The writer quotes the payload when needed, so your code never escapes anything.

`name` is the tag. It is either a string, which needs a `match` function, or a class, whose `name` becomes the tag. With a class, `match` is optional and defaults to `value instanceof Class`.

```ts
const money = createType({
  name: Money,
  parse: (text) => {
    const m = /^(-?\d+(?:\.\d+)?) ([A-Z]{3})$/.exec(text)
    if (!m) throw new Error("expected \"<amount> <CCY>\"")
    return new Money(m[1]!, m[2]!)
  },
  stringify: (m) => `${m.amount} ${m.currency}`,
})

const cents = createType({ name: "Cents", match: (v) => typeof v === "bigint", parse: BigInt, stringify: String })
```

You never write the type yourself. TypeScript takes `T` from the class, from `match` when it is a type guard, and from `parse`. A simple check such as `(v) => v instanceof Money` or `(v) => typeof v === "bigint"` is a type guard automatically. A compound check such as `(v) => v instanceof Date && !Number.isNaN(v.getTime())` is not, so `T` then comes from the class or from `parse`. If these sources disagree, the call does not compile. `stringify` never contributes to `T`.

`createCollection` makes a tagged list type. It takes the same `name` and `match` as `createType`, plus `items`, `fromItems` and `toItems`. `items` is the schema of each item. `fromItems` builds the collection from the decoded items, and `toItems` lists them for encoding. The collection type comes from what `fromItems` returns, so write `fromItems` before `toItems`.

To make a generic collection, wrap `createCollection` in a generic function. TypeScript cannot apply a generic class such as `SortedSet` to a type argument by itself, so the function's type parameter carries the item type. Nothing inside the spec needs a type annotation.

```ts
const sortedSet = <S extends Schema>(item: S) => createCollection({
  name: SortedSet,
  items: item,
  fromItems: (items) => new SortedSet(items),
  toItems: (v) => v.items,
})
```

Pass an array as `items` to give a collection several type arguments. Each item is then a tuple, and the name lists every argument, as in `Map<string, number>`. `set` and `map` are built exactly this way.

```ts
const pairs = <K extends Schema, V extends Schema>(key: K, value: V) => createCollection({
  name: "Pairs",
  items: [key, value],
  match: Array.isArray,
  fromItems: (items) => items,
  toItems: (v) => v,
})
```

A collection with a fixed item schema needs no wrapper: `createCollection({ name: Bag, items: Number, fromItems, toItems })` is a `Type<Bag>`. Register the wrapper function, not one of its results, when you use a generic collection in schema text: `{ types: { SortedSet: sortedSet } }`.

A name must be an identifier other than `true`, `false`, `null`, `NaN`, `Infinity`, `number`, `string`, `boolean` and `bigint`. An anonymous class therefore fails. Errors thrown by `parse`, `stringify`, `toItems` and `fromItems` are wrapped in a `JSTNError` that keeps the original as `cause`.

## Use with Standard Schema

Every `Type`, including the result of `JSTN.schema`, implements [Standard Schema](https://standardschema.dev) v1. Any library that accepts a Standard Schema, such as a form library or a router, can use a JSTN schema directly.

```ts
const User = JSTN.schema({ name: String, tags: array(String) })
User["~standard"].validate({ name: "Ada", tags: ["x", 1] })
```

`validate` is synchronous and its vendor is `"jstn"`. On success it returns `{ value }`, with the input value itself. On failure it returns one issue, `{ issues: [{ message, path }] }`, where `message` is the error's `reason` and `path` is its `segments`, such as `["tags", 1]`. The inferred output type is `Infer<typeof User>`. The `StandardSchemaV1` types are exported, so you need no extra dependency.

## Validate without serialising

`JSTN.validate(value, schema)` returns the same value typed as `Infer<S>`, or throws a `JSTNError`. `JSTN.is(value, schema)` returns `true` exactly when `validate` would not throw, and it narrows the type. Errors that are not `JSTNError` propagate from both.

Trust the `true` branch of `is` only. TypeScript also narrows the `false` branch, but the runtime check is stricter than the static type. An invalid `Date`, an object with an extra key, and a class instance checked against an object shape all fail `is`, yet TypeScript still gives them the type you checked against. In `if (JSTN.is(d, Date)) ... else ...` with `d: Date | string`, the `else` branch can still hold a `Date`.

## Read errors

The library throws only `JSTNError`. Its fields are `reason`, `path`, `segments`, `line` and `column`. `path` is the formatted path such as `$.someArr[2]`, and `segments` holds the same path as an array such as `["someArr", 2]`. Its `message` is `${path}: ${reason}`, followed by ` (line L, column C)` when a position is known. Errors from `parse` and `parseSchema` have a position. Errors from `stringify`, `validate` and `is` do not.

```text
$.someArr[2]: expected number, got string "x" (line 6, column 16)
$.someObj: missing required key "inner" (line 4, column 12)
$.d: expected "(" or "[" immediately after tag "Date" (line 1, column 5)
$.price: invalid Money "abc": expected "<amount> <CCY>" (line 2, column 10)
$: unknown type "User" (line 3, column 10)
```

Paths start at `$`. Identifier keys are written `.key`, other keys `["key"]`, and indexes `[i]`. Map entries use `[i][0]` for the key and `[i][1]` for the value. Lines and columns start at 1, and columns count UTF-16 code units. A byte order mark at the start is skipped and takes no column.

## Output rules

`space` works like the third argument of `JSON.stringify`. A number is floored and clamped to 0 through 10. A string is cut to 10 characters. Any other value, `0` or `""` gives compact output. Compact output has no whitespace and no trailing commas. Pretty output has these rules:

- An object with entries always breaks one entry per line, with trailing commas.
- A list whose items are all scalars or tagged scalars stays on one line.
- Any other list breaks one item per line.
- There is no final newline. Object entries follow schema order, and `Set` and `Map` items follow insertion order.

With `space` set to `2`, a value for the text schema in the previous section is written like this:

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

A key is written bare when it is an identifier, including keywords such as `null`, and quoted otherwise. Strings are always written with double quotes. A payload is written raw when it is not empty, contains none of `( ) " ' \`, control characters or lone surrogates, and does not start or end with a space. Otherwise it is quoted, and lone surrogates are escaped as in strings. A date is written with `toISOString()`, with `.000Z` shortened to `Z`.

## Reference grammars

The notation is ISO EBNF. Trivia may appear between any two tokens, except at ⟨adj⟩.

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

These details apply on top of the grammars:

- A payload body is trimmed. A quoted payload must be one string and nothing else, so `X("a" b)` fails with `expected ")" after quoted payload`. Comments are not recognised inside a payload.
- Nesting deeper than 512 levels fails in both languages. Data counts lists and objects. Schema text counts `{`, `[`, `(` and `<`, and each `[]` suffix. `stringify`, `validate` and `is` apply the same limit to values, so `stringify` never writes data that `parse` rejects.
- In schema text, `>>` is two tokens. Number and bigint tokens are never valid, and string tokens are allowed only as keys. `Set<>` fails with `"Set" expects 1 type argument, got 0`.
- Schema text errors always have path `$`. Registry errors are raised before reading starts and have no position.

## Requirements

JSTN needs Node 26 or later and is ESM only. Consumers need TypeScript 5.5 or later, because `createType` relies on inferred type guards and `stringify` uses `NoInfer`. There are no runtime dependencies.
