# Data format

JSTN data looks like JavaScript literals. This schema and document use every data feature:

```jstn-schema
{
  name: string,
  "display name": string,
  count: number,
  ratio: number,
  offset: number,
  big: bigint,
  created: date,
  tags: set(string),
  scores: map(string, number),
  price: money,
  note: note,
  ranks: sortedSet(number),
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

## Syntax

- Keys are identifiers or quoted strings. Strings use either quote style.
- Commas between entries are required, and a trailing comma is allowed.
- Numbers include `NaN`, `Infinity`, `-Infinity` and `-0`. A trailing `n` makes a bigint. Hex, octal, binary and numeric separators are not supported.
- A tag followed directly by `(` holds a text payload, such as `Date(...)` or `Money(...)`.
- A tag followed directly by `[` holds a tagged list, such as `Set[...]`, `Map[[k, v], ...]` or a custom collection. No space is allowed between the tag and the bracket.
- Every `JSON.stringify` output is valid data, except that duplicate keys are rejected.

## Payloads

A payload is the text inside `Tag(...)`. It is written raw when all of these hold:

- it is not empty
- it contains none of `( ) " ' \`, control characters or lone surrogates
- it does not start or end with a space

Otherwise it is quoted like a string, as in `Note(" padded ")`, and lone surrogates are escaped. A raw payload is trimmed when read. A quoted payload must be one string and nothing else. Comments are not recognised inside a payload.

Your `createType` code never escapes anything: `stringify` returns plain text and `parse` receives plain text.

## Output

`space` works like the third argument of `JSON.stringify`:

- A number is floored and clamped to 0 through 10.
- A string is cut to 10 characters.
- Any other value, `0` or `""` gives compact output, which has no whitespace and no trailing commas.

Pretty output follows these rules:

- An object with entries always breaks one entry per line, with trailing commas.
- A list whose items are all scalars or tagged scalars stays on one line.
- Any other list breaks one item per line.
- There is no final newline.

Object entries follow schema order, and `Set` and `Map` items follow insertion order. A key is written bare when it is an identifier, including keywords such as `null`, and quoted otherwise. Strings are always written with double quotes. A date is written with `toISOString()`, with `.000Z` shortened to `Z`.

```jstn-schema
{
  someObj: { inner: boolean },
  someArr: array(number),
  lookup: map(string, { a: number }),
  "key with space": optional(string),
}
```

```jstn
{
  someObj: {
    inner: true,
  },
  someArr: [1, 2, 3],
  lookup: Map[
    [
      "x",
      {
        a: 1,
      },
    ],
  ],
  "key with space": "here",
}
```

## Limits

Nesting deeper than 512 lists and objects fails. `stringify`, `validate` and `is` apply the same limit to values, so `stringify` never writes data that `parse` rejects.

See [grammar.md](grammar.md) for the exact grammar.
