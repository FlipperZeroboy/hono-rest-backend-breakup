import { Hono } from "hono";
import {
  getLocalStatusSummary,
  getRegistrationStatus,
  getSolarIrradiance,
  addInventoryResource,
  createModule,
  deleteModule,
  dryRunConstruction,
  listBlueprintCatalog,
  listInventory,
  listModules,
  listResourceCatalog,
  loadLocalRegistration,
  registerHabitat,
  removeInventoryResource,
  startConstruction,
  showBlueprint,
  showModule,
  tickHabitat,
  unregisterHabitat,
  updateModule,
  cancelConstructionJob,
  listConstructionJobs,
  type HabitatStatus,
  type HabitatModule,
  type ConstructionCancelResult,
  type ConstructionDryRun,
  type ConstructionJobStatus,
  type ConstructionStart,
  type InventoryAddResult,
  type InventoryEntry,
  type InventoryRemoveResult,
  type IndustryResource,
  type LocalRegistration,
  type ProductionBlueprint,
  type TickSummary,
} from "./habitat";

declare const Bun: {
  serve(options: {
    fetch: (request: Request) => Response | Promise<Response>;
    hostname: string;
    port: number;
  }): unknown;
};

export type RegistrationView = {
  habitatUuid: string;
  habitatId: string;
  displayName: string;
  apiToken: string;
};

type AppOptions = {
  logger?: (line: string) => void;
  getRegistration?: () => Promise<RegistrationSource | null>;
  registerHabitat?: (name: string) => Promise<RegistrationSource>;
  getRegistrationStatus?: () => Promise<HabitatStatus>;
  getLocalStatusSummary?: typeof getLocalStatusSummary;
  unregisterHabitat?: () => Promise<{ habitatId: string }>;
  listBlueprintCatalog?: () => Promise<{ catalogVersion: string; blueprints: ProductionBlueprint[] }>;
  showBlueprint?: (blueprintId: string) => Promise<ProductionBlueprint>;
  listResourceCatalog?: () => Promise<{ catalogVersion: string; resources: IndustryResource[] }>;
  getSolarIrradiance?: typeof getSolarIrradiance;
  listModules?: () => Promise<HabitatModule[]>;
  showModule?: (id: string) => Promise<HabitatModule>;
  createModule?: (input: { blueprintId: string; name?: string }) => Promise<HabitatModule>;
  updateModule?: (id: string, input: { name?: string; status?: string; health?: number }) => Promise<HabitatModule>;
  deleteModule?: (id: string) => Promise<void>;
  listInventory?: () => Promise<InventoryEntry[]>;
  addInventoryResource?: (resource: string, quantity: number) => Promise<InventoryAddResult>;
  removeInventoryResource?: (resource: string, quantity: number) => Promise<InventoryRemoveResult>;
  tickHabitat?: (count: number) => Promise<TickSummary>;
  dryRunConstruction?: (blueprintId: string) => Promise<ConstructionDryRun>;
  startConstruction?: (blueprintId: string) => Promise<ConstructionStart>;
  listConstructionJobs?: () => Promise<ConstructionJobStatus[]>;
  cancelConstructionJob?: (facilityId: string) => Promise<ConstructionCancelResult>;
};

type RegistrationSource = Pick<LocalRegistration, "habitatUuid" | "habitatId" | "displayName"> & {
  apiToken?: string;
};

export type ServerConfig = {
  host: string;
  port: number;
};

export function getServerConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const port = Number(env.HABITAT_API_PORT || "8787");

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("HABITAT_API_PORT must be an integer between 1 and 65535.");
  }

  return {
    host: env.HABITAT_API_HOST || "0.0.0.0",
    port,
  };
}

async function loadRegistrationView(): Promise<RegistrationSource | null> {
  const registration = await loadLocalRegistration();

  if (!registration) {
    return null;
  }

  const storedRegistration = registration as typeof registration & { apiToken?: unknown };

  return {
    habitatUuid: registration.habitatUuid,
    habitatId: registration.habitatId,
    displayName: registration.displayName,
    apiToken: typeof storedRegistration.apiToken === "string" ? storedRegistration.apiToken : "",
  };
}

export function createApp(options: AppOptions = {}) {
  const log = options.logger ?? console.log;
  const keplerFetch = createKeplerFetchLogger(log);
  const app = new Hono<{ Variables: { logSummary?: string } }>();
  const getRegistration = options.getRegistration ?? loadRegistrationView;
  const register = options.registerHabitat ?? ((name) => registerHabitat(name, { fetchImpl: keplerFetch }));
  const getStatus = options.getRegistrationStatus ?? (() => getRegistrationStatus({ fetchImpl: keplerFetch }));
  const getLocalSummary = options.getLocalStatusSummary ?? getLocalStatusSummary;
  const unregister = options.unregisterHabitat ?? (() => unregisterHabitat({ fetchImpl: keplerFetch }));
  const getBlueprintCatalog = options.listBlueprintCatalog ?? (() => listBlueprintCatalog({ fetchImpl: keplerFetch }));
  const getBlueprint = options.showBlueprint ?? ((blueprintId) => showBlueprint(blueprintId, { fetchImpl: keplerFetch }));
  const getResourceCatalog = options.listResourceCatalog ?? (() => listResourceCatalog({ fetchImpl: keplerFetch }));
  const getSolar = options.getSolarIrradiance ?? (() => getSolarIrradiance({ fetchImpl: keplerFetch }));
  const getModules = options.listModules ?? listModules;
  const getModule = options.showModule ?? showModule;
  const createLocalModule = options.createModule ?? ((input) => createModule(input, { fetchImpl: keplerFetch }));
  const updateLocalModule = options.updateModule ?? updateModule;
  const deleteLocalModule = options.deleteModule ?? deleteModule;
  const getInventory = options.listInventory ?? listInventory;
  const addInventory = options.addInventoryResource ?? addInventoryResource;
  const removeInventory = options.removeInventoryResource ?? removeInventoryResource;
  const advanceTicks = options.tickHabitat ?? ((count) => tickHabitat(count, { fetchImpl: keplerFetch }));
  const dryRun = options.dryRunConstruction ?? ((blueprintId) => dryRunConstruction(blueprintId, { fetchImpl: keplerFetch }));
  const start = options.startConstruction ?? ((blueprintId) => startConstruction(blueprintId, { fetchImpl: keplerFetch }));
  const getConstructionJobs = options.listConstructionJobs ?? listConstructionJobs;
  const cancelConstruction = options.cancelConstructionJob ?? cancelConstructionJob;

  app.use("*", async (context, next) => {
    await next();
    const summary = context.get("logSummary") ?? `HTTP ${context.res.status}`;
    log(`[habitat-api] ${context.req.method} ${new URL(context.req.url).pathname} -> ${summary}`);
  });

  app.onError((error, context) => {
    const message = error instanceof Error ? error.message : "Habitat backend request failed.";
    const status = message.startsWith("Blueprint not found:") ? 404 : 500;
    context.set("logSummary", `error (${status})`);
    return context.json({ error: { message } }, status);
  });

  app.get("/registration", async (context) => {
    const registration = await getRegistration();
    context.set("logSummary", registration ? "registered" : "not registered");
    return context.json({ registration: registration ? toRegistrationView(registration) : null });
  });

  app.post("/registration", async (context) => {
    let body: { displayName?: unknown };

    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: { message: "Request body must be JSON." } }, 400);
    }

    if (typeof body.displayName !== "string" || !body.displayName.trim()) {
      return context.json({ error: { message: "Registration displayName is required." } }, 400);
    }

    const registration = await register(body.displayName);
    context.set("logSummary", "registered habitat");
    return context.json({ registration: toRegistrationView(registration) }, 201);
  });

  app.delete("/registration", async (context) => {
    const result = await unregister();
    context.set("logSummary", "unregistered habitat");
    return context.json({ registration: null, habitatId: result.habitatId });
  });

  app.get("/status", async (context) => {
    const [remoteStatus, localSummary] = await Promise.all([
      getStatus(),
      getLocalSummary(),
    ]);
    context.set("logSummary", `${localSummary.moduleCount} modules`);

    return context.json({
      status: {
        habitat: remoteStatus.habitat,
        ...localSummary,
      },
    });
  });

  app.get("/catalog/blueprints", async (context) => {
    context.set("logSummary", "proxied to Kepler");
    return context.json(await getBlueprintCatalog());
  });
  app.get("/catalog/blueprints/:blueprintId", async (context) => {
    context.set("logSummary", "proxied to Kepler");
    return context.json(await getBlueprint(context.req.param("blueprintId")));
  });
  app.get("/catalog/resources", async (context) => {
    context.set("logSummary", "proxied to Kepler");
    return context.json(await getResourceCatalog());
  });
  app.get("/solar/irradiance", async (context) => {
    context.set("logSummary", "proxied to Kepler");
    return context.json(await getSolar());
  });

  app.get("/modules", async (context) => {
    const modules = await getModules();
    context.set("logSummary", `${modules.length} modules`);
    return context.json({ modules });
  });
  app.get("/modules/:id", async (context) => {
    return context.json({ module: await getModule(context.req.param("id")) });
  });
  app.put("/modules", async (context) => {
    const body = await readJsonBody(context);

    if (typeof body.blueprintId !== "string" || !body.blueprintId.trim()) {
      return context.json({ error: { message: "Module blueprintId is required." } }, 400);
    }

    const module = await createLocalModule({
      blueprintId: body.blueprintId,
      name: typeof body.name === "string" ? body.name : undefined,
    });
    return context.json({ module }, 201);
  });
  app.put("/modules/:id", async (context) => {
    const body = await readJsonBody(context);
    const module = await updateLocalModule(context.req.param("id"), {
      name: typeof body.name === "string" ? body.name : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      health: typeof body.health === "number" ? body.health : undefined,
    });
    return context.json({ module });
  });
  app.delete("/modules/:id", async (context) => {
    const id = context.req.param("id");
    await deleteLocalModule(id);
    return context.json({ moduleId: id });
  });

  app.get("/inventory", async (context) => {
    const inventory = await getInventory();
    context.set("logSummary", `${inventory.length} resource types`);
    return context.json({ inventory });
  });
  app.put("/inventory", async (context) => {
    const body = await readJsonBody(context);

    if (body.operation !== "add" && body.operation !== "remove") {
      return context.json({ error: { message: "Inventory operation must be add or remove." } }, 400);
    }

    if (typeof body.resource !== "string" || !body.resource.trim()) {
      return context.json({ error: { message: "Inventory resource is required." } }, 400);
    }

    if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity) || body.quantity <= 0) {
      return context.json({ error: { message: "Inventory quantity must be a positive number." } }, 400);
    }

    const result = body.operation === "add"
      ? await addInventory(body.resource, body.quantity)
      : await removeInventory(body.resource, body.quantity);
    return context.json({ inventory: result });
  });

  app.get("/power/overview", async (context) => {
    const modules = await getModules();
    context.set("logSummary", `${modules.length} modules`);
    return context.json({ modules });
  });

  app.post("/ticks", async (context) => {
    const body = await readJsonBody(context);
    const count = body.count;

    if (typeof count !== "number" || !Number.isInteger(count) || count <= 0) {
      return context.json({ error: { message: "tick count must be a positive integer" } }, 400);
    }

    const tick = await advanceTicks(count);
    context.set("logSummary", `${count} ticks advanced`);
    return context.json({ tick });
  });

  app.get("/construction", async (context) => {
    const jobs = await getConstructionJobs();
    context.set("logSummary", `${jobs.length} active construction jobs`);
    return context.json({ jobs });
  });
  app.post("/construction", async (context) => {
    const body = await readJsonBody(context);

    if (typeof body.blueprintId !== "string" || !body.blueprintId.trim()) {
      return context.json({ error: { message: "Construction blueprintId is required." } }, 400);
    }

    if (body.dryRun === true) {
      const construction = await dryRun(body.blueprintId);
      context.set("logSummary", "construction dry run");
      return context.json({ construction });
    }

    const construction = await start(body.blueprintId);
    context.set("logSummary", "construction started");
    return context.json({ construction }, 201);
  });
  app.delete("/construction/:facilityId", async (context) => {
    const construction = await cancelConstruction(context.req.param("facilityId"));
    context.set("logSummary", "construction canceled");
    return context.json({ construction });
  });

  return app;
}

function createKeplerFetchLogger(log: (line: string) => void): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const response = await fetch(request);
    log(`[kepler] ${request.method} ${new URL(request.url).pathname} -> ${response.status}`);
    return response;
  };
}

async function readJsonBody(context: { req: { json: <T>() => Promise<T> } }) {
  try {
    return await context.req.json<Record<string, unknown>>();
  } catch {
    throw new Error("Request body must be JSON.");
  }
}

function toRegistrationView(registration: RegistrationSource): RegistrationView {
  return {
    habitatUuid: registration.habitatUuid,
    habitatId: registration.habitatId,
    displayName: registration.displayName,
    apiToken: typeof registration.apiToken === "string" ? registration.apiToken : "",
  };
}

export const app = createApp();

if (import.meta.main) {
  const config = getServerConfig();
  Bun.serve({ fetch: app.fetch, hostname: config.host, port: config.port });
  console.log(`Habitat backend listening on ${config.host}:${config.port}`);
}
