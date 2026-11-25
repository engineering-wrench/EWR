// Единый источник истины: вкладка палитры → плитка → id, имя и привязка к движку.
//
// Раскладка (какая лента = какая вкладка, порядок плиток) взята из движка EWB:
//   * порядок примитивов внутри вкладок — C-записи WEWBANSI.RES (`symbolLayouts.ansi`
//     в Site/engine/palette.generated.json), 39 записей; счётчики сходятся с лентами;
//   * книжные детали — группы EXT/*.EWX (`EwbSetPartsBin` + `EwbDefineComp`);
//   * имена PartNum — WEWBMSG.RES (`partNames`);
//   * класс модели — `library.ansi` (C-записи ewba.la).
//
// Уверенность:
//   confirmed — имя и место подтверждены (иконка с подписью, порядок реестра, PartNum);
//   inferred  — иконка опознана, но имя выбрано внутри семейства (см. docs/re/palette.md §7);
//   unresolved— привязки нет.
//
// `device` — тип устройства для движка (Site/engine/parser.js: deviceType), `unknown` —
// движок такой элемент пока не моделирует (привязка к PartNum/ExtComp всё равно есть).

const t = (strip, index, id, name, en, partNum = null, ext = null, model = null,
    device = 'unknown', pins = 0, confidence = 'confirmed') => ({
    strip, index, id, name, en, partNum, ext, model, device, pins, confidence
});

// Вкладки: strip → id элемента тулбара EWR (Site/logic/js/interface.js).
export const TABS = [
    { strip: 3001, key: 'sources', title: 'Источники', en: 'Sources' },
    { strip: 3002, key: 'component', title: 'Базовые', en: 'Basic' },
    { strip: 3003, key: 'diod', title: 'Диоды', en: 'Diodes' },
    { strip: 3004, key: 'transistor', title: 'Транзисторы', en: 'Transistors' },
    { strip: 3005, key: 'analog', title: 'Аналоговые ИС', en: 'Analog ICs' },
    { strip: 3006, key: 'mixed', title: 'Смешанные ИС', en: 'Mixed ICs' },
    { strip: 3007, key: 'digit', title: 'Цифровые ИС', en: 'Digital ICs' },
    { strip: 3008, key: 'logic', title: 'Логические элементы', en: 'Logic Gates' },
    { strip: 3009, key: 'digital', title: 'Цифровые', en: 'Digital' },
    { strip: 3010, key: 'indicators', title: 'Индикаторы', en: 'Indicators' },
    { strip: 3011, key: 'controls', title: 'Управление', en: 'Controls' },
    { strip: 3012, key: 'text', title: 'Прочее', en: 'Miscellaneous' },
    { strip: 3013, key: 'instrument', title: 'Приборы', en: 'Instruments' }
];

export const TILES = [
    // --- Источники (3001), 23: 9 примитивов + 14 книжных ----------------------
    t(3001, 1, 'ground', 'Земля', 'Ground', 8, null, null, 'ground', 1),
    t(3001, 2, 'battery', 'Батарея', 'Battery', 2, null, null, 'vsource', 2),
    t(3001, 3, 'dc-current-source', 'Источник постоянного тока', 'DC Current Source', 10, null, null, 'isource', 2),
    t(3001, 4, 'ac-voltage-source', 'Источник переменного напряжения', 'AC Voltage Source', 0, null, null, 'vsource', 2),
    t(3001, 5, 'ac-current-source', 'Источник переменного тока', 'AC Current Source', 7, null, null, 'isource', 2),
    t(3001, 6, 'vcvs', 'ИНУН: источник напряжения, управляемый напряжением', 'Voltage-Controlled Voltage Source', 32, null, null, 'unknown', 4, 'inferred'),
    t(3001, 7, 'vccs', 'ИНУТ: источник тока, управляемый напряжением', 'Voltage-Controlled Current Source', 34, null, null, 'unknown', 4, 'inferred'),
    t(3001, 8, 'ccvs', 'ИТУН: источник напряжения, управляемый током', 'Current-Controlled Voltage Source', 35, null, null, 'unknown', 4, 'inferred'),
    t(3001, 9, 'cccs', 'ИТУТ: источник тока, управляемый током', 'Current-Controlled Current Source', 33, null, null, 'unknown', 4, 'inferred'),
    t(3001, 10, 'vcc', 'Напряжение питания Vcc', 'Vcc', null, 'Volt', 'volt.par', 'unknown', 1),
    t(3001, 11, 'vdd', 'Напряжение питания Vdd', 'Vdd', null, 'Vdd', 'vdd.par', 'unknown', 1),
    t(3001, 12, 'clock', 'Тактовый генератор', 'Clock', null, 'clock', 'clock.par', 'unknown', 2),
    t(3001, 13, 'am-source', 'Источник с амплитудной модуляцией', 'AM Source', null, 'am', 'am.par', 'unknown', 2),
    t(3001, 14, 'fm-source', 'Источник с частотной модуляцией', 'FM Source', null, 'fm', 'fm.par', 'unknown', 2),
    t(3001, 15, 'sine-source', 'Синусоидальный источник', 'Sine Wave Source', null, 'sinewave', 'vcsw.par', 'unknown', 2),
    t(3001, 16, 'triangle-source', 'Источник треугольного сигнала', 'Triangle Wave Source', null, 'triwave', 'vctw.par', 'unknown', 2),
    t(3001, 17, 'square-source', 'Источник прямоугольного сигнала', 'Square Wave Source', null, 'sqrwave', 'vcsqw.par', 'unknown', 2),
    t(3001, 18, 'one-shot', 'Одновибратор', 'One Shot', null, 'con1shot', 'vcosh.par', 'unknown', 2),
    t(3001, 19, 'ac-sweep-source', 'Источник с качанием частоты', 'AC Sweep Source', null, 'ascts', 'ascts.par', 'unknown', 2, 'inferred'),
    t(3001, 20, 'pwl-source', 'Кусочно-линейный источник', 'Piecewise Linear Source', null, 'pwl', 'pwl.par', 'unknown', 2),
    t(3001, 21, 'fsk-source', 'Источник с частотной манипуляцией', 'FSK Source', null, 'fsk', 'fsk.par', 'unknown', 2),
    t(3001, 22, 'poly-source', 'Полиномиальный источник', 'Polynomial Source', null, 'poly', 'poly.par', 'unknown', 3, 'inferred'),
    t(3001, 23, 'arbitrary-source', 'Произвольный источник', 'Arbitrary Source', null, 'arbsrc', 'arbs.par', 'unknown', 2, 'inferred'),

    // --- Базовые (3002), 20: 10 примитивов + 10 книжных ----------------------
    t(3002, 1, 'point', 'Соединитель', 'Connector', 9, null, null, 'connector', 2),
    t(3002, 2, 'resistor', 'Резистор', 'Resistor', 1, null, null, 'resistor', 2),
    t(3002, 3, 'capacitor', 'Конденсатор', 'Capacitor', 3, null, null, 'capacitor', 2),
    t(3002, 4, 'inductor', 'Катушка индуктивности', 'Inductor', 6, null, null, 'inductor', 2),
    t(3002, 5, 'transformer', 'Трансформатор', 'Transformer', 14, null, null, 'transformer', 4),
    t(3002, 6, 'relay', 'Реле', 'Relay', 20, null, null, 'unknown', 4, 'inferred'),
    t(3002, 7, 'switch', 'Ключ', 'Switch', 38, null, null, 'unknown', 2),
    t(3002, 8, 'td-switch', 'Ключ с задержкой', 'Time-Delay Switch', 21, null, null, 'unknown', 2),
    t(3002, 9, 'vc-switch', 'Ключ, управляемый напряжением', 'Voltage-Controlled Switch', 36, null, null, 'unknown', 4),
    t(3002, 10, 'cc-switch', 'Ключ, управляемый током', 'Current-Controlled Switch', 37, null, null, 'unknown', 4),
    t(3002, 11, 'pull-up', 'Подтягивающий резистор', 'Pull-Up Resistor', null, 'Pull', 'pull.par', 'unknown', 3, 'inferred'),
    t(3002, 12, 'potentiometer', 'Потенциометр', 'Potentiometer', null, 'pot', 'pot.par', 'unknown', 3),
    t(3002, 13, 'resistor-pack', 'Сборка резисторов', 'Resistor Pack', null, 'respk', 'respk.par', 'unknown', 16),
    t(3002, 14, 'coupled-inductor', 'Связанные индуктивности', 'Coupled Inductor', null, 'lcouple', 'lcoup.par', 'unknown', 4, 'inferred'),
    t(3002, 15, 'polarized-capacitor', 'Полярный конденсатор', 'Polarized Capacitor', null, 'polcap', 'elcap.par', 'unknown', 2),
    t(3002, 16, 'variable-capacitor', 'Переменный конденсатор', 'Variable Capacitor', null, 'varc', 'varc.par', 'unknown', 2),
    t(3002, 17, 'variable-inductor', 'Переменная индуктивность', 'Variable Inductor', null, 'varl', 'varl.par', 'unknown', 2),
    t(3002, 18, 'magnetic-core', 'Магнитный сердечник', 'Magnetic Core', null, 'mcore', 'mcore.par', 'unknown', 4, 'inferred'),
    t(3002, 19, 'analog-switch', 'Аналоговый ключ', 'Analog Switch', null, 'analogsw', 'asw.par', 'unknown', 4, 'inferred'),
    t(3002, 20, 'nonlinear-transformer', 'Нелинейный трансформатор', 'Nonlinear Transformer', null, 'nltrnfr', 'ntsf.par', 'unknown', 4, 'inferred'),

    // --- Диоды (3003), 8: 3 примитива + 5 книжных ----------------------------
    t(3003, 1, 'diode', 'Диод', 'Diode', 4, null, null, 'diode', 2),
    t(3003, 2, 'zener', 'Стабилитрон', 'Zener Diode', 16, null, null, 'diode', 2),
    t(3003, 3, 'led', 'Светодиод', 'LED', 17, null, null, 'diode', 2),
    t(3003, 4, 'diode-bridge', 'Мостовой выпрямитель', 'Full Wave Bridge', null, 'fwb', 'fwb.par', 'unknown', 4),
    t(3003, 5, 'shockley-diode', 'Диод Шокли', 'Shockley Diode', null, 'shock', 'shock.par', 'unknown', 2, 'inferred'),
    t(3003, 6, 'scr', 'Тиристор', 'SCR', null, 'scr', 'scr.par', 'unknown', 3),
    t(3003, 7, 'diac', 'Динистор', 'Diac', null, 'diac', 'diac.par', 'unknown', 2),
    t(3003, 8, 'triac', 'Симистор', 'Triac', null, 'triac', 'triac.par', 'unknown', 3),

    // --- Транзисторы (3004), 14: 12 примитивов + 2 книжных -------------------
    t(3004, 1, 'npn', 'Биполярный транзистор n-p-n', 'NPN Transistor', 5, null, null, 'unknown', 3),
    t(3004, 2, 'pnp', 'Биполярный транзистор p-n-p', 'PNP Transistor', 11, null, null, 'unknown', 3),
    t(3004, 3, 'jfet-n', 'Полевой транзистор с n-каналом', 'N-Channel JFET', 22, null, null, 'unknown', 3),
    t(3004, 4, 'jfet-p', 'Полевой транзистор с p-каналом', 'P-Channel JFET', 23, null, null, 'unknown', 3),
    t(3004, 5, 'nmos-dm', 'N-МОП, обеднение, 3 вывода', 'Depletion N-MOSFET', 24, null, null, 'unknown', 3),
    t(3004, 6, 'pmos-dm', 'P-МОП, обеднение, 3 вывода', 'Depletion P-MOSFET', 25, null, null, 'unknown', 3),
    t(3004, 7, 'nmos-dmb', 'N-МОП, обеднение, 4 вывода', 'Depletion N-MOSFET (4 terminal)', 26, null, null, 'unknown', 4),
    t(3004, 8, 'pmos-dmb', 'P-МОП, обеднение, 4 вывода', 'Depletion P-MOSFET (4 terminal)', 27, null, null, 'unknown', 4),
    t(3004, 9, 'nmos-em', 'N-МОП, обогащение, 3 вывода', 'Enhancement N-MOSFET', 28, null, null, 'unknown', 3),
    t(3004, 10, 'pmos-em', 'P-МОП, обогащение, 3 вывода', 'Enhancement P-MOSFET', 29, null, null, 'unknown', 3),
    t(3004, 11, 'nmos-emb', 'N-МОП, обогащение, 4 вывода', 'Enhancement N-MOSFET (4 terminal)', 30, null, null, 'unknown', 4),
    t(3004, 12, 'pmos-emb', 'P-МОП, обогащение, 4 вывода', 'Enhancement P-MOSFET (4 terminal)', 31, null, null, 'unknown', 4),
    t(3004, 13, 'nmesfet', 'Полевой транзистор Шоттки n-канал', 'N-Channel MESFET', null, 'nmesfet', 'nmes.par', 'unknown', 3),
    t(3004, 14, 'pmesfet', 'Полевой транзистор Шоттки p-канал', 'P-Channel MESFET', null, 'pmesfet', 'pmes.par', 'unknown', 3),

    // --- Аналоговые ИС (3005), 6: 1 примитив + 5 книжных ---------------------
    t(3005, 1, 'opamp-3t', 'Операционный усилитель, 3 вывода', '3-Terminal Opamp', 15, null, null, 'unknown', 3),
    t(3005, 2, 'opamp', 'Операционный усилитель', 'Opamp', null, 'opamp', 'opamp.par', 'unknown', 5),
    t(3005, 3, 'opamp-7t', 'Операционный усилитель, 7 выводов', '7-Terminal Opamp', null, '7oamp', '7oamp.par', 'unknown', 7),
    t(3005, 4, 'opamp-9t', 'Операционный усилитель, 9 выводов', '9-Terminal Opamp', null, '9oamp', '9oamp.par', 'unknown', 9),
    t(3005, 5, 'comparator', 'Компаратор', 'Comparator', null, 'comp', 'comp.par', 'unknown', 5),
    t(3005, 6, 'pll', 'ФАПЧ', 'Phase-Locked Loop', null, 'pll', 'pll.par', 'unknown', 8, 'inferred'),

    // --- Смешанные ИС (3006), 5 ---------------------------------------------
    t(3006, 1, 'adc', 'АЦП', 'A/D Converter', null, 'AD', 'ad.par', 'unknown', 6, 'inferred'),
    t(3006, 2, 'dac-i', 'ЦАП по току', 'D/A Converter (current)', null, 'DA', 'da.par', 'unknown', 5),
    t(3006, 3, 'dac-v', 'ЦАП по напряжению', 'D/A Converter (voltage)', null, 'VDA', 'vda.par', 'unknown', 5),
    t(3006, 4, 'mono', 'Одновибратор (моностабильный)', 'Mono', null, 'Mono', 'mono.par', 'unknown', 4),
    t(3006, 5, 'ic-555', 'Таймер 555', '555 Timer', null, '555', '555.par', 'unknown', 8),

    // --- Цифровые ИС (3007), 6 (шаблоны серий, CHIP 658) ---------------------
    t(3007, 1, 'ic-74xx', 'ИС серии 74xx', '74xx Series', null, 'Template740', 'tpl70.par', 'unknown', 0),
    t(3007, 2, 'ic-741xx', 'ИС серии 741xx', '741xx Series', null, 'Template741', 'tpl71.par', 'unknown', 0),
    t(3007, 3, 'ic-742xx', 'ИС серии 742xx', '742xx Series', null, 'Template742', 'tpl72.par', 'unknown', 0),
    t(3007, 4, 'ic-743xx', 'ИС серии 743xx', '743xx Series', null, 'Template743', 'tpl73.par', 'unknown', 0),
    t(3007, 5, 'ic-744xx', 'ИС серии 744xx', '744xx Series', null, 'Template744', 'tpl74.par', 'unknown', 0),
    t(3007, 6, 'ic-4xxx', 'ИС серии 4xxx', '4xxx Series', null, 'Template4', 'tpl4x.par', 'unknown', 0),

    // --- Логические элементы (3008), 18: 10 + 8 шаблонов ---------------------
    t(3008, 1, 'and2', 'И', 'AND', null, 'And2', 'and2.par', 'unknown', 3),
    t(3008, 2, 'or2', 'ИЛИ', 'OR', null, 'Or2', 'or2.par', 'unknown', 3),
    t(3008, 3, 'not', 'НЕ', 'NOT', null, 'Not', 'not.par', 'unknown', 2),
    t(3008, 4, 'nor2', 'ИЛИ-НЕ', 'NOR', null, 'Nor2', 'nor2.par', 'unknown', 3),
    t(3008, 5, 'nand2', 'И-НЕ', 'NAND', null, 'Nand2', 'nand2.par', 'unknown', 3),
    t(3008, 6, 'xor2', 'Исключающее ИЛИ', 'XOR', null, 'Xor2', 'xor2.par', 'unknown', 3),
    t(3008, 7, 'xnor2', 'Исключающее ИЛИ-НЕ', 'XNOR', null, 'Xnor2', 'xnor2.par', 'unknown', 3),
    t(3008, 8, 'tri-state', 'Трёхстабильный буфер', 'Tri-state Buffer', null, 'Tri', 'tri.par', 'unknown', 3),
    t(3008, 9, 'buffer', 'Буфер', 'Buffer', null, 'Buf', 'buf.par', 'unknown', 2),
    t(3008, 10, 'schmitt', 'Триггер Шмитта', 'Schmitt Trigger', null, 'Schmitt', 'schmt.par', 'unknown', 3),
    t(3008, 11, 'template-and', 'Шаблон: И', 'AND Template', null, 'TemplateAnd', 'tpl7.par', 'unknown', 3),
    t(3008, 12, 'template-or', 'Шаблон: ИЛИ', 'OR Template', null, 'TemplateOr', 'tpl9.par', 'unknown', 3),
    t(3008, 13, 'template-nand', 'Шаблон: И-НЕ', 'NAND Template', null, 'TemplateNand', 'tpl8.par', 'unknown', 3),
    t(3008, 14, 'template-nor', 'Шаблон: ИЛИ-НЕ', 'NOR Template', null, 'TemplateNor', 'tpl10.par', 'unknown', 3),
    t(3008, 15, 'template-not', 'Шаблон: НЕ', 'NOT Template', null, 'TemplateNot', 'tpl13.par', 'unknown', 2),
    t(3008, 16, 'template-xor', 'Шаблон: Исключающее ИЛИ', 'XOR Template', null, 'TemplateXor', 'tpl11.par', 'unknown', 3),
    t(3008, 17, 'template-xnor', 'Шаблон: Исключающее ИЛИ-НЕ', 'XNOR Template', null, 'TemplateXnor', 'tpl12.par', 'unknown', 3),
    t(3008, 18, 'template-buf', 'Шаблон: буфер', 'Buffer Template', null, 'TemplateBuf', 'tpl14.par', 'unknown', 2),

    // --- Цифровые (3009), 14: 7 триггеров + 7 шаблонов ----------------------
    t(3009, 1, 'half-adder', 'Полусумматор', 'Half Adder', null, 'HA', 'ha.par', 'unknown', 4),
    t(3009, 2, 'full-adder', 'Полный сумматор', 'Full Adder', null, 'FA', 'fa.par', 'unknown', 5),
    t(3009, 3, 'rs-ff', 'RS-триггер', 'RS Flip-Flop', null, 'RS', 'rs_ff.par', 'unknown', 4),
    t(3009, 4, 'jk-ff-3', 'JK-триггер с тремя входами', 'JK Flip-Flop (3 inputs)', null, 'JK3', 'jk_ff.par', 'unknown', 5),
    t(3009, 5, 'jk-ff', 'JK-триггер', 'JK Flip-Flop', null, 'JK', 'jkn.par', 'unknown', 5),
    t(3009, 6, 'd-ff', 'D-триггер', 'D Flip-Flop', null, 'D', 'd_ff.par', 'unknown', 4),
    t(3009, 7, 'd-ff-neg', 'D-триггер с инверсным выходом', 'D Flip-Flop (inverted)', null, 'DN', 'dn.par', 'unknown', 4),
    t(3009, 8, 'mux', 'Мультиплексор', 'Multiplexer', null, 'TemplateMux', 'tpl4.par', 'unknown', 3),
    t(3009, 9, 'decoder', 'Дешифратор / демультиплексор', 'Decoder / Demux', null, 'TemplateDecDemux', 'tpl5.par', 'unknown', 3),
    t(3009, 10, 'encoder', 'Шифратор', 'Encoder', null, 'TemplateEnc', 'tpl15.par', 'unknown', 3),
    t(3009, 11, 'arithmetic', 'Арифметические устройства', 'Arithmetic', null, 'TemplateAri', 'tpl1.par', 'unknown', 3),
    t(3009, 12, 'counter', 'Счётчик', 'Counter', null, 'TemplateCou', 'tpl2.par', 'unknown', 3),
    t(3009, 13, 'shift', 'Сдвиговый регистр', 'Shift Register', null, 'TemplateShf', 'tpl3.par', 'unknown', 3),
    t(3009, 14, 'flip-flop-template', 'Триггеры (шаблон)', 'Flip-Flops', null, 'TemplateFli', 'tpl6.par', 'unknown', 3),

    // --- Индикаторы (3010), 9: 4 примитива + 5 книжных ----------------------
    t(3010, 1, 'voltmeter', 'Вольтметр', 'Voltmeter', 13, null, null, 'meter', 2),
    t(3010, 2, 'ammeter', 'Амперметр', 'Ammeter', 12, null, null, 'meter', 2),
    t(3010, 3, 'bulb', 'Лампа накаливания', 'Bulb', 18, null, null, 'unknown', 2),
    t(3010, 4, 'beeper', 'Звукоизлучатель', 'Beeper', null, 'beeper', 'beep.par', 'unknown', 2),
    t(3010, 5, 'seg7', 'Семисегментный индикатор', '7-Segment Display', null, 'Seg7', '7seg.par', 'unknown', 8),
    t(3010, 6, 'seg7d', 'Семисегментный индикатор с точкой', '7-Segment Display (decimal)', null, 'Seg7D', '7segd.par', 'unknown', 9),
    t(3010, 7, 'fuse', 'Предохранитель', 'Fuse', 19, null, null, 'unknown', 2),
    t(3010, 8, 'bar', 'Линейный индикатор (столбик)', 'Bar Display', null, 'bar', 'bar.par', 'unknown', 2),
    t(3010, 9, 'dbar', 'Линейный индикатор (точка)', 'Dot Bar Display', null, 'dbar', 'dbar.par', 'unknown', 2),

    // --- Управление (3011), 12 (группа 662) ---------------------------------
    t(3011, 1, 'differentiator', 'Дифференциатор', 'Differentiator', null, 'diff', 'diff.par', 'unknown', 4),
    t(3011, 2, 'integrator', 'Интегратор', 'Integrator', null, 'int', 'int.par', 'unknown', 4),
    t(3011, 3, 'gain', 'Масштабирующее звено', 'Gain Block', null, 'gain', 'gain.par', 'unknown', 4),
    t(3011, 4, 'transconductance', 'Преобразователь проводимости', 'Transconductance Block', null, 'tran', 'tran.par', 'unknown', 4),
    t(3011, 5, 'multiplier', 'Умножитель', 'Multiplier', null, 'mult', 'mult.par', 'unknown', 4),
    t(3011, 6, 'divider', 'Делитель', 'Divider', null, 'div', 'div.par', 'unknown', 4),
    t(3011, 7, 'summer', 'Сумматор', 'Summer', null, 'sum', 'sum.par', 'unknown', 4),
    t(3011, 8, 'limiter', 'Ограничитель', 'Limiter', null, 'lim', 'lim.par', 'unknown', 4),
    t(3011, 9, 'voltage-limiter', 'Ограничитель напряжения', 'Voltage Limiter', null, 'conlimit', 'vclim.par', 'unknown', 4),
    t(3011, 10, 'current-limiter', 'Ограничитель тока', 'Current Limiter', null, 'curlimit', 'cclim.par', 'unknown', 4),
    t(3011, 11, 'hysteresis', 'Звено с гистерезисом', 'Hysteresis Block', null, 'hyst', 'hyter.par', 'unknown', 4),
    t(3011, 12, 'slew', 'Ограничитель скорости нарастания', 'Slew Rate Block', null, 'slew', 'slewr.par', 'unknown', 4),

    // --- Прочее (3012), 13: 12 книжных (группа 663) + 1 трансформатор -------
    t(3012, 1, 'lossy-line', 'Линия передачи с потерями', 'Lossy Transmission Line', null, 'lotra', 'lotra.par', 'unknown', 2),
    t(3012, 2, 'table', 'Таблица состояний', 'Table', null, 'Table', 'table.par', 'unknown', 8, 'inferred'),
    t(3012, 3, 'net8', 'Восьмиразрядная шина', 'Net8', null, 'net8', 'nt16.par', 'unknown', 8),
    t(3012, 4, 'nonlinear-transformer-2', 'Нелинейный трансформатор (библиотечный)', 'Nonlinear Transformer', null, 'nltrnfr', 'ntsf.par', 'unknown', 4, 'inferred'),
    t(3012, 5, 'transformer-library', 'Трансформатор (библиотечный)', 'Transformer', null, 'trans', 'trans.par', 'unknown', 4, 'inferred'),
    t(3012, 6, 'crystal', 'Кварцевый резонатор', 'Crystal', null, 'cryst', 'cryst.par', 'unknown', 2),
    t(3012, 7, 'vacuum-tube', 'Электронная лампа', 'Vacuum Tube', null, 'vacum', 'vactb.par', 'unknown', 3),
    t(3012, 8, 'motor', 'Двигатель постоянного тока', 'DC Motor', null, 'motr', 'dcmot.par', 'unknown', 2),
    t(3012, 9, 'boost', 'Повышающий преобразователь', 'Boost Converter', null, 'boost', 'boost.par', 'unknown', 3),
    t(3012, 10, 'buck', 'Понижающий преобразователь', 'Buck Converter', null, 'buck', 'buck.par', 'unknown', 3),
    t(3012, 11, 'buck-boost', 'Инвертирующий преобразователь', 'Buck-Boost Converter', null, 'bckbst', 'bckbt.par', 'unknown', 3),
    t(3012, 12, 'text-box', 'Текст', 'Text Box', null, 'textbox', 'textb.par', 'unknown', 0),
    t(3012, 13, 'title-block', 'Основная надпись', 'Title Block', null, 'titleblk', 'title.par', 'unknown', 0),

    // --- Приборы (3013), 7 (встроенные, без PartNum/ExtComp) ----------------
    t(3013, 1, 'multimeter', 'Мультиметр', 'Multimeter', null, null, null, 'unknown', 2),
    t(3013, 2, 'oscilloscope', 'Осциллограф', 'Oscilloscope', null, null, null, 'unknown', 3),
    t(3013, 3, 'function-generator', 'Генератор сигналов', 'Signal Generator', null, null, null, 'unknown', 3),
    t(3013, 4, 'curve-tracer', 'Характериограф', 'IV Analyzer', null, null, null, 'unknown', 3),
    t(3013, 5, 'logic-analyzer', 'Логический анализатор', 'Logic Analyzer', null, null, null, 'unknown', 5),
    t(3013, 6, 'bode-plotter', 'Измеритель АЧХ', 'Bode Plotter', null, null, null, 'unknown', 3),
    t(3013, 7, 'logic-probe', 'Логический пробник', 'Logic Probe', null, null, null, 'unknown', 2)
];

// Плитка источника: `ewb-<лента>-<индекс>` (совпадает с `source` в манифесте).
export const tileId = (tile) => `ewb-${tile.strip}-${String(tile.index).padStart(2, '0')}`;

// Упорядоченный список id вкладки — для interface.js (idListComponent).
export function idListFor(key) {
    const tab = TABS.find((x) => x.key === key);
    if (!tab) return [];
    return TILES.filter((x) => x.strip === tab.strip).sort((a, b) => a.index - b.index).map((x) => x.id);
}
