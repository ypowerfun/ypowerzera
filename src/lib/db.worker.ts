import { cache } from "react";
import { PrismaClient } from "@primearena/prisma-worker/wasm.js";
import type { PrismaClient as NodeClient, Prisma } from "@prisma/client";
import { guardedAdapter } from "./d1-prisma-adapter";
import { sitesDatabase } from "./sites-d1";

const requestClient = cache(() => {
  const database = sitesDatabase();
  if (!database) throw new Error("Binding D1 ausente.");
  return new PrismaClient({ adapter: guardedAdapter(database) });
});
export const db = new Proxy({} as NodeClient, {
  get(_target, property) {
    const client = requestClient();
    const value = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
export type Tx = Prisma.TransactionClient | NodeClient;
export type TxClient = Prisma.TransactionClient;
