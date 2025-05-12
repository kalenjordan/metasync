const logger = require("./logger");
const ErrorHandler = require('./ErrorHandler');
// Import GraphQL queries/mutations
const {
  FETCH_METAOBJECT_DEFINITIONS,
  FETCH_ALL_METAOBJECT_DEFINITIONS,
  CREATE_METAOBJECT_DEFINITION,
  UPDATE_METAOBJECT_DEFINITION
} = require('../graphql/metaobject');

class MetaobjectDefinitionHandler {
  constructor(client, options = {}) {
    this.client = client;
    this.options = options;
    this.debug = options.debug;
  }

  async fetchMetaobjectDefinitions(type = null) {
    let definitions = [];
    try {
        // Always fetch all types and filter in code
        const response = await this.client.graphql(FETCH_ALL_METAOBJECT_DEFINITIONS, undefined, 'FetchAllMetaobjectDefinitions');
        definitions = response.metaobjectDefinitions.nodes;

        // Filter in code if a specific type is requested
        if (type) {
            definitions = definitions.filter(def => def.type === type);
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
    return fieldDef;
  }

  async createMetaobjectDefinition(definition) {
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
          const result = await this.client.graphql(CREATE_METAOBJECT_DEFINITION, { definition: input }, 'CreateMetaobjectDefinition');
          if (result.metaobjectDefinitionCreate.userErrors.length > 0) {
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

  async updateMetaobjectDefinition(definition, existingDefinition) {
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
          const result = await this.client.graphql(UPDATE_METAOBJECT_DEFINITION, { id: existingDefinition.id, definition: input }, 'UpdateMetaobjectDefinition');
          if (result.metaobjectDefinitionUpdate.userErrors.length > 0) {
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

  async syncDefinitions(sourceClient, typeToSync = null) {
    logger.startSection("Syncing metaobject definitions");

    // Create a temporary handler for the source client
    const sourceHandler = new MetaobjectDefinitionHandler(sourceClient, this.options);
    const sourceDefinitions = await sourceHandler.fetchMetaobjectDefinitions(typeToSync);

    if (sourceDefinitions.length === 0) {
      logger.warn(typeToSync ? `No metaobject definitions found in source for type: ${typeToSync}` : `No metaobject definitions found in source.`);
      logger.endSection();
      return { results: { created: 0, updated: 0, skipped: 0, failed: 0 }, definitionTypes: [] };
    }
    logger.info(`Found ${sourceDefinitions.length} definition(s) in source${typeToSync ? ` for type: ${typeToSync}` : ''}`);

    const targetDefinitions = await this.fetchMetaobjectDefinitions();
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
        const updated = await this.updateMetaobjectDefinition(definition, targetDefinitionMap[definition.type]);
        updated ? results.updated++ : results.failed++;
      } else {
        const created = await this.createMetaobjectDefinition(definition);
        created ? results.created++ : results.failed++;
      }
      processedCount++;
    }
    logger.success("Finished syncing metaobject definitions");
    logger.endSection();
    return { results, definitionTypes: sourceDefinitions.map(def => def.type) };
  }

  async listAvailableDefinitions(sourceClient) {
      logger.info(`No specific metaobject type specified (--key). Fetching available types...`);

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

      definitions.forEach(def => {
          logger.info(`${def.type} (${def.name || "No name"})`, 0, 'main');
      });

      logger.info(``);
      logger.unindent();

      logger.info(`Please run the command again with --key <type> to specify which metaobject type to sync.`);
  }
}

module.exports = MetaobjectDefinitionHandler;
