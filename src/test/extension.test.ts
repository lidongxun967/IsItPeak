import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import {
	parseClockTime,
	parseDays,
	parsePeriods,
	parseHolidayData,
	isHolidayDate,
	isInPeak,
	getNextTransition,
	formatDuration,
	formatClock,
	HolidayData,
} from '../time';

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

		test('解析星期过滤 days', () => {
			const periods = parsePeriods([{ start: '08:00', end: '11:00', days: [1, 2, 2, 5] }]);
			assert.deepStrictEqual(periods[0].days, [1, 2, 5]); // 去重
		});

		test('省略或空 days 表示每天生效', () => {
			assert.strictEqual(parsePeriods([{ start: '08:00', end: '11:00' }])[0].days, undefined);
			assert.strictEqual(parsePeriods([{ start: '08:00', end: '11:00', days: [] }])[0].days, undefined);
		});
	});

	suite('parseDays', () => {
		test('仅保留 0-6 的整数并去重', () => {
			assert.deepStrictEqual(parseDays([1, 3, 3, 6]), [1, 3, 6]);
			assert.deepStrictEqual(parseDays([0, 7, -1, 2, 2.5, '1']), [0, 2]);
		});

		test('空值返回 undefined', () => {
			assert.strictEqual(parseDays(undefined), undefined);
			assert.strictEqual(parseDays([]), undefined);
			assert.strictEqual(parseDays('abc'), undefined);
		});
	});

	suite('isInPeak', () => {
		const sameDay = parsePeriods([{ start: '08:00', end: '11:00' }]);
		const crossMidnight = parsePeriods([{ start: '22:00', end: '06:00' }]);

		test('当天时段内/外判断', () => {
			assert.strictEqual(isInPeak(toMinute(8, 0), 1, sameDay), true);
			assert.strictEqual(isInPeak(toMinute(10, 30), 1, sameDay), true);
			assert.strictEqual(isInPeak(toMinute(11, 0), 1, sameDay), false);
			assert.strictEqual(isInPeak(toMinute(7, 59), 1, sameDay), false);
		});

		test('跨天时段内/外判断', () => {
			assert.strictEqual(isInPeak(toMinute(23, 0), 1, crossMidnight), true);
			assert.strictEqual(isInPeak(toMinute(3, 0), 1, crossMidnight), true);
			assert.strictEqual(isInPeak(toMinute(6, 0), 1, crossMidnight), false);
			assert.strictEqual(isInPeak(toMinute(12, 0), 1, crossMidnight), false);
		});

		test('仅工作日生效：周末不进入峰价', () => {
			const weekdayOnly = parsePeriods([{ start: '08:00', end: '11:00', days: [1, 2, 3, 4, 5] }]);
			assert.strictEqual(isInPeak(toMinute(9, 0), 1, weekdayOnly), true); // 周一
			assert.strictEqual(isInPeak(toMinute(9, 0), 5, weekdayOnly), true); // 周五
			assert.strictEqual(isInPeak(toMinute(9, 0), 0, weekdayOnly), false); // 周日
			assert.strictEqual(isInPeak(toMinute(9, 0), 6, weekdayOnly), false); // 周六
		});

		test('跨天时段早晨部分归属于前一天', () => {
			const weekdayCross = parsePeriods([{ start: '22:00', end: '06:00', days: [1, 2, 3, 4, 5] }]);
			// 周二凌晨 03:00 属于周一晚开始的时段
			assert.strictEqual(isInPeak(toMinute(3, 0), 2, weekdayCross), true);
			// 周日凌晨 03:00 属于周六，周六不生效
			assert.strictEqual(isInPeak(toMinute(3, 0), 0, weekdayCross), false);
			// 周五晚 23:00 生效；周六晚 23:00 不生效
			assert.strictEqual(isInPeak(toMinute(23, 0), 5, weekdayCross), true);
			assert.strictEqual(isInPeak(toMinute(23, 0), 6, weekdayCross), false);
		});
	});

	suite('getNextTransition', () => {
		const sameDay = parsePeriods([{ start: '08:00', end: '11:00' }]);
		const crossMidnight = parsePeriods([{ start: '22:00', end: '06:00' }]);

		test('谷价时段返回下一次峰价开始', () => {
			const t = getNextTransition(toMinute(13, 0), 1, sameDay);
			assert.strictEqual(t.type, 'peak-start');
			assert.strictEqual(t.deltaMinutes, 19 * 60); // 次日 08:00
		});

		test('峰价时段返回当前峰价结束', () => {
			const t = getNextTransition(toMinute(9, 0), 1, sameDay);
			assert.strictEqual(t.type, 'peak-end');
			assert.strictEqual(t.deltaMinutes, 2 * 60); // 11:00
		});

		test('跨天时段次日凌晨仍算当前峰价', () => {
			const t = getNextTransition(toMinute(3, 0), 1, crossMidnight);
			assert.strictEqual(t.type, 'peak-end');
			assert.strictEqual(t.deltaMinutes, 3 * 60); // 06:00
		});

		test('跨天时段晚间峰价开始前返回开始时间', () => {
			const t = getNextTransition(toMinute(20, 0), 1, crossMidnight);
			assert.strictEqual(t.type, 'peak-start');
			assert.strictEqual(t.deltaMinutes, 2 * 60); // 22:00
		});

		test('仅工作日生效：周日 09:00 返回周一 08:00 开始', () => {
			const weekdayOnly = parsePeriods([{ start: '08:00', end: '11:00', days: [1, 2, 3, 4, 5] }]);
			const t = getNextTransition(toMinute(9, 0), 0, weekdayOnly);
			assert.strictEqual(t.type, 'peak-start');
			assert.strictEqual(t.deltaMinutes, 23 * 60); // 周一 08:00
		});

		test('仅工作日生效：周六白天返回周一 22:00 开始', () => {
			const weekdayCross = parsePeriods([{ start: '22:00', end: '06:00', days: [1, 2, 3, 4, 5] }]);
			const t = getNextTransition(toMinute(12, 0), 6, weekdayCross);
			assert.strictEqual(t.type, 'peak-start');
			assert.strictEqual(t.deltaMinutes, 22 * 60 + 2 * 24 * 60 - 12 * 60); // 周一 22:00
		});

		test('仅工作日生效：周五晚 23:00 返回周六 06:00 结束', () => {
			const weekdayCross = parsePeriods([{ start: '22:00', end: '06:00', days: [1, 2, 3, 4, 5] }]);
			const t = getNextTransition(toMinute(23, 0), 5, weekdayCross);
			assert.strictEqual(t.type, 'peak-end');
			assert.strictEqual(t.deltaMinutes, 7 * 60); // 周六 06:00（周五晚时段结束）
		});

		test('仅工作日生效：周三凌晨 03:00 返回当日 06:00 结束', () => {
			const weekdayCross = parsePeriods([{ start: '22:00', end: '06:00', days: [1, 2, 3, 4, 5] }]);
			const t = getNextTransition(toMinute(3, 0), 3, weekdayCross);
			assert.strictEqual(t.type, 'peak-end');
			assert.strictEqual(t.deltaMinutes, 3 * 60); // 周三 06:00（周二晚时段结束）
		});
	});

	suite('节假日', () => {
		test('parseHolidayData 归一化日期并忽略非法项', () => {
			// 故意混入非法数据，验证解析的健壮性
			const raw = {
				'2026': ['1.1', ' 01.01 ', '12.31', 'bad', '13.1', '0.5', '1.32', 5],
				'26': ['1.1'], // 非法年份
				'2027': '1.1', // 非数组
			} as unknown as HolidayData;
			const data = parseHolidayData(raw);
			assert.deepStrictEqual([...data.keys()].sort(), [2026]);
			const set = data.get(2026)!;
			assert.strictEqual(set.size, 2);
			assert.strictEqual(set.has('1.1'), true);
			assert.strictEqual(set.has('12.31'), true);
			assert.deepStrictEqual(parseHolidayData(undefined), new Map());
		});

		test('isHolidayDate 按年月日匹配', () => {
			const data = parseHolidayData({ '2026': ['1.1', '2.14'] });
			assert.strictEqual(isHolidayDate(new Date(2026, 0, 1), data), true);
			assert.strictEqual(isHolidayDate(new Date(2026, 1, 14), data), true);
			assert.strictEqual(isHolidayDate(new Date(2026, 0, 2), data), false);
			assert.strictEqual(isHolidayDate(new Date(2025, 0, 1), data), false);
		});

		test('isInPeak：开启 freeOnHolidays 的时段在节假日不生效', () => {
			const periods = parsePeriods([{ start: '08:00', end: '11:00', freeOnHolidays: true }]);
			// 假设 1.1（周四）为节假日
			assert.strictEqual(isInPeak(toMinute(9, 0), 4, periods, true), false);
			assert.strictEqual(isInPeak(toMinute(9, 0), 4, periods, false), true); // 非节假日照常
			assert.strictEqual(isInPeak(toMinute(9, 0), 4, periods), true); // 未传参默认非节假日
		});

		test('isInPeak：未开启 freeOnHolidays 的时段在节假日仍生效', () => {
			const periods = parsePeriods([{ start: '08:00', end: '11:00' }]);
			assert.strictEqual(isInPeak(toMinute(9, 0), 4, periods, true), true);
		});

		test('isInPeak：跨天时段凌晨部分按昨天的节假日状态判断', () => {
			const periods = parsePeriods([{ start: '22:00', end: '06:00', freeOnHolidays: true }]);
			// 今天非节假日、昨天是节假日：昨晚时段被跳过，凌晨 03:00 为谷价
			assert.strictEqual(isInPeak(toMinute(3, 0), 4, periods, false, true), false);
			// 昨天非节假日：凌晨 03:00 仍为昨晚时段的峰价
			assert.strictEqual(isInPeak(toMinute(3, 0), 4, periods, false, false), true);
			// 今天是节假日、昨天不是：凌晨 03:00 归属昨天，仍为峰价；今晚 23:00 被跳过
			assert.strictEqual(isInPeak(toMinute(3, 0), 4, periods, true, false), true);
			assert.strictEqual(isInPeak(toMinute(23, 0), 4, periods, true, false), false);
		});

		test('getNextTransition：节假日跳过峰价开始事件', () => {
			const periods = parsePeriods([{ start: '08:00', end: '11:00', days: [1, 2, 3, 4, 5], freeOnHolidays: true }]);
			const data = parseHolidayData({ '2026': ['1.1'] });
			// 2025-12-31（周三）13:00：1.1 为节假日，下一次峰价为 1.2（周五）08:00
			const now = new Date(2025, 11, 31, 13, 0);
			const t = getNextTransition(13 * 60, now.getDay(), periods, { now, data });
			assert.strictEqual(t.type, 'peak-start');
			assert.strictEqual(t.deltaMinutes, 43 * 60);
			// 不提供节假日上下文时仍为 1.1 08:00
			const t2 = getNextTransition(13 * 60, now.getDay(), periods);
			assert.strictEqual(t2.deltaMinutes, 19 * 60);
		});

		test('getNextTransition：节假日不影响未开启 freeOnHolidays 的时段', () => {
			const periods = parsePeriods([{ start: '08:00', end: '11:00', days: [1, 2, 3, 4, 5] }]);
			const data = parseHolidayData({ '2026': ['1.1'] });
			const now = new Date(2025, 11, 31, 13, 0);
			const t = getNextTransition(13 * 60, now.getDay(), periods, { now, data });
			assert.strictEqual(t.type, 'peak-start');
			assert.strictEqual(t.deltaMinutes, 19 * 60);
		});

		test('getNextTransition：跨天时段在节假日不产生结束事件', () => {
			// 2025-12-31（周三）为节假日，其晚间的跨天时段不生效
			const periods = parsePeriods([{ start: '22:00', end: '06:00', freeOnHolidays: true }]);
			const data = parseHolidayData({ '2025': ['12.31'] });
			const now = new Date(2025, 11, 31, 13, 0);
			const t = getNextTransition(13 * 60, now.getDay(), periods, { now, data });
			assert.strictEqual(t.type, 'peak-start');
			assert.strictEqual(t.deltaMinutes, 22 * 60 - 13 * 60 + 24 * 60); // 1.1 22:00
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
