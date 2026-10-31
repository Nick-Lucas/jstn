# Schema language

`JSTN.parseSchema(text, { types })` reads jstn-schema text and returns the same `Type` objects the TypeScript builders return. The text looks like TypeScript types.

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

## Rules

- The built-in names are `number`, `string`, `boolean`, `bigint`, `null`, `Date`, `Set` and `Map`.
- `T[]` binds tighter than `|`, so `number | string[]` is not `(number | string)[]`. Use parentheses for an array of a union. A leading `|` is allowed.
- `[]` is the empty tuple, `{}` is the empty object, and `"k"?: T` is an optional field.
- `>>` is two tokens. Number and bigint tokens are never valid. String tokens are allowed only as keys.
- Errors always have path `$` and a line and column.

## Registering custom types

`options.types` adds names:

- A schema, such as a `createType` result, is used as a bare name: `Money`.
- A function is a collection factory. It is written with exactly as many type arguments as it declares parameters: `SortedSet<number>`.

```ts
import { JSTN, createCollection, createType } from "jstn"
import type { Schema } from "jstn"

class Money {
  readonly amount: string
  readonly currency: string
  constructor(amount: string, currency: string) {
    this.amount = amount
    this.currency = currency
  }
}

class SortedSet<T> {
  readonly items: T[]
  constructor(items: Iterable<T>) {
    this.items = [...items].sort()
  }
}

const money = createType({
  name: Money,
  parse: (text) => new Money(text.split(" ")[0] ?? "", text.split(" ")[1] ?? ""),
  stringify: (m) => `${m.amount} ${m.currency}`,
})

const sortedSet = <S extends Schema>(item: S) => createCollection({
  name: SortedSet,
  items: item,
  fromItems: (items) => new SortedSet(items),
  toItems: (v) => v.items,
})

const Product = JSTN.parseSchema("{ price: Money, sizes: SortedSet<number> }", {
  types: { Money: money, SortedSet: sortedSet },
})
```

Register the factory function itself, not one of its results.

- A registry key must be an identifier that is not `true`, `false`, `NaN` or `Infinity`, and it cannot redefine a built-in name.
- A function with no declared parameters fails with `"Foo" is not a schema or collection`. A factory that does not return a `Type` fails where it is used.
- Registry errors are raised before reading starts and have no position.

## Static types

`parseSchema` returns `Type<unknown>`, because the text is only known at runtime. `JSTN.parse` with that schema returns `unknown`. Use the TypeScript builders when you want static types.

## Names

Every `Type.name` is canonical schema text, and `parseSchema(t.name, { types }).name === t.name`:

```ts nocheck
JSTN.schema({ tags: set(String), lookup: map(String, array(Number)) }).name
// "{ tags: Set<string>, lookup: Map<string, number[]> }"
```

The exceptions are:

- a `createType` or `createCollection` named `Date`, `Set` or `Map`, because the text name resolves to the built-in
- a collection with a fixed item schema registered as a bare name

See [grammar.md](grammar.md) for the exact grammar.
