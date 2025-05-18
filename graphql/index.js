const logger = require("../utils/logger");
/**
 * GraphQL queries index file
 *
 * This file exports all GraphQL queries in one convenient place for easier importing.
 */

const DeleteCollection = require('./DeleteCollection.graphql');
const DeleteProduct = require('./DeleteProduct.graphql');
const GetCollectionById = require('./GetCollectionById.graphql');
const GetCollectionByHandle = require('./GetCollectionByHandle.graphql');
const GetCollections = require('./GetCollections.graphql');
const GetProductByHandle = require('./GetProductByHandle.graphql');
const GetProducts = require('./GetProducts.graphql');
const CreateCollection = require('./CreateCollection.graphql');
const UpdateCollection = require('./UpdateCollection.graphql');
const GetPages = require('./GetPages.graphql');
const CreatePage = require('./CreatePage.graphql');
const UpdatePage = require('./UpdatePage.graphql');

// Add metafield operation imports
const FetchMetafieldDefinitions = require('./FetchMetafieldDefinitions.graphql');
const CreateMetafieldDefinition = require('./CreateMetafieldDefinition.graphql');
const UpdateMetafieldDefinition = require('./UpdateMetafieldDefinition.graphql');
const DeleteMetafieldDefinition = require('./DeleteMetafieldDefinition.graphql');
const GetMetaobjectDefinitionType = require('./GetMetaobjectDefinitionType.graphql');
const GetMetaobjectDefinitionId = require('./GetMetaobjectDefinitionId.graphql');
const MetaobjectFetchDefinitions = require('./MetaobjectFetchDefinitions');
const MetaobjectFetchAllDefinitions = require('./MetaobjectFetchAllDefinitions');

module.exports = {
  DeleteCollection,
  DeleteProduct,
  GetCollectionById,
  GetCollectionByHandle,
  GetCollections,
  GetProductByHandle,
  GetProducts,
  CreateCollection,
  UpdateCollection,
  GetPages,
  CreatePage,
  UpdatePage,
  // Export metafield operations
  FetchMetafieldDefinitions,
  CreateMetafieldDefinition,
  UpdateMetafieldDefinition,
  DeleteMetafieldDefinition,
  GetMetaobjectDefinitionType,
  GetMetaobjectDefinitionId,
  MetaobjectFetchDefinitions,
  MetaobjectFetchAllDefinitions
};
