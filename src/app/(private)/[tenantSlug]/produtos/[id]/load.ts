import "server-only";
import { notFound } from "next/navigation";
import { DomainError } from "@/server/errors";

export async function loadOr404<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}
