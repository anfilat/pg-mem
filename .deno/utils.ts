import moment from 'https://deno.land/x/momentjs@2.29.1-deno/mod.ts';
import { List } from 'https://deno.land/x/immutable@4.0.0-rc.12-deno.1/mod.ts';
import { IValue, NotSupported, _ISchema, _IType, _Transaction } from './interfaces-private.ts';
import { DataTypeDef, Expr, nil, QName } from 'https://deno.land/x/pgsql_ast_parser@3.0.4/mod.ts';
import { ISubscription, IType, typeDefToStr } from './interfaces.ts';
import { bufClone, bufCompare, isBuf } from './buffer-deno.ts';

export interface Ctor<T> extends Function {
    new(...params: any[]): T; prototype: T;
}

export type Optional<T> = { [key in keyof T]?: T[key] };



export function trimNullish<T>(value: T, depth = 5): T {
    if (depth < 0)
        return value;
    if (value instanceof Array) {
        value.forEach(x => trimNullish(x, depth - 1))
    }
    if (typeof value !== 'object' || value instanceof Date || moment.isMoment(value) || moment.isDuration(value))
        return value;

    if (!value) {
        return value;
    }

    for (const k of Object.keys(value)) {
        const val = (value as any)[k];
        if (val === undefined || val === null)
            delete (value as any)[k];
        else
            trimNullish(val, depth - 1);
    }
    return value;
}


export function watchUse<T>(rootValue: T): { checked: T; check?: () => string | null; } {
    if (!rootValue || typeof globalThis !== 'undefined' && (globalThis as any)?.process?.env?.['NOCHECKFULLQUERYUSAGE'] === 'true') {
        return { checked: rootValue };
    }
    if (typeof rootValue !== 'object') {
        throw new NotSupported();
    }
    if (Array.isArray(rootValue)) {
        throw new NotSupported();
    }
    const toUse = new Map<string, any>();
    function recurse(value: any, stack: List<string> = List()): any {
        if (!value || typeof value !== 'object') {
            return value;
        }
        if (Array.isArray(value)) {
            return value
                .map((x, i) => recurse(x, stack.push(`[${i}]`)));
        }
        // watch object
        const ret = {};
        for (const [k, _v] of Object.entries(value)) {
            const nstack = stack.push('.' + k);
            let v = recurse(_v, nstack);
            const nstackKey = nstack.join('');
            toUse.set(nstackKey, _v);
            Object.defineProperty(ret, k, {
                get() {
                    toUse.delete(nstackKey);
                    return v;
                },
                enumerable: true,
            });
        }
        return ret;
    }

    const final = recurse(rootValue);

    const check = function () {
        if (toUse.size) {
            return `The query you ran generated an AST which parts have not been read by the query planner. \
This means that those parts could be ignored:

    ⇨ ` + [...toUse.entries()]
                    .map(([k, v]) => k + ' (' + JSON.stringify(v) + ')')
                    .join('\n    ⇨ ');
        }
        return null;
    }
    return { checked: final, check };
}



export function deepEqual<T>(a: T, b: T, strict?: boolean, depth = 10, numberDelta = 0.0001) {
    return deepCompare(a, b, strict, depth, numberDelta) === 0;
}
export function deepCompare<T>(a: T, b: T, strict?: boolean, depth = 10, numberDelta = 0.0001): number {
    if (depth < 0) {
        throw new NotSupported('Comparing too deep entities');
    }

    if (a === b) {
        return 0;
    }
    if (!strict) {
        // should not use '==' because it could call .toString() on objects when compared to strings.
        // ... which is not ok. Especially when working with translatable objects, which .toString() returns a transaltion (a string, thus)
        if (!a && !b) {
            return 0;
        }
    }

    if (Array.isArray(a)) {
        if (!Array.isArray(b)) {
            return 1;
        }
        if (a.length !== b.length) {
            return a.length > b.length ? 1 : -1;
        }
        for (let i = 0; i < a.length; i++) {
            const inner = deepCompare(a[i], b[i], strict, depth - 1, numberDelta);
            if (inner)
                return inner;
        }
        return 0;
    }

    if (isBuf(a) || isBuf(b)) {
        if (!isBuf(a)) {
            return 1;
        }
        if (!isBuf(b)) {
            return -1;
        }
        return bufCompare(a, b);
    }

    // handle dates
    if (a instanceof Date || b instanceof Date || moment.isMoment(a) || moment.isMoment(b)) {
        const am = moment(a);
        const bm = moment(b);
        if (am.isValid() !== bm.isValid()) {
            return am.isValid()
                ? -1
                : 1;
        }
        const diff = am.diff(bm, 'seconds');
        if (Math.abs(diff) < 0.001) {
            return 0;
        }
        return diff > 0 ? 1 : -1;
    }

    // handle durations
    if (moment.isDuration(a) || moment.isDuration(b)) {
        const da = moment.duration(a);
        const db = moment.duration(b);
        if (da.isValid() !== db.isValid()) {
            return da.isValid()
                ? -1
                : 1;
        }
        const diff = da.asMilliseconds() - db.asMilliseconds();
        if (Math.abs(diff) < 1) {
            return 0;
        }
        return diff > 0 ? 1 : -1;
    }

    const fa = Number.isFinite(<any>a);
    const fb = Number.isFinite(<any>b);
    if (fa || fb) {
        if (Math.abs(<any>a - <any>b) <= numberDelta) {
            return 0;
        }
        return a > b ? 1 : -1;
    }

    // === handle plain objects
    if (typeof a !== 'object') {
        return -1; // objects are at the end
    }
    if (typeof b !== 'object') {
        return 1; // objects are at the end
    }

    if (!a || !b) {
        return 0; // nulls
    }

    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (strict && ak.length !== bk.length) {
        // longer objects at the end
        return ak.length > bk.length ? 1 : -1;
    }
    const set: Iterable<string> = strict
        ? Object.keys(a)
        : new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of set) {
        const inner = deepCompare((a as any)[k], (b as any)[k], strict, depth - 1, numberDelta);
        if (inner) {
            return inner;
        }
    }
    return 0;
}


type Json = { [key: string]: Json } | Json[] | string | number | null;
export function queryJson(a: Json, b: Json) {
    if (!a || !b) {
        return (a ?? null) === (b ?? null);
    }
    if (a === b) {
        return true;
    }

    if (typeof a === 'string' || typeof b === 'string') {
        return false;
    }

    if (typeof a === 'number' || typeof b === 'number') {
        return false;
    }

    if (Array.isArray(a)) {
        // expecting array
        if (!Array.isArray(b)) {
            return false;
        }
        // => must match all those criteria
        const toMatch = [...a];
        for (const be of b) {
            for (let i = 0; i < toMatch.length; i++) {
                if (queryJson(toMatch[i], be)) {
                    // matched this criteria
                    toMatch.splice(i, 1);
                    break;
                }
            }
            if (!toMatch.length) {
                break;
            }
        }
        return !toMatch.length;
    }

    if (Array.isArray(b)) {
        return false;
    }

    if ((typeof a === 'object') !== (typeof b === 'object')) {
        return false;
    }
    const akeys = Object.keys(a);
    const bkeys = Object.keys(b);
    if (akeys.length > bkeys.length) {
        return false;
    }
    for (const ak of akeys) {
        if (!(ak in (b as any))) {
            return false;
        }
        if (!queryJson(a[ak], b[ak])) {
            return false;
        }
    }
    return true;
}

export function buildColumnIds(suggestedIds: string[]) {
    const exists = new Set(suggestedIds);
    const got = new Set();
    let cid = 0;
    return suggestedIds
        .map(x => {
            if (x && !got.has(x)) {
                got.add(x);
                return x;
            }
            let base = x ?? 'column';
            let nm: string;
            do {
                nm = base + (cid++);
            } while (exists.has(nm) || got.has(nm));
            got.add(nm);
            return nm;
        });
}

export function buildLikeMatcher(likeCondition: string, caseSensitive = true) {
    // Escape regex characters from likeCondition
    likeCondition = likeCondition.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    let likeRegexString = likeCondition.replace(/\%/g, ".*").replace(/_/g, '.');
    likeRegexString = "^" + likeRegexString + "$";
    const reg = new RegExp(likeRegexString, caseSensitive ? '' : 'i');

    return (stringToMatch: string | number) => {
        if (nullIsh(stringToMatch)) {
            return null;
        }
        if (typeof stringToMatch != "string") {
            stringToMatch = stringToMatch.toString();
        }
        return reg.test(stringToMatch);
    }
}

export function nullIsh(v: any) {
    return v === null || v === undefined;
}
export function hasNullish(...vals: any[]) {
    return vals.some(nullIsh);
}

export function deepCloneSimple<T>(v: T): T {
    if (!v || typeof v !== 'object' || v instanceof Date) {
        return v;
    }
    if (Array.isArray(v)) {
        return (v as any[]).map(x => deepCloneSimple(x)) as any;
    }
    if (isBuf(v)) {
        return bufClone(v) as any;
    }

    const ret: any = {};
    for (const k of Object.keys(v)) {
        ret[k] = deepCloneSimple((v as any)[k]);
    }
    for (const k of Object.getOwnPropertySymbols(v)) {
        ret[k] = (v as any)[k]; // no need to deep clone that
    }
    return ret;
}


export function isSelectAllArgList(select: Expr[]) {
    const [first] = select;
    return select.length === 1
        && first.type === 'ref'
        && first.name === '*'
    // && !first.table
}


export function ignore(...val: any[]): void {
    for (const v of val) {
        if (!v) {
            continue;
        }
        if (Array.isArray(v)) {
            ignore(...v);
            continue;
        }
        if (typeof v !== 'object') {
            continue;
        }
        ignore(...Object.values(v));
    }
}

export function combineSubs(...vals: ISubscription[]): ISubscription {
    return {
        unsubscribe: () => {
            vals.forEach(u => u?.unsubscribe());
        },
    };
}


interface Ctx {
    schema: _ISchema;
    transaction: _Transaction;
}
const curCtx: Ctx[] = [];
export function getContext(): Ctx {
    if (!curCtx.length) {
        throw new Error('Cannot call getFunctionContext() in this context');
    }
    return curCtx[curCtx.length - 1];
}

export function pushContext<T>(ctx: Ctx, act: () => T): T {
    try {
        curCtx.push(ctx)
        return act();
    } finally {
        curCtx.pop();
    }
}

export function indexHash(this: void, vals: (IValue | string)[]) {
    return vals.map(x => typeof x === 'string' ? x : x.hash).sort().join('|');
}

export function randomString(length = 8, chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'): string {
    var result = '';
    for (var i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}


export function schemaOf(t: DataTypeDef): string | nil {
    if (t.kind === 'array') {
        return schemaOf(t.arrayOf);
    }
    return t.schema;
}


export function isType(t: any): t is _IType {
    return !!t?.[isType.TAG];
}
isType.TAG = Symbol();


export function suggestColumnName(expr: Expr): string | null {
    // suggest a column result name
    switch (expr.type) {
        case 'call':
            const fn = expr.function;
            if (typeof fn === 'string') {
                return fn;
            } else {
                return fn.keyword;
            }
        case 'ref':
            return expr.name;
        case 'keyword':
            return expr.keyword;
        case 'cast':
            return typeDefToStr(expr.to);
    }
    return null;
}