# Grammar

The data format and the schema language share one lexer. The notation is ISO EBNF. Trivia may appear between any two tokens, except at ⟨adj⟩.

## Lexical grammar

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

## Data

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

## Schema language

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

## Details

These details apply on top of the grammars:

- A payload body is trimmed. A quoted payload must be one string and nothing else, so `X("a" b)` fails with `expected ")" after quoted payload`. Comments are not recognised inside a payload.
- Nesting deeper than 512 levels fails in both languages. Data counts lists and objects. Schema text counts `{`, `[`, `(` and `<`, and each `[]` suffix. `stringify`, `validate` and `is` apply the same limit to values, so `stringify` never writes data that `parse` rejects.
- In schema text, `>>` is two tokens. Number and bigint tokens are never valid, and string tokens are allowed only as keys. `Set<>` fails with `"Set" expects 1 type argument, got 0`.
- Schema text errors always have path `$`. Registry errors are raised before reading starts and have no position.
