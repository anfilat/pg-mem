
import { QueryError } from './interfaces.ts';
import LRUCache from 'https://deno.land/x/lru_cache@6.0.0-deno.4/mod.ts';
import hash from 'https://deno.land/x/object_hash@2.0.3.1/mod.ts';
import { Expr, parse, Statement } from 'https://deno.land/x/pgsql_ast_parser@3.0.4/mod.ts';


const astCache: LRUCache<any, any> = new LRUCache({
    max: 1000,
});


/** Parse an AST from SQL */
export function parseSql(sql: string): Statement[];
export function parseSql(sql: string, entry: 'expr'): Expr;
export function parseSql(sql: string, entry?: string): any {
    // when 'entry' is not specified, lets cache parsings
    // => better perf on repetitive requests
    const key = !entry && hash(sql);
    if (!entry) {
        const cached = astCache.get(key);
        if (cached) {
            return cached;
        }
    }

    try {

        let ret = parse(sql, entry as any);

        // cache result
        if (!entry) {
            astCache.set(key, ret);
        }
        return ret;

    } catch (e) {
        if (typeof e?.message !== 'string' || !/Syntax error/.test(e.message)) {
            throw e;
        }


        // throw a nice parsing error.
        throw new QueryError(`💔 Your query failed to parse.
This is most likely due to a SQL syntax error. However, you might also have hit a bug, or an unimplemented feature of pg-mem.
If this is the case, please file an issue at https://github.com/oguimbal/pg-mem along with a query that reproduces this syntax error.

👉 Failed query:

    ${sql}

💀 ${e.message}`);
    }

}
