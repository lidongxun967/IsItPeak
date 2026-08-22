# Change Log

All notable changes to the "isitpeak" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.2.0] - 2026-08-22

- 时段配置 `isitpeak.peakPeriods` 支持 `days` 字段：可指定该时段仅在一周中的某些天（0=周日、1=周一、……、6=周六）生效，省略或为空则每天生效
- 默认时段调整为仅在周一至周五生效（`days: [1, 2, 3, 4, 5]`）

## [0.1.0] - 2026-08-20

- 新增配置 `isitpeak.showRemaining`：在状态栏直接显示当前状态剩余时长（精确到分钟，默认开启）
- 新增配置 `isitpeak.peakYellowBackground`：峰价时段使用黄色背景高亮状态栏（默认开启）