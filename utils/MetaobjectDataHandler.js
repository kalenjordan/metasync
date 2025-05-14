const logger = require("./logger");
const ErrorHandler = require("./ErrorHandler");

// Import GraphQL queries/mutations
const FETCH_METAOBJECTS = require("../graphql/MetaobjectFetch");
const CREATE_METAOBJECT = require("../graphql/MetaobjectCreate");
const UPDATE_METAOBJECT = require("../graphql/MetaobjectUpdate");

class MetaobjectDataHandler {
  constructor(client, options) {
    this.client = client;
    this.options = options;
    this.debug = options.debug;
  }

  async fetchMetaobjects(client, type) {
    try {
      const response = await client.graphql(FETCH_METAOBJECTS, { type }, "GetMetaobjects");
      return response.metaobjects.edges.map((edge) => edge.node);
    } catch (error) {
      logger.error(`Error fetching metaobjects for type ${type}: ${error.message}`);
      return [];
    }
  }

  async createMetaobject(client, metaobject, definitionType) {
    const fields = metaobject.fields
      .filter((field) => field.value !== null && field.value !== undefined)
      .map((field) => ({ key: field.key, value: field.value || "" }));

    const input = { type: definitionType, fields, capabilities: metaobject.capabilities || {} };
    if (metaobject.handle) input.handle = metaobject.handle;

    if (this.options.notADrill) {
      logger.startSection(`Creating metaobject: ${input.handle || "unknown"}`);
      logger.info(`Creating with ${fields.length} fields`);
      try {
        const result = await client.graphql(CREATE_METAOBJECT, { metaobject: input }, "CreateMetaobject");
        if (result.metaobjectCreate.userErrors.length > 0) {
          // Use the ErrorHandler for consistent error handling
          const getFieldDetails = (field, index, errorPath) => {
            // Format the value for display
            let valuePreview = field.value ? String(field.value) : "";
            if (valuePreview.length > 50) {
              valuePreview = valuePreview.substring(0, 47) + "...";
            }

            return {
              itemName: `Field ${field.key}`,
              valuePreview: valuePreview,
            };
          };

          ErrorHandler.handleGraphQLUserErrors(
            result.metaobjectCreate.userErrors,
            fields,
            getFieldDetails,
            `metaobject ${metaobject.handle || "unknown"}`
          );

          logger.endSection();
          return null;
        }
        logger.success(`Successfully created metaobject ${input.handle || "unknown"}`);
        logger.endSection();
        return result.metaobjectCreate.metaobject;
      } catch (error) {
        logger.error(`Error creating metaobject ${metaobject.handle || "unknown"}: ${error.message}`);
        logger.endSection();
        return null;
      }
    } else {
      logger.info(`[DRY RUN] Would create metaobject ${metaobject.handle || "unknown"} with ${fields.length} fields`);
      return { id: "dry-run-id", handle: metaobject.handle || "dry-run-handle" };
    }
  }

  async updateMetaobject(client, metaobject, existingMetaobject) {
    const fields = metaobject.fields
      .filter((field) => field.value !== null && field.value !== undefined)
      .map((field) => ({ key: field.key, value: field.value || "" }));

    const input = { fields };

    if (this.options.notADrill) {
      logger.startSection(`Updating metaobject: ${metaobject.handle || "unknown"}`);
      try {
        const result = await client.graphql(UPDATE_METAOBJECT, { id: existingMetaobject.id, metaobject: input }, "UpdateMetaobject");
        if (result.metaobjectUpdate.userErrors.length > 0) {
          // Use the ErrorHandler for consistent error handling
          const getFieldDetails = (field, index, errorPath) => {
            // Format the value for display
            let valuePreview = field.value ? String(field.value) : "";
            if (valuePreview.length > 50) {
              valuePreview = valuePreview.substring(0, 47) + "...";
            }

            return {
              itemName: `Field ${field.key}`,
              valuePreview: valuePreview,
            };
          };

          ErrorHandler.handleGraphQLUserErrors(
            result.metaobjectUpdate.userErrors,
            fields,
            getFieldDetails,
            `metaobject ${metaobject.handle || "unknown"}`
          );

          logger.endSection();
          return null;
        }
        logger.success(`Successfully updated metaobject ${metaobject.handle || "unknown"}`);
        logger.endSection();
        return result.metaobjectUpdate.metaobject;
      } catch (error) {
        logger.error(`Error updating metaobject ${metaobject.handle || "unknown"}: ${error.message}`);
        logger.endSection();
        return null;
      }
    } else {
      logger.info(`[DRY RUN] Would update metaobject ${metaobject.handle || "unknown"}`);
      return { id: existingMetaobject.id, handle: metaobject.handle || existingMetaobject.handle };
    }
  }

  async syncData(sourceClient, targetClient, definitionTypes, sourceDefinitionHandler) {
    logger.startSection("Syncing metaobject data");
    const results = { created: 0, updated: 0, skipped: 0, failed: 0 };

    for (const definitionType of definitionTypes) {
      logger.startSection(`Syncing data for type: ${definitionType}`);
      // Fetch definitions from source
      const sourceDefinitions = await sourceDefinitionHandler.fetchMetaobjectDefinitions(definitionType);
      if (sourceDefinitions.length === 0) {
        logger.warn(`No definition found for type: ${definitionType}, skipping data sync`);
        logger.endSection();
        continue;
      }
      const definition = sourceDefinitions[0];
      const requiredFields =
        definition.fieldDefinitions
          ?.filter((f) => f.required)
          .reduce((map, f) => {
            map[f.key] = { name: f.name, type: sourceDefinitionHandler.getFieldTypeName(f) };
            return map;
          }, {}) || {};

      const sourceMetaobjects = await this.fetchMetaobjects(sourceClient, definitionType);
      logger.info(`Found ${sourceMetaobjects.length} object(s) in source for type ${definitionType}`);

      // Filter by handle if specified
      let filteredMetaobjects = sourceMetaobjects;
      if (this.options.handle) {
        const originalCount = filteredMetaobjects.length;
        filteredMetaobjects = filteredMetaobjects.filter((obj) => obj.handle === this.options.handle);
        const filteredCount = originalCount - filteredMetaobjects.length;
        if (filteredCount > 0) {
          logger.info(`Filtered to ${filteredMetaobjects.length} object(s) with handle '${this.options.handle}'`);
          results.skipped += filteredCount;
        }
      }

      const targetMetaobjects = await this.fetchMetaobjects(targetClient, definitionType);
      logger.info(`Found ${targetMetaobjects.length} object(s) in target for type ${definitionType}`);
      const targetMetaobjectMap = targetMetaobjects.reduce((map, obj) => {
        if (obj.handle) map[obj.handle] = obj;
        return map;
      }, {});

      let processedCount = 0;
      for (const metaobject of filteredMetaobjects) {
        if (processedCount >= this.options.limit) {
          logger.info(`Reached data processing limit (${this.options.limit}) for type ${definitionType}.`);
          break;
        }
        const existingFieldMap = metaobject.fields.reduce((map, f) => {
          map[f.key] = f;
          return map;
        }, {});
        const processedMetaobject = { ...metaobject, fields: [...metaobject.fields] }; // Clone

        if (this.debug && Object.keys(requiredFields).length > 0) {
          logger.debug(`Metaobject ${metaobject.handle || "unknown"} required fields: ${Object.keys(requiredFields).join(", ")}`);
        }
        Object.entries(requiredFields).forEach(([key, fieldInfo]) => {
          if (!existingFieldMap[key] || existingFieldMap[key].value === null || existingFieldMap[key].value === undefined) {
            logger.warn(`Adding missing required field '${fieldInfo.name}' (${key}) to metaobject ${metaobject.handle || "unknown"}`);
            let defaultValue = "";
            // Simplified default value logic
            if (fieldInfo.type === "boolean") defaultValue = "false";
            else if (fieldInfo.type.includes("number")) defaultValue = "0";
            else if (fieldInfo.type === "date") defaultValue = new Date().toISOString().split("T")[0];
            else if (fieldInfo.type === "datetime") defaultValue = new Date().toISOString();
            processedMetaobject.fields.push({ key, value: defaultValue });
          }
        });

        try {
          if (metaobject.handle && targetMetaobjectMap[metaobject.handle]) {
            await this.updateMetaobject(targetClient, processedMetaobject, targetMetaobjectMap[metaobject.handle]);
            results.updated++;
          } else {
            await this.createMetaobject(targetClient, processedMetaobject, definitionType);
            results.created++;
          }
        } catch (error) {
          // Errors are logged within create/update methods, just count failure here
          results.failed++;
        }
        processedCount++;
      }
      logger.success(`Finished syncing data for type: ${definitionType}`);
      logger.endSection();
    }
    logger.success("Finished syncing metaobject data");
    logger.endSection();
    return results;
  }
}

module.exports = MetaobjectDataHandler;
