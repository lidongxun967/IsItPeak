import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import {
	parseClockTime,
	parsePeriods,
	isInPeak,
	getNextTransition,
	formatDuration,
	formatClock,
} from '../extension';

/** 将 HH:mm 转换为当日 0 点起的分钟数 */
function toMinute(hh: number, mm: number): number {
	return hh * 60 + mm;
}

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	suite('parseClockTime', () => {
		test('解析合法的 24 小时制时间', () => {
			assert.deepStrictEqual(parseClockTime('08:00'), { minutes: 480, label: '08:00' });
			assert.deepStrictEqual(parseClockTime('23:59'), { minutes: 1439, label: '23:59' });
			assert.deepStrictEqual(parseClockTime(' 9:5 '), { minutes: 545, label: '09:05' });
		});

		test('拒绝非法输入', () => {
			assert.strictEqual(parseClockTime('24:00'), undefined);
			assert.strictEqual(parseClockTime('08:60'), undefined);
			assert.strictEqual(parseClockTime('abc'), undefined);
			assert.strictEqual(parseClockTime('8'), undefined);
		});
	});

	suite('parsePeriods', () => {
		test('解析当天时段', () => {
			const periods = parsePeriods([{ start: '08:00', end: '11:00' }]);
			assert.strictEqual(periods.length, 1);
			assert.strictEqual(periods[0].start, 480);
			assert.strictEqual(periods[0].end, 660);
		});

		test('跨天时段结束时间加一天', () => {
			const periods = parsePeriods([{ start: '22:00', end: '06:00' }]);
			assert.strictEqual(periods[0].start, 22 * 60);
			assert.strictEqual(periods[0].end, 6 * 60 + 24 * 60);
		});

		test('忽略非法时段', () => {
			assert.deepStrictEqual(parsePeriods([{ start: 'bad', end: '11:00' }]), []);
			assert.deepStrictEqual(parsePeriods(undefined), []);
		});
	});

	suite('isInPeak', () => {
		const sameDay = parsePeriods([{ start: '08:00', end: '11:00' }]);
		const crossMidnight = parsePeriods([{ start: '22:00', end: '06:00' }]);

		test('当天时段内/外判断', () => {
			assert.strictEqual(isInPeak(toMinute(8, 0), sameDay), true);
			assert.strictEqual(isInPeak(toMinute(10, 30), sameDay), true);
			assert.strictEqual(isInPeak(toMinute(11, 0), sameDay), false);
			assert.strictEqual(isInPeak(toMinute(7, 59), sameDay), false);
		});

		test('跨天时段内/外判断', () => {
			assert.strictEqual(isInPeak(toMinute(23, 0), crossMidnight), true);
			assert.strictEqual(isInPeak(toMinute(3, 0), crossMidnight), true);
			assert.strictEqual(isInPeak(toMinute(6, 0), crossMidnight), false);
			assert.strictEqual(isInPeak(toMinute(12, 0), crossMidnight), false);
		});
	});

	suite('getNextTransition', () => {
		const sameDay = parsePeriods([{ start: '08:00', end: '11:00' }]);
		const crossMidnight = parsePeriods([{ start: '22:00', end: '06:00' }]);

		test('谷价时段返回下一次峰价开始', () => {
			const t = getNextTransition(toMinute(13, 0), sameDay);
			assert.strictEqual(t.type, 'peak-start');
			assert.strictEqual(t.deltaMinutes, 19 * 60); // 次日 08:00
		});

		test('峰价时段返回当前峰价结束', () => {
			const t = getNextTransition(toMinute(9, 0), sameDay);
			assert.strictEqual(t.type, 'peak-end');
			assert.strictEqual(t.deltaMinutes, 2 * 60); // 11:00
		});

		test('跨天时段次日凌晨仍算当前峰价', () => {
			const t = getNextTransition(toMinute(3, 0), crossMidnight);
			assert.strictEqual(t.type, 'peak-end');
			assert.strictEqual(t.deltaMinutes, 3 * 60); // 06:00
		});

		test('跨天时段晚间峰价开始前返回开始时间', () => {
			const t = getNextTransition(toMinute(20, 0), crossMidnight);
			assert.strictEqual(t.type, 'peak-start');
			assert.strictEqual(t.deltaMinutes, 2 * 60); // 22:00
		});
	});

	suite('formatDuration / formatClock', () => {
		test('格式化时长', () => {
			assert.strictEqual(formatDuration(0), '0分钟');
			assert.strictEqual(formatDuration(30), '30分钟');
			assert.strictEqual(formatDuration(60), '1小时');
			assert.strictEqual(formatDuration(90), '1小时30分钟');
			assert.strictEqual(formatDuration(7 * 60 + 5), '7小时5分钟');
		});

		test('格式化 24 小时制时钟', () => {
			assert.strictEqual(formatClock(0), '00:00');
			assert.strictEqual(formatClock(480), '08:00');
			assert.strictEqual(formatClock(1439), '23:59');
		});
	});
});
