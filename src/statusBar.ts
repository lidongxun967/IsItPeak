// ---------------------------------------------------------------------------
// 状态栏集成：创建、刷新、通知、定时器与配置变更监听
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';
import {
	TimePeriod,
	parsePeriods,
	isInPeak,
	getNextTransition,
	formatDuration,
	formatClock,
} from './time';

const UPDATE_INTERVAL_MS = 10_000; // 每 10 秒刷新一次状态栏
const STATUS_BAR_PRIORITY = 0;

/**
 * 注册并显示峰谷价状态栏。
 * 立即刷新一次并定时刷新；配置变更时也会刷新。
 * 状态在峰价/谷价之间切换时（且配置 isitpeak.notifyOnSwitch 开启）弹出通知，首次刷新不弹。
 * @returns 一个 Disposable，用于在扩展停用时清理状态栏项、定时器与配置变更监听
 */
export function registerPeakStatusBar(): vscode.Disposable {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, STATUS_BAR_PRIORITY);
	statusBarItem.show();

	/** 上一次的状态，首次刷新时为 undefined（不触发通知） */
	let lastInPeak: boolean | undefined;

	const update = () => {
		const config = vscode.workspace.getConfiguration('isitpeak');
		const peakLabel = config.get<string>('peakLabel', '峰价');
		const valleyLabel = config.get<string>('valleyLabel', '谷价');
		const notifyOnSwitch = config.get<boolean>('notifyOnSwitch', true);
		const showRemaining = config.get<boolean>('showRemaining', true);
		const peakYellowBackground = config.get<boolean>('peakYellowBackground', true);
		const periods = parsePeriods(config.get<TimePeriod[]>('peakPeriods', []));

		const now = new Date();
		const minuteOfDay = now.getHours() * 60 + now.getMinutes();
		const weekday = now.getDay(); // 0=周日、1=周一、……、6=周六
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
			inPeak = isInPeak(minuteOfDay, weekday, periods);
			const transition = getNextTransition(minuteOfDay, weekday, periods);
			text = inPeak ? peakLabel : valleyLabel;
			// 可选：在状态栏直接显示当前状态剩余时长（精确到分钟）
			if (showRemaining) {
				text = `${text}还剩${formatDuration(transition.deltaMinutes)}`;
			}
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
		// 可选：峰价时段使用黄色背景高亮（谷价或关闭时恢复默认背景）
		statusBarItem.backgroundColor =
			inPeak && peakYellowBackground ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;

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
	const configSubscription = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('isitpeak')) {
			update();
		}
	});

	return new vscode.Disposable(() => {
		clearInterval(timer);
		statusBarItem.dispose();
		configSubscription.dispose();
	});
}
