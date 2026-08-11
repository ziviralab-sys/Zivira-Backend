import { Router } from "express";
import bcrypt from "bcryptjs";
import { asyncHandler } from "../http/async-handler.js";
import { UserModel } from "../models/user.model.js";
import { EmployeeModel } from "../models/employee.model.js";
import { runExactTenSeed } from "../seed/exact-10.js";

export const seedRouter = Router();

// Reset EVERY master dataset (legacy models + all 54 generic masters-registry
// tabs) to exactly 10 cross-linked records per tenant. Same secret-header
// pattern as /run below — exists because Render's free tier has no shell
// access, so this is the only way to run scripts/seed-exact-10.ts against
// the live database (PRD Section 5.4 / 18).
//
//   curl -X POST https://<backend>/api/seed/exact-10 -H "x-seed-secret: <SEED_SECRET>"
seedRouter.post("/exact-10", asyncHandler(async (req, res) => {
  const secret = req.headers["x-seed-secret"];
  if (!secret || secret !== process.env.SEED_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await runExactTenSeed();
  res.json({ success: true, message: "Every master dataset reset to exactly 10 records for tenant zivira-labs." });
}));

// ONE-TIME seed endpoint — disable after use by removing SEED_SECRET env var
seedRouter.post("/run", asyncHandler(async (req, res) => {
  const secret = req.headers["x-seed-secret"];
  if (!secret || secret !== process.env.SEED_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const passwordHash = await bcrypt.hash("ziviramumbai", 12);

  // Create ABM Manager user
  await UserModel.updateOne(
    { username: "abm-001" },
    {
      username: "abm-001",
      passwordHash,
      displayName: "Demo Area Business Manager",
      role: "ABM",
      portal: "FIELD_FORCE",
      tenantSlug: "zivira-labs",
      active: true
    },
    { upsert: true }
  );

  // Create ABM Employee record
  await EmployeeModel.updateOne(
    { tenantSlug: "zivira-labs", employeeCode: "ABM-001" },
    {
      tenantSlug: "zivira-labs",
      name: "Demo Area Business Manager",
      employeeCode: "ABM-001",
      designation: "Area Business Manager",
      division: "Cardio Diabetes",
      reportingManager: "NBH-001",
      territory: "Mumbai",
      role: "ABM",
      status: "ACTIVE"
    },
    { upsert: true }
  );

  // Link MR-001 to report to ABM-001
  await EmployeeModel.updateOne(
    { tenantSlug: "zivira-labs", employeeCode: "MR-001" },
    { reportingManager: "ABM-001" }
  );

  res.json({ success: true, message: "abm-001 created. Login: abm-001 / ziviramumbai" });
}));
