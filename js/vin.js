/* wenFSD — Tesla VIN decoder
 * Decodes a 17-char Tesla VIN into model / year / plant / inferred hardware.
 * Heuristic for hardware + generation (VIN doesn't encode the Autopilot computer),
 * so results include a `warnings` array and everything stays user-overridable.
 *
 * VIN positions used (1-indexed): 1-3 WMI(plant/region), 4 model, 9 check digit,
 * 10 model year, 11 plant.
 */
const VIN = (function () {
  const WMI = {
    "5YJ": { region: "North America", plant: "Fremont, USA" },
    "7SA": { region: "North America", plant: "Austin, USA" },
    "7G2": { region: "North America", plant: "Nevada, USA (Semi)" },
    "LRW": { region: "Asia-Pacific", plant: "Shanghai, China" },
    "XP7": { region: "Europe", plant: "Berlin, Germany" },
  };
  const MODEL = { "S": "Model S", "3": "Model 3", "X": "Model X", "Y": "Model Y", "C": "Cybertruck", "R": "Roadster" };
  const PLANT = { F: "Fremont", A: "Austin", B: "Berlin", C: "Shanghai", N: "Nevada", P: "Fremont (pilot)" };
  // Model-year letter codes (VINs skip I, O, Q, U, Z)
  const YEAR = {
    A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017,
    J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025,
    T: 2026, V: 2027, W: 2028, X: 2029, Y: 2030,
  };

  // North-America VIN check-digit (NHTSA). Soft-validated; non-NA plants may differ.
  const TRANSLIT = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9 };
  const WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
  function checkDigitValid(vin) {
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      const c = vin[i];
      const v = /[0-9]/.test(c) ? +c : TRANSLIT[c];
      if (v == null) return false;
      sum += v * WEIGHTS[i];
    }
    const rem = sum % 11;
    const expect = rem === 10 ? "X" : String(rem);
    return vin[8] === expect;
  }

  // hardware (Autopilot computer) inference from model + year
  function inferHardware(model, year) {
    if (!year) return { hw: "AI4", note: "assumed AI4 (HW4) — couldn't read year" };
    if (model === "Model 3" || model === "Model Y") {
      if (year >= 2024) return { hw: "AI4", note: "HW4 (Model 3/Y 2024+)" };
      if (year >= 2019) return { hw: "AI3", note: "HW3 (Model 3/Y 2019–2023)" };
      return { hw: "AI2.5", note: "pre-HW3" };
    }
    if (model === "Model S" || model === "Model X") {
      if (year >= 2023) return { hw: "AI4", note: "HW4 (refreshed S/X 2023+)" };
      if (year >= 2019) return { hw: "AI3", note: "HW3 (S/X 2019–2022)" };
      return { hw: "AI2.5", note: "pre-HW3" };
    }
    if (model === "Cybertruck") return { hw: "AI4", note: "HW4" };
    return { hw: "AI4", note: "assumed AI4" };
  }

  // marketing generation name
  function generation(model, year) {
    if (model === "Model Y" && year >= 2025) return "Juniper";
    if (model === "Model 3" && year >= 2024) return "Highland";
    return "";
  }

  function decode(raw) {
    const warnings = [];
    const vin = String(raw || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
    if (vin.length !== 17) {
      return { valid: false, vin, warnings: ["VIN must be 17 characters (got " + vin.length + ")."] };
    }
    const wmi = WMI[vin.slice(0, 3)];
    if (!wmi) warnings.push("WMI '" + vin.slice(0, 3) + "' isn't a known Tesla code — decode may be off.");

    const model = MODEL[vin[3]] || null;
    if (!model) warnings.push("Couldn't read model from position 4 ('" + vin[3] + "').");

    const year = YEAR[vin[9]] || null;
    if (!year) warnings.push("Couldn't read model year from position 10 ('" + vin[9] + "').");

    const plant = PLANT[vin[10]] || (wmi ? wmi.plant.split(",")[0] : null);

    // check digit: only meaningful for North-American builds
    if (vin.slice(0, 3) === "5YJ" || vin.slice(0, 3) === "7SA") {
      if (!checkDigitValid(vin)) warnings.push("Check digit doesn't validate — double-check for typos.");
    }

    const { hw, note } = inferHardware(model, year);
    const gen = generation(model, year);

    return {
      valid: !!(model && year),
      vin,
      model,
      year,
      generation: gen,
      hardware: hw,
      hardwareNote: note,
      plant,
      region: wmi ? wmi.region : null,
      // RHD can't be read from the VIN reliably; leave for the user to set.
      displayName: [year, model, gen].filter(Boolean).join(" ") || "Tesla",
      warnings,
    };
  }

  return { decode };
})();
