const logger = require("./logger");
// Import strategy classes
const MetaobjectSyncStrategy = require('../strategies/MetaobjectSyncStrategy');
const ProductMetafieldSyncStrategy = require('../strategies/ProductMetafieldSyncStrategy');
const CompanyMetafieldSyncStrategy = require('../strategies/CompanyMetafieldSyncStrategy');
const OrderMetafieldSyncStrategy = require('../strategies/OrderMetafieldSyncStrategy');
const VariantMetafieldSyncStrategy = require('../strategies/VariantMetafieldSyncStrategy');
const CustomerMetafieldSyncStrategy = require('../strategies/CustomerMetafieldSyncStrategy');
const CollectionMetafieldSyncStrategy = require('../strategies/CollectionMetafieldSyncStrategy');
const PageSyncStrategy = require('../strategies/PageSyncStrategy');
const ProductSyncStrategy = require('../strategies/ProductSyncStrategy');
const CollectionSyncStrategy = require('../strategies/CollectionSyncStrategy');
const AllResourcesSyncStrategy = require('../strategies/AllResourcesSyncStrategy');
const EverythingSyncStrategy = require('../strategies/EverythingSyncStrategy');

// Definition strategies mapping
const definitionStrategies = {
  products: ProductMetafieldSyncStrategy,
  companies: CompanyMetafieldSyncStrategy,
  orders: OrderMetafieldSyncStrategy,
  variants: VariantMetafieldSyncStrategy,
  customers: CustomerMetafieldSyncStrategy,
  collections: CollectionMetafieldSyncStrategy,
  metaobjects: MetaobjectSyncStrategy,

};

// Data strategies mapping
const dataStrategies = {
  products: ProductSyncStrategy,
  pages: PageSyncStrategy,
  collections: CollectionSyncStrategy,
  metaobjects: MetaobjectSyncStrategy,
  all: AllResourcesSyncStrategy
  // Add other data strategies as they're implemented
};

/**
 * Get the appropriate definition strategy for a resource
 * @param {string} resource - The resource type
 * @returns {Object|null} - The strategy class or null if not found
 */
function getDefinitionStrategyForResource(resource) {
  return definitionStrategies[resource] || null;
}

/**
 * Get the appropriate data strategy for a resource
 * @param {string} resource - The resource type
 * @returns {Object|null} - The strategy class or null if not found
 */
function getDataStrategyForResource(resource) {
  return dataStrategies[resource] || null;
}

/**
 * Get the strategy for the "everything" command
 * @returns {Object} - The EverythingSyncStrategy class
 */
function getEverythingStrategy() {
  return EverythingSyncStrategy;
}

module.exports = {
  getDefinitionStrategyForResource,
  getDataStrategyForResource,
  getEverythingStrategy
};
