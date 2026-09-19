// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 配置中的时段，时间为 24 小时制，如 "08:00" */
export interface TimePeriod {
	/** 开始时间（24 小时制） */
	start: string;
	/** 结束时间（24 小时制）；若小于开始时间则视为跨天（如 22:00 至 06:00） */
	end: string;
	/** 该时段生效的星期（0=周日、1=周一、……、6=周六）；省略或为空表示每天生效 */
	days?: number[];
	/** 法定节假日全天按空闲计费：开启后，该时段在 isitpeak.holidayData 配置的法定节假日内不生效 */
	freeOnHolidays?: boolean;
}

/** 解析后的时段（分钟表示，end 已归一化为大于 start，可能超过 1440） */
export interface ParsedPeriod {
	start: number;
	end: number;
	startLabel: string;
	endLabel: string;
	/** 生效的星期；undefined 表示每天生效 */
	days: number[] | undefined;
	/** 是否在法定节假日按空闲计费（该时段在这些日期不生效）；undefined 等同于 false */
	freeOnHolidays: boolean | undefined;
}

/** 下一次状态切换事件 */
export interface NextTransition {
	type: 'peak-start' | 'peak-end';
	deltaMinutes: number;
}

/** 法定节假日数据：年份（如 "2026"）-> 日期列表（"月.日"，如 "1.1"） */
export type HolidayData = Record<string, string[]>;

/** 供 getNextTransition 使用的节假日上下文 */
export interface HolidayContext {
	/** 当前日期，用于推算未来各天是否为节假日 */
	now: Date;
	/** 解析后的节假日数据 */
	data: Map<number, Set<string>>;
}

const MINUTES_PER_DAY = 24 * 60;

// ---------------------------------------------------------------------------
// 纯函数：时间解析与计算（无 vscode 依赖，可独立测试）
// ---------------------------------------------------------------------------

/**
 * 解析 "HH:mm"（24 小时制）格式的时间。
 * 合法时返回距当日 0 点的分钟数及规范化后的标签，否则返回 undefined。
 */
export function parseClockTime(value: string): { minutes: number; label: string } | undefined {
	const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
	if (!match) {
		return undefined;
	}
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) {
		return undefined;
	}
	const label = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
	return { minutes: hours * 60 + minutes, label };
}

/**
 * 解析配置中的星期数组：仅保留 0-6 的整数并去重。
 * 省略、非数组或为空时返回 undefined（表示每天生效）。
 */
export function parseDays(days: unknown): number[] | undefined {
	if (!Array.isArray(days) || days.length === 0) {
		return undefined;
	}
	const unique = [
		...new Set(days.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)),
	];
	return unique.length > 0 ? unique : undefined;
}

/** 判断时段在指定星期（0=周日、1=周一、……、6=周六）是否生效 */
function appliesOnDay(p: ParsedPeriod, weekday: number): boolean {
	return p.days === undefined || p.days.includes(weekday);
}

/** 归一化 "月.日" 字符串为 "M.D"（容忍多余零与空白），非法时返回 undefined */
function normalizeMonthDay(value: string): string | undefined {
	const match = /^(\d{1,2})\.(\d{1,2})$/.exec(value.trim());
	if (!match) {
		return undefined;
	}
	const month = Number(match[1]);
	const day = Number(match[2]);
	if (month < 1 || month > 12 || day < 1 || day > 31) {
		return undefined;
	}
	return `${month}.${day}`;
}

/**
 * 将节假日配置解析为 年份 -> 归一化日期集合 的映射。
 * 忽略非法的年份键与日期项；无有效日期的年份不入表。
 */
export function parseHolidayData(raw: HolidayData | undefined): Map<number, Set<string>> {
	const result = new Map<number, Set<string>>();
	if (!raw || typeof raw !== 'object') {
		return result;
	}
	for (const [yearKey, dates] of Object.entries(raw)) {
		if (!/^\d{4}$/.test(yearKey.trim()) || !Array.isArray(dates)) {
			continue;
		}
		const set = new Set<string>();
		for (const item of dates) {
			if (typeof item !== 'string') {
				continue;
			}
			const normalized = normalizeMonthDay(item);
			if (normalized) {
				set.add(normalized);
			}
		}
		if (set.size > 0) {
			result.set(Number(yearKey.trim()), set);
		}
	}
	return result;
}

/** 判断给定日期是否为配置中的法定节假日 */
export function isHolidayDate(date: Date, holidays: Map<number, Set<string>>): boolean {
	const yearDates = holidays.get(date.getFullYear());
	return yearDates !== undefined && yearDates.has(`${date.getMonth() + 1}.${date.getDate()}`);
}

/** 返回 base 日期偏移 offset 天后的当日 0 点日期 */
function addDays(base: Date, offset: number): Date {
	return new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
}

/**
 * 将配置中的时段字符串解析为分钟表示。
 * 若结束时间不大于开始时间，则视为跨天（结束时间加一天）。
 */
export function parsePeriods(raw: TimePeriod[] | undefined): ParsedPeriod[] {
	const periods: ParsedPeriod[] = [];
	for (const item of raw ?? []) {
		const start = parseClockTime(item.start);
		const end = parseClockTime(item.end);
		if (!start || !end) {
			continue;
		}
		let endMinutes = end.minutes;
		if (endMinutes <= start.minutes) {
			endMinutes += MINUTES_PER_DAY;
		}
		periods.push({
			start: start.minutes,
			end: endMinutes,
			startLabel: start.label,
			endLabel: end.label,
			days: parseDays(item.days),
			freeOnHolidays: item.freeOnHolidays === true,
		});
	}
	return periods;
}

/**
 * 判断某分钟（当日 0 点起的分钟数）是否处于峰价时段。
 * 支持跨天时段（如 22:00 至 06:00）；跨天时段的早晨部分归属于其开始日（前一天）。
 * @param weekday 当前星期（0=周日、1=周一、……、6=周六）
 * @param isHoliday 今天是否为法定节假日；为 true 时开启了 freeOnHolidays 的时段不生效
 * @param isYesterdayHoliday 昨天是否为法定节假日；跨天时段的凌晨部分归属昨天，按昨天的节假日状态判断
 */
export function isInPeak(
	minuteOfDay: number,
	weekday: number,
	periods: ParsedPeriod[],
	isHoliday = false,
	isYesterdayHoliday = false,
): boolean {
	for (const p of periods) {
		const skipOnHoliday = p.freeOnHolidays === true;
		if (p.end <= MINUTES_PER_DAY) {
			// 当天时段：start <= t < end
			if (skipOnHoliday && isHoliday) {
				continue;
			}
			if (minuteOfDay >= p.start && minuteOfDay < p.end && appliesOnDay(p, weekday)) {
				return true;
			}
		} else {
			// 跨天时段：晚间部分 [start, 1440) 属于今天，早晨部分 [0, end - 1440) 属于昨天
			const eveningSkipped = skipOnHoliday && isHoliday;
			const morningSkipped = skipOnHoliday && isYesterdayHoliday;
			if (!eveningSkipped && minuteOfDay >= p.start && appliesOnDay(p, weekday)) {
				return true;
			}
			if (!morningSkipped && minuteOfDay < p.end - MINUTES_PER_DAY && appliesOnDay(p, (weekday + 6) % 7)) {
				return true;
			}
		}
	}
	return false;
}

/**
 * 计算从当前分钟开始，距离下一次状态切换（峰价开始/结束）的分钟数。
 * 时段按天循环并按星期过滤，因此搜索未来 0-7 天即可覆盖完整周期。
 * @param weekday 当前星期（0=周日、1=周一、……、6=周六）
 * @param holidays 节假日上下文；提供后，开启了 freeOnHolidays 的时段在法定节假日不产生状态切换
 */
export function getNextTransition(
	minuteOfDay: number,
	weekday: number,
	periods: ParsedPeriod[],
	holidays?: HolidayContext,
): NextTransition {
	let best: NextTransition | undefined;
	for (const p of periods) {
		const isCrossMidnight = p.end > MINUTES_PER_DAY;
		const endClock = p.end % MINUTES_PER_DAY;
		for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
			// 峰价开始事件：发生在 dayOffset 天，归属 dayOffset 天的星期
			if (appliesOnDay(p, (weekday + dayOffset) % 7)) {
				const startSkipped =
					holidays !== undefined && p.freeOnHolidays && isHolidayDate(addDays(holidays.now, dayOffset), holidays.data);
				if (!startSkipped) {
					const startDelta = p.start + dayOffset * MINUTES_PER_DAY - minuteOfDay;
					if (startDelta > 0 && (!best || startDelta < best.deltaMinutes)) {
						best = { type: 'peak-start', deltaMinutes: startDelta };
					}
				}
			}
			// 峰价结束事件：发生在 dayOffset 天的 endClock 处。
			// 非跨天时段归属当天；跨天时段（endClock 为次日凌晨）归属开始日的前一天。
			const endStartDayOffset = dayOffset - (isCrossMidnight ? 1 : 0);
			const endDay = (weekday + endStartDayOffset + 7) % 7;
			if (appliesOnDay(p, endDay)) {
				const endSkipped =
					holidays !== undefined &&
					p.freeOnHolidays &&
					isHolidayDate(addDays(holidays.now, endStartDayOffset), holidays.data);
				if (!endSkipped) {
					const endDelta = endClock + dayOffset * MINUTES_PER_DAY - minuteOfDay;
					if (endDelta > 0 && (!best || endDelta < best.deltaMinutes)) {
						best = { type: 'peak-end', deltaMinutes: endDelta };
					}
				}
			}
		}
	}
	return best ?? { type: 'peak-start', deltaMinutes: 0 };
}

/** 将分钟数格式化为 "x小时x分钟"（自动省略为 0 的部分） */
export function formatDuration(totalMinutes: number): string {
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours > 0 && minutes > 0) {
		return `${hours}小时${minutes}分钟`;
	}
	if (hours > 0) {
		return `${hours}小时`;
	}
	return `${minutes}分钟`;
}

/** 将分钟数格式化为 24 小时制 "HH:mm" */
export function formatClock(minutes: number): string {
	const hours = Math.floor(minutes / 60) % 24;
	const mins = minutes % 60;
	return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}
