// Import strategy classes
const MetaobjectSyncStrategy = require('../strategies/MetaobjectSyncStrategy');
const ProductMetafieldSyncStrategy = require('../strategies/ProductMetafieldSyncStrategy');
const CompanyMetafieldSyncStrategy = require('../strategies/CompanyMetafieldSyncStrategy');
const OrderMetafieldSyncStrategy = require('../strategies/OrderMetafieldSyncStrategy');
const VariantMetafieldSyncStrategy = require('../strategies/VariantMetafieldSyncStrategy');
const CustomerMetafieldSyncStrategy = require('../strategies/CustomerMetafieldSyncStrategy');
const PageSyncStrategy = require('../strategies/PageSyncStrategy');
const ProductSyncStrategy = require('../strategies/ProductSyncStrategy');

// Definition strategies mapping
const definitionStrategies = {
  product: ProductMetafieldSyncStrategy,
  company: CompanyMetafieldSyncStrategy,
  order: OrderMetafieldSyncStrategy,
  variant: VariantMetafieldSyncStrategy,
  customer: CustomerMetafieldSyncStrategy,
  metaobject: MetaobjectSyncStrategy
};

// Data strategies mapping
const dataStrategies = {
  product: ProductSyncStrategy,
  page: PageSyncStrategy,
  metaobject: MetaobjectSyncStrategy
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

module.exports = {
  getDefinitionStrategyForResource,
  getDataStrategyForResource
};
