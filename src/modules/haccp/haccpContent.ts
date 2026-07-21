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
  /** Maryland's licensing risk tier — drives whether a HACCP plan is required at all (High/Moderate always are). */
  riskPriority: "High" | "Moderate";
  /** Whether this type's CCP table includes a cook step (cooking temps, no-hot-hold discard rule). */
  hasCookStep: boolean;
  /** Whether this type's CCP table includes hot-holding (steam table/warmer) in addition to cooking. */
  hasHotHolding: boolean;
  description: string;
}

export const HACCP_BUSINESS_TYPES: HaccpBusinessType[] = [
  {
    key: "convenience_grocery",
    label: "Convenience Store / Grocery (No-Cook)",
    riskPriority: "Moderate",
    hasCookStep: false,
    hasHotHolding: false,
    description: "Prepackaged and cold-hold items only — no cooking step on site.",
  },
  {
    key: "deli_carryout",
    label: "Deli / Carryout (Cook-and-Serve, No Hot-Holding)",
    riskPriority: "High",
    hasCookStep: true,
    hasHotHolding: false,
    description: "Made-to-order items prepared and served immediately; no extended hot-holding equipment.",
  },
  {
    key: "restaurant",
    label: "Restaurant (Full-Service, With Hot-Holding)",
    riskPriority: "High",
    hasCookStep: true,
    hasHotHolding: true,
    description: "Full-service food preparation including hot-holding/steam-table equipment.",
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
4. Advance Preparation. No potentially hazardous foods are prepared more than 24 hours in advance unless properly cooled and stored under refrigeration.
5. Off-Premises Distribution. {{offPremisesClause}}
6. Cold Storage Requirements. Refrigerated foods (meats, salads, dairy) are held at or below 41°F.
7. Special Processes. No reduced-oxygen packaging (ROP), sushi preparation, curing, or similar specialized processes are conducted at this facility unless separately approved by the health department.
8. Time-Only Control / Pooled Eggs. Not used at this facility unless separately documented and approved.

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
