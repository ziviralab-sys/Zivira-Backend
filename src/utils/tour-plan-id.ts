// src/utils/tour-plan-id.ts
// PRD Section 12.1 — TP ID generation + collision-safe creation.
//
// Format: TP-{YYYY-MM}-{EMPLOYEECODE}-{SEQUENCE}
// Example: TP-2026-06-MR001-003
// sequence = count of all TPs for this MR in this month + 1
// Each void+reassign increments the sequence — IDs are always unique.
//
// PRD-documented error: "Duplicate tpId error (E11000) on simultaneous
// reassign — two managers reassign the same TP at the same time."
// Fix: retry loop on E11000 duplicate key, recomputing the sequence each try.

import { TourPlanModel } from "../models/tour-plan.model.js";

export async function nextTourPlanId(tenantSlug: string, employeeCode: string, month: string) {
  const count = await TourPlanModel.countDocuments({ tenantSlug, employeeCode, month });
  const sequence = String(count + 1).padStart(3, "0");
  return `TP-${month}-${employeeCode.toUpperCase()}-${sequence}`;
}

/**
 * Runs `create` with a freshly generated tpId, retrying on MongoDB E11000
 * duplicate-key errors (two managers voiding/reassigning at the same instant).
 */
export async function createTourPlanWithRetry<T>(
  tenantSlug: string,
  employeeCode: string,
  month: string,
  create: (tpId: string) => Promise<T>,
  maxAttempts = 5
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const tpId = await nextTourPlanId(tenantSlug, employeeCode, month);
    try {
      return await create(tpId);
    } catch (error) {
      const isDuplicateKey =
        typeof error === "object" && error !== null && "code" in error && (error as { code?: number }).code === 11000;
      if (!isDuplicateKey) throw error;
      lastError = error;
      // brief jitter so concurrent retries don't immediately collide again
      await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 50));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Failed to generate a unique Tour Plan ID");
}
