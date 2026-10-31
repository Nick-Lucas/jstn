import { describe, expect, it } from "vitest"
import { JSTN, JSTNError, date } from "../../src/index.ts"

function fails(run: () => unknown): JSTNError {
  try {
    run()
  } catch (error) {
    if (error instanceof JSTNError) return error
    throw error
  }
  throw new Error("expected a JSTNError")
}

function utcYear(year: number, month: number, day: number): Date {
  const value = new Date(0)
  value.setUTCFullYear(year, month - 1, day)
  return value
}

function decode(payload: string): Date {
  return date.decode({ kind: "tagged", tag: "Date", payload, pos: { line: 1, column: 1 } }, [])
}

const MIN = new Date(-8.64e15)
const MAX = new Date(8.64e15)

describe("formatting", () => {
  it.each([
    ["whole seconds", new Date(Date.UTC(2026, 0, 1, 14, 0, 0)), "2026-01-01T14:00:00Z"],
    ["milliseconds", new Date(Date.UTC(2026, 0, 1, 14, 0, 0, 123)), "2026-01-01T14:00:00.123Z"],
    ["year 5", utcYear(5, 3, 1), "0005-03-01T00:00:00Z"],
    ["year 99", utcYear(99, 12, 31), "0099-12-31T00:00:00Z"],
    ["the maximum instant", MAX, "+275760-09-13T00:00:00Z"],
    ["the minimum instant", MIN, "-271821-04-20T00:00:00Z"],
    ["year -1", utcYear(-1, 1, 1), "-000001-01-01T00:00:00Z"],
  ])("formats %s", (_, value, payload) => {
    expect(date.encode(value, [])).toStrictEqual({ kind: "tagged", tag: "Date", payload })
  })
})

describe("accepted payloads", () => {
  it.each([
    ["date only", "2026-01-01", Date.UTC(2026, 0, 1)],
    ["minutes only", "2026-01-01T14:30Z", Date.UTC(2026, 0, 1, 14, 30)],
    ["seconds", "2026-01-01T14:30:15Z", Date.UTC(2026, 0, 1, 14, 30, 15)],
    ["1 fraction digit", "2026-01-01T00:00:00.1Z", Date.UTC(2026, 0, 1, 0, 0, 0, 100)],
    ["2 fraction digits", "2026-01-01T00:00:00.12Z", Date.UTC(2026, 0, 1, 0, 0, 0, 120)],
    ["3 fraction digits", "2026-01-01T00:00:00.123Z", Date.UTC(2026, 0, 1, 0, 0, 0, 123)],
    ["4 fraction digits", "2026-01-01T00:00:00.1239Z", Date.UTC(2026, 0, 1, 0, 0, 0, 123)],
    ["9 fraction digits", "2026-01-01T00:00:00.123999999Z", Date.UTC(2026, 0, 1, 0, 0, 0, 123)],
    ["a +05:30 offset", "2026-01-01T05:30:00+05:30", Date.UTC(2026, 0, 1)],
    ["a -08:00 offset", "2025-12-31T16:00-08:00", Date.UTC(2026, 0, 1)],
    ["a leap day", "2024-02-29", Date.UTC(2024, 1, 29)],
    ["a 400-year leap day", "2000-02-29", Date.UTC(2000, 1, 29)],
    ["the last second of a year", "2026-12-31T23:59:59Z", Date.UTC(2026, 11, 31, 23, 59, 59)],
    ["year 5", "0005-03-01", utcYear(5, 3, 1).getTime()],
    ["the maximum instant", "+275760-09-13T00:00:00Z", MAX.getTime()],
    ["the minimum instant", "-271821-04-20T00:00:00Z", MIN.getTime()],
    ["the maximum instant behind an offset", "+275760-09-13T01:00:00+01:00", MAX.getTime()],
    ["the minimum instant ahead of an offset", "-271821-04-19T23:00:00-01:00", MIN.getTime()],
    ["a negative year leap day", "-000004-02-29", utcYear(-4, 2, 29).getTime()],
  ])("accepts %s", (_, payload, time) => {
    const value = decode(payload)
    expect(value).toBeInstanceOf(Date)
    expect(value.getTime()).toBe(time)
  })
})

describe("rejected payloads", () => {
  it.each([
    ["2026-02-30", "day out of range"],
    ["2025-02-29", "day out of range"],
    ["1900-02-29", "day out of range"],
    ["2026-04-31", "day out of range"],
    ["2026-01-00", "day out of range"],
    ["2026-13-01", "month out of range"],
    ["2026-00-10", "month out of range"],
    ["2026-01-01T24:00Z", "hour out of range"],
    ["2026-01-01T12:60Z", "minute out of range"],
    ["2026-01-01T12:00:60Z", "second out of range"],
    ["2026-01-01T12:00+24:00", "offset out of range"],
    ["2026-01-01T12:00+05:60", "offset out of range"],
    ["2026-01-01T12:00", "expected an ISO 8601 date"],
    ["2026-01-01t12:00Z", "expected an ISO 8601 date"],
    ["2026-01-01T12:00z", "expected an ISO 8601 date"],
    ["2026-1-1", "expected an ISO 8601 date"],
    ["20260101", "expected an ISO 8601 date"],
    ["2026-01-01T12:00:00.1234567890Z", "expected an ISO 8601 date"],
    ["", "expected an ISO 8601 date"],
    ["1", "expected an ISO 8601 date"],
    [" 2026-01-01", "expected an ISO 8601 date"],
    ["-000000-01-01", "year -000000 is not allowed"],
    ["+275760-09-13T00:00:00.001Z", "outside the Date range"],
    ["+275760-09-13T00:00:00-00:01", "outside the Date range"],
    ["-271821-04-19T23:59:59Z", "outside the Date range"],
    ["+999999-01-01", "outside the Date range"],
  ])("rejects %o", (payload, why) => {
    const error = fails(() => date.decode({ kind: "tagged", tag: "Date", payload, pos: { line: 1, column: 5 } }, ["d"]))
    expect(error.message).toBe(`$.d: invalid Date ${JSON.stringify(payload)}: ${why} (line 1, column 5)`)
  })

  it("rejects a node with another tag or kind", () => {
    expect(fails(() => date.decode({ kind: "string", value: "2026-01-01" }, ["someDate"])).message).toBe(
      "$.someDate: expected Date, got string \"2026-01-01\"",
    )
    expect(fails(() => date.decode({ kind: "tagged", tag: "Money", payload: "1 GBP" }, [])).message).toBe("$: expected Date, got Money")
  })
})

describe("encode", () => {
  it.each([
    [new Date(Number.NaN), "$: expected Date, got invalid Date"],
    ["2026-01-01", "$: expected Date, got string \"2026-01-01\""],
    [0, "$: expected Date, got number 0"],
    [{}, "$: expected Date, got object"],
  ])("rejects %o", (value, message) => {
    expect(fails(() => date.encode(value, [])).message).toBe(message)
  })

  it("validates with the Date shorthand", () => {
    expect(JSTN.is(new Date(0), Date)).toBe(true)
    expect(JSTN.is(new Date(Number.NaN), Date)).toBe(false)
  })
})

describe("round trip", () => {
  const samples = [
    new Date(0),
    new Date(Date.UTC(2026, 0, 1, 14)),
    new Date(Date.UTC(1969, 11, 31, 23, 59, 59, 999)),
    new Date(Date.UTC(2024, 1, 29, 12, 34, 56, 7)),
    utcYear(5, 3, 1),
    utcYear(-1, 1, 1),
    utcYear(-12345, 6, 7),
    MIN,
    MAX,
  ]

  it.each(samples)("decode(encode(%o)) is the same instant", (value) => {
    expect(date.decode(date.encode(value, []), [])).toStrictEqual(value)
  })

  it.each(samples)("parse(stringify(%o)) is the same instant", (value) => {
    expect(JSTN.parse(JSTN.stringify(value, Date), Date)).toStrictEqual(value)
  })
})
