import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile as fsReadFile, rm, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLocalStateStore } from "../src/local-state";
import {
  addInventoryResource,
  createModule,
  deleteModule,
  dryRunConstruction,
  cancelConstructionJob,
  listInventory,
  listConstructionJobs,
  listModules,
  removeInventoryResource,
  showModule,
  startConstruction,
  tickHabitat,
  updateModule,
} from "../src/habitat";
import { createApp } from "../src/server";

function getRegistrationFilePath(cwd: string) {
  return join(cwd, ".habitat", "registration.json");
}

function getModulesFilePath(cwd: string) {
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

test("help advertises Kepler registration, catalog, and local module commands", async () => {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", "--help"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("register");
  expect(output).toContain("status");
  expect(output).toContain("unregister");
  expect(output).toContain("config");
  expect(output).toContain("solar");
  expect(output).toContain("blueprint");
  expect(output).toContain("resource");
  expect(output).toContain("module");
  expect(output).not.toContain("zone");
  expect(output).not.toContain("door");
  expect(output).not.toContain("airlock");
  expect(output).not.toContain("sensor");
  expect(output).not.toContain("rover");
  expect(output).not.toContain("greenhouse");
});

let tempDir: string;
let server: ReturnType<typeof Bun.serve> | undefined;
let backendServer: ReturnType<typeof Bun.serve> | undefined;
let previousApiBaseUrl: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "habitat-cli-"));
  await writeFile(
    join(tempDir, ".env"),
    "KEPLER_BASE_URL=https://planet.turingguild.com\nKEPLER_PLANET_TOKEN=test-token\n",
    "utf8",
  );
  await mkdir(join(tempDir, ".habitat"), { recursive: true });
  await writeFile(
    join(tempDir, ".habitat", "registration.json"),
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
            id: "module-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "command-module",
            moduleType: "command-module",
            displayName: "Command Module",
            connectedTo: [],
            runtimeAttributes: { health: 100, status: "active", powerDrawKw: { active: 2, idle: 1 } },
            capabilities: ["habitat-command"],
            source: "kepler-registration",
            createdAt: "2026-07-06T12:00:00.000Z",
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
          {
            id: "module-2",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "life-support",
            moduleType: "life-support",
            displayName: "Life Support",
            connectedTo: ["module-1"],
            runtimeAttributes: { health: 99, status: "idle", powerDrawKw: { idle: 5 } },
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
  previousApiBaseUrl = process.env.HABITAT_API_BASE_URL;
  const backendApp = createApp({
    listModules: () => listModules({ cwd: tempDir }),
    showModule: (id) => showModule(id, { cwd: tempDir }),
    createModule: (input) => createModule(input, { cwd: tempDir }),
    updateModule: (id, input) => updateModule(id, input, { cwd: tempDir }),
    deleteModule: (id) => deleteModule(id, { cwd: tempDir }),
    listInventory: () => listInventory({ cwd: tempDir }),
    addInventoryResource: (resource, quantity) => addInventoryResource(resource, quantity, { cwd: tempDir }),
    removeInventoryResource: (resource, quantity) => removeInventoryResource(resource, quantity, { cwd: tempDir }),
    tickHabitat: (count) => tickHabitat(count, { cwd: tempDir }),
    dryRunConstruction: (blueprintId) => dryRunConstruction(blueprintId, { cwd: tempDir }),
    startConstruction: (blueprintId) => startConstruction(blueprintId, { cwd: tempDir }),
    listConstructionJobs: () => listConstructionJobs({ cwd: tempDir }),
    cancelConstructionJob: (facilityId) => cancelConstructionJob(facilityId, { cwd: tempDir }),
  });
  backendServer = Bun.serve({ port: 0, fetch: backendApp.fetch });
  process.env.HABITAT_API_BASE_URL = `http://127.0.0.1:${backendServer.port}`;
});

async function writeTickRegistration() {
  await writeFile(
    join(tempDir, ".habitat", "registration.json"),
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
              currentEnergyKwh: 500,
              energyStorageKwh: 500,
              powerDrawKw: { offline: 0 },
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
            runtimeAttributes: { health: 100, status: "active", powerDrawKw: { active: 2 } },
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
            runtimeAttributes: { health: 100, status: "active", powerDrawKw: { active: 5 } },
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

afterEach(async () => {
  server?.stop(true);
  server = undefined;
  backendServer?.stop(true);
  backendServer = undefined;
  if (previousApiBaseUrl === undefined) {
    delete process.env.HABITAT_API_BASE_URL;
  } else {
    process.env.HABITAT_API_BASE_URL = previousApiBaseUrl;
  }
  await rm(tempDir, { recursive: true, force: true });
});

function startBlueprintCatalogServer() {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const isBackendRequest = !request.headers.get("authorization");

      if (url.pathname === "/catalog/blueprints") {
        return Response.json({
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
            {
              id: "bp-2",
              blueprintId: "rover-bay-upgrade",
              displayName: "Rover Bay Upgrade",
              description: "Upgrades the rover bay.",
              status: "published",
              output: { itemType: "facility-upgrade", quantity: 1 },
              inputs: { spareParts: 8, power: 3 },
              requiredFacility: { moduleType: "rover-bay", level: 1 },
              buildTicks: 300,
              repeatable: false,
            },
          ],
        });
      }

      if (url.pathname === "/catalog/resources") {
        return Response.json({
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
            {
              id: "resource-spare-parts",
              resourceType: "spare-parts",
              displayName: "Spare Parts",
              kind: "manufactured",
              rarity: "uncommon",
              description: "General repair and build components.",
              unit: "parts",
            },
          ],
        });
      }

      if (url.pathname === "/catalog/blueprints/survey-rover") {
        const blueprint = {
            id: "bp-1",
            blueprintId: "survey-rover",
            displayName: "Survey Rover",
            description: "Builds a rover for site surveys.",
            status: "published",
            output: { itemType: "rover", quantity: 1 },
            inputs: { spareParts: 4 },
            productionCost: { powerKwh: 7 },
            requiredFacility: { moduleType: "rover-bay", level: 1 },
            buildTicks: 120,
            prerequisites: ["rover-bay"],
            unlocks: ["site-survey"],
            repeatable: true,
            capabilities: ["resource-survey"],
          };
        return Response.json(isBackendRequest ? blueprint : { blueprint });
      }

      if (url.pathname === "/catalog/blueprints/small-solar-array") {
        const blueprint = {
            id: "bp-solar",
            blueprintId: "small-solar-array",
            displayName: "Small Solar Array Blueprint",
            description: "Generates starter solar power.",
            status: "published",
            output: { itemType: "module", moduleType: "small-solar-array", quantity: 1 },
            inputs: { ferrite: 90, "silicate-glass": 45, "conductive-ore": 18 },
            productionCost: { power: 3 },
            requiredFacility: { moduleType: "workshop-fabricator", minimumLevel: 1 },
            buildTicks: 180,
            prerequisites: [],
            unlocks: [],
            repeatable: true,
            runtimeAttributes: { health: 100, status: "online", powerGenerationKw: 12 },
            capabilities: ["solar-generation"],
          };
        return Response.json(isBackendRequest ? blueprint : { blueprint });
      }

      if (isBackendRequest && url.pathname.startsWith("/catalog/blueprints/")) {
        return Response.json({ error: { message: `Blueprint not found: ${url.pathname.split("/").pop()}` } }, { status: 404 });
      }

      return Response.json({ error: { message: "not found" } }, { status: 404 });
    },
  });

  return `http://${server.hostname}:${server.port}`;
}

function startSolarStatusServer() {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/world/solar-irradiance" || url.pathname === "/solar/irradiance") {
        return Response.json({
          solarIrradiance: {
            wPerM2: 900,
            condition: "clear",
          },
        });
      }

      return Response.json({ error: { message: "not found" } }, { status: 404 });
    },
  });

  return `http://127.0.0.1:${server.port}`;
}

function startRegistrationBackendServer() {
  const requests: string[] = [];
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);

      if (request.method === "POST" && url.pathname === "/registration") {
        return Response.json({
          registration: {
            habitatUuid: "11111111-1111-4111-8111-111111111111",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            displayName: "Artemis Ridge",
            apiToken: "habitat-api-token",
          },
        }, { status: 201 });
      }

      if (request.method === "GET" && url.pathname === "/status") {
        return Response.json({
          status: {
            habitat: {
              id: "habitat_11111111_1111_4111_8111_111111111111",
              habitatSlug: "artemis-ridge",
              displayName: "Artemis Ridge",
              catalogVersion: "2026-06-24",
              status: "active",
              lastSeenAt: "2026-07-10T12:00:00.000Z",
            },
            currentTick: 60,
            moduleCount: 2,
            powerSummary: {
              totalPowerDrawKw: 7,
              energyUsedKwh: 0.11667,
              batteryEnergyKwh: 100,
              batteryCapacityKwh: 200,
              powerShortageKwh: 0,
            },
          },
        });
      }

      if (request.method === "DELETE" && url.pathname === "/registration") {
        return Response.json({ registration: null, habitatId: "habitat_11111111_1111_4111_8111_111111111111" });
      }

      return Response.json({ error: { message: "not found" } }, { status: 404 });
    },
  });

  return { baseUrl: `http://127.0.0.1:${server.port}`, requests };
}

test("registration lifecycle commands use the backend and keep friendly output", async () => {
  const backend = startRegistrationBackendServer();
  const env = { ...process.env, HABITAT_PROJECT_ROOT: tempDir, HABITAT_API_BASE_URL: backend.baseUrl };

  const registerProc = Bun.spawn(["bun", "run", "src/index.ts", "register", "--name", "Artemis Ridge"], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env,
  });
  const registerOutput = await new Response(registerProc.stdout).text();
  const registerErrorOutput = await new Response(registerProc.stderr).text();
  expect(await registerProc.exited).toBe(0);
  expect(registerErrorOutput).toBe("");
  expect(registerOutput).toContain("Registered habitat: Artemis Ridge");

  const statusProc = Bun.spawn(["bun", "run", "src/index.ts", "status"], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env,
  });
  const statusOutput = await new Response(statusProc.stdout).text();
  expect(await statusProc.exited).toBe(0);
  expect(statusOutput).toContain("Habitat ID: habitat_11111111_1111_4111_8111_111111111111");
  expect(statusOutput).toContain("Current Tick: 60");

  const unregisterProc = Bun.spawn(["bun", "run", "src/index.ts", "unregister"], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env,
  });
  const unregisterOutput = await new Response(unregisterProc.stdout).text();
  const unregisterErrorOutput = await new Response(unregisterProc.stderr).text();
  expect(await unregisterProc.exited).toBe(0);
  expect(unregisterErrorOutput).toBe("");
  expect(unregisterOutput).toContain("Unregistered habitat: habitat_11111111_1111_4111_8111_111111111111");
  expect(backend.requests).toEqual([
    "POST /registration",
    "GET /status",
    "DELETE /registration",
  ]);
});

test("blueprint list and show read the Kepler catalog without changing local state", async () => {
  const baseUrl = startBlueprintCatalogServer();
  await writeFile(
    join(tempDir, ".env"),
    `KEPLER_BASE_URL=${baseUrl}\nKEPLER_PLANET_TOKEN=test-token\n`,
    "utf8",
  );
  const beforeRegistration = await readFile(join(tempDir, ".habitat", "registration.json"), "utf8");

  const listProc = Bun.spawn(["bun", "run", "src/index.ts", "blueprint", "list"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir, HABITAT_API_BASE_URL: baseUrl },
  });

  const listOutput = await new Response(listProc.stdout).text();
  const listErrorOutput = await new Response(listProc.stderr).text();
  expect(await listProc.exited).toBe(0);
  expect(listErrorOutput).toBe("");
  expect(listOutput).toContain("Blueprint ID");
  expect(listOutput).toContain("Name");
  expect(listOutput).toContain("Build Ticks");
  expect(listOutput).toContain("survey-rover");
  expect(listOutput).toContain("Survey Rover");
  expect(listOutput).toContain("rover-bay-upgrade");

  const showProc = Bun.spawn(["bun", "run", "src/index.ts", "blueprint", "show", "survey-rover"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir, HABITAT_API_BASE_URL: baseUrl },
  });

  const showOutput = await new Response(showProc.stdout).text();
  const showErrorOutput = await new Response(showProc.stderr).text();
  expect(await showProc.exited).toBe(0);
  expect(showErrorOutput).toBe("");
  expect(showOutput).toContain("ID: survey-rover");
  expect(showOutput).toContain("Name: Survey Rover");
  expect(showOutput).toContain("Description: Builds a rover for site surveys.");
  expect(showOutput).toContain("Build Ticks: 120");
  expect(showOutput).toContain("Inputs: {\"spareParts\":4}");
  expect(showOutput).toContain("Required Facility: {\"moduleType\":\"rover-bay\",\"level\":1}");
  expect(showOutput).toContain("Capabilities: resource-survey");

  const missingProc = Bun.spawn(["bun", "run", "src/index.ts", "blueprint", "show", "missing-blueprint"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir, HABITAT_API_BASE_URL: baseUrl },
  });

  const missingOutput = await new Response(missingProc.stdout).text();
  const missingErrorOutput = await new Response(missingProc.stderr).text();
  expect(await missingProc.exited).toBe(1);
  expect(missingOutput).toBe("");
  expect(missingErrorOutput).toContain("Blueprint not found: missing-blueprint");
  expect(await readFile(join(tempDir, ".habitat", "registration.json"), "utf8")).toBe(beforeRegistration);
});

test("resource list reads possible Kepler resource types without creating inventory", async () => {
  const baseUrl = startBlueprintCatalogServer();
  await writeFile(
    join(tempDir, ".env"),
    `KEPLER_BASE_URL=${baseUrl}\nKEPLER_PLANET_TOKEN=test-token\n`,
    "utf8",
  );
  const beforeRegistration = await readFile(join(tempDir, ".habitat", "registration.json"), "utf8");

  const proc = Bun.spawn(["bun", "run", "src/index.ts", "resource", "list"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir, HABITAT_API_BASE_URL: baseUrl },
  });

  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Resource catalog: possible resource types in the Kepler world.");
  expect(output).toContain("Local inventory: resources your habitat owns are managed with `habitat inventory`.");
  expect(output).toContain("Blueprint requirements: resources or modules needed to build something later.");
  expect(output).toContain("Resource Type");
  expect(output).toContain("water");
  expect(output).toContain("Water");
  expect(output).toContain("liters");
  expect(output).toContain("spare-parts");
  expect(output).not.toContain("You own");
  expect(output).not.toContain("Inventory");
  expect(await readFile(join(tempDir, ".habitat", "registration.json"), "utf8")).toBe(beforeRegistration);
});

test("construct dry-run reports readiness without changing local state", async () => {
  const baseUrl = startBlueprintCatalogServer();
  await writeFile(
    join(tempDir, ".env"),
    `KEPLER_BASE_URL=${baseUrl}\nKEPLER_PLANET_TOKEN=test-token\n`,
    "utf8",
  );
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
  await writeFile(join(tempDir, ".habitat", "registration.json"), JSON.stringify(registration, null, 2) + "\n", "utf8");
  const beforeRegistration = await readFile(join(tempDir, ".habitat", "registration.json"), "utf8");

  const proc = Bun.spawn(["bun", "run", "src/index.ts", "construct", "small-solar-array", "--dry-run"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Construction Dry Run: small-solar-array");
  expect(output).toContain("Required Facility Exists: yes (workshop-fabricator)");
  expect(output).toContain("Fabricator Available: yes (Workshop Fabricator: idle)");
  expect(output).toContain("Supply Cache Online: yes (Supply Cache: active)");
  expect(output).toContain("Prerequisites Met: yes (none)");
  expect(output).toContain("Inventory Sufficient: no");
  expect(output).toContain("conductive-ore: need 18, have 18, ok");
  expect(output).toContain("ferrite: need 90, have 100, ok");
  expect(output).toContain("silicate-glass: need 45, have 40, missing 5");
  expect(output).toContain("Module To Create: small-solar-array x1");
  expect(output).toContain("Resources To Spend: {\"ferrite\":90,\"silicate-glass\":45,\"conductive-ore\":18}");
  expect(output).toContain("Build Time: 180 ticks (0.05 hours)");
  expect(output).toContain("Can Start Construction: no");
  expect(await readFile(join(tempDir, ".habitat", "registration.json"), "utf8")).toBe(beforeRegistration);
});

test("construct starts a local construction job without creating the output module", async () => {
  const baseUrl = startBlueprintCatalogServer();
  await writeFile(
    join(tempDir, ".env"),
    `KEPLER_BASE_URL=${baseUrl}\nKEPLER_PLANET_TOKEN=test-token\n`,
    "utf8",
  );
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
  };
  await writeFile(join(tempDir, ".habitat", "registration.json"), JSON.stringify(registration, null, 2) + "\n", "utf8");

  const proc = Bun.spawn(["bun", "run", "src/index.ts", "construct", "small-solar-array"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Started Construction: small-solar-array");
  expect(output).toContain("Construction Job:");
  expect(output).toContain("Output Module ID: module_");
  expect(output).toContain("Build Ticks: 180");
  expect(output).toContain("Build Time: 180 ticks (0.05 hours)");
  expect(output).toContain("Remaining Ticks: 180");
  expect(output).toContain("Remaining Time: 180 ticks (0.05 hours)");
  expect(output).toContain("Facility: Workshop Fabricator");

  const stored = JSON.parse(await readFile(join(tempDir, ".habitat", "habitat-modules.json"), "utf8"));
  expect(stored.map((module: { moduleType: string }) => module.moduleType)).toEqual([
    "basic-battery",
    "workshop-fabricator",
    "supply-cache",
  ]);

  const fabricator = stored.find((module: { id: string }) => module.id === "fabricator-1");
  expect(fabricator.runtimeAttributes.status).toBe("active");
  expect(fabricator.runtimeAttributes.constructionJob.blueprintId).toBe("small-solar-array");
  expect(fabricator.runtimeAttributes.constructionJob.outputModuleId).toStartWith("module_");
  expect(fabricator.runtimeAttributes.constructionJob.remainingTicks).toBe(180);
  expect(fabricator.runtimeAttributes.constructionJob.runtimeAttributes).toEqual({
    health: 100,
    status: "online",
    powerGenerationKw: 12,
  });
  expect(fabricator.runtimeAttributes.constructionJob.capabilities).toEqual(["solar-generation"]);

  const cache = stored.find((module: { id: string }) => module.id === "cache-1");
  expect(cache.runtimeAttributes.storedResources).toEqual({
    ferrite: 10,
    "silicate-glass": 5,
    "conductive-ore": 0,
  });
});

test("construction status prints active construction jobs", async () => {
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
  };
  await writeFile(join(tempDir, ".habitat", "registration.json"), JSON.stringify(registration, null, 2) + "\n", "utf8");

  const proc = Bun.spawn(["bun", "run", "src/index.ts", "construction", "status"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Active Construction Jobs");
  expect(output).toContain("construction-1");
  expect(output).toContain("small-solar-array");
  expect(output).toContain("Workshop Fabricator");
  expect(output).toContain("module-solar-1");
  expect(output).toContain("172 / 180 ticks remaining");
  expect(output).toContain("0.04778 / 0.05 hours");
});

test("construction cancel clears an active job without refunding materials", async () => {
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
  };
  await writeFile(join(tempDir, ".habitat", "registration.json"), JSON.stringify(registration, null, 2) + "\n", "utf8");

  const proc = Bun.spawn(["bun", "run", "src/index.ts", "construction", "cancel", "workshop-fabricator-1"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Canceled construction job construction-1 for small-solar-array.");
  expect(output).toContain("Workshop Fabricator is available again.");
  expect(output).toContain("No output module was created.");
  expect(output).toContain("Spent materials were not refunded.");

  const stored = JSON.parse(await readFile(join(tempDir, ".habitat", "habitat-modules.json"), "utf8"));
  const fabricator = stored.find((module: { id: string }) => module.id === "fabricator-1");
  const cache = stored.find((module: { id: string }) => module.id === "cache-1");

  expect(fabricator.runtimeAttributes.status).toBe("idle");
  expect(fabricator.runtimeAttributes.constructionJob).toBeUndefined();
  expect(stored.find((module: { id: string }) => module.id === "module-solar-1")).toBeUndefined();
  expect(cache.runtimeAttributes.storedResources).toEqual({
    ferrite: 10,
    "silicate-glass": 5,
    "conductive-ore": 0,
  });
});

test("inventory add and list update the local supply cache", async () => {
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
        id: "cache-1",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        blueprintId: "supply-cache",
        moduleType: "supply-cache",
        displayName: "Supply Cache",
        connectedTo: [],
        runtimeAttributes: {
          health: 100,
          status: "active",
          storedResources: {},
          powerDrawKw: { active: 0.5 },
        },
        capabilities: ["storage"],
        source: "kepler-registration",
        createdAt: "2026-07-06T12:00:00.000Z",
        updatedAt: "2026-07-06T12:00:00.000Z",
      },
    ],
  };
  await writeFile(join(tempDir, ".habitat", "registration.json"), JSON.stringify(registration, null, 2) + "\n", "utf8");

  for (const [resource, quantity] of [
    ["ferrite", "90"],
    ["silicate-glass", "45"],
    ["conductive-ore", "18"],
  ]) {
    const addProc = Bun.spawn(["bun", "run", "src/index.ts", "inventory", "add", resource, quantity], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
    });

    const output = await new Response(addProc.stdout).text();
    const errorOutput = await new Response(addProc.stderr).text();
    expect(await addProc.exited).toBe(0);
    expect(errorOutput).toBe("");
    expect(output).toContain(`Added ${quantity} ${resource} to Supply Cache.`);
  }

  const listProc = Bun.spawn(["bun", "run", "src/index.ts", "inventory", "list"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const output = await new Response(listProc.stdout).text();
  const errorOutput = await new Response(listProc.stderr).text();
  expect(await listProc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Local Inventory");
  expect(output).toContain("conductive-ore | 18");
  expect(output).toContain("ferrite | 90");
  expect(output).toContain("silicate-glass | 45");

  const removeProc = Bun.spawn(["bun", "run", "src/index.ts", "inventory", "remove", "ferrite", "5"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });
  const removeOutput = await new Response(removeProc.stdout).text();
  const removeErrorOutput = await new Response(removeProc.stderr).text();
  expect(await removeProc.exited).toBe(0);
  expect(removeErrorOutput).toBe("");
  expect(removeOutput).toContain("Removed 5 ferrite from Supply Cache.");
  expect(removeOutput).toContain("Current Quantity: 85");

  const stored = JSON.parse(await readFile(join(tempDir, ".habitat", "habitat-modules.json"), "utf8"));
  const cache = stored.find((module: { id: string }) => module.id === "cache-1");
  expect(cache.runtimeAttributes.storedResources).toEqual({
    ferrite: 85,
    "silicate-glass": 45,
    "conductive-ore": 18,
  });
});

test("module list and show print local module state", async () => {
  const listProc = Bun.spawn(["bun", "run", "src/index.ts", "module", "list"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const listOutput = await new Response(listProc.stdout).text();
  expect(await listProc.exited).toBe(0);
  expect(listOutput).toContain("1 | command-module-1 | Command Module | active | 100");
  expect(listOutput).toContain("2 | life-support-1 | Life Support | idle | 99");
  expect(listOutput).not.toContain("\nmodule-1 |");
  expect(listOutput.startsWith("module-1 |")).toBe(false);

  const showProc = Bun.spawn(["bun", "run", "src/index.ts", "module", "show", "2"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const showOutput = await new Response(showProc.stdout).text();
  expect(await showProc.exited).toBe(0);
  expect(showOutput).toContain("ID: module-2");
  expect(showOutput).toContain("Capabilities: atmosphere-control");
  expect(showOutput).toContain("Connected To: module-1");
});

test("module status prints current power table and one-tick energy cost", async () => {
  const statusProc = Bun.spawn(["bun", "run", "src/index.ts", "module", "status"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const output = await new Response(statusProc.stdout).text();
  const errorOutput = await new Response(statusProc.stderr).text();
  expect(await statusProc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Module");
  expect(output).toContain("Declared");
  expect(output).toContain("Effective");
  expect(output).toContain("Power Draw");
  expect(output).toContain("Command Module");
  expect(output).toContain("active");
  expect(output).toContain("2 kW");
  expect(output).toContain("Life Support");
  expect(output).toContain("idle");
  expect(output).toContain("5 kW");
  expect(output).toContain("Total Power Draw: 7 kW");
  expect(output).toContain("Energy Cost Per Tick: 0.00194 kWh");
});

test("power overview preserves the readable power table through the backend", async () => {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", "power", "overview"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Command Module");
  expect(output).toContain("Total Power Draw: 7 kW");
});

test("module status explains effective construction state and depleted batteries", async () => {
  await writeFile(
    join(tempDir, ".habitat", "registration.json"),
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
              currentEnergyKwh: 0,
              energyStorageKwh: 500,
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

  const statusProc = Bun.spawn(["bun", "run", "src/index.ts", "module", "status"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const output = await new Response(statusProc.stdout).text();
  const errorOutput = await new Response(statusProc.stderr).text();
  expect(await statusProc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Workshop Fabricator");
  expect(output).toContain("active");
  expect(output).toContain("constructing small-solar-array");
  expect(output).toContain("Battery Energy: 0 / 500 kWh");
  expect(output).toContain("No usable battery energy remains.");
});

test("module show prints construction, battery, and generation details in readable lines", async () => {
  await writeFile(
    join(tempDir, ".habitat", "registration.json"),
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
              currentEnergyKwh: 485.7,
              energyStorageKwh: 500,
              reserveKwh: 60,
              maxPowerOutputKw: 40,
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
            id: "module-solar-1",
            habitatId: "habitat_11111111_1111_4111_8111_111111111111",
            blueprintId: "small-solar-array",
            moduleType: "small-solar-array",
            displayName: "Small Solar Array",
            connectedTo: [],
            runtimeAttributes: {
              health: 100,
              powerDrawKw: { offline: 0, online: 0, active: 0, damaged: 0 },
              status: "online",
              powerGenerationKw: 12,
              degradedStormGenerationKw: 3,
              maintenanceHoursPer100Ticks: 4,
              surfaceAreaM2: 28,
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

  const batteryProc = Bun.spawn(["bun", "run", "src/index.ts", "module", "show", "basic-battery-1"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });
  const batteryOutput = await new Response(batteryProc.stdout).text();
  expect(await batteryProc.exited).toBe(0);
  expect(batteryOutput).toContain("Battery Energy: 485.7 / 500 kWh");
  expect(batteryOutput).toContain("Reserve Energy: 60 kWh");
  expect(batteryOutput).toContain("Max Power Output: 40 kW");

  const fabricatorProc = Bun.spawn(["bun", "run", "src/index.ts", "module", "show", "workshop-fabricator-1"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });
  const fabricatorOutput = await new Response(fabricatorProc.stdout).text();
  expect(await fabricatorProc.exited).toBe(0);
  expect(fabricatorOutput).toContain("Construction Job: construction-1");
  expect(fabricatorOutput).toContain("Building: small-solar-array");
  expect(fabricatorOutput).toContain("Remaining Build Time: 172 / 180 ticks");
  expect(fabricatorOutput).toContain("0.04778 / 0.05 hours");
  expect(fabricatorOutput).toContain("Output Module ID: module-solar-1");

  const solarProc = Bun.spawn(["bun", "run", "src/index.ts", "module", "show", "small-solar-array-1"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });
  const solarOutput = await new Response(solarProc.stdout).text();
  expect(await solarProc.exited).toBe(0);
  expect(solarOutput).toContain("Power Generation: 12 kW");
  expect(solarOutput).toContain("Storm Generation: 3 kW");
  expect(solarOutput).toContain("Surface Area: 28 m2");
  expect(solarOutput).toContain("Maintenance Load: 4 crew-hours / 100 operating ticks");
});

test("module set-status updates one module and prints current power draw", async () => {
  const statusProc = Bun.spawn(["bun", "run", "src/index.ts", "module", "set-status", "module-1", "idle"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const output = await new Response(statusProc.stdout).text();
  const errorOutput = await new Response(statusProc.stderr).text();
  expect(await statusProc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Updated module module-1 to idle.");
  expect(output).toContain("Current Power Draw: 1 kW");

  const stored = JSON.parse(await readFile(join(tempDir, ".habitat", "habitat-modules.json"), "utf8"));
  const updated = stored.find((module: { id: string }) => module.id === "module-1");
  expect(updated.runtimeAttributes).toEqual({
    health: 100,
    status: "idle",
    powerDrawKw: { active: 2, idle: 1 },
  });
});

test("module set-status rejects unsupported statuses", async () => {
  const statusProc = Bun.spawn(["bun", "run", "src/index.ts", "module", "set-status", "module-1", "sleeping"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const output = await new Response(statusProc.stdout).text();
  const errorOutput = await new Response(statusProc.stderr).text();
  expect(await statusProc.exited).toBe(1);
  expect(output).toBe("");
  expect(errorOutput).toContain("Status must be one of: offline, idle, online, active, damaged.");
});

test("module commands accept friendly module handles and condition alias", async () => {
  const showProc = Bun.spawn(["bun", "run", "src/index.ts", "module", "show", "command-module-1"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const showOutput = await new Response(showProc.stdout).text();
  expect(await showProc.exited).toBe(0);
  expect(showOutput).toContain("ID: module-1");

  const updateProc = Bun.spawn(
    [
      "bun",
      "run",
      "src/index.ts",
      "module",
      "update",
      "command-module-1",
      "--status",
      "maintenance",
      "--condition",
      "87",
    ],
    {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
    },
  );

  expect(await updateProc.exited).toBe(0);

  const updatedShowProc = Bun.spawn(["bun", "run", "src/index.ts", "module", "show", "command-module-1"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const updatedShowOutput = await new Response(updatedShowProc.stdout).text();
  expect(await updatedShowProc.exited).toBe(0);
  expect(updatedShowOutput).toContain("Status: maintenance");
  expect(updatedShowOutput).toContain("Health: 87");
});

test("tick command prints power summary and persists battery drain", async () => {
  await writeTickRegistration();

  const tickProc = Bun.spawn(["bun", "run", "src/index.ts", "tick", "60"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const tickOutput = await new Response(tickProc.stdout).text();
  expect(await tickProc.exited).toBe(0);
  expect(tickOutput).toContain("Ticks Advanced: 60");
  expect(tickOutput).toContain("Current Tick: 60");
  expect(tickOutput).toContain("Total Power Draw: 7 kW");
  expect(tickOutput).toContain("Energy Used: 0.11667 kWh");
  expect(tickOutput).toContain("Battery Energy: 499.88333 / 500 kWh");
  expect(tickOutput).toContain("Power Shortage: 0 kWh");
  expect(tickOutput).toContain("Solar Generated: 0 kWh");
  expect(tickOutput).toContain("Solar Charging: none (no online solar modules)");

  const stored = JSON.parse(
    await readFile(join(tempDir, ".habitat", "registration.json"), "utf8"),
  );
  expect(stored.currentTick).toBe(60);
  expect(stored.modules[0].runtimeAttributes.currentEnergyKwh).toBeCloseTo(499.8833333333, 10);
});

test("solar status prints the current Kepler irradiance in beginner-friendly language", async () => {
  const baseUrl = startSolarStatusServer();
  await writeFile(
    join(tempDir, ".env"),
    `KEPLER_BASE_URL=${baseUrl}\nKEPLER_PLANET_TOKEN=test-token\n`,
    "utf8",
  );

  const solarProc = Bun.spawn(["bun", "run", "src/index.ts", "solar", "status"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir, HABITAT_API_BASE_URL: baseUrl },
  });

  const output = await new Response(solarProc.stdout).text();
  const errorOutput = await new Response(solarProc.stderr).text();
  expect(await solarProc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Solar Irradiance: 900 W/m2");
  expect(output).toContain("Condition: clear");
  expect(output).toContain("Kepler reports clear conditions. Local solar charging will use this irradiance.");
});

test("tick command reports completed construction jobs", async () => {
  await writeFile(
    join(tempDir, ".habitat", "registration.json"),
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
                buildTicks: 1,
                remainingTicks: 1,
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

  const tickProc = Bun.spawn(["bun", "run", "src/index.ts", "tick", "1"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const output = await new Response(tickProc.stdout).text();
  const errorOutput = await new Response(tickProc.stderr).text();
  expect(await tickProc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Construction Completed:");
  expect(output).toContain("small-solar-array -> module-solar-1");
  expect(output).toContain("Facility Available: Workshop Fabricator");

  const stored = JSON.parse(await readFile(join(tempDir, ".habitat", "habitat-modules.json"), "utf8"));
  const fabricator = stored.find((module: { id: string }) => module.id === "fabricator-1");
  expect(fabricator.runtimeAttributes.status).toBe("idle");
  expect(fabricator.runtimeAttributes.constructionJob).toBeUndefined();
  expect(stored.find((module: { id: string }) => module.id === "module-solar-1")).toMatchObject({
    moduleType: "small-solar-array",
    capabilities: ["solar-generation"],
  });
});

test("tick command clearly reports when no usable battery energy remains", async () => {
  await writeTickRegistration();
  const stored = JSON.parse(await readFile(join(tempDir, ".habitat", "registration.json"), "utf8"));
  stored.modules[0].runtimeAttributes.currentEnergyKwh = 0;
  await writeFile(join(tempDir, ".habitat", "registration.json"), JSON.stringify(stored, null, 2) + "\n", "utf8");

  const tickProc = Bun.spawn(["bun", "run", "src/index.ts", "tick", "1"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
  });

  const output = await new Response(tickProc.stdout).text();
  const errorOutput = await new Response(tickProc.stderr).text();
  expect(await tickProc.exited).toBe(0);
  expect(errorOutput).toBe("");
  expect(output).toContain("Battery Energy: 0 / 500 kWh");
  expect(output).toContain("No usable battery energy remains.");
});

test("tick command rejects invalid counts", async () => {
  await writeTickRegistration();

  for (const count of ["0", "-1", "abc"]) {
    const tickProc = Bun.spawn(["bun", "run", "src/index.ts", "tick", count], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HABITAT_PROJECT_ROOT: tempDir },
    });

    const stderr = await new Response(tickProc.stderr).text();
    expect(await tickProc.exited).toBe(1);
    expect(stderr).toContain("tick count must be a positive integer");
  }
});
