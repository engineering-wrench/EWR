#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Оракульный шим поверх XSPICE32.DLL (запускается 32-битным Python под Wine).

Подключает настоящий движок EWB 5.12 (XSPICE32.DLL) через штатный интерфейс
IFsimulator (XSPIinit) — тот же путь, которым пользуется WEWB32.EXE, —
строит цепь из JSON-описания, гоняет анализы и снимает результаты через
колбэки фронтенда OUTpBeginPlot/OUTpData/OUTendPlot (это и есть «сырые»
данные движка до форматирования приборами).

Разведка DLL (сессия 2026-10):
  * соглашение вызова экспортов — stdcall (`ret $0x10`);
  * XSPIinit(frontEnd, &sim) копирует 22 указателя из frontEnd (F4-раскладка
    + 7 EWB-полей) и заменяет поля 5/6/7/11/14 своими split_*-обёртками;
  * split_*-обёртки вызывают внутреннюю реализацию OUT*, затем НАШ колбэк;
    у beginPlot arg9 заменяется на адрес внутреннего глобала (0x51a1b8) —
    писать по этому указателю НЕЛЬЗЯ (это состояние DLL);
  * при OUTpData первый аргумент колбэка — тот же внутренний глобал
    (постоянный), поэтому «какой plot» отслеживаем сами (стек открытых).

Запуск:
    python.exe shim.py --dll XSPICE32.DLL --enumerate
    python.exe shim.py --dll XSPICE32.DLL --deck deck.json --out out.json
"""

import argparse
import ctypes
import json
import os
import sys
import traceback
from ctypes import (
    POINTER,
    byref,
    c_char_p,
    c_double,
    c_int,
    c_void_p,
    cast,
)

WINFUNCTYPE = ctypes.WINFUNCTYPE

# --- Типы-флаги IFparm/IFvalue (include/sim/IFsim.h) ---------------------------

IF_FLAG = 0x1
IF_INTEGER = 0x2
IF_REAL = 0x4
IF_COMPLEX = 0x8
IF_NODE = 0x10
IF_STRING = 0x20
IF_INSTANCE = 0x40
IF_PARSETREE = 0x80
IF_VECTOR = 0x8000
IF_VARTYPES = 0x80FF

OK = 0


class IFcomplex(ctypes.Structure):
    _fields_ = [("real", c_double), ("imag", c_double)]


class IFparm(ctypes.Structure):
    _fields_ = [
        ("keyword", c_char_p),
        ("id", c_int),
        ("dataType", c_int),
        ("description", c_char_p),
    ]


class IFvalueVec(ctypes.Union):
    _fields_ = [
        ("iVec", c_void_p),
        ("rVec", c_void_p),
        ("cVec", c_void_p),
        ("sVec", c_void_p),
        ("uVec", c_void_p),
        ("nVec", c_void_p),
    ]


class IFvalueV(ctypes.Structure):
    _fields_ = [("numValue", c_int), ("vec", IFvalueVec)]


class IFvalue(ctypes.Union):
    _fields_ = [
        ("iValue", c_int),
        ("rValue", c_double),
        ("cValue", IFcomplex),
        ("sValue", c_char_p),
        ("uValue", c_void_p),
        ("nValue", c_void_p),
        ("tValue", c_void_p),
        ("v", IFvalueV),
    ]


class IFdevice(ctypes.Structure):
    # Раскладка линии v9 (F4-стиль): указатели на счётчики (разведка 2026-10).
    _fields_ = [
        ("name", c_char_p),
        ("description", c_char_p),
        ("terms", POINTER(c_int)),
        ("numNames", POINTER(c_int)),
        ("termNames", POINTER(c_char_p)),
        ("numInstanceParms", POINTER(c_int)),
        ("instanceParms", POINTER(IFparm)),
        ("numModelParms", POINTER(c_int)),
        ("modelParms", POINTER(IFparm)),
    ]


class IFanalysis(ctypes.Structure):
    _fields_ = [
        ("name", c_char_p),
        ("description", c_char_p),
        ("numParms", c_int),
        ("analysisParms", POINTER(IFparm)),
    ]


class IFsimulator(ctypes.Structure):
    _fields_ = [
        ("simulator", c_char_p),
        ("description", c_char_p),
        ("version", c_char_p),
        ("newCircuit", c_void_p),
        ("deleteCircuit", c_void_p),
        ("newNode", c_void_p),
        ("groundNode", c_void_p),
        ("bindNode", c_void_p),
        ("findNode", c_void_p),
        ("instToNode", c_void_p),
        ("setNodeParm", c_void_p),
        ("askNodeQuest", c_void_p),
        ("deleteNode", c_void_p),
        ("newInstance", c_void_p),
        ("setInstanceParm", c_void_p),
        ("askInstanceQuest", c_void_p),
        ("findInstance", c_void_p),
        ("deleteInstance", c_void_p),
        ("newModel", c_void_p),
        ("setModelParm", c_void_p),
        ("askModelQuest", c_void_p),
        ("findModel", c_void_p),
        ("deleteModel", c_void_p),
        ("newTask", c_void_p),
        ("newAnalysis", c_void_p),
        ("setAnalysisParm", c_void_p),
        ("askAnalysisQuest", c_void_p),
        ("findAnalysis", c_void_p),
        ("findTask", c_void_p),
        ("deleteTask", c_void_p),
        ("doAnalyses", c_void_p),
        ("nonconvErr", c_void_p),
        # --- 11 EWB-надстроек линии v9 (разведка DLL 2026-10) ---
        ("getMatrixElement", c_void_p),      # rva 0x99207
        ("getVoltage", c_void_p),            # rva 0x99246
        ("addVoltage", c_void_p),            # rva 0x9929e
        ("getCurrent", c_void_p),            # rva 0x992bf
        ("addCurrent", c_void_p),            # rva 0x992e8
        ("setBreakPoint", c_void_p),         # rva 0x98e70
        ("setRelativeBreakPoint", c_void_p), # rva 0x98ee9
        ("changeCapacitorValue", c_void_p),  # rva 0x438b1
        ("changeInductorValue", c_void_p),   # rva 0x48e84
        ("isFirstIteration", c_void_p),      # rva 0x92824
        ("setMaxStep", c_void_p),            # rva 0x9b8d4
        # --------------------------------------------------------
        ("numDevices", c_int),
        ("devices", POINTER(POINTER(IFdevice))),
        ("numAnalyses", c_int),
        ("analyses", POINTER(POINTER(IFanalysis))),
        ("numNodeParms", c_int),
        ("nodeParms", POINTER(IFparm)),
        ("numSpecSigs", c_int),
        ("specSigs", POINTER(c_char_p)),
    ]


# --- Колбэки фронтенда (F4-раскладка + 7 EWB-полей в хвосте) --------------------

IFNEWUID = WINFUNCTYPE(
    c_int, c_void_p, POINTER(c_void_p), c_void_p, c_char_p, c_int, POINTER(c_void_p)
)
IFDELUID = WINFUNCTYPE(c_int, c_void_p, c_void_p, c_int)
IFPAUSETEST = WINFUNCTYPE(c_int)
IFSECONDS = WINFUNCTYPE(c_double)
IFERROR = WINFUNCTYPE(c_int, c_int, c_char_p, POINTER(c_void_p))
OUTPBEGINPLOT = WINFUNCTYPE(
    c_int,
    c_void_p,
    c_void_p,
    c_void_p,
    c_void_p,
    c_int,
    c_int,
    POINTER(c_void_p),
    c_int,
    POINTER(c_void_p),
)
OUTPDATA = WINFUNCTYPE(c_int, c_void_p, POINTER(IFvalue), POINTER(IFvalue))
OUTWREFERENCE = WINFUNCTYPE(c_int, c_void_p, POINTER(IFvalue), POINTER(c_void_p))
OUTWDATA = WINFUNCTYPE(c_int, c_void_p, c_int, POINTER(IFvalue), c_void_p)
OUTENDPLOT = WINFUNCTYPE(c_int, c_void_p)
OUTBEGINDOMAIN = WINFUNCTYPE(c_int, c_void_p, c_void_p, c_int, POINTER(IFvalue))
OUTENDDOMAIN = WINFUNCTYPE(c_int, c_void_p)
OUTATTRIBUTES = WINFUNCTYPE(c_int, c_void_p, POINTER(c_void_p), c_int, POINTER(IFvalue))

# --- 7 EWB-колбэков сверх F4-раскладки (поля 15..21) ---------------------------
# Сигнатуры сняты с реальных реализаций в WEWB32.EXE (адреса 0x4fff9d, 0x500003,
# 0x5000e3, 0x5001a0, 0x50015b, 0x5014e5, 0x50cc6c; структура фронтенда WEWB32 —
# 0x58d289). Все stdcall, `ret N` соответствует числу аргументов:
#   f15()                      — «обновить UI после setup» (no args)
#   f16(double, double)        — прогресс TRAN (два времени из ckt+0x28/0x30)
#   f17(double)                — TRAN завершён (финальное время)
#   f18(double t, double *out) — опрос UI о точке останова; 0 = не просить
#   f19(int *count)            — опрос UI-объектов (сколько ещё ждут)
#   f20(void *s) -> void *     — вспомогательный поиск строки (для сообщений)
#   f21(int id) -> char *      — строка по id (движок сам чистит хвост varargs)
EWB0 = WINFUNCTYPE(c_int)
EWB1 = WINFUNCTYPE(c_int, c_double, c_double)
EWB2 = WINFUNCTYPE(c_int, c_double)
EWB3 = WINFUNCTYPE(c_int, c_double, POINTER(c_double))
EWB4 = WINFUNCTYPE(c_int, POINTER(c_int))
EWB5 = WINFUNCTYPE(c_void_p, c_void_p)
EWB6 = WINFUNCTYPE(c_void_p, c_int)


class FrontEnd(ctypes.Structure):
    _fields_ = [
        ("IFnewUid", IFNEWUID),
        ("IFdelUid", IFDELUID),
        ("IFpauseTest", IFPAUSETEST),
        ("IFseconds", IFSECONDS),
        ("IFerror", IFERROR),
        ("OUTpBeginPlot", OUTPBEGINPLOT),
        ("OUTpData", OUTPDATA),
        ("OUTwBeginPlot", OUTPBEGINPLOT),
        ("OUTwReference", OUTWREFERENCE),
        ("OUTwData", OUTWDATA),
        ("OUTwEnd", OUTENDPLOT),
        ("OUTendPlot", OUTENDPLOT),
        ("OUTbeginDomain", OUTBEGINDOMAIN),
        ("OUTendDomain", OUTENDDOMAIN),
        ("OUTattributes", OUTATTRIBUTES),
        # 7 EWB-полей сверх F4-раскладки (сигнатуры сняты с WEWB32.EXE)
        ("ewb1", EWB0),
        ("ewb2", EWB1),
        ("ewb3", EWB2),
        ("ewb4", EWB3),
        ("ewb5", EWB4),
        ("ewb6", EWB5),
        ("ewb7", EWB6),
    ]


# Глобальное состояние шима (живёт весь процесс)
PLOTS = {}          # plot_id -> {name, refName, refType, dataType, names, points, ended}
NEXT_PLOT_ID = [1]
OPEN_PLOTS = []     # стек открытых plot'ов (id)
ERRORS = []         # лог IFerror
KEEPALIVE = []      # буферы/строки, которые должны жить
LOG_STEPS = []


def _uid_to_str(p):
    if not p:
        return None
    try:
        return cast(p, c_char_p).value.decode("latin1")
    except Exception:
        return None


def cb_newuid(ckt, uidOut, name, typeName, typeCode, nodeOut):
    # Выдаём новый uid: просто сохраняем строку и возвращаем живой указатель.
    s = (_uid_to_str(name) or "auto").encode("latin1")
    buf = ctypes.create_string_buffer(s)
    KEEPALIVE.append(buf)
    if uidOut:
        uidOut[0] = cast(buf, c_void_p).value
    return OK


def cb_deluid(ckt, uid, typeCode):
    return OK


def cb_pausetest():
    return 0


def cb_seconds():
    # Для детерминизма статистики — ноль.
    return 0.0


def cb_error(flags, message, uid):
    msg = message.decode("latin1") if message else ""
    ERRORS.append({"flags": flags, "message": msg})
    sys.stderr.write("IFerror(%d): %s\n" % (flags, msg))
    return OK


def cb_beginplot(ckt, job, plotName, refName, refType, numNames, names, dataType, plotOut):
    pid = NEXT_PLOT_ID[0]
    NEXT_PLOT_ID[0] += 1
    nameList = []
    for i in range(numNames):
        nameList.append(_uid_to_str(names[i]) if names else None)
    PLOTS[pid] = {
        "id": pid,
        "name": _uid_to_str(plotName),
        "refName": _uid_to_str(refName),
        "refType": refType,
        "dataType": dataType,
        "names": nameList,
        "points": [],
        "ended": False,
    }
    OPEN_PLOTS.append(pid)
    LOG_STEPS.append(
        "plot#%d %s names=%d refType=%d dataType=%d"
        % (pid, PLOTS[pid]["name"], numNames, refType, dataType)
    )
    # ВАЖНО: plotOut указывает на внутренний глобал DLL — не пишем туда.
    return OK


def _read_vec_value(valuePtr):
    v = cast(valuePtr, POINTER(IFvalueV)).contents
    if v.numValue < 0 or v.numValue > 10000000:
        return None
    return int(v.numValue), v.vec


def cb_pdata(plotPtr, refPtr, valPtr):
    if not OPEN_PLOTS:
        # данные без открытого plot — создаём неявный
        cb_beginplot(None, None, None, None, IF_REAL, 0, None, IF_REAL, None)
    p = PLOTS[OPEN_PLOTS[-1]]
    ref = None
    if refPtr:
        if p["refType"] & IF_COMPLEX:
            cv = cast(refPtr, POINTER(IFcomplex)).contents
            ref = [cv.real, cv.imag]
        elif p["refType"] & IF_INTEGER:
            ref = cast(refPtr, POINTER(c_int)).contents.value
        else:
            ref = cast(refPtr, POINTER(c_double)).contents.value
    values = None
    if valPtr:
        nv = _read_vec_value(valPtr)
        if nv is not None:
            n, vec = nv
            if p["dataType"] & IF_COMPLEX:
                arr = cast(vec.cVec, POINTER(IFcomplex))
                values = [[arr[i].real, arr[i].imag] for i in range(n)]
            elif p["dataType"] & IF_INTEGER:
                arr = cast(vec.iVec, POINTER(c_int))
                values = [arr[i] for i in range(n)]
            else:
                arr = cast(vec.rVec, POINTER(c_double))
                values = [arr[i] for i in range(n)]
    p["points"].append({"ref": ref, "values": values})
    return OK


def cb_wreference(plotPtr, valuePtr, refOut):
    return OK


def cb_wdata(plotPtr, dataIndex, valuePtr, refPtr):
    return OK


def cb_endplot(plotPtr):
    if OPEN_PLOTS:
        pid = OPEN_PLOTS.pop()
        PLOTS[pid]["ended"] = True
    return OK


def cb_begindomain(plotPtr, domainName, typeCode, valuePtr):
    return OK


def cb_enddomain(plotPtr):
    return OK


def cb_attributes(plotPtr, namePtr, attr, valuePtr):
    if OPEN_PLOTS:
        p = PLOTS[OPEN_PLOTS[-1]]
        p["attributes"] = p.get("attributes", []) + [int(attr)]
    return OK


# --- Стабы 7 EWB-колбэков (поля 15..21) -----------------------------------------
# Логируем вызовы (первые EWB_LOG_LIMIT каждого вида) — это сами по себе данные
# оракула о внутренних временах движка (f16/f17) и частоте опросов UI (f18/f19).

EWB_CALLS = []          # [{cb: 1..7, args: [...]}]
EWB_COUNTS = [0] * 7
EWB_LOG_LIMIT = 200


def _ewb_log(cb, *args):
    EWB_COUNTS[cb - 1] += 1
    if len(EWB_CALLS) < EWB_LOG_LIMIT * 7:
        EWB_CALLS.append({"cb": cb, "args": list(args)})


def cb_ewb1_update():
    """f15: «обновить UI после setup»; возврат игнорируется."""
    _ewb_log(1)
    return OK


def cb_ewb2_progress(t1, t2):
    """f16: прогресс TRAN (два времени из ckt+0x28/0x30); возврат != -1 обязателен."""
    _ewb_log(2, float(t1), float(t2))
    return OK


def cb_ewb3_done(t):
    """f17: TRAN завершён (финальное время)."""
    _ewb_log(3, float(t))
    return OK


def cb_ewb4_breakpoint(t, out):
    """f18: опрос UI о точке останова; *out > 0 => движок выставит breakpoint."""
    _ewb_log(4, float(t))
    if out:
        out[0] = 0.0
    return OK


def cb_ewb5_pending(count):
    """f19: опрос UI-объектов (сколько ещё ждут); 0 => ничего."""
    _ewb_log(5)
    if count:
        count[0] = 0
    return OK


def cb_ewb6_strfind(s):
    """f20: поиск/подстановка строки (в путях сообщений); возвращаем аргумент."""
    _ewb_log(6, _uid_to_str(s))
    return s if s else 0


def cb_ewb7_strtable(idx):
    """f21: строка по id (таблица ds:0x5badfc в WEWB32); живой буфер."""
    _ewb_log(7, int(idx))
    buf = ctypes.create_string_buffer(("<ewb-%d>" % int(idx)).encode("latin1"))
    KEEPALIVE.append(buf)
    return cast(buf, c_void_p).value


def make_frontend():
    fe = FrontEnd(
        IFNEWUID(cb_newuid),
        IFDELUID(cb_deluid),
        IFPAUSETEST(cb_pausetest),
        IFSECONDS(cb_seconds),
        IFERROR(cb_error),
        OUTPBEGINPLOT(cb_beginplot),
        OUTPDATA(cb_pdata),
        OUTPBEGINPLOT(cb_beginplot),
        OUTWREFERENCE(cb_wreference),
        OUTWDATA(cb_wdata),
        OUTENDPLOT(cb_endplot),
        OUTENDPLOT(cb_endplot),
        OUTBEGINDOMAIN(cb_begindomain),
        OUTENDDOMAIN(cb_enddomain),
        OUTATTRIBUTES(cb_attributes),
        EWB0(cb_ewb1_update),
        EWB1(cb_ewb2_progress),
        EWB2(cb_ewb3_done),
        EWB3(cb_ewb4_breakpoint),
        EWB4(cb_ewb5_pending),
        EWB5(cb_ewb6_strfind),
        EWB6(cb_ewb7_strtable),
    )
    return fe


# --- Привязка вызовов таблицы IFsimulator ---------------------------------------

SIM_SIGS = {
    "newCircuit": (c_int, POINTER(c_void_p)),
    "deleteCircuit": (c_int, c_void_p),
    "newNode": (c_int, c_void_p, POINTER(c_void_p), c_char_p),
    "groundNode": (c_int, c_void_p, POINTER(c_void_p), c_char_p),
    "bindNode": (c_int, c_void_p, c_void_p, c_int, c_void_p),
    "findNode": (c_int, c_void_p, POINTER(c_void_p), c_char_p),
    "instToNode": (c_int, c_void_p, c_void_p, c_int, POINTER(c_void_p), POINTER(c_char_p)),
    "setNodeParm": (c_int, c_void_p, c_void_p, c_int, POINTER(IFvalue), POINTER(IFvalue)),
    "askNodeQuest": (c_int, c_void_p, c_void_p, c_int, POINTER(IFvalue), POINTER(IFvalue)),
    "newInstance": (c_int, c_void_p, c_void_p, POINTER(c_void_p), c_char_p),
    "setInstanceParm": (c_int, c_void_p, c_void_p, c_int, POINTER(IFvalue), POINTER(IFvalue)),
    "askInstanceQuest": (c_int, c_void_p, c_void_p, c_int, POINTER(IFvalue), POINTER(IFvalue)),
    "newModel": (c_int, c_void_p, c_int, POINTER(c_void_p), c_char_p),
    "setModelParm": (c_int, c_void_p, c_void_p, c_int, POINTER(IFvalue), POINTER(IFvalue)),
    "newTask": (c_int, c_void_p, POINTER(c_void_p), c_char_p),
    "newAnalysis": (c_int, c_void_p, c_int, c_char_p, POINTER(c_void_p), c_void_p),
    "setAnalysisParm": (c_int, c_void_p, c_void_p, c_int, POINTER(IFvalue), POINTER(IFvalue)),
    "doAnalyses": (c_int, c_void_p, c_int, c_void_p),
}


class Sim:
    """Обёртка над IFsimulator: имена устройств/анализов и вызовы с проверкой."""

    def __init__(self, lib, simPtr):
        self.lib = lib
        self.ptr = simPtr
        self.s = cast(simPtr, POINTER(IFsimulator)).contents
        self._fns = {}
        for name, (res, *args) in SIM_SIGS.items():
            raw = getattr(self.s, name)
            proto = WINFUNCTYPE(res, *args)
            self._fns[name] = proto(raw) if raw else None

    def call(self, name, *args):
        fn = self._fns.get(name)
        if fn is None:
            raise RuntimeError("нет функции %s в таблице симулятора" % name)
        return fn(*args)

    # --- каталог устройств/анализов ---

    def devices(self):
        out = []
        for i in range(self.s.numDevices):
            d = self.s.devices[i].contents

            def deref_int(p):
                return p[0] if p else 0

            def deref_parms(p, n):
                if not p or n <= 0:
                    return []
                return [
                    {
                        "keyword": _uid_to_str(p[k].keyword),
                        "id": p[k].id,
                        "dataType": p[k].dataType,
                        "description": _uid_to_str(p[k].description),
                    }
                    for k in range(n)
                ]

            numNames = deref_int(d.numNames)
            out.append(
                {
                    "index": i,
                    "name": d.name.decode("latin1") if d.name else None,
                    "description": d.description.decode("latin1") if d.description else None,
                    "terms": deref_int(d.terms),
                    "termNames": [
                        _uid_to_str(d.termNames[k]) for k in range(numNames)
                    ]
                    if d.termNames
                    else [],
                    "instanceParms": deref_parms(d.instanceParms, deref_int(d.numInstanceParms)),
                    "modelParms": deref_parms(d.modelParms, deref_int(d.numModelParms)),
                }
            )
        return out

    def device_index(self, name):
        for i in range(self.s.numDevices):
            d = self.s.devices[i].contents
            if d.name and d.name.decode("latin1").lower() == name.lower():
                return i
        return None

    def analyses(self):
        out = []
        for i in range(self.s.numAnalyses):
            a = self.s.analyses[i].contents
            out.append(
                {
                    "index": i,
                    "name": a.name.decode("latin1") if a.name else None,
                    "description": a.description.decode("latin1") if a.description else None,
                    "parms": [
                        {
                            "keyword": _uid_to_str(a.analysisParms[k].keyword),
                            "id": a.analysisParms[k].id,
                            "dataType": a.analysisParms[k].dataType,
                            "description": _uid_to_str(a.analysisParms[k].description),
                        }
                        for k in range(a.numParms)
                    ]
                    if a.analysisParms
                    else [],
                }
            )
        return out

    def analysis_index(self, name):
        for i in range(self.s.numAnalyses):
            a = self.s.analyses[i].contents
            if a.name and a.name.decode("latin1").lower() == name.lower():
                return i
        return None

    def node_parms(self):
        return [
            {
                "keyword": _uid_to_str(self.s.nodeParms[k].keyword),
                "id": self.s.nodeParms[k].id,
                "dataType": self.s.nodeParms[k].dataType,
                "description": _uid_to_str(self.s.nodeParms[k].description),
            }
            for k in range(self.s.numNodeParms)
        ]

    def spec_sigs(self):
        return [_uid_to_str(self.s.specSigs[k]) for k in range(self.s.numSpecSigs)]


# --- Построение цепи и запуск анализов ------------------------------------------


def find_parm(table, keyword):
    for p in table:
        if p["keyword"] and p["keyword"].lower() == keyword.lower():
            return p
    return None


def set_ifvalue(value, dataType):
    """Заполнить IFvalue по декларации IFparm.dataType.

    Поддерживает скаляры и IF_VECTOR (передаётся списком), напр. `pulse`
    у Vsource/Isource — real-вектор [v1 v2 td tr tf pw per (phase)].
    """
    v = IFvalue()
    base = dataType & IF_VARTYPES
    if base & IF_VECTOR:
        n = len(value)
        if base & IF_COMPLEX:
            arr = (IFcomplex * n)(*[IFcomplex(float(x[0]), float(x[1])) for x in value])
            v.v.vec.cVec = cast(arr, c_void_p)
        elif base & IF_INTEGER:
            arr = (c_int * n)(*[int(x) for x in value])
            v.v.vec.iVec = cast(arr, c_void_p)
        else:
            arr = (c_double * n)(*[float(x) for x in value])
            v.v.vec.rVec = cast(arr, c_void_p)
        v.v.numValue = n
        KEEPALIVE.append(arr)
        return v
    if base & IF_FLAG or base & IF_INTEGER:
        v.iValue = int(value)
    elif base & IF_REAL:
        v.rValue = float(value)
    elif base & IF_STRING:
        buf = ctypes.create_string_buffer(str(value).encode("latin1"))
        KEEPALIVE.append(buf)
        v.sValue = cast(buf, c_char_p)
    elif base & IF_COMPLEX:
        v.cValue = IFcomplex(float(value[0]), float(value[1]))
    else:
        v.rValue = float(value)
    return v


def build_and_run(lib, sim, deck):
    # В таблице DLL есть model-only записи ('capacitor'=0 выводов рядом с
    # 'Capacitor'=2) — при совпадении имени берём запись с выводами.
    devs = {}
    for d in sim.devices():
        key = d["name"].lower()
        if key not in devs or d["terms"] > devs[key]["terms"]:
            devs[key] = d
    anals = {a["name"].lower(): a for a in sim.analyses()}

    ckt = c_void_p()
    rc = sim.call("newCircuit", byref(ckt))
    if rc != OK:
        raise RuntimeError("newCircuit rc=%d" % rc)

    nodes = {}
    gnd = c_void_p()
    gname = ctypes.create_string_buffer(b"0")
    KEEPALIVE.append(gname)
    rc = sim.call("groundNode", ckt, byref(gnd), cast(gname, c_char_p))
    if rc != OK:
        raise RuntimeError("groundNode rc=%d" % rc)
    nodes["0"] = gnd

    def ensure_node(name):
        if name in nodes:
            return nodes[name]
        nb = ctypes.create_string_buffer(name.encode("latin1"))
        KEEPALIVE.append(nb)
        np_ = c_void_p()
        rc = sim.call("newNode", ckt, byref(np_), cast(nb, c_char_p))
        if rc != OK:
            raise RuntimeError("newNode(%s) rc=%d" % (name, rc))
        nodes[name] = np_
        return np_

    reports = []
    for el in deck.get("elements", []):
        devName = el["dev"].lower()
        d = devs.get(devName)
        if d is None:
            raise RuntimeError("устройство %r отсутствует в DLL" % el["dev"])
        modelName = el.get("model") or ("%s_mod" % el["name"])
        mb = ctypes.create_string_buffer(modelName.encode("latin1"))
        KEEPALIVE.append(mb)
        model = c_void_p()
        rc = sim.call("newModel", ckt, d["index"], byref(model), cast(mb, c_char_p))
        if rc != OK:
            raise RuntimeError("newModel(%s) rc=%d" % (modelName, rc))
        for k, v in (el.get("modelParams") or {}).items():
            p = find_parm(d["modelParms"], k)
            if p is None:
                raise RuntimeError("нет параметра модели %r у %s" % (k, devName))
            val = set_ifvalue(v, p["dataType"])
            rc = sim.call("setModelParm", ckt, model, p["id"], byref(val), None)
            if rc != OK:
                raise RuntimeError("setModelParm(%s.%s) rc=%d" % (devName, k, rc))
        nb = ctypes.create_string_buffer(el["name"].encode("latin1"))
        KEEPALIVE.append(nb)
        inst = c_void_p()
        rc = sim.call("newInstance", ckt, model, byref(inst), cast(nb, c_char_p))
        if rc != OK:
            raise RuntimeError("newInstance(%s) rc=%d" % (el["name"], rc))
        for k, v in (el.get("params") or {}).items():
            p = find_parm(d["instanceParms"], k)
            if p is None:
                raise RuntimeError("нет инстанс-параметра %r у %s" % (k, devName))
            val = set_ifvalue(v, p["dataType"])
            rc = sim.call("setInstanceParm", ckt, inst, p["id"], byref(val), None)
            if rc != OK:
                raise RuntimeError("setInstanceParm(%s.%s) rc=%d" % (el["name"], k, rc))
        for term, nodeName in enumerate(el["nodes"], start=1):
            nodep = ensure_node(nodeName)
            rc = sim.call("bindNode", ckt, inst, term, nodep)
            if rc != OK:
                raise RuntimeError("bindNode(%s,%d) rc=%d" % (el["name"], term, rc))
        reports.append({"name": el["name"], "dev": devName})

    tb = ctypes.create_string_buffer(b"task1")
    KEEPALIVE.append(tb)
    task = c_void_p()
    rc = sim.call("newTask", ckt, byref(task), cast(tb, c_char_p))
    if rc != OK:
        raise RuntimeError("newTask rc=%d" % rc)

    for an in deck.get("analyses", []):
        aName = an["type"].lower()
        a = anals.get(aName)
        if a is None:
            raise RuntimeError("анализ %r отсутствует в DLL" % an["type"])
        jb = ctypes.create_string_buffer(an["name"].encode("latin1"))
        KEEPALIVE.append(jb)
        job = c_void_p()
        rc = sim.call("newAnalysis", ckt, a["index"], cast(jb, c_char_p), byref(job), task)
        if rc != OK:
            raise RuntimeError("newAnalysis(%s) rc=%d" % (an["type"], rc))
        for k, v in (an.get("params") or {}).items():
            p = find_parm(a["parms"], k)
            if p is None:
                raise RuntimeError("нет параметра %r у анализа %s" % (k, an["type"]))
            val = set_ifvalue(v, p["dataType"])
            rc = sim.call("setAnalysisParm", ckt, job, p["id"], byref(val), None)
            if rc != OK:
                raise RuntimeError("setAnalysisParm(%s.%s) rc=%d" % (an["type"], k, rc))

    rc = sim.call("doAnalyses", ckt, 1, task)  # RESTART=1
    return {"doAnalyses_rc": rc, "elements": reports}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dll", required=True)
    ap.add_argument("--deck")
    ap.add_argument("--out")
    ap.add_argument("--enumerate", action="store_true")
    args = ap.parse_args()

    lib = ctypes.WinDLL(args.dll)
    lib.XSPIinit.restype = c_int
    lib.XSPIinit.argtypes = [POINTER(FrontEnd), POINTER(c_void_p)]

    fe = make_frontend()
    KEEPALIVE.append(fe)
    simPtr = c_void_p()
    rc = lib.XSPIinit(byref(fe), byref(simPtr))
    if rc != OK or not simPtr:
        raise RuntimeError("XSPIinit rc=%d ptr=%s" % (rc, simPtr))

    sim = Sim(lib, simPtr)

    result = {
        "dll": os.path.basename(args.dll),
        "simulator": sim.s.simulator.decode("latin1") if sim.s.simulator else None,
        "description": sim.s.description.decode("latin1") if sim.s.description else None,
        "version": sim.s.version.decode("latin1") if sim.s.version else None,
    }

    if args.enumerate:
        result["devices"] = sim.devices()
        result["analyses"] = sim.analyses()
        result["nodeParms"] = sim.node_parms()
        result["specSigs"] = sim.spec_sigs()
    elif args.deck:
        with open(args.deck, "r", encoding="utf-8") as f:
            deck = json.load(f)
        result.update(build_and_run(lib, sim, deck))
        result["errors"] = ERRORS
        result["plots"] = [PLOTS[k] for k in sorted(PLOTS.keys())]
        result["steps"] = LOG_STEPS
        result["ewbCalls"] = EWB_CALLS
        result["ewbCounts"] = list(EWB_COUNTS)

    text = json.dumps(result, ensure_ascii=True, indent=1)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        sys.stdout.write(text + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(2)
