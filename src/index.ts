#!/usr/bin/env bun

import { Command } from "commander";
import pkg from "../package.json";
import {
  checkLocalConfig,
} from "./habitat";
import { createApiClient, type RegistrationResponse, type StatusResponse, type TickResponse } from "./api-client";
import { createBlueprintCommand } from "./commands/blueprint";
import { createConstructCommand } from "./commands/construct";
import { createConstructionCommand } from "./commands/construction";
import { createInventoryCommand } from "./commands/inventory";
import { createModuleCommand } from "./commands/module";
import { createPowerCommand } from "./commands/power";
import { createResourceCommand } from "./commands/resource";
import { createSolarCommand } from "./commands/solar";
import { formatNumber, parseTickCount, printError } from "./cli-utils";

const program = new Command();
const apiClient = createApiClient();

program
  .name("habitat")
  .description("Register and manage this local Habitat CLI with the Kepler Planet Server.")
  .version(pkg.version)
  .showHelpAfterError("(run `habitat --help` for usage)")
  .addHelpText(
    "after",
    `

Configuration:
  CLI calls the local backend at HABITAT_API_BASE_URL (default: http://localhost:8787).
  The backend reads KEPLER_BASE_URL and KEPLER_PLANET_TOKEN from .env.
  The backend stores local Habitat state in .habitat/habitat.sqlite.

Examples:
  habitat register --name "Artemis Ridge"
  habitat status
  habitat unregister
  habitat config
  habitat solar status
  habitat tick 60
  habitat power overview
  habitat blueprint list
  habitat construct small-solar-array --dry-run
  habitat construction status
  habitat inventory add ferrite 90
  habitat inventory remove ferrite 10
  habitat inventory list
  habitat resource list
  habitat module list`,
  );

program
  .command("config")
  .description("Check local Kepler configuration without contacting Kepler.")
  .action(async () => {
    try {
      const config = await checkLocalConfig();
      console.log(`Base URL: ${config.baseUrl}`);
      console.log(`Token Loaded: ${config.tokenLoaded ? "yes" : "no"}`);
      console.log(`Database File: ${config.databaseFile}`);
    } catch (error) {
      printError(error);
    }
  });

program
  .command("register")
  .description("Register this habitat through the local Habitat backend.")
  .requiredOption("--name <habitat name>", "Habitat display name")
  .action(async (options: { name: string }) => {
    try {
      const response = await apiClient.post<RegistrationResponse>("/registration", {
        displayName: options.name,
      });
      const registration = response.registration;

      if (!registration) {
        throw new Error("Backend registration did not return a registration.");
      }

      console.log(`Registered habitat: ${registration.displayName}`);
      console.log(`Habitat ID: ${registration.habitatId}`);
      console.log("Local state database: .habitat/habitat.sqlite");
    } catch (error) {
      printError(error);
    }
  });

program
  .command("status")
  .description("Show this habitat registration and local state status.")
  .action(async () => {
    try {
      const response = await apiClient.get<StatusResponse>("/status");
      const { habitat, currentTick, moduleCount, powerSummary } = response.status;

      console.log(`Habitat ID: ${habitat.id}`);
      console.log(`Slug: ${habitat.habitatSlug}`);
      console.log(`Name: ${habitat.displayName}`);
      console.log(`Catalog Version: ${habitat.catalogVersion}`);
      console.log(`Status: ${habitat.status}`);
      console.log(`Last Seen: ${habitat.lastSeenAt ?? "never"}`);
      console.log(`Current Tick: ${currentTick}`);
      console.log(`Modules: ${moduleCount}`);
      console.log(`Total Power Draw: ${formatNumber(powerSummary.totalPowerDrawKw)} kW`);
      console.log(
        `Battery Energy: ${formatNumber(powerSummary.batteryEnergyKwh)} / ${formatNumber(powerSummary.batteryCapacityKwh)} kWh`,
      );
    } catch (error) {
      printError(error);
    }
  });

program
  .command("tick")
  .description("Advance the local habitat power simulation by one-second ticks.")
  .argument("<count>", "Positive integer number of one-second ticks", parseTickCount)
  .action(async (count: number) => {
    try {
      const result = (await apiClient.post<TickResponse>("/ticks", { count })).tick;

      console.log(`Ticks Advanced: ${result.ticksAdvanced}`);
      console.log(`Current Tick: ${result.currentTick}`);
      console.log(`Total Power Draw: ${formatNumber(result.totalPowerDrawKw)} kW`);
      console.log(`Energy Used: ${formatNumber(result.energyUsedKwh)} kWh`);
      console.log(
        `Battery Energy: ${formatNumber(result.batteryEnergyKwh)} / ${formatNumber(result.batteryCapacityKwh)} kWh`,
      );
      console.log(`Power Shortage: ${formatNumber(result.powerShortageKwh)} kWh`);
      console.log(`Solar Generated: ${formatNumber(result.solarGeneratedKwh)} kWh`);
      if (result.solarChargedKwh > 0) {
        console.log(`Solar Charged: ${formatNumber(result.solarChargedKwh)} kWh`);
      } else {
        console.log(`Solar Charging: none (${result.solarChargingReason})`);
      }

      if (result.batteryCapacityKwh > 0 && result.batteryEnergyKwh <= 0) {
        console.log("No usable battery energy remains.");
      }

      if (result.completedConstructionJobs.length > 0) {
        console.log("Construction Completed:");

        for (const job of result.completedConstructionJobs) {
          console.log(`${job.blueprintId} -> ${job.outputModuleId}`);
          console.log(`Facility Available: ${job.facilityName}`);
        }
      }
    } catch (error) {
      printError(error);
    }
  });

program
  .command("unregister")
  .description("Unregister this habitat through the backend and remove local SQLite state.")
  .action(async () => {
    try {
      const response = await apiClient.delete<RegistrationResponse>("/registration");
      console.log(`Unregistered habitat: ${response.habitatId ?? response.registration?.habitatId ?? "local habitat"}`);
      console.log("Removed local state database: .habitat/habitat.sqlite");
    } catch (error) {
      printError(error);
    }
  });

program.addCommand(createBlueprintCommand());
program.addCommand(createConstructCommand());
program.addCommand(createConstructionCommand());
program.addCommand(createInventoryCommand());
program.addCommand(createResourceCommand());
program.addCommand(createSolarCommand());
program.addCommand(createModuleCommand());
program.addCommand(createPowerCommand());

program
  .command("* [commandParts...]", { hidden: true })
  .description("Handle unknown commands.")
  .allowUnknownOption(true)
  .action((commandParts: string[]) => {
    const commandName = commandParts.join(" ");
    console.error(`Unknown command: ${commandName}`);
    console.error("Try `habitat --help`.");
    process.exitCode = 1;
  });

await program.parseAsync();
