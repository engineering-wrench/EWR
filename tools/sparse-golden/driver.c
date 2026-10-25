/*
 *  driver.c — тестовый драйвер C-эталона Sparse 1.3 (vendor/spice3f4).
 *
 *  Не часть движка EWR: это golden-инструмент для 1:1 сверки JS-порта
 *  (Site/engine/spice/sparse.js) с оригиналом. Читает построчный скрипт из
 *  stdin, выполняет те же вызовы, что JS-интерпретатор в
 *  Site/engine/test/sparse-golden.test.mjs, и печатает результаты в
 *  каноническом виде (double — "%.17g", round-trip).
 *
 *  Сборка (см. tools/sparse-golden/build.mjs):
 *      gcc -O0 -ffp-contract=off -w -I shim -I $V/include -I $V/lib/sparse
 *          driver.c spalloc.c spbuild.c spfactor.c spsolve.c sputils.c spsmp.c -lm
 */
#define spINSIDE_SPARSE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "spconfig.h"
#include "spmatrix.h"
#include "spdefs.h"
#include "smpdefs.h"

/* Функции spsmp.c, не объявленные в smpdefs.h */
extern int SMPcZeroCol(SMPmatrix *, int);
extern int SMPcAddCol(SMPmatrix *, int, int);
extern int SMPzeroRow(SMPmatrix *, int);
extern int SMPcDProd(SMPmatrix *, SPcomplex *, int *);
extern void SMPcaSolve(SMPmatrix *, double [], double [], double [], double []);

/* ── Учёт памяти для ALLOC/FREE из spdefs.h ── */
char *tmalloc(unsigned num) {
    return (char *) malloc(num ? num : 1);
}
char *trealloc(char *ptr, unsigned num) {
    return (char *) realloc(ptr, num ? num : 1);
}
void txfree(char *ptr) {
    if (ptr) free(ptr);
}

static char *M = NULL;

static void pv(double v) {
    printf(" %.17g", v);
}

/* Col не инициализируется до spcLinkRows (в release — только под #if DEBUG),
 * поэтому в дампе нормализуем его к 0: до линковки алгоритмы Col не читают,
 * а сверка с JS должна быть детерминированной. */
static int colOf(MatrixPtr m, ElementPtr e) {
    return m->RowsLinked ? e->Col : 0;
}

static void dumpMatrix(void) {
    MatrixPtr m = (MatrixPtr) M;
    int i;
    ElementPtr e;

    printf("P size %d\n", m->Size);
    printf("P extsize %d\n", m->ExtSize);
    printf("P complex %d\n", (int) m->Complex);
    printf("P flags %d %d %d %d %d %d %d %d %d %d\n",
           (int) m->Factored, (int) m->NeedsOrdering, (int) m->Reordered,
           (int) m->NumberOfInterchangesIsOdd, (int) m->RowsLinked,
           (int) m->Partitioned, m->Elements, m->Fillins, m->Singletons,
           m->CurrentSize);
    printf("P pivotmethod %c\n", m->PivotSelectionMethod ? m->PivotSelectionMethod : '-');
    printf("P i2e-row");
    for (i = 1; i <= m->Size; i++) printf(" %d", m->IntToExtRowMap[i]);
    printf("\n");
    printf("P i2e-col");
    for (i = 1; i <= m->Size; i++) printf(" %d", m->IntToExtColMap[i]);
    printf("\n");
    printf("P e2i-row");
    for (i = 0; i <= m->ExtSize; i++) printf(" %d", m->ExtToIntRowMap[i]);
    printf("\n");
    printf("P e2i-col");
    for (i = 0; i <= m->ExtSize; i++) printf(" %d", m->ExtToIntColMap[i]);
    printf("\n");
    for (i = 1; i <= m->Size; i++) {
        e = m->Diag[i];
        if (e == NULL) printf("P diag %d null\n", i);
        else {
            printf("P diag %d %d %d", i, e->Row, colOf(m, e));
            pv(e->Real);
            pv(e->Imag);
            printf("\n");
        }
    }
    for (i = 1; i <= m->Size; i++) {
        printf("P col %d", i);
        for (e = m->FirstInCol[i]; e != NULL; e = e->NextInCol) {
            printf(" | %d %d", e->Row, colOf(m, e));
            pv(e->Real);
            pv(e->Imag);
        }
        printf("\n");
    }
    for (i = 1; i <= m->Size; i++) {
        printf("P row %d", i);
        for (e = m->FirstInRow[i]; e != NULL; e = e->NextInRow) {
            printf(" | %d %d", e->Row, colOf(m, e));
            pv(e->Real);
            pv(e->Imag);
        }
        printf("\n");
    }
}

int main(void) {
    char line[65536];
    char cmd[64];
    while (fgets(line, sizeof line, stdin) != NULL) {
        if (sscanf(line, "%63s", cmd) != 1) continue;
        if (!strcmp(cmd, "new")) {
            int size = 0, cplx = 0, err = 0;
            sscanf(line, "%*s %d %d", &size, &cplx);
            M = spCreate(size, cplx, &err);
            printf("new %s %d\n", M ? "ok" : "null", spError(M));
        } else if (!strcmp(cmd, "add")) {
            int r = 0, c = 0;
            double re = 0, im = 0;
            double *e;
            sscanf(line, "%*s %d %d %lf %lf", &r, &c, &re, &im);
            e = spGetElement(M, r, c);
            if (e == NULL) {
                printf("add null\n");
            } else {
                e[0] = re;
                e[1] = im;
                printf("add ok %d\n", spError(M));
            }
        } else if (!strcmp(cmd, "preorder")) {
            spMNA_Preorder(M);
            printf("preorder %d\n", spError(M));
        } else if (!strcmp(cmd, "order")) {
            double rel = 0, abs = 0;
            int piv = 1;
            sscanf(line, "%*s %lf %lf %d", &rel, &abs, &piv);
            printf("order %d\n", spOrderAndFactor(M, NULL, rel, abs, piv));
        } else if (!strcmp(cmd, "factor")) {
            printf("factor %d\n", spFactor(M));
        } else if (!strcmp(cmd, "lu")) {
            double pivtol = 0, gmin = 0;
            sscanf(line, "%*s %lf %lf", &pivtol, &gmin);
            printf("lu %d\n", SMPluFac(M, pivtol, gmin));
        } else if (!strcmp(cmd, "clu")) {
            double pivtol = 0;
            sscanf(line, "%*s %lf", &pivtol);
            printf("clu %d\n", SMPcLUfac(M, pivtol));
        } else if (!strcmp(cmd, "reorder")) {
            double pivtol = 0, pivrel = 0, gmin = 0;
            sscanf(line, "%*s %lf %lf %lf", &pivtol, &pivrel, &gmin);
            printf("reorder %d\n", SMPreorder(M, pivtol, pivrel, gmin));
        } else if (!strcmp(cmd, "creorder")) {
            double pivtol = 0, pivrel = 0;
            int nswaps = 0;
            sscanf(line, "%*s %lf %lf", &pivtol, &pivrel);
            printf("creorder %d\n", SMPcReorder(M, pivtol, pivrel, &nswaps));
        } else if (!strcmp(cmd, "setreal")) {
            spSetReal(M);
            printf("setreal %d\n", spError(M));
        } else if (!strcmp(cmd, "setcomplex")) {
            spSetComplex(M);
            printf("setcomplex %d\n", spError(M));
        } else if (!strcmp(cmd, "clear")) {
            spClear(M);
            printf("clear %d\n", spError(M));
        } else if (!strcmp(cmd, "solve") || !strcmp(cmd, "solveT")) {
            /* solve n r1..rn */
            static double rhs[4096], iarr[4096];
            int n = 0, i, off = 0;
            char *p;
            sscanf(line, "%*s %d%n", &n, &off);
            p = line + off;
            for (i = 1; i <= n; i++) {
                rhs[i] = strtod(p, &p);
                iarr[i] = 0.0;
            }
            rhs[0] = 0.0;
            iarr[0] = 0.0;
            if (cmd[5] == 'T') spSolveTransposed(M, rhs, rhs, iarr, iarr);
            else spSolve(M, rhs, rhs, iarr, iarr);
            printf("%s %d", cmd, n);
            for (i = 1; i <= n; i++) pv(rhs[i]);
            printf("\n");
        } else if (!strcmp(cmd, "csolve") || !strcmp(cmd, "csolveT")) {
            /* csolve n r1..rn i1..in */
            static double rhs[4096], iarr[4096];
            int n = 0, i, off = 0;
            char *p;
            sscanf(line, "%*s %d%n", &n, &off);
            p = line + off;
            for (i = 1; i <= n; i++) rhs[i] = strtod(p, &p);
            for (i = 1; i <= n; i++) iarr[i] = strtod(p, &p);
            rhs[0] = 0.0;
            iarr[0] = 0.0;
            if (cmd[6] == 'T') spSolveTransposed(M, rhs, rhs, iarr, iarr);
            else spSolve(M, rhs, rhs, iarr, iarr);
            printf("%s %d", cmd, n);
            for (i = 1; i <= n; i++) pv(rhs[i]);
            for (i = 1; i <= n; i++) pv(iarr[i]);
            printf("\n");
        } else if (!strcmp(cmd, "mult") || !strcmp(cmd, "multT")) {
            /* mult n s1..sn   -> RHS = A*S (или A^T*S) */
            static double rhs[4096], sol[4096], iarr[4096], isl[4096];
            int n = 0, i, off = 0;
            char *p;
            sscanf(line, "%*s %d%n", &n, &off);
            p = line + off;
            for (i = 1; i <= n; i++) sol[i] = strtod(p, &p);
            for (i = 0; i <= n; i++) {
                rhs[i] = 0.0;
                iarr[i] = 0.0;
                isl[i] = 0.0;
            }
            if (cmd[4] == 'T') spMultTransposed(M, rhs, sol, iarr, isl);
            else spMultiply(M, rhs, sol, iarr, isl);
            printf("%s %d", cmd, n);
            for (i = 1; i <= n; i++) pv(rhs[i]);
            printf("\n");
        } else if (!strcmp(cmd, "cmult") || !strcmp(cmd, "cmultT")) {
            /* cmult n r1..rn i1..in */
            static double rhs[4096], sol[4096], iarr[4096], isl[4096];
            int n = 0, i, off = 0;
            char *p;
            sscanf(line, "%*s %d%n", &n, &off);
            p = line + off;
            for (i = 1; i <= n; i++) sol[i] = strtod(p, &p);
            for (i = 1; i <= n; i++) isl[i] = strtod(p, &p);
            for (i = 0; i <= n; i++) {
                rhs[i] = 0.0;
                iarr[i] = 0.0;
            }
            if (cmd[5] == 'T') spMultTransposed(M, rhs, sol, iarr, isl);
            else spMultiply(M, rhs, sol, iarr, isl);
            printf("%s %d", cmd, n);
            for (i = 1; i <= n; i++) pv(rhs[i]);
            for (i = 1; i <= n; i++) pv(iarr[i]);
            printf("\n");
        } else if (!strcmp(cmd, "casolve")) {
            static double rhs[4096], iarr[4096], spare[4096], ispare[4096];
            int n = 0, i, off = 0;
            char *p;
            sscanf(line, "%*s %d%n", &n, &off);
            p = line + off;
            for (i = 1; i <= n; i++) rhs[i] = strtod(p, &p);
            for (i = 1; i <= n; i++) iarr[i] = strtod(p, &p);
            for (i = 0; i <= n; i++) {
                rhs[i] = i ? rhs[i] : 0.0;
                iarr[i] = i ? iarr[i] : 0.0;
                spare[i] = 0.0;
                ispare[i] = 0.0;
            }
            SMPcaSolve(M, rhs, iarr, spare, ispare);
            printf("casolve %d", n);
            for (i = 1; i <= n; i++) pv(rhs[i]);
            for (i = 1; i <= n; i++) pv(iarr[i]);
            printf("\n");
        } else if (!strcmp(cmd, "det")) {
            int exp = 0;
            double re = 0.0, im = 0.0;
            spDeterminant(M, &exp, &re, &im);
            printf("det %d", exp);
            pv(re);
            pv(im);
            printf(" %d\n", spError(M));
        } else if (!strcmp(cmd, "cdprod")) {
            SPcomplex mant;
            int exp = 0;
            int err;
            mant.real = 0.0;
            mant.imag = 0.0;
            err = SMPcDProd(M, &mant, &exp);
            printf("cdprod %d %d", err, exp);
            pv(mant.real);
            pv(mant.imag);
            printf("\n");
        } else if (!strcmp(cmd, "prodDiag")) {
            SPcomplex mant;
            int exp = 0;
            int err;
            mant.real = 0.0;
            mant.imag = 0.0;
            err = SMPcProdDiag(M, &mant, &exp);
            printf("prodDiag %d %d", err, exp);
            pv(mant.real);
            pv(mant.imag);
            printf("\n");
        } else if (!strcmp(cmd, "err")) {
            printf("err %d\n", spError(M));
        } else if (!strcmp(cmd, "where")) {
            int r = 0, c = 0;
            spWhereSingular(M, &r, &c);
            printf("where %d %d\n", r, c);
        } else if (!strcmp(cmd, "size")) {
            printf("size %d\n", SMPmatSize(M));
        } else if (!strcmp(cmd, "getsizereal")) {
            printf("getsizereal %d\n", spGetSize(M, 0));
        } else if (!strcmp(cmd, "elements")) {
            printf("elements %d\n", spElementCount(M));
        } else if (!strcmp(cmd, "fillins")) {
            printf("fillins %d\n", spFillinCount(M));
        } else if (!strcmp(cmd, "find")) {
            int r = 0, c = 0, create = 0;
            ElementPtr e;
            sscanf(line, "%*s %d %d %d", &r, &c, &create);
            e = (ElementPtr) SMPfindElt(M, r, c, create);
            if (e == NULL) printf("find null\n");
            else {
                printf("find %d %d", e->Row, e->Col);
                pv(e->Real);
                pv(e->Imag);
                printf("\n");
            }
        } else if (!strcmp(cmd, "zerocol")) {
            int c = 0;
            sscanf(line, "%*s %d", &c);
            printf("zerocol %d\n", SMPcZeroCol((SMPmatrix *) M, c));
        } else if (!strcmp(cmd, "addcol")) {
            int a = 0, b = 0;
            sscanf(line, "%*s %d %d", &a, &b);
            printf("addcol %d\n", SMPcAddCol((SMPmatrix *) M, a, b));
        } else if (!strcmp(cmd, "zerorow")) {
            int r = 0;
            sscanf(line, "%*s %d", &r);
            printf("zerorow %d\n", SMPzeroRow((SMPmatrix *) M, r));
        } else if (!strcmp(cmd, "preOrderSMP")) {
            printf("preOrderSMP %d\n", SMPpreOrder(M));
        } else if (!strcmp(cmd, "matsize")) {
            printf("matsize %d\n", SMPmatSize(M));
        } else if (!strcmp(cmd, "geterrorSMP")) {
            int r = 0, c = 0;
            SMPgetError(M, &r, &c);
            printf("geterrorSMP %d %d\n", r, c);
        } else if (!strcmp(cmd, "print")) {
            dumpMatrix();
        } else if (!strcmp(cmd, "destroy")) {
            spDestroy(M);
            M = NULL;
            printf("destroy\n");
        } else if (!strcmp(cmd, "quit")) {
            printf("quit\n");
            break;
        } else {
            printf("unknown %s\n", cmd);
        }
        fflush(stdout);
    }
    if (M) spDestroy(M);
    return 0;
}
