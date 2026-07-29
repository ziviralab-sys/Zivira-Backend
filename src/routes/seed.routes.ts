import { Router } from "express";
import bcrypt from "bcryptjs";
import { asyncHandler } from "../http/async-handler.js";
import { UserModel } from "../models/user.model.js";
import { EmployeeModel } from "../models/employee.model.js";

export const seedRouter = Router();

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
