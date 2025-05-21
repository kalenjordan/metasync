const logger = require("../utils/Logger");
;
const BaseMetafieldSyncStrategy = require("./BaseMetafieldSyncStrategy");

class CompanyMetafieldSyncStrategy extends BaseMetafieldSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    // Call the base constructor with the specific ownerType
    super(sourceClient, targetClient, options, "COMPANY");
  }

  // All common methods (fetch, create, update, sync, list) are inherited from BaseMetafieldSyncStrategy
  // Add any COMPANY-specific overrides or methods here if needed in the future.
}

module.exports = CompanyMetafieldSyncStrategy;
