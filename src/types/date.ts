import type { Type } from "../core/type.ts"
import { createType } from "./custom.ts"

const ISO = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2}))?$/
const MAX_TIME = 8.64e15
const MS_PER_400_YEARS = 146_097 * 86_400_000

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function check(ok: boolean, why: string): void {
  if (!ok) throw new Error(why)
}

function offsetMinutes(zone: string): number {
  if (zone === "Z") return 0
  const hours = Number(zone.slice(1, 3))
  const minutes = Number(zone.slice(4, 6))
  check(hours <= 23 && minutes <= 59, "offset out of range")
  return (zone.startsWith("-") ? -1 : 1) * (hours * 60 + minutes)
}

export function parseIsoDate(text: string): Date {
  const match = ISO.exec(text)
  if (!match) throw new Error("expected an ISO 8601 date")
  const [, yearText = "", monthText = "", dayText = "", hourText = "0", minuteText = "0", secondText = "0", fraction = "", zone = "Z"] = match
  check(yearText !== "-000000", "year -000000 is not allowed")
  const [year, month, day] = [Number(yearText), Number(monthText), Number(dayText)]
  const [hour, minute, second] = [Number(hourText), Number(minuteText), Number(secondText)]
  check(month >= 1 && month <= 12, "month out of range")
  check(day >= 1 && day <= daysInMonth(year, month), "day out of range")
  check(hour <= 23, "hour out of range")
  check(minute <= 59, "minute out of range")
  check(second <= 59, "second out of range")
  const cycles = Math.floor(year / 400)
  const date = new Date(0)
  date.setUTCFullYear(year - cycles * 400, month - 1, day)
  date.setUTCHours(hour, minute - offsetMinutes(zone), second, Number(fraction.slice(0, 3).padEnd(3, "0")))
  const time = date.getTime() + cycles * MS_PER_400_YEARS
  check(Math.abs(time) <= MAX_TIME, "outside the Date range")
  return new Date(time)
}

export function formatIsoDate(value: Date): string {
  return value.toISOString().replace(/\.000Z$/, "Z")
}

export const date: Type<Date> = createType({
  name: Date,
  match: (value) => value instanceof Date && !Number.isNaN(value.getTime()),
  parse: parseIsoDate,
  stringify: formatIsoDate,
})
