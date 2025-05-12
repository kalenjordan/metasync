const logger = require("../utils/logger");
const ErrorHandler = require('../utils/ErrorHandler');
// Import GraphQL queries/mutations
const {
  FETCH_METAOBJECT_DEFINITIONS,
  FETCH_ALL_METAOBJECT_DEFINITIONS,
  FETCH_METAOBJECTS,
  CREATE_METAOBJECT_DEFINITION,
  UPDATE_METAOBJECT_DEFINITION,
  CREATE_METAOBJECT,
  UPDATE_METAOBJECT
} = require('../graphql/metaobject');

class MetaobjectSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.debug = options.debug;
  }

  // --- Metaobject Definition Methods ---

  async fetchMetaobjectDefinitions(client, type = null) {
    let definitions = [];
    try {
        if (type) {
            // Fetch specific type
            const response = await client.graphql(FETCH_METAOBJECT_DEFINITIONS, { type }, 'FetchMetaobjectDefinitions');
            definitions = response.metaobjectDefinitions.nodes.filter(def => def.type === type);
        } else {
            // Fetch all types
            const response = await client.graphql(FETCH_ALL_METAOBJECT_DEFINITIONS, undefined, 'FetchAllMetaobjectDefinitions');
            definitions = response.metaobjectDefinitions.nodes;
        }
    } catch (error) {
        logger.error(`Error fetching metaobject definitions (type: ${type || 'all'}): ${error.message}`);
        definitions = []; // Return empty on error
    }

    return definitions;
  }

  /**
   * Extract field type name from a field definition
   */
  getFieldTypeName(field) {
    if (typeof field.type === 'string') {
      return field.type;
    }
    if (field.type && field.type.name) {
      return field.type.name;
    }
    return 'single_line_text_field';
  }

  /**
   * Processes a field definition for the API.
   */
  processFieldDefinition(field) {
    const typeName = this.getFieldTypeName(field);
    const fieldDef = {
      key: field.key,
      name: field.name,
      description: field.description || "",
      required: field.required,
      type: typeName,
      validations: field.validations || []
    };
    // Add special validations based on type (original logic)
    if (typeName === "metaobject_reference" && field.type?.supportedTypes) {
        fieldDef.validations.push({ name: "metaobject_definition", value: JSON.stringify({ types: field.type.supportedTypes }) });
    }
    if (typeName === "rating" && field.type?.outOfRange) {
        fieldDef.validations.push({ name: "range", value: JSON.stringify({ min: "0", max: field.type.outOfRange }) });
    }
    if (typeName === "list" && field.type?.validationRules?.allowedValues) {
        fieldDef.validations.push({ name: "allowed_values", value: JSON.stringify(field.type.validationRules.allowedValues) });
    }
    return fieldDef;
  }

  async createMetaobjectDefinition(client, definition) {
    const input = {
      type: definition.type,
      name: definition.name,
      description: definition.description || "",
      fieldDefinitions: definition.fieldDefinitions.map(field => this.processFieldDefinition(field)),
      capabilities: definition.capabilities || {},
    };

    if (this.options.notADrill) {
      logger.startSection(`Creating metaobject definition: ${definition.type}`);
      try {
          const result = await client.graphql(CREATE_METAOBJECT_DEFINITION, { definition: input }, 'CreateMetaobjectDefinition');
          if (result.metaobjectDefinitionCreate.userErrors.length > 0) {
            // Use the ErrorHandler for consistent error handling
            const getFieldDefDetails = (fieldDef, index, errorPath) => {
              return {
                itemName: `Definition field ${fieldDef.key}`,
                valuePreview: null // Field definitions don't have a simple value to preview
              };
            };

            ErrorHandler.handleGraphQLUserErrors(
              result.metaobjectDefinitionCreate.userErrors,
              input.fieldDefinitions,
              getFieldDefDetails,
              `metaobject definition ${definition.type}`
            );

            logger.endSection();
            return null;
          }
          logger.success(`Successfully created definition ${definition.type}`);
          logger.endSection();
          return result.metaobjectDefinitionCreate.metaobjectDefinition;
      } catch (error) {
          logger.error(`Error creating metaobject definition ${definition.type}: ${error.message}`);
          logger.endSection();
          return null;
      }
    } else {
      logger.info(`[DRY RUN] Would create metaobject definition ${definition.type}`);
      return { id: "dry-run-id", type: definition.type };
    }
  }

  async updateMetaobjectDefinition(client, definition, existingDefinition) {
    const existingFieldMap = existingDefinition.fieldDefinitions?.reduce((map, field) => {
      map[field.key] = field;
      return map;
    }, {}) || {};

    const fieldDefinitions = definition.fieldDefinitions.map(field => {
      const fieldDef = this.processFieldDefinition(field);
      return existingFieldMap[field.key]
        ? { update: { key: fieldDef.key, name: fieldDef.name, description: fieldDef.description, required: fieldDef.required, validations: fieldDef.validations } }
        : { create: { key: fieldDef.key, type: fieldDef.type, name: fieldDef.name, description: fieldDef.description, required: fieldDef.required, validations: fieldDef.validations } };
    });

    const input = {
      name: definition.name,
      description: definition.description || "",
      fieldDefinitions,
      capabilities: definition.capabilities || {},
    };

    if (this.options.notADrill) {
      logger.startSection(`Updating metaobject definition: ${definition.type}`);
      try {
          const result = await client.graphql(UPDATE_METAOBJECT_DEFINITION, { id: existingDefinition.id, definition: input }, 'UpdateMetaobjectDefinition');
          if (result.metaobjectDefinitionUpdate.userErrors.length > 0) {
            // Use the ErrorHandler for consistent error handling
            const getFieldDefDetails = (fieldDef, index, errorPath) => {
              return {
                itemName: `Definition field ${fieldDef.key}`,
                valuePreview: null // Field definitions don't have a simple value to preview
              };
            };

            ErrorHandler.handleGraphQLUserErrors(
              result.metaobjectDefinitionUpdate.userErrors,
              input.fieldDefinitions,
              getFieldDefDetails,
              `metaobject definition ${definition.type}`
            );

            logger.endSection();
            return null;
          }
          logger.success(`Successfully updated definition ${definition.type}`);
          logger.endSection();
          return result.metaobjectDefinitionUpdate.metaobjectDefinition;
      } catch (error) {
          logger.error(`Error updating metaobject definition ${definition.type}: ${error.message}`);
          logger.endSection();
          return null;
      }
    } else {
      logger.info(`[DRY RUN] Would update metaobject definition ${definition.type}`);
      return { id: existingDefinition.id, type: definition.type };
    }
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

  async syncDefinitionsOnly(typeToSync = this.options.key) {
    logger.startSection("Syncing metaobject definitions");
    const sourceDefinitions = await this.fetchMetaobjectDefinitions(this.sourceClient, typeToSync);

    if (sourceDefinitions.length === 0) {
      logger.warn(typeToSync ? `No metaobject definitions found in source for type: ${typeToSync}` : `No metaobject definitions found in source.`);
      logger.endSection();
      return { results: { created: 0, updated: 0, skipped: 0, failed: 0 }, definitionTypes: [] };
    }
    logger.info(`Found ${sourceDefinitions.length} definition(s) in source${typeToSync ? ` for type: ${typeToSync}` : ''}`);

    const targetDefinitions = await this.fetchMetaobjectDefinitions(this.targetClient);
    logger.info(`Found ${targetDefinitions.length} definition(s) in target`);
    const targetDefinitionMap = targetDefinitions.reduce((map, def) => { map[def.type] = def; return map; }, {});

    const results = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let processedCount = 0;

    for (const definition of sourceDefinitions) {
      if (processedCount >= this.options.limit) {
        logger.info(`Reached processing limit (${this.options.limit}). Stopping definition sync.`);
        break;
      }
      if (targetDefinitionMap[definition.type]) {
        const updated = await this.updateMetaobjectDefinition(this.targetClient, definition, targetDefinitionMap[definition.type]);
        updated ? results.updated++ : results.failed++;
      } else {
        const created = await this.createMetaobjectDefinition(this.targetClient, definition);
        created ? results.created++ : results.failed++;
      }
      processedCount++;
    }
    logger.success("Finished syncing metaobject definitions");
    logger.endSection();
    return { results, definitionTypes: sourceDefinitions.map(def => def.type) };
  }

  async syncDataOnly(definitionTypes) {
    logger.startSection("Syncing metaobject data");
    const results = { created: 0, updated: 0, skipped: 0, failed: 0 };

    for (const definitionType of definitionTypes) {
        logger.startSection(`Syncing data for type: ${definitionType}`);
        const sourceDefinitions = await this.fetchMetaobjectDefinitions(this.sourceClient, definitionType);
        if (sourceDefinitions.length === 0) {
            logger.warn(`No definition found for type: ${definitionType}, skipping data sync`);
            logger.endSection();
            continue;
        }
        const definition = sourceDefinitions[0];
        const requiredFields = definition.fieldDefinitions?.filter(f => f.required).reduce((map, f) => {
            map[f.key] = { name: f.name, type: this.getFieldTypeName(f) };
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

  async listAvailableDefinitions() {
      logger.info(`No specific metaobject type specified (--key). Fetching available types...`);
      const definitions = await this.fetchMetaobjectDefinitions(this.sourceClient);
      if (definitions.length === 0) {
          logger.warn(`No metaobject definitions found in source shop.`);
          return;
      }

      // Use a blank line with info method instead of \n escape character
      logger.info(``);
      logger.info(`Available metaobject definition types:`);

      // Increase indentation level before listing types
      logger.indent();

      definitions.forEach(def => {
          // Using 'main' type for info to get the bullet point
          logger.info(`${def.type} (${def.name || "No name"})`, 0, 'main');
      });

      // Add a blank line after the list
      logger.info(``);

      // Reset indentation before the final message
      logger.unindent();

      logger.info(`Please run the command again with --key <type> to specify which metaobject type to sync.`);
  }

  async sync() {
    // Handle listing definitions if key is missing
    if (!this.options.key) {
      await this.listAvailableDefinitions();
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
      const defSync = await this.syncDefinitionsOnly(fetchType);
      definitionResults = defSync.results;
      definitionTypes = defSync.definitionTypes;
    } else if (isSyncingData) {
      // If only syncing data, use the provided key as the type
      // For "all", we need to fetch all available types first
      if (shouldFetchAllTypes) {
        const allDefinitions = await this.fetchMetaobjectDefinitions(this.sourceClient);
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
      const defSync = await this.syncDefinitionsOnly(fetchType);
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
