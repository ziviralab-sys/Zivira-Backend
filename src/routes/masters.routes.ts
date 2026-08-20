import { Router } from "express";
import { asyncHandler } from "../http/async-handler.js";
import { HttpError } from "../http/errors.js";
import { getMasterModel } from "../models/master-record.model.js";
import { MASTERS, getMasterConfig } from "../masters/registry.js";
import { audit } from "../utils/audit.js";
import { serializeDocument } from "../utils/serialize.js";

export const mastersRouter = Router();

// Every masters response must always be fresh — a stale cached list after a
// successful save is what makes a real duplicate-code error look like a bug.
mastersRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

function requireConfig(key: string) {
  const config = getMasterConfig(key);
  if (!config) {
    throw new HttpError(404, `Unknown master: ${key}`);
  }
  return config;
}

// Defense-in-depth: any field declared with a fixed `options` list (e.g.
// Doctor Category -> A/B/C) can only ever be saved as one of those exact
// values, no matter what the client sends. This is what keeps a stray value
// like a leftover "D" from ever finding its way back into a fixed-choice
// column, even if a client bug or an old cached form manages to submit one.
function validateOptionFields(config: ReturnType<typeof requireConfig>, body: Record<string, unknown>) {
  for (const f of config.fields) {
    if (!f.options || !f.options.length) continue;
    const val = body[f.key];
    if (val === undefined || val === null || val === "") continue;
    if (!f.options.includes(String(val))) {
      throw new HttpError(400, `${f.label} must be one of: ${f.options.join(", ")}`);
    }
  }
}

// Zivira_Master_Tab_Client_Change_3B.docx — "the key calculations should be
// centralized in the backend/service layer rather than duplicated in the
// frontend": Target Value = Target Unit x Unit Price, and Net Sale
// Unit/Value = Sales - Return for both Primary and Secondary Sales. Mutates
// `doc` in place (the record about to be saved) so the client never has to
// compute or submit these — it can send them, but whatever it sends is
// overwritten with the real calculation.
function applyComputedSalesFields(key: string, doc: Record<string, unknown>) {
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  if (key === "targetMaster") {
    doc.targetValue = num(doc.targetUnit) * num(doc.unitPrice);
  }

  if (key === "primarySales" || key === "secondarySales") {
    doc.netSaleUnit = num(doc.salesUnit) - num(doc.returnUnit);
    doc.netSaleValue = num(doc.salesValue) - num(doc.returnValue);
  }
}

// GET /masters — list every master's key/title/fields, so the frontend can render
// exact document headers without hardcoding them anywhere.
mastersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ data: MASTERS.map(({ key, title, fields, keyFields }) => ({ key, title, fields, keyFields })) });
  })
);

// GET /masters/:key/schema — field list + labels for a single master
mastersRouter.get(
  "/:key/schema",
  asyncHandler(async (req, res) => {
    const config = requireConfig(req.params.key);
    res.json({ data: config });
  })
);

// GET /masters/:key — list all records for this tenant. Supports filtering
// by any declared field via query params (e.g. ?division=Astra&hq=Chennai),
// so the Sales tab's cascading Division -> Zone -> Region -> Area -> HQ ->
// Product -> Month dropdowns (Zivira_Master_Tab_Client_Change_3B.docx) can
// narrow results without the frontend having to fetch and filter everything
// client-side.
mastersRouter.get(
  "/:key",
  asyncHandler(async (req, res) => {
    const config = requireConfig(req.params.key);
    const Model = getMasterModel(config.key);
    const filter: Record<string, unknown> = { tenantSlug: req.auth!.tenantSlug };
    const fieldKeys = new Set(config.fields.map((f) => f.key));
    for (const [key, value] of Object.entries(req.query)) {
      if (!fieldKeys.has(key) || typeof value !== "string" || !value.trim()) continue;
      filter[key] = value;
    }
    const records = await Model.find(filter).sort({ createdAt: 1 });
    res.json({ data: records.map(serializeDocument), schema: config });
  })
);

// POST /masters/:key — create one record
mastersRouter.post(
  "/:key",
  asyncHandler(async (req, res) => {
    const config = requireConfig(req.params.key);
    const Model = getMasterModel(config.key);
    const tenantSlug = req.auth!.tenantSlug;

    const missing = config.fields
      .filter((f) => config.keyFields.includes(f.key))
      .filter((f) => req.body[f.key] === undefined || req.body[f.key] === null || req.body[f.key] === "");
    if (missing.length) {
      throw new HttpError(400, `Missing required field(s): ${missing.map((f) => f.label).join(", ")}`);
    }

    validateOptionFields(config, req.body);

    const keyFilter: Record<string, unknown> = { tenantSlug };
    for (const k of config.keyFields) keyFilter[k] = req.body[k];
    const existing = await Model.findOne(keyFilter);
    if (existing) {
      throw new HttpError(409, `A record with this ${config.keyFields.join(" + ")} already exists`);
    }

    for (const uf of config.uniqueFields ?? []) {
      if (req.body[uf] === undefined || req.body[uf] === null || req.body[uf] === "") continue;
      const dupe = await Model.findOne({ tenantSlug, [uf]: req.body[uf] });
      if (dupe) {
        const label = config.fields.find((f) => f.key === uf)?.label ?? uf;
        throw new HttpError(409, `A record with this ${label} already exists`);
      }
    }

    const doc: Record<string, unknown> = { tenantSlug, status: "Active" };
    for (const f of config.fields) {
      if (req.body[f.key] !== undefined) doc[f.key] = req.body[f.key];
    }
    applyComputedSalesFields(config.key, doc);

    const created = await Model.create(doc);
    await audit(`MASTER_${config.key.toUpperCase()}_CREATED`, config.key, String(created._id), { tenantSlug });
    res.status(201).json({ data: serializeDocument(created) });
  })
);

// PUT /masters/:key/:id — update one record
mastersRouter.put(
  "/:key/:id",
  asyncHandler(async (req, res) => {
    const config = requireConfig(req.params.key);
    const Model = getMasterModel(config.key);
    const tenantSlug = req.auth!.tenantSlug;

    const update: Record<string, unknown> = {};
    for (const f of config.fields) {
      if (req.body[f.key] !== undefined) update[f.key] = req.body[f.key];
    }

    validateOptionFields(config, update);

    for (const uf of config.uniqueFields ?? []) {
      if (update[uf] === undefined || update[uf] === null || update[uf] === "") continue;
      const dupe = await Model.findOne({ tenantSlug, [uf]: update[uf], _id: { $ne: req.params.id } });
      if (dupe) {
        const label = config.fields.find((f) => f.key === uf)?.label ?? uf;
        throw new HttpError(409, `A record with this ${label} already exists`);
      }
    }

    // A PUT here can be a partial update (e.g. only Return Unit changed) —
    // computing Target Value / Net Sale Unit / Net Sale Value from `update`
    // alone would silently drop whichever side of the calculation wasn't
    // resubmitted. Merge onto the existing record first so the computed
    // fields always reflect the real, complete row.
    if (config.key === "targetMaster" || config.key === "primarySales" || config.key === "secondarySales") {
      const existing = await Model.findOne({ _id: req.params.id, tenantSlug }).lean();
      if (!existing) throw new HttpError(404, `${config.title} record not found`);
      const merged: Record<string, unknown> = { ...existing, ...update };
      applyComputedSalesFields(config.key, merged);
      const computedKeys = config.key === "targetMaster" ? ["targetValue"] : ["netSaleUnit", "netSaleValue"];
      for (const k of computedKeys) update[k] = merged[k];
    }

    const updated = await Model.findOneAndUpdate({ _id: req.params.id, tenantSlug }, { $set: update }, { new: true });
    if (!updated) throw new HttpError(404, `${config.title} record not found`);

    await audit(`MASTER_${config.key.toUpperCase()}_UPDATED`, config.key, String(updated._id), { tenantSlug });
    res.json({ data: serializeDocument(updated) });
  })
);

// POST /masters/:key/:id/deactivate — soft delete
mastersRouter.post(
  "/:key/:id/deactivate",
  asyncHandler(async (req, res) => {
    const config = requireConfig(req.params.key);
    const Model = getMasterModel(config.key);
    const tenantSlug = req.auth!.tenantSlug;

    const updated = await Model.findOneAndUpdate(
      { _id: req.params.id, tenantSlug },
      { $set: { status: "Inactive" } },
      { new: true }
    );
    if (!updated) throw new HttpError(404, `${config.title} record not found`);

    await audit(`MASTER_${config.key.toUpperCase()}_DEACTIVATED`, config.key, String(updated._id), { tenantSlug });
    res.json({ data: serializeDocument(updated) });
  })
);

// POST /masters/:key/:id/reactivate
mastersRouter.post(
  "/:key/:id/reactivate",
  asyncHandler(async (req, res) => {
    const config = requireConfig(req.params.key);
    const Model = getMasterModel(config.key);
    const tenantSlug = req.auth!.tenantSlug;

    const updated = await Model.findOneAndUpdate(
      { _id: req.params.id, tenantSlug },
      { $set: { status: "Active" } },
      { new: true }
    );
    if (!updated) throw new HttpError(404, `${config.title} record not found`);

    res.json({ data: serializeDocument(updated) });
  })
);
