const logger = require("../utils/Logger");
const BaseMetafieldSyncStrategy = require("./BaseMetafieldSyncStrategy");

class OrderMetafieldSyncStrategy extends BaseMetafieldSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    super(sourceClient, targetClient, options, "ORDER");
  }
}

module.exports = OrderMetafieldSyncStrategy;
