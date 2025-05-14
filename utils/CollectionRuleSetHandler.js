const logger = require('./logger');

/**
 * Utility class to handle collection rulesets
 */
class CollectionRuleSetHandler {
  constructor(targetMetafieldDefinitions) {
    this.targetMetafieldDefinitions = targetMetafieldDefinitions;
  }

  /**
   * Set the target metafield definitions
   * @param {Object} targetMetafieldDefinitions - Metafield definitions from target shop
   */
  setTargetMetafieldDefinitions(targetMetafieldDefinitions) {
    this.targetMetafieldDefinitions = targetMetafieldDefinitions;
  }

  /**
   * Analyzes a collection's ruleset and logs detailed information
   * @param {Object} collection - The collection to analyze
   */
  analyzeRuleSet(collection) {
    if (!collection.ruleSet || !collection.ruleSet.rules) {
      logger.info('No ruleset found for this collection');
      return null;
    }

    // Log the whole ruleSet for debugging
    logger.info(`Collection ruleSet details:`);
    logger.indent();
    logger.info(`Rules count: ${collection.ruleSet.rules.length}`);
    logger.info(`Applied disjunctively: ${collection.ruleSet.appliedDisjunctively}`);

    // Log metafield conditions for debugging (both METAFIELD and PRODUCT_METAFIELD_DEFINITION)
    const metafieldConditions = collection.ruleSet.rules.filter(rule =>
      rule.column === 'METAFIELD' || rule.column === 'PRODUCT_METAFIELD_DEFINITION'
    );

    if (metafieldConditions.length > 0) {
      logger.info(`Collection has ${metafieldConditions.length} metafield conditions in its rule set`);
      logger.indent();

      // Check if conditionObject is present for any rules
      const hasConditionObject = metafieldConditions.some(rule => rule.conditionObject);
      if (!hasConditionObject) {
        logger.error(`None of the metafield rules have conditionObject. This may indicate a GraphQL query issue.`);
        throw new Error(`Metafield rules missing conditionObject in collection ${collection.title}`);
      }

      // Log each metafield condition for diagnosis purposes only
      metafieldConditions.forEach((rule, index) => {
        logger.info(`Rule ${index + 1}: ${rule.column}`);
        logger.indent();

        if (!rule.conditionObject) {
          logger.error(`Metafield rule ${index + 1} is missing conditionObject`);
          throw new Error(`Metafield rule missing conditionObject in collection ${collection.title}`);
        }

        if (!rule.conditionObject.metafieldDefinition) {
          logger.error(`Metafield rule ${index + 1} is missing metafieldDefinition`);
          throw new Error(`Metafield rule missing metafieldDefinition in collection ${collection.title}`);
        }

        const def = rule.conditionObject.metafieldDefinition;
        if (!def.ownerType) {
          logger.error(`Metafield condition ${index + 1} is missing ownerType - cannot process rule`);
          throw new Error(`Metafield condition is missing ownerType in rule set for collection ${collection.title}`);
        }

        logger.info(`Namespace: ${def.namespace}`);
        logger.info(`Key: ${def.key}`);
        logger.info(`Owner type: ${def.ownerType}`);
        logger.info(`Relation: ${rule.relation}`);
        logger.info(`Condition: ${rule.condition}`);

        // Find matching definitions by namespace and key (NOT by ID)
        if (!this.targetMetafieldDefinitions[def.ownerType]) {
          logger.error(`No metafield definitions found for owner type: ${def.ownerType}`);
          throw new Error(`No metafield definitions found for owner type: ${def.ownerType} in collection ${collection.title}`);
        }

        const matchingDef = this.targetMetafieldDefinitions[def.ownerType].find(targetDef =>
          targetDef.namespace === def.namespace && targetDef.key === def.key
        );

        if (matchingDef) {
          logger.info(`✓ Found matching definition in target shop: ${matchingDef.id}`);
        } else {
          logger.error(`✗ No matching definition found for ${def.namespace}.${def.key} with ownerType=${def.ownerType}`);
        }

        logger.unindent();
      });

      logger.unindent();
    }

    logger.unindent();
    return metafieldConditions.length > 0;
  }

  /**
   * Prepares a collection's ruleset for input to Shopify API
   * @param {Object} collection - The collection containing the ruleset
   * @returns {Object} The prepared ruleset input
   */
  prepareRuleSetInput(collection) {
    if (!collection.ruleSet || !collection.ruleSet.rules) {
      return null;
    }

    // Create a clean copy of the rules with necessary fields including conditionObjectId for metafield rules
    const cleanRules = collection.ruleSet.rules.map(rule => {
      const baseRule = {
        column: rule.column,
        condition: rule.condition,
        relation: rule.relation
      };

      // Handle both METAFIELD and PRODUCT_METAFIELD_DEFINITION columns
      if (rule.column === 'METAFIELD' || rule.column === 'PRODUCT_METAFIELD_DEFINITION') {
        if (!rule.conditionObject || !rule.conditionObject.metafieldDefinition) {
          logger.error(`Metafield rule missing required conditionObject with metafieldDefinition`);
          throw new Error(`Metafield rule missing required data in collection ${collection.title}`);
        }

        const def = rule.conditionObject.metafieldDefinition;
        if (!def.ownerType) {
          logger.error(`Missing ownerType in metafield definition for rule with namespace=${def.namespace}, key=${def.key}`);
          throw new Error(`Missing ownerType in metafield definition for collection ${collection.title}`);
        }

        // Find matching definition by namespace and key (NOT by ID) in target shop
        if (!this.targetMetafieldDefinitions[def.ownerType]) {
          logger.error(`No metafield definitions found for owner type: ${def.ownerType}`);
          throw new Error(`No metafield definitions found for owner type: ${def.ownerType} in collection ${collection.title}`);
        }

        const matchingDef = this.targetMetafieldDefinitions[def.ownerType].find(targetDef =>
          targetDef.namespace === def.namespace && targetDef.key === def.key
        );

        if (matchingDef) {
          // Include the conditionObjectId which is required for metafield rules
          logger.info(`Adding conditionObjectId: ${matchingDef.id} for ${rule.column} rule ${def.namespace}.${def.key}`);
          baseRule.conditionObjectId = matchingDef.id;
        } else {
          logger.error(`Cannot create ${rule.column} rule for ${def.namespace}.${def.key}: No matching definition found in target shop`);
        }
      }

      return baseRule;
    });

    // Add ruleSet to input with updated rules
    return {
      appliedDisjunctively: collection.ruleSet.appliedDisjunctively,
      rules: cleanRules
    };
  }

  /**
   * Logs detailed information about metafield rules in a collection
   * @param {Object} collection - The collection containing the rules
   */
  logMetafieldRules(collection) {
    if (!collection.ruleSet || !collection.ruleSet.rules) {
      return;
    }

    const metafieldRules = collection.ruleSet.rules.filter(rule =>
      rule.column === 'METAFIELD' || rule.column === 'PRODUCT_METAFIELD_DEFINITION'
    );

    if (metafieldRules.length > 0) {
      logger.info(`Smart collection uses ${metafieldRules.length} metafield conditions in its rules`);
      logger.indent();

      for (const rule of metafieldRules) {
        if (!rule.conditionObject || !rule.conditionObject.metafieldDefinition) {
          logger.error(`Metafield rule missing required conditionObject with metafieldDefinition`);
          throw new Error(`Metafield rule missing required data in collection ${collection.title}`);
        }

        const def = rule.conditionObject.metafieldDefinition;
        if (!def.ownerType) {
          logger.error(`Missing ownerType in metafield definition`);
          throw new Error(`Missing ownerType in metafield definition for collection ${collection.title}`);
        }

        logger.info(`Metafield rule: ${def.namespace}.${def.key}`);
        logger.indent();
        logger.info(`Owner type: ${def.ownerType}`);
        logger.info(`Relation: ${rule.relation}`);
        logger.info(`Condition: ${rule.condition}`);

        // These would use a special CollectionRuleMetafieldCondition type in Shopify GraphQL
        logger.info(`⚠ This collection uses metafield conditions which may require specific metafield definitions`);
        logger.info(`  with the MetafieldCapabilitySmartCollectionCondition capability for owner type: ${def.ownerType}`);
        logger.unindent();
      }

      logger.unindent();
    }
  }

  /**
   * Logs error information for metafield rules in the collection
   * @param {Object} collection - The collection with error details
   */
  logRuleErrors(collection) {
    if (!collection.ruleSet || !collection.ruleSet.rules) {
      return;
    }

    const metafieldRules = collection.ruleSet.rules.filter(rule =>
      rule.column === 'METAFIELD' || rule.column === 'PRODUCT_METAFIELD_DEFINITION'
    );

    if (metafieldRules.length > 0) {
      logger.error(`Smart collection uses metafield rules:`);
      logger.indent();

      metafieldRules.forEach((rule, index) => {
        if (rule.conditionObject && rule.conditionObject.metafieldDefinition) {
          const def = rule.conditionObject.metafieldDefinition;
          const ownerType = def.ownerType || 'UNKNOWN';
          logger.error(`Rule ${index + 1}: ${def.namespace}.${def.key}, ownerType=${ownerType}`);
          logger.error(`  Relation: ${rule.relation}, Condition: ${rule.condition}`);
        } else {
          logger.error(`Rule ${index + 1}: Missing metafieldDefinition`);
        }
      });

      logger.error(`⚠ IMPORTANT: This appears to be a smart collection with metafield conditions.`);
      logger.error(`You need to create metafield definitions with the following properties:`);
      logger.error(`1. Namespace and key matching what's in the rules`);
      logger.error(`2. Owner type matching what's in the rules (usually PRODUCT)`);
      logger.error(`3. The MetafieldCapabilitySmartCollectionCondition capability`);
      logger.error(`You can do this in Shopify Admin: Settings > Custom data > Product properties`);

      logger.unindent();
    }
  }
}

module.exports = CollectionRuleSetHandler;
