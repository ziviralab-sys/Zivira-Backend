import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { requireAuth, requireCompanyAdmin } from "../http/auth.js";
import { mastersRouter } from "./masters.routes.js";
import { HttpError } from "../http/errors.js";
import { AttendanceModel } from "../models/attendance.model.js";
import { DcrModel } from "../models/dcr.model.js";
import { DoctorModel } from "../models/doctor.model.js";
import { EmployeeModel } from "../models/employee.model.js";
import { ProductModel } from "../models/product.model.js";
import { audit } from "../utils/audit.js";
import { serializeDocument } from "../utils/serialize.js";
import { StockistModel } from "../models/stockist.model.js";
import { SubdivisionModel } from "../models/subdivision.model.js";
import { FieldForceModel } from "../models/fieldforce.model.js";
import { ProductCategoryModel } from "../models/product-category.model.js";
import { ProductBrandModel } from "../models/product-brand.model.js";
import { ProductCatalogModel } from "../models/product-catalog.model.js";
import { DoctorCategoryModel } from "../models/doctor-category.model.js";
import { DoctorSpecialityModel } from "../models/doctor-speciality.model.js";
import { DoctorQualificationModel } from "../models/doctor-qualification.model.js";
import { ProductGroupModel } from "../models/product-group.model.js";
import { DealerModel } from "../models/dealer.model.js";
import { HolidayModel } from "../models/holiday.model.js";
import { SfcModel } from "../models/sfc.model.js";
import { ExpenseModel } from "../models/expense.model.js";
import { HospitalModel } from "../models/hospital.model.js";
import { UnlistedDoctorModel } from "../models/unlisted-doctor.model.js";
import { CompanyBranchModel } from "../models/company-branch.model.js";
import { TourPlanModel } from "../models/tour-plan.model.js";
import { ExpenseClaimModel } from "../models/expense-claim.model.js";
import { CompanyConfigModel, DEFAULT_CONFIG, getConfigValue } from "../models/company-config.model.js";

// Case-insensitive exact match, so "division" filters agree regardless of how a value
// was originally cased (Excel import vs. manual entry through the Add form).
function exactCaseInsensitive(value: string) {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

// Shared page/limit parsing for routes that back large collections (e.g. the ~20k-row
// doctor/customer import) so the client never has to pull the whole collection at once.
function parsePagination(req: { query: Record<string, unknown> }, opts: { defaultLimit: number; maxLimit: number }) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const rawLimit = parseInt(String(req.query.limit ?? opts.defaultLimit), 10) || opts.defaultLimit;
  const limit = Math.min(Math.max(1, rawLimit), opts.maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}


const employeeSchema = z.object({
  name: z.string().min(2),
  employeeCode: z.string().min(2),
  designation: z.string().min(2),
  division: z.string().min(2),
  reportingManager: z.string().optional(),
  territory: z.string().min(2),
  role: z.enum(["NBH", "BH", "RBM", "ZBM", "ABM", "SR_MR", "MR"]),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE")
});

const doctorSchema = z.object({
  name: z.string().min(2),
  specialty: z.string().min(2),
  category: z.enum(["A", "B", "C", "D"]).default("C"),
  state: z.string().min(2),
  city: z.string().min(2),
  territory: z.string().min(2),
  mappedEmployeeCode: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE")
});

const productSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  category: z.string().min(2),
  division: z.string().min(2),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE")
});

export const companyRouter = Router();

companyRouter.use(requireAuth, requireCompanyAdmin);
companyRouter.use("/masters", mastersRouter);

companyRouter.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const tenantSlug = req.auth!.tenantSlug!;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [employeeCount, doctorCount, activeProductCount, dcrSubmittedToday, attendanceMarkedToday, recentDoctors, recentEmployees] =
      await Promise.all([
        EmployeeModel.countDocuments({ tenantSlug, status: "ACTIVE" }),
        DoctorModel.countDocuments({ tenantSlug, status: "ACTIVE" }),
        ProductModel.countDocuments({ tenantSlug, status: "ACTIVE" }),
        DcrModel.countDocuments({ tenantSlug, visitDate: { $gte: today }, status: { $in: ["SUBMITTED", "MANAGER_APPROVED", "APPROVED"] } }),
        AttendanceModel.countDocuments({ tenantSlug, attendanceDate: { $gte: today } }),
        DoctorModel.find({ tenantSlug }).sort({ createdAt: -1 }).limit(5),
        EmployeeModel.find({ tenantSlug }).sort({ createdAt: -1 }).limit(5)
      ]);

    res.json({
      data: {
        metrics: { employeeCount, doctorCount, activeProductCount, dcrSubmittedToday, attendanceMarkedToday },
        recentDoctors: recentDoctors.map(serializeDocument),
        recentEmployees: recentEmployees.map(serializeDocument)
      }
    });
  })
);

companyRouter.get(
  "/employees",
  asyncHandler(async (req, res) => {
    const query: Record<string, unknown> = { tenantSlug: req.auth!.tenantSlug };
    if (typeof req.query.division === "string" && req.query.division.trim()) {
      query.division = exactCaseInsensitive(req.query.division.trim());
    }
    const employees = await EmployeeModel.find(query).sort({ createdAt: -1 });
    res.json({ data: employees.map(serializeDocument) });
  })
);

companyRouter.post(
  "/employees",
  asyncHandler(async (req, res) => {
    const tenantSlug = req.auth!.tenantSlug!;
    const body = employeeSchema.parse(req.body);
    const employee = await EmployeeModel.create({ ...body, tenantSlug });
    await audit("EMPLOYEE_CREATED", "Employee", String(employee._id), { tenantSlug, employeeCode: employee.employeeCode });
    res.status(201).json({ data: serializeDocument(employee) });
  })
);

companyRouter.get(
  "/doctors",
  asyncHandler(async (req, res) => {
    const tenantSlug = req.auth!.tenantSlug;
    const { page, limit, skip } = parsePagination(req, { defaultLimit: 100, maxLimit: 500 });
    const [doctors, total] = await Promise.all([
      DoctorModel.find({ tenantSlug }).sort({ createdAt: -1, doctorCode: 1 }).skip(skip).limit(limit),
      DoctorModel.countDocuments({ tenantSlug })
    ]);
    res.json({
      data: doctors.map(serializeDocument),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  })
);

// Distinct, paginated clinic names sourced from the doctor collection (Excel Customer
// sheet's "Clinic name" column) — backs the Hospital screen without fetching all ~20k
// doctor documents just to dedupe one field.
companyRouter.get(
  "/doctors/clinics",
  asyncHandler(async (req, res) => {
    const tenantSlug = req.auth!.tenantSlug;
    const { page, limit, skip } = parsePagination(req, { defaultLimit: 100, maxLimit: 500 });
    const values = await DoctorModel.distinct("clinicName", { tenantSlug });
    const names = [...new Set(
      values
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => v.trim())
    )].sort((a, b) => a.localeCompare(b));
    const total = names.length;
    res.json({
      data: names.slice(skip, skip + limit),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  })
);

// Doctors whose dob or anniversaryDate falls in the given month (1-12), for the Doctor
// Celebrations report. Filtered server-side so this doesn't require fetching the whole
// ~20k-row doctor collection just to find one month's birthdays/anniversaries.
companyRouter.get(
  "/doctors/celebrations",
  asyncHandler(async (req, res) => {
    const tenantSlug = req.auth!.tenantSlug;
    const month = parseInt(String(req.query.month ?? ""), 10);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new HttpError(400, "month query param (1-12) is required");
    }
    const doctors = await DoctorModel.find({
      tenantSlug,
      $expr: {
        $or: [
          { $eq: [{ $month: "$dob" }, month] },
          { $eq: [{ $month: "$anniversaryDate" }, month] }
        ]
      }
    }).sort({ name: 1 });
    res.json({ data: doctors.map(serializeDocument) });
  })
);

companyRouter.post(
  "/doctors",
  asyncHandler(async (req, res) => {
    const tenantSlug = req.auth!.tenantSlug!;
    const body = doctorSchema.parse(req.body);
    const doctor = await DoctorModel.create({ ...body, tenantSlug });
    await audit("DOCTOR_CREATED", "Doctor", String(doctor._id), { tenantSlug, category: doctor.category });
    res.status(201).json({ data: serializeDocument(doctor) });
  })
);

companyRouter.get(
  "/products",
  asyncHandler(async (req, res) => {
    const query: Record<string, unknown> = { tenantSlug: req.auth!.tenantSlug };
    if (typeof req.query.subDivision === "string" && req.query.subDivision.trim()) {
      query.subDivision = req.query.subDivision.trim();
    }
    if (typeof req.query.division === "string" && req.query.division.trim()) {
      query.division = req.query.division.trim();
    }
    const products = await ProductModel.find(query).sort({ createdAt: -1 });
    res.json({ data: products.map(serializeDocument) });
  })
);

companyRouter.post(
  "/products",
  asyncHandler(async (req, res) => {
    const tenantSlug = req.auth!.tenantSlug!;
    const body = productSchema.parse(req.body);
    const product = await ProductModel.create({ ...body, tenantSlug });
    await audit("PRODUCT_CREATED", "Product", String(product._id), { tenantSlug, code: product.code });
    res.status(201).json({ data: serializeDocument(product) });
  })
);

// GET /company/dcrs — admin sees DCRs only after 24h delay
companyRouter.get(
  "/dcrs",
  asyncHandler(async (req, res) => {
    const tenantSlug = req.auth!.tenantSlug!;
    const query: Record<string, unknown> = { tenantSlug };
    if (typeof req.query.employeeCode === "string" && req.query.employeeCode.trim()) {
      query.employeeCode = req.query.employeeCode.trim().toUpperCase();
    }
    if (typeof req.query.callSession === "string" && req.query.callSession.trim()) {
      query.callSession = req.query.callSession.trim().toUpperCase();
    }

    const dcrs = await DcrModel.find(query).sort({ createdAt: -1 }).limit(200).populate("doctorId");
    res.json({ data: dcrs.map(serializeDocument) });
  })
);

companyRouter.get(
  "/dcrs/:id",
  asyncHandler(async (req, res) => {
    const dcr = await DcrModel.findOne({ _id: req.params.id, tenantSlug: req.auth!.tenantSlug }).populate("doctorId");
    if (!dcr) throw new Error("DCR not found");
    res.json({ data: serializeDocument(dcr) });
  })
);

// POST /company/dcrs/:id/approve — admin final approval
companyRouter.post(
  "/dcrs/:id/approve",
  asyncHandler(async (req, res) => {
    const dcr = await DcrModel.findOne({ _id: req.params.id, tenantSlug: req.auth!.tenantSlug });
    if (!dcr) throw new Error("DCR not found");
    dcr.status = "APPROVED";
    await dcr.save();
    res.json({ data: serializeDocument(dcr) });
  })
);

companyRouter.get(
  "/manager-activity",
  asyncHandler(async (req, res) => {
    const tenantSlug = req.auth!.tenantSlug!;
    const managers = await EmployeeModel.find({ tenantSlug, role: { $in: ["ABM", "RBM", "ZBM", "NBH"] } }).sort({ name: 1 });

    const rows = await Promise.all(managers.map(async (manager) => {
      const team = await EmployeeModel.find({ tenantSlug, reportingManager: manager.employeeCode });
      const codes = team.map((employee) => employee.employeeCode);
      const [approved, rejected, pending] = await Promise.all([
        DcrModel.countDocuments({ tenantSlug, employeeCode: { $in: codes }, status: { $in: ["MANAGER_APPROVED", "APPROVED"] } }),
        DcrModel.countDocuments({ tenantSlug, employeeCode: { $in: codes }, status: "REJECTED" }),
        DcrModel.countDocuments({ tenantSlug, employeeCode: { $in: codes }, status: "SUBMITTED" })
      ]);

      return {
        manager: serializeDocument(manager),
        approved,
        rejected,
        autoApproved: 0,
        pending,
        autoApproveRate: 0,
        flagged: false
      };
    }));

    res.json({ data: rows });
  })
);
// ─── Stockist Routes ───────────────────────────────────────────────

const stockistValidation = z.object({
  name: z.string().min(2),
  erpCode: z.string().optional(),
  state: z.string().min(2),
  hqName: z.string().min(2),
  address: z.string().min(2),
  phone: z.string().optional(),
  fieldForceName: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE")
});

companyRouter.get("/stockists", asyncHandler(async (req, res) => {
  const stockists = await StockistModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ state: 1 });
  res.json({ data: stockists.map(serializeDocument) });
}));

companyRouter.post("/stockists", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = stockistValidation.parse(req.body);
  const stockist = await StockistModel.create({ ...body, tenantSlug });
  await audit("STOCKIST_CREATED", "Stockist", String(stockist._id), { tenantSlug });
  res.status(201).json({ data: serializeDocument(stockist) });
}));

companyRouter.post("/stockists/bulk", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const rows = z.array(stockistValidation).parse(req.body.rows);
  let inserted = 0, updated = 0;
  for (const row of rows) {
    const key = row.erpCode
      ? { tenantSlug, erpCode: row.erpCode }
      : { tenantSlug, name: row.name, hqName: row.hqName };
    const result = await StockistModel.updateOne(key, { ...row, tenantSlug }, { upsert: true });
    if (result.upsertedCount) inserted++; else updated++;
  }
  res.json({ data: { inserted, updated, total: rows.length } });
}));
/**
 * TASK 2 — ADD THIS BLOCK to the bottom of company.routes.ts
 * (before the final closing of the file, after the /dcrs/:id/approve route)
 *
 * Paste everything between the ===BEGIN=== and ===END=== markers.
 */

// ===BEGIN===

// GET /company/field-force-status — live status of all field employees for today
companyRouter.get(
  "/field-force-status",
  asyncHandler(async (req, res) => {
    const tenantSlug = req.auth!.tenantSlug!;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const employees = await EmployeeModel.find({
      tenantSlug,
      status: "ACTIVE",
      role: { $in: ["MR", "SR_MR", "ABM", "RBM", "ZBM", "NBH", "BH"] }
    }).sort({ name: 1 });

    const rows = await Promise.all(
      employees.map(async (emp) => {
        const [dcr, attendance] = await Promise.all([
          DcrModel.findOne({
            tenantSlug,
            employeeCode: emp.employeeCode,
            visitDate: { $gte: today }
          })
            .sort({ createdAt: -1 })
            .lean(),
          AttendanceModel.findOne({
            tenantSlug,
            employeeCode: emp.employeeCode,
            attendanceDate: { $gte: today }
          })
            .sort({ createdAt: -1 })
            .lean()
        ]);

        // Count calls made today
        const callsToday = await DcrModel.countDocuments({
          tenantSlug,
          employeeCode: emp.employeeCode,
          visitDate: { $gte: today }
        });

        const dcrStatus = dcr
          ? (dcr.status as string)
          : "NOT_SUBMITTED";

        const attendanceStatus = attendance
          ? (attendance.status as string)
          : "ABSENT";

        return {
          employeeCode: emp.employeeCode,
          name: emp.name,
          territory: emp.territory,
          role: emp.role,
          dcrStatus,
          attendanceStatus,
          callsToday,
          lastSeenAt: dcr?.updatedAt ?? null
        };
      })
    );

    res.json({ data: rows });
  })
);

// GET /company/notices — list notices for this tenant
companyRouter.get(
  "/notices",
  asyncHandler(async (req, res) => {
    const { NoticeModel } = await import("../models/notice.model.js");
    const notices = await NoticeModel.find({ tenantSlug: req.auth!.tenantSlug })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ data: notices.map(serializeDocument) });
  })
);

// POST /company/notices — post a new notice
companyRouter.post(
  "/notices",
  asyncHandler(async (req, res) => {
    const { NoticeModel } = await import("../models/notice.model.js");
    const noticeSchema = z.object({
      title: z.string().min(3).max(200),
      message: z.string().min(5),
      audience: z.enum(["ALL", "MR", "MANAGER", "ADMIN"]).default("ALL"),
      priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL")
    });
    const tenantSlug = req.auth!.tenantSlug!;
    const body = noticeSchema.parse(req.body);
    const postedBy = req.auth!.sub; // user id
    const notice = await NoticeModel.create({ ...body, tenantSlug, postedBy });
    await audit("NOTICE_CREATED", "Notice", String(notice._id), { tenantSlug });
    res.status(201).json({ data: serializeDocument(notice) });
  })
);

// ===END===

// ─── Sub-Division Routes ──────────────────────────────────────────

const subdivisionSchema = z.object({
  division: z.string().min(1),
  subdivisionName: z.string().min(1).optional().nullable(),
  productwiseCount: z.number().int().min(0).default(0),
  fieldforcewiseCount: z.number().int().min(0).default(0)
});

const subdivisionUpdateSchema = subdivisionSchema.partial();

companyRouter.get("/subdivisions", asyncHandler(async (req, res) => {
  const subdivisions = await SubdivisionModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ createdAt: -1 });
  res.json({ data: subdivisions.map(serializeDocument) });
}));

companyRouter.post("/subdivisions", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = subdivisionSchema.parse(req.body);
  const subdivision = await SubdivisionModel.create({ ...body, tenantSlug });
  await audit("SUBDIVISION_CREATED", "Subdivision", String(subdivision._id), { tenantSlug });
  res.status(201).json({ data: serializeDocument(subdivision) });
}));

companyRouter.put("/subdivisions/:id", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = subdivisionUpdateSchema.parse(req.body);
  const subdivision = await SubdivisionModel.findOneAndUpdate(
    { _id: req.params.id, tenantSlug },
    body,
    { new: true }
  );
  if (!subdivision) throw new HttpError(404, "Sub-Division not found");
  await audit("SUBDIVISION_UPDATED", "Subdivision", String(subdivision._id), { tenantSlug });
  res.json({ data: serializeDocument(subdivision) });
}));

companyRouter.post("/subdivisions/:id/deactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const subdivision = await SubdivisionModel.findOneAndUpdate(
    { _id: req.params.id, tenantSlug },
    { status: "INACTIVE" },
    { new: true }
  );
  if (!subdivision) throw new HttpError(404, "Sub-Division not found");
  await audit("SUBDIVISION_DEACTIVATED", "Subdivision", String(subdivision._id), { tenantSlug });
  res.json({ data: serializeDocument(subdivision) });
}));

// ─── Sub-Division Field Force (read-only) ─────────────────────────

companyRouter.get("/fieldforce", asyncHandler(async (req, res) => {
  const query: Record<string, unknown> = { tenantSlug: req.auth!.tenantSlug };
  if (typeof req.query.subDivision === "string" && req.query.subDivision.trim()) {
    query.subDivision = req.query.subDivision.trim();
  }
  const fieldForce = await FieldForceModel.find(query).sort({ createdAt: 1 });
  res.json({ data: fieldForce.map(serializeDocument) });
}));

// ─── Product Category ──────────────────────────────────────────────

const productCategorySchema = z.object({
  shortName: z.string().trim().optional().nullable(),
  categoryName: z.string().min(1),
  sortOrder: z.number().int().optional().nullable()
});

const productCategoryUpdateSchema = productCategorySchema.partial();

companyRouter.get("/product-categories", asyncHandler(async (req, res) => {
  const categories = await ProductCategoryModel.find({ tenantSlug: req.auth!.tenantSlug })
    .sort({ sortOrder: 1, createdAt: 1 });
  res.json({ data: categories.map(serializeDocument) });
}));

companyRouter.post("/product-categories", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = productCategorySchema.parse(req.body);
  const category = await ProductCategoryModel.create({ ...body, tenantSlug });
  await audit("PRODUCT_CATEGORY_CREATED", "ProductCategory", String(category._id), { tenantSlug });
  res.status(201).json({ data: serializeDocument(category) });
}));

companyRouter.put("/product-categories/:id", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = productCategoryUpdateSchema.parse(req.body);
  const category = await ProductCategoryModel.findOneAndUpdate(
    { _id: req.params.id, tenantSlug },
    body,
    { new: true }
  );
  if (!category) throw new HttpError(404, "Product Category not found");
  await audit("PRODUCT_CATEGORY_UPDATED", "ProductCategory", String(category._id), { tenantSlug });
  res.json({ data: serializeDocument(category) });
}));

companyRouter.post("/product-categories/:id/deactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const category = await ProductCategoryModel.findOneAndUpdate(
    { _id: req.params.id, tenantSlug },
    { status: "INACTIVE" },
    { new: true }
  );
  if (!category) throw new HttpError(404, "Product Category not found");
  await audit("PRODUCT_CATEGORY_DEACTIVATED", "ProductCategory", String(category._id), { tenantSlug });
  res.json({ data: serializeDocument(category) });
}));

companyRouter.post("/product-categories/:id/reactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const category = await ProductCategoryModel.findOneAndUpdate(
    { _id: req.params.id, tenantSlug },
    { status: "ACTIVE" },
    { new: true }
  );
  if (!category) throw new HttpError(404, "Product Category not found");
  await audit("PRODUCT_CATEGORY_REACTIVATED", "ProductCategory", String(category._id), { tenantSlug });
  res.json({ data: serializeDocument(category) });
}));

// ─── Product Brand ──────────────────────────────────────────────────

const productBrandSchema = z.object({
  shortName: z.string().trim().optional().nullable(),
  brandName: z.string().min(1),
  sortOrder: z.number().int().optional().nullable()
});
const productBrandUpdateSchema = productBrandSchema.partial();

companyRouter.get("/product-brands", asyncHandler(async (req, res) => {
  const brands = await ProductBrandModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ sortOrder: 1, createdAt: 1 });
  res.json({ data: brands.map(serializeDocument) });
}));

companyRouter.post("/product-brands", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = productBrandSchema.parse(req.body);
  const brand = await ProductBrandModel.create({ ...body, tenantSlug });
  await audit("PRODUCT_BRAND_CREATED", "ProductBrand", String(brand._id), { tenantSlug });
  res.status(201).json({ data: serializeDocument(brand) });
}));

companyRouter.put("/product-brands/:id", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = productBrandUpdateSchema.parse(req.body);
  const brand = await ProductBrandModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, body, { new: true });
  if (!brand) throw new HttpError(404, "Product Brand not found");
  await audit("PRODUCT_BRAND_UPDATED", "ProductBrand", String(brand._id), { tenantSlug });
  res.json({ data: serializeDocument(brand) });
}));

companyRouter.post("/product-brands/:id/deactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const brand = await ProductBrandModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, { status: "INACTIVE" }, { new: true });
  if (!brand) throw new HttpError(404, "Product Brand not found");
  await audit("PRODUCT_BRAND_DEACTIVATED", "ProductBrand", String(brand._id), { tenantSlug });
  res.json({ data: serializeDocument(brand) });
}));

companyRouter.post("/product-brands/:id/reactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const brand = await ProductBrandModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, { status: "ACTIVE" }, { new: true });
  if (!brand) throw new HttpError(404, "Product Brand not found");
  await audit("PRODUCT_BRAND_REACTIVATED", "ProductBrand", String(brand._id), { tenantSlug });
  res.json({ data: serializeDocument(brand) });
}));

// ─── Product Catalog (Product Detail master list) ───────────────────

const productCatalogSchema = z.object({
  productCode: z.string().trim().optional().nullable(),
  productName: z.string().min(1),
  description: z.string().trim().optional().nullable(),
  saleUnit: z.string().trim().optional().nullable(),
  sortOrder: z.number().int().optional().nullable()
});
const productCatalogUpdateSchema = productCatalogSchema.partial();

companyRouter.get("/product-catalog", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const query: Record<string, unknown> = { tenantSlug };
  if (typeof req.query.division === "string" && req.query.division.trim()) {
    // ProductCatalogModel has no division field of its own — it's derived via the brand's division.
    const brands = await ProductBrandModel.find({ tenantSlug, division: exactCaseInsensitive(req.query.division.trim()) }, { brandName: 1 });
    query.brandName = { $in: brands.map((b) => b.brandName) };
  }
  const products = await ProductCatalogModel.find(query).sort({ sortOrder: 1, createdAt: 1 });
  res.json({ data: products.map(serializeDocument) });
}));

companyRouter.post("/product-catalog", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = productCatalogSchema.parse(req.body);
  const product = await ProductCatalogModel.create({ ...body, tenantSlug });
  await audit("PRODUCT_CATALOG_CREATED", "ProductCatalog", String(product._id), { tenantSlug });
  res.status(201).json({ data: serializeDocument(product) });
}));

companyRouter.put("/product-catalog/:id", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = productCatalogUpdateSchema.parse(req.body);
  const product = await ProductCatalogModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, body, { new: true });
  if (!product) throw new HttpError(404, "Product not found");
  await audit("PRODUCT_CATALOG_UPDATED", "ProductCatalog", String(product._id), { tenantSlug });
  res.json({ data: serializeDocument(product) });
}));

companyRouter.post("/product-catalog/:id/deactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const product = await ProductCatalogModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, { status: "INACTIVE" }, { new: true });
  if (!product) throw new HttpError(404, "Product not found");
  await audit("PRODUCT_CATALOG_DEACTIVATED", "ProductCatalog", String(product._id), { tenantSlug });
  res.json({ data: serializeDocument(product) });
}));

companyRouter.post("/product-catalog/:id/reactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const product = await ProductCatalogModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, { status: "ACTIVE" }, { new: true });
  if (!product) throw new HttpError(404, "Product not found");
  await audit("PRODUCT_CATALOG_REACTIVATED", "ProductCatalog", String(product._id), { tenantSlug });
  res.json({ data: serializeDocument(product) });
}));

// ─── Doctor Category ──────────────────────────────────────────────────

const doctorCategorySchema = z.object({
  shortName: z.string().trim().optional().nullable(),
  categoryName: z.string().min(1),
  noOfVisit: z.number().int().optional().nullable(),
  sortOrder: z.number().int().optional().nullable()
});
const doctorCategoryUpdateSchema = doctorCategorySchema.partial();

companyRouter.get("/doctor-categories", asyncHandler(async (req, res) => {
  const rows = await DoctorCategoryModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ sortOrder: 1, createdAt: 1 });
  res.json({ data: rows.map(serializeDocument) });
}));

companyRouter.post("/doctor-categories", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = doctorCategorySchema.parse(req.body);
  const row = await DoctorCategoryModel.create({ ...body, tenantSlug });
  await audit("DOCTOR_CATEGORY_CREATED", "DoctorCategory", String(row._id), { tenantSlug });
  res.status(201).json({ data: serializeDocument(row) });
}));

companyRouter.put("/doctor-categories/:id", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = doctorCategoryUpdateSchema.parse(req.body);
  const row = await DoctorCategoryModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, body, { new: true });
  if (!row) throw new HttpError(404, "Doctor Category not found");
  await audit("DOCTOR_CATEGORY_UPDATED", "DoctorCategory", String(row._id), { tenantSlug });
  res.json({ data: serializeDocument(row) });
}));

companyRouter.post("/doctor-categories/:id/deactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const row = await DoctorCategoryModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, { status: "INACTIVE" }, { new: true });
  if (!row) throw new HttpError(404, "Doctor Category not found");
  await audit("DOCTOR_CATEGORY_DEACTIVATED", "DoctorCategory", String(row._id), { tenantSlug });
  res.json({ data: serializeDocument(row) });
}));

companyRouter.post("/doctor-categories/:id/reactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const row = await DoctorCategoryModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, { status: "ACTIVE" }, { new: true });
  if (!row) throw new HttpError(404, "Doctor Category not found");
  await audit("DOCTOR_CATEGORY_REACTIVATED", "DoctorCategory", String(row._id), { tenantSlug });
  res.json({ data: serializeDocument(row) });
}));

// ─── Doctor Speciality ────────────────────────────────────────────────

const doctorSpecialitySchema = z.object({
  shortName: z.string().trim().optional().nullable(),
  specialityName: z.string().min(1),
  noOfSlides: z.number().int().optional().nullable(),
  sortOrder: z.number().int().optional().nullable()
});
const doctorSpecialityUpdateSchema = doctorSpecialitySchema.partial();

companyRouter.get("/doctor-specialities", asyncHandler(async (req, res) => {
  const rows = await DoctorSpecialityModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ sortOrder: 1, createdAt: 1 });
  res.json({ data: rows.map(serializeDocument) });
}));

companyRouter.post("/doctor-specialities", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = doctorSpecialitySchema.parse(req.body);
  const row = await DoctorSpecialityModel.create({ ...body, tenantSlug });
  await audit("DOCTOR_SPECIALITY_CREATED", "DoctorSpeciality", String(row._id), { tenantSlug });
  res.status(201).json({ data: serializeDocument(row) });
}));

companyRouter.put("/doctor-specialities/:id", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = doctorSpecialityUpdateSchema.parse(req.body);
  const row = await DoctorSpecialityModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, body, { new: true });
  if (!row) throw new HttpError(404, "Doctor Speciality not found");
  await audit("DOCTOR_SPECIALITY_UPDATED", "DoctorSpeciality", String(row._id), { tenantSlug });
  res.json({ data: serializeDocument(row) });
}));

companyRouter.post("/doctor-specialities/:id/deactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const row = await DoctorSpecialityModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, { status: "INACTIVE" }, { new: true });
  if (!row) throw new HttpError(404, "Doctor Speciality not found");
  await audit("DOCTOR_SPECIALITY_DEACTIVATED", "DoctorSpeciality", String(row._id), { tenantSlug });
  res.json({ data: serializeDocument(row) });
}));

companyRouter.post("/doctor-specialities/:id/reactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const row = await DoctorSpecialityModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, { status: "ACTIVE" }, { new: true });
  if (!row) throw new HttpError(404, "Doctor Speciality not found");
  await audit("DOCTOR_SPECIALITY_REACTIVATED", "DoctorSpeciality", String(row._id), { tenantSlug });
  res.json({ data: serializeDocument(row) });
}));

// ─── Doctor Qualification ─────────────────────────────────────────────

const doctorQualificationSchema = z.object({
  qualificationName: z.string().min(1),
  sortOrder: z.number().int().optional().nullable()
});
const doctorQualificationUpdateSchema = doctorQualificationSchema.partial();

companyRouter.get("/doctor-qualifications", asyncHandler(async (req, res) => {
  const rows = await DoctorQualificationModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ sortOrder: 1, createdAt: 1 });
  res.json({ data: rows.map(serializeDocument) });
}));

companyRouter.post("/doctor-qualifications", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = doctorQualificationSchema.parse(req.body);
  const row = await DoctorQualificationModel.create({ ...body, tenantSlug });
  await audit("DOCTOR_QUALIFICATION_CREATED", "DoctorQualification", String(row._id), { tenantSlug });
  res.status(201).json({ data: serializeDocument(row) });
}));

companyRouter.put("/doctor-qualifications/:id", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = doctorQualificationUpdateSchema.parse(req.body);
  const row = await DoctorQualificationModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, body, { new: true });
  if (!row) throw new HttpError(404, "Doctor Qualification not found");
  await audit("DOCTOR_QUALIFICATION_UPDATED", "DoctorQualification", String(row._id), { tenantSlug });
  res.json({ data: serializeDocument(row) });
}));

companyRouter.post("/doctor-qualifications/:id/deactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const row = await DoctorQualificationModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, { status: "INACTIVE" }, { new: true });
  if (!row) throw new HttpError(404, "Doctor Qualification not found");
  await audit("DOCTOR_QUALIFICATION_DEACTIVATED", "DoctorQualification", String(row._id), { tenantSlug });
  res.json({ data: serializeDocument(row) });
}));

companyRouter.post("/doctor-qualifications/:id/reactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const row = await DoctorQualificationModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, { status: "ACTIVE" }, { new: true });
  if (!row) throw new HttpError(404, "Doctor Qualification not found");
  await audit("DOCTOR_QUALIFICATION_REACTIVATED", "DoctorQualification", String(row._id), { tenantSlug });
  res.json({ data: serializeDocument(row) });
}));

// ─── Product Groups (read-only, imported from Excel) ────────────────────────

companyRouter.get("/product-groups", asyncHandler(async (req, res) => {
  const rows = await ProductGroupModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ moleculeName: 1 });
  res.json({ data: rows.map(serializeDocument) });
}));

// ─── Chemist / Dealers (read-only, imported from Excel) ─────────────────────

companyRouter.get("/dealers", asyncHandler(async (req, res) => {
  const rows = await DealerModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ sourceSNo: 1 });
  res.json({ data: rows.map(serializeDocument) });
}));

// ─── Holidays (read-only, imported from Excel) ───────────────────────────────

companyRouter.get("/holidays", asyncHandler(async (req, res) => {
  const rows = await HolidayModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ sourceSNo: 1 });
  res.json({ data: rows.map(serializeDocument) });
}));

// ─── SFC (read-only, imported from Excel) ────────────────────────────────────

companyRouter.get("/sfc", asyncHandler(async (req, res) => {
  const rows = await SfcModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ sourceSNo: 1 });
  res.json({ data: rows.map(serializeDocument) });
}));

// ─── Expense (read-only, imported from Excel) — backs SFC Updation, Allowance
// Fixation, and Fixed/Variable Expense Parameter, each rendering a different
// subset of the same records ───────────────────────────────────────────────

companyRouter.get("/expenses", asyncHandler(async (req, res) => {
  const rows = await ExpenseModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ role: 1 });
  res.json({ data: rows.map(serializeDocument) });
}));

// ─── Hospitals ─────────────────────────────────────────────────────────────

const hospitalValidation = z.object({
  hospitalCode: z.string().min(1),
  hospitalName: z.string().min(1),
  type: z.enum(["Private", "Government", "Trust", "Other"]).default("Private"),
  city: z.string().optional(),
  medicalRepresentative: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE")
});

companyRouter.get("/hospitals", asyncHandler(async (req, res) => {
  const hospitals = await HospitalModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ createdAt: -1 });
  res.json({ data: hospitals.map(serializeDocument) });
}));

companyRouter.post("/hospitals", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = hospitalValidation.parse(req.body);
  const hospital = await HospitalModel.create({ ...body, tenantSlug });
  await audit("HOSPITAL_CREATED", "Hospital", String(hospital._id), { tenantSlug });
  res.status(201).json({ data: serializeDocument(hospital) });
}));

companyRouter.put("/hospitals/:id", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = hospitalValidation.partial().parse(req.body);
  const hospital = await HospitalModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, body, { new: true });
  if (!hospital) throw new HttpError(404, "Hospital not found");
  await audit("HOSPITAL_UPDATED", "Hospital", String(hospital._id), { tenantSlug });
  res.json({ data: serializeDocument(hospital) });
}));

// ─── Unlisted Doctors ──────────────────────────────────────────────────────

const unlistedDoctorValidation = z.object({
  tempCode: z.string().min(1),
  name: z.string().min(1),
  specialty: z.string().optional(),
  city: z.string().optional(),
  mr: z.string().optional(),
  clinicName: z.string().optional(),
  address: z.string().optional(),
  area: z.string().optional(),
  state: z.string().optional(),
  pinCode: z.string().optional(),
  patch: z.string().optional(),
  hq: z.string().optional(),
  mobile: z.string().optional(),
  email: z.string().optional(),
  visitFrequency: z.string().optional(),
  potential: z.string().optional(),
  remarks: z.string().optional(),
  approvedBy: z.string().optional(),
  dob: z.string().optional(),
  anniversaryDate: z.string().optional(),
  status: z.enum(["Pending", "Approved", "Rejected"]).default("Pending")
});

companyRouter.get("/unlisted-doctors", asyncHandler(async (req, res) => {
  const docs = await UnlistedDoctorModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ createdAt: -1 });
  res.json({ data: docs.map(serializeDocument) });
}));

companyRouter.post("/unlisted-doctors", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = unlistedDoctorValidation.parse(req.body);
  const doc = await UnlistedDoctorModel.create({ ...body, tenantSlug });
  await audit("UNLISTED_DOCTOR_CREATED", "UnlistedDoctor", String(doc._id), { tenantSlug });
  res.status(201).json({ data: serializeDocument(doc) });
}));

companyRouter.put("/unlisted-doctors/:id", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = unlistedDoctorValidation.partial().parse(req.body);
  const doc = await UnlistedDoctorModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, body, { new: true });
  if (!doc) throw new HttpError(404, "Unlisted Doctor not found");
  await audit("UNLISTED_DOCTOR_UPDATED", "UnlistedDoctor", String(doc._id), { tenantSlug, status: doc.status });
  res.json({ data: serializeDocument(doc) });
}));

// ─── Territory Doctor Connections ─────────────────────────────────────────

companyRouter.get("/territory/doctor-counts", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  // Group by territory (patch) to get doctor counts.
  // We need to also include HQ information, which we could look up or just infer from employees.
  const agg = await DoctorModel.aggregate([
    { $match: { tenantSlug } },
    { $group: {
      _id: "$territory",
      totalDoctors: { $sum: 1 },
      activeDoctors: {
        $sum: { $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0] }
      },
      mrCode: { $first: "$mappedEmployeeCode" }
    }}
  ]);

  // Lookup HQ for MRs
  const counts = await Promise.all(agg.map(async (doc) => {
    let hq = "Unknown";
    let division = "Zivira";
    if (doc.mrCode) {
      const emp = await EmployeeModel.findOne({ tenantSlug, employeeCode: doc.mrCode });
      if (emp) {
        hq = emp.territory || "Unknown";
        division = emp.division || "Zivira";
      }
    }
    return {
      patch: doc._id || "Unassigned",
      hq,
      division,
      totalDoctors: doc.totalDoctors,
      activeDoctors: doc.activeDoctors
    };
  }));

  res.json({ data: counts });
}));

companyRouter.post("/territory/bulk-deactivate", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const patchSchema = z.object({ patch: z.string().min(1) });
  const { patch } = patchSchema.parse(req.body);

  const result = await DoctorModel.updateMany(
    { tenantSlug, territory: patch },
    { $set: { status: "INACTIVE" } }
  );

  await audit("TERRITORY_BULK_DEACTIVATED", "Territory", patch, { tenantSlug, modifiedCount: result.modifiedCount });
  res.json({ data: { success: true, modifiedCount: result.modifiedCount } });
}));

// ══════════════════════════════════════════════════════════════════════
// PRD Section 12.5 — GST Multi-Branch Location — Admin "Branches & GST" tab
// ══════════════════════════════════════════════════════════════════════

const companyBranchValidation = z.object({
  branchName: z.string().min(2),
  gstNumber: z.string().min(15, "GST number must be 15 characters").max(15),
  address: z.string().min(2),
  city: z.string().min(2),
  state: z.string().min(2),
  pincode: z.string().min(4),
  isHeadquarters: z.boolean().optional().default(false),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE")
});

companyRouter.get("/branches", asyncHandler(async (req, res) => {
  const branches = await CompanyBranchModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ isHeadquarters: -1, branchName: 1 });
  res.json({ data: branches.map(serializeDocument) });
}));

companyRouter.post("/branches", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = companyBranchValidation.parse(req.body);
  const gstNumber = body.gstNumber.toUpperCase().trim();

  const dupe = await CompanyBranchModel.findOne({ tenantSlug, gstNumber });
  if (dupe) throw new HttpError(409, `This GST number is already registered to ${dupe.branchName}`);

  if (body.isHeadquarters) {
    await CompanyBranchModel.updateMany({ tenantSlug }, { $set: { isHeadquarters: false } });
  }

  const branch = await CompanyBranchModel.create({ ...body, gstNumber, tenantSlug });
  await audit("COMPANY_BRANCH_CREATED", "CompanyBranch", String(branch._id), { tenantSlug, branchName: branch.branchName });
  res.status(201).json({ data: serializeDocument(branch) });
}));

companyRouter.patch("/branches/:id", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const body = companyBranchValidation.partial().parse(req.body);
  const update: Record<string, unknown> = { ...body };
  if (body.gstNumber) {
    const gstNumber = body.gstNumber.toUpperCase().trim();
    const dupe = await CompanyBranchModel.findOne({ tenantSlug, gstNumber, _id: { $ne: req.params.id } });
    if (dupe) throw new HttpError(409, `This GST number is already registered to ${dupe.branchName}`);
    update.gstNumber = gstNumber;
  }
  if (body.isHeadquarters) {
    await CompanyBranchModel.updateMany({ tenantSlug, _id: { $ne: req.params.id } }, { $set: { isHeadquarters: false } });
  }
  const branch = await CompanyBranchModel.findOneAndUpdate({ _id: req.params.id, tenantSlug }, update, { new: true });
  if (!branch) throw new HttpError(404, "Branch not found");
  await audit("COMPANY_BRANCH_UPDATED", "CompanyBranch", String(branch._id), { tenantSlug });
  res.json({ data: serializeDocument(branch) });
}));

// GET /company/branches/lookup?gst=29AAACZ3085J1ZP — returns the branch
// matching that GST number, or 404 if it's not one of Zivira's own branches
// (e.g. a distributor's GST appearing on their statement — PRD "Exact
// Solution": skip auto-fill and leave branch as manual selection).
companyRouter.get("/branches/lookup", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const gst = typeof req.query.gst === "string" ? req.query.gst.toUpperCase().trim() : "";
  if (!gst) throw new HttpError(400, "gst query parameter is required");
  const branch = await CompanyBranchModel.findOne({ tenantSlug, gstNumber: gst });
  if (!branch) throw new HttpError(404, "No branch registered with this GST number");
  res.json({ data: serializeDocument(branch) });
}));

// ══════════════════════════════════════════════════════════════════════
// PRD Section 12.1 — Tour Plan — Admin read-only view across all managers
// ══════════════════════════════════════════════════════════════════════
companyRouter.get("/tour-plans", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const query: Record<string, unknown> = { tenantSlug };
  if (typeof req.query.month === "string" && req.query.month) query.month = req.query.month;
  if (typeof req.query.status === "string" && req.query.status) query.status = req.query.status;
  const tps = await TourPlanModel.find(query).sort({ createdAt: -1 }).limit(1000);
  res.json({ data: tps.map(serializeDocument) });
}));

// ══════════════════════════════════════════════════════════════════════
// Expense Claims — Admin-wide view + branch/GST report (Section 12.5
// follow-up: GST Branch → claims linkage). Filterable by month/status/branch.
// ══════════════════════════════════════════════════════════════════════
companyRouter.get("/expense-claims", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const query: Record<string, unknown> = { tenantSlug };
  if (typeof req.query.month === "string" && req.query.month) query.month = req.query.month;
  if (typeof req.query.status === "string" && req.query.status) query.status = req.query.status;
  if (typeof req.query.gstBranchCode === "string" && req.query.gstBranchCode) query.gstBranchCode = req.query.gstBranchCode;
  const claims = await ExpenseClaimModel.find(query).sort({ createdAt: -1 }).limit(1000);
  res.json({ data: claims.map(serializeDocument) });
}));

companyRouter.get("/expense-claims/branch-summary", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : undefined;

  const match: Record<string, unknown> = { tenantSlug };
  if (month) match.month = month;

  const rows = await ExpenseClaimModel.aggregate([
    { $match: match },
    { $group: {
      _id: { gstBranchCode: "$gstBranchCode", gstBranchName: "$gstBranchName" },
      totalClaims: { $sum: 1 },
      totalAmountRs: { $sum: "$amountRs" },
      approvedAmountRs: { $sum: { $cond: [{ $eq: ["$status", "APPROVED"] }, "$amountRs", 0] } },
      pendingAmountRs: { $sum: { $cond: [{ $eq: ["$status", "SUBMITTED"] }, "$amountRs", 0] } },
      rejectedAmountRs: { $sum: { $cond: [{ $eq: ["$status", "REJECTED"] }, "$amountRs", 0] } }
    } },
    { $project: {
      _id: 0,
      gstBranchCode: "$_id.gstBranchCode",
      gstBranchName: "$_id.gstBranchName",
      totalClaims: 1, totalAmountRs: 1, approvedAmountRs: 1, pendingAmountRs: 1, rejectedAmountRs: 1
    } },
    { $sort: { totalAmountRs: -1 } }
  ]);
  res.json({ data: rows, month: month ?? "all" });
}));

// ══════════════════════════════════════════════════════════════════════
// PRD Section 12.2 — Visit Summary (admin-wide, filterable by MR)
// ══════════════════════════════════════════════════════════════════════
companyRouter.get("/visit-summary", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : undefined;
  const employeeCode = typeof req.query.employeeCode === "string" ? req.query.employeeCode : undefined;

  const match: Record<string, unknown> = { tenantSlug, status: { $ne: "REJECTED" } };
  if (month) match.month = month;
  if (employeeCode) match.employeeCode = employeeCode;

  const rows = await DcrModel.aggregate([
    { $match: match },
    { $group: { _id: "$doctorId", visitCount: { $sum: 1 }, lastVisitDate: { $max: "$visitDate" } } },
    { $lookup: { from: "doctors", localField: "_id", foreignField: "_id", as: "doctor" } },
    { $unwind: { path: "$doctor", preserveNullAndEmptyArrays: true } },
    { $project: {
      doctorId: "$_id", _id: 0,
      doctorName: "$doctor.name",
      mappedEmployeeCode: "$doctor.mappedEmployeeCode",
      visitCount: 1, lastVisitDate: 1,
      overVisitFlag: { $gte: ["$visitCount", 3] }
    } },
    { $sort: { doctorName: 1 } }
  ]);
  res.json({ data: rows, month: month ?? "all" });
}));

// ══════════════════════════════════════════════════════════════════════
// PRD Section 12.3A — Drug Summary (samples given, per product, per doctor)
// ══════════════════════════════════════════════════════════════════════
companyRouter.get("/drug-summary", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : undefined;
  const doctorId = typeof req.query.doctorId === "string" ? req.query.doctorId : undefined;

  const match: Record<string, unknown> = { tenantSlug, status: { $ne: "REJECTED" } };
  if (month) match.month = month;
  if (doctorId) match.doctorId = new mongoose.Types.ObjectId(doctorId);

  const rows = await DcrModel.aggregate([
    { $match: match },
    { $unwind: { path: "$samplesGiven", preserveNullAndEmptyArrays: true } },
    { $match: { samplesGiven: { $ne: null } } },
    { $group: {
      _id: { doctorId: "$doctorId", productCode: "$samplesGiven.productCode", productName: "$samplesGiven.productName" },
      totalQty: { $sum: "$samplesGiven.qty" },
      visitCount: { $sum: 1 }
    } },
    { $project: { _id: 0, doctorId: "$_id.doctorId", productCode: "$_id.productCode", productName: "$_id.productName", totalQty: 1, visitCount: 1 } },
    { $sort: { totalQty: -1 } }
  ]);
  res.json({ data: rows, month: month ?? "all" });
}));

// ══════════════════════════════════════════════════════════════════════
// PRD Section 12.3B — Gift Summary (inputs given, per item type, per doctor)
// ══════════════════════════════════════════════════════════════════════
companyRouter.get("/gift-summary", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : undefined;
  const doctorId = typeof req.query.doctorId === "string" ? req.query.doctorId : undefined;

  const match: Record<string, unknown> = { tenantSlug, status: { $ne: "REJECTED" } };
  if (month) match.month = month;
  if (doctorId) match.doctorId = new mongoose.Types.ObjectId(doctorId);

  const thresholdRaw = await getConfigValue(tenantSlug, "GIFT_VALUE_THRESHOLD_RS");
  const threshold = typeof thresholdRaw === "number" ? thresholdRaw : Number(DEFAULT_CONFIG.GIFT_VALUE_THRESHOLD_RS);

  const rows = await DcrModel.aggregate([
    { $match: match },
    { $unwind: { path: "$inputsGiven", preserveNullAndEmptyArrays: true } },
    { $match: { inputsGiven: { $ne: null } } },
    { $group: {
      _id: { doctorId: "$doctorId", itemType: "$inputsGiven.itemType" },
      totalQty: { $sum: "$inputsGiven.qty" },
      totalValue: { $sum: { $ifNull: ["$inputsGiven.valueRs", 0] } }
    } },
    { $project: { _id: 0, doctorId: "$_id.doctorId", itemType: "$_id.itemType", totalQty: 1, totalValue: 1, overThreshold: { $gt: ["$totalValue", threshold] } } },
    { $sort: { totalValue: -1 } }
  ]);
  res.json({ data: rows, month: month ?? "all", thresholdRs: threshold });
}));

// ══════════════════════════════════════════════════════════════════════
// PRD Section 12.3 — Admin MIS "Doctor Coverage" sub-tab: Doctor Name, Total
// Visits, Total Samples (units), Total Gifts (units), Last Visit Date,
// Assigned MR — everything in one row per doctor, ready for CSV export.
// ══════════════════════════════════════════════════════════════════════
companyRouter.get("/doctor-coverage", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : undefined;
  const match: Record<string, unknown> = { tenantSlug, status: { $ne: "REJECTED" } };
  if (month) match.month = month;

  const [visitRows, sampleRows, giftRows, doctors] = await Promise.all([
    DcrModel.aggregate([
      { $match: match },
      { $group: { _id: "$doctorId", visitCount: { $sum: 1 }, lastVisitDate: { $max: "$visitDate" } } }
    ]),
    DcrModel.aggregate([
      { $match: match },
      { $unwind: { path: "$samplesGiven", preserveNullAndEmptyArrays: true } },
      { $match: { samplesGiven: { $ne: null } } },
      { $group: { _id: "$doctorId", totalSamples: { $sum: "$samplesGiven.qty" } } }
    ]),
    DcrModel.aggregate([
      { $match: match },
      { $unwind: { path: "$inputsGiven", preserveNullAndEmptyArrays: true } },
      { $match: { inputsGiven: { $ne: null } } },
      { $group: { _id: "$doctorId", totalGifts: { $sum: "$inputsGiven.qty" }, totalGiftValue: { $sum: { $ifNull: ["$inputsGiven.valueRs", 0] } } } }
    ]),
    DoctorModel.find({ tenantSlug, status: "ACTIVE" }).lean()
  ]);

  const visitMap = new Map(visitRows.map((r) => [String(r._id), r]));
  const sampleMap = new Map(sampleRows.map((r) => [String(r._id), r.totalSamples]));
  const giftMap = new Map(giftRows.map((r) => [String(r._id), r]));
  const thresholdRaw = await getConfigValue(tenantSlug, "GIFT_VALUE_THRESHOLD_RS");
  const threshold = typeof thresholdRaw === "number" ? thresholdRaw : Number(DEFAULT_CONFIG.GIFT_VALUE_THRESHOLD_RS);

  const data = doctors.map((doctor) => {
    const id = String(doctor._id);
    const visit = visitMap.get(id);
    const gift = giftMap.get(id);
    return {
      doctorId: id,
      doctorName: doctor.name,
      specialty: doctor.specialty,
      assignedMR: doctor.mappedEmployeeCode ?? null,
      totalVisits: visit?.visitCount ?? 0,
      lastVisitDate: visit?.lastVisitDate ?? null,
      totalSamples: sampleMap.get(id) ?? 0,
      totalGifts: gift?.totalGifts ?? 0,
      totalGiftValueRs: gift?.totalGiftValue ?? 0,
      overGiftThreshold: (gift?.totalGiftValue ?? 0) > threshold
    };
  });

  res.json({ data, month: month ?? "all", thresholdRs: threshold });
}));

// ══════════════════════════════════════════════════════════════════════
// Platform settings — GIFT_VALUE_THRESHOLD_RS (PRD 12.3B "Exact Solution":
// "Store GIFT_VALUE_THRESHOLD_RS in CompanyConfig model, default 500. Admin
// can edit in Platform Settings.")
// ══════════════════════════════════════════════════════════════════════
companyRouter.get("/config", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const rows = await CompanyConfigModel.find({ tenantSlug }).lean();
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({ data: { ...DEFAULT_CONFIG, ...byKey } });
}));

companyRouter.patch("/config/:key", asyncHandler(async (req, res) => {
  const tenantSlug = req.auth!.tenantSlug!;
  const { value } = z.object({ value: z.union([z.number(), z.string(), z.boolean()]) }).parse(req.body);
  const row = await CompanyConfigModel.findOneAndUpdate(
    { tenantSlug, key: req.params.key },
    { tenantSlug, key: req.params.key, value, updatedBy: req.auth!.sub },
    { upsert: true, new: true }
  );
  await audit("COMPANY_CONFIG_UPDATED", "CompanyConfig", String(row._id), { tenantSlug, key: req.params.key, value });
  res.json({ data: serializeDocument(row) });
}));

