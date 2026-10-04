import { twMerge } from "tailwind-merge";

/** Junta classes ignorando valores falsos; em conflito (ex.: px-4 e px-2) a última vence. */
export const cx = (...c: Array<string | false | null | undefined>) => twMerge(c.filter(Boolean).join(" "));
