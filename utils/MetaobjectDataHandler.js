const logger = require("./logger");
const ErrorHandler = require("./ErrorHandler");

// Import GraphQL queries/mutations
const FETCH_METAOBJECTS = require("../graphql/MetaobjectFetch");
const CREATE_METAOBJECT = require("../graphql/MetaobjectCreate");
const UPDATE_METAOBJECT = require("../graphql/MetaobjectUpdate");
const FETCH_METAOBJECT_BY_ID = require("../graphql/MetaobjectFetchById");

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

  /**
   * Fetches a single metaobject by ID
   * @param {Object} client - The Shopify client
   * @param {string} id - The metaobject ID to fetch
   * @returns {Object|null} The metaobject or null if not found
   */
  async fetchMetaobjectById(client, id) {
    try {
      const response = await client.graphql(FETCH_METAOBJECT_BY_ID, { id }, "GetMetaobjectById");
      if (response.metaobject) {
        return response.metaobject;
      }
      return null;
    } catch (error) {
      logger.error(`Error fetching metaobject with ID ${id}: ${error.message}`);
      return null;
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

    // Map to store definition IDs to their types
    const definitionIdToTypeMap = {};

    // Fetch all metaobject definitions first to analyze structure
    const definitionsMap = {};
    for (const definitionType of definitionTypes) {
      const sourceDefinitions = await sourceDefinitionHandler.fetchMetaobjectDefinitions(definitionType);
      if (sourceDefinitions.length > 0) {
        definitionsMap[definitionType] = sourceDefinitions[0];
        // Add to definition ID map
        if (sourceDefinitions[0].id) {
          definitionIdToTypeMap[sourceDefinitions[0].id] = definitionType;
        }
        logger.info(`Fetched definition for type: ${definitionType}`);
      } else {
        logger.warn(`No definition found for type: ${definitionType}`);
      }
    }

    // Build a reference validation map for each field
    const fieldReferenceMap = {};
    for (const [definitionType, definition] of Object.entries(definitionsMap)) {
      if (!definition.fieldDefinitions) continue;

      for (const field of definition.fieldDefinitions) {
        if (field.type.name === "metaobject_reference" || field.type.name === "list.metaobject_reference") {
          // Look for metaobject_definition_id validation
          const refValidation = field.validations?.find(v => v.name === "metaobject_definition_id");
          if (refValidation && refValidation.value) {
            const key = `${definitionType}:${field.key}`;
            fieldReferenceMap[key] = {
              definitionId: refValidation.value,
              refType: definitionIdToTypeMap[refValidation.value] || null
            };

            if (!fieldReferenceMap[key].refType) {
              // If the type wasn't in our initial fetch, we need to fetch it
              try {
                const additionalDefinition = await sourceDefinitionHandler.fetchMetaobjectDefinitionById(refValidation.value);
                if (additionalDefinition) {
                  fieldReferenceMap[key].refType = additionalDefinition.type;
                  definitionIdToTypeMap[refValidation.value] = additionalDefinition.type;
                  // Add to definitions map if not already there
                  if (!definitionsMap[additionalDefinition.type]) {
                    definitionsMap[additionalDefinition.type] = additionalDefinition;
                    logger.info(`Added referenced definition type: ${additionalDefinition.type}`);
                  }
                }
              } catch (error) {
                logger.error(`Error fetching referenced definition ID ${refValidation.value}: ${error.message}`);
              }
            }
          }
        }
      }
    }

    // Also build target map by type+handle for cross-type references
    const targetTypeHandleMap = {};
    for (const targetType of Object.values(definitionIdToTypeMap)) {
      // Skip if already processed
      if (targetTypeHandleMap[targetType]) continue;

      // Only process types for which we have definitions
      if (!definitionsMap[targetType]) {
        logger.info(`Skipping target mapping for type ${targetType} (no definition available)`);
        continue;
      }

      targetTypeHandleMap[targetType] = {};
      const typeObjects = await this.fetchMetaobjects(targetClient, targetType);
      logger.info(`Found ${typeObjects.length} object(s) in target for type ${targetType} for mapping`);
      typeObjects.forEach(obj => {
        if (obj.handle) targetTypeHandleMap[targetType][obj.handle] = obj;
      });
    }

    logger.info(`Built target mapping for ${Object.keys(targetTypeHandleMap).length} types`);

    for (const definitionType of definitionTypes) {
      logger.startSection(`Syncing data for type: ${definitionType}`);

      // Skip if no definition was found
      if (!definitionsMap[definitionType]) {
        logger.warn(`No definition found for type: ${definitionType}, skipping data sync`);
        logger.endSection();
        continue;
      }

      const definition = definitionsMap[definitionType];
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

      // Build target metaobject map by handle
      const targetMetaobjectMap = {};
      targetMetaobjects.forEach(obj => {
        if (obj.handle) targetMetaobjectMap[obj.handle] = obj;
      });

      // Process metaobject reference fields by using the source map
      const processMetaobjectReferenceFields = async (fields, metaobject) => {
        // Create a deep copy of the fields to avoid modifying the original
        const processedFields = JSON.parse(JSON.stringify(fields));

        // Find all reference fields that are metaobject or metaobject list types
        const metaobjectReferenceFields = definition.fieldDefinitions?.filter(field =>
          field.type.name === "metaobject_reference" || field.type.name === "list.metaobject_reference"
        ) || [];

        if (metaobjectReferenceFields.length === 0) {
          return processedFields;
        }

        // Process each metaobject reference field
        for (const referenceField of metaobjectReferenceFields) {
          const fieldKey = referenceField.key;
          const field = processedFields.find(f => f.key === fieldKey);

          if (!field || !field.value) continue;

          // Get reference type from our validation map
          const refMapKey = `${definitionType}:${fieldKey}`;
          const referenceTypeInfo = fieldReferenceMap[refMapKey];

          if (!referenceTypeInfo || !referenceTypeInfo.refType) {
            logger.warn(`Cannot determine reference type for field ${fieldKey} in ${metaobject.handle || "unknown"}`);
            continue;
          }

          const refType = referenceTypeInfo.refType;
          logger.startSection(`Processing ${fieldKey} as reference to type ${refType}`);

          if (referenceField.type.name === "metaobject_reference") {
            // Handle single metaobject reference
            const sourceId = field.value;

            // Fetch the metaobject by ID
            const sourceMetaobject = await this.fetchMetaobjectById(sourceClient, sourceId);

            if (!sourceMetaobject) {
              logger.warn(`Cannot find source metaobject with ID ${sourceId} for reference field ${fieldKey} in ${metaobject.handle || "unknown"}`);
              field.value = "";
              continue;
            }

            const referenceHandle = sourceMetaobject.handle;

            if (!referenceHandle) {
              logger.warn(`Missing handle for source metaobject with ID ${sourceId}`);
              field.value = "";
              continue;
            }

            // Look up target metaobject by type and handle
            if (targetTypeHandleMap[refType] && targetTypeHandleMap[refType][referenceHandle]) {
              field.value = targetTypeHandleMap[refType][referenceHandle].id;
              logger.info(`Mapped reference ${referenceHandle} (${refType}) to target ID ${field.value}`);
            } else {
              logger.warn(`Cannot find target metaobject with handle "${referenceHandle}" (type: ${refType}) for field ${fieldKey} in ${metaobject.handle || "unknown"}`);
              field.value = ""; // Clear the value
            }
          } else if (referenceField.type.name === "list.metaobject_reference") {
            // Handle metaobject list reference
            try {
              const sourceIds = JSON.parse(field.value);
              if (!Array.isArray(sourceIds)) {
                logger.warn(`Invalid format for metaobject list field ${fieldKey} in ${metaobject.handle || "unknown"}: ${field.value}`);
                field.value = "[]";
                continue;
              }

              const targetIds = [];

              for (const sourceId of sourceIds) {
                // Fetch the metaobject by ID
                const sourceMetaobject = await this.fetchMetaobjectById(sourceClient, sourceId);

                if (!sourceMetaobject) {
                  logger.warn(`Cannot find source metaobject with ID ${sourceId} for list reference field ${fieldKey} in ${metaobject.handle || "unknown"}`);
                  continue;
                }

                const referenceHandle = sourceMetaobject.handle;

                if (!referenceHandle) {
                  logger.warn(`Missing handle for reference in ${metaobject.handle || "unknown"}`);
                  continue;
                }

                // Look up target metaobject by type and handle using our ref type from validations
                if (targetTypeHandleMap[refType] && targetTypeHandleMap[refType][referenceHandle]) {
                  targetIds.push(targetTypeHandleMap[refType][referenceHandle].id);
                  logger.info(`Mapped list reference ${referenceHandle} (${refType}) to target ID ${targetTypeHandleMap[refType][referenceHandle].id}`);
                } else {
                  logger.warn(`Cannot find target metaobject with handle "${referenceHandle}" (type: ${refType}) for list field ${fieldKey} in ${metaobject.handle || "unknown"}`);
                }
              }

              field.value = JSON.stringify(targetIds);
            } catch (error) {
              logger.error(`Error processing metaobject list field ${fieldKey} in ${metaobject.handle || "unknown"}: ${error.message}`);
              field.value = "[]";
            }
          }

          logger.endSection();
        }

        return processedFields;
      };

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

        // Clone the metaobject
        const processedMetaobject = { ...metaobject, fields: [] };

        if (this.debug && Object.keys(requiredFields).length > 0) {
          logger.debug(`Metaobject ${metaobject.handle || "unknown"} required fields: ${Object.keys(requiredFields).join(", ")}`);
        }

        // Add missing required fields
        Object.entries(requiredFields).forEach(([key, fieldInfo]) => {
          if (!existingFieldMap[key] || existingFieldMap[key].value === null || existingFieldMap[key].value === undefined) {
            logger.warn(`Adding missing required field '${fieldInfo.name}' (${key}) to metaobject ${metaobject.handle || "unknown"}`);
            let defaultValue = "";
            // Simplified default value logic
            if (fieldInfo.type === "boolean") defaultValue = "false";
            else if (fieldInfo.type.includes("number")) defaultValue = "0";
            else if (fieldInfo.type === "date") defaultValue = new Date().toISOString().split("T")[0];
            else if (fieldInfo.type === "datetime") defaultValue = new Date().toISOString();
            existingFieldMap[key] = { key, value: defaultValue };
          }
        });

        // Process metaobject reference fields to map IDs from source to target
        processedMetaobject.fields = await processMetaobjectReferenceFields(
          Object.values(existingFieldMap),
          metaobject
        );

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
