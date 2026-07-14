import type {
  HabitatModule,
  IndustryResource,
  ProductionBlueprint,
} from "./habitat";
import { formatJsonField, formatNumber } from "./cli-utils";

export function moduleStatus(module: HabitatModule) {
  return String(module.runtimeAttributes.status ?? "unknown");
}

export function moduleHealth(module: HabitatModule) {
  return String(module.runtimeAttributes.health ?? "unknown");
}

export function modulePowerDrawKw(module: HabitatModule) {
  const status = moduleStatus(module);
  const powerDrawKw = module.runtimeAttributes.powerDrawKw;

  if (!powerDrawKw || typeof powerDrawKw !== "object" || Array.isArray(powerDrawKw)) {
    return 0;
  }

  const draw = (powerDrawKw as Record<string, unknown>)[status];
  return typeof draw === "number" && Number.isFinite(draw) ? draw : 0;
}

function numericAttribute(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function constructionJob(module: HabitatModule) {
  const job = module.runtimeAttributes.constructionJob;

  if (!job || typeof job !== "object" || Array.isArray(job)) {
    return null;
  }

  const entry = job as Record<string, unknown>;

  if (typeof entry.blueprintId !== "string") {
    return null;
  }

  return entry;
}

function moduleEffectiveState(module: HabitatModule) {
  const job = constructionJob(module);

  if (job) {
    return `constructing ${job.blueprintId}`;
  }

  if (
    typeof module.runtimeAttributes.currentEnergyKwh === "number" &&
    typeof module.runtimeAttributes.energyStorageKwh === "number" &&
    numericAttribute(module.runtimeAttributes.energyStorageKwh) > 0 &&
    numericAttribute(module.runtimeAttributes.currentEnergyKwh) <= 0
  ) {
    return "depleted";
  }

  return moduleStatus(module);
}

export function printModuleStatusTable(modules: HabitatModule[]) {
  const rows = modules.map((module) => ({
    name: module.displayName,
    declaredState: moduleStatus(module),
    effectiveState: moduleEffectiveState(module),
    powerDrawKw: modulePowerDrawKw(module),
  }));
  const nameWidth = Math.max("Module".length, ...rows.map((row) => row.name.length));
  const declaredWidth = Math.max("Declared".length, ...rows.map((row) => row.declaredState.length));
  const effectiveWidth = Math.max("Effective".length, ...rows.map((row) => row.effectiveState.length));
  const totalPowerDrawKw = rows.reduce((total, row) => total + row.powerDrawKw, 0);
  const energyCostPerTickKwh = totalPowerDrawKw / 3600;
  const batteryEnergyKwh = modules.reduce(
    (total, module) => total + numericAttribute(module.runtimeAttributes.currentEnergyKwh),
    0,
  );
  const batteryCapacityKwh = modules.reduce(
    (total, module) => total + numericAttribute(module.runtimeAttributes.energyStorageKwh),
    0,
  );

  console.log(`${"Module".padEnd(nameWidth)}  ${"Declared".padEnd(declaredWidth)}  ${"Effective".padEnd(effectiveWidth)}  Power Draw`);
  console.log(`${"-".repeat(nameWidth)}  ${"-".repeat(declaredWidth)}  ${"-".repeat(effectiveWidth)}  ----------`);

  for (const row of rows) {
    console.log(
      `${row.name.padEnd(nameWidth)}  ${row.declaredState.padEnd(declaredWidth)}  ${row.effectiveState.padEnd(effectiveWidth)}  ${formatNumber(row.powerDrawKw)} kW`,
    );
  }

  console.log("");
  console.log(`Total Power Draw: ${formatNumber(totalPowerDrawKw)} kW`);
  console.log(`Energy Cost Per Tick: ${formatNumber(energyCostPerTickKwh)} kWh`);

  if (batteryCapacityKwh > 0) {
    console.log(`Battery Energy: ${formatNumber(batteryEnergyKwh)} / ${formatNumber(batteryCapacityKwh)} kWh`);

    if (batteryEnergyKwh <= 0) {
      console.log("No usable battery energy remains.");
    }
  }
}

export function printModule(module: HabitatModule) {
  const job = constructionJob(module);

  console.log(`ID: ${module.id}`);
  console.log(`Habitat ID: ${module.habitatId}`);
  console.log(`Blueprint ID: ${module.blueprintId}`);
  console.log(`Module Type: ${module.moduleType}`);
  console.log(`Name: ${module.displayName}`);
  console.log(`Source: ${module.source}`);
  console.log(`Declared Status: ${moduleStatus(module)}`);
  console.log(`Effective Status: ${moduleEffectiveState(module)}`);
  console.log(`Health: ${moduleHealth(module)}`);
  console.log(`Capabilities: ${module.capabilities.length > 0 ? module.capabilities.join(", ") : "none"}`);
  console.log(`Connected To: ${module.connectedTo.length > 0 ? module.connectedTo.join(", ") : "none"}`);

  if (
    numericAttribute(module.runtimeAttributes.energyStorageKwh) > 0 ||
    typeof module.runtimeAttributes.currentEnergyKwh === "number"
  ) {
    console.log(
      `Battery Energy: ${formatNumber(numericAttribute(module.runtimeAttributes.currentEnergyKwh))} / ${formatNumber(numericAttribute(module.runtimeAttributes.energyStorageKwh))} kWh`,
    );
  }

  if (typeof module.runtimeAttributes.reserveKwh === "number") {
    console.log(`Reserve Energy: ${formatNumber(module.runtimeAttributes.reserveKwh)} kWh`);
  }

  if (typeof module.runtimeAttributes.maxPowerOutputKw === "number") {
    console.log(`Max Power Output: ${formatNumber(module.runtimeAttributes.maxPowerOutputKw)} kW`);
  }

  if (job) {
    console.log(`Construction Job: ${job.id}`);
    console.log(`Building: ${job.blueprintId}`);
    console.log(`Output Module ID: ${job.outputModuleId ?? "unknown"}`);
    console.log(`Remaining Build Time: ${formatNumber(numericAttribute(job.remainingTicks))} / ${formatNumber(numericAttribute(job.buildTicks))} ticks (${formatNumber(numericAttribute(job.remainingTicks) / 3600)} / ${formatNumber(numericAttribute(job.buildTicks) / 3600)} hours)`);
  }

  if (typeof module.runtimeAttributes.powerGenerationKw === "number") {
    console.log(`Power Generation: ${formatNumber(module.runtimeAttributes.powerGenerationKw)} kW`);
  }

  if (typeof module.runtimeAttributes.degradedStormGenerationKw === "number") {
    console.log(`Storm Generation: ${formatNumber(module.runtimeAttributes.degradedStormGenerationKw)} kW`);
  }

  if (typeof module.runtimeAttributes.surfaceAreaM2 === "number") {
    console.log(`Surface Area: ${formatNumber(module.runtimeAttributes.surfaceAreaM2)} m2`);
  }

  if (typeof module.runtimeAttributes.maintenanceHoursPer100Ticks === "number") {
    console.log(`Maintenance Load: ${formatNumber(module.runtimeAttributes.maintenanceHoursPer100Ticks)} crew-hours / 100 operating ticks`);
  }

  console.log(`Runtime Attributes: ${JSON.stringify(module.runtimeAttributes)}`);
}

export function printBlueprintTable(blueprints: ProductionBlueprint[]) {
  const rows = blueprints.map((blueprint) => ({
    id: blueprint.blueprintId,
    name: blueprint.displayName,
    output: blueprint.output?.itemType ? String(blueprint.output.itemType) : "unknown",
    buildTicks: blueprint.buildTicks === undefined ? "unknown" : String(blueprint.buildTicks),
    repeatable: blueprint.repeatable === undefined ? "unknown" : blueprint.repeatable ? "yes" : "no",
  }));
  const idWidth = Math.max("Blueprint ID".length, ...rows.map((row) => row.id.length));
  const nameWidth = Math.max("Name".length, ...rows.map((row) => row.name.length));
  const outputWidth = Math.max("Output".length, ...rows.map((row) => row.output.length));
  const buildTicksWidth = Math.max("Build Ticks".length, ...rows.map((row) => row.buildTicks.length));

  console.log(
    `${"Blueprint ID".padEnd(idWidth)}  ${"Name".padEnd(nameWidth)}  ${"Output".padEnd(outputWidth)}  ${"Build Ticks".padEnd(buildTicksWidth)}  Repeatable`,
  );
  console.log(
    `${"-".repeat(idWidth)}  ${"-".repeat(nameWidth)}  ${"-".repeat(outputWidth)}  ${"-".repeat(buildTicksWidth)}  ----------`,
  );

  for (const row of rows) {
    console.log(
      `${row.id.padEnd(idWidth)}  ${row.name.padEnd(nameWidth)}  ${row.output.padEnd(outputWidth)}  ${row.buildTicks.padEnd(buildTicksWidth)}  ${row.repeatable}`,
    );
  }
}

export function printBlueprint(blueprint: ProductionBlueprint) {
  console.log(`ID: ${blueprint.blueprintId}`);
  console.log(`Name: ${blueprint.displayName}`);
  console.log(`Description: ${blueprint.description ?? "none"}`);
  console.log(`Status: ${blueprint.status ?? "unknown"}`);
  console.log(`Build Ticks: ${blueprint.buildTicks ?? "unknown"}`);
  console.log(`Repeatable: ${blueprint.repeatable === undefined ? "unknown" : blueprint.repeatable ? "yes" : "no"}`);
  console.log(`Output: ${formatJsonField(blueprint.output)}`);
  console.log(`Inputs: ${formatJsonField(blueprint.inputs)}`);
  console.log(`Production Cost: ${formatJsonField(blueprint.productionCost)}`);
  console.log(`Required Facility: ${formatJsonField(blueprint.requiredFacility)}`);
  console.log(`Prerequisites: ${blueprint.prerequisites?.length ? blueprint.prerequisites.join(", ") : "none"}`);
  console.log(`Unlocks: ${blueprint.unlocks?.length ? blueprint.unlocks.join(", ") : "none"}`);
  console.log(`Capabilities: ${blueprint.capabilities?.length ? blueprint.capabilities.join(", ") : "none"}`);
}

export function printResourceTable(resources: IndustryResource[]) {
  const rows = resources.map((resource) => ({
    type: resource.resourceType,
    name: resource.displayName,
    kind: resource.kind,
    rarity: resource.rarity,
    unit: resource.unit ?? "n/a",
  }));
  const typeWidth = Math.max("Resource Type".length, ...rows.map((row) => row.type.length));
  const nameWidth = Math.max("Name".length, ...rows.map((row) => row.name.length));
  const kindWidth = Math.max("Kind".length, ...rows.map((row) => row.kind.length));
  const rarityWidth = Math.max("Rarity".length, ...rows.map((row) => row.rarity.length));

  console.log(
    `${"Resource Type".padEnd(typeWidth)}  ${"Name".padEnd(nameWidth)}  ${"Kind".padEnd(kindWidth)}  ${"Rarity".padEnd(rarityWidth)}  Unit`,
  );
  console.log(
    `${"-".repeat(typeWidth)}  ${"-".repeat(nameWidth)}  ${"-".repeat(kindWidth)}  ${"-".repeat(rarityWidth)}  ----`,
  );

  for (const row of rows) {
    console.log(
      `${row.type.padEnd(typeWidth)}  ${row.name.padEnd(nameWidth)}  ${row.kind.padEnd(kindWidth)}  ${row.rarity.padEnd(rarityWidth)}  ${row.unit}`,
    );
  }
}

export function printResourceCatalogNotes() {
  console.log("Resource catalog: possible resource types in the Kepler world.");
  console.log("Local inventory: resources your habitat owns are managed with `habitat inventory`.");
  console.log("Blueprint requirements: resources or modules needed to build something later.");
}
