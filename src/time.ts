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
}

/** 解析后的时段（分钟表示，end 已归一化为大于 start，可能超过 1440） */
export interface ParsedPeriod {
	start: number;
	end: number;
	startLabel: string;
	endLabel: string;
	/** 生效的星期；undefined 表示每天生效 */
	days: number[] | undefined;
}

/** 下一次状态切换事件 */
export interface NextTransition {
	type: 'peak-start' | 'peak-end';
	deltaMinutes: number;
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
		});
	}
	return periods;
}

/**
 * 判断某分钟（当日 0 点起的分钟数）是否处于峰价时段。
 * 支持跨天时段（如 22:00 至 06:00）；跨天时段的早晨部分归属于其开始日（前一天）。
 * @param weekday 当前星期（0=周日、1=周一、……、6=周六）
 */
export function isInPeak(minuteOfDay: number, weekday: number, periods: ParsedPeriod[]): boolean {
	for (const p of periods) {
		if (p.end <= MINUTES_PER_DAY) {
			// 当天时段：start <= t < end
			if (minuteOfDay >= p.start && minuteOfDay < p.end && appliesOnDay(p, weekday)) {
				return true;
			}
		} else {
			// 跨天时段：晚间部分 [start, 1440) 属于当天，早晨部分 [0, end - 1440) 属于前一天
			if (minuteOfDay >= p.start && appliesOnDay(p, weekday)) {
				return true;
			}
			if (minuteOfDay < p.end - MINUTES_PER_DAY && appliesOnDay(p, (weekday + 6) % 7)) {
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
 */
export function getNextTransition(
	minuteOfDay: number,
	weekday: number,
	periods: ParsedPeriod[],
): NextTransition {
	let best: NextTransition | undefined;
	for (const p of periods) {
		const isCrossMidnight = p.end > MINUTES_PER_DAY;
		const endClock = p.end % MINUTES_PER_DAY;
		for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
			// 峰价开始事件：发生在 dayOffset 天，归属 dayOffset 天的星期
			if (appliesOnDay(p, (weekday + dayOffset) % 7)) {
				const startDelta = p.start + dayOffset * MINUTES_PER_DAY - minuteOfDay;
				if (startDelta > 0 && (!best || startDelta < best.deltaMinutes)) {
					best = { type: 'peak-start', deltaMinutes: startDelta };
				}
			}
			// 峰价结束事件：发生在 dayOffset 天的 endClock 处。
			// 非跨天时段归属当天；跨天时段（endClock 为次日凌晨）归属开始日的前一天。
			const endDay = (weekday + dayOffset - (isCrossMidnight ? 1 : 0) + 7) % 7;
			if (appliesOnDay(p, endDay)) {
				const endDelta = endClock + dayOffset * MINUTES_PER_DAY - minuteOfDay;
				if (endDelta > 0 && (!best || endDelta < best.deltaMinutes)) {
					best = { type: 'peak-end', deltaMinutes: endDelta };
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
