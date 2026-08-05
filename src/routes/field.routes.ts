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
import { audit } from "../utils/audit.js";
import { serializeDocument } from "../utils/serialize.js";

const dcrSchema = z.object({
  doctorId:         z.string().optional(),
  productsDetailed: z.array(z.string()).default([]),
  notes:            z.string().optional(),
  callSession:      z.enum(["MORNING", "AFTERNOON", "EVENING"]).default("MORNING"),
  callTime:         z.string().optional(),
  samplesGiven:     z.array(z.object({ productName: z.string(), qty: z.number() })).default([]),
  inputsGiven:      z.array(z.object({ inputName: z.string(), qty: z.number() })).default([]),
  jointWork: z.object({
    accompanyingManager:  z.string().optional(),
    jointWorkType:        z.enum(["FIELD_WORK", "ON_JOB_TRAINING", "PERFORMANCE_REVIEW"]).optional(),
    managerObservations:  z.string().optional()
  }).optional()
});

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
    status: "SUBMITTED",
    adminVisibleAt: new Date()
  });
  await audit("FIELD_DCR_SUBMITTED", "Dcr", String(dcr._id), { tenantSlug, employeeCode: employee.employeeCode });
  res.status(201).json({ data: serializeDocument(dcr) });
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
