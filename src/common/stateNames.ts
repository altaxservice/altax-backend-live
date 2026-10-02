/** Full state names for client-facing wording ("Maryland Unemployment Insurance"). Keyed by 2-letter code, DC included. */
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** The state's full name, or null when the code is empty/unrecognized. */
export function stateDisplayName(state: string | null | undefined): string | null {
  return STATE_NAMES[String(state || "").trim().toUpperCase()] ?? null;
}

/** "Maryland Unemployment Insurance" for an MD client, "District of Columbia Unemployment Insurance" for DC — Maryland when no state is on file, the original behavior. */
export function unemploymentInsuranceLabel(state: string | null | undefined): string {
  return `${stateDisplayName(state) ?? "Maryland"} Unemployment Insurance`;
}
