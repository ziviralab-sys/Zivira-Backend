import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { HttpError } from "../http/errors.js";
import { requireAuth } from "../http/auth.js";
import { DcrModel } from "../models/dcr.model.js";
import { DoctorModel } from "../models/doctor.model.js";
import { EmployeeModel } from "../models/employee.model.js";
import { UserModel } from "../models/user.model.js";
import { TourPlanModel } from "../models/tour-plan.model.js";
import { ExpenseClaimModel } from "../models/expense-claim.model.js";
import { audit } from "../utils/audit.js";
import { serializeDocument } from "../utils/serialize.js";
import { createTourPlanWithRetry } from "../utils/tour-plan-id.js";
import { notifyManager } from "../utils/notify.js";
import { enrichTourPlansWithNames } from "../utils/enrich-tour-plans.js";
import { enrichWithEmployeeNames } from "../utils/enrich-employee-names.js";

export const managerRouter = Router();
managerRouter.use(requireAuth);

// PRD 8.1 — Role Architecture: Manager (ABM/RBM) — portal field stays
// FIELD_FORCE, only the role differs. NBH kept for backward compatibility
// with existing seed data / the org hierarchy above ABM.
const MANAGER_ROLES = ["ABM", "RBM", "NBH", "ZBM", "BH"];

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
  // IMPORTANT (PRD 8.1 / Section 14 issue #12): Manager user records must
  // have role=ABM or RBM but portal MUST remain FIELD_FORCE. Never change
  // the portal field to ADMIN — only the role differs from an MR.
  if (user.portal !== "FIELD_FORCE" || !MANAGER_ROLES.includes(user.role)) {
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
  const serialized = dcrs.map(serializeDocument);
  res.json({ data: await enrichWithEmployeeNames(mgr.tenantSlug, serialized, ["employeeCode", "managerApprovedBy"]) });
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

function currentUtcMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ══════════════════════════════════════════════════════════════════════
// PRD Section 12.1 — Tour Plan: Cross-Manager Assignment & Void/Reassign
// ══════════════════════════════════════════════════════════════════════

// GET /manager/tour-plans — TPs for this manager's own assigned MRs only
managerRouter.get("/tour-plans", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const tps = await TourPlanModel.find({ tenantSlug: mgr.tenantSlug, assignedManager: mgr.employeeCode }).sort({ createdAt: -1 });
  res.json({ data: await enrichTourPlansWithNames(mgr.tenantSlug, tps) });
}));

// GET /manager/tour-plans/cross-team — ALL TPs across the tenant, for
// cross-manager visibility (PRD: "New 'Cross-Team TPs' tab — shows TPs from
// all MRs across the tenant, not just own team.")
managerRouter.get("/tour-plans/cross-team", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const tps = await TourPlanModel.find({ tenantSlug: mgr.tenantSlug }).sort({ createdAt: -1 }).limit(500);
  res.json({ data: await enrichTourPlansWithNames(mgr.tenantSlug, tps) });
}));

// PATCH /manager/tour-plans/:tpId/approve — only the assignedManager may approve
managerRouter.patch("/tour-plans/:tpId/approve", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const tp = await TourPlanModel.findOne({ tenantSlug: mgr.tenantSlug, tpId: req.params.tpId });
  if (!tp) throw new HttpError(404, "Tour Plan not found");
  if (tp.assignedManager !== mgr.employeeCode) throw new HttpError(403, "Only the assigned manager can approve this Tour Plan");
  if (tp.status === "VOIDED") throw new HttpError(409, "This Tour Plan has been voided and can no longer be approved");
  tp.status = "APPROVED";
  tp.approvedBy = mgr.employeeCode;
  tp.approvedAt = new Date();
  await tp.save();
  await audit("MANAGER_TOUR_PLAN_APPROVED", "TourPlan", String(tp._id), { tenantSlug: mgr.tenantSlug, managerCode: mgr.employeeCode, tpId: tp.tpId });
  res.json({ data: serializeDocument(tp) });
}));

// PATCH /manager/tour-plans/:tpId/reject
managerRouter.patch("/tour-plans/:tpId/reject", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
  const tp = await TourPlanModel.findOne({ tenantSlug: mgr.tenantSlug, tpId: req.params.tpId });
  if (!tp) throw new HttpError(404, "Tour Plan not found");
  if (tp.assignedManager !== mgr.employeeCode) throw new HttpError(403, "Only the assigned manager can reject this Tour Plan");
  if (tp.status === "VOIDED") throw new HttpError(409, "This Tour Plan has been voided and can no longer be rejected");
  tp.status = "REJECTED";
  tp.rejectReason = reason;
  await tp.save();
  await audit("MANAGER_TOUR_PLAN_REJECTED", "TourPlan", String(tp._id), { tenantSlug: mgr.tenantSlug, managerCode: mgr.employeeCode, tpId: tp.tpId });
  res.json({ data: serializeDocument(tp) });
}));

// PATCH /manager/tour-plans/:tpId/void — ANY manager in the tenant may void
// any TP (PRD "Exact Solution" for the role-check bug: "if user.role is ABM
// or RBM, allow void on ANY TP within same tenantSlug"). Void never deletes
// — the record is preserved with voidedBy/voidReason/voidedAt for audit.
managerRouter.patch("/tour-plans/:tpId/void", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const { reason } = z.object({ reason: z.string().min(1, "A void reason is required") }).parse(req.body);
  const tp = await TourPlanModel.findOne({ tenantSlug: mgr.tenantSlug, tpId: req.params.tpId });
  if (!tp) throw new HttpError(404, "Tour Plan not found");
  if (tp.status === "VOIDED") throw new HttpError(409, "This Tour Plan is already voided");

  tp.status = "VOIDED";
  tp.voidedBy = mgr.employeeCode;
  tp.voidedAt = new Date();
  tp.voidReason = reason;
  await tp.save();

  await audit("MANAGER_TOUR_PLAN_VOIDED", "TourPlan", String(tp._id), { tenantSlug: mgr.tenantSlug, voidedBy: mgr.employeeCode, tpId: tp.tpId, reason });

  // Notify the ORIGINAL (primary) manager, if it wasn't them who voided it.
  if (tp.primaryManager && tp.primaryManager !== mgr.employeeCode) {
    const primaryMgrEmployee = await EmployeeModel.findOne({ tenantSlug: mgr.tenantSlug, employeeCode: tp.primaryManager });
    await notifyManager({
      tenantSlug: mgr.tenantSlug,
      managerEmployeeCode: tp.primaryManager,
      managerEmail: primaryMgrEmployee?.email,
      managerName: primaryMgrEmployee?.name,
      title: `Tour Plan ${tp.tpId} voided`,
      message: `${mgr.name} (${mgr.employeeCode}) voided ${tp.employeeName ?? tp.employeeCode}'s Tour Plan ${tp.tpId} for ${tp.month}. Reason: ${reason}`
    });
    tp.managerNotifiedAt = new Date();
    await tp.save();
  }

  res.json({ data: serializeDocument(tp) });
}));

// Walks the parentTpId (backward) and reassignedToTpId (forward) links from
// a given TP to collect every tpId that belongs to the SAME reassignment
// lineage — a single linked list, since each TP can only ever be reassigned
// once (VOIDED is terminal). Used to tell "this TP was already reassigned
// through this exact chain before" apart from "this MR has a genuinely
// separate, unrelated Tour Plan" (see reassign guard below).
async function buildTourPlanLineage(tenantSlug: string, root: InstanceType<typeof TourPlanModel>) {
  const ids = new Set<string>([root.tpId]);

  let cursor: InstanceType<typeof TourPlanModel> | null = root;
  while (cursor?.parentTpId && !ids.has(cursor.parentTpId)) {
    ids.add(cursor.parentTpId);
    cursor = await TourPlanModel.findOne({ tenantSlug, tpId: cursor.parentTpId });
  }

  cursor = root;
  while (cursor?.reassignedToTpId && !ids.has(cursor.reassignedToTpId)) {
    ids.add(cursor.reassignedToTpId);
    cursor = await TourPlanModel.findOne({ tenantSlug, tpId: cursor.reassignedToTpId });
  }

  return ids;
}

// POST /manager/tour-plans/:tpId/reassign — voids the original (if not
// already voided) and creates a brand-new TP for the same MR under the
// calling manager, linked back via parentTpId. Returns the new tpId.
managerRouter.post("/tour-plans/:tpId/reassign", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const { reason } = z.object({ reason: z.string().min(1, "A void reason is required") }).parse(req.body);
  const original = await TourPlanModel.findOne({ tenantSlug: mgr.tenantSlug, tpId: req.params.tpId });
  if (!original) throw new HttpError(404, "Tour Plan not found");

  // PRD "Exact Solution" — "parentTpId chain becomes circular after Manager
  // B reassigns same MR+month already has a non-VOIDED TP" — this must only
  // catch a genuinely SEPARATE, unrelated Tour Plan thread for this MR this
  // month, not the TP being reassigned itself (or any earlier/later link in
  // its own chain). A plain per-employee-per-month lookup without lineage
  // awareness blocked EVERY reassign whenever an MR simply had more than one
  // Tour Plan on record for the month — fixed by only flagging a conflict
  // when the other active TP falls outside this TP's own lineage.
  // "Active" here must match the definition the submit-time guard in
  // field.routes.ts uses (DRAFT/SUBMITTED/APPROVED) — REJECTED and VOIDED
  // are both terminal/inactive, so neither should ever block a reassign.
  const lineage = await buildTourPlanLineage(mgr.tenantSlug, original);
  const conflicting = await TourPlanModel.findOne({
    tenantSlug: mgr.tenantSlug,
    employeeCode: original.employeeCode,
    month: original.month,
    status: { $in: ["DRAFT", "SUBMITTED", "APPROVED"] },
    tpId: { $nin: Array.from(lineage) }
  });
  if (conflicting) {
    throw new HttpError(
      409,
      `${original.employeeName ?? original.employeeCode} already has a separate active Tour Plan (${conflicting.tpId}) for ${original.month} — void that one first, or reassign it instead.`
    );
  }

  if (original.status !== "VOIDED") {
    original.status = "VOIDED";
    original.voidedBy = mgr.employeeCode;
    original.voidedAt = new Date();
    original.voidReason = reason;
  }

  const created = await createTourPlanWithRetry(mgr.tenantSlug, original.employeeCode, original.month, (tpId) =>
    TourPlanModel.create({
      tenantSlug: mgr.tenantSlug,
      tpId,
      employeeCode: original.employeeCode,
      employeeName: original.employeeName,
      primaryManager: original.primaryManager,
      assignedManager: mgr.employeeCode,
      month: original.month,
      locations: original.locations,
      status: "SUBMITTED",
      parentTpId: original.tpId,
      gstBranchCode: original.gstBranchCode,
      gstBranchName: original.gstBranchName
    })
  );

  original.reassignedToTpId = created.tpId;
  await original.save();

  await audit("MANAGER_TOUR_PLAN_REASSIGNED", "TourPlan", String(created._id), {
    tenantSlug: mgr.tenantSlug, byManager: mgr.employeeCode, fromTpId: original.tpId, toTpId: created.tpId, reason
  });

  if (original.primaryManager && original.primaryManager !== mgr.employeeCode) {
    const primaryMgrEmployee = await EmployeeModel.findOne({ tenantSlug: mgr.tenantSlug, employeeCode: original.primaryManager });
    await notifyManager({
      tenantSlug: mgr.tenantSlug,
      managerEmployeeCode: original.primaryManager,
      managerEmail: primaryMgrEmployee?.email,
      managerName: primaryMgrEmployee?.name,
      title: `Tour Plan ${original.tpId} voided & reassigned`,
      message: `${mgr.name} (${mgr.employeeCode}) reassigned ${original.employeeName ?? original.employeeCode} to a new Tour Plan ${created.tpId} for ${original.month}. Reason: ${reason}`
    });
    original.managerNotifiedAt = new Date();
    await original.save();
  }

  const [enrichedOriginal, enrichedCreated] = await enrichTourPlansWithNames(mgr.tenantSlug, [original, created]);
  res.status(201).json({ data: { original: enrichedOriginal, created: enrichedCreated } });
}));

// ══════════════════════════════════════════════════════════════════════
// Expense Claims — GST Branch → claims linkage (Section 12.5 follow-up).
// A claim is routed to whichever manager the Tour Plan it references is
// currently assigned to, so reassigning a Tour Plan also carries its claims
// to the new manager's queue.
// ══════════════════════════════════════════════════════════════════════
managerRouter.get("/expense-claims", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const claims = await ExpenseClaimModel.find({ tenantSlug: mgr.tenantSlug, assignedManager: mgr.employeeCode }).sort({ createdAt: -1 });
  const serialized = claims.map(serializeDocument);
  res.json({ data: await enrichWithEmployeeNames(mgr.tenantSlug, serialized, ["assignedManager"]) });
}));

managerRouter.get("/expense-claims/cross-team", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const claims = await ExpenseClaimModel.find({ tenantSlug: mgr.tenantSlug }).sort({ createdAt: -1 });
  const serialized = claims.map(serializeDocument);
  res.json({ data: await enrichWithEmployeeNames(mgr.tenantSlug, serialized, ["assignedManager"]) });
}));

managerRouter.patch("/expense-claims/:claimId/approve", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const claim = await ExpenseClaimModel.findOne({ tenantSlug: mgr.tenantSlug, claimId: req.params.claimId });
  if (!claim) throw new HttpError(404, "Expense claim not found");
  if (claim.assignedManager !== mgr.employeeCode) throw new HttpError(403, "Only the assigned manager can approve this claim");
  if (claim.status !== "SUBMITTED") throw new HttpError(400, `Claim is already ${claim.status}`);

  claim.status = "APPROVED";
  claim.approvedBy = mgr.employeeCode;
  claim.approvedAt = new Date();
  await claim.save();

  await audit("MANAGER_EXPENSE_CLAIM_APPROVED", "ExpenseClaim", String(claim._id), { tenantSlug: mgr.tenantSlug, byManager: mgr.employeeCode, claimId: claim.claimId });
  res.json({ data: serializeDocument(claim) });
}));

managerRouter.patch("/expense-claims/:claimId/reject", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const { reason } = z.object({ reason: z.string().min(1, "A rejection reason is required") }).parse(req.body);
  const claim = await ExpenseClaimModel.findOne({ tenantSlug: mgr.tenantSlug, claimId: req.params.claimId });
  if (!claim) throw new HttpError(404, "Expense claim not found");
  if (claim.assignedManager !== mgr.employeeCode) throw new HttpError(403, "Only the assigned manager can reject this claim");
  if (claim.status !== "SUBMITTED") throw new HttpError(400, `Claim is already ${claim.status}`);

  claim.status = "REJECTED";
  claim.rejectedBy = mgr.employeeCode;
  claim.rejectReason = reason;
  claim.rejectedAt = new Date();
  await claim.save();

  await audit("MANAGER_EXPENSE_CLAIM_REJECTED", "ExpenseClaim", String(claim._id), { tenantSlug: mgr.tenantSlug, byManager: mgr.employeeCode, claimId: claim.claimId, reason });
  res.json({ data: serializeDocument(claim) });
}));

// ══════════════════════════════════════════════════════════════════════
// PRD Section 12.2 — Visit Coverage grid: rows = doctors, columns = MRs
// ══════════════════════════════════════════════════════════════════════
managerRouter.get("/visit-coverage", asyncHandler(async (req, res) => {
  const mgr = await getManagerProfile(req.auth!.sub);
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : currentUtcMonth();
  const team = await EmployeeModel.find({ tenantSlug: mgr.tenantSlug, reportingManager: mgr.employeeCode, status: "ACTIVE" }).sort({ name: 1 });
  const codes = team.map((e) => e.employeeCode);

  const doctors = await DoctorModel.find({ tenantSlug: mgr.tenantSlug, mappedEmployeeCode: { $in: codes }, status: "ACTIVE" }).sort({ name: 1 });

  const counts = await DcrModel.aggregate([
    { $match: { tenantSlug: mgr.tenantSlug, employeeCode: { $in: codes }, month, status: { $ne: "REJECTED" } } },
    { $group: { _id: { doctorId: "$doctorId", employeeCode: "$employeeCode" }, visitCount: { $sum: 1 } } }
  ]);
  const cellMap = new Map(counts.map((c) => [`${c._id.doctorId}:${c._id.employeeCode}`, c.visitCount]));

  const rows = doctors.map((doctor) => ({
    doctorId: String(doctor._id),
    doctorName: doctor.name,
    mappedEmployeeCode: doctor.mappedEmployeeCode,
    mappedEmployeeName: doctor.mappedEmployeeName,
    cells: codes.map((code) => ({
      employeeCode: code,
      visitCount: cellMap.get(`${String(doctor._id)}:${code}`) ?? 0
    }))
  }));

  res.json({ data: { month, mrs: team.map((e) => ({ employeeCode: e.employeeCode, name: e.name })), rows } });
}));
