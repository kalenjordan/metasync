const logger = require("../utils/logger");
;
const ErrorHandler = require('../utils/ErrorHandler');

class MetaobjectSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    this.sourceClient = sourceClient;
    this.targetClient = targetClient;
    this.options = options;
    this.debug = options.debug;
  }

  // --- Metaobject Definition Methods ---

  async fetchMetaobjectDefinitions(client, type = null) {
    const query = `#graphql
      query FetchMetaobjectDefinitions($type: String) {
        metaobjectDefinitions(first: 100, filter: {type: $type}) {
          nodes {
            id
            type
            name
            description
            fieldDefinitions {
              key
              name
              description
              required
              type {
                name
              }
              validations {
                name
                value
              }
            }
            capabilities {
              publishable {
                enabled
              }
            }
            access {
              admin
              storefront
            }
          }
        }
      }
    `;
    // Note: The filter argument might need adjustment depending on API version
    // and whether we are fetching ALL definitions (type=null)
    // The original query didn't use a filter when type was null.
    // Let's adjust to match original logic more closely.

    const fetchAllQuery = `#graphql
      query FetchAllMetaobjectDefinitions {
        metaobjectDefinitions(first: 100) {
          nodes {
            id
            type
            name
            description
            fieldDefinitions {
              key
              name
              description
              required
              type {
                name
              }
              validations {
                name
                value
              }
            }
            capabilities {
              publishable {
                enabled
              }
            }
            access {
              admin
              storefront
            }
          }
        }
      }
    `;

    let definitions = [];
    try {
        if (type) {
            // Fetch specific type - Re-check schema if filter works like this
            // Original code fetched all then filtered, which is safer / more compatible.
            // Let's stick to fetch all then filter for now.
            const response = await client.graphql(fetchAllQuery, undefined, 'FetchAllMetaobjectDefinitions');
            definitions = response.metaobjectDefinitions.nodes.filter(def => def.type === type);
        } else {
            // Fetch all types
            const response = await client.graphql(fetchAllQuery, undefined, 'FetchAllMetaobjectDefinitions');
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
    const mutation = `#graphql
      mutation createMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
        metaobjectDefinitionCreate(definition: $definition) {
          metaobjectDefinition { id type }
          userErrors { field message code }
        }
      }
    `;
    if (this.options.notADrill) {
      try {
          const result = await client.graphql(mutation, { definition: input }, 'CreateMetaobjectDefinition');
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

            return null;
          }
          return result.metaobjectDefinitionCreate.metaobjectDefinition;
      } catch (error) {
          logger.error(`Error creating metaobject definition ${definition.type}: ${error.message}`);
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

    const mutation = `#graphql
      mutation updateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
        metaobjectDefinitionUpdate(id: $id, definition: $definition) {
          metaobjectDefinition { id type }
          userErrors { field message code }
        }
      }
    `;

    if (this.options.notADrill) {
      try {
          const result = await client.graphql(mutation, { id: existingDefinition.id, definition: input }, 'UpdateMetaobjectDefinition');
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

            return null;
          }
          return result.metaobjectDefinitionUpdate.metaobjectDefinition;
      } catch (error) {
          logger.error(`Error updating metaobject definition ${definition.type}: ${error.message}`);
          return null;
      }
    } else {
      logger.info(`[DRY RUN] Would update metaobject definition ${definition.type}`);
      return { id: existingDefinition.id, type: definition.type };
    }
  }

  // --- Metaobject Data Methods ---

  async fetchMetaobjects(client, type) {
    const query = `#graphql
      query GetMetaobjects($type: String!) {
        metaobjects(type: $type, first: 100) {
          edges {
            node {
              id handle type displayName
              fields { key value type reference { ... on MediaImage { image { url } } ... on Metaobject { handle } } }
              capabilities { publishable { status } }
            }
          }
        }
      }
    `;
    // Simplified query fields for brevity, adjust as needed
    try {
        const response = await client.graphql(query, { type }, 'GetMetaobjects');
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

    const mutation = `#graphql
      mutation createMetaobject($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id handle }
          userErrors { field message code }
        }
      }
    `;

    if (this.options.notADrill) {
      logger.info(`Creating metaobject: ${input.handle || 'unknown'} with ${fields.length} fields`);
      try {
        const result = await client.graphql(mutation, { metaobject: input }, 'CreateMetaobject');
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

          return null;
        }
        return result.metaobjectCreate.metaobject;
      } catch (error) {
        logger.error(`Error creating metaobject ${metaobject.handle || 'unknown'}: ${error.message}`);
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

    const mutation = `#graphql
      mutation updateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject { id handle }
          userErrors { field message code }
        }
      }
    `;

    if (this.options.notADrill) {
       logger.info(`Updating metaobject: ${metaobject.handle || 'unknown'}`);
       try {
            const result = await client.graphql(mutation, { id: existingMetaobject.id, metaobject: input }, 'UpdateMetaobject');
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

                return null;
            }
            return result.metaobjectUpdate.metaobject;
       } catch (error) {
            logger.error(`Error updating metaobject ${metaobject.handle || 'unknown'}: ${error.message}`);
            return null;
       }
    } else {
      logger.info(`[DRY RUN] Would update metaobject ${metaobject.handle || 'unknown'}`);
      return { id: existingMetaobject.id, handle: metaobject.handle || existingMetaobject.handle };
    }
  }

  // --- Sync Orchestration Methods ---

  async syncDefinitionsOnly() {
    logger.info("Syncing metaobject definitions...");
    const sourceDefinitions = await this.fetchMetaobjectDefinitions(this.sourceClient, this.options.key);

    if (sourceDefinitions.length === 0) {
      logger.warn(this.options.key ? `No metaobject definitions found in source for type: ${this.options.key}` : `No metaobject definitions found in source.`);
      return { results: { created: 0, updated: 0, skipped: 0, failed: 0 }, definitionTypes: [] };
    }
    logger.info(`Found ${sourceDefinitions.length} definition(s) in source${this.options.key ? ` for type: ${this.options.key}` : ''}`);

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
        logger.info(`Updating metaobject definition: ${definition.type}`);
        const updated = await this.updateMetaobjectDefinition(this.targetClient, definition, targetDefinitionMap[definition.type]);
        updated ? results.updated++ : results.failed++;
      } else {
        logger.info(`Creating metaobject definition: ${definition.type}`);
        const created = await this.createMetaobjectDefinition(this.targetClient, definition);
        created ? results.created++ : results.failed++;
      }
      processedCount++;
    }
    logger.success("Finished syncing metaobject definitions.");
    return { results, definitionTypes: sourceDefinitions.map(def => def.type) };
  }

  async syncDataOnly(definitionTypes) {
      logger.info("Syncing metaobject data...");
      const results = { created: 0, updated: 0, skipped: 0, failed: 0 };

      for (const definitionType of definitionTypes) {
          logger.info(`Syncing data for type: ${definitionType}`);
          const sourceDefinitions = await this.fetchMetaobjectDefinitions(this.sourceClient, definitionType);
          if (sourceDefinitions.length === 0) {
              logger.warn(`No definition found for type: ${definitionType}, skipping data sync`);
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
      }
      logger.success("Finished syncing metaobject data.");
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

    let definitionResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let dataResults = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let definitionTypes = [];

    // Sync definitions if needed
    if (!this.options.dataOnly) {
      const defSync = await this.syncDefinitionsOnly();
      definitionResults = defSync.results;
      definitionTypes = defSync.definitionTypes;
    } else {
      // If only syncing data, use the provided key as the type
      definitionTypes = [this.options.key];
    }

    // Sync data if needed
    if (!this.options.definitionsOnly && definitionTypes.length > 0) {
      dataResults = await this.syncDataOnly(definitionTypes);
    }

    return { definitionResults, dataResults };
  }
}

module.exports = MetaobjectSyncStrategy;
