/**
 * HACCP business-type taxonomy, master menu/equipment checklist, and per-type
 * CCP/legal template bodies — mirrors contractContent.ts's pattern exactly
 * (code-level default + optional v3_haccp_templates DB override, resolved in
 * haccp.routes.ts). Content grounded in a real client's existing HACCP plan
 * (Chase Grocery And Deli LLC, reviewed this session) plus the Maryland
 * Department of Health's statewide HACCP Guidelines and COMAR 10.15.03, which
 * both Baltimore City and Baltimore County enforce identically — the only
 * jurisdiction-specific content is the letterhead/citation, handled in
 * haccpPdf.ts, not here.
 *
 * Cooking/cold-holding temperatures below (poultry 165°F, ground meat 155°F,
 * fish/pork/eggs 145°F, cold hold ≤41°F, hot hold ≥135°F) are the standard FDA
 * Food Code minimums Maryland adopts by reference under COMAR 10.15.03 — the
 * same figures the real Chase Grocery plan already uses. This is drafted to be
 * genuinely accurate for a typical Maryland retail food facility, but it is
 * still template language, not a substitute for the local health department's
 * own review of a specific facility's actual operation.
 */

export interface HaccpBusinessType {
  key: string;
  label: string;
  /**
   * The fee/priority tier printed on Baltimore City's own Food Facility
   * License Application (REQUIRED FEES BASED ON FACILITY TYPE/PRIORITY table:
   * High $520, Moderate $285, Low $65 — read directly off the real form).
   * "No cooking step on site" facilities (prepackaged/cold-hold only) are
   * genuinely Low Priority, not Moderate — a real filing mistake caught live,
   * 2026-09-28: Convenience Store/Grocery (No-Cook) was wrongly landing on
   * the $285 Moderate row instead of the $65 Low row.
   */
  riskPriority: "High" | "Moderate" | "Low";
  /** Whether this type's CCP table includes a cook step (cooking temps, no-hot-hold discard rule). */
  hasCookStep: boolean;
  /** Whether this type's CCP table includes hot-holding (steam table/warmer) in addition to cooking. */
  hasHotHolding: boolean;
  description: string;
  /**
   * The three facts Maryland's priority assessment asks for (COMAR 10.15.03.33C; the state's HACCP
   * submission guidelines, Section A): the foods, the food service system, and the population served.
   * Printed on the Menu & Equipment List when no HACCP plan is required, so a Low priority store still
   * hands the health department what it needs to classify it.
   */
  priorityAssessment: { foods: string; system: string; population: string };
  /** Why this type lands on its priority level, in plain words, plus when the health department may rate it differently. */
  priorityReason: string;
  /**
   * Which of the 3 canonical CCP content bodies (in BUILT_IN_HACCP_TEMPLATES,
   * keyed by convenience_grocery/deli_carryout/restaurant) this type resolves
   * to. Lets many descriptive business-type labels share one already-verified
   * CCP profile instead of needing new legal content drafted per label —
   * defaults to the type's own key when omitted (the 3 canonical types).
   */
  ccpProfileKey?: string;
}

export const HACCP_BUSINESS_TYPES: HaccpBusinessType[] = [
  {
    key: "convenience_grocery",
    label: "Convenience Store / Grocery (No-Cook)",
    riskPriority: "Low",
    hasCookStep: false,
    hasHotHolding: false,
    description: "Prepackaged and cold-hold items only — no cooking step on site.",
    priorityAssessment: {
      foods: "Commercially packaged foods only — including packaged foods that need refrigeration or freezing (dairy, eggs, ice cream, frozen food) — plus shelf-stable groceries and non-food items. Nothing is opened, cut, assembled or prepared on site.",
      system: "Cold hold-serve: refrigerated and frozen storage and display of packaged items. No cooking, reheating or hot-holding.",
      population: "General public, walk-in / over-the-counter customers. No highly susceptible population (hospital, nursing home, school) is served.",
    },
    priorityReason: "LOW — the store sells only commercially packaged foods. A facility selling only commercially packaged potentially hazardous foods does not need a HACCP plan (COMAR 10.15.03.34A). Becomes Moderate if staff heat, cut or assemble food for customers.",
  },
  {
    key: "grocery_deli_cold_only",
    label: "Grocery & Deli (Cold Cuts Only, No Cooking)",
    riskPriority: "Moderate",
    hasCookStep: false,
    hasHotHolding: false,
    description: "Deli counter serving cold cuts/salads by weight, plus grocery items — no cooking step on site.",
    priorityAssessment: {
      foods: "Cold cuts, cheeses and salads that are opened, sliced and portioned to order or sold by weight, plus packaged groceries. Nothing is cooked.",
      system: "Cold hold-serve: potentially hazardous foods are handled, sliced and served cold. No cooking, reheating or hot-holding.",
      population: "General public, walk-in / over-the-counter customers. No highly susceptible population (hospital, nursing home, school) is served.",
    },
    priorityReason: "MODERATE — potentially hazardous food is opened and sliced on site (not only sold in its original package), but it is never cooked, cooled or reheated. A HACCP plan is required (COMAR 10.15.03.34A).",
  },
  {
    key: "deli_carryout",
    label: "Deli / Carryout (Cook-and-Serve, No Hot-Holding)",
    riskPriority: "High",
    hasCookStep: true,
    hasHotHolding: false,
    description: "Made-to-order items prepared and served immediately; no extended hot-holding equipment.",
    priorityAssessment: {
      foods: "Cold ready-to-eat deli items plus made-to-order cooked items (breakfast sandwiches, hot subs, eggs cooked to order).",
      system: "Cook-serve for made-to-order items and cold hold-serve for ready-to-eat items. Cooked items are served immediately; there is no hot-holding equipment.",
      population: "General public, walk-in / over-the-counter customers. No highly susceptible population (hospital, nursing home, school) is served.",
    },
    priorityReason: "HIGH — the plan includes a cooking step and a cooling step, so food can pass through the 41-135°F range more than once. If every item is cooked to order, served immediately and nothing is cooled for later use, the health department may rate it Moderate. A HACCP plan is required either way.",
  },
  {
    key: "convenience_hot_food",
    label: "Convenience Store (With Hot Food)",
    riskPriority: "High",
    hasCookStep: true,
    hasHotHolding: false,
    description: "Convenience store with a made-to-order hot food counter (grill/fryer); no extended hot-holding equipment.",
    priorityAssessment: {
      foods: "Packaged groceries and refrigerated items, plus a made-to-order hot food counter (grill / fryer).",
      system: "Cook-serve for the hot food counter and cold hold-serve for packaged items. Cooked items are served immediately; there is no hot-holding equipment.",
      population: "General public, walk-in / over-the-counter customers. No highly susceptible population (hospital, nursing home, school) is served.",
    },
    priorityReason: "HIGH — the store cooks food on site (cook step, with cooling of any prepared ingredients). If everything is cooked to order, served immediately and nothing is cooled for later use, the health department may rate it Moderate. A HACCP plan and a Certified Food Manager are required.",
    ccpProfileKey: "deli_carryout",
  },
  {
    key: "grocery_deli_hot_food",
    label: "Grocery & Deli (Cold Cuts + Hot Food)",
    riskPriority: "High",
    hasCookStep: true,
    hasHotHolding: false,
    description: "Deli counter with both cold cuts and made-to-order hot food; no extended hot-holding equipment.",
    priorityAssessment: {
      foods: "Cold cuts and salads sliced to order, packaged groceries, and made-to-order hot food.",
      system: "Cold hold-serve for cold cuts and packaged items; cook-serve for hot food. Cooked items are served immediately; there is no hot-holding equipment.",
      population: "General public, walk-in / over-the-counter customers. No highly susceptible population (hospital, nursing home, school) is served.",
    },
    priorityReason: "HIGH — the deli both slices cold potentially hazardous food and cooks food on site. If everything hot is cooked to order, served immediately and nothing is cooled for later use, the health department may rate it Moderate. A HACCP plan and a Certified Food Manager are required.",
    ccpProfileKey: "deli_carryout",
  },
  {
    key: "restaurant",
    label: "Restaurant (Full-Service, With Hot-Holding)",
    riskPriority: "High",
    hasCookStep: true,
    hasHotHolding: true,
    description: "Full-service food preparation including hot-holding/steam-table equipment.",
    priorityAssessment: {
      foods: "Full menu of cooked and cold potentially hazardous foods prepared on site, including foods held hot on a steam table and leftovers that are cooled and reheated.",
      system: "Cook-serve, hot hold-serve and cold hold-serve, with cooling and reheating of prepared food.",
      population: "General public, walk-in / over-the-counter customers. No highly susceptible population (hospital, nursing home, school) is served.",
    },
    priorityReason: "HIGH — food is cooked, hot-held, cooled and reheated, so it passes through the 41-135°F range two or more times (COMAR 10.15.03.33C). A HACCP plan and a Certified Food Manager are required.",
  },
  {
    key: "grocery_hot_holding",
    label: "Grocery / Convenience (With Hot-Holding or Buffet)",
    riskPriority: "High",
    hasCookStep: true,
    hasHotHolding: true,
    description: "Grocery or convenience store operating a steam table, buffet, or other hot-holding display.",
    priorityAssessment: {
      foods: "Packaged groceries plus cooked foods held hot on a steam table, buffet or heated display.",
      system: "Cook-hot hold-serve for the hot display, with cooling and reheating of unsold food, and cold hold-serve for packaged items.",
      population: "General public, walk-in / over-the-counter customers. No highly susceptible population (hospital, nursing home, school) is served.",
    },
    priorityReason: "HIGH — hot-holding with cooling and reheating of leftovers means food passes through the 41-135°F range two or more times (COMAR 10.15.03.33C). A HACCP plan and a Certified Food Manager are required.",
    ccpProfileKey: "restaurant",
  },
];

export const HACCP_BUSINESS_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  HACCP_BUSINESS_TYPES.map((t) => [t.key, t.label])
);

export interface ChecklistItem {
  key: string;
  label: string;
}
export interface ChecklistCategory {
  category: string;
  items: ChecklistItem[];
}

/** Master menu-item checklist, grouped by category — every realistic item across all three business types; staff check off what applies. */
export const HACCP_MENU_CATEGORIES: ChecklistCategory[] = [
  {
    category: "Dairy",
    items: [
      { key: "butter", label: "Butter" },
      { key: "cheese", label: "Cheese" },
      { key: "eggs", label: "Eggs" },
      { key: "milk", label: "Milk" },
      { key: "yogurt", label: "Yogurt" },
    ],
  },
  {
    category: "Cold Food",
    items: [
      { key: "breakfast_sandwiches", label: "Breakfast Sandwiches" },
      { key: "cold_subs", label: "Cold Subs" },
      { key: "cold_wraps", label: "Cold Wraps" },
      { key: "cold_cuts", label: "Cold Cuts / Deli Meat" },
      { key: "chicken_tuna_salad", label: "Chicken/Tuna Salad Sandwiches" },
      { key: "pre_cut_fruit", label: "Pre-Cut Fruits" },
      { key: "salads", label: "Salads (Green/Pasta/Potato)" },
    ],
  },
  {
    category: "Hot Food (cook-and-serve or hot-held)",
    items: [
      { key: "hot_subs", label: "Hot Subs / Grilled Sandwiches" },
      { key: "fried_chicken", label: "Fried Chicken / Fried Items" },
      { key: "burgers", label: "Burgers" },
      { key: "pizza", label: "Pizza" },
      { key: "soups", label: "Soups" },
      { key: "hot_entrees", label: "Hot Entrées / Steam Table Items" },
      { key: "eggs_cooked_to_order", label: "Eggs Cooked to Order" },
    ],
  },
  {
    category: "Groceries",
    items: [
      { key: "bread", label: "Bread" },
      { key: "cereals", label: "Cereals" },
      { key: "coffee", label: "Coffee" },
      { key: "frozen_food", label: "Frozen Food" },
      { key: "noodles", label: "Noodles / Pasta" },
      { key: "canned_goods", label: "Canned Goods" },
      { key: "condiments", label: "Condiments" },
    ],
  },
  {
    category: "Snacks & Refreshments",
    items: [
      { key: "cakes", label: "Cakes / Baked Goods" },
      { key: "candy", label: "Candy" },
      { key: "chips", label: "Chips" },
      { key: "ice_cream", label: "Ice Cream" },
      { key: "juices", label: "Juices" },
      { key: "soda", label: "Soda" },
      { key: "tea", label: "Tea" },
      { key: "water", label: "Bottled Water" },
    ],
  },
  {
    category: "Non-Food Items",
    items: [
      { key: "cigarettes", label: "Cigarettes" },
      { key: "cigars", label: "Cigars" },
      { key: "cleaning_items", label: "Cleaning Items" },
      { key: "disposable_tableware", label: "Disposable Tableware/Cutlery" },
      { key: "foil", label: "Foil/Wrap" },
      { key: "hair_items", label: "Hair Items" },
      { key: "household_supplies", label: "Household Supplies" },
      { key: "otc_drugs", label: "Over-Counter Drugs (Tylenol, Advil, etc.)" },
      { key: "phone_accessories", label: "Phone Accessories" },
      { key: "soap", label: "Soap" },
    ],
  },
];

/** Master equipment checklist — every realistic piece of equipment across all three business types; staff check off what's on site. */
export const HACCP_EQUIPMENT_ITEMS: ChecklistItem[] = [
  { key: "shelves", label: "Shelves / Storage Shelving" },
  { key: "beverage_cooler_1door", label: "1-Door Beverage Cooler" },
  { key: "beverage_cooler_2door", label: "2-Door Beverage Cooler" },
  { key: "beverage_cooler_4door", label: "4-Door Commercial Beverage Cooler" },
  { key: "ice_cream_freezer", label: "Ice-Cream Freezer" },
  { key: "walk_in_cooler", label: "Walk-In Cooler" },
  { key: "walk_in_freezer", label: "Walk-In Freezer" },
  { key: "reach_in_cooler", label: "Reach-In Cooler" },
  { key: "food_prep_counter", label: "Food Prep Counter" },
  { key: "sandwich_prep_table", label: "Sandwich Prep Table (Cold Well)" },
  { key: "deli_case", label: "Deli Case" },
  { key: "deli_slicer", label: "Deli Slicer" },
  { key: "grill", label: "Grill / Griddle" },
  { key: "stove", label: "Stove / Range" },
  { key: "fryer", label: "Deep Fryer" },
  { key: "oven", label: "Oven" },
  { key: "steam_table", label: "Steam Table / Hot-Holding Unit" },
  { key: "heated_display_case", label: "Heated Display Case / Warmer" },
  { key: "microwave", label: "Microwave" },
  { key: "coffee_machine", label: "Coffee Machine" },
  { key: "ice_machine", label: "Ice Machine" },
  { key: "3_compartment_sink", label: "3-Compartment Sink (Wash/Rinse/Sanitize)" },
  { key: "handwashing_sink", label: "Handwashing Sink(s) with Soap, Warm Water, Paper Towels" },
  { key: "metal_stem_thermometer", label: "Digital/Metal Stem Thermometer(s), calibrated weekly" },
  { key: "sanitizer_buckets", label: "Sanitizer Buckets and Test Strips" },
  { key: "cash_register", label: "Cash Register / POS" },
  { key: "atm", label: "ATM" },
  { key: "security_cameras", label: "Security Cameras" },
];

/**
 * Appended after every plan's CCP section, regardless of business type — general
 * good-practice content that applies to any Maryland retail food facility.
 * Kept separate for the same reason contractContent.ts splits GENERAL_TERMS
 * out from service-specific scope: a shared-language change happens once.
 */
export const GENERAL_HANDLING_KEY = "general_handling";
export const GENERAL_HANDLING_TITLE = "General Food Handling & Recordkeeping";
export const GENERAL_HANDLING_BODY = `B. GENERAL FOOD HANDLING INFORMATION AND PROCEDURES

1. Approved Food Sources. All food is purchased from licensed and approved suppliers and certified distributors.
2. Cross-Contamination Prevention. Raw meats are stored on lower shelves, ready-to-eat foods on upper shelves. Separate utensils and gloves are used for raw and ready-to-eat items.
3. Thawing Procedure. All frozen foods are thawed under refrigeration at or below 41°F.
4. Cooling Method. Potentially hazardous foods that require cooling are cooled using an ice bath, shallow pans, and/or rapid-chill refrigeration — from 135°F to 70°F within 2 hours, and from 70°F to 41°F within an additional 4 hours (or to 41°F within 4 hours total for cold-service items that never leave refrigeration).
5. Advance Preparation. No potentially hazardous foods are prepared more than 24 hours in advance unless properly cooled and stored under refrigeration.
6. Pre-Packaged Reheating for Hot-Holding. Commercially processed, pre-packaged potentially hazardous foods that are reheated for hot-holding are reheated within 2 hours to at least 135°F for 15 seconds before being placed on hot-hold.
7. Off-Premises Distribution. {{offPremisesClause}}
8. Cold Storage Requirements. Refrigerated foods (meats, salads, dairy) are held at or below 41°F.
9. Special Processes. No reduced-oxygen packaging (ROP), sous vide, smoking, curing, fermenting, dehydration, sushi preparation, or similar specialized processes are conducted at this facility unless separately approved by the health department.
10. Time-Only Control / Pooled Eggs. Not used at this facility unless separately documented and approved.

RECORDKEEPING. Temperature logs and sanitation checklists are completed and maintained on-site, and are available for review by the health inspector at all times.

C. PROCEDURES FOR EMPLOYEE HACCP TRAINING

Purpose. To ensure that all food employees understand and correctly follow the procedures outlined in this HACCP Plan to prevent foodborne illness, maintain compliance with Maryland COMAR 10.15.03 regulations, and ensure consistent food safety practices at all times.

Training Schedule. Initial training is provided to all new food employees before they begin work in food preparation or service areas. Periodic/refresher training is provided at least annually, or whenever: the HACCP plan is updated or modified; new equipment or menu items are introduced; or monitoring or record-keeping issues are identified.

Training Topics. Each employee is trained on: the HACCP Plan overview and critical control points; food handling and temperature control; monitoring procedures (how to take and record temperatures, and when corrective action is needed); corrective actions (re-cook, discard, report equipment malfunction); verification procedures (management review of logs, thermometer calibration); personal hygiene and sanitation (handwashing, gloves, cleaning/sanitizing food-contact surfaces).

Manager Responsibilities. The Person-in-Charge ensures each employee understands and complies with these procedures, maintains training records and temperature logs for inspection, verifies corrective actions are taken immediately when a deviation is found, and reviews HACCP compliance during daily operations.

Acknowledgment. Each employee signs a statement confirming they have received and understood HACCP training before working independently with food:

"I, __________________________________, have received training on HACCP procedures, temperature control, and corrective actions for {{businessName}}. I understand and agree to follow all food safety and sanitation procedures described in this HACCP Plan."

Signature: _______________________________          Date: _______________`;

export interface BuiltInHaccpTemplate {
  businessTypeKey: string;
  title: string;
  body: string;
}

/**
 * Section A + D content, per business type. {{businessName}} and other tokens
 * are merged in haccp.routes.ts via substituteHaccpPlaceholders. Each body is
 * SECTION A + SECTION D only — Section B/C (GENERAL_HANDLING_BODY above) and
 * the menu/equipment checklist pages are appended afterward by the route/PDF
 * layer, same two-piece-composition pattern as contracts' scope + general terms.
 */
export const BUILT_IN_HACCP_TEMPLATES: BuiltInHaccpTemplate[] = [
  {
    businessTypeKey: "convenience_grocery",
    title: "HACCP Plan — Convenience Store / Grocery (No-Cook)",
    body: `A. PRIORITY ASSESSMENT INFORMATION

{{businessName}} sells only prepackaged, ready-to-eat food and commercially packaged potentially hazardous foods. No cooking, reheating, or hot-holding takes place on the premises. This facility uses a Cold Hold-Serve system only — all potentially hazardous items are received prepackaged and held under refrigeration until sold. This establishment serves the general public through walk-in/over-the-counter customer service. No high-risk populations (such as hospitals, nursing homes, or schools) are served.

D. CRITICAL CONTROL POINT (CCP) PROCEDURES

Process: Cold Storage and Display of Prepackaged/Ready-to-Eat Foods (No Cook Step)

CCP & EQUIPMENT: Cold hold food at or below 41°F in refrigerated display/storage equipment until sale.
MONITORING: Check internal product temperature at the start of each shift and at least every 4 hours with a calibrated metal stem or digital thermometer.
CORRECTIVE ACTION: Discard any product held above 41°F for more than 4 hours, or if the time out of temperature cannot be determined. Move product to working refrigeration immediately if a deviation is found.
VERIFICATION: Manager reviews temperature logs weekly and re-calibrates thermometers weekly and after any drop or extreme temperature exposure.

CROSS-CONTAMINATION: Raw and ready-to-eat items are never commingled; all products sold are received in their original, sealed manufacturer packaging.`,
  },
  {
    businessTypeKey: "grocery_deli_cold_only",
    title: "HACCP Plan — Grocery & Deli (Cold Cuts Only, No Cooking)",
    body: `A. PRIORITY ASSESSMENT INFORMATION

{{businessName}} operates a grocery with a deli counter that slices and sells cold cuts, cheeses and salads by weight or to order, together with commercially packaged foods. No cooking, reheating, or hot-holding takes place on the premises. This facility uses a Cold Hold-Serve system only — all potentially hazardous foods are received cold, held under refrigeration, and served cold. This establishment serves the general public through walk-in/over-the-counter customer service. No high-risk populations (such as hospitals, nursing homes, or schools) are served.

D. CRITICAL CONTROL POINT (CCP) PROCEDURES

Process 1: Cold Storage and Display of Potentially Hazardous Foods (No Cook Step)
Menu Items: Cold Cuts / Deli Meat, Cheese, Salads, Pre-Cut Fruits, Cold Subs, Cold Wraps, and packaged refrigerated items.

CCP & EQUIPMENT: Cold hold food at or below 41°F in the deli case, sandwich prep table, and refrigerated storage until sale.
MONITORING: Check internal product temperature at the start of each shift and at least every 2 hours with a calibrated metal stem or digital thermometer.
CORRECTIVE ACTION: Discard any product held above 41°F for more than 4 hours, or if the time out of temperature cannot be determined. Move product to working refrigeration immediately if a deviation is found.
VERIFICATION: Manager reviews temperature logs weekly and re-calibrates thermometers weekly and after any drop or extreme temperature exposure.

Process 2: Slicing and Portioning Cold Ready-to-Eat Foods
CCP & EQUIPMENT: Slice and portion cold cuts and cheeses only after cleaning and sanitizing the slicer and food-contact surfaces; return product to refrigeration promptly. Opened ready-to-eat potentially hazardous food held more than 24 hours is date-marked and discarded after 7 days at or below 41°F.
MONITORING: Check that the slicer and prep surfaces are cleaned and sanitized at least every 4 hours of continuous use and between different products; check date marks at the start of each shift.
CORRECTIVE ACTION: Re-clean and sanitize any equipment or surface found soiled. Discard any ready-to-eat food that is past its date mark or has no date mark.
VERIFICATION: Manager reviews sanitizer test-strip readings and date-marking practices weekly.

CROSS-CONTAMINATION: Raw animal foods are not handled or stored at this facility. Ready-to-eat foods are handled with gloves or clean utensils, and the slicer is cleaned and sanitized before it is used for a different product.`,
  },
  {
    businessTypeKey: "deli_carryout",
    title: "HACCP Plan — Deli / Carryout (Cook-and-Serve, No Hot-Holding)",
    body: `A. PRIORITY ASSESSMENT INFORMATION

This facility uses a Cook-and-Serve system for made-to-order items and a Cold Hold-Serve system for prepackaged ready-to-eat foods. All food items are prepared to order and served immediately. The establishment does not use hot-holding equipment; no foods are held at hot temperatures for extended periods. This establishment serves the general public through walk-in customer service. No high-risk populations (such as hospitals, nursing homes, or schools) are served.

D. CRITICAL CONTROL POINT (CCP) PROCEDURES

Process 1: Food Preparation With No Cook Step
Menu Items: Prepackaged Tuna/Chicken Salads, Cold Subs, Cold Wraps, Cold Cuts, Pre-Cut Fruits, and similar ready-to-eat items.

CCP & EQUIPMENT: Cold hold food at or below 41°F in sandwich prep/refrigerated equipment until service.
MONITORING: Check internal temperature every 2 hours with a metal stem thermometer.
CORRECTIVE ACTION: Discard products above 41°F for more than 4 hours, or if time out of temperature cannot be determined.
VERIFICATION: Manager reviews temperature logs weekly.

Process 2: Cooking (Made-to-Order, Served Immediately)
Menu Items: Breakfast Sandwiches, Hot Subs, Eggs Cooked to Order, and similar cooked-to-order items.

CCP & EQUIPMENT: Cook to the required minimum internal temperature — poultry 165°F, ground meats 155°F, fish/pork/eggs 145°F (each held for the required time per COMAR/FDA Food Code) — then serve immediately.
MONITORING: Check internal temperature of each cooked item with a calibrated metal stem thermometer before service.
CORRECTIVE ACTION: Continue cooking any item that does not reach its required minimum temperature. This facility does not hot-hold — any cooked item not served within a reasonable time of cooking is discarded rather than held.
VERIFICATION: Manager review of cooking temperature logs and thermometer calibration weekly.

Process 3: Cooling (if applicable)
CCP & EQUIPMENT: Cool in walk-in refrigeration to or below 41°F within 4 hours; keep in cold storage at 41°F or below until service.
MONITORING: Check internal product temperature at 2 hours and 4 hours with a metal stem thermometer.
CORRECTIVE ACTION: Use an ice bath if food has not cooled to 41°F within 2 hours. Discard product that does not reach 41°F within 4 hours.
VERIFICATION: Manager review of temperature monitoring practices and calibration logs.`,
  },
  {
    businessTypeKey: "restaurant",
    title: "HACCP Plan — Restaurant (Full-Service, With Hot-Holding)",
    body: `A. PRIORITY ASSESSMENT INFORMATION

This facility uses a Cook-and-Serve system for made-to-order items, a Hot Hold-Serve system for items held on a steam table or warmer, and a Cold Hold-Serve system for prepackaged and cold ready-to-eat foods. This establishment serves the general public through dine-in and/or carryout service. No high-risk populations (such as hospitals, nursing homes, or schools) are served.

D. CRITICAL CONTROL POINT (CCP) PROCEDURES

Process 1: Food Preparation With No Cook Step
Menu Items: Cold Subs, Cold Wraps, Cold Cuts, Salads, Pre-Cut Fruits, and similar ready-to-eat items.

CCP & EQUIPMENT: Cold hold food at or below 41°F in sandwich prep/refrigerated equipment until service.
MONITORING: Check internal temperature every 2 hours with a metal stem thermometer.
CORRECTIVE ACTION: Discard products above 41°F for more than 4 hours, or if time out of temperature cannot be determined.
VERIFICATION: Manager reviews temperature logs weekly.

Process 2: Cooking
Menu Items: Burgers, Fried Chicken, Hot Entrées, Pizza, Soups, and similar cooked items.

CCP & EQUIPMENT: Cook to the required minimum internal temperature — poultry 165°F, ground meats 155°F, fish/pork/eggs 145°F (each held for the required time per COMAR/FDA Food Code).
MONITORING: Check internal temperature of each cooked item with a calibrated metal stem thermometer at the end of cooking, before it is served or moved to hot-holding.
CORRECTIVE ACTION: Continue cooking any item that does not reach its required minimum temperature.
VERIFICATION: Manager review of cooking temperature logs and thermometer calibration weekly.

Process 3: Hot Holding
CCP & EQUIPMENT: Hot hold cooked food at or above 135°F in a steam table, warmer, or heated display case.
MONITORING: Check internal product temperature at least every 2 hours with a metal stem thermometer. Food held for pickup/service without active temperature control may remain above 135°F for up to 15 minutes before pickup; discard if held longer without temperature control.
CORRECTIVE ACTION: Reheat food to 165°F for at least 15 seconds if it falls below 135°F and less than 4 hours have elapsed since it fell out of temperature. Discard food held below 135°F for 4 hours or longer, or if the time cannot be determined.
VERIFICATION: Manager reviews hot-holding temperature logs weekly and re-calibrates thermometers weekly and after any drop or extreme temperature exposure.

Process 4: Cooling
CCP & EQUIPMENT: Cool cooked food from 135°F to 70°F within 2 hours, and from 70°F to 41°F or below within an additional 4 hours (6 hours total), using an ice bath, shallow pans, or a blast chiller.
MONITORING: Check internal product temperature at 2 hours and again at 6 hours with a metal stem thermometer.
CORRECTIVE ACTION: Use an ice bath, divide food into smaller/shallower containers, or use a blast chiller if food is not cooling on schedule. Discard product that does not reach 41°F within the required cooling time.
VERIFICATION: Manager review of temperature monitoring practices and calibration logs.

Process 5: Reheating for Hot Holding
CCP & EQUIPMENT: Reheat previously cooked and cooled food to 165°F for at least 15 seconds within 2 hours before placing in hot-holding.
MONITORING: Check internal temperature with a metal stem thermometer immediately after reheating.
CORRECTIVE ACTION: Continue reheating, or use a different reheating method, until 165°F is reached within the 2-hour window; discard if the food cannot be brought to temperature within 2 hours.
VERIFICATION: Manager reviews reheating logs weekly.`,
  },
];

// ---------------------------------------------------------------------------
// Which documents a business type needs
// ---------------------------------------------------------------------------

/**
 * Menu and equipment choices that reveal a riskier operation than the business type claims. The form
 * compares what is checked against the selected type and offers the matching type — a store set to
 * "No-Cook" that ticks a fryer is not a Low priority store, whatever its type says.
 */
export const HACCP_RISK_SIGNALS = {
  /** Foods that are cooked on site. */
  hotMenu: ["hot_subs", "fried_chicken", "burgers", "pizza", "soups", "hot_entrees", "eggs_cooked_to_order"],
  /** Potentially hazardous food that is opened, sliced or assembled on site (not simply sold in its package). */
  preparedColdMenu: ["breakfast_sandwiches", "cold_subs", "cold_wraps", "cold_cuts", "chicken_tuna_salad", "pre_cut_fruit", "salads"],
  cookingEquipment: ["grill", "stove", "fryer", "oven"],
  hotHoldingEquipment: ["steam_table", "heated_display_case"],
  coldPrepEquipment: ["deli_case", "deli_slicer", "sandwich_prep_table", "food_prep_counter"],
  /** Not a risk by itself — it depends on whether staff heat food for customers. */
  microwaveEquipment: ["microwave"],
} as const;

export type HaccpPlanComponentKey = "haccp_plan" | "menu_equipment" | "license_application" | "plan_review";
export type RequirementStatus = "required" | "not_required" | "if_applicable";

export interface DocumentRequirement {
  /** The generator component this maps to, when the app produces it. */
  component?: HaccpPlanComponentKey;
  label: string;
  status: RequirementStatus;
  why: string;
}

export interface DocumentRequirements {
  riskPriority: "High" | "Moderate" | "Low";
  priorityReason: string;
  priorityAssessment: HaccpBusinessType["priorityAssessment"];
  documents: DocumentRequirement[];
  /** Things the owner must gather and attach — not generated here. */
  attachments: string[];
  /** Other approvals outside the health department that commonly come with this kind of store. */
  relatedApprovals: string[];
  /** The documents to pre-select in the generator. */
  defaultComponents: HaccpPlanComponentKey[];
  fees: string[];
}

/**
 * What a business of this type should submit, from Maryland's own rules: COMAR 10.15.03.34A makes a HACCP
 * plan mandatory only for High and Moderate priority facilities; the plans-and-specifications submittal
 * (menu, equipment, layout) applies to every new, remodeled or re-owned facility (Health-General §21-321);
 * Baltimore County waives the Certified Food Manager card for Low priority; Baltimore City's application
 * lists the fee by priority and the extra attachments it requires. The health department assigns the final
 * priority — this is what to expect, not a ruling.
 */
export function buildDocumentRequirements(type: HaccpBusinessType, jurisdiction: string, buildingPermit: "yes" | "no" | "unknown" = "unknown"): DocumentRequirements {
  const low = type.riskPriority === "Low";
  const isCity = /city/i.test(jurisdiction);
  const documents: DocumentRequirement[] = [];

  documents.push(low
    ? { component: "haccp_plan", label: "HACCP Plan", status: "not_required",
        why: "Not required — a store that sells only commercially packaged foods is exempt (COMAR 10.15.03.34A). Don't submit one: it adds statements the health department may question." }
    : { component: "haccp_plan", label: "HACCP Plan", status: "required",
        why: `Required for ${type.riskPriority} priority facilities (COMAR 10.15.03.34A); it must be re-approved every 5 years and before a new process is started.` });

  documents.push({
    component: "menu_equipment", label: low ? "Menu & Equipment List + priority assessment" : "Menu & Equipment List", status: "required",
    why: low
      ? "The menu and equipment are part of the plans submittal, and for a Low priority store this list (with the priority assessment printed on it) is what the department uses to classify the facility."
      : "The menu and equipment are part of the plans submittal and feed the HACCP plan.",
  });

  documents.push(isCity
    ? { component: "license_application", label: "Food Facility License Application (Baltimore City)", status: "required",
        why: "Required for every food facility. The fee is set by priority — High $520, Moderate $285, Low $65 (form revised 1/15/2020; confirm current amounts)." }
    : { component: "license_application", label: "Food Service Facility Permit Application and Fee Statement (Baltimore County)", status: "required",
        why: "Required for each new facility and at a change of ownership, and renewed every year (a $14.00/day late fee applies to renewals filed after March 31)." });

  documents.push(isCity
    ? { component: "plan_review", label: "Plan Review Application (Baltimore City)", status: "required",
        why: "Required for every new, renovated or change-of-ownership food facility. Fees: $75 plan review + $150 plan review inspection." }
    : buildingPermit === "no"
    ? { component: "plan_review", label: "Equipment review — Baltimore County Department of Health", status: "required",
        why: `No building permit is needed (per the County), so this is an equipment-only review. Send the menu and equipment cut sheets${low ? "" : " and the HACCP plan"} to Baltimore County Department of Health, Division of Environmental Health Services, 6401 York Road, Third Floor, Baltimore, MD 21212 (ehs@baltimorecountymd.gov).` }
    : buildingPermit === "yes"
    ? { component: "plan_review", label: "Plans review with a building permit — Baltimore County", status: "required",
        why: `Construction or remodeling: submit the building permit application, fees and plans (architectural, plumbing, mechanical, electrical, finish schedule, air balance schedule, scaled fixture layout), the menu${low ? "" : ", the HACCP plan"} and equipment cut sheets to Baltimore County Department of Permits, Approvals and Inspections, Building Inspections, 111 W. Chesapeake Avenue, Room 100, Towson, MD 21204.` }
    : { component: "plan_review", label: "Plans Review submittal (Baltimore County guide)", status: "if_applicable",
        why: "Only when you build, remodel, alter or convert the space, or change equipment. Then send plans (layout, finish schedule), the menu, equipment cut sheets" + (low ? "." : " and the HACCP plan.") + " Tell us below whether a building permit is needed." });

  documents.push(low
    ? { label: "Certified Food Manager card", status: "not_required",
        why: "Baltimore County: not applicable to a Low priority permit." }
    : { label: "Certified Food Manager card", status: "required",
        why: isCity
          ? "Expected for Moderate and High priority facilities — confirm with your plan reviewer (the City application doesn't state it)."
          : "Baltimore County asks for a Certified Food Manager Level I identification card for Moderate and High priority permits." });

  const attachments: string[] = [];
  if (isCity) {
    attachments.push(
      "Workers' compensation Certificate of Compliance (or the policy / binder number) — required with the City application",
      "Waste hauler statement — and a copy of the contract if the business produces more than three 32-gallon receptacles per week",
      "If the store sells tobacco: the Statement of Tobacco Licensee on page 2 of the City application (initial each line, add the State license number)",
    );
  }
  if (!low) attachments.push("Equipment cut sheets and a scaled floor plan with the fixture layout");
  else attachments.push("Equipment cut sheets and a floor plan only if the space is new or being remodeled");

  const fees = isCity
    ? [`License fee for ${type.riskPriority} priority: ${type.riskPriority === "High" ? "$520" : type.riskPriority === "Moderate" ? "$285" : "$65"}`, "Plan review: $75 (floor plan review) + $150 (plan review inspection)"]
    : ["Permit fee is set by the County by priority — see the Fee Statement on the application"];

  return {
    riskPriority: type.riskPriority,
    priorityReason: type.priorityReason,
    priorityAssessment: type.priorityAssessment,
    documents,
    attachments,
    relatedApprovals: [
      "Use and Occupancy certificate and fire department permit for the address",
      "Baltimore trader's license (Clerk of the Circuit Court)",
      "Maryland tobacco license — if the store sells tobacco",
    ],
    defaultComponents: documents.filter((d) => d.component && d.status === "required").map((d) => d.component as HaccpPlanComponentKey),
    fees,
  };
}
