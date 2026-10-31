# JSTN

JavaScript Type Notation: schemas plus a data format that looks like JavaScript literals.

- **Schemas** validate at runtime and infer TypeScript types at build time.
- **Data** keeps the types JSON loses, such as `Date`, `bigint`, `Set`, `Map` and your own classes.
- **The API** works like `JSON`, with a schema as the second argument.

<!-- jstn-schema { id: bigint, name: string, joined: date, roles: set(string), manager: union(string, null) } -->

```jstn
{
  id: 9007199254740993n,
  name: "Ada",
  joined: Date(2026-01-01T14:00:00Z),
  roles: Set["admin", "dev"],
  manager: null,
}
```

## Getting started

JSTN is not published to npm yet. Install it from GitHub:

```sh
npm install github:Nick-Lucas/jstn
```

It needs Node 26 or later and TypeScript 5.5 or later, and it is ESM only. It has no runtime dependencies.

```ts
import { JSTN, set, union } from "jstn"
import type { Infer } from "jstn"

const User = JSTN.schema({
  id: BigInt,
  name: String,
  joined: Date,
  roles: set(String),
  manager: union(String, null),
})

type User = Infer<typeof User>

const ada: User = {
  id: 9007199254740993n,
  name: "Ada",
  joined: new Date("2026-01-01T14:00:00Z"),
  roles: new Set(["admin", "dev"]),
  manager: null,
}

const text = JSTN.stringify(ada, User, 2)
const copy = JSTN.parse(text, User)
copy.joined.getFullYear()
```

`stringify` and `parse` both validate. A value that does not match the schema throws a `JSTNError` that says where it failed:

```text
$.roles[1]: expected string, got number 2 (line 5, column 23)
```

## Cheat sheet

A schema is written the same way in TypeScript and as text.

| Schema | Data |
|---|---|
| `number` | `1`, `-0`, `NaN`, `Infinity` |
| `string` | `"a"` or `'a'` |
| `boolean` | `true` |
| `bigint` | `123n` |
| `null` | `null` |
| `date` | `Date(2026-01-01T14:00:00Z)` |
| `{ a: number }` | `{ a: 1 }` |
| `{ "b c": optional(number) }` | `{}` or `{ "b c": 1 }` |
| `array(number)` | `[1, 2]` |
| `tuple(number, string)` | `[1, "a"]` |
| `union(number, string)` | `1` or `"a"` |
| `set(string)` | `Set["a", "b"]` |
| `map(string, number)` | `Map[["a", 1]]` |
| `money`, from `createType` | `Money(12.50 GBP)` |
| `sortedSet(number)`, from `createCollection` | `SortedSet[1, 2]` |

`Number`, `String`, `Boolean`, `BigInt` and `Date` work as shorthands for the scalars. Data may contain `//` and `/* */` comments and trailing commas. Keys need quotes only when they are not identifiers.

## Examples

### Read a config file

```ts
import { JSTN, array, optional } from "jstn"

const Config = JSTN.schema({
  host: String,
  port: Number,
  allowedOrigins: array(String),
  timeoutMs: optional(Number),
})

const text = `{
  // Listen on every interface in production
  host: "0.0.0.0",
  port: 8080,
  allowedOrigins: [
    "https://example.com",
    "https://admin.example.com",
  ],
}`

const config = JSTN.parse(text, Config)
config.timeoutMs ?? 30_000
```

### Send dates and bigints over HTTP

```ts
import { JSTN, array } from "jstn"
import type { Infer } from "jstn"

const Order = JSTN.schema({
  id: BigInt,
  placedAt: Date,
  lines: array({ sku: String, quantity: Number }),
})

type Order = Infer<typeof Order>

async function saveOrder(order: Order): Promise<void> {
  await fetch("/orders", { method: "POST", body: JSTN.stringify(order, Order) })
}

async function loadOrder(id: bigint): Promise<Order> {
  const response = await fetch(`/orders/${id}`)
  return JSTN.parse(await response.text(), Order)
}
```

The request body is compact:

<!-- jstn-schema { id: bigint, placedAt: date, lines: array({ sku: string, quantity: number }) } -->

```jstn
{id:9007199254740993n,placedAt:Date(2026-10-31T09:30:00Z),lines:[{sku:"A-1",quantity:2}]}
```

### Save state to localStorage

```ts
import { JSTN, map, set } from "jstn"
import type { Infer } from "jstn"

const Prefs = JSTN.schema({
  favourites: set(String),
  lastOpened: map(String, Date),
})

function savePrefs(prefs: Infer<typeof Prefs>): void {
  localStorage.setItem("prefs", JSTN.stringify(prefs, Prefs))
}

function loadPrefs(): Infer<typeof Prefs> {
  const text = localStorage.getItem("prefs")
  return text === null ? { favourites: new Set(), lastOpened: new Map() } : JSTN.parse(text, Prefs)
}
```

### Check untrusted input

```ts
import { JSTN, JSTNError, optional } from "jstn"

const Signup = JSTN.schema({ email: String, age: optional(Number) })

function handleSignup(body: unknown): string {
  if (!JSTN.is(body, Signup)) return "invalid"
  return body.email
}

function requireSignup(body: unknown) {
  try {
    return JSTN.validate(body, Signup)
  } catch (error) {
    if (error instanceof JSTNError) throw new Error(`Bad signup at ${error.path}: ${error.reason}`)
    throw error
  }
}
```

### Add your own type

Pass a class as the `name`. The tag comes from the class name, and values are matched with `instanceof`.

```ts
import { JSTN, createType } from "jstn"

const url = createType({
  name: URL,
  parse: (text) => new URL(text),
  stringify: (u) => u.href,
})

const Link = JSTN.schema({ title: String, href: url })

JSTN.stringify({ title: "Docs", href: new URL("https://example.com/docs") }, Link)
```

<!-- jstn-schema { title: string, href: url } -->

```jstn
{title:"Docs",href:URL(https://example.com/docs)}
```

For values that are not class instances, give a string `name` and a `match` function:

```ts
import { createType } from "jstn"

const email = createType({
  name: "Email",
  match: (v) => typeof v === "string" && v.includes("@"),
  parse: (text) => {
    if (!text.includes("@")) throw new Error("expected an email address")
    return text
  },
  stringify: (address) => address,
})
```

Throw from `parse` to reject bad input. `JSTN.parse("Email(nope)", email)` fails with `$: invalid Email "nope": expected an email address (line 1, column 1)`.

### Add your own collection

Wrap `createCollection` in a generic function to make a collection that takes a type argument:

```ts
import { JSTN, createCollection } from "jstn"
import type { Schema } from "jstn"

class SortedSet<T> {
  readonly items: T[]
  constructor(items: Iterable<T>) {
    this.items = [...items].sort()
  }
}

const sortedSet = <S extends Schema>(item: S) => createCollection({
  name: SortedSet,
  items: item,
  fromItems: (items) => new SortedSet(items),
  toItems: (v) => v.items,
})

const Leaderboard = JSTN.schema({ scores: sortedSet(Number) })

JSTN.stringify({ scores: new SortedSet([3, 1, 2]) }, Leaderboard)
```

<!-- jstn-schema { scores: sortedSet(number) } -->

```jstn
{scores:SortedSet[1,2,3]}
```

### Store and share schemas as text

A schema's `name` is its source code. Save it, send it, read it back with `parseSchema`, or paste it into TypeScript:

```ts
import { JSTN, array, createType, optional, set } from "jstn"

const url = createType({ name: URL, parse: (text) => new URL(text), stringify: (u) => u.href })

const Bookmark = JSTN.schema({
  title: String,
  href: url,
  tags: set(String),
  visited: optional(array(Date)),
})

const text = Bookmark.name
const copy = JSTN.parseSchema(text, { types: { url } })

JSTN.parse(`{ title: "Docs", href: URL(https://example.com), tags: Set[] }`, copy)
```

`text` is `{ title: string, href: url, tags: set(string), visited: optional(array(date)) }`. Text schemas are checked at runtime only, so `parse` with `copy` returns `unknown`. See [docs/schema-language.md](docs/schema-language.md).

### Use with Standard Schema libraries

Every schema implements [Standard Schema](https://standardschema.dev), so it works with any library that accepts one.

```ts
import { JSTN, array } from "jstn"
import type { StandardSchemaV1 } from "jstn"

const Todo = JSTN.schema({ title: String, tags: array(String) })

function check<T>(schema: StandardSchemaV1<T>, input: unknown): T {
  const result = schema["~standard"].validate(input)
  if (result instanceof Promise) throw new Error("async schemas are not supported")
  if (result.issues) throw new Error(result.issues.map((issue) => issue.message).join("; "))
  return result.value
}

check(Todo, { title: "Ship it", tags: ["work"] })
```

## API

### `JSTN.stringify(value, schema, space?)`

Validates `value` and returns JSTN text. `space` works like the third argument of `JSON.stringify`. Throws `JSTNError`.

### `JSTN.parse(text, schema)`

Reads JSTN text, validates it, and returns a value typed by the schema. Throws `JSTNError` with a line and column.

### `JSTN.validate(value, schema)`

Returns `value` typed by the schema, or throws `JSTNError`.

### `JSTN.is(value, schema)`

Returns `true` when `value` matches and narrows its type. Trust only the `true` branch. See [docs/validation.md](docs/validation.md#jstnis-narrowing).

### `JSTN.schema(schema)`

Turns any schema, including shorthands and object literals, into a `Type`. Use it to name a schema once and reuse it. Its `name` is the schema as text, which you can paste back into TypeScript.

### `JSTN.parseSchema(text, { types? })`

Reads [schema text](docs/schema-language.md), which is the same syntax as a TypeScript schema, and returns a `Type<unknown>`. `types` registers custom types and collection factories by name, as in `{ types: { money, sortedSet } }`.

### Builders

| Builder | Makes |
|---|---|
| `number`, `string`, `boolean`, `bigint`, `date` | scalars, also written `Number`, `String`, `Boolean`, `BigInt`, `Date` |
| `array(item)` | `T[]` |
| `tuple(a, b, ...)` | `[A, B, ...]` |
| `union(a, b, ...)` | `A \| B \| ...`, tried in order |
| `set(item)` | `Set<T>` |
| `map(key, value)` | `Map<K, V>` |
| `optional(schema)` | an object field that may be absent |
| `{ ... }` | an object with exactly these keys |
| `null` | `null` |

### `createType({ name, match?, parse, stringify })`

Makes a tagged scalar, written `Name(payload)`.

- `name`: a class, or a string tag.
- `match(value)`: whether a value belongs to this type. Optional with a class, where it defaults to `instanceof`.
- `parse(text)`: builds a value from the payload text.
- `stringify(value)`: returns the payload text.

The TypeScript type is inferred from the class, `match` or `parse`. See [docs/validation.md](docs/validation.md#createtype-inference).

The type's `name` is the tag in camelCase, such as `money` for `Money`. Give the variable that name, so that schema text matches your code.

### `createCollection({ name, match?, items, fromItems, toItems })`

Makes a tagged list, written `Name[...]`.

- `name` and `match`: as for `createType`.
- `items`: the schema of each item, or an array of schemas for items that are tuples, as in `map`.
- `fromItems(items)`: builds the collection from decoded items. Write it before `toItems`.
- `toItems(value)`: returns the items to encode.

### `JSTNError`

The only error JSTN throws. Its fields are `reason`, `path` (such as `$.lines[0].sku`), `segments` (such as `["lines", 0, "sku"]`), `line` and `column`. See [docs/validation.md](docs/validation.md#errors).

### Types

- `Infer<typeof schema>`: the TypeScript type of a schema.
- `Type<T>`: a schema object, as returned by every builder.
- `Schema`: anything accepted where a schema is expected.
- `StandardSchemaV1`: the Standard Schema interface every `Type` implements.

## Documentation

- [Data format](docs/data-format.md): syntax, payloads and output rules.
- [Schema language](docs/schema-language.md): writing schemas as text and registering custom types.
- [Validation and types](docs/validation.md): objects, unions, type inference and errors.
- [Grammar](docs/grammar.md): the EBNF for both languages.

## License

MIT
