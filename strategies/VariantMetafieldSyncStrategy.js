const BaseMetafieldSyncStrategy = require("./BaseMetafieldSyncStrategy");

class VariantMetafieldSyncStrategy extends BaseMetafieldSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    super(sourceClient, targetClient, options, "PRODUCTVARIANT");
  }
}

module.exports = VariantMetafieldSyncStrategy;
