const logger = require("./logger");
const ErrorHandler = require("./ErrorHandler");
// Import GraphQL queries/mutations
const FETCH_ALL_METAOBJECT_DEFINITIONS = require("../graphql/MetaobjectFetchAllDefinitions.graphql");
const CREATE_METAOBJECT_DEFINITION = require("../graphql/MetaobjectCreateDefinition.graphql");
const UPDATE_METAOBJECT_DEFINITION = require("../graphql/MetaobjectUpdateDefinition.graphql");
const FETCH_METAOBJECT_DEFINITION_BY_ID = require("../graphql/MetaobjectFetchDefinitionById.graphql");

class MetaobjectDefinitionHandler {
  constructor(client, options = {}) {
    this.client = client;
    this.options = options;
    this.debug = options.debug;
    this.definitionTypesMap = null;
  }

  async fetchMetaobjectDefinitions(type = null) {
    let definitions = [];
    try {
      // Always fetch all types and filter in code
      const response = await this.client.graphql(FETCH_ALL_METAOBJECT_DEFINITIONS, undefined, "FetchAllMetaobjectDefinitions");
      definitions = response.metaobjectDefinitions.nodes;

      // Filter in code if a specific type is requested
      if (type) {
        definitions = definitions.filter((def) => def.type === type);
      }
    } catch (error) {
      logger.error(`Error fetching metaobject definitions (type: ${type || "all"}): ${error.message}`);
      definitions = []; // Return empty on error
    }

    return definitions;
  }

  /**
   * Fetches a metaobject definition by its ID
   * @param {string} id The metaobject definition ID
   * @returns {Object|null} The metaobject definition or null if not found
   */
  async fetchMetaobjectDefinitionById(id) {
    if (!id) {
      logger.error("No definition ID provided to fetchMetaobjectDefinitionById");
      return null;
    }

    try {
      const response = await this.client.graphql(FETCH_METAOBJECT_DEFINITION_BY_ID, { id }, "FetchMetaobjectDefinitionById");
      if (response.metaobjectDefinition) {
        logger.info(`Successfully fetched definition for ID: ${id} (type: ${response.metaobjectDefinition.type})`);
        return response.metaobjectDefinition;
      } else {
        logger.warn(`No definition found for ID: ${id}`);
        return null;
      }
    } catch (error) {
      logger.error(`Error fetching metaobject definition by ID ${id}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract field type name from a field definition
   */
  getFieldTypeName(field) {
    if (typeof field.type === "string") {
      return field.type;
    }
    if (field.type && field.type.name) {
      return field.type.name;
    }
    return "single_line_text_field";
  }

  /**
   * Finds a definition ID in the target store by type
   */
  async getDefinitionIdByType(type) {
    if (!type) {
      return null;
    }

    const definitions = await this.fetchMetaobjectDefinitions(type);

    if (definitions.length === 0) {
      logger.warn(`No definitions found for type: ${type}`);
      return null;
    }

    return definitions[0].id;
  }

  /**
   * Processes a field definition for the API.
   */
  async processFieldDefinition(field, sourceDefinitionTypes = null) {
    const typeName = this.getFieldTypeName(field);
    const fieldDef = {
      key: field.key,
      name: field.name,
      description: field.description || "",
      required: field.required,
      type: typeName,
      validations: field.validations ? [...field.validations] : [],
    };

    // Add special validations based on type
    if (typeName === "metaobject_reference" && field.type?.supportedTypes) {
      fieldDef.validations.push({ name: "metaobject_definition", value: JSON.stringify({ types: field.type.supportedTypes }) });
    }
    if (typeName === "rating" && field.type?.outOfRange) {
      fieldDef.validations.push({ name: "range", value: JSON.stringify({ min: "0", max: field.type.outOfRange }) });
    }
    if (typeName === "list" && field.type?.validationRules?.allowedValues) {
      fieldDef.validations.push({ name: "allowed_values", value: JSON.stringify(field.type.validationRules.allowedValues) });
    }

    // Handle metaobject_definition_id validations by looking up target store's definition ID
    if (fieldDef.validations && fieldDef.validations.length > 0) {
      for (let i = 0; i < fieldDef.validations.length; i++) {
        const validation = fieldDef.validations[i];

        if (validation.name === "metaobject_definition_id") {
          const sourceDefinitionId = validation.value;

          // Look up type in the source definitions map
          if (sourceDefinitionTypes && sourceDefinitionTypes[sourceDefinitionId]) {
            const definitionType = sourceDefinitionTypes[sourceDefinitionId];
            const targetDefinitionId = await this.getDefinitionIdByType(definitionType);

            if (targetDefinitionId) {
              fieldDef.validations[i].value = targetDefinitionId;
            } else {
              logger.error(`Cannot create metaobject_definition_id validation: No definition of type '${definitionType}' found in target store`);
              logger.error(`The definition '${definitionType}' must be synced to the target store first`);
            }
          } else {
            logger.error(`Cannot resolve metaobject_definition_id validation in field '${field.key}'`);
            logger.error(`Referenced definition ID '${sourceDefinitionId}' not found in source store`);
            logger.error(`This may be a reference to a definition outside the current source store`);
          }
        }
      }
    }

    return fieldDef;
  }

  async createMetaobjectDefinition(definition, sourceDefinitionTypes = null) {
    const fieldDefinitions = await Promise.all(definition.fieldDefinitions.map((field) => this.processFieldDefinition(field, sourceDefinitionTypes)));

    const input = {
      type: definition.type,
      name: definition.name,
      description: definition.description || "",
      fieldDefinitions,
      capabilities: definition.capabilities || {},
    };

    if (this.options.notADrill) {
      logger.startSection(`Creating metaobject definition: ${definition.type}`);
      try {
        const result = await this.client.graphql(CREATE_METAOBJECT_DEFINITION, { definition: input }, "CreateMetaobjectDefinition");
        if (result.metaobjectDefinitionCreate.userErrors.length > 0) {
          const getFieldDefDetails = (fieldDef, index, errorPath) => {
            return {
              itemName: `Definition field ${fieldDef.key}`,
              valuePreview: null, // Field definitions don't have a simple value to preview
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

  async updateMetaobjectDefinition(definition, existingDefinition, sourceDefinitionTypes = null) {
    const existingFieldMap =
      existingDefinition.fieldDefinitions?.reduce((map, field) => {
        map[field.key] = field;
        return map;
      }, {}) || {};

    const fieldDefinitionsPromises = definition.fieldDefinitions.map(async (field) => {
      const fieldDef = await this.processFieldDefinition(field, sourceDefinitionTypes);
      return existingFieldMap[field.key]
        ? {
            update: {
              key: fieldDef.key,
              name: fieldDef.name,
              description: fieldDef.description,
              required: fieldDef.required,
              validations: fieldDef.validations,
            },
          }
        : {
            create: {
              key: fieldDef.key,
              type: fieldDef.type,
              name: fieldDef.name,
              description: fieldDef.description,
              required: fieldDef.required,
              validations: fieldDef.validations,
            },
          };
    });

    const fieldDefinitions = await Promise.all(fieldDefinitionsPromises);

    const input = {
      name: definition.name,
      description: definition.description || "",
      fieldDefinitions,
      capabilities: definition.capabilities || {},
    };

    if (this.options.notADrill) {
      logger.startSection(`Updating metaobject definition: ${definition.type}`);
      try {
        const result = await this.client.graphql(
          UPDATE_METAOBJECT_DEFINITION,
          { id: existingDefinition.id, definition: input },
          "UpdateMetaobjectDefinition"
        );
        if (result.metaobjectDefinitionUpdate.userErrors.length > 0) {
          const getFieldDefDetails = (fieldDef, index, errorPath) => {
            return {
              itemName: `Definition field ${fieldDef.key}`,
              valuePreview: null, // Field definitions don't have a simple value to preview
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

  async syncDefinitions(sourceClient, typeToSync = null) {
    logger.startSection("Syncing metaobject definitions");

    // Create a temporary handler for the source client
    const sourceHandler = new MetaobjectDefinitionHandler(sourceClient, this.options);

    // First fetch all definitions from source to build a complete map
    const allSourceDefinitions = await sourceHandler.fetchMetaobjectDefinitions();
    logger.info(`Found ${allSourceDefinitions.length} total definition(s) in source store`);

    // Create a complete map of definition IDs to types from all source definitions
    const sourceDefinitionTypesMap = allSourceDefinitions.reduce((map, def) => {
      map[def.id] = def.type;
      return map;
    }, {});

    // Now get only the definitions we want to sync
    let sourceDefinitions = allSourceDefinitions;
    if (typeToSync) {
      sourceDefinitions = sourceDefinitions.filter((def) => def.type === typeToSync);
      logger.info(`Processing ${sourceDefinitions.length} definition(s) of type: ${typeToSync}`);
    }

    if (sourceDefinitions.length === 0) {
      logger.warn(typeToSync ? `No metaobject definitions found in source for type: ${typeToSync}` : `No metaobject definitions found in source.`);
      logger.endSection();
      return { results: { created: 0, updated: 0, skipped: 0, failed: 0 }, definitionTypes: [] };
    }

    // Check for metaobject_definition_id validations that reference definitions we don't have
    for (const def of sourceDefinitions) {
      if (def.fieldDefinitions) {
        for (const field of def.fieldDefinitions) {
          if (field.validations) {
            for (const validation of field.validations) {
              if (validation.name === "metaobject_definition_id" && !sourceDefinitionTypesMap[validation.value]) {
                logger.warn(`Definition ${def.type} field ${field.key} references unknown definition ID: ${validation.value}`);
              }
            }
          }
        }
      }
    }

    const targetDefinitions = await this.fetchMetaobjectDefinitions();
    logger.info(`Found ${targetDefinitions.length} definition(s) in target store`);

    // Create a map of types to definitions in target store
    const targetDefinitionTypeMap = targetDefinitions.reduce((map, def) => {
      map[def.type] = def;
      return map;
    }, {});

    const results = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let processedCount = 0;

    for (const definition of sourceDefinitions) {
      if (processedCount >= this.options.limit) {
        logger.info(`Reached processing limit (${this.options.limit}). Stopping definition sync.`);
        break;
      }
      if (targetDefinitionTypeMap[definition.type]) {
        const updated = await this.updateMetaobjectDefinition(definition, targetDefinitionTypeMap[definition.type], sourceDefinitionTypesMap);
        updated ? results.updated++ : results.failed++;
      } else {
        const created = await this.createMetaobjectDefinition(definition, sourceDefinitionTypesMap);
        created ? results.created++ : results.failed++;
      }
      processedCount++;
    }
    logger.success("Finished syncing metaobject definitions");
    logger.endSection();
    return { results, definitionTypes: sourceDefinitions.map((def) => def.type) };
  }

  async listAvailableDefinitions(sourceClient) {
    logger.info(`No specific metaobject type specified (--type). Fetching available types...`);

    // Create a temporary handler for the source client
    const sourceHandler = new MetaobjectDefinitionHandler(sourceClient, this.options);
    const definitions = await sourceHandler.fetchMetaobjectDefinitions();

    if (definitions.length === 0) {
      logger.warn(`No metaobject definitions found in source shop.`);
      return;
    }

    logger.info(``);
    logger.info(`Available metaobject definition types:`);

    logger.indent();

    definitions.forEach((def) => {
      logger.info(`${def.type} (${def.name || "No name"})`, 0, "main");
    });

    logger.info(``);
    logger.unindent();

    logger.info(`Please run the command again with --type <type> to specify which metaobject type to sync.`);
  }
}

module.exports = MetaobjectDefinitionHandler;
