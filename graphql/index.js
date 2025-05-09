/**
 * GraphQL queries index file
 *
 * This file exports all GraphQL queries in one convenient place for easier importing.
 */

module.exports = {
  // Product queries
  GetProducts: require('./GetProducts.graphql'),
  GetProductByHandle: require('./GetProductByHandle.graphql'),

  // Collection queries
  GetCollectionByHandle: require('./GetCollectionByHandle.graphql'),
  GetCollectionById: require('./GetCollectionById.graphql'),

  // Page queries
  GetPages: require('./GetPages.graphql'),
  CreatePage: require('./CreatePage.graphql'),
  UpdatePage: require('./UpdatePage.graphql'),
};
