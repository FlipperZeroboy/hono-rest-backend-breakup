import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile as fsReadFile, rm, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  addInventoryResource,
  cancelConstructionJob,
  checkLocalConfig,
  createModule,
  deleteModule,
  listBlueprintCatalog,
  listResourceCatalog,
  dryRunConstruction,
  getLocalStatusSummary,
  getDatabaseFilePath,
  getRegistrationStatus,
  getSolarIrradiance,
  listInventory,
  listConstructionJobs,
  listModules,
  loadLocalRegistration,
  LocalRegistration,
  registerHabitat,
  removeInventoryResource,
  setModuleStatus,
  showBlueprint,
  showModule,
  startConstruction,
  tickHabitat,
  unregisterHabitat,
  updateModule,
} from "../src/habitat";
import {
  getLocalStateStore,
} from "../src/local-state";

let tempDir: string;

function getRegistrationFilePath(cwd = tempDir) {
  return join(cwd, ".habitat", "registration.json");
}

function getModulesFilePath(cwd = tempDir) {
  return join(cwd, ".habitat", "habitat-modules.json");
}

async function writeFile(path: string, contents: string, encoding: BufferEncoding = "utf8") {
  if (path === getRegistrationFilePath(dirname(dirname(path)))) {
    await getLocalStateStore(dirname(dirname(path))).save(JSON.parse(contents));
    return;
  }

  if (path === getModulesFilePath(dirname(dirname(path)))) {
    const cwd = dirname(dirname(path));
    const registration = await getLocalStateStore(cwd).load();
    if (!registration) {
      throw new Error("Test module fixture requires a registration fixture.");
    }
    registration.modules = JSON.parse(contents);
    await getLocalStateStore(cwd).save(registration);
    return;
  }

  await fsWriteFile(path, contents, encoding);
}

async function readFile(path: string, encoding: BufferEncoding = "utf8") {
  if (path === getRegistrationFilePath(dirname(dirname(path)))) {
    return JSON.stringify(await getLocalStateStore(dirname(dirname(path))).load());
  }

  if (path === getModulesFilePath(dirname(dirname(path)))) {
    const registration = await getLocalStateStore(dirname(dirname(path))).load();
    return JSON.stringify(registration?.modules ?? []);
  }

  return fsReadFile(path, encoding);
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "habitat-cli-"));
  await writeFile(
    join(tempDir, ".env"),
    "KEPLER_BASE_URL=https://planet.turingguild.com\nKEPLER_PLANET_TOKEN=test-token\n",
    "utf8",
  );
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("local state store saves and loads local state in sqlite, then deletes the database file", async () => {
  const store = getLocalStateStore(tempDir);
  const registration = {
    habitatUuid: "11111111-1111-4111-8111-111111111111",
    habitatId: "habitat_11111111_1111_4111_8111_111111111111",
    displayName: "Artemis Ridge",
    registeredAt: "2026-07-06T12:00:00.000Z",
    currentTick: 0,
    starterModules: [],
    blueprints: [],
    modules: [
      {
        id: "module-1",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        blueprintId: "command-module",
        moduleType: "command-module",
        displayName: "Command Module",
        connectedTo: [],
        runtimeAttributes: { health: 100, status: "active" },
        capabilities: ["habitat-command"],
        source: "kepler-registration",
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:00:00.000Z",
      },
    ],
    powerSummary: {
      totalPowerDrawKw: 0,
      energyUsedKwh: 0,
      batteryEnergyKwh: 0,
      batteryCapacityKwh: 0,
      powerShortageKwh: 0,
    },
    tickHistory: [],
  } satisfies LocalRegistration;

  await store.save(registration);
  const databaseFile = join(tempDir, ".habitat", "habitat.sqlite");

  await expect(Bun.file(databaseFile).exists()).resolves.toBe(true);

  const freshStore = getLocalStateStore(tempDir);
  expect(await freshStore.load()).toEqual(registration);

  await store.delete();
  expect(await freshStore.load()).toBeNull();
  await expect(Bun.file(databaseFile).exists()).resolves.toBe(false);
});

test("local state store load returns null when the sqlite database is missing", async () => {
  const store = getLocalStateStore(tempDir);

  await expect(store.load()).resolves.toBeNull();
});

async function writePowerRegistration({
  currentEnergyKwh = 10,
  energyStorageKwh = 10,
}: {
  currentEnergyKwh?: number;
  energyStorageKwh?: number;
} = {}) {
  await mkdir(join(tempDir, ".habitat"), { recursive: true });
  await writeFile(
    getRegistrationFilePath(tempDir),
    JSON.stringify(
      {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        displayName: "Artemis Ridge",
        registeredAt: "2026-07-06T12:00:00.000Z",
        currentTick: 0,
        starterModules: [],
        blueprints: [],
        modules: [
          {
            id: "battery-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "basic-battery",
            moduleType: "basic-battery",
            displayName: "Basic Battery",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "offline",
              currentEnergyKwh,
              energyStorageKwh,
              powerDrawKw: { offline: 0, active: 0 },
            },
            capabilities: ["power-storage"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
          {
            id: "command-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "command-module",
            moduleType: "command-module",
            displayName: "Command Module",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "active",
              powerDrawKw: { offline: 0, idle: 1, active: 2, damaged: 0 },
            },
            capabilities: ["habitat-command"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
          {
            id: "life-support-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "life-support",
            moduleType: "life-support",
            displayName: "Life Support",
            connectedTo: ["command-1"],
            runtimeAttributes: {
              health: 100,
              status: "active",
              powerDrawKw: { offline: 0, active: 5 },
            },
            capabilities: ["atmosphere-control"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

async function writeSolarRegistration({
  batteryStatus = "online",
  currentEnergyKwh = 10,
  energyStorageKwh = 10.01,
  includeBattery = true,
  solarStatus = "online",
  includeSolar = true,
}: {
  batteryStatus?: string;
  currentEnergyKwh?: number;
  energyStorageKwh?: number;
  includeBattery?: boolean;
  solarStatus?: string;
  includeSolar?: boolean;
} = {}) {
  const modules = [];

  if (includeBattery) {
    modules.push({
      id: "battery-1",
      habitatId: "habitat_11111111_1111_4111_8111_111111111111",
      blueprintId: "basic-battery",
      moduleType: "basic-battery",
      displayName: "Basic Battery",
      connectedTo: [],
      runtimeAttributes: {
        health: 100,
        status: batteryStatus,
        currentEnergyKwh,
        energyStorageKwh,
        powerDrawKw: { offline: 0, online: 0, active: 0, damaged: 0 },
      },
      capabilities: ["power-storage"],
      source: "kepler-registration",
      createdAt: "2026-07-06T12:00:00.000Z",
      updatedAt: "2026-07-06T12:00:00.000Z",
    });
  }

  if (includeSolar) {
    modules.push({
      id: "solar-1",
      habitatId: "habitat_11111111_1111_4111_8111_111111111111",
      blueprintId: "small-solar-array",
      moduleType: "small-solar-array",
      displayName: "Small Solar Array",
      connectedTo: [],
      runtimeAttributes: {
        health: 100,
        status: solarStatus,
        powerDrawKw: { offline: 0, online: 0, active: 0, damaged: 0 },
        powerGenerationKw: 12,
      },
      capabilities: ["solar-generation"],
      source: "local-blueprint",
      createdAt: "2026-07-06T12:00:00.000Z",
      updatedAt: "2026-07-06T12:00:00.000Z",
    });
  }

  await mkdir(join(tempDir, ".habitat"), { recursive: true });
  await writeFile(
    getRegistrationFilePath(tempDir),
    JSON.stringify({
      habitatUuid: "11111111-1111-4111-8111-111111111111",
      habitatId: "habitat_11111111_1111_4111_8111_111111111111",
      displayName: "Artemis Ridge",
      registeredAt: "2026-07-06T12:00:00.000Z",
      currentTick: 0,
      starterModules: [],
      blueprints: [],
      modules,
      powerSummary: {
        totalPowerDrawKw: 0,
        energyUsedKwh: 0,
        batteryEnergyKwh: 0,
        batteryCapacityKwh: 0,
        powerShortageKwh: 0,
      },
      tickHistory: [],
    }, null, 2) + "\n",
    "utf8",
  );
}

function solarResponse(wPerM2?: number) {
  return async () => new Response(
    JSON.stringify({
      solarIrradiance: {
        ...(wPerM2 === undefined ? {} : { wPerM2 }),
        condition: wPerM2 === undefined ? "unknown" : "clear",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("registerHabitat sends OpenAPI request keys and persists returned registration data", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });

    return new Response(
      JSON.stringify({
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        starterModules: [
          {
            id: "module-1",
            blueprintId: "command-module",
            displayName: "Command Module",
            connectedTo: [],
            runtimeAttributes: { health: 100, status: "active" },
            capabilities: ["habitat-command"],
          },
          {
            id: "module-2",
            blueprintId: "custom-lab",
            displayName: "Custom Lab",
            connectedTo: ["module-1"],
            runtimeAttributes: { health: 88, status: "idle" },
            capabilities: ["custom-science"],
          },
        ],
        blueprints: [
          {
            blueprintId: "command-module",
            displayName: "Command Module Blueprint",
            output: { itemType: "module", moduleType: "command-module", quantity: 1 },
            runtimeAttributes: { health: 100, status: "active" },
            capabilities: ["habitat-command"],
          },
        ],
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  };

  const registration = await registerHabitat("Artemis Ridge", {
    cwd: tempDir,
    fetchImpl,
    randomUuid: () => "11111111-1111-4111-8111-111111111111",
    now: () => new Date("2026-07-06T12:00:00.000Z"),
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://planet.turingguild.com/habitats/register");
  expect(requests[0].init.method).toBe("POST");
  expect(requests[0].init.headers).toEqual({
    Authorization: "Bearer test-token",
    "Content-Type": "application/json",
  });
  expect(JSON.parse(String(requests[0].init.body))).toEqual({
    displayName: "Artemis Ridge",
    habitatUuid: "11111111-1111-4111-8111-111111111111",
  });

  expect(registration).toMatchObject({
    habitatUuid: "11111111-1111-4111-8111-111111111111",
    habitatId: "habitat_11111111_1111_4111_8111_111111111111",
    displayName: "Artemis Ridge",
    registeredAt: "2026-07-06T12:00:00.000Z",
    currentTick: 0,
  });
  expect(registration.modules).toEqual([
    {
      id: "module-1",
      habitatId: "habitat_11111111_1111_4111_8111_111111111111",
      blueprintId: "command-module",
      moduleType: "command-module",
      displayName: "Command Module",
      connectedTo: [],
      runtimeAttributes: { health: 100, status: "active" },
      capabilities: ["habitat-command"],
      source: "kepler-registration",
      createdAt: "2026-07-06T12:00:00.000Z",
      updatedAt: "2026-07-06T12:00:00.000Z",
    },
    {
      id: "module-2",
      habitatId: "habitat_11111111_1111_4111_8111_111111111111",
      blueprintId: "custom-lab",
      moduleType: "custom-lab",
      displayName: "Custom Lab",
      connectedTo: ["module-1"],
      runtimeAttributes: { health: 88, status: "idle" },
      capabilities: ["custom-science"],
      source: "kepler-registration",
      createdAt: "2026-07-06T12:00:00.000Z",
      updatedAt: "2026-07-06T12:00:00.000Z",
    },
  ]);

  const stored = await loadLocalRegistration(tempDir);
  expect(stored).toEqual({
    ...registration,
    starterModules: [],
    blueprints: [],
  });
});

test("listBlueprintCatalog fetches official blueprints without changing local state", async () => {
  await writePowerRegistration();
  const beforeRegistration = await readFile(getRegistrationFilePath(tempDir), "utf8");
  const requests: Array<{ url: string; init: RequestInit }> = [];

  const result = await listBlueprintCatalog({
    cwd: tempDir,
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });

      return new Response(
        JSON.stringify({
          catalogVersion: "2026-06-24",
          blueprints: [
            {
              id: "bp-1",
              blueprintId: "survey-rover",
              displayName: "Survey Rover",
              description: "Builds a rover for site surveys.",
              status: "published",
              output: { itemType: "rover", quantity: 1 },
              inputs: { spareParts: 4 },
              buildTicks: 120,
              repeatable: true,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://planet.turingguild.com/catalog/blueprints");
  expect(requests[0].init.method).toBe("GET");
  expect(requests[0].init.headers).toEqual({
    Authorization: "Bearer test-token",
  });
  expect(result.catalogVersion).toBe("2026-06-24");
  expect(result.blueprints[0].blueprintId).toBe("survey-rover");
  expect(await readFile(getRegistrationFilePath(tempDir), "utf8")).toBe(beforeRegistration);
});

test("listResourceCatalog fetches official resource types without changing local state", async () => {
  await writePowerRegistration();
  const beforeRegistration = await readFile(getRegistrationFilePath(tempDir), "utf8");
  const requests: Array<{ url: string; init: RequestInit }> = [];

  const result = await listResourceCatalog({
    cwd: tempDir,
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });

      return new Response(
        JSON.stringify({
          catalogVersion: "2026-06-24",
          resources: [
            {
              id: "resource-water",
              resourceType: "water",
              displayName: "Water",
              kind: "consumable",
              rarity: "common",
              description: "Reusable life-support water.",
              unit: "liters",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://planet.turingguild.com/catalog/resources");
  expect(requests[0].init.method).toBe("GET");
  expect(requests[0].init.headers).toEqual({
    Authorization: "Bearer test-token",
  });
  expect(result.catalogVersion).toBe("2026-06-24");
  expect(result.resources[0].resourceType).toBe("water");
  expect(await readFile(getRegistrationFilePath(tempDir), "utf8")).toBe(beforeRegistration);
});

test("showBlueprint fetches one official blueprint and converts missing blueprints to a friendly error", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];

  const blueprint = await showBlueprint("rover-bay-upgrade", {
    cwd: tempDir,
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });

      return new Response(
        JSON.stringify({
          blueprint: {
            id: "bp-2",
            blueprintId: "rover-bay-upgrade",
            displayName: "Rover Bay Upgrade",
            description: "Upgrades the rover bay.",
            status: "published",
            output: { itemType: "facility-upgrade", quantity: 1 },
            inputs: { spareParts: 8, power: 3 },
            productionCost: { powerKwh: 12 },
            requiredFacility: { moduleType: "rover-bay", level: 1 },
            buildTicks: 300,
            prerequisites: ["rover-bay"],
            unlocks: ["survey-rover"],
            repeatable: false,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  expect(requests[0].url).toBe("https://planet.turingguild.com/catalog/blueprints/rover-bay-upgrade");
  expect(blueprint.displayName).toBe("Rover Bay Upgrade");
  expect(blueprint.inputs).toEqual({ spareParts: 8, power: 3 });

  await expect(
    showBlueprint("missing-blueprint", {
      cwd: tempDir,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { message: "not found" } }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
    }),
  ).rejects.toThrow("Blueprint not found: missing-blueprint");
});

test("dryRunConstruction checks readiness without changing local state", async () => {
  await mkdir(join(tempDir, ".habitat"), { recursive: true });
  const registration = {
    habitatUuid: "11111111-1111-4111-8111-111111111111",
    habitatId: "habitat_11111111_1111_4111_8111_111111111111",
    displayName: "Artemis Ridge",
    registeredAt: "2026-07-06T12:00:00.000Z",
    currentTick: 4,
    starterModules: [],
    blueprints: [],
    modules: [
      {
        id: "battery-1",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        blueprintId: "basic-battery",
        moduleType: "basic-battery",
        displayName: "Basic Battery",
        connectedTo: [],
        runtimeAttributes: {
          health: 100,
          status: "offline",
          currentEnergyKwh: 10,
          energyStorageKwh: 10,
          powerDrawKw: { offline: 0 },
        },
        capabilities: ["power-storage"],
        source: "kepler-registration",
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:00:00.000Z",
      },
      {
        id: "fabricator-1",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        blueprintId: "workshop-fabricator",
        moduleType: "workshop-fabricator",
        displayName: "Workshop Fabricator",
        connectedTo: [],
        runtimeAttributes: { health: 100, status: "idle", powerDrawKw: { idle: 1 } },
        capabilities: ["basic-fabrication"],
        source: "kepler-registration",
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:00:00.000Z",
      },
      {
        id: "cache-1",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        blueprintId: "supply-cache",
        moduleType: "supply-cache",
        displayName: "Supply Cache",
        connectedTo: [],
        runtimeAttributes: {
          health: 100,
          status: "active",
          storedResources: { ferrite: 100, "silicate-glass": 40, "conductive-ore": 18 },
          powerDrawKw: { active: 0.5 },
        },
        capabilities: ["storage"],
        source: "kepler-registration",
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:00:00.000Z",
      },
    ],
  };
  await writeFile(getRegistrationFilePath(tempDir), JSON.stringify(registration, null, 2) + "\n", "utf8");
  const beforeRegistration = await readFile(getRegistrationFilePath(tempDir), "utf8");

  const result = await dryRunConstruction("small-solar-array", {
    cwd: tempDir,
    fetchImpl: async (url, init) => {
      expect(String(url)).toBe("https://planet.turingguild.com/catalog/blueprints/small-solar-array");
      expect(init?.headers).toEqual({ Authorization: "Bearer test-token" });

      return Response.json({
        blueprint: {
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array Blueprint",
          status: "published",
          output: { itemType: "module", moduleType: "small-solar-array", quantity: 1 },
          inputs: { ferrite: 90, "silicate-glass": 45, "conductive-ore": 18 },
          productionCost: { power: 3 },
          requiredFacility: { moduleType: "workshop-fabricator", minimumLevel: 1 },
          buildTicks: 180,
          prerequisites: [],
          runtimeAttributes: { health: 100, status: "online", powerGenerationKw: 12 },
          capabilities: ["solar-generation"],
        },
      });
    },
  });

  expect(result).toMatchObject({
    blueprintId: "small-solar-array",
    facilityExists: true,
    facilityAvailable: true,
    supplyCacheOnline: true,
    prerequisitesMet: true,
    inventorySufficient: false,
    canStart: false,
    moduleToCreate: {
      itemType: "module",
      moduleType: "small-solar-array",
      quantity: 1,
    },
    resourcesToSpend: { ferrite: 90, "silicate-glass": 45, "conductive-ore": 18 },
    inventoryChecks: [
      { resource: "conductive-ore", required: 18, available: 18, sufficient: true },
      { resource: "ferrite", required: 90, available: 100, sufficient: true },
      { resource: "silicate-glass", required: 45, available: 40, sufficient: false },
    ],
  });
  expect(await readFile(getRegistrationFilePath(tempDir), "utf8")).toBe(beforeRegistration);
});

test("startConstruction spends inventory and attaches a local construction job", async () => {
  await mkdir(join(tempDir, ".habitat"), { recursive: true });
  await writeFile(
    getRegistrationFilePath(tempDir),
    JSON.stringify(
      {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        displayName: "Artemis Ridge",
        registeredAt: "2026-07-06T12:00:00.000Z",
        currentTick: 4,
        starterModules: [],
        blueprints: [],
        modules: [
          {
            id: "battery-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "basic-battery",
            moduleType: "basic-battery",
            displayName: "Basic Battery",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "offline",
              currentEnergyKwh: 10,
              energyStorageKwh: 10,
              powerDrawKw: { offline: 0 },
            },
            capabilities: ["power-storage"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
          {
            id: "fabricator-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "workshop-fabricator",
            moduleType: "workshop-fabricator",
            displayName: "Workshop Fabricator",
            connectedTo: [],
            runtimeAttributes: { health: 100, status: "idle", powerDrawKw: { idle: 1, active: 8 } },
            capabilities: ["basic-fabrication"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
          {
            id: "cache-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "supply-cache",
            moduleType: "supply-cache",
            displayName: "Supply Cache",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "active",
              storedResources: { ferrite: 100, "silicate-glass": 50, "conductive-ore": 18 },
              powerDrawKw: { active: 0.5 },
            },
            capabilities: ["storage"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const result = await startConstruction("small-solar-array", {
    cwd: tempDir,
    randomUuid: () => "33333333-3333-4333-8333-333333333333",
    now: () => new Date("2026-07-06T12:30:00.000Z"),
    fetchImpl: async () =>
      Response.json({
        blueprint: {
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array Blueprint",
          status: "published",
          output: { itemType: "module", moduleType: "small-solar-array", quantity: 1 },
          inputs: { ferrite: 90, "silicate-glass": 45, "conductive-ore": 18 },
          productionCost: { power: 3 },
          requiredFacility: { moduleType: "workshop-fabricator", minimumLevel: 1 },
          buildTicks: 180,
          prerequisites: [],
          runtimeAttributes: { health: 100, status: "online", powerGenerationKw: 12 },
          capabilities: ["solar-generation"],
        },
      }),
  });
  const job = result.job;

  expect(job).toEqual({
    id: "construction_33333333_3333_4333_8333_333333333333",
    blueprintId: "small-solar-array",
    outputModuleId: "module_33333333_3333_4333_8333_333333333333",
    output: { itemType: "module", moduleType: "small-solar-array", quantity: 1 },
    buildTicks: 180,
    remainingTicks: 180,
    runtimeAttributes: { health: 100, status: "online", powerGenerationKw: 12 },
    capabilities: ["solar-generation"],
    status: "active",
    startedAt: "2026-07-06T12:30:00.000Z",
  });

  const stored = await loadLocalRegistration(tempDir);
  expect(stored?.modules.map((module) => module.moduleType)).toEqual([
    "basic-battery",
    "workshop-fabricator",
    "supply-cache",
  ]);

  const fabricator = stored?.modules.find((module) => module.id === "fabricator-1");
  expect(result.facility.id).toBe("fabricator-1");
  expect(fabricator?.runtimeAttributes.status).toBe("active");
  expect(fabricator?.runtimeAttributes.constructionJob).toEqual(job);

  const cache = stored?.modules.find((module) => module.id === "cache-1");
  expect(cache?.runtimeAttributes.storedResources).toEqual({
    ferrite: 10,
    "silicate-glass": 5,
    "conductive-ore": 0,
  });
});

test("listConstructionJobs reports active jobs from local fabricators", async () => {
  await mkdir(join(tempDir, ".habitat"), { recursive: true });
  await writeFile(
    getRegistrationFilePath(tempDir),
    JSON.stringify(
      {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        displayName: "Artemis Ridge",
        registeredAt: "2026-07-06T12:00:00.000Z",
        currentTick: 4,
        starterModules: [],
        blueprints: [],
        modules: [
          {
            id: "fabricator-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "workshop-fabricator",
            moduleType: "workshop-fabricator",
            displayName: "Workshop Fabricator",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "active",
              constructionJob: {
                id: "construction-1",
                blueprintId: "small-solar-array",
                outputModuleId: "module-solar-1",
                output: { itemType: "module", moduleType: "small-solar-array", quantity: 1 },
                buildTicks: 180,
                remainingTicks: 172,
                runtimeAttributes: { health: 100, status: "online", powerGenerationKw: 12 },
                capabilities: ["solar-generation"],
                status: "active",
                startedAt: "2026-07-06T12:30:00.000Z",
              },
            },
            capabilities: ["basic-fabrication"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:30:00.000Z",
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  expect(await listConstructionJobs({ cwd: tempDir })).toEqual([
    {
      facilityId: "fabricator-1",
      facilityName: "Workshop Fabricator",
      job: {
        id: "construction-1",
        blueprintId: "small-solar-array",
        outputModuleId: "module-solar-1",
        output: { itemType: "module", moduleType: "small-solar-array", quantity: 1 },
        buildTicks: 180,
        remainingTicks: 172,
        runtimeAttributes: { health: 100, status: "online", powerGenerationKw: 12 },
        capabilities: ["solar-generation"],
        status: "active",
        startedAt: "2026-07-06T12:30:00.000Z",
      },
    },
  ]);
});

test("cancelConstructionJob clears the job without refunding inventory or creating output", async () => {
  await mkdir(join(tempDir, ".habitat"), { recursive: true });
  await writeFile(
    getRegistrationFilePath(tempDir),
    JSON.stringify(
      {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        displayName: "Artemis Ridge",
        registeredAt: "2026-07-06T12:00:00.000Z",
        currentTick: 4,
        starterModules: [],
        blueprints: [],
        modules: [
          {
            id: "fabricator-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "workshop-fabricator",
            moduleType: "workshop-fabricator",
            displayName: "Workshop Fabricator",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "active",
              constructionJob: {
                id: "construction-1",
                blueprintId: "small-solar-array",
                outputModuleId: "module-solar-1",
                output: { itemType: "module", moduleType: "small-solar-array", quantity: 1 },
                buildTicks: 180,
                remainingTicks: 172,
                runtimeAttributes: { health: 100, status: "online", powerGenerationKw: 12 },
                capabilities: ["solar-generation"],
                status: "active",
                startedAt: "2026-07-06T12:30:00.000Z",
              },
            },
            capabilities: ["basic-fabrication"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:30:00.000Z",
          },
          {
            id: "cache-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "supply-cache",
            moduleType: "supply-cache",
            displayName: "Supply Cache",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "active",
              storedResources: { ferrite: 10, "silicate-glass": 5, "conductive-ore": 0 },
            },
            capabilities: ["storage"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:30:00.000Z",
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const result = await cancelConstructionJob("fabricator-1", { cwd: tempDir });
  expect(result).toEqual({
    facilityId: "fabricator-1",
    facilityName: "Workshop Fabricator",
    jobId: "construction-1",
    blueprintId: "small-solar-array",
    outputModuleId: "module-solar-1",
  });

  const stored = await loadLocalRegistration(tempDir);
  const fabricator = stored?.modules.find((module) => module.id === "fabricator-1");
  const cache = stored?.modules.find((module) => module.id === "cache-1");

  expect(fabricator?.runtimeAttributes.status).toBe("idle");
  expect(fabricator?.runtimeAttributes.constructionJob).toBeUndefined();
  expect(stored?.modules.find((module) => module.id === "module-solar-1")).toBeUndefined();
  expect(cache?.runtimeAttributes.storedResources).toEqual({
    ferrite: 10,
    "silicate-glass": 5,
    "conductive-ore": 0,
  });
});

test("inventory add and list use the local supply cache", async () => {
  await mkdir(join(tempDir, ".habitat"), { recursive: true });
  await writeFile(
    getRegistrationFilePath(tempDir),
    JSON.stringify(
      {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        displayName: "Artemis Ridge",
        registeredAt: "2026-07-06T12:00:00.000Z",
        currentTick: 4,
        starterModules: [],
        blueprints: [],
        modules: [
          {
            id: "cache-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "supply-cache",
            moduleType: "supply-cache",
            displayName: "Supply Cache",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "active",
              storedResources: { ferrite: 10 },
              powerDrawKw: { active: 0.5 },
            },
            capabilities: ["storage"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  expect(await addInventoryResource("ferrite", 90, { cwd: tempDir })).toEqual({
    resource: "ferrite",
    added: 90,
    quantity: 100,
    storageModuleId: "cache-1",
    storageModuleName: "Supply Cache",
  });
  expect(await addInventoryResource("silicate-glass", 45, { cwd: tempDir })).toMatchObject({
    resource: "silicate-glass",
    quantity: 45,
  });

  expect(await listInventory({ cwd: tempDir })).toEqual([
    { resource: "ferrite", quantity: 100 },
    { resource: "silicate-glass", quantity: 45 },
  ]);

  const stored = await loadLocalRegistration(tempDir);
  const cache = stored?.modules.find((module) => module.id === "cache-1");
  expect(cache?.runtimeAttributes.storedResources).toEqual({
    ferrite: 100,
    "silicate-glass": 45,
  });
});

test("inventory remove subtracts resources from the local supply cache", async () => {
  const registration: LocalRegistration = {
    habitatUuid: "11111111-1111-4111-8111-111111111111",
    habitatId: "habitat_11111111_1111_4111_8111_111111111111",
    displayName: "Artemis Ridge",
    registeredAt: "2026-07-06T12:00:00.000Z",
    currentTick: 0,
    starterModules: [],
    blueprints: [],
    modules: [],
    powerSummary: {
      totalPowerDrawKw: 0,
      energyUsedKwh: 0,
      batteryEnergyKwh: 0,
      batteryCapacityKwh: 0,
      powerShortageKwh: 0,
    },
    tickHistory: [],
  };

  registration.modules.push({
    id: "cache-1",
    habitatId: registration.habitatId,
    blueprintId: "supply-cache",
    moduleType: "supply-cache",
    displayName: "Supply Cache",
    connectedTo: [],
    runtimeAttributes: {
      health: 100,
      status: "active",
      storedResources: { ferrite: 10 },
    },
    capabilities: ["storage"],
    source: "kepler-registration",
    createdAt: "2026-07-06T12:00:00.000Z",
    updatedAt: "2026-07-06T12:00:00.000Z",
  });
  await getLocalStateStore(tempDir).save(registration);

  await expect(removeInventoryResource("ferrite", 3, { cwd: tempDir })).resolves.toEqual({
    resource: "ferrite",
    removed: 3,
    quantity: 7,
    storageModuleId: "cache-1",
    storageModuleName: "Supply Cache",
  });
  await expect(removeInventoryResource("ferrite", 8, { cwd: tempDir })).rejects.toThrow(
    "Not enough ferrite in local inventory.",
  );
});

test("tickHabitat advances one-second ticks and drains battery power", async () => {
  await writePowerRegistration();

  const result = await tickHabitat(1, { cwd: tempDir });

  expect(result).toMatchObject({
    startTick: 0,
    currentTick: 1,
    ticksAdvanced: 1,
    totalPowerDrawKw: 7,
    energyUsedKwh: 7 / 3600,
    batteryEnergyKwh: 10 - 7 / 3600,
    batteryCapacityKwh: 10,
    powerShortageKwh: 0,
  });

  const stored = await loadLocalRegistration(tempDir);
  expect(stored?.currentTick).toBe(1);
  expect(stored?.modules[0].runtimeAttributes.currentEnergyKwh).toBe(10 - 7 / 3600);
  expect(stored?.tickHistory).toHaveLength(1);
});

test("tickHabitat multiplies power use over multiple ticks", async () => {
  await writePowerRegistration();

  const result = await tickHabitat(60, { cwd: tempDir });

  expect(result.energyUsedKwh).toBe(7 / 60);
  expect(result.batteryEnergyKwh).toBe(10 - 7 / 60);
  expect(result.currentTick).toBe(60);
});

test("tickHabitat clamps battery energy and reports shortage", async () => {
  await writePowerRegistration({ currentEnergyKwh: 0.001, energyStorageKwh: 10 });

  const result = await tickHabitat(1, { cwd: tempDir });

  expect(result.batteryEnergyKwh).toBe(0);
  expect(result.powerShortageKwh).toBeCloseTo(7 / 3600 - 0.001, 10);
  expect((await loadLocalRegistration(tempDir))?.modules[0].runtimeAttributes.currentEnergyKwh).toBe(0);
});

test("tickHabitat charges an online battery from online solar modules using Kepler irradiance", async () => {
  await mkdir(join(tempDir, ".habitat"), { recursive: true });
  await writeFile(
    getRegistrationFilePath(tempDir),
    JSON.stringify(
      {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        displayName: "Artemis Ridge",
        registeredAt: "2026-07-06T12:00:00.000Z",
        currentTick: 0,
        starterModules: [],
        blueprints: [],
        modules: [
          {
            id: "battery-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "basic-battery",
            moduleType: "basic-battery",
            displayName: "Basic Battery",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "online",
              currentEnergyKwh: 10,
              energyStorageKwh: 10.01,
              powerDrawKw: { offline: 0, online: 0, active: 0, damaged: 0 },
            },
            capabilities: ["power-storage"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
          {
            id: "command-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "command-module",
            moduleType: "command-module",
            displayName: "Command Module",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "active",
              powerDrawKw: { active: 2 },
            },
            capabilities: ["habitat-command"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
          {
            id: "life-support-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "life-support",
            moduleType: "life-support",
            displayName: "Life Support",
            connectedTo: ["command-1"],
            runtimeAttributes: {
              health: 100,
              status: "active",
              powerDrawKw: { active: 5 },
            },
            capabilities: ["atmosphere-control"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
          {
            id: "solar-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "small-solar-array",
            moduleType: "small-solar-array",
            displayName: "Small Solar Array",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "online",
              powerDrawKw: { offline: 0, online: 0, active: 0, damaged: 0 },
              powerGenerationKw: 12,
            },
            capabilities: ["solar-generation"],
            source: "local-blueprint",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const result = await tickHabitat(1, {
    cwd: tempDir,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          solarIrradiance: {
            wPerM2: 900,
            condition: "clear",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  expect(result.energyUsedKwh).toBe(7 / 3600);
  expect(result.solarGeneratedKwh).toBe(6 / 3600);
  expect(result.solarChargedKwh).toBe(6 / 3600);
  expect(result.solarChargingReason).toBe("Solar charging completed.");
  expect(result.batteryEnergyKwh).toBeCloseTo(10 - 1 / 3600, 10);
  expect((await loadLocalRegistration(tempDir))?.modules[0].runtimeAttributes.currentEnergyKwh).toBeCloseTo(10 - 1 / 3600, 10);
});

test("tickHabitat does not apply solar charging when the battery is offline", async () => {
  await mkdir(join(tempDir, ".habitat"), { recursive: true });
  await writeFile(
    getRegistrationFilePath(tempDir),
    JSON.stringify(
      {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        displayName: "Artemis Ridge",
        registeredAt: "2026-07-06T12:00:00.000Z",
        currentTick: 0,
        starterModules: [],
        blueprints: [],
        modules: [
          {
            id: "battery-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "basic-battery",
            moduleType: "basic-battery",
            displayName: "Basic Battery",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "offline",
              currentEnergyKwh: 10,
              energyStorageKwh: 10.01,
              powerDrawKw: { offline: 0, online: 0, active: 0, damaged: 0 },
            },
            capabilities: ["power-storage"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
          {
            id: "command-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "command-module",
            moduleType: "command-module",
            displayName: "Command Module",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "active",
              powerDrawKw: { active: 2 },
            },
            capabilities: ["habitat-command"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
          {
            id: "life-support-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "life-support",
            moduleType: "life-support",
            displayName: "Life Support",
            connectedTo: ["command-1"],
            runtimeAttributes: {
              health: 100,
              status: "active",
              powerDrawKw: { active: 5 },
            },
            capabilities: ["atmosphere-control"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
          {
            id: "solar-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "small-solar-array",
            moduleType: "small-solar-array",
            displayName: "Small Solar Array",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "online",
              powerDrawKw: { offline: 0, online: 0, active: 0, damaged: 0 },
              powerGenerationKw: 12,
            },
            capabilities: ["solar-generation"],
            source: "local-blueprint",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const result = await tickHabitat(1, {
    cwd: tempDir,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          solarIrradiance: {
            wPerM2: 900,
            condition: "clear",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  expect(result.batteryEnergyKwh).toBeCloseTo(10 - 7 / 3600, 10);
  expect(result.solarGeneratedKwh).toBe(0);
  expect(result.solarChargingReason).toBe("no online battery modules");
});

test.each([
  ["no solar panel exists", { includeSolar: false }, "no online solar modules"],
  ["solar panel is offline", { solarStatus: "offline" }, "no online solar modules"],
  ["no battery exists", { includeBattery: false }, "no online battery modules"],
] as const)("tickHabitat reports when %s", async (_case, setup, reason) => {
  await writeSolarRegistration(setup);

  const result = await tickHabitat(1, {
    cwd: tempDir,
    fetchImpl: solarResponse(900),
  });

  expect(result.solarGeneratedKwh).toBe(0);
  expect(result.solarChargedKwh).toBe(0);
  expect(result.solarChargingReason).toBe(reason);
});

test.each([
  ["zero irradiance", solarResponse(0)],
  ["missing irradiance", solarResponse(undefined)],
] as const)("tickHabitat reports %s without charging", async (_case, fetchImpl) => {
  await writeSolarRegistration();

  const result = await tickHabitat(1, { cwd: tempDir, fetchImpl });

  expect(result.solarGeneratedKwh).toBe(0);
  expect(result.solarChargedKwh).toBe(0);
  expect(result.solarChargingReason).toBe("no usable solar irradiance was reported by Kepler");
});

test("tickHabitat reports when an online battery is already full", async () => {
  await writeSolarRegistration({ currentEnergyKwh: 10.01, energyStorageKwh: 10.01 });

  const result = await tickHabitat(1, {
    cwd: tempDir,
    fetchImpl: solarResponse(900),
  });

  expect(result.solarGeneratedKwh).toBe(6 / 3600);
  expect(result.solarChargedKwh).toBe(0);
  expect(result.solarChargingReason).toBe("all online batteries were full");
  expect(result.batteryEnergyKwh).toBe(10.01);
});

test("tickHabitat reports when Kepler solar irradiance fails", async () => {
  await writeSolarRegistration();

  const result = await tickHabitat(1, {
    cwd: tempDir,
    fetchImpl: async () => {
      throw new Error("Kepler unavailable");
    },
  });

  expect(result.solarGeneratedKwh).toBe(0);
  expect(result.solarChargedKwh).toBe(0);
  expect(result.solarChargingReason).toBe("solar irradiance could not be read from Kepler");
});

test("tickHabitat advances construction jobs and completes output modules only after enough ticks", async () => {
  await mkdir(join(tempDir, ".habitat"), { recursive: true });
  await writeFile(
    getRegistrationFilePath(tempDir),
    JSON.stringify(
      {
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        displayName: "Artemis Ridge",
        registeredAt: "2026-07-06T12:00:00.000Z",
        currentTick: 0,
        starterModules: [],
        blueprints: [],
        modules: [
          {
            id: "battery-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "basic-battery",
            moduleType: "basic-battery",
            displayName: "Basic Battery",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "offline",
              currentEnergyKwh: 10,
              energyStorageKwh: 10,
              powerDrawKw: { offline: 0 },
            },
            capabilities: ["power-storage"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
          {
            id: "fabricator-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "workshop-fabricator",
            moduleType: "workshop-fabricator",
            displayName: "Workshop Fabricator",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              status: "active",
              powerDrawKw: { active: 8, idle: 1 },
              constructionJob: {
                id: "construction-1",
                blueprintId: "small-solar-array",
                outputModuleId: "module-solar-1",
                output: { itemType: "module", moduleType: "small-solar-array", quantity: 1 },
                buildTicks: 3,
                remainingTicks: 3,
                runtimeAttributes: { health: 100, status: "online", powerGenerationKw: 12 },
                capabilities: ["solar-generation"],
                status: "active",
                startedAt: "2026-07-06T12:30:00.000Z",
              },
            },
            capabilities: ["basic-fabrication"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:30:00.000Z",
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const partial = await tickHabitat(2, { cwd: tempDir });
  expect(partial.completedConstructionJobs).toEqual([]);

  let stored = await loadLocalRegistration(tempDir);
  let fabricator = stored?.modules.find((module) => module.id === "fabricator-1");
  expect(fabricator?.runtimeAttributes.status).toBe("active");
  expect((fabricator?.runtimeAttributes.constructionJob as { remainingTicks: number }).remainingTicks).toBe(1);
  expect(stored?.modules.find((module) => module.id === "module-solar-1")).toBeUndefined();

  const completed = await tickHabitat(1, { cwd: tempDir });
  expect(completed.completedConstructionJobs).toEqual([
    {
      jobId: "construction-1",
      blueprintId: "small-solar-array",
      outputModuleId: "module-solar-1",
      outputModuleType: "small-solar-array",
      facilityId: "fabricator-1",
      facilityName: "Workshop Fabricator",
    },
  ]);

  stored = await loadLocalRegistration(tempDir);
  fabricator = stored?.modules.find((module) => module.id === "fabricator-1");
  const outputModule = stored?.modules.find((module) => module.id === "module-solar-1");

  expect(fabricator?.runtimeAttributes.status).toBe("idle");
  expect(fabricator?.runtimeAttributes.constructionJob).toBeUndefined();
  expect(outputModule).toMatchObject({
    id: "module-solar-1",
    blueprintId: "small-solar-array",
    moduleType: "small-solar-array",
    displayName: "Small Solar Array",
    runtimeAttributes: { health: 100, status: "online", powerGenerationKw: 12 },
    capabilities: ["solar-generation"],
    source: "local-blueprint",
  });
});

test("module CRUD uses local modules and fetches official blueprints from Kepler", async () => {
  await getLocalStateStore(tempDir).save({
    habitatUuid: "11111111-1111-4111-8111-111111111111",
    habitatId: "habitat_11111111_1111_4111_8111_111111111111",
    displayName: "Artemis Ridge",
    registeredAt: "2026-07-06T12:00:00.000Z",
    currentTick: 0,
    starterModules: [],
    blueprints: [],
    modules: [
      {
        id: "starter-command",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        blueprintId: "command-module",
        moduleType: "command-module",
        displayName: "Command Module",
        connectedTo: [],
        runtimeAttributes: { health: 100, status: "active" },
        capabilities: ["habitat-command"],
        source: "kepler-registration",
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:00:00.000Z",
      },
    ],
    powerSummary: {
      totalPowerDrawKw: 0,
      energyUsedKwh: 0,
      batteryEnergyKwh: 0,
      batteryCapacityKwh: 0,
      powerShortageKwh: 0,
    },
    tickHistory: [],
  });

  expect(await listModules({ cwd: tempDir })).toHaveLength(1);
  expect((await showModule("starter-command", { cwd: tempDir })).displayName).toBe("Command Module");

  const blueprintRequests: string[] = [];
  const created = await createModule(
    { blueprintId: "small-solar-array", name: "Solar Test Array" },
    {
      cwd: tempDir,
      fetchImpl: async (url: string | URL | Request) => {
        blueprintRequests.push(String(url));

        if (String(url) === "https://planet.turingguild.com/catalog/blueprints/small-solar-array") {
          return new Response(
            JSON.stringify({
              blueprint: {
                blueprintId: "small-solar-array",
                displayName: "Small Solar Array Blueprint",
                output: { itemType: "module", moduleType: "small-solar-array", quantity: 1 },
                runtimeAttributes: {
                  health: 100,
                  status: "idle",
                  powerDrawKw: { offline: 0, idle: 0, active: 0, damaged: 0 },
                },
                capabilities: ["solar-generation"],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (String(url) === "https://planet.turingguild.com/catalog/blueprints/survey-rover") {
          return new Response(
            JSON.stringify({
              blueprint: {
                blueprintId: "survey-rover",
                displayName: "Survey Rover Blueprint",
                output: { itemType: "rover", quantity: 1 },
                runtimeAttributes: { health: 100 },
                capabilities: ["starter-survey"],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({ error: { message: "not found" } }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      },
      randomUuid: () => "33333333-3333-4333-8333-333333333333",
      now: () => new Date("2026-07-06T12:10:00.000Z"),
    },
  );

  expect(created).toEqual({
    id: "module_33333333_3333_4333_8333_333333333333",
    habitatId: "habitat_11111111_1111_4111_8111_111111111111",
    blueprintId: "small-solar-array",
    moduleType: "small-solar-array",
    displayName: "Solar Test Array",
    connectedTo: [],
    runtimeAttributes: {
      health: 100,
      status: "idle",
      powerDrawKw: { offline: 0, idle: 0, active: 0, damaged: 0 },
    },
    capabilities: ["solar-generation"],
    source: "local-blueprint",
    createdAt: "2026-07-06T12:10:00.000Z",
    updatedAt: "2026-07-06T12:10:00.000Z",
  });
  expect(blueprintRequests).toContain("https://planet.turingguild.com/catalog/blueprints/small-solar-array");

  const updated = await updateModule(
    created.id,
    { name: "Solar Test Array Prime", status: "active", health: 95 },
    { cwd: tempDir, now: () => new Date("2026-07-06T12:20:00.000Z") },
  );

  expect(updated.displayName).toBe("Solar Test Array Prime");
  expect(updated.runtimeAttributes.status).toBe("active");
  expect(updated.runtimeAttributes.health).toBe(95);
  expect(updated.updatedAt).toBe("2026-07-06T12:20:00.000Z");

  await expect(
    createModule(
      { blueprintId: "survey-rover" },
      {
        cwd: tempDir,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              blueprint: {
                blueprintId: "survey-rover",
                displayName: "Survey Rover Blueprint",
                output: { itemType: "rover", quantity: 1 },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    ),
  ).rejects.toThrow("Blueprint does not output a module: survey-rover");

  await deleteModule(created.id, { cwd: tempDir });
  expect((await listModules({ cwd: tempDir })).map((module) => module.id)).toEqual([
    "starter-command",
  ]);
});

test("setModuleStatus updates only runtime status and saves habitat modules", async () => {
  await writePowerRegistration();

  const before = await showModule("command-1", { cwd: tempDir });
  const updated = await setModuleStatus("command-1", "idle", { cwd: tempDir });

  expect(updated.id).toBe("command-1");
  expect(updated.runtimeAttributes.status).toBe("idle");
  expect(updated.runtimeAttributes.health).toBe(before.runtimeAttributes.health);
  expect(updated.runtimeAttributes.powerDrawKw).toEqual(before.runtimeAttributes.powerDrawKw);
  expect(updated.displayName).toBe(before.displayName);
  expect(updated.updatedAt).toBe(before.updatedAt);

  const storedRegistration = await loadLocalRegistration(tempDir);
  expect(storedRegistration?.modules.find((module) => module.id === "command-1")?.runtimeAttributes.status).toBe("idle");

  const storedModules = JSON.parse(await readFile(getModulesFilePath(tempDir), "utf8"));
  expect(storedModules.find((module: { id: string }) => module.id === "command-1").runtimeAttributes.status).toBe("idle");
});

test("setModuleStatus rejects unsupported runtime states", async () => {
  await writePowerRegistration();

  await expect(setModuleStatus("command-1", "sleeping", { cwd: tempDir })).rejects.toThrow(
    "Status must be one of: offline, idle, online, active, damaged.",
  );
});

test("getLocalStatusSummary reports the local module count", async () => {
  await registerHabitat("Artemis Ridge", {
    cwd: tempDir,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          habitatId: "habitat_11111111_1111_4111_8111_111111111111",
          starterModules: [
            {
              id: "module-1",
              blueprintId: "command-module",
              displayName: "Command Module",
              connectedTo: [],
              runtimeAttributes: { health: 100, status: "active" },
              capabilities: ["habitat-command"],
            },
            {
              id: "module-2",
              blueprintId: "life-support",
              displayName: "Life Support",
              connectedTo: ["module-1"],
              runtimeAttributes: { health: 100, status: "active" },
              capabilities: ["atmosphere-control"],
            },
          ],
          blueprints: [],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    randomUuid: () => "11111111-1111-4111-8111-111111111111",
    now: () => new Date("2026-07-06T12:00:00.000Z"),
  });

  expect(await getLocalStatusSummary({ cwd: tempDir })).toEqual({
    currentTick: 0,
    moduleCount: 2,
    powerSummary: {
      totalPowerDrawKw: 0,
      energyUsedKwh: 0,
      batteryEnergyKwh: 0,
      batteryCapacityKwh: 0,
      powerShortageKwh: 0,
    },
  });
});

test("registerHabitat can run outside the project directory and still use the project .env and .habitat", async () => {
  const outsideDir = await mkdtemp(join(tmpdir(), "habitat-cli-outside-"));

  try {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const registration = await registerHabitat("The Hideout", {
      cwd: outsideDir,
      projectRoot: tempDir,
      fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init: init ?? {} });

        return new Response(
          JSON.stringify({
            habitatId: "habitat_22222222_2222_4222_8222_222222222222",
            starterModules: [],
            blueprints: [],
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      },
      randomUuid: () => "22222222-2222-4222-8222-222222222222",
      now: () => new Date("2026-07-07T12:00:00.000Z"),
    });

    expect(requests[0].url).toBe("https://planet.turingguild.com/habitats/register");
    expect(requests[0].init.headers).toEqual({
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    });
    expect(await loadLocalRegistration(outsideDir)).toBeNull();
    expect(await loadLocalRegistration(tempDir)).toEqual(registration);
  } finally {
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test("checkLocalConfig can verify project configuration from outside the project without network calls", async () => {
  const outsideDir = await mkdtemp(join(tmpdir(), "habitat-cli-outside-"));

  try {
    const config = await checkLocalConfig({
      cwd: outsideDir,
      projectRoot: tempDir,
    });

    expect(config).toEqual({
      baseUrl: "https://planet.turingguild.com",
      tokenLoaded: true,
      databaseFile: join(tempDir, ".habitat", "habitat.sqlite"),
    });
  } finally {
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test("checkLocalConfig honors HABITAT_PROJECT_ROOT for installed launchers", async () => {
  const outsideDir = await mkdtemp(join(tmpdir(), "habitat-cli-outside-"));
  const previousProjectRoot = process.env.HABITAT_PROJECT_ROOT;
  process.env.HABITAT_PROJECT_ROOT = tempDir;

  try {
    await writeFile(join(outsideDir, ".env"), "OTHER_VALUE=true\n", "utf8");

    const config = await checkLocalConfig({
      cwd: outsideDir,
    });

    expect(config.databaseFile).toBe(join(tempDir, ".habitat", "habitat.sqlite"));
    expect(config.tokenLoaded).toBe(true);
  } finally {
    if (previousProjectRoot === undefined) {
      delete process.env.HABITAT_PROJECT_ROOT;
    } else {
      process.env.HABITAT_PROJECT_ROOT = previousProjectRoot;
    }

    await rm(outsideDir, { recursive: true, force: true });
  }
});

test("getRegistrationStatus fetches the saved habitat registration from Kepler", async () => {
  await registerHabitat("Artemis Ridge", {
    cwd: tempDir,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          habitatId: "habitat_11111111_1111_4111_8111_111111111111",
          starterModules: [],
          blueprints: [],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    randomUuid: () => "11111111-1111-4111-8111-111111111111",
    now: () => new Date("2026-07-06T12:00:00.000Z"),
  });

  const requests: Array<{ url: string; init: RequestInit }> = [];
  const status = await getRegistrationStatus({
    cwd: tempDir,
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });

      return new Response(
        JSON.stringify({
          habitat: {
            id: "habitat_11111111_1111_4111_8111_111111111111",
            habitatSlug: "artemis-ridge",
            displayName: "Artemis Ridge",
            catalogVersion: "2026-06-24",
            status: "active",
            lastSeenAt: "2026-07-06T12:05:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe(
    "https://planet.turingguild.com/habitats/habitat_11111111_1111_4111_8111_111111111111/registration",
  );
  expect(requests[0].init.method).toBe("GET");
  expect(requests[0].init.headers).toEqual({
    Authorization: "Bearer test-token",
  });
  expect(status.habitat.status).toBe("active");
  expect(status.habitat.habitatSlug).toBe("artemis-ridge");
});

test("getSolarIrradiance fetches and parses the current Kepler solar irradiance", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const solar = await getSolarIrradiance({
    cwd: tempDir,
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });

      return new Response(
        JSON.stringify({
          solarIrradiance: {
            wPerM2: 900,
            condition: "clear",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://planet.turingguild.com/world/solar-irradiance");
  expect(requests[0].init.method).toBe("GET");
  expect(requests[0].init.headers).toEqual({});
  expect(solar).toEqual({
    solarIrradiance: {
      wPerM2: 900,
      condition: "clear",
    },
  });
});

test("unregisterHabitat deletes server registration before removing the local registration file", async () => {
  await registerHabitat("Artemis Ridge", {
    cwd: tempDir,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          habitatId: "habitat_11111111_1111_4111_8111_111111111111",
          starterModules: [],
          blueprints: [],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    randomUuid: () => "11111111-1111-4111-8111-111111111111",
    now: () => new Date("2026-07-06T12:00:00.000Z"),
  });

  const requests: Array<{ url: string; init: RequestInit }> = [];
  const result = await unregisterHabitat({
    cwd: tempDir,
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    },
  });

  expect(result.habitatId).toBe("habitat_11111111_1111_4111_8111_111111111111");
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe(
    "https://planet.turingguild.com/habitats/habitat_11111111_1111_4111_8111_111111111111",
  );
  expect(requests[0].init.method).toBe("DELETE");
  expect(requests[0].init.headers).toEqual({
    Authorization: "Bearer test-token",
  });
  expect(await loadLocalRegistration(tempDir)).toBeNull();
});
