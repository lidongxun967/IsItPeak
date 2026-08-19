// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 配置中的时段，时间为 24 小时制，如 "08:00" */
interface TimePeriod {
	/** 开始时间（24 小时制） */
	start: string;
	/** 结束时间（24 小时制）；若小于开始时间则视为跨天（如 22:00 至 06:00） */
	end: string;
}

/** 解析后的时段（分钟表示，end 已归一化为大于 start，可能超过 1440） */
interface ParsedPeriod {
	start: number;
	end: number;
	startLabel: string;
	endLabel: string;
}

/** 下一次状态切换事件 */
interface NextTransition {
	type: 'peak-start' | 'peak-end';
	deltaMinutes: number;
}

const MINUTES_PER_DAY = 24 * 60;
const UPDATE_INTERVAL_MS = 10_000; // 每 10 秒刷新一次状态栏
const STATUS_BAR_PRIORITY = 100;

// ---------------------------------------------------------------------------
// 纯函数：时间解析与计算（导出以便单元测试）
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
		});
	}
	return periods;
}

/**
 * 判断某分钟（当日 0 点起的分钟数）是否处于峰价时段。
 * 支持跨天时段（如 22:00 至 06:00）。
 */
export function isInPeak(minuteOfDay: number, periods: ParsedPeriod[]): boolean {
	for (const p of periods) {
		if (p.end <= MINUTES_PER_DAY) {
			// 当天时段：start <= t < end
			if (minuteOfDay >= p.start && minuteOfDay < p.end) {
				return true;
			}
		} else {
			// 跨天时段：晚间部分 [start, 1440) 或早晨部分 [0, end - 1440)
			if (minuteOfDay >= p.start || minuteOfDay < p.end - MINUTES_PER_DAY) {
				return true;
			}
		}
	}
	return false;
}

/**
 * 计算从当前分钟开始，距离下一次状态切换（峰价开始/结束）的分钟数。
 * 时段按天循环，因此只需比较当天与明天的边界时间。
 */
export function getNextTransition(minuteOfDay: number, periods: ParsedPeriod[]): NextTransition {
	let best: NextTransition | undefined;
	for (const p of periods) {
		const endClock = p.end % MINUTES_PER_DAY;
		const events: Array<{ time: number; type: 'peak-start' | 'peak-end' }> = [
			{ time: p.start, type: 'peak-start' },
			{ time: endClock, type: 'peak-end' },
		];
		// 当天尚未到达的边界
		for (const e of events) {
			const delta = e.time - minuteOfDay;
			if (delta > 0 && (!best || delta < best.deltaMinutes)) {
				best = { type: e.type, deltaMinutes: delta };
			}
		}
		// 明天的边界（加一天）
		for (const e of events) {
			const delta = e.time + MINUTES_PER_DAY - minuteOfDay;
			if (!best || delta < best.deltaMinutes) {
				best = { type: e.type, deltaMinutes: delta };
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

// ---------------------------------------------------------------------------
// 扩展入口
// ---------------------------------------------------------------------------

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "isitpeak" is now active!');

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, STATUS_BAR_PRIORITY);
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	/** 上一次的状态，首次刷新时为 undefined（不触发通知） */
	let lastInPeak: boolean | undefined;

	const update = () => {
		const config = vscode.workspace.getConfiguration('isitpeak');
		const peakLabel = config.get<string>('peakLabel', '峰价');
		const valleyLabel = config.get<string>('valleyLabel', '谷价');
		const notifyOnSwitch = config.get<boolean>('notifyOnSwitch', true);
		const periods = parsePeriods(config.get<TimePeriod[]>('peakPeriods', []));

		const now = new Date();
		const minuteOfDay = now.getHours() * 60 + now.getMinutes();
		const currentTimeLabel = formatClock(minuteOfDay);

		let text: string;
		let tooltip: string;
		let inPeak: boolean;

		if (periods.length === 0) {
			inPeak = false;
			text = valleyLabel;
			tooltip = [
				`当前：${valleyLabel}`,
				`当前时间：${currentTimeLabel}`,
				'尚未配置峰价时段，请在设置中填写 isitpeak.peakPeriods',
			].join('\n');
		} else {
			inPeak = isInPeak(minuteOfDay, periods);
			const transition = getNextTransition(minuteOfDay, periods);
			text = inPeak ? peakLabel : valleyLabel;
			const lines = [
				`当前：${inPeak ? peakLabel : valleyLabel}`,
				`当前时间：${currentTimeLabel}`,
			];
			if (transition.type === 'peak-end') {
				lines.push(`${peakLabel}将于 ${formatDuration(transition.deltaMinutes)} 后结束`);
			} else {
				lines.push(`距离${peakLabel}还有 ${formatDuration(transition.deltaMinutes)}`);
			}
			tooltip = lines.join('\n');
		}

		statusBarItem.text = text;
		statusBarItem.tooltip = tooltip;

		// 状态发生切换时弹出通知（首次初始化不弹）
		const isFirstUpdate = lastInPeak === undefined;
		if (!isFirstUpdate && inPeak !== lastInPeak && notifyOnSwitch) {
			const message = inPeak
				? `已进入${peakLabel}时段（${currentTimeLabel}）`
				: `已进入${valleyLabel}时段（${currentTimeLabel}）`;
			vscode.window.showInformationMessage(message);
		}
		lastInPeak = inPeak;
	};

	// 立即刷新一次，并定时刷新；设置变更时也刷新
	update();
	const timer = setInterval(update, UPDATE_INTERVAL_MS);
	context.subscriptions.push(new vscode.Disposable(() => clearInterval(timer)));
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('isitpeak')) {
				update();
			}
		}),
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
