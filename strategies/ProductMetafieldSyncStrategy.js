const logger = require("../utils/logger");
const BaseMetafieldSyncStrategy = require("./BaseMetafieldSyncStrategy");

class ProductMetafieldSyncStrategy extends BaseMetafieldSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    // Call the base constructor with the specific ownerType
    super(sourceClient, targetClient, options, "PRODUCT");
  }

  // All common methods (fetch, create, update, sync, list) are inherited from BaseMetafieldSyncStrategy
  // Add any PRODUCT-specific overrides or methods here if needed in the future.
}

module.exports = ProductMetafieldSyncStrategy;
