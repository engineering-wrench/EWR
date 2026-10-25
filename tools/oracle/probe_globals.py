#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Проба глобалов XSPICE32.DLL после `XSPIinit` (запускать 32-битным Python под Wine).

Что проверяет (см. `docs/re/engine-behavior.md` §4.5 и §5.3):
  * константы CONSTroot2 / CONSTvt0 / CONSTKoverQ / CONSTe (адреса 0x544e2c..);
  * SPfrontEnd (0x5100cc), «второй» указатель фронтенда (0x51a1b4);
  * копию таблицы фронтенда (0x545bf0) — какие OUT-поля DLL подменила
    своими `split_*`-обёртками.

Запуск (из папки vendor/py32, как и шим):
    cd vendor/py32 && WINEDEBUG=-all wine python.exe -u \
        'Z:\\...\\EWR\\tools\\oracle\\probe_globals.py'

Скрипт read-only: DLL не модифицируется, колбэки-пустышки не вызываются
(XSPIinit лишь копирует таблицу фронтенда).
"""

import ctypes
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _here)
import shim  # noqa: E402  (оракульный шим: типы FrontEnd и make_frontend)

DLL = os.environ.get("EWR_DLL") or os.path.join(_here, "..", "..", "EWB512", "XSPICE32.DLL")
DLL = os.path.abspath(DLL)

# --- инфо из дизассемблера (предпочтительная база образа 0x400000) ---------------
CONST_ADDRS = [
    (0x544E2C, "CONSTroot2"),
    (0x544E34, "CONSTvt0"),
    (0x544E3C, "CONSTKoverQ"),
    (0x544E44, "CONSTe"),
]
G_SPFRONTEND = 0x5100CC  # SPfrontEnd
G_FRONTEND2 = 0x51A1B4   # второй указатель на таблицу фронтенда
G_SIMINFO = 0x5100F0     # *description из XSPIinit
FE_COPY = 0x545BF0       # копия таблицы фронтенда (22 указателя)
FE_COPY_LEN = 0x16       # dword'ов
SPLIT_FIELDS = {0x14, 0x18, 0x1C, 0x2C, 0x38}  # OUT-поля, подменённые split_*
PREFERRED_BASE = 0x400000


def main():
    if not os.path.exists(DLL):
        sys.exit("DLL не найдена: %s" % DLL)

    lib = ctypes.WinDLL(DLL)
    lib.XSPIinit.restype = ctypes.c_int
    lib.XSPIinit.argtypes = [ctypes.POINTER(shim.FrontEnd), ctypes.POINTER(ctypes.c_void_p)]

    fe = shim.make_frontend()
    shim.KEEPALIVE.append(fe)
    sim_ptr = ctypes.c_void_p()
    rc = lib.XSPIinit(ctypes.byref(fe), ctypes.byref(sim_ptr))
    print("XSPIinit rc=%d sim=0x%08x" % (rc, sim_ptr.value or 0))

    base = ctypes.windll.kernel32.GetModuleHandleA(b"xspice32.dll")

    def addr(va):  # адрес дизассемблера -> фактический (Wine грузит по своей базе)
        return base + (va - PREFERRED_BASE)

    def dbl(va):
        return ctypes.c_double.from_buffer_copy(ctypes.string_at(addr(va), 8)).value

    def i32(va):
        return ctypes.c_int32.from_buffer_copy(ctypes.string_at(addr(va), 4)).value

    print("base = 0x%08x (предпочтительная 0x%08x)" % (base, PREFERRED_BASE))
    for va, name in CONST_ADDRS:
        print("%-12s @0x%08x = %.17g" % (name, va, dbl(va)))
    print("SPfrontEnd  (0x%08x) = 0x%08x" % (G_SPFRONTEND, i32(G_SPFRONTEND)))
    print("frontEnd2   (0x%08x) = 0x%08x" % (G_FRONTEND2, i32(G_FRONTEND2)))
    print("simInfo     (0x%08x) = 0x%08x" % (G_SIMINFO, i32(G_SIMINFO)))
    print("fe(аргумент XSPIinit)  = 0x%08x" % ctypes.cast(ctypes.byref(fe), ctypes.c_void_p).value)
    print("копия таблицы фронтенда @0x%08x:" % FE_COPY)
    for k in range(FE_COPY_LEN):
        off = 4 * k
        mark = "  <- split_*" if off in SPLIT_FIELDS else ""
        print("   +0x%02x = 0x%08x%s" % (off, i32(FE_COPY + off), mark))


if __name__ == "__main__":
    main()
