// src/seed/fix-data-corrections.ts
//
// Targeted, non-destructive data correction for two specific issues reported
// against the live tenant data (NOT the demo seed logic in exact-10.ts,
// which is a full wipe+reset and would also erase any real records the user
// has since added through the admin UI):
//
//   1. Any string field anywhere across the masters registry that is exactly
//      "ARA" (case-insensitive, whole-value match — never a substring, so a
//      genuine surname or word that merely contains "ara" is left alone) is
//      corrected to "Aura".
//   2. Any Doctor Category value of "D" is remapped to A/B/C. The registry
//      (src/masters/registry.ts) has only ever offered A/B/C as options —
//      "D" can only exist in already-stored documents from before that was
//      enforced — so this cycles existing "D" rows across A/B/C evenly
//      rather than dumping them all into one bucket.
//
// Safe to re-run any time: it only touches documents that still match the
// bad value, so a second run is a no-op.

import { connectMongo } from "../db.js";
import { getMasterModel } from "../models/master-record.model.js";
import { MASTERS } from "../masters/registry.js";
import { EmployeeModel } from "../models/employee.model.js";

const TENANT = "zivira-labs";
const ROTATION: readonly string[] = ["A", "B", "C"];

async function fixAraSpelling() {
  console.log("\n── Fixing 'ARA' -> 'Aura' across all master collections ──");
  let totalFixed = 0;

  for (const config of MASTERS) {
    const Model = getMasterModel(config.key);
    const stringFieldKeys = config.fields.map((f) => f.key);

    for (const key of stringFieldKeys) {
      const matches = await Model.find({
        tenantSlug: TENANT,
        [key]: { $regex: /^ARA$/i }
      });
      if (!matches.length) continue;

      for (const doc of matches) {
        (doc as any)[key] = "Aura";
        await doc.save();
      }
      totalFixed += matches.length;
      console.log(`  [FIXED] ${config.key}.${key}: ${matches.length} record(s) "ARA" -> "Aura"`);
    }
  }

  // The employees collection is a hand-written legacy model (not part of the
  // generic masters registry) whose free-text "division" field can carry the
  // same typo — Division Master's own dropdown already only offers
  // Astra/Aura/Zivira, but this field is a separate plain string.
  const badEmployees = await EmployeeModel.find({ tenantSlug: TENANT, division: { $regex: /^ARA$/i } });
  if (badEmployees.length) {
    for (const doc of badEmployees) {
      (doc as any).division = "Aura";
      await doc.save();
    }
    totalFixed += badEmployees.length;
    console.log(`  [FIXED] employees.division: ${badEmployees.length} record(s) "ARA" -> "Aura"`);
  }

  console.log(totalFixed ? `  Total corrected: ${totalFixed}` : "  No 'ARA' values found — nothing to fix.");
}

async function fixDoctorCategoryD() {
  console.log("\n── Removing Doctor Category 'D' (A/B/C only) ──");
  let totalFixed = 0;

  // Every master whose registry entry restricts a field to exactly the
  // A/B/C doctor-category options — covers doctorClassification today, and
  // automatically covers any future master reusing the same options list
  // without needing this script updated.
  for (const config of MASTERS) {
    for (const field of config.fields) {
      if (!field.options || field.options.length !== 3) continue;
      if (!(field.options.includes("A") && field.options.includes("B") && field.options.includes("C"))) continue;

      const Model = getMasterModel(config.key);
      const matches = await Model.find({ tenantSlug: TENANT, [field.key]: { $regex: /^D$/i } }).sort({ createdAt: 1 });
      if (!matches.length) continue;

      for (let i = 0; i < matches.length; i++) {
        const doc = matches[i];
        (doc as any)[field.key] = ROTATION[i % ROTATION.length];
        await doc.save();
      }
      totalFixed += matches.length;
      console.log(`  [FIXED] ${config.key}.${field.key}: ${matches.length} record(s) "D" remapped across A/B/C`);
    }
  }

  console.log(totalFixed ? `  Total corrected: ${totalFixed}` : "  No Category 'D' values found — nothing to fix.");
}

export async function runDataCorrections() {
  await connectMongo();
  console.log(`Connected. Running targeted data corrections for tenant "${TENANT}" (no records deleted, no other fields touched)...`);

  await fixAraSpelling();
  await fixDoctorCategoryD();

  console.log("\nDone.");
}
