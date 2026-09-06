/**
 * IRS Pub 946, Table A-1 — 200% declining balance, half-year convention.
 * These percentages are a fixed mathematical result of the declining-balance
 * method switching to straight-line partway through (the standard published
 * table every preparer already uses), unlike the bonus depreciation rate,
 * which is set by statute and changes by tax year — that's why bonus % is a
 * user-entered field on the asset, not a table like this one.
 *
 * Scoped to 5-year and 7-year property (the two classes covering the vast
 * majority of a small business's signage/equipment/vehicles/furniture).
 * Mid-quarter convention and other property classes are out of scope —
 * verified against CELLTOTAL LLC's actual filed Form 4562 (5-year property,
 * $4,050 basis, 20.00% Year-1 rate = $810.00, matching the return exactly).
 */
export type MacrsPropertyClass = "5-Year" | "7-Year";

export const MACRS_HALF_YEAR_TABLES: Record<MacrsPropertyClass, number[]> = {
  "5-Year": [20.00, 32.00, 19.20, 11.52, 11.52, 5.76],
  "7-Year": [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
};

export function isMacrsPropertyClass(v: unknown): v is MacrsPropertyClass {
  return v === "5-Year" || v === "7-Year";
}
