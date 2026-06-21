// Server VIN decoder (ESM port of js/vin.js) — used to populate model/year/hardware/market
// when an owner links their Tesla account.
const WMI = {
  "5YJ": { region: "North America", plant: "Fremont, USA", market: "United States" },
  "7SA": { region: "North America", plant: "Austin, USA", market: "United States" },
  "LRW": { region: "Asia-Pacific", plant: "Shanghai, China", market: "Australia" },
  "XP7": { region: "Europe", plant: "Berlin, Germany", market: "Europe" },
};
const MODEL = { S: "Model S", "3": "Model 3", X: "Model X", Y: "Model Y", C: "Cybertruck", R: "Roadster" };
const YEAR = { A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017, J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025, T: 2026, V: 2027, W: 2028, X: 2029, Y: 2030 };

function inferHardware(model, year) {
  if (!year) return "AI4";
  if (model === "Model 3" || model === "Model Y") return year >= 2024 ? "AI4" : year >= 2019 ? "AI3" : "AI2.5";
  if (model === "Model S" || model === "Model X") return year >= 2023 ? "AI4" : year >= 2019 ? "AI3" : "AI2.5";
  return "AI4";
}
function generation(model, year) {
  if (model === "Model Y" && year >= 2025) return "Juniper";
  if (model === "Model 3" && year >= 2024) return "Highland";
  return "";
}

export function decodeVIN(raw) {
  const vin = String(raw || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (vin.length !== 17) return { valid: false, vin };
  const wmi = WMI[vin.slice(0, 3)];
  const model = MODEL[vin[3]] || null;
  const year = YEAR[vin[9]] || null;
  const hardware = inferHardware(model, year);
  return {
    valid: !!(model && year),
    vin, model, model_year: year, generation: generation(model, year),
    hardware, market: wmi ? wmi.market : null, drive: wmi && wmi.region !== "North America" && wmi.region !== "Europe" ? "RHD" : "LHD",
    plant: wmi ? wmi.plant : null,
  };
}
