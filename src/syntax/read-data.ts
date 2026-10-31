import { checkDepth, JSTNError } from "../core/error.ts"
import { quote } from "../core/strings.ts"
import type { Entry, Node, Pos } from "../core/type.ts"
import { Lexer } from "./lexer.ts"

function keyword(name: string, pos: Pos): Node | undefined {
  switch (name) {
    case "null": return { kind: "null", pos }
    case "true": return { kind: "boolean", value: true, pos }
    case "false": return { kind: "boolean", value: false, pos }
    case "NaN": return { kind: "number", value: Number.NaN, pos }
    case "Infinity": return { kind: "number", value: Number.POSITIVE_INFINITY, pos }
    default: return undefined
  }
}

export function readData(text: string): Node {
  const path: (string | number)[] = []
  const fail = (reason: string, pos: Pos): never => {
    throw new JSTNError(reason, [...path], pos)
  }
  const lexer = new Lexer(text, fail)

  function readValue(): Node {
    const token = lexer.next()
    switch (token.kind) {
      case "number": return { kind: "number", value: token.value, pos: token.pos }
      case "bigint": return { kind: "bigint", value: token.value, pos: token.pos }
      case "string": return { kind: "string", value: token.value, pos: token.pos }
      case "ident": return keyword(token.value, token.pos) ?? readTagged(token.value, token.pos)
      case "punct":
        if (token.value === "{") return readObject(token.pos)
        if (token.value === "[") return readList(null, token.pos, token.pos)
    }
    return lexer.unexpected(token, "value")
  }

  function readTagged(tag: string, pos: Pos): Node {
    const open = lexer.peek()
    if (open.adjacent && open.kind === "punct" && open.value === "(") {
      lexer.next()
      return { kind: "tagged", tag, payload: lexer.readPayload(open.pos), pos }
    }
    if (open.adjacent && open.kind === "punct" && open.value === "[") {
      lexer.next()
      return readList(tag, pos, open.pos)
    }
    return fail(`expected "(" or "[" immediately after tag ${quote(tag)}`, pos)
  }

  function readList(tag: string | null, pos: Pos, open: Pos): Node {
    checkDepth(path.length, path, open)
    const items: Node[] = []
    for (;;) {
      path.push(items.length)
      const closed = lexer.eat("]")
      if (!closed) items.push(readValue())
      path.pop()
      if (closed || !lexer.more("]")) break
    }
    return { kind: "list", tag, items, pos }
  }

  function readObject(pos: Pos): Node {
    checkDepth(path.length, path, pos)
    const entries: Entry[] = []
    const seen = new Set<string>()
    while (!lexer.eat("}")) {
      const token = lexer.readKey()
      path.push(token.value)
      if (seen.has(token.value)) fail("duplicate key", token.pos)
      seen.add(token.value)
      lexer.expect(":")
      entries.push({ key: token.value, value: readValue(), keyPos: token.pos })
      path.pop()
      if (!lexer.more("}")) break
    }
    return { kind: "object", entries, pos }
  }

  const node = readValue()
  lexer.expectEnd()
  return node
}
