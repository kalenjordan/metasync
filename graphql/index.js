const logger = require("../utils/logger");
/**
 * GraphQL queries index file
 *
 * This file exports all GraphQL queries in one convenient place for easier importing.
 */

module.exports = {
  // Product queries
  GetProducts: require('./GetProducts.graphql.js'),
  GetProductByHandle: require('./GetProductByHandle.graphql.js'),

  // Collection queries
  GetCollections: require('./GetCollections.graphql.js'),
  GetCollectionByHandle: require('./GetCollectionByHandle.graphql.js'),
  GetCollectionById: require('./GetCollectionById.graphql.js'),
  CreateCollection: require('./CreateCollection.graphql.js'),
  UpdateCollection: require('./UpdateCollection.graphql.js'),

  // Page queries
  GetPages: require('./GetPages.graphql.js'),
  CreatePage: require('./CreatePage.graphql.js'),
  UpdatePage: require('./UpdatePage.graphql.js'),
};
