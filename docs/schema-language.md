# Schema language

Schema text is the TypeScript builder syntax. The same text works in two places:

- in TypeScript, as an expression that builds a schema
- as a string passed to `JSTN.parseSchema(text, { types })`

Every `Type.name` is written in this syntax, so you can paste a serialised schema into TypeScript unchanged.

```jstn-schema
{
  someNum: number,
  someStr: string,
  someDate: date,
  someObj: { inner: boolean },
  someArr: array(number),
  someTuple: tuple(number, string),
  someUnion: union(number, string),
  customVal: money,
  big: bigint,
  tags: set(string),
  lookup: map(string, { a: number }),
  scores: sortedSet(number),
  nothing: null,
  "key with space": optional(string),
}
```

## Built-in names

| Name | Arguments |
|---|---|
| `number`, `string`, `boolean`, `bigint`, `date`, `null` | none |
| `Number`, `String`, `Boolean`, `BigInt`, `Date` | none: the shorthands for the names above |
| `array`, `set` | 1 |
| `map` | 2 |
| `tuple` | any number, including none |
| `union` | 2 or more |
| `optional` | 1, and only as the value of an object field |

## Rules

- A builder must be called, as in `array(number)`, and a type must not be: `number()` is an error.
- Calls and objects allow trailing commas. Whitespace and comments are allowed between any two tokens.
- Object keys are identifiers or double- or single-quoted strings.
- Errors always have path `$` and a line and column.

## Registering custom types

`options.types` adds names. Use the same variable names as your code, and the object shorthand registers them in one step:

- A `Type`, such as a `createType` result, is used as a bare name: `money`.
- A function is a collection factory. It is called with exactly as many arguments as it declares parameters: `sortedSet(number)`.

```ts
import { JSTN, createCollection, createType, number } from "jstn"
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

const text = "{ price: money, sizes: sortedSet(number) }"

const fromText = JSTN.parseSchema(text, { types: { money, sortedSet } })
const fromCode = JSTN.schema({ price: money, sizes: sortedSet(number) })
fromText.name === fromCode.name
```

- A registry key must be an identifier that is not `true`, `false`, `NaN` or `Infinity`, and it cannot redefine a built-in name.
- A function with no declared parameters fails with `"foo" is not a schema or collection`. A factory that does not return a `Type` fails where it is used.
- Registry errors are raised before reading starts and have no position.

## Names

A custom type's name is its data tag in camelCase: `Money` becomes `money` and `SortedSet` becomes `sortedSet`. Name your variables the same way, and the round trip holds in both directions:

```ts nocheck
JSTN.schema({ tags: set(String), lookup: map(String, array(Number)) }).name
// "{ tags: set(string), lookup: map(string, array(number)) }"
```

`parseSchema(t.name, { types }).name === t.name` for every type. The exceptions are:

- a custom type whose camelCase name matches a built-in, such as a `createType` tagged `Date`, because the text resolves to the built-in
- a collection with a fixed item schema registered as a bare name
- an object field named `__proto__`, because a JavaScript object literal treats that key as the prototype

## Static types

`parseSchema` returns `Type<unknown>`, because the text is only known at runtime. `JSTN.parse` with that schema returns `unknown`. Paste the text into your code when you want static types.

See [grammar.md](grammar.md) for the exact grammar.
