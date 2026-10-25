/*
 *  pre.h — принудительно включается ПЕРЕД каждым .c (флаг -include).
 *  Даёт прототипы современных glibc-заголовков до того, как заголовки
 *  SPICE 1993 года объявят их в стиле K&R (иначе — конфликт типов).
 */
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
