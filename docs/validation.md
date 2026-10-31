# Validation and types

How schemas check values, how TypeScript types are inferred, and what errors look like.

## Schemas

A `Schema` is one of these:

- a `Type`: `number`, `string`, `boolean`, `bigint`, `date`, or a type returned by a builder
- a shorthand: `Number`, `String`, `Boolean`, `BigInt`, `Date`, or `null`
- a plain object literal whose values are schemas or `optional(schema)`

`Array`, `Set`, `Map` and `Object` are compile errors. At runtime they throw with a hint such as `$: not a schema: Array (use array(...))`.

## Objects

- Objects are strict. An unknown key fails with `unknown key` in both directions.
- Only plain objects match an object schema. A class instance does not. Use `createType` or `createCollection` for classes.
- An `optional(...)` field may be absent. `stringify` omits a field whose value is `undefined`, so the inferred type is `k?: T | undefined`. `parse` never produces `undefined`.
- A required field that holds `undefined` fails.
- `optional()` is valid only as an object field.
- The empty shape `{}` infers `Record<string, never>`, because it accepts only an object with no keys.

## Readonly input

`stringify` accepts readonly arrays and tuples at any depth, so `as const` data and frozen arrays type-check. `parse` and `validate` return mutable types.

## Unions

A union tries its members in declaration order, and the first member that succeeds wins. Put the narrower member first.

Tags remove most ambiguity, because `1` and `1n`, `[...]` and `Set[...]`, and `"..."` and `Date(...)` are different nodes. When every member fails, the error with the deepest path is reported. If no member got past the union itself, the error is `expected A | B, got ...`.

## `JSTN.is` narrowing

Trust the `true` branch of `is` only. TypeScript also narrows the `false` branch, but the runtime check is stricter than the static type. An invalid `Date`, an object with an extra key, and a class instance checked against an object shape all fail `is`, yet TypeScript still gives them the type you checked against. In `if (JSTN.is(d, Date)) ... else ...` with `d: Date | string`, the `else` branch can still hold a `Date`.

## `createType` inference

TypeScript takes `T` from three places:

- the class, when `name` is a class
- `match`, when it is a type guard
- `parse`

If these disagree, the call does not compile. `stringify` never contributes to `T`, so property order does not matter.

A simple check such as `(v) => v instanceof Money` or `(v) => typeof v === "bigint"` is a type guard automatically. A compound check such as `(v) => v instanceof Date && !Number.isNaN(v.getTime())` is not, so `T` then comes from the class or from `parse`.

With a string `name`, `match` is required. With a class, `match` defaults to `value instanceof Class`.

## `createCollection` inference

The collection type comes from what `fromItems` returns, so write `fromItems` before `toItems`. Otherwise `toItems` sees `unknown`.

`match` cannot carry the item type: `v instanceof SortedSet` only tells TypeScript `SortedSet<any>`. TypeScript also cannot apply a generic class to a type argument by itself. So a generic collection is a generic function that calls `createCollection`, and the function's type parameter carries the item type into `fromItems` and `toItems`.

When `items` is an array, each item is a tuple and the collection takes one argument per element, as in `map(string, number)`.

## Names

A `createType` or `createCollection` name is the tag used in data, such as `Money` in `Money(12.50 GBP)`. It must be an identifier other than `true`, `false`, `null`, `NaN`, `Infinity`, `number`, `string`, `boolean` and `bigint`, and its camelCase form must not be one of those either. An anonymous class therefore fails.

The type's `name`, which schema text and error messages use, is the tag in camelCase: `Money` becomes `money`, `SortedSet` becomes `sortedSet`, and `URL` becomes `url`. Name the variable that holds the type the same way, so that schema text pastes into your code unchanged.

## Errors

The library throws only `JSTNError`:

| Field | Example |
|---|---|
| `message` | `$.someArr[2]: expected number, got string "x" (line 6, column 16)` |
| `reason` | `expected number, got string "x"` |
| `path` | `$.someArr[2]` |
| `segments` | `["someArr", 2]` |
| `line`, `column` | `6`, `16`, or `undefined` |

Errors from `parse` and `parseSchema` have a position. Errors from `stringify`, `validate` and `is` do not. Errors thrown by `parse`, `stringify`, `toItems` and `fromItems` in custom types are wrapped in a `JSTNError` that keeps the original as `cause`.

```text
$.someArr[2]: expected number, got string "x" (line 6, column 16)
$.someObj: missing required key "inner" (line 4, column 12)
$.d: expected "(" or "[" immediately after tag "Date" (line 1, column 5)
$.price: invalid money "abc": expected "<amount> <CCY>" (line 2, column 10)
$: unknown type "user" (line 3, column 10)
```

Paths start at `$`. Identifier keys are written `.key`, other keys `["key"]`, and indexes `[i]`. Map entries use `[i][0]` for the key and `[i][1]` for the value. Lines and columns start at 1, and columns count UTF-16 code units. A byte order mark at the start is skipped and takes no column.

## Standard Schema

Every `Type` has a `~standard` property that implements [Standard Schema](https://standardschema.dev) v1:

- `vendor` is `"jstn"` and `validate` is synchronous.
- On success it returns `{ value }`, where `value` is the input itself.
- On failure it returns one issue, `{ issues: [{ message, path }] }`. `message` is the error's `reason`, and `path` is its `segments`.
- The output type is `Infer<typeof schema>`.
