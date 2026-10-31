import { createTRPCClient, httpBatchLink, httpLink, TRPCClientError } from "@trpc/client"
import { initTRPC } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { describe, expect, it } from "vitest"
import { JSTN, array } from "../src/index.ts"
import { Money, SortedSet, money, sortedSet } from "./support/fixtures.ts"

JSTN.register(money, sortedSet)

const t = initTRPC.create({ transformer: JSTN.transformer })

const Order = JSTN.schema({ id: BigInt, placedAt: Date, total: money, tags: array(String) })

const router = t.router({
  snapshot: t.procedure.query(() => ({
    at: new Date("2026-01-01T14:00:00Z"),
    big: 9007199254740993n,
    tags: new Set(["a", "b"]),
    lookup: new Map([["x", { n: 1 }]]),
    price: new Money("12.50", "GBP"),
    scores: new SortedSet([3, 1, 2]),
    nothing: null,
    skipped: undefined,
  })),
  echo: t.procedure.input((value: unknown) => value).mutation(({ input }) => input),
  placeOrder: t.procedure.input(Order).mutation(({ input }) => ({ id: input.id + 1n, total: input.total })),
  nothing: t.procedure.query(() => undefined),
  fail: t.procedure.query(() => {
    throw new Error("boom")
  }),
})

type ServerRequest = Parameters<typeof fetchRequestHandler>[0]["req"]
const ServerRequest = (globalThis as unknown as { Request: new (input: unknown, init?: unknown) => ServerRequest }).Request

function fetchFromRouter(input: unknown, init?: unknown) {
  return fetchRequestHandler({ endpoint: "/trpc", req: new ServerRequest(input, init), router, createContext: () => ({}) })
}

const batched = createTRPCClient<typeof router>({
  links: [httpBatchLink({ url: "http://localhost/trpc", transformer: JSTN.transformer, fetch: fetchFromRouter })],
})

const single = createTRPCClient<typeof router>({
  links: [httpLink({ url: "http://localhost/trpc", transformer: JSTN.transformer, fetch: fetchFromRouter })],
})

describe("tRPC transformer", () => {
  it("sends dates, bigints, sets, maps and registered types from server to client", async () => {
    const result = await batched.snapshot.query()
    expect(result).toStrictEqual({
      at: new Date("2026-01-01T14:00:00Z"),
      big: 9007199254740993n,
      tags: new Set(["a", "b"]),
      lookup: new Map([["x", { n: 1 }]]),
      price: new Money("12.50", "GBP"),
      scores: new SortedSet([1, 2, 3]),
      nothing: null,
    })
  })

  it.each([["a batched link", batched], ["a single link", single]])("sends rich input from client to server through %s", async (_, client) => {
    const input = { when: new Date(0), ids: new Set([1n, 2n]), nested: [new Map([[1, new Money("1.00", "EUR")]])] }
    expect(await client.echo.mutate(input)).toStrictEqual(input)
  })

  it("validates input with a JSTN schema through Standard Schema", async () => {
    const order = { id: 41n, placedAt: new Date(0), total: new Money("9.99", "GBP"), tags: ["gift"] }
    expect(await single.placeOrder.mutate(order)).toStrictEqual({ id: 42n, total: new Money("9.99", "GBP") })
    const bad = { ...order, tags: [1] } as unknown as typeof order
    await expect(single.placeOrder.mutate(bad)).rejects.toThrow(/expected string, got number 1/)
  })

  it("passes undefined results and inputs through", async () => {
    expect(await batched.nothing.query()).toBeUndefined()
    expect(await single.nothing.query()).toBeUndefined()
    expect(await batched.echo.mutate(undefined)).toBeUndefined()
  })

  it("transports errors", async () => {
    const error = await single.fail.query().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(TRPCClientError)
    expect((error as TRPCClientError<typeof router>).message).toBe("boom")
  })
})
