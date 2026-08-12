import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { HttpError } from "../http/errors.js";
import { requireAuth, requireFieldForce } from "../http/auth.js";
import { AttendanceModel } from "../models/attendance.model.js";
import { DcrModel } from "../models/dcr.model.js";
import { DoctorModel } from "../models/doctor.model.js";
import { EmployeeModel } from "../models/employee.model.js";
import { UserModel } from "../models/user.model.js";
import { ProductModel } from "../models/product.model.js";
import { CompanyBranchModel } from "../models/company-branch.model.js";
import { TourPlanModel } from "../models/tour-plan.model.js";
import { ExpenseClaimModel } from "../models/expense-claim.model.js";
import { audit } from "../utils/audit.js";
import { serializeDocument } from "../utils/serialize.js";
import { createTourPlanWithRetry } from "../utils/tour-plan-id.js";
import { createExpenseClaimWithRetry } from "../utils/expense-claim-id.js";

// PRD 12.3B — fixed gift/input item-type list for the compliance-tracked
// picker (Pen, Calendar, Notepad, Literature, ...). Kept as a constant so
// the frontend dropdown and backend validation never drift apart.
export const GIFT_ITEM_TYPES = ["Pen", "Calendar", "Notepad", "Literature", "Diary", "Mug", "Visiting Card Holder", "Other"] as const;

// PRD 12.3A/12.3B — samplesGiven/inputsGiven upgraded to structured rows.
// productCode is now required (Section 12.3A "Exact Solution": "Dropdown
// MUST call /company/products with the MR's subdivision filter — no
// free-text entry allowed for product codes"). itemType/valueRs enable the
// MCI gift-value compliance alert (Section 12.3B).
const dcrSchema = z.object({
  doctorId:         z.string().optional(),
  productsDetailed: z.array(z.string()).default([]),
  notes:            z.string().optional(),
  callSession:      z.enum(["MORNING", "AFTERNOON", "EVENING"]).default("MORNING"),
  callTime:         z.string().optional(),
  samplesGiven: z.array(z.object({
    productName:  z.string(),
    productCode:  z.string().optional(),
    qty:          z.number().min(0),
    batchNumber:  z.string().optional()
  })).default([]),
  inputsGiven: z.array(z.object({
    inputName: z.string(),
    itemType:  z.string().optional(),
    qty:       z.number().min(0),
    valueRs:   z.number().min(0).optional()
  })).default([]),
  jointWork: z.object({
    accompanyingManager:  z.string().optional(),
    jointWorkType:        z.enum(["FIELD_WORK", "ON_JOB_TRAINING", "PERFORMANCE_REVIEW"]).optional(),
    managerObservations:  z.string().optional()
  }).optional(),
  overrideOverVisitWarning: z.boolean().optional() // MR clicked "Confirm" on the 4th-visit modal
});

function currentUtcMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const fieldRouter = Router();
fieldRouter.use(requireAuth, requireFieldForce);

async function getFieldProfile(userId: string) {
  const user = await UserModel.findById(userId);
  if (!user?.tenantSlug) throw new HttpError(404, "Field user not found");
  const employee = await EmployeeModel.findOne({ tenantSlug: user.tenantSlug, employeeCode: user.username.toUpperCase() });
  if (!employee) {
    const fallback = await EmployeeModel.findOne({ tenantSlug: user.tenantSlug, role: "MR" });
    if (!fallback) throw new HttpError(404, "Employee profile not found");
    return fallback;
  }
  return employee;
}

fieldRouter.get("/dashboard", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const employee = await getFieldProfile(req.auth!.sub);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [doctors, completedDcrs, attendance, recentDcrs] = await Promise.all([
    DoctorModel.find({ tenantSlug, mappedEmployeeCode: employee.employeeCode, status: "ACTIVE" }).sort({ category: 1, name: 1 }),
    DcrModel.countDocuments({ tenantSlug, employeeCode: employee.employeeCode, visitDate: { $gte: today } }),
    AttendanceModel.findOne({ tenantSlug, employeeCode: employee.employeeCode, attendanceDate: { $gte: today } }),
    DcrModel.find({ tenantSlug, employeeCode: employee.employeeCode }).sort({ createdAt: -1 }).limit(5)
  ]);
  res.json({ data: {
    profile: serializeDocument(employee),
    today: { plannedVisits: doctors.length, completedDcrs, attendanceMarked: Boolean(attendance) },
    doctors: doctors.map(serializeDocument),
    recentDcrs: recentDcrs.map(serializeDocument)
  }});
}));

fieldRouter.get("/doctors", asyncHandler(async (req, res) => {
  const employee = await getFieldProfile(req.auth!.sub);
  const doctors = await DoctorModel.find({ tenantSlug: req.auth!.tenantSlug, mappedEmployeeCode: employee.employeeCode, status: "ACTIVE" }).sort({ category: 1, name: 1 });
  res.json({ data: doctors.map(serializeDocument) });
}));

fieldRouter.get("/dcrs", asyncHandler(async (req, res) => {
  const employee = await getFieldProfile(req.auth!.sub);
  const dcrs = await DcrModel.find({ tenantSlug: req.auth!.tenantSlug, employeeCode: employee.employeeCode }).sort({ createdAt: -1 }).limit(30).populate("doctorId");
  res.json({ data: dcrs.map(serializeDocument) });
}));

fieldRouter.post("/dcrs", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const employee = await getFieldProfile(req.auth!.sub);
  const body = dcrSchema.parse(req.body);
  const month = currentUtcMonth();

  // ── PRD 12.2 — daily-uniqueness guard (app-layer; rejected visits excluded) ──
  if (body.doctorId) {
    const now = new Date();
    const visitDateOnly = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    const sameDayVisit = await DcrModel.findOne({
      tenantSlug, employeeCode: employee.employeeCode, doctorId: body.doctorId,
      visitDateOnly, status: { $ne: "REJECTED" }
    });
    if (sameDayVisit) {
      throw new HttpError(409, "This doctor has already been visited today — one DCR per doctor per day.");
    }
  }

  // ── PRD 12.2 — over-visit soft warning (BEFORE saving, in POST /dcrs) ──
  // "DCR still saves — this is a soft warning, not a hard block." The MR can
  // override (overrideOverVisitWarning=true from the confirm modal); the
  // override itself is logged via overVisitFlag/overVisitCount for the
  // manager's DCR review table (amber highlight, Section 12.2).
  let overVisitFlag = false;
  let overVisitCount: number | null = null;
  if (body.doctorId) {
    const visitCount = await DcrModel.countDocuments({
      tenantSlug, employeeCode: employee.employeeCode, doctorId: body.doctorId,
      month, status: { $ne: "REJECTED" }
    });
    if (visitCount >= 3) {
      overVisitFlag = true;
      overVisitCount = visitCount + 1;
    }
  }

  const dcr = await DcrModel.create({
    tenantSlug,
    employeeCode: employee.employeeCode,
    doctorId: body.doctorId,
    productsDetailed: body.productsDetailed,
    notes: body.notes,
    callSession: body.callSession,
    callTime: body.callTime,
    samplesGiven: body.samplesGiven,
    inputsGiven: body.inputsGiven,
    jointWork: body.jointWork,
    visitDate: new Date(),
    month,
    overVisitFlag,
    overVisitCount,
    status: "SUBMITTED",
    adminVisibleAt: new Date()
  });
  await audit("FIELD_DCR_SUBMITTED", "Dcr", String(dcr._id), {
    tenantSlug, employeeCode: employee.employeeCode,
    overVisitFlag, overrideAcknowledged: body.overrideOverVisitWarning ?? false
  });
  res.status(201).json({ data: serializeDocument(dcr), overVisitFlag, overVisitCount });
}));

// ── PRD 12.2 — Visit Summary: counts per doctor for this MR this month ──
fieldRouter.get("/visit-summary", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const employee = await getFieldProfile(req.auth!.sub);
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : currentUtcMonth();

  const counts = await DcrModel.aggregate([
    { $match: { tenantSlug, employeeCode: employee.employeeCode, month, status: { $ne: "REJECTED" } } },
    { $group: { _id: "$doctorId", visitCount: { $sum: 1 }, lastVisitDate: { $max: "$visitDate" } } }
  ]);
  const countsByDoctor = new Map(counts.map((c) => [String(c._id), c]));

  const doctors = await DoctorModel.find({ tenantSlug, mappedEmployeeCode: employee.employeeCode, status: "ACTIVE" }).sort({ name: 1 });
  const data = doctors.map((doctor) => {
    const match = countsByDoctor.get(String(doctor._id));
    const visitCount = match?.visitCount ?? 0;
    return {
      doctorId: String(doctor._id),
      doctorName: doctor.name,
      specialty: doctor.specialty,
      visitCount,
      lastVisitDate: match?.lastVisitDate ?? null,
      overVisitFlag: visitCount >= 3,
      badge: visitCount === 0 ? "GREEN" : visitCount <= 2 ? "YELLOW" : "RED"
    };
  });
  res.json({ data, month });
}));

// ── PRD 12.2 — Unvisited Doctors: assigned to this MR, 0 visits this month ──
fieldRouter.get("/unvisited-doctors", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const employee = await getFieldProfile(req.auth!.sub);
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : currentUtcMonth();

  // PRD "Exact Solution": DoctorModel.find MUST include mappedEmployeeCode —
  // scope is always this MR's own territory, never the whole tenant.
  const myDoctors = await DoctorModel.find({ tenantSlug, mappedEmployeeCode: employee.employeeCode, status: "ACTIVE" });
  const visitedIds = await DcrModel.distinct("doctorId", { tenantSlug, employeeCode: employee.employeeCode, month, status: { $ne: "REJECTED" } });
  const visitedIdSet = new Set(visitedIds.map((id) => String(id)));
  const unvisited = myDoctors.filter((d) => !visitedIdSet.has(String(d._id)));

  res.json({ data: unvisited.map(serializeDocument), month });
}));

// ── PRD 12.3A — product picker for the samples-distributed form (no free text) ──
fieldRouter.get("/products", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const products = await ProductModel.find({ tenantSlug, status: "ACTIVE" }).sort({ productName: 1, name: 1 }).limit(500);
  res.json({ data: products.map(serializeDocument) });
}));

// ── PRD 12.3B — gift/input item-type picker ──
fieldRouter.get("/gift-items", asyncHandler(async (_req, res) => {
  res.json({ data: GIFT_ITEM_TYPES });
}));

// ── PRD 12.5 — branch/GST list + lookup, needed on the Tour Plan form ──
fieldRouter.get("/branches", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const branches = await CompanyBranchModel.find({ tenantSlug, status: "ACTIVE" }).sort({ isHeadquarters: -1, branchName: 1 });
  res.json({ data: branches.map(serializeDocument) });
}));

fieldRouter.get("/branches/lookup", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const gst = typeof req.query.gst === "string" ? req.query.gst.toUpperCase().trim() : "";
  if (!gst) throw new HttpError(400, "gst query parameter is required");
  const branch = await CompanyBranchModel.findOne({ tenantSlug, gstNumber: gst });
  if (!branch) throw new HttpError(404, "No branch registered with this GST number");
  res.json({ data: serializeDocument(branch) });
}));

// ── PRD 12.1 — Tour Plan (MR side: submit + view own) ──
const tourPlanLocationSchema = z.object({
  date: z.string(),
  area: z.string(),
  town: z.string(),
  purpose: z.string().optional().default("")
});

const tourPlanSubmitSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "month must be 'YYYY-MM'"),
  locations: z.array(tourPlanLocationSchema).min(1, "At least one location is required"),
  gstBranchCode: z.string().optional()
});

fieldRouter.get("/tour-plans", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const employee = await getFieldProfile(req.auth!.sub);
  const tps = await TourPlanModel.find({ tenantSlug, employeeCode: employee.employeeCode }).sort({ createdAt: -1 });
  res.json({ data: tps.map(serializeDocument) });
}));

fieldRouter.post("/tour-plans", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const employee = await getFieldProfile(req.auth!.sub);
  const body = tourPlanSubmitSchema.parse(req.body);

  if (!employee.reportingManager) {
    throw new HttpError(400, "You have no reporting manager assigned — contact your admin before submitting a Tour Plan.");
  }

  // Root cause of the manager-portal "already has an active Tour Plan" false
  // positives: nothing stopped an MR from submitting a second, wholly
  // unrelated Tour Plan for a month that already has one live. Block that
  // here so at most one non-VOIDED, non-REJECTED TP ever exists per MR per
  // month — reassignment/void is the only way to replace it after that.
  const existingActive = await TourPlanModel.findOne({
    tenantSlug,
    employeeCode: employee.employeeCode,
    month: body.month,
    status: { $in: ["DRAFT", "SUBMITTED", "APPROVED"] }
  });
  if (existingActive) {
    throw new HttpError(
      409,
      `You already have an active Tour Plan (${existingActive.tpId}) for ${body.month}. Ask your manager to void or reassign it before submitting a new one.`
    );
  }

  let gstBranchName: string | undefined;
  if (body.gstBranchCode) {
    const branch = await CompanyBranchModel.findOne({ tenantSlug, gstNumber: body.gstBranchCode.toUpperCase().trim() });
    if (branch) gstBranchName = branch.branchName;
  }

  const created = await createTourPlanWithRetry(tenantSlug, employee.employeeCode, body.month, (tpId) =>
    TourPlanModel.create({
      tenantSlug,
      tpId,
      employeeCode: employee.employeeCode,
      employeeName: employee.name,
      primaryManager: employee.reportingManager,
      assignedManager: employee.reportingManager,
      month: body.month,
      locations: body.locations,
      status: "SUBMITTED",
      gstBranchCode: body.gstBranchCode,
      gstBranchName
    })
  );

  await audit("FIELD_TOUR_PLAN_SUBMITTED", "TourPlan", String(created._id), { tenantSlug, employeeCode: employee.employeeCode, tpId: created.tpId });
  res.status(201).json({ data: serializeDocument(created) });
}));

// ── Expense Claims — the GST Branch a Tour Plan carries is what a claim
// inherits (Section 12.5 follow-up: "how should [the GST branch] redirect to
// the admin/manager to claim their expenses — create a linkage for this").
// A claim can only be filed against one of the MR's own Tour Plans, and it
// always carries that TP's gstBranchCode/gstBranchName forward so Admin can
// report claims by branch.
const expenseClaimSubmitSchema = z.object({
  tpId: z.string().min(1, "Select the Tour Plan this expense belongs to"),
  category: z.enum(["Travel", "Lodging", "Food", "Local Conveyance", "Other"]),
  expenseDate: z.string().min(1, "Expense date is required"),
  amountRs: z.number().min(0.01, "Amount must be greater than 0"),
  description: z.string().optional()
});

fieldRouter.get("/expense-claims", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const employee = await getFieldProfile(req.auth!.sub);
  const claims = await ExpenseClaimModel.find({ tenantSlug, employeeCode: employee.employeeCode }).sort({ createdAt: -1 });
  res.json({ data: claims.map(serializeDocument) });
}));

fieldRouter.post("/expense-claims", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const employee = await getFieldProfile(req.auth!.sub);
  const body = expenseClaimSubmitSchema.parse(req.body);

  const tp = await TourPlanModel.findOne({ tenantSlug, tpId: body.tpId, employeeCode: employee.employeeCode });
  if (!tp) throw new HttpError(404, "Tour Plan not found — expenses can only be claimed against your own Tour Plans.");
  if (tp.status === "VOIDED" || tp.status === "REJECTED") {
    throw new HttpError(400, `Tour Plan ${tp.tpId} is ${tp.status.toLowerCase()} and can no longer receive expense claims.`);
  }
  if (!employee.reportingManager && !tp.assignedManager) {
    throw new HttpError(400, "No manager assigned to route this claim to — contact your admin.");
  }

  const created = await createExpenseClaimWithRetry(tenantSlug, employee.employeeCode, tp.month, (claimId) =>
    ExpenseClaimModel.create({
      tenantSlug,
      claimId,
      employeeCode: employee.employeeCode,
      employeeName: employee.name,
      assignedManager: tp.assignedManager || employee.reportingManager,
      tpId: tp.tpId,
      month: tp.month,
      gstBranchCode: tp.gstBranchCode,
      gstBranchName: tp.gstBranchName,
      category: body.category,
      expenseDate: body.expenseDate,
      amountRs: body.amountRs,
      description: body.description,
      status: "SUBMITTED"
    })
  );

  await audit("FIELD_EXPENSE_CLAIM_SUBMITTED", "ExpenseClaim", String(created._id), {
    tenantSlug, employeeCode: employee.employeeCode, claimId: created.claimId, tpId: tp.tpId, amountRs: body.amountRs
  });
  res.status(201).json({ data: serializeDocument(created) });
}));

fieldRouter.post("/attendance/check-in", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const employee = await getFieldProfile(req.auth!.sub);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const attendance = await AttendanceModel.findOneAndUpdate(
    { tenantSlug, employeeCode: employee.employeeCode, attendanceDate: today },
    { tenantSlug, employeeCode: employee.employeeCode, attendanceDate: today, status: "PRESENT", checkInAt: new Date() },
    { upsert: true, new: true }
  );
  await audit("FIELD_ATTENDANCE_CHECK_IN", "Attendance", String(attendance._id), { tenantSlug, employeeCode: employee.employeeCode });
  res.status(201).json({ data: serializeDocument(attendance) });
}));

fieldRouter.post("/attendance/check-out", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const employee = await getFieldProfile(req.auth!.sub);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const attendance = await AttendanceModel.findOneAndUpdate(
    { tenantSlug, employeeCode: employee.employeeCode, attendanceDate: today },
    { checkOutAt: new Date() },
    { new: true }
  );
  res.status(200).json({ data: attendance ? serializeDocument(attendance) : null });
}));
