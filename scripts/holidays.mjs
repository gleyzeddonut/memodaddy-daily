// Holiday dates: fixed MM-DD, or rules resolved for a given year.
//   easter, easter+N / easter-N, 2nd-sunday-05, last-monday-05, 4th-thursday-11

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/// Anonymous Gregorian algorithm → [month, day].
export function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return day;
}
function lastWeekday(year, month, weekday) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - ((last - weekday + 7) % 7);
}

/// The concrete date(s) a holiday rule produces: a fixed "MM-DD" stays
/// yearly; a rule yields "YYYY-MM-DD" for each year asked for.
export function resolveDates(rule, years) {
  if (/^\d{2}-\d{2}$/.test(rule)) return [rule];
  const out = [];
  for (const y of years) {
    let m;
    if ((m = rule.match(/^easter([+-]\d+)?$/))) {
      const [mo, d] = easter(y);
      const dt = new Date(Date.UTC(y, mo - 1, d + Number(m[1] ?? 0)));
      out.push(ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()));
    } else if ((m = rule.match(/^(\d)(?:st|nd|rd|th)-([a-z]+)-(\d{2})$/))) {
      const wd = WEEKDAYS.indexOf(m[2]); if (wd < 0) throw new Error(`bad weekday in ${rule}`);
      out.push(ymd(y, Number(m[3]), nthWeekday(y, Number(m[3]), wd, Number(m[1]))));
    } else if ((m = rule.match(/^last-([a-z]+)-(\d{2})$/))) {
      const wd = WEEKDAYS.indexOf(m[1]); if (wd < 0) throw new Error(`bad weekday in ${rule}`);
      out.push(ymd(y, Number(m[2]), lastWeekday(y, Number(m[2]), wd)));
    } else {
      throw new Error(`unknown date rule: ${rule}`);
    }
  }
  return out;
}
