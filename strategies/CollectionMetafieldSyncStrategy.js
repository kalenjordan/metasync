const BaseMetafieldSyncStrategy = require('./BaseMetafieldSyncStrategy');

class CollectionMetafieldSyncStrategy extends BaseMetafieldSyncStrategy {
  constructor(sourceClient, targetClient, options) {
    super(sourceClient, targetClient, options, 'COLLECTION');
  }
}

module.exports = CollectionMetafieldSyncStrategy;
