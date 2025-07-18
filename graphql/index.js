const logger = require("../utils/Logger");
/**
 * GraphQL queries index file
 *
 * This file exports all GraphQL queries in one convenient place for easier importing.
 */

const CollectionDelete = require('./CollectionDelete.graphql');
const CollectionCreate = require('./CollectionCreate.graphql');
const CollectionUpdate = require('./CollectionUpdate.graphql');
const CollectionFetchById = require('./CollectionFetchById.graphql');
const CollectionFetchByHandle = require('./CollectionFetchByHandle.graphql');
const CollectionFetchAll = require('./CollectionFetchAll.graphql');
const ProductDelete = require('./ProductDelete.graphql');
const ProductFetchByHandle = require('./ProductFetchByHandle.graphql');
const ProductFetchAll = require('./ProductFetchAll.graphql');
const PageFetchAll = require('./PageFetchAll.graphql');
const PageCreate = require('./PageCreate.graphql');
const PageUpdate = require('./PageUpdate.graphql');
const MenuFetchAll = require('./MenuFetchAll.graphql');
const MenuCreate = require('./MenuCreate.graphql');
const MenuUpdate = require('./MenuUpdate.graphql');

// Metafield operations
const MetafieldDefinitionsFetch = require('./MetafieldDefinitionsFetch.graphql');
const MetafieldDefinitionCreate = require('./MetafieldDefinitionCreate.graphql');
const MetafieldDefinitionUpdate = require('./MetafieldDefinitionUpdate.graphql');
const MetafieldDefinitionDelete = require('./MetafieldDefinitionDelete.graphql');
const MetaobjectDefinitionTypeFetch = require('./MetaobjectDefinitionTypeFetch.graphql');
const MetaobjectDefinitionIdFetch = require('./MetaobjectDefinitionIdFetch.graphql');

// Metaobject operations
const MetaobjectFetch = require('./MetaobjectFetch.graphql');
const MetaobjectFetchById = require('./MetaobjectFetchById.graphql');
const MetaobjectFetchAllDefinitions = require('./MetaobjectFetchAllDefinitions.graphql');
const MetaobjectFetchDefinitionById = require('./MetaobjectFetchDefinitionById.graphql');
const MetaobjectCreate = require('./MetaobjectCreate.graphql');
const MetaobjectUpdate = require('./MetaobjectUpdate.graphql');
const MetaobjectCreateDefinition = require('./MetaobjectCreateDefinition.graphql');
const MetaobjectUpdateDefinition = require('./MetaobjectUpdateDefinition.graphql');

module.exports = {
  CollectionCreate,
  CollectionDelete,
  CollectionFetchById,
  CollectionFetchByHandle,
  CollectionFetchAll,
  CollectionUpdate,
  ProductDelete,
  ProductFetchByHandle,
  ProductFetchAll,
  PageFetchAll,
  PageCreate,
  PageUpdate,
  MenuFetchAll,
  MenuCreate,
  MenuUpdate,
  // Metafield operations
  MetafieldDefinitionsFetch,
  MetafieldDefinitionCreate,
  MetafieldDefinitionUpdate,
  MetafieldDefinitionDelete,
  MetaobjectDefinitionTypeFetch,
  MetaobjectDefinitionIdFetch,
  // Metaobject operations
  MetaobjectFetch,
  MetaobjectFetchById,
  MetaobjectFetchAllDefinitions,
  MetaobjectFetchDefinitionById,
  MetaobjectCreate,
  MetaobjectUpdate,
  MetaobjectCreateDefinition,
  MetaobjectUpdateDefinition
};
