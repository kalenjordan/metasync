const logger = require("../utils/logger");
const ErrorHandler = require('../utils/ErrorHandler');
const MetaobjectDefinitionHandler = require('../utils/MetaobjectDefinitionHandler');
// Import GraphQL queries/mutations
const {
  FETCH_METAOBJECTS,
  CREATE_METAOBJECT,
  UPDATE_METAOBJECT
} = require('../graphql/metaobject');

class MetaobjectSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.debug = options.debug;

    // Create definition handlers
    this.definitionHandler = new MetaobjectDefinitionHandler(targetClient, options);
  }

  // --- Metaobject Data Methods ---

  async fetchMetaobjects(client, type) {
    try {
        const response = await client.graphql(FETCH_METAOBJECTS, { type }, 'GetMetaobjects');
        return response.metaobjects.edges.map(edge => edge.node);
    } catch (error) {
        logger.error(`Error fetching metaobjects for type ${type}: ${error.message}`);
        return [];
    }
  }

  async createMetaobject(client, metaobject, definitionType) {
    const fields = metaobject.fields
        .filter(field => field.value !== null && field.value !== undefined)
        .map(field => ({ key: field.key, value: field.value || "" }));

    const input = { type: definitionType, fields, capabilities: metaobject.capabilities || {} };
    if (metaobject.handle) input.handle = metaobject.handle;

    if (this.options.notADrill) {
      logger.startSection(`Creating metaobject: ${input.handle || 'unknown'}`);
      logger.info(`Creating with ${fields.length} fields`);
      try {
        const result = await client.graphql(CREATE_METAOBJECT, { metaobject: input }, 'CreateMetaobject');
        if (result.metaobjectCreate.userErrors.length > 0) {
          // Use the ErrorHandler for consistent error handling
          const getFieldDetails = (field, index, errorPath) => {
            // Format the value for display
            let valuePreview = field.value ? String(field.value) : '';
            if (valuePreview.length > 50) {
              valuePreview = valuePreview.substring(0, 47) + '...';
            }

            return {
              itemName: `Field ${field.key}`,
              valuePreview: valuePreview
            };
          };

          ErrorHandler.handleGraphQLUserErrors(
            result.metaobjectCreate.userErrors,
            fields,
            getFieldDetails,
            `metaobject ${metaobject.handle || 'unknown'}`
          );

          logger.endSection();
          return null;
        }
        logger.success(`Successfully created metaobject ${input.handle || 'unknown'}`);
        logger.endSection();
        return result.metaobjectCreate.metaobject;
      } catch (error) {
        logger.error(`Error creating metaobject ${metaobject.handle || 'unknown'}: ${error.message}`);
        logger.endSection();
        return null;
      }
    } else {
      logger.info(`[DRY RUN] Would create metaobject ${metaobject.handle || 'unknown'} with ${fields.length} fields`);
      return { id: "dry-run-id", handle: metaobject.handle || "dry-run-handle" };
    }
  }

  async updateMetaobject(client, metaobject, existingMetaobject) {
    const fields = metaobject.fields
        .filter(field => field.value !== null && field.value !== undefined)
        .map(field => ({ key: field.key, value: field.value || "" }));

    const input = { fields };

    if (this.options.notADrill) {
       logger.startSection(`Updating metaobject: ${metaobject.handle || 'unknown'}`);
       try {
            const result = await client.graphql(UPDATE_METAOBJECT, { id: existingMetaobject.id, metaobject: input }, 'UpdateMetaobject');
            if (result.metaobjectUpdate.userErrors.length > 0) {
                // Use the ErrorHandler for consistent error handling
                const getFieldDetails = (field, index, errorPath) => {
                  // Format the value for display
                  let valuePreview = field.value ? String(field.value) : '';
                  if (valuePreview.length > 50) {
                    valuePreview = valuePreview.substring(0, 47) + '...';
                  }

                  return {
                    itemName: `Field ${field.key}`,
                    valuePreview: valuePreview
                  };
                };

                ErrorHandler.handleGraphQLUserErrors(
                  result.metaobjectUpdate.userErrors,
                  fields,
                  getFieldDetails,
                  `metaobject ${metaobject.handle || 'unknown'}`
                );

                logger.endSection();
                return null;
            }
            logger.success(`Successfully updated metaobject ${metaobject.handle || 'unknown'}`);
            logger.endSection();
            return result.metaobjectUpdate.metaobject;
       } catch (error) {
            logger.error(`Error updating metaobject ${metaobject.handle || 'unknown'}: ${error.message}`);
            logger.endSection();
            return null;
       }
    } else {
      logger.info(`[DRY RUN] Would update metaobject ${metaobject.handle || 'unknown'}`);
      return { id: existingMetaobject.id, handle: metaobject.handle || existingMetaobject.handle };
    }
  }

  // --- Sync Orchestration Methods ---

  async syncDataOnly(definitionTypes) {
    logger.startSection("Syncing metaobject data");
    const results = { created: 0, updated: 0, skipped: 0, failed: 0 };

    for (const definitionType of definitionTypes) {
        logger.startSection(`Syncing data for type: ${definitionType}`);
        // Create temporary source handler to fetch definitions from source
        const sourceHandler = new MetaobjectDefinitionHandler(this.sourceClient, this.options);
        const sourceDefinitions = await sourceHandler.fetchMetaobjectDefinitions(definitionType);
        if (sourceDefinitions.length === 0) {
            logger.warn(`No definition found for type: ${definitionType}, skipping data sync`);
            logger.endSection();
            continue;
        }
        const definition = sourceDefinitions[0];
        const requiredFields = definition.fieldDefinitions?.filter(f => f.required).reduce((map, f) => {
            map[f.key] = { name: f.name, type: sourceHandler.getFieldTypeName(f) };
            return map;
        }, {}) || {};

        const sourceMetaobjects = await this.fetchMetaobjects(this.sourceClient, definitionType);
        logger.info(`Found ${sourceMetaobjects.length} object(s) in source for type ${definitionType}`);
        const targetMetaobjects = await this.fetchMetaobjects(this.targetClient, definitionType);
        logger.info(`Found ${targetMetaobjects.length} object(s) in target for type ${definitionType}`);
        const targetMetaobjectMap = targetMetaobjects.reduce((map, obj) => { if(obj.handle) map[obj.handle] = obj; return map; }, {});

        let processedCount = 0;
        for (const metaobject of sourceMetaobjects) {
            if (processedCount >= this.options.limit) {
                logger.info(`Reached data processing limit (${this.options.limit}) for type ${definitionType}.`);
                break;
            }
            const existingFieldMap = metaobject.fields.reduce((map, f) => { map[f.key] = f; return map; }, {});
            const processedMetaobject = { ...metaobject, fields: [...metaobject.fields] }; // Clone

            if (this.debug && Object.keys(requiredFields).length > 0) {
                logger.debug(`Metaobject ${metaobject.handle || 'unknown'} required fields: ${Object.keys(requiredFields).join(', ')}`);
            }
            Object.entries(requiredFields).forEach(([key, fieldInfo]) => {
                if (!existingFieldMap[key] || existingFieldMap[key].value === null || existingFieldMap[key].value === undefined) {
                    logger.warn(`Adding missing required field '${fieldInfo.name}' (${key}) to metaobject ${metaobject.handle || 'unknown'}`);
                    let defaultValue = "";
                    // Simplified default value logic
                    if (fieldInfo.type === "boolean") defaultValue = "false";
                    else if (fieldInfo.type.includes("number")) defaultValue = "0";
                    else if (fieldInfo.type === "date") defaultValue = new Date().toISOString().split('T')[0];
                    else if (fieldInfo.type === "datetime") defaultValue = new Date().toISOString();
                    processedMetaobject.fields.push({ key, value: defaultValue });
                }
            });

            try {
                if (metaobject.handle && targetMetaobjectMap[metaobject.handle]) {
                    await this.updateMetaobject(this.targetClient, processedMetaobject, targetMetaobjectMap[metaobject.handle]);
                    results.updated++;
                } else {
                    await this.createMetaobject(this.targetClient, processedMetaobject, definitionType);
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

  async sync() {
    // Handle listing definitions if key is missing
    if (!this.options.key) {
      await this.definitionHandler.listAvailableDefinitions(this.sourceClient);
      return { definitionResults: null, dataResults: null }; // Indicate no sync occurred
    }

    // Special case: "--type all" should fetch all definitions
    const shouldFetchAllTypes = this.options.key === 'all';

    // Determine what to sync based on command/strategy type
    const isSyncingDefinitions = this.options.command === 'definitions';
    const isSyncingData = this.options.command === 'data';

    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let dataResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let definitionTypes = [];

    // Sync definitions if requested by command
    if (isSyncingDefinitions) {
      // If syncing all types, pass null to fetch all definitions
      const fetchType = shouldFetchAllTypes ? null : this.options.key;
      const defSync = await this.definitionHandler.syncDefinitions(this.sourceClient, fetchType);
      definitionResults = defSync.results;
      definitionTypes = defSync.definitionTypes;
    } else if (isSyncingData) {
      // If only syncing data, use the provided key as the type
      // For "all", we need to fetch all available types first
      if (shouldFetchAllTypes) {
        // Create temporary source handler to fetch all definitions
        const tempSourceHandler = new MetaobjectDefinitionHandler(this.sourceClient, this.options);
        const allDefinitions = await tempSourceHandler.fetchMetaobjectDefinitions();
        definitionTypes = allDefinitions.map(def => def.type);
        logger.info(`Found ${definitionTypes.length} definition types to sync data for`);
      } else {
        definitionTypes = [this.options.key];
      }

      // Sync data
      if (definitionTypes.length > 0) {
        dataResults = await this.syncDataOnly(definitionTypes);
      }
    } else {
      // Default: sync both definitions and data
      // If syncing all types, pass null to fetch all definitions
      const fetchType = shouldFetchAllTypes ? null : this.options.key;
      const defSync = await this.definitionHandler.syncDefinitions(this.sourceClient, fetchType);
      definitionResults = defSync.results;
      definitionTypes = defSync.definitionTypes;

      if (definitionTypes.length > 0) {
        dataResults = await this.syncDataOnly(definitionTypes);
      }
    }

    return { definitionResults, dataResults };
  }
}

module.exports = MetaobjectSyncStrategy;
