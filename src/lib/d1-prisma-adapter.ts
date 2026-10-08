import { PrismaD1 } from "@prisma/adapter-d1";
import type { SqlQuery } from "@prisma/driver-adapter-utils";
import type { D1Database } from "@cloudflare/workers-types";

/** Never pretend that D1 implements Prisma's interactive transactions. */
export function guardedAdapter(database: D1Database) {
  const adapter = new PrismaD1(database);
  const connect = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    const connection = await connect();
    // SQLite dates in the existing schema and prepared batches use epoch milliseconds.
    const normalize = (query: SqlQuery): SqlQuery => ({
      ...query,
      args: query.args.map((value, i) => query.argTypes[i]?.scalarType === "datetime" && value != null ? new Date(value as string).getTime() : value),
      argTypes: query.argTypes.map(type => type.scalarType === "datetime" ? { ...type, scalarType: "int" as const } : type),
    });
    const read = connection.queryRaw.bind(connection);
    const write = connection.executeRaw.bind(connection);
    connection.queryRaw = query => read(normalize(query));
    connection.executeRaw = query => write(normalize(query));
    connection.startTransaction = async () => {
      throw new Error("Esta operação transacional ainda precisa ser migrada para batch D1.");
    };
    return connection;
  };
  return adapter;
}
