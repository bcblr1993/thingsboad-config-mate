# styles.css 重复 selector 报告（阶段 6.3 数据收集）

扫描时点：本次 stage 6.2 的 install/history/logs 提取**之后**。
- styles.css 当前行数：4445
- 简单 selector（无逗号、< 100 字符）总数：614
- 重复 selector 数：125 个，共 376 处定义

## 处理建议

CSS cascade 的最后一条规则胜出。绝大多数重复都是**累积技术债**：开发者新增覆盖规则而不是修改原有。**实际生效的是最后一个定义**。

安全去重策略：
1. 对每个重复 selector，diff 所有定义
2. 如果完全相同 → 删除前 N-1 个，保留最后一个
3. 如果不同 → 用浏览器实际渲染确认哪个生效，删除其他
4. 涉及 !important / @media / 特异性更高 selector 的 → 谨慎处理

单次估算：~125 个 selector × 5 分钟人工审核 = **~10 小时**。建议单独立项，分多次 PR。

## 完整重复列表（按定义次数倒序）

- `.header-inner` × **15** — lines 55, 149, 330, 1145, 1886, 2187, 2231, 2327, 3200, 3521, 4178, 4215, 4246, 4382, 4387
- `.content` × **9** — lines 69, 385, 1834, 1959, 2235, 2350, 3123, 3290, 4281
- `.action-bar` × **8** — lines 559, 2149, 2288, 3046, 3188, 3318, 4287, 4376
- `.header-title` × **7** — lines 98, 109, 157, 335, 1153, 2192, 2334
- `.service-grid` × **7** — lines 1449, 1847, 2032, 2258, 2509, 4423, 4433
- `.header-summary` × **6** — lines 1924, 2197, 2240, 3282, 4209, 4234
- `.config-form` × **6** — lines 2060, 2246, 2915, 3133, 3303, 4301
- `to` × **5** — lines 416, 722, 733, 850, 857
- `.deployment-header` × **5** — lines 1353, 3560, 3866, 4086, 4253
- `.plan-summary` × **5** — lines 1385, 2028, 2417, 3714, 3889
- `.service-card` × **5** — lines 1456, 2517, 3138, 4427, 4437
- `.service-actions` × **5** — lines 1587, 1828, 2578, 3142, 3406
- `.brand-title` × **5** — lines 1893, 3206, 3526, 4186, 4402
- `.header-target` × **5** — lines 1932, 2204, 2342, 3286, 4239
- `.config-workspace` × **5** — lines 1966, 2036, 2358, 2786, 3295
- `.config-workspace-header` × **5** — lines 1978, 2210, 2370, 2790, 3146
- `.config-shell` × **5** — lines 2804, 3082, 3086, 3154, 3299
- `.deployment-context` × **5** — lines 3566, 3629, 4099, 4257, 4263
- `.header` × **4** — lines 42, 1879, 2321, 3195
- `.header-controls` × **4** — lines 132, 172, 359, 1165
- `.search-box` × **4** — lines 196, 270, 349, 1173
- `.search-input:focus` × **4** — lines 201, 286, 354, 1180
- `from` × **4** — lines 411, 718, 728, 845
- `.service-config-panel` × **4** — lines 1620, 1842, 2253, 2602
- `.service-config-header` × **4** — lines 1628, 1818, 2610, 4169
- `.config-toolbar .search-box` × **4** — lines 2049, 2220, 2800, 3150
- `.deployment-overview` × **4** — lines 2393, 3693, 3878, 4119
- `.config-nav` × **4** — lines 2811, 3092, 3097, 3159
- `.workbench-nav` × **4** — lines 3214, 4190, 4221, 4398
- `.field-input` × **3** — lines 82, 535, 3010
- `.header-right` × **3** — lines 164, 1134, 1158
- `.btn-header` × **3** — lines 233, 363, 1189
- `.group-content` × **3** — lines 403, 2965, 3182
- `.field-desc` × **3** — lines 468, 528, 3018
- `.group-header` × **3** — lines 635, 2935, 3173
- `.group-header:hover` × **3** — lines 647, 2948, 3178
- `.user-menu` × **3** — lines 1273, 4394, 4408
- `.deployment-panel` × **3** — lines 1343, 1973, 2364
- `.deployment-meta` × **3** — lines 1369, 2024, 2402
- `.dependency-summary` × **3** — lines 1396, 2430, 3723
- `.dependency-row` × **3** — lines 1402, 2436, 3728
- `.dependency-label` × **3** — lines 1410, 2440, 3732
- `.service-config-summary` × **3** — lines 1650, 1823, 4173
- `.service-config-sections` × **3** — lines 1674, 1852, 2624
- `.service-config-section.wide` × **3** — lines 1687, 1856, 2652
- `.service-config-table td` × **3** — lines 1707, 1863, 2710
- `.service-config-key` × **3** — lines 1717, 1868, 2683
- `.service-config-value` × **3** — lines 1726, 1873, 2717
- `.brand-subtitle` × **3** — lines 1918, 2338, 3555
- `.config-toolbar` × **3** — lines 2040, 2214, 2796
- `.source-panel` × **3** — lines 2076, 2266, 3025
- `.action-subtitle` × **3** — lines 2171, 3066, 3324
- `.service-actions.has-cleanup` × **3** — lines 2584, 3413, 4442
- `.config-nav-list` × **3** — lines 2858, 3104, 3169
- `.config-detail-pane` × **3** — lines 2906, 3164, 3307
- `.deployment-context .status-badge` × **3** — lines 3621, 3675, 4105
- `:root` × **2** — lines 1, 2307
- `body` × **2** — lines 20, 2317
- `.version-badge` × **2** — lines 122, 344
- `.status-group` × **2** — lines 141, 206
- `.btn-header:hover` × **2** — lines 245, 305
- `.status-badge` × **2** — lines 311, 1198
- `.group-section` × **2** — lines 397, 2923
- `.group-title` × **2** — lines 422, 2953
- `.group-title::before` × **2** — lines 431, 2959
- `.card` × **2** — lines 441, 2972
- `.card .form-row>div:last-child` × **2** — lines 462, 2984
- `.card:hover` × **2** — lines 489, 2988
- `.field-label` × **2** — lines 514, 2994
- `.var-code` × **2** — lines 550, 3000
- `100%` × **2** — lines 710, 1233
- `.modal` × **2** — lines 912, 1008
- `.modal-content` × **2** — lines 1036, 1207
- `.user-chip` × **2** — lines 1281, 4413
- `.user-name` × **2** — lines 1309, 4417
- `.deployment-chip` × **2** — lines 1378, 2408
- `.dependency-chip` × **2** — lines 1422, 2445
- `.service-card:hover` × **2** — lines 1467, 2531
- `.service-card.required` × **2** — lines 1473, 2537
- `.service-card.selected` × **2** — lines 1482, 2542
- `.service-card.selected::before` × **2** — lines 1487, 2548
- `.service-top` × **2** — lines 1498, 2553
- `.service-name` × **2** — lines 1506, 2561
- `.service-status` × **2** — lines 1526, 2566
- `.service-message` × **2** — lines 1577, 2572
- `.service-actions button` × **2** — lines 1593, 2589
- `.service-config-title` × **2** — lines 1638, 2615
- `.service-config-body` × **2** — lines 1658, 2620
- `.service-config-section` × **2** — lines 1680, 2645
- `.service-config-section-title` × **2** — lines 1691, 2661
- `.service-config-table` × **2** — lines 1700, 2706
- `.service-config-value-wrap` × **2** — lines 1733, 2723
- `.service-config-list-value` × **2** — lines 1746, 2780
- `.section-kicker` × **2** — lines 1993, 2376
- `.config-workspace-title` × **2** — lines 2003, 2383
- `.config-workspace-meta` × **2** — lines 2011, 2388
- `.toolbar-button-group` × **2** — lines 2053, 2224
- `.source-panel.fullscreen` × **2** — lines 2090, 2270
- `.source-panel-header` × **2** — lines 2105, 2274
- `.source-panel-actions` × **2** — lines 2129, 2278
- `.source-panel-actions .btn-header` × **2** — lines 2137, 2283
- `.action-title` × **2** — lines 2165, 3062
- `.action-buttons` × **2** — lines 2177, 2294
- `.toolbar-button-group .btn-header` × **2** — lines 2262, 3683
- `.action-buttons .btn-install-init` × **2** — lines 2299, 3072
- `.service-config-sections.has-port.has-other` × **2** — lines 2641, 3116
- `.service-config-section + .service-config-section` × **2** — lines 2656, 3110
- `.brand-line span:first-child` × **2** — lines 3210, 3548
- `.workbench-nav-item` × **2** — lines 3227, 4225
- `.workbench-nav-desc` × **2** — lines 3268, 4230
- `.cleanup-detail-value` × **2** — lines 3448, 3460
- `.deployment-mode .badge-edge` × **2** — lines 3611, 4275
- `.dependency-status-summary` × **2** — lines 3738, 4196
- `.dependency-card-desc` × **2** — lines 3769, 4201
- `.dependency-status-list` × **2** — lines 3778, 4205
- `.dependency-status-chip.running` × **2** — lines 3822, 4153
- `.dependency-status-chip.pending` × **2** — lines 3838, 4158
- `.dependency-status-chip.empty` × **2** — lines 3855, 4164
- `.deployment-title-block` × **2** — lines 3873, 4095
- `.overview-row` × **2** — lines 4011, 4125
- `.overview-label` × **2** — lines 4019, 4130
- `.overview-items` × **2** — lines 4039, 4135
- `.deployment-overview .deployment-chip` × **2** — lines 4047, 4139
- `.deployment-overview .dependency-status-chip` × **2** — lines 4068, 4144
- `.deployment-context .btn-header` × **2** — lines 4109, 4270
