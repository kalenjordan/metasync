/**
 * GraphQL queries and mutations for Metaobject operations
 */

const FETCH_METAOBJECT_DEFINITIONS = require('./MetaobjectFetchDefinitions');
const FETCH_ALL_METAOBJECT_DEFINITIONS = require('./MetaobjectFetchAllDefinitions');
const FETCH_METAOBJECTS = require('./MetaobjectFetch');
const CREATE_METAOBJECT_DEFINITION = require('./MetaobjectCreateDefinition');
const UPDATE_METAOBJECT_DEFINITION = require('./MetaobjectUpdateDefinition');
const CREATE_METAOBJECT = require('./MetaobjectCreate');
const UPDATE_METAOBJECT = require('./MetaobjectUpdate');

module.exports = {
  FETCH_METAOBJECT_DEFINITIONS,
  FETCH_ALL_METAOBJECT_DEFINITIONS,
  FETCH_METAOBJECTS,
  CREATE_METAOBJECT_DEFINITION,
  UPDATE_METAOBJECT_DEFINITION,
  CREATE_METAOBJECT,
  UPDATE_METAOBJECT
};
