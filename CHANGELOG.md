# Change Log

All notable changes to the "isitpeak" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.3.0] - 2026-09-20

- 新增配置 `isitpeak.holidayData`：节假日数据（可按年调整），格式为 `{ "2026": ["1.1", "1.2"] }`，默认内置 2026 年国务院办公厅公布的法定节假日（不含调休上班日，其本就属于周末）
- 时段配置 `isitpeak.peakPeriods` 新增 `freeOnHolidays` 字段：开启后，该时段在 `holidayData` 配置的法定节假日内不生效，全天按空闲（谷价）计费
- 默认峰价时段已开启 `freeOnHolidays`；状态栏提示中会标注当日为法定节假日

## [0.2.0] - 2026-08-22

- 时段配置 `isitpeak.peakPeriods` 支持 `days` 字段：可指定该时段仅在一周中的某些天（0=周日、1=周一、……、6=周六）生效，省略或为空则每天生效
- 默认时段调整为仅在周一至周五生效（`days: [1, 2, 3, 4, 5]`）

## [0.1.0] - 2026-08-20

- 新增配置 `isitpeak.showRemaining`：在状态栏直接显示当前状态剩余时长（精确到分钟，默认开启）
- 新增配置 `isitpeak.peakYellowBackground`：峰价时段使用黄色背景高亮状态栏（默认开启）