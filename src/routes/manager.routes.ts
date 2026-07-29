import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { HttpError } from "../http/errors.js";
import { requireAuth } from "../http/auth.js";
import { DcrModel } from "../models/dcr.model.js";
import { EmployeeModel } from "../models/employee.model.js";
import { UserModel } from "../models/user.model.js";
import { audit } from "../utils/audit.js";
import { serializeDocument } from "../utils/serialize.js";

export const managerRouter = Router();
managerRouter.use(requireAuth);

const managedEmployeeSchema = z.object({
  name: z.string().min(2),
  employeeCode: z.string().min(2).transform((value) => value.toUpperCase()),
  designation: z.string().min(2).default("Medical Representative"),
  division: z.string().min(2),
  territory: z.string().min(2),
  role: z.enum(["MR", "SR_MR"]).default("MR"),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  password: z.string().min(6).default("zivira123")
});

async function getManagerProfile(userId: string) {
  const user = await UserModel.findById(userId);
  if (!user?.tenantSlug) throw new HttpError(404, "Manager not found");
  if (user.portal !== "FIELD_FORCE" || !["ABM", "NBH"].includes(user.role)) {
    throw new HttpError(403, "Manager access required");
  }
  const emp = await EmployeeModel.findOne({ tenantSlug: user.tenantSlug, employeeCode: user.username.toUpperCase() });
  if (!emp) throw new HttpError(404, "Employee profile not found");
  return emp;
}

// GET /manager/team — list of employees reporting to this manager
managerRouter.get("/team", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const team = await EmployeeModel.find({
    tenantSlug: mgr.tenantSlug,
    reportingManager: mgr.employeeCode,
    status: "ACTIVE"
  }).sort({ name: 1 });
  res.json({ data: team.map(serializeDocument) });
}));

managerRouter.post("/team", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const body = managedEmployeeSchema.parse(req.body);
  const employee = await EmployeeModel.create({
    ...body,
    tenantSlug: mgr.tenantSlug,
    reportingManager: mgr.employeeCode
  });

  await UserModel.updateOne(
    { username: body.employeeCode.toLowerCase(), portal: "FIELD_FORCE" },
    {
      username: body.employeeCode.toLowerCase(),
      passwordHash: await bcrypt.hash(body.password, 10),
      displayName: body.name,
      role: "MR",
      portal: "FIELD_FORCE",
      tenantSlug: mgr.tenantSlug,
      active: body.status === "ACTIVE"
    },
    { upsert: true }
  );

  await audit("MANAGER_FIELD_EMPLOYEE_CREATED", "Employee", String(employee._id), {
    tenantSlug: mgr.tenantSlug,
    managerCode: mgr.employeeCode,
    employeeCode: employee.employeeCode
  });

  res.status(201).json({ data: { ...serializeDocument(employee), demoPassword: body.password } });
}));

// GET /manager/dcrs — all team DCRs (newest first)
managerRouter.get("/dcrs", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const team = await EmployeeModel.find({ tenantSlug: mgr.tenantSlug, reportingManager: mgr.employeeCode });
  const codes = team.map(e => e.employeeCode);
  const dcrs = await DcrModel.find({
    tenantSlug: mgr.tenantSlug,
    employeeCode: { $in: codes }
  }).sort({ createdAt: -1 }).limit(100).populate("doctorId");
  res.json({ data: dcrs.map(serializeDocument) });
}));

// POST /manager/dcrs/:id/approve
managerRouter.post("/dcrs/:id/approve", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const dcr = await DcrModel.findById(req.params.id);
  if (!dcr || dcr.tenantSlug !== mgr.tenantSlug) throw new HttpError(404, "DCR not found");
  dcr.status = "MANAGER_APPROVED";
  dcr.managerApprovedBy = mgr.employeeCode;
  dcr.managerApprovedAt = new Date();
  await dcr.save();
  await audit("MANAGER_DCR_APPROVED", "Dcr", String(dcr._id), { tenantSlug: mgr.tenantSlug, managerCode: mgr.employeeCode });
  res.json({ data: serializeDocument(dcr) });
}));

// POST /manager/dcrs/:id/reject
managerRouter.post("/dcrs/:id/reject", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const dcr = await DcrModel.findById(req.params.id);
  if (!dcr || dcr.tenantSlug !== mgr.tenantSlug) throw new HttpError(404, "DCR not found");
  const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
  dcr.status = "REJECTED";
  if (reason) dcr.notes = (dcr.notes ? dcr.notes + "\n[Rejected]: " : "[Rejected]: ") + reason;
  await dcr.save();
  await audit("MANAGER_DCR_REJECTED", "Dcr", String(dcr._id), { tenantSlug: mgr.tenantSlug, managerCode: mgr.employeeCode });
  res.json({ data: serializeDocument(dcr) });
}));

// GET /manager/dashboard
managerRouter.get("/dashboard", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const team = await EmployeeModel.find({ tenantSlug: mgr.tenantSlug, reportingManager: mgr.employeeCode });
  const codes = team.map(e => e.employeeCode);
  const [totalDcrs, pendingApproval, approvedToday] = await Promise.all([
    DcrModel.countDocuments({ tenantSlug: mgr.tenantSlug, employeeCode: { $in: codes }, visitDate: { $gte: today } }),
    DcrModel.countDocuments({ tenantSlug: mgr.tenantSlug, employeeCode: { $in: codes }, status: "SUBMITTED" }),
    DcrModel.countDocuments({ tenantSlug: mgr.tenantSlug, employeeCode: { $in: codes }, status: "MANAGER_APPROVED", managerApprovedAt: { $gte: today } })
  ]);
  res.json({ data: { manager: serializeDocument(mgr), team: team.map(serializeDocument), stats: { totalDcrs, pendingApproval, approvedToday, teamSize: team.length } } });
}));
