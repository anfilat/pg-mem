import { IValue, _IIndex, _ISelection, _IType, TR, RegClass, RegType, _ISchema } from '../interfaces-private.ts';
import { DataType, CastError, IType, QueryError, NotSupported, nil } from '../interfaces.ts';
import moment from 'https://deno.land/x/momentjs@2.29.1-deno/mod.ts';
import { deepEqual, deepCompare, nullIsh, getContext } from '../utils.ts';
import { Evaluator, Value } from '../valuetypes.ts';
import { DataTypeDef, parse, QName } from 'https://deno.land/x/pgsql_ast_parser@3.0.4/mod.ts';
import { parseArrayLiteral, parseGeometricLiteral } from 'https://deno.land/x/pgsql_ast_parser@3.0.4/mod.ts';
import { bufCompare, bufFromString, bufToString, TBuffer } from '../buffer-deno.ts';
import { TypeBase } from './datatype-base.ts';
import { BoxType, CircleType, LineType, LsegType, PathType, PointType, PolygonType } from './datatypes-geometric.ts';




class RegTypeImpl extends TypeBase<RegType> {


    get primary(): DataType {
        return DataType.regtype;
    }

    doCanCast(_to: _IType): boolean | nil {
        switch (_to.primary) {
            case DataType.text:
            case DataType.integer:
                return true;
        }
        return null;
    }

    doCast(a: Evaluator<RegType>, to: _IType): Evaluator {
        switch (to.primary) {
            case DataType.text:
                return a
                    .setType(to)
                    .setConversion(raw => raw.toString(10)
                        , s => `(${s})::TEXT`
                        , toText => ({ toText }))
            case DataType.integer:
                return a
                    .setType(to)
                    .setConversion((raw: RegType) => {
                        if (typeof raw === 'number') {
                            return raw;
                        }
                        const t = a.owner.parseType(raw);
                        return t.reg.typeId;
                    }
                        , s => `(${s})::INT`
                        , toText => ({ toText }))
        }
        throw new Error('failed to cast');
    }
}

class RegClassImpl extends TypeBase<RegClass> {



    get primary(): DataType {
        return DataType.regclass;
    }

    doCanCast(_to: _IType): boolean | nil {
        switch (_to.primary) {
            case DataType.text:
            case DataType.integer:
                return true;
        }
        return null;
    }

    doCast(a: Evaluator, to: _IType): Evaluator {
        switch (to.primary) {
            case DataType.text:
                return a
                    .setType(Types.text())
                    .setConversion((raw: RegClass) => {
                        return raw?.toString();
                    }
                        , s => `(${s})::TEXT`
                        , toText => ({ toText }))
            case DataType.integer:
                return a
                    .setType(Types.text())
                    .setConversion((raw: RegClass) => {

                        // === regclass -> int

                        const cls = parseRegClass(raw);
                        const { schema } = getContext();

                        // if its a number, then try to get it.
                        if (typeof cls === 'number') {
                            return schema.getObjectByRegOrName(cls)
                                ?.reg.classId
                                ?? cls;
                        }

                        // get the object or throw
                        return schema.getObjectByRegOrName(raw)
                            .reg.classId;
                    }
                        , s => `(${s})::INT`
                        , toText => ({ toText }))
        }
        throw new Error('failed to cast');
    }
}

class JSONBType extends TypeBase<any> {


    constructor(readonly primary: DataType) {
        super();
    }

    doCanCast(_to: _IType): boolean | nil {
        switch (_to.primary) {
            case DataType.text:
            case DataType.json:
            case DataType.jsonb:
                return true;
        }
        return null;
    }

    doCast(a: Evaluator, to: _IType): Evaluator {
        if (to.primary === DataType.json) {
            return a
                .setType(Types.text())
                .setConversion(json => JSON.stringify(json)
                    , s => `(${s})::JSONB`
                    , toJsonB => ({ toJsonB }))
                .convert(to) as Evaluator; // <== might need truncation
        }

        // json
        return a.setType(to);
    }

    doEquals(a: any, b: any): boolean {
        return deepEqual(a, b, false);
    }

    doGt(a: any, b: any): boolean {
        return deepCompare(a, b) > 0;
    }

    doLt(a: any, b: any): boolean {
        return deepCompare(a, b) < 0;
    }
}

class UUIDtype extends TypeBase<Date> {


    get primary(): DataType {
        return DataType.uuid;
    }

    doCanCast(to: _IType) {
        switch (to.primary) {
            case DataType.text:
                return true;
        }
        return null;
    }

    doCast(value: Evaluator, to: _IType) {
        switch (to.primary) {
            case DataType.text:
                return value;
        }
        throw new Error('Unexpected cast error');
    }
}

class TimestampType extends TypeBase<Date> {


    constructor(readonly primary: DataType) {
        super();
    }

    doCanCast(to: _IType) {
        switch (to.primary) {
            case DataType.timestamp:
            case DataType.date:
            case DataType.time:
                return true;
        }
        return null;
    }

    doCast(value: Evaluator, to: _IType) {
        switch (to.primary) {
            case DataType.timestamp:
                return value;
            case DataType.date:
                return value
                    .setConversion(raw => moment(raw).startOf('day').toDate()
                        , sql => `(${sql})::date`
                        , toDate => ({ toDate }));
            case DataType.time:
                return value
                    .setConversion(raw => moment(raw).format('HH:mm:ss') + '.000000'
                        , sql => `(${sql})::date`
                        , toDate => ({ toDate }));
        }
        throw new Error('Unexpected cast error');
    }

    doEquals(a: any, b: any): boolean {
        return moment(a).diff(moment(b)) < 0.1;
    }
    doGt(a: any, b: any): boolean {
        return moment(a).diff(moment(b)) > 0;
    }
    doLt(a: any, b: any): boolean {
        return moment(a).diff(moment(b)) < 0;
    }
}

class NullType extends TypeBase<null> {

    // get name() {
    //     return null;
    // }

    get primary(): DataType {
        return DataType.null;
    }

    doCast(value: Evaluator<any>, to: _IType): Evaluator<any> {
        return new Evaluator(value.owner, to, null, 'null', 'null', null, null);
    }

    doCanCast(to: _IType): boolean {
        return true;
    }

    doEquals(a: any, b: any): boolean {
        return false;
    }

    doGt(a: any, b: any): boolean {
        return false;
    }

    doLt(a: any, b: any): boolean {
        return false;
    }

    doPrefer(type: _IType) {
        return type; // always prefer notnull types
    }
}

const integers = new Set([DataType.integer, DataType.bigint]);
const numbers = new Set([DataType.integer, DataType.bigint, DataType.decimal, DataType.float]);

export function isNumeric(t: IType) {
    return numbers.has(t.primary);
}
export function isInteger(t: IType) {
    return integers.has(t.primary);
}

class NumberType extends TypeBase<number> {

    constructor(readonly primary: DataType) {
        super();
    }

    doCanConvertImplicit(to: _IType) {
        switch (to.primary) {
            case DataType.integer:
            case DataType.bigint:
            case DataType.float:
            case DataType.decimal:
            case DataType.regtype:
            case DataType.regclass:
                return true;
            default:
                return false;
        }
    }

    doPrefer(type: _IType): _IType | null {
        switch (type.primary) {
            case DataType.integer:
            case DataType.bigint:
                return this;
            case DataType.float:
            case DataType.decimal:
                return type;
        }
        return null;
    }

    doCanCast(to: _IType) {
        switch (to.primary) {
            case DataType.integer:
            case DataType.bigint:
            case DataType.float:
            case DataType.decimal:
            case DataType.regtype:
            case DataType.regclass:
                return true;
            default:
                return false;
        }
    }
    doCast(value: Evaluator<any>, to: _IType): Evaluator<any> {
        if (!integers.has(value.type.primary) && integers.has(to.primary)) {
            return new Evaluator(
                value.owner
                , to
                , value.id
                , value.sql
                , value.hash
                , value
                , (raw, t) => {
                    const got = value.get(raw, t);
                    return typeof got === 'number'
                        ? Math.round(got)
                        : got;
                }
            );
        }
        if (to.primary === DataType.regtype) {
            return value
                .setType(Types.regtype)
                .setConversion((int: number, _, t) => {
                    const got = value.owner.getType(int, { nullIfNotFound: true });
                    if (!got) {
                        throw new CastError(DataType.integer, DataType.regtype);
                    }
                    return got.name;
                }
                    , sql => `(${sql})::regtype`
                    , intToRegType => ({ intToRegType }));
        }
        if (to.primary === DataType.regclass) {
            return value
                .setType(Types.regclass)
                .setConversion((int: number) => {
                    // === int -> regclass
                    const { schema } = getContext();
                    const obj = schema.getObjectByRegOrName(int, { nullIfNotFound: true });
                    return obj?.reg.classId ?? int;
                }
                    , sql => `(${sql})::regclass`
                    , intToRegClass => ({ intToRegClass }));
        }
        return value.setType(to);
    }
}

class TimeType extends TypeBase<string> {


    get primary(): DataType {
        return DataType.time;
    }


    doCanCast(to: _IType) {
        switch (to.primary) {
            case DataType.text:
                return true;
        }
        return null;
    }

    doCast(value: Evaluator, to: _IType) {
        switch (to.primary) {
            case DataType.text:
                return value
                    .setType(Types.text())
        }
        throw new Error('Unexpected cast error');
    }
}

class ByteArrayType extends TypeBase<TBuffer> {

    get primary(): DataType {
        return DataType.bytea;
    }


    doCanCast(to: _IType) {
        switch (to.primary) {
            case DataType.text:
                return true;
        }
        return null;
    }

    doCast(value: Evaluator, to: _IType) {
        switch (to.primary) {
            case DataType.text:
                return value
                    .setConversion(raw => bufToString(raw)
                        , sql => `(${sql})::text`
                        , toStr => ({ toStr }));
        }
        throw new Error('Unexpected cast error');
    }

    doEquals(a: TBuffer, b: TBuffer): boolean {
        return bufCompare(a, b) === 0;
    }

    doGt(a: TBuffer, b: TBuffer): boolean {
        return bufCompare(a, b) > 0;
    }

    doLt(a: TBuffer, b: TBuffer): boolean {
        return bufCompare(a, b) < 0;
    }
}


class TextType extends TypeBase<string> {

    get name(): string {
        if (this.citext) {
            return 'citext';
        }
        return this.len ? 'character varying' : 'text';
    }

    get primary(): DataType {
        return this.citext
            ? DataType.citext
            : DataType.text;
    }

    constructor(readonly len: number | null, private citext?: boolean) {
        super();
    }

    doPrefer(to: _IType) {
        if (this.canConvert(to)) {
            return to;
        }
        return null;
    }

    doCanConvertImplicit(to: _IType): boolean {
        // text is implicitely convertible to dates
        switch (to.primary) {
            case DataType.text:
            case DataType.bool:
            case DataType.uuid:
            case DataType.bytea:
                return true;
        }
        return false;
    }

    doCanCast(to: _IType): boolean | nil {
        switch (to.primary) {
            case DataType.text:
            case DataType.citext:
                return true;
            case DataType.timestamp:
            case DataType.date:
            case DataType.time:
                return true;
            case DataType.text:
            case DataType.uuid:
                return true;
            case DataType.jsonb:
            case DataType.json:
                return true;
            case DataType.regtype:
            case DataType.regclass:
                return true;
            case DataType.bool:
                return true;
            case DataType.array:
                return this.canConvert((to as ArrayType).of);
            case DataType.bytea:
                return true;
        }
        if (numbers.has(to.primary)) {
            return true;
        }
        if (isGeometric(to.primary)) {
            return true;
        }
        return undefined;
    }

    doCast(value: Evaluator<string>, to: _IType) {
        switch (to.primary) {
            case DataType.citext:
                return value.setType(to);
            case DataType.timestamp:
                return value
                    .setConversion(str => {
                        const conv = moment.utc(str);
                        if (!conv.isValid()) {
                            throw new QueryError(`Invalid timestamp format: ` + str);
                        }
                        return conv.toDate()
                    }
                        , sql => `(${sql})::timestamp`
                        , toTs => ({ toTs }));
            case DataType.date:
                return value
                    .setConversion(str => {
                        const conv = moment.utc(str);
                        if (!conv.isValid()) {
                            throw new QueryError(`Invalid timestamp format: ` + str);
                        }
                        return conv.startOf('day').toDate();
                    }
                        , sql => `(${sql})::date`
                        , toDate => ({ toDate }));
            case DataType.time:
                return value
                    .setConversion(str => {
                        const conv = moment.utc(str, 'HH:mm:ss');
                        if (!conv.isValid()) {
                            throw new QueryError(`Invalid time format: ` + str);
                        }
                        return conv.format('HH:mm:ss.000000');
                    }
                        , sql => `(${sql})::time`
                        , toTime => ({ toTime }));
            case DataType.bool:
                return value
                    .setConversion(rawStr => {
                        if (nullIsh(rawStr)) {
                            return null;
                        }
                        const str = (rawStr as string).toLowerCase();
                        if ('true'.startsWith(str)) {
                            return true;
                        } else if ('false'.startsWith(str)) {
                            return false;
                        }
                        if ('yes'.startsWith(str)) {
                            return true;
                        } else if ('no'.startsWith(str)) {
                            return false;
                        }
                        throw new CastError(DataType.text, DataType.bool, 'string ' + rawStr);
                    }
                        , sql => `(${sql})::boolean`
                        , toBool => ({ toBool }));
            case DataType.uuid:
                return value
                    .setConversion((_rawStr: string) => {
                        let rawStr = _rawStr;
                        if (nullIsh(rawStr)) {
                            return null;
                        }
                        // check schema
                        if (rawStr[0] === '{') {
                            if (rawStr[rawStr.length - 1] !== '}') {
                                throw new CastError(DataType.text, DataType.uuid, 'string: ' + JSON.stringify(_rawStr));
                            }
                            rawStr = rawStr.substr(1, rawStr.length - 2);
                        }
                        rawStr = rawStr.toLowerCase();
                        const [full, a, b, c, d, e] = /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/.exec(rawStr) ?? [];
                        if (!full) {
                            throw new CastError(DataType.text, DataType.uuid, 'string: ' + JSON.stringify(_rawStr));
                        }
                        return `${a}-${b}-${c}-${d}-${e}`;
                    }
                        , sql => `(${sql})::uuid`
                        , toUuid => ({ toUuid }));
            case DataType.json:
            case DataType.jsonb:
                return value
                    .setConversion(raw => JSON.parse(raw)
                        , sql => `(${sql})::jsonb`
                        , toJsonb => ({ toJsonb }));
            case DataType.text:
                const fromStr = to as TextType;
                const toStr = to as TextType;
                if (toStr.len === null || (fromStr.len ?? -1) < toStr.len) {
                    // no need to truncate
                    return value;
                }
                return value
                    .setConversion(str => {
                        if (str?.length > toStr.len!) {
                            throw new QueryError(`value too long for type character varying(${toStr.len})`);
                        }
                        return str;
                    }
                        , sql => `TRUNCATE(${sql}, ${toStr.len})`
                        , truncate => ({ truncate, len: toStr.len }));
            case DataType.regtype:
                return value
                    .setType(Types.regtype)
                    .setConversion((str: string) => {
                        let repl = str.replace(/["\s]+/g, '');
                        if (repl.startsWith('pg_catalog.')) {
                            repl = repl.substr('pg_catalog.'.length);
                        }
                        return value.owner.parseType(repl).name;
                    }
                        , sql => `(${sql})::regtype`
                        , strToRegType => ({ strToRegType }));
            case DataType.regclass:
                return value
                    .setType(Types.regclass)
                    .setConversion((str: string) => {
                        // === text -> regclass

                        const cls = parseRegClass(str);
                        const { schema } = getContext();

                        // if its a number, then try to get it.
                        if (typeof cls === 'number') {
                            return schema.getObjectByRegOrName(cls)
                                ?.name
                                ?? cls;
                        }

                        // else, get or throw.
                        return schema.getObject(cls)
                            .name;
                    }
                        , sql => `(${sql})::regclass`
                        , strToRegClass => ({ strToRegClass }));
            case DataType.array:
                return value
                    .setType(to)
                    .setConversion((str: string) => {
                        const array = parseArrayLiteral(str);
                        (to as ArrayType).convertLiteral(value.owner, array);
                        return array;
                    }
                        , sql => `(${sql})::${to.name}`
                        , parseArray => ({ parseArray }));
            case DataType.bytea:
                return value
                    .setConversion(str => {
                        return bufFromString(str);
                    }
                        , sql => `(${sql})::bytea`
                        , toBytea => ({ toBytea }));

        }
        if (numbers.has(to.primary)) {
            const isInt = integers.has(to.primary);
            return value
                .setConversion(str => {
                    const val = Number.parseFloat(str);
                    if (!Number.isFinite(val)) {
                        throw new QueryError(`invalid input syntax for ${to.primary}: ${str}`);
                    }
                    if (isInt && Math.floor(val) !== val) {
                        throw new QueryError(`invalid input syntax for ${to.primary}: ${str}`)
                    }
                    return val;
                }
                    , sql => `(${sql})::${to.primary}`
                    , castNum => ({ castNum, to: to.primary }));
        }
        if (isGeometric(to.primary)) {
            return value
                .setConversion(str => {
                    const ret = parseGeometricLiteral(str, to.primary as any);
                    return ret;
                }
                    , sql => `(${sql})::${to.primary}`
                    , castGeo => ({ castGeo, to: to.primary }));
        }
        return undefined;
    }

    doEquals(a: string, b: string) {
        if (this.citext) {
            return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
        }

        return super.doEquals(a, b);
    }
}



class BoolType extends TypeBase<boolean> {
    get primary(): DataType {
        return DataType.bool;
    }
}

export class ArrayType extends TypeBase<any[]> {
    get primary(): DataType {
        return DataType.array;
    }

    get name(): string {
        return this.of.name + '[]';
    }


    constructor(readonly of: _IType) {
        super();
    }

    doCanCast(to: _IType) {
        return to instanceof ArrayType
            && to.of.canConvert(this.of);
    }

    doCast(value: Evaluator, _to: _IType) {
        const to = _to as ArrayType;
        const valueType = value.type as ArrayType;
        return new Evaluator(
            value.owner
            , to
            , value.id
            , value.sql
            , value.hash!
            , value
            , (raw, t) => {
                const arr = value.get(raw, t) as any[];
                return arr.map(x => Value.constant(value.owner, valueType.of, x).convert(to.of).get(raw, t));
            });
    }

    doEquals(a: any[], b: any[]): boolean {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (!this.of.equals(a[i], b[i])) {
                return false;
            }
        }
        return true;
    }

    doGt(a: any[], b: any[]): boolean {
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
            if (this.of.gt(a[i], b[i])) {
                return true;
            }
        }
        return a.length > b.length;
    }

    doLt(a: any[], b: any[]): boolean {
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
            if (this.of.lt(a[i], b[i])) {
                return true;
            }
        }
        return a.length < b.length;
    }

    convertLiteral(owner: _ISchema, elts: any) {
        if (elts === null || elts === undefined) {
            return;
        }
        if (!Array.isArray(elts)) {
            throw new QueryError('Array depth mismatch: was expecting an array item.');
        }
        if (this.of instanceof ArrayType) {
            for (let i = 0; i < elts.length; i++) {
                this.of.convertLiteral(owner, elts[i]);
            }
        } else {
            for (let i = 0; i < elts.length; i++) {
                if (Array.isArray(elts[i])) {
                    throw new QueryError('Array depth mismatch: was not expecting an array item.');
                }
                elts[i] = Value.text(owner, elts[i])
                    .convert(this.of)
                    .get();
            }
        }
        return elts;
    }
}


/** Basic types */
export const Types = {
    [DataType.bool]: new BoolType() as _IType,
    [DataType.text]: (len: number | nil = null) => makeText(len) as _IType,
    [DataType.citext]: new TextType(null, true),
    [DataType.timestamp]: new TimestampType(DataType.timestamp) as _IType,
    [DataType.timestampz]: new TimestampType(DataType.timestampz) as _IType,
    [DataType.uuid]: new UUIDtype() as _IType,
    [DataType.date]: new TimestampType(DataType.date) as _IType,
    [DataType.time]: new TimeType() as _IType,
    [DataType.jsonb]: new JSONBType(DataType.jsonb) as _IType,
    [DataType.regtype]: new RegTypeImpl() as _IType,
    [DataType.regclass]: new RegClassImpl() as _IType,
    [DataType.json]: new JSONBType(DataType.json) as _IType,
    [DataType.null]: new NullType() as _IType,
    [DataType.float]: new NumberType(DataType.float) as _IType,
    [DataType.integer]: new NumberType(DataType.integer) as _IType,
    [DataType.bigint]: new NumberType(DataType.bigint) as _IType,
    [DataType.bytea]: new ByteArrayType() as _IType,
    [DataType.point]: new PointType() as _IType,
    [DataType.line]: new LineType() as _IType,
    [DataType.lseg]: new LsegType() as _IType,
    [DataType.box]: new BoxType() as _IType,
    [DataType.path]: new PathType() as _IType,
    [DataType.polygon]: new PolygonType() as _IType,
    [DataType.circle]: new CircleType() as _IType,
}

export function isGeometric(dt: DataType) {
    switch (dt) {
        case DataType.point:
        case DataType.line:
        case DataType.lseg:
        case DataType.box:
        case DataType.path:
        case DataType.polygon:
        case DataType.circle:
            return true;
    }
    return false;
}

const texts = new Map<number | null, _IType>();
function makeText(len: number | nil = null) {
    len = len ?? null;
    let got = texts.get(len);
    if (!got) {
        texts.set(len, got = new TextType(len));
    }
    return got;
}





export function parseRegClass(_reg: RegClass): QName | number {
    let reg = _reg;
    if (typeof reg === 'string' && /^\d+$/.test(reg)) {
        reg = parseInt(reg);
    }
    if (typeof reg === 'number') {
        return reg;
    }
    // todo remove casts after next pgsql-ast-parser release
    try {
        const ret = parse(reg, 'qualified_name' as any) as QName;
        return ret;
    } catch (e) {
        return { name: reg };
    }
}


export const typeSynonyms: { [key: string]: DataType } = {
    'varchar': DataType.text,
    'char': DataType.text,
    'character': DataType.text,
    'character varying': DataType.text,

    'int': DataType.integer,
    'int4': DataType.integer,
    'serial': DataType.integer,
    'bigserial': DataType.integer,
    'smallserial': DataType.integer,
    'smallint': DataType.integer,
    'bigint': DataType.integer,
    'oid': DataType.integer,

    'decimal': DataType.float,
    'float': DataType.float,
    'double precision': DataType.float,
    'numeric': DataType.float,
    'real': DataType.float,
    'money': DataType.float,

    'timestampz': DataType.timestamp, //  => todo support timestampz
    'timestamp with time zone': DataType.timestamp, //  => todo support timestampz
    'timestamp without time zone': DataType.timestamp,

    'boolean': DataType.bool,

    'time with time zone': DataType.time,
    'time without time zone': DataType.time,
}


/** Finds a common type by implicit conversion */
export function reconciliateTypes(values: IValue[], nullIfNoMatch?: false): _IType;
export function reconciliateTypes(values: IValue[], nullIfNoMatch: true): _IType | nil;
export function reconciliateTypes(values: IValue[], nullIfNoMatch?: boolean): _IType | nil
export function reconciliateTypes(values: IValue[], nullIfNoMatch?: boolean): _IType | nil {
    // FROM  https://www.postgresql.org/docs/current/typeconv-union-case.html

    const nonNull = values
        .filter(x => x.type.primary !== DataType.null);

    if (!nonNull.length) {
        // If all inputs are of type unknown, resolve as type text (the preferred type of the string category). Otherwise, unknown inputs are ignored for the purposes of the remaining rules.
        return Types.text();
    }

    // If all inputs are of the same type, and it is not unknown, resolve as that type.
    const single = new Set(nonNull
        .map(v => v.type.reg.typeId));
    if (single.size === 1) {
        return nonNull[0].type;
    }

    return reconciliateTypesRaw(nonNull, nullIfNoMatch);
}



/** Finds a common type by implicit conversion */
function reconciliateTypesRaw(values: IValue[], nullIfNoMatch?: false): _IType;
function reconciliateTypesRaw(values: IValue[], nullIfNoMatch: true): _IType | nil;
function reconciliateTypesRaw(values: IValue[], nullIfNoMatch?: boolean): _IType | nil
function reconciliateTypesRaw(values: IValue[], nullIfNoMatch?: boolean): _IType | nil {
    // find the matching type among non constants
    const foundType = values
        .reduce((final, c) => {
            if (c.type === Types.null) {
                return final;
            }
            const pref = final.prefer(c.type);
            if (!pref) {
                throw new CastError(c.type.primary, final.primary, c.sql ?? undefined);
            }
            return pref;
        }, Types.null);

    // check that all constant literals are matching this.
    for (const x of values) {
        if (!x.isConstantLiteral && !x.type.canConvertImplicit(foundType)) {
            if (nullIfNoMatch) {
                return null;
            }
            throw new CastError(x.type.primary, foundType.primary);
        }
    }

    return foundType;
}