import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { requireAuth, requireCompanyAdmin } from "../http/auth.js";
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
    const employees = await EmployeeModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ createdAt: -1 });
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
    const doctors = await DoctorModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ createdAt: -1 });
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
  const products = await ProductCatalogModel.find({ tenantSlug: req.auth!.tenantSlug }).sort({ sortOrder: 1, createdAt: 1 });
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
